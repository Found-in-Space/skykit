import {
  createStarCellKey,
  createStarTreeStrategyEvaluator,
  distanceToCellAabbPc,
  normalizeObserverShellView,
} from '@found-in-space/star-trees';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

const DEFAULT_LIMITING_MAGNITUDE = 6.5;

/**
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
export async function planObserverShellDemand(options) {
  const view = normalizeObserverShellView(options.context.view);
  let indexMagnitude = DEFAULT_LIMITING_MAGNITUDE;
  /** @type {import('@found-in-space/star-trees').StarTreeStrategyEvaluator | null} */
  let evaluator = null;
  const getEvaluator = () => {
    if (!evaluator) {
      evaluator = createStarTreeStrategyEvaluator({
        strategy: { kind: 'observer-shell' },
        view,
        indexMagnitude,
        role: 'current',
      });
    }
    return evaluator;
  };

  const result = await options.context.traversal.select({
    distanceToNode: (node) => distanceToCellAabbPc(view.observerPc, node),
    visit(node, { bootstrap, queuedDistancePc }) {
      if (!evaluator) {
        indexMagnitude = bootstrap.header.magLimit;
      }
      const evaluation = getEvaluator().evaluateCell(node, { queuedDistancePc });
      return evaluationToTraversalDecision(evaluation);
    },
  });
  const entries = [...result.entries];
  const cellKeyForEntry = createEntryCellKeyCache();

  entries.sort((left, right) =>
    compareObserverShellEntries(left, right, {
      coarseFirst: options.context.streaming?.coarseFirst !== false,
      cellKeyForEntry,
    }),
  );

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: ['observer-shell'],
    metadata: {
      strategy: 'observer-shell',
      observerPc: view.observerPc,
      limitingMagnitude: view.limitingMagnitude,
      indexMagnitude,
      motion: createMotionSummary(view.motion),
      inspectedNodeCount: result.stats.inspectedNodeCount,
      selectedNodeCount: result.stats.selectedNodeCount,
      payloadNodeCount: result.stats.payloadNodeCount,
      prunedNodeCount: result.stats.prunedNodeCount,
      prefetchNodeCount: 0,
      prefetchOverlapCount: 0,
      frontierShardCount: result.stats.frontierShardCount,
      maxLevelInspected: result.stats.maxLevelInspected,
    },
  };
}

/**
 * @param {import('@found-in-space/star-trees').StarTreeStrategyEvaluation} evaluation
 */
function evaluationToTraversalDecision(evaluation) {
  return {
    include: evaluation.relevant,
    emit: evaluation.emit,
    descend: evaluation.descend ?? evaluation.relevant,
    distancePc: evaluation.distancePc,
    priority: evaluation.priority,
    relevance: evaluation.relevance,
    role: evaluation.role,
    reasons: evaluation.reasons,
    metadata: evaluation.metadata,
  };
}

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {{
 *   coarseFirst: boolean;
 *   cellKeyForEntry: (entry: StarOctreeDemandEntry) => string;
 * }} options
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
  return options.cellKeyForEntry(left).localeCompare(options.cellKeyForEntry(right));
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

function createEntryCellKeyCache() {
  /** @type {WeakMap<StarOctreeDemandEntry, string>} */
  const cache = new WeakMap();
  /** @type {(entry: StarOctreeDemandEntry) => string} */
  const cellKeyForEntry = (entry) => {
    let cellKey = cache.get(entry);
    if (!cellKey) {
      cellKey = createStarCellKey(entry.node);
      cache.set(entry, cellKey);
    }
    return cellKey;
  };
  return cellKeyForEntry;
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

/**
 * @param {import('@found-in-space/star-trees').StarTreeViewPatch['motion']} motion
 */
function createMotionSummary(motion) {
  const velocity = motion?.velocityPcPerSec;
  const explicitSpeed = Number(motion?.speedPcPerSec);
  const velocitySpeed = velocity
    ? Math.hypot(Number(velocity.x), Number(velocity.y), Number(velocity.z))
    : 0;
  const speedPcPerSec = Number.isFinite(explicitSpeed) && explicitSpeed > 0
    ? explicitSpeed
    : (Number.isFinite(velocitySpeed) ? velocitySpeed : 0);
  const lookaheadSecs = Number(motion?.lookaheadSecs);
  const normalizedLookaheadSecs = Number.isFinite(lookaheadSecs) && lookaheadSecs > 0
    ? lookaheadSecs
    : 0;

  return {
    enabled: speedPcPerSec > 0 && normalizedLookaheadSecs > 0,
    speedPcPerSec,
    lookaheadSecs: normalizedLookaheadSecs,
    lookaheadDistancePc: speedPcPerSec * normalizedLookaheadSecs,
  };
}
