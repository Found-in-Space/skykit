import { SKYKIT_ACTIONS } from './actions.js';
import { normalizeVector3, parsePointArgs } from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitViewer} SkykitViewer
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

export function createSkykitDebugBridge() {
  /** @type {Map<string, import('./index.d.ts').SkykitDebugViewer>} */
  const viewers = new Map();
  /** @type {string | null} */
  let activeId = null;

  return {
    listViewers,
    useViewer,
    getViewer,
    snapshot,
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

  /**
   * @param {SkykitViewer} viewer
   * @param {import('./index.d.ts').SkykitDebugRegisterOptions} [options]
   */
  function registerViewer(viewer, options = {}) {
    const debugId = options.id ?? viewer.id;
    const debugViewer = createDebugViewer(viewer, debugId, options.label ?? debugId);
    viewers.set(debugId, debugViewer);
    activeId ??= debugId;
    const off = viewer.on('viewer/dispose', () => {
      off();
      viewers.delete(debugId);
      if (activeId === debugId) {
        activeId = viewers.keys().next().value ?? null;
      }
    });
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
   * @returns {import('./index.d.ts').SkykitDebugViewer}
   */
  function createDebugViewer(viewer, debugId, label) {
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
      unregister() {
        viewers.delete(debugId);
        if (activeId === debugId) {
          activeId = viewers.keys().next().value ?? null;
        }
      },
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
