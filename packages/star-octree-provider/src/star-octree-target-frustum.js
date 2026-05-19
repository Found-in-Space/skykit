import {
  createStarCellKey,
  createStarTreeStrategyEvaluator,
  distanceToCellAabbPc,
  normalizeTargetFrustumView,
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
export async function planTargetFrustumDemand(options) {
  const view = normalizeTargetFrustumView(
    options.context.view,
    /** @type {import('@found-in-space/star-trees').StarTreeTargetFrustumStrategy} */ (options.context.strategy),
  );
  let indexMagnitude = DEFAULT_LIMITING_MAGNITUDE;
  let shellPrunedNodeCount = 0;
  let frustumPrunedNodeCount = 0;
  /** @type {import('@found-in-space/star-trees').StarTreeStrategyEvaluator | null} */
  let evaluator = null;
  const getEvaluator = () => {
    if (!evaluator) {
      evaluator = createStarTreeStrategyEvaluator({
        strategy: options.context.strategy,
        view,
        indexMagnitude,
        role: 'current',
      });
    }
    return evaluator;
  };
  const targetDistancePc = 'targetDistancePc' in view
    ? view.targetDistancePc
    : undefined;

  const result = await options.context.traversal.select({
    distanceToNode: (node) => distanceToCellAabbPc(view.observerPc, node),
    visit(node, { bootstrap, queuedDistancePc }) {
      if (!evaluator) {
        indexMagnitude = bootstrap.header.magLimit;
      }
      const evaluation = getEvaluator().evaluateCell(node, { queuedDistancePc });
      if (!evaluation.relevant && evaluation.metadata?.frustumRejected) {
        frustumPrunedNodeCount += 1;
      } else if (!evaluation.relevant && evaluation.metadata?.shellRejected) {
        shellPrunedNodeCount += 1;
      }
      return evaluationToTraversalDecision(evaluation);
    },
  });
  const entries = [...result.entries];

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
      indexMagnitude,
      frustumMode: view.frustumMode,
      ...(view.targetPc ? { targetPc: view.targetPc } : {}),
      ...(targetDistancePc !== undefined ? { targetDistancePc } : {}),
      inspectedNodeCount: result.stats.inspectedNodeCount,
      selectedNodeCount: result.stats.selectedNodeCount,
      payloadNodeCount: result.stats.payloadNodeCount,
      prunedNodeCount: result.stats.prunedNodeCount,
      shellPrunedNodeCount,
      frustumPrunedNodeCount,
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
