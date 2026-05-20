import { SKYKIT_ACTIONS } from './actions.js';
import { normalizeVector3, parsePointArgs } from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitViewer} SkykitViewer
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

export function createSkykitDebugBridge() {
  /** @type {Map<string, import('./index.d.ts').SkykitDebugViewer>} */
  const viewers = new Map();
  /** @type {import('./index.d.ts').SkykitDebugDiagnostic[]} */
  const diagnostics = [];
  /** @type {string | null} */
  let activeId = null;
  let diagnosticOrdinal = 0;
  const maxDiagnostics = 100;

  return {
    listViewers,
    useViewer,
    getViewer,
    snapshot,
    recordDiagnostic,
    listDiagnostics,
    clearDiagnostics,
    registerViewer,
    unregisterViewer,
    getObserverPc,
    setObserverPc,
    flyToPc,
    lookAtPc,
    cancelAutomation,
    listActions,
    invokeAction,
    pressAction,
    releaseAction,
  };

  function listViewers() {
    return Array.from(viewers.values()).map((viewer) => ({
      id: viewer.id,
      label: viewer.label,
      disposed: viewer.disposed,
    }));
  }

  /** @param {string | number | SkykitViewer} target */
  function useViewer(target) {
    const debugViewer = resolveDebugViewer(target);
    activeId = debugViewer?.id ?? activeId;
    return debugViewer;
  }

  /** @param {string | number | SkykitViewer} [target] */
  function getViewer(target) {
    return target == null && activeId ? viewers.get(activeId) ?? null : resolveDebugViewer(target);
  }

  /** @param {string | number | SkykitViewer} [target] */
  function snapshot(target) {
    return getViewer(target)?.getSnapshotState() ?? null;
  }

  /** @param {import('./index.d.ts').SkykitDebugDiagnosticInput} diagnostic */
  function recordDiagnostic(diagnostic) {
    const message = resolveDiagnosticMessage(diagnostic);
    /** @type {import('./index.d.ts').SkykitDebugDiagnostic} */
    const record = {
      id: ++diagnosticOrdinal,
      timestampMs: finiteTimestamp(diagnostic.timestampMs),
      level: normalizeDiagnosticLevel(diagnostic.level),
      type: typeof diagnostic.type === 'string' && diagnostic.type
        ? diagnostic.type
        : 'debug/diagnostic',
      ...(typeof diagnostic.viewerId === 'string' && diagnostic.viewerId
        ? { viewerId: diagnostic.viewerId }
        : {}),
      ...(message ? { message } : {}),
      ...('data' in diagnostic ? { data: sanitizeDebugData(diagnostic.data) } : {}),
      ...('error' in diagnostic ? { error: sanitizeError(diagnostic.error) } : {}),
    };
    diagnostics.push(record);
    if (diagnostics.length > maxDiagnostics) {
      diagnostics.splice(0, diagnostics.length - maxDiagnostics);
    }
    return record;
  }

  /**
   * @param {import('./index.d.ts').SkykitDebugDiagnosticQuery} [query]
   */
  function listDiagnostics(query = {}) {
    const limit = Number.isFinite(Number(query.limit)) && Number(query.limit) > 0
      ? Math.floor(Number(query.limit))
      : diagnostics.length;
    return diagnostics
      .filter((diagnostic) => {
        if (query.level && diagnostic.level !== query.level) return false;
        if (query.type && diagnostic.type !== query.type) return false;
        if (query.viewerId && diagnostic.viewerId !== query.viewerId) return false;
        return true;
      })
      .slice(-limit)
      .map((diagnostic) => ({ ...diagnostic }));
  }

  function clearDiagnostics() {
    diagnostics.length = 0;
  }

  /**
   * @param {SkykitViewer} viewer
   * @param {import('./index.d.ts').SkykitDebugRegisterOptions} [options]
   */
  function registerViewer(viewer, options = {}) {
    const debugId = options.id ?? viewer.id;
    /** @type {Array<() => void>} */
    const teardowns = [];
    const unregister = () => {
      for (const teardown of teardowns.splice(0)) {
        teardown();
      }
      viewers.delete(debugId);
      if (activeId === debugId) {
        activeId = viewers.keys().next().value ?? null;
      }
    };
    const debugViewer = createDebugViewer(viewer, debugId, options.label ?? debugId, unregister);
    viewers.set(debugId, debugViewer);
    activeId ??= debugId;
    teardowns.push(
      viewer.on('viewer/dispose', unregister),
      viewer.on('*', (event) => recordViewerDiagnostic(debugId, event)),
    );
    return debugViewer;
  }

  /** @param {string | number | SkykitViewer} target */
  function unregisterViewer(target) {
    const debugViewer = resolveDebugViewer(target);
    if (!debugViewer) return false;
    debugViewer.unregister();
    return true;
  }

  /**
   * @param {string | number | SkykitViewer} [target]
   * @returns {Vector3Like | null}
   */
  function getObserverPc(target) {
    return getViewer(target)?.getObserverPc() ?? null;
  }

  /**
   * @param {Vector3Like | number} pointOrX
   * @param {number | string | SkykitViewer} [yOrTarget]
   * @param {number} [z]
   * @param {string | number | SkykitViewer} [target]
   */
  function setObserverPc(pointOrX, yOrTarget, z, target) {
    const { point, viewerTarget } = parsePointArgs(pointOrX, yOrTarget, z, target);
    const debugViewer = getViewer(viewerTarget);
    if (!debugViewer) throw new Error('No SkyKit debug viewer is registered.');
    return debugViewer.setObserverPc(point);
  }

  /**
   * @param {Vector3Like} point
   * @param {Record<string, unknown>} [options]
   * @param {string | number | SkykitViewer} [target]
   */
  function flyToPc(point, options = {}, target) {
    const debugViewer = getViewer(target);
    if (!debugViewer) throw new Error('No SkyKit debug viewer is registered.');
    return debugViewer.flyToPc(point, options);
  }

  /**
   * @param {Vector3Like} point
   * @param {Record<string, unknown>} [options]
   * @param {string | number | SkykitViewer} [target]
   */
  function lookAtPc(point, options = {}, target) {
    const debugViewer = getViewer(target);
    if (!debugViewer) throw new Error('No SkyKit debug viewer is registered.');
    return debugViewer.lookAtPc(point, options);
  }

  /** @param {string | number | SkykitViewer} [target] */
  function cancelAutomation(target) {
    return getViewer(target)?.cancelAutomation() ?? false;
  }

  /** @param {string | number | SkykitViewer} [target] */
  function listActions(target) {
    return getViewer(target)?.listActions() ?? [];
  }

  /**
   * @param {string} id
   * @param {unknown} [payload]
   * @param {string | number | SkykitViewer} [target]
   */
  function invokeAction(id, payload, target) {
    const debugViewer = getViewer(target);
    if (!debugViewer) throw new Error('No SkyKit debug viewer is registered.');
    return debugViewer.invokeAction(id, payload);
  }

  /**
   * @param {string} id
   * @param {unknown} [payload]
   * @param {string | number | SkykitViewer} [target]
   */
  function pressAction(id, payload, target) {
    const debugViewer = getViewer(target);
    if (!debugViewer) throw new Error('No SkyKit debug viewer is registered.');
    return debugViewer.pressAction(id, payload);
  }

  /**
   * @param {string} id
   * @param {string | number | SkykitViewer} [target]
   */
  function releaseAction(id, target) {
    const debugViewer = getViewer(target);
    if (!debugViewer) throw new Error('No SkyKit debug viewer is registered.');
    return debugViewer.releaseAction(id);
  }

  /**
   * @param {string | number | SkykitViewer | undefined} target
   */
  function resolveDebugViewer(target) {
    if (target == null) {
      return activeId ? viewers.get(activeId) ?? null : viewers.values().next().value ?? null;
    }
    if (typeof target === 'number') {
      return Array.from(viewers.values())[target] ?? null;
    }
    if (typeof target === 'string') {
      return viewers.get(target) ?? null;
    }
    return Array.from(viewers.values()).find((viewer) => viewer.viewer === target) ?? null;
  }

  /**
   * @param {SkykitViewer} viewer
   * @param {string} debugId
   * @param {string} label
   * @param {() => void} unregister
   * @returns {import('./index.d.ts').SkykitDebugViewer}
   */
  function createDebugViewer(viewer, debugId, label, unregister) {
    return /** @type {import('./index.d.ts').SkykitDebugViewer} */ ({
      id: debugId,
      label,
      viewer,
      get disposed() {
        return viewer.getSnapshot().disposed;
      },
      getSnapshotState() {
        return viewer.getSnapshot();
      },
      getObserverPc() {
        return viewer.observerRig.getObserverPc();
      },
      setObserverPc(pointOrX, y, z) {
        const point = typeof pointOrX === 'number'
          ? normalizeVector3({ x: pointOrX, y, z }, { x: 0, y: 0, z: 0 })
          : normalizeVector3(pointOrX, { x: 0, y: 0, z: 0 });
        viewer.requestViewState({ observerPc: point }, 'debug.setObserverPc');
        viewer.update(0);
        return viewer.observerRig.getObserverPc();
      },
      flyToPc(point, options = {}) {
        const target = normalizeVector3(point, { x: 0, y: 0, z: 0 });
        if (viewer.actions.listActions().some((entry) => entry.id === SKYKIT_ACTIONS.navigation.flyTo)) {
          void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.flyTo, { ...options, targetPc: target }, { source: 'debug' });
          return target;
        }
        return this.setObserverPc(target);
      },
      lookAtPc(point, options = {}) {
        const target = normalizeVector3(point, { x: 0, y: 0, z: 0 });
        if (viewer.actions.listActions().some((entry) => entry.id === SKYKIT_ACTIONS.navigation.lookAt)) {
          void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.lookAt, { ...options, targetPc: target }, { source: 'debug' });
        } else {
          viewer.requestViewState({ targetPc: target }, 'debug.lookAtPc');
        }
        viewer.update(0);
        return target;
      },
      cancelAutomation() {
        if (viewer.actions.listActions().some((entry) => entry.id === SKYKIT_ACTIONS.navigation.cancel)) {
          void viewer.actions.invoke(SKYKIT_ACTIONS.navigation.cancel, undefined, { source: 'debug' });
          return true;
        }
        return false;
      },
      listActions() {
        return viewer.actions.listActions();
      },
      invokeAction(id, payload) {
        return viewer.actions.invoke(id, payload, { source: 'debug' });
      },
      pressAction(id, payload) {
        viewer.actions.press(id, payload, { source: 'debug' });
      },
      releaseAction(id) {
        viewer.actions.release(id, { source: 'debug' });
      },
      unregister,
    });
  }

  /**
   * @param {string} debugId
   * @param {import('./index.d.ts').SkykitEvent} event
   */
  function recordViewerDiagnostic(debugId, event) {
    if (!isDiagnosticEvent(event)) return;
    recordDiagnostic({
      level: 'error',
      type: event.type,
      viewerId: debugId,
      data: sanitizeDebugData(event),
      ...(event.error ? { error: event.error } : {}),
    });
  }
}

/**
 * @param {import('./index.d.ts').SkykitDebugBridge} debugBridge
 * @param {import('./index.d.ts').InstallSkykitDebugGlobalOptions} [options]
 */
export function installSkykitDebugGlobal(debugBridge, options = {}) {
  const target = /** @type {Record<string, unknown>} */ (options.target ?? globalThis);
  const name = options.name ?? 'skykitDebug';
  const previous = target[name];
  target[name] = debugBridge;
  return () => {
    if (previous === undefined) {
      delete target[name];
    } else {
      target[name] = previous;
    }
  };
}

/** @param {import('./index.d.ts').SkykitEvent} event */
function isDiagnosticEvent(event) {
  return event.type === 'task/error' ||
    event.type.endsWith('/error') ||
    Boolean(event.error);
}

/**
 * @param {unknown} value
 * @returns {import('./index.d.ts').SkykitDebugDiagnosticLevel}
 */
function normalizeDiagnosticLevel(value) {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}

/** @param {unknown} value */
function finiteTimestamp(value) {
  const timestamp = Number(value);
  if (Number.isFinite(timestamp)) return timestamp;
  return globalThis.performance?.now?.() ?? Date.now();
}

/** @param {import('./index.d.ts').SkykitDebugDiagnosticInput} diagnostic */
function resolveDiagnosticMessage(diagnostic) {
  if (typeof diagnostic.message === 'string' && diagnostic.message) {
    return diagnostic.message;
  }
  return resolveErrorMessage(diagnostic.error);
}

/** @param {unknown} error */
function resolveErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof /** @type {{ message?: unknown }} */ (error).message === 'string') {
    return /** @type {{ message: string }} */ (error).message;
  }
  if (typeof error === 'string') return error;
  return null;
}

/** @param {unknown} error */
function sanitizeError(error) {
  if (!error) return error;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  if (typeof error === 'object') {
    const message = resolveErrorMessage(error);
    const sanitized = sanitizeDebugData(error, 1);
    return {
      ...(message ? { message } : {}),
      ...(sanitized && typeof sanitized === 'object' ? sanitized : {}),
    };
  }
  return error;
}

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function sanitizeDebugData(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Error) return sanitizeError(value);
  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor.name,
      byteLength: value.byteLength,
      length: 'length' in value ? value.length : undefined,
    };
  }
  if (depth >= 3) {
    return summarizeObject(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((entry) => sanitizeDebugData(entry, depth + 1));
  }

  /** @type {Record<string, unknown>} */
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isHeavyDebugKey(key)) {
      output[key] = summarizeObject(entry);
      continue;
    }
    output[key] = sanitizeDebugData(entry, depth + 1);
  }
  return output;
}

/** @param {string} key */
function isHeavyDebugKey(key) {
  return key === 'viewer' ||
    key === 'frame' ||
    key === 'renderer' ||
    key === 'scene' ||
    key === 'camera' ||
    key === 'roots' ||
    key === 'source' ||
    key === 'session' ||
    key === 'part' ||
    key === 'object3d';
}

/** @param {unknown} value */
function summarizeObject(value) {
  if (value == null || typeof value !== 'object') return value;
  const object = /** @type {{ id?: unknown; type?: unknown; name?: unknown; constructor?: { name?: string } }} */ (value);
  return {
    type: object.constructor?.name ?? 'Object',
    ...(typeof object.id === 'string' ? { id: object.id } : {}),
    ...(typeof object.name === 'string' ? { name: object.name } : {}),
  };
}
