import * as THREE from 'three';

import { raDecToIcrsDirection } from '@found-in-space/spatial';

import {
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createViewAnchoredImageController,
} from './anchored-images.js';
import { createSkykitLayerHostPlugin } from './layer-host.js';

/**
 * @typedef {import('./index.d.ts').AnchoredImageCatalog} AnchoredImageCatalog
 * @typedef {import('./index.d.ts').AnchoredImageSkyPlugin} AnchoredImageSkyPlugin
 * @typedef {import('./index.d.ts').SkykitConstellationArtMode} SkykitConstellationArtMode
 * @typedef {import('./index.d.ts').SkykitConstellationArtOptions} SkykitConstellationArtOptions
 * @typedef {import('./index.d.ts').SkykitConstellationLayer} SkykitConstellationLayer
 * @typedef {import('./index.d.ts').SkykitConstellationLayerOptions} SkykitConstellationLayerOptions
 * @typedef {import('./index.d.ts').SkykitFeatureCollection} SkykitFeatureCollection
 * @typedef {import('./index.d.ts').SkykitLayerContext} SkykitLayerContext
 * @typedef {import('./index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('./index.d.ts').SkykitPluginTeardown} SkykitPluginTeardown
 * @typedef {import('./index.d.ts').SkykitSpatialFeature} SkykitSpatialFeature
 * @typedef {import('./index.d.ts').SkykitWaypoint} SkykitWaypoint
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

const DEFAULT_BOUNDARY_RADIUS = 8;
const DEFAULT_BOUNDARY_COLOR = 0x7aa7ff;
const DEFAULT_BOUNDARY_OPACITY = 0.35;
const DEFAULT_BOUNDARY_RENDER_ORDER = -2;
const DEFAULT_ART_OPACITY = 0.22;
const DEFAULT_ART_MAX_ANGLE_DEG = 60;
const DEFAULT_TARGET_DISTANCE_PC = 60;

/**
 * @param {SkykitConstellationLayerOptions} options
 * @returns {SkykitConstellationLayer}
 */
export function createSkykitConstellationLayer(options) {
  if (!options?.manifest || typeof options.manifest !== 'object') {
    throw new TypeError('createSkykitConstellationLayer() requires manifest.');
  }

  const manifest = options.manifest;
  const datasetId = datasetIdForManifest(manifest, options.id);
  const id = options.id ?? `constellations:${datasetId}`;
  const publish = options.publish === false ? null : options.publish ?? null;
  /** @type {SkykitLayerContext | null} */
  let context = null;
  /** @type {THREE.Object3D | null} */
  let boundaryRoot = null;
  /** @type {AnchoredImageCatalog | null} */
  let artCatalog = null;
  /** @type {AnchoredImageSkyPlugin | null} */
  let artPlugin = null;
  /** @type {SkykitPluginTeardown | null} */
  let artTeardown = null;
  /** @type {SkykitPluginTeardown | null} */
  let catalogTeardown = null;
  let visible = options.visible !== false;
  /** @type {false | SkykitConstellationArtOptions} */
  let desiredArt = normalizeArtOptions(options.art);

  /** @type {SkykitConstellationLayer} */
  const layer = {
    id,
    priority: options.priority,
    async setup(ctx) {
      context = ctx;
      if (options.boundary !== false) {
        boundaryRoot = createConstellationBoundaryObject(manifest, options);
        boundaryRoot.visible = visible;
        ctx.addObject3D(boundaryRoot, {
          anchorMode: 'observer-centric',
          disposeObject: true,
        });
      }

      if (publish?.features) {
        ctx.provideProduct(
          publish.features,
          createConstellationFeatureCollection(manifest, {
            layerId: id,
            datasetId,
            label: labelForManifest(manifest, datasetId),
          }),
          productMetadata('features', id, publish.metadata),
        );
      }

      if (publish?.waypoints) {
        ctx.provideProduct(
          publish.waypoints,
          createConstellationWaypoints(manifest, {
            layerId: id,
            distancePc: DEFAULT_TARGET_DISTANCE_PC,
          }),
          productMetadata('waypoints', id, publish.metadata),
        );
      }

      if (desiredArt) {
        await installArt(desiredArt);
      }
    },
    show() {
      visible = true;
      syncVisibility();
      return visible;
    },
    hide() {
      visible = false;
      syncVisibility();
      return visible;
    },
    toggle(force) {
      visible = typeof force === 'boolean' ? force : !visible;
      syncVisibility();
      return visible;
    },
    async setArt(input) {
      desiredArt = normalizeArtOptions(input);
      if (!context) return artMode(desiredArt);
      if (!desiredArt) {
        removeArt();
        return 'off';
      }
      await installArt(desiredArt, { replace: true });
      return artMode(desiredArt);
    },
    dispose() {
      removeArt();
      boundaryRoot = null;
      context = null;
    },
    getSnapshot() {
      return {
        id,
        visible,
        manifestId: datasetId,
        lineCount: boundaryRoot?.userData.lineCount ?? 0,
        art: artPlugin ? artMode(desiredArt) : 'off',
        artCatalogCount: artCatalog?.list().length ?? 0,
        artPlugin: artPlugin?.getSnapshot?.() ?? null,
      };
    },
  };

  return layer;

  /**
   * @param {SkykitConstellationArtOptions} artOptions
   * @param {{ replace?: boolean }} [installOptions]
   */
  async function installArt(artOptions, installOptions = {}) {
    if (!context) return;
    if (artPlugin && !installOptions.replace) {
      syncVisibility();
      return;
    }
    removeArt();
    artCatalog ??= await createAnchoredImageCatalog({
      manifest: toAnchoredImageManifest(manifest, options.assetBaseUrl),
    });
    if (publish?.catalog) {
      catalogTeardown = context.provideProduct(
        publish.catalog,
        artCatalog,
        productMetadata('surface', id, publish.metadata),
      );
    }
    artPlugin = createAnchoredImageSkyPlugin({
      id: `${id}:art`,
      catalog: artCatalog,
      controller: createViewAnchoredImageController({
        strategy: 'nearest',
        maxAngleDeg: finiteNumber(artOptions.maxAngleDeg, DEFAULT_ART_MAX_ANGLE_DEG),
      }),
      loading: artOptions.loading ?? 'lazy',
      opacity: finiteNumber(artOptions.opacity, DEFAULT_ART_OPACITY),
      skipTextureErrors: artOptions.skipTextureErrors !== false,
    });
    const teardown = await artPlugin.setup(context);
    artTeardown = typeof teardown === 'function' ? teardown : null;
    syncVisibility();
  }

  function removeArt() {
    artTeardown?.();
    catalogTeardown?.();
    artTeardown = null;
    catalogTeardown = null;
    artPlugin = null;
  }

  function syncVisibility() {
    if (boundaryRoot) boundaryRoot.visible = visible;
    if (!context) return;
    const artRoot = context.roots.observerContentRoot.children.find((child) => child.name === `${id}:art`);
    if (artRoot) artRoot.visible = visible;
  }
}

/**
 * @param {SkykitConstellationLayerOptions} options
 * @returns {SkykitPlugin & { getLayer(): SkykitConstellationLayer; getSnapshot(): unknown }}
 */
export function createSkykitConstellationPlugin(options) {
  const layer = createSkykitConstellationLayer(options);
  const host = createSkykitLayerHostPlugin({
    id: `${layer.id ?? 'constellations'}:host`,
    layers: [layer],
  });
  return {
    id: options.id ?? 'skykit-constellations',
    setup(context) {
      return host.setup(context);
    },
    getLayer() {
      return layer;
    },
    getSnapshot() {
      return layer.getSnapshot();
    },
  };
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {SkykitConstellationLayerOptions} options
 */
export function createConstellationBoundaryObject(manifest, options) {
  const root = new THREE.Group();
  root.name = 'constellation-boundaries';
  const boundaryOptions = options.boundary && typeof options.boundary === 'object' ? options.boundary : {};
  const radius = finiteNumber(
    'boundaryRadius' in options ? /** @type {{ boundaryRadius?: unknown }} */ (options).boundaryRadius : boundaryOptions.radius,
    DEFAULT_BOUNDARY_RADIUS,
  );
  const positions = boundaryPositions(manifest, radius);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const color = boundaryOptions.color
    ?? colorFromUnknown(/** @type {{ boundaryColor?: unknown }} */ (options).boundaryColor)
    ?? DEFAULT_BOUNDARY_COLOR;
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: finiteNumber(
      'boundaryOpacity' in options ? /** @type {{ boundaryOpacity?: unknown }} */ (options).boundaryOpacity : boundaryOptions.opacity,
      DEFAULT_BOUNDARY_OPACITY,
    ),
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'constellation-boundary-lines';
  lines.renderOrder = finiteNumber(
    'renderOrder' in options ? /** @type {{ renderOrder?: unknown }} */ (options).renderOrder : boundaryOptions.renderOrder,
    DEFAULT_BOUNDARY_RENDER_ORDER,
  );
  root.add(lines);
  root.userData.lineCount = positions.length / 6;
  return root;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {{ layerId: string; datasetId: string; label: string }} options
 * @returns {SkykitFeatureCollection}
 */
export function createConstellationFeatureCollection(manifest, options) {
  /** @type {SkykitSpatialFeature[]} */
  const features = [];
  const constellations = Array.isArray(manifest.constellations) ? manifest.constellations : [];
  constellations.forEach((input, index) => {
    const constellation = recordFromUnknown(input);
    const id = constellationId(constellation, index);
    const direction = constellationDirection(constellation);
    features.push({
      id,
      layerId: options.layerId,
      kind: 'constellation',
      label: resolveConstellationLabel(constellation),
      frame: 'observer-sky',
      ...(direction ? { position: direction, target: targetFromDirection(direction, DEFAULT_TARGET_DISTANCE_PC) } : {}),
      metadata: {
        iau: constellation.iau ?? null,
        sourceConstellationId: constellation.id ?? null,
        common_name: constellation.common_name ?? null,
      },
    });
  });

  boundaryEdges(manifest).forEach((edge, index) => {
    const midpoint = normalizeVector({
      x: edge.start.x + edge.end.x,
      y: edge.start.y + edge.end.y,
      z: edge.start.z + edge.end.z,
    });
    features.push({
      id: `boundary-${index + 1}`,
      layerId: options.layerId,
      kind: 'constellation-boundary',
      label: 'Constellation boundary',
      frame: 'observer-sky',
      ...(midpoint ? { position: midpoint, target: targetFromDirection(midpoint, DEFAULT_TARGET_DISTANCE_PC) } : {}),
      metadata: {
        startIcrs: edge.start,
        endIcrs: edge.end,
        sourceEdge: edge.source,
      },
    });
  });

  return {
    type: 'FeatureCollection',
    features,
    metadata: {
      datasetId: options.datasetId,
      label: options.label,
      layerKind: 'constellations',
      source: manifest.source ?? manifest.format ?? null,
    },
  };
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {{ layerId: string; distancePc: number }} options
 * @returns {SkykitWaypoint[]}
 */
export function createConstellationWaypoints(manifest, options) {
  /** @type {SkykitWaypoint[]} */
  const waypoints = [];
  const constellations = Array.isArray(manifest.constellations) ? manifest.constellations : [];
  constellations.forEach((input, index) => {
    const constellation = recordFromUnknown(input);
    const direction = constellationDirection(constellation);
    if (!direction) return;
    const id = constellationId(constellation, index);
    waypoints.push({
      id,
      layerId: options.layerId,
      kind: 'constellation',
      label: resolveConstellationLabel(constellation),
      frame: 'observer-sky',
      position: direction,
      target: targetFromDirection(direction, options.distancePc),
      tags: ['constellation'],
      metadata: {
        iau: constellation.iau ?? null,
        sourceConstellationId: constellation.id ?? null,
        common_name: constellation.common_name ?? null,
      },
    });
  });
  return waypoints;
}

/** @param {Record<string, unknown>} manifest @param {string | undefined} assetBaseUrl */
export function toAnchoredImageManifest(manifest, assetBaseUrl) {
  const constellations = Array.isArray(manifest.constellations) ? manifest.constellations : [];
  return {
    format: 'found-in-space/anchored-image-manifest@1',
    id: String(manifest.id ?? 'constellations'),
    label: labelForManifest(manifest, String(manifest.id ?? 'constellations')),
    assetBaseUrl: assetBaseUrl ?? null,
    images: constellations.map((constellation, index) => toAnchoredImage(constellation, assetBaseUrl, index)).filter(Boolean),
    attribution: manifest.license,
    metadata: {
      sourceFormat: manifest.format,
      sourcePackage: manifest.source,
      astrometry: manifest.astrometry,
    },
  };
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {number} radius
 */
function boundaryPositions(manifest, radius) {
  /** @type {number[]} */
  const positions = [];
  for (const edge of boundaryEdges(manifest)) {
    positions.push(
      edge.start.x * radius, edge.start.y * radius, edge.start.z * radius,
      edge.end.x * radius, edge.end.y * radius, edge.end.z * radius,
    );
  }
  return positions;
}

/** @param {Record<string, unknown>} manifest */
function boundaryEdges(manifest) {
  const boundaries = recordFromUnknown(manifest.boundaries);
  const edges = Array.isArray(boundaries.edges) ? boundaries.edges : [];
  /** @type {Array<{ start: Vector3Like; end: Vector3Like; source: string }>} */
  const result = [];
  for (const edge of edges) {
    if (typeof edge !== 'string') continue;
    const parts = edge.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const start = directionFromRaDecText(parts[2], parts[3]);
    const end = directionFromRaDecText(parts[4], parts[5]);
    if (!start || !end) continue;
    result.push({ start, end, source: edge });
  }
  return result;
}

/** @param {string} raText @param {string} decText */
function directionFromRaDecText(raText, decText) {
  const raHours = parseSexagesimal(raText);
  const decDeg = parseSexagesimal(decText);
  if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) return null;
  return raDecToIcrsDirection({ raHours, decDeg });
}

/** @param {string} value */
function parseSexagesimal(value) {
  const sign = value.trim().startsWith('-') ? -1 : 1;
  const clean = value.trim().replace(/^[+-]/, '');
  const parts = clean.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  return sign * (parts[0] + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600);
}

/** @param {unknown} input @param {string | undefined} assetBaseUrl @param {number} index */
function toAnchoredImage(input, assetBaseUrl, index) {
  const constellation = recordFromUnknown(input);
  const image = recordFromUnknown(constellation.image);
  const imageFile = typeof image.file === 'string' ? image.file : '';
  const anchors = Array.isArray(image.anchors) ? image.anchors.map(toAnchoredImageAnchor).filter(Boolean) : [];
  if (!imageFile || anchors.length < 2) return null;
  return {
    id: constellationId(constellation, index),
    label: resolveConstellationLabel(constellation),
    groupId: typeof constellation.iau === 'string' ? constellation.iau : undefined,
    image: {
      src: typeof image.url === 'string'
        ? image.url
        : assetBaseUrl
          ? new URL(imageFile, assetBaseUrl).href
          : imageFile,
      width: Array.isArray(image.size) ? Number(image.size[0]) || 512 : 512,
      height: Array.isArray(image.size) ? Number(image.size[1]) || 512 : 512,
      anchors,
    },
    metadata: {
      sourceConstellationId: constellation.id ?? null,
      iau: constellation.iau ?? null,
      common_name: constellation.common_name ?? null,
    },
  };
}

/** @param {unknown} input */
function toAnchoredImageAnchor(input) {
  const anchor = recordFromUnknown(input);
  const icrs = recordFromUnknown(anchor.icrs);
  const pixel = recordFromUnknown(anchor.pixel);
  const target = {
    x: Number(icrs.x),
    y: Number(icrs.y),
    z: Number(icrs.z),
  };
  const point = {
    x: Number(pixel.x),
    y: Number(pixel.y),
  };
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    pixel: point,
    target: {
      kind: 'direction',
      frame: 'icrs',
      ...target,
    },
    metadata: {
      hip: anchor.hip,
      raDeg: anchor.raDeg,
      decDeg: anchor.decDeg,
    },
  };
}

/** @param {Record<string, unknown>} constellation */
function constellationDirection(constellation) {
  const image = recordFromUnknown(constellation.image);
  const anchors = Array.isArray(image.anchors) ? image.anchors : [];
  const sum = { x: 0, y: 0, z: 0 };
  let count = 0;
  for (const input of anchors) {
    const anchor = recordFromUnknown(input);
    const icrs = recordFromUnknown(anchor.icrs);
    const direction = normalizeVector({
      x: Number(icrs.x),
      y: Number(icrs.y),
      z: Number(icrs.z),
    });
    if (!direction) continue;
    sum.x += direction.x;
    sum.y += direction.y;
    sum.z += direction.z;
    count += 1;
  }
  return count > 0 ? normalizeVector(sum) : null;
}

/** @param {Record<string, unknown>} constellation @param {number} index */
function constellationId(constellation, index) {
  return String(constellation.id ?? constellation.iau ?? `constellation-${index + 1}`);
}

/** @param {Record<string, unknown>} constellation */
function resolveConstellationLabel(constellation) {
  const commonName = constellation.common_name;
  if (commonName && typeof commonName === 'object') {
    const source = /** @type {Record<string, unknown>} */ (commonName);
    if (typeof source.native === 'string' && source.native.trim()) return source.native.trim();
    if (typeof source.english === 'string' && source.english.trim()) return source.english.trim();
  }
  return String(constellation.iau ?? constellation.id ?? 'Constellation');
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string | undefined} fallback
 */
function datasetIdForManifest(manifest, fallback) {
  return String(manifest.id ?? fallback ?? 'constellations');
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} fallback
 */
function labelForManifest(manifest, fallback) {
  return String(manifest.label ?? manifest.name ?? manifest.id ?? fallback);
}

/**
 * @param {string} kind
 * @param {string} ownerId
 * @param {import('./index.d.ts').SkykitProductMetadata | undefined} metadata
 */
function productMetadata(kind, ownerId, metadata) {
  return {
    kind,
    ownerId,
    ...(metadata ?? {}),
  };
}

/**
 * @param {unknown} input
 * @returns {false | SkykitConstellationArtOptions}
 */
function normalizeArtOptions(input) {
  if (input === false || input == null) return false;
  if (typeof input === 'string') {
    const loading = normalizeArtMode(input);
    return loading === 'off' ? false : { loading };
  }
  const source = /** @type {SkykitConstellationArtOptions} */ (input);
  const loading = normalizeArtMode(source.loading ?? 'lazy');
  if (loading === 'off') return false;
  return {
    ...source,
    loading,
  };
}

/**
 * @param {unknown} value
 * @returns {SkykitConstellationArtMode}
 */
function normalizeArtMode(value) {
  const mode = String(value ?? 'off').trim().toLowerCase();
  if (mode === 'preload') return 'preload';
  if (mode === 'lazy' || mode === 'on' || mode === 'true') return 'lazy';
  return 'off';
}

/** @param {false | SkykitConstellationArtOptions} options */
function artMode(options) {
  return options ? options.loading ?? 'lazy' : 'off';
}

/** @param {Vector3Like} direction @param {number} distancePc */
function targetFromDirection(direction, distancePc) {
  return {
    targetPc: {
      x: direction.x * distancePc,
      y: direction.y * distancePc,
      z: direction.z * distancePc,
    },
  };
}

/** @param {Vector3Like} value */
function normalizeVector(value) {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length <= 0) return null;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  };
}

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {unknown} value */
function colorFromUnknown(value) {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined;
}

/** @param {unknown} input */
function recordFromUnknown(input) {
  return /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
}
