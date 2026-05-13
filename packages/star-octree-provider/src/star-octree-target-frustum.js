import { STAR_HAS_PAYLOAD } from './star-octree-format.js';
import {
  ERR_STAR_OCTREE_INVALID_VIEW,
  createStarOctreeError,
} from './star-octree-errors.js';
import { loadRadiusForMagnitudeShell } from './star-octree-observer-shell.js';
import {
  distanceToNodeAabbPc,
  traverseOctree,
} from './star-octree-traversal.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LIMITING_MAGNITUDE = 6.5;

/**
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
export async function planTargetFrustumDemand(options) {
  const bootstrap = await options.indexSource.ensureBootstrapLoaded();
  const view = normalizeTargetFrustumView(
    options.context.view,
    options.context.strategy,
  );
  const frustum = createFrustumTester(view);
  const indexMagnitude = bootstrap.header.magLimit;
  /** @type {StarOctreeDemandEntry[]} */
  const entries = [];
  let shellPrunedNodeCount = 0;
  let frustumPrunedNodeCount = 0;
  let prefetchNodeCount = 0;

  const traversal = await traverseOctree({
    indexSource: options.indexSource,
    bootstrap,
    distanceToNode: (node) => distanceToNodeAabbPc(view.observerPc, node),
    visitor(node) {
      const distancePc = distanceToNodeAabbPc(view.observerPc, node);
      const loadRadiusPc = loadRadiusForMagnitudeShell(
        node.halfSize,
        view.limitingMagnitude,
        indexMagnitude,
      );
      const shellRelevant = distancePc <= loadRadiusPc;

      if (!shellRelevant) {
        shellPrunedNodeCount += 1;
        return {
          include: false,
          descend: false,
          distancePc,
        };
      }

      const frustumRelevant = frustum.intersectsNode(node);
      if (!frustumRelevant) {
        frustumPrunedNodeCount += 1;
        return {
          include: false,
          descend: false,
          distancePc,
        };
      }

      if ((node.flags & STAR_HAS_PAYLOAD) && node.payloadLength > 0) {
        entries.push({
          node,
          priority: -distancePc,
          role: 'current',
          reasons: ['target-frustum'],
          metadata: {
            distancePc,
            loadRadiusPc,
            limitingMagnitude: view.limitingMagnitude,
            indexMagnitude,
          },
        });
      }

      return {
        include: true,
        descend: true,
        distancePc,
      };
    },
  });

  entries.sort((left, right) => {
    const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return left.node.nodeKey.localeCompare(right.node.nodeKey);
  });

  return {
    entries,
    signature: entries
      .map((entry) => `${entry.node.nodeKey}:${entry.role ?? 'current'}`)
      .join('|'),
    reasons: ['target-frustum'],
    metadata: {
      strategy: 'target-frustum',
      observerPc: view.observerPc,
      limitingMagnitude: view.limitingMagnitude,
      indexMagnitude,
      inspectedNodeCount: traversal.stats.inspectedNodeCount,
      selectedNodeCount: traversal.stats.selectedNodeCount,
      payloadNodeCount: traversal.stats.payloadNodeCount,
      prunedNodeCount: traversal.stats.prunedNodeCount,
      shellPrunedNodeCount,
      frustumPrunedNodeCount,
      prefetchNodeCount,
      frontierShardCount: traversal.stats.frontierShardCount,
      maxLevelInspected: traversal.stats.maxLevelInspected,
    },
  };
}

/**
 * @param {StarOctreeViewPatch | StarOctreeSelectionContext['view']} view
 * @param {StarOctreeSelectionContext['strategy']} strategy
 */
export function normalizeTargetFrustumView(view = {}, strategy = { kind: 'target-frustum' }) {
  if (strategy.kind !== 'target-frustum') {
    throw createInvalidViewError('target-frustum strategy configuration is required.');
  }

  const observerPc = normalizePoint(view.observerPc, DEFAULT_OBSERVER_PC);
  const limitingMagnitude = normalizeFiniteNumber(
    view.limitingMagnitude ?? view.mDesired,
    DEFAULT_LIMITING_MAGNITUDE,
  );
  const orientationIcrs = normalizeQuaternion(view.orientationIcrs);
  const verticalFovDeg = normalizePositiveNumber(
    view.verticalFovDeg ?? strategy.verticalFovDeg,
    'verticalFovDeg',
  );
  const aspectRatio = normalizePositiveNumber(view.aspectRatio, 'aspectRatio');
  const nearPc = normalizeNonNegativeNumber(
    view.nearPc ?? strategy.nearPc ?? 0,
    'nearPc',
  );
  const farPc = view.farPc ?? strategy.farPc;

  if (!orientationIcrs) {
    throw createInvalidViewError('target-frustum requires orientationIcrs.');
  }

  if (farPc !== undefined && (!Number.isFinite(Number(farPc)) || Number(farPc) <= nearPc)) {
    throw createInvalidViewError('target-frustum farPc must be greater than nearPc.');
  }

  return {
    ...view,
    observerPc,
    limitingMagnitude,
    orientationIcrs,
    verticalFovDeg,
    aspectRatio,
    nearPc,
    ...(farPc !== undefined ? { farPc: Number(farPc) } : {}),
    ...(strategy.overscanDeg !== undefined
      ? { overscanDeg: Number(strategy.overscanDeg) }
      : {}),
  };
}

/**
 * @param {ReturnType<typeof normalizeTargetFrustumView>} view
 */
export function createFrustumTester(view) {
  const basis = quaternionToCameraBasis(view.orientationIcrs);
  const halfVerticalRad = degreesToRadians(
    view.verticalFovDeg / 2 + (view.overscanDeg ?? 0),
  );
  const halfHorizontalRad = Math.atan(Math.tan(halfVerticalRad) * view.aspectRatio);
  const tanVertical = Math.tan(halfVerticalRad);
  const tanHorizontal = Math.tan(halfHorizontalRad);
  const planes = [
    { normal: basis.forward, offset: -view.nearPc },
    ...(view.farPc !== undefined
      ? [{ normal: scaleVector(basis.forward, -1), offset: view.farPc }]
      : []),
    { normal: normalizeVector(addVectors(scaleVector(basis.forward, tanVertical), scaleVector(basis.up, -1))), offset: 0 },
    { normal: normalizeVector(addVectors(scaleVector(basis.forward, tanVertical), basis.up)), offset: 0 },
    { normal: normalizeVector(addVectors(scaleVector(basis.forward, tanHorizontal), scaleVector(basis.right, -1))), offset: 0 },
    { normal: normalizeVector(addVectors(scaleVector(basis.forward, tanHorizontal), basis.right)), offset: 0 },
  ];

  return {
    basis,
    /**
     * @param {StarOctreeRuntimeNode} node
     */
    intersectsNode(node) {
      const relativeCenter = {
        x: node.centerX - view.observerPc.x,
        y: node.centerY - view.observerPc.y,
        z: node.centerZ - view.observerPc.z,
      };

      for (const plane of planes) {
        const centerDistance =
          dotVector(plane.normal, relativeCenter) + plane.offset;
        const radius =
          node.halfSize *
          (
            Math.abs(plane.normal.x) +
            Math.abs(plane.normal.y) +
            Math.abs(plane.normal.z)
          );
        if (centerDistance + radius < 0) {
          return false;
        }
      }

      return true;
    },
  };
}

/**
 * @param {{ x: number; y: number; z: number; w: number }} quaternion
 */
export function quaternionToCameraBasis(quaternion) {
  return {
    right: rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, quaternion),
    up: rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, quaternion),
    forward: rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, quaternion),
  };
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 * @param {{ x: number; y: number; z: number; w: number }} quaternion
 */
function rotateVectorByQuaternion(vector, quaternion) {
  const qx = quaternion.x;
  const qy = quaternion.y;
  const qz = quaternion.z;
  const qw = quaternion.w;
  const tx = 2 * (qy * vector.z - qz * vector.y);
  const ty = 2 * (qz * vector.x - qx * vector.z);
  const tz = 2 * (qx * vector.y - qy * vector.x);

  return normalizeVector({
    x: vector.x + qw * tx + (qy * tz - qz * ty),
    y: vector.y + qw * ty + (qz * tx - qx * tz),
    z: vector.z + qw * tz + (qx * ty - qy * tx),
  });
}

/**
 * @param {unknown} value
 */
function normalizeQuaternion(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const quaternion = /** @type {{ x?: unknown; y?: unknown; z?: unknown; w?: unknown }} */ (value);
  const x = Number(quaternion.x);
  const y = Number(quaternion.y);
  const z = Number(quaternion.z);
  const w = Number(quaternion.w);
  const length = Math.hypot(x, y, z, w);
  if (!(length > 0) || !Number.isFinite(length)) {
    return null;
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length,
    w: w / length,
  };
}

/**
 * @param {unknown} value
 * @param {{ x: number; y: number; z: number }} fallback
 */
function normalizePoint(value, fallback) {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }

  const point = /** @type {Partial<typeof fallback>} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);

  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : { ...fallback };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw createInvalidViewError(`target-frustum requires positive ${label}.`);
  }
  return number;
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizeNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw createInvalidViewError(`target-frustum requires non-negative ${label}.`);
  }
  return number;
}

/**
 * @param {string} message
 */
function createInvalidViewError(message) {
  return createStarOctreeError(ERR_STAR_OCTREE_INVALID_VIEW, message);
}

/**
 * @param {number} degrees
 */
function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function dotVector(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 * @param {number} scalar
 */
function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 */
function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!(length > 0)) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}
