export const SKYKIT_ACTION_NAMESPACE = 'skykit:';

export const SKYKIT_ACTIONS = Object.freeze({
  viewer: Object.freeze({
    reset: 'skykit:viewer.reset',
  }),
  observer: Object.freeze({
    recenterParallax: 'skykit:observer.parallax.recenter',
    enableParallaxTilt: 'skykit:observer.parallax.enableTilt',
  }),
  navigation: Object.freeze({
    flyTo: 'skykit:navigation.flyTo',
    flyPolyline: 'skykit:navigation.flyPolyline',
    transitionTo: 'skykit:navigation.transitionTo',
    orbit: 'skykit:navigation.orbit',
    orbitalInsert: 'skykit:navigation.orbitalInsert',
    lookAt: 'skykit:navigation.lookAt',
    lockAt: 'skykit:navigation.lockAt',
    unlockAt: 'skykit:navigation.unlockAt',
    cancelMovement: 'skykit:navigation.cancelMovement',
    cancelOrientation: 'skykit:navigation.cancelOrientation',
    cancel: 'skykit:navigation.cancel',
  }),
  ship: Object.freeze({
    moveForward: 'skykit:ship.move.forward',
    moveBack: 'skykit:ship.move.back',
    moveLeft: 'skykit:ship.move.left',
    moveRight: 'skykit:ship.move.right',
    moveUp: 'skykit:ship.move.up',
    moveDown: 'skykit:ship.move.down',
    pitchUp: 'skykit:ship.attitude.pitchUp',
    pitchDown: 'skykit:ship.attitude.pitchDown',
    yawLeft: 'skykit:ship.attitude.yawLeft',
    yawRight: 'skykit:ship.attitude.yawRight',
    rollClockwise: 'skykit:ship.attitude.rollClockwise',
    rollAnticlockwise: 'skykit:ship.attitude.rollAnticlockwise',
    boost: 'skykit:ship.boost',
  }),
  layer: Object.freeze({
    toggle: 'skykit:layer.toggle',
    show: 'skykit:layer.show',
    hide: 'skykit:layer.hide',
  }),
  selection: Object.freeze({
    clear: 'skykit:selection.clear',
    flyToSelected: 'skykit:selection.flyToSelected',
    openExternal: 'skykit:selection.openExternal',
  }),
  journey: Object.freeze({
    goToChapter: 'skykit:journey.goToChapter',
    next: 'skykit:journey.next',
    previous: 'skykit:journey.previous',
    seek: 'skykit:journey.seek',
    play: 'skykit:journey.play',
    pause: 'skykit:journey.pause',
  }),
});

export const SKYKIT_CONTROLS = Object.freeze({
  observer: Object.freeze({
    parallaxOffset: 'skykit:observer.control.parallaxOffset',
  }),
  ship: Object.freeze({
    move: 'skykit:ship.control.move',
    attitude: 'skykit:ship.control.attitude',
  }),
});

/**
 * @returns {import('./index.d.ts').SkykitActionRegistry}
 */
export function createSkykitActionRegistry() {
  /** @type {Map<string, Array<import('./index.d.ts').SkykitActionRecord>>} */
  const handlers = new Map();
  /** @type {Map<string, Set<string>>} */
  const pressedSources = new Map();
  /** @type {Map<string, unknown>} */
  const controlValues = new Map();
  /** @type {Set<(event: import('./index.d.ts').SkykitActionEvent) => void>} */
  const listeners = new Set();
  let order = 0;

  const registry = {
    registerAction,
    registerContext,
    invoke,
    press,
    release,
    isPressed,
    setControlValue,
    getControlValue,
    listActions,
    subscribe,
    getSnapshot,
    dispose,
  };

  return registry;

  /**
   * @param {string} id
   * @param {import('./index.d.ts').SkykitActionHandler} handler
   * @param {import('./index.d.ts').SkykitActionRegisterOptions} [options]
   */
  function registerAction(id, handler, options = {}) {
    const actionId = normalizeActionId(id);
    if (typeof handler !== 'function') {
      throw new TypeError('SkyKit action handlers must be functions.');
    }
    const record = {
      id: actionId,
      label: options.label,
      priority: finiteNumber(options.priority, 0),
      order: order += 1,
      handler,
    };
    let records = handlers.get(actionId);
    if (!records) {
      records = [];
      handlers.set(actionId, records);
    }
    records.push(record);
    records.sort(compareActionRecords);
    emit({ type: 'action/register', id: actionId, record: summarizeRecord(record) });
    return () => {
      const nextRecords = handlers.get(actionId);
      if (!nextRecords) return;
      const index = nextRecords.indexOf(record);
      if (index >= 0) nextRecords.splice(index, 1);
      if (!nextRecords.length) handlers.delete(actionId);
      emit({ type: 'action/unregister', id: actionId, record: summarizeRecord(record) });
    };
  }

  /**
   * @param {string} namespace
   * @param {Record<string, import('./index.d.ts').SkykitActionHandler>} contextHandlers
   * @param {import('./index.d.ts').SkykitActionRegisterOptions} [options]
   */
  function registerContext(namespace, contextHandlers, options = {}) {
    const prefix = normalizeContextNamespace(namespace);
    /** @type {Array<() => void>} */
    const unregisters = [];
    for (const [name, handler] of Object.entries(contextHandlers ?? {})) {
      unregisters.push(registerAction(`${prefix}.${name}`, handler, options));
    }
    return () => {
      for (const unregister of unregisters.splice(0).reverse()) {
        unregister();
      }
    };
  }

  /**
   * @param {string} id
   * @param {unknown} [payload]
   * @param {import('./index.d.ts').SkykitActionMetadata} [metadata]
   */
  async function invoke(id, payload, metadata = {}) {
    const actionId = normalizeActionId(id);
    const records = [...(handlers.get(actionId) ?? [])];
    emit({ type: 'action/invoke', id: actionId, payload, metadata, handlerCount: records.length });
    /** @type {PromiseSettledResult<unknown>[]} */
    const results = [];
    for (const record of records) {
      try {
        const value = await record.handler({
          id: actionId,
          payload,
          metadata,
          registry,
        });
        results.push({ status: 'fulfilled', value });
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error));
        results.push({ status: 'rejected', reason });
        emit({
          type: 'action/error',
          id: actionId,
          payload,
          metadata,
          error: reason,
          message: reason.message,
          record: summarizeRecord(record),
        });
      }
    }
    return results;
  }

  /**
   * @param {string} id
   * @param {unknown} [payload]
   * @param {import('./index.d.ts').SkykitActionMetadata} [metadata]
   */
  function press(id, payload, metadata = {}) {
    const actionId = normalizeActionId(id);
    const source = actionSource(metadata);
    let sources = pressedSources.get(actionId);
    if (!sources) {
      sources = new Set();
      pressedSources.set(actionId, sources);
    }
    sources.add(source);
    emit({ type: 'action/press', id: actionId, payload, metadata, source, pressed: true });
  }

  /**
   * @param {string} id
   * @param {import('./index.d.ts').SkykitActionMetadata} [metadata]
   */
  function release(id, metadata = {}) {
    const actionId = normalizeActionId(id);
    const source = actionSource(metadata);
    const sources = pressedSources.get(actionId);
    sources?.delete(source);
    if (sources && sources.size === 0) {
      pressedSources.delete(actionId);
    }
    emit({ type: 'action/release', id: actionId, metadata, source, pressed: isPressed(actionId) });
  }

  /** @param {string} id */
  function isPressed(id) {
    return (pressedSources.get(normalizeActionId(id))?.size ?? 0) > 0;
  }

  /**
   * @param {string} id
   * @param {unknown} value
   * @param {import('./index.d.ts').SkykitActionMetadata} [metadata]
   */
  function setControlValue(id, value, metadata = {}) {
    const controlId = normalizeActionId(id);
    controlValues.set(controlId, value);
    emit({ type: 'action/control', id: controlId, value, metadata });
  }

  /** @param {string} id */
  function getControlValue(id) {
    return controlValues.get(normalizeActionId(id));
  }

  function listActions() {
    return Array.from(handlers.entries())
      .map(([id, records]) => ({
        id,
        handlerCount: records.length,
        handlers: records.map(summarizeRecord),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** @param {(event: import('./index.d.ts').SkykitActionEvent) => void} listener */
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return {
      actions: listActions(),
      pressed: Array.from(pressedSources.entries())
        .map(([id, sources]) => ({ id, sources: Array.from(sources).sort() }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      controls: Array.from(controlValues.keys()).sort(),
    };
  }

  function dispose() {
    handlers.clear();
    pressedSources.clear();
    controlValues.clear();
    listeners.clear();
  }

  /** @param {import('./index.d.ts').SkykitActionEvent} event */
  function emit(event) {
    for (const listener of listeners) {
      listener(event);
    }
  }
}

/**
 * @param {string} id
 */
export function normalizeActionId(id) {
  const normalized = String(id ?? '').trim();
  if (!normalized) {
    throw new TypeError('SkyKit action ids must be non-empty strings.');
  }
  return normalized;
}

/** @param {string} namespace */
function normalizeContextNamespace(namespace) {
  return normalizeActionId(namespace).replace(/[.]+$/u, '');
}

/**
 * @param {import('./index.d.ts').SkykitActionMetadata} metadata
 */
function actionSource(metadata) {
  const source = metadata?.source;
  return typeof source === 'string' && source ? source : 'default';
}

/** @param {import('./index.d.ts').SkykitActionRecord} record */
function summarizeRecord(record) {
  return {
    id: record.id,
    priority: record.priority,
    order: record.order,
    ...(record.label ? { label: record.label } : {}),
  };
}

/**
 * @param {import('./index.d.ts').SkykitActionRecord} left
 * @param {import('./index.d.ts').SkykitActionRecord} right
 */
function compareActionRecords(left, right) {
  return left.priority - right.priority || left.order - right.order;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
