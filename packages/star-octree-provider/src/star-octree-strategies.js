import {
  createStarCellKey,
  createStarTreeStrategyEvaluator,
  createStrategyForVolumeRequest,
  normalizeStarTreeStrategyView,
  resolveMotionLookahead,
} from '@found-in-space/star-trees';
import { planObserverShellDemand } from './star-octree-observer-shell.js';
import { planTargetFrustumDemand } from './star-octree-target-frustum.js';
import {
  ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY,
  createStarOctreeError,
} from './star-octree-errors.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeCellStreamOptions} StarOctreeCellStreamOptions
 * @typedef {import('./index.d.ts').StarOctreeCellDelta} StarOctreeCellDelta
 * @typedef {import('./index.d.ts').StarOctreeProviderService} StarOctreeProviderService
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('@found-in-space/star-trees').StarTreeVolumeRequest} StarTreeVolumeRequest
 * @typedef {import('./index.d.ts').WarmVolumeResult} WarmVolumeResult
 * @typedef {import('@found-in-space/star-trees').StarTreeStrategy} StarTreeStrategy
 * @typedef {import('@found-in-space/star-trees').StarTreeStrategyEvaluation} StarTreeStrategyEvaluation
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
export async function planStarOctreeStrategyDemand(options) {
  const strategy = options.context.strategy;

  if (strategy.kind === 'observer-shell') {
    return planObserverShellDemand(options);
  }

  if (strategy.kind === 'target-frustum') {
    return planTargetFrustumDemand(options);
  }

  if (
    strategy.kind === 'sphere-volume' ||
    strategy.kind === 'path-volume' ||
    strategy.kind === 'composite'
  ) {
    return planEvaluatorDemand(options.context, strategy);
  }

  if (strategy.kind === 'motion-lookahead') {
    return planMotionLookaheadDemand(options.indexSource, options.context, strategy);
  }

  throw createUnsupportedStrategyError('unknown');
}

/**
 * @param {StarTreeStrategy} strategy
 * @param {import('./index.d.ts').StarOctreeViewPatch | undefined} view
 */
export function normalizeStrategyView(strategy, view) {
  return normalizeStarTreeStrategyView(strategy, view);
}

/**
 * @param {StarOctreeSelectionContext} context
 * @param {StarTreeStrategy} strategy
 * @returns {Promise<StarOctreeDemandPlan>}
 */
async function planEvaluatorDemand(context, strategy) {
  const view = normalizeStrategyView(strategy, context.view);
  let indexMagnitude = DEFAULT_LIMITING_MAGNITUDE;
  let evaluator = createStarTreeStrategyEvaluator({
    strategy,
    view,
    indexMagnitude,
    role: 'current',
  });

  const result = await context.traversal.select({
    distanceToNode: (node) => evaluator.distanceToCell(node),
    visit(node, { bootstrap, queuedDistancePc }) {
      if (indexMagnitude !== bootstrap.header.magLimit) {
        indexMagnitude = bootstrap.header.magLimit;
        evaluator = createStarTreeStrategyEvaluator({
          strategy,
          view,
          indexMagnitude,
          role: 'current',
        });
      }

      return evaluationToTraversalDecision(
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
    reasons: [strategy.kind],
    metadata: {
      strategy: strategy.kind,
      selectedNodeCount: entries.length,
      inspectedNodeCount: result.stats.inspectedNodeCount,
      payloadNodeCount: result.stats.payloadNodeCount,
      prunedNodeCount: result.stats.prunedNodeCount,
      frontierShardCount: result.stats.frontierShardCount,
      maxLevelInspected: result.stats.maxLevelInspected,
    },
  };
}

/**
 * @param {StarTreeStrategyEvaluation} evaluation
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
 * @param {StarOctreeIndexSource} indexSource
 * @param {StarOctreeSelectionContext} context
 * @param {Extract<StarTreeStrategy, { kind: 'motion-lookahead' }>} strategy
 */
async function planMotionLookaheadDemand(indexSource, context, strategy) {
  if (strategy.strategy.kind === 'motion-lookahead') {
    throw createUnsupportedStrategyError('nested motion-lookahead');
  }

  const currentContext = {
    ...context,
    strategy: strategy.strategy,
    view: {
      ...normalizeStrategyView(strategy.strategy, context.view),
      revision: context.viewRevision,
    },
  };
  const currentPlan = await planStarOctreeStrategyDemand({
    indexSource,
    context: currentContext,
  });
  const observerPc = normalizePoint(context.view.observerPc);
  const lookahead = resolveMotionLookahead(context.view.motion, observerPc);

  if (!lookahead.enabled || !lookahead.futureObserverPc) {
    return {
      ...currentPlan,
      metadata: {
        ...(currentPlan.metadata ?? {}),
        motionLookahead: {
          enabled: false,
          lookaheadSecs: lookahead.lookaheadSecs,
          lookaheadDistancePc: lookahead.lookaheadDistancePc,
          futureObserverPc: lookahead.futureObserverPc,
          prefetchNodeCount: 0,
          prefetchOverlapCount: 0,
        },
      },
    };
  }

  const futureView = {
    ...context.view,
    observerPc: lookahead.futureObserverPc,
    motion: undefined,
  };
  const futureContext = {
    ...context,
    strategy: strategy.strategy,
    view: {
      ...normalizeStrategyView(strategy.strategy, futureView),
      revision: context.viewRevision,
    },
  };
  const futurePlan = await planStarOctreeStrategyDemand({
    indexSource,
    context: futureContext,
  });
  const currentCellKeys = new Set(
    currentPlan.entries
      .filter((entry) => (entry.role ?? 'current') === 'current')
      .map((entry) => createStarCellKey(entry.node)),
  );
  let prefetchOverlapCount = 0;
  const prefetchEntries = [];

  for (const entry of futurePlan.entries) {
    if (currentCellKeys.has(createStarCellKey(entry.node))) {
      prefetchOverlapCount += 1;
      continue;
    }

    prefetchEntries.push({
      ...entry,
      role: /** @type {const} */ ('prefetch'),
      reasons: dedupe(['motion-lookahead', ...(entry.reasons ?? [])]),
      metadata: {
        ...(entry.metadata ?? {}),
        prefetchKind: 'motion-lookahead',
        baseStrategy: strategy.strategy.kind,
        futureObserverPc: lookahead.futureObserverPc,
        originalRole: entry.role ?? 'current',
      },
    });
  }

  const entries = sortDemandEntries(
    mergeDemandEntries([...currentPlan.entries, ...prefetchEntries]),
    { coarseFirst: context.streaming?.coarseFirst !== false },
  );

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: dedupe([...(currentPlan.reasons ?? []), 'motion-lookahead']),
    metadata: {
      ...(currentPlan.metadata ?? {}),
      motionLookahead: {
        enabled: true,
        baseStrategy: strategy.strategy.kind,
        lookaheadSecs: lookahead.lookaheadSecs,
        lookaheadDistancePc: lookahead.lookaheadDistancePc,
        futureObserverPc: lookahead.futureObserverPc,
        prefetchNodeCount: prefetchEntries.length,
        prefetchOverlapCount,
      },
      prefetchNodeCount: prefetchEntries.length,
      prefetchOverlapCount,
    },
  };
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
    for await (const delta of streamVolumeCells(provider, request, {
      ...options,
      id: options.id
        ? `${options.id}:${requestIndex}`
        : undefined,
      streaming: {
        batchMode: 'payload-range',
        ...options.streaming,
      },
    })) {
      options.onProgress?.({ request, requestIndex, delta });

      if (delta.type === 'stars/cells-upsert') {
        cellCount += delta.cells.length;
        starCount += delta.cells.reduce((sum, cell) => sum + cell.count, 0);
      } else if (delta.type === 'stars/current') {
        currentCount += 1;
      } else if (delta.type === 'stars/error') {
        throw new Error(delta.error?.message ?? 'Volume warm failed.');
      }
    }
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
      strategyContributors: [createContributor(entry)],
    },
  };
}

/**
 * @param {StarOctreeDemandEntry} entry
 */
function createContributor(entry) {
  return {
    strategy: String(entry.metadata?.strategy ?? entry.reasons?.[0] ?? 'unknown'),
    role: entry.role ?? 'current',
    priority: entry.priority,
    relevance: entry.relevance,
    reasons: entry.reasons ?? [],
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
  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return createStarCellKey(left.node).localeCompare(createStarCellKey(right.node));
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 * @param {{ coarseFirst: boolean }} options
 */
function sortDemandEntries(entries, options) {
  return [...entries].sort((left, right) => {
    const roleDelta = roleOrder(left) - roleOrder(right);
    if (roleDelta !== 0) return roleDelta;

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

    const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return createStarCellKey(left.node).localeCompare(createStarCellKey(right.node));
  });
}

/**
 * @param {StarOctreeDemandEntry} entry
 */
function roleOrder(entry) {
  return (entry.role ?? 'current') === 'current' ? 0 : 1;
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
 * @param {unknown} value
 */
function normalizePoint(value) {
  if (!value || typeof value !== 'object') {
    return { x: 0, y: 0, z: 0 };
  }

  const point = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : { x: 0, y: 0, z: 0 };
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
 * @param {string} kind
 * @returns {Error & { code: string }}
 */
function createUnsupportedStrategyError(kind) {
  return createStarOctreeError(
    ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY,
    `Star octree strategy "${kind}" is not supported yet.`,
  );
}
