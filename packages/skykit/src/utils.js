import * as THREE from 'three';
import {
  resolveSpatialLookAt,
} from '@found-in-space/spatial';

export const DEFAULT_MAG_LIMIT = 6.5;
export const IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/**
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 * @typedef {import('./index.d.ts').QuaternionLike} QuaternionLike
 * @typedef {import('./index.d.ts').SkykitSceneRoots} SkykitSceneRoots
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 * @typedef {import('./index.d.ts').SkykitPluginInput} SkykitPluginInput
 * @typedef {import('./index.d.ts').SkykitThreePluginContext} SkykitThreePluginContext
 * @typedef {import('./index.d.ts').SkykitViewer} SkykitViewer
 * @typedef {import('./index.d.ts').SkykitViewerOptions} SkykitViewerOptions
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeViewPatch} StarOctreeViewPatch
 */

/**
 * @param {string} id
 * @param {SkykitViewerOptions['roots']} roots
 * @returns {SkykitSceneRoots}
 */
export function createSceneRoots(id, roots = {}) {
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
export function addRootToScene(scene, object) {
  if (!object.parent) {
    scene.add(object);
  }
}

/**
 * @param {SkykitSceneRoots} roots
 * @param {SkykitViewState} view
 */
export function syncRootsFromView(roots, view) {
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
 * @param {SkykitSceneRoots} roots
 * @param {import('./index.d.ts').SkykitLayerAnchorMode} anchorMode
 * @param {string} [scaleBandId]
 */
export function resolveAnchorRoot(roots, anchorMode, scaleBandId) {
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
 * @param {Partial<SkykitViewState>} input
 * @param {number} revision
 * @returns {SkykitViewState}
 */
export function normalizeViewState(input = {}, revision = 0, options = {}) {
  const observerPc = normalizeVector3(input.observerPc, { x: 0, y: 0, z: 0 });
  const coordinateUnitsPerParsec = positiveFinite(input.coordinateUnitsPerParsec, 1);
  const look = resolveViewLook(input, observerPc, options);
  return {
    revision,
    observerPc,
    renderObserverPosition: normalizeVector3(input.renderObserverPosition, observerPc),
    lookAt: look.lookAt,
    targetPc: look.targetPc,
    orientationIcrs: look.orientationIcrs,
    limitingMagnitude: finiteNumber(input.limitingMagnitude, DEFAULT_MAG_LIMIT),
    ...(input.verticalFovDeg !== undefined ? { verticalFovDeg: positiveFinite(input.verticalFovDeg, 40) } : {}),
    ...(input.aspectRatio !== undefined ? { aspectRatio: positiveFinite(input.aspectRatio, 1) } : {}),
    motion: input.motion ?? null,
    coordinateUnitsPerParsec,
  };
}

/** @param {SkykitViewState} view */
export function cloneViewState(view) {
  return {
    ...view,
    observerPc: cloneVector3(view.observerPc),
    renderObserverPosition: cloneVector3(view.renderObserverPosition),
    lookAt: cloneLookAt(view.lookAt),
    targetPc: view.targetPc ? cloneVector3(view.targetPc) : null,
    orientationIcrs: view.orientationIcrs ? cloneQuaternion(view.orientationIcrs) : null,
    motion: view.motion ? cloneMotion(view.motion) : null,
  };
}

/** @param {SkykitViewState} view */
export function toStarOctreeViewPatch(view) {
  /** @type {StarOctreeViewPatch} */
  const patch = {
    observerPc: view.observerPc,
    limitingMagnitude: view.limitingMagnitude,
    mDesired: view.limitingMagnitude,
    ...(view.targetPc ? { targetPc: view.targetPc } : {}),
    ...(view.orientationIcrs ? { orientationIcrs: view.orientationIcrs } : {}),
    ...(view.verticalFovDeg !== undefined ? { verticalFovDeg: view.verticalFovDeg } : {}),
    ...(view.aspectRatio !== undefined ? { aspectRatio: view.aspectRatio } : {}),
    ...(view.motion ? { motion: view.motion } : {}),
  };
  return patch;
}

/**
 * @param {Partial<SkykitViewState>} input
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<Partial<SkykitViewState>>}
 */
export async function resolveViewLookAtInput(input = {}, options = {}) {
  const observerPc = normalizeVector3(
    input.observerPc ?? /** @type {{ observerPc?: unknown }} */ (options).observerPc,
    { x: 0, y: 0, z: 0 },
  );
  const lookInput = input.lookAt
    ?? (input.orientationIcrs ? { orientationIcrs: input.orientationIcrs } : null);
  if (!lookInput) return input;
  const resolved = await resolveSpatialLookAt(lookInput, {
    observerPc,
    resolveStar: typeof options.resolveStar === 'function'
      ? /** @type {import('@found-in-space/spatial').ResolveSpatialLookAtOptions['resolveStar']} */ (options.resolveStar)
      : undefined,
    resolveBookmark: typeof options.resolveBookmark === 'function'
      ? /** @type {import('@found-in-space/spatial').ResolveSpatialLookAtOptions['resolveBookmark']} */ (options.resolveBookmark)
      : undefined,
  });
  const resolvedLook = /** @type {import('@found-in-space/spatial').SpatialResolvedLookAt} */ (resolved);
  return {
    ...input,
    lookAt: /** @type {import('./index.d.ts').SkykitLookAtInput | null} */ (resolvedLook.lookAt),
    targetPc: resolvedLook.targetPc,
    orientationIcrs: resolvedLook.orientationIcrs,
  };
}

/**
 * @param {Partial<SkykitViewState>} input
 * @param {Vector3Like} observerPc
 * @param {Record<string, unknown>} [options]
 * @returns {{ lookAt: import('./index.d.ts').SkykitLookAtInput | null; targetPc: Vector3Like | null; orientationIcrs: QuaternionLike | null }}
 */
function resolveViewLook(input, observerPc, options = {}) {
  const lookInput = input.lookAt
    ?? (input.orientationIcrs ? { orientationIcrs: input.orientationIcrs } : null);
  if (!lookInput) {
    return {
      lookAt: null,
      targetPc: null,
      orientationIcrs: null,
    };
  }
  const resolved = resolveSpatialLookAt(lookInput, {
    observerPc,
    resolveStar: typeof options.resolveStar === 'function'
      ? /** @type {import('@found-in-space/spatial').ResolveSpatialLookAtOptions['resolveStar']} */ (options.resolveStar)
      : undefined,
    resolveBookmark: typeof options.resolveBookmark === 'function'
      ? /** @type {import('@found-in-space/spatial').ResolveSpatialLookAtOptions['resolveBookmark']} */ (options.resolveBookmark)
      : undefined,
  });
  if (resolved && typeof /** @type {Promise<unknown>} */ (resolved).then === 'function') {
    throw new TypeError('normalizeViewState() received an async lookAt resolver result.');
  }
  const resolvedLook = /** @type {import('@found-in-space/spatial').SpatialResolvedLookAt} */ (resolved);
  return {
    lookAt: /** @type {import('./index.d.ts').SkykitLookAtInput | null} */ (cloneLookAt(resolvedLook.lookAt)),
    targetPc: resolvedLook.targetPc
      ? cloneVector3(resolvedLook.targetPc)
      : (input.targetPc == null ? null : normalizeVector3(input.targetPc, { x: 0, y: 0, z: 0 })),
    orientationIcrs: resolvedLook.orientationIcrs ? cloneQuaternion(resolvedLook.orientationIcrs) : null,
  };
}

/**
 * @param {unknown} lookAt
 * @returns {import('./index.d.ts').SkykitLookAtInput | null}
 */
function cloneLookAt(lookAt) {
  if (!lookAt || typeof lookAt !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (lookAt);
  return {
    ...source,
    ...(source.targetPc && typeof source.targetPc === 'object'
      ? { targetPc: cloneVector3(/** @type {Vector3Like} */ (source.targetPc)) }
      : {}),
    ...(source.orientationIcrs && typeof source.orientationIcrs === 'object'
      ? { orientationIcrs: cloneQuaternion(/** @type {QuaternionLike} */ (source.orientationIcrs)) }
      : {}),
  };
}

/**
 * @param {SkykitPluginInput} plugin
 * @param {SkykitThreePluginContext} context
 */
export async function setupPlugin(plugin, context) {
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
export async function attachPart(part, context) {
  await part.attach?.(context);
}

/**
 * @param {SkykitThreePart} part
 * @param {SkykitThreePluginContext} context
 */
export async function startPart(part, context) {
  await part.start?.(context);
}

/** @param {SkykitThreePart} part */
export async function detachAndDisposePart(part) {
  await part.detach?.();
  await part.dispose?.();
}

/** @param {SkykitThreePart} a @param {SkykitThreePart} b */
export function compareParts(a, b) {
  return (a.priority ?? 0) - (b.priority ?? 0);
}

/**
 * @param {SkykitThreePart} part
 */
export function snapshotPart(part) {
  return {
    id: part.id ?? null,
    priority: part.priority ?? 0,
    snapshot: part.getSnapshot?.() ?? null,
  };
}

/**
 * @param {unknown} value
 * @returns {value is StarOctreeProviderSession}
 */
export function isProviderSession(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof /** @type {{ updateView?: unknown }} */ (value).updateView === 'function'
      && typeof /** @type {{ subscribe?: unknown }} */ (value).subscribe === 'function',
  );
}

export function createNoopRenderer() {
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
export function mountRenderer(host, renderer, autoMount) {
  if (!host || !autoMount || !renderer?.domElement || typeof host.appendChild !== 'function') return;
  host.appendChild(renderer.domElement);
}

/** @param {unknown} value */
export async function disposeMaybe(value) {
  if (value && typeof value === 'object' && typeof /** @type {{ dispose?: unknown }} */ (value).dispose === 'function') {
    await /** @type {{ dispose: () => void | Promise<void> }} */ (value).dispose();
  }
}

/**
 * @param {THREE.Object3D} object
 */
export function disposeObjectTree(object) {
  object.traverse?.((/** @type {THREE.Object3D} */ child) => {
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
export function parsePointArgs(pointOrX, yOrTarget, z, target) {
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
export function normalizeVector3(value, fallback) {
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
export function normalizeQuaternion(value, fallback) {
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
export function cloneVector3(value) {
  return { x: value.x, y: value.y, z: value.z };
}

/** @param {QuaternionLike} value */
export function cloneQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

/** @param {import('./index.d.ts').SkykitObserverMotion} motion */
export function cloneMotion(motion) {
  return {
    velocityPcPerSec: cloneVector3(motion.velocityPcPerSec),
    speedPcPerSec: motion.speedPcPerSec,
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {string} name */
export function namedGroup(name) {
  const group = new THREE.Group();
  group.name = name;
  return group;
}
