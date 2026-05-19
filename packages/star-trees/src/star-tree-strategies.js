// @ts-nocheck

export const ERR_STAR_TREE_INVALID_VIEW = 'ERR_STAR_TREE_INVALID_VIEW';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_TARGET_VERTICAL_FOV_DEG = 40;
const DEFAULT_TARGET_OVERSCAN_DEG = 8;
const DEFAULT_TARGET_RADIUS_PC = 96;
const DEFAULT_TARGET_ASPECT_RATIO = 1;
const DEFAULT_TARGET_NEAR_PC = 0.01;
const GEOMETRY_EPSILON = 1e-9;
const GATE_EPSILON = 1e-12;
const SQRT_3 = Math.sqrt(3);
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

export function createObserverShellStrategy() {
  return /** @type {const} */ ({ kind: 'observer-shell' });
}

/**
 * @param {Omit<import('./index.d.ts').StarTreeTargetFrustumStrategy, 'kind'>} [options]
 */
export function createTargetFrustumStrategy(options = {}) {
  return {
    kind: /** @type {const} */ ('target-frustum'),
    ...definedFields(options),
  };
}

/**
 * @param {Omit<import('./index.d.ts').StarTreeSphereVolumeStrategy, 'kind'>} options
 */
export function createSphereVolumeStrategy(options) {
  return {
    kind: /** @type {const} */ ('sphere-volume'),
    centerPc: normalizeRequiredPoint(options.centerPc, 'centerPc'),
    radiusPc: normalizePositiveNumber(options.radiusPc, 'radiusPc'),
  };
}

/**
 * @param {Omit<import('./index.d.ts').StarTreePathVolumeStrategy, 'kind'>} options
 */
export function createPathVolumeStrategy(options) {
  return {
    kind: /** @type {const} */ ('path-volume'),
    pointsPc: normalizePathPoints(options.pointsPc),
    radiusPc: normalizePositiveNumber(options.radiusPc, 'radiusPc'),
  };
}

/**
 * @param {import('./index.d.ts').StarTreeStrategy} strategy
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
 * @param {import('./index.d.ts').StarTreeStrategy[]} strategies
 * @param {{ mode?: 'union' }} [options]
 */
export function combineStarTreeStrategies(strategies, options = {}) {
  if (!Array.isArray(strategies) || strategies.length === 0) {
    throw new TypeError('combineStarTreeStrategies() requires at least one strategy.');
  }

  if (options.mode !== undefined && options.mode !== 'union') {
    throw new TypeError('Only union star tree strategy composition is supported.');
  }

  return {
    kind: /** @type {const} */ ('composite'),
    mode: /** @type {const} */ ('union'),
    strategies: [...strategies],
  };
}

/**
 * @param {import('./index.d.ts').StarTreeStrategy} strategy
 * @param {import('./index.d.ts').StarTreeViewPatch | undefined} view
 */
export function normalizeStarTreeStrategyView(strategy, view) {
  if (strategy.kind === 'observer-shell') {
    return normalizeObserverShellView(view);
  }

  if (strategy.kind === 'target-frustum') {
    return normalizeTargetFrustumView(view, strategy);
  }

  if (strategy.kind === 'motion-lookahead') {
    return normalizeStarTreeStrategyView(strategy.strategy, view);
  }

  return view ?? {};
}

/**
 * @param {{
 *   strategy: import('./index.d.ts').StarTreeStrategy;
 *   view?: import('./index.d.ts').StarTreeViewPatch;
 *   role?: 'current' | 'prefetch';
 *   indexMagnitude?: number;
 *   currentObserverPc?: import('./index.d.ts').StarTreePointPc;
 * }} options
 */
export function createStarTreeStrategyEvaluator(options) {
  const strategy = options.strategy;
  const role = options.role ?? 'current';
  const indexMagnitude = normalizeFiniteNumber(options.indexMagnitude, DEFAULT_LIMITING_MAGNITUDE);

  if (strategy.kind === 'observer-shell') {
    const view = normalizeObserverShellView(options.view);
    const motion = resolveMotionPriorityContext(view.motion);
    return {
      kind: strategy.kind,
      view,
      distanceToCell: (cell) => distanceToCellAabbPc(view.observerPc, cell),
      evaluateCell(cell, helpers = {}) {
        return evaluateObserverShellCell({
          cell,
          view,
          indexMagnitude,
          motion,
          role,
          queuedDistancePc: helpers.queuedDistancePc,
          currentObserverPc: options.currentObserverPc,
        });
      },
    };
  }

  if (strategy.kind === 'target-frustum') {
    const view = normalizeTargetFrustumView(options.view, strategy);
    const frustum = createFrustumTester(view);
    return {
      kind: strategy.kind,
      view,
      distanceToCell: (cell) => distanceToCellAabbPc(view.observerPc, cell),
      evaluateCell(cell, helpers = {}) {
        return evaluateTargetFrustumCell({
          cell,
          view,
          frustum,
          indexMagnitude,
          role,
          queuedDistancePc: helpers.queuedDistancePc,
        });
      },
    };
  }

  if (strategy.kind === 'sphere-volume') {
    return {
      kind: strategy.kind,
      view: options.view ?? {},
      distanceToCell: (cell) => distanceToCellAabbPc(strategy.centerPc, cell),
      evaluateCell(cell, helpers = {}) {
        const distancePc = helpers.queuedDistancePc ?? distanceToCellAabbPc(strategy.centerPc, cell);
        const relevant = distancePc <= strategy.radiusPc;
        const remainingRadiusPc = strategy.radiusPc - distancePc;
        return {
          relevant,
          descend: relevant,
          emit: relevant,
          distancePc,
          relevance: relevant ? Math.max(0, remainingRadiusPc / strategy.radiusPc) : 0,
          priority: remainingRadiusPc,
          reasons: ['sphere-volume'],
          metadata: {
            strategy: 'sphere-volume',
            centerPc: strategy.centerPc,
            radiusPc: strategy.radiusPc,
            distancePc,
          },
        };
      },
    };
  }

  if (strategy.kind === 'path-volume') {
    const pathDistance = createPathDistanceEvaluator(strategy.pointsPc);
    return {
      kind: strategy.kind,
      view: options.view ?? {},
      distanceToCell(cell) {
        return pathDistance.distanceToCoordinates(cell.centerX, cell.centerY, cell.centerZ);
      },
      evaluateCell(cell, helpers = {}) {
        const centerDistancePc = helpers.queuedDistancePc !== undefined
          ? helpers.queuedDistancePc
          : pathDistance.distanceToCoordinates(cell.centerX, cell.centerY, cell.centerZ);
        const capsuleRadiusPc = strategy.radiusPc + cell.halfSize * SQRT_3;
        const relevant = centerDistancePc <= capsuleRadiusPc;
        const remainingRadiusPc = capsuleRadiusPc - centerDistancePc;
        return {
          relevant,
          descend: relevant,
          emit: relevant,
          distancePc: centerDistancePc,
          relevance: relevant ? Math.max(0, remainingRadiusPc / capsuleRadiusPc) : 0,
          priority: remainingRadiusPc,
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
    };
  }

  if (strategy.kind === 'composite') {
    if (strategy.mode !== 'union') {
      throw new TypeError(`Star tree composite mode "${strategy.mode}" is not supported.`);
    }

    const evaluators = strategy.strategies.map((childStrategy) =>
      createStarTreeStrategyEvaluator({
        ...options,
        strategy: childStrategy,
      }));

    return {
      kind: strategy.kind,
      view: options.view ?? {},
      distanceToCell(cell) {
        let distancePc = Number.POSITIVE_INFINITY;
        for (const evaluator of evaluators) {
          distancePc = Math.min(distancePc, evaluator.distanceToCell(cell));
        }
        return distancePc;
      },
      evaluateCell(cell) {
        return mergeCompositeEvaluations(
          evaluators.map((evaluator) => evaluator.evaluateCell(cell)),
        );
      },
    };
  }

  throw new TypeError(`Star tree strategy "${strategy.kind}" cannot be evaluated as a single-cell strategy.`);
}

/**
 * @param {import('./index.d.ts').StarTreeStrategyEvaluation[]} evaluations
 * @returns {import('./index.d.ts').StarTreeStrategyEvaluation}
 */
function mergeCompositeEvaluations(evaluations) {
  const relevantEvaluations = evaluations.filter((evaluation) => evaluation.relevant);
  if (relevantEvaluations.length === 0) {
    return {
      relevant: false,
      descend: false,
      emit: false,
      reasons: dedupe(evaluations.flatMap((evaluation) => evaluation.reasons ?? [])),
      metadata: {
        strategy: 'composite',
        strategyContributors: evaluations.map(createEvaluationContributor),
      },
    };
  }

  const role = relevantEvaluations.some((evaluation) => (evaluation.role ?? 'current') === 'current')
    ? 'current'
    : 'prefetch';
  const priority = Math.max(...relevantEvaluations.map((evaluation) => evaluation.priority ?? 0));
  const relevance = Math.max(...relevantEvaluations.map((evaluation) => evaluation.relevance ?? 0));
  const distancePc = Math.min(...relevantEvaluations.map((evaluation) =>
    Number.isFinite(evaluation.distancePc) ? Number(evaluation.distancePc) : Number.POSITIVE_INFINITY));

  return {
    relevant: true,
    descend: relevantEvaluations.some((evaluation) => evaluation.descend !== false),
    emit: relevantEvaluations.some((evaluation) => evaluation.emit !== false),
    role,
    relevance,
    priority,
    ...(Number.isFinite(distancePc) ? { distancePc } : {}),
    reasons: dedupe(relevantEvaluations.flatMap((evaluation) => evaluation.reasons ?? [])),
    metadata: {
      strategy: 'composite',
      strategyContributors: evaluations.map(createEvaluationContributor),
    },
  };
}

/**
 * @param {import('./index.d.ts').StarTreeStrategyEvaluation} evaluation
 */
function createEvaluationContributor(evaluation) {
  return {
    strategy: String(evaluation.metadata?.strategy ?? evaluation.reasons?.[0] ?? 'unknown'),
    role: evaluation.role ?? 'current',
    priority: evaluation.priority,
    relevance: evaluation.relevance,
    reasons: evaluation.reasons ?? [],
  };
}

/**
 * @param {{
 *   cell: import('./index.d.ts').StarTreeCellGeometry;
 *   view: ReturnType<typeof normalizeObserverShellView>;
 *   indexMagnitude: number;
 *   motion: ReturnType<typeof resolveMotionPriorityContext>;
 *   role: 'current' | 'prefetch';
 *   queuedDistancePc?: number;
 *   currentObserverPc?: import('./index.d.ts').StarTreePointPc;
 * }} options
 */
function evaluateObserverShellCell(options) {
  const distancePc = options.queuedDistancePc ??
    distanceToCellAabbPc(options.view.observerPc, options.cell);
  const loadRadiusPc = loadRadiusForMagnitudeShell(
    options.cell.halfSize,
    options.view.limitingMagnitude,
    options.indexMagnitude,
  );
  const relevant = distancePc <= loadRadiusPc;
  const motionScore = relevant
    ? scoreMotionPriority({
        cell: options.cell,
        observerPc: options.currentObserverPc ?? options.view.observerPc,
        motion: options.role === 'current'
          ? options.motion
          : { ...options.motion, enabled: false },
      })
    : null;

  return {
    relevant,
    descend: relevant,
    emit: relevant,
    distancePc,
    relevance: relevant ? Math.max(0, (loadRadiusPc - distancePc) / loadRadiusPc) : 0,
    priority: (loadRadiusPc - distancePc) + (motionScore?.motionPriorityBias ?? 0),
    role: options.role,
    reasons: [
      options.role === 'current'
        ? 'observer-shell'
        : 'motion-lookahead',
    ],
    metadata: {
      strategy: 'observer-shell',
      distancePc,
      loadRadiusPc,
      limitingMagnitude: options.view.limitingMagnitude,
      indexMagnitude: options.indexMagnitude,
      ...(options.role === 'prefetch'
        ? {
            prefetchKind: 'motion-lookahead',
            futureObserverPc: options.view.observerPc,
          }
        : {}),
      ...(motionScore ?? {}),
    },
  };
}

/**
 * @param {{
 *   cell: import('./index.d.ts').StarTreeCellGeometry;
 *   view: ReturnType<typeof normalizeTargetFrustumView>;
 *   frustum: ReturnType<typeof createFrustumTester>;
 *   indexMagnitude: number;
 *   role: 'current' | 'prefetch';
 *   queuedDistancePc?: number;
 * }} options
 */
function evaluateTargetFrustumCell(options) {
  const visiblePoint = options.frustum.nearestVisiblePointToCell(options.cell);

  if (!visiblePoint) {
    return {
      relevant: false,
      descend: false,
      distancePc: options.queuedDistancePc ??
        distanceToCellAabbPc(options.view.observerPc, options.cell),
      metadata: {
        strategy: 'target-frustum',
        frustumRejected: true,
      },
    };
  }

  const distancePc = visiblePoint.distancePc;
  const loadRadiusPc = loadRadiusForMagnitudeShell(
    options.cell.halfSize,
    options.view.limitingMagnitude,
    options.indexMagnitude,
  );
  const relevant = distancePc <= loadRadiusPc;

  if (!relevant) {
    return {
      relevant: false,
      descend: false,
      distancePc,
      metadata: {
        strategy: 'target-frustum',
        shellRejected: true,
        distancePc,
        loadRadiusPc,
      },
    };
  }

  return {
    relevant: true,
    descend: true,
    emit: true,
    distancePc,
    relevance: Math.max(0, (loadRadiusPc - distancePc) / loadRadiusPc),
    priority: loadRadiusPc - distancePc,
    role: options.role,
    reasons: [
      options.role === 'current'
        ? 'target-frustum'
        : 'motion-lookahead',
    ],
    metadata: {
      strategy: 'target-frustum',
      distancePc,
      forwardDistancePc: visiblePoint.forwardDistancePc,
      nearestVisiblePc: visiblePoint.point,
      loadRadiusPc,
      limitingMagnitude: options.view.limitingMagnitude,
      indexMagnitude: options.indexMagnitude,
      frustumMode: options.view.frustumMode,
      ...(options.role === 'prefetch'
        ? {
            prefetchKind: 'motion-lookahead',
            futureObserverPc: options.view.observerPc,
          }
        : {}),
    },
  };
}

/**
 * @param {import('./index.d.ts').StarTreeViewPatch | undefined} view
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
 * @param {import('./index.d.ts').StarTreeViewPatch | import('./index.d.ts').StarTreeViewState | undefined} view
 * @param {import('./index.d.ts').StarTreeStrategy} strategy
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
 * @param {number} halfSize
 * @param {number} limitingMagnitude
 * @param {number} indexMagnitude
 */
export function loadRadiusForMagnitudeShell(halfSize, limitingMagnitude, indexMagnitude) {
  return halfSize * 10 ** ((limitingMagnitude - indexMagnitude) / 5);
}

/**
 * @param {import('./index.d.ts').StarTreePointPc} point
 * @param {import('./index.d.ts').StarTreeCellGeometry} cell
 */
export function distanceToCellAabbPc(point, cell) {
  const dx = Math.max(Math.abs(point.x - cell.centerX) - cell.halfSize, 0);
  const dy = Math.max(Math.abs(point.y - cell.centerY) - cell.halfSize, 0);
  const dz = Math.max(Math.abs(point.z - cell.centerZ) - cell.halfSize, 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * @param {import('./index.d.ts').StarTreePointPc} point
 * @param {import('./index.d.ts').StarTreePointPc[]} pointsPc
 */
export function distancePointToPathPc(point, pointsPc) {
  return createPathDistanceEvaluator(pointsPc).distanceToPoint(point);
}

/**
 * @param {import('./index.d.ts').StarTreePointPc[]} pointsPc
 */
export function createPathDistanceEvaluator(pointsPc) {
  const points = normalizePathPoints(pointsPc);
  const segments = [];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    segments.push({
      start,
      dx,
      dy,
      dz,
      lengthSquared: dx * dx + dy * dy + dz * dz,
    });
  }

  return {
    points,
    distanceToPoint(point) {
      return distanceToCoordinates(point.x, point.y, point.z);
    },
    distanceToCoordinates,
  };

  function distanceToCoordinates(x, y, z) {
      let minimum = Number.POSITIVE_INFINITY;
      for (const segment of segments) {
        minimum = Math.min(minimum, distanceCoordinatesToPreparedSegment(x, y, z, segment));
      }
      return minimum;
  }
}

/**
 * @param {import('./index.d.ts').BuildTravelVolumeRequestsOptions} options
 * @returns {import('./index.d.ts').StarTreePathVolumeRequest[]}
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
      Math.abs(last.radiusPc - radiusPc) < GEOMETRY_EPSILON &&
      pointDistance(last.pointsPc[last.pointsPc.length - 1], slicePoints[0]) < GEOMETRY_EPSILON
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
 * @param {import('./index.d.ts').StarTreeVolumeRequest} request
 */
export function createStrategyForVolumeRequest(request) {
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
 * @param {import('./index.d.ts').StarTreeViewPatch['motion']} motion
 * @param {import('./index.d.ts').StarTreePointPc} observerPc
 */
export function resolveMotionLookahead(motion, observerPc) {
  const lookaheadSecs = normalizeFiniteNumber(motion?.lookaheadSecs, 0);
  const velocityPcPerSec = normalizeVelocity(motion?.velocityPcPerSec);

  if (!velocityPcPerSec || !(lookaheadSecs > 0)) {
    return {
      enabled: false,
      lookaheadSecs,
      lookaheadDistancePc: 0,
      velocityPcPerSec,
      futureObserverPc: null,
    };
  }

  const speedPcPerSec = Math.hypot(
    velocityPcPerSec.x,
    velocityPcPerSec.y,
    velocityPcPerSec.z,
  );
  const lookaheadDistancePc = speedPcPerSec * lookaheadSecs;

  return {
    enabled: lookaheadDistancePc > 0,
    lookaheadSecs,
    lookaheadDistancePc,
    velocityPcPerSec,
    futureObserverPc: {
      x: observerPc.x + velocityPcPerSec.x * lookaheadSecs,
      y: observerPc.y + velocityPcPerSec.y * lookaheadSecs,
      z: observerPc.z + velocityPcPerSec.z * lookaheadSecs,
    },
  };
}

/**
 * @param {{
 *   strategy: import('./index.d.ts').StarTreeStrategy;
 *   thresholds?: import('./index.d.ts').StarTreeDemandThresholds;
 *   previousDemandView: import('./index.d.ts').StarTreeViewState | null;
 *   nextView: import('./index.d.ts').StarTreeViewState;
 *   reason?: string;
 * }} options
 * @returns {{ replan: boolean; reasons: string[] }}
 */
export function evaluateStarTreeDemandGate(options) {
  if (options.strategy.kind === 'motion-lookahead') {
    return evaluateMotionLookaheadGate(options);
  }

  if (options.strategy.kind === 'composite') {
    return evaluateCompositeGate(options);
  }

  if (
    options.strategy.kind === 'sphere-volume' ||
    options.strategy.kind === 'path-volume'
  ) {
    return evaluateFixedVolumeGate(options);
  }

  if (!options.previousDemandView) {
    return replan(defaultQueuedReasons(options.reason, 'initial'));
  }

  if (!options.thresholds) {
    return replan(defaultQueuedReasons(options.reason, 'demand-changed'));
  }

  if (options.strategy.kind === 'observer-shell') {
    return evaluateObserverShellGate(options);
  }

  if (options.strategy.kind === 'target-frustum') {
    return evaluateTargetFrustumGate(options);
  }

  return replan(defaultQueuedReasons(options.reason, 'strategy'));
}

/**
 * @param {import('./index.d.ts').StarTreeDemandThresholds | undefined} thresholds
 * @returns {import('./index.d.ts').StarTreeDemandThresholds}
 */
export function normalizeStarTreeDemandThresholds(thresholds) {
  return {
    ...(validThreshold(thresholds?.observerMoveThresholdPc) !== undefined
      ? { observerMoveThresholdPc: validThreshold(thresholds?.observerMoveThresholdPc) }
      : {}),
    ...(validThreshold(thresholds?.limitingMagnitudeDelta) !== undefined
      ? { limitingMagnitudeDelta: validThreshold(thresholds?.limitingMagnitudeDelta) }
      : {}),
    ...(validThreshold(thresholds?.directionAngleDeg) !== undefined
      ? { directionAngleDeg: validThreshold(thresholds?.directionAngleDeg) }
      : {}),
  };
}

/**
 * @param {ReturnType<typeof normalizeTargetFrustumView>} view
 */
export function createFrustumTester(view) {
  const basis = 'frustumBasis' in view && view.frustumBasis
    ? view.frustumBasis
    : quaternionToCameraBasis(view.orientationIcrs);
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
    containsPoint(point) {
      return containsPointInFrustum(point);
    },
    intersectsCell(cell) {
      const relativeCenter = {
        x: cell.centerX - view.observerPc.x,
        y: cell.centerY - view.observerPc.y,
        z: cell.centerZ - view.observerPc.z,
      };

      for (const plane of planes) {
        const centerDistance =
          dotVector(plane.normal, relativeCenter) + plane.offset;
        const radius =
          cell.halfSize *
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
    nearestVisiblePointToCell(cell) {
      const bounds = createCellBounds(cell);
      const corners = createAabbCorners(bounds);
      let nearest = null;

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
        const clipped = clipRayToAabb(view.observerPc, ray, bounds);
        if (clipped) {
          addCandidate(clipped);
        }
      }

      return nearest;
    },
  };

  function containsPointInFrustum(point) {
    const relative = subtractVectors(point, view.observerPc);
    for (const plane of planes) {
      if (dotVector(plane.normal, relative) + plane.offset < -GEOMETRY_EPSILON) {
        return false;
      }
    }
    return true;
  }

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

export function quaternionToCameraBasis(quaternion) {
  return {
    right: rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, quaternion),
    up: rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, quaternion),
    forward: rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, quaternion),
  };
}

/**
 * @param {import('./index.d.ts').StarTreeViewPatch['motion']} motion
 */
function resolveMotionPriorityContext(motion) {
  const speedPcPerSec = resolveMotionSpeed(motion);
  const lookaheadSecs = normalizeFiniteNumber(motion?.lookaheadSecs, 0);
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

  const deltaX = options.cell.centerX - options.observerPc.x;
  const deltaY = options.cell.centerY - options.observerPc.y;
  const deltaZ = options.cell.centerZ - options.observerPc.z;
  const centerDistancePc = Math.hypot(deltaX, deltaY, deltaZ);
  const forwardDistancePc =
    deltaX * direction.x + deltaY * direction.y + deltaZ * direction.z;
  const lateralDistancePc = Math.max(
    0,
    Math.sqrt(Math.max(0, centerDistancePc ** 2 - forwardDistancePc ** 2)) -
      options.cell.halfSize,
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

function createInvalidViewError(message) {
  const error = new TypeError(message);
  error.code = ERR_STAR_TREE_INVALID_VIEW;
  return error;
}

function evaluateMotionLookaheadGate(options) {
  const baseGate = evaluateStarTreeDemandGate({
    ...options,
    strategy: options.strategy.strategy,
  });
  const motionChanged = motionLookaheadSignature(options.previousDemandView) !==
    motionLookaheadSignature(options.nextView);

  if (baseGate.replan || motionChanged) {
    return replan(withExplicitReason(
      options.reason,
      dedupe([
        ...baseGate.reasons,
        ...(motionChanged ? ['motion-lookahead'] : []),
      ]),
    ));
  }

  return unchanged(dedupe([...baseGate.reasons, 'motion-lookahead-unchanged']));
}

function evaluateCompositeGate(options) {
  const results = options.strategy.strategies.map((childStrategy) =>
    evaluateStarTreeDemandGate({
      ...options,
      strategy: childStrategy,
    }),
  );
  const reasons = dedupe(results.flatMap((result) => result.reasons));

  return results.some((result) => result.replan)
    ? replan(withExplicitReason(options.reason, reasons))
    : unchanged(reasons.length > 0 ? reasons : ['composite-unchanged']);
}

function evaluateFixedVolumeGate(options) {
  if (!options.previousDemandView) {
    return replan(defaultQueuedReasons(options.reason, 'initial'));
  }

  return unchanged([`${options.strategy.kind}-unchanged`]);
}

function evaluateObserverShellGate(options) {
  const thresholds = normalizeStarTreeDemandThresholds(options.thresholds);
  const reasons = [];

  if (
    pointDifferenceExceeds(
      observerPc(options.previousDemandView),
      observerPc(options.nextView),
      thresholds.observerMoveThresholdPc,
    )
  ) {
    reasons.push('observer-move-threshold');
  }

  if (
    numberDifferenceExceeds(
      limitingMagnitude(options.previousDemandView),
      limitingMagnitude(options.nextView),
      thresholds.limitingMagnitudeDelta,
    )
  ) {
    reasons.push('limiting-magnitude');
  }

  return reasons.length > 0
    ? replan(withExplicitReason(options.reason, reasons))
    : unchanged(['threshold-unchanged']);
}

function evaluateTargetFrustumGate(options) {
  const thresholds = normalizeStarTreeDemandThresholds(options.thresholds);
  const reasons = [];
  const previousView = options.previousDemandView;
  const nextView = options.nextView;

  if (
    pointDifferenceExceeds(
      observerPc(previousView),
      observerPc(nextView),
      thresholds.observerMoveThresholdPc,
    )
  ) {
    reasons.push('observer-move-threshold');
  }

  if (
    numberDifferenceExceeds(
      limitingMagnitude(previousView),
      limitingMagnitude(nextView),
      thresholds.limitingMagnitudeDelta,
    )
  ) {
    reasons.push('limiting-magnitude');
  }

  if (pointChanged(previousView.targetPc, nextView.targetPc)) {
    reasons.push('view-volume');
  }

  if (
    directionChanged(
      previousView.directionIcrs,
      nextView.directionIcrs,
      thresholds.directionAngleDeg,
    )
  ) {
    reasons.push('view-volume');
  }

  if (
    orientationForwardChanged(
      previousView.orientationIcrs,
      nextView.orientationIcrs,
      thresholds.directionAngleDeg,
    )
  ) {
    reasons.push('view-volume');
  }

  for (const field of ['verticalFovDeg', 'aspectRatio', 'nearPc', 'farPc', 'preloadDistancePc']) {
    if (targetScalarChanged(field, previousView, nextView, options.strategy)) {
      reasons.push('view-volume');
      break;
    }
  }

  return reasons.length > 0
    ? replan(withExplicitReason(options.reason, dedupe(reasons)))
    : unchanged(['threshold-unchanged']);
}

function observerPc(view) {
  return normalizePoint(view?.observerPc, DEFAULT_OBSERVER_PC);
}

function limitingMagnitude(view) {
  return normalizeFiniteNumber(
    view?.limitingMagnitude ?? view?.mDesired,
    DEFAULT_LIMITING_MAGNITUDE,
  );
}

function pointDifferenceExceeds(previous, next, threshold) {
  const distance = Math.hypot(
    next.x - previous.x,
    next.y - previous.y,
    next.z - previous.z,
  );

  if (threshold === undefined) {
    return distance > GATE_EPSILON;
  }

  return distance > threshold;
}

function numberDifferenceExceeds(previous, next, threshold) {
  const difference = Math.abs(next - previous);

  if (threshold === undefined) {
    return difference > GATE_EPSILON;
  }

  return difference > threshold;
}

function pointChanged(previous, next) {
  const previousPoint = normalizeOptionalPoint(previous);
  const nextPoint = normalizeOptionalPoint(next);
  if (!previousPoint && !nextPoint) return false;
  if (!previousPoint || !nextPoint) return true;
  return pointDifferenceExceeds(previousPoint, nextPoint, undefined);
}

function motionLookaheadSignature(view) {
  const motion = view?.motion;
  const velocity = normalizeOptionalPoint(motion?.velocityPcPerSec);
  const lookaheadSecs = Number(motion?.lookaheadSecs);
  if (!velocity || !Number.isFinite(lookaheadSecs) || !(lookaheadSecs > 0)) {
    return 'none';
  }

  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (!(speed > GATE_EPSILON)) {
    return 'none';
  }

  return [
    roundSignatureNumber(velocity.x),
    roundSignatureNumber(velocity.y),
    roundSignatureNumber(velocity.z),
    roundSignatureNumber(lookaheadSecs),
  ].join(':');
}

function roundSignatureNumber(value) {
  return Number.isFinite(value)
    ? String(Math.round(value / GATE_EPSILON) * GATE_EPSILON)
    : 'nan';
}

function directionChanged(previous, next, thresholdDeg) {
  const previousDirection = normalizeOptionalVector(previous);
  const nextDirection = normalizeOptionalVector(next);
  if (!previousDirection && !nextDirection) return false;
  if (!previousDirection || !nextDirection) return true;

  if (thresholdDeg === undefined) {
    return pointDifferenceExceeds(previousDirection, nextDirection, undefined);
  }

  return angleDegBetween(previousDirection, nextDirection) > thresholdDeg;
}

function orientationForwardChanged(previous, next, thresholdDeg) {
  const previousQuaternion = normalizeQuaternion(previous);
  const nextQuaternion = normalizeQuaternion(next);
  if (!previousQuaternion && !nextQuaternion) return false;
  if (!previousQuaternion || !nextQuaternion) return true;

  if (thresholdDeg === undefined && quaternionChanged(previousQuaternion, nextQuaternion)) {
    return true;
  }

  return angleDegBetween(
    quaternionToCameraBasis(previousQuaternion).forward,
    quaternionToCameraBasis(nextQuaternion).forward,
  ) > (thresholdDeg ?? 0);
}

function targetScalarChanged(field, previousView, nextView, strategy) {
  return scalarChanged(
    targetScalar(field, previousView, strategy),
    targetScalar(field, nextView, strategy),
  );
}

function targetScalar(field, view, strategy) {
  if (field === 'verticalFovDeg') {
    return view.verticalFovDeg ?? strategy.verticalFovDeg ??
      (view.orientationIcrs ? undefined : DEFAULT_TARGET_VERTICAL_FOV_DEG);
  }

  if (field === 'aspectRatio') {
    return view.aspectRatio ??
      (view.orientationIcrs ? undefined : DEFAULT_TARGET_ASPECT_RATIO);
  }

  if (field === 'nearPc') {
    return view.nearPc ?? strategy.nearPc ?? 0;
  }

  if (field === 'farPc') {
    return view.farPc ?? strategy.farPc ?? implicitTargetFarPc(view, strategy);
  }

  if (field === 'preloadDistancePc') {
    return view.preloadDistancePc ?? 0;
  }

  return undefined;
}

function implicitTargetFarPc(view, strategy) {
  if (view.orientationIcrs || !view.targetPc) {
    return undefined;
  }

  const observer = observerPc(view);
  const target = normalizeOptionalPoint(view.targetPc);
  if (!target) {
    return undefined;
  }

  const targetDistancePc = Math.hypot(
    target.x - observer.x,
    target.y - observer.y,
    target.z - observer.z,
  );
  const targetRadiusPc = normalizeFiniteNumber(
    strategy.targetRadiusPc,
    DEFAULT_TARGET_RADIUS_PC,
  );
  const preloadDistancePc = Math.max(
    0,
    normalizeFiniteNumber(view.preloadDistancePc, 0),
  );
  return targetDistancePc + targetRadiusPc + preloadDistancePc;
}

function scalarChanged(previous, next) {
  if (previous === undefined && next === undefined) return false;
  const previousNumber = Number(previous);
  const nextNumber = Number(next);
  if (!Number.isFinite(previousNumber) || !Number.isFinite(nextNumber)) {
    return previous !== next;
  }
  return Math.abs(nextNumber - previousNumber) > GATE_EPSILON;
}

function validThreshold(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function defaultQueuedReasons(explicitReason, fallback) {
  return explicitReason ? [explicitReason] : [fallback];
}

function withExplicitReason(explicitReason, reasons) {
  if (!explicitReason || reasons.includes(explicitReason)) {
    return dedupe(reasons);
  }
  return [explicitReason, ...dedupe(reasons)];
}

function dedupe(reasons) {
  return Array.from(new Set(reasons));
}

function replan(reasons) {
  return { replan: true, reasons };
}

function unchanged(reasons) {
  return { replan: false, reasons };
}

function createCellBounds(cell) {
  return {
    minX: cell.centerX - cell.halfSize,
    minY: cell.centerY - cell.halfSize,
    minZ: cell.centerZ - cell.halfSize,
    maxX: cell.centerX + cell.halfSize,
    maxY: cell.centerY + cell.halfSize,
    maxZ: cell.centerZ + cell.halfSize,
  };
}

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

function containsPointInAabb(point, bounds) {
  return point.x >= bounds.minX - GEOMETRY_EPSILON &&
    point.x <= bounds.maxX + GEOMETRY_EPSILON &&
    point.y >= bounds.minY - GEOMETRY_EPSILON &&
    point.y <= bounds.maxY + GEOMETRY_EPSILON &&
    point.z >= bounds.minZ - GEOMETRY_EPSILON &&
    point.z <= bounds.maxZ + GEOMETRY_EPSILON;
}

function closestPointOnAabb(point, bounds) {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, point.y)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, point.z)),
  };
}

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

function clipRayToAabb(origin, ray, bounds) {
  let lower = ray.minDistancePc;
  let upper = ray.maxDistancePc ?? Number.POSITIVE_INFINITY;

  const axes = [
    { axis: 'x', min: bounds.minX, max: bounds.maxX },
    { axis: 'y', min: bounds.minY, max: bounds.maxY },
    { axis: 'z', min: bounds.minZ, max: bounds.maxZ },
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

function clamp01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

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

function normalizeQuaternion(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const quaternion = value;
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

function normalizeOptionalPoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const point = value;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : null;
}

function normalizeOptionalVector(value) {
  const point = normalizeOptionalPoint(value);
  if (!point) {
    return null;
  }

  const length = vectorLength(point);
  return length > 0 ? scaleVector(point, 1 / length) : null;
}

function normalizePoint(value, fallback) {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }

  const point = value;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);

  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : { ...fallback };
}

function normalizeRequiredPoint(value, label) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${label} must be a finite parsec point.`);
  }

  const point = value;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return { x, y, z };
  }

  throw new TypeError(`${label} must be a finite parsec point.`);
}

function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }
  return number;
}

function normalizeFinitePositiveNumber(value, fallback, label) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return number;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw createInvalidViewError(`${label} must be a positive finite number.`);
}

function normalizeNonNegativeNumber(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeOptionalPositiveNumber(value) {
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizePathPoints(pointsPc) {
  if (!Array.isArray(pointsPc) || pointsPc.length < 2) {
    throw new TypeError('pointsPc must contain at least two parsec points.');
  }

  return pointsPc.map((point, index) => normalizeRequiredPoint(point, `pointsPc[${index}]`));
}

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

function normalizeVelocity(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const velocity = value;
  const x = Number(velocity.x);
  const y = Number(velocity.y);
  const z = Number(velocity.z);
  const speed = Math.hypot(x, y, z);

  return Number.isFinite(speed) && speed > 0
    ? { x, y, z }
    : null;
}

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
    if (distance > startDistance + GEOMETRY_EPSILON && distance < endDistance - GEOMETRY_EPSILON) {
      points.push(route.points[index]);
    }
  }

  points.push(interpolateRoutePoint(route, endDistance));
  return points;
}

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

function quantizeRadius(radiusPc, quantizeStepPc) {
  if (!(quantizeStepPc > 0)) {
    return radiusPc;
  }
  return Math.ceil(radiusPc / quantizeStepPc) * quantizeStepPc;
}

function distanceCoordinatesToPreparedSegment(x, y, z, segment) {
  if (!(segment.lengthSquared > 0)) {
    return Math.hypot(x - segment.start.x, y - segment.start.y, z - segment.start.z);
  }

  const t = Math.max(0, Math.min(1, (
    (x - segment.start.x) * segment.dx +
    (y - segment.start.y) * segment.dy +
    (z - segment.start.z) * segment.dz
  ) / segment.lengthSquared));
  return Math.hypot(
    x - (segment.start.x + segment.dx * t),
    y - (segment.start.y + segment.dy * t),
    z - (segment.start.z + segment.dz * t),
  );
}

function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function cameraBasisFromForward(forward) {
  const normalizedForward = normalizeVector(forward);
  const upSeed = Math.abs(dotVector(normalizedForward, TARGET_UP)) > 0.95
    ? TARGET_UP_FALLBACK
    : TARGET_UP;
  const right = normalizeVector(crossVector(normalizedForward, upSeed));
  const up = normalizeVector(crossVector(right, normalizedForward));
  return {
    right,
    up,
    forward: normalizedForward,
  };
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scale) {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

function dotVector(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function crossVector(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalizeVector(vector) {
  const length = vectorLength(vector);
  if (!(length > 0) || !Number.isFinite(length)) {
    return { x: 0, y: 0, z: 0 };
  }
  return scaleVector(vector, 1 / length);
}

function angleDegBetween(left, right) {
  const dot = clamp(dotVector(left, right), -1, 1);
  return Math.acos(dot) * 180 / Math.PI;
}

function quaternionChanged(previous, next) {
  const direct = Math.hypot(
    next.x - previous.x,
    next.y - previous.y,
    next.z - previous.z,
    next.w - previous.w,
  );
  const negated = Math.hypot(
    next.x + previous.x,
    next.y + previous.y,
    next.z + previous.z,
    next.w + previous.w,
  );
  return Math.min(direct, negated) > GATE_EPSILON;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function definedFields(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}
