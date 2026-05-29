import * as THREE from 'three';

import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

import { createSkykitAnimationLoop } from '../animation-loop.js';
import { createSkykitLayerHostPlugin } from '../layer-host.js';
import { createSkykitProductRegistryPlugin, getSkykitProductRegistry } from '../products.js';
import { createSkykitStarSourcePlugin } from '../star-source.js';
import { createSkykitViewer } from '../viewer.js';
import { createStreamingStarsPlugin } from '../plugins.js';
import {
  createSkykitXrComposition,
  createSkykitXrPickBridgePlugin,
} from './composition.js';
import { createSkykitXrStarPickingPlugin } from './plugins.js';

const DEFAULT_COORDINATE_UNITS_PER_PARSEC = 0.001;
const DEFAULT_LIMITING_MAGNITUDE = 7.5;
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_STAR_SOURCE_PRODUCT = 'stars:stellar/source';
const DEFAULT_STAR_STORE_PRODUCT = 'stars:stellar/store';
const DEFAULT_STAR_ATTRIBUTES = Object.freeze(['position', 'teffLog8', 'magAbs']);
const DEFAULT_STAR_PICK_ATTRIBUTES = Object.freeze(['objectRef', 'pickMeta']);

/**
 * @typedef {import('../index.d.ts').SkykitAnimationLoop} SkykitAnimationLoop
 * @typedef {import('../index.d.ts').SkykitAnimationLoopOptions} SkykitAnimationLoopOptions
 * @typedef {import('../index.d.ts').SkykitHostedLayer} SkykitHostedLayer
 * @typedef {import('../index.d.ts').SkykitLayerHostOptions} SkykitLayerHostOptions
 * @typedef {import('../index.d.ts').SkykitLayerHostPlugin} SkykitLayerHostPlugin
 * @typedef {import('../index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('../index.d.ts').SkykitPluginInput} SkykitPluginInput
 * @typedef {import('../index.d.ts').SkykitPluginTeardown} SkykitPluginTeardown
 * @typedef {import('../index.d.ts').SkykitProductRegistryPlugin} SkykitProductRegistryPlugin
 * @typedef {import('../index.d.ts').SkykitProductKey} SkykitProductKey
 * @typedef {import('../index.d.ts').SkykitStarCellSource} SkykitStarCellSource
 * @typedef {import('../index.d.ts').SkykitStarSourcePublishOptions} SkykitStarSourcePublishOptions
 * @typedef {import('../index.d.ts').SkykitStreamingStarsPlugin} SkykitStreamingStarsPlugin
 * @typedef {import('../index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('../index.d.ts').SkykitViewer} SkykitViewer
 * @typedef {import('../index.d.ts').SkykitViewerOptions} SkykitViewerOptions
 * @typedef {import('../index.d.ts').SkykitViewportSize} SkykitViewportSize
 * @typedef {import('../xr.d.ts').SkykitVrPickBridgeOptions} SkykitVrPickBridgeOptions
 * @typedef {import('../xr.d.ts').SkykitVrStarsOptions} SkykitVrStarsOptions
 * @typedef {import('../xr.d.ts').SkykitVrStarPickOptions} SkykitVrStarPickOptions
 * @typedef {import('../xr.d.ts').SkykitVrViewer} SkykitVrViewer
 * @typedef {import('../xr.d.ts').SkykitVrViewerOptions} SkykitVrViewerOptions
 * @typedef {import('../xr.d.ts').SkykitVrXrOptions} SkykitVrXrOptions
 * @typedef {import('../xr.d.ts').SkykitXrComposition} SkykitXrComposition
 * @typedef {import('../xr.d.ts').SkykitXrPickBridgePlugin} SkykitXrPickBridgePlugin
 * @typedef {import('../xr.d.ts').SkykitXrRaySource} SkykitXrRaySource
 * @typedef {import('../xr.d.ts').SkykitXrSessionHandle} SkykitXrSessionHandle
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProviderService} StarOctreeProviderService
 * @typedef {import('@found-in-space/three-star-field').ThreeStarField} ThreeStarField
 */

/**
 * @typedef {{
 *   plugin: SkykitProductRegistryPlugin | null;
 * }} VrProducts
 *
 * @typedef {{
 *   provider: StarOctreeProviderService | null;
 *   source: SkykitStarCellSource | null;
 *   sourcePlugins: SkykitPlugin[];
 *   starField: ThreeStarField | null;
 *   starLayer: SkykitStreamingStarsPlugin | null;
 *   ownsProvider: boolean;
 *   ownsStarField: boolean;
 * }} VrStarBundle
 *
 * @typedef {{
 *   ray: SkykitXrRaySource | null;
 *   key: string | null;
 * }} ResolvedVrRay
 */

/**
 * @param {SkykitVrViewerOptions} [options]
 * @returns {Promise<SkykitVrViewer>}
 */
export async function createSkykitVrViewer(options = {}) {
  const renderer = options.renderer ?? createDefaultVrRenderer();
  const ownsRenderer = !options.renderer;
  const camera = options.camera ?? createDefaultVrCamera();
  const view = createVrView(options.view);
  const xr = createVrXrComposition(options.xr, renderer, camera, view);
  const products = createVrProducts(options.products);
  const callerPlugins = Array.from(options.plugins ?? []);
  const stars = createVrStarBundle(options.stars, view, callerPlugins);
  const layerHost = createVrLayerHost(options.layerHost, options.layers);
  const pickBridge = createVrPickBridge(xr, options.pickBridge);
  const starPicking = createVrStarPicking(stars, xr, options.stars);

  const plugins = [
    ...(xr?.plugins ?? []),
    ...(products.plugin ? [products.plugin] : []),
    ...stars.sourcePlugins,
    ...(stars.starLayer ? [stars.starLayer] : []),
    ...(layerHost ? [layerHost] : []),
    ...(pickBridge ? [pickBridge] : []),
    ...(starPicking ? [starPicking] : []),
    ...callerPlugins,
  ];

  const viewer = await createSkykitViewer({
    id: options.id,
    host: options.host,
    scene: options.scene,
    renderer,
    camera,
    autoMountRenderer: options.autoMountRenderer,
    ...(xr ? {
      roots: xr.roots,
      cameraRoot: xr.cameraRoot,
      observerRig: xr.observerRig,
    } : {}),
    view,
    plugins,
  });

  const loop = createVrLoop(viewer, options.loop);
  let disposed = false;
  /** @type {SkykitVrViewer} */
  const vr = {
    viewer,
    xr,
    rig: xr?.rig ?? null,
    session: xr?.session ?? null,
    body: xr?.body ?? null,
    navigation: xr?.navigation ?? null,
    renderer,
    camera,
    products: products.plugin,
    starSource: stars.source,
    starField: stars.starField,
    starLayer: stars.starLayer,
    layerHost,
    pickBridge,
    pickRouter: pickBridge?.router ?? null,
    starPicking,
    loop,
    rays: xr?.rays ?? {},
    enter,
    exit,
    install,
    resize,
    getSnapshot,
    dispose,
  };
  const lifecycle = installVrBrowserLifecycle(vr, options.host, options);
  resize();
  return vr;

  /** @returns {Promise<SkykitXrSessionHandle>} */
  function enter() {
    if (!xr) {
      return Promise.reject(new Error('SkyKit VR viewer cannot enter XR because XR support is disabled.'));
    }
    return xr.enter();
  }

  /** @returns {Promise<void>} */
  function exit() {
    if (!xr) {
      return Promise.reject(new Error('SkyKit VR viewer cannot exit XR because XR support is disabled.'));
    }
    return xr.exit();
  }

  /** @param {SkykitPluginInput} plugin */
  function install(plugin) {
    return viewer.addPlugin(plugin);
  }

  /** @param {Partial<SkykitViewportSize>} [size] */
  function resize(size) {
    if (size) {
      viewer.resize(size);
      return;
    }
    const host = options.host;
    const devicePixelRatio = Math.min(
      resolveDevicePixelRatio(),
      positiveNumber(options.maxDevicePixelRatio, DEFAULT_MAX_DEVICE_PIXEL_RATIO),
    );
    viewer.resize({
      width: positiveNumber(host?.clientWidth, 1),
      height: positiveNumber(host?.clientHeight, 1),
      devicePixelRatio,
    });
  }

  function getSnapshot() {
    return {
      id: viewer.id,
      disposed,
      viewer: viewer.getSnapshot(),
      xr: xr?.getSnapshot?.() ?? null,
      products: products.plugin?.getSnapshot?.() ?? null,
      stars: {
        source: stars.source?.getSnapshot?.() ?? null,
        renderer: stars.starField?.getSnapshot?.() ?? null,
        layer: stars.starLayer?.getSnapshot?.() ?? null,
        picking: starPicking?.getSnapshot?.() ?? null,
      },
      layerHost: layerHost?.getSnapshot?.() ?? null,
      pickBridge: pickBridge?.getSnapshot?.() ?? null,
      loop: loop?.getSnapshot?.() ?? null,
      owned: {
        renderer: ownsRenderer,
        provider: stars.ownsProvider,
        starField: stars.ownsStarField,
        xr: xr !== null,
      },
    };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycle.dispose();
    loop?.dispose();
    await viewer.dispose();
    await xr?.dispose?.();
    if (stars.ownsProvider) {
      await stars.provider?.dispose?.();
    }
    if (stars.ownsStarField) {
      stars.starField?.dispose?.();
    }
    if (ownsRenderer) {
      renderer.dispose?.();
    }
  }
}

/** @returns {THREE.WebGLRenderer} */
function createDefaultVrRenderer() {
  const WebGLRenderer = /** @type {new (options?: unknown) => THREE.WebGLRenderer} */ (
    /** @type {any} */ (THREE).WebGLRenderer
  );
  const renderer = new WebGLRenderer({ antialias: true });
  enableRendererXr(renderer);
  return renderer;
}

/** @returns {THREE.PerspectiveCamera} */
function createDefaultVrCamera() {
  return new THREE.PerspectiveCamera(70, 1, 0.01, 10000);
}

/**
 * @param {SkykitVrXrOptions | false | undefined} options
 * @param {THREE.WebGLRenderer | import('../index.d.ts').SkykitRendererLike} renderer
 * @param {THREE.Camera} camera
 * @param {Partial<SkykitViewState>} view
 * @returns {SkykitXrComposition | null}
 */
function createVrXrComposition(options, renderer, camera, view) {
  if (options === false) return null;
  enableRendererXr(renderer);
  const {
    mode,
    referenceSpaceType,
    session,
    locomotion,
    navigation,
    ...compositionOptions
  } = options ?? {};
  const sessionOptions = session === false
    ? false
    : {
        ...(session ?? {}),
        ...(mode !== undefined ? { mode } : {}),
        ...(referenceSpaceType !== undefined ? { referenceSpaceType } : {}),
      };
  const navigationInput = navigation ?? locomotion;
  return createSkykitXrComposition({
    ...compositionOptions,
    renderer,
    camera,
    coordinateUnitsPerParsec: compositionOptions.coordinateUnitsPerParsec
      ?? view.coordinateUnitsPerParsec
      ?? DEFAULT_COORDINATE_UNITS_PER_PARSEC,
    session: sessionOptions,
    navigation: navigationInput === false
      ? false
      : {
          ...((locomotion && typeof locomotion === 'object') ? locomotion : {}),
          ...((navigation && typeof navigation === 'object') ? navigation : {}),
        },
  });
}

/**
 * @param {Partial<SkykitViewState> | undefined} view
 * @returns {Partial<SkykitViewState>}
 */
function createVrView(view) {
  return {
    coordinateUnitsPerParsec: DEFAULT_COORDINATE_UNITS_PER_PARSEC,
    limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE,
    ...(view ?? {}),
  };
}

/**
 * @param {SkykitVrViewerOptions['products']} options
 * @returns {VrProducts}
 */
function createVrProducts(options) {
  if (options === false) {
    return { plugin: null };
  }
  if (isProductRegistryPlugin(options)) {
    return { plugin: /** @type {SkykitProductRegistryPlugin} */ (options) };
  }
  return {
    plugin: createSkykitProductRegistryPlugin(options && typeof options === 'object' ? options : {}),
  };
}

/**
 * @param {SkykitVrStarsOptions | false | undefined} options
 * @param {Partial<SkykitViewState>} view
 * @param {SkykitPluginInput[]} callerPlugins
 * @returns {VrStarBundle}
 */
function createVrStarBundle(options, view, callerPlugins) {
  if (options === false) {
    return {
      provider: null,
      source: null,
      sourcePlugins: [],
      starField: null,
      starLayer: null,
      ownsProvider: false,
      ownsStarField: false,
    };
  }
  const stars = options ?? {};
  const id = stars.id ?? 'skykit-vr-stars';
  const pickEnabled = stars.pick !== false;
  const attributes = createStarAttributes(stars.attributes, pickEnabled);
  const strategy = stars.strategy ?? createObserverShellStrategy();
  const publish = normalizeStarPublish(stars.publish);
  const provider = stars.source
    ? null
    : stars.provider ?? createStarOctreeProviderService({ url: OCTREE_DEFAULT });
  const ownsProvider = !stars.source && !stars.provider;
  const source = stars.source ?? createSkykitStarSourcePlugin({
    id,
    provider: provider ?? undefined,
    session: stars.session,
    strategy,
    attributes,
    retainCellsOnRestart: stars.retainCellsOnRestart,
    publish,
  });
  const sourcePlugins = createVrSourcePlugins({
    id,
    source,
    sourceWasSupplied: Boolean(stars.source),
    publish,
    callerPlugins,
  });
  const starField = stars.renderer ?? createThreeStarField({
    limitingMagnitude: positiveNumber(view.limitingMagnitude, DEFAULT_LIMITING_MAGNITUDE),
  });
  const ownsStarField = !stars.renderer;
  const starLayer = stars.layer === false
    ? null
    : createStreamingStarsPlugin({
        id: `${id}:renderer`,
        source,
        renderer: createNonOwningStarField(starField),
        session: stars.session,
        strategy,
        attributes,
        ...((stars.layer && typeof stars.layer === 'object') ? stars.layer : {}),
      });
  return {
    provider,
    source,
    sourcePlugins,
    starField,
    starLayer,
    ownsProvider,
    ownsStarField,
  };
}

/**
 * @param {{
 *   id: string;
 *   source: SkykitStarCellSource;
 *   sourceWasSupplied: boolean;
 *   publish: SkykitStarSourcePublishOptions | false;
 *   callerPlugins: SkykitPluginInput[];
 * }} options
 * @returns {SkykitPlugin[]}
 */
function createVrSourcePlugins(options) {
  if (!options.sourceWasSupplied) {
    return [options.source];
  }
  const plugins = [];
  if (!callerPluginsIncludeSource(options.callerPlugins, options.source)) {
    plugins.push(createNonOwningStarSourcePlugin(options.source));
  }
  if (options.publish !== false) {
    plugins.push(createStarSourcePublisherPlugin({
      id: `${options.id}:products`,
      source: options.source,
      publish: options.publish,
    }));
  }
  return plugins;
}

/**
 * @param {SkykitVrViewerOptions['layerHost']} layerHost
 * @param {Iterable<SkykitHostedLayer> | undefined} layers
 * @returns {SkykitLayerHostPlugin | null}
 */
function createVrLayerHost(layerHost, layers) {
  if (layerHost === false) return null;
  if (isLayerHostPlugin(layerHost)) {
    const plugin = /** @type {SkykitLayerHostPlugin} */ (layerHost);
    for (const layer of layers ?? []) {
      plugin.addLayer(layer);
    }
    return plugin;
  }
  if (layerHost || layers) {
    return createSkykitLayerHostPlugin({
      ...((layerHost && typeof layerHost === 'object') ? layerHost : {}),
      layers,
    });
  }
  return null;
}

/**
 * @param {SkykitXrComposition | null} xr
 * @param {SkykitVrViewerOptions['pickBridge']} options
 * @returns {SkykitXrPickBridgePlugin | null}
 */
function createVrPickBridge(xr, options) {
  if (!xr || options === false || options == null) return null;
  if (options !== true && typeof options !== 'object') return null;
  const bridgeOptions = options === true ? {} : options;
  const { ray: rayInput, ...rest } = bridgeOptions;
  const resolved = resolveVrRay(xr, rayInput);
  if (!resolved.ray) return null;
  return createSkykitXrPickBridgePlugin({
    ...rest,
    raySource: createNonOwningRaySource(resolved.ray),
  });
}

/**
 * @param {VrStarBundle} stars
 * @param {SkykitXrComposition | null} xr
 * @param {SkykitVrStarsOptions | false | undefined} starOptions
 * @returns {(SkykitPlugin & { getSnapshot?(): unknown }) | null}
 */
function createVrStarPicking(stars, xr, starOptions) {
  if (!xr || !stars.source || !stars.starField || starOptions === false) return null;
  const pickInput = starOptions?.pick;
  if (pickInput === false) return null;
  const pickOptions = pickInput === true || pickInput == null ? {} : pickInput;
  const { ray: rayInput, ...rest } = pickOptions;
  const resolved = resolveVrRay(xr, rayInput);
  if (!resolved.ray) return null;
  return createSkykitXrStarPickingPlugin({
    ...rest,
    renderer: stars.starField,
    source: stars.source,
    rig: xr.rig,
    raySource: createNonOwningRaySource(resolved.ray),
    handedness: rest.handedness ?? (resolved.key === 'right' ? 'right' : 'any'),
    attributes: rest.attributes ?? DEFAULT_STAR_PICK_ATTRIBUTES,
  });
}

/**
 * @param {SkykitViewer} viewer
 * @param {SkykitAnimationLoopOptions | false | undefined} options
 * @returns {SkykitAnimationLoop | null}
 */
function createVrLoop(viewer, options) {
  if (options === false) return null;
  return createSkykitAnimationLoop(viewer, {
    scheduler: 'renderer',
    autoStart: true,
    ...(options ?? {}),
  });
}

/**
 * @param {SkykitVrViewer} vr
 * @param {SkykitViewerOptions['host']} host
 * @param {SkykitVrViewerOptions} options
 * @returns {{ dispose(): void }}
 */
function installVrBrowserLifecycle(vr, host, options) {
  const browserWindow = resolveBrowserWindow();
  /** @type {Array<() => void>} */
  const removers = [];
  if (browserWindow && options.autoResize !== false) {
    const onResize = () => vr.resize();
    browserWindow.addEventListener('resize', onResize);
    removers.push(() => browserWindow.removeEventListener('resize', onResize));
  }
  if (browserWindow && options.autoDispose !== false) {
    const disposeSoon = () => {
      void vr.dispose();
    };
    browserWindow.addEventListener('pagehide', disposeSoon, { once: true });
    browserWindow.addEventListener('beforeunload', disposeSoon, { once: true });
    removers.push(() => browserWindow.removeEventListener('pagehide', disposeSoon));
    removers.push(() => browserWindow.removeEventListener('beforeunload', disposeSoon));
  }
  return {
    dispose() {
      for (const remove of removers.splice(0).reverse()) {
        remove();
      }
    },
  };
}

/**
 * @param {SkykitXrComposition} xr
 * @param {SkykitVrStarPickOptions['ray'] | SkykitVrPickBridgeOptions['ray'] | undefined} input
 * @returns {ResolvedVrRay}
 */
function resolveVrRay(xr, input) {
  if (input && typeof input === 'object' && typeof /** @type {{ getRay?: unknown }} */ (input).getRay === 'function') {
    const key = Object.entries(xr.rays).find(([, ray]) => ray === input)?.[0] ?? null;
    return { ray: /** @type {SkykitXrRaySource} */ (input), key };
  }
  if (typeof input === 'string') {
    return { ray: xr.rays[input] ?? null, key: xr.rays[input] ? input : null };
  }
  for (const key of ['right', 'head', 'left']) {
    if (xr.rays[key]) {
      return { ray: xr.rays[key], key };
    }
  }
  return { ray: null, key: null };
}

/**
 * @param {readonly string[] | Iterable<string> | undefined} input
 * @param {boolean} pickEnabled
 * @returns {string[]}
 */
function createStarAttributes(input, pickEnabled) {
  const attributes = new Set(DEFAULT_STAR_ATTRIBUTES);
  for (const attribute of input ?? []) {
    attributes.add(attribute);
  }
  if (pickEnabled) {
    for (const attribute of DEFAULT_STAR_PICK_ATTRIBUTES) {
      attributes.add(attribute);
    }
  }
  return Array.from(attributes);
}

/**
 * @param {SkykitStarSourcePublishOptions | false | undefined} input
 * @returns {SkykitStarSourcePublishOptions | false}
 */
function normalizeStarPublish(input) {
  if (input === false) return false;
  const options = input ?? {};
  return {
    source: options.source ?? DEFAULT_STAR_SOURCE_PRODUCT,
    store: options.store ?? DEFAULT_STAR_STORE_PRODUCT,
    metadata: {
      label: 'Stellar source',
      tags: ['vr', 'stellar'],
      ...(options.metadata ?? {}),
    },
  };
}

/**
 * @param {{ id: string; source: SkykitStarCellSource; publish: SkykitStarSourcePublishOptions }} options
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
function createStarSourcePublisherPlugin(options) {
  let productCount = 0;
  return {
    id: options.id,
    setup(context) {
      const products = getSkykitProductRegistry(context);
      /** @type {SkykitPluginTeardown[]} */
      const teardowns = [];
      const metadata = {
        kind: 'stars',
        ownerId: options.source.id,
        label: 'Stellar source',
        tags: ['vr', 'stellar'],
        ...(options.publish.metadata ?? {}),
      };
      if (options.publish.source) {
        teardowns.push(products.provide(options.publish.source, options.source, metadata));
      }
      if (options.publish.store) {
        teardowns.push(products.provide(options.publish.store, options.source.getStore(), metadata));
      }
      productCount = teardowns.length;
      return () => {
        for (const teardown of teardowns.splice(0).reverse()) {
          teardown();
        }
        productCount = 0;
      };
    },
    getSnapshot() {
      return {
        id: options.id,
        productCount,
      };
    },
  };
}

/**
 * Installs a caller-owned source into this viewer without making the viewer
 * responsible for disposing that source.
 *
 * @param {SkykitStarCellSource} source
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
function createNonOwningStarSourcePlugin(source) {
  const id = `${source.id}:viewer-lifecycle`;
  let removePart = /** @type {SkykitPluginTeardown | null} */ (null);
  return {
    id,
    setup(context) {
      const threeContext = /** @type {import('../index.d.ts').SkykitThreePluginContext} */ (context);
      removePart = threeContext.addPart({
        id: source.id,
        priority: source.priority,
        attach(nextContext) {
          return source.attach?.(nextContext);
        },
        start(nextContext) {
          return source.start?.(nextContext);
        },
        update(frame) {
          return source.update?.(frame);
        },
        beforeRender(frame) {
          return source.beforeRender?.(frame);
        },
        afterRender(frame) {
          return source.afterRender?.(frame);
        },
        resize(size) {
          return source.resize?.(size);
        },
        setView(view) {
          return source.setView?.(view);
        },
        detach() {
          return source.detach?.();
        },
        dispose() {
          return source.detach?.();
        },
        getSnapshot() {
          return source.getSnapshot?.() ?? { id: source.id };
        },
      });
      return () => {
        removePart?.();
        removePart = null;
      };
    },
    getSnapshot() {
      return {
        id,
        source: source.getSnapshot?.() ?? { id: source.id },
      };
    },
  };
}

/**
 * @param {ThreeStarField} starField
 * @returns {ThreeStarField}
 */
function createNonOwningStarField(starField) {
  return {
    object3d: starField.object3d,
    apply(delta) {
      return starField.apply(delta);
    },
    setCells(cells) {
      return starField.setCells(cells);
    },
    clear() {
      return starField.clear();
    },
    setView(view) {
      return starField.setView(view);
    },
    pick(ray, options) {
      return starField.pick(ray, options);
    },
    getVisibleBounds(options) {
      return starField.getVisibleBounds(options);
    },
    getSnapshot() {
      return starField.getSnapshot();
    },
    dispose() {},
  };
}

/**
 * @param {SkykitXrRaySource} raySource
 * @returns {SkykitXrRaySource}
 */
function createNonOwningRaySource(raySource) {
  return {
    id: raySource.id,
    getRay(context) {
      return raySource.getRay(context);
    },
    getSnapshot() {
      return raySource.getSnapshot();
    },
    dispose() {},
  };
}

/** @param {unknown} renderer */
function enableRendererXr(renderer) {
  const xr = renderer && typeof renderer === 'object'
    ? /** @type {{ enabled?: boolean }} */ (/** @type {{ xr?: unknown }} */ (renderer).xr)
    : null;
  if (xr && typeof xr === 'object') {
    xr.enabled = true;
  }
}

/** @param {unknown} value */
function isProductRegistryPlugin(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof /** @type {{ setup?: unknown }} */ (value).setup === 'function'
    && typeof /** @type {{ provide?: unknown }} */ (value).provide === 'function'
    && typeof /** @type {{ get?: unknown }} */ (value).get === 'function';
}

/** @param {unknown} value */
function isLayerHostPlugin(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof /** @type {{ setup?: unknown }} */ (value).setup === 'function'
    && typeof /** @type {{ addLayer?: unknown }} */ (value).addLayer === 'function';
}

/**
 * @param {SkykitPluginInput[]} plugins
 * @param {SkykitStarCellSource} source
 */
function callerPluginsIncludeSource(plugins, source) {
  return plugins.some((plugin) => plugin === source);
}

/** @param {unknown} value @param {number} fallback */
function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function resolveDevicePixelRatio() {
  const browserWindow = resolveBrowserWindow();
  return positiveNumber(browserWindow?.devicePixelRatio ?? globalThis.devicePixelRatio, 1);
}

function resolveBrowserWindow() {
  const value = /** @type {{ window?: unknown }} */ (globalThis).window;
  return value && typeof value === 'object'
    && typeof /** @type {{ addEventListener?: unknown }} */ (value).addEventListener === 'function'
    && typeof /** @type {{ removeEventListener?: unknown }} */ (value).removeEventListener === 'function'
    ? /** @type {{ devicePixelRatio?: number; addEventListener(type: string, listener: () => void, options?: unknown): void; removeEventListener(type: string, listener: () => void): void }} */ (value)
    : null;
}
