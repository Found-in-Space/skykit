import { createStarCellKey } from '@found-in-space/star-trees';
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
const DEFAULT_TARGET_NEAR_PC = 0.01;
const GEOMETRY_EPSILON = 1e-9;
const TARGET_UP = Object.freeze({ x: 0, y: 0, z: 1 });
const TARGET_UP_FALLBACK = Object.freeze({ x: 0, y: 1, z: 0 });
const AABB_EDGE_INDICES = Object.freeze([
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
]);

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
      const visiblePoint = frustum.nearestVisiblePointToNode(node);

      if (!visiblePoint) {
        frustumPrunedNodeCount += 1;
        return {
          include: false,
          descend: false,
          distancePc: distanceToNodeAabbPc(options.view.observerPc, node),
        };
      }

      const distancePc = visiblePoint.distancePc;
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
          forwardDistancePc: visiblePoint.forwardDistancePc,
          nearestVisiblePc: visiblePoint.point,
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
      view.nearPc ?? strategy.nearPc ?? DEFAULT_TARGET_NEAR_PC,
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
    view.nearPc ?? strategy.nearPc ?? DEFAULT_TARGET_NEAR_PC,
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
     * @param {{ x: number; y: number; z: number }} point
     */
    containsPoint(point) {
      return containsPointInFrustum(point);
    },
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
    /**
     * Finds the nearest point in the intersection of this node's AABB and the
     * visible frustum. This is the visibility witness used by the magnitude
     * shell: if the brightest possible star in the node would not be visible at
     * this distance, no child can become visible either.
     *
     * @param {StarOctreeRuntimeNode} node
     * @returns {{ point: { x: number; y: number; z: number }; distancePc: number; forwardDistancePc: number } | null}
     */
    nearestVisiblePointToNode(node) {
      const bounds = createNodeBounds(node);
      const corners = createAabbCorners(bounds);
      /** @type {{ point: { x: number; y: number; z: number }; distancePc: number; forwardDistancePc: number } | null} */
      let nearest = null;

      /**
       * @param {{ x: number; y: number; z: number } | null} point
       */
      const addCandidate = (point) => {
        if (!point || !containsPointInAabb(point, bounds) || !containsPointInFrustum(point)) {
          return;
        }
        const relative = subtractVectors(point, view.observerPc);
        const distancePc = vectorLength(relative);
        const forwardDistancePc = dotVector(basis.forward, relative);
        if (!nearest || distancePc < nearest.distancePc) {
          nearest = {
            point,
            distancePc,
            forwardDistancePc,
          };
        }
      };

      addCandidate(closestPointOnAabb(view.observerPc, bounds));

      for (const corner of corners) {
        addCandidate(corner);
      }

      for (const [leftIndex, rightIndex] of AABB_EDGE_INDICES) {
        const clipped = clipSegmentToFrustum(corners[leftIndex], corners[rightIndex]);
        if (clipped) {
          addCandidate(closestPointOnSegment(
            view.observerPc,
            clipped.start,
            clipped.end,
          ));
        }
      }

      for (const ray of createFrustumBoundaryRays(view, basis, tanHorizontal, tanVertical)) {
        const clipped = clipRayToAabb(
          view.observerPc,
          ray,
          bounds,
        );
        if (clipped) {
          addCandidate(clipped);
        }
      }

      return nearest;
    },
  };

  /**
   * @param {{ x: number; y: number; z: number }} point
   */
  function containsPointInFrustum(point) {
    const relative = subtractVectors(point, view.observerPc);
    for (const plane of planes) {
      if (dotVector(plane.normal, relative) + plane.offset < -GEOMETRY_EPSILON) {
        return false;
      }
    }
    return true;
  }

  /**
   * @param {{ x: number; y: number; z: number }} start
   * @param {{ x: number; y: number; z: number }} end
   */
  function clipSegmentToFrustum(start, end) {
    const relativeStart = subtractVectors(start, view.observerPc);
    const direction = subtractVectors(end, start);
    let lower = 0;
    let upper = 1;

    for (const plane of planes) {
      const startDistance = dotVector(plane.normal, relativeStart) + plane.offset;
      const delta = dotVector(plane.normal, direction);

      if (Math.abs(delta) <= GEOMETRY_EPSILON) {
        if (startDistance < -GEOMETRY_EPSILON) {
          return null;
        }
        continue;
      }

      const crossing = -startDistance / delta;
      if (delta > 0) {
        lower = Math.max(lower, crossing);
      } else {
        upper = Math.min(upper, crossing);
      }

      if (lower - upper > GEOMETRY_EPSILON) {
        return null;
      }
    }

    return {
      start: addVectors(start, scaleVector(direction, clamp01(lower))),
      end: addVectors(start, scaleVector(direction, clamp01(upper))),
    };
  }
}

/**
 * @param {StarOctreeRuntimeNode} node
 */
function createNodeBounds(node) {
  return {
    minX: node.centerX - node.halfSize,
    minY: node.centerY - node.halfSize,
    minZ: node.centerZ - node.halfSize,
    maxX: node.centerX + node.halfSize,
    maxY: node.centerY + node.halfSize,
    maxZ: node.centerZ + node.halfSize,
  };
}

/**
 * @param {{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }} bounds
 */
function createAabbCorners(bounds) {
  return [
    { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
    { x: bounds.maxX, y: bounds.minY, z: bounds.minZ },
    { x: bounds.minX, y: bounds.maxY, z: bounds.minZ },
    { x: bounds.maxX, y: bounds.maxY, z: bounds.minZ },
    { x: bounds.minX, y: bounds.minY, z: bounds.maxZ },
    { x: bounds.maxX, y: bounds.minY, z: bounds.maxZ },
    { x: bounds.minX, y: bounds.maxY, z: bounds.maxZ },
    { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
  ];
}

/**
 * @param {{ x: number; y: number; z: number }} point
 * @param {{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }} bounds
 */
function containsPointInAabb(point, bounds) {
  return point.x >= bounds.minX - GEOMETRY_EPSILON &&
    point.x <= bounds.maxX + GEOMETRY_EPSILON &&
    point.y >= bounds.minY - GEOMETRY_EPSILON &&
    point.y <= bounds.maxY + GEOMETRY_EPSILON &&
    point.z >= bounds.minZ - GEOMETRY_EPSILON &&
    point.z <= bounds.maxZ + GEOMETRY_EPSILON;
}

/**
 * @param {{ x: number; y: number; z: number }} point
 * @param {{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }} bounds
 */
function closestPointOnAabb(point, bounds) {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, point.z)),
  };
}

/**
 * @param {{ x: number; y: number; z: number }} point
 * @param {{ x: number; y: number; z: number }} start
 * @param {{ x: number; y: number; z: number }} end
 */
function closestPointOnSegment(point, start, end) {
  const direction = subtractVectors(end, start);
  const lengthSquared = dotVector(direction, direction);
  if (lengthSquared <= GEOMETRY_EPSILON) {
    return start;
  }
  const offset = subtractVectors(point, start);
  const t = clamp01(dotVector(offset, direction) / lengthSquared);
  return addVectors(start, scaleVector(direction, t));
}

/**
 * @param {ReturnType<typeof normalizeTargetFrustumView>} view
 * @param {{ right: { x: number; y: number; z: number }; up: { x: number; y: number; z: number }; forward: { x: number; y: number; z: number } }} basis
 * @param {number} tanHorizontal
 * @param {number} tanVertical
 */
function createFrustumBoundaryRays(view, basis, tanHorizontal, tanVertical) {
  const offsets = [
    [0, 0],
    [tanHorizontal, 0],
    [-tanHorizontal, 0],
    [0, tanVertical],
    [0, -tanVertical],
    [tanHorizontal, tanVertical],
    [tanHorizontal, -tanVertical],
    [-tanHorizontal, tanVertical],
    [-tanHorizontal, -tanVertical],
  ];

  return offsets.map(([horizontal, vertical]) => {
    const direction = normalizeVector(addVectors(
      addVectors(
        basis.forward,
        scaleVector(basis.right, horizontal),
      ),
      scaleVector(basis.up, vertical),
    ));
    const forwardDot = dotVector(basis.forward, direction);
    const minDistancePc = forwardDot > GEOMETRY_EPSILON
      ? view.nearPc / forwardDot
      : 0;
    const maxDistancePc = view.farPc !== undefined && forwardDot > GEOMETRY_EPSILON
      ? view.farPc / forwardDot
      : undefined;
    return {
      direction,
      minDistancePc,
      maxDistancePc,
    };
  });
}

/**
 * @param {{ x: number; y: number; z: number }} origin
 * @param {{
 *   direction: { x: number; y: number; z: number };
 *   minDistancePc: number;
 *   maxDistancePc?: number;
 * }} ray
 * @param {{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }} bounds
 */
function clipRayToAabb(origin, ray, bounds) {
  let lower = ray.minDistancePc;
  let upper = ray.maxDistancePc ?? Number.POSITIVE_INFINITY;

  const axes = [
    { axis: /** @type {'x'} */ ('x'), min: bounds.minX, max: bounds.maxX },
    { axis: /** @type {'y'} */ ('y'), min: bounds.minY, max: bounds.maxY },
    { axis: /** @type {'z'} */ ('z'), min: bounds.minZ, max: bounds.maxZ },
  ];

  for (const { axis, min, max } of axes) {
    const direction = ray.direction[axis];
    const start = origin[axis];

    if (Math.abs(direction) <= GEOMETRY_EPSILON) {
      if (start < min - GEOMETRY_EPSILON || start > max + GEOMETRY_EPSILON) {
        return null;
      }
      continue;
    }

    const first = (min - start) / direction;
    const second = (max - start) / direction;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));

    if (lower - upper > GEOMETRY_EPSILON) {
      return null;
    }
  }

  if (!Number.isFinite(lower) || lower < -GEOMETRY_EPSILON) {
    return null;
  }

  return addVectors(origin, scaleVector(ray.direction, Math.max(0, lower)));
}

/**
 * @param {number} value
 */
function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
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
