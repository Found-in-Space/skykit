import { STAR_HAS_PAYLOAD } from './star-octree-format.js';
import {
  distanceToNodeAabbPc,
  traverseOctree,
} from './star-octree-traversal.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LIMITING_MAGNITUDE = 6.5;

/**
 * @param {number} halfSize
 * @param {number} limitingMagnitude
 * @param {number} indexMagnitude
 */
export function loadRadiusForMagnitudeShell(
  halfSize,
  limitingMagnitude,
  indexMagnitude,
) {
  return halfSize * 10 ** ((limitingMagnitude - indexMagnitude) / 5);
}

/**
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
export async function planObserverShellDemand(options) {
  const bootstrap = await options.indexSource.ensureBootstrapLoaded();
  const observerPc = normalizePoint(
    options.context.view.observerPc,
    DEFAULT_OBSERVER_PC,
  );
  const limitingMagnitude = normalizeFiniteNumber(
    options.context.view.limitingMagnitude,
    DEFAULT_LIMITING_MAGNITUDE,
  );
  const indexMagnitude = bootstrap.header.magLimit;
  const motion = resolveMotionPriorityContext(options.context.view.motion);
  /** @type {StarOctreeDemandEntry[]} */
  const entries = [];

  const traversal = await traverseOctree({
    indexSource: options.indexSource,
    bootstrap,
    distanceToNode: (node) => distanceToNodeAabbPc(observerPc, node),
    visitor(node) {
      const distancePc = distanceToNodeAabbPc(observerPc, node);
      const loadRadiusPc = loadRadiusForMagnitudeShell(
        node.halfSize,
        limitingMagnitude,
        indexMagnitude,
      );
      const include = distancePc <= loadRadiusPc;

      if (
        include &&
        (node.flags & STAR_HAS_PAYLOAD) &&
        node.payloadLength > 0
      ) {
        const motionScore = scoreMotionPriority({
          node,
          observerPc,
          motion,
        });
        entries.push({
          node,
          priority: -distancePc + (motionScore?.motionPriorityBias ?? 0),
          role: 'current',
          reasons: ['observer-shell'],
          metadata: {
            distancePc,
            loadRadiusPc,
            limitingMagnitude,
            indexMagnitude,
            ...(motionScore ?? {}),
          },
        });
      }

      return {
        include,
        descend: include,
        distancePc,
      };
    },
  });

  entries.sort((left, right) =>
    compareObserverShellEntries(left, right, {
      coarseFirst: options.context.streaming?.coarseFirst !== false,
    }),
  );

  return {
    entries,
    signature: createNodeSetSignature(entries),
    reasons: ['observer-shell'],
    metadata: {
      strategy: 'observer-shell',
      observerPc,
      limitingMagnitude,
      indexMagnitude,
      inspectedNodeCount: traversal.stats.inspectedNodeCount,
      selectedNodeCount: traversal.stats.selectedNodeCount,
      payloadNodeCount: traversal.stats.payloadNodeCount,
      prunedNodeCount: traversal.stats.prunedNodeCount,
      motion,
      frontierShardCount: traversal.stats.frontierShardCount,
      maxLevelInspected: traversal.stats.maxLevelInspected,
    },
  };
}

/**
 * @param {StarOctreeViewPatch | undefined} view
 */
export function normalizeObserverShellView(view = {}) {
  const observerPc = normalizePoint(view.observerPc, DEFAULT_OBSERVER_PC);
  const limitingMagnitude = normalizeFiniteNumber(
    view.limitingMagnitude ?? view.mDesired,
    DEFAULT_LIMITING_MAGNITUDE,
  );

  return {
    ...view,
    observerPc,
    limitingMagnitude,
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
 * @param {StarOctreeSelectionContext['view']['motion']} motion
 */
function resolveMotionPriorityContext(motion) {
  const speedPcPerSec = resolveMotionSpeed(motion);
  const lookaheadSecs = normalizeFiniteNumber(
    motion?.lookaheadSecs,
    0,
  );
  const velocityDirection = resolveMotionDirection(motion);

  if (!(speedPcPerSec > 0) || !(lookaheadSecs > 0)) {
    return {
      enabled: false,
      speedPcPerSec,
      lookaheadSecs,
      lookaheadDistancePc: 0,
      velocityDirection,
    };
  }

  const lookaheadDistancePc = speedPcPerSec * lookaheadSecs;

  return {
    enabled: true,
    speedPcPerSec,
    lookaheadSecs,
    lookaheadDistancePc,
    velocityDirection,
  };
}

/**
 * @param {StarOctreeSelectionContext['view']['motion']} motion
 */
function resolveMotionSpeed(motion) {
  const explicitSpeed = Number(motion?.speedPcPerSec);
  if (Number.isFinite(explicitSpeed) && explicitSpeed > 0) {
    return explicitSpeed;
  }

  const velocity = motion?.velocityPcPerSec;
  if (!velocity) {
    return 0;
  }

  const x = Number(velocity.x);
  const y = Number(velocity.y);
  const z = Number(velocity.z);
  const speed = Math.hypot(x, y, z);
  return Number.isFinite(speed) ? speed : 0;
}

/**
 * @param {StarOctreeSelectionContext['view']['motion']} motion
 */
function resolveMotionDirection(motion) {
  const velocity = motion?.velocityPcPerSec;
  if (!velocity) {
    return null;
  }

  const x = Number(velocity.x);
  const y = Number(velocity.y);
  const z = Number(velocity.z);
  const length = Math.hypot(x, y, z);
  if (!(length > 0) || !Number.isFinite(length)) {
    return null;
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length,
  };
}

/**
 * @param {{
 *   node: import('./index.d.ts').StarOctreeRuntimeNode;
 *   observerPc: { x: number; y: number; z: number };
 *   motion: ReturnType<typeof resolveMotionPriorityContext>;
 * }} options
 */
function scoreMotionPriority(options) {
  if (!options.motion.enabled) {
    return null;
  }

  const metadata = {
    motionPriorityBias: 0,
    motionLookaheadDistancePc: options.motion.lookaheadDistancePc,
  };
  const direction = options.motion.velocityDirection;
  if (!direction) {
    return metadata;
  }

  const deltaX = options.node.centerX - options.observerPc.x;
  const deltaY = options.node.centerY - options.observerPc.y;
  const deltaZ = options.node.centerZ - options.observerPc.z;
  const centerDistancePc = Math.hypot(deltaX, deltaY, deltaZ);
  const forwardDistancePc =
    deltaX * direction.x + deltaY * direction.y + deltaZ * direction.z;
  const lateralDistancePc = Math.max(
    0,
    Math.sqrt(Math.max(0, centerDistancePc ** 2 - forwardDistancePc ** 2)) -
      options.node.halfSize,
  );
  const lookaheadErrorPc = Math.abs(
    forwardDistancePc - options.motion.lookaheadDistancePc,
  );
  const behindPenaltyPc =
    forwardDistancePc < 0
      ? Math.abs(forwardDistancePc) + options.motion.lookaheadDistancePc
      : 0;
  const motionPriorityBias = -(
    lateralDistancePc +
    lookaheadErrorPc * 0.25 +
    behindPenaltyPc
  );

  return {
    ...metadata,
    motionPriorityBias,
    motionForwardDistancePc: forwardDistancePc,
    motionLateralDistancePc: lateralDistancePc,
    motionLookaheadErrorPc: lookaheadErrorPc,
    motionBehindPenaltyPc: behindPenaltyPc,
  };
}

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {{ coarseFirst: boolean }} options
 */
function compareObserverShellEntries(left, right, options) {
  if (options.coarseFirst) {
    const levelDelta = left.node.level - right.node.level;
    if (levelDelta !== 0) return levelDelta;
    const motionDelta = compareMetadataNumberDescending(
      left,
      right,
      'motionPriorityBias',
    );
    if (motionDelta !== 0) return motionDelta;
    const distanceDelta = compareMetadataNumber(left, right, 'distancePc');
    if (distanceDelta !== 0) return distanceDelta;
  }

  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return left.node.nodeKey.localeCompare(right.node.nodeKey);
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 */
function createNodeSetSignature(entries) {
  return entries
    .map((entry) => entry.node.nodeKey)
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
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {string} key
 */
function compareMetadataNumberDescending(left, right, key) {
  const leftValue = optionalMetadataNumber(left, key);
  const rightValue = optionalMetadataNumber(right, key);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  return leftValue === rightValue ? 0 : rightValue - leftValue;
}

/**
 * @param {StarOctreeDemandEntry} entry
 * @param {string} key
 */
function metadataNumber(entry, key) {
  const value = Number(entry.metadata?.[key]);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * @param {StarOctreeDemandEntry} entry
 * @param {string} key
 */
function optionalMetadataNumber(entry, key) {
  const value = Number(entry.metadata?.[key]);
  return Number.isFinite(value) ? value : null;
}
