import * as THREE from 'three';

import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

import { createSkykitAnimationLoop } from './animation-loop.js';
import { SKYKIT_ACTIONS, SKYKIT_CONTROLS } from './actions.js';
import {
  createKeyboardNavigationPlugin,
  createObject3dPlugin,
  createMouseLookPlugin,
  createSkykitJourneyPlugin,
  createSkykitNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitStatusPlugin,
  createStreamingStarsPlugin,
} from './plugins.js';
import { createObject3dLayer } from './layers.js';
import { createSkykitViewer } from './viewer.js';

const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_EXPOSURE = 2400;
const DEFAULT_UNITS_PER_PARSEC = 0.001;
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;

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
  const starField = options.starField ?? createThreeStarField({
    limitingMagnitude,
    exposure: positive(options.exposure, DEFAULT_EXPOSURE),
  });

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
      createStreamingStarsPlugin({
        id: 'stars',
        provider,
        renderer: starField,
        session: {
          strategy: options.strategy ?? createObserverShellStrategy(),
          ...(options.session ?? {}),
        },
      }),
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
    loop,
    capabilities,
    install,
    addObject,
    resize,
    dispose,
  };
  browser.journey = createLazyJourneyFacade(browser);
  browser.constellations = createLazyConstellationsFacade(browser, host);

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
        createObject3dPlugin,
        createSkykitJourneyPlugin,
        createSkykitNavigationPlugin,
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

/** @param {unknown} input */
function isBrowserAddon(input) {
  return Boolean(input && typeof input === 'object' && typeof /** @type {{ install?: unknown }} */ (input).install === 'function');
}

/**
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @returns {import('./browser.d.ts').SkykitBrowserJourneyFacade}
 */
function createLazyJourneyFacade(browser) {
  /** @type {Promise<import('./browser.d.ts').SkykitBrowserJourneyFacade> | null} */
  let loaded = null;
  const loadCapability = () => {
    loaded ??= import('./browser-journey.js')
      .then((module) => module.installSkykitJourneyBrowserCapability({ browser }));
    return loaded;
  };
  return {
    async transitionTo(viewOrScene, options) {
      return (await loadCapability()).transitionTo(viewOrScene, options);
    },
    async applyScene(sceneSpec) {
      return (await loadCapability()).applyScene(sceneSpec);
    },
    async load(input, options) {
      return (await loadCapability()).load(input, options);
    },
    async getSnapshot() {
      return (await loadCapability()).getSnapshot();
    },
  };
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

function createPointerPlugins(options, host) {
  const mouseMode = normalizeMouseMode(options.mouseMode);
  if (options.grab === false || mouseMode === 'none') return [];
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
    render({ viewer }) {
      const stars = viewer.parts.find((part) => part.id === 'stars')?.snapshot;
      target.textContent = JSON.stringify({
        observerPc: viewer.view.observerPc,
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
