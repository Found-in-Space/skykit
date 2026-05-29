import {
  getSkykitProductRegistry,
  isSkykitProductRef,
} from '../products.js';
import { createSkykitXrPickRouter } from './pick-router.js';
import {
  createSkykitXrBodyPlugin,
  createSkykitXrNavigationPlugin,
  createSkykitXrObserverRig,
  createSkykitXrRayVisualPlugin,
  createSkykitXrSessionPlugin,
} from './plugins.js';
import { createSkykitXrRaySource } from './rays.js';
import { createSkykitXrRig } from './rig.js';

const DEFAULT_COMPOSITION_ID = 'skykit-xr-composition';
const FRAME_STATE_BRIDGE_PRIORITY = -850;
const PICK_BRIDGE_PRIORITY = 50;

/**
 * @typedef {import('../index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('../index.d.ts').SkykitPluginTeardown} SkykitPluginTeardown
 * @typedef {import('../index.d.ts').SkykitProductKey} SkykitProductKey
 * @typedef {import('../index.d.ts').SkykitProductRef} SkykitProductRef
 * @typedef {import('../index.d.ts').SkykitSceneRoots} SkykitSceneRoots
 * @typedef {import('../index.d.ts').SkykitThreeFrame} SkykitThreeFrame
 * @typedef {import('../index.d.ts').SkykitThreePluginContext} SkykitThreePluginContext
 * @typedef {import('../xr.d.ts').SkykitXrBodyPlugin} SkykitXrBodyPlugin
 * @typedef {import('../xr.d.ts').SkykitXrComposition} SkykitXrComposition
 * @typedef {import('../xr.d.ts').SkykitXrCompositionOptions} SkykitXrCompositionOptions
 * @typedef {import('../xr.d.ts').SkykitXrNavigationPlugin} SkykitXrNavigationPlugin
 * @typedef {import('../xr.d.ts').SkykitXrPickBlocker} SkykitXrPickBlocker
 * @typedef {import('../xr.d.ts').SkykitXrPickBridgePlugin} SkykitXrPickBridgePlugin
 * @typedef {import('../xr.d.ts').SkykitXrPickBridgePluginOptions} SkykitXrPickBridgePluginOptions
 * @typedef {import('../xr.d.ts').SkykitXrPickRouteResult} SkykitXrPickRouteResult
 * @typedef {import('../xr.d.ts').SkykitXrPickRouter} SkykitXrPickRouter
 * @typedef {import('../xr.d.ts').SkykitXrPickTarget} SkykitXrPickTarget
 * @typedef {import('../xr.d.ts').SkykitXrRayContext} SkykitXrRayContext
 * @typedef {import('../xr.d.ts').SkykitXrRaySource} SkykitXrRaySource
 * @typedef {import('../xr.d.ts').SkykitXrRaySourceOptions} SkykitXrRaySourceOptions
 * @typedef {import('../xr.d.ts').SkykitXrRig} SkykitXrRig
 * @typedef {import('../xr.d.ts').SkykitXrSessionPlugin} SkykitXrSessionPlugin
 */

/**
 * @param {SkykitXrRig} rig
 * @returns {SkykitSceneRoots}
 */
export function createSkykitSceneRootsFromXrRig(rig) {
  if (!rig || typeof rig !== 'object') {
    throw new TypeError('createSkykitSceneRootsFromXrRig() requires an XR rig.');
  }
  return {
    originContentRoot: rig.originContentRoot,
    observerContentRoot: rig.observerContentRoot,
    navigationRoot: rig.navigationRoot,
    scaleBandedContentRoots: new Map(Object.entries(rig.scaleBandedContentRoots)),
  };
}

/**
 * @param {SkykitXrCompositionOptions} [options]
 * @returns {SkykitXrComposition}
 */
export function createSkykitXrComposition(options = {}) {
  const id = options.id ?? DEFAULT_COMPOSITION_ID;
  const ownsRig = !options.rig;
  const rig = options.rig ?? createSkykitXrRig({
    id: `${id}:rig`,
    scaleBandIds: options.scaleBandIds,
  });
  if (options.camera) {
    rig.attachCamera(options.camera);
  }

  const roots = createSkykitSceneRootsFromXrRig(rig);
  const observerRig = createSkykitXrObserverRig({
    rig,
    coordinateUnitsPerParsec: options.coordinateUnitsPerParsec,
  });
  const cameraRoot = rig.cameraMount;
  const ownedRays = new Set();
  const rays = options.rays === false
    ? {}
    : createCompositionRays(id, options.rays, ownedRays);
  const session = options.session === false
    ? null
    : /** @type {SkykitXrSessionPlugin} */ (createSkykitXrSessionPlugin({
      ...(options.session ?? {}),
      ...(options.renderer !== undefined ? { renderer: options.renderer } : {}),
    }));
  const body = options.body === false
    ? null
    : createSkykitXrBodyPlugin({
      ...(options.body ?? {}),
      rig,
    });
  const navigation = options.navigation === false
    ? null
    : /** @type {SkykitXrNavigationPlugin} */ (createSkykitXrNavigationPlugin({
      ...(options.navigation ?? {}),
      rig,
    }));

  /** @type {SkykitPlugin[]} */
  const plugins = [];
  if (session) plugins.push(session);
  if (body) plugins.push(body);
  plugins.push(createSkykitXrFrameStateBridgePlugin({
    id: `${id}:frame-state`,
    rig,
    body,
    rays,
  }));
  if (navigation) plugins.push(navigation);
  if (options.rayVisuals === true && rays.right) {
    plugins.push(createSkykitXrRayVisualPlugin({
      id: `${id}:right-ray-visual`,
      raySource: createNonOwningRaySource(rays.right),
      rig,
    }));
  }

  let disposed = false;

  return {
    rig,
    roots,
    observerRig,
    cameraRoot,
    plugins,
    session,
    body,
    navigation,
    rays,
    enter,
    exit,
    dispose,
    getSnapshot,
  };

  async function enter() {
    if (!session) {
      throw new Error('SkyKit XR composition cannot enter XR because session support is disabled.');
    }
    return session.enter();
  }

  async function exit() {
    if (!session) {
      throw new Error('SkyKit XR composition cannot exit XR because session support is disabled.');
    }
    return session.exit();
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    if (session) {
      await session.exit();
    }
    observerRig.dispose?.();
    for (const ray of ownedRays) {
      ray.dispose?.();
    }
    ownedRays.clear();
    if (ownsRig) {
      rig.dispose();
    }
  }

  function getSnapshot() {
    return {
      id,
      disposed,
      ownsRig,
      roots: {
        originContentRoot: roots.originContentRoot.name,
        observerContentRoot: roots.observerContentRoot.name,
        navigationRoot: roots.navigationRoot.name,
        scaleBandedContentRoots: Array.from(roots.scaleBandedContentRoots.keys()),
      },
      pluginIds: plugins.map((plugin) => plugin.id ?? null),
      session: session?.getSnapshot?.() ?? null,
      body: body?.getSnapshot?.() ?? null,
      navigation: navigation?.getSnapshot?.() ?? null,
      rays: Object.fromEntries(
        Object.entries(rays).map(([key, ray]) => [key, ray.getSnapshot?.() ?? { id: ray.id }]),
      ),
    };
  }
}

/**
 * @param {SkykitXrPickBridgePluginOptions} options
 * @returns {SkykitXrPickBridgePlugin}
 */
export function createSkykitXrPickBridgePlugin(options) {
  if (!options?.raySource || typeof options.raySource.getRay !== 'function') {
    throw new TypeError('createSkykitXrPickBridgePlugin() requires a raySource.');
  }
  const id = options.id ?? 'skykit-xr-pick-bridge';
  const router = options.router ?? createSkykitXrPickRouter({ raySource: options.raySource });
  /** @type {SkykitXrPickBlocker[]} */
  const directBlockers = Array.from(options.blockers ?? []);
  /** @type {SkykitXrPickTarget[]} */
  const directTargets = Array.from(options.targets ?? []);
  /** @type {Map<SkykitProductKey, SkykitXrPickBlocker[]>} */
  const productBlockers = new Map();
  /** @type {Map<SkykitProductKey, SkykitXrPickTarget[]>} */
  const productTargets = new Map();
  /** @type {SkykitPluginTeardown[]} */
  const teardowns = [];
  /** @type {SkykitXrPickRouteResult | null} */
  let lastRoute = null;
  let disposed = false;

  refreshRouter();

  return {
    id,
    router,
    setup,
    addBlocker,
    addTarget,
    route,
    getSnapshot,
  };

  /** @param {SkykitThreePluginContext} context */
  function setup(context) {
    const products = getSkykitProductRegistry(context);
    for (const input of options.blockerProducts ?? []) {
      const key = productInputKey(input);
      teardowns.push(products.subscribe(key, (value) => {
        productBlockers.set(key, /** @type {SkykitXrPickBlocker[]} */ (flattenProductHandles(value)));
        refreshRouter();
      }, { replay: true }));
    }
    for (const input of options.targetProducts ?? []) {
      const key = productInputKey(input);
      teardowns.push(products.subscribe(key, (value) => {
        productTargets.set(key, /** @type {SkykitXrPickTarget[]} */ (flattenProductHandles(value)));
        refreshRouter();
      }, { replay: true }));
    }
    if (options.routeOnFrame === true) {
      context.addPart({
        id: `${id}:route-on-frame`,
        priority: PICK_BRIDGE_PRIORITY,
        update(frame) {
          route(createRayContextFromFrame(frame));
        },
      });
    }
    return () => {
      disposed = true;
      for (const teardown of teardowns.splice(0).reverse()) {
        teardown();
      }
      productBlockers.clear();
      productTargets.clear();
      refreshRouter();
    };
  }

  /** @param {SkykitXrPickBlocker} blocker */
  function addBlocker(blocker) {
    directBlockers.push(blocker);
    refreshRouter();
    return () => {
      removeHandle(directBlockers, blocker);
      refreshRouter();
    };
  }

  /** @param {SkykitXrPickTarget} target */
  function addTarget(target) {
    directTargets.push(target);
    refreshRouter();
    return () => {
      removeHandle(directTargets, target);
      refreshRouter();
    };
  }

  /** @param {SkykitXrRayContext} [context] */
  function route(context = {}) {
    lastRoute = router.route(context);
    options.onRoute?.(lastRoute);
    return lastRoute;
  }

  function getSnapshot() {
    return {
      id,
      disposed,
      directBlockerCount: directBlockers.length,
      directTargetCount: directTargets.length,
      productBlockerCount: countProductHandles(productBlockers),
      productTargetCount: countProductHandles(productTargets),
      lastRoute,
      router: router.getSnapshot?.() ?? null,
    };
  }

  function refreshRouter() {
    router.setBlockers([
      ...directBlockers,
      ...Array.from(productBlockers.values()).flat(),
    ]);
    router.setTargets([
      ...directTargets,
      ...Array.from(productTargets.values()).flat(),
    ]);
  }
}

/**
 * @param {{
 *   id: string;
 *   rig: SkykitXrRig;
 *   body: SkykitXrBodyPlugin | null;
 *   rays: Record<string, SkykitXrRaySource>;
 * }} options
 * @returns {SkykitPlugin}
 */
function createSkykitXrFrameStateBridgePlugin(options) {
  return {
    id: options.id,
    setup(context) {
      context.addPart({
        id: options.id,
        priority: FRAME_STATE_BRIDGE_PRIORITY,
        update(frame) {
          const current = /** @type {import('../index.d.ts').SkykitXrFrameState} */ (
            frame.xr ?? { presenting: false }
          );
          frame.xr = {
            ...current,
            presenting: current.presenting === true,
            rig: options.rig,
            ...(options.body ? { body: options.body.getBody() } : {}),
            rays: options.rays,
          };
        },
      });
    },
  };
}

/**
 * @param {string} id
 * @param {SkykitXrCompositionOptions['rays']} rayOptions
 * @param {Set<SkykitXrRaySource>} ownedRays
 * @returns {Record<string, SkykitXrRaySource>}
 */
function createCompositionRays(id, rayOptions, ownedRays) {
  /** @type {Record<string, SkykitXrRaySource>} */
  const rays = {};
  const options = /** @type {{
    left?: false | SkykitXrRaySource | SkykitXrRaySourceOptions;
    right?: false | SkykitXrRaySource | SkykitXrRaySourceOptions;
    head?: false | SkykitXrRaySource | SkykitXrRaySourceOptions;
  }} */ (rayOptions ?? {});
  const right = createCompositionRay(
    options.right,
    { id: `${id}:right-ray`, kind: 'target-ray', handedness: 'right' },
    ownedRays,
  );
  const left = createCompositionRay(
    options.left,
    { id: `${id}:left-ray`, kind: 'target-ray', handedness: 'left' },
    ownedRays,
  );
  const head = createCompositionRay(
    options.head,
    { id: `${id}:head-gaze`, kind: 'head-gaze', handedness: null },
    ownedRays,
  );
  if (right) rays.right = right;
  if (left) rays.left = left;
  if (head) rays.head = head;
  return rays;
}

/**
 * @param {false | SkykitXrRaySource | SkykitXrRaySourceOptions | undefined} input
 * @param {SkykitXrRaySourceOptions} defaults
 * @param {Set<SkykitXrRaySource>} ownedRays
 * @returns {SkykitXrRaySource | null}
 */
function createCompositionRay(input, defaults, ownedRays) {
  if (input === false) return null;
  if (isRaySource(input)) return input;
  const ray = createSkykitXrRaySource({
    ...defaults,
    ...(input && typeof input === 'object' ? input : {}),
  });
  ownedRays.add(ray);
  return ray;
}

/**
 * @param {unknown} value
 * @returns {value is SkykitXrRaySource}
 */
function isRaySource(value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    typeof /** @type {{ getRay?: unknown }} */ (value).getRay === 'function';
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

/**
 * @param {SkykitThreeFrame} frame
 * @returns {SkykitXrRayContext}
 */
function createRayContextFromFrame(frame) {
  const xr = /** @type {import('../index.d.ts').SkykitXrFrameState} */ (
    frame.xr ?? { presenting: false }
  );
  const session = xr.session && typeof xr.session === 'object'
    ? /** @type {{ inputSources?: Iterable<unknown> }} */ (xr.session)
    : null;
  return {
    frame: xr.frame,
    referenceSpace: xr.referenceSpace,
    session: /** @type {any} */ (xr.session),
    inputSources: session?.inputSources ?? [],
    rig: /** @type {any} */ (xr.rig),
    body: /** @type {any} */ (xr.body),
    rays: /** @type {any} */ (xr.rays),
    viewer: frame.viewer,
  };
}

/**
 * @param {SkykitProductKey | SkykitProductRef} input
 * @returns {SkykitProductKey}
 */
function productInputKey(input) {
  return isSkykitProductRef(input) ? input.key : String(input);
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function flattenProductHandles(value) {
  if (value == null) return [];
  if (isIterableObject(value)) return Array.from(value);
  return [value];
}

/**
 * @param {unknown} value
 * @returns {value is Iterable<unknown>}
 */
function isIterableObject(value) {
  return Boolean(value) &&
    typeof value !== 'string' &&
    typeof value !== 'function' &&
    typeof /** @type {{ [Symbol.iterator]?: unknown }} */ (value)[Symbol.iterator] === 'function';
}

/**
 * @template T
 * @param {T[]} list
 * @param {T} value
 */
function removeHandle(list, value) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
}

/**
 * @param {Map<string, unknown[]>} map
 */
function countProductHandles(map) {
  let count = 0;
  for (const values of map.values()) {
    count += values.length;
  }
  return count;
}
