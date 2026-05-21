import {
  combineStrategies,
  createStarCellStore,
} from '@found-in-space/star-trees';

import { isProviderSession, toStarOctreeViewPatch } from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitStarCellDemand} SkykitStarCellDemand
 * @typedef {import('./index.d.ts').SkykitStarCellSource} SkykitStarCellSource
 * @typedef {import('./index.d.ts').SkykitStarSourcePluginOptions} SkykitStarSourcePluginOptions
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('@found-in-space/star-trees').StarCellDelta} StarCellDelta
 * @typedef {import('@found-in-space/star-trees').StarCellKey} StarCellKey
 * @typedef {import('@found-in-space/star-trees').StarCellStrategy} StarCellStrategy
 * @typedef {SkykitStarCellDemand & {
 *   id: string;
 *   strategy: SkykitStarCellDemand['strategy'] | null;
 *   view?: SkykitStarCellDemand['view'];
 *   attributes: string[];
 * }} NormalizedStarCellDemand
 * @typedef {{
 *   until: 'first-upsert' | 'current';
 *   maxAgeMs: number;
 * }} RestartRetentionPolicy
 * @typedef {{
 *   cellKeys: Set<StarCellKey>;
 *   until: RestartRetentionPolicy['until'];
 *   timeoutId: ReturnType<typeof setTimeout> | null;
 * }} RetainedRestartCells
 */

const DEFAULT_RESTART_RETENTION_MAX_AGE_MS = 20_000;

/**
 * @param {SkykitStarSourcePluginOptions} options
 * @returns {SkykitStarCellSource}
 */
export function createSkykitStarSourcePlugin(options) {
  if (!options?.provider && !isProviderSession(options?.session)) {
    throw new TypeError('createSkykitStarSourcePlugin() requires provider or session.');
  }

  const id = options.id ?? 'skykit-star-source';
  const store = createStarCellStore();
  /** @type {Map<string, NormalizedStarCellDemand>} */
  const demands = new Map();
  /** @type {Set<(delta: StarCellDelta) => void>} */
  const listeners = new Set();
  /** @type {StarOctreeProviderSession | null} */
  let session = isProviderSession(options.session) ? options.session : null;
  const ownsSession = session == null;
  /** @type {(() => void) | null} */
  let unsubscribeSession = null;
  /** @type {import('./index.d.ts').SkykitThreePluginContext | null} */
  let context = null;
  let started = false;
  let disposed = false;
  let demandOrdinal = 0;
  /** @type {Promise<void>} */
  let pendingRestart = Promise.resolve();
  let deltaCount = 0;
  let status = /** @type {'idle' | 'streaming' | 'current' | 'failed' | 'disposed'} */ ('idle');
  /** @type {string | null} */
  let lastError = null;
  /** @type {string | null} */
  let lastErrorEventKey = null;
  const restartRetentionPolicy = normalizeRestartRetentionPolicy(options.retainCellsOnRestart);
  /** @type {RetainedRestartCells | null} */
  let retainedRestartCells = null;

  if (options.strategy) {
    addDemand({
      id: `${id}:base`,
      strategy: options.strategy,
      attributes: options.attributes,
    });
  }

  /** @type {SkykitStarCellSource} */
  const source = {
    id,
    priority: options.priority ?? 100,
    setup(pluginContext) {
      pluginContext.addPart(source);
    },
    addDemand,
    registerDemand: addDemand,
    removeDemand,
    refreshDemand,
    subscribe,
    apply,
    getStore: () => store,
    getSnapshot,
    attach,
    start,
    setView,
    detach,
    dispose,
  };

  return source;

  /**
   * @param {SkykitStarCellDemand} demand
   */
  function addDemand(demand) {
    const demandId = demand.id ?? `${id}:demand-${++demandOrdinal}`;
    demands.set(demandId, normalizeDemand(demand, demandId));
    if (session && ownsSession && context) {
      void queueRestart('skykit.demand');
    }
    return () => {
      removeDemand(demandId);
    };
  }

  /**
   * @param {string} demandId
   */
  function removeDemand(demandId) {
    const removed = demands.delete(demandId);
    if (removed && session && ownsSession && context) {
      void queueRestart('skykit.demand');
    }
  }

  /**
   * @param {string} [reason]
   */
  function refreshDemand(reason = 'skykit.demand') {
    if (!session || !ownsSession || !context || disposed) {
      return Promise.resolve();
    }
    return queueRestart(reason);
  }

  /**
   * @param {(delta: StarCellDelta) => void} listener
   * @param {{ replay?: boolean }} [subscribeOptions]
   */
  function subscribe(listener, subscribeOptions = {}) {
    listeners.add(listener);
    if (subscribeOptions.replay !== false) {
      const cells = store.getCells();
      if (cells.length > 0) {
        listener({ type: 'stars/cells-upsert', providerId: id, cells });
      }
      const snapshot = store.getSnapshot();
      if (snapshot.lastDelta?.type === 'stars/current') {
        listener(snapshot.lastDelta);
      }
      if (snapshot.lastError?.type === 'stars/error') {
        listener(snapshot.lastError);
      }
    }
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * @param {StarCellDelta} delta
   */
  function apply(delta) {
    if (disposed) return;
    deltaCount += 1;
    store.apply(delta);
    if (delta.type === 'stars/current') {
      status = 'current';
    } else if (delta.type === 'stars/error') {
      status = 'failed';
      lastError = delta.error?.message ?? 'Star cell stream failed.';
      emitStarSourceError(delta);
    } else {
      status = 'streaming';
    }
    for (const listener of listeners) {
      listener(delta);
    }
    flushRetainedRestartCells(delta);
  }

  /**
   * @param {Extract<StarCellDelta, { type: 'stars/error' }>} delta
   */
  function emitStarSourceError(delta) {
    const message = delta.error?.message ?? 'Star cell stream failed.';
    const error = /** @type {{ name?: unknown; stack?: unknown }} */ (delta.error ?? {});
    const key = `${delta.providerId ?? id}:${delta.sessionId ?? ''}:${delta.demandRevision ?? ''}:${message}`;
    if (key === lastErrorEventKey) return;
    lastErrorEventKey = key;
    context?.emit?.({
      type: 'stars/source/error',
      sourceId: id,
      providerId: delta.providerId,
      sessionId: delta.sessionId,
      demandRevision: delta.demandRevision,
      error: {
        name: typeof error.name === 'string' ? error.name : 'Error',
        message,
        ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
      },
    });
  }

  /** @param {import('./index.d.ts').SkykitThreePluginContext} nextContext */
  function attach(nextContext) {
    context = nextContext;
    if (!session) {
      session = createSession(nextContext.getViewState());
    }
  }

  function start() {
    started = true;
    subscribeSession();
  }

  /** @param {SkykitViewState} view */
  function setView(view) {
    if (disposed) return;
    session?.updateView(resolveProviderViewPatch(view), {
      reason: 'skykit.view',
      ...(options.updateOptions ?? {}),
    });
  }

  function detach() {
    unsubscribeSession?.();
    unsubscribeSession = null;
  }

  async function dispose() {
    if (disposed) return;
    detach();
    clearRetainedRestartCells();
    clearStoreForConsumers();
    disposed = true;
    status = 'disposed';
    if (ownsSession) {
      await session?.dispose();
    }
    session = null;
    demands.clear();
    listeners.clear();
    store.clear();
  }

  function getSnapshot() {
    return {
      id,
      status,
      deltaCount,
      sessionId: session?.id ?? null,
      demandCount: demands.size,
      demands: Array.from(demands.values()).map((demand) => ({
        id: demand.id,
        attributes: demand.attributes ? [...demand.attributes] : [],
      })),
      store: store.getSnapshot(),
      session: session?.getSnapshot?.() ?? null,
      provider: options.provider?.getSnapshot?.() ?? null,
      lastError,
      disposed,
    };
  }

  /**
   * @param {SkykitViewState} view
   */
  function createSession(view) {
    if (!options.provider) {
      throw new TypeError('SkyKit star source cannot create a session without provider.');
    }
    const sessionOptions = /** @type {import('@found-in-space/star-octree-provider').StarOctreeSessionOptions | undefined} */ (
      isProviderSession(options.session) ? undefined : options.session
    );
    const strategy = resolveCompositeStrategy(view, sessionOptions?.strategy);
    const attributes = resolveAttributes(sessionOptions?.attributes);
    return options.provider.createSession({
      ...(sessionOptions ?? {}),
      ...(strategy ? { strategy } : {}),
      ...(attributes.length > 0 ? { attributes } : {}),
      coordinates: options.coordinates
        ?? sessionOptions?.coordinates
        ?? createSkykitRenderCoordinateOutput(view.coordinateUnitsPerParsec),
    });
  }

  function subscribeSession() {
    if (!session || unsubscribeSession) return;
    unsubscribeSession = session.subscribe((delta) => {
      apply(delta);
    });
  }

  /**
   * @param {string} reason
   */
  function queueRestart(reason) {
    pendingRestart = pendingRestart
      .catch(() => {})
      .then(() => restartSession(reason));
    return pendingRestart;
  }

  /**
   * @param {string} reason
   */
  async function restartSession(reason) {
    if (!context || !ownsSession || disposed) return;
    const previousSession = session;
    unsubscribeSession?.();
    unsubscribeSession = null;
    if (restartRetentionPolicy) {
      retainCurrentStoreCellsForRestart(restartRetentionPolicy);
    } else {
      clearStoreForConsumers();
    }
    session = createSession(context.getViewState());
    if (started) {
      subscribeSession();
      setView(context.getViewState());
    }
    await previousSession?.dispose();
    context.emit?.({
      type: 'stars/source/restart',
      source,
      reason,
      session,
    });
  }

  function clearStoreForConsumers() {
    const cellKeys = store.getCells().map((cell) => cell.cellKey);
    if (cellKeys.length > 0) {
      apply({ type: 'stars/cells-remove', providerId: id, cellKeys });
    }
  }

  /** @param {RestartRetentionPolicy} policy */
  function retainCurrentStoreCellsForRestart(policy) {
    clearRetainedRestartCells();
    const cellKeys = store.getCells().map((cell) => cell.cellKey);
    if (cellKeys.length === 0) return;
    retainedRestartCells = {
      cellKeys: new Set(cellKeys),
      until: policy.until,
      timeoutId: setTimeout(() => {
        releaseRetainedRestartCells(new Set());
      }, policy.maxAgeMs),
    };
  }

  /** @param {StarCellDelta} delta */
  function flushRetainedRestartCells(delta) {
    if (!retainedRestartCells || retainedRestartCells.cellKeys.size === 0) return;
    /** @type {Set<StarCellKey> | null} */
    let replacementCellKeys = null;
    if (delta.type === 'stars/cells-upsert' && retainedRestartCells.until === 'first-upsert') {
      replacementCellKeys = new Set(delta.cells.map((cell) => cell.cellKey));
    } else if (delta.type === 'stars/current') {
      replacementCellKeys = new Set(delta.cellKeys);
    } else if (delta.type === 'stars/error') {
      replacementCellKeys = new Set();
    }
    if (!replacementCellKeys) return;
    releaseRetainedRestartCells(replacementCellKeys);
  }

  /** @param {Set<StarCellKey>} replacementCellKeys */
  function releaseRetainedRestartCells(replacementCellKeys) {
    if (!retainedRestartCells) return;
    const cellKeys = Array.from(retainedRestartCells.cellKeys)
      .filter((cellKey) => !replacementCellKeys.has(cellKey));
    clearRetainedRestartCells();
    emitCellRemoval(cellKeys);
  }

  function clearRetainedRestartCells() {
    if (retainedRestartCells?.timeoutId) {
      clearTimeout(retainedRestartCells.timeoutId);
    }
    retainedRestartCells = null;
  }

  /** @param {StarCellKey[]} cellKeys */
  function emitCellRemoval(cellKeys) {
    if (cellKeys.length === 0) return;
    const delta = /** @type {Extract<StarCellDelta, { type: 'stars/cells-remove' }>} */ (
      { type: 'stars/cells-remove', providerId: id, cellKeys }
    );
    deltaCount += 1;
    store.apply(delta);
    for (const listener of listeners) {
      listener(delta);
    }
  }

  /**
   * @param {SkykitViewState} view
   * @param {SkykitStarCellDemand['strategy'] | undefined} baseStrategy
   */
  function resolveCompositeStrategy(view, baseStrategy) {
    const strategies = [];
    const resolvedBaseStrategy = resolveDemandStrategy(baseStrategy, view);
    if (resolvedBaseStrategy) {
      strategies.push(resolvedBaseStrategy);
    }
    for (const demand of demands.values()) {
      const strategy = resolveDemandStrategy(demand.strategy, view);
      if (strategy) {
        strategies.push(strategy);
      }
    }
    if (strategies.length === 0) {
      return undefined;
    }
    if (strategies.length === 1) {
      return strategies[0];
    }
    return combineStrategies(strategies);
  }

  /**
   * @param {SkykitViewState} view
   */
  function resolveProviderViewPatch(view) {
    let patch = toStarOctreeViewPatch(view);
    for (const demand of demands.values()) {
      const demandPatch = resolveDemandViewPatch(demand.view, view);
      if (demandPatch) {
        patch = mergeStarSourceViewPatch(patch, demandPatch);
      }
    }
    return patch;
  }

  /**
   * @param {readonly string[] | undefined} sessionAttributes
   */
  function resolveAttributes(sessionAttributes) {
    const attributes = new Set(sessionAttributes ?? options.attributes ?? []);
    for (const demand of demands.values()) {
      for (const attribute of demand.attributes ?? []) {
        attributes.add(attribute);
      }
    }
    return Array.from(attributes);
  }
}

/**
 * @param {SkykitStarCellDemand} demand
 * @param {string} id
 * @returns {NormalizedStarCellDemand}
 */
function normalizeDemand(demand, id) {
  return {
    id,
    strategy: demand.strategy ?? null,
    view: demand.view,
    attributes: demand.attributes ? Array.from(demand.attributes) : [],
  };
}

/**
 * @param {SkykitStarSourcePluginOptions['retainCellsOnRestart']} value
 * @returns {RestartRetentionPolicy | null}
 */
function normalizeRestartRetentionPolicy(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const until = value.until === 'first-upsert' || value.until === 'current'
    ? value.until
    : null;
  if (!until) return null;
  const maxAgeMs = positiveFiniteNumber(
    value.maxAgeMs,
    DEFAULT_RESTART_RETENTION_MAX_AGE_MS,
  );
  return { until, maxAgeMs };
}

/**
 * @param {SkykitStarCellDemand['strategy']} strategy
 * @param {SkykitViewState} view
 * @returns {StarCellStrategy | null}
 */
function resolveDemandStrategy(strategy, view) {
  if (!strategy) {
    return null;
  }
  if (typeof strategy === 'function') {
    return strategy(view);
  }
  return strategy;
}

/**
 * @param {SkykitStarCellDemand['view']} viewPatch
 * @param {SkykitViewState} view
 */
function resolveDemandViewPatch(viewPatch, view) {
  if (!viewPatch) {
    return null;
  }
  if (typeof viewPatch === 'function') {
    return viewPatch(view) ?? null;
  }
  return viewPatch;
}

/**
 * @param {import('@found-in-space/star-octree-provider').StarOctreeViewPatch} base
 * @param {Partial<import('@found-in-space/star-octree-provider').StarOctreeViewPatch>} patch
 */
function mergeStarSourceViewPatch(base, patch) {
  const merged = {
    ...base,
    ...patch,
  };
  if (base.limitingMagnitude !== undefined || patch.limitingMagnitude !== undefined) {
    const baseLimit = Number(base.limitingMagnitude);
    const nextLimit = Number(patch.limitingMagnitude);
    merged.limitingMagnitude = Math.max(
      Number.isFinite(baseLimit) ? baseLimit : -Infinity,
      Number.isFinite(nextLimit) ? nextLimit : -Infinity,
    );
  }
  return merged;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * @param {number} coordinateUnitsPerParsec
 * @returns {import('@found-in-space/star-octree-provider').StarOctreeCoordinateOutput}
 */
export function createSkykitRenderCoordinateOutput(coordinateUnitsPerParsec) {
  const scale = Number.isFinite(coordinateUnitsPerParsec) && coordinateUnitsPerParsec > 0
    ? coordinateUnitsPerParsec
    : 1;
  if (scale === 1) {
    return {
      name: 'icrs-parsec-position',
      frame: 'icrs',
      units: ['pc', 'pc', 'pc'],
    };
  }
  return {
    name: 'skykit-render-position',
    frame: 'icrs',
    units: ['render-unit', 'render-unit', 'render-unit'],
    transformPosition({ xPc, yPc, zPc }) {
      return {
        x: xPc * scale,
        y: yPc * scale,
        z: zPc * scale,
      };
    },
  };
}
