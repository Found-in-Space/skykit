/**
 * @typedef {import('./index.d.ts').StarOctreeDemandGateResult} StarOctreeDemandGateResult
 * @typedef {import('./index.d.ts').StarOctreeDemandThresholds} StarOctreeDemandThresholds
 * @typedef {import('./index.d.ts').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('./index.d.ts').StarOctreeViewState} StarOctreeViewState
 */

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_TARGET_VERTICAL_FOV_DEG = 40;
const DEFAULT_TARGET_ASPECT_RATIO = 1;
const DEFAULT_TARGET_RADIUS_PC = 96;
const EPSILON = 1e-12;

/**
 * @param {{
 *   strategy: StarOctreeFetchStrategy;
 *   thresholds?: StarOctreeDemandThresholds;
 *   previousDemandView: StarOctreeViewState | null;
 *   nextView: StarOctreeViewState;
 *   reason?: string;
 * }} options
 * @returns {{ replan: boolean; reasons: string[] }}
 */
export function evaluateDemandGate(options) {
  if (options.strategy.kind === 'custom') {
    return evaluateCustomDemandGate(options);
  }

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
 * @param {Parameters<typeof evaluateDemandGate>[0]} options
 */
function evaluateMotionLookaheadGate(options) {
  const strategy = /** @type {Extract<StarOctreeFetchStrategy, { kind: 'motion-lookahead' }>} */ (options.strategy);
  const baseGate = evaluateDemandGate({
    ...options,
    strategy: strategy.strategy,
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

/**
 * @param {Parameters<typeof evaluateDemandGate>[0]} options
 */
function evaluateCompositeGate(options) {
  const strategy = /** @type {Extract<StarOctreeFetchStrategy, { kind: 'composite' }>} */ (options.strategy);
  const results = strategy.strategies.map((childStrategy) =>
    evaluateDemandGate({
      ...options,
      strategy: childStrategy,
    }),
  );
  const reasons = dedupe(results.flatMap((result) => result.reasons));

  return results.some((result) => result.replan)
    ? replan(withExplicitReason(options.reason, reasons))
    : unchanged(reasons.length > 0 ? reasons : ['composite-unchanged']);
}

/**
 * @param {Parameters<typeof evaluateDemandGate>[0]} options
 */
function evaluateFixedVolumeGate(options) {
  if (!options.previousDemandView) {
    return replan(defaultQueuedReasons(options.reason, 'initial'));
  }

  return unchanged([`${options.strategy.kind}-unchanged`]);
}

/**
 * @param {Parameters<typeof evaluateDemandGate>[0]} options
 */
function evaluateCustomDemandGate(options) {
  const strategy = /** @type {Extract<StarOctreeFetchStrategy, { kind: 'custom' }>} */ (options.strategy);

  if (!strategy.shouldReplan) {
    return replan(defaultQueuedReasons(options.reason, 'custom-strategy'));
  }

  const result = strategy.shouldReplan({
    strategy,
    thresholds: options.thresholds,
    previousDemandView: options.previousDemandView,
    nextView: options.nextView,
    reason: options.reason,
  });

  if (isPromiseLike(result)) {
    throw new TypeError('Custom star octree shouldReplan() must return synchronously.');
  }

  return normalizeCustomGateResult(result, options.reason);
}

/**
 * @param {StarOctreeDemandGateResult} result
 * @param {string | undefined} reason
 */
function normalizeCustomGateResult(result, reason) {
  if (typeof result === 'boolean') {
    return result
      ? replan(defaultQueuedReasons(reason, 'custom-strategy'))
      : unchanged(['custom-strategy-unchanged']);
  }

  if (result?.replan) {
    return replan(result.reasons?.length
      ? result.reasons
      : defaultQueuedReasons(reason, 'custom-strategy'));
  }

  return unchanged(result?.reasons?.length
    ? result.reasons
    : ['custom-strategy-unchanged']);
}

/**
 * @param {Parameters<typeof evaluateDemandGate>[0]} options
 */
function evaluateObserverShellGate(options) {
  const thresholds = normalizeThresholds(options.thresholds);
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

/**
 * @param {Parameters<typeof evaluateDemandGate>[0]} options
 */
function evaluateTargetFrustumGate(options) {
  const thresholds = normalizeThresholds(options.thresholds);
  const reasons = [];
  const previousView = /** @type {StarOctreeViewState} */ (options.previousDemandView);
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
    if (
      targetScalarChanged(
        field,
        previousView,
        nextView,
        /** @type {Extract<StarOctreeFetchStrategy, { kind: 'target-frustum' }>} */ (options.strategy),
      )
    ) {
      reasons.push('view-volume');
      break;
    }
  }

  return reasons.length > 0
    ? replan(withExplicitReason(options.reason, dedupe(reasons)))
    : unchanged(['threshold-unchanged']);
}

/**
 * @param {StarOctreeDemandThresholds | undefined} thresholds
 * @returns {StarOctreeDemandThresholds}
 */
export function normalizeDemandThresholds(thresholds) {
  return normalizeThresholds(thresholds);
}

/**
 * @param {StarOctreeDemandThresholds | undefined} thresholds
 * @returns {StarOctreeDemandThresholds}
 */
function normalizeThresholds(thresholds) {
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
 * @param {unknown} value
 */
function validThreshold(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/**
 * @param {string | undefined} explicitReason
 * @param {string} fallback
 */
function defaultQueuedReasons(explicitReason, fallback) {
  return explicitReason ? [explicitReason] : [fallback];
}

/**
 * @param {string | undefined} explicitReason
 * @param {string[]} reasons
 */
function withExplicitReason(explicitReason, reasons) {
  if (!explicitReason || reasons.includes(explicitReason)) {
    return dedupe(reasons);
  }
  return [explicitReason, ...dedupe(reasons)];
}

/**
 * @param {string[]} reasons
 */
function dedupe(reasons) {
  return Array.from(new Set(reasons));
}

/**
 * @param {string[]} reasons
 */
function replan(reasons) {
  return { replan: true, reasons };
}

/**
 * @param {string[]} reasons
 */
function unchanged(reasons) {
  return { replan: false, reasons };
}

/**
 * @param {StarOctreeViewState | null} view
 */
function observerPc(view) {
  return normalizePoint(view?.observerPc, DEFAULT_OBSERVER_PC);
}

/**
 * @param {StarOctreeViewState | null} view
 */
function limitingMagnitude(view) {
  return normalizeFiniteNumber(
    view?.limitingMagnitude ?? view?.mDesired,
    DEFAULT_LIMITING_MAGNITUDE,
  );
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
 * @param {{ x: number; y: number; z: number }} previous
 * @param {{ x: number; y: number; z: number }} next
 * @param {number | undefined} threshold
 */
function pointDifferenceExceeds(previous, next, threshold) {
  const distance = Math.hypot(
    next.x - previous.x,
    next.y - previous.y,
    next.z - previous.z,
  );

  if (threshold === undefined) {
    return distance > EPSILON;
  }

  return distance > threshold;
}

/**
 * @param {number} previous
 * @param {number} next
 * @param {number | undefined} threshold
 */
function numberDifferenceExceeds(previous, next, threshold) {
  const difference = Math.abs(next - previous);

  if (threshold === undefined) {
    return difference > EPSILON;
  }

  return difference > threshold;
}

/**
 * @param {unknown} previous
 * @param {unknown} next
 */
function pointChanged(previous, next) {
  const previousPoint = optionalPoint(previous);
  const nextPoint = optionalPoint(next);
  if (!previousPoint && !nextPoint) return false;
  if (!previousPoint || !nextPoint) return true;
  return pointDifferenceExceeds(previousPoint, nextPoint, undefined);
}

/**
 * @param {unknown} value
 */
function optionalPoint(value) {
  if (!value || typeof value !== 'object') return null;
  const point = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : null;
}

/**
 * @param {StarOctreeViewState | null} view
 */
function motionLookaheadSignature(view) {
  const motion = view?.motion;
  const velocity = optionalPoint(motion?.velocityPcPerSec);
  const lookaheadSecs = Number(motion?.lookaheadSecs);
  if (!velocity || !Number.isFinite(lookaheadSecs) || !(lookaheadSecs > 0)) {
    return 'none';
  }

  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (!(speed > EPSILON)) {
    return 'none';
  }

  return [
    roundSignatureNumber(velocity.x),
    roundSignatureNumber(velocity.y),
    roundSignatureNumber(velocity.z),
    roundSignatureNumber(lookaheadSecs),
  ].join(':');
}

/**
 * @param {number} value
 */
function roundSignatureNumber(value) {
  return Number.isFinite(value)
    ? String(Math.round(value / EPSILON) * EPSILON)
    : 'nan';
}

/**
 * @param {unknown} previous
 * @param {unknown} next
 * @param {number | undefined} thresholdDeg
 */
function directionChanged(previous, next, thresholdDeg) {
  const previousDirection = optionalNormalizedVector(previous);
  const nextDirection = optionalNormalizedVector(next);
  if (!previousDirection && !nextDirection) return false;
  if (!previousDirection || !nextDirection) return true;

  if (thresholdDeg === undefined) {
    return pointDifferenceExceeds(previousDirection, nextDirection, undefined);
  }

  return angleDegBetween(previousDirection, nextDirection) > thresholdDeg;
}

/**
 * @param {unknown} previous
 * @param {unknown} next
 * @param {number | undefined} thresholdDeg
 */
function orientationForwardChanged(previous, next, thresholdDeg) {
  const previousQuaternion = optionalQuaternion(previous);
  const nextQuaternion = optionalQuaternion(next);
  if (!previousQuaternion && !nextQuaternion) return false;
  if (!previousQuaternion || !nextQuaternion) return true;

  if (thresholdDeg === undefined && quaternionChanged(previousQuaternion, nextQuaternion)) {
    return true;
  }

  return angleDegBetween(
    quaternionForward(previousQuaternion),
    quaternionForward(nextQuaternion),
  ) > (thresholdDeg ?? 0);
}

/**
 * @param {unknown} value
 */
function optionalNormalizedVector(value) {
  const point = optionalPoint(value);
  if (!point) return null;
  const length = Math.hypot(point.x, point.y, point.z);
  if (length <= EPSILON) return null;
  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
  };
}

/**
 * @param {unknown} value
 */
function optionalQuaternion(value) {
  if (!value || typeof value !== 'object') return null;
  const quaternion = /** @type {{ x?: unknown; y?: unknown; z?: unknown; w?: unknown }} */ (value);
  const x = Number(quaternion.x);
  const y = Number(quaternion.y);
  const z = Number(quaternion.z);
  const w = Number(quaternion.w);
  const length = Math.hypot(x, y, z, w);
  return Number.isFinite(length) && length > EPSILON
    ? { x: x / length, y: y / length, z: z / length, w: w / length }
    : null;
}

/**
 * @param {{ x: number; y: number; z: number; w: number }} previous
 * @param {{ x: number; y: number; z: number; w: number }} next
 */
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
  return Math.min(direct, negated) > EPSILON;
}

/**
 * @param {{ x: number; y: number; z: number; w: number }} quaternion
 */
function quaternionForward(quaternion) {
  return rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, quaternion);
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 * @param {{ x: number; y: number; z: number; w: number }} quaternion
 */
function rotateVectorByQuaternion(vector, quaternion) {
  const u = { x: quaternion.x, y: quaternion.y, z: quaternion.z };
  const s = quaternion.w;
  const dotUV = dotVector(u, vector);
  const dotUU = dotVector(u, u);
  const crossUV = crossVector(u, vector);
  return {
    x: 2 * dotUV * u.x + (s * s - dotUU) * vector.x + 2 * s * crossUV.x,
    y: 2 * dotUV * u.y + (s * s - dotUU) * vector.y + 2 * s * crossUV.y,
    z: 2 * dotUV * u.z + (s * s - dotUU) * vector.z + 2 * s * crossUV.z,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function angleDegBetween(left, right) {
  const dot = clamp(dotVector(left, right), -1, 1);
  return Math.acos(dot) * 180 / Math.PI;
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function dotVector(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function crossVector(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {string} field
 * @param {StarOctreeViewState} previousView
 * @param {StarOctreeViewState} nextView
 * @param {Extract<StarOctreeFetchStrategy, { kind: 'target-frustum' }>} strategy
 */
function targetScalarChanged(field, previousView, nextView, strategy) {
  return scalarChanged(
    targetScalar(field, previousView, strategy),
    targetScalar(field, nextView, strategy),
  );
}

/**
 * @param {string} field
 * @param {StarOctreeViewState} view
 * @param {Extract<StarOctreeFetchStrategy, { kind: 'target-frustum' }>} strategy
 */
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

/**
 * @param {StarOctreeViewState} view
 * @param {Extract<StarOctreeFetchStrategy, { kind: 'target-frustum' }>} strategy
 */
function implicitTargetFarPc(view, strategy) {
  if (view.orientationIcrs || !view.targetPc) {
    return undefined;
  }

  const observer = observerPc(view);
  const target = optionalPoint(view.targetPc);
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

/**
 * @param {unknown} previous
 * @param {unknown} next
 */
function scalarChanged(previous, next) {
  if (previous === undefined && next === undefined) return false;
  const previousNumber = Number(previous);
  const nextNumber = Number(next);
  if (!Number.isFinite(previousNumber) || !Number.isFinite(nextNumber)) {
    return previous !== next;
  }
  return Math.abs(nextNumber - previousNumber) > EPSILON;
}

/**
 * @param {unknown} value
 */
function isPromiseLike(value) {
  return Boolean(
    value &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof /** @type {{ then?: unknown }} */ (value).then === 'function',
  );
}
