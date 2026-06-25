import * as THREE from 'three';

import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  parseSpatialLookAtText,
  resolveSpatialTarget,
} from '@found-in-space/spatial';

import { SKYKIT_ACTIONS, SKYKIT_CONTROLS } from './actions.js';
import {
  createRaDecLookAt,
  parseDeclination,
  parseRightAscension,
} from '@found-in-space/spatial';
import { createSkykitInspectFacade } from './inspect.js';
import { createSkykitLayerHostPlugin } from './layer-host.js';
import { createObject3dLayer } from './layers.js';
import { createSkykitNavigationPlugin, createSkykitStatusPlugin } from './plugins.js';
import { createSkykitProductRegistryPlugin } from './products.js';
import {
  createSkykitSelectionFacade,
  createSkykitSelectionProductsPlugin,
} from './selection.js';
import { createSkykitVrViewer } from './xr/vr-viewer.js';

const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_SELECTION_PRODUCT = 'selection:primary';

/**
 * @param {import('./xr-browser.d.ts').SkykitXrBrowserOptions | import('./browser.d.ts').SkykitBrowserHost} [input]
 * @returns {Promise<import('./xr-browser.d.ts').SkykitXrBrowser>}
 */
export async function createSkykitXrBrowser(input = {}) {
  const options = normalizeOptions(input);
  const host = resolveTarget(options.host ?? '#viewer', 'SkyKit XR browser host');
  const statusInput = options.status === true ? '#status' : options.status;
  const statusTarget = statusInput === false || statusInput == null
    ? null
    : resolveTarget(statusInput, 'SkyKit XR status target');
  const renderer = options.renderer;
  renderer?.setClearColor?.(options.background ?? 0x02040b, 1);
  if (host.style && options.disableTouchAction !== false) host.style.touchAction = 'none';

  const products = isProductRegistryPlugin(options.products)
    ? options.products
    : createSkykitProductRegistryPlugin({ id: 'skykit-xr-browser-products' });
  const selectionProducts = createSkykitSelectionProductsPlugin({ id: 'skykit-xr-browser-selection' });
  const selection = createSkykitSelectionFacade({
    store: selectionProducts.primary,
    products,
  });
  const capabilities = new Set();
  const providerBundle = createProviderBundle(options);
  const layerHost = normalizeLayerHost(options.layerHost);
  let browser = /** @type {import('./xr-browser.d.ts').SkykitXrBrowser | null} */ (null);

  const vr = await createSkykitVrViewer({
    ...options,
    host,
    renderer,
    products,
    layerHost,
    stars: normalizeStarsOptions(options, providerBundle.provider),
    plugins: [
      selectionProducts,
      ...(statusTarget ? [createStatusPlugin(statusTarget, () => browser)] : []),
      ...(options.plugins ?? []),
    ],
    maxDevicePixelRatio: options.maxDevicePixelRatio ?? DEFAULT_MAX_DEVICE_PIXEL_RATIO,
  });
  const inspect = createSkykitInspectFacade({
    viewer: vr.viewer,
    products,
    selection,
    getXrSnapshot: () => vr.xr?.getSnapshot?.() ?? null,
    getRuntimeSnapshot: () => vr.getSnapshot(),
  });
  /** @type {Array<() => void | Promise<void>>} */
  const browserDisposables = [];
  let disposed = false;

  browser = {
    viewer: vr.viewer,
    vr,
    xr: vr.xr,
    rig: vr.rig,
    session: vr.session,
    body: vr.body,
    navigation: vr.navigation,
    rays: vr.rays,
    renderer: vr.renderer,
    camera: vr.camera,
    provider: providerBundle.provider,
    starSource: vr.starSource,
    starField: vr.starField,
    starLayer: vr.starLayer,
    layerHost: vr.layerHost,
    pickBridge: vr.pickBridge,
    pickRouter: vr.pickRouter,
    starPicking: vr.starPicking,
    loop: vr.loop,
    products,
    capabilities,
    actions: vr.viewer.actions,
    selection,
    inspect,
    enter: () => vr.enter(),
    exit: () => vr.exit(),
    install,
    addObject,
    addLayer,
    resize: (size) => vr.resize(size),
    dispose,
  };
  browser.constellations = createLazyConstellationsFacade(browser, host);
  browser.frames = createLazyCoordinateFramesFacade(browser, host);
  return browser;

  /**
   * @param {import('./browser.d.ts').SkykitBrowserInstallInput} input
   * @returns {Promise<import('./index.d.ts').SkykitPluginTeardown>}
   */
  async function install(input) {
    if (!input || !browser) return () => {};
    const teardown = isBrowserAddon(input)
      ? await input.install(createBrowserAddonContext(input, browser, host))
      : await vr.install(/** @type {import('./index.d.ts').SkykitPluginInput} */ (input));
    if (typeof teardown !== 'function') return () => {};
    browserDisposables.push(teardown);
    return () => {
      const index = browserDisposables.indexOf(teardown);
      if (index >= 0) browserDisposables.splice(index, 1);
      void teardown();
    };
  }

  /**
   * @param {THREE.Object3D} object3d
   * @param {import('./browser.d.ts').SkykitBrowserObjectOptions} [objectOptions]
   * @returns {import('./browser.d.ts').SkykitBrowserObjectHandle}
   */
  function addObject(object3d, objectOptions = {}) {
    if (!object3d) {
      throw new TypeError('SkykitXrBrowser.addObject() requires a THREE.Object3D.');
    }
    const { positionPc, ...layerOptions } = objectOptions;
    if (positionPc) {
      setObjectPositionPc(
        object3d,
        positionPc,
        vr.viewer.getViewState().coordinateUnitsPerParsec,
      );
    }
    const part = createObject3dLayer({
      ...layerOptions,
      object3d,
      anchorMode: layerOptions.anchorMode ?? 'world-space',
    });
    const remove = vr.viewer.addPart(part);
    return {
      object3d,
      part,
      remove,
      dispose: remove,
    };
  }

  /** @param {import('./index.d.ts').SkykitHostedLayer} layer */
  function addLayer(layer) {
    if (!vr.layerHost) {
      throw new Error('SkykitXrBrowser.addLayer() requires an enabled layer host.');
    }
    return vr.layerHost.addLayer(layer);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    for (const disposable of browserDisposables.splice(0).reverse()) {
      await disposable();
    }
    inspect.dispose?.();
    await vr.dispose();
    if (providerBundle.ownsProvider) await providerBundle.provider?.dispose?.();
  }
}

/**
 * @param {import('./xr-browser.d.ts').SkykitXrBrowserOptions} options
 * @param {import('@found-in-space/star-octree-provider').StarOctreeProviderService | null} provider
 */
function normalizeStarsOptions(options, provider) {
  if (options.stars === false) return false;
  const stars = options.stars && typeof options.stars === 'object' ? options.stars : {};
  const pick = stars.pick === false
    ? false
    : {
        ...((stars.pick && typeof stars.pick === 'object') ? stars.pick : {}),
        selection: typeof stars.pick === 'object' && stars.pick?.selection !== undefined
          ? stars.pick.selection
          : DEFAULT_SELECTION_PRODUCT,
      };
  return {
    ...stars,
    ...(provider && !stars.provider && !stars.source ? { provider } : {}),
    pick,
  };
}

/** @param {import('./xr-browser.d.ts').SkykitXrBrowserOptions} options */
function createProviderBundle(options) {
  if (options.stars === false) {
    return { provider: null, ownsProvider: false };
  }
  const stars = options.stars && typeof options.stars === 'object' ? options.stars : {};
  if (stars.provider || stars.source) {
    return { provider: stars.provider ?? null, ownsProvider: false };
  }
  if (options.provider) {
    return { provider: options.provider, ownsProvider: false };
  }
  return {
    provider: createStarOctreeProviderService({
      url: options.octreeUrl ?? OCTREE_DEFAULT,
      persistentCache: normalizePersistentCacheMode(options.persistentCache),
    }),
    ownsProvider: true,
  };
}

/** @param {import('./xr.d.ts').SkykitVrViewerOptions['layerHost']} input */
function normalizeLayerHost(input) {
  if (input === false) return false;
  if (input && typeof input === 'object') return input;
  return createSkykitLayerHostPlugin({ id: 'skykit-xr-browser-layer-host' });
}

/**
 * @param {import('./browser.d.ts').SkykitBrowserAddon} addon
 * @param {import('./xr-browser.d.ts').SkykitXrBrowser} browser
 * @param {Element | import('./browser.d.ts').SkykitBrowserHost} host
 * @returns {import('./xr-browser.d.ts').SkykitXrBrowserAddonContext}
 */
function createBrowserAddonContext(addon, browser, host) {
  return {
    id: addon.id,
    host,
    browser,
    viewer: browser.viewer,
    vr: browser.vr,
    xr: browser.xr,
    THREE,
    skykit: {
      SKYKIT_ACTIONS,
      SKYKIT_CONTROLS,
      createRaDecLookAt,
      createSkykitNavigationPlugin,
      parseDeclination,
      parseRightAscension,
      parseSpatialLookAtText,
      products: browser.products,
      selection: browser.selection,
      inspect: browser.inspect,
    },
  };
}

/**
 * @param {import('./xr-browser.d.ts').SkykitXrBrowser | null} browser
 * @param {Element | import('./browser.d.ts').SkykitBrowserHost} host
 * @returns {import('./browser.d.ts').SkykitBrowserConstellationsFacade}
 */
function createLazyConstellationsFacade(browser, host) {
  /** @type {Promise<import('./browser.d.ts').SkykitBrowserConstellationsFacade> | null} */
  let loaded = null;
  const loadCapability = (options = {}) => {
    loaded ??= import('./browser-constellations.js')
      .then((module) => module.installSkykitConstellationsBrowserCapability({
        browser: /** @type {import('./browser.d.ts').SkykitBrowser} */ (browser),
        host,
        options,
      }));
    return loaded;
  };
  return {
    async load(options) {
      return loadCapability(options);
    },
    async show() {
      return (await loadCapability()).show();
    },
    async hide() {
      return (await loadCapability()).hide();
    },
    async toggle(force) {
      return (await loadCapability()).toggle(force);
    },
    async setArt(mode) {
      return (await loadCapability()).setArt(mode);
    },
    async getSnapshot() {
      return (await loadCapability()).getSnapshot();
    },
  };
}

/**
 * @param {import('./xr-browser.d.ts').SkykitXrBrowser | null} browser
 * @param {Element | import('./browser.d.ts').SkykitBrowserHost} host
 * @returns {import('./browser.d.ts').SkykitBrowserCoordinateFramesFacade}
 */
function createLazyCoordinateFramesFacade(browser, host) {
  /** @type {Promise<import('./browser.d.ts').SkykitBrowserCoordinateFramesFacade> | null} */
  let loaded = null;
  const loadCapability = (options = {}) => {
    loaded ??= import('./browser-frames.js')
      .then((module) => module.installSkykitCoordinateFramesBrowserCapability({
        browser: /** @type {import('./browser.d.ts').SkykitBrowser} */ (browser),
        host,
        options,
      }));
    return loaded;
  };
  return {
    async load(options) {
      return loadCapability(options);
    },
    async show() {
      return (await loadCapability()).show();
    },
    async hide() {
      return (await loadCapability()).hide();
    },
    async toggle(force) {
      return (await loadCapability()).toggle(force);
    },
    async getSnapshot() {
      return (await loadCapability()).getSnapshot();
    },
  };
}

/**
 * @param {import('./browser.d.ts').SkykitBrowserStatusTarget} target
 * @param {() => import('./xr-browser.d.ts').SkykitXrBrowser | null} getBrowser
 */
function createStatusPlugin(target, getBrowser) {
  return createSkykitStatusPlugin({
    intervalSeconds: 0.5,
    render({ viewer }) {
      const browser = getBrowser();
      const stars = browser?.starSource?.getSnapshot?.()
        ?? viewer.parts.find((part) => part.id === 'skykit-vr-stars')?.snapshot
        ?? null;
      const session = browser?.session?.getSnapshot?.() ?? null;
      target.textContent = JSON.stringify({
        observerPc: viewer.view.observerPc,
        starsLoaded: browser?.starField?.getSnapshot?.().starCount ?? 0,
        stream: stars?.status ?? 'starting',
        xr: session
          ? {
              supported: session.supported ?? null,
              presenting: session.presenting ?? false,
              stage: session.enterStage ?? 'idle',
            }
          : null,
      }, null, 2);
    },
  });
}

/** @param {unknown} input */
function isBrowserAddon(input) {
  return Boolean(input && typeof input === 'object' && typeof /** @type {{ install?: unknown }} */ (input).install === 'function');
}

/** @param {unknown} value */
function isProductRegistryPlugin(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof /** @type {{ setup?: unknown }} */ (value).setup === 'function'
    && typeof /** @type {{ provide?: unknown }} */ (value).provide === 'function'
    && typeof /** @type {{ get?: unknown }} */ (value).get === 'function';
}

function normalizeOptions(input) {
  if (typeof input === 'string' || isElementLike(input)) return { host: input };
  return input ?? {};
}

function resolveTarget(input, label) {
  if (typeof input !== 'string') {
    if (input) return input;
    throw new Error(`${label} is missing.`);
  }
  const target = document.querySelector(input);
  if (!target) throw new Error(`${label} not found: ${input}`);
  return target;
}

function isElementLike(value) {
  return Boolean(value && typeof value === 'object' && 'appendChild' in value);
}

function normalizePersistentCacheMode(value) {
  const mode = String(value ?? 'on').trim().toLowerCase();
  return mode === 'off' || mode === 'false' || mode === 'no' || mode === '0' || mode === 'disabled'
    ? 'off'
    : 'on';
}

/**
 * @param {THREE.Object3D} object3d
 * @param {{ x: number; y: number; z: number }} positionPc
 * @param {number} unitsPerParsec
 */
function setObjectPositionPc(object3d, positionPc, unitsPerParsec) {
  object3d.position?.set?.(
    positionPc.x * unitsPerParsec,
    positionPc.y * unitsPerParsec,
    positionPc.z * unitsPerParsec,
  );
}

/** @param {string} text */
export function parseSkykitXrSpatialTargetText(text) {
  const targetSpec = parseSpatialLookAtText(text);
  const target = resolveSpatialTarget(targetSpec);
  return target && typeof /** @type {Promise<unknown>} */ (target).then !== 'function'
    ? target
    : null;
}
