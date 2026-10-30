import { requiredSpatialVector3 } from './math.js';
import {
  raDecDistanceToIcrs,
} from './coordinates.js';
import {
  SPATIAL_LOCAL_FORWARD,
  SPATIAL_LOCAL_UP,
  addSpatialVectors,
  applySpatialQuaternion,
  cloneSpatialQuaternion,
  cloneSpatialVector3,
  createSpatialQuaternionFromAxisAngle,
  createSpatialQuaternionFromForwardUp,
  dotSpatialVectors,
  getSpatialVectorLength,
  isNonZeroSpatialVector,
  normalizeDirectionOr,
  normalizeSpatialDirection,
  normalizeSpatialQuaternion,
  normalizeSpatialVector3,
  perpendicularTo,
  scaleSpatialVector,
  subtractSpatialVectors,
} from './math.js';
import {
  EPSILON,
  copySource,
  degreesToRadians,
  finiteNumber,
  finiteNumberInRange,
  finiteRequiredNumber,
  nonNegativeFiniteNumber,
  nonNegativeIntegerRequired,
  positiveFiniteNumber,
  warning,
} from './numerics.js';
import {
  assertSpatialCoordinateSpace,
  normalizeSpatialCoordinateSpace,
  spatialSpaceFor,
} from './spaces.js';

export function sampleToAimSpec(sample) {
  if (sample.kind === 'target') {
    return {
      kind: 'target',
      target: cloneSpatialVector3(sample.target),
      ...(sample.up !== undefined ? { up: cloneSpatialVector3(sample.up) } : {}),
      ...(sample.positionAngleDeg !== undefined ? { positionAngleDeg: finiteNumber(sample.positionAngleDeg, 0) } : {}),
      ...(sample.lock !== undefined ? { lock: sample.lock === true } : {}),
      ...copySource(sample),
    };
  }
  if (sample.kind === 'direction') {
    return {
      kind: 'direction',
      forward: cloneSpatialVector3(sample.forward),
      ...(sample.up !== undefined ? { up: cloneSpatialVector3(sample.up) } : {}),
      ...(sample.positionAngleDeg !== undefined ? { positionAngleDeg: finiteNumber(sample.positionAngleDeg, 0) } : {}),
      ...copySource(sample),
    };
  }
  return {
    kind: 'orientation',
    orientation: cloneSpatialQuaternion(sample.orientation),
    ...copySource(sample),
  };
}

export const DEFAULT_SYNTHETIC_TARGET_DISTANCE_UNITS = 1;

export function normalizeSpatialPose(input, inheritedSpace) {
  if (input == null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected a spatial pose object.');
  const space = spatialSpaceFor(input, inheritedSpace);
  return { space, position: normalizeSpatialVector3(input.position), orientation: normalizeSpatialQuaternion(input.orientation) };
}

export function cloneSpatialPose(pose) {
  return { space: normalizeSpatialCoordinateSpace(pose.space), position: cloneSpatialVector3(pose.position), orientation: cloneSpatialQuaternion(pose.orientation) };
}

export function normalizeSpatialTarget(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialTargetSpec object.');
  }
  if (input.kind === 'position') {
    return { space,
      kind: 'position',
      target: requiredSpatialVector3(input.target, 'target'),
      ...copySource(input),
    };
  }
  if (input.kind === 'radec') {
    const hasRaDeg = input.raDeg !== undefined;
    const hasRaHours = input.raHours !== undefined;
    if (hasRaDeg === hasRaHours) {
      throw new TypeError('RA/Dec targets require exactly one of raDeg or raHours.');
    }
    const decDeg = finiteNumberInRange(input.decDeg, -90, 90, 'decDeg');
    const ra = hasRaDeg
      ? finiteRequiredNumber(input.raDeg, 'raDeg')
      : finiteRequiredNumber(input.raHours, 'raHours');
    const distance = positiveFiniteNumber(input.distance, 'distance');
    return { space,
      kind: 'radec',
      ...(hasRaDeg ? { raDeg: ra } : { raHours: ra }),
      decDeg,
      distance,
      ...copySource(input),
    };
  }
  if (input.kind === 'bookmark') {
    if (typeof input.id !== 'string' || input.id.length === 0) {
      throw new TypeError('Bookmark targets require an id.');
    }
    return { space, kind: 'bookmark', id: input.id, ...copySource(input) };
  }
  throw new TypeError(`Unsupported spatial target kind: ${String(input.kind)}`);
}

export function resolveSpatialTarget(input, options = {}) {
  const space = spatialSpaceFor(input);
  const target = normalizeSpatialTarget(input, space);
  if (target.kind === 'position') return cloneSpatialVector3(target.target);
  if (target.kind === 'radec') return raDecDistanceToIcrs(target);
  const resolver = options.resolveBookmark;
  if (typeof resolver !== 'function') return null;
  const resolved = resolver(target.id, target);
  if (resolved && typeof resolved.then === 'function') {
    return resolved.then((value) => {
      if (!value) return null;
      assertSpatialCoordinateSpace(value.space, space);
      return resolveSpatialTarget(value, options);
    });
  }
  if (resolved) assertSpatialCoordinateSpace(resolved.space, space);
  return resolved ? resolveSpatialTarget(resolved, options) : null;
}

export function normalizeSpatialAimSpec(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialAimSpec object.');
  }
  if (input.kind === 'target') {
    if (input.lock !== undefined && typeof input.lock !== 'boolean') {
      throw new TypeError('Target aim lock must be a boolean.');
    }
    return { space,
      kind: 'target',
      target: requiredSpatialVector3(input.target, 'target'),
      ...(input.up !== undefined ? { up: normalizeSpatialVector3(input.up) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: finiteRequiredNumber(input.positionAngleDeg, 'positionAngleDeg') } : {}),
      ...(input.lock !== undefined ? { lock: input.lock } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'direction') {
    const forward = requiredSpatialVector3(input.forward, 'forward');
    if (!isNonZeroSpatialVector(forward)) {
      throw new RangeError('Direction aim forward must be non-zero.');
    }
    return { space,
      kind: 'direction',
      forward: normalizeSpatialDirection(forward),
      ...(input.up !== undefined ? { up: normalizeSpatialVector3(input.up) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: finiteRequiredNumber(input.positionAngleDeg, 'positionAngleDeg') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'orientation') {
    if (input.orientation == null) throw new TypeError('orientation is required.');
    return { space,
      kind: 'orientation',
      orientation: normalizeSpatialQuaternion(input.orientation),
      ...copySource(input),
    };
  }
  throw new TypeError(`Unsupported spatial aim kind: ${String(input.kind)}`);
}

export function evaluateSpatialAim(input) {
  const space = spatialSpaceFor(input, input?.aim?.space);
  const position = requiredSpatialVector3(input?.position, 'position');
  const aim = normalizeSpatialAimSpec(input?.aim, space);
  const syntheticTargetDistance = input.syntheticTargetDistance === undefined
    ? DEFAULT_SYNTHETIC_TARGET_DISTANCE_UNITS
    : positiveFiniteNumber(input.syntheticTargetDistance, 'syntheticTargetDistance');
  if (aim.kind === 'target') {
    const offset = subtractSpatialVectors(aim.target, position);
    const distance = getSpatialVectorLength(offset);
    const warnings = [];
    const forward = distance > 0
      ? scaleSpatialVector(offset, 1 / distance)
      : cloneSpatialVector3(SPATIAL_LOCAL_FORWARD);
    if (!(distance > 0)) {
      warnings.push(warning('degenerateTargetAim', 'Target aim is at the observer position.'));
    }
    const up = resolveAimUp(forward, aim.up, aim.positionAngleDeg, warnings);
    return { space,
      kind: 'target',
      target: cloneSpatialVector3(aim.target),
      forward,
      up,
      orientation: createSpatialQuaternionFromForwardUp(forward, up),
      distance,
      ...copySource(aim),
      diagnostics: { warnings },
    };
  }
  if (aim.kind === 'direction') {
    const warnings = [];
    const forward = normalizeDirectionOr(aim.forward, SPATIAL_LOCAL_FORWARD);
    const up = resolveAimUp(forward, aim.up, aim.positionAngleDeg, warnings);
    return { space,
      kind: 'direction',
      forward,
      up,
      orientation: createSpatialQuaternionFromForwardUp(forward, up),
      syntheticTarget: addSpatialVectors(position, scaleSpatialVector(forward, syntheticTargetDistance)),
      syntheticTargetDistance,
      ...copySource(aim),
      diagnostics: { warnings },
    };
  }
  const orientation = normalizeSpatialQuaternion(aim.orientation);
  const forward = normalizeDirectionOr(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, orientation), SPATIAL_LOCAL_FORWARD);
  const up = normalizeDirectionOr(applySpatialQuaternion(SPATIAL_LOCAL_UP, orientation), SPATIAL_LOCAL_UP);
  return { space,
    kind: 'orientation',
    forward,
    up,
    orientation,
    syntheticTarget: addSpatialVectors(position, scaleSpatialVector(forward, syntheticTargetDistance)),
    syntheticTargetDistance,
    ...copySource(aim),
    diagnostics: { warnings: [] },
  };
}

export function normalizeSpatialFrameState(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialFrameState object.');
  return { space,
    ...(input.timeSecs !== undefined ? { timeSecs: nonNegativeFiniteNumber(input.timeSecs, 'timeSecs') } : {}),
    ...(input.frameIndex !== undefined ? { frameIndex: nonNegativeIntegerRequired(input.frameIndex, 'frameIndex') } : {}),
    pose: normalizeSpatialPose(input.pose, space),
    aim: input.aim == null ? null : input.aim,
    ...(input.targetLock !== undefined ? { targetLock: input.targetLock } : {}),
    ...(input.orbit !== undefined ? { orbit: input.orbit } : {}),
    ...(input.pathFollow !== undefined ? { pathFollow: input.pathFollow } : {}),
    ...(input.fovDeg !== undefined ? { fovDeg: positiveFiniteNumber(input.fovDeg, 'fovDeg') } : {}),
  };
}

export function frameStateAimSpec(frameState) {
  const space = spatialSpaceFor(frameState.pose);
  return frameState.aim?.kind
    ? sampleToAimSpec(frameState.aim)
    : { kind: 'orientation', orientation: frameState.pose.orientation };
}

export function cloneFrameState(frameState) {
  return {
    ...frameState,
    pose: cloneSpatialPose(frameState.pose),
    aim: frameState.aim ? cloneAimSample(frameState.aim) : null,
    targetLock: frameState.targetLock ? { ...frameState.targetLock, target: cloneSpatialVector3(frameState.targetLock.target) } : null,
  };
}

export function cloneAimSample(sample) {
  return {
    ...sample,
    ...(sample.target ? { target: cloneSpatialVector3(sample.target) } : {}),
    ...(sample.syntheticTarget ? { syntheticTarget: cloneSpatialVector3(sample.syntheticTarget) } : {}),
    forward: cloneSpatialVector3(sample.forward),
    up: cloneSpatialVector3(sample.up),
    orientation: cloneSpatialQuaternion(sample.orientation),
  };
}

export function resolveAimUp(forward, authoredUp, positionAngleDeg, warnings) {
  let up = authoredUp !== undefined
    ? normalizeDirectionOr(authoredUp, null)
    : cloneSpatialVector3(SPATIAL_LOCAL_UP);
  let usedFallback = false;
  if (up) {
    up = subtractSpatialVectors(up, scaleSpatialVector(forward, dotSpatialVectors(up, forward)));
  }
  if (!up || getSpatialVectorLength(up) <= EPSILON) {
    warnings.push(warning('degenerateAimUp', 'Aim up vector had zero length or was parallel to forward.'));
    up = perpendicularTo(forward);
    usedFallback = true;
  }
  up = normalizeDirectionOr(up, SPATIAL_LOCAL_UP);
  if (positionAngleDeg !== undefined) {
    up = applySpatialQuaternion(up, createSpatialQuaternionFromAxisAngle(forward, degreesToRadians(positionAngleDeg)));
  }
  const resolved = normalizeDirectionOr(up, SPATIAL_LOCAL_UP);
  if (usedFallback && Math.abs(dotSpatialVectors(resolved, forward)) > 1e-7) {
    return perpendicularTo(forward);
  }
  return resolved;
}
