import {
  createStarCellKey,
  createStarTreeStrategyEvaluator,
  distanceToCellAabbPc,
  loadRadiusForMagnitudeShell,
  normalizeObserverShellView,
} from '@found-in-space/star-trees';
import { STAR_HAS_PAYLOAD } from './star-octree-format.js';
import {
  createTraversalStats,
  readChildNodes,
} from './star-octree-traversal.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

/**
 * Provider-internal cache for observer-shell demand planning. Each cached
 * subtree stores the entries emitted during its last traversal and the maximum
 * observer displacement that can occur before any included/excluded shell
 * decision inside that subtree may need to change.
 *
 * @typedef {{
 *   entries: StarOctreeDemandEntry[];
 *   subtreeSafeMovePc: number;
 * }} ObserverShellCachedSubtree
 *
 * @typedef {{
 *   kind: 'observer-shell-cache';
 *   observerPc: { x: number; y: number; z: number };
 *   limitingMagnitude: number;
 *   indexMagnitude: number;
 *   subtrees: Map<string, ObserverShellCachedSubtree>;
 * }} ObserverShellPlannerCache
 */

const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const OBSERVER_SHELL_MARGIN_EPSILON_PC = 1e-9;

/**
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
export async function planObserverShellDemand(options) {
  if (!hasObserverShellIndexSource(options.indexSource)) {
    return planObserverShellDemandWithTraversalContext(options);
  }

  const view = normalizeObserverShellView(options.context.view);
  const bootstrap = await options.indexSource.ensureBootstrapLoaded();
  const root = await options.indexSource.ensureRootShardLoaded();
  const traversalLane = resolveTraversalLane(options.context);
  const indexMagnitude = Number.isFinite(bootstrap.header.magLimit)
    ? bootstrap.header.magLimit
    : DEFAULT_LIMITING_MAGNITUDE;
  const evaluator = createStarTreeStrategyEvaluator({
    strategy: { kind: 'observer-shell' },
    view,
    indexMagnitude,
    role: 'current',
  });
  const previousCache = normalizeObserverShellCache(
    options.context.plannerCache,
    view,
    indexMagnitude,
  );
  const nextCache = createObserverShellCache(view, indexMagnitude);
  const stats = createTraversalStats();
  const reuseStats = {
    reusedSubtreeCount: 0,
    reEvaluatedBoundaryCount: 0,
    newEntryCount: 0,
  };
  /** @type {StarOctreeDemandEntry[]} */
  const entries = [];

  for (const nodeIndex of root.shard.header.entryNodes) {
    if (nodeIndex <= 0) continue;
    const node = root.shard.readRuntimeNode(bootstrap.header, nodeIndex);
    const cached = await planNode(node, distanceToCellAabbPc(view.observerPc, node));
    entries.push(...cached.entries);
  }

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
    plannerCache: nextCache,
    metadata: {
      strategy: 'observer-shell',
      observerPc: view.observerPc,
      limitingMagnitude: view.limitingMagnitude,
      indexMagnitude,
      motion: createMotionSummary(view.motion),
      inspectedNodeCount: stats.inspectedNodeCount,
      selectedNodeCount: stats.selectedNodeCount,
      payloadNodeCount: stats.payloadNodeCount,
      prunedNodeCount: stats.prunedNodeCount,
      prefetchNodeCount: 0,
      prefetchOverlapCount: 0,
      frontierShardCount: stats.frontierShardCount,
      maxLevelInspected: stats.maxLevelInspected,
      observerShellCache: reuseStats,
    },
  };

  /**
   * @param {import('./index.d.ts').StarOctreeRuntimeNode} node
   * @param {number} queuedDistancePc
   * @returns {Promise<ObserverShellCachedSubtree>}
   */
  async function planNode(node, queuedDistancePc) {
    throwIfAborted(options.context.signal);
    const cellKey = createStarCellKey(node);
    stats.inspectedNodeCount += 1;
    stats.maxLevelInspected = stats.maxLevelInspected == null
      ? node.level
      : Math.max(stats.maxLevelInspected, node.level);

    const previous = previousCache?.subtrees.get(cellKey);
    const movedPc = previousCache
      ? pointDistance(previousCache.observerPc, view.observerPc)
      : Number.POSITIVE_INFINITY;
    if (previous && movedPc <= previous.subtreeSafeMovePc) {
      reuseStats.reusedSubtreeCount += 1;
      const reused = {
        ...previous,
        subtreeSafeMovePc: Math.max(0, previous.subtreeSafeMovePc - movedPc),
        entries: previous.entries.map(cloneDemandEntry),
      };
      nextCache.subtrees.set(cellKey, reused);
      if (reused.entries.length > 0) {
        stats.selectedNodeCount += 1;
        stats.payloadNodeCount += reused.entries.length;
      } else {
        stats.prunedNodeCount += 1;
      }
      return reused;
    }
    if (previous) {
      reuseStats.reEvaluatedBoundaryCount += 1;
    }

    const evaluation = evaluator.evaluateCell(node, { queuedDistancePc });
    const decision = evaluationToTraversalDecision(evaluation);
    const nodeSafeMovePc = computeObserverShellSafeMovePc(
      node,
      queuedDistancePc,
      view.limitingMagnitude,
      indexMagnitude,
    );
    /** @type {StarOctreeDemandEntry[]} */
    const nodeEntries = [];
    let subtreeSafeMovePc = nodeSafeMovePc;

    if (!decision.include) {
      stats.prunedNodeCount += 1;
      const cached = createCachedSubtree(nodeEntries, subtreeSafeMovePc);
      nextCache.subtrees.set(cellKey, cached);
      return cached;
    }

    stats.selectedNodeCount += 1;
    if (
      decision.emit !== false &&
      (node.flags & STAR_HAS_PAYLOAD) &&
      node.payloadLength > 0
    ) {
      nodeEntries.push({
        node,
        priority: decision.priority,
        relevance: decision.relevance,
        role: decision.role ?? 'current',
        reasons: decision.reasons,
        metadata: decision.metadata,
      });
      stats.payloadNodeCount += 1;
      reuseStats.newEntryCount += 1;
    }

    if (decision.descend && node.childMask !== 0) {
      const children = await readChildNodes(
        options.indexSource,
        bootstrap,
        node,
        stats,
        {
          lane: traversalLane,
          signal: options.context.signal,
        },
      );
      for (const child of children) {
        const childCached = await planNode(
          child,
          distanceToCellAabbPc(view.observerPc, child),
        );
        nodeEntries.push(...childCached.entries);
        subtreeSafeMovePc = Math.min(subtreeSafeMovePc, childCached.subtreeSafeMovePc);
      }
    }

    const cached = createCachedSubtree(nodeEntries, subtreeSafeMovePc);
    nextCache.subtrees.set(cellKey, cached);
    return cached;
  }

  /**
   * @param {StarOctreeDemandEntry[]} nodeEntries
   * @param {number} subtreeSafeMovePc
   * @returns {ObserverShellCachedSubtree}
   */
  function createCachedSubtree(nodeEntries, subtreeSafeMovePc) {
    return {
      entries: nodeEntries.map(cloneDemandEntry),
      subtreeSafeMovePc: Math.max(0, finiteNumber(subtreeSafeMovePc, 0)),
    };
  }
}

/**
 * Compatibility path for strategy unit tests and custom callers that still
 * provide only the older traversal facade rather than a provider index source.
 *
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
async function planObserverShellDemandWithTraversalContext(options) {
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
      observerShellCache: {
        reusedSubtreeCount: 0,
        reEvaluatedBoundaryCount: 0,
        newEntryCount: entries.length,
      },
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

/**
 * @param {unknown} indexSource
 * @returns {indexSource is StarOctreeIndexSource}
 */
function hasObserverShellIndexSource(indexSource) {
  const source = /** @type {{
   *   ensureBootstrapLoaded?: unknown;
   *   ensureRootShardLoaded?: unknown;
   *   loadShard?: unknown;
   * }} */ (indexSource);
  return typeof source?.ensureBootstrapLoaded === 'function' &&
    typeof source.ensureRootShardLoaded === 'function' &&
    typeof source.loadShard === 'function';
}

/**
 * @param {StarOctreeSelectionContext} context
 * @returns {'current' | 'replacement' | 'prefetch'}
 */
function resolveTraversalLane(context) {
  const lane = /** @type {{ traversalLane?: unknown }} */ (context).traversalLane;
  return lane === 'prefetch' || lane === 'replacement' ? lane : 'current';
}

/**
 * @param {unknown} input
 * @param {ReturnType<typeof normalizeObserverShellView>} view
 * @param {number} indexMagnitude
 * @returns {ObserverShellPlannerCache | null}
 */
function normalizeObserverShellCache(input, view, indexMagnitude) {
  if (
    !input ||
    typeof input !== 'object' ||
    /** @type {{ kind?: unknown }} */ (input).kind !== 'observer-shell-cache'
  ) {
    return null;
  }

  const cache = /** @type {Partial<ObserverShellPlannerCache>} */ (input);
  if (
    !sameFiniteNumber(cache.limitingMagnitude, view.limitingMagnitude) ||
    !sameFiniteNumber(cache.indexMagnitude, indexMagnitude) ||
    !isPoint(cache.observerPc) ||
    !(cache.subtrees instanceof Map)
  ) {
    return null;
  }

  return /** @type {ObserverShellPlannerCache} */ (cache);
}

/**
 * @param {ReturnType<typeof normalizeObserverShellView>} view
 * @param {number} indexMagnitude
 * @returns {ObserverShellPlannerCache}
 */
function createObserverShellCache(view, indexMagnitude) {
  return {
    kind: 'observer-shell-cache',
    observerPc: clonePoint(view.observerPc),
    limitingMagnitude: view.limitingMagnitude,
    indexMagnitude,
    subtrees: new Map(),
  };
}

/**
 * @param {import('./index.d.ts').StarOctreeRuntimeNode} node
 * @param {number} distancePc
 * @param {number} limitingMagnitude
 * @param {number} indexMagnitude
 */
function computeObserverShellSafeMovePc(
  node,
  distancePc,
  limitingMagnitude,
  indexMagnitude,
) {
  const loadRadiusPc = loadRadiusForMagnitudeShell(
    node.halfSize,
    limitingMagnitude,
    indexMagnitude,
  );
  const marginPc = Math.abs(
    finiteNumber(loadRadiusPc, 0) - finiteNumber(distancePc, Number.POSITIVE_INFINITY),
  );
  return Math.max(0, marginPc - OBSERVER_SHELL_MARGIN_EPSILON_PC);
}

/**
 * @param {StarOctreeDemandEntry} entry
 * @returns {StarOctreeDemandEntry}
 */
function cloneDemandEntry(entry) {
  return {
    ...entry,
    ...(entry.reasons ? { reasons: [...entry.reasons] } : {}),
    ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
  };
}

/**
 * @param {{ x: number; y: number; z: number }} point
 */
function clonePoint(point) {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
function sameFiniteNumber(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    leftNumber === rightNumber;
}

/**
 * @param {unknown} value
 * @returns {value is { x: number; y: number; z: number }}
 */
function isPoint(value) {
  if (!value || typeof value !== 'object') return false;
  const point = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  return Number.isFinite(Number(point.x)) &&
    Number.isFinite(Number(point.y)) &&
    Number.isFinite(Number(point.z));
}

/**
 * @param {AbortSignal | undefined} signal
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  const error = new Error('Observer-shell demand planning aborted.');
  error.name = 'AbortError';
  throw error;
}
