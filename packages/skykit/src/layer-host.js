import { getSkykitProductRegistry, isSkykitProductRef } from './products.js';
import { getSkykitScaleStateForViewer } from './scale.js';
import { disposeObjectTree, resolveAnchorRoot } from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitHostedLayer} SkykitHostedLayer
 * @typedef {import('./index.d.ts').SkykitLayerContext} SkykitLayerContext
 * @typedef {import('./index.d.ts').SkykitLayerHostOptions} SkykitLayerHostOptions
 * @typedef {import('./index.d.ts').SkykitLayerHostPlugin} SkykitLayerHostPlugin
 * @typedef {import('./index.d.ts').SkykitLayerState} SkykitLayerState
 * @typedef {import('./index.d.ts').SkykitLayerAddObjectOptions} SkykitLayerAddObjectOptions
 * @typedef {import('./index.d.ts').SkykitLayerScalePolicy} SkykitLayerScalePolicy
 * @typedef {import('./index.d.ts').SkykitPluginTeardown} SkykitPluginTeardown
 * @typedef {import('./index.d.ts').SkykitProductKey} SkykitProductKey
 * @typedef {import('./index.d.ts').SkykitThreeFrame} SkykitThreeFrame
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 * @typedef {import('./index.d.ts').SkykitThreePluginContext} SkykitThreePluginContext
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('./index.d.ts').SkykitViewportSize} SkykitViewportSize
 */

/**
 * @typedef {{
 *   object3d: import('three').Object3D;
 *   options: SkykitLayerAddObjectOptions;
 *   parent: import('three').Object3D | null;
 *   disposed: boolean;
 *   visibleBeforePolicy: boolean | null;
 * }} LayerObjectRecord
 */

/**
 * @typedef {{
 *   part: SkykitThreePart;
 *   order: number;
 *   attached: boolean;
 *   started: boolean;
 *   disposed: boolean;
 * }} LayerChildPartRecord
 */

/**
 * @typedef {{
 *   sourceInput: unknown;
 *   demand: unknown;
 *   source: { addDemand: (demand: unknown) => SkykitPluginTeardown } | null;
 *   demandTeardown: SkykitPluginTeardown | null;
 *   productTeardown: SkykitPluginTeardown | null;
 *   disposed: boolean;
 * }} LayerDemandRecord
 */

/**
 * @typedef {{
 *   layer: SkykitHostedLayer;
 *   id: string;
 *   order: number;
 *   part: SkykitThreePart;
 *   context: SkykitLayerContext | null;
 *   baseContext: SkykitThreePluginContext | null;
 *   partTeardown: SkykitPluginTeardown | null;
 *   setupPromise: Promise<void> | null;
 *   setupComplete: boolean;
 *   attached: boolean;
 *   started: boolean;
 *   disposed: boolean;
 *   teardowns: SkykitPluginTeardown[];
 *   objects: LayerObjectRecord[];
 *   childParts: LayerChildPartRecord[];
 *   demands: LayerDemandRecord[];
 *   pickBlockers: unknown[];
 *   pickTargets: unknown[];
 *   nextChildOrder: number;
 *   lastState: SkykitLayerState | null;
 *   lastView: SkykitViewState | null;
 *   lastSize: SkykitViewportSize | null;
 *   activationMode: 'active' | 'frozen' | 'hidden';
 *   currentScalePolicy: SkykitLayerScalePolicy[string] | null;
 * }} LayerRecord
 */

const SKYKIT_LAYER_HOSTS_STORE_KEY = Symbol.for('found-in-space.skykit.layer-hosts');
const noopTeardown = () => {};

/**
 * @param {SkykitLayerHostOptions} [options]
 * @returns {SkykitLayerHostPlugin}
 */
export function createSkykitLayerHostPlugin(options = {}) {
  const id = options.id ?? 'skykit-layer-host';
  /** @type {LayerRecord[]} */
  const records = [];
  /** @type {SkykitThreePluginContext | null} */
  let hostContext = null;
  let disposed = false;
  let nextOrder = 0;

  /** @type {SkykitLayerHostPlugin} */
  const plugin = {
    id,
    setup(context) {
      hostContext = /** @type {SkykitThreePluginContext} */ (context);
      const registry = getSkykitLayerHostRegistry(/** @type {SkykitThreePluginContext} */ (context));
      registry.add(plugin);
      for (const record of records) {
        installRecord(record, hostContext);
      }
      return async () => {
        disposed = true;
        registry.delete(plugin);
        for (const record of [...records].reverse()) {
          await removeRecord(record);
        }
      };
    },
    addLayer(layer) {
      const record = createRecord(layer);
      records.push(record);
      if (hostContext && !disposed) {
        installRecord(record, hostContext);
      }
      return () => {
        void removeRecord(record);
      };
    },
    getSnapshot() {
      return {
        id,
        layerCount: records.length,
        layers: records.map((record) => ({
          id: record.id,
          priority: record.layer.priority ?? null,
          mounted: record.attached && !record.disposed,
          started: record.started && !record.disposed,
          setupComplete: record.setupComplete,
          childPartCount: record.childParts.filter((child) => !child.disposed).length,
          localPickBlockerCount: record.pickBlockers.length,
          localPickTargetCount: record.pickTargets.length,
          demandCount: record.demands.length,
          activationMode: /** @type {import('./index.d.ts').SkykitLayerActivationMode} */ (record.activationMode),
          bounds: snapshotBounds(record.layer.getBounds?.()),
          snapshot: record.layer.getSnapshot?.() ?? null,
        })),
      };
    },
    getPickBlockers() {
      return records
        .filter(isInteractiveRecord)
        .flatMap((record) => record.pickBlockers);
    },
    getPickTargets() {
      return records
        .filter(isInteractiveRecord)
        .flatMap((record) => record.pickTargets);
    },
    getBounds() {
      return records
        .filter((record) => !record.disposed)
        .flatMap((record) => flattenBounds(record.layer.getBounds?.()));
    },
  };

  for (const layer of options.layers ?? []) {
    records.push(createRecord(layer));
  }

  return plugin;

  /** @param {SkykitHostedLayer} layer */
  function createRecord(layer) {
    if (!layer || typeof layer !== 'object') {
      throw new TypeError('SkyKit hosted layers must be objects.');
    }
    const layerId = layer.id ?? `skykit-layer-${nextOrder + 1}`;
    /** @type {LayerRecord} */
    const record = {
      layer,
      id: layerId,
      order: nextOrder++,
      part: /** @type {SkykitThreePart} */ ({}),
      context: null,
      baseContext: null,
      partTeardown: null,
      setupPromise: null,
      setupComplete: false,
      attached: false,
      started: false,
      disposed: false,
      teardowns: [],
      objects: [],
      childParts: [],
      demands: [],
      pickBlockers: [],
      pickTargets: [],
      nextChildOrder: 0,
      lastState: null,
      lastView: null,
      lastSize: null,
      activationMode: 'active',
      currentScalePolicy: null,
    };
    record.part = createLayerPart(record);
    return record;
  }

  /**
   * @param {LayerRecord} record
   * @param {SkykitThreePluginContext} context
   */
  function installRecord(record, context) {
    if (record.partTeardown || record.disposed) return;
    record.baseContext = context;
    record.partTeardown = context.addPart(record.part);
  }

  /** @param {LayerRecord} record */
  async function removeRecord(record) {
    const index = records.indexOf(record);
    if (index >= 0) records.splice(index, 1);
    const removePart = record.partTeardown;
    record.partTeardown = null;
    removePart?.();
    await disposeRecord(record);
  }
}

/** @param {LayerRecord} record */
function createLayerPart(record) {
  /** @type {SkykitThreePart} */
  const part = {
    id: record.id,
    priority: record.layer.priority,
    async attach(context) {
      await ensureSetup(record, context);
      if (record.disposed || !record.context) return;
      mountObjects(record);
      await runAttachLifecycle(record);
      record.attached = true;
      mountObjects(record);
      await syncPendingChildParts(record);
    },
    async start(context) {
      await ensureSetup(record, context);
      if (record.disposed || !record.context) return;
      await runStartLifecycle(record);
      record.started = true;
      await syncPendingChildParts(record);
    },
    setView(view) {
      if (record.disposed || !record.context || !record.baseContext) return;
      record.lastView = view;
      runSetViewLifecycle(record, view);
    },
    update(frame) {
      if (record.disposed || !record.context) return;
      runFrameLifecycle(record, 'update', frame);
    },
    beforeRender(frame) {
      if (record.disposed || !record.context) return;
      runFrameLifecycle(record, 'beforeRender', frame);
    },
    afterRender(frame) {
      if (record.disposed || !record.context) return;
      runFrameLifecycle(record, 'afterRender', frame);
    },
    resize(size) {
      if (record.disposed || !record.context) return;
      record.lastSize = size;
      runResizeLifecycle(record, size);
    },
    async detach() {
      if (!record.context) return;
      await runDetachLifecycle(record);
      unmountObjects(record);
      record.attached = false;
      record.started = false;
    },
    async dispose() {
      await disposeRecord(record);
    },
    getSnapshot() {
      return {
        id: record.id,
        mounted: record.attached && !record.disposed,
        started: record.started && !record.disposed,
        setupComplete: record.setupComplete,
        objectCount: record.objects.length,
        childPartCount: record.childParts.filter((child) => !child.disposed).length,
        localPickBlockerCount: record.pickBlockers.length,
        localPickTargetCount: record.pickTargets.length,
        demandCount: record.demands.length,
        activationMode: /** @type {import('./index.d.ts').SkykitLayerActivationMode} */ (record.activationMode),
        bounds: snapshotBounds(record.layer.getBounds?.()),
        layer: record.layer.getSnapshot?.() ?? null,
      };
    },
  };
  return part;
}

/**
 * @param {LayerRecord} record
 * @param {SkykitThreePluginContext} context
 */
async function ensureSetup(record, context) {
  if (record.setupPromise) {
    await record.setupPromise;
    return;
  }
  record.baseContext = context;
  record.context = createLayerContext(record, context);
  record.setupPromise = Promise.resolve()
    .then(async () => {
      const teardown = await record.layer.setup?.(/** @type {SkykitLayerContext} */ (record.context));
      if (typeof teardown === 'function') {
        const tracked = trackTeardown(record, teardown);
        if (record.disposed) await tracked();
      }
      record.setupComplete = true;
    });
  await record.setupPromise;
}

/**
 * @param {LayerRecord} record
 * @param {SkykitThreePluginContext} context
 * @returns {SkykitLayerContext}
 */
function createLayerContext(record, context) {
  const products = getSkykitProductRegistry(context);
  return {
    ...context,
    products,
    addPart(part) {
      return addChildPart(record, part);
    },
    addDisposable(disposable) {
      return trackTeardown(record, context.addDisposable(disposable));
    },
    on(type, listener) {
      return trackTeardown(record, context.on(type, listener));
    },
    scheduleTask(task, options) {
      return trackTeardown(record, context.scheduleTask(task, options));
    },
    addObject3D(object3d, options = {}) {
      return addObject3D(record, object3d, options);
    },
    provideProduct(key, value, metadata) {
      if (!key) return noopTeardown;
      return trackTeardown(record, products.provide(key, value, metadata));
    },
    addDemand(source, demand) {
      return addLayerDemand(record, products, source, demand);
    },
    addPickTarget(target, options = {}) {
      return addLayerInteractionHandle(record, products, 'target', target, options);
    },
    addPickBlocker(blocker, options = {}) {
      return addLayerInteractionHandle(record, products, 'blocker', blocker, options);
    },
  };
}

/**
 * @param {LayerRecord} record
 * @param {SkykitThreePart} part
 * @returns {SkykitPluginTeardown}
 */
function addChildPart(record, part) {
  if (!part || typeof part !== 'object') {
    throw new TypeError('SkyKit parts must be objects.');
  }
  /** @type {LayerChildPartRecord} */
  const child = {
    part,
    order: record.nextChildOrder++,
    attached: false,
    started: false,
    disposed: false,
  };
  record.childParts.push(child);
  queueChildPartSync(record, child);
  return trackTeardown(record, () => removeChildPart(record, child));
}

/**
 * @param {LayerRecord} record
 * @param {import('three').Object3D} object3d
 * @param {SkykitLayerAddObjectOptions} options
 * @returns {SkykitPluginTeardown}
 */
function addObject3D(record, object3d, options) {
  const entry = {
    object3d,
    options,
    parent: null,
    disposed: false,
    visibleBeforePolicy: null,
  };
  record.objects.push(entry);
  if (record.attached) mountObject(record, entry);
  return trackTeardown(record, () => {
    disposeObjectRecord(record, entry);
  });
}

/** @param {LayerRecord} record */
function mountObjects(record) {
  for (const entry of record.objects) {
    mountObject(record, entry);
  }
}

/**
 * @param {LayerRecord} record
 * @param {LayerObjectRecord} entry
 */
function mountObject(record, entry) {
  if (entry.disposed || !record.baseContext) return;
  const parent = resolveAnchorRoot(
    record.baseContext.roots,
    entry.options.anchorMode ?? record.currentScalePolicy?.anchorMode ?? 'world-space',
    entry.options.scaleBandId ?? record.currentScalePolicy?.scaleBandId,
  );
  if (!parent.parent) {
    record.baseContext.scene.add(parent);
  }
  if (entry.object3d.parent !== parent) {
    parent.add(entry.object3d);
  }
  entry.parent = parent;
  applyObjectVisibilityPolicy(record, entry);
}

/** @param {LayerRecord} record */
function unmountObjects(record) {
  for (const entry of record.objects) {
    unmountObject(entry);
  }
}

/** @param {LayerRecord} record */
function remountObjects(record) {
  for (const entry of record.objects) {
    unmountObject(entry);
    mountObject(record, entry);
  }
}

/** @param {LayerObjectRecord} entry */
function unmountObject(entry) {
  entry.parent?.remove(entry.object3d);
  entry.parent = null;
}

/**
 * @param {LayerRecord} record
 * @param {LayerObjectRecord} entry
 */
function disposeObjectRecord(record, entry) {
  if (entry.disposed) return;
  entry.disposed = true;
  unmountObject(entry);
  const index = record.objects.indexOf(entry);
  if (index >= 0) record.objects.splice(index, 1);
  if (entry.options.disposeObject) {
    disposeObjectTree(entry.object3d);
  }
}

/** @param {LayerRecord} record */
async function disposeRecord(record) {
  if (record.disposed) return;
  record.disposed = true;
  if (record.context && record.attached) {
    await runDetachLifecycle(record);
    unmountObjects(record);
    record.attached = false;
    record.started = false;
  }
  if (record.context) {
    await record.layer.dispose?.(record.context);
  }
  for (const teardown of [...record.teardowns].reverse()) {
    await teardown();
  }
  record.teardowns.length = 0;
  unmountObjects(record);
  record.objects.length = 0;
  record.childParts.length = 0;
  for (const demand of [...record.demands]) {
    disposeDemandRecord(demand);
  }
  record.demands.length = 0;
  record.pickBlockers.length = 0;
  record.pickTargets.length = 0;
  record.context = null;
  record.baseContext = null;
  record.attached = false;
  record.started = false;
}

/** @param {LayerRecord} record */
async function runAttachLifecycle(record) {
  for (const item of orderedLifecycleItems(record)) {
    if (item.kind === 'layer') {
      await record.layer.attach?.(/** @type {SkykitLayerContext} */ (record.context));
    } else {
      await attachChildPart(record, item.child);
    }
  }
}

/** @param {LayerRecord} record */
async function runStartLifecycle(record) {
  for (const item of orderedLifecycleItems(record)) {
    if (item.kind === 'layer') {
      await record.layer.start?.(/** @type {SkykitLayerContext} */ (record.context));
    } else {
      await startChildPart(record, item.child);
    }
  }
}

/**
 * @param {LayerRecord} record
 * @param {SkykitViewState} view
 */
function runSetViewLifecycle(record, view) {
  const layerState = record.baseContext ? createLayerState(record.baseContext, view) : null;
  for (const item of orderedLifecycleItems(record)) {
    if (item.kind === 'layer') {
      if (shouldRunLayerHooks(record)) {
        record.layer.setView?.(view, /** @type {SkykitLayerContext} */ (record.context));
      }
      if (layerState) notifyState(record, layerState);
    } else if (shouldRunLayerHooks(record) && item.child.attached && item.child.started) {
      item.child.part.setView?.(view);
    }
  }
}

/**
 * @param {LayerRecord} record
 * @param {'update' | 'beforeRender' | 'afterRender'} hook
 * @param {SkykitThreeFrame} frame
 */
function runFrameLifecycle(record, hook, frame) {
  const layerState = hook === 'update' ? createLayerStateFromFrame(frame) : null;
  for (const item of orderedLifecycleItems(record)) {
    if (item.kind === 'layer') {
      if (layerState) notifyState(record, layerState);
      if (shouldRunLayerHooks(record)) {
        record.layer[hook]?.(frame, /** @type {SkykitLayerContext} */ (record.context));
      }
    } else if (shouldRunLayerHooks(record) && item.child.attached && item.child.started) {
      item.child.part[hook]?.(frame);
    }
  }
}

/**
 * @param {LayerRecord} record
 * @param {SkykitViewportSize} size
 */
function runResizeLifecycle(record, size) {
  for (const item of orderedLifecycleItems(record)) {
    if (item.kind === 'layer') {
      if (shouldRunLayerHooks(record)) {
        record.layer.resize?.(size, /** @type {SkykitLayerContext} */ (record.context));
      }
    } else if (shouldRunLayerHooks(record) && item.child.attached) {
      item.child.part.resize?.(size);
    }
  }
}

/** @param {LayerRecord} record */
async function runDetachLifecycle(record) {
  for (const item of orderedLifecycleItems(record).reverse()) {
    if (item.kind === 'layer') {
      await record.layer.detach?.(/** @type {SkykitLayerContext} */ (record.context));
    } else {
      await detachChildPart(item.child);
    }
  }
}

/**
 * @param {LayerRecord} record
 * @returns {Array<
 *   | { kind: 'layer'; priority: number; order: number }
 *   | { kind: 'child'; priority: number; order: number; child: LayerChildPartRecord }
 * >}
 */
function orderedLifecycleItems(record) {
  return [
    {
      kind: /** @type {'layer'} */ ('layer'),
      priority: record.layer.priority ?? 0,
      order: 0,
    },
    ...record.childParts
      .filter((child) => !child.disposed)
      .map((child) => ({
        kind: /** @type {'child'} */ ('child'),
        priority: child.part.priority ?? 0,
        order: child.order + 1,
        child,
      })),
  ].sort((left, right) => left.priority - right.priority || left.order - right.order);
}

/**
 * @param {LayerRecord} record
 * @param {LayerChildPartRecord} child
 */
function queueChildPartSync(record, child) {
  void syncChildPart(record, child).catch((error) => {
    emitChildPartError(record, child, 'sync', error);
  });
}

/** @param {LayerRecord} record */
async function syncPendingChildParts(record) {
  for (const child of [...record.childParts]) {
    await syncChildPart(record, child);
  }
}

/**
 * @param {LayerRecord} record
 * @param {LayerChildPartRecord} child
 */
async function syncChildPart(record, child) {
  if (!record.context || child.disposed) return;
  if (record.attached && !child.attached) {
    await attachChildPart(record, child);
  }
  if (record.started && !child.started) {
    await startChildPart(record, child);
  }
  if (record.lastView && child.attached && child.started) {
    child.part.setView?.(record.lastView);
  }
  if (record.lastSize && child.attached) {
    child.part.resize?.(record.lastSize);
  }
}

/**
 * @param {LayerRecord} record
 * @param {LayerChildPartRecord} child
 */
async function attachChildPart(record, child) {
  if (!record.context || child.disposed || child.attached) return;
  await child.part.attach?.(record.context);
  child.attached = true;
}

/**
 * @param {LayerRecord} record
 * @param {LayerChildPartRecord} child
 */
async function startChildPart(record, child) {
  if (!record.context || child.disposed || child.started) return;
  await child.part.start?.(record.context);
  child.started = true;
}

/** @param {LayerChildPartRecord} child */
async function detachChildPart(child) {
  if (child.disposed || !child.attached) return;
  await child.part.detach?.();
  child.attached = false;
  child.started = false;
}

/**
 * @param {LayerRecord} record
 * @param {LayerChildPartRecord} child
 */
async function removeChildPart(record, child) {
  const index = record.childParts.indexOf(child);
  if (index >= 0) record.childParts.splice(index, 1);
  if (child.disposed) return;
  await detachChildPart(child);
  child.disposed = true;
  child.started = false;
  child.attached = false;
  await child.part.dispose?.();
}

/**
 * @param {LayerRecord} record
 * @param {LayerChildPartRecord} child
 * @param {string} phase
 * @param {unknown} error
 */
function emitChildPartError(record, child, phase, error) {
  record.context?.emit({
    type: 'layer/child-part-error',
    layerId: record.id,
    partId: child.part.id ?? null,
    phase,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * @param {LayerRecord} record
 * @param {SkykitPluginTeardown} teardown
 * @returns {SkykitPluginTeardown}
 */
function trackTeardown(record, teardown) {
  let active = true;
  /** @type {SkykitPluginTeardown} */
  const wrapped = () => {
    if (!active) return undefined;
    active = false;
    const index = record.teardowns.indexOf(wrapped);
    if (index >= 0) record.teardowns.splice(index, 1);
    return Promise.resolve(teardown()).then(() => {});
  };
  record.teardowns.push(wrapped);
  return wrapped;
}

/**
 * @param {LayerRecord} record
 * @param {SkykitLayerState} state
 */
function notifyState(record, state) {
  record.lastState = state;
  if (!record.context) return;
  applyScalePolicy(record, state);
  const result = record.layer.setState?.(state, record.context);
  if (result && typeof result === 'object' && typeof result.then === 'function') {
    result.catch((error) => {
      record.context?.emit({
        type: 'layer/state-error',
        layerId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * @param {SkykitThreePluginContext} context
 * @param {SkykitViewState} view
 * @returns {SkykitLayerState}
 */
function createLayerState(context, view) {
  return {
    view,
    navigation: {
      observerPc: view.observerPc,
      renderObserverPosition: view.renderObserverPosition,
      orientationIcrs: view.orientationIcrs ?? null,
      motion: view.motion ?? null,
    },
    camera: {
      verticalFovDeg: view.verticalFovDeg ?? cameraFov(context.camera),
      aspectRatio: view.aspectRatio ?? cameraAspect(context.camera),
      viewProjection: resolveViewProjection(context.camera),
    },
    scale: getSkykitScaleStateForViewer(context.viewer, view),
  };
}

/**
 * @param {SkykitThreeFrame} frame
 * @returns {SkykitLayerState}
 */
function createLayerStateFromFrame(frame) {
  return {
    view: frame.view,
    navigation: {
      observerPc: frame.view.observerPc,
      renderObserverPosition: frame.view.renderObserverPosition,
      orientationIcrs: frame.view.orientationIcrs ?? null,
      motion: frame.view.motion ?? null,
    },
    camera: {
      verticalFovDeg: frame.view.verticalFovDeg ?? cameraFov(frame.camera),
      aspectRatio: frame.view.aspectRatio ?? cameraAspect(frame.camera),
      viewProjection: resolveViewProjection(frame.camera),
    },
    xr: frame.xr ?? null,
    scale: getSkykitScaleStateForViewer(frame.viewer, frame.view),
  };
}

/** @param {import('three').Camera} camera */
function cameraFov(camera) {
  return typeof /** @type {{ fov?: unknown }} */ (camera).fov === 'number'
    ? /** @type {{ fov: number }} */ (/** @type {unknown} */ (camera)).fov
    : undefined;
}

/** @param {import('three').Camera} camera */
function cameraAspect(camera) {
  return typeof /** @type {{ aspect?: unknown }} */ (camera).aspect === 'number'
    ? /** @type {{ aspect: number }} */ (/** @type {unknown} */ (camera)).aspect
    : undefined;
}

/**
 * @param {SkykitThreePluginContext} context
 * @returns {Set<SkykitLayerHostPlugin>}
 */
export function getSkykitLayerHostRegistry(context) {
  return context.useStore(SKYKIT_LAYER_HOSTS_STORE_KEY, () => new Set());
}

/**
 * @param {LayerRecord} record
 * @param {ReturnType<typeof getSkykitProductRegistry>} products
 * @param {unknown} sourceInput
 * @param {unknown} demand
 */
function addLayerDemand(record, products, sourceInput, demand) {
  /** @type {LayerDemandRecord} */
  const entry = {
    sourceInput,
    demand,
    source: null,
    demandTeardown: null,
    productTeardown: null,
    disposed: false,
  };
  record.demands.push(entry);
  if (isSkykitProductRef(sourceInput)) {
    entry.productTeardown = products.subscribe(sourceInput.key, (source) => {
      unbindDemandSource(entry);
      entry.source = isDemandSource(source)
        ? /** @type {{ addDemand: (demand: unknown) => SkykitPluginTeardown }} */ (source)
        : null;
      syncDemandRecord(record, entry);
    }, { replay: true });
  } else {
    entry.source = isDemandSource(sourceInput)
      ? /** @type {{ addDemand: (demand: unknown) => SkykitPluginTeardown }} */ (sourceInput)
      : null;
    syncDemandRecord(record, entry);
  }
  return trackTeardown(record, () => {
    const index = record.demands.indexOf(entry);
    if (index >= 0) record.demands.splice(index, 1);
    disposeDemandRecord(entry);
  });
}

/**
 * @param {LayerRecord} record
 * @param {ReturnType<typeof getSkykitProductRegistry>} products
 * @param {'target' | 'blocker'} kind
 * @param {unknown} handle
 * @param {{ key?: SkykitProductKey | false; metadata?: import('./index.d.ts').SkykitProductMetadata }} options
 */
function addLayerInteractionHandle(record, products, kind, handle, options) {
  const list = kind === 'target' ? record.pickTargets : record.pickBlockers;
  list.push(handle);
  const productTeardown = options.key !== undefined && options.key !== false
    ? products.provide(options.key, handle, {
        kind: kind === 'target' ? 'xr-pick-target' : 'xr-pick-blocker',
        ownerId: record.id,
        ...(options.metadata ?? {}),
      })
    : null;
  return trackTeardown(record, () => {
    removeHandle(list, handle);
    productTeardown?.();
  });
}

/**
 * @param {LayerRecord} record
 * @param {LayerDemandRecord} entry
 */
function syncDemandRecord(record, entry) {
  if (entry.disposed) return;
  if (!shouldDemandBeLive(record)) {
    unbindDemandSource(entry);
    return;
  }
  if (!entry.source || entry.demandTeardown) return;
  entry.demandTeardown = entry.source.addDemand?.(entry.demand) ?? null;
}

/** @param {LayerDemandRecord} entry */
function unbindDemandSource(entry) {
  entry.demandTeardown?.();
  entry.demandTeardown = null;
}

/** @param {LayerDemandRecord} entry */
function disposeDemandRecord(entry) {
  if (entry.disposed) return;
  entry.disposed = true;
  unbindDemandSource(entry);
  entry.productTeardown?.();
  entry.productTeardown = null;
  entry.source = null;
}

/**
 * @param {unknown} value
 * @returns {value is { addDemand: (demand: unknown) => SkykitPluginTeardown }}
 */
function isDemandSource(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof /** @type {{ addDemand?: unknown }} */ (value).addDemand === 'function';
}

/**
 * @param {LayerRecord} record
 * @param {SkykitLayerState} state
 */
function applyScalePolicy(record, state) {
  const policy = resolveLayerScalePolicy(record.layer, state.scale?.domain);
  const nextMode = normalizeActivationMode(policy?.mode);
  const policyChanged = record.currentScalePolicy !== policy;
  const modeChanged = record.activationMode !== nextMode;
  record.currentScalePolicy = policy;
  record.activationMode = nextMode;
  if (policyChanged || modeChanged) {
    for (const entry of record.objects) {
      applyObjectVisibilityPolicy(record, entry);
    }
    if (policyChanged && record.attached) {
      remountObjects(record);
    }
    for (const demand of record.demands) {
      syncDemandRecord(record, demand);
    }
  }
}

/**
 * @param {SkykitHostedLayer} layer
 * @param {string | undefined} domain
 * @returns {SkykitLayerScalePolicy[string] | null}
 */
function resolveLayerScalePolicy(layer, domain) {
  const policy = /** @type {{ scalePolicy?: SkykitLayerScalePolicy }} */ (layer).scalePolicy;
  if (!policy || !domain) return null;
  return policy[domain] ?? null;
}

/** @param {unknown} value */
function normalizeActivationMode(value) {
  return value === 'frozen' || value === 'hidden' ? value : 'active';
}

/** @param {LayerRecord} record */
function shouldRunLayerHooks(record) {
  return record.activationMode === 'active';
}

/** @param {LayerRecord} record */
function shouldDemandBeLive(record) {
  const demandPolicy = record.currentScalePolicy?.demand;
  if (demandPolicy === 'paused') return false;
  if (record.activationMode === 'frozen' && demandPolicy !== 'live') return false;
  return true;
}

/**
 * @param {LayerRecord} record
 * @param {LayerObjectRecord} entry
 */
function applyObjectVisibilityPolicy(record, entry) {
  if (record.activationMode === 'hidden') {
    if (entry.visibleBeforePolicy === null) {
      entry.visibleBeforePolicy = entry.object3d.visible;
    }
    entry.object3d.visible = false;
    return;
  }
  if (entry.visibleBeforePolicy !== null) {
    entry.object3d.visible = entry.visibleBeforePolicy;
    entry.visibleBeforePolicy = null;
  }
}

/** @param {LayerRecord} record */
function isInteractiveRecord(record) {
  return record.attached && !record.disposed && record.activationMode !== 'hidden';
}

/** @param {unknown} value */
function flattenBounds(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

/** @param {unknown} value */
function snapshotBounds(value) {
  const bounds = flattenBounds(value);
  return bounds.length === 0 ? null : bounds;
}

/** @param {import('three').Camera} camera */
function resolveViewProjection(camera) {
  if (!camera || typeof camera !== 'object') return undefined;
  camera.updateMatrixWorld?.();
  const projection = /** @type {{ projectionMatrix?: { elements?: unknown }; matrixWorldInverse?: { elements?: unknown }; projectionMatrixInverse?: unknown }} */ (camera);
  if (!projection.projectionMatrix || !projection.matrixWorldInverse) return undefined;
  if (typeof /** @type {{ clone?: unknown }} */ (projection.projectionMatrix).clone === 'function') {
    return /** @type {any} */ (projection.projectionMatrix).clone().multiply(projection.matrixWorldInverse);
  }
  return undefined;
}

/**
 * @template T
 * @param {T[]} list
 * @param {T} handle
 */
function removeHandle(list, handle) {
  const index = list.indexOf(handle);
  if (index >= 0) list.splice(index, 1);
}
