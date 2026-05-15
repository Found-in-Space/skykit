import * as THREE from 'three';

const DEFAULT_MAG_LIMIT = 6.5;
const IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/**
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 * @typedef {import('./index.d.ts').QuaternionLike} QuaternionLike
 * @typedef {import('./index.d.ts').SkykitEvent} SkykitEvent
 * @typedef {import('./index.d.ts').SkykitPart} SkykitPart
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 * @typedef {import('./index.d.ts').SkykitThreeFrame} SkykitThreeFrame
 * @typedef {import('./index.d.ts').SkykitThreePluginContext} SkykitThreePluginContext
 * @typedef {import('./index.d.ts').SkykitViewer} SkykitViewer
 * @typedef {import('./index.d.ts').SkykitViewerOptions} SkykitViewerOptions
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('./index.d.ts').SkykitViewportSize} SkykitViewportSize
 * @typedef {import('./index.d.ts').SkykitPluginInput} SkykitPluginInput
 * @typedef {import('./index.d.ts').SkykitPluginTeardown} SkykitPluginTeardown
 * @typedef {import('./index.d.ts').SkykitSceneRoots} SkykitSceneRoots
 * @typedef {import('./index.d.ts').SkykitObserverRig} SkykitObserverRig
 * @typedef {import('./index.d.ts').Object3dLayerOptions} Object3dLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayerOptions} StreamingStarLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayer} StreamingStarLayer
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProductDelta} StarOctreeProductDelta
 */

/**
 * @param {SkykitViewerOptions} [options]
 * @returns {Promise<SkykitViewer>}
 */
export async function createSkykitViewer(options = {}) {
  const id = options.id ?? `skykit-viewer-${Math.random().toString(36).slice(2)}`;
  const scene = options.scene ?? new THREE.Scene();
  const renderer = options.renderer ?? createNoopRenderer();
  const camera = options.camera ?? new THREE.PerspectiveCamera(60, 1, 0.1, 10_000);
  const roots = createSceneRoots(id, options.roots);
  const observerRig = options.observerRig ?? createDesktopSkykitObserverRig(options.view);
  const host = options.host ?? null;
  /** @type {SkykitThreePart[]} */
  const parts = [];
  /** @type {Array<() => Promise<void> | void>} */
  const disposables = [];
  /** @type {Map<string, Set<(event: SkykitEvent) => void>>} */
  const listeners = new Map();
  /** @type {Map<symbol | string, unknown>} */
  const stores = new Map();
  /** @type {Map<symbol | string, unknown>} */
  const resources = new Map();
  /** @type {Array<{ id: string; status: 'active' | 'finished' | 'failed' | 'cancelled'; reason?: string; priority?: string; error?: string; controller: AbortController }>} */
  const scheduledTasks = [];
  /** @type {Array<() => void>} */
  const pendingTaskStarters = [];
  /** @type {Partial<SkykitViewState> | null} */
  let pendingViewPatch = null;
  let disposed = false;
  let started = false;
  let elapsedSeconds = 0;
  let view = normalizeViewState({
    ...options.view,
    observerPc: options.view?.observerPc ?? observerRig.getObserverPc(),
    renderObserverPosition: options.view?.renderObserverPosition ?? observerRig.getRenderObserverPosition(),
    orientationIcrs: options.view?.orientationIcrs ?? observerRig.getOrientationIcrs?.() ?? null,
    motion: options.view?.motion ?? observerRig.getMotion?.() ?? null,
  }, 0);

  addRootToScene(scene, roots.originContentRoot);
  addRootToScene(scene, roots.observerContentRoot);
  addRootToScene(scene, roots.navigationRoot);
  for (const root of roots.scaleBandedContentRoots.values()) {
    addRootToScene(scene, root);
  }
  roots.navigationRoot.add(camera);
  syncRootsFromView(roots, view);
  mountRenderer(host, renderer, options.autoMountRenderer !== false);

  /** @type {SkykitViewer} */
  const viewer = {
    id,
    mode: 'three',
    scene,
    renderer,
    camera,
    roots,
    contentRoot: roots.originContentRoot,
    navigationRoot: roots.navigationRoot,
    observerRig,
    addPart,
    getViewState,
    requestViewState,
    update,
    render,
    frame,
    resize,
    on,
    emit,
    getSnapshot,
    dispose,
  };

  const context = createContext(viewer);

  for (const part of options.parts ?? []) {
    addPartRecord(part);
  }

  for (const plugin of options.plugins ?? []) {
    const teardown = await setupPlugin(plugin, context);
    if (typeof teardown === 'function') {
      disposables.push(teardown);
    }
  }

  for (const part of orderedParts()) {
    await attachPart(part, context);
    await startPart(part, context);
    part.setView?.(cloneViewState(view));
  }
  started = true;
  for (const startTask of pendingTaskStarters.splice(0)) {
    startTask();
  }

  emit({ type: 'viewer/start', viewer });
  return viewer;

  /**
   * @param {SkykitThreePart} part
   * @returns {SkykitPluginTeardown}
   */
  function addPart(part) {
    assertActive();
    addPartRecord(part);
    if (started) {
      void attachPart(part, context)
        .then(() => startPart(part, context))
        .then(() => part.setView?.(cloneViewState(view)));
    }
    return () => {
      void removePart(part);
    };
  }

  /**
   * @param {SkykitThreePart} part
   */
  function addPartRecord(part) {
    if (!part || typeof part !== 'object') {
      throw new TypeError('SkyKit parts must be objects.');
    }
    parts.push(part);
    parts.sort(compareParts);
  }

  /**
   * @param {SkykitThreePart} part
   */
  async function removePart(part) {
    const index = parts.indexOf(part);
    if (index >= 0) {
      parts.splice(index, 1);
    }
    await detachAndDisposePart(part);
  }

  function getViewState() {
    return cloneViewState(view);
  }

  /**
   * @param {Partial<SkykitViewState>} patch
   * @param {string} [reason]
   */
  function requestViewState(patch, reason) {
    assertActive();
    pendingViewPatch = {
      ...(pendingViewPatch ?? {}),
      ...patch,
    };
    emit({ type: 'view/request', reason, patch });
  }

  /**
   * @param {number} [deltaSeconds]
   */
  function update(deltaSeconds = 0) {
    assertActive();
    const dt = Math.max(0, finiteNumber(deltaSeconds, 0));
    elapsedSeconds += dt;
    const viewChanged = flushViewPatch(false);
    observerRig.update?.(createFrame(dt));
    view = normalizeViewState({
      ...view,
      motion: observerRig.getMotion?.() ?? view.motion ?? null,
      renderObserverPosition: observerRig.getRenderObserverPosition(),
    }, view.revision);
    if (viewChanged) {
      for (const part of orderedParts()) {
        part.setView?.(cloneViewState(view));
      }
      emit({ type: 'view/change', view: cloneViewState(view) });
    }
    for (const part of orderedParts()) {
      part.update?.(createFrame(dt));
    }
  }

  function render() {
    assertActive();
    const frameData = createFrame(0);
    for (const part of orderedParts()) {
      part.beforeRender?.(frameData);
    }
    renderer.render?.(scene, camera);
    for (const part of orderedParts()) {
      part.afterRender?.(frameData);
    }
  }

  /**
   * @param {number} [deltaSeconds]
   */
  function frame(deltaSeconds = 0) {
    update(deltaSeconds);
    render();
  }

  /**
   * @param {Partial<SkykitViewportSize>} [size]
   */
  function resize(size = {}) {
    assertActive();
    const nextSize = {
      width: positiveFinite(size.width, host?.clientWidth ?? 1),
      height: positiveFinite(size.height, host?.clientHeight ?? 1),
      devicePixelRatio: positiveFinite(size.devicePixelRatio, globalThis.devicePixelRatio ?? 1),
    };
    renderer.setPixelRatio?.(nextSize.devicePixelRatio);
    renderer.setSize?.(nextSize.width, nextSize.height, true);
    for (const part of orderedParts()) {
      part.resize?.(nextSize);
    }
    emit({ type: 'viewer/resize', size: nextSize });
  }

  /**
   * @param {string} type
   * @param {(event: SkykitEvent) => void} listener
   */
  function on(type, listener) {
    let typeListeners = listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      listeners.set(type, typeListeners);
    }
    typeListeners.add(listener);
    return () => {
      typeListeners?.delete(listener);
    };
  }

  /**
   * @param {SkykitEvent} event
   */
  function emit(event) {
    const typed = listeners.get(event.type);
    if (typed) {
      for (const listener of typed) listener(event);
    }
    const wildcard = listeners.get('*');
    if (wildcard) {
      for (const listener of wildcard) listener(event);
    }
  }

  function getSnapshot() {
    return {
      id,
      disposed,
      partCount: parts.length,
      pluginCount: Array.from(options.plugins ?? []).length,
      view: cloneViewState(view),
      roots: {
        originContentRoot: roots.originContentRoot.name,
        observerContentRoot: roots.observerContentRoot.name,
        navigationRoot: roots.navigationRoot.name,
        scaleBandedContentRoots: Array.from(roots.scaleBandedContentRoots.keys()),
      },
      scheduledTasks: scheduledTasks.map((task) => ({
        id: task.id,
        status: task.status,
        ...(task.reason ? { reason: task.reason } : {}),
        ...(task.priority ? { priority: task.priority } : {}),
        ...(task.error ? { error: task.error } : {}),
      })),
    };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    emit({ type: 'viewer/dispose', viewer });
    for (const task of scheduledTasks) {
      if (task.status === 'active') {
        task.status = 'cancelled';
        task.controller.abort();
      }
    }
    for (const part of [...orderedParts()].reverse()) {
      await detachAndDisposePart(part);
    }
    for (const disposable of [...disposables].reverse()) {
      await disposable();
    }
    for (const resource of resources.values()) {
      await disposeMaybe(resource);
    }
    await disposeMaybe(observerRig);
    if (host && renderer.domElement && typeof host.removeChild === 'function') {
      try {
        host.removeChild(renderer.domElement);
      } catch {
        // The host may already have been cleared by application code.
      }
    }
    listeners.clear();
    stores.clear();
    resources.clear();
  }

  /**
   * @param {boolean} [notifyParts]
   */
  function flushViewPatch(notifyParts = true) {
    if (!pendingViewPatch) return false;
    const nextRevision = view.revision + 1;
    view = normalizeViewState({ ...view, ...pendingViewPatch }, nextRevision);
    pendingViewPatch = null;
    observerRig.setObserverPc?.(view.observerPc);
    if (view.orientationIcrs) {
      observerRig.setOrientationIcrs?.(view.orientationIcrs);
    }
    syncRootsFromView(roots, view);
    if (notifyParts) {
      for (const part of orderedParts()) {
        part.setView?.(cloneViewState(view));
      }
      emit({ type: 'view/change', view: cloneViewState(view) });
    }
    return true;
  }

  /**
   * @param {number} deltaSeconds
   * @returns {SkykitThreeFrame}
   */
  function createFrame(deltaSeconds) {
    return {
      viewer,
      deltaSeconds,
      elapsedSeconds,
      view: cloneViewState(view),
      renderer,
      scene,
      camera,
      roots,
      observerRig,
    };
  }

  function orderedParts() {
    return [...parts].sort(compareParts);
  }

  /**
   * @param {SkykitViewer} currentViewer
   * @returns {SkykitThreePluginContext}
   */
  function createContext(currentViewer) {
    return {
      mode: 'three',
      viewer: currentViewer,
      scene,
      renderer,
      camera,
      roots,
      contentRoot: roots.originContentRoot,
      navigationRoot: roots.navigationRoot,
      observerRig,
      addPart: currentViewer.addPart,
      addDisposable(disposable) {
        const teardown = typeof disposable === 'function'
          ? disposable
          : () => disposable.dispose?.();
        disposables.push(teardown);
        return () => {
          const index = disposables.indexOf(teardown);
          if (index >= 0) disposables.splice(index, 1);
          void teardown();
        };
      },
      getViewState: currentViewer.getViewState,
      requestViewState: currentViewer.requestViewState,
      on: currentViewer.on,
      emit: currentViewer.emit,
      useStore(key, factory) {
        if (!stores.has(key)) {
          stores.set(key, factory());
        }
        return stores.get(key);
      },
      useResource(key, factory) {
        if (!resources.has(key)) {
          resources.set(key, factory());
        }
        return /** @type {any} */ (resources.get(key));
      },
      scheduleTask(task, taskOptions = {}) {
        const controller = new AbortController();
        const record = {
          id: `task-${scheduledTasks.length + 1}`,
          status: /** @type {'active' | 'finished' | 'failed' | 'cancelled'} */ ('active'),
          reason: taskOptions.reason,
          priority: taskOptions.priority,
          controller,
        };
        scheduledTasks.push(record);
        const startTask = () => {
          void Promise.resolve()
            .then(() => task({
              viewer: currentViewer,
              signal: controller.signal,
              reason: taskOptions.reason,
              priority: taskOptions.priority,
            }))
            .then(() => {
              if (record.status === 'active') record.status = 'finished';
            })
            .catch((error) => {
              record.status = 'failed';
              record.error = error instanceof Error ? error.message : String(error);
              emit({ type: 'task/error', task: record, error });
            });
        };
        if (started) {
          startTask();
        } else {
          pendingTaskStarters.push(startTask);
        }
        return () => {
          if (record.status === 'active') {
            record.status = 'cancelled';
            controller.abort();
          }
        };
      },
    };
  }

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitViewer has been disposed.');
    }
  }
}

/**
 * @param {import('./index.d.ts').DesktopSkykitObserverRigOptions} [options]
 * @returns {SkykitObserverRig}
 */
export function createDesktopSkykitObserverRig(options = {}) {
  let observerPc = normalizeVector3(options.observerPc, { x: 0, y: 0, z: 0 });
  let orientationIcrs = normalizeQuaternion(options.orientationIcrs, IDENTITY_QUATERNION);
  let previousObserverPc = cloneVector3(observerPc);
  let motion = {
    velocityPcPerSec: { x: 0, y: 0, z: 0 },
    speedPcPerSec: 0,
  };
  let disposed = false;
  return {
    type: 'desktop',
    getObserverPc() {
      assertActive();
      return cloneVector3(observerPc);
    },
    getRenderObserverPosition() {
      assertActive();
      return cloneVector3(observerPc);
    },
    getOrientationIcrs() {
      assertActive();
      return cloneQuaternion(orientationIcrs);
    },
    getMotion() {
      assertActive();
      return cloneMotion(motion);
    },
    setObserverPc(nextObserverPc) {
      assertActive();
      observerPc = normalizeVector3(nextObserverPc, observerPc);
    },
    setOrientationIcrs(nextOrientation) {
      assertActive();
      orientationIcrs = normalizeQuaternion(nextOrientation, orientationIcrs);
    },
    update(frameData) {
      assertActive();
      const dt = Math.max(0, finiteNumber(frameData.deltaSeconds, 0));
      if (dt > 0) {
        const velocity = {
          x: (observerPc.x - previousObserverPc.x) / dt,
          y: (observerPc.y - previousObserverPc.y) / dt,
          z: (observerPc.z - previousObserverPc.z) / dt,
        };
        motion = {
          velocityPcPerSec: velocity,
          speedPcPerSec: Math.hypot(velocity.x, velocity.y, velocity.z),
        };
      } else {
        motion = {
          velocityPcPerSec: { x: 0, y: 0, z: 0 },
          speedPcPerSec: 0,
        };
      }
      previousObserverPc = cloneVector3(observerPc);
    },
    dispose() {
      disposed = true;
    },
  };

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitObserverRig has been disposed.');
    }
  }
}

/**
 * @param {Object3dLayerOptions} options
 * @returns {SkykitThreePart}
 */
export function createObject3dLayer(options) {
  if (!options?.object3d) {
    throw new TypeError('createObject3dLayer() requires object3d.');
  }
  const id = options.id ?? options.object3d.name ?? 'object3d-layer';
  const anchorMode = options.anchorMode ?? 'world-space';
  /** @type {THREE.Object3D | null} */
  let parent = null;
  return {
    id,
    priority: options.priority,
    object3d: options.object3d,
    attach(context) {
      parent = resolveAnchorRoot(context.roots, anchorMode, options.scaleBandId);
      parent.add(options.object3d);
    },
    detach() {
      parent?.remove(options.object3d);
      parent = null;
    },
    dispose() {
      parent?.remove(options.object3d);
      parent = null;
      if (options.disposeObject) {
        disposeObjectTree(options.object3d);
      }
    },
    getSnapshot() {
      return {
        id,
        anchorMode,
        scaleBandId: options.scaleBandId ?? null,
        mounted: parent != null,
      };
    },
  };
}

/**
 * @param {StreamingStarLayerOptions} options
 * @returns {StreamingStarLayer}
 */
export function createStreamingStarLayer(options) {
  if (!options?.provider) {
    throw new TypeError('createStreamingStarLayer() requires provider.');
  }
  if (!options?.renderer) {
    throw new TypeError('createStreamingStarLayer() requires renderer.');
  }
  const id = options.id ?? 'streaming-stars';
  /** @type {StarOctreeProviderSession | null} */
  let session = isProviderSession(options.session) ? options.session : null;
  const ownsSession = session == null;
  /** @type {(() => void) | null} */
  let unsubscribe = null;
  let disposed = false;
  let deltaCount = 0;
  let status = /** @type {'idle' | 'streaming' | 'current' | 'failed' | 'disposed'} */ ('idle');
  /** @type {string | null} */
  let lastError = null;

  /** @type {StreamingStarLayer} */
  const layer = {
    id,
    priority: options.priority,
    object3d: options.renderer.object3d,
    apply,
    attach,
    start,
    setView,
    detach,
    dispose,
    getSnapshot,
  };
  return layer;

  /**
   * @param {StarOctreeProductDelta} delta
   */
  function apply(delta) {
    if (disposed) return;
    deltaCount += 1;
    options.renderer.apply(delta);
    if (delta.type === 'data/representation-current') {
      status = 'current';
    } else if (delta.type === 'data/product-error') {
      status = 'failed';
      lastError = delta.error?.message ?? 'Product stream failed.';
    } else {
      status = 'streaming';
    }
  }

  /** @param {SkykitThreePluginContext} context */
  function attach(context) {
    context.roots.originContentRoot.add(options.renderer.object3d);
    if (!session) {
      const sessionOptions = /** @type {import('@found-in-space/star-octree-provider').StarOctreeSessionOptions | undefined} */ (
        isProviderSession(options.session) ? undefined : options.session
      );
      session = options.provider.createSession({
        ...(sessionOptions ?? {}),
        ...(options.attributes ? { attributes: Array.from(options.attributes) } : {}),
        ...(options.coordinates ? { coordinates: options.coordinates } : {}),
      });
    }
  }

  /** @param {SkykitThreePluginContext} context */
  function start(context) {
    if (!session) return;
    unsubscribe = session.subscribe((delta) => {
      apply(delta);
    });
  }

  /** @param {SkykitViewState} view */
  function setView(view) {
    if (disposed) return;
    options.renderer.setView({
      observerPosition: view.renderObserverPosition,
      limitingMagnitude: view.limitingMagnitude,
      coordinateUnitsPerParsec: view.coordinateUnitsPerParsec,
    });
    session?.updateView(toStarOctreeViewPatch(view), {
      reason: 'skykit.view',
      ...(options.updateOptions ?? {}),
    });
  }

  function detach() {
    options.renderer.object3d.parent?.remove(options.renderer.object3d);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    status = 'disposed';
    unsubscribe?.();
    unsubscribe = null;
    detach();
    if (ownsSession) {
      await session?.dispose();
    }
    options.renderer.dispose();
  }

  function getSnapshot() {
    return {
      id,
      status,
      deltaCount,
      sessionId: session?.id ?? null,
      renderer: options.renderer.getSnapshot(),
      session: session?.getSnapshot?.() ?? null,
      lastError,
    };
  }
}

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
    return {
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
        if (typeof /** @type {{ flyToPc?: unknown }} */ (viewer).flyToPc === 'function') {
          return /** @type {{ flyToPc: (point: Vector3Like, options?: Record<string, unknown>) => Vector3Like }} */ (viewer)
            .flyToPc(point, options);
        }
        return this.setObserverPc(point);
      },
      lookAtPc(point, options = {}) {
        if (typeof /** @type {{ lookAtPc?: unknown }} */ (viewer).lookAtPc === 'function') {
          return /** @type {{ lookAtPc: (point: Vector3Like, options?: Record<string, unknown>) => Vector3Like }} */ (viewer)
            .lookAtPc(point, options);
        }
        const target = normalizeVector3(point, { x: 0, y: 0, z: 0 });
        viewer.requestViewState({ targetPc: target }, 'debug.lookAtPc');
        viewer.update(0);
        return target;
      },
      cancelAutomation() {
        if (typeof /** @type {{ cancelAutomation?: unknown }} */ (viewer).cancelAutomation === 'function') {
          /** @type {{ cancelAutomation: () => void }} */ (viewer).cancelAutomation();
          return true;
        }
        return false;
      },
      unregister() {
        viewers.delete(debugId);
        if (activeId === debugId) {
          activeId = viewers.keys().next().value ?? null;
        }
      },
    };
  }
}

/**
 * @param {import('./index.d.ts').SkykitDebugBridge} debugBridge
 * @param {import('./index.d.ts').InstallSkykitDebugGlobalOptions} [options]
 */
export function installSkykitDebugGlobal(debugBridge, options = {}) {
  const target = options.target ?? globalThis;
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

/**
 * @param {SkykitSceneRoots} roots
 * @param {import('./index.d.ts').SkykitLayerAnchorMode} anchorMode
 * @param {string} [scaleBandId]
 */
function resolveAnchorRoot(roots, anchorMode, scaleBandId) {
  if (anchorMode === 'observer-centric') return roots.observerContentRoot;
  if (anchorMode === 'scale-banded') {
    const id = scaleBandId ?? 'default';
    let root = roots.scaleBandedContentRoots.get(id);
    if (!root) {
      root = namedGroup(`skykit:scale-banded:${id}`);
      roots.scaleBandedContentRoots.set(id, root);
    }
    return root;
  }
  return roots.originContentRoot;
}

/**
 * @param {SkykitViewerOptions['roots']} roots
 * @returns {SkykitSceneRoots}
 */
function createSceneRoots(id, roots = {}) {
  return {
    originContentRoot: roots.originContentRoot ?? namedGroup(`${id}:origin-content-root`),
    observerContentRoot: roots.observerContentRoot ?? namedGroup(`${id}:observer-content-root`),
    scaleBandedContentRoots: roots.scaleBandedContentRoots ?? new Map(),
    navigationRoot: roots.navigationRoot ?? namedGroup(`${id}:navigation-root`),
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Object3D} object
 */
function addRootToScene(scene, object) {
  if (!object.parent) {
    scene.add(object);
  }
}

/**
 * @param {SkykitSceneRoots} roots
 * @param {SkykitViewState} view
 */
function syncRootsFromView(roots, view) {
  const scale = view.coordinateUnitsPerParsec;
  roots.observerContentRoot.position.set(
    view.observerPc.x * scale,
    view.observerPc.y * scale,
    view.observerPc.z * scale,
  );
  roots.observerContentRoot.quaternion.identity();
  roots.navigationRoot.position.set(
    view.observerPc.x * scale,
    view.observerPc.y * scale,
    view.observerPc.z * scale,
  );
  const orientation = normalizeQuaternion(view.orientationIcrs, IDENTITY_QUATERNION);
  roots.navigationRoot.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
}

/**
 * @param {Partial<SkykitViewState>} input
 * @param {number} revision
 * @returns {SkykitViewState}
 */
function normalizeViewState(input = {}, revision = 0) {
  const observerPc = normalizeVector3(input.observerPc, { x: 0, y: 0, z: 0 });
  const coordinateUnitsPerParsec = positiveFinite(input.coordinateUnitsPerParsec, 1);
  return {
    revision,
    observerPc,
    renderObserverPosition: normalizeVector3(input.renderObserverPosition, observerPc),
    targetPc: input.targetPc == null ? null : normalizeVector3(input.targetPc, { x: 0, y: 0, z: 0 }),
    directionIcrs: input.directionIcrs == null ? null : normalizeVector3(input.directionIcrs, { x: 0, y: 0, z: -1 }),
    orientationIcrs: input.orientationIcrs == null ? null : normalizeQuaternion(input.orientationIcrs, IDENTITY_QUATERNION),
    limitingMagnitude: finiteNumber(input.limitingMagnitude, DEFAULT_MAG_LIMIT),
    ...(input.verticalFovDeg !== undefined ? { verticalFovDeg: finiteNumber(input.verticalFovDeg, 40) } : {}),
    ...(input.aspectRatio !== undefined ? { aspectRatio: positiveFinite(input.aspectRatio, 1) } : {}),
    motion: input.motion ?? null,
    coordinateUnitsPerParsec,
  };
}

/** @param {SkykitViewState} view */
function cloneViewState(view) {
  return {
    ...view,
    observerPc: cloneVector3(view.observerPc),
    renderObserverPosition: cloneVector3(view.renderObserverPosition),
    targetPc: view.targetPc ? cloneVector3(view.targetPc) : null,
    directionIcrs: view.directionIcrs ? cloneVector3(view.directionIcrs) : null,
    orientationIcrs: view.orientationIcrs ? cloneQuaternion(view.orientationIcrs) : null,
    motion: view.motion ? cloneMotion(view.motion) : null,
  };
}

/** @param {SkykitViewState} view */
function toStarOctreeViewPatch(view) {
  /** @type {StarOctreeViewPatch} */
  const patch = {
    observerPc: view.observerPc,
    limitingMagnitude: view.limitingMagnitude,
    mDesired: view.limitingMagnitude,
    ...(view.targetPc ? { targetPc: view.targetPc } : {}),
    ...(view.directionIcrs ? { directionIcrs: view.directionIcrs } : {}),
    ...(view.orientationIcrs ? { orientationIcrs: view.orientationIcrs } : {}),
    ...(view.verticalFovDeg !== undefined ? { verticalFovDeg: view.verticalFovDeg } : {}),
    ...(view.aspectRatio !== undefined ? { aspectRatio: view.aspectRatio } : {}),
    ...(view.motion ? { motion: view.motion } : {}),
  };
  return patch;
}

/**
 * @param {SkykitPluginInput} plugin
 * @param {SkykitThreePluginContext} context
 */
async function setupPlugin(plugin, context) {
  if (typeof plugin === 'function') {
    return plugin(context);
  }
  if (!plugin || typeof plugin.setup !== 'function') {
    throw new TypeError('SkyKit plugins must be setup functions or objects with setup().');
  }
  return plugin.setup(context);
}

/**
 * @param {SkykitThreePart} part
 * @param {SkykitThreePluginContext} context
 */
async function attachPart(part, context) {
  await part.attach?.(context);
}

/**
 * @param {SkykitThreePart} part
 * @param {SkykitThreePluginContext} context
 */
async function startPart(part, context) {
  await part.start?.(context);
}

/** @param {SkykitThreePart} part */
async function detachAndDisposePart(part) {
  await part.detach?.();
  await part.dispose?.();
}

/** @param {SkykitThreePart} a @param {SkykitThreePart} b */
function compareParts(a, b) {
  return (a.priority ?? 0) - (b.priority ?? 0);
}

/**
 * @param {unknown} value
 * @returns {value is StarOctreeProviderSession}
 */
function isProviderSession(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof /** @type {{ updateView?: unknown }} */ (value).updateView === 'function'
      && typeof /** @type {{ subscribe?: unknown }} */ (value).subscribe === 'function',
  );
}

function createNoopRenderer() {
  return {
    domElement: { nodeName: 'CANVAS' },
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  };
}

/**
 * @param {SkykitViewerOptions['host']} host
 * @param {SkykitViewerOptions['renderer']} renderer
 * @param {boolean} autoMount
 */
function mountRenderer(host, renderer, autoMount) {
  if (!host || !autoMount || !renderer?.domElement || typeof host.appendChild !== 'function') return;
  host.appendChild(renderer.domElement);
}

/** @param {unknown} value */
async function disposeMaybe(value) {
  if (value && typeof value === 'object' && typeof /** @type {{ dispose?: unknown }} */ (value).dispose === 'function') {
    await /** @type {{ dispose: () => void | Promise<void> }} */ (value).dispose();
  }
}

/**
 * @param {THREE.Object3D} object
 */
function disposeObjectTree(object) {
  object.traverse?.((child) => {
    const disposable = /** @type {{ geometry?: { dispose?: () => void }; material?: { dispose?: () => void } | Array<{ dispose?: () => void }> }} */ (child);
    disposable.geometry?.dispose?.();
    const materials = Array.isArray(disposable.material)
      ? disposable.material
      : disposable.material
        ? [disposable.material]
        : [];
    for (const material of materials) material.dispose?.();
  });
}

/**
 * @param {Vector3Like | number} pointOrX
 * @param {number | string | SkykitViewer | undefined} yOrTarget
 * @param {number | undefined} z
 * @param {string | number | SkykitViewer | undefined} target
 */
function parsePointArgs(pointOrX, yOrTarget, z, target) {
  if (typeof pointOrX === 'number') {
    return {
      point: normalizeVector3({ x: pointOrX, y: yOrTarget, z }, { x: 0, y: 0, z: 0 }),
      viewerTarget: target,
    };
  }
  return {
    point: normalizeVector3(pointOrX, { x: 0, y: 0, z: 0 }),
    viewerTarget: yOrTarget,
  };
}

/**
 * @param {unknown} value
 * @param {Vector3Like} fallback
 * @returns {Vector3Like}
 */
function normalizeVector3(value, fallback) {
  if (!value || typeof value !== 'object') return cloneVector3(fallback);
  const vector = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(vector.x);
  const y = Number(vector.y);
  const z = Number(vector.z);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : cloneVector3(fallback);
}

/**
 * @param {unknown} value
 * @param {QuaternionLike} fallback
 * @returns {QuaternionLike}
 */
function normalizeQuaternion(value, fallback) {
  if (!value || typeof value !== 'object') return cloneQuaternion(fallback);
  const q = /** @type {{ x?: unknown; y?: unknown; z?: unknown; w?: unknown }} */ (value);
  const x = Number(q.x);
  const y = Number(q.y);
  const z = Number(q.z);
  const w = Number(q.w);
  const length = Math.hypot(x, y, z, w);
  return length > 0
    ? { x: x / length, y: y / length, z: z / length, w: w / length }
    : cloneQuaternion(fallback);
}

/** @param {Vector3Like} value */
function cloneVector3(value) {
  return { x: value.x, y: value.y, z: value.z };
}

/** @param {QuaternionLike} value */
function cloneQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

/** @param {import('./index.d.ts').SkykitObserverMotion} motion */
function cloneMotion(motion) {
  return {
    velocityPcPerSec: cloneVector3(motion.velocityPcPerSec),
    speedPcPerSec: motion.speedPcPerSec,
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {string} name */
function namedGroup(name) {
  const group = new THREE.Group();
  group.name = name;
  return group;
}
