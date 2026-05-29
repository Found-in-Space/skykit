import * as THREE from 'three';

import { raDecToIcrsDirection } from '@found-in-space/spatial';

import { createSkykitLayerHostPlugin } from './layer-host.js';

/**
 * @typedef {import('./index.d.ts').SkykitCoordinateFrameMarker} SkykitCoordinateFrameMarker
 * @typedef {import('./index.d.ts').SkykitCoordinateFrameMarkerLayer} SkykitCoordinateFrameMarkerLayer
 * @typedef {import('./index.d.ts').SkykitCoordinateFrameMarkerLayerOptions} SkykitCoordinateFrameMarkerLayerOptions
 * @typedef {import('./index.d.ts').SkykitFeatureCollection} SkykitFeatureCollection
 * @typedef {import('./index.d.ts').SkykitLayerContext} SkykitLayerContext
 * @typedef {import('./index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('./index.d.ts').SkykitSpatialFeature} SkykitSpatialFeature
 * @typedef {import('./index.d.ts').SkykitWaypoint} SkykitWaypoint
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

const DEFAULT_RADIUS = 8;
const DEFAULT_LINE_COLOR = 0x88d7ff;
const DEFAULT_POINT_COLOR = 0xffd36a;
const GALACTIC_CENTER_RA_DEG = 266.4051;
const GALACTIC_CENTER_DEC_DEG = -28.936175;
const GALACTIC_NORTH_RA_DEG = 192.85948;
const GALACTIC_NORTH_DEC_DEG = 27.12825;
const EARTH_OBLIQUITY_DEG = 23.43928;

/**
 * @param {SkykitCoordinateFrameMarkerLayerOptions} options
 * @returns {SkykitCoordinateFrameMarkerLayer}
 */
export function createSkykitCoordinateFrameMarkerLayer(options) {
  if (!options?.frame) {
    throw new TypeError('createSkykitCoordinateFrameMarkerLayer() requires frame.');
  }

  const frame = String(options.frame);
  const id = options.id ?? `coordinate-frame:${frame}`;
  const radius = positiveFinite(options.radiusPc, DEFAULT_RADIUS);
  const markers = Array.from(options.markers ?? createDefaultMarkers(frame, radius));
  const publish = options.publish === false ? null : options.publish ?? null;
  /** @type {THREE.Object3D | null} */
  let root = null;
  let visible = options.visible !== false;

  /** @type {SkykitCoordinateFrameMarkerLayer} */
  const layer = {
    id,
    priority: options.priority,
    setup(ctx) {
      root = createMarkerObject(markers);
      root.visible = visible;
      ctx.addObject3D(root, {
        anchorMode: 'observer-centric',
        disposeObject: true,
      });
      if (publish?.features) {
        ctx.provideProduct(
          publish.features,
          createMarkerFeatureCollection(markers, { layerId: id, frame }),
          productMetadata('features', id, publish.metadata),
        );
      }
      if (publish?.waypoints) {
        ctx.provideProduct(
          publish.waypoints,
          createMarkerWaypoints(markers, { layerId: id, frame }),
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
        frame,
        visible,
        markerCount: markers.length,
        mounted: root?.parent != null,
      };
    },
  };

  return layer;
}

/**
 * @param {SkykitCoordinateFrameMarkerLayerOptions} options
 * @returns {SkykitPlugin & { getLayer(): SkykitCoordinateFrameMarkerLayer; getSnapshot(): unknown }}
 */
export function createSkykitCoordinateFrameMarkerPlugin(options) {
  const layer = createSkykitCoordinateFrameMarkerLayer(options);
  const host = createSkykitLayerHostPlugin({
    id: `${layer.id ?? 'coordinate-frame'}:host`,
    layers: [layer],
  });
  return {
    id: options.id ?? `skykit-coordinate-frame:${options.frame}`,
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
 * @param {SkykitCoordinateFrameMarker[]} markers
 * @param {{ layerId: string; frame: string }} options
 * @returns {SkykitFeatureCollection}
 */
export function createMarkerFeatureCollection(markers, options) {
  return {
    type: 'FeatureCollection',
    features: markers.map((marker) => markerToFeature(marker, options)),
    metadata: {
      datasetId: options.frame,
      label: `${options.frame} frame`,
      layerKind: 'coordinate-frame-markers',
      source: null,
    },
  };
}

/**
 * @param {SkykitCoordinateFrameMarker[]} markers
 * @param {{ layerId: string; frame: string }} options
 * @returns {SkykitWaypoint[]}
 */
export function createMarkerWaypoints(markers, options) {
  return markers
    .filter((marker) => marker.targetIcrs)
    .map((marker) => ({
      ...markerToFeature(marker, options),
      target: { targetPc: /** @type {Vector3Like} */ (marker.targetIcrs) },
      tags: ['coordinate-frame', options.frame],
    }));
}

/**
 * @param {SkykitCoordinateFrameMarker} marker
 * @param {{ layerId: string; frame: string }} options
 * @returns {SkykitSpatialFeature}
 */
function markerToFeature(marker, options) {
  return {
    id: marker.id,
    layerId: options.layerId,
    kind: `coordinate-frame:${marker.kind}`,
    label: marker.label,
    frame: 'icrs-pc',
    ...(marker.targetIcrs ? {
      position: marker.targetIcrs,
      target: { targetPc: marker.targetIcrs },
    } : {}),
    metadata: {
      coordinateFrame: options.frame,
      ...(marker.pathIcrs ? { pathIcrs: marker.pathIcrs } : {}),
      ...(marker.metadata ?? {}),
    },
  };
}

/**
 * @param {string} frame
 * @param {number} radius
 * @returns {SkykitCoordinateFrameMarker[]}
 */
function createDefaultMarkers(frame, radius) {
  const basis = basisForFrame(frame);
  const prefix = frame.toLowerCase();
  const planePath = createPlanePath(basis.x, basis.y, radius, 64);
  return [
    axisMarker(`${prefix}:x-axis`, `${frame} X axis`, basis.x, radius),
    axisMarker(`${prefix}:y-axis`, `${frame} Y axis`, basis.y, radius),
    axisMarker(`${prefix}:z-axis`, `${frame} north axis`, basis.z, radius),
    {
      id: `${prefix}:plane`,
      label: `${frame} plane`,
      kind: 'plane',
      pathIcrs: planePath,
      metadata: { frame },
    },
    {
      id: `${prefix}:north-pole`,
      label: `${frame} north pole`,
      kind: 'pole',
      targetIcrs: scaleVector(basis.z, radius),
      metadata: { frame },
    },
    {
      id: `${prefix}:south-pole`,
      label: `${frame} south pole`,
      kind: 'pole',
      targetIcrs: scaleVector(basis.z, -radius),
      metadata: { frame },
    },
  ];
}

/**
 * @param {string} id
 * @param {string} label
 * @param {Vector3Like} direction
 * @param {number} radius
 * @returns {SkykitCoordinateFrameMarker}
 */
function axisMarker(id, label, direction, radius) {
  return {
    id,
    label,
    kind: 'axis',
    targetIcrs: scaleVector(direction, radius),
    pathIcrs: [
      scaleVector(direction, -radius),
      scaleVector(direction, radius),
    ],
  };
}

/** @param {string} frame */
function basisForFrame(frame) {
  if (frame.toLowerCase() === 'galactic') {
    const north = raDecToIcrsDirection({ raDeg: GALACTIC_NORTH_RA_DEG, decDeg: GALACTIC_NORTH_DEC_DEG })
      ?? { x: 0, y: 0, z: 1 };
    const center = raDecToIcrsDirection({ raDeg: GALACTIC_CENTER_RA_DEG, decDeg: GALACTIC_CENTER_DEC_DEG })
      ?? { x: 1, y: 0, z: 0 };
    const y = normalizeVector(cross(north, center)) ?? { x: 0, y: 1, z: 0 };
    const x = normalizeVector(cross(y, north)) ?? center;
    return { x, y, z: normalizeVector(north) ?? north };
  }
  if (frame.toLowerCase() === 'solar') {
    const obliquity = EARTH_OBLIQUITY_DEG * Math.PI / 180;
    const x = { x: 1, y: 0, z: 0 };
    const z = normalizeVector({ x: 0, y: -Math.sin(obliquity), z: Math.cos(obliquity) })
      ?? { x: 0, y: 0, z: 1 };
    const y = normalizeVector(cross(z, x)) ?? { x: 0, y: 1, z: 0 };
    return { x, y, z };
  }
  return {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
  };
}

/** @param {SkykitCoordinateFrameMarker[]} markers */
function createMarkerObject(markers) {
  const root = new THREE.Group();
  root.name = 'coordinate-frame-markers';
  const lineMaterial = new THREE.LineBasicMaterial({
    color: DEFAULT_LINE_COLOR,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    color: DEFAULT_POINT_COLOR,
    size: 0.08,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  for (const marker of markers) {
    if (marker.pathIcrs && marker.pathIcrs.length >= 2) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(flattenPoints(marker.pathIcrs), 3));
      const line = marker.kind === 'plane'
        ? new THREE.LineLoop(geometry, lineMaterial.clone())
        : new THREE.Line(geometry, lineMaterial.clone());
      line.name = marker.id;
      root.add(line);
    }
    if (marker.targetIcrs) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(flattenPoints([marker.targetIcrs]), 3));
      const point = new THREE.Points(geometry, pointMaterial.clone());
      point.name = `${marker.id}:point`;
      root.add(point);
    }
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

/** @param {Vector3Like} xAxis @param {Vector3Like} yAxis @param {number} radius @param {number} steps */
function createPlanePath(xAxis, yAxis, radius, steps) {
  /** @type {Vector3Like[]} */
  const points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = index / steps * Math.PI * 2;
    points.push({
      x: (Math.cos(angle) * xAxis.x + Math.sin(angle) * yAxis.x) * radius,
      y: (Math.cos(angle) * xAxis.y + Math.sin(angle) * yAxis.y) * radius,
      z: (Math.cos(angle) * xAxis.z + Math.sin(angle) * yAxis.z) * radius,
    });
  }
  return points;
}

/** @param {Vector3Like} vector @param {number} scale */
function scaleVector(vector, scale) {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

/** @param {Vector3Like} left @param {Vector3Like} right */
function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
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
function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
