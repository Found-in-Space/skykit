import { createStarCellKey } from '@found-in-space/star-products';
import {
  ERR_STAR_OCTREE_INVALID_VIEW,
  createStarOctreeError,
} from './star-octree-errors.js';
import { loadRadiusForMagnitudeShell } from './star-octree-observer-shell.js';
import { distanceToNodeAabbPc } from './star-octree-traversal.js';

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
const DEFAULT_TARGET_VERTICAL_FOV_DEG = 40;
const DEFAULT_TARGET_OVERSCAN_DEG = 8;
const DEFAULT_TARGET_RADIUS_PC = 96;
const DEFAULT_TARGET_ASPECT_RATIO = 1;
const TARGET_UP = Object.freeze({ x: 0, y: 0, z: 1 });
const TARGET_UP_FALLBACK = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
export async function planTargetFrustumDemand(options) {
  const view = normalizeTargetFrustumView(
    options.context.view,
    options.context.strategy,
  );
  const targetDistancePc = 'targetDistancePc' in view
    ? view.targetDistancePc
    : undefined;
  const currentResult = await collectTargetFrustumEntries({
    context: options.context,
    view,
    role: 'current',
  });
  const entries = [...currentResult.entries];

  entries.sort((left, right) =>
    compareTargetFrustumEntries(left, right, {
      coarseFirst: options.context.streaming?.coarseFirst !== false,
    }),
  );

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: ['target-frustum'],
    metadata: {
      strategy: 'target-frustum',
      observerPc: view.observerPc,
      limitingMagnitude: view.limitingMagnitude,
      indexMagnitude: currentResult.indexMagnitude,
      frustumMode: view.frustumMode,
      ...(view.targetPc ? { targetPc: view.targetPc } : {}),
      ...(targetDistancePc !== undefined
        ? { targetDistancePc }
        : {}),
      inspectedNodeCount: currentResult.stats.inspectedNodeCount,
      selectedNodeCount: currentResult.stats.selectedNodeCount,
      payloadNodeCount: currentResult.stats.payloadNodeCount,
      prunedNodeCount: currentResult.stats.prunedNodeCount,
      shellPrunedNodeCount: currentResult.shellPrunedNodeCount,
      frustumPrunedNodeCount: currentResult.frustumPrunedNodeCount,
      prefetchNodeCount: 0,
      prefetchOverlapCount: 0,
      frontierShardCount: currentResult.stats.frontierShardCount,
      maxLevelInspected: currentResult.stats.maxLevelInspected,
    },
  };
}

/**
 * @param {{
 *   context: StarOctreeSelectionContext;
 *   view: ReturnType<typeof normalizeTargetFrustumView>;
 *   role: 'current' | 'prefetch';
 * }} options
 */
async function collectTargetFrustumEntries(options) {
  const frustum = createFrustumTester(options.view);
  let indexMagnitude = DEFAULT_LIMITING_MAGNITUDE;
  let shellPrunedNodeCount = 0;
  let frustumPrunedNodeCount = 0;

  const result = await options.context.traversal.select({
    distanceToNode: (node) => distanceToNodeAabbPc(options.view.observerPc, node),
    visit(node, { bootstrap }) {
      indexMagnitude = bootstrap.header.magLimit;
      const distancePc = distanceToNodeAabbPc(options.view.observerPc, node);
      const loadRadiusPc = loadRadiusForMagnitudeShell(
        node.halfSize,
        options.view.limitingMagnitude,
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

      const relativeCenter = subtractVectors(
        { x: node.centerX, y: node.centerY, z: node.centerZ },
        options.view.observerPc,
      );
      const forwardDistancePc = dotVector(
        frustum.basis.forward,
        relativeCenter,
      );

      return {
        include: true,
        descend: true,
        distancePc,
        priority: -distancePc,
        role: options.role,
        reasons: [
          options.role === 'current'
            ? 'target-frustum'
            : 'motion-lookahead',
        ],
        metadata: {
          distancePc,
          forwardDistancePc,
          loadRadiusPc,
          limitingMagnitude: options.view.limitingMagnitude,
          indexMagnitude,
          frustumMode: options.view.frustumMode,
          ...(options.role === 'prefetch'
            ? {
                prefetchKind: 'motion-lookahead',
                futureObserverPc: options.view.observerPc,
              }
            : {}),
        },
      };
    },
  });

  return {
    entries: result.entries,
    stats: result.stats,
    indexMagnitude,
    shellPrunedNodeCount,
    frustumPrunedNodeCount,
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
  const targetPc = normalizeOptionalPoint(view.targetPc);
  const directionIcrs = normalizeOptionalVector(view.directionIcrs);
  const targetVector = targetPc ? subtractVectors(targetPc, observerPc) : null;
  const targetDistancePc = targetVector ? vectorLength(targetVector) : null;
  const targetDirection =
    directionIcrs ??
    (
      targetVector && targetDistancePc && targetDistancePc > 0
        ? scaleVector(targetVector, 1 / targetDistancePc)
        : null
    );

  if (orientationIcrs) {
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
      frustumMode: 'orientation',
      ...(targetPc ? { targetPc } : {}),
      ...(farPc !== undefined ? { farPc: Number(farPc) } : {}),
      ...(strategy.overscanDeg !== undefined
        ? { overscanDeg: Number(strategy.overscanDeg) }
        : {}),
    };
  }

  if (!targetDirection) {
    throw createInvalidViewError(
      'target-frustum requires orientationIcrs, targetPc, or directionIcrs.',
    );
  }

  const verticalFovDeg = normalizeFinitePositiveNumber(
    view.verticalFovDeg ?? strategy.verticalFovDeg,
    DEFAULT_TARGET_VERTICAL_FOV_DEG,
    'verticalFovDeg',
  );
  const aspectRatio = normalizeFinitePositiveNumber(
    view.aspectRatio,
    DEFAULT_TARGET_ASPECT_RATIO,
    'aspectRatio',
  );
  const nearPc = normalizeNonNegativeNumber(
    view.nearPc ?? strategy.nearPc ?? 0,
    'nearPc',
  );
  const explicitFarPc = view.farPc ?? strategy.farPc;
  const targetRadiusPc = normalizeFinitePositiveNumber(
    strategy.targetRadiusPc,
    DEFAULT_TARGET_RADIUS_PC,
    'targetRadiusPc',
  );
  const preloadDistancePc = normalizeFiniteNumber(view.preloadDistancePc, 0);
  const farPc = explicitFarPc !== undefined
    ? Number(explicitFarPc)
    : (
        targetDistancePc !== null
          ? targetDistancePc + targetRadiusPc + Math.max(0, preloadDistancePc)
          : undefined
      );

  if (farPc !== undefined && (!Number.isFinite(farPc) || farPc <= nearPc)) {
    throw createInvalidViewError('target-frustum farPc must be greater than nearPc.');
  }

  return {
    ...view,
    observerPc,
    limitingMagnitude,
    frustumBasis: cameraBasisFromForward(targetDirection),
    frustumMode: targetPc ? 'target' : 'direction',
    verticalFovDeg,
    aspectRatio,
    nearPc,
    overscanDeg: normalizeFiniteNumber(
      strategy.overscanDeg,
      DEFAULT_TARGET_OVERSCAN_DEG,
    ),
    ...(targetPc ? { targetPc } : {}),
    ...(targetDistancePc !== null ? { targetDistancePc } : {}),
    targetRadiusPc,
    ...(farPc !== undefined ? { farPc: Number(farPc) } : {}),
  };
}

/**
 * @param {ReturnType<typeof normalizeTargetFrustumView>} view
 */
export function createFrustumTester(view) {
  const basis = 'frustumBasis' in view && view.frustumBasis
    ? view.frustumBasis
    : quaternionToCameraBasis(
        /** @type {{ x: number; y: number; z: number; w: number }} */ (view.orientationIcrs),
      );
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
 */
function normalizeOptionalPoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const point = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : null;
}

/**
 * @param {unknown} value
 */
function normalizeOptionalVector(value) {
  const point = normalizeOptionalPoint(value);
  if (!point) {
    return null;
  }

  const length = vectorLength(point);
  return length > 0 ? scaleVector(point, 1 / length) : null;
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
 * @param {number} fallback
 * @param {string} label
 */
function normalizeFinitePositiveNumber(value, fallback, label) {
  if (value === undefined) {
    return fallback;
  }
  return normalizePositiveNumber(value, label);
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
function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
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
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function crossVector(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 */
function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

/**
 * @param {{ x: number; y: number; z: number }} forward
 */
function cameraBasisFromForward(forward) {
  const normalizedForward = normalizeVector(forward);
  const preferredUp =
    Math.abs(dotVector(normalizedForward, TARGET_UP)) > 0.98
      ? TARGET_UP_FALLBACK
      : TARGET_UP;
  const right = normalizeVector(crossVector(normalizedForward, preferredUp));
  const up = normalizeVector(crossVector(right, normalizedForward));

  return {
    right,
    up,
    forward: normalizedForward,
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

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {{ coarseFirst: boolean }} options
 */
function compareTargetFrustumEntries(left, right, options) {
  if (options.coarseFirst) {
    const levelDelta = left.node.level - right.node.level;
    if (levelDelta !== 0) return levelDelta;

    const forwardDelta = compareMetadataNumber(left, right, 'forwardDistancePc');
    if (forwardDelta !== 0) return forwardDelta;

    const distanceDelta = compareMetadataNumber(left, right, 'distancePc');
    if (distanceDelta !== 0) return distanceDelta;
  }

  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return createStarCellKey(left.node).localeCompare(createStarCellKey(right.node));
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 */
function createCurrentNodeSetSignature(entries) {
  return entries
    .filter((entry) => (entry.role ?? 'current') === 'current')
    .map((entry) => createStarCellKey(entry.node))
    .sort()
    .join('|');
}

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {string} key
 */
function compareMetadataNumber(left, right, key) {
  const leftValue = metadataNumber(left, key);
  const rightValue = metadataNumber(right, key);
  return leftValue === rightValue ? 0 : leftValue - rightValue;
}

/**
 * @param {StarOctreeDemandEntry} entry
 * @param {string} key
 */
function metadataNumber(entry, key) {
  const value = Number(entry.metadata?.[key]);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}
