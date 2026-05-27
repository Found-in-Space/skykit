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
 * @typedef {import('./index.d.ts').AnchoredImageMatch} AnchoredImageMatch
 * @typedef {import('./index.d.ts').AnchoredImageController} AnchoredImageController
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
const DEFAULT_FADE_SECONDS = 0.4;
const DEFAULT_HYSTERESIS_SECONDS = 0.2;
const EPSILON = 1e-4;
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
    resolveNearest(lookDirection, nearestOptions = {}) {
      const matches = scoreEntries(lookDirection, selectEntries(entries, nearestOptions.selection, catalog));
      if (matches.length === 0) return null;
      const maxAngleRad = optionalAngleRad(nearestOptions.maxAngleDeg);
      return matches.find((match) => maxAngleRad == null || match.viewDistanceRad <= maxAngleRad) ?? null;
    },
    resolveWithinAngle(lookDirection, withinOptions) {
      const maxAngleRad = requiredAngleRad(withinOptions?.maxAngleDeg);
      if (!Number.isFinite(maxAngleRad)) return [];
      return scoreEntries(lookDirection, selectEntries(entries, withinOptions?.selection, catalog))
        .filter((match) => match.viewDistanceRad <= maxAngleRad);
    },
  };

  return catalog;
}

/**
 * @param {import('./index.d.ts').ManualAnchoredImageControllerOptions} [options]
 * @returns {import('./index.d.ts').AnchoredImageController}
 */
export function createManualAnchoredImageController(options = {}) {
  /** @type {AnchoredImageSelection | undefined} */
  let selection = options.selection;
  /** @type {AnchoredImageMatch[]} */
  let latestActive = [];

  return {
    update(input) {
      latestActive = selectEntries(input.catalog.list(), selection, input.catalog)
        .map((entry) => scoreEntry(input.viewDirectionIcrs, entry))
        .filter(isMatch);
      return latestActive;
    },
    setSelection(nextSelection) {
      selection = nextSelection;
      latestActive = [];
    },
    getSelection() {
      return selection;
    },
    getSnapshot() {
      return {
        type: 'manual',
        selection: snapshotSelection(selection),
        active: latestActive.map(snapshotMatch),
      };
    },
  };
}

/**
 * @param {import('./index.d.ts').ViewAnchoredImageControllerOptions} [options]
 * @returns {import('./index.d.ts').AnchoredImageController}
 */
export function createViewAnchoredImageController(options = {}) {
  const strategy = options.strategy === 'within-angle' ? 'within-angle' : 'nearest';
  /** @type {AnchoredImageSelection | undefined} */
  let selection = options.selection;
  const maxAngleDeg = options.maxAngleDeg;
  const hysteresisSeconds = nonNegativeFinite(options.hysteresisSeconds, DEFAULT_HYSTERESIS_SECONDS);
  /** @type {string | null} */
  let committedKey = null;
  /** @type {string | null} */
  let candidateKey = null;
  let candidateHeldSeconds = 0;
  /** @type {AnchoredImageMatch | null} */
  let latestCandidate = null;
  /** @type {AnchoredImageMatch[]} */
  let latestActive = [];

  return {
    update(input) {
      if (strategy === 'within-angle') {
        latestActive = input.catalog.resolveWithinAngle(input.viewDirectionIcrs, {
          selection,
          maxAngleDeg: Number(maxAngleDeg),
        });
        latestCandidate = latestActive[0] ?? null;
        committedKey = null;
        candidateKey = null;
        candidateHeldSeconds = 0;
        return latestActive;
      }

      const resolved = input.catalog.resolveNearest(input.viewDirectionIcrs, {
        selection,
        maxAngleDeg,
      });
      latestCandidate = resolved;
      const resolvedKey = resolved?.key ?? null;

      if (!committedKey) {
        commit(resolvedKey);
      } else if (resolvedKey === committedKey) {
        candidateKey = null;
        candidateHeldSeconds = 0;
      } else if (hysteresisSeconds === 0) {
        commit(resolvedKey);
      } else {
        const deltaSeconds = Math.max(0, finiteNumber(input.deltaSeconds, 0));
        if (candidateKey !== resolvedKey) {
          candidateKey = resolvedKey;
          candidateHeldSeconds = deltaSeconds;
        } else {
          candidateHeldSeconds += deltaSeconds;
        }
        if (candidateHeldSeconds >= hysteresisSeconds) {
          commit(resolvedKey);
        }
      }

      latestActive = committedKey
        ? [scoreEntry(input.viewDirectionIcrs, input.catalog.get(committedKey))].filter(isMatch)
        : [];
      return latestActive;
    },
    setSelection(nextSelection) {
      selection = nextSelection;
      committedKey = null;
      candidateKey = null;
      candidateHeldSeconds = 0;
      latestCandidate = null;
      latestActive = [];
    },
    getSelection() {
      return selection;
    },
    getSnapshot() {
      return {
        type: 'view',
        strategy,
        selection: snapshotSelection(selection),
        maxAngleDeg: maxAngleDeg ?? null,
        hysteresisSeconds,
        committedKey,
        candidateKey,
        candidateHeldSeconds,
        candidate: latestCandidate ? snapshotMatch(latestCandidate) : null,
        active: latestActive.map(snapshotMatch),
      };
    },
  };

  /** @param {string | null} nextKey */
  function commit(nextKey) {
    committedKey = nextKey;
    candidateKey = null;
    candidateHeldSeconds = 0;
  }
}

/**
 * @param {import('./index.d.ts').AnchoredImageSkyPluginOptions} options
 * @returns {import('./index.d.ts').AnchoredImageSkyPlugin}
 */
export function createAnchoredImageSkyPlugin(options) {
  if (!options?.catalog) {
    throw new TypeError('createAnchoredImageSkyPlugin() requires options.catalog.');
  }
  if (!options.controller) {
    throw new TypeError('createAnchoredImageSkyPlugin() requires options.controller.');
  }

  const id = options.id ?? 'anchored-image-sky';
  const catalog = options.catalog;
  const imageController = options.controller;
  const root = new THREE.Group();
  root.name = id;
  /** @type {TextureLoaderLike} */
  const textureLoader = options.textureLoader ?? new THREE.TextureLoader();
  const loading = normalizeLoading(options.loading);
  const fixedAtInfinity = options.fixedAtInfinity !== false;
  const skipTextureErrors = options.skipTextureErrors === true;
  const onTextureError = typeof options.onTextureError === 'function' ? options.onTextureError : null;
  const baseOpacity = finiteNumber(options.opacity, DEFAULT_OPACITY);
  const fadeInSeconds = nonNegativeFinite(options.fadeInSeconds, DEFAULT_FADE_SECONDS);
  const fadeOutSeconds = nonNegativeFinite(options.fadeOutSeconds, DEFAULT_FADE_SECONDS);
  /** @type {Map<string, ObjectCacheRecord>} */
  const objectCache = new Map();
  /** @type {Map<string, AnchoredImageStyleState>} */
  const styleByKey = new Map();
  /** @type {Map<string, number>} */
  const opacityByKey = new Map();
  /** @type {Set<string>} */
  let targetKeys = new Set();
  /** @type {AnchoredImageMatch[]} */
  let latestActive = [];
  /** @type {SkykitPluginContext | null} */
  let context = null;
  let disposed = false;

  /** @type {import('./index.d.ts').AnchoredImageSkyPlugin} */
  const plugin = {
    id,
    setup(pluginContext) {
      context = pluginContext;
      const layer = createObject3dLayer({
        id,
        priority: options.priority,
        object3d: root,
        anchorMode: options.anchorMode ?? (fixedAtInfinity ? 'observer-centric' : 'world-space'),
        scaleBandId: options.scaleBandId,
      });
      pluginContext.addPart({
        ...layer,
        update(frame) {
          void reconcileFrame(frame, { awaitLoads: false });
        },
        dispose() {
          layer.dispose?.();
          disposeObjects();
        },
        getSnapshot() {
          return createSnapshot();
        },
      });

      return reconcileView(pluginContext.getViewState(), {
        deltaSeconds: 0,
        elapsedSeconds: 0,
        awaitLoads: loading === 'preload',
      });
    },
    getActive() {
      return latestActive;
    },
    getCatalog() {
      return catalog;
    },
    getSnapshot() {
      return createSnapshot();
    },
  };

  return plugin;

  /**
   * @param {SkykitThreeFrame} frame
   * @param {{ awaitLoads?: boolean }} [reconcileOptions]
   * @returns {Promise<void>}
   */
  function reconcileFrame(frame, reconcileOptions = {}) {
    return reconcileView(frame.view, {
      deltaSeconds: frame.deltaSeconds,
      elapsedSeconds: frame.elapsedSeconds,
      awaitLoads: reconcileOptions.awaitLoads,
    });
  }

  /**
   * @param {SkykitViewState} view
   * @param {{ deltaSeconds?: number, elapsedSeconds?: number, awaitLoads?: boolean }} [reconcileOptions]
   * @returns {Promise<void>}
   */
  async function reconcileView(view, reconcileOptions = {}) {
    if (disposed) return;
    const viewDirectionIcrs = resolveViewDirection(view);
    latestActive = normalizeControllerMatches(imageController.update({
      catalog,
      view,
      viewDirectionIcrs,
      deltaSeconds: Math.max(0, finiteNumber(reconcileOptions.deltaSeconds, 0)),
      elapsedSeconds: Math.max(0, finiteNumber(reconcileOptions.elapsedSeconds, 0)),
    }), viewDirectionIcrs);
    targetKeys = new Set(latestActive.map((entry) => entry.key));

    updateStyleStates(Math.max(0, finiteNumber(reconcileOptions.deltaSeconds, 0)));
    const entriesToLoad = entriesForLoad();
    if (reconcileOptions.awaitLoads) {
      await Promise.all(entriesToLoad.map((entry) => ensureObject(entry)));
    } else {
      for (const entry of entriesToLoad) {
        void ensureObject(entry).catch(() => {});
      }
    }
    applyCachedStyles();
  }

  /** @param {AnchoredImageMatch[]} matches @param {Vector3Like} viewDirectionIcrs */
  function normalizeControllerMatches(matches, viewDirectionIcrs) {
    if (!Array.isArray(matches)) return [];
    /** @type {AnchoredImageMatch[]} */
    const normalized = [];
    const seen = new Set();
    for (const match of matches) {
      const candidate = /** @type {Partial<AnchoredImageMatch> | null | undefined} */ (match);
      const entry = candidate?.entry ?? (candidate?.key ? catalog.get(candidate.key) : null);
      if (!entry || seen.has(entry.key)) continue;
      const scored = scoreEntry(viewDirectionIcrs, entry);
      if (!scored) continue;
      normalized.push({
        entry,
        key: entry.key,
        angleRad: finiteNumber(candidate?.angleRad, scored.angleRad),
        viewDistanceRad: finiteNumber(candidate?.viewDistanceRad, scored.viewDistanceRad),
      });
      seen.add(entry.key);
    }
    return normalized;
  }

  /** @returns {AnchoredImageCatalogEntry[]} */
  function entriesForLoad() {
    const entries = [];
    const seen = new Set();
    if (loading === 'preload') {
      for (const entry of preloadEntries()) {
        if (!seen.has(entry.key)) {
          entries.push(entry);
          seen.add(entry.key);
        }
      }
    }
    for (const match of latestActive) {
      if (!seen.has(match.key)) {
        entries.push(match.entry);
        seen.add(match.key);
      }
    }
    return entries;
  }

  /** @returns {AnchoredImageCatalogEntry[]} */
  function preloadEntries() {
    const selection = typeof imageController.getSelection === 'function'
      ? imageController.getSelection()
      : undefined;
    return selectEntries(catalog.list(), selection, catalog);
  }

  /** @param {number} deltaSeconds */
  function updateStyleStates(deltaSeconds) {
    const keys = new Set([...targetKeys, ...opacityByKey.keys(), ...objectCache.keys()]);
    styleByKey.clear();
    for (const key of keys) {
      const object = objectCache.get(key)?.object;
      const entry = catalog.get(key) ?? object?.userData?.anchoredImageEntry ?? null;
      const targetOpacity = targetKeys.has(key) ? baseOpacity : 0;
      const currentOpacity = opacityByKey.get(key) ?? 0;
      const opacity = approachOpacity(currentOpacity, targetOpacity, deltaSeconds);
      if (opacity > EPSILON || targetOpacity > 0 || objectCache.has(key)) {
        opacityByKey.set(key, opacity);
      } else {
        opacityByKey.delete(key);
      }
      const active = targetOpacity > 0;
      const visible = active || opacity > EPSILON;
      styleByKey.set(key, {
        entry,
        active,
        visible,
        opacity,
        targetOpacity,
      });
    }
  }

  /** @param {number} current @param {number} target @param {number} deltaSeconds */
  function approachOpacity(current, target, deltaSeconds) {
    if (current === target) return target;
    const duration = target > current ? fadeInSeconds : fadeOutSeconds;
    if (duration <= 0) return target;
    const step = baseOpacity * Math.max(0, deltaSeconds) / duration;
    if (Math.abs(target - current) <= step) return target;
    return current + Math.sign(target - current) * step;
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
      opacity: baseOpacity,
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
      active: false,
      visible: false,
      opacity: 0,
      targetOpacity: 0,
    };
    object.visible = state.visible;
    setObjectOpacity(object, state.opacity);
    options.applyImageStyle?.(object, state);
  }

  function createSnapshot() {
    return {
      id,
      loading,
      fixedAtInfinity,
      fadeInSeconds,
      fadeOutSeconds,
      cachedCount: countCachedObjects(),
      controller: imageController.getSnapshot?.() ?? null,
      active: latestActive.map(snapshotMatch),
      visible: visibleKeys(),
      fading: fadingKeys(),
    };
  }

  function visibleKeys() {
    return [...styleByKey.entries()]
      .filter(([, state]) => state.visible)
      .map(([key]) => key);
  }

  function fadingKeys() {
    return [...styleByKey.entries()]
      .filter(([, state]) => Math.abs(state.targetOpacity - state.opacity) > EPSILON)
      .map(([key]) => key);
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
    opacityByKey.clear();
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
  const targetPc = normalizeVector3(view.targetPc, null);
  const observerPc = normalizeVector3(view.observerPc, { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  if (targetPc) {
    const direction = normalizeVector3(subtractVectors(targetPc, observerPc), null);
    if (direction) return direction;
  }
  const orientation = normalizeQuaternion(view.orientationIcrs);
  if (orientation) return normalizeVector3(rotateVectorByQuaternion(LOCAL_FORWARD, orientation), LOCAL_FORWARD) ?? { ...LOCAL_FORWARD };
  return { ...LOCAL_FORWARD };
}

/**
 * @param {Vector3Like | [number, number, number]} lookDirection
 * @param {AnchoredImageCatalogEntry[]} entries
 * @returns {AnchoredImageMatch[]}
 */
function scoreEntries(lookDirection, entries) {
  const direction = vector3FromArray(normalizeDirection(lookDirection));
  if (!direction) return [];
  return entries
    .map((entry) => scoreEntry(direction, entry))
    .filter(isMatch)
    .sort(compareMatches);
}

/**
 * @param {Vector3Like | [number, number, number]} lookDirection
 * @param {AnchoredImageCatalogEntry | null | undefined} entry
 * @returns {AnchoredImageMatch | null}
 */
function scoreEntry(lookDirection, entry) {
  if (!entry) return null;
  const direction = vector3FromArray(normalizeDirection(lookDirection));
  if (!direction) return null;
  const angleRad = angularDistance(direction, entry.centroidIcrs);
  const viewDistanceRad = Math.max(0, angleRad - entry.boundsConeRadiusRad);
  return { entry, key: entry.key, angleRad, viewDistanceRad };
}

/**
 * @param {AnchoredImageMatch} left
 * @param {AnchoredImageMatch} right
 */
function compareMatches(left, right) {
  return (left.viewDistanceRad - right.viewDistanceRad) || (left.angleRad - right.angleRad);
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

/** @param {unknown} value @returns {number | null} */
function optionalAngleRad(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? degreesToRadians(number) : null;
}

/** @param {unknown} value @returns {number} */
function requiredAngleRad(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? degreesToRadians(number) : Number.NaN;
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

/** @param {AnchoredImageSelection | undefined} selection */
function snapshotSelection(selection) {
  if (typeof selection === 'function') return '[function]';
  return selection ?? null;
}

/** @param {AnchoredImageMatch} match */
function snapshotMatch(match) {
  return {
    key: match.key,
    angleRad: match.angleRad,
    viewDistanceRad: match.viewDistanceRad,
  };
}

/** @param {AnchoredImageCatalogEntry | null} entry @returns {entry is AnchoredImageCatalogEntry} */
function isCatalogEntry(entry) {
  return entry != null;
}

/** @param {Vector3Like | null} value @returns {value is Vector3Like} */
function isVector3(value) {
  return value != null;
}

/** @param {AnchoredImageMatch | null} match @returns {match is AnchoredImageMatch} */
function isMatch(match) {
  return match != null;
}
