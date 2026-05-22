import {
  compareStarCellPriority,
  createStarCellKey,
  createStrategyForVolumeRequest,
  normalizeStarCellStrategyView,
} from '@found-in-space/star-trees';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeCellStreamOptions} StarOctreeCellStreamOptions
 * @typedef {import('./index.d.ts').StarOctreeCellDelta} StarOctreeCellDelta
 * @typedef {import('./index.d.ts').StarOctreeProviderService} StarOctreeProviderService
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('@found-in-space/star-trees').StarCellDecision} StarCellDecision
 * @typedef {import('@found-in-space/star-trees').StarCellPriority} StarCellPriority
 * @typedef {import('@found-in-space/star-trees').StarCellStrategy} StarCellStrategy
 * @typedef {import('@found-in-space/star-trees').StarTreeVolumeRequest} StarTreeVolumeRequest
 * @typedef {import('./index.d.ts').WarmVolumeResult} WarmVolumeResult
 */

const DEFAULT_LIMITING_MAGNITUDE = 6.5;

/**
 * @param {{
 *   indexSource?: unknown;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
export async function planStarOctreeStrategyDemand(options) {
  return planEvaluatorDemand(options.context);
}

/**
 * @param {StarCellStrategy} strategy
 * @param {import('./index.d.ts').StarOctreeViewPatch | undefined} view
 */
export function normalizeStrategyView(strategy, view) {
  return normalizeStarCellStrategyView(strategy, view);
}

/**
 * @param {StarOctreeSelectionContext} context
 * @returns {Promise<StarOctreeDemandPlan>}
 */
async function planEvaluatorDemand(context) {
  const strategy = context.strategy;
  const anchor = context.strategyAnchor ?? strategy.createAnchor(context.view);
  const view = anchor.view;
  let indexMagnitude = DEFAULT_LIMITING_MAGNITUDE;
  let evaluator = strategy.createEvaluator(anchor, {
    indexMagnitude,
    role: context.traversalLane === 'prefetch' ? 'prefetch' : 'current',
  });

  const result = await context.traversal.select({
    distanceToNode: (node) => evaluator.distanceToCell?.(node) ?? 0,
    visit(node, { bootstrap, queuedDistancePc }) {
      if (indexMagnitude !== bootstrap.header.magLimit) {
        indexMagnitude = bootstrap.header.magLimit;
        evaluator = strategy.createEvaluator(anchor, {
          indexMagnitude,
          role: context.traversalLane === 'prefetch' ? 'prefetch' : 'current',
        });
      }

      return decisionToTraversalDecision(
        evaluator.evaluateCell(node, { queuedDistancePc }),
      );
    },
  });

  const entries = sortDemandEntries(result.entries, {
    coarseFirst: context.streaming?.coarseFirst !== false,
  });

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: collectReasons(entries),
    metadata: {
      selectedNodeCount: entries.length,
      inspectedNodeCount: result.stats.inspectedNodeCount,
      payloadNodeCount: result.stats.payloadNodeCount,
      prunedNodeCount: result.stats.prunedNodeCount,
      frontierShardCount: result.stats.frontierShardCount,
      maxLevelInspected: result.stats.maxLevelInspected,
      prefetchNodeCount: entries.filter((entry) => entry.role === 'prefetch').length,
      view,
    },
  };
}

/**
 * @param {StarCellDecision} decision
 */
function decisionToTraversalDecision(decision) {
  const priority = decision.priority;
  const role = /** @type {'current' | 'prefetch'} */ (
    priority?.lane === 'warm' ? 'prefetch' : 'current'
  );
  return {
    include: decision.include,
    emit: decision.emit,
    descend: decision.descend ?? decision.include,
    distancePc: decision.distancePc,
    priority: numericPriority(priority),
    relevance: decision.relevance,
    role,
    reasons: decision.reasons,
    metadata: {
      ...(decision.metadata ?? {}),
      semanticPriority: priority,
      ...(decision.contributors ? { strategyContributors: decision.contributors } : {}),
    },
  };
}

/**
 * @param {StarCellPriority | undefined} priority
 */
function numericPriority(priority) {
  if (!priority) return 0;
  const laneBase = priority.lane === 'live'
    ? 1e12
    : priority.lane === 'warm'
      ? 0
      : -1e12;
  return laneBase - (priority.band ?? 0) * 1e9 + (priority.score ?? 0);
}

/**
 * @param {StarOctreeProviderService} provider
 * @param {StarTreeVolumeRequest} request
 * @param {Omit<StarOctreeCellStreamOptions, 'strategy'>} [options]
 * @returns {AsyncIterable<StarOctreeCellDelta>}
 */
export function streamVolumeCells(provider, request, options = {}) {
  return provider.streamCells({
    ...options,
    strategy: createStrategyForVolumeRequest(request),
  });
}

/**
 * @param {StarOctreeProviderService} provider
 * @param {StarTreeVolumeRequest[]} requests
 * @param {Omit<StarOctreeCellStreamOptions, 'strategy'> & {
 *   onProgress?: (progress: import('./index.d.ts').WarmVolumeProgress) => void;
 * }} [options]
 * @returns {Promise<WarmVolumeResult>}
 */
export async function warmVolumeRequests(provider, requests, options = {}) {
  let cellCount = 0;
  let starCount = 0;
  let currentCount = 0;

  for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
    const request = requests[requestIndex];
    const result = await provider.warmCells({
      ...options,
      strategy: createStrategyForVolumeRequest(request),
      id: options.id
        ? `${options.id}:${requestIndex}`
        : undefined,
      streaming: {
        emitCachedFirst: true,
        ...options.streaming,
      },
    });
    options.onProgress?.({ request, requestIndex, result });
    cellCount += result.counts.payloadNodeCount;
    starCount += result.decodedStarCount;
    currentCount += 1;
  }

  return {
    requestCount: requests.length,
    cellCount,
    starCount,
    currentCount,
  };
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 */
function collectReasons(entries) {
  const reasons = dedupe(entries.flatMap((entry) => entry.reasons ?? []));
  return reasons.length > 0 ? reasons : ['strategy'];
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 */
function mergeDemandEntries(entries) {
  /** @type {Map<string, StarOctreeDemandEntry>} */
  const byCellKey = new Map();

  for (const entry of entries) {
    const cellKey = createStarCellKey(entry.node);
    const existing = byCellKey.get(cellKey);
    if (!existing) {
      byCellKey.set(cellKey, withContributor(entry));
      continue;
    }

    byCellKey.set(cellKey, mergeDemandEntry(existing, entry));
  }

  return Array.from(byCellKey.values());
}

/**
 * @param {StarOctreeDemandEntry} existing
 * @param {StarOctreeDemandEntry} next
 */
function mergeDemandEntry(existing, next) {
  const winner = compareEntryPrecedence(existing, next) <= 0 ? existing : next;
  const contributors = [
    ...metadataContributors(existing),
    createContributor(next),
  ];

  return {
    ...winner,
    reasons: dedupe([...(existing.reasons ?? []), ...(next.reasons ?? [])]),
    relevance: Math.max(existing.relevance ?? 0, next.relevance ?? 0),
    metadata: {
      ...(winner.metadata ?? {}),
      strategyContributors: contributors,
    },
  };
}

/**
 * @param {StarOctreeDemandEntry} entry
 */
function withContributor(entry) {
  return {
    ...entry,
    metadata: {
      ...(entry.metadata ?? {}),
      strategyContributors: metadataContributors(entry),
    },
  };
}

/**
 * @param {StarOctreeDemandEntry} entry
 */
function createContributor(entry) {
  return {
    role: entry.role ?? 'current',
    priority: entry.metadata?.semanticPriority,
    schedulerPriority: entry.priority,
    relevance: entry.relevance,
    reasons: entry.reasons ?? [],
    metadata: entry.metadata,
  };
}

/**
 * @param {StarOctreeDemandEntry} entry
 */
function metadataContributors(entry) {
  const contributors = entry.metadata?.strategyContributors;
  return Array.isArray(contributors)
    ? contributors
    : [createContributor(entry)];
}

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 */
function compareEntryPrecedence(left, right) {
  const roleDelta = roleOrder(left) - roleOrder(right);
  if (roleDelta !== 0) return roleDelta;
  const priorityDelta = compareEntryPriority(left, right);
  if (priorityDelta !== 0) return priorityDelta;
  return createStarCellKey(left.node).localeCompare(createStarCellKey(right.node));
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 * @param {{ coarseFirst: boolean }} options
 */
function sortDemandEntries(entries, options) {
  const cellKeyForEntry = createEntryCellKeyCache();
  return mergeDemandEntries(entries).sort((left, right) => {
    const roleDelta = roleOrder(left) - roleOrder(right);
    if (roleDelta !== 0) return roleDelta;

    const priorityDelta = compareEntryPriority(left, right);
    if (priorityDelta !== 0) return priorityDelta;

    if (options.coarseFirst) {
      const levelDelta = left.node.level - right.node.level;
      if (levelDelta !== 0) return levelDelta;

      const motionDelta = compareMetadataNumberDescending(left, right, 'motionPriorityBias');
      if (motionDelta !== 0) return motionDelta;

      const forwardDelta = compareMetadataNumber(left, right, 'forwardDistancePc');
      if (forwardDelta !== 0) return forwardDelta;

      const distanceDelta = compareMetadataNumber(left, right, 'distancePc');
      if (distanceDelta !== 0) return distanceDelta;
    }

    return cellKeyForEntry(left).localeCompare(cellKeyForEntry(right));
  });
}

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 */
function compareEntryPriority(left, right) {
  const semanticDelta = compareStarCellPriority(
    /** @type {StarCellPriority | undefined} */ (left.metadata?.semanticPriority),
    /** @type {StarCellPriority | undefined} */ (right.metadata?.semanticPriority),
  );
  if (semanticDelta !== 0) return semanticDelta;
  return (right.priority ?? 0) - (left.priority ?? 0);
}

/**
 * @param {StarOctreeDemandEntry} entry
 */
function roleOrder(entry) {
  return (entry.role ?? 'current') === 'current' ? 0 : 1;
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
 * @param {string[]} values
 */
function dedupe(values) {
  return Array.from(new Set(values));
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
