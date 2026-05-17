import { planObserverShellDemand, normalizeObserverShellView } from './star-octree-observer-shell.js';
import { createStarCellKey } from '@found-in-space/star-products';
import {
  normalizeTargetFrustumView,
  planTargetFrustumDemand,
} from './star-octree-target-frustum.js';
import {
  ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY,
  createStarOctreeError,
} from './star-octree-errors.js';
import { resolveMotionLookahead } from './star-octree-motion.js';
import { distanceToNodeAabbPc } from './star-octree-traversal.js';

/**
 * @typedef {import('./index.d.ts').BuildTravelVolumeRequestsOptions} BuildTravelVolumeRequestsOptions
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('./index.d.ts').StarOctreeObjectBatchStreamOptions} StarOctreeObjectBatchStreamOptions
 * @typedef {import('./index.d.ts').StarOctreePathVolumeRequest} StarOctreePathVolumeRequest
 * @typedef {import('./index.d.ts').StarOctreePointPc} StarOctreePointPc
 * @typedef {import('./index.d.ts').StarOctreeProductDelta} StarOctreeProductDelta
 * @typedef {import('./index.d.ts').StarOctreeProviderService} StarOctreeProviderService
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeSphereVolumeRequest} StarOctreeSphereVolumeRequest
 * @typedef {import('./index.d.ts').StarOctreeVolumeRequest} StarOctreeVolumeRequest
 * @typedef {import('./index.d.ts').WarmVolumeResult} WarmVolumeResult
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const EPSILON = 1e-9;
const SQRT_3 = Math.sqrt(3);

export function createObserverShellStrategy() {
  return /** @type {const} */ ({ kind: 'observer-shell' });
}

/**
 * @param {Omit<Extract<StarOctreeFetchStrategy, { kind: 'target-frustum' }>, 'kind'>} [options]
 */
export function createTargetFrustumStrategy(options = {}) {
  return {
    kind: /** @type {const} */ ('target-frustum'),
    ...definedFields(options),
  };
}

/**
 * @param {Omit<StarOctreeSphereVolumeRequest, 'type'>} options
 */
export function createSphereVolumeStrategy(options) {
  return {
    kind: /** @type {const} */ ('sphere-volume'),
    centerPc: normalizePoint(options.centerPc, 'centerPc'),
    radiusPc: normalizePositiveNumber(options.radiusPc, 'radiusPc'),
  };
}

/**
 * @param {Omit<StarOctreePathVolumeRequest, 'type'>} options
 */
export function createPathVolumeStrategy(options) {
  return {
    kind: /** @type {const} */ ('path-volume'),
    pointsPc: normalizePathPoints(options.pointsPc),
    radiusPc: normalizePositiveNumber(options.radiusPc, 'radiusPc'),
  };
}

/**
 * @param {StarOctreeFetchStrategy} strategy
 */
export function withMotionLookahead(strategy) {
  if (strategy.kind === 'motion-lookahead') {
    throw new TypeError('withMotionLookahead() cannot wrap another motion-lookahead strategy.');
  }

  return {
    kind: /** @type {const} */ ('motion-lookahead'),
    strategy,
  };
}

/**
 * @param {StarOctreeFetchStrategy[]} strategies
 * @param {{ mode?: 'union' }} [options]
 */
export function combineStarOctreeStrategies(strategies, options = {}) {
  if (!Array.isArray(strategies) || strategies.length === 0) {
    throw new TypeError('combineStarOctreeStrategies() requires at least one strategy.');
  }

  if (options.mode !== undefined && options.mode !== 'union') {
    throw new TypeError('Only union star octree strategy composition is supported.');
  }

  return {
    kind: /** @type {const} */ ('composite'),
    mode: /** @type {const} */ ('union'),
    strategies: [...strategies],
  };
}

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

  if (strategy.kind === 'sphere-volume') {
    return planSphereVolumeDemand(options.context, strategy);
  }

  if (strategy.kind === 'path-volume') {
    return planPathVolumeDemand(options.context, strategy);
  }

  if (strategy.kind === 'motion-lookahead') {
    return planMotionLookaheadDemand(options.indexSource, options.context, strategy);
  }

  if (strategy.kind === 'composite') {
    return planCompositeDemand(options.indexSource, options.context, strategy);
  }

  if (strategy.kind === 'custom') {
    return strategy.selectDemand(options.context);
  }

  throw createUnsupportedStrategyError('unknown');
}

/**
 * @param {StarOctreeFetchStrategy} strategy
 * @param {import('./index.d.ts').StarOctreeViewPatch | undefined} view
 */
export function normalizeStrategyView(strategy, view) {
  if (strategy.kind === 'observer-shell') {
    return normalizeObserverShellView(view);
  }

  if (strategy.kind === 'target-frustum') {
    return normalizeTargetFrustumView(view, strategy);
  }

  if (strategy.kind === 'motion-lookahead') {
    return normalizeStrategyView(strategy.strategy, view);
  }

  return view ?? {};
}

/**
 * @param {BuildTravelVolumeRequestsOptions} options
 * @returns {StarOctreePathVolumeRequest[]}
 */
export function buildTravelVolumeRequests(options) {
  const route = createRoute(normalizePathPoints(options.routePointsPc));
  const paddingPc = normalizeNonNegativeNumber(options.paddingPc, 0.5);
  const quantizeStepPc = normalizeNonNegativeNumber(options.quantizeStepPc, 1);
  const defaultRadiusPc = normalizeOptionalPositiveNumber(options.defaultRadiusPc);
  const profile = normalizeRadiusProfile(options.radiusProfile, defaultRadiusPc);

  if (route.points.length < 2) {
    return [];
  }

  if (profile.length === 0) {
    if (!defaultRadiusPc) {
      return [];
    }
    return [{
      type: 'path',
      pointsPc: route.points,
      radiusPc: quantizeRadius(defaultRadiusPc + paddingPc, quantizeStepPc),
    }];
  }

  /** @type {StarOctreePathVolumeRequest[]} */
  const requests = [];

  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const next = profile[index];
    const slicePoints = extractRouteSlicePoints(route, previous.progress, next.progress);
    if (slicePoints.length < 2) {
      continue;
    }

    const radiusPc = quantizeRadius(
      Math.max(previous.radiusPc, next.radiusPc) + paddingPc,
      quantizeStepPc,
    );
    if (!(radiusPc > 0)) {
      continue;
    }

    const last = requests[requests.length - 1];
    if (
      last &&
      Math.abs(last.radiusPc - radiusPc) < EPSILON &&
      pointDistance(last.pointsPc[last.pointsPc.length - 1], slicePoints[0]) < EPSILON
    ) {
      last.pointsPc.push(...slicePoints.slice(1));
      continue;
    }

    requests.push({
      type: 'path',
      pointsPc: slicePoints,
      radiusPc,
    });
  }

  return requests;
}

/**
 * @param {StarOctreeProviderService} provider
 * @param {StarOctreeVolumeRequest} request
 * @param {Omit<StarOctreeObjectBatchStreamOptions, 'strategy'>} [options]
 * @returns {AsyncIterable<StarOctreeProductDelta>}
 */
export function streamVolumeProducts(provider, request, options = {}) {
  return provider.streamObjectBatches({
    ...options,
    strategy: createStrategyForVolumeRequest(request),
  });
}

/**
 * @param {StarOctreeProviderService} provider
 * @param {StarOctreeVolumeRequest[]} requests
 * @param {Omit<StarOctreeObjectBatchStreamOptions, 'strategy'> & {
 *   onProgress?: (progress: import('./index.d.ts').WarmVolumeProgress) => void;
 * }} [options]
 * @returns {Promise<WarmVolumeResult>}
 */
export async function warmVolumeRequests(provider, requests, options = {}) {
  let productCount = 0;
  let starCount = 0;
  let currentCount = 0;

  for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
    const request = requests[requestIndex];
    for await (const delta of streamVolumeProducts(provider, request, {
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

      if (delta.type === 'data/product-upsert') {
        productCount += 1;
        starCount += delta.product.count;
      } else if (delta.type === 'data/representation-current') {
        currentCount += 1;
      } else if (delta.type === 'data/product-error') {
        throw new Error(delta.error?.message ?? 'Volume warm failed.');
      }
    }
  }

  return {
    requestCount: requests.length,
    productCount,
    starCount,
    currentCount,
  };
}

/**
 * @param {StarOctreePointPc} point
 * @param {StarOctreePointPc[]} pointsPc
 */
export function distancePointToPathPc(point, pointsPc) {
  const points = normalizePathPoints(pointsPc);
  let minimum = Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index += 1) {
    minimum = Math.min(
      minimum,
      distancePointToSegment(point, points[index - 1], points[index]),
    );
  }

  return minimum;
}

/**
 * @param {StarOctreeSelectionContext} context
 * @param {Extract<StarOctreeFetchStrategy, { kind: 'sphere-volume' }>} strategy
 */
async function planSphereVolumeDemand(context, strategy) {
  const result = await context.traversal.select({
    distanceToNode: (node) => distanceToNodeAabbPc(strategy.centerPc, node),
    visit(node) {
      const distancePc = distanceToNodeAabbPc(strategy.centerPc, node);
      const include = distancePc <= strategy.radiusPc;
      return {
        include,
        descend: include,
        distancePc,
        priority: -distancePc,
        reasons: ['sphere-volume'],
        metadata: {
          strategy: 'sphere-volume',
          centerPc: strategy.centerPc,
          radiusPc: strategy.radiusPc,
          distancePc,
        },
      };
    },
  });

  const entries = sortDemandEntries(result.entries, {
    coarseFirst: context.streaming?.coarseFirst !== false,
  });

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: ['sphere-volume'],
    metadata: {
      strategy: 'sphere-volume',
      centerPc: strategy.centerPc,
      radiusPc: strategy.radiusPc,
      ...result.stats,
    },
  };
}

/**
 * @param {StarOctreeSelectionContext} context
 * @param {Extract<StarOctreeFetchStrategy, { kind: 'path-volume' }>} strategy
 */
async function planPathVolumeDemand(context, strategy) {
  const result = await context.traversal.select({
    distanceToNode: (node) =>
      Math.max(0, distancePointToPathPc(nodeCenter(node), strategy.pointsPc) - node.halfSize * SQRT_3),
    visit(node) {
      const centerDistancePc = distancePointToPathPc(nodeCenter(node), strategy.pointsPc);
      const capsuleRadiusPc = strategy.radiusPc + node.halfSize * SQRT_3;
      const include = centerDistancePc <= capsuleRadiusPc;
      return {
        include,
        descend: include,
        distancePc: centerDistancePc,
        priority: -centerDistancePc,
        reasons: ['path-volume'],
        metadata: {
          strategy: 'path-volume',
          radiusPc: strategy.radiusPc,
          centerDistancePc,
          capsuleRadiusPc,
          pointCount: strategy.pointsPc.length,
        },
      };
    },
  });

  const entries = sortDemandEntries(result.entries, {
    coarseFirst: context.streaming?.coarseFirst !== false,
  });

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: ['path-volume'],
    metadata: {
      strategy: 'path-volume',
      radiusPc: strategy.radiusPc,
      pointCount: strategy.pointsPc.length,
      ...result.stats,
    },
  };
}

/**
 * @param {StarOctreeIndexSource} indexSource
 * @param {StarOctreeSelectionContext} context
 * @param {Extract<StarOctreeFetchStrategy, { kind: 'motion-lookahead' }>} strategy
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
  const observerPc = normalizePoint(context.view.observerPc, 'observerPc', DEFAULT_OBSERVER_PC);
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
 * @param {StarOctreeIndexSource} indexSource
 * @param {StarOctreeSelectionContext} context
 * @param {Extract<StarOctreeFetchStrategy, { kind: 'composite' }>} strategy
 */
async function planCompositeDemand(indexSource, context, strategy) {
  if (strategy.mode !== 'union') {
    throw createUnsupportedStrategyError(`composite:${strategy.mode}`);
  }

  const childPlans = [];
  for (const childStrategy of strategy.strategies) {
    const childContext = {
      ...context,
      strategy: childStrategy,
      view: {
        ...normalizeStrategyView(childStrategy, context.view),
        revision: context.viewRevision,
      },
    };
    childPlans.push(await planStarOctreeStrategyDemand({
      indexSource,
      context: childContext,
    }));
  }

  const entries = sortDemandEntries(
    mergeDemandEntries(childPlans.flatMap((plan) => plan.entries)),
    { coarseFirst: context.streaming?.coarseFirst !== false },
  );

  return {
    entries,
    signature: createCurrentNodeSetSignature(entries),
    reasons: dedupe(childPlans.flatMap((plan) => plan.reasons ?? [])),
    metadata: {
      strategy: 'composite',
      mode: strategy.mode,
      strategyCount: strategy.strategies.length,
      selectedNodeCount: entries.length,
      currentNodeCount: entries.filter((entry) => (entry.role ?? 'current') === 'current').length,
      prefetchNodeCount: entries.filter((entry) => entry.role === 'prefetch').length,
      contributors: childPlans.map((plan, index) => ({
        index,
        strategy: strategy.strategies[index].kind,
        reasons: plan.reasons ?? [],
        signature: plan.signature,
        entryCount: plan.entries.length,
        metadata: plan.metadata,
      })),
    },
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
 * @param {StarOctreeVolumeRequest} request
 */
function createStrategyForVolumeRequest(request) {
  if (request.type === 'sphere') {
    return createSphereVolumeStrategy({
      centerPc: request.centerPc,
      radiusPc: request.radiusPc,
    });
  }

  if (request.type === 'path') {
    return createPathVolumeStrategy({
      pointsPc: request.pointsPc,
      radiusPc: request.radiusPc,
    });
  }

  throw new TypeError('Unknown star volume request type.');
}

/**
 * @param {object} object
 */
function definedFields(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {StarOctreePointPc} [fallback]
 */
function normalizePoint(value, label, fallback) {
  if (!value || typeof value !== 'object') {
    if (fallback) return { ...fallback };
    throw new TypeError(`${label} must be a finite parsec point.`);
  }

  const point = /** @type {Partial<StarOctreePointPc>} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return { x, y, z };
  }

  if (fallback) return { ...fallback };
  throw new TypeError(`${label} must be a finite parsec point.`);
}

/**
 * @param {unknown} pointsPc
 * @returns {StarOctreePointPc[]}
 */
function normalizePathPoints(pointsPc) {
  if (!Array.isArray(pointsPc) || pointsPc.length < 2) {
    throw new TypeError('pointsPc must contain at least two parsec points.');
  }

  return pointsPc.map((point, index) => normalizePoint(point, `pointsPc[${index}]`));
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }
  return number;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeNonNegativeNumber(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * @param {unknown} value
 */
function normalizeOptionalPositiveNumber(value) {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * @param {BuildTravelVolumeRequestsOptions['radiusProfile']} radiusProfile
 * @param {number | undefined} defaultRadiusPc
 */
function normalizeRadiusProfile(radiusProfile, defaultRadiusPc) {
  if (!Array.isArray(radiusProfile) || radiusProfile.length === 0) {
    return [];
  }

  const profile = radiusProfile
    .map((point) => ({
      progress: Math.max(0, Math.min(1, Number(point.progress))),
      radiusPc: normalizeOptionalPositiveNumber(point.radiusPc) ?? defaultRadiusPc ?? 0,
    }))
    .filter((point) => Number.isFinite(point.progress) && point.radiusPc > 0)
    .sort((left, right) => left.progress - right.progress);

  if (profile.length === 0) {
    return [];
  }

  if (profile[0].progress > 0) {
    profile.unshift({
      progress: 0,
      radiusPc: profile[0].radiusPc,
    });
  }

  const last = profile[profile.length - 1];
  if (last.progress < 1) {
    profile.push({
      progress: 1,
      radiusPc: last.radiusPc,
    });
  }

  return profile;
}

/**
 * @param {StarOctreePointPc[]} points
 */
function createRoute(points) {
  const distances = [0];
  let totalDistancePc = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalDistancePc += pointDistance(points[index - 1], points[index]);
    distances.push(totalDistancePc);
  }

  return {
    points,
    distances,
    totalDistancePc,
  };
}

/**
 * @param {ReturnType<typeof createRoute>} route
 * @param {number} startProgress
 * @param {number} endProgress
 */
function extractRouteSlicePoints(route, startProgress, endProgress) {
  const startDistance = route.totalDistancePc * Math.max(0, Math.min(1, startProgress));
  const endDistance = route.totalDistancePc * Math.max(0, Math.min(1, endProgress));
  if (!(endDistance > startDistance)) {
    return [];
  }

  const points = [
    interpolateRoutePoint(route, startDistance),
  ];

  for (let index = 1; index < route.points.length - 1; index += 1) {
    const distance = route.distances[index];
    if (distance > startDistance + EPSILON && distance < endDistance - EPSILON) {
      points.push(route.points[index]);
    }
  }

  points.push(interpolateRoutePoint(route, endDistance));
  return points;
}

/**
 * @param {ReturnType<typeof createRoute>} route
 * @param {number} distancePc
 */
function interpolateRoutePoint(route, distancePc) {
  const clampedDistance = Math.max(0, Math.min(route.totalDistancePc, distancePc));

  for (let index = 1; index < route.points.length; index += 1) {
    const segmentStartDistance = route.distances[index - 1];
    const segmentEndDistance = route.distances[index];
    if (clampedDistance > segmentEndDistance) {
      continue;
    }

    const segmentLength = segmentEndDistance - segmentStartDistance;
    if (!(segmentLength > 0)) {
      return route.points[index];
    }

    const t = (clampedDistance - segmentStartDistance) / segmentLength;
    return {
      x: route.points[index - 1].x + (route.points[index].x - route.points[index - 1].x) * t,
      y: route.points[index - 1].y + (route.points[index].y - route.points[index - 1].y) * t,
      z: route.points[index - 1].z + (route.points[index].z - route.points[index - 1].z) * t,
    };
  }

  return route.points[route.points.length - 1];
}

/**
 * @param {number} radiusPc
 * @param {number} quantizeStepPc
 */
function quantizeRadius(radiusPc, quantizeStepPc) {
  if (!(quantizeStepPc > 0)) {
    return radiusPc;
  }
  return Math.ceil(radiusPc / quantizeStepPc) * quantizeStepPc;
}

/**
 * @param {StarOctreeRuntimeNode} node
 * @returns {StarOctreePointPc}
 */
function nodeCenter(node) {
  return {
    x: node.centerX,
    y: node.centerY,
    z: node.centerZ,
  };
}

/**
 * @param {StarOctreePointPc} point
 * @param {StarOctreePointPc} start
 * @param {StarOctreePointPc} end
 */
function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (!(lengthSquared > 0)) {
    return pointDistance(point, start);
  }

  const t = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx +
    (point.y - start.y) * dy +
    (point.z - start.z) * dz
  ) / lengthSquared));
  return pointDistance(point, {
    x: start.x + dx * t,
    y: start.y + dy * t,
    z: start.z + dz * t,
  });
}

/**
 * @param {StarOctreePointPc} left
 * @param {StarOctreePointPc} right
 */
function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
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
