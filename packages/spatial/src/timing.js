import {
  clamp,
  copySource,
  finiteNumber,
  nearlyEqual,
  nonNegativeFiniteNumber,
  positiveFiniteNumber,
  positiveIntegerRequired,
  positiveNumber,
  timingDistanceNearlyEqual,
  timingScalarNearlyEqual,
  timingTimeNearlyEqual,
  warning,
  withTimingDurationConstraints,
} from './numerics.js';
import {
  attachSpatialSpace,
  spatialSpaceFor,
} from './spaces.js';

export function normalizeTimingPhases(input, durationSecs) {
  if (!Array.isArray(input)) throw new TypeError('Custom timing requires phases.');
  if (input.length === 0) throw new RangeError('Custom timing requires at least one phase.');
  const phases = input.map((phase, index) => {
    if (!phase || typeof phase !== 'object') throw new TypeError('Custom timing phase must be an object.');
    const value = /** @type {Record<string, unknown>} */ (phase);
    const kind = String(value.kind ?? '');
    if (!TIMING_PHASE_KINDS.has(kind)) throw new TypeError(`Unsupported timing phase kind: ${kind}`);
    const normalized = {
      kind,
      startTimeSecs: nonNegativeFiniteNumber(value.startTimeSecs, `phases[${index}].startTimeSecs`),
      endTimeSecs: nonNegativeFiniteNumber(value.endTimeSecs, `phases[${index}].endTimeSecs`),
      startDistance: nonNegativeFiniteNumber(value.startDistance, `phases[${index}].startDistance`),
      endDistance: nonNegativeFiniteNumber(value.endDistance, `phases[${index}].endDistance`),
      startSpeedUnitsPerSec: nonNegativeFiniteNumber(value.startSpeedUnitsPerSec, `phases[${index}].startSpeedUnitsPerSec`),
      endSpeedUnitsPerSec: nonNegativeFiniteNumber(value.endSpeedUnitsPerSec, `phases[${index}].endSpeedUnitsPerSec`),
    };
    if (normalized.endTimeSecs < normalized.startTimeSecs) throw new RangeError('Custom timing phase endTimeSecs cannot be before startTimeSecs.');
    if (normalized.endDistance < normalized.startDistance) throw new RangeError('Custom timing phase endDistance cannot be before startDistance.');
    const expectedDistance = (normalized.startSpeedUnitsPerSec + normalized.endSpeedUnitsPerSec) * 0.5
      * (normalized.endTimeSecs - normalized.startTimeSecs);
    const actualDistance = normalized.endDistance - normalized.startDistance;
    const cumulativeDistanceScale = Math.max(normalized.startDistance, normalized.endDistance);
    if (!timingDistanceNearlyEqual(expectedDistance, actualDistance, cumulativeDistanceScale)) {
      throw new RangeError('Custom timing phase distance must match its speed integral.');
    }
    return normalized;
  });
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    if (index === 0) {
      if (phase.startTimeSecs !== 0 || phase.startDistance !== 0) {
        throw new RangeError('Custom timing phases must start at zero time and distance.');
      }
      continue;
    }
    const previous = phases[index - 1];
    if (!timingTimeNearlyEqual(phase.startTimeSecs, previous.endTimeSecs)) {
      throw new RangeError('Custom timing phases must have contiguous times.');
    }
    if (!timingDistanceNearlyEqual(phase.startDistance, previous.endDistance)) {
      throw new RangeError('Custom timing phases must have contiguous distances.');
    }
    if (!nearlyEqual(phase.startSpeedUnitsPerSec, previous.endSpeedUnitsPerSec, 1e-7)) {
      throw new RangeError('Custom timing phases must have contiguous speeds.');
    }
  }
  const last = phases[phases.length - 1] ?? null;
  if (last && !timingTimeNearlyEqual(last.endTimeSecs, durationSecs)) {
    throw new RangeError('Custom timing final phase must end at durationSecs.');
  }
  return phases;
}

export const TIMING_PHASE_KINDS = new Set(['accelerate', 'cruise', 'decelerate', 'blend', 'hold']);

export const TIMING_PROFILE_KINDS = new Set(['duration', 'constantSpeed', 'trapezoid', 'triangular', 'custom']);

export function normalizeSpatialTimingSpec(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialTimingSpec object.');
  }
  const value = /** @type {Record<string, unknown>} */ (input);
  if (input.kind === 'duration') {
    const output = {
      kind: 'duration',
      durationSecs: nonNegativeFiniteNumber(value.durationSecs, 'durationSecs'),
      ...copySource(input),
    };
    return attachSpatialSpace(withTimingDurationConstraints(output, value), space);
  }
  if (input.kind === 'constantSpeed') {
    return { space,
      kind: 'constantSpeed',
      speedUnitsPerSec: nonNegativeFiniteNumber(value.speedUnitsPerSec, 'speedUnitsPerSec'),
      ...(value.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(value.durationSecs, 'durationSecs') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'trapezoid') {
    const output = {
      kind: 'trapezoid',
      ...(value.departureSpeedUnitsPerSec !== undefined ? { departureSpeedUnitsPerSec: nonNegativeFiniteNumber(value.departureSpeedUnitsPerSec, 'departureSpeedUnitsPerSec') } : {}),
      ...(value.cruiseSpeedUnitsPerSec !== undefined ? { cruiseSpeedUnitsPerSec: nonNegativeFiniteNumber(value.cruiseSpeedUnitsPerSec, 'cruiseSpeedUnitsPerSec') } : {}),
      ...(value.arrivalSpeedUnitsPerSec !== undefined ? { arrivalSpeedUnitsPerSec: nonNegativeFiniteNumber(value.arrivalSpeedUnitsPerSec, 'arrivalSpeedUnitsPerSec') } : {}),
      ...(value.accelerationUnitsPerSec2 !== undefined ? { accelerationUnitsPerSec2: positiveFiniteNumber(value.accelerationUnitsPerSec2, 'accelerationUnitsPerSec2') } : {}),
      ...(value.decelerationUnitsPerSec2 !== undefined ? { decelerationUnitsPerSec2: positiveFiniteNumber(value.decelerationUnitsPerSec2, 'decelerationUnitsPerSec2') } : {}),
      ...(value.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(value.durationSecs, 'durationSecs') } : {}),
      ...copySource(input),
    };
    return attachSpatialSpace(withTimingDurationConstraints(output, value), space);
  }
  if (input.kind === 'triangular') {
    return { space,
      kind: 'triangular',
      ...(value.departureSpeedUnitsPerSec !== undefined ? { departureSpeedUnitsPerSec: nonNegativeFiniteNumber(value.departureSpeedUnitsPerSec, 'departureSpeedUnitsPerSec') } : {}),
      ...(value.peakSpeedUnitsPerSec !== undefined ? { peakSpeedUnitsPerSec: nonNegativeFiniteNumber(value.peakSpeedUnitsPerSec, 'peakSpeedUnitsPerSec') } : {}),
      ...(value.arrivalSpeedUnitsPerSec !== undefined ? { arrivalSpeedUnitsPerSec: nonNegativeFiniteNumber(value.arrivalSpeedUnitsPerSec, 'arrivalSpeedUnitsPerSec') } : {}),
      ...(value.accelerationUnitsPerSec2 !== undefined ? { accelerationUnitsPerSec2: positiveFiniteNumber(value.accelerationUnitsPerSec2, 'accelerationUnitsPerSec2') } : {}),
      ...(value.decelerationUnitsPerSec2 !== undefined ? { decelerationUnitsPerSec2: positiveFiniteNumber(value.decelerationUnitsPerSec2, 'decelerationUnitsPerSec2') } : {}),
      ...(value.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(value.durationSecs, 'durationSecs') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'custom') {
    const durationSecs = nonNegativeFiniteNumber(value.durationSecs, 'durationSecs');
    return { space,
      kind: 'custom',
      durationSecs,
      phases: normalizeTimingPhases(value.phases, durationSecs),
      ...copySource(input),
    };
  }
  throw new TypeError(`Unsupported timing kind: ${String(input.kind)}`);
}

export function deriveSpatialOrbitalInsertTiming(input) {
  const space = spatialSpaceFor(input);
  if (!input || typeof input !== 'object') {
    throw new TypeError('deriveSpatialOrbitalInsertTiming() requires an input object.');
  }
  const distance = nonNegativeFiniteNumber(input.distance, 'distance');
  const orbitalSpeedUnitsPerSec = nonNegativeFiniteNumber(input.orbitalSpeedUnitsPerSec, 'orbitalSpeedUnitsPerSec');
  const currentSpeedUnitsPerSec = input.currentSpeedUnitsPerSec !== undefined
    ? nonNegativeFiniteNumber(input.currentSpeedUnitsPerSec, 'currentSpeedUnitsPerSec')
    : undefined;
  const approachSpeedUnitsPerSec = input.approachSpeedUnitsPerSec !== undefined
    ? nonNegativeFiniteNumber(input.approachSpeedUnitsPerSec, 'approachSpeedUnitsPerSec')
    : currentSpeedUnitsPerSec ?? orbitalSpeedUnitsPerSec;
  return attachSpatialSpace(deriveTimingProfile({ space,
    kind: 'trapezoid',
    distance,
    durationSecs: input.durationSecs,
    minDurationSecs: input.minDurationSecs,
    maxDurationSecs: input.maxDurationSecs,
    departureSpeedUnitsPerSec: currentSpeedUnitsPerSec ?? approachSpeedUnitsPerSec,
    cruiseSpeedUnitsPerSec: approachSpeedUnitsPerSec,
    arrivalSpeedUnitsPerSec: orbitalSpeedUnitsPerSec,
    accelerationUnitsPerSec2: input.accelerationUnitsPerSec2,
    decelerationUnitsPerSec2: input.decelerationUnitsPerSec2,
  }), space);
}

export function normalizeSpatialTravelSpec(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialTravelSpec object.');
  }
  if (!['polyline', 'orbitTransfer', 'orbitalInsert'].includes(input.kind)) {
    throw new TypeError(`Unsupported travel kind: ${String(input.kind)}`);
  }
  return { space,
    kind: input.kind,
    ...(input.timing !== undefined ? { timing: isTimingProfile(input.timing) ? normalizeTimingProfile(input.timing, undefined, space) : normalizeSpatialTimingSpec(input.timing, space) } : {}),
    ...(input.sampleStepSecs !== undefined ? { sampleStepSecs: positiveFiniteNumber(input.sampleStepSecs, 'sampleStepSecs') } : {}),
    ...(input.maxPoints !== undefined ? { maxPoints: positiveIntegerRequired(input.maxPoints, 'maxPoints') } : {}),
    ...copySource(input),
  };
}

export function deriveSpatialRouteTiming(input) {
  const space = spatialSpaceFor(input);
  if (!input || typeof input !== 'object') {
    throw new TypeError('deriveSpatialRouteTiming() requires an input object.');
  }
  const totalLength = nonNegativeFiniteNumber(input.totalLength, 'totalLength');
  const timing = input?.travel?.timing;
  if (isTimingProfile(timing)) return attachSpatialSpace(cloneTimingProfileForDistance(timing, totalLength, space), space);
  if (timing) {
    const spec = normalizeSpatialTimingSpec(timing, space);
    return attachSpatialSpace(deriveTimingProfile({ space,
      ...spec,
      distance: totalLength,
      ...(input.departureSpeedUnitsPerSec !== undefined
        ? { departureSpeedUnitsPerSec: input.departureSpeedUnitsPerSec }
        : {}),
      ...(input.arrivalSpeedUnitsPerSec !== undefined
        ? { arrivalSpeedUnitsPerSec: input.arrivalSpeedUnitsPerSec }
        : {}),
    }), space);
  }
  return attachSpatialSpace(deriveTimingProfile({ space, kind: 'duration', durationSecs: totalLength > 0 ? totalLength : 0, distance: totalLength }), space);
}

export function deriveTimingProfile(input) {
  const space = spatialSpaceFor(input);
  const distance = nonNegativeFiniteNumber(input?.distance, 'distance');
  const spec = normalizeSpatialTimingSpec(input);
  if (spec.kind === 'custom') return deriveCustomTimingProfile(spec, distance);
  if (spec.kind === 'constantSpeed') return deriveConstantSpeedTimingProfile(spec, distance);
  if (spec.kind === 'trapezoid' || spec.kind === 'triangular') {
    return deriveKinematicTimingProfile(spec, distance);
  }
  return deriveDurationTimingProfile(spec, distance);
}

export function deriveDurationTimingProfile(spec, distance) {
  const diagnostics = createTimingDiagnostics(spec);
  const durationSecs = applyTimingDurationConstraints(spec.durationSecs, spec, diagnostics);
  if (distance > 0 && !(durationSecs > 0)) {
    throw new RangeError('Timing duration must be greater than zero for a non-zero route distance.');
  }
  const speedUnitsPerSec = durationSecs > 0 ? distance / durationSecs : 0;
  return createUniformTimingProfile('duration', distance, durationSecs, speedUnitsPerSec, diagnostics);
}

export function deriveConstantSpeedTimingProfile(spec, distance) {
  const diagnostics = createTimingDiagnostics(spec);
  const requestedSpeed = Math.max(0, finiteNumber(spec.speedUnitsPerSec, 0));
  let durationSecs = spec.durationSecs !== undefined
    ? spec.durationSecs
    : requestedSpeed > 0
      ? distance / requestedSpeed
      : 0;
  if (spec.durationSecs !== undefined) {
    diagnostics.durationConstrainedProfile = true;
  }
  if (!(requestedSpeed > 0) && distance > 0 && spec.durationSecs === undefined) {
    throw new RangeError('Constant-speed timing requires positive speed for a non-zero route distance.');
  }
  durationSecs = applyTimingDurationConstraints(durationSecs, spec, diagnostics);
  if (distance > 0 && !(durationSecs > 0)) {
    throw new RangeError('Constant-speed timing duration must be greater than zero for a non-zero route distance.');
  }
  const speedUnitsPerSec = durationSecs > 0 ? distance / durationSecs : 0;
  if (spec.durationSecs !== undefined && requestedSpeed > 0 && !nearlyEqual(speedUnitsPerSec, requestedSpeed)) {
    diagnostics.warnings.push(warning('durationOverridesConstantSpeed', 'Timing duration changed the effective constant speed.', {
      requestedSpeedUnitsPerSec: requestedSpeed,
      effectiveSpeedUnitsPerSec: speedUnitsPerSec,
    }));
  }
  return createUniformTimingProfile('constantSpeed', distance, durationSecs, speedUnitsPerSec, diagnostics);
}

export function deriveCustomTimingProfile(spec, distance) {
  const diagnostics = createTimingDiagnostics(spec);
  const phases = spec.phases.map((phase) => ({ ...phase }));
  const finalPhase = phases[phases.length - 1] ?? null;
  const finalDistance = finalPhase?.endDistance ?? 0;
  if (!timingDistanceNearlyEqual(finalDistance, distance)) {
    throw new RangeError('Custom timing phase distance must match route distance.');
  }
  return finalizeTimingProfile('custom', distance, phases, diagnostics);
}

export function deriveKinematicTimingProfile(spec, distance) {
  const diagnostics = createTimingDiagnostics(spec);
  if (distance === 0) {
    const durationSecs = applyTimingDurationConstraints(spec.durationSecs ?? 0, spec, diagnostics);
    return completeKinematicTimingProfile(spec.kind, distance, createHoldPhases(durationSecs, 0), diagnostics, spec);
  }
  if (spec.durationSecs !== undefined) {
    return deriveDurationConstrainedKinematicProfile(spec, distance, spec.durationSecs, diagnostics);
  }
  const natural = deriveNaturalKinematicPhases(spec, distance, diagnostics);
  const naturalDuration = natural.phases[natural.phases.length - 1]?.endTimeSecs ?? 0;
  const constrainedDuration = applyTimingDurationConstraints(naturalDuration, spec, diagnostics);
  if (!nearlyEqual(constrainedDuration, naturalDuration)) {
    return deriveDurationConstrainedKinematicProfile(spec, distance, constrainedDuration, diagnostics);
  }
  return completeKinematicTimingProfile(natural.kind, distance, natural.phases, diagnostics, spec);
}

export function deriveNaturalKinematicPhases(spec, distance, diagnostics) {
  const v0 = Math.max(0, finiteNumber(spec.departureSpeedUnitsPerSec, 0));
  const v1 = Math.max(0, finiteNumber(spec.arrivalSpeedUnitsPerSec, 0));
  const acceleration = positiveNumber(spec.accelerationUnitsPerSec2, 0);
  const deceleration = positiveNumber(spec.decelerationUnitsPerSec2, 0);
  if (acceleration > 0 && deceleration > 0) {
    return deriveTwoRateKinematicPhases(spec, distance, v0, v1, acceleration, deceleration, diagnostics);
  }
  if (deceleration > 0 && v0 > v1) {
    return deriveDecelerationOnlyPhases(distance, v0, v1, deceleration);
  }
  if (acceleration > 0 && v1 > v0) {
    return deriveAccelerationOnlyPhases(distance, v0, v1, acceleration);
  }
  diagnostics.warnings.push(warning('kinematicTimingMissingRate', 'Kinematic timing fell back to constant-speed timing because acceleration or deceleration was not usable.'));
  return { kind: spec.kind, phases: createEndpointBlendFallbackPhases(distance, v0, v1, spec) };
}

export function deriveTwoRateKinematicPhases(spec, distance, v0, v1, acceleration, deceleration, diagnostics) {
  const endpointTransitionDistance = v0 > v1
    ? rampDistance(v1, v0, deceleration)
    : rampDistance(v0, v1, acceleration);
  if (endpointTransitionDistance > distance && !timingDistanceNearlyEqual(endpointTransitionDistance, distance)) {
    diagnostics.warnings.push(warning(
      'endpointRateFittedToDistance',
      'Requested endpoint speed change cannot fit within the route distance, so its rate was fitted.',
      { requestedTransitionDistance: endpointTransitionDistance, availableDistance: distance },
    ));
    return {
      kind: 'triangular',
      phases: createEndpointBlendFallbackPhases(distance, v0, v1, spec),
    };
  }
  const triangularPeak = solveTriangularPeakSpeed(distance, v0, v1, acceleration, deceleration);
  if (v0 === v1 && v0 > 0 && timingScalarNearlyEqual(triangularPeak, v0)) {
    return { kind: 'trapezoid', phases: createCruisePhases(distance / v0, distance, v0) };
  }
  let peakSpeedUnitsPerSec = triangularPeak;
  let kind = 'triangular';
  if (spec.kind === 'trapezoid' && spec.cruiseSpeedUnitsPerSec !== undefined) {
    const cruiseSpeedUnitsPerSec = Math.max(spec.cruiseSpeedUnitsPerSec, v0, v1);
    const cruiseDistance = rampDistance(v0, cruiseSpeedUnitsPerSec, acceleration)
      + rampDistance(v1, cruiseSpeedUnitsPerSec, deceleration);
    if (cruiseSpeedUnitsPerSec <= 0 && distance > 0) {
      diagnostics.warnings.push(warning('trapezoidCollapsedToTriangular', 'Requested cruise speed cannot cover a non-zero distance.'));
    } else if (cruiseDistance < distance || timingDistanceNearlyEqual(cruiseDistance, distance)) {
      peakSpeedUnitsPerSec = cruiseSpeedUnitsPerSec;
      kind = 'trapezoid';
    } else {
      diagnostics.warnings.push(warning('trapezoidCollapsedToTriangular', 'Requested cruise speed cannot be reached over this distance.'));
    }
  } else if (spec.kind === 'triangular' && spec.peakSpeedUnitsPerSec !== undefined) {
    const requestedPeak = Math.max(spec.peakSpeedUnitsPerSec, v0, v1);
    const requestedPeakDistance = rampDistance(v0, requestedPeak, acceleration)
      + rampDistance(v1, requestedPeak, deceleration);
    if (requestedPeakDistance < distance && !timingDistanceNearlyEqual(requestedPeakDistance, distance)) {
      peakSpeedUnitsPerSec = requestedPeak;
      kind = 'trapezoid';
      diagnostics.warnings.push(warning('triangularPeakRequiresCruise', 'Requested triangular peak is too low, so a cruise phase was inserted.'));
    } else if (requestedPeakDistance > distance && !timingDistanceNearlyEqual(requestedPeakDistance, distance)) {
      diagnostics.warnings.push(warning('triangularPeakFittedToDistance', 'Requested triangular peak is too high for this distance.'));
    } else {
      peakSpeedUnitsPerSec = requestedPeak;
    }
  }
  return buildKinematicPhasesForPeak(distance, v0, v1, peakSpeedUnitsPerSec, acceleration, deceleration, kind);
}

export function deriveDecelerationOnlyPhases(distance, v0, v1, deceleration) {
  const decelDistance = rampDistance(v1, v0, deceleration);
  if (decelDistance < distance || timingDistanceNearlyEqual(decelDistance, distance)) {
    const phases = [];
    const cruiseDistance = timingDistanceNearlyEqual(decelDistance, distance)
      ? 0
      : Math.max(0, distance - decelDistance);
    if (cruiseDistance > 0) appendTimingPhase(phases, 'cruise', cruiseDistance / v0, v0, v0);
    appendTimingPhase(phases, 'decelerate', (v0 - v1) / deceleration, v0, v1);
    return { kind: cruiseDistance > 0 ? 'trapezoid' : 'triangular', phases };
  }
  const fittedDeceleration = (v0 * v0 - v1 * v1) / (2 * distance);
  const phases = [];
  appendTimingPhase(phases, 'decelerate', (v0 - v1) / fittedDeceleration, v0, v1);
  return { kind: 'triangular', phases };
}

export function deriveAccelerationOnlyPhases(distance, v0, v1, acceleration) {
  const accelDistance = rampDistance(v0, v1, acceleration);
  if (accelDistance < distance || timingDistanceNearlyEqual(accelDistance, distance)) {
    const phases = [];
    appendTimingPhase(phases, 'accelerate', (v1 - v0) / acceleration, v0, v1);
    const cruiseDistance = timingDistanceNearlyEqual(accelDistance, distance)
      ? 0
      : Math.max(0, distance - accelDistance);
    if (cruiseDistance > 0) appendTimingPhase(phases, 'cruise', cruiseDistance / v1, v1, v1);
    return { kind: cruiseDistance > 0 ? 'trapezoid' : 'triangular', phases };
  }
  const fittedAcceleration = (v1 * v1 - v0 * v0) / (2 * distance);
  const phases = [];
  appendTimingPhase(phases, 'accelerate', (v1 - v0) / fittedAcceleration, v0, v1);
  return { kind: 'triangular', phases };
}

export function buildKinematicPhasesForPeak(distance, v0, v1, peakSpeedUnitsPerSec, acceleration, deceleration, kind) {
  const phases = [];
  const peak = Math.max(peakSpeedUnitsPerSec, v0, v1);
  if (peak > v0) {
    appendTimingPhase(phases, 'accelerate', (peak - v0) / acceleration, v0, peak);
  }
  const accelDistance = rampDistance(v0, peak, acceleration);
  const decelDistance = rampDistance(v1, peak, deceleration);
  const rampTotalDistance = accelDistance + decelDistance;
  const cruiseDistance = timingDistanceNearlyEqual(rampTotalDistance, distance)
    ? 0
    : Math.max(0, distance - rampTotalDistance);
  if (cruiseDistance > 0) {
    appendTimingPhase(phases, 'cruise', cruiseDistance / peak, peak, peak);
    kind = 'trapezoid';
  }
  if (peak > v1) {
    appendTimingPhase(phases, 'decelerate', (peak - v1) / deceleration, peak, v1);
  }
  if (phases.length === 0) phases.push(...createCruisePhases(distance / peak, distance, peak));
  return { kind, phases };
}

export function deriveDurationConstrainedKinematicProfile(spec, distance, requestedDurationSecs, diagnostics) {
  diagnostics.durationConstrainedProfile = true;
  const durationSecs = applyTimingDurationConstraints(requestedDurationSecs, spec, diagnostics);
  if (!(durationSecs > 0)) {
    throw new RangeError('Kinematic timing duration must be greater than zero for a non-zero route distance.');
  }
  const v0 = Math.max(0, finiteNumber(spec.departureSpeedUnitsPerSec, 0));
  const v1 = Math.max(0, finiteNumber(spec.arrivalSpeedUnitsPerSec, 0));
  const requestedPeak = Math.max(
    spec.cruiseSpeedUnitsPerSec ?? 0,
    spec.peakSpeedUnitsPerSec ?? 0,
    v0,
    v1,
    distance / durationSecs,
  );
  let ta = spec.accelerationUnitsPerSec2 !== undefined && requestedPeak > v0
    ? Math.min((requestedPeak - v0) / spec.accelerationUnitsPerSec2, durationSecs * 0.4)
    : durationSecs * 0.2;
  let td = spec.decelerationUnitsPerSec2 !== undefined && requestedPeak > v1
    ? Math.min((requestedPeak - v1) / spec.decelerationUnitsPerSec2, durationSecs * 0.4)
    : durationSecs * 0.2;
  const endpointDistance = 0.5 * (v0 * ta + v1 * td);
  if (endpointDistance >= distance && endpointDistance > 0) {
    const scale = (distance * 0.5) / endpointDistance;
    ta *= scale;
    td *= scale;
  }
  const cruiseEndSecs = durationSecs - td;
  const tc = Math.max(0, cruiseEndSecs - ta);
  const materializedTd = durationSecs - (ta + tc);
  const denominator = 0.5 * ta + tc + 0.5 * materializedTd;
  const endpointContribution = 0.5 * (v0 * ta + v1 * materializedTd);
  const peakSpeedUnitsPerSec = (distance - endpointContribution) / denominator;
  if (!Number.isFinite(peakSpeedUnitsPerSec) || peakSpeedUnitsPerSec < 0) {
    throw new RangeError('Unable to derive a non-negative timing speed for the requested duration and endpoint speeds.');
  }
  const phases = [];
  appendTimingPhase(phases, timingPhaseKind(v0, peakSpeedUnitsPerSec), ta, v0, peakSpeedUnitsPerSec);
  appendTimingPhase(phases, 'cruise', tc, peakSpeedUnitsPerSec, peakSpeedUnitsPerSec);
  appendTimingPhase(phases, timingPhaseKind(peakSpeedUnitsPerSec, v1), materializedTd, peakSpeedUnitsPerSec, v1);
  const kind = phases.some((phase) => phase.kind === 'cruise') && phases.some((phase) => phase.kind !== 'cruise')
    ? 'trapezoid'
    : spec.kind;
  return completeKinematicTimingProfile(kind, distance, phases, diagnostics, spec);
}

export function createUniformTimingProfile(kind, distance, durationSecs, speedUnitsPerSec, diagnostics) {
  return finalizeTimingProfile(
    kind,
    distance,
    distance > 0 ? createCruisePhases(durationSecs, distance, speedUnitsPerSec) : createHoldPhases(durationSecs, 0),
    diagnostics,
  );
}

export function createCruisePhases(durationSecs, distance, speedUnitsPerSec) {
  return [{
    kind: distance > 0 ? 'cruise' : 'hold',
    startTimeSecs: 0,
    endTimeSecs: durationSecs,
    startDistance: 0,
    endDistance: distance,
    startSpeedUnitsPerSec: speedUnitsPerSec,
    endSpeedUnitsPerSec: speedUnitsPerSec,
  }];
}

export function createHoldPhases(durationSecs, distance) {
  return [{
    kind: 'hold',
    startTimeSecs: 0,
    endTimeSecs: durationSecs,
    startDistance: 0,
    endDistance: distance,
    startSpeedUnitsPerSec: 0,
    endSpeedUnitsPerSec: 0,
  }];
}

export function createEndpointBlendFallbackPhases(distance, departureSpeedUnitsPerSec, arrivalSpeedUnitsPerSec, spec) {
  const averageEndpointSpeed = (departureSpeedUnitsPerSec + arrivalSpeedUnitsPerSec) * 0.5;
  if (averageEndpointSpeed > 0) {
    return [{
      kind: nearlyEqual(departureSpeedUnitsPerSec, arrivalSpeedUnitsPerSec) ? 'cruise' : 'blend',
      startTimeSecs: 0,
      endTimeSecs: distance / averageEndpointSpeed,
      startDistance: 0,
      endDistance: distance,
      startSpeedUnitsPerSec: departureSpeedUnitsPerSec,
      endSpeedUnitsPerSec: arrivalSpeedUnitsPerSec,
    }];
  }
  const fallbackSpeed = Math.max(spec.cruiseSpeedUnitsPerSec ?? 0, spec.peakSpeedUnitsPerSec ?? 0, distance);
  const durationSecs = fallbackSpeed > 0 ? distance / fallbackSpeed : 0;
  return createCruisePhases(durationSecs, distance, durationSecs > 0 ? distance / durationSecs : 0);
}

export function appendTimingPhase(phases, kind, durationSecs, startSpeedUnitsPerSec, endSpeedUnitsPerSec) {
  if (!(durationSecs > 0)) return;
  const previous = phases[phases.length - 1];
  const startTimeSecs = previous?.endTimeSecs ?? 0;
  const startDistance = previous?.endDistance ?? 0;
  const endTimeSecs = startTimeSecs + durationSecs;
  const materializedDurationSecs = endTimeSecs - startTimeSecs;
  const endDistance = startDistance
    + (startSpeedUnitsPerSec + endSpeedUnitsPerSec) * 0.5 * materializedDurationSecs;
  phases.push({
    kind,
    startTimeSecs,
    endTimeSecs,
    startDistance,
    endDistance,
    startSpeedUnitsPerSec,
    endSpeedUnitsPerSec,
  });
}

export function timingPhaseKind(startSpeedUnitsPerSec, endSpeedUnitsPerSec) {
  if (endSpeedUnitsPerSec > startSpeedUnitsPerSec) return 'accelerate';
  if (endSpeedUnitsPerSec < startSpeedUnitsPerSec) return 'decelerate';
  return 'cruise';
}

export function completeKinematicTimingProfile(kind, distance, phases, diagnostics, spec) {
  const profile = finalizeTimingProfile(kind, distance, phases, diagnostics);
  markRequestedRateApplication(profile, spec, diagnostics);
  return profile;
}

export function finalizeTimingProfile(kind, distance, phases, diagnostics) {
  const normalizedPhases = phases.length > 0 ? phases : createHoldPhases(0, distance);
  const durationSecs = normalizedPhases[normalizedPhases.length - 1]?.endTimeSecs ?? 0;
  const validatedPhases = normalizeTimingPhases(normalizedPhases, durationSecs);
  const finalDistance = validatedPhases[validatedPhases.length - 1]?.endDistance ?? 0;
  if (!timingDistanceNearlyEqual(finalDistance, distance)) {
    throw new RangeError('Derived timing phase distance must match distance.');
  }
  const departureSpeedUnitsPerSec = validatedPhases[0]?.startSpeedUnitsPerSec ?? 0;
  const arrivalSpeedUnitsPerSec = validatedPhases[validatedPhases.length - 1]?.endSpeedUnitsPerSec ?? 0;
  const peakSpeedUnitsPerSec = validatedPhases.reduce((peak, phase) => Math.max(peak, phase.startSpeedUnitsPerSec, phase.endSpeedUnitsPerSec), 0);
  let accelerationUnitsPerSec2 = 0;
  let decelerationUnitsPerSec2 = 0;
  for (const phase of validatedPhases) {
    const duration = phase.endTimeSecs - phase.startTimeSecs;
    if (!(duration > 0)) continue;
    const rate = (phase.endSpeedUnitsPerSec - phase.startSpeedUnitsPerSec) / duration;
    if (rate > accelerationUnitsPerSec2) accelerationUnitsPerSec2 = rate;
    if (-rate > decelerationUnitsPerSec2) decelerationUnitsPerSec2 = -rate;
  }
  return {
    kind,
    durationSecs,
    distance,
    departureSpeedUnitsPerSec,
    cruiseSpeedUnitsPerSec: peakSpeedUnitsPerSec,
    arrivalSpeedUnitsPerSec,
    peakSpeedUnitsPerSec,
    ...(accelerationUnitsPerSec2 > 0 ? { accelerationUnitsPerSec2 } : {}),
    ...(decelerationUnitsPerSec2 > 0 ? { decelerationUnitsPerSec2 } : {}),
    phases: validatedPhases,
    diagnostics,
  };
}

export function markRequestedRateApplication(profile, spec, diagnostics) {
  if (spec.accelerationUnitsPerSec2 !== undefined) {
    const hasAccelerationPhase = profile.phases.some((phase) => phase.endSpeedUnitsPerSec > phase.startSpeedUnitsPerSec);
    const applied = hasAccelerationPhase && nearlyEqual(profile.accelerationUnitsPerSec2 ?? 0, spec.accelerationUnitsPerSec2);
    diagnostics.requestedAccelerationApplied = applied;
    if (!hasAccelerationPhase) {
      diagnostics.warnings.push(warning('requestedAccelerationIgnored', 'Requested acceleration was not used by the derived timing profile.', {
        requestedAccelerationUnitsPerSec2: spec.accelerationUnitsPerSec2,
      }));
    } else if (!applied) {
      diagnostics.warnings.push(warning('requestedAccelerationFitted', 'Requested acceleration was fitted to satisfy route duration and distance.', {
        requestedAccelerationUnitsPerSec2: spec.accelerationUnitsPerSec2,
        effectiveAccelerationUnitsPerSec2: profile.accelerationUnitsPerSec2 ?? 0,
      }));
    }
  }
  if (spec.decelerationUnitsPerSec2 !== undefined) {
    const hasDecelerationPhase = profile.phases.some((phase) => phase.endSpeedUnitsPerSec < phase.startSpeedUnitsPerSec);
    const applied = hasDecelerationPhase && nearlyEqual(profile.decelerationUnitsPerSec2 ?? 0, spec.decelerationUnitsPerSec2);
    diagnostics.requestedDecelerationApplied = applied;
    if (!hasDecelerationPhase) {
      diagnostics.warnings.push(warning('requestedDecelerationIgnored', 'Requested deceleration was not used by the derived timing profile.', {
        requestedDecelerationUnitsPerSec2: spec.decelerationUnitsPerSec2,
      }));
    } else if (!applied) {
      diagnostics.warnings.push(warning('requestedDecelerationFitted', 'Requested deceleration was fitted to satisfy route duration and distance.', {
        requestedDecelerationUnitsPerSec2: spec.decelerationUnitsPerSec2,
        effectiveDecelerationUnitsPerSec2: profile.decelerationUnitsPerSec2 ?? 0,
      }));
    }
  }
}

export function createTimingDiagnostics(spec) {
  return {
    ...(spec.durationSecs !== undefined ? { requestedDurationSecs: spec.durationSecs } : {}),
    ...(spec.accelerationUnitsPerSec2 !== undefined ? { requestedAccelerationUnitsPerSec2: spec.accelerationUnitsPerSec2 } : {}),
    ...(spec.decelerationUnitsPerSec2 !== undefined ? { requestedDecelerationUnitsPerSec2: spec.decelerationUnitsPerSec2 } : {}),
    warnings: [],
  };
}

export function applyTimingDurationConstraints(durationSecs, spec, diagnostics) {
  let next = Math.max(0, finiteNumber(durationSecs, 0));
  if (spec.minDurationSecs !== undefined && next < spec.minDurationSecs) {
    next = spec.minDurationSecs;
    diagnostics.clampedToMinDuration = true;
    diagnostics.durationConstrainedProfile = true;
    diagnostics.warnings.push(warning('timingClampedToMinDuration', 'Timing duration was clamped to minDurationSecs.'));
  }
  if (spec.maxDurationSecs !== undefined && next > spec.maxDurationSecs) {
    next = spec.maxDurationSecs;
    diagnostics.clampedToMaxDuration = true;
    diagnostics.durationConstrainedProfile = true;
    diagnostics.warnings.push(warning('timingClampedToMaxDuration', 'Timing duration was clamped to maxDurationSecs.'));
  }
  return next;
}

export function solveTriangularPeakSpeed(distance, v0, v1, acceleration, deceleration) {
  const numerator = distance + (v0 * v0) / (2 * acceleration) + (v1 * v1) / (2 * deceleration);
  const denominator = 1 / (2 * acceleration) + 1 / (2 * deceleration);
  return Math.sqrt(Math.max(v0 * v0, v1 * v1, numerator / denominator));
}

export function rampDistance(lowSpeedUnitsPerSec, highSpeedUnitsPerSec, rateUnitsPerSec2) {
  const delta = highSpeedUnitsPerSec * highSpeedUnitsPerSec - lowSpeedUnitsPerSec * lowSpeedUnitsPerSec;
  return delta > 0 && rateUnitsPerSec2 > 0 ? delta / (2 * rateUnitsPerSec2) : 0;
}

export function evaluateTimingProfileAt(profile, elapsedSecs) {
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const phases = Array.isArray(profile?.phases) ? profile.phases : [];
  if (phases.length === 0) {
    const durationSecs = Math.max(0, finiteNumber(profile?.durationSecs, 0));
    const distance = Math.max(0, finiteNumber(profile?.distance, 0));
    const t = durationSecs > 0 ? clamp(elapsed / durationSecs, 0, 1) : 1;
    const speedUnitsPerSec = durationSecs > 0 ? distance / durationSecs : 0;
    return { distance: distance * t, speedUnitsPerSec };
  }
  if (elapsed <= phases[0].startTimeSecs || timingTimeNearlyEqual(elapsed, phases[0].startTimeSecs)) {
    return { distance: phases[0].startDistance, speedUnitsPerSec: phases[0].startSpeedUnitsPerSec };
  }
  for (const phase of phases) {
    if (elapsed <= phase.endTimeSecs || timingTimeNearlyEqual(elapsed, phase.endTimeSecs)) {
      const phaseDuration = phase.endTimeSecs - phase.startTimeSecs;
      if (!(phaseDuration > 0)) {
        return { distance: phase.endDistance, speedUnitsPerSec: phase.endSpeedUnitsPerSec };
      }
      const localTime = clamp(elapsed - phase.startTimeSecs, 0, phaseDuration);
      const acceleration = (phase.endSpeedUnitsPerSec - phase.startSpeedUnitsPerSec) / phaseDuration;
      return {
        distance: phase.startDistance + phase.startSpeedUnitsPerSec * localTime + 0.5 * acceleration * localTime * localTime,
        speedUnitsPerSec: Math.max(0, phase.startSpeedUnitsPerSec + acceleration * localTime),
      };
    }
  }
  const last = phases[phases.length - 1];
  return { distance: last.endDistance, speedUnitsPerSec: last.endSpeedUnitsPerSec };
}

export function isTimingProfile(input) {
  return Boolean(
    input
    && typeof input === 'object'
    && Array.isArray(input.phases)
    && Number.isFinite(input.durationSecs)
    && input.diagnostics
    && typeof input.diagnostics === 'object',
  );
}

export function cloneTimingProfileForDistance(profile, distance, inheritedSpace) {
  return normalizeTimingProfile(profile, distance, inheritedSpace);
}

export function normalizeTimingProfile(profile, expectedDistance = undefined, inheritedSpace) {
  const space = spatialSpaceFor(profile, inheritedSpace);
  if (!profile || typeof profile !== 'object') {
    throw new TypeError('Expected a SpatialTimingProfile object.');
  }
  if (!TIMING_PROFILE_KINDS.has(profile.kind)) {
    throw new TypeError(`Unsupported timing profile kind: ${String(profile.kind)}`);
  }
  const durationSecs = nonNegativeFiniteNumber(profile.durationSecs, 'SpatialTimingProfile.durationSecs');
  const phases = normalizeTimingPhases(profile.phases, durationSecs);
  const finalDistance = phases[phases.length - 1]?.endDistance ?? 0;
  if (expectedDistance !== undefined && !timingDistanceNearlyEqual(finalDistance, expectedDistance)) {
    throw new RangeError('SpatialTimingProfile final phase distance must match route totalLength.');
  }
  if (profile.distance !== undefined) {
    const declaredDistance = nonNegativeFiniteNumber(profile.distance, 'SpatialTimingProfile.distance');
    if (!timingDistanceNearlyEqual(declaredDistance, finalDistance)) {
      throw new RangeError('SpatialTimingProfile distance must match its final phase distance.');
    }
  }
  const departureSpeedUnitsPerSec = phases[0]?.startSpeedUnitsPerSec ?? 0;
  const arrivalSpeedUnitsPerSec = phases[phases.length - 1]?.endSpeedUnitsPerSec ?? 0;
  const peakSpeedUnitsPerSec = phases.reduce(
    (peak, phase) => Math.max(peak, phase.startSpeedUnitsPerSec, phase.endSpeedUnitsPerSec),
    0,
  );
  let accelerationUnitsPerSec2 = 0;
  let decelerationUnitsPerSec2 = 0;
  for (const phase of phases) {
    const phaseDurationSecs = phase.endTimeSecs - phase.startTimeSecs;
    if (!(phaseDurationSecs > 0)) continue;
    const rateUnitsPerSec2 = (phase.endSpeedUnitsPerSec - phase.startSpeedUnitsPerSec) / phaseDurationSecs;
    accelerationUnitsPerSec2 = Math.max(accelerationUnitsPerSec2, rateUnitsPerSec2);
    decelerationUnitsPerSec2 = Math.max(decelerationUnitsPerSec2, -rateUnitsPerSec2);
  }
  const summary = {
    departureSpeedUnitsPerSec,
    cruiseSpeedUnitsPerSec: peakSpeedUnitsPerSec,
    arrivalSpeedUnitsPerSec,
    peakSpeedUnitsPerSec,
    accelerationUnitsPerSec2,
    decelerationUnitsPerSec2,
  };
  for (const [field, expected] of Object.entries(summary)) {
    if (profile[field] === undefined) continue;
    const declared = nonNegativeFiniteNumber(profile[field], `SpatialTimingProfile.${field}`);
    if (!nearlyEqual(declared, expected, 1e-9)) {
      throw new RangeError(`SpatialTimingProfile ${field} must match its phases.`);
    }
  }
  if (!profile.diagnostics || typeof profile.diagnostics !== 'object') {
    throw new TypeError('SpatialTimingProfile diagnostics must be an object.');
  }
  if (!Array.isArray(profile.diagnostics.warnings)) {
    throw new TypeError('SpatialTimingProfile diagnostics.warnings must be an array.');
  }
  return {
    space,
    kind: profile.kind,
    durationSecs,
    distance: finalDistance,
    departureSpeedUnitsPerSec,
    cruiseSpeedUnitsPerSec: peakSpeedUnitsPerSec,
    arrivalSpeedUnitsPerSec,
    peakSpeedUnitsPerSec,
    ...(accelerationUnitsPerSec2 > 0 ? { accelerationUnitsPerSec2 } : {}),
    ...(decelerationUnitsPerSec2 > 0 ? { decelerationUnitsPerSec2 } : {}),
    phases,
    diagnostics: {
      ...profile.diagnostics,
      warnings: profile.diagnostics.warnings.map((entry) => (
        entry && typeof entry === 'object' ? { ...entry } : entry
      )),
    },
  };
}
