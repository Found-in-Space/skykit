import * as THREE from 'three';

import { SKYKIT_ACTIONS, createSkykitActionRegistry } from './actions.js';
import { createDesktopSkykitObserverRig } from './observer-rig.js';
import {
  addRootToScene,
  attachPart,
  cloneViewState,
  compareParts,
  createNoopRenderer,
  createSceneRoots,
  detachAndDisposePart,
  disposeMaybe,
  finiteNumber,
  mountRenderer,
  normalizeViewState,
  positiveFinite,
  resolveViewLookAtInput,
  setupPlugin,
  snapshotPart,
  syncRootsFromView,
} from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitEvent} SkykitEvent
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 * @typedef {import('./index.d.ts').SkykitThreeFrame} SkykitThreeFrame
 * @typedef {import('./index.d.ts').SkykitThreePluginContext} SkykitThreePluginContext
 * @typedef {import('./index.d.ts').SkykitViewer} SkykitViewer
 * @typedef {import('./index.d.ts').SkykitViewerOptions} SkykitViewerOptions
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('./index.d.ts').SkykitViewportSize} SkykitViewportSize
 * @typedef {import('./index.d.ts').SkykitPluginTeardown} SkykitPluginTeardown
 * @typedef {import('./index.d.ts').SkykitFrameOptions} SkykitFrameOptions
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
  const observerRig = options.observerRig ?? createDesktopSkykitObserverRig({
    observerPc: options.view?.observerPc,
    orientationIcrs: options.view?.orientationIcrs ?? undefined,
    coordinateUnitsPerParsec: options.view?.coordinateUnitsPerParsec,
  });
  const host = options.host ?? null;
  const pluginInputs = Array.from(options.plugins ?? []);
  const actions = createSkykitActionRegistry();
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
  const initialProjectionView = resolveCameraProjectionView(camera);
  const initialViewInput = await resolveViewLookAtInput({
    ...options.view,
    ...(options.view?.verticalFovDeg === undefined && initialProjectionView.verticalFovDeg !== undefined
      ? { verticalFovDeg: initialProjectionView.verticalFovDeg }
      : {}),
    ...(options.view?.aspectRatio === undefined && initialProjectionView.aspectRatio !== undefined
      ? { aspectRatio: initialProjectionView.aspectRatio }
      : {}),
    observerPc: options.view?.observerPc ?? observerRig.getObserverPc(),
    renderObserverPosition: options.view?.renderObserverPosition ?? observerRig.getRenderObserverPosition(),
    orientationIcrs: options.view?.orientationIcrs ?? observerRig.getOrientationIcrs?.() ?? null,
    motion: options.view?.motion ?? observerRig.getMotion?.() ?? null,
  }, viewLookResolverOptions(options.view?.observerPc ?? observerRig.getObserverPc()));
  let view = normalizeViewState(initialViewInput, 0, viewLookResolverOptions(initialViewInput.observerPc));
  const initialView = cloneViewState(view);
  observerRig.setObserverPc?.(view.observerPc);
  if (view.orientationIcrs) observerRig.setOrientationIcrs?.(view.orientationIcrs);

  addRootToScene(scene, roots.originContentRoot);
  addRootToScene(scene, roots.observerContentRoot);
  addRootToScene(scene, roots.navigationRoot);
  for (const root of roots.scaleBandedContentRoots.values()) {
    addRootToScene(scene, root);
  }
  const cameraRoot = resolveCameraRoot(options.cameraRoot, roots);
  if (cameraRoot) {
    cameraRoot.add(camera);
  }
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
    actions,
    addPart,
    addPlugin,
    getViewState,
    requestViewState,
    update,
    render,
    frame,
    resize,
    on: /** @type {SkykitViewer['on']} */ (on),
    emit,
    getSnapshot,
    dispose,
  };

  actions.subscribe((event) => emit(event));
  actions.registerAction(SKYKIT_ACTIONS.viewer.reset, () => {
    const { revision: _revision, ...patch } = cloneViewState(initialView);
    requestViewState(patch, SKYKIT_ACTIONS.viewer.reset);
  }, {
    label: 'Reset viewer',
  });

  const context = createContext(viewer);

  for (const part of options.parts ?? []) {
    addPartRecord(part);
  }

  for (const plugin of pluginInputs) {
    await installPlugin(plugin);
  }

  for (const part of orderedParts()) {
    await attachPart(part, context);
    await part.start?.(context);
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
    emit({ type: 'part/add', part });
    if (started) {
      void attachPart(part, context)
        .then(() => part.start?.(context))
        .then(() => part.setView?.(cloneViewState(view)));
    }
    return () => {
      void removePart(part);
    };
  }

  /**
   * @param {import('./index.d.ts').SkykitPluginInput} plugin
   * @returns {Promise<SkykitPluginTeardown>}
   */
  async function addPlugin(plugin) {
    assertActive();
    return installPlugin(plugin, true);
  }

  /**
   * @param {import('./index.d.ts').SkykitPluginInput} plugin
   * @param {boolean} [record]
   * @returns {Promise<SkykitPluginTeardown>}
   */
  async function installPlugin(plugin, record = false) {
    const teardown = await setupPlugin(plugin, context);
    if (record) pluginInputs.push(plugin);
    if (typeof teardown !== 'function') return () => {};
    disposables.push(teardown);
    return () => {
      const index = disposables.indexOf(teardown);
      if (index >= 0) disposables.splice(index, 1);
      void teardown();
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
    if (index < 0) return;
    parts.splice(index, 1);
    emit({ type: 'part/remove', part });
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
    const normalizedPatch = normalizeRequestedViewPatch(patch);
    if (lookAtNeedsAsyncResolution(normalizedPatch)) {
      const observerPc = /** @type {Partial<SkykitViewState>} */ (normalizedPatch).observerPc ?? view.observerPc;
      void resolveViewLookAtInput(normalizedPatch, viewLookResolverOptions(observerPc))
        .then((resolvedPatch) => {
          if (disposed) return;
          pendingViewPatch = {
            ...(pendingViewPatch ?? {}),
            ...resolvedPatch,
          };
        })
        .catch((error) => {
          emit({
            type: 'view/lookAt-error',
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      emit({ type: 'view/request', reason, patch: normalizedPatch });
      return;
    }
    pendingViewPatch = {
      ...(pendingViewPatch ?? {}),
      ...normalizedPatch,
    };
    emit({ type: 'view/request', reason, patch: normalizedPatch });
  }

  /**
   * @param {number} [deltaSeconds]
   */
  function update(deltaSeconds = 0, frameOptions = {}) {
    assertActive();
    const dt = Math.max(0, finiteNumber(deltaSeconds, 0));
    elapsedSeconds += dt;
    const viewChanged = flushViewPatch(false);
    observerRig.update?.(createFrame(dt, frameOptions));
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
    const frameData = createFrame(dt, frameOptions);
    emit({ type: 'viewer/update', frame: frameData });
    for (const part of orderedParts()) {
      part.update?.(frameData);
    }
  }

  function render(frameOptions = {}) {
    assertActive();
    const frameData = createFrame(0, frameOptions);
    for (const part of orderedParts()) {
      part.beforeRender?.(frameData);
    }
    renderer.render?.(scene, camera);
    for (const part of orderedParts()) {
      part.afterRender?.(frameData);
    }
    emit({ type: 'viewer/render', frame: frameData });
  }

  /**
   * @param {number} [deltaSeconds]
   */
  function frame(deltaSeconds = 0, frameOptions = {}) {
    update(deltaSeconds, frameOptions);
    render(frameOptions);
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
    const projectionChanged = syncCameraProjectionFromViewport(nextSize);
    renderer.setPixelRatio?.(nextSize.devicePixelRatio);
    renderer.setSize?.(nextSize.width, nextSize.height, true);
    for (const part of orderedParts()) {
      part.resize?.(nextSize);
    }
    if (projectionChanged) {
      for (const part of orderedParts()) {
        part.setView?.(cloneViewState(view));
      }
      emit({ type: 'view/change', view: cloneViewState(view) });
    }
    emit({ type: 'viewer/resize', size: nextSize });
  }

  /**
   * @template {SkykitEvent} TEvent
   * @param {TEvent['type']} type
   * @param {(event: TEvent) => void} listener
   */
  function on(type, listener) {
    let typeListeners = listeners.get(type);
    if (!typeListeners) {
      typeListeners = new Set();
      listeners.set(type, typeListeners);
    }
    typeListeners.add(/** @type {(event: SkykitEvent) => void} */ (listener));
    return () => {
      typeListeners?.delete(/** @type {(event: SkykitEvent) => void} */ (listener));
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
      pluginCount: pluginInputs.length,
      view: cloneViewState(view),
      roots: {
        originContentRoot: roots.originContentRoot.name,
        observerContentRoot: roots.observerContentRoot.name,
        navigationRoot: roots.navigationRoot.name,
        scaleBandedContentRoots: Array.from(roots.scaleBandedContentRoots.keys()),
      },
      parts: orderedParts().map(snapshotPart),
      scheduledTasks: scheduledTasks.map((task) => ({
        id: task.id,
        status: task.status,
        ...(task.reason ? { reason: task.reason } : {}),
        ...(task.priority ? { priority: task.priority } : {}),
        ...(task.error ? { error: task.error } : {}),
      })),
      actions: actions.getSnapshot(),
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
      await removePart(part);
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
    actions.dispose();
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
   * @param {SkykitViewportSize} size
   */
  function syncCameraProjectionFromViewport(size) {
    const perspectiveCamera = getPerspectiveCamera(camera);
    if (!perspectiveCamera) return false;

    const aspectRatio = size.width / size.height;
    if (Number.isFinite(aspectRatio) && aspectRatio > 0 && perspectiveCamera.aspect !== aspectRatio) {
      perspectiveCamera.aspect = aspectRatio;
      perspectiveCamera.updateProjectionMatrix?.();
    }

    const projectionView = resolveCameraProjectionView(perspectiveCamera);
    const patch = {
      ...(projectionView.verticalFovDeg !== undefined && projectionView.verticalFovDeg !== view.verticalFovDeg
        ? { verticalFovDeg: projectionView.verticalFovDeg }
        : {}),
      ...(projectionView.aspectRatio !== undefined && projectionView.aspectRatio !== view.aspectRatio
        ? { aspectRatio: projectionView.aspectRatio }
        : {}),
    };
    if (Object.keys(patch).length === 0) return false;

    view = normalizeViewState({ ...view, ...patch }, view.revision + 1);
    syncRootsFromView(roots, view);
    return true;
  }

  /**
   * @param {number} deltaSeconds
   * @param {SkykitFrameOptions} [options]
   * @returns {SkykitThreeFrame}
   */
  function createFrame(deltaSeconds, options = {}) {
    const frameOptions = /** @type {SkykitFrameOptions} */ (options ?? {});
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
      ...(frameOptions.xr ? { xr: frameOptions.xr } : {}),
    };
  }

  function orderedParts() {
    return [...parts].sort(compareParts);
  }

  /** @param {Partial<SkykitViewState>} patch */
  function normalizeRequestedViewPatch(patch) {
    if (!patch || typeof patch !== 'object') return patch;
    if ('lookAt' in patch) return patch;
    if (patch.orientationIcrs) {
      return {
        ...patch,
        lookAt: { orientationIcrs: patch.orientationIcrs },
      };
    }
    if (patch.targetPc) {
      return {
        ...patch,
        lookAt: { targetPc: patch.targetPc },
      };
    }
    return patch;
  }

  /** @param {Partial<SkykitViewState>} patch */
  function lookAtNeedsAsyncResolution(patch) {
    if (!patch || typeof patch !== 'object' || !('lookAt' in patch)) return false;
    const lookAt = /** @type {Record<string, unknown> | null} */ (patch.lookAt);
    return !!lookAt
      && typeof lookAt === 'object'
      && 'star' in lookAt
      && !('targetPc' in lookAt)
      && typeof options.resolveLookAtStar === 'function';
  }

  /** @param {unknown} observerPc */
  function viewLookResolverOptions(observerPc) {
    return {
      observerPc,
      resolveStar: typeof options.resolveLookAtStar === 'function'
        ? /** @type {import('@found-in-space/spatial').ResolveSpatialLookAtOptions['resolveStar']} */ (
          (star, lookAt) => options.resolveLookAtStar?.(
            star,
            /** @type {import('./index.d.ts').SkykitLookAtInput} */ (lookAt),
          )
        )
        : undefined,
      resolveBookmark: typeof options.resolveLookAtBookmark === 'function'
        ? /** @type {import('@found-in-space/spatial').ResolveSpatialLookAtOptions['resolveBookmark']} */ (
          (bookmarkId, lookAt) => options.resolveLookAtBookmark?.(bookmarkId, lookAt)
        )
        : undefined,
    };
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
      actions,
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
        return /** @type {any} */ (stores.get(key));
      },
      useResource(key, factory) {
        if (!resources.has(key)) {
          resources.set(key, factory());
        }
        return /** @type {any} */ (resources.get(key));
      },
      scheduleTask(task, taskOptions = {}) {
        const controller = new AbortController();
        /** @type {{ id: string; status: 'active' | 'finished' | 'failed' | 'cancelled'; reason?: string; priority?: string; error?: string; controller: AbortController }} */
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
 * @param {SkykitViewerOptions['cameraRoot']} cameraRoot
 * @param {import('./index.d.ts').SkykitSceneRoots} roots
 * @returns {THREE.Object3D | null}
 */
function resolveCameraRoot(cameraRoot, roots) {
  if (cameraRoot === false) return null;
  if (cameraRoot && typeof cameraRoot === 'object' && /** @type {{ isObject3D?: unknown }} */ (cameraRoot).isObject3D) {
    return /** @type {THREE.Object3D} */ (cameraRoot);
  }
  return roots.navigationRoot;
}

/**
 * @param {THREE.Camera} camera
 * @returns {{ verticalFovDeg?: number; aspectRatio?: number }}
 */
function resolveCameraProjectionView(camera) {
  const perspectiveCamera = getPerspectiveCamera(camera);
  if (!perspectiveCamera) return {};

  const verticalFovDeg = Number(perspectiveCamera.fov);
  const aspectRatio = Number(perspectiveCamera.aspect);
  return {
    ...(Number.isFinite(verticalFovDeg) && verticalFovDeg > 0 ? { verticalFovDeg } : {}),
    ...(Number.isFinite(aspectRatio) && aspectRatio > 0 ? { aspectRatio } : {}),
  };
}

/**
 * @param {THREE.Camera} camera
 * @returns {(THREE.PerspectiveCamera & { isPerspectiveCamera?: boolean }) | null}
 */
function getPerspectiveCamera(camera) {
  return camera instanceof THREE.PerspectiveCamera ||
    /** @type {{ isPerspectiveCamera?: unknown }} */ (camera).isPerspectiveCamera === true
    ? /** @type {THREE.PerspectiveCamera & { isPerspectiveCamera?: boolean }} */ (camera)
    : null;
}
