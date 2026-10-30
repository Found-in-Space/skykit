import { createJourneyOperation } from './operations.js';

/**
 * @template Scene, Services
 * @param {import('./index.d.ts').JourneyDefinition<Scene, Services>} definition
 * @returns {import('./index.d.ts').JourneyDefinition<Scene, Services>}
 */
export function defineGuidedJourney(definition) {
  if (!definition?.id || !Array.isArray(definition.chapters) || !definition.chapters.length) {
    throw new TypeError('A journey needs an id and ordered chapters.');
  }
  const ids = new Set();
  for (const chapter of definition.chapters) {
    if (!chapter.id || ids.has(chapter.id)) throw new TypeError(`Invalid or duplicate chapter id: ${chapter.id}`);
    ids.add(chapter.id);
  }
  const edges = new Set();
  for (const edge of definition.transitions ?? []) {
    const key = JSON.stringify([edge.from, edge.to]);
    if (!ids.has(edge.from) || !ids.has(edge.to) || edges.has(key)) throw new TypeError(`Invalid or duplicate journey edge: ${key}`);
    edges.add(key);
  }
  return Object.freeze({ ...definition,
    chapters: Object.freeze(definition.chapters.map(chapter => Object.freeze({ ...chapter }))),
    transitions: Object.freeze((definition.transitions ?? []).map(edge => Object.freeze({ ...edge }))),
  });
}

/**
 * @template Scene, Services
 * @param {{ definition: import('./index.d.ts').JourneyDefinition<Scene, Services>, driver: import('./index.d.ts').JourneyDriver<Scene, Services> }} options
 * @returns {import('./index.d.ts').GuidedJourneyController}
 */
export function createGuidedJourneyController({ definition: input, driver }) {
  const definition = defineGuidedJourney(input);
  const chapters = new Map(definition.chapters.map(chapter => [chapter.id, chapter]));
  /** @type {Set<(snapshot: import('./index.d.ts').JourneySnapshot) => void>} */
  const listeners = new Set();
  /** @type {Set<Promise<void>>} */
  const cleanupTasks = new Set();
  /** @type {unknown[]} */
  const cleanupErrors = [];
  /** @type {import('./index.d.ts').JourneySnapshot} */
  let state = { id: definition.id, status: 'idle', requestedChapterId: null, enteredChapterId: null,
    arrivedChapterId: null, history: [], operation: null, source: null, error: null, progress: null, disposed: false };
  /** @typedef {{ context: import('./index.d.ts').JourneyContext<Scene, Services>, chapter: import('./index.d.ts').JourneyChapter<Scene, Services>, controller: AbortController, cleanups: Set<import('./index.d.ts').Cleanup>, entered: boolean, closed: boolean, closing?: Promise<void> }} Scope */
  /** @typedef {{ control: import('./operations.d.ts').OperationControl, scope: Scope, navigation?: import('./operations.d.ts').JourneyOperation }} Activation */
  /** @type {Activation | null} */
  let pending = null;
  /** @type {Scope | null} */
  let activeScope = null;
  /** @type {Promise<void> | undefined} */
  let disposal;
  let departure = Promise.resolve();
  let serial = 0;
  const getSnapshot = () => ({ ...state, history: [...state.history] });
  /** @param {Partial<import('./index.d.ts').JourneySnapshot>} patch */
  function publish(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(getSnapshot());
  }
  /** @param {() => void | Promise<void>} work */
  function trackCleanup(work) {
    const task = Promise.resolve().then(work).catch(error => { cleanupErrors.push(error); });
    cleanupTasks.add(task);
    void task.then(() => cleanupTasks.delete(task));
    return task;
  }
  /** @param {Scope} scope @param {import('./index.d.ts').LeaveReason} reason */
  function closeScope(scope, reason) {
    if (scope.closing) return scope.closing;
    scope.closed = true;
    scope.controller.abort(reason);
    scope.closing = trackCleanup(async () => {
      try {
        if (scope.entered) {
          const cleanup = await scope.chapter.leave?.({ ...scope.context, reason });
          if (typeof cleanup === 'function') scope.cleanups.add(cleanup);
        }
      } finally {
        const cleanups = [...scope.cleanups].reverse();
        scope.cleanups.clear();
        const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Journey cleanup failed.');
      }
    });
    if (scope.entered) departure = Promise.all([departure, scope.closing]).then(() => {});
    return scope.closing;
  }
  /** @param {'cancelled' | 'superseded'} reason */
  function abortPending(reason) {
    const old = pending;
    if (!old) return;
    pending = null;
    old.navigation?.cancel();
    old.control.abort(reason);
    void closeScope(old.scope, reason);
    if (activeScope === old.scope) activeScope = null;
  }
  /** @param {import('./operations.d.ts').OperationStatus} status @param {unknown} [error] */
  function settledOperation(status, error) {
    const control = createJourneyOperation({ id: `${definition.id}:${++serial}` });
    control.settle(status, error);
    return control.operation;
  }
  /** @param {Scope} scope @param {(() => void | import('./index.d.ts').Cleanup | Promise<void | import('./index.d.ts').Cleanup>) | undefined} hook */
  async function runHook(scope, hook) {
    scope.context.throwIfAborted();
    const cleanup = await hook?.();
    if (typeof cleanup === 'function') scope.context.addCleanup(cleanup);
    scope.context.throwIfAborted();
  }
  /** @param {Activation} activation */
  async function activate(activation) {
    const { scope, control } = activation;
    const { chapter, context } = scope;
    try {
      await runHook(scope, () => driver.prepare?.(chapter.scene, context));
      await runHook(scope, () => chapter.prepare?.(context));
      if (activeScope) {
        const previous = activeScope;
        activeScope = null;
        await closeScope(previous, 'leave');
        context.throwIfAborted();
      }
      await departure;
      context.throwIfAborted();
      scope.entered = true;
      activeScope = scope;
      publish({ enteredChapterId: chapter.id });
      await runHook(scope, () => driver.enter?.(chapter.scene, context));
      await runHook(scope, () => chapter.enter?.(context));
      publish({ status: 'transitioning' });
      context.throwIfAborted();
      activation.navigation = driver.transition(chapter.scene, context);
      const result = await activation.navigation.finished;
      context.throwIfAborted();
      if (result.status !== 'completed') {
        pending = null;
        driver.cancel();
        activeScope = null;
        await closeScope(scope, result.status === 'failed' ? 'failed' : result.status);
        control.settle(result.status, result.error);
        if (state.operation === control.operation) publish({ status: result.status === 'failed' ? 'failed' : 'cancelled', error: result.error ?? null });
        return;
      }
      await runHook(scope, () => chapter.arrive?.(context));
      pending = null;
      control.settle('completed');
      publish({ status: 'active', arrivedChapterId: chapter.id, history: [...state.history, chapter.id], progress: null });
    } catch (error) {
      if (scope.closed || pending !== activation) return;
      pending = null;
      driver.cancel();
      if (activeScope === scope) activeScope = null;
      void closeScope(scope, 'failed');
      control.settle('failed', error);
      publish({ status: 'failed', error });
    }
  }
  /** @param {string} id @param {import('./index.d.ts').GoToOptions} [options] */
  function goTo(id, options = {}) {
    if (state.disposed) return settledOperation('failed', new Error('Journey is disposed.'));
    const chapter = chapters.get(id);
    if (!chapter) return settledOperation('failed', new RangeError(`Unknown chapter: ${id}`));
    if (options.signal?.aborted) return settledOperation('cancelled');
    const from = state.enteredChapterId;
    abortPending('superseded');
    driver.cancel();
    const controller = new AbortController();
    /** @type {Scope} */
    const scope = { chapter, controller, entered: false, closed: false, cleanups: new Set(), context: /** @type {any} */ (null) };
    const control = createJourneyOperation({ id: `${definition.id}:${++serial}`, signal: options.signal,
      onCancel(status) {
        if (pending?.scope !== scope) return;
        pending.navigation?.cancel();
        pending = null;
        driver.cancel();
        void closeScope(scope, status);
        if (activeScope === scope) activeScope = null;
        publish({ status: 'cancelled' });
      },
    });
    scope.context = {
      journeyId: definition.id, chapterId: id, previousChapterId: from, requestedChapterId: id,
      source: options.source ?? 'api', scene: chapter.scene, signal: controller.signal,
      services: /** @type {Services} */ (driver.services),
      transition: definition.transitions?.find(edge => edge.from === from && edge.to === id) ?? chapter.transition ?? definition.transition ?? {},
      isCurrent: () => !scope.closed && !state.disposed && (pending?.scope === scope || activeScope === scope),
      throwIfAborted() { controller.signal.throwIfAborted(); if (!this.isCurrent()) throw new Error('Journey activation superseded.'); },
      addCleanup(cleanup) {
        if (typeof cleanup !== 'function') throw new TypeError('Cleanup must be a function.');
        if (scope.closed) void trackCleanup(cleanup);
        else scope.cleanups.add(cleanup);
      },
      reportProgress(progress) { if (pending?.scope === scope) publish({ progress }); },
    };
    const activation = { control, scope };
    pending = activation;
    publish({ status: 'preparing', requestedChapterId: id, source: scope.context.source, operation: control.operation, error: null, progress: null });
    if (pending === activation) void activate(activation);
    return control.operation;
  }
  /** @param {number} direction @param {import('./index.d.ts').GoToOptions} [options] */
  function move(direction, options) {
    const cursor = state.requestedChapterId ?? state.enteredChapterId;
    const index = definition.chapters.findIndex(chapter => chapter.id === cursor);
    const target = index < 0 ? 0 : index + direction;
    if (target < 0 || target >= definition.chapters.length) return settledOperation('completed');
    return goTo(definition.chapters[target].id, options);
  }
  function cancel() {
    if (state.disposed) return;
    abortPending('cancelled');
    driver.cancel();
    if (activeScope) { void closeScope(activeScope, 'cancelled'); activeScope = null; }
    publish({ status: 'cancelled', progress: null });
  }
  return {
    start: (id = definition.chapters[0].id, options) => goTo(id, options),
    goTo, next: options => move(1, options), previous: options => move(-1, options), cancel, getSnapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      if (disposal) return disposal;
      abortPending('cancelled');
      driver.cancel();
      if (activeScope) { void closeScope(activeScope, 'disposed'); activeScope = null; }
      publish({ disposed: true, status: 'cancelled', progress: null });
      listeners.clear();
      disposal = (async () => {
        while (cleanupTasks.size) await Promise.all([...cleanupTasks]);
        if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Journey cleanup failed.');
      })();
      return disposal;
    },
  };
}
