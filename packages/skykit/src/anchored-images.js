import * as THREE from 'three';

import {
  icrsDirectionToTargetPc,
  loadAnchoredImageManifest,
  normalizeDirection,
  solveAnchoredImage,
  solveAnchoredImageMesh,
} from '@found-in-space/anchored-image';
import {
  createAnchoredImageMeshObject,
  disposeAnchoredImageObject,
} from '@found-in-space/anchored-image/three';
import { computeSpatialLookAtOrientation } from '@found-in-space/spatial';

import { createObject3dLayer } from './layers.js';

/**
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 * @typedef {import('./index.d.ts').QuaternionLike} QuaternionLike
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('./index.d.ts').SkykitThreeFrame} SkykitThreeFrame
 * @typedef {import('./index.d.ts').SkykitPluginContext} SkykitPluginContext
 * @typedef {import('./index.d.ts').AnchoredImageCatalog} AnchoredImageCatalog
 * @typedef {import('./index.d.ts').AnchoredImageCatalogEntry} AnchoredImageCatalogEntry
 * @typedef {import('./index.d.ts').AnchoredImageActiveEntry} AnchoredImageActiveEntry
 * @typedef {import('./index.d.ts').AnchoredImageSelection} AnchoredImageSelection
 * @typedef {import('./index.d.ts').AnchoredImageStyleState} AnchoredImageStyleState
 * @typedef {import('@found-in-space/anchored-image').AnchoredImage} AnchoredImage
 * @typedef {{ load(url: string, onLoad?: (texture: THREE.Texture) => void, onProgress?: unknown, onError?: (error: unknown) => void): unknown }} TextureLoaderLike
 * @typedef {{ object?: THREE.Object3D, promise?: Promise<THREE.Object3D | null> }} ObjectCacheRecord
 */

const DEFAULT_DISTANCE_PC = 60;
const DEFAULT_RADIUS = 8;
const DEFAULT_OPACITY = 0.22;
const DEFAULT_CUTOFF = 0.08;
const DEFAULT_SUBDIVISIONS = 1;
const DEFAULT_MAX_ACTIVE_IMAGES = 2;
const DEFAULT_ACTIVE_FADE_DEG = 8;
const ICRS_NORTH = Object.freeze({ x: 0, y: 0, z: 1 });
const LOCAL_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });

/**
 * @param {import('./index.d.ts').AnchoredImageCatalogOptions} [options]
 * @returns {Promise<import('./index.d.ts').AnchoredImageCatalog>}
 */
export async function createAnchoredImageCatalog(options = {}) {
  const manifest = await loadAnchoredImageManifest(options);
  /** @type {AnchoredImageCatalogEntry[]} */
  const entries = manifest.images
    .map((image) => createCatalogEntry(image))
    .filter(isCatalogEntry)
    .sort((left, right) => left.label.localeCompare(right.label));
  const lookup = new Map();

  for (const entry of entries) {
    for (const key of [entry.id, entry.groupId, entry.label]) {
      const lookupKey = normalizeLookupKey(key);
      if (lookupKey && !lookup.has(lookupKey)) lookup.set(lookupKey, entry);
    }
  }

  /** @type {AnchoredImageCatalog} */
  let catalog;
  catalog = {
    manifest,
    list() {
      return entries;
    },
    get(key) {
      const lookupKey = normalizeLookupKey(key);
      return lookupKey ? lookup.get(lookupKey) ?? null : null;
    },
    resolveTargetPc(key, targetOptions = {}) {
      const entry = catalog.get(key);
      if (!entry) return null;
      const distancePc = positiveFinite(targetOptions.distancePc, DEFAULT_DISTANCE_PC);
      return icrsDirectionToTargetPc(
        entry.centroidIcrs,
        distancePc,
        targetOptions.observerPc ?? { x: 0, y: 0, z: 0 },
      );
    },
    resolveLookAt(key, lookOptions = {}) {
      const entry = catalog.get(key);
      if (!entry) return null;
      const observerPc = normalizeVector3Like(lookOptions.observerPc, { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
      const targetPc = catalog.resolveTargetPc(entry.key, {
        observerPc,
        distancePc: lookOptions.distancePc,
      });
      if (!targetPc) return null;
      const upIcrs = normalizeVector3Like(lookOptions.upIcrs, entry.imageUpIcrs ?? ICRS_NORTH)
        ?? entry.imageUpIcrs
        ?? ICRS_NORTH;
      return {
        entry,
        targetPc,
        upIcrs,
        orientationIcrs: computeSpatialLookAtOrientation({
          position: observerPc,
          target: targetPc,
          up: upIcrs,
        }),
      };
    },
    resolveActive(directionIcrs, activeOptions = {}) {
      const direction = vector3FromArray(normalizeDirection(directionIcrs));
      if (!direction) return [];
      const selected = selectEntries(entries, activeOptions.selection, catalog);
      const fadeRad = degreesToRadians(nonNegativeFinite(activeOptions.fadeDeg, DEFAULT_ACTIVE_FADE_DEG));
      const maxImages = positiveInteger(activeOptions.maxImages, DEFAULT_MAX_ACTIVE_IMAGES);
      return selected
        .map((entry) => {
          const angleRad = angularDistance(direction, entry.centroidIcrs);
          const outsideRad = Math.max(0, angleRad - entry.boundsConeRadiusRad);
          const weight = outsideRad <= 0
            ? 1
            : fadeRad > 0
              ? Math.max(0, 1 - outsideRad / fadeRad)
              : 0;
          return { entry, key: entry.key, weight, angleRad, outsideRad };
        })
        .filter((entry) => entry.weight > 0)
        .sort((left, right) => (right.weight - left.weight) || (left.angleRad - right.angleRad))
        .slice(0, maxImages);
    },
  };

  return catalog;
}

/**
 * @param {import('./index.d.ts').AnchoredImageSkyPluginOptions} options
 * @returns {import('./index.d.ts').AnchoredImageSkyPlugin}
 */
export function createAnchoredImageSkyPlugin(options) {
  if (!options?.catalog) {
    throw new TypeError('createAnchoredImageSkyPlugin() requires options.catalog.');
  }

  const id = options.id ?? 'anchored-image-sky';
  const catalog = options.catalog;
  const root = new THREE.Group();
  root.name = id;
  /** @type {TextureLoaderLike} */
  const textureLoader = options.textureLoader ?? new THREE.TextureLoader();
  const loading = normalizeLoading(options.loading);
  const fixedAtInfinity = options.fixedAtInfinity !== false;
  const skipTextureErrors = options.skipTextureErrors === true;
  const onTextureError = typeof options.onTextureError === 'function' ? options.onTextureError : null;
  /** @type {Map<string, ObjectCacheRecord>} */
  const objectCache = new Map();
  /** @type {Map<string, AnchoredImageStyleState>} */
  const styleByKey = new Map();
  let mode = normalizeMode(options.mode);
  /** @type {AnchoredImageSelection | undefined} */
  let selection = options.selection;
  /** @type {AnchoredImageActiveEntry[]} */
  let latestActive = [];
  /** @type {SkykitPluginContext | null} */
  let context = null;
  let disposed = false;

  /** @type {import('./index.d.ts').AnchoredImageSkyPlugin} */
  const controller = {
    id,
    setup(pluginContext) {
      context = pluginContext;
      const layer = createObject3dLayer({
        id,
        priority: options.priority,
        object3d: root,
        anchorMode: fixedAtInfinity ? 'observer-centric' : 'world-space',
      });
      pluginContext.addPart({
        ...layer,
        update(frame) {
          void reconcile(frame.view, { awaitLoads: false });
        },
        dispose() {
          layer.dispose?.();
          disposeObjects();
        },
        getSnapshot() {
          return {
            id,
            mode,
            loading,
            fixedAtInfinity,
            selectedCount: selectedEntries().length,
            cachedCount: countCachedObjects(),
            active: latestActive.map((entry) => ({ key: entry.key, weight: entry.weight })),
          };
        },
      });

      return reconcile(pluginContext.getViewState(), {
        awaitLoads: loading === 'preload' || mode === 'all',
      });
    },
    setMode(nextMode) {
      mode = normalizeMode(nextMode);
      void reconcileLatest();
    },
    setSelection(nextSelection) {
      selection = nextSelection;
      void reconcileLatest();
    },
    getActive() {
      return latestActive;
    },
    getCatalog() {
      return catalog;
    },
    getSnapshot() {
      return {
        id,
        mode,
        loading,
        fixedAtInfinity,
        selectedCount: selectedEntries().length,
        cachedCount: countCachedObjects(),
        active: latestActive.map((entry) => ({ key: entry.key, weight: entry.weight })),
      };
    },
  };

  return controller;

  /** @returns {AnchoredImageCatalogEntry[]} */
  function selectedEntries() {
    return selectEntries(catalog.list(), selection, catalog);
  }

  /** @returns {Promise<void>} */
  async function reconcileLatest() {
    if (!context || disposed) return;
    await reconcile(context.getViewState(), {
      awaitLoads: loading === 'preload' || mode === 'all',
    });
  }

  /**
   * @param {SkykitViewState} view
   * @param {{ awaitLoads?: boolean }} [reconcileOptions]
   * @returns {Promise<void>}
   */
  async function reconcile(view, reconcileOptions = {}) {
    if (disposed) return;
    const selected = selectedEntries();
    const viewDirection = resolveViewDirection(view);
    const activeEnabled = options.active?.enabled ?? mode === 'view';
    latestActive = activeEnabled || mode === 'view'
      ? catalog.resolveActive(viewDirection, {
          selection,
          maxImages: options.active?.maxImages,
          fadeDeg: options.active?.fadeDeg,
        })
      : [];
    const activeByKey = new Map(latestActive.map((entry) => [entry.key, entry]));
    const visible = resolveVisibleEntries(selected, activeByKey);
    const visibleKeys = new Set(visible.map((entry) => entry.key));
    const shouldPreload = loading === 'preload' || mode === 'all';
    const entriesToLoad = shouldPreload ? selected : visible;

    updateStyleStates(selected, visibleKeys, activeByKey, activeEnabled);
    if (reconcileOptions.awaitLoads) {
      await Promise.all(entriesToLoad.map((entry) => ensureObject(entry)));
    } else {
      for (const entry of entriesToLoad) {
        void ensureObject(entry).catch(() => {});
      }
    }
    applyCachedStyles();
  }

  /**
   * @param {AnchoredImageCatalogEntry[]} selected
   * @param {Map<string, AnchoredImageActiveEntry>} activeByKey
   * @returns {AnchoredImageCatalogEntry[]}
   */
  function resolveVisibleEntries(selected, activeByKey) {
    if (mode === 'view') {
      return latestActive.map((entry) => entry.entry);
    }
    if (mode === 'fixed') {
      return selected;
    }
    return selected;
  }

  /**
   * @param {AnchoredImageCatalogEntry[]} selected
   * @param {Set<string>} visibleKeys
   * @param {Map<string, AnchoredImageActiveEntry>} activeByKey
   * @param {boolean} activeEnabled
   */
  function updateStyleStates(selected, visibleKeys, activeByKey, activeEnabled) {
    styleByKey.clear();
    const selectedKeys = new Set(selected.map((entry) => entry.key));
    for (const entry of selected) {
      const active = activeByKey.get(entry.key);
      const weight = active?.weight ?? 0;
      const visible = visibleKeys.has(entry.key);
      const opacity = resolveOpacity({ visible, weight, activeEnabled });
      styleByKey.set(entry.key, {
        entry,
        mode,
        active: Boolean(active && weight > 0),
        weight,
        visible,
        opacity,
      });
    }
    for (const key of objectCache.keys()) {
      if (!selectedKeys.has(key)) {
        const object = objectCache.get(key)?.object;
        styleByKey.set(key, {
          entry: object?.userData?.anchoredImageEntry ?? null,
          mode,
          active: false,
          weight: 0,
          visible: false,
          opacity: 0,
        });
      }
    }
  }

  /** @param {{ visible: boolean, weight: number, activeEnabled: boolean }} input */
  function resolveOpacity({ visible, weight, activeEnabled }) {
    if (!visible) return 0;
    const baseOpacity = finiteNumber(options.opacity, DEFAULT_OPACITY);
    const activeOpacity = finiteNumber(options.activeOpacity, baseOpacity);
    const inactiveOpacity = finiteNumber(options.inactiveOpacity, baseOpacity);
    if (mode === 'view') {
      return activeOpacity * Math.max(0, Math.min(1, weight));
    }
    if (mode === 'all' && activeEnabled) {
      return inactiveOpacity + (activeOpacity - inactiveOpacity) * Math.max(0, Math.min(1, weight));
    }
    return baseOpacity;
  }

  /**
   * @param {AnchoredImageCatalogEntry} entry
   * @returns {Promise<THREE.Object3D | null>}
   */
  async function ensureObject(entry) {
    const cached = objectCache.get(entry.key);
    if (cached?.object) return cached.object;
    if (cached?.promise) return cached.promise;

    const promise = createImageObject(entry)
      .then((object) => {
        if (!object) return null;
        object.userData.anchoredImageEntry = entry;
        objectCache.set(entry.key, { object });
        root.add(object);
        applyObjectStyle(entry.key, object);
        return object;
      })
      .catch((error) => {
        objectCache.delete(entry.key);
        onTextureError?.({ entry, image: entry.image, imageUrl: entry.image.image.src, error });
        if (skipTextureErrors) return null;
        throw error;
      });

    objectCache.set(entry.key, { promise });
    return promise;
  }

  /**
   * @param {AnchoredImageCatalogEntry} entry
   * @returns {Promise<THREE.Object3D | null>}
   */
  async function createImageObject(entry) {
    if (!entry.image.image.src) {
      throw new Error(`Anchored image "${entry.id}" has no image URL.`);
    }
    const texture = await loadTexture(textureLoader, entry.image.image.src);
    const mesh = solveAnchoredImageMesh(entry.image, {
      subdivisions: positiveInteger(options.subdivisions, DEFAULT_SUBDIVISIONS),
    });
    if (!mesh) return null;
    return createAnchoredImageMeshObject(mesh, {
      texture,
      index: Math.max(0, catalog.list().indexOf(entry)),
      radius: positiveFinite(options.radius, DEFAULT_RADIUS),
      opacity: finiteNumber(options.opacity, DEFAULT_OPACITY),
      cutoff: finiteNumber(options.cutoff, DEFAULT_CUTOFF),
      renderOrder: finiteNumber(options.renderOrder, -1),
      namePrefix: options.namePrefix ?? 'anchored-image-sky',
    });
  }

  function applyCachedStyles() {
    for (const [key, cached] of objectCache.entries()) {
      if (cached.object) applyObjectStyle(key, cached.object);
    }
  }

  /**
   * @param {string} key
   * @param {THREE.Object3D} object
   */
  function applyObjectStyle(key, object) {
    const state = styleByKey.get(key) ?? {
      entry: object.userData.anchoredImageEntry ?? null,
      mode,
      active: false,
      weight: 0,
      visible: false,
      opacity: 0,
    };
    object.visible = state.visible;
    setObjectOpacity(object, state.opacity);
    options.applyImageStyle?.(object, state);
  }

  function countCachedObjects() {
    let count = 0;
    for (const value of objectCache.values()) {
      if (value.object) count += 1;
    }
    return count;
  }

  function disposeObjects() {
    disposed = true;
    for (const cached of objectCache.values()) {
      if (cached.object) {
        cached.object.parent?.remove(cached.object);
        disposeAnchoredImageObject(cached.object);
      }
    }
    objectCache.clear();
    styleByKey.clear();
    root.clear();
  }
}

/**
 * @param {AnchoredImage} image
 * @returns {AnchoredImageCatalogEntry | null}
 */
function createCatalogEntry(image) {
  const solved = solveAnchoredImage(image);
  if (!solved || solved.targetKind !== 'direction') return null;
  const width = solved.image.image.width;
  const height = solved.image.image.height;
  const corners = [[0, 0], [width, 0], [width, height], [0, height]]
    .map(([x, y]) => targetDirectionAt(solved, x, y))
    .filter(isVector3);
  const anchorDirections = solved.image.image.anchors
    .slice(0, 3)
    .map((anchor) => vector3FromArray(normalizeDirection(anchor.target)))
    .filter(isVector3);
  const topCenter = targetDirectionAt(solved, width * 0.5, 0);
  const bottomCenter = targetDirectionAt(solved, width * 0.5, height);
  if (corners.length !== 4 || anchorDirections.length < 3 || !topCenter || !bottomCenter) {
    return null;
  }

  const centroid = normalizeVector3(sumVectors(anchorDirections));
  const imageUp = normalizeVector3(subtractVectors(topCenter, bottomCenter));
  if (!centroid || !imageUp) return null;
  const boundsConeRadiusRad = corners.reduce(
    (max, corner) => Math.max(max, angularDistance(centroid, corner)),
    0,
  );
  const id = solved.image.id;
  const groupId = solved.image.groupId ?? null;
  const label = solved.image.label ?? groupId ?? id;

  return {
    id,
    key: groupId ?? id,
    groupId,
    label,
    image: solved.image,
    centroidIcrs: centroid,
    imageUpIcrs: imageUp,
    cornersIcrs: corners,
    boundsConeRadiusRad,
    metadata: solved.image.metadata ?? {},
  };
}

/**
 * @param {import('@found-in-space/anchored-image').SolvedAnchoredImage} solved
 * @param {number} x
 * @param {number} y
 * @returns {Vector3Like | null}
 */
function targetDirectionAt(solved, x, y) {
  const target = solved.targetAt({ x, y });
  if (target?.kind !== 'direction') return null;
  return vector3FromArray(normalizeDirection(target));
}

/** @param {SkykitViewState} view @returns {Vector3Like} */
function resolveViewDirection(view) {
  const explicitDirection = normalizeVector3(view.directionIcrs, null);
  if (explicitDirection) return explicitDirection;
  const orientation = normalizeQuaternion(view.orientationIcrs);
  if (orientation) return normalizeVector3(rotateVectorByQuaternion(LOCAL_FORWARD, orientation), LOCAL_FORWARD) ?? { ...LOCAL_FORWARD };
  const targetPc = normalizeVector3(view.targetPc, null);
  const observerPc = normalizeVector3(view.observerPc, { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  if (targetPc) {
    const direction = normalizeVector3(subtractVectors(targetPc, observerPc), null);
    if (direction) return direction;
  }
  return { ...LOCAL_FORWARD };
}

/**
 * @param {AnchoredImageCatalogEntry[]} entries
 * @param {AnchoredImageSelection | undefined} selection
 * @param {AnchoredImageCatalog} catalog
 * @returns {AnchoredImageCatalogEntry[]}
 */
function selectEntries(entries, selection, catalog) {
  if (selection == null) return [...entries];
  if (typeof selection === 'function') {
    return entries.filter((entry) => selection(entry));
  }
  const values = Array.isArray(selection) ? selection : [selection];
  const selected = [];
  const seen = new Set();
  for (const value of values) {
    const entry = catalog.get(value);
    if (entry && !seen.has(entry.key)) {
      selected.push(entry);
      seen.add(entry.key);
    }
  }
  return selected;
}

/** @param {unknown} value @returns {'fixed' | 'view' | 'all'} */
function normalizeMode(value) {
  return value === 'fixed' || value === 'view' || value === 'all' ? value : 'all';
}

/** @param {unknown} value @returns {'preload' | 'lazy'} */
function normalizeLoading(value) {
  return value === 'lazy' ? 'lazy' : 'preload';
}

/**
 * @param {TextureLoaderLike} loader
 * @param {string} url
 * @returns {Promise<THREE.Texture>}
 */
function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

/** @param {THREE.Object3D} object @param {number} opacity */
function setObjectOpacity(object, opacity) {
  /** @param {THREE.Object3D} target */
  const apply = (target) => {
    const material = /** @type {THREE.Mesh} */ (target).material;
    if (Array.isArray(material)) {
      for (const item of material) setMaterialOpacity(item, opacity);
    } else {
      setMaterialOpacity(material, opacity);
    }
  };
  if (/** @type {THREE.Mesh} */ (object).isMesh) apply(object);
  object.traverse?.((child) => {
    if (child !== object && /** @type {THREE.Mesh} */ (child).isMesh) apply(child);
  });
}

/** @param {THREE.Material | undefined} material @param {number} opacity */
function setMaterialOpacity(material, opacity) {
  if (!material) return;
  if (material.uniforms?.opacity) {
    material.uniforms.opacity.value = opacity;
  }
  if ('opacity' in material) {
    material.opacity = opacity;
    material.transparent = true;
  }
}

/** @param {Vector3Like} vector @param {QuaternionLike} quaternion @returns {Vector3Like} */
function rotateVectorByQuaternion(vector, quaternion) {
  const x = vector.x;
  const y = vector.y;
  const z = vector.z;
  const qx = quaternion.x;
  const qy = quaternion.y;
  const qz = quaternion.z;
  const qw = quaternion.w;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  };
}

/** @param {Vector3Like} a @param {Vector3Like} b */
function angularDistance(a, b) {
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(dot);
}

/** @param {Vector3Like[]} vectors @returns {Vector3Like} */
function sumVectors(vectors) {
  return vectors.reduce(
    (sum, vector) => ({
      x: sum.x + vector.x,
      y: sum.y + vector.y,
      z: sum.z + vector.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
}

/** @param {Vector3Like} a @param {Vector3Like} b @returns {Vector3Like} */
function subtractVectors(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

/**
 * @param {unknown} value
 * @param {Vector3Like | null} [fallback]
 * @returns {Vector3Like | null}
 */
function normalizeVector3(value, fallback = null) {
  const vector = normalizeVector3Like(value, null);
  if (!vector) return fallback;
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : fallback;
}

/**
 * @param {unknown} value
 * @param {Vector3Like | null} [fallback]
 * @returns {Vector3Like | null}
 */
function normalizeVector3Like(value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback;
  const source = /** @type {{ x?: unknown, y?: unknown, z?: unknown }} */ (value);
  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : fallback;
}

/** @param {unknown} value @returns {Vector3Like | null} */
function vector3FromArray(value) {
  return Array.isArray(value) && value.length >= 3
    ? normalizeVector3Like({ x: value[0], y: value[1], z: value[2] })
    : normalizeVector3Like(value);
}

/** @param {unknown} value @returns {QuaternionLike | null} */
function normalizeQuaternion(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {{ x?: unknown, y?: unknown, z?: unknown, w?: unknown }} */ (value);
  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  const w = Number(source.w);
  if (![x, y, z, w].every(Number.isFinite)) return null;
  const length = Math.hypot(x, y, z, w);
  return length > 0 ? { x: x / length, y: y / length, z: z / length, w: w / length } : null;
}

/** @param {unknown} value @returns {string | null} */
function normalizeLookupKey(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

/** @param {number} degrees */
function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

/** @param {unknown} value @param {number} fallback */
function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function nonNegativeFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** @param {AnchoredImageCatalogEntry | null} entry @returns {entry is AnchoredImageCatalogEntry} */
function isCatalogEntry(entry) {
  return entry != null;
}

/** @param {Vector3Like | null} value @returns {value is Vector3Like} */
function isVector3(value) {
  return value != null;
}
