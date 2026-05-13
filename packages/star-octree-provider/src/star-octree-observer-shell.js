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
const DEFAULT_MOTION_MIN_LEVEL = 1;

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
  const motion = resolveMotionAdaptiveTraversal({
    view: options.context.view,
    bootstrap,
    limitingMagnitude,
    indexMagnitude,
  });
  /** @type {StarOctreeDemandEntry[]} */
  const entries = [];
  let motionCappedNodeCount = 0;

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
      const motionCapped =
        include &&
        motion.adaptiveMaxLevel !== null &&
        node.level >= motion.adaptiveMaxLevel &&
        node.childMask !== 0;

      if (
        include &&
        (node.flags & STAR_HAS_PAYLOAD) &&
        node.payloadLength > 0
      ) {
        entries.push({
          node,
          priority: -distancePc,
          role: 'current',
          reasons: ['observer-shell'],
          metadata: {
            distancePc,
            loadRadiusPc,
            limitingMagnitude,
            indexMagnitude,
            ...(motion.enabled
              ? {
                  motionAdaptiveMaxLevel: motion.adaptiveMaxLevel,
                  motionLookaheadDistancePc: motion.lookaheadDistancePc,
                }
              : {}),
          },
        });
      }

      if (motionCapped) {
        motionCappedNodeCount += 1;
      }

      return {
        include,
        descend: include && !motionCapped,
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
    signature: entries.map((entry) => entry.node.nodeKey).join('|'),
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
      motionCappedNodeCount,
      motionAdaptive: motion,
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
 * @param {{
 *   view: StarOctreeSelectionContext['view'];
 *   bootstrap: import('./index.d.ts').StarOctreeBootstrapProduct;
 *   limitingMagnitude: number;
 *   indexMagnitude: number;
 * }} options
 */
function resolveMotionAdaptiveTraversal(options) {
  const speedPcPerSec = resolveMotionSpeed(options.view.motion);
  const lookaheadSecs = normalizeFiniteNumber(
    options.view.motion?.lookaheadSecs,
    0,
  );

  if (!(speedPcPerSec > 0) || !(lookaheadSecs > 0)) {
    return {
      enabled: false,
      speedPcPerSec,
      lookaheadSecs,
      lookaheadDistancePc: 0,
      adaptiveMaxLevel: null,
      sourceMaxLevel: options.bootstrap.header.maxLevel,
    };
  }

  const lookaheadDistancePc = speedPcPerSec * lookaheadSecs;
  const visibilityScale = 10 ** (
    (options.limitingMagnitude - options.indexMagnitude) / 5
  );
  const levelRatio =
    (options.bootstrap.header.worldHalfSize * visibilityScale) /
    lookaheadDistancePc;
  const rawLevel =
    levelRatio > 0 && Number.isFinite(levelRatio)
      ? Math.floor(Math.log2(levelRatio))
      : DEFAULT_MOTION_MIN_LEVEL;
  const adaptiveMaxLevel = Math.max(DEFAULT_MOTION_MIN_LEVEL, rawLevel);

  return {
    enabled: true,
    speedPcPerSec,
    lookaheadSecs,
    lookaheadDistancePc,
    visibilityScale,
    adaptiveMaxLevel,
    sourceMaxLevel: options.bootstrap.header.maxLevel,
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
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {{ coarseFirst: boolean }} options
 */
function compareObserverShellEntries(left, right, options) {
  if (options.coarseFirst) {
    const levelDelta = left.node.level - right.node.level;
    if (levelDelta !== 0) return levelDelta;
    const distanceDelta = compareMetadataNumber(left, right, 'distancePc');
    if (distanceDelta !== 0) return distanceDelta;
  }

  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return left.node.nodeKey.localeCompare(right.node.nodeKey);
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
