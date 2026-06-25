import * as THREE from 'three';

import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';
import {
  createRaDecLookAt,
  parseDeclination,
  parseRightAscension,
  parseSpatialLookAtText,
} from '@found-in-space/spatial';

import { createSkykitAnimationLoop } from './animation-loop.js';
import { SKYKIT_ACTIONS, SKYKIT_CONTROLS } from './actions.js';
import {
  createKeyboardNavigationPlugin,
  createObject3dPlugin,
  createMouseLookPlugin,
  createSkyOrbitPlugin,
  createSkykitNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitStatusPlugin,
  createStreamingStarsPlugin,
} from './plugins.js';
import { createSkykitInspectFacade } from './inspect.js';
import { createObject3dLayer } from './layers.js';
import { createSkykitProductRegistryPlugin } from './products.js';
import {
  createSkykitLayerSelectionFromPick,
  createSkykitLayerSelectionPlugin,
  createSkykitSelectionFacade,
  createSkykitSelectionProductsPlugin,
} from './selection.js';
import { createSkykitStarSourcePlugin } from './star-source.js';
import { createSkykitStarPickingPlugin } from './star-picking.js';
import { createSkykitViewer } from './viewer.js';

const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_EXPOSURE = 2400;
const DEFAULT_UNITS_PER_PARSEC = 0.001;
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_STAR_SOURCE_PRODUCT = 'stars:stellar/source';
const DEFAULT_STAR_STORE_PRODUCT = 'stars:stellar/store';
const DEFAULT_SELECTION_PRODUCT = 'selection:primary';

/**
 * Create the default browser star viewer used by the starter lessons.
 *
 * @param {import('./browser.d.ts').SkykitBrowserOptions | import('./browser.d.ts').SkykitBrowserHost} [input]
 * @returns {Promise<import('./browser.d.ts').SkykitBrowser>}
 */
export async function createSkykitBrowser(input = {}) {
  const options = normalizeOptions(input);
  const host = resolveTarget(options.host ?? '#viewer', 'SkyKit browser host');
  const statusInput = options.status === true ? '#status' : options.status;
  const statusTarget = statusInput === false || statusInput == null
    ? null
    : resolveTarget(statusInput, 'SkyKit status target');
  const limitingMagnitude = positive(options.limitingMagnitude, DEFAULT_LIMITING_MAGNITUDE);
  const renderer = options.renderer ?? new THREE.WebGLRenderer({
    antialias: options.antialias !== false,
  });
  const camera = options.camera ?? new THREE.PerspectiveCamera(
    positive(options.fovDeg, 58),
    1,
    positive(options.near, 0.0001),
    positive(options.far, 1000),
  );
  const provider = options.provider ?? createStarOctreeProviderService({
    url: options.octreeUrl ?? OCTREE_DEFAULT,
    persistentCache: normalizePersistentCacheMode(options.persistentCache),
  });
  const strategy = options.strategy ?? options.session?.strategy ?? createObserverShellStrategy();
  const starSource = createSkykitStarSourcePlugin({
    id: 'stars-source',
    provider,
    priority: 100,
    session: stripStarSourceSessionOptions(options.session),
    publish: {
      source: DEFAULT_STAR_SOURCE_PRODUCT,
      store: DEFAULT_STAR_STORE_PRODUCT,
      metadata: {
        label: 'Stellar source',
        tags: ['browser', 'stellar'],
      },
    },
  });
  const starField = options.starField ?? createThreeStarField({
    limitingMagnitude,
    exposure: positive(options.exposure, DEFAULT_EXPOSURE),
  });
  const products = createSkykitProductRegistryPlugin({ id: 'skykit-browser-products' });
  const selectionProducts = createSkykitSelectionProductsPlugin({ id: 'skykit-browser-selection' });
  const layerSelection = createSkykitLayerSelectionPlugin({ id: 'skykit-browser-layer-selection' });
  const starPicking = createBrowserStarPicking(options, host, starSource, starField);

  renderer.setClearColor?.(options.background ?? 0x02040b, 1);
  if (host.style && options.disableTouchAction !== false) host.style.touchAction = 'none';

  const viewer = await createSkykitViewer({
    host,
    renderer,
    camera,
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      coordinateUnitsPerParsec: positive(options.coordinateUnitsPerParsec, DEFAULT_UNITS_PER_PARSEC),
      limitingMagnitude,
      ...(options.lookAt ? { lookAt: options.lookAt } : {}),
      ...(options.view ?? {}),
    },
    plugins: [
      products,
      selectionProducts,
      layerSelection,
      starSource,
      createStreamingStarsPlugin({
        id: 'stars',
        source: starSource,
        renderer: starField,
        strategy,
        attributes: options.session?.attributes,
      }),
      ...(starPicking ? [starPicking] : []),
      ...(options.keyboard === false ? [] : [
        createKeyboardNavigationPlugin({
          speedPcPerSec: positive(options.speedPcPerSec, 2),
          ...(options.keyboard ?? {}),
        }),
      ]),
      ...createPointerPlugins(options, host),
      ...(statusTarget ? [createStatusPlugin(statusTarget)] : []),
      ...(options.plugins ?? []),
    ],
  });

  const loop = createSkykitAnimationLoop(viewer, options.loop);
  const capabilities = new Set();
  const selection = createSkykitSelectionFacade({
    store: selectionProducts.primary,
    products,
  });
  const inspect = createSkykitInspectFacade({
    viewer,
    products,
    selection,
  });
  /** @type {Array<() => void | Promise<void>>} */
  const browserDisposables = [];
  let disposed = false;
  /** @type {import('./browser.d.ts').SkykitBrowser} */
  const browser = {
    viewer,
    renderer,
    camera,
    provider,
    starField,
    starPicking,
    loop,
    capabilities,
    actions: viewer.actions,
    products,
    selection,
    inspect,
    install,
    addObject,
    resize,
    dispose,
  };
  browser.constellations = createLazyConstellationsFacade(browser, host);
  browser.frames = createLazyCoordinateFramesFacade(browser, host);
  browser.grids = createLazyCoordinateGridsFacade(browser, host);

  function resize() {
    viewer.resize({
      devicePixelRatio: Math.min(
        window.devicePixelRatio || 1,
        positive(options.maxDevicePixelRatio, DEFAULT_MAX_DEVICE_PIXEL_RATIO),
      ),
    });
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', disposeSoon);
    window.removeEventListener('beforeunload', disposeSoon);
    for (const disposable of browserDisposables.splice(0).reverse()) {
      await disposable();
    }
    inspect.dispose?.();
    loop.dispose();
    await viewer.dispose();
    if (!options.provider) await provider.dispose?.();
    if (!options.renderer) renderer.dispose?.();
  }
  function disposeSoon() { void dispose(); }

  if (options.autoResize !== false) window.addEventListener('resize', resize);
  if (options.autoDispose !== false) {
    window.addEventListener('pagehide', disposeSoon, { once: true });
    window.addEventListener('beforeunload', disposeSoon, { once: true });
  }
  resize();
  if (options.autoStart !== false) loop.start();

  return browser;

  /**
   * @param {import('./browser.d.ts').SkykitBrowserInstallInput} input
   * @returns {Promise<import('./index.d.ts').SkykitPluginTeardown>}
   */
  async function install(input) {
    if (!input) return () => {};
    const teardown = isBrowserAddon(input)
      ? await input.install(createBrowserAddonContext(input))
      : await viewer.addPlugin(/** @type {import('./index.d.ts').SkykitPluginInput} */ (input));
    if (typeof teardown !== 'function') return () => {};
    browserDisposables.push(teardown);
    return () => {
      const index = browserDisposables.indexOf(teardown);
      if (index >= 0) browserDisposables.splice(index, 1);
      void teardown();
    };
  }

  /**
   * @param {import('./browser.d.ts').SkykitBrowserAddon} addon
   * @returns {import('./browser.d.ts').SkykitBrowserAddonContext}
   */
  function createBrowserAddonContext(addon) {
    return {
      id: addon.id,
      host,
      browser,
      viewer,
      THREE,
      skykit: {
        SKYKIT_ACTIONS,
        SKYKIT_CONTROLS,
        createRaDecLookAt,
        createObject3dPlugin,
        createSkyOrbitPlugin,
        createSkykitNavigationPlugin,
        parseDeclination,
        parseRightAscension,
        parseSpatialLookAtText,
        createSkykitLayerSelectionFromPick,
        createSkykitLayerSelectionPlugin,
        products,
        selection,
        inspect,
      },
    };
  }

  /**
   * @param {THREE.Object3D} object3d
   * @param {import('./browser.d.ts').SkykitBrowserObjectOptions} [objectOptions]
   * @returns {import('./browser.d.ts').SkykitBrowserObjectHandle}
   */
  function addObject(object3d, objectOptions = {}) {
    if (!object3d) {
      throw new TypeError('SkykitBrowser.addObject() requires a THREE.Object3D.');
    }
    const { positionPc, ...layerOptions } = objectOptions;
    if (positionPc) {
      setObjectPositionPc(
        object3d,
        positionPc,
        viewer.getViewState().coordinateUnitsPerParsec,
      );
    }
    const part = createObject3dLayer({
      ...layerOptions,
      object3d,
      anchorMode: layerOptions.anchorMode ?? 'world-space',
    });
    const remove = viewer.addPart(part);
    return {
      object3d,
      part,
      remove,
      dispose: remove,
    };
  }
}

/**
 * @param {import('./browser.d.ts').SkykitBrowserOptions} options
 * @param {Element | import('./browser.d.ts').SkykitBrowserHost} host
 * @param {import('./index.d.ts').SkykitStarCellSource} source
 * @param {import('@found-in-space/three-star-field').ThreeStarField} starField
 * @returns {(import('./index.d.ts').SkykitPlugin & { getSnapshot?(): unknown }) | null}
 */
function createBrowserStarPicking(options, host, source, starField) {
  if (options.pick === false || typeof starField.pick !== 'function') return null;
  const pickOptions = options.pick === true || options.pick == null ? {} : options.pick;
  const { target, ...rest } = pickOptions;
  return createSkykitStarPickingPlugin({
    ...rest,
    target: target ?? /** @type {import('./index.d.ts').SkykitStarPickingTarget} */ (host),
    renderer: starField,
    source,
    selection: rest.selection ?? DEFAULT_SELECTION_PRODUCT,
  });
}

/** @param {unknown} input */
function isBrowserAddon(input) {
  return Boolean(input && typeof input === 'object' && typeof /** @type {{ install?: unknown }} */ (input).install === 'function');
}

/**
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @param {Element | import('./browser.d.ts').SkykitBrowserHost} host
 * @returns {import('./browser.d.ts').SkykitBrowserConstellationsFacade}
 */
function createLazyConstellationsFacade(browser, host) {
  /** @type {Promise<import('./browser.d.ts').SkykitBrowserConstellationsFacade> | null} */
  let loaded = null;
  const loadCapability = (options = {}) => {
    loaded ??= import('./browser-constellations.js')
      .then((module) => module.installSkykitConstellationsBrowserCapability({
        browser,
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
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @param {Element | import('./browser.d.ts').SkykitBrowserHost} host
 * @returns {import('./browser.d.ts').SkykitBrowserCoordinateFramesFacade}
 */
function createLazyCoordinateFramesFacade(browser, host) {
  /** @type {Promise<import('./browser.d.ts').SkykitBrowserCoordinateFramesFacade> | null} */
  let loaded = null;
  const loadCapability = (options = {}) => {
    loaded ??= import('./browser-frames.js')
      .then((module) => module.installSkykitCoordinateFramesBrowserCapability({
        browser,
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
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @param {Element | import('./browser.d.ts').SkykitBrowserHost} host
 * @returns {import('./browser.d.ts').SkykitBrowserCoordinateGridsFacade}
 */
function createLazyCoordinateGridsFacade(browser, host) {
  /** @type {Promise<import('./browser.d.ts').SkykitBrowserCoordinateGridsFacade> | null} */
  let loaded = null;
  const loadCapability = (options = {}) => {
    loaded ??= import('./browser-grids.js')
      .then((module) => module.installSkykitCoordinateGridsBrowserCapability({
        browser,
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

function createPointerPlugins(options, host) {
  const mouseMode = normalizeMouseMode(options.mouseMode);
  if (options.grab === false || mouseMode === 'none') return [];
  if (mouseMode === 'orbit') {
    return [createSkyOrbitPlugin({
      target: host,
      ...(options.grab ?? {}),
    })];
  }
  const pointerOptions = {
    target: host,
    sensitivityRadiansPerPixel: 0.00075,
    ...(options.grab ?? {}),
  };
  return [
    mouseMode === 'look' || mouseMode === 'strafe'
      ? createMouseLookPlugin(pointerOptions)
      : createSkyGrabPlugin(pointerOptions),
  ];
}

function normalizeMouseMode(value) {
  const mode = String(value ?? 'grab').trim().toLowerCase();
  if (mode === 'look' || mode === 'mouse-look' || mode === 'mouselook' || mode === 'game' || mode === 'strafe') {
    return mode === 'strafe' ? 'strafe' : 'look';
  }
  if (mode === 'orbit' || mode === 'object-orbit' || mode === 'orbital' || mode === 'inspect') return 'orbit';
  if (mode === 'none' || mode === 'off' || mode === 'false') return 'none';
  return 'grab';
}

function normalizePersistentCacheMode(value) {
  const mode = String(value ?? 'on').trim().toLowerCase();
  return mode === 'off' || mode === 'false' || mode === 'no' || mode === '0' || mode === 'disabled'
    ? 'off'
    : 'on';
}

function createStatusPlugin(target) {
  return createSkykitStatusPlugin({
    intervalSeconds: 0.5,
    render({ viewer: viewerSnapshot }) {
      const stars = viewerSnapshot.parts.find((part) => part.id === 'stars')?.snapshot;
      target.textContent = JSON.stringify({
        observerPc: viewerSnapshot.view.observerPc,
        starsLoaded: stars?.renderer?.starCount ?? 0,
        stream: stars?.status ?? 'starting',
      }, null, 2);
    },
  });
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

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {import('@found-in-space/star-octree-provider').StarOctreeSessionOptions | undefined} session */
function stripStarSourceSessionOptions(session) {
  if (!session) return undefined;
  const { strategy: _strategy, attributes: _attributes, ...rest } = session;
  return rest;
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
