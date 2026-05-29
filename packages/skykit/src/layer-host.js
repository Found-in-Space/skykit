import { getSkykitProductRegistry } from './products.js';
import { disposeObjectTree, resolveAnchorRoot } from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitHostedLayer} SkykitHostedLayer
 * @typedef {import('./index.d.ts').SkykitLayerContext} SkykitLayerContext
 * @typedef {import('./index.d.ts').SkykitLayerHostOptions} SkykitLayerHostOptions
 * @typedef {import('./index.d.ts').SkykitLayerHostPlugin} SkykitLayerHostPlugin
 * @typedef {import('./index.d.ts').SkykitLayerState} SkykitLayerState
 * @typedef {import('./index.d.ts').SkykitLayerAddObjectOptions} SkykitLayerAddObjectOptions
 * @typedef {import('./index.d.ts').SkykitPluginTeardown} SkykitPluginTeardown
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
 * }} LayerObjectRecord
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
 *   lastState: SkykitLayerState | null;
 * }} LayerRecord
 */

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
      for (const record of records) {
        installRecord(record, hostContext);
      }
      return async () => {
        disposed = true;
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
          snapshot: record.layer.getSnapshot?.() ?? null,
        })),
      };
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
      lastState: null,
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
      await record.layer.attach?.(record.context);
      record.attached = true;
    },
    async start(context) {
      await ensureSetup(record, context);
      if (record.disposed || !record.context) return;
      await record.layer.start?.(record.context);
      record.started = true;
    },
    setView(view) {
      if (record.disposed || !record.context || !record.baseContext) return;
      record.layer.setView?.(view, record.context);
      notifyState(record, createLayerState(record.baseContext, view));
    },
    update(frame) {
      if (record.disposed || !record.context) return;
      notifyState(record, createLayerStateFromFrame(frame));
      record.layer.update?.(frame, record.context);
    },
    beforeRender(frame) {
      if (record.disposed || !record.context) return;
      record.layer.beforeRender?.(frame, record.context);
    },
    afterRender(frame) {
      if (record.disposed || !record.context) return;
      record.layer.afterRender?.(frame, record.context);
    },
    resize(size) {
      if (record.disposed || !record.context) return;
      record.layer.resize?.(size, record.context);
    },
    async detach() {
      if (!record.context) return;
      await record.layer.detach?.(record.context);
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
      return trackTeardown(record, context.addPart(part));
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
  };
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
    entry.options.anchorMode ?? 'world-space',
    entry.options.scaleBandId,
  );
  if (!parent.parent) {
    record.baseContext.scene.add(parent);
  }
  if (entry.object3d.parent !== parent) {
    parent.add(entry.object3d);
  }
  entry.parent = parent;
}

/** @param {LayerRecord} record */
function unmountObjects(record) {
  for (const entry of record.objects) {
    unmountObject(entry);
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
    await record.layer.detach?.(record.context);
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
  record.context = null;
  record.baseContext = null;
  record.attached = false;
  record.started = false;
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
    },
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
    },
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
