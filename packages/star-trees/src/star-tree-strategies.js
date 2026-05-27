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
  return {
    createAnchor(view = {}) {
      return { view: normalizeObserverShellView(view) };
    },
    createEvaluator(anchor, context = {}) {
      const view = normalizeObserverShellView(anchor.view);
      const role = context.role ?? 'current';
      const indexMagnitude = normalizeFiniteNumber(context.indexMagnitude, DEFAULT_LIMITING_MAGNITUDE);
      const motion = resolveMotionPriorityContext(view.motion);
      return {
        view,
        distanceToCell: (cell) => distanceToCellAabbPc(view.observerPc, cell),
        evaluateCell(cell, helpers = {}) {
          return toDecision(evaluateObserverShellCell({
            cell,
            view,
            indexMagnitude,
            motion,
            role,
            queuedDistancePc: helpers.queuedDistancePc,
            currentObserverPc: context.currentObserverPc,
          }));
        },
      };
    },
    diff(previous, next, context = {}) {
      return observerShellChange(previous, next, context);
    },
  };
}

/**
 * @param {import('./index.d.ts').TargetFrustumStrategyOptions} [options]
 */
export function createTargetFrustumStrategy(options = {}) {
  return {
    createAnchor(view = {}) {
      return { view: normalizeTargetFrustumView(view, options) };
    },
    createEvaluator(anchor, context = {}) {
      const view = normalizeTargetFrustumView(anchor.view, options);
      const frustum = createFrustumTester(view);
      const role = context.role ?? 'current';
      const indexMagnitude = normalizeFiniteNumber(context.indexMagnitude, DEFAULT_LIMITING_MAGNITUDE);
      return {
        view,
        distanceToCell: (cell) => distanceToCellAabbPc(view.observerPc, cell),
        evaluateCell(cell, helpers = {}) {
          return toDecision(evaluateTargetFrustumCell({
            cell,
            view,
            frustum,
            indexMagnitude,
            role,
            queuedDistancePc: helpers.queuedDistancePc,
          }));
        },
      };
    },
    diff(previous, next, context = {}) {
      return targetFrustumChange(previous, next, context);
    },
  };
}

/**
 * @param {import('./index.d.ts').SphereVolumeStrategyOptions} options
 */
export function createSphereVolumeStrategy(options) {
  const centerPc = normalizeRequiredPoint(options.centerPc, 'centerPc');
  const radiusPc = normalizePositiveNumber(options.radiusPc, 'radiusPc');
  return {
    createAnchor(view = {}) {
      return { view: view ?? {} };
    },
    createEvaluator(anchor) {
      return {
        view: anchor.view ?? {},
        distanceToCell: (cell) => distanceToCellAabbPc(centerPc, cell),
        evaluateCell(cell, helpers = {}) {
          const distancePc = helpers.queuedDistancePc ?? distanceToCellAabbPc(centerPc, cell);
          const relevant = distancePc <= radiusPc;
          const remainingRadiusPc = radiusPc - distancePc;
          return {
            include: relevant,
            descend: relevant,
            emit: relevant,
            distancePc,
            relevance: relevant ? Math.max(0, remainingRadiusPc / radiusPc) : 0,
            priority: livePriority(1, remainingRadiusPc),
            reasons: ['sphere-volume'],
            metadata: {
              centerPc,
              radiusPc,
              distancePc,
            },
          };
        },
      };
    },
    diff(previous, next, context = {}) {
      return fixedStrategyChange(previous, context, 'sphere-volume-unchanged');
    },
  };
}

/**
 * @param {import('./index.d.ts').PathVolumeStrategyOptions} options
 */
export function createPathVolumeStrategy(options) {
  const pointsPc = normalizePathPoints(options.pointsPc);
  const radiusPc = normalizePositiveNumber(options.radiusPc, 'radiusPc');
  return {
    createAnchor(view = {}) {
      return { view: view ?? {} };
    },
    createEvaluator(anchor) {
      const pathDistance = createPathDistanceEvaluator(pointsPc);
      return {
        view: anchor.view ?? {},
        distanceToCell(cell) {
          return pathDistance.distanceToCoordinates(cell.centerX, cell.centerY, cell.centerZ);
        },
        evaluateCell(cell, helpers = {}) {
          const centerDistancePc = helpers.queuedDistancePc !== undefined
            ? helpers.queuedDistancePc
            : pathDistance.distanceToCoordinates(cell.centerX, cell.centerY, cell.centerZ);
          const capsuleRadiusPc = radiusPc + cell.halfSize * SQRT_3;
          const relevant = centerDistancePc <= capsuleRadiusPc;
          const remainingRadiusPc = capsuleRadiusPc - centerDistancePc;
          return {
            include: relevant,
            descend: relevant,
            emit: relevant,
            distancePc: centerDistancePc,
            relevance: relevant ? Math.max(0, remainingRadiusPc / capsuleRadiusPc) : 0,
            priority: livePriority(1, remainingRadiusPc),
            reasons: ['path-volume'],
            metadata: {
              radiusPc,
              centerDistancePc,
              capsuleRadiusPc,
              pointCount: pointsPc.length,
            },
          };
        },
      };
    },
    diff(previous, next, context = {}) {
      return fixedStrategyChange(previous, context, 'path-volume-unchanged');
    },
  };
}

/**
 * @param {import('./index.d.ts').LookaheadStrategyOptions} options
 */
export function createLookaheadStrategy(options) {
  const base = options.base;
  const horizonSecs = normalizePositiveNumber(options.horizonSecs, 'horizonSecs');
  const tickSecs = normalizePositiveNumber(options.tickSecs, 'tickSecs');
  const blackoutSecs = Math.max(0, normalizeFiniteNumber(options.blackoutSecs, 0));
  return {
    createAnchor(view = {}) {
      const baseView = view ?? {};
      return {
        view: baseView,
        params: {
          samples: createLookaheadSampleAnchors(base, baseView, {
            horizonSecs,
            tickSecs,
            blackoutSecs,
          }),
        },
      };
    },
    createEvaluator(anchor, context = {}) {
      const samples = Array.isArray(anchor.params?.samples)
        ? anchor.params.samples
        : [];
      const evaluators = samples.map((sample, index) => ({
        index,
        seconds: sample.seconds,
        evaluator: base.createEvaluator(sample.anchor, {
          ...context,
          role: 'prefetch',
        }),
      }));
      return {
        view: anchor.view ?? {},
        distanceToCell(cell) {
          let distancePc = Number.POSITIVE_INFINITY;
          for (const sample of evaluators) {
            const distanceToCell = sample.evaluator.distanceToCell;
            if (distanceToCell) {
              distancePc = Math.min(distancePc, distanceToCell(cell));
            }
          }
          return Number.isFinite(distancePc) ? distancePc : 0;
        },
        evaluateCell(cell, helpers = {}) {
          return evaluateLookaheadCell(cell, helpers, evaluators);
        },
      };
    },
    diff(previous, next, context = {}) {
      if (!previous) return resetChange(context.reason ?? 'initial');
      const previousSignature = lookaheadAnchorSignature(previous);
      const nextSignature = lookaheadAnchorSignature(next);
      return previousSignature === nextSignature
        ? unchanged(['lookahead-unchanged'])
        : resetChange(context.reason ?? 'lookahead');
    },
  };
}

/**
 * @param {import('./index.d.ts').StarCellStrategy} base
 * @param {import('./index.d.ts').WarmStrategyOptions} [options]
 */
export function createWarmStrategy(base, options = {}) {
  if (!base || typeof base.createAnchor !== 'function' || typeof base.createEvaluator !== 'function') {
    throw new TypeError('createWarmStrategy() requires a strategy object.');
  }
  const lane = typeof options.lane === 'string' && options.lane
    ? options.lane
    : 'warm';
  const reason = typeof options.reason === 'string' && options.reason
    ? options.reason
    : 'warm';
  const band = Number.isFinite(options.band) ? Number(options.band) : null;
  const scoreBias = Number.isFinite(options.scoreBias) ? Number(options.scoreBias) : 0;

  return {
    createAnchor(view = {}) {
      return base.createAnchor(view);
    },
    createEvaluator(anchor, context = {}) {
      const evaluator = base.createEvaluator(anchor, {
        ...context,
        role: 'prefetch',
      });
      return {
        view: evaluator.view,
        ...(typeof evaluator.distanceToCell === 'function'
          ? { distanceToCell: (cell) => evaluator.distanceToCell(cell) }
          : {}),
        evaluateCell(cell, helpers = {}) {
          const decision = evaluator.evaluateCell(cell, helpers);
          return {
            ...decision,
            priority: warmDecisionPriority(decision.priority, {
              lane,
              band,
              scoreBias,
            }),
            reasons: dedupe([reason, ...(decision.reasons ?? [])]),
            contributors: Array.isArray(decision.contributors)
              ? decision.contributors.map((contributor) => ({
                  ...contributor,
                  priority: warmDecisionPriority(contributor.priority, {
                    lane,
                    band,
                    scoreBias,
                  }),
                }))
              : decision.contributors,
            metadata: {
              ...(decision.metadata ?? {}),
              warmLane: lane,
            },
          };
        },
      };
    },
    diff(previous, next, context = {}) {
      return base.diff(previous, next, context);
    },
  };
}

/**
 * @param {import('./index.d.ts').StarCellStrategy[]} strategies
 */
export function combineStrategies(strategies) {
  if (!Array.isArray(strategies) || strategies.length === 0) {
    throw new TypeError('combineStrategies() requires at least one strategy.');
  }

  return {
    createAnchor(view = {}) {
      return {
        view: view ?? {},
        params: {
          anchors: strategies.map((strategy) => strategy.createAnchor(view)),
        },
      };
    },
    createEvaluator(anchor, context = {}) {
      const anchors = Array.isArray(anchor.params?.anchors)
        ? anchor.params.anchors
        : strategies.map((strategy) => strategy.createAnchor(anchor.view));
      const evaluators = strategies.map((strategy, index) =>
        strategy.createEvaluator(anchors[index], context));
      return {
        view: anchor.view ?? {},
        distanceToCell(cell) {
          let distancePc = Number.POSITIVE_INFINITY;
          for (const evaluator of evaluators) {
            if (evaluator.distanceToCell) {
              distancePc = Math.min(distancePc, evaluator.distanceToCell(cell));
            }
          }
          return Number.isFinite(distancePc) ? distancePc : 0;
        },
        evaluateCell(cell, helpers = {}) {
          return mergeDecisions(evaluators.map((evaluator) => {
            const queuedDistancePc = evaluator.distanceToCell
              ? evaluator.distanceToCell(cell)
              : helpers.queuedDistancePc;
            return evaluator.evaluateCell(cell, {
              ...helpers,
              queuedDistancePc,
            });
          }));
        },
      };
    },
    diff(previous, next, context = {}) {
      const previousAnchors = Array.isArray(previous?.params?.anchors)
        ? previous.params.anchors
        : [];
      const nextAnchors = Array.isArray(next.params?.anchors)
        ? next.params.anchors
        : strategies.map((strategy) => strategy.createAnchor(next.view));
      const changes = strategies.map((strategy, index) =>
        strategy.diff(previousAnchors[index] ?? null, nextAnchors[index], context));
      return mergeStrategyChanges(changes, context);
    },
  };
}

/**
 * @param {import('./index.d.ts').StarCellStrategy} strategy
 * @param {import('./index.d.ts').StarTreeViewPatch | undefined} view
 */
export function normalizeStarCellStrategyView(strategy, view) {
  return strategy.createAnchor(view).view;
}

/**
 * @param {import('./index.d.ts').StarCellDecision[]} decisions
 * @returns {import('./index.d.ts').StarCellDecision}
 */
function mergeDecisions(decisions) {
  const includedDecisions = decisions.filter((decision) => decision.include);
  if (includedDecisions.length === 0) {
    return {
      include: false,
      descend: false,
      emit: false,
      contributors: decisions.map(createDecisionContributor),
      reasons: dedupe(decisions.flatMap((decision) => decision.reasons ?? [])),
      metadata: {
        strategyContributors: decisions.map(createDecisionContributor),
      },
    };
  }

  const winner = includedDecisions.reduce((best, next) =>
    comparePriority(next.priority, best.priority) < 0 ? next : best);
  const relevance = Math.max(...includedDecisions.map((decision) => decision.relevance ?? 0));
  const distancePc = Math.min(...includedDecisions.map((decision) =>
    Number.isFinite(decision.distancePc) ? Number(decision.distancePc) : Number.POSITIVE_INFINITY));

  return {
    include: true,
    descend: includedDecisions.some((decision) => decision.descend !== false),
    emit: includedDecisions.some((decision) => decision.emit !== false),
    relevance,
    priority: winner.priority,
    ...(Number.isFinite(distancePc) ? { distancePc } : {}),
    reasons: dedupe(includedDecisions.flatMap((decision) => decision.reasons ?? [])),
    contributors: decisions.map(createDecisionContributor),
    metadata: {
      ...(winner.metadata ?? {}),
      strategyContributors: decisions.map(createDecisionContributor),
    },
  };
}

/**
 * @param {import('./index.d.ts').StarCellDecision} decision
 */
function createDecisionContributor(decision) {
  return {
    priority: decision.priority,
    relevance: decision.relevance,
    reasons: decision.reasons ?? [],
    metadata: decision.metadata,
  };
}

/**
 * @param {import('./index.d.ts').StarCellPriority | undefined} priority
 */
function priorityLaneRank(priority) {
  if (!priority || priority.lane === 'live') return 0;
  if (priority.lane === 'warm') return 1;
  return 2;
}

/**
 * Returns a negative number when left outranks right.
 *
 * @param {import('./index.d.ts').StarCellPriority | undefined} left
 * @param {import('./index.d.ts').StarCellPriority | undefined} right
 */
export function compareStarCellPriority(left, right) {
  const laneDelta = priorityLaneRank(left) - priorityLaneRank(right);
  if (laneDelta !== 0) return laneDelta;
  const bandDelta = (left?.band ?? 0) - (right?.band ?? 0);
  if (bandDelta !== 0) return bandDelta;
  return (right?.score ?? 0) - (left?.score ?? 0);
}

const comparePriority = compareStarCellPriority;

/**
 * @param {number} band
 * @param {number} score
 * @returns {import('./index.d.ts').StarCellPriority}
 */
function livePriority(band, score) {
  return {
    lane: 'live',
    band,
    score: Number.isFinite(score) ? score : 0,
  };
}

/**
 * @param {number} band
 * @param {number} score
 * @returns {import('./index.d.ts').StarCellPriority}
 */
function warmPriority(band, score) {
  return {
    lane: 'warm',
    band,
    score: Number.isFinite(score) ? score : 0,
  };
}

/**
 * @param {import('./index.d.ts').StarCellPriority | undefined} priority
 * @param {{ lane: string; band: number | null; scoreBias: number }} options
 * @returns {import('./index.d.ts').StarCellPriority}
 */
function warmDecisionPriority(priority, options) {
  return {
    lane: options.lane,
    band: options.band ?? priority?.band ?? 0,
    score: (Number.isFinite(priority?.score) ? Number(priority.score) : 0) + options.scoreBias,
  };
}

/**
 * @param {{
 *   relevant: boolean;
 *   descend?: boolean;
 *   emit?: boolean;
 *   role?: 'current' | 'prefetch';
 *   relevance?: number;
 *   priority?: number;
 *   distancePc?: number;
 *   reasons?: string[];
 *   metadata?: Record<string, unknown>;
 * }} evaluation
 * @returns {import('./index.d.ts').StarCellDecision}
 */
function toDecision(evaluation) {
  const lane = evaluation.role === 'prefetch' ? 'warm' : 'live';
  return {
    include: evaluation.relevant,
    descend: evaluation.descend,
    emit: evaluation.emit,
    relevance: evaluation.relevance,
    distancePc: evaluation.distancePc,
    priority: lane === 'warm'
      ? warmPriority(0, evaluation.priority ?? 0)
      : livePriority(0, evaluation.priority ?? 0),
    reasons: evaluation.reasons,
    metadata: evaluation.metadata,
  };
}

function resetChange(reason) {
  return { kind: 'reset', reason, reasons: [reason] };
}

function unchanged(reasons = ['strategy-unchanged']) {
  return { kind: 'none', reasons };
}

function replan(reasons) {
  return { kind: 'regions-changed', regions: [], reasons };
}

/**
 * @param {import('./index.d.ts').StarStrategyChange[]} changes
 * @param {import('./index.d.ts').StarStrategyDiffContext} context
 */
function mergeStrategyChanges(changes, context) {
  const reasons = dedupe(changes.flatMap((change) => change.reasons ?? []));
  const reset = changes.find((change) => change.kind === 'reset');
  if (reset) {
    return resetChange(context.reason ?? reset.reason);
  }
  if (changes.every((change) => change.kind === 'none')) {
    return unchanged(reasons.length > 0 ? reasons : ['strategy-unchanged']);
  }
  return replan(withExplicitReason(context.reason, reasons.length > 0 ? reasons : ['strategy']));
}

/**
 * @param {import('./index.d.ts').StarStrategyAnchor | null | undefined} previous
 * @param {import('./index.d.ts').StarStrategyDiffContext} context
 * @param {string} unchangedReason
 */
function fixedStrategyChange(previous, context, unchangedReason) {
  return previous
    ? unchanged([unchangedReason])
    : resetChange(context.reason ?? 'initial');
}

/**
 * @param {import('./index.d.ts').StarStrategyAnchor | null | undefined} previous
 * @param {import('./index.d.ts').StarStrategyAnchor} next
 * @param {import('./index.d.ts').StarStrategyDiffContext} context
 */
function observerShellChange(previous, next, context) {
  if (!previous) return resetChange(context.reason ?? 'initial');
  return evaluateObserverShellGate({
    thresholds: context.thresholds,
    previousDemandView: previous.view,
    nextView: next.view,
    reason: context.reason,
  });
}

/**
 * @param {import('./index.d.ts').StarStrategyAnchor | null | undefined} previous
 * @param {import('./index.d.ts').StarStrategyAnchor} next
 * @param {import('./index.d.ts').StarStrategyDiffContext} context
 */
function targetFrustumChange(previous, next, context) {
  if (!previous) return resetChange(context.reason ?? 'initial');
  return evaluateTargetFrustumGate({
    thresholds: context.thresholds,
    previousDemandView: previous.view,
    nextView: next.view,
    reason: context.reason,
  });
}

/**
 * @param {import('./index.d.ts').StarCellStrategy} base
 * @param {import('./index.d.ts').StarTreeViewPatch} view
 * @param {{ horizonSecs: number; tickSecs: number; blackoutSecs: number }} options
 */
function createLookaheadSampleAnchors(base, view, options) {
  const observerPc = normalizePoint(view.observerPc, DEFAULT_OBSERVER_PC);
  const velocity = normalizeVelocity(view.motion?.velocityPcPerSec);
  if (!velocity) return [];

  const startSecs = Math.max(
    options.tickSecs,
    options.blackoutSecs > 0 ? options.blackoutSecs : options.tickSecs,
  );
  const samples = [];
  for (let seconds = startSecs; seconds <= options.horizonSecs + GATE_EPSILON; seconds += options.tickSecs) {
    const futureView = {
      ...view,
      observerPc: {
        x: observerPc.x + velocity.x * seconds,
        y: observerPc.y + velocity.y * seconds,
        z: observerPc.z + velocity.z * seconds,
      },
      motion: undefined,
    };
    samples.push({
      seconds,
      anchor: base.createAnchor(futureView),
    });
  }
  return samples;
}

/**
 * @param {import('./index.d.ts').StarTreeCellGeometry} cell
 * @param {{ queuedDistancePc?: number }} helpers
 * @param {{ index: number; seconds: number; evaluator: import('./index.d.ts').StarCellEvaluator }[]} samples
 * @returns {import('./index.d.ts').StarCellDecision}
 */
function evaluateLookaheadCell(cell, helpers, samples) {
  const included = [];
  for (const sample of samples) {
    const distancePc = sample.evaluator.distanceToCell
      ? sample.evaluator.distanceToCell(cell)
      : helpers.queuedDistancePc;
    const decision = sample.evaluator.evaluateCell(cell, {
      queuedDistancePc: distancePc,
    });
    if (decision.include) {
      included.push({ sample, decision });
    }
  }

  if (included.length === 0) {
    return {
      include: false,
      descend: false,
      emit: false,
      reasons: ['lookahead'],
    };
  }

  const best = included.reduce((winner, next) =>
    comparePriority(next.decision.priority, winner.decision.priority) < 0 ? next : winner);
  const sharedCount = included.length;
  const earliestIndex = Math.min(...included.map((entry) => entry.sample.index));
  const bestScore = best.decision.priority?.score ?? 0;
  const distancePc = Math.min(...included.map((entry) =>
    Number.isFinite(entry.decision.distancePc)
      ? Number(entry.decision.distancePc)
      : Number.POSITIVE_INFINITY));

  return {
    include: true,
    descend: included.some((entry) => entry.decision.descend !== false),
    emit: included.some((entry) => entry.decision.emit !== false),
    priority: warmPriority(0, sharedCount * 1e9 - earliestIndex * 1e6 + bestScore),
    relevance: Math.max(...included.map((entry) => entry.decision.relevance ?? 0)),
    ...(Number.isFinite(distancePc) ? { distancePc } : {}),
    reasons: dedupe(['lookahead', ...included.flatMap((entry) => entry.decision.reasons ?? [])]),
    contributors: included.map((entry) => createDecisionContributor(entry.decision)),
    metadata: {
      lookaheadSharedCount: sharedCount,
      lookaheadEarliestSecs: Math.min(...included.map((entry) => entry.sample.seconds)),
      strategyContributors: included.map((entry) => createDecisionContributor(entry.decision)),
    },
  };
}

/**
 * @param {import('./index.d.ts').StarStrategyAnchor} anchor
 */
function lookaheadAnchorSignature(anchor) {
  const samples = Array.isArray(anchor.params?.samples)
    ? anchor.params.samples
    : [];
  return JSON.stringify(samples.map((sample) => ({
    seconds: roundSignatureNumber(sample.seconds),
    view: sample.anchor?.view ?? {},
  })));
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
        : 'lookahead',
    ],
    metadata: {
      distancePc,
      loadRadiusPc,
      limitingMagnitude: options.view.limitingMagnitude,
      indexMagnitude: options.indexMagnitude,
      ...(options.role === 'prefetch'
        ? {
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
  const loadRadiusPc = loadRadiusForMagnitudeShell(
    options.cell.halfSize,
    options.view.limitingMagnitude,
    options.indexMagnitude,
  );
  const minimumDistancePc = options.queuedDistancePc ??
    distanceToCellAabbPc(options.view.observerPc, options.cell);

  if (minimumDistancePc > loadRadiusPc) {
    return {
      relevant: false,
      descend: false,
      distancePc: minimumDistancePc,
      metadata: {
        shellRejected: true,
        distancePc: minimumDistancePc,
        loadRadiusPc,
      },
    };
  }

  const visiblePoint = options.frustum.nearestVisiblePointToCell(options.cell);

  if (!visiblePoint) {
    return {
      relevant: false,
      descend: false,
      distancePc: minimumDistancePc,
      metadata: {
        frustumRejected: true,
      },
    };
  }

  const distancePc = visiblePoint.distancePc;
  const relevant = distancePc <= loadRadiusPc;

  if (!relevant) {
    return {
      relevant: false,
      descend: false,
      distancePc,
      metadata: {
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
        : 'lookahead',
    ],
    metadata: {
      distancePc,
      forwardDistancePc: visiblePoint.forwardDistancePc,
      nearestVisiblePc: visiblePoint.point,
      loadRadiusPc,
      limitingMagnitude: options.view.limitingMagnitude,
      indexMagnitude: options.indexMagnitude,
      frustumMode: options.view.frustumMode,
      ...(options.role === 'prefetch'
        ? {
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
 * @param {import('./index.d.ts').TargetFrustumStrategyOptions} options
 */
export function normalizeTargetFrustumView(view = {}, options = {}) {
  const observerPc = normalizePoint(view.observerPc, DEFAULT_OBSERVER_PC);
  const limitingMagnitude = normalizeFiniteNumber(
    view.limitingMagnitude ?? view.mDesired,
    DEFAULT_LIMITING_MAGNITUDE,
  );
  const orientationIcrs = normalizeQuaternion(view.orientationIcrs);
  const targetPc = normalizeOptionalPoint(view.targetPc);
  const targetVector = targetPc ? subtractVectors(targetPc, observerPc) : null;
  const targetDistancePc = targetVector ? vectorLength(targetVector) : null;

  if (targetVector && targetDistancePc && targetDistancePc > 0) {
    const targetDirection = scaleVector(targetVector, 1 / targetDistancePc);
    const verticalFovDeg = normalizeFinitePositiveNumber(
      view.verticalFovDeg ?? options.verticalFovDeg,
      DEFAULT_TARGET_VERTICAL_FOV_DEG,
      'verticalFovDeg',
    );
    const aspectRatio = normalizeFinitePositiveNumber(
      view.aspectRatio,
      DEFAULT_TARGET_ASPECT_RATIO,
      'aspectRatio',
    );
    const nearPc = normalizeNonNegativeNumber(
      view.nearPc ?? options.nearPc ?? DEFAULT_TARGET_NEAR_PC,
      'nearPc',
    );
    const explicitFarPc = view.farPc ?? options.farPc;
    const targetRadiusPc = normalizeFinitePositiveNumber(
      options.targetRadiusPc,
      DEFAULT_TARGET_RADIUS_PC,
      'targetRadiusPc',
    );
    const preloadDistancePc = normalizeFiniteNumber(view.preloadDistancePc, 0);
    const farPc = explicitFarPc !== undefined
      ? Number(explicitFarPc)
      : targetDistancePc + targetRadiusPc + Math.max(0, preloadDistancePc);

    if (!Number.isFinite(farPc) || farPc <= nearPc) {
      throw createInvalidViewError('target-frustum farPc must be greater than nearPc.');
    }

    return {
      ...view,
      observerPc,
      limitingMagnitude,
      frustumBasis: cameraBasisFromForward(targetDirection),
      frustumMode: 'target',
      verticalFovDeg,
      aspectRatio,
      nearPc,
      overscanDeg: normalizeFiniteNumber(
        options.overscanDeg,
        DEFAULT_TARGET_OVERSCAN_DEG,
      ),
      targetPc,
      targetDistancePc,
      targetRadiusPc,
      farPc: Number(farPc),
      ...(orientationIcrs ? { orientationIcrs } : {}),
    };
  }

  if (orientationIcrs) {
    const verticalFovDeg = normalizePositiveNumber(
      view.verticalFovDeg ?? options.verticalFovDeg,
      'verticalFovDeg',
    );
    const aspectRatio = normalizePositiveNumber(view.aspectRatio, 'aspectRatio');
    const nearPc = normalizeNonNegativeNumber(
      view.nearPc ?? options.nearPc ?? DEFAULT_TARGET_NEAR_PC,
      'nearPc',
    );
    const farPc = view.farPc ?? options.farPc;

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
      ...(options.overscanDeg !== undefined
        ? { overscanDeg: Number(options.overscanDeg) }
        : {}),
    };
  }

  throw createInvalidViewError(
    'target-frustum requires targetPc or orientationIcrs.',
  );
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
 *   strategy: import('./index.d.ts').StarCellStrategy;
 *   thresholds?: import('./index.d.ts').StarTreeDemandThresholds;
 *   previousAnchor: import('./index.d.ts').StarStrategyAnchor | null;
 *   nextAnchor: import('./index.d.ts').StarStrategyAnchor;
 *   reason?: string;
 * }} options
 * @returns {{ replan: boolean; reasons: string[] }}
 */
export function evaluateStarCellStrategyChange(options) {
  const change = options.strategy.diff(options.previousAnchor, options.nextAnchor, {
    thresholds: options.thresholds,
    reason: options.reason,
  });
  const reasons = change.reasons?.length
    ? change.reasons
    : defaultQueuedReasons(options.reason, change.kind === 'none' ? 'strategy-unchanged' : 'strategy');
  return {
    replan: change.kind !== 'none',
    reasons,
  };
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
    createFrustumPlane(basis.forward, -view.nearPc),
    ...(view.farPc !== undefined
      ? [createFrustumPlane(scaleVector(basis.forward, -1), view.farPc)]
      : []),
    createFrustumPlane(
      normalizeVector(addVectors(scaleVector(basis.forward, tanVertical), scaleVector(basis.up, -1))),
      0,
    ),
    createFrustumPlane(
      normalizeVector(addVectors(scaleVector(basis.forward, tanVertical), basis.up)),
      0,
    ),
    createFrustumPlane(
      normalizeVector(addVectors(scaleVector(basis.forward, tanHorizontal), scaleVector(basis.right, -1))),
      0,
    ),
    createFrustumPlane(
      normalizeVector(addVectors(scaleVector(basis.forward, tanHorizontal), basis.right)),
      0,
    ),
  ];
  // farPc is a forward-plane distance; use the corner ray length for a safe radial cull.
  const maxVisibleDistancePc = view.farPc !== undefined
    ? view.farPc * Math.hypot(1, tanHorizontal, tanVertical)
    : undefined;
  const boundaryRays = createFrustumBoundaryRays(view, basis, tanHorizontal, tanVertical);

  return {
    basis,
    containsPoint(point) {
      return containsPointInFrustum(point);
    },
    intersectsCell,
    nearestVisiblePointToCell(cell) {
      if (!intersectsCell(cell)) {
        return null;
      }

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

      for (const ray of boundaryRays) {
        const clipped = clipRayToAabb(view.observerPc, ray, bounds);
        if (clipped) {
          addCandidate(clipped);
        }
      }

      return nearest;
    },
  };

  function intersectsCell(cell) {
    const relativeCenterX = cell.centerX - view.observerPc.x;
    const relativeCenterY = cell.centerY - view.observerPc.y;
    const relativeCenterZ = cell.centerZ - view.observerPc.z;

    if (outsideRadialFrustumBounds(
      relativeCenterX,
      relativeCenterY,
      relativeCenterZ,
      cell.halfSize,
    )) {
      return false;
    }

    for (const plane of planes) {
      const centerDistance =
        plane.normal.x * relativeCenterX +
        plane.normal.y * relativeCenterY +
        plane.normal.z * relativeCenterZ +
        plane.offset;
      const radius = cell.halfSize * plane.radiusScale;
      if (centerDistance + radius < 0) {
        return false;
      }
    }

    return true;
  }

  function outsideRadialFrustumBounds(relativeCenterX, relativeCenterY, relativeCenterZ, halfSize) {
    const centerDistanceSquared =
      relativeCenterX * relativeCenterX +
      relativeCenterY * relativeCenterY +
      relativeCenterZ * relativeCenterZ;
    const halfDiagonalPc = halfSize * SQRT_3;

    if (maxVisibleDistancePc !== undefined) {
      const maximumDistancePc = maxVisibleDistancePc + halfDiagonalPc + GEOMETRY_EPSILON;
      if (centerDistanceSquared > maximumDistancePc * maximumDistancePc) {
        return true;
      }
    }

    const minimumDistancePc = view.nearPc - halfDiagonalPc - GEOMETRY_EPSILON;
    return minimumDistancePc > 0 && centerDistanceSquared < minimumDistancePc * minimumDistancePc;
  }

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
    orientationForwardChanged(
      previousView.orientationIcrs,
      nextView.orientationIcrs,
      thresholds.directionAngleDeg,
    )
  ) {
    reasons.push('view-volume');
  }

  for (const field of ['verticalFovDeg', 'aspectRatio', 'nearPc', 'farPc', 'preloadDistancePc']) {
    if (targetScalarChanged(field, previousView, nextView)) {
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

function targetScalarChanged(field, previousView, nextView, options = {}) {
  return scalarChanged(
    targetScalar(field, previousView, options),
    targetScalar(field, nextView, options),
  );
}

function targetScalar(field, view, options = {}) {
  if (field === 'verticalFovDeg') {
    return view.verticalFovDeg ?? options.verticalFovDeg ??
      (view.targetPc ? DEFAULT_TARGET_VERTICAL_FOV_DEG : undefined);
  }

  if (field === 'aspectRatio') {
    return view.aspectRatio ??
      (view.targetPc ? DEFAULT_TARGET_ASPECT_RATIO : undefined);
  }

  if (field === 'nearPc') {
    return view.nearPc ?? options.nearPc ?? 0;
  }

  if (field === 'farPc') {
    return view.farPc ?? options.farPc ?? implicitTargetFarPc(view, options);
  }

  if (field === 'preloadDistancePc') {
    return view.preloadDistancePc ?? 0;
  }

  return undefined;
}

function implicitTargetFarPc(view, options = {}) {
  if (!view.targetPc) {
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
    options.targetRadiusPc,
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

function createFrustumPlane(normal, offset) {
  return {
    normal,
    offset,
    radiusScale: Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z),
  };
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

  const directionX = ray.direction.x;
  if (Math.abs(directionX) <= GEOMETRY_EPSILON) {
    if (origin.x < bounds.minX - GEOMETRY_EPSILON || origin.x > bounds.maxX + GEOMETRY_EPSILON) {
      return null;
    }
  } else {
    const first = (bounds.minX - origin.x) / directionX;
    const second = (bounds.maxX - origin.x) / directionX;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower - upper > GEOMETRY_EPSILON) return null;
  }

  const directionY = ray.direction.y;
  if (Math.abs(directionY) <= GEOMETRY_EPSILON) {
    if (origin.y < bounds.minY - GEOMETRY_EPSILON || origin.y > bounds.maxY + GEOMETRY_EPSILON) {
      return null;
    }
  } else {
    const first = (bounds.minY - origin.y) / directionY;
    const second = (bounds.maxY - origin.y) / directionY;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower - upper > GEOMETRY_EPSILON) return null;
  }

  const directionZ = ray.direction.z;
  if (Math.abs(directionZ) <= GEOMETRY_EPSILON) {
    if (origin.z < bounds.minZ - GEOMETRY_EPSILON || origin.z > bounds.maxZ + GEOMETRY_EPSILON) {
      return null;
    }
  } else {
    const first = (bounds.minZ - origin.z) / directionZ;
    const second = (bounds.maxZ - origin.z) / directionZ;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower - upper > GEOMETRY_EPSILON) return null;
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
