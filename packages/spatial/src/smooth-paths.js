import {
  IDENTITY_QUATERNION,
  LOCAL_FORWARD,
  LOCAL_RIGHT,
  LOCAL_UP,
  ZERO_VECTOR,
  addVectors,
  applyQuaternion,
  clonePose,
  cloneQuaternion,
  cloneVector3,
  finiteNumber,
  normalizeDirection,
  normalizeQuaternion,
  normalizeVector3,
  scaleVector,
  subtractVectors,
  vectorLength,
} from './math.js';

const EPSILON = 1e-9;
const DEFAULT_ARC_SAMPLES_PER_SEGMENT = 80;
const DEFAULT_TARGET_DISTANCE = 100;

/**
 * @param {Iterable<unknown>} [waypoints]
 * @returns {import('./index.d.ts').SpatialTimedPositionWaypoint[]}
 */
export function normalizeTimedSpatialPositionWaypoints(waypoints = []) {
  return Array.from(waypoints ?? [])
    .map((entry, index) => {
      const source = /** @type {{ id?: unknown; timeSecs?: unknown; position?: unknown; positionPc?: unknown; motionGroup?: unknown }} */ (entry ?? {});
      return {
        id: String(source.id ?? `pos-${index}`),
        timeSecs: finiteNumber(source.timeSecs, 0),
        position: normalizeVector3(source.position ?? source.positionPc, ZERO_VECTOR),
        ...(source.motionGroup && typeof source.motionGroup === 'object'
          ? { motionGroup: clonePlainObject(source.motionGroup) }
          : {}),
      };
    })
    .sort(compareTimedEntries);
}

/**
 * @param {Iterable<unknown>} [waypoints]
 * @returns {import('./index.d.ts').SpatialTimedOrientationWaypoint[]}
 */
export function normalizeTimedSpatialOrientationWaypoints(waypoints = []) {
  return /** @type {import('./index.d.ts').SpatialTimedOrientationWaypoint[]} */ (Array.from(waypoints ?? [])
    .map((entry, index) => normalizeOrientationWaypoint(entry, index))
    .sort(compareTimedEntries));
}

/**
 * @param {Iterable<unknown>} [waypoints]
 * @param {import('./index.d.ts').CreateSpatialPositionTrackOptions} [options]
 * @returns {import('./index.d.ts').SpatialPositionTrack}
 */
export function createSpatialPositionTrack(waypoints = [], options = {}) {
  const normalized = normalizeTimedSpatialPositionWaypoints(waypoints);
  const samplesPerSegment = Math.max(
    8,
    Math.floor(finiteNumber(options.samplesPerSegment, DEFAULT_ARC_SAMPLES_PER_SEGMENT)),
  );
  /** @type {import('./index.d.ts').SpatialPositionTrackSegment[]} */
  const segments = [];
  const points = normalized.map((entry) => entry.position);
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const start = normalized[index];
    const end = normalized[index + 1];
    const durationSecs = Math.max(0, end.timeSecs - start.timeSecs);
    const held = pointDistance(start.position, end.position) <= EPSILON;
    const arc = held
      ? { length: 0, samples: [{ u: 0, distance: 0, point: cloneVector3(start.position) }] }
      : createArcTable(points, index, samplesPerSegment);
    segments.push({
      index,
      start,
      end,
      durationSecs,
      held,
      length: arc.length,
      speed: durationSecs > EPSILON && !held ? arc.length / durationSecs : 0,
      arc,
    });
  }
  return {
    waypoints: normalized,
    segments,
    durationSecs: normalized.length > 0 ? normalized[normalized.length - 1].timeSecs : 0,
    samplesPerSegment,
  };
}

/**
 * @param {import('./index.d.ts').SpatialPositionTrack} track
 * @param {number} timeSecs
 * @returns {import('./index.d.ts').SpatialPositionTrackSample}
 */
export function evaluateSpatialPositionTrack(track, timeSecs) {
  const waypoints = Array.isArray(track?.waypoints) ? track.waypoints : [];
  if (waypoints.length === 0) {
    return positionSample(0, ZERO_VECTOR, ZERO_VECTOR, 0, null);
  }
  const clampedTime = clamp(finiteNumber(timeSecs, 0), waypoints[0].timeSecs, track.durationSecs);
  if (waypoints.length === 1 || !Array.isArray(track.segments) || track.segments.length === 0) {
    return positionSample(clampedTime, waypoints[0].position, ZERO_VECTOR, 0, null);
  }
  const segment = findTimedSegment(track.segments, clampedTime);
  if (!segment || segment.durationSecs <= EPSILON) {
    return positionSample(clampedTime, waypoints[0].position, ZERO_VECTOR, 0, null);
  }
  if (segment.held || segment.length <= EPSILON) {
    return positionSample(clampedTime, segment.start.position, ZERO_VECTOR, 0, segment.index);
  }
  const localTime = clamp(clampedTime - segment.start.timeSecs, 0, segment.durationSecs);
  const targetDistance = (localTime / segment.durationSecs) * segment.length;
  const u = uAtArcDistance(segment.arc, targetDistance);
  const position = catmullRomSegmentPoint(waypoints.map((entry) => entry.position), segment.index, u);
  const deltaDistance = Math.max(segment.length * 0.0025, 0.01);
  const before = catmullRomSegmentPoint(
    waypoints.map((entry) => entry.position),
    segment.index,
    uAtArcDistance(segment.arc, targetDistance - deltaDistance),
  );
  const after = catmullRomSegmentPoint(
    waypoints.map((entry) => entry.position),
    segment.index,
    uAtArcDistance(segment.arc, targetDistance + deltaDistance),
  );
  const velocityUnit = normalizeOrZero(subtractVectors(after, before));
  return positionSample(clampedTime, position, scaleVector(velocityUnit, segment.speed), segment.speed, segment.index);
}

/**
 * @param {Iterable<unknown>} [waypoints]
 * @param {import('./index.d.ts').CreateSpatialOrientationTrackOptions} [options]
 * @returns {import('./index.d.ts').SpatialOrientationTrack}
 */
export function createSpatialOrientationTrack(waypoints = [], options = {}) {
  const normalized = normalizeTimedSpatialOrientationWaypoints(waypoints);
  return {
    waypoints: normalized,
    durationSecs: normalized.length > 0 ? normalized[normalized.length - 1].timeSecs : 0,
    useLinearInterpolation: options.useLinearInterpolation === true,
  };
}

/**
 * @param {import('./index.d.ts').SpatialOrientationTrack} track
 * @param {number} timeSecs
 * @param {{ position?: import('./index.d.ts').SpatialVector3 }} [context]
 * @returns {import('./index.d.ts').SpatialOrientationTrackSample}
 */
export function evaluateSpatialOrientationTrack(track, timeSecs, context = {}) {
  const waypoints = Array.isArray(track?.waypoints) ? track.waypoints : [];
  const position = normalizeVector3(context.position, ZERO_VECTOR);
  if (waypoints.length === 0) {
    return orientationSample(finiteNumber(timeSecs, 0), IDENTITY_QUATERNION);
  }
  const clampedTime = clamp(finiteNumber(timeSecs, 0), waypoints[0].timeSecs, track.durationSecs);
  const bracket = findBracketingWaypoints(waypoints, clampedTime);
  if (!bracket) {
    return orientationSample(clampedTime, IDENTITY_QUATERNION);
  }
  const left = quaternionFromOrientationWaypoint(bracket.left, position);
  const right = quaternionFromOrientationWaypoint(bracket.right, position);
  const t = track.useLinearInterpolation ? bracket.t : smoothstep01(bracket.t);
  return orientationSample(clampedTime, slerpQuaternions(left, right, t));
}

/**
 * @param {import('./index.d.ts').CreateSpatialSmoothPathInput} input
 * @param {import('./index.d.ts').CreateSpatialSmoothPathOptions} [options]
 * @returns {import('./index.d.ts').SpatialSmoothPath}
 */
export function createSpatialSmoothPath(input = {}, options = {}) {
  const positionTrack = createSpatialPositionTrack(input.positionWaypoints ?? [], options);
  const orientationTrack = createSpatialOrientationTrack(input.orientationWaypoints ?? [], options);
  const durationSecs = Math.max(
    0,
    finiteNumber(input.durationSecs, Math.max(positionTrack.durationSecs, orientationTrack.durationSecs)),
  );
  const targetDistance = positiveOrFallback(input.targetDistance ?? options.targetDistance, DEFAULT_TARGET_DISTANCE);
  /** @type {import('./index.d.ts').SpatialSmoothPath} */
  const path = {
    durationSecs,
    positionTrack,
    orientationTrack,
    evaluate(timeSecs) {
      return evaluateSpatialSmoothPath(path, timeSecs, { targetDistance });
    },
    /** @param {import('./index.d.ts').MaterializeSpatialPathSamplesOptions} [sampleOptions] */
    sample(sampleOptions = {}) {
      return materializeSpatialPathSamples(path, sampleOptions);
    },
    /** @param {import('./index.d.ts').MaterializeSpatialPreloadHintsOptions} [hintOptions] */
    materializePreloadHints(hintOptions = {}) {
      return materializeSpatialPreloadHints(path.sample(hintOptions), hintOptions);
    },
  };
  return path;
}

/**
 * @param {import('./index.d.ts').SpatialSmoothPath} path
 * @param {number} timeSecs
 * @param {{ targetDistance?: number }} [options]
 * @returns {import('./index.d.ts').SpatialSmoothPathSample}
 */
export function evaluateSpatialSmoothPath(path, timeSecs, options = {}) {
  const clampedTime = clamp(finiteNumber(timeSecs, 0), 0, positiveOrFallback(path.durationSecs, 0));
  const position = evaluateSpatialPositionTrack(path.positionTrack, clampedTime);
  const orientation = evaluateSpatialOrientationTrack(path.orientationTrack, clampedTime, {
    position: position.position,
  });
  const forward = applyQuaternion(LOCAL_FORWARD, orientation.orientation);
  const up = applyQuaternion(LOCAL_UP, orientation.orientation);
  const target = addVectors(position.position, scaleVector(forward, positiveOrFallback(options.targetDistance, DEFAULT_TARGET_DISTANCE)));
  return {
    timeSecs: clampedTime,
    pose: {
      position: cloneVector3(position.position),
      orientation: cloneQuaternion(orientation.orientation),
    },
    position: cloneVector3(position.position),
    orientation: cloneQuaternion(orientation.orientation),
    target,
    forward,
    up,
    velocity: cloneVector3(position.velocity),
    velocityUnit: cloneVector3(position.velocityUnit),
    speed: position.speed,
    segmentIndex: position.segmentIndex,
  };
}

/**
 * @param {import('./index.d.ts').SpatialPoseTransitionInput} input
 * @returns {import('./index.d.ts').SpatialPoseTransition}
 */
export function createSpatialPoseTransition(input) {
  const from = normalizePoseLike(input?.from);
  const to = normalizePoseLike(input?.to);
  const movementDuration = transitionDuration(input?.movement, input?.durationSecs);
  const orientationDuration = transitionDuration(input?.orientation, input?.durationSecs);
  const durationSecs = Math.max(movementDuration, orientationDuration);
  /** @type {import('./index.d.ts').SpatialPoseTransition} */
  const transition = {
    durationSecs,
    from,
    to,
    movement: input?.movement ?? { durationSecs: movementDuration },
    orientation: input?.orientation ?? { durationSecs: orientationDuration },
    evaluate(elapsedSecs) {
      return evaluateSpatialPoseTransition(transition, elapsedSecs);
    },
  };
  return transition;
}

/**
 * @param {import('./index.d.ts').SpatialPoseTransition} transition
 * @param {number} elapsedSecs
 * @returns {import('./index.d.ts').SpatialPoseTransitionSample}
 */
export function evaluateSpatialPoseTransition(transition, elapsedSecs) {
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const movementDuration = transitionDuration(transition.movement, transition.durationSecs);
  const orientationDuration = transitionDuration(transition.orientation, transition.durationSecs);
  const moveT = movementDuration <= EPSILON ? 1 : smoothstep01(elapsed / movementDuration);
  const orientationT = orientationDuration <= EPSILON ? 1 : smoothstep01(elapsed / orientationDuration);
  return {
    elapsedSecs: elapsed,
    complete: elapsed >= transition.durationSecs - EPSILON,
    pose: {
      position: lerpVector(transition.from.position, transition.to.position, moveT),
      orientation: slerpQuaternions(transition.from.orientation, transition.to.orientation, orientationT),
    },
    movementComplete: elapsed >= movementDuration - EPSILON,
    orientationComplete: elapsed >= orientationDuration - EPSILON,
  };
}

/**
 * @param {import('./index.d.ts').SpatialSmoothPath | { sample?: Function; evaluate?: Function; durationSecs?: number } | import('./index.d.ts').SpatialSmoothPathSample[]} input
 * @param {import('./index.d.ts').MaterializeSpatialPathSamplesOptions} [options]
 * @returns {import('./index.d.ts').SpatialSmoothPathSample[]}
 */
export function materializeSpatialPathSamples(input, options = {}) {
  if (Array.isArray(input)) {
    return input.map(cloneSmoothSample);
  }
  if (!input || typeof input !== 'object' || typeof input.evaluate !== 'function') {
    return [];
  }
  const durationSecs = Math.max(0, finiteNumber(input.durationSecs, 0));
  const stepSecs = positiveOrFallback(options.stepSecs, 1);
  /** @type {import('./index.d.ts').SpatialSmoothPathSample[]} */
  const samples = [];
  let frameIndex = 0;
  for (let timeSecs = 0; timeSecs <= durationSecs + stepSecs * 0.5; timeSecs += stepSecs) {
    const sample = /** @type {import('./index.d.ts').SpatialSmoothPathSample} */ (
      input.evaluate(Math.min(timeSecs, durationSecs))
    );
    samples.push({ ...cloneSmoothSample(sample), frameIndex });
    frameIndex += 1;
    if (sample.timeSecs >= durationSecs - EPSILON) break;
  }
  return samples;
}

/**
 * @param {import('./index.d.ts').SpatialSmoothPathSample[] | import('./index.d.ts').SpatialSmoothPath} input
 * @param {import('./index.d.ts').MaterializeSpatialPreloadHintsOptions} [options]
 * @returns {import('./index.d.ts').SpatialPreloadHint[]}
 */
export function materializeSpatialPreloadHints(input, options = {}) {
  const samples = Array.isArray(input)
    ? input.map(cloneSmoothSample)
    : materializeSpatialPathSamples(input, options);
  if (samples.length === 0) return [];
  /** @type {import('./index.d.ts').SpatialPreloadHint[]} */
  const hints = [];
  const pathRadius = Number(options.pathRadiusPc);
  if (Number.isFinite(pathRadius) && pathRadius > 0 && samples.length > 1) {
    hints.push({
      kind: 'path-volume',
      pointsPc: samples.map((sample) => cloneVector3(sample.pose.position)),
      radiusPc: pathRadius,
      timeRangeSecs: [samples[0].timeSecs, samples[samples.length - 1].timeSecs],
      priority: finiteNumber(options.priority, 0),
    });
  }
  const sphereRadius = Number(options.sphereRadiusPc);
  if (Number.isFinite(sphereRadius) && sphereRadius > 0) {
    for (const sample of samples) {
      hints.push({
        kind: 'sphere-volume',
        centerPc: cloneVector3(sample.pose.position),
        radiusPc: sphereRadius,
        timeRangeSecs: [sample.timeSecs, sample.timeSecs],
        priority: finiteNumber(options.priority, 0),
      });
    }
  }
  const lookaheadSecs = Number(options.lookaheadSecs);
  if (Number.isFinite(lookaheadSecs) && lookaheadSecs > 0) {
    for (const sample of samples) {
      if (!(sample.speed > 0)) continue;
      hints.push({
        kind: 'view-lookahead',
        pose: clonePose(sample.pose),
        velocity: cloneVector3(sample.velocity),
        lookaheadSecs,
        timeRangeSecs: [sample.timeSecs, sample.timeSecs + lookaheadSecs],
        priority: finiteNumber(options.priority, 0),
      });
    }
  }
  return hints;
}

/** @param {unknown} entry @param {number} index */
function normalizeOrientationWaypoint(entry, index) {
  const source = /** @type {{ id?: unknown; timeSecs?: unknown; kind?: unknown; target?: unknown; targetPc?: unknown; forward?: unknown; up?: unknown; orientation?: unknown; orientationIcrs?: unknown; cameraQuaternion?: unknown }} */ (entry ?? {});
  const id = String(source.id ?? `ori-${index}`);
  const timeSecs = finiteNumber(source.timeSecs, 0);
  if (source.kind === 'target' || source.target || source.targetPc) {
    return {
      id,
      timeSecs,
      kind: 'target',
      target: normalizeVector3(source.target ?? source.targetPc, ZERO_VECTOR),
      up: normalizeDirectionOr(source.up, LOCAL_UP),
    };
  }
  if (source.kind === 'quaternion' || source.orientation || source.orientationIcrs || source.cameraQuaternion) {
    return {
      id,
      timeSecs,
      kind: 'quaternion',
      orientation: normalizeQuaternion(source.orientation ?? source.orientationIcrs ?? source.cameraQuaternion, IDENTITY_QUATERNION),
    };
  }
  const forward = normalizeDirectionOr(source.forward, LOCAL_FORWARD);
  return {
    id,
    timeSecs,
    kind: 'direction',
    forward,
    up: orthonormalizeUp(forward, source.up),
  };
}

/** @param {{ timeSecs: number; id?: string }} left @param {{ timeSecs: number; id?: string }} right */
function compareTimedEntries(left, right) {
  return left.timeSecs - right.timeSecs || String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

/** @param {unknown} value */
function clonePlainObject(value) {
  return { .../** @type {Record<string, unknown>} */ (value) };
}

/** @param {import('./index.d.ts').SpatialVector3} a @param {import('./index.d.ts').SpatialVector3} b */
function pointDistance(a, b) {
  return vectorLength(subtractVectors(a, b));
}

/** @param {import('./index.d.ts').SpatialVector3} vector */
function normalizeOrZero(vector) {
  const length = vectorLength(vector);
  return length > EPSILON ? scaleVector(vector, 1 / length) : cloneVector3(ZERO_VECTOR);
}

/** @param {unknown} value @param {import('./index.d.ts').SpatialVector3} fallback */
function normalizeDirectionOr(value, fallback) {
  const candidate = normalizeVector3(value, fallback);
  const length = vectorLength(candidate);
  return length > EPSILON ? scaleVector(candidate, 1 / length) : cloneVector3(fallback);
}

/** @param {import('./index.d.ts').SpatialVector3} forward @param {unknown} up */
function orthonormalizeUp(forward, up) {
  const candidate = normalizeDirectionOr(up, LOCAL_UP);
  const projected = subtractVectors(candidate, scaleVector(forward, dot(candidate, forward)));
  const projectedLength = vectorLength(projected);
  if (projectedLength > EPSILON) return scaleVector(projected, 1 / projectedLength);
  for (const fallback of [LOCAL_UP, { x: 0, y: 0, z: 1 }, LOCAL_RIGHT]) {
    const next = subtractVectors(fallback, scaleVector(forward, dot(fallback, forward)));
    const nextLength = vectorLength(next);
    if (nextLength > EPSILON) return scaleVector(next, 1 / nextLength);
  }
  return cloneVector3(LOCAL_UP);
}

/** @param {import('./index.d.ts').SpatialVector3} a @param {import('./index.d.ts').SpatialVector3} b */
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** @param {import('./index.d.ts').SpatialVector3} a @param {import('./index.d.ts').SpatialVector3} b */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** @param {import('./index.d.ts').SpatialVector3[]} points @param {number} index @param {number} samplesPerSegment */
function createArcTable(points, index, samplesPerSegment) {
  const samples = [{ u: 0, distance: 0, point: catmullRomSegmentPoint(points, index, 0) }];
  let distance = 0;
  let previous = samples[0].point;
  for (let step = 1; step <= samplesPerSegment; step += 1) {
    const u = step / samplesPerSegment;
    const point = catmullRomSegmentPoint(points, index, u);
    distance += pointDistance(previous, point);
    samples.push({ u, distance, point });
    previous = point;
  }
  return { length: distance, samples };
}

/** @param {import('./index.d.ts').SpatialVector3} first @param {import('./index.d.ts').SpatialVector3} second */
function extrapolateBefore(first, second) {
  return subtractVectors(scaleVector(first, 2), second);
}

/** @param {import('./index.d.ts').SpatialVector3} last @param {import('./index.d.ts').SpatialVector3} previous */
function extrapolateAfter(last, previous) {
  return subtractVectors(scaleVector(last, 2), previous);
}

/** @param {import('./index.d.ts').SpatialVector3} a @param {import('./index.d.ts').SpatialVector3} b @param {number} ta @param {number} tb @param {number} t */
function interpolateCentripetal(a, b, ta, tb, t) {
  if (Math.abs(tb - ta) <= EPSILON) return cloneVector3(b);
  return addVectors(scaleVector(a, (tb - t) / (tb - ta)), scaleVector(b, (t - ta) / (tb - ta)));
}

/** @param {number} nextT @param {import('./index.d.ts').SpatialVector3} a @param {import('./index.d.ts').SpatialVector3} b */
function knot(nextT, a, b) {
  return nextT + Math.max(Math.sqrt(pointDistance(a, b)), EPSILON);
}

/** @param {import('./index.d.ts').SpatialVector3[]} points @param {number} index @param {number} u */
function catmullRomSegmentPoint(points, index, u) {
  const p1 = points[index];
  const p2 = points[index + 1];
  if (!p1 || !p2) return cloneVector3(points[points.length - 1] ?? ZERO_VECTOR);
  const p0 = points[index - 1] ?? extrapolateBefore(p1, p2);
  const p3 = points[index + 2] ?? extrapolateAfter(p2, p1);
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const t = lerp(t1, t2, clamp(u, 0, 1));
  const a1 = interpolateCentripetal(p0, p1, t0, t1, t);
  const a2 = interpolateCentripetal(p1, p2, t1, t2, t);
  const a3 = interpolateCentripetal(p2, p3, t2, t3, t);
  const b1 = interpolateCentripetal(a1, a2, t0, t2, t);
  const b2 = interpolateCentripetal(a2, a3, t1, t3, t);
  return interpolateCentripetal(b1, b2, t1, t2, t);
}

/** @param {{ length: number; samples: Array<{ u: number; distance: number }> }} table @param {number} distance */
function uAtArcDistance(table, distance) {
  if (table.length <= EPSILON) return 0;
  const clamped = clamp(distance, 0, table.length);
  for (let index = 1; index < table.samples.length; index += 1) {
    const right = table.samples[index];
    const left = table.samples[index - 1];
    if (right.distance >= clamped) {
      const span = right.distance - left.distance;
      return lerp(left.u, right.u, span > EPSILON ? (clamped - left.distance) / span : 0);
    }
  }
  return 1;
}

/** @param {import('./index.d.ts').SpatialPositionTrackSegment[]} segments @param {number} timeSecs */
function findTimedSegment(segments, timeSecs) {
  if (timeSecs <= segments[0].start.timeSecs) return segments[0];
  for (const segment of segments) {
    if (timeSecs >= segment.start.timeSecs && timeSecs <= segment.end.timeSecs) return segment;
  }
  return segments[segments.length - 1] ?? null;
}

/** @param {import('./index.d.ts').SpatialTimedOrientationWaypoint[]} waypoints @param {number} timeSecs */
function findBracketingWaypoints(waypoints, timeSecs) {
  if (waypoints.length === 0) return null;
  if (waypoints.length === 1 || timeSecs <= waypoints[0].timeSecs) {
    return { left: waypoints[0], right: waypoints[0], t: 0 };
  }
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const left = waypoints[index];
    const right = waypoints[index + 1];
    if (timeSecs >= left.timeSecs && timeSecs <= right.timeSecs) {
      const duration = right.timeSecs - left.timeSecs;
      return { left, right, t: duration > EPSILON ? clamp((timeSecs - left.timeSecs) / duration, 0, 1) : 0 };
    }
  }
  const last = waypoints[waypoints.length - 1];
  return { left: last, right: last, t: 0 };
}

/** @param {import('./index.d.ts').SpatialTimedOrientationWaypoint} waypoint @param {import('./index.d.ts').SpatialVector3} position */
function quaternionFromOrientationWaypoint(waypoint, position) {
  if (waypoint.kind === 'target') {
    return quaternionFromForwardUp(subtractVectors(waypoint.target, position), waypoint.up);
  }
  if (waypoint.kind === 'quaternion') {
    return cloneQuaternion(waypoint.orientation);
  }
  return quaternionFromForwardUp(waypoint.forward, waypoint.up);
}

/** @param {import('./index.d.ts').SpatialVector3} forwardInput @param {unknown} upInput */
function quaternionFromForwardUp(forwardInput, upInput) {
  const forward = normalizeDirectionOr(forwardInput, LOCAL_FORWARD);
  const up = orthonormalizeUp(forward, upInput);
  const backward = scaleVector(forward, -1);
  const right = normalizeDirectionOr(cross(up, backward), LOCAL_RIGHT);
  const correctedUp = normalizeDirectionOr(cross(backward, right), up);
  return quaternionFromBasis(right, correctedUp, backward);
}

/** @param {import('./index.d.ts').SpatialVector3} right @param {import('./index.d.ts').SpatialVector3} up @param {import('./index.d.ts').SpatialVector3} backward */
function quaternionFromBasis(right, up, backward) {
  const m11 = right.x; const m12 = up.x; const m13 = backward.x;
  const m21 = right.y; const m22 = up.y; const m23 = backward.y;
  const m31 = right.z; const m32 = up.z; const m33 = backward.z;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return normalizeQuaternion({
      w: 0.25 / s,
      x: (m32 - m23) * s,
      y: (m13 - m31) * s,
      z: (m21 - m12) * s,
    });
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return normalizeQuaternion({
      w: (m32 - m23) / s,
      x: 0.25 * s,
      y: (m12 + m21) / s,
      z: (m13 + m31) / s,
    });
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return normalizeQuaternion({
      w: (m13 - m31) / s,
      x: (m12 + m21) / s,
      y: 0.25 * s,
      z: (m23 + m32) / s,
    });
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return normalizeQuaternion({
    w: (m21 - m12) / s,
    x: (m13 + m31) / s,
    y: (m23 + m32) / s,
    z: 0.25 * s,
  });
}

/** @param {import('./index.d.ts').SpatialQuaternion} a @param {import('./index.d.ts').SpatialQuaternion} b @param {number} t */
function slerpQuaternions(a, b, t) {
  let bx = b.x; let by = b.y; let bz = b.z; let bw = b.w;
  let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalfTheta < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
    cosHalfTheta = -cosHalfTheta;
  }
  if (cosHalfTheta >= 1) return cloneQuaternion(a);
  const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
  if (sqrSinHalfTheta <= EPSILON) {
    return normalizeQuaternion({
      x: lerp(a.x, bx, t),
      y: lerp(a.y, by, t),
      z: lerp(a.z, bz, t),
      w: lerp(a.w, bw, t),
    });
  }
  const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
  const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  return normalizeQuaternion({
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  });
}

/** @param {number} value */
function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/** @param {number} left @param {number} right @param {number} t */
function lerp(left, right, t) {
  return left + (right - left) * t;
}

/** @param {import('./index.d.ts').SpatialVector3} left @param {import('./index.d.ts').SpatialVector3} right @param {number} t */
function lerpVector(left, right, t) {
  return {
    x: lerp(left.x, right.x, t),
    y: lerp(left.y, right.y, t),
    z: lerp(left.z, right.z, t),
  };
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {unknown} value @param {number} fallback */
function positiveOrFallback(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {number} timeSecs @param {import('./index.d.ts').SpatialVector3} position @param {import('./index.d.ts').SpatialVector3} velocity @param {number} speed @param {number | null} segmentIndex */
function positionSample(timeSecs, position, velocity, speed, segmentIndex) {
  const velocityUnit = speed > EPSILON ? normalizeOrZero(velocity) : cloneVector3(ZERO_VECTOR);
  return {
    timeSecs,
    position: cloneVector3(position),
    velocity: cloneVector3(velocity),
    velocityUnit,
    speed,
    segmentIndex,
  };
}

/** @param {number} timeSecs @param {import('./index.d.ts').SpatialQuaternion} orientation */
function orientationSample(timeSecs, orientation) {
  const q = normalizeQuaternion(orientation, IDENTITY_QUATERNION);
  return {
    timeSecs,
    orientation: q,
    forward: applyQuaternion(LOCAL_FORWARD, q),
    up: applyQuaternion(LOCAL_UP, q),
  };
}

/** @param {unknown} value */
function normalizePoseLike(value) {
  const pose = /** @type {{ position?: unknown; orientation?: unknown; observerPc?: unknown; orientationIcrs?: unknown }} */ (value ?? {});
  return {
    position: normalizeVector3(pose.position ?? pose.observerPc, ZERO_VECTOR),
    orientation: normalizeQuaternion(pose.orientation ?? pose.orientationIcrs, IDENTITY_QUATERNION),
  };
}

/** @param {unknown} lane @param {unknown} fallback */
function transitionDuration(lane, fallback) {
  return Math.max(0, finiteNumber(/** @type {{ durationSecs?: unknown }} */ (lane ?? {}).durationSecs, finiteNumber(fallback, 0)));
}

/** @param {import('./index.d.ts').SpatialSmoothPathSample} sample */
function cloneSmoothSample(sample) {
  return {
    ...sample,
    pose: clonePose(sample.pose),
    position: cloneVector3(sample.position ?? sample.pose.position),
    orientation: cloneQuaternion(sample.orientation ?? sample.pose.orientation),
    target: cloneVector3(sample.target),
    forward: cloneVector3(sample.forward),
    up: cloneVector3(sample.up),
    velocity: cloneVector3(sample.velocity),
    velocityUnit: cloneVector3(sample.velocityUnit),
  };
}
