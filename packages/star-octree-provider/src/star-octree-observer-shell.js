import { createStarCellKey } from '@found-in-space/star-trees';
import { distanceToNodeAabbPc } from './star-octree-traversal.js';

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
  const observerPc = normalizePoint(
    options.context.view.observerPc,
    DEFAULT_OBSERVER_PC,
  );
  const limitingMagnitude = normalizeFiniteNumber(
    options.context.view.limitingMagnitude,
    DEFAULT_LIMITING_MAGNITUDE,
  );
  const motion = resolveMotionPriorityContext(options.context.view.motion);
  const currentResult = await collectObserverShellEntries({
    context: options.context,
    observerPc,
    limitingMagnitude,
    motion,
    role: 'current',
  });
  const entries = [...currentResult.entries];

  entries.sort((left, right) =>
    compareObserverShellEntries(left, right, {
      coarseFirst: options.context.streaming?.coarseFirst !== false,
    }),
  );

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: ['observer-shell'],
    metadata: {
      strategy: 'observer-shell',
      observerPc,
      limitingMagnitude,
      indexMagnitude: currentResult.indexMagnitude,
      inspectedNodeCount: currentResult.stats.inspectedNodeCount,
      selectedNodeCount: currentResult.stats.selectedNodeCount,
      payloadNodeCount: currentResult.stats.payloadNodeCount,
      prunedNodeCount: currentResult.stats.prunedNodeCount,
      motion,
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
 *   observerPc: { x: number; y: number; z: number };
 *   currentObserverPc?: { x: number; y: number; z: number };
 *   limitingMagnitude: number;
 *   motion: ReturnType<typeof resolveMotionPriorityContext>;
 *   role: 'current' | 'prefetch';
 * }} options
 */
async function collectObserverShellEntries(options) {
  let indexMagnitude = DEFAULT_LIMITING_MAGNITUDE;
  const result = await options.context.traversal.select({
    distanceToNode: (node) => distanceToNodeAabbPc(options.observerPc, node),
    visit(node, { bootstrap }) {
      indexMagnitude = bootstrap.header.magLimit;
      const distancePc = distanceToNodeAabbPc(options.observerPc, node);
      const loadRadiusPc = loadRadiusForMagnitudeShell(
        node.halfSize,
        options.limitingMagnitude,
        indexMagnitude,
      );
      const include = distancePc <= loadRadiusPc;
      const motionScore = include
        ? scoreMotionPriority({
            node,
            observerPc: options.currentObserverPc ?? options.observerPc,
            motion: options.role === 'current'
              ? options.motion
              : { ...options.motion, enabled: false },
          })
        : null;

      return {
        include,
        descend: include,
        distancePc,
        priority: -distancePc + (motionScore?.motionPriorityBias ?? 0),
        role: options.role,
        reasons: [
          options.role === 'current'
            ? 'observer-shell'
            : 'motion-lookahead',
        ],
        metadata: {
          distancePc,
          loadRadiusPc,
          limitingMagnitude: options.limitingMagnitude,
          indexMagnitude,
          ...(options.role === 'prefetch'
            ? {
                prefetchKind: 'motion-lookahead',
                futureObserverPc: options.observerPc,
              }
            : {}),
          ...(motionScore ?? {}),
        },
      };
    },
  });

  return { entries: result.entries, stats: result.stats, indexMagnitude };
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
