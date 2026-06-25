import * as THREE from 'three';

import {
  basisForFrame,
  basisSphericalToIcrs,
} from './coordinate-basis.js';
import { createSkykitLayerHostPlugin } from './layer-host.js';

/**
 * @typedef {import('./index.d.ts').SkykitCoordinateGridLayer} SkykitCoordinateGridLayer
 * @typedef {import('./index.d.ts').SkykitCoordinateGridLayerOptions} SkykitCoordinateGridLayerOptions
 * @typedef {import('./index.d.ts').SkykitCoordinateGridLineFeature} SkykitCoordinateGridLineFeature
 * @typedef {import('./index.d.ts').SkykitCoordinateGridSystemId} SkykitCoordinateGridSystemId
 * @typedef {import('./index.d.ts').SkykitCoordinateGridWaypointFeature} SkykitCoordinateGridWaypointFeature
 * @typedef {import('./index.d.ts').SkykitFeatureCollection} SkykitFeatureCollection
 * @typedef {import('./index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('./index.d.ts').SkykitSpatialFeature} SkykitSpatialFeature
 * @typedef {import('./index.d.ts').SkykitWaypoint} SkykitWaypoint
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

const DEFAULT_RADIUS = 8;
const DEFAULT_LINE_COLOR = 0x5ea6ff;
const DEFAULT_PLANE_COLOR = 0xffd36a;
const DEFAULT_POINT_COLOR = 0xffffff;
const DEFAULT_LINE_OPACITY = 0.24;
const DEFAULT_PLANE_OPACITY = 0.52;
const DEFAULT_POINT_OPACITY = 0.86;
const DEFAULT_POINT_SIZE = 0.055;
const MERIDIAN_SEGMENTS = 48;
const PARALLEL_SEGMENTS = 96;

/**
 * @param {SkykitCoordinateGridLayerOptions} options
 * @returns {SkykitCoordinateGridLayer}
 */
export function createSkykitCoordinateGridLayer(options) {
  if (!options?.system) {
    throw new TypeError('createSkykitCoordinateGridLayer() requires system.');
  }

  const system = cleanSystemId(options.system);
  const id = options.id ?? `coordinate-grid:${system}`;
  const radius = positiveFinite(options.radiusPc, DEFAULT_RADIUS);
  const grid = createCoordinateGridFeatures(system, radius);
  const publish = options.publish === false ? null : options.publish ?? null;
  /** @type {THREE.Object3D | null} */
  let root = null;
  let visible = options.visible !== false;

  /** @type {SkykitCoordinateGridLayer} */
  const layer = {
    id,
    priority: options.priority,
    setup(ctx) {
      root = createGridObject(grid.lines, grid.waypoints, options);
      root.visible = visible;
      ctx.addObject3D(root, {
        anchorMode: 'observer-centric',
        disposeObject: true,
      });
      if (publish?.features) {
        ctx.provideProduct(
          publish.features,
          createGridFeatureCollection(grid.lines, { layerId: id, system }),
          productMetadata('features', id, publish.metadata),
        );
      }
      if (publish?.waypoints) {
        ctx.provideProduct(
          publish.waypoints,
          createGridWaypoints(grid.waypoints, { layerId: id, system }),
          productMetadata('waypoints', id, publish.metadata),
        );
      }
    },
    show() {
      visible = true;
      if (root) root.visible = true;
      return visible;
    },
    hide() {
      visible = false;
      if (root) root.visible = false;
      return visible;
    },
    toggle(force) {
      visible = typeof force === 'boolean' ? force : !visible;
      if (root) root.visible = visible;
      return visible;
    },
    getSnapshot() {
      return {
        id,
        system,
        visible,
        lineCount: grid.lines.length,
        waypointCount: grid.waypoints.length,
        mounted: root?.parent != null,
      };
    },
  };

  return layer;
}

/**
 * @param {SkykitCoordinateGridLayerOptions} options
 * @returns {SkykitPlugin & { getLayer(): SkykitCoordinateGridLayer; getSnapshot(): unknown }}
 */
export function createSkykitCoordinateGridPlugin(options) {
  const layer = createSkykitCoordinateGridLayer(options);
  const host = createSkykitLayerHostPlugin({
    id: `${layer.id ?? 'coordinate-grid'}:host`,
    layers: [layer],
  });
  return {
    id: options.id ?? `skykit-coordinate-grid:${options.system}`,
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
 * @param {SkykitCoordinateGridSystemId | string} system
 * @param {number} radius
 * @returns {{ lines: SkykitCoordinateGridLineFeature[]; waypoints: SkykitCoordinateGridWaypointFeature[] }}
 */
export function createCoordinateGridFeatures(system, radius = DEFAULT_RADIUS) {
  const normalized = cleanSystemId(system);
  if (normalized === 'equatorial') return createEquatorialGrid(radius);
  if (normalized === 'galactic') return createGalacticGrid(radius);
  throw new TypeError(`Unsupported SkyKit coordinate grid system: ${system}`);
}

/**
 * @param {SkykitCoordinateGridLineFeature[]} lines
 * @param {{ layerId: string; system: string }} options
 * @returns {SkykitFeatureCollection}
 */
export function createGridFeatureCollection(lines, options) {
  return {
    type: 'FeatureCollection',
    features: lines.map((line) => gridLineToFeature(line, options)),
    metadata: {
      datasetId: options.system,
      label: `${options.system} coordinate grid`,
      layerKind: 'coordinate-grids',
      source: null,
    },
  };
}

/**
 * @param {SkykitCoordinateGridWaypointFeature[]} waypoints
 * @param {{ layerId: string; system: string }} options
 * @returns {SkykitWaypoint[]}
 */
export function createGridWaypoints(waypoints, options) {
  return waypoints.map((waypoint) => ({
    id: waypoint.id,
    layerId: options.layerId,
    kind: `coordinate-grid:${waypoint.kind}`,
    label: waypoint.label,
    frame: 'icrs-pc',
    position: waypoint.targetIcrs,
    target: { targetPc: waypoint.targetIcrs },
    tags: ['coordinate-grid', options.system],
    metadata: {
      coordinateGrid: options.system,
      ...(waypoint.metadata ?? {}),
    },
  }));
}

/**
 * @param {SkykitCoordinateGridLineFeature} line
 * @param {{ layerId: string; system: string }} options
 * @returns {SkykitSpatialFeature}
 */
function gridLineToFeature(line, options) {
  return {
    id: line.id,
    layerId: options.layerId,
    kind: `coordinate-grid:${line.kind}`,
    label: line.label,
    frame: 'icrs-pc',
    pathIcrs: line.pathIcrs,
    metadata: {
      coordinateGrid: options.system,
      ...(line.metadata ?? {}),
    },
  };
}

/**
 * @param {number} radius
 * @returns {{ lines: SkykitCoordinateGridLineFeature[]; waypoints: SkykitCoordinateGridWaypointFeature[] }}
 */
function createEquatorialGrid(radius) {
  const basis = basisForFrame('equatorial');
  /** @type {SkykitCoordinateGridLineFeature[]} */
  const lines = [];
  for (let raHours = 0; raHours < 24; raHours += 2) {
    const raDeg = raHours * 15;
    lines.push({
      id: `equatorial:ra-${pad2(raHours)}h-meridian`,
      label: `RA ${raHours}h meridian`,
      kind: 'meridian',
      pathIcrs: meridianPath(basis, raDeg, radius),
      metadata: { system: 'equatorial', raHours, raDeg },
    });
  }
  for (let decDeg = -75; decDeg <= 75; decDeg += 15) {
    lines.push({
      id: `equatorial:dec-${signedAngleId(decDeg)}-parallel`,
      label: `Dec ${signedAngleLabel(decDeg)} parallel`,
      kind: 'parallel',
      pathIcrs: parallelPath(basis, decDeg, radius),
      metadata: { system: 'equatorial', decDeg },
    });
  }
  /** @type {SkykitCoordinateGridWaypointFeature[]} */
  const waypoints = [
    {
      id: 'equatorial:north-celestial-pole',
      label: 'North celestial pole',
      kind: 'pole',
      targetIcrs: basisSphericalToIcrs(basis, 0, 90, radius),
      metadata: { system: 'equatorial', decDeg: 90 },
    },
    {
      id: 'equatorial:south-celestial-pole',
      label: 'South celestial pole',
      kind: 'pole',
      targetIcrs: basisSphericalToIcrs(basis, 0, -90, radius),
      metadata: { system: 'equatorial', decDeg: -90 },
    },
    ...[0, 6, 12, 18].map((raHours) => ({
      id: `equatorial:ra-${pad2(raHours)}h`,
      label: `RA ${raHours}h`,
      kind: /** @type {'cardinal'} */ ('cardinal'),
      targetIcrs: basisSphericalToIcrs(basis, raHours * 15, 0, radius),
      metadata: { system: 'equatorial', raHours, raDeg: raHours * 15, decDeg: 0 },
    })),
  ];
  return { lines, waypoints };
}

/**
 * @param {number} radius
 * @returns {{ lines: SkykitCoordinateGridLineFeature[]; waypoints: SkykitCoordinateGridWaypointFeature[] }}
 */
function createGalacticGrid(radius) {
  const basis = basisForFrame('galactic');
  /** @type {SkykitCoordinateGridLineFeature[]} */
  const lines = [];
  for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
    lines.push({
      id: `galactic:l-${pad3(lonDeg)}deg-meridian`,
      label: `Galactic longitude ${lonDeg} deg meridian`,
      kind: 'meridian',
      pathIcrs: meridianPath(basis, lonDeg, radius),
      metadata: { system: 'galactic', longitudeDeg: lonDeg },
    });
  }
  for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
    if (latDeg === 0) continue;
    lines.push({
      id: `galactic:b-${signedAngleId(latDeg)}-parallel`,
      label: `Galactic latitude ${signedAngleLabel(latDeg)} parallel`,
      kind: 'parallel',
      pathIcrs: parallelPath(basis, latDeg, radius),
      metadata: { system: 'galactic', latitudeDeg: latDeg },
    });
  }
  lines.push({
    id: 'galactic:plane',
    label: 'Galactic plane',
    kind: 'plane',
    pathIcrs: parallelPath(basis, 0, radius),
    metadata: { system: 'galactic', latitudeDeg: 0 },
  });
  /** @type {SkykitCoordinateGridWaypointFeature[]} */
  const waypoints = [
    {
      id: 'galactic:north-pole',
      label: 'Galactic north pole',
      kind: 'pole',
      targetIcrs: basisSphericalToIcrs(basis, 0, 90, radius),
      metadata: { system: 'galactic', latitudeDeg: 90 },
    },
    {
      id: 'galactic:south-pole',
      label: 'Galactic south pole',
      kind: 'pole',
      targetIcrs: basisSphericalToIcrs(basis, 0, -90, radius),
      metadata: { system: 'galactic', latitudeDeg: -90 },
    },
    ...[0, 90, 180, 270].map((longitudeDeg) => ({
      id: `galactic:l-${pad3(longitudeDeg)}deg`,
      label: `Galactic longitude ${longitudeDeg} deg`,
      kind: /** @type {'cardinal'} */ ('cardinal'),
      targetIcrs: basisSphericalToIcrs(basis, longitudeDeg, 0, radius),
      metadata: { system: 'galactic', longitudeDeg, latitudeDeg: 0 },
    })),
  ];
  return { lines, waypoints };
}

/**
 * @param {ReturnType<typeof basisForFrame>} basis
 * @param {number} longitudeDeg
 * @param {number} radius
 * @returns {Vector3Like[]}
 */
function meridianPath(basis, longitudeDeg, radius) {
  /** @type {Vector3Like[]} */
  const points = [];
  for (let index = 0; index <= MERIDIAN_SEGMENTS; index += 1) {
    const latitudeDeg = -90 + 180 * (index / MERIDIAN_SEGMENTS);
    points.push(basisSphericalToIcrs(basis, longitudeDeg, latitudeDeg, radius));
  }
  return points;
}

/**
 * @param {ReturnType<typeof basisForFrame>} basis
 * @param {number} latitudeDeg
 * @param {number} radius
 * @returns {Vector3Like[]}
 */
function parallelPath(basis, latitudeDeg, radius) {
  /** @type {Vector3Like[]} */
  const points = [];
  for (let index = 0; index < PARALLEL_SEGMENTS; index += 1) {
    const longitudeDeg = 360 * (index / PARALLEL_SEGMENTS);
    points.push(basisSphericalToIcrs(basis, longitudeDeg, latitudeDeg, radius));
  }
  return points;
}

/**
 * @param {SkykitCoordinateGridLineFeature[]} lines
 * @param {SkykitCoordinateGridWaypointFeature[]} waypoints
 * @param {SkykitCoordinateGridLayerOptions} options
 */
function createGridObject(lines, waypoints, options) {
  const root = new THREE.Group();
  root.name = `coordinate-grid:${cleanSystemId(options.system)}`;
  const lineMaterial = new THREE.LineBasicMaterial({
    color: colorFromUnknown(options.lineColor) ?? DEFAULT_LINE_COLOR,
    transparent: true,
    opacity: finiteNumber(options.lineOpacity, DEFAULT_LINE_OPACITY),
    depthWrite: false,
  });
  const planeMaterial = new THREE.LineBasicMaterial({
    color: colorFromUnknown(options.planeColor) ?? DEFAULT_PLANE_COLOR,
    transparent: true,
    opacity: finiteNumber(options.planeOpacity, DEFAULT_PLANE_OPACITY),
    depthWrite: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: colorFromUnknown(options.waypointColor) ?? DEFAULT_POINT_COLOR,
    size: positiveFinite(options.waypointSize, DEFAULT_POINT_SIZE),
    sizeAttenuation: true,
    transparent: true,
    opacity: finiteNumber(options.waypointOpacity, DEFAULT_POINT_OPACITY),
    depthWrite: false,
  });
  for (const lineFeature of lines) {
    if (lineFeature.pathIcrs.length < 2) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(flattenPoints(lineFeature.pathIcrs), 3));
    const line = lineFeature.kind === 'meridian'
      ? new THREE.Line(geometry, lineMaterial.clone())
      : new THREE.LineLoop(geometry, (lineFeature.kind === 'plane' ? planeMaterial : lineMaterial).clone());
    line.name = lineFeature.id;
    root.add(line);
  }
  for (const waypoint of waypoints) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(flattenPoints([waypoint.targetIcrs]), 3));
    const point = new THREE.Points(geometry, pointMaterial.clone());
    point.name = `${waypoint.id}:point`;
    root.add(point);
  }
  return root;
}

/** @param {Vector3Like[]} points */
function flattenPoints(points) {
  /** @type {number[]} */
  const positions = [];
  for (const point of points) {
    positions.push(point.x, point.y, point.z);
  }
  return positions;
}

/** @param {unknown} value */
function cleanSystemId(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** @param {number} value */
function pad2(value) {
  return String(value).padStart(2, '0');
}

/** @param {number} value */
function pad3(value) {
  return String(value).padStart(3, '0');
}

/** @param {number} value */
function signedAngleId(value) {
  if (value < 0) return `minus-${Math.abs(value)}deg`;
  if (value > 0) return `plus-${value}deg`;
  return '0deg';
}

/** @param {number} value */
function signedAngleLabel(value) {
  if (value > 0) return `+${value} deg`;
  return `${value} deg`;
}

/** @param {unknown} value @param {number} fallback */
function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {unknown} value */
function colorFromUnknown(value) {
  return value == null ? null : /** @type {THREE.ColorRepresentation} */ (value);
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
