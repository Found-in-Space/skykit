import { requiredSpatialVector3 } from './math.js';
import {
  SPATIAL_IDENTITY_QUATERNION,
  SPATIAL_ZERO_VECTOR,
  addSpatialVectors,
  cloneSpatialQuaternion,
  cloneSpatialVector3,
  combineSpatialVectors,
  getSpatialVectorLength,
  interpolateSpatialDirections,
  interpolateSpatialQuaternions,
  lerp,
  lerpVector,
  normalizeSpatialVector3,
  scaleSpatialVector,
  subtractSpatialVectors,
} from './math.js';
import {
  DEFAULT_SAMPLE_STEP_SECS,
  EPSILON,
  clamp,
  compareTime,
  copySource,
  finiteNumber,
  finiteNumberInRange,
  finiteRequiredNumber,
  finiteTime,
  nonNegativeFiniteNumber,
  positiveFiniteNumber,
  positiveNumber,
  smoothstep01,
  timingTimeNearlyEqual,
  warning,
} from './numerics.js';
import {
  cloneAimSample,
  cloneFrameState,
  cloneSpatialPose,
  evaluateSpatialAim,
  frameStateAimSpec,
  normalizeSpatialAimSpec,
  normalizeSpatialFrameState,
  normalizeSpatialPose,
} from './pose-aim.js';
import {
  assertSpatialCoordinateSpace,
  attachSpatialSpace,
  normalizeSpatialCoordinateSpace,
  spatialSpaceFor,
} from './spaces.js';

export const POSE_TRANSITION_VIEW_PATHS = new WeakMap();

export const TRANSITION_LANE_INTERPOLATIONS = new Set([
  'hold',
  'linear',
  'smoothstep',
  'easeIn',
  'easeOut',
  'easeInOut',
  'slerp',
]);

export function buildSpatialAimTrack(keys = [], options = {}) {
  const space = spatialSpaceFor(options);
  const duplicateTimePolicy = normalizeDuplicateTimePolicy(options.duplicateTimePolicy);
  const normalizedKeys = normalizeAimKeys(keys, duplicateTimePolicy, space);
  const durationSecs = options.durationSecs !== undefined
    ? nonNegativeFiniteNumber(options.durationSecs, 'durationSecs')
    : normalizedKeys.length > 0
      ? normalizedKeys[normalizedKeys.length - 1].timeSecs
      : 0;
  assertKeysWithinDuration(normalizedKeys, durationSecs);
  const defaultInterpolation = options.defaultInterpolation === undefined
    ? undefined
    : normalizeSpatialAimInterpolationSpec(options.defaultInterpolation);
  return { space,
    keys: normalizedKeys,
    durationSecs,
    ...(defaultInterpolation !== undefined ? { defaultInterpolation } : {}),
    duplicateTimePolicy,
    diagnostics: { durationSecs, duplicateTimePolicy, warnings: [] },
  };
}

export function evaluateSpatialAimTrack(track, timeSecs, context = {}) {
  const space = spatialSpaceFor(track, context.space);
  if (context.positionSample) assertSpatialCoordinateSpace(context.positionSample.pose.space, space);
  const keys = Array.isArray(track?.keys) ? track.keys : [];
  if (keys.length === 0) throw new TypeError('Aim tracks require at least one key.');
  const clampedTime = clamp(finiteNumber(timeSecs, 0), 0, Math.max(0, finiteNumber(track.durationSecs, 0)));
  const bracket = findTimedBracket(keys, clampedTime);
  const position = context.position ?? context.positionSample?.pose?.position;
  const choice = selectAimInterpolation(bracket, track.defaultInterpolation);
  if (!position && aimInterpolationRequiresObserver(bracket, choice.spec)) {
    throw new TypeError('Target aim track evaluation requires position or positionSample.pose.position.');
  }
  const interpolated = interpolateAim(bracket, choice, { space,
    position: position ?? SPATIAL_ZERO_VECTOR,
    fallbackUp: context.fallbackUp,
    syntheticTargetDistance: context.syntheticTargetDistance,
  });
  const sample = evaluateSpatialAim({ space,
    position: position ?? SPATIAL_ZERO_VECTOR,
    aim: interpolated.aim,
    syntheticTargetDistance: context.syntheticTargetDistance,
  });
  const warnings = [
    ...interpolated.warnings,
    ...(sample.diagnostics?.warnings ?? []),
  ];
  const aimSample = {
    ...sample,
    diagnostics: { warnings },
  };
  return { space,
    timeSecs: clampedTime,
    aim: aimSample,
    segmentIndex: bracket.segmentIndex,
    ...(interpolated.sourceKey ? copySource(interpolated.sourceKey) : {}),
    diagnostics: { warnings },
  };
}

export function normalizeSpatialPathSpec(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialPathSpec object.');
  const duplicateTimePolicy = normalizeDuplicateTimePolicy(input.duplicateTimePolicy);
  const positionKeys = normalizePositionKeys(input.positionKeys, duplicateTimePolicy, space);
  if (positionKeys.length === 0) throw new TypeError('SpatialPathSpec.positionKeys must contain at least one key.');
  const aimKeys = input.aimKeys === undefined ? [] : normalizeAimKeys(input.aimKeys, duplicateTimePolicy, space);
  const durationSecs = input.durationSecs !== undefined
    ? nonNegativeFiniteNumber(input.durationSecs, 'durationSecs')
    : Math.max(positionKeys[positionKeys.length - 1].timeSecs, aimKeys[aimKeys.length - 1]?.timeSecs ?? 0);
  assertKeysWithinDuration(positionKeys, durationSecs);
  assertKeysWithinDuration(aimKeys, durationSecs);
  return { space,
    durationSecs,
    positionKeys,
    ...(aimKeys.length > 0 ? { aimKeys } : {}),
    ...(input.timeRemap !== undefined ? { timeRemap: input.timeRemap == null ? null : normalizeSpatialTimeRemap(input.timeRemap, durationSecs) } : {}),
    duplicateTimePolicy,
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function evaluateSpatialPath(path, timeSecs, options = {}) {
  const space = spatialSpaceFor(path);
  const normalized = normalizeSpatialPathSpec(path, space);
  const clampedTime = clamp(finiteNumber(timeSecs, 0), 0, normalized.durationSecs);
  const positionSample = evaluatePositionKeys(normalized.positionKeys, clampedTime);
  let aim = null;
  let orientation = cloneSpatialQuaternion(SPATIAL_IDENTITY_QUATERNION);
  if (normalized.aimKeys?.length > 0) {
    const track = buildSpatialAimTrack(normalized.aimKeys, { space,
      durationSecs: normalized.durationSecs,
      duplicateTimePolicy: normalized.duplicateTimePolicy,
    });
    const aimSample = evaluateSpatialAimTrack(track, clampedTime, {
      positionSample,
      syntheticTargetDistance: options.syntheticTargetDistance,
    });
    aim = aimSample.aim;
    orientation = cloneSpatialQuaternion(aim.orientation);
  }
  return { space,
    timeSecs: clampedTime,
    ...(options.frameIndex !== undefined ? { frameIndex: options.frameIndex } : {}),
    pose: { space,
      position: positionSample.pose.position,
      orientation,
    },
    aim,
    velocityUnitsPerSec: positionSample.velocityUnitsPerSec,
    speedUnitsPerSec: positionSample.speedUnitsPerSec,
    accelerationUnitsPerSec2: positionSample.accelerationUnitsPerSec2,
    accelerationMagnitudeUnitsPerSec2: positionSample.accelerationMagnitudeUnitsPerSec2,
    segmentIndex: positionSample.segmentIndex,
    segmentId: positionSample.segmentId,
    diagnostics: { warnings: [] },
  };
}

export function evaluateSpatialPathPlayback(path, elapsedSecs, options = {}) {
  const space = spatialSpaceFor(path);
  const normalized = normalizeSpatialPathSpec(path, space);
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const timeSecs = remapPathTime(normalized, elapsed);
  const sample = evaluateSpatialPath(normalized, timeSecs, options);
  return { ...sample, playbackElapsedSecs: elapsed };
}

export function sampleSpatialPath(path, options = {}) {
  const space = spatialSpaceFor(path);
  const normalized = normalizeSpatialPathSpec(path, space);
  const sampling = normalizeSpatialSamplingOptions(options);
  const duration = normalized.timeRemap?.playbackDurationSecs ?? normalized.durationSecs;
  const timeline = createSpatialSamplingTimeline(duration, sampling);
  const samples = timeline.times.map((elapsedSecs, frameIndex) => (
    normalized.timeRemap
      ? evaluateSpatialPathPlayback(normalized, elapsedSecs, { ...options, frameIndex })
      : evaluateSpatialPath(normalized, elapsedSecs, { ...options, frameIndex })
  ));
  if (timeline.truncated) {
    addSamplingWarning(
      samples,
      warning('maxSamplesTruncatesPath', 'maxSamples truncates path sampling before the end time.', {
        maxSamples: sampling.maxSamples,
        durationSecs: duration,
      }),
    );
  }
  return samples;
}

export function sampleSpatialPathDiagnostics(path, options = {}) {
  const space = spatialSpaceFor(path);
  const normalized = normalizeSpatialPathSpec(path, space);
  const warnings = [];
  const sampling = normalizeSpatialSamplingOptions(options);
  const duration = normalized.timeRemap?.playbackDurationSecs ?? normalized.durationSecs;
  if (spatialSamplingWouldTruncate(duration, sampling)) {
    warnings.push(warning('maxSamplesTruncatesPath', 'maxSamples truncates path sampling before the end time.', {
      maxSamples: sampling.maxSamples,
      durationSecs: duration,
    }));
  }
  return {
    durationSecs: normalized.durationSecs,
    ...(normalized.timeRemap?.playbackDurationSecs !== undefined ? { playbackDurationSecs: normalized.timeRemap.playbackDurationSecs } : {}),
    duplicateTimePolicy: normalized.duplicateTimePolicy,
    timeRemap: normalized.timeRemap ?? null,
    warnings,
  };
}

export function normalizeSpatialViewTransitionSpec(input) {
  const space = spatialSpaceFor(input, input?.from?.pose?.space);
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialViewTransitionSpec object.');
  return { space,
    from: normalizeSpatialFrameState(input.from, space),
    to: normalizeSpatialFrameState(input.to, space),
    ...(input.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(input.durationSecs, 'durationSecs') } : {}),
    ...(input.position !== undefined ? { position: normalizeTransitionLane(input.position) } : {}),
    ...(input.aim !== undefined ? { aim: normalizeTransitionLane(input.aim) } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function buildSpatialViewTransitionPath(spec, options = {}) {
  const space = spatialSpaceFor(spec, spec?.from?.pose?.space);
  const normalized = normalizeSpatialViewTransitionSpec(spec);
  const warnings = [];
  const timing = resolveTransitionLaneTimings(normalized);
  const durationSecs = timing.durationSecs;
  const path = normalizeSpatialPathSpec({ space,
    durationSecs,
    positionKeys: materializeTransitionPositionKeys({
      from: normalized.from.pose.position,
      to: normalized.to.pose.position,
      lane: normalized.position,
      timing: timing.position,
      durationSecs,
      warnings,
    }),
    aimKeys: materializeTransitionAimKeys({
      from: frameStateAimSpec(normalized.from),
      to: frameStateAimSpec(normalized.to),
      lane: normalized.aim,
      timing: timing.aim,
      durationSecs,
    }),
    ...copySource(normalized),
    ...(normalized.metadata ? { metadata: { ...normalized.metadata } } : {}),
  }, space);
  const diagnostics = {
    durationSecs,
    positionDurationSecs: timing.position.durationSecs,
    aimDurationSecs: timing.aim.durationSecs,
    positionDelaySecs: timing.position.delaySecs,
    aimDelaySecs: timing.aim.delaySecs,
    pathDiagnostics: sampleSpatialPathDiagnostics(path, options),
    warnings,
  };
  return { space,
    kind: 'viewTransitionPath',
    durationSecs,
    path,
    from: normalized.from,
    to: normalized.to,
    diagnostics,
  };
}

export function evaluateSpatialViewTransition(transition, elapsedSecs) {
  const space = spatialSpaceFor(transition);
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const sample = evaluateSpatialPathPlayback(transition.path, elapsed);
  const positionEndSecs = transition.diagnostics.positionDelaySecs + transition.diagnostics.positionDurationSecs;
  const aimEndSecs = transition.diagnostics.aimDelaySecs + transition.diagnostics.aimDurationSecs;
  const complete = (elapsed >= transition.durationSecs || timingTimeNearlyEqual(elapsed, transition.durationSecs));
  const frameState = transitionFrameState(transition, sample, complete);
  return { space,
    elapsedSecs: elapsed,
    complete,
    positionComplete: (elapsed >= positionEndSecs || timingTimeNearlyEqual(elapsed, positionEndSecs)),
    aimComplete: (elapsed >= aimEndSecs || timingTimeNearlyEqual(elapsed, aimEndSecs)),
    frameState,
    pose: cloneSpatialPose(sample.pose),
    diagnostics: { warnings: [] },
  };
}

export function normalizeSpatialPoseTransitionSpec(input) {
  const space = spatialSpaceFor(input, input?.from?.space);
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialPoseTransitionSpec object.');
  return { space,
    from: normalizeSpatialPose(input.from, space),
    to: normalizeSpatialPose(input.to, space),
    ...(input.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(input.durationSecs, 'durationSecs') } : {}),
    ...(input.movement !== undefined ? { movement: normalizeTransitionLane(input.movement) } : {}),
    ...(input.orientation !== undefined ? { orientation: normalizeTransitionLane(input.orientation) } : {}),
  };
}

export function createSpatialPoseTransition(input) {
  const space = spatialSpaceFor(input, input?.from?.space);
  const normalized = normalizeSpatialPoseTransitionSpec(input);
  const viewTransition = buildPoseTransitionViewPath(normalized);
  const transition = {
    durationSecs: viewTransition.durationSecs,
    from: normalized.from,
    to: normalized.to,
    movement: publicTransitionLane(normalized.movement, {
      durationSecs: viewTransition.diagnostics.positionDurationSecs,
      delaySecs: viewTransition.diagnostics.positionDelaySecs,
    }),
    orientation: publicTransitionLane(normalized.orientation, {
      durationSecs: viewTransition.diagnostics.aimDurationSecs,
      delaySecs: viewTransition.diagnostics.aimDelaySecs,
    }),
  };
  POSE_TRANSITION_VIEW_PATHS.set(transition, viewTransition);
  return attachSpatialSpace(transition, space);
}

export function evaluateSpatialPoseTransition(transition, elapsedSecs) {
  const space = spatialSpaceFor(transition, transition?.from?.space);
  const viewTransition = transition && typeof transition === 'object'
    ? POSE_TRANSITION_VIEW_PATHS.get(transition) ?? buildPoseTransitionViewPath(transition)
    : buildPoseTransitionViewPath(transition);
  const sample = evaluateSpatialViewTransition(viewTransition, elapsedSecs);
  return { space,
    elapsedSecs: sample.elapsedSecs,
    complete: sample.complete,
    movementComplete: sample.positionComplete,
    orientationComplete: sample.aimComplete,
    pose: cloneSpatialPose(sample.pose),
    diagnostics: sample.diagnostics,
  };
}

export function materializeSpatialPreloadHints(input, options = {}) {
  const space = Array.isArray(input) ? normalizeSpatialCoordinateSpace(input[0]?.pose?.space ?? options.space) : spatialSpaceFor(input);
  const samples = Array.isArray(input) ? input : sampleSpatialPath(input, options);
  for (const sample of samples) assertSpatialCoordinateSpace(sample.pose.space, space);
  const hints = [];
  const pathRadius = options.pathRadius !== undefined ? nonNegativeFiniteNumber(options.pathRadius, 'pathRadius') : 0;
  const sphereRadius = options.sphereRadius !== undefined ? nonNegativeFiniteNumber(options.sphereRadius, 'sphereRadius') : 0;
  const lookaheadSecs = options.lookaheadSecs !== undefined ? nonNegativeFiniteNumber(options.lookaheadSecs, 'lookaheadSecs') : 0;
  const priority = finiteNumber(options.priority, 0);
  if (pathRadius > 0 && samples.length > 1) {
    hints.push({ space,
      kind: 'pathVolume',
      points: samples.map((sample) => cloneSpatialVector3(sample.pose.position)),
      radius: pathRadius,
      timeRangeSecs: [samples[0].timeSecs, samples[samples.length - 1].timeSecs],
      priority,
    });
  }
  if (sphereRadius > 0) {
    for (const sample of samples) {
      hints.push({ space,
        kind: 'sphereVolume',
        center: cloneSpatialVector3(sample.pose.position),
        radius: sphereRadius,
        timeRangeSecs: [sample.timeSecs, sample.timeSecs],
        priority,
      });
    }
  }
  if (lookaheadSecs > 0) {
    for (const sample of samples) {
      if (!(sample.speedUnitsPerSec > 0)) continue;
      hints.push({
        space,
        kind: 'viewLookahead',
        pose: cloneSpatialPose(sample.pose),
        velocityUnitsPerSec: cloneSpatialVector3(sample.velocityUnitsPerSec),
        lookaheadSecs,
        timeRangeSecs: [sample.timeSecs, sample.timeSecs + lookaheadSecs],
        priority,
      });
    }
  }
  return hints;
}

export function normalizeSpatialTimeRemap(input, pathDurationSecs) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialTimeRemapSpec object.');
  if (input.kind !== 'linear' && input.kind !== 'eased') {
    throw new TypeError('Path timeRemap supports only linear and eased.');
  }
  return {
    kind: input.kind,
    ...(input.playbackDurationSecs !== undefined
      ? { playbackDurationSecs: nonNegativeFiniteNumber(input.playbackDurationSecs, 'playbackDurationSecs') }
      : { playbackDurationSecs: pathDurationSecs }),
    ...(input.easing !== undefined ? { easing: normalizeEasing(input.easing) } : {}),
  };
}

export function normalizeSpatialSamplingOptions(input = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Spatial sampling options must be an object.');
  }
  if ('stepSecs' in input) throw new TypeError('Use sampleStepSecs instead of stepSecs.');
  const frameRateStep = input.frameRate !== undefined
    ? 1 / positiveFiniteNumber(input.frameRate, 'frameRate')
    : null;
  const sampleStepSecs = input.sampleStepSecs !== undefined
    ? positiveFiniteNumber(input.sampleStepSecs, 'sampleStepSecs')
    : frameRateStep ?? DEFAULT_SAMPLE_STEP_SECS;
  if (frameRateStep != null && !timingTimeNearlyEqual(frameRateStep, sampleStepSecs)) {
    throw new RangeError('sampleStepSecs and frameRate imply different sampling intervals.');
  }
  let maxSamples = Number.POSITIVE_INFINITY;
  if (input.maxSamples !== undefined) {
    maxSamples = finiteRequiredNumber(input.maxSamples, 'maxSamples');
    if (!Number.isInteger(maxSamples) || maxSamples <= 0) {
      throw new RangeError('maxSamples must be a positive integer.');
    }
  }
  return {
    sampleStepSecs,
    maxSamples,
  };
}

export function createSpatialSamplingTimeline(durationSecs, sampling) {
  const duration = nonNegativeFiniteNumber(durationSecs, 'sampling durationSecs');
  const plan = createSpatialSamplingPlan(duration, sampling.sampleStepSecs);
  const times = [];
  const sampleCount = Math.min(plan.requiredSamples, sampling.maxSamples);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    times.push(sampleIndex === plan.endpointSampleIndex
      ? duration
      : sampleIndex * sampling.sampleStepSecs);
  }
  return {
    times,
    truncated: sampleCount < plan.requiredSamples,
  };
}

export function spatialSamplingWouldTruncate(durationSecs, sampling) {
  const duration = nonNegativeFiniteNumber(durationSecs, 'sampling durationSecs');
  return createSpatialSamplingPlan(duration, sampling.sampleStepSecs).requiredSamples > sampling.maxSamples;
}

export function createSpatialSamplingPlan(durationSecs, sampleStepSecs) {
  if (durationSecs === 0) {
    return { endpointSampleIndex: 0, requiredSamples: 1 };
  }
  const quotient = durationSecs / sampleStepSecs;
  const gridIndex = Math.floor(quotient);
  const gridTimeSecs = gridIndex * sampleStepSecs;
  const endpointOnGrid = gridIndex > 0
    && Number.isFinite(gridTimeSecs)
    && timingTimeNearlyEqual(gridTimeSecs, durationSecs);
  const endpointSampleIndex = endpointOnGrid ? gridIndex : gridIndex + 1;
  return {
    endpointSampleIndex,
    requiredSamples: endpointSampleIndex + 1,
  };
}

export function addSamplingWarning(samples, diagnosticWarning) {
  if (samples.length === 0) return;
  const index = samples.length - 1;
  const sample = samples[index];
  samples[index] = {
    ...sample,
    diagnostics: {
      ...(sample.diagnostics ?? {}),
      warnings: [...(sample.diagnostics?.warnings ?? []), diagnosticWarning],
    },
  };
}

export function normalizePositionKeys(keys, duplicateTimePolicy, inheritedSpace) {
  const space = normalizeSpatialCoordinateSpace(inheritedSpace);
  const normalized = Array.from(keys ?? []).map((key, index) => ({
    space: spatialSpaceFor(key, space),
    id: String(key?.id ?? `position-${index}`),
    timeSecs: finiteTime(key?.timeSecs),
    position: requiredSpatialVector3(key?.position, 'Position key position'),
    interpolation: normalizeSpatialPositionInterpolation(key?.interpolation ?? { kind: 'linear' }),
    ...copySource(key ?? {}),
    ...(key?.metadata && typeof key.metadata === 'object' ? { metadata: { ...key.metadata } } : {}),
  })).sort(compareTime);
  return applyDuplicateTimePolicy(normalized, duplicateTimePolicy);
}

export function normalizeAimKeys(keys, duplicateTimePolicy, inheritedSpace) {
  const space = normalizeSpatialCoordinateSpace(inheritedSpace);
  const normalized = Array.from(keys ?? []).map((key, index) => ({
    space: spatialSpaceFor(key, space),
    id: String(key?.id ?? `aim-${index}`),
    timeSecs: finiteTime(key?.timeSecs),
    aim: normalizeSpatialAimSpec(key?.aim, space),
    ...(key?.interpolation !== undefined ? { interpolation: normalizeSpatialAimInterpolationSpec(key.interpolation) } : {}),
    ...copySource(key ?? {}),
    ...(key?.metadata && typeof key.metadata === 'object' ? { metadata: { ...key.metadata } } : {}),
  })).sort(compareTime);
  return applyDuplicateTimePolicy(normalized, duplicateTimePolicy);
}

export function applyDuplicateTimePolicy(keys, policy) {
  const normalizedPolicy = normalizeDuplicateTimePolicy(policy);
  if (keys.length < 2) return keys;
  if (normalizedPolicy === 'error') {
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index].timeSecs === keys[index - 1].timeSecs) {
        throw new RangeError('Duplicate time keys require an explicit non-error duplicateTimePolicy.');
      }
    }
    return keys;
  }
  if (normalizedPolicy === 'coalesceFirst') {
    return keys.filter((key, index) => index === 0 || key.timeSecs !== keys[index - 1].timeSecs);
  }
  if (normalizedPolicy === 'coalesceLast') {
    return keys.filter((key, index) => index === keys.length - 1 || key.timeSecs !== keys[index + 1].timeSecs);
  }
  return keys;
}

export function normalizeDuplicateTimePolicy(policy) {
  const normalized = policy ?? 'error';
  if (['error', 'coalesceFirst', 'coalesceLast', 'hold', 'cut', 'preserve'].includes(normalized)) {
    return normalized;
  }
  throw new TypeError(`Unsupported duplicateTimePolicy: ${String(policy)}`);
}

export function assertKeysWithinDuration(keys, durationSecs) {
  for (const key of keys) {
    if (key.timeSecs > durationSecs && !timingTimeNearlyEqual(key.timeSecs, durationSecs)) {
      throw new RangeError('Path key timeSecs cannot exceed durationSecs.');
    }
  }
}

export function normalizeSpatialPositionInterpolation(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected SpatialPositionInterpolation object.');
  }
  if (input.kind === 'hold') {
    return { kind: 'hold' };
  }
  if (input.kind === 'linear') {
    return {
      kind: 'linear',
      ...(input.easing !== undefined ? { easing: normalizeEasing(input.easing) } : {}),
    };
  }
  if (input.kind === 'catmullRom') {
    if (input.centripetal !== undefined && typeof input.centripetal !== 'boolean') {
      throw new TypeError('catmullRom centripetal must be a boolean.');
    }
    return {
      kind: 'catmullRom',
      ...(input.tension !== undefined ? { tension: finiteNumberInRange(input.tension, 0, 1, 'catmullRom tension') } : {}),
      ...(input.centripetal !== undefined ? { centripetal: input.centripetal } : {}),
    };
  }
  if (input.kind === 'cubicBezier') {
    return {
      kind: 'cubicBezier',
      ...(input.inTangent !== undefined ? { inTangent: normalizeSpatialVector3(input.inTangent) } : {}),
      ...(input.outTangent !== undefined ? { outTangent: normalizeSpatialVector3(input.outTangent) } : {}),
    };
  }
  if (input.kind === 'hermite') {
    return {
      kind: 'hermite',
      ...(input.inVelocityUnitsPerSec !== undefined ? { inVelocityUnitsPerSec: normalizeSpatialVector3(input.inVelocityUnitsPerSec) } : {}),
      ...(input.outVelocityUnitsPerSec !== undefined ? { outVelocityUnitsPerSec: normalizeSpatialVector3(input.outVelocityUnitsPerSec) } : {}),
    };
  }
  throw new TypeError(`Unsupported position interpolation kind: ${String(input.kind)}`);
}

export function normalizeSpatialAimInterpolationSpec(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected SpatialAimInterpolationSpec object.');
  }
  if (input.kind === 'hold') return { kind: 'hold' };
  if (['slerp', 'targetLinear', 'targetBezier', 'directionSlerp'].includes(input.kind)) {
    return {
      kind: input.kind,
      ...(input.easing !== undefined ? { easing: normalizeEasing(input.easing) } : {}),
    };
  }
  throw new TypeError(`Unsupported aim interpolation kind: ${String(input.kind)}`);
}

export function evaluatePositionInterpolation(keys, segmentIndex, t, durationSecs) {
  const left = keys[segmentIndex];
  const right = keys[segmentIndex + 1];
  const interpolation = left.interpolation ?? { kind: 'linear' };
  if (interpolation.kind === 'hold') {
    const position = t >= 1 ? right.position : left.position;
    return {
      position: cloneSpatialVector3(position),
      velocityUnitsPerSec: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
      accelerationUnitsPerSec2: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
    };
  }
  if (interpolation.kind === 'cubicBezier') {
    return evaluateCubicBezierPosition(left, right, t, durationSecs);
  }
  if (interpolation.kind === 'hermite') {
    return evaluateHermitePosition(left, right, t, durationSecs);
  }
  if (interpolation.kind === 'catmullRom') {
    return evaluateCatmullRomPosition(keys, segmentIndex, t, durationSecs, interpolation);
  }
  return evaluateLinearPosition(left, right, t, durationSecs);
}

export function evaluateLinearPosition(left, right, t, durationSecs) {
  if (left.interpolation?.kind === 'linear' && left.interpolation.easing) {
    const pointAt = (u) => lerpVector(
      left.position,
      right.position,
      applyEasing(left.interpolation.easing, u),
    );
    const derivative = finiteDifferenceVector(pointAt, t);
    return {
      position: pointAt(t),
      velocityUnitsPerSec: scaleSpatialVector(derivative.first, 1 / durationSecs),
      accelerationUnitsPerSec2: scaleSpatialVector(derivative.second, 1 / (durationSecs * durationSecs)),
    };
  }
  const velocityUnitsPerSec = scaleSpatialVector(subtractSpatialVectors(right.position, left.position), 1 / durationSecs);
  return {
    position: lerpVector(left.position, right.position, t),
    velocityUnitsPerSec,
    accelerationUnitsPerSec2: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
  };
}

export function evaluateCubicBezierPosition(left, right, t, durationSecs) {
  const p0 = left.position;
  const p3 = right.position;
  const delta = subtractSpatialVectors(p3, p0);
  const p1 = addSpatialVectors(
    p0,
    left.interpolation?.kind === 'cubicBezier' && left.interpolation.outTangent
      ? left.interpolation.outTangent
      : scaleSpatialVector(delta, 1 / 3),
  );
  const p2 = addSpatialVectors(
    p3,
    right.interpolation?.kind === 'cubicBezier' && right.interpolation.inTangent
      ? right.interpolation.inTangent
      : scaleSpatialVector(delta, -1 / 3),
  );
  const u = clamp(t, 0, 1);
  const oneMinus = 1 - u;
  const position = addSpatialVectors(
    addSpatialVectors(
      scaleSpatialVector(p0, oneMinus ** 3),
      scaleSpatialVector(p1, 3 * oneMinus * oneMinus * u),
    ),
    addSpatialVectors(
      scaleSpatialVector(p2, 3 * oneMinus * u * u),
      scaleSpatialVector(p3, u ** 3),
    ),
  );
  const derivative = addSpatialVectors(
    addSpatialVectors(
      scaleSpatialVector(subtractSpatialVectors(p1, p0), 3 * oneMinus * oneMinus),
      scaleSpatialVector(subtractSpatialVectors(p2, p1), 6 * oneMinus * u),
    ),
    scaleSpatialVector(subtractSpatialVectors(p3, p2), 3 * u * u),
  );
  const secondDerivative = addSpatialVectors(
    scaleSpatialVector(addSpatialVectors(subtractSpatialVectors(p2, scaleSpatialVector(p1, 2)), p0), 6 * oneMinus),
    scaleSpatialVector(addSpatialVectors(subtractSpatialVectors(p3, scaleSpatialVector(p2, 2)), p1), 6 * u),
  );
  return {
    position,
    velocityUnitsPerSec: scaleSpatialVector(derivative, 1 / durationSecs),
    accelerationUnitsPerSec2: scaleSpatialVector(secondDerivative, 1 / (durationSecs * durationSecs)),
  };
}

export function evaluateHermitePosition(left, right, t, durationSecs) {
  const p0 = left.position;
  const p1 = right.position;
  const defaultVelocity = scaleSpatialVector(subtractSpatialVectors(p1, p0), 1 / durationSecs);
  const v0 = left.interpolation?.kind === 'hermite' && left.interpolation.outVelocityUnitsPerSec
    ? left.interpolation.outVelocityUnitsPerSec
    : defaultVelocity;
  const v1 = right.interpolation?.kind === 'hermite' && right.interpolation.inVelocityUnitsPerSec
    ? right.interpolation.inVelocityUnitsPerSec
    : defaultVelocity;
  const m0 = scaleSpatialVector(v0, durationSecs);
  const m1 = scaleSpatialVector(v1, durationSecs);
  const u = clamp(t, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const position = combineSpatialVectors([
    [p0, 2 * u3 - 3 * u2 + 1],
    [m0, u3 - 2 * u2 + u],
    [p1, -2 * u3 + 3 * u2],
    [m1, u3 - u2],
  ]);
  const derivative = combineSpatialVectors([
    [p0, 6 * u2 - 6 * u],
    [m0, 3 * u2 - 4 * u + 1],
    [p1, -6 * u2 + 6 * u],
    [m1, 3 * u2 - 2 * u],
  ]);
  const secondDerivative = combineSpatialVectors([
    [p0, 12 * u - 6],
    [m0, 6 * u - 4],
    [p1, -12 * u + 6],
    [m1, 6 * u - 2],
  ]);
  return {
    position,
    velocityUnitsPerSec: scaleSpatialVector(derivative, 1 / durationSecs),
    accelerationUnitsPerSec2: scaleSpatialVector(secondDerivative, 1 / (durationSecs * durationSecs)),
  };
}

export function evaluateCatmullRomPosition(keys, segmentIndex, t, durationSecs, interpolation) {
  const tension = interpolation.tension ?? 0;
  const centripetal = interpolation.centripetal !== false;
  const pointAt = (u) => {
    const catmull = centripetal
      ? centripetalCatmullRomPosition(keys, segmentIndex, u)
      : uniformCatmullRomPosition(keys, segmentIndex, u);
    if (tension <= EPSILON) return catmull;
    const linear = lerpVector(keys[segmentIndex].position, keys[segmentIndex + 1].position, clamp(u, 0, 1));
    return lerpVector(catmull, linear, tension);
  };
  const derivative = finiteDifferenceVector(pointAt, t);
  return {
    position: pointAt(t),
    velocityUnitsPerSec: scaleSpatialVector(derivative.first, 1 / durationSecs),
    accelerationUnitsPerSec2: scaleSpatialVector(derivative.second, 1 / (durationSecs * durationSecs)),
  };
}

export function catmullRomControlPoints(keys, segmentIndex) {
  const p1 = keys[segmentIndex].position;
  const p2 = keys[segmentIndex + 1].position;
  const p0 = keys[segmentIndex - 1]?.position ?? subtractSpatialVectors(scaleSpatialVector(p1, 2), p2);
  const p3 = keys[segmentIndex + 2]?.position ?? subtractSpatialVectors(scaleSpatialVector(p2, 2), p1);
  return { p0, p1, p2, p3 };
}

export function uniformCatmullRomPosition(keys, segmentIndex, t) {
  const { p0, p1, p2, p3 } = catmullRomControlPoints(keys, segmentIndex);
  const u = clamp(t, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  return scaleSpatialVector(combineSpatialVectors([
    [p0, -u3 + 2 * u2 - u],
    [p1, 3 * u3 - 5 * u2 + 2],
    [p2, -3 * u3 + 4 * u2 + u],
    [p3, u3 - u2],
  ]), 0.5);
}

export function centripetalCatmullRomPosition(keys, segmentIndex, t) {
  const { p0, p1, p2, p3 } = catmullRomControlPoints(keys, segmentIndex);
  const t0 = 0;
  const t1 = catmullRomKnot(t0, p0, p1);
  const t2 = catmullRomKnot(t1, p1, p2);
  const t3 = catmullRomKnot(t2, p2, p3);
  const u = lerp(t1, t2, clamp(t, 0, 1));
  const a1 = interpolateCentripetalVector(p0, p1, t0, t1, u);
  const a2 = interpolateCentripetalVector(p1, p2, t1, t2, u);
  const a3 = interpolateCentripetalVector(p2, p3, t2, t3, u);
  const b1 = interpolateCentripetalVector(a1, a2, t0, t2, u);
  const b2 = interpolateCentripetalVector(a2, a3, t1, t3, u);
  return interpolateCentripetalVector(b1, b2, t1, t2, u);
}

export function catmullRomKnot(previousKnot, a, b) {
  return previousKnot + Math.sqrt(getSpatialVectorLength(subtractSpatialVectors(a, b)));
}

export function interpolateCentripetalVector(a, b, ta, tb, t) {
  if (tb === ta) return cloneSpatialVector3(b);
  return addSpatialVectors(
    scaleSpatialVector(a, (tb - t) / (tb - ta)),
    scaleSpatialVector(b, (t - ta) / (tb - ta)),
  );
}

export function finiteDifferenceVector(pointAt, t) {
  const u = clamp(t, 0, 1);
  const h = 1e-3;
  const center = pointAt(u);
  if (u - h >= 0 && u + h <= 1) {
    const before = pointAt(u - h);
    const after = pointAt(u + h);
    return {
      first: scaleSpatialVector(subtractSpatialVectors(after, before), 1 / (2 * h)),
      second: scaleSpatialVector(addSpatialVectors(subtractSpatialVectors(after, scaleSpatialVector(center, 2)), before), 1 / (h * h)),
    };
  }
  if (u + 2 * h <= 1) {
    const first = pointAt(u + h);
    const second = pointAt(u + 2 * h);
    return {
      first: scaleSpatialVector(combineSpatialVectors([
        [center, -3],
        [first, 4],
        [second, -1],
      ]), 1 / (2 * h)),
      second: scaleSpatialVector(addSpatialVectors(subtractSpatialVectors(center, scaleSpatialVector(first, 2)), second), 1 / (h * h)),
    };
  }
  const first = pointAt(u - h);
  const second = pointAt(u - 2 * h);
  return {
    first: scaleSpatialVector(combineSpatialVectors([
      [center, 3],
      [first, -4],
      [second, 1],
    ]), 1 / (2 * h)),
    second: scaleSpatialVector(addSpatialVectors(subtractSpatialVectors(center, scaleSpatialVector(first, 2)), second), 1 / (h * h)),
  };
}

export function evaluatePositionKeys(keys, timeSecs) {
  const space = normalizeSpatialCoordinateSpace(keys[0]?.space);
  const bracket = findTimedBracket(keys, timeSecs);
  const left = bracket.left;
  const right = bracket.right;
  if (!right || left === right) {
    return pathPositionSample(timeSecs, left.position, SPATIAL_ZERO_VECTOR, 0, SPATIAL_ZERO_VECTOR, null, left.id, space);
  }
  const duration = right.timeSecs - left.timeSecs;
  const t = bracket.t;
  const evaluation = evaluatePositionInterpolation(keys, bracket.segmentIndex, t, duration);
  return pathPositionSample(
    timeSecs,
    evaluation.position,
    evaluation.velocityUnitsPerSec,
    getSpatialVectorLength(evaluation.velocityUnitsPerSec),
    evaluation.accelerationUnitsPerSec2,
    bracket.segmentIndex,
    left.id, space
  );
}

export function pathPositionSample(timeSecs, position, velocityUnitsPerSec, speedUnitsPerSec, accelerationUnitsPerSec2, segmentIndex, segmentId, coordinateSpace) {
  const space = normalizeSpatialCoordinateSpace(coordinateSpace);
  const acceleration = accelerationUnitsPerSec2 ?? SPATIAL_ZERO_VECTOR;
  return {
    timeSecs,
    pose: { space,
      position: cloneSpatialVector3(position),
      orientation: cloneSpatialQuaternion(SPATIAL_IDENTITY_QUATERNION),
    },
    aim: null,
    velocityUnitsPerSec: cloneSpatialVector3(velocityUnitsPerSec),
    speedUnitsPerSec,
    accelerationUnitsPerSec2: cloneSpatialVector3(acceleration),
    accelerationMagnitudeUnitsPerSec2: getSpatialVectorLength(acceleration),
    segmentIndex,
    segmentId,
    diagnostics: { warnings: [] },
  };
}

export function findTimedBracket(keys, timeSecs) {
  if (keys.length === 1 || timeSecs <= keys[0].timeSecs) {
    return { left: keys[0], right: keys[0], t: 0, segmentIndex: null };
  }
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index];
    const right = keys[index + 1];
    if (timeSecs <= right.timeSecs || timingTimeNearlyEqual(timeSecs, right.timeSecs)) {
      const duration = right.timeSecs - left.timeSecs;
      const t = duration > 0 ? clamp((timeSecs - left.timeSecs) / duration, 0, 1) : 1;
      return { left, right, t, segmentIndex: index };
    }
  }
  const last = keys[keys.length - 1];
  return { left: last, right: last, t: 1, segmentIndex: null };
}

export function selectAimInterpolation(bracket, defaultInterpolation) {
  const leftAim = bracket.left.aim;
  const rightAim = bracket.right?.aim ?? leftAim;
  const explicit = bracket.left.interpolation ?? defaultInterpolation;
  if (explicit) return { spec: normalizeSpatialAimInterpolationSpec(explicit), mixedDefault: false };
  if (leftAim.kind === 'target' && rightAim.kind === 'target') {
    return { spec: { kind: 'targetLinear' }, mixedDefault: false };
  }
  if (leftAim.kind === 'direction' && rightAim.kind === 'direction') {
    return { spec: { kind: 'directionSlerp' }, mixedDefault: false };
  }
  if (leftAim.kind === 'orientation' && rightAim.kind === 'orientation') {
    return { spec: { kind: 'slerp' }, mixedDefault: false };
  }
  return { spec: { kind: 'slerp' }, mixedDefault: true };
}

export function aimInterpolationRequiresObserver(bracket, interpolation) {
  const selectedAim = interpolation.kind === 'hold' && bracket.t >= 1
    ? bracket.right.aim
    : bracket.left.aim;
  if (interpolation.kind === 'hold') return selectedAim.kind === 'target';
  if (interpolation.kind === 'targetLinear' || interpolation.kind === 'targetBezier') return true;
  if (interpolation.kind === 'slerp') {
    return bracket.left.aim.kind === 'target' || bracket.right.aim.kind === 'target';
  }
  return false;
}

export function interpolateAim(bracket, choice, context) {
  const space = spatialSpaceFor(context);
  const interpolation = choice.spec;
  const t = clamp(bracket.t, 0, 1);
  const warnings = [];
  const fallbackUp = context.fallbackUp === undefined
    ? undefined
    : normalizeSpatialVector3(context.fallbackUp);
  if (!bracket.right || bracket.left === bracket.right || interpolation.kind === 'hold') {
    const sourceKey = t >= 1 ? bracket.right : bracket.left;
    return {
      aim: aimWithFallbackUp(sourceKey.aim, fallbackUp),
      sourceKey,
      warnings,
    };
  }
  if (choice.mixedDefault) {
    warnings.push(warning(
      'mixedAimInterpolation',
      'Mixed aim kinds default to orientation slerp interpolation.',
      endpointSourceMetadata(bracket.left, bracket.right),
    ));
  }
  if (interpolation.kind === 'targetLinear' || interpolation.kind === 'targetBezier') {
    assertAimKind(bracket.left.aim, 'target', interpolation.kind);
    assertAimKind(bracket.right.aim, 'target', interpolation.kind);
    const easing = interpolation.easing ?? (interpolation.kind === 'targetBezier' ? { kind: 'smoothstep' } : { kind: 'linear' });
    const easedT = applyEasing(easing, t);
    return {
      aim: {
        kind: 'target',
        target: lerpVector(bracket.left.aim.target, bracket.right.aim.target, easedT),
        ...resolvedInterpolatedAimUp(bracket.left.aim, bracket.right.aim, fallbackUp),
      },
      sourceKey: null,
      warnings,
    };
  }
  if (interpolation.kind === 'directionSlerp') {
    assertAimKind(bracket.left.aim, 'direction', interpolation.kind);
    assertAimKind(bracket.right.aim, 'direction', interpolation.kind);
    const easedT = applyEasing(interpolation.easing ?? { kind: 'linear' }, t);
    return {
      aim: {
        kind: 'direction',
        forward: interpolateSpatialDirections(bracket.left.aim.forward, bracket.right.aim.forward, easedT),
        ...resolvedInterpolatedAimUp(bracket.left.aim, bracket.right.aim, fallbackUp),
      },
      sourceKey: null,
      warnings,
    };
  }
  const easedT = applyEasing(interpolation.easing ?? { kind: 'linear' }, t);
  const leftSample = evaluateSpatialAim({ space,
    position: context.position,
    aim: aimWithFallbackUp(bracket.left.aim, fallbackUp),
    syntheticTargetDistance: context.syntheticTargetDistance,
  });
  const rightSample = evaluateSpatialAim({ space,
    position: context.position,
    aim: aimWithFallbackUp(bracket.right.aim, fallbackUp),
    syntheticTargetDistance: context.syntheticTargetDistance,
  });
  warnings.push(...(leftSample.diagnostics?.warnings ?? []), ...(rightSample.diagnostics?.warnings ?? []));
  return {
    aim: {
      kind: 'orientation',
      orientation: interpolateSpatialQuaternions(leftSample.orientation, rightSample.orientation, easedT),
    },
    sourceKey: null,
    warnings,
  };
}

export function assertAimKind(aim, expectedKind, interpolationKind) {
  if (aim.kind !== expectedKind) {
    throw new TypeError(`${interpolationKind} aim interpolation requires ${expectedKind} aim keys.`);
  }
}

export function aimWithFallbackUp(aim, fallbackUp) {
  if (!fallbackUp || aim.kind === 'orientation' || aim.up !== undefined) return aim;
  return { ...aim, up: fallbackUp };
}

export function resolvedInterpolatedAimUp(leftAim, rightAim, fallbackUp) {
  const up = leftAim.up ?? rightAim.up ?? fallbackUp;
  return up ? { up: normalizeSpatialVector3(up) } : {};
}

export function endpointSourceMetadata(leftKey, rightKey) {
  const metadata = {};
  if (leftKey.source !== undefined) metadata.leftSource = leftKey.source;
  if (rightKey.source !== undefined) metadata.rightSource = rightKey.source;
  return metadata.leftSource !== undefined || metadata.rightSource !== undefined
    ? metadata
    : undefined;
}

export function remapPathTime(path, elapsedSecs) {
  if (!path.timeRemap) return clamp(elapsedSecs, 0, path.durationSecs);
  const playbackDuration = path.timeRemap.playbackDurationSecs ?? path.durationSecs;
  let t = playbackDuration > 0 ? clamp(elapsedSecs / playbackDuration, 0, 1) : 1;
  if (path.timeRemap.kind === 'eased') t = applyEasing(path.timeRemap.easing ?? { kind: 'smoothstep' }, t);
  return t * path.durationSecs;
}

export function normalizeEasing(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialEasingSpec object.');
  if (input.kind === 'linear' || input.kind === 'smoothstep') return { kind: input.kind };
  if (input.kind === 'easeIn' || input.kind === 'easeOut' || input.kind === 'easeInOut') {
    return {
      kind: input.kind,
      ...(input.power !== undefined ? { power: positiveFiniteNumber(input.power, `${input.kind} power`) } : {}),
    };
  }
  if (input.kind === 'cubicBezier') {
    return {
      kind: 'cubicBezier',
      x1: finiteNumberInRange(input.x1, 0, 1, 'cubicBezier x1'),
      y1: finiteRequiredNumber(input.y1, 'cubicBezier y1'),
      x2: finiteNumberInRange(input.x2, 0, 1, 'cubicBezier x2'),
      y2: finiteRequiredNumber(input.y2, 'cubicBezier y2'),
    };
  }
  throw new TypeError(`Unsupported easing kind: ${String(input.kind)}`);
}

export function applyEasing(easing, t) {
  const clamped = clamp(t, 0, 1);
  if (easing.kind === 'linear') return clamped;
  if (easing.kind === 'easeIn') return clamped ** positiveNumber(easing.power, 2);
  if (easing.kind === 'easeOut') return 1 - (1 - clamped) ** positiveNumber(easing.power, 2);
  if (easing.kind === 'easeInOut') {
    const power = positiveNumber(easing.power, 2);
    return clamped < 0.5 ? 0.5 * (2 * clamped) ** power : 1 - 0.5 * (2 * (1 - clamped)) ** power;
  }
  if (easing.kind === 'cubicBezier') return applyCubicBezierEasing(easing, clamped);
  return smoothstep01(clamped);
}

export function applyCubicBezierEasing(easing, t) {
  if (t <= 0 || t >= 1) return t;
  let u = t;
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const x = cubicBezierCoordinate(u, easing.x1, easing.x2);
    const error = x - t;
    if (Math.abs(error) <= 1e-7) {
      return cubicBezierCoordinate(u, easing.y1, easing.y2);
    }
    if (error > 0) upper = u;
    else lower = u;
    const derivative = cubicBezierDerivative(u, easing.x1, easing.x2);
    if (Math.abs(derivative) <= 1e-7) break;
    const next = u - error / derivative;
    if (!(next > lower && next < upper) || !Number.isFinite(next)) break;
    u = next;
  }
  for (let iteration = 0; iteration < 24; iteration += 1) {
    u = (lower + upper) * 0.5;
    const x = cubicBezierCoordinate(u, easing.x1, easing.x2);
    if (Math.abs(x - t) <= 1e-7) break;
    if (x > t) upper = u;
    else lower = u;
  }
  return cubicBezierCoordinate(u, easing.y1, easing.y2);
}

export function cubicBezierCoordinate(t, p1, p2) {
  const oneMinus = 1 - t;
  return 3 * oneMinus * oneMinus * t * p1 + 3 * oneMinus * t * t * p2 + t * t * t;
}

export function cubicBezierDerivative(t, p1, p2) {
  const oneMinus = 1 - t;
  return 3 * oneMinus * oneMinus * p1 + 6 * oneMinus * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

export function resolveTransitionLaneTimings(spec) {
  if (spec.durationSecs !== undefined) {
    const durationSecs = spec.durationSecs;
    return {
      durationSecs,
      position: resolveTransitionLaneTimingWithTotal('position', spec.position, durationSecs),
      aim: resolveTransitionLaneTimingWithTotal('aim', spec.aim, durationSecs),
    };
  }
  const position = resolveTransitionLaneTimingWithoutTotal(spec.position);
  const aim = resolveTransitionLaneTimingWithoutTotal(spec.aim);
  return {
    durationSecs: Math.max(
      position.delaySecs + position.durationSecs,
      aim.delaySecs + aim.durationSecs,
      1,
    ),
    position,
    aim,
  };
}

export function resolveTransitionLaneTimingWithTotal(name, lane, durationSecs) {
  const delaySecs = lane?.delaySecs ?? 0;
  if (delaySecs > durationSecs && !timingTimeNearlyEqual(delaySecs, durationSecs)) {
    throw new RangeError(`${name} transition lane delaySecs cannot exceed durationSecs.`);
  }
  const laneDurationSecs = lane?.durationSecs ?? Math.max(0, durationSecs - delaySecs);
  if (delaySecs + laneDurationSecs > durationSecs && !timingTimeNearlyEqual(delaySecs + laneDurationSecs, durationSecs)) {
    throw new RangeError(`${name} transition lane delaySecs plus durationSecs cannot exceed durationSecs.`);
  }
  return { delaySecs, durationSecs: laneDurationSecs };
}

export function resolveTransitionLaneTimingWithoutTotal(lane) {
  return {
    delaySecs: lane?.delaySecs ?? 0,
    durationSecs: lane?.durationSecs ?? 1,
  };
}

export function materializeTransitionPositionKeys(input) {
  const interpolation = transitionPositionInterpolation(input.lane, input.warnings);
  return materializeTransitionKeys({
    from: input.from,
    to: input.to,
    timing: input.timing,
    durationSecs: input.durationSecs,
    activeInterpolation: interpolation,
    keyPrefix: 'position',
    valueKey: 'position',
  });
}

export function materializeTransitionAimKeys(input) {
  const interpolation = transitionAimInterpolation(input.lane, input.from, input.to);
  return materializeTransitionKeys({
    from: input.from,
    to: input.to,
    timing: input.timing,
    durationSecs: input.durationSecs,
    activeInterpolation: interpolation,
    keyPrefix: 'aim',
    valueKey: 'aim',
  });
}

export function materializeTransitionKeys(input) {
  const keys = [];
  const delaySecs = input.timing.delaySecs;
  const activeDurationSecs = input.timing.durationSecs;
  const activeEndSecs = delaySecs + activeDurationSecs;
  const holdInterpolation = { kind: 'hold' };
  const makeKey = (id, timeSecs, value, interpolation) => ({
    id: `${input.keyPrefix}-${id}`,
    timeSecs,
    [input.valueKey]: value,
    interpolation,
  });

  if (input.durationSecs === 0) {
    return [makeKey('to', 0, input.to, holdInterpolation)];
  }

  if (activeDurationSecs === 0) {
    if (delaySecs === 0) {
      keys.push(makeKey('to', 0, input.to, holdInterpolation));
    } else {
      keys.push(makeKey('from', 0, input.from, holdInterpolation));
      keys.push(makeKey('to', delaySecs, input.to, holdInterpolation));
    }
  } else {
    if (delaySecs > 0) {
      keys.push(makeKey('from', 0, input.from, holdInterpolation));
      keys.push(makeKey('active-start', delaySecs, input.from, input.activeInterpolation));
    } else {
      keys.push(makeKey('active-start', 0, input.from, input.activeInterpolation));
    }
    keys.push(makeKey('active-end', activeEndSecs, input.to, holdInterpolation));
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey.timeSecs < input.durationSecs && !timingTimeNearlyEqual(lastKey.timeSecs, input.durationSecs)) {
    keys.push(makeKey('hold-end', input.durationSecs, input.to, holdInterpolation));
  }
  return keys;
}

export function transitionPositionInterpolation(lane, warnings) {
  const interpolation = lane?.interpolation ?? 'linear';
  if (interpolation === 'hold') return { kind: 'hold' };
  if (interpolation === 'slerp') {
    warnings.push(warning(
      'positionSlerpInterpolationUnsupported',
      'Position transition lanes do not support slerp; using linear interpolation.',
    ));
  }
  const easing = transitionLaneEasing(lane, interpolation);
  return {
    kind: 'linear',
    ...(easing.kind !== 'linear' || lane?.easing !== undefined ? { easing } : {}),
  };
}

export function transitionAimInterpolation(lane, from, to) {
  const interpolation = lane?.interpolation ?? 'linear';
  if (interpolation === 'hold') return { kind: 'hold' };
  const easing = transitionLaneEasing(lane, interpolation);
  const withEasing = (kind) => ({
    kind,
    ...(easing.kind !== 'linear' || lane?.easing !== undefined ? { easing } : {}),
  });
  if (interpolation === 'slerp' || from.kind !== to.kind || from.kind === 'orientation') {
    return withEasing('slerp');
  }
  if (from.kind === 'target') return withEasing('targetLinear');
  if (from.kind === 'direction') return withEasing('directionSlerp');
  return withEasing('slerp');
}

export function transitionLaneEasing(lane, interpolation) {
  if (lane?.easing !== undefined) return lane.easing;
  if (interpolation === 'smoothstep') return { kind: 'smoothstep' };
  if (interpolation === 'easeIn') return { kind: 'easeIn' };
  if (interpolation === 'easeOut') return { kind: 'easeOut' };
  if (interpolation === 'easeInOut') return { kind: 'easeInOut' };
  return { kind: 'linear' };
}

export function normalizeTransitionLane(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialTransitionLaneSpec object.');
  const interpolation = input.interpolation === undefined ? undefined : String(input.interpolation);
  if (interpolation !== undefined && !TRANSITION_LANE_INTERPOLATIONS.has(interpolation)) {
    throw new TypeError(`Unsupported transition lane interpolation: ${interpolation}`);
  }
  return {
    ...(input.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(input.durationSecs, 'transition lane durationSecs') } : {}),
    ...(input.delaySecs !== undefined ? { delaySecs: nonNegativeFiniteNumber(input.delaySecs, 'transition lane delaySecs') } : {}),
    ...(input.easing !== undefined ? { easing: normalizeEasing(input.easing) } : {}),
    ...(interpolation !== undefined ? { interpolation } : {}),
  };
}

export function transitionFrameState(transition, sample, complete) {
  const endpointFrameState = complete ? transition.to : transition.from;
  const { frameIndex: _frameIndex, ...metadata } = cloneFrameState(endpointFrameState);
  const frameState = {
    ...metadata,
    timeSecs: sample.timeSecs,
    pose: cloneSpatialPose(sample.pose),
    aim: sample.aim ? cloneAimSample(sample.aim) : null,
  };
  if (sample.frameIndex !== undefined) frameState.frameIndex = sample.frameIndex;
  return frameState;
}

export function buildPoseTransitionViewPath(input) {
  const space = spatialSpaceFor(input, input?.from?.space);
  const normalized = normalizeSpatialPoseTransitionSpec(input);
  return buildSpatialViewTransitionPath({ space,
    from: { pose: normalized.from, aim: null },
    to: { pose: normalized.to, aim: null },
    ...(normalized.durationSecs !== undefined ? { durationSecs: normalized.durationSecs } : {}),
    ...(normalized.movement !== undefined ? { position: normalized.movement } : {}),
    ...(normalized.orientation !== undefined ? { aim: normalized.orientation } : {}),
  });
}

export function publicTransitionLane(lane, timing) {
  const output = {
    ...(lane ?? {}),
    durationSecs: timing.durationSecs,
  };
  if (lane?.delaySecs !== undefined || timing.delaySecs > 0) {
    output.delaySecs = timing.delaySecs;
  }
  return output;
}
