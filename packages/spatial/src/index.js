const EPSILON = 1e-9;
const DEFAULT_SAMPLE_STEP_SECS = 1 / 60;
const DEFAULT_SYNTHETIC_TARGET_DISTANCE_PC = 1;
const POSE_TRANSITION_VIEW_PATHS = new WeakMap();
const TRANSITION_LANE_INTERPOLATIONS = new Set([
  'hold',
  'linear',
  'smoothstep',
  'easeIn',
  'easeOut',
  'easeInOut',
  'slerp',
]);
const TIMING_PHASE_KINDS = new Set(['accelerate', 'cruise', 'decelerate', 'blend', 'hold']);
const TIMING_PROFILE_KINDS = new Set(['duration', 'constantSpeed', 'trapezoid', 'triangular', 'custom']);

export const SPATIAL_ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });
export const SPATIAL_LOCAL_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
export const SPATIAL_LOCAL_UP = Object.freeze({ x: 0, y: 1, z: 0 });
export const SPATIAL_LOCAL_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });
export const SPATIAL_IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const DEFAULT_SPATIAL_SCALE_PROFILE = Object.freeze({
  navigationUnits: 'pc',
  metersPerNavigationUnit: 1,
  worldUnitsPerNavigationUnit: 1,
});

export function normalizeSpatialVector3(input, fallback = SPATIAL_ZERO_VECTOR) {
  if (input == null) input = fallback;
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a spatial vector object.');
  }
  const value = input;
  if (![value.x, value.y, value.z].every((component) => typeof component === 'number')) {
    throw new TypeError('Spatial vector components must be numbers.');
  }
  const { x, y, z } = value;
  if (![x, y, z].every(Number.isFinite)) {
    throw new RangeError('Spatial vector components must be finite numbers.');
  }
  return { x, y, z };
}

export function normalizeSpatialQuaternion(input, fallback = SPATIAL_IDENTITY_QUATERNION) {
  if (input == null) input = fallback;
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a spatial quaternion object.');
  }
  const value = input;
  if (![value.x, value.y, value.z, value.w].every((component) => typeof component === 'number')) {
    throw new TypeError('Spatial quaternion components must be numbers.');
  }
  const { x, y, z, w } = value;
  if (![x, y, z, w].every(Number.isFinite)) {
    throw new RangeError('Spatial quaternion components must be finite numbers.');
  }
  const length = Math.hypot(x, y, z, w);
  if (!(length > 0)) {
    throw new RangeError('Spatial quaternion length must be greater than zero.');
  }
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

export function normalizeSpatialPose(input = {}) {
  if (input == null) input = {};
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a spatial pose object.');
  }
  if ('position' in input || 'orientation' in input) {
    throw new TypeError('SpatialPose uses observerPc and orientationIcrs.');
  }
  return {
    observerPc: normalizeSpatialVector3(input.observerPc, SPATIAL_ZERO_VECTOR),
    orientationIcrs: normalizeSpatialQuaternion(input.orientationIcrs, SPATIAL_IDENTITY_QUATERNION),
  };
}

export function normalizeSpatialScaleProfile(input = DEFAULT_SPATIAL_SCALE_PROFILE) {
  if (input == null) input = DEFAULT_SPATIAL_SCALE_PROFILE;
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a spatial scale profile object.');
  }
  if (input.navigationUnits !== undefined && typeof input.navigationUnits !== 'string') {
    throw new TypeError('navigationUnits must be a string.');
  }
  const metersPerNavigationUnit = input.metersPerNavigationUnit === undefined
    ? DEFAULT_SPATIAL_SCALE_PROFILE.metersPerNavigationUnit
    : positiveFiniteNumber(input.metersPerNavigationUnit, 'metersPerNavigationUnit');
  return {
    navigationUnits: input.navigationUnits ?? DEFAULT_SPATIAL_SCALE_PROFILE.navigationUnits,
    metersPerNavigationUnit,
    worldUnitsPerNavigationUnit: input.worldUnitsPerNavigationUnit === undefined
      ? metersPerNavigationUnit
      : positiveFiniteNumber(input.worldUnitsPerNavigationUnit, 'worldUnitsPerNavigationUnit'),
  };
}

export function cloneSpatialVector3(value) {
  return { x: value.x, y: value.y, z: value.z };
}

export function cloneSpatialQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

export function cloneSpatialPose(pose) {
  return {
    observerPc: cloneSpatialVector3(pose.observerPc),
    orientationIcrs: cloneSpatialQuaternion(pose.orientationIcrs),
  };
}

export function addSpatialVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtractSpatialVectors(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleSpatialVector(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

export function getSpatialVectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function normalizeSpatialDirection(vector) {
  const normalized = normalizeSpatialVector3(vector);
  const length = getSpatialVectorLength(normalized);
  return length > 0 ? scaleSpatialVector(normalized, 1 / length) : cloneSpatialVector3(SPATIAL_LOCAL_FORWARD);
}

export function isNonZeroSpatialVector(vector) {
  return getSpatialVectorLength(normalizeSpatialVector3(vector)) > 0;
}

export function multiplySpatialQuaternions(a, b) {
  return normalizeSpatialQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

export function createSpatialQuaternionFromAxisAngle(axis, angleRad) {
  const direction = normalizeDirectionOr(axis, SPATIAL_LOCAL_UP);
  const half = finiteNumber(angleRad, 0) * 0.5;
  const s = Math.sin(half);
  return normalizeSpatialQuaternion({
    x: direction.x * s,
    y: direction.y * s,
    z: direction.z * s,
    w: Math.cos(half),
  });
}

export function applySpatialQuaternion(vector, quaternion) {
  const x = vector.x;
  const y = vector.y;
  const z = vector.z;
  const qx = quaternion.x;
  const qy = quaternion.y;
  const qz = quaternion.z;
  const qw = quaternion.w;

  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;

  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

export function rotateSpatialLocalAxis(orientationIcrs, localAxis, angleRad) {
  if (!(Math.abs(finiteNumber(angleRad, 0)) > 0)) {
    return cloneSpatialQuaternion(orientationIcrs);
  }
  return multiplySpatialQuaternions(
    orientationIcrs,
    createSpatialQuaternionFromAxisAngle(localAxis, angleRad),
  );
}

export function raDecToIcrsDirection(input) {
  const decDeg = finiteNumber(input?.decDeg, Number.NaN);
  const raDeg = input?.raDeg !== undefined
    ? finiteNumber(input.raDeg, Number.NaN)
    : finiteNumber(input?.raHours, Number.NaN) * 15;
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null;
  const ra = degreesToRadians(raDeg);
  const dec = degreesToRadians(decDeg);
  const cosDec = Math.cos(dec);
  return {
    x: cosDec * Math.cos(ra),
    y: cosDec * Math.sin(ra),
    z: Math.sin(dec),
  };
}

export function raDecDistanceToIcrs(input) {
  const direction = raDecToIcrsDirection(input);
  const distancePc = positiveNumber(input?.distancePc, Number.NaN);
  return direction && Number.isFinite(distancePc)
    ? scaleSpatialVector(direction, distancePc)
    : null;
}

export function icrsToRaDec(positionPc, observerPc = SPATIAL_ZERO_VECTOR) {
  const position = normalizeSpatialVector3(positionPc);
  const observer = normalizeSpatialVector3(observerPc);
  const direction = subtractSpatialVectors(position, observer);
  const length = getSpatialVectorLength(direction);
  if (!(length > 0)) return null;
  const unit = scaleSpatialVector(direction, 1 / length);
  const raRawDeg = radiansToDegrees(Math.atan2(unit.y, unit.x));
  const raDeg = (raRawDeg + 360) % 360;
  const decDeg = radiansToDegrees(Math.asin(clamp(unit.z, -1, 1)));
  return { raDeg, raHours: raDeg / 15, decDeg };
}

export function icrsDirectionToTargetPc(directionIcrs, distancePc, observerPc = SPATIAL_ZERO_VECTOR) {
  const direction = normalizeDirectionOr(normalizeSpatialVector3(directionIcrs), null);
  const distance = positiveNumber(distancePc, Number.NaN);
  if (!direction || !Number.isFinite(distance)) return null;
  return addSpatialVectors(normalizeSpatialVector3(observerPc), scaleSpatialVector(direction, distance));
}

export function projectSpatialEquirectangular(input) {
  const width = positiveNumber(input?.width, 1);
  const height = positiveNumber(input?.height, 1);
  const raDeg = finiteNumber(input?.raDeg, 0);
  const decDeg = finiteNumber(input?.decDeg, 0);
  return {
    x: ((raDeg % 360) + 360) % 360 / 360 * width,
    y: (0.5 - clamp(decDeg, -90, 90) / 180) * height,
  };
}

export function normalizeSpatialTarget(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialTargetSpec object.');
  }
  if (input.kind === 'position') {
    return {
      kind: 'position',
      targetPc: normalizeSpatialVector3(input.targetPc),
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
    const distancePc = positiveFiniteNumber(input.distancePc, 'distancePc');
    return {
      kind: 'radec',
      ...(hasRaDeg ? { raDeg: ra } : { raHours: ra }),
      decDeg,
      distancePc,
      ...copySource(input),
    };
  }
  if (input.kind === 'bookmark') {
    if (typeof input.id !== 'string' || input.id.length === 0) {
      throw new TypeError('Bookmark targets require an id.');
    }
    return { kind: 'bookmark', id: input.id, ...copySource(input) };
  }
  throw new TypeError(`Unsupported spatial target kind: ${String(input.kind)}`);
}

export function resolveSpatialTarget(input, options = {}) {
  const target = normalizeSpatialTarget(input);
  if (target.kind === 'position') return cloneSpatialVector3(target.targetPc);
  if (target.kind === 'radec') return raDecDistanceToIcrs(target);
  const resolver = options.resolveBookmark;
  if (typeof resolver !== 'function') return null;
  const resolved = resolver(target.id, target);
  if (resolved && typeof resolved.then === 'function') {
    return resolved.then((value) => value ? resolveSpatialTarget(value, options) : null);
  }
  return resolved ? resolveSpatialTarget(resolved, options) : null;
}

export function normalizeSpatialAimSpec(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialAimSpec object.');
  }
  if (input.kind === 'target') {
    if (input.lock !== undefined && typeof input.lock !== 'boolean') {
      throw new TypeError('Target aim lock must be a boolean.');
    }
    return {
      kind: 'target',
      targetPc: normalizeSpatialVector3(input.targetPc),
      ...(input.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(input.upIcrs) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: finiteRequiredNumber(input.positionAngleDeg, 'positionAngleDeg') } : {}),
      ...(input.lock !== undefined ? { lock: input.lock } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'direction') {
    const forwardIcrs = normalizeSpatialVector3(input.forwardIcrs);
    if (!isNonZeroSpatialVector(forwardIcrs)) {
      throw new RangeError('Direction aim forwardIcrs must be non-zero.');
    }
    return {
      kind: 'direction',
      forwardIcrs: normalizeSpatialDirection(forwardIcrs),
      ...(input.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(input.upIcrs) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: finiteRequiredNumber(input.positionAngleDeg, 'positionAngleDeg') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'orientation') {
    return {
      kind: 'orientation',
      orientationIcrs: normalizeSpatialQuaternion(input.orientationIcrs),
      ...copySource(input),
    };
  }
  throw new TypeError(`Unsupported spatial aim kind: ${String(input.kind)}`);
}

export function evaluateSpatialAim(input) {
  const observerPc = normalizeSpatialVector3(input?.observerPc);
  const aim = normalizeSpatialAimSpec(input?.aim);
  const syntheticTargetDistancePc = positiveNumber(
    input?.syntheticTargetDistancePc,
    DEFAULT_SYNTHETIC_TARGET_DISTANCE_PC,
  );
  if (aim.kind === 'target') {
    const offset = subtractSpatialVectors(aim.targetPc, observerPc);
    const distancePc = getSpatialVectorLength(offset);
    const warnings = [];
    const forwardIcrs = distancePc > 0
      ? scaleSpatialVector(offset, 1 / distancePc)
      : cloneSpatialVector3(SPATIAL_LOCAL_FORWARD);
    if (!(distancePc > 0)) {
      warnings.push(warning('degenerateTargetAim', 'Target aim is at the observer position.'));
    }
    const upIcrs = resolveAimUp(forwardIcrs, aim.upIcrs, aim.positionAngleDeg, warnings);
    return {
      kind: 'target',
      targetPc: cloneSpatialVector3(aim.targetPc),
      forwardIcrs,
      upIcrs,
      orientationIcrs: quaternionFromForwardUp(forwardIcrs, upIcrs),
      distancePc,
      ...copySource(aim),
      diagnostics: { warnings },
    };
  }
  if (aim.kind === 'direction') {
    const warnings = [];
    const forwardIcrs = normalizeDirectionOr(aim.forwardIcrs, SPATIAL_LOCAL_FORWARD);
    const upIcrs = resolveAimUp(forwardIcrs, aim.upIcrs, aim.positionAngleDeg, warnings);
    return {
      kind: 'direction',
      forwardIcrs,
      upIcrs,
      orientationIcrs: quaternionFromForwardUp(forwardIcrs, upIcrs),
      syntheticTargetPc: addSpatialVectors(observerPc, scaleSpatialVector(forwardIcrs, syntheticTargetDistancePc)),
      syntheticTargetDistancePc,
      ...copySource(aim),
      diagnostics: { warnings },
    };
  }
  const orientationIcrs = normalizeSpatialQuaternion(aim.orientationIcrs);
  const forwardIcrs = normalizeDirectionOr(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, orientationIcrs), SPATIAL_LOCAL_FORWARD);
  const upIcrs = normalizeDirectionOr(applySpatialQuaternion(SPATIAL_LOCAL_UP, orientationIcrs), SPATIAL_LOCAL_UP);
  return {
    kind: 'orientation',
    forwardIcrs,
    upIcrs,
    orientationIcrs,
    syntheticTargetPc: addSpatialVectors(observerPc, scaleSpatialVector(forwardIcrs, syntheticTargetDistancePc)),
    syntheticTargetDistancePc,
    ...copySource(aim),
    diagnostics: { warnings: [] },
  };
}

export function normalizeSpatialDestination(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialDestinationSpec object.');
  }
  if (input.id !== undefined && typeof input.id !== 'string') {
    throw new TypeError('Destination id must be a string.');
  }
  if (input.label !== undefined && typeof input.label !== 'string') {
    throw new TypeError('Destination label must be a string.');
  }
  return {
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    centerPc: normalizeSpatialVector3(input.centerPc),
    ...(input.radiusPc !== undefined ? { radiusPc: nonNegativeFiniteNumber(input.radiusPc, 'radiusPc') } : {}),
    ...(input.boundsRadiusPc !== undefined ? { boundsRadiusPc: nonNegativeFiniteNumber(input.boundsRadiusPc, 'boundsRadiusPc') } : {}),
    ...(input.aim !== undefined ? { aim: normalizeSpatialAimSpec(input.aim) } : {}),
    ...(input.orbit !== undefined ? { orbit: normalizeSpatialOrbitSpec(input.orbit) } : {}),
    ...(input.dwellSecs !== undefined ? { dwellSecs: nonNegativeFiniteNumber(input.dwellSecs, 'dwellSecs') } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function normalizeSpatialOrbitSpec(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialOrbitSpec object.');
  }
  const radiusPc = positiveFiniteNumber(input.radiusPc, 'Orbit radiusPc');
  if (input.handedness !== undefined && input.handedness !== -1 && input.handedness !== 1) {
    throw new RangeError('Orbit handedness must be 1 or -1.');
  }
  return {
    centerPc: normalizeSpatialVector3(input.centerPc),
    radiusPc,
    ...(input.orbitNormal !== undefined ? { orbitNormal: normalizeSpatialVector3(input.orbitNormal) } : {}),
    ...(input.referenceAxis !== undefined ? { referenceAxis: normalizeSpatialVector3(input.referenceAxis) } : {}),
    ...(input.handedness !== undefined ? { handedness: input.handedness } : {}),
    ...(input.initialAngleRad !== undefined ? { initialAngleRad: finiteRequiredNumber(input.initialAngleRad, 'initialAngleRad') } : {}),
    ...(input.angularSpeedRadPerSec !== undefined ? { angularSpeedRadPerSec: finiteRequiredNumber(input.angularSpeedRadPerSec, 'angularSpeedRadPerSec') } : {}),
    ...(input.aim !== undefined ? { aim: normalizeSpatialAimSpec(input.aim) } : {}),
    ...copySource(input),
  };
}

export function createSpatialOrbitBasis(orbit) {
  const normalized = normalizeSpatialOrbitSpec(orbit);
  const warnings = [];
  const normal = normalizeDirectionOr(normalized.orbitNormal ?? SPATIAL_LOCAL_UP, SPATIAL_LOCAL_UP);
  let reference = normalized.referenceAxis
    ? normalizeDirectionOr(normalized.referenceAxis, SPATIAL_LOCAL_RIGHT)
    : cloneSpatialVector3(SPATIAL_LOCAL_RIGHT);
  reference = subtractSpatialVectors(reference, scaleSpatialVector(normal, dot(reference, normal)));
  if (getSpatialVectorLength(reference) <= EPSILON) {
    warnings.push(warning('orbitReferenceParallelToNormal', 'Orbit reference axis was parallel to orbit normal.'));
    reference = perpendicularTo(normal);
  }
  const radial = normalizeDirectionOr(reference, SPATIAL_LOCAL_RIGHT);
  const tangent = scaleSpatialVector(cross(normal, radial), normalized.handedness === -1 ? -1 : 1);
  return {
    centerPc: cloneSpatialVector3(normalized.centerPc),
    radiusPc: normalized.radiusPc,
    normal,
    radial,
    tangent: normalizeDirectionOr(tangent, SPATIAL_LOCAL_FORWARD),
    referenceAxis: radial,
    warnings,
  };
}

export function deriveSpatialOrbitAngle(input) {
  const centerPc = normalizeSpatialVector3(input?.centerPc);
  const positionPc = normalizeSpatialVector3(input?.positionPc);
  const basis = createSpatialOrbitBasis({
    centerPc,
    radiusPc: Math.max(getSpatialVectorLength(subtractSpatialVectors(positionPc, centerPc)), 1),
    ...(input?.orbitNormal !== undefined ? { orbitNormal: input.orbitNormal } : {}),
    ...(input?.referenceAxis !== undefined ? { referenceAxis: input.referenceAxis } : {}),
    ...(input?.handedness !== undefined ? { handedness: input.handedness } : {}),
  });
  const offset = subtractSpatialVectors(positionPc, centerPc);
  return Math.atan2(dot(offset, basis.tangent), dot(offset, basis.radial));
}

export function sampleSpatialOrbitPosition(orbitOrBasis, angleRad) {
  const basis = 'radial' in orbitOrBasis && 'tangent' in orbitOrBasis
    ? orbitOrBasis
    : createSpatialOrbitBasis(orbitOrBasis);
  const radial = scaleSpatialVector(basis.radial, Math.cos(angleRad));
  const tangent = scaleSpatialVector(basis.tangent, Math.sin(angleRad));
  return addSpatialVectors(
    basis.centerPc,
    scaleSpatialVector(addSpatialVectors(radial, tangent), basis.radiusPc),
  );
}

export function evaluateSpatialOrbit(orbit, elapsedSecs) {
  const normalized = normalizeSpatialOrbitSpec(orbit);
  const basis = createSpatialOrbitBasis(normalized);
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const angleRad = finiteNumber(normalized.initialAngleRad, 0)
    + finiteNumber(normalized.angularSpeedRadPerSec, 0) * elapsed;
  const positionPc = sampleSpatialOrbitPosition(basis, angleRad);
  const radial = normalizeDirectionOr(subtractSpatialVectors(positionPc, basis.centerPc), basis.radial);
  const tangent = normalizeDirectionOr(scaleSpatialVector(cross(basis.normal, radial), normalized.handedness === -1 ? -1 : 1), basis.tangent);
  const speedPcPerSec = Math.abs(finiteNumber(normalized.angularSpeedRadPerSec, 0)) * normalized.radiusPc;
  const velocityPcPerSec = scaleSpatialVector(tangent, speedPcPerSec * Math.sign(finiteNumber(normalized.angularSpeedRadPerSec, 0) || 1));
  const aim = evaluateSpatialAim({
    observerPc: positionPc,
    aim: normalized.aim ?? { kind: 'target', targetPc: normalized.centerPc },
  });
  return {
    elapsedSecs: elapsed,
    angleRad,
    positionPc,
    velocityPcPerSec,
    speedPcPerSec,
    radial,
    tangent,
    basis,
    aim,
  };
}

export function deriveSpatialOrbitHandoff(input) {
  const orbit = normalizeSpatialOrbitSpec(input?.orbit);
  const positionPc = normalizeSpatialVector3(input?.positionPc);
  const basis = createSpatialOrbitBasis(orbit);
  const angleRad = Math.atan2(
    dot(subtractSpatialVectors(positionPc, basis.centerPc), basis.tangent),
    dot(subtractSpatialVectors(positionPc, basis.centerPc), basis.radial),
  );
  return {
    orbit: { ...orbit, initialAngleRad: angleRad },
    basis,
    angleRad,
  };
}

export function normalizeSpatialTimingSpec(input) {
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
    return withTimingDurationConstraints(output, value);
  }
  if (input.kind === 'constantSpeed') {
    return {
      kind: 'constantSpeed',
      speedPcPerSec: nonNegativeFiniteNumber(value.speedPcPerSec, 'speedPcPerSec'),
      ...(value.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(value.durationSecs, 'durationSecs') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'trapezoid') {
    const output = {
      kind: 'trapezoid',
      ...(value.departureSpeedPcPerSec !== undefined ? { departureSpeedPcPerSec: nonNegativeFiniteNumber(value.departureSpeedPcPerSec, 'departureSpeedPcPerSec') } : {}),
      ...(value.cruiseSpeedPcPerSec !== undefined ? { cruiseSpeedPcPerSec: nonNegativeFiniteNumber(value.cruiseSpeedPcPerSec, 'cruiseSpeedPcPerSec') } : {}),
      ...(value.arrivalSpeedPcPerSec !== undefined ? { arrivalSpeedPcPerSec: nonNegativeFiniteNumber(value.arrivalSpeedPcPerSec, 'arrivalSpeedPcPerSec') } : {}),
      ...(value.accelerationPcPerSec2 !== undefined ? { accelerationPcPerSec2: positiveFiniteNumber(value.accelerationPcPerSec2, 'accelerationPcPerSec2') } : {}),
      ...(value.decelerationPcPerSec2 !== undefined ? { decelerationPcPerSec2: positiveFiniteNumber(value.decelerationPcPerSec2, 'decelerationPcPerSec2') } : {}),
      ...(value.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(value.durationSecs, 'durationSecs') } : {}),
      ...copySource(input),
    };
    return withTimingDurationConstraints(output, value);
  }
  if (input.kind === 'triangular') {
    return {
      kind: 'triangular',
      ...(value.departureSpeedPcPerSec !== undefined ? { departureSpeedPcPerSec: nonNegativeFiniteNumber(value.departureSpeedPcPerSec, 'departureSpeedPcPerSec') } : {}),
      ...(value.peakSpeedPcPerSec !== undefined ? { peakSpeedPcPerSec: nonNegativeFiniteNumber(value.peakSpeedPcPerSec, 'peakSpeedPcPerSec') } : {}),
      ...(value.arrivalSpeedPcPerSec !== undefined ? { arrivalSpeedPcPerSec: nonNegativeFiniteNumber(value.arrivalSpeedPcPerSec, 'arrivalSpeedPcPerSec') } : {}),
      ...(value.accelerationPcPerSec2 !== undefined ? { accelerationPcPerSec2: positiveFiniteNumber(value.accelerationPcPerSec2, 'accelerationPcPerSec2') } : {}),
      ...(value.decelerationPcPerSec2 !== undefined ? { decelerationPcPerSec2: positiveFiniteNumber(value.decelerationPcPerSec2, 'decelerationPcPerSec2') } : {}),
      ...(value.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(value.durationSecs, 'durationSecs') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'custom') {
    const durationSecs = nonNegativeFiniteNumber(value.durationSecs, 'durationSecs');
    return {
      kind: 'custom',
      durationSecs,
      phases: normalizeTimingPhases(value.phases, durationSecs),
      ...copySource(input),
    };
  }
  throw new TypeError(`Unsupported timing kind: ${String(input.kind)}`);
}

export function deriveSpatialOrbitalInsertTiming(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('deriveSpatialOrbitalInsertTiming() requires an input object.');
  }
  const distancePc = nonNegativeFiniteNumber(input.distancePc, 'distancePc');
  const orbitalSpeedPcPerSec = nonNegativeFiniteNumber(input.orbitalSpeedPcPerSec, 'orbitalSpeedPcPerSec');
  const currentSpeedPcPerSec = input.currentSpeedPcPerSec !== undefined
    ? nonNegativeFiniteNumber(input.currentSpeedPcPerSec, 'currentSpeedPcPerSec')
    : undefined;
  const approachSpeedPcPerSec = input.approachSpeedPcPerSec !== undefined
    ? nonNegativeFiniteNumber(input.approachSpeedPcPerSec, 'approachSpeedPcPerSec')
    : currentSpeedPcPerSec ?? orbitalSpeedPcPerSec;
  return deriveTimingProfile({
    kind: 'trapezoid',
    distancePc,
    durationSecs: input.durationSecs,
    minDurationSecs: input.minDurationSecs,
    maxDurationSecs: input.maxDurationSecs,
    departureSpeedPcPerSec: currentSpeedPcPerSec ?? approachSpeedPcPerSec,
    cruiseSpeedPcPerSec: approachSpeedPcPerSec,
    arrivalSpeedPcPerSec: orbitalSpeedPcPerSec,
    accelerationPcPerSec2: input.accelerationPcPerSec2,
    decelerationPcPerSec2: input.decelerationPcPerSec2,
  });
}

export function normalizeSpatialTravelSpec(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialTravelSpec object.');
  }
  if (!['polyline', 'orbitTransfer', 'orbitalInsert'].includes(input.kind)) {
    throw new TypeError(`Unsupported travel kind: ${String(input.kind)}`);
  }
  return {
    kind: input.kind,
    ...(input.timing !== undefined ? { timing: isTimingProfile(input.timing) ? normalizeTimingProfile(input.timing) : normalizeSpatialTimingSpec(input.timing) } : {}),
    ...(input.sampleStepSecs !== undefined ? { sampleStepSecs: positiveFiniteNumber(input.sampleStepSecs, 'sampleStepSecs') } : {}),
    ...(input.maxPoints !== undefined ? { maxPoints: positiveIntegerRequired(input.maxPoints, 'maxPoints') } : {}),
    ...copySource(input),
  };
}

export function deriveSpatialRouteTiming(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('deriveSpatialRouteTiming() requires an input object.');
  }
  const totalLengthPc = nonNegativeFiniteNumber(input.totalLengthPc, 'totalLengthPc');
  const timing = input?.travel?.timing;
  if (isTimingProfile(timing)) return cloneTimingProfileForDistance(timing, totalLengthPc);
  if (timing) {
    const spec = normalizeSpatialTimingSpec(timing);
    return deriveTimingProfile({
      ...spec,
      distancePc: totalLengthPc,
      ...(input.departureSpeedPcPerSec !== undefined
        ? { departureSpeedPcPerSec: input.departureSpeedPcPerSec }
        : {}),
      ...(input.arrivalSpeedPcPerSec !== undefined
        ? { arrivalSpeedPcPerSec: input.arrivalSpeedPcPerSec }
        : {}),
    });
  }
  return deriveTimingProfile({ kind: 'duration', durationSecs: totalLengthPc > 0 ? totalLengthPc : 0, distancePc: totalLengthPc });
}

export function normalizeSpatialRouteEndpointSpec(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialRouteEndpointSpec object.');
  }
  return {
    ...(input.positionPc !== undefined ? { positionPc: normalizeSpatialVector3(input.positionPc) } : {}),
    ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
    ...(input.orbit !== undefined ? { orbit: input.orbit == null ? null : normalizeSpatialOrbitSpec(input.orbit) } : {}),
    ...(input.aim !== undefined ? { aim: input.aim == null ? null : normalizeSpatialAimSpec(input.aim) } : {}),
    ...(input.velocityPcPerSec !== undefined ? { velocityPcPerSec: normalizeSpatialVector3(input.velocityPcPerSec) } : {}),
    ...(input.speedPcPerSec !== undefined ? { speedPcPerSec: nonNegativeFiniteNumber(input.speedPcPerSec, 'speedPcPerSec') } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function buildSpatialRouteEndpoint(input, options = {}) {
  if (isVectorLike(input)) {
    return endpointFromSpec({ positionPc: normalizeSpatialVector3(input) }, options);
  }
  const spec = isDestinationLike(input)
    ? { destination: normalizeSpatialDestination(input) }
    : normalizeSpatialRouteEndpointSpec(input);
  return endpointFromSpec(spec, options);
}

export function buildSpatialPolylineRoute(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('buildSpatialPolylineRoute() requires an input object.');
  }
  const pointsPc = Array.from(input.pointsPc ?? []).map((point) => normalizeSpatialVector3(point));
  if (pointsPc.length === 0) {
    throw new TypeError('Polyline routes require at least one point.');
  }
  const segments = buildRouteSegments(pointsPc);
  const totalLengthPc = segments.reduce((sum, segment) => sum + segment.lengthPc, 0);
  const travel = input.travel ? normalizeSpatialTravelSpec(input.travel) : { kind: 'polyline' };
  const timing = deriveSpatialRouteTiming({ totalLengthPc, travel });
  const departure = buildSpatialRouteEndpoint({ positionPc: pointsPc[0] }, { role: 'departure' });
  const arrival = buildSpatialRouteEndpoint({ positionPc: pointsPc[pointsPc.length - 1] }, { role: 'arrival' });
  const arrivalAction = input.arrivalAction === undefined
    ? undefined
    : input.arrivalAction === null ? null : normalizeSpatialArrivalAction(input.arrivalAction);
  return createRoute({
    kind: 'polyline',
    pointsPc,
    segments,
    totalLengthPc,
    timing,
    departure,
    arrival,
    ...(arrivalAction !== undefined ? { arrivalAction } : {}),
    diagnostics: routeDiagnostics(totalLengthPc, timing),
    ...copySource(input),
  });
}

export function buildSpatialOrbitTransferRoute(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected orbit transfer route input.');
  const from = buildSpatialRouteEndpoint(input.from, { role: 'departure', referencePose: input.referencePose });
  const to = buildSpatialRouteEndpoint(input.to, {
    role: 'arrival',
    referencePose: from ? { observerPc: from.positionPc, orientationIcrs: SPATIAL_IDENTITY_QUATERNION } : input.referencePose,
  });
  if (!from || !to) return null;
  const travel = input.travel ? normalizeSpatialTravelSpec(input.travel) : { kind: 'orbitTransfer' };
  const authoredTimingProfile = isTimingProfile(travel.timing) ? travel.timing : null;
  let geometry = createOrbitTransferGeometry(from, to, travel, authoredTimingProfile);
  let segments = buildRouteSegments(geometry.pointsPc);
  let totalLengthPc = segments.reduce((sum, segment) => sum + segment.lengthPc, 0);
  let timing = deriveSpatialRouteTiming({ totalLengthPc, travel, departureSpeedPcPerSec: from.speedPcPerSec, arrivalSpeedPcPerSec: to.speedPcPerSec });
  geometry = createOrbitTransferGeometry(from, to, travel, timing);
  segments = buildRouteSegments(geometry.pointsPc);
  totalLengthPc = segments.reduce((sum, segment) => sum + segment.lengthPc, 0);
  timing = deriveSpatialRouteTiming({ totalLengthPc, travel, departureSpeedPcPerSec: from.speedPcPerSec, arrivalSpeedPcPerSec: to.speedPcPerSec });
  const arrivalAction = input.arrivalAction !== undefined
    ? input.arrivalAction == null ? null : normalizeSpatialArrivalAction(input.arrivalAction)
    : to.orbit ? normalizeSpatialArrivalAction({
        kind: 'orbit',
        destination: to.destination,
        orbit: deriveSpatialOrbitHandoff({ positionPc: to.positionPc, orbit: to.orbit }).orbit,
        aim: to.aim ?? to.destination?.aim ?? to.orbit.aim ?? null,
      }) : null;
  return createRoute({
    kind: 'orbitTransfer',
    pointsPc: geometry.pointsPc,
    segments,
    totalLengthPc,
    timing,
    departure: from,
    arrival: to,
    arrivalAction,
    diagnostics: routeDiagnostics(totalLengthPc, timing, geometry.diagnostics),
    ...copySource(input),
  });
}

export function buildSpatialOrbitalInsertRoute(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected orbital insert route input.');
  const orbit = normalizeSpatialOrbitSpec(input.orbit);
  const from = buildSpatialRouteEndpoint(input.from, { role: 'departure', referencePose: input.referencePose });
  if (!from) return null;
  const insertion = deriveOrbitalInsertionSelection(from, orbit);
  const arrivalOrbit = { ...orbit, initialAngleRad: insertion.angleRad };
  const arrivalPosition = insertion.positionPc;
  const arrivalOrbitSample = evaluateSpatialOrbit(arrivalOrbit, 0);
  const arrival = buildSpatialRouteEndpoint({
    positionPc: arrivalPosition,
    destination: input.destination,
    orbit: arrivalOrbit,
    aim: orbit.aim ?? input.destination?.aim ?? null,
    velocityPcPerSec: arrivalOrbitSample.velocityPcPerSec,
    speedPcPerSec: arrivalOrbitSample.speedPcPerSec,
  }, { role: 'arrival' });
  const travel = input.travel ? normalizeSpatialTravelSpec(input.travel) : { kind: 'orbitalInsert' };
  const orbitalSpeedPcPerSec = arrivalOrbitSample.speedPcPerSec;
  const authoredTimingProfile = isTimingProfile(travel.timing) ? travel.timing : null;
  let geometry = createOrbitalInsertGeometry(from, arrival, arrivalOrbit, travel, authoredTimingProfile);
  let segments = buildRouteSegments(geometry.pointsPc);
  let totalLengthPc = segments.reduce((sum, segment) => sum + segment.lengthPc, 0);
  let timing = deriveOrbitalInsertRouteTiming({
    totalLengthPc,
    travel,
    from,
    orbitalSpeedPcPerSec,
  });
  geometry = createOrbitalInsertGeometry(from, arrival, arrivalOrbit, travel, timing);
  segments = buildRouteSegments(geometry.pointsPc);
  totalLengthPc = segments.reduce((sum, segment) => sum + segment.lengthPc, 0);
  timing = deriveOrbitalInsertRouteTiming({
    totalLengthPc,
    travel,
    from,
    orbitalSpeedPcPerSec,
  });
  return createRoute({
    kind: 'orbitalInsert',
    pointsPc: geometry.pointsPc,
    segments,
    totalLengthPc,
    timing,
    departure: from,
    arrival,
    arrivalAction: normalizeSpatialArrivalAction({
      kind: 'orbitalInsert',
      destination: input.destination,
      orbit: arrivalOrbit,
      timing,
    }),
    diagnostics: routeDiagnostics(totalLengthPc, timing, {
      settleBehavior: 'continueOrbit',
      ...geometry.diagnostics,
      insertionSelection: insertion.selection,
      insertionAngleRad: insertion.angleRad,
      insertionPositionPc: cloneSpatialVector3(insertion.positionPc),
      insertionPlaneOffsetPc: insertion.planeOffsetPc,
      ...(insertion.approachAlignment !== null
        ? { insertionApproachAlignment: insertion.approachAlignment }
        : {}),
      ...(insertion.departureVelocityAlignment !== null
        ? { insertionDepartureVelocityAlignment: insertion.departureVelocityAlignment }
        : {}),
      warnings: [...insertion.warnings, ...(geometry.diagnostics.warnings ?? [])],
    }),
    ...copySource(input),
  });
}

export function normalizeSpatialArrivalAction(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialArrivalAction object.');
  if (input.kind === 'none') return { kind: 'none' };
  if (input.kind === 'orbit') {
    if (input.preserveAim !== undefined && typeof input.preserveAim !== 'boolean') {
      throw new TypeError('preserveAim must be a boolean.');
    }
    return {
      kind: 'orbit',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
      orbit: normalizeSpatialOrbitSpec(input.orbit),
      ...(input.aim !== undefined ? { aim: input.aim == null ? null : normalizeSpatialAimSpec(input.aim) } : {}),
      ...(input.settleSecs !== undefined ? { settleSecs: nonNegativeFiniteNumber(input.settleSecs, 'settleSecs') } : {}),
      ...(input.preserveAim !== undefined ? { preserveAim: input.preserveAim } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'orbitalInsert') {
    return {
      kind: 'orbitalInsert',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
      orbit: normalizeSpatialOrbitSpec(input.orbit),
      ...(input.timing !== undefined ? { timing: normalizeTimingProfile(input.timing) } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'lookAt') {
    return {
      kind: 'lookAt',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
      aim: normalizeSpatialAimSpec(input.aim),
      ...(input.dwellSecs !== undefined ? { dwellSecs: nonNegativeFiniteNumber(input.dwellSecs, 'dwellSecs') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'lockAt') {
    const aim = normalizeSpatialAimSpec(input.aim);
    if (aim.kind !== 'target') throw new TypeError('lockAt arrival actions require target aim.');
    return {
      kind: 'lockAt',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
      aim,
      ...(input.dwellSecs !== undefined ? { dwellSecs: nonNegativeFiniteNumber(input.dwellSecs, 'dwellSecs') } : {}),
      ...copySource(input),
    };
  }
  throw new TypeError(`Unsupported arrival action kind: ${String(input.kind)}`);
}

export function getSpatialRouteDiagnostics(route) {
  return { ...route.diagnostics, warnings: [...(route.diagnostics?.warnings ?? [])] };
}

export function evaluateSpatialRoute(route, elapsedSecs, options = {}) {
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const duration = Math.max(0, route.timing?.durationSecs ?? route.diagnostics?.durationSecs ?? 0);
  const timingSample = evaluateTimingProfileAt(route.timing, elapsed);
  const distancePc = clamp(timingSample.distancePc, 0, route.totalLengthPc);
  const sample = sampleRouteAtDistance(route, distancePc, timingSample.speedPcPerSec);
  const complete = elapsed >= duration || timingTimeNearlyEqual(elapsed, duration);
  const endpointVelocity = complete
    ? sampleRouteEndpointVelocity(route.arrival)
    : elapsed === 0 ? sampleRouteEndpointVelocity(route.departure) : null;
  return {
    elapsedSecs: elapsed,
    ...(options.frameIndex !== undefined ? { frameIndex: options.frameIndex } : {}),
    ...(route.id !== undefined ? { routeId: route.id } : {}),
    routeKind: route.kind,
    positionPc: sample.positionPc,
    velocityPcPerSec: endpointVelocity?.velocityPcPerSec ?? sample.velocityPcPerSec,
    speedPcPerSec: endpointVelocity?.speedPcPerSec ?? sample.speedPcPerSec,
    distancePc,
    segmentIndex: sample.segmentIndex,
    complete,
    diagnostics: { warnings: [] },
  };
}

export function sampleSpatialRoute(route, options = {}) {
  const sampling = normalizeSpatialSamplingOptions(options);
  const duration = Math.max(0, route.timing?.durationSecs ?? route.diagnostics?.durationSecs ?? 0);
  const timeline = createSpatialSamplingTimeline(duration, sampling);
  const samples = timeline.times.map((timeSecs, frameIndex) => (
    evaluateSpatialRoute(route, timeSecs, { frameIndex })
  ));
  if (timeline.truncated) {
    addSamplingWarning(
      samples,
      warning('maxSamplesTruncatesRoute', 'maxSamples truncates route sampling before the end time.', {
        maxSamples: sampling.maxSamples,
        durationSecs: duration,
      }),
    );
  }
  return samples;
}

export function buildSpatialAimTrack(keys = [], options = {}) {
  const duplicateTimePolicy = normalizeDuplicateTimePolicy(options.duplicateTimePolicy);
  const normalizedKeys = normalizeAimKeys(keys, duplicateTimePolicy);
  const durationSecs = options.durationSecs !== undefined
    ? nonNegativeFiniteNumber(options.durationSecs, 'durationSecs')
    : normalizedKeys.length > 0
      ? normalizedKeys[normalizedKeys.length - 1].timeSecs
      : 0;
  assertKeysWithinDuration(normalizedKeys, durationSecs);
  const defaultInterpolation = options.defaultInterpolation === undefined
    ? undefined
    : normalizeSpatialAimInterpolationSpec(options.defaultInterpolation);
  return {
    keys: normalizedKeys,
    durationSecs,
    ...(defaultInterpolation !== undefined ? { defaultInterpolation } : {}),
    duplicateTimePolicy,
    diagnostics: { durationSecs, duplicateTimePolicy, warnings: [] },
  };
}

export function evaluateSpatialAimTrack(track, timeSecs, context = {}) {
  const keys = Array.isArray(track?.keys) ? track.keys : [];
  if (keys.length === 0) throw new TypeError('Aim tracks require at least one key.');
  const clampedTime = clamp(finiteNumber(timeSecs, 0), 0, Math.max(0, finiteNumber(track.durationSecs, 0)));
  const bracket = findTimedBracket(keys, clampedTime);
  const observerPc = context.observerPc ?? context.positionSample?.pose?.observerPc;
  const choice = selectAimInterpolation(bracket, track.defaultInterpolation);
  if (!observerPc && aimInterpolationRequiresObserver(bracket, choice.spec)) {
    throw new TypeError('Target aim track evaluation requires observerPc or positionSample.pose.observerPc.');
  }
  const interpolated = interpolateAim(bracket, choice, {
    observerPc: observerPc ?? SPATIAL_ZERO_VECTOR,
    fallbackUpIcrs: context.fallbackUpIcrs,
    syntheticTargetDistancePc: context.syntheticTargetDistancePc,
  });
  const sample = evaluateSpatialAim({
    observerPc: observerPc ?? SPATIAL_ZERO_VECTOR,
    aim: interpolated.aim,
    syntheticTargetDistancePc: context.syntheticTargetDistancePc,
  });
  const warnings = [
    ...interpolated.warnings,
    ...(sample.diagnostics?.warnings ?? []),
  ];
  const aimSample = {
    ...sample,
    diagnostics: { warnings },
  };
  return {
    timeSecs: clampedTime,
    aim: aimSample,
    segmentIndex: bracket.segmentIndex,
    ...(interpolated.sourceKey ? copySource(interpolated.sourceKey) : {}),
    diagnostics: { warnings },
  };
}

export function normalizeSpatialPathSpec(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialPathSpec object.');
  const duplicateTimePolicy = normalizeDuplicateTimePolicy(input.duplicateTimePolicy);
  const positionKeys = normalizePositionKeys(input.positionKeys, duplicateTimePolicy);
  if (positionKeys.length === 0) throw new TypeError('SpatialPathSpec.positionKeys must contain at least one key.');
  const aimKeys = input.aimKeys === undefined ? [] : normalizeAimKeys(input.aimKeys, duplicateTimePolicy);
  const durationSecs = input.durationSecs !== undefined
    ? nonNegativeFiniteNumber(input.durationSecs, 'durationSecs')
    : Math.max(positionKeys[positionKeys.length - 1].timeSecs, aimKeys[aimKeys.length - 1]?.timeSecs ?? 0);
  assertKeysWithinDuration(positionKeys, durationSecs);
  assertKeysWithinDuration(aimKeys, durationSecs);
  return {
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
  const normalized = normalizeSpatialPathSpec(path);
  const clampedTime = clamp(finiteNumber(timeSecs, 0), 0, normalized.durationSecs);
  const positionSample = evaluatePositionKeys(normalized.positionKeys, clampedTime);
  let aim = null;
  let orientationIcrs = cloneSpatialQuaternion(SPATIAL_IDENTITY_QUATERNION);
  if (normalized.aimKeys?.length > 0) {
    const track = buildSpatialAimTrack(normalized.aimKeys, {
      durationSecs: normalized.durationSecs,
      duplicateTimePolicy: normalized.duplicateTimePolicy,
    });
    const aimSample = evaluateSpatialAimTrack(track, clampedTime, {
      positionSample,
      syntheticTargetDistancePc: options.syntheticTargetDistancePc,
    });
    aim = aimSample.aim;
    orientationIcrs = cloneSpatialQuaternion(aim.orientationIcrs);
  }
  return {
    timeSecs: clampedTime,
    ...(options.frameIndex !== undefined ? { frameIndex: options.frameIndex } : {}),
    pose: {
      observerPc: positionSample.pose.observerPc,
      orientationIcrs,
    },
    aim,
    velocityPcPerSec: positionSample.velocityPcPerSec,
    speedPcPerSec: positionSample.speedPcPerSec,
    accelerationPcPerSec2: positionSample.accelerationPcPerSec2,
    accelerationMagnitudePcPerSec2: positionSample.accelerationMagnitudePcPerSec2,
    segmentIndex: positionSample.segmentIndex,
    segmentId: positionSample.segmentId,
    diagnostics: { warnings: [] },
  };
}

export function evaluateSpatialPathPlayback(path, elapsedSecs, options = {}) {
  const normalized = normalizeSpatialPathSpec(path);
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const timeSecs = remapPathTime(normalized, elapsed);
  const sample = evaluateSpatialPath(normalized, timeSecs, options);
  return { ...sample, playbackElapsedSecs: elapsed };
}

export function sampleSpatialPath(path, options = {}) {
  const normalized = normalizeSpatialPathSpec(path);
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
  const normalized = normalizeSpatialPathSpec(path);
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
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialViewTransitionSpec object.');
  return {
    from: normalizeSpatialFrameState(input.from),
    to: normalizeSpatialFrameState(input.to),
    ...(input.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(input.durationSecs, 'durationSecs') } : {}),
    ...(input.position !== undefined ? { position: normalizeTransitionLane(input.position) } : {}),
    ...(input.aim !== undefined ? { aim: normalizeTransitionLane(input.aim) } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function buildSpatialViewTransitionPath(spec, options = {}) {
  const normalized = normalizeSpatialViewTransitionSpec(spec);
  const warnings = [];
  const timing = resolveTransitionLaneTimings(normalized);
  const durationSecs = timing.durationSecs;
  const path = normalizeSpatialPathSpec({
    durationSecs,
    positionKeys: materializeTransitionPositionKeys({
      from: normalized.from.pose.observerPc,
      to: normalized.to.pose.observerPc,
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
  });
  const diagnostics = {
    durationSecs,
    positionDurationSecs: timing.position.durationSecs,
    aimDurationSecs: timing.aim.durationSecs,
    positionDelaySecs: timing.position.delaySecs,
    aimDelaySecs: timing.aim.delaySecs,
    pathDiagnostics: sampleSpatialPathDiagnostics(path, options),
    warnings,
  };
  return {
    kind: 'viewTransitionPath',
    durationSecs,
    path,
    from: normalized.from,
    to: normalized.to,
    diagnostics,
  };
}

export function evaluateSpatialViewTransition(transition, elapsedSecs) {
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const sample = evaluateSpatialPathPlayback(transition.path, elapsed);
  const positionEndSecs = transition.diagnostics.positionDelaySecs + transition.diagnostics.positionDurationSecs;
  const aimEndSecs = transition.diagnostics.aimDelaySecs + transition.diagnostics.aimDurationSecs;
  const complete = elapsed >= transition.durationSecs - EPSILON;
  const frameState = transitionFrameState(transition, sample, complete);
  return {
    elapsedSecs: elapsed,
    complete,
    positionComplete: elapsed >= positionEndSecs - EPSILON,
    aimComplete: elapsed >= aimEndSecs - EPSILON,
    frameState,
    pose: cloneSpatialPose(sample.pose),
    diagnostics: { warnings: [] },
  };
}

export function normalizeSpatialPoseTransitionSpec(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialPoseTransitionSpec object.');
  return {
    from: normalizeSpatialPose(input.from),
    to: normalizeSpatialPose(input.to),
    ...(input.durationSecs !== undefined ? { durationSecs: nonNegativeFiniteNumber(input.durationSecs, 'durationSecs') } : {}),
    ...(input.movement !== undefined ? { movement: normalizeTransitionLane(input.movement) } : {}),
    ...(input.orientation !== undefined ? { orientation: normalizeTransitionLane(input.orientation) } : {}),
  };
}

export function createSpatialPoseTransition(input) {
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
  return transition;
}

export function evaluateSpatialPoseTransition(transition, elapsedSecs) {
  const viewTransition = transition && typeof transition === 'object'
    ? POSE_TRANSITION_VIEW_PATHS.get(transition) ?? buildPoseTransitionViewPath(transition)
    : buildPoseTransitionViewPath(transition);
  const sample = evaluateSpatialViewTransition(viewTransition, elapsedSecs);
  return {
    elapsedSecs: sample.elapsedSecs,
    complete: sample.complete,
    movementComplete: sample.positionComplete,
    orientationComplete: sample.aimComplete,
    pose: cloneSpatialPose(sample.pose),
    diagnostics: sample.diagnostics,
  };
}

export function materializeSpatialPreloadHints(input, options = {}) {
  const samples = Array.isArray(input) ? input : sampleSpatialPath(input, options);
  const hints = [];
  const pathRadiusPc = options.pathRadiusPc !== undefined ? positiveNumber(options.pathRadiusPc, 0) : 0;
  const sphereRadiusPc = options.sphereRadiusPc !== undefined ? positiveNumber(options.sphereRadiusPc, 0) : 0;
  const lookaheadSecs = options.lookaheadSecs !== undefined ? positiveNumber(options.lookaheadSecs, 0) : 0;
  const priority = finiteNumber(options.priority, 0);
  if (pathRadiusPc > 0 && samples.length > 1) {
    hints.push({
      kind: 'pathVolume',
      pointsPc: samples.map((sample) => cloneSpatialVector3(sample.pose.observerPc)),
      radiusPc: pathRadiusPc,
      timeRangeSecs: [samples[0].timeSecs, samples[samples.length - 1].timeSecs],
      priority,
    });
  }
  if (sphereRadiusPc > 0) {
    for (const sample of samples) {
      hints.push({
        kind: 'sphereVolume',
        centerPc: cloneSpatialVector3(sample.pose.observerPc),
        radiusPc: sphereRadiusPc,
        timeRangeSecs: [sample.timeSecs, sample.timeSecs],
        priority,
      });
    }
  }
  if (lookaheadSecs > 0) {
    for (const sample of samples) {
      if (!(sample.speedPcPerSec > 0)) continue;
      hints.push({
        kind: 'viewLookahead',
        pose: cloneSpatialPose(sample.pose),
        velocityPcPerSec: cloneSpatialVector3(sample.velocityPcPerSec),
        lookaheadSecs,
        timeRangeSecs: [sample.timeSecs, sample.timeSecs + lookaheadSecs],
        priority,
      });
    }
  }
  return hints;
}

export function normalizeSpatialUpdateDelta(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected update delta input.');
  }
  if (!('deltaSecs' in input)) {
    throw new TypeError('deltaSecs is required.');
  }
  return nonNegativeFiniteNumber(input.deltaSecs, 'deltaSecs');
}

export function createDirectSpatialMotionModel(options = {}) {
  return createManualMotionModel(options, 'direct');
}

export function createInertialSpatialMotionModel(options = {}) {
  return createManualMotionModel(options, 'inertial');
}

export function createThrustSpatialMotionModel(options = {}) {
  return createManualMotionModel(options, 'thrust');
}

export function createSpatialNavigationAutomation() {
  let activeRoute = null;
  let activeOrbit = null;
  let activeAim = null;
  let targetLock = null;
  let elapsedSecs = 0;
  let frameState = normalizeSpatialFrameState({
    pose: { observerPc: SPATIAL_ZERO_VECTOR, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    aim: null,
  });
  let currentSpeedPcPerSec = 0;
  let lastManualLookActive = false;
  let orientationSuppressed = false;
  /** @type {{ action: Extract<import('./index.d.ts').SpatialArrivalAction, { kind: 'orbit' }>; positionPc: import('./index.d.ts').SpatialVector3; elapsedSecs: number; durationSecs: number } | null} */
  let pendingSettle = null;
  /** @type {{ elapsedSecs: number; durationSecs: number } | null} */
  let activeDwell = null;
  let disposed = false;

  return {
    flyRoute(route) {
      assertNavigationActive();
      activeRoute = route;
      activeOrbit = null;
      pendingSettle = null;
      elapsedSecs = 0;
    },
    orbit(orbit) {
      assertNavigationActive();
      activeOrbit = normalizeSpatialOrbitSpec(orbit);
      activeRoute = null;
      pendingSettle = null;
      elapsedSecs = 0;
      orientationSuppressed = false;
    },
    lookAt(aim) {
      assertNavigationActive();
      activeAim = normalizeSpatialAimSpec(aim);
      targetLock = null;
      activeDwell = null;
      orientationSuppressed = false;
    },
    lockAt(aim) {
      assertNavigationActive();
      const normalized = normalizeSpatialAimSpec(aim);
      if (normalized.kind !== 'target') throw new TypeError('lockAt() requires target aim.');
      activeAim = normalized;
      targetLock = { targetPc: cloneSpatialVector3(normalized.targetPc), aim: null };
      activeDwell = null;
      orientationSuppressed = false;
    },
    unlockAt() {
      assertNavigationActive();
      if (targetLock) {
        targetLock = null;
        activeAim = null;
        activeDwell = null;
      }
    },
    cancelMovement() {
      assertNavigationActive();
      cancelMovementState();
    },
    cancelOrientation() {
      assertNavigationActive();
      cancelOrientationState();
    },
    cancel() {
      assertNavigationActive();
      cancelMovementState();
      cancelOrientationState();
    },
    update(input) {
      assertNavigationActive();
      const dt = normalizeSpatialUpdateDelta(input);
      if (input.manualLookActive !== undefined && typeof input.manualLookActive !== 'boolean') {
        throw new TypeError('manualLookActive must be a boolean.');
      }
      const dwellAtStart = activeDwell;
      lastManualLookActive = input.manualLookActive === true;
      elapsedSecs += dt;
      let pose = normalizeSpatialPose(input.pose);
      let routeSample = null;
      let orbitSample = null;
      if (pendingSettle) {
        pendingSettle.elapsedSecs += dt;
        pose = { ...pose, observerPc: cloneSpatialVector3(pendingSettle.positionPc) };
        currentSpeedPcPerSec = 0;
        if (pendingSettle.elapsedSecs >= pendingSettle.durationSecs - EPSILON) {
          const action = pendingSettle.action;
          const arrivalPositionPc = pendingSettle.positionPc;
          const settleOverflowSecs = Math.max(0, pendingSettle.elapsedSecs - pendingSettle.durationSecs);
          activateArrivalAction(action, settleOverflowSecs, arrivalPositionPc);
        }
      }
      if (activeRoute) {
        const sample = evaluateSpatialRoute(activeRoute, elapsedSecs);
        routeSample = sample;
        pose = { ...pose, observerPc: sample.positionPc };
        currentSpeedPcPerSec = sample.speedPcPerSec;
        if (sample.complete) {
          const routeDurationSecs = Math.max(0, finiteNumber(
            activeRoute.timing?.durationSecs,
            activeRoute.diagnostics?.durationSecs ?? 0,
          ));
          const overshootSecs = Math.max(0, elapsedSecs - routeDurationSecs);
          applyArrivalAction(activeRoute.arrivalAction, overshootSecs);
          if (!activeOrbit) activeRoute = null;
        }
      }
      if (activeOrbit) {
        orbitSample = evaluateSpatialOrbit(activeOrbit, elapsedSecs);
        pose = { ...pose, observerPc: orbitSample.positionPc };
        currentSpeedPcPerSec = orbitSample.speedPcPerSec;
      }
      if (dwellAtStart && activeDwell === dwellAtStart) {
        activeDwell.elapsedSecs += dt;
        if (activeDwell.elapsedSecs >= activeDwell.durationSecs - EPSILON) {
          activeDwell = null;
          activeAim = null;
          targetLock = null;
        }
      }
      let aim = orbitSample && !orientationSuppressed ? orbitSample.aim : null;
      if (activeAim) {
        aim = evaluateSpatialAim({ observerPc: pose.observerPc, aim: activeAim });
      }
      if (aim && !lastManualLookActive) {
        pose = { ...pose, orientationIcrs: aim.orientationIcrs };
      }
      if (targetLock && aim?.kind === 'target') {
        targetLock = { targetPc: cloneSpatialVector3(aim.targetPc), aim };
      }
      frameState = {
        pose: cloneSpatialPose(pose),
        aim,
        targetLock,
        orbit: activeOrbit && orbitSample ? {
          orbit: activeOrbit,
          angleRad: orbitSample.angleRad,
          basis: orbitSample.basis,
          speedPcPerSec: orbitSample.speedPcPerSec,
        } : null,
        pathFollow: activeRoute && routeSample ? {
          routeId: activeRoute.id,
          routeKind: activeRoute.kind,
          distancePc: routeSample.distancePc,
          velocityPcPerSec: routeSample.velocityPcPerSec,
          speedPcPerSec: routeSample.speedPcPerSec,
          segmentIndex: routeSample.segmentIndex,
        } : null,
      };
      return cloneSpatialPose(pose);
    },
    getFrameState() {
      return cloneFrameState(frameState);
    },
    getDiagnostics() {
      return {
        activeMovement: activeRoute
          ? { kind: activeRoute.kind, route: activeRoute, distancePc: frameState.pathFollow?.distancePc ?? 0, totalLengthPc: activeRoute.totalLengthPc, speedPcPerSec: currentSpeedPcPerSec }
          : activeOrbit
            ? { kind: 'orbit', orbit: frameState.orbit, speedPcPerSec: currentSpeedPcPerSec }
            : { kind: 'idle', speedPcPerSec: 0 },
        activeAim: { aim: frameState.aim, targetLock, manualLookActive: lastManualLookActive },
        elapsedSecs,
        durationSecs: activeRoute?.timing?.durationSecs,
        frameState: cloneFrameState(frameState),
        activeRoute,
        activeTiming: activeRoute?.timing ?? null,
        currentSpeedPcPerSec,
        arrivalAction: activeRoute?.arrivalAction ?? pendingSettle?.action ?? null,
        pendingSettle: pendingSettle ? {
          behavior: 'continueOrbit',
          elapsedSecs: pendingSettle.elapsedSecs,
          durationSecs: pendingSettle.durationSecs,
          targetOrbit: pendingSettle.action.orbit,
        } : null,
        warnings: [],
      };
    },
    dispose() {
      disposed = true;
      activeRoute = null;
      activeOrbit = null;
      activeAim = null;
      targetLock = null;
      pendingSettle = null;
      activeDwell = null;
      currentSpeedPcPerSec = 0;
      lastManualLookActive = false;
    },
  };

  function assertNavigationActive() {
    if (disposed) throw new Error('Spatial navigation automation is disposed.');
  }

  function cancelMovementState() {
    activeRoute = null;
    activeOrbit = null;
    pendingSettle = null;
    elapsedSecs = 0;
    currentSpeedPcPerSec = 0;
    frameState = { ...frameState, orbit: null, pathFollow: null };
  }

  function cancelOrientationState() {
    activeAim = null;
    targetLock = null;
    activeDwell = null;
    orientationSuppressed = true;
    frameState = { ...frameState, aim: null, targetLock: null };
  }

  function applyArrivalAction(action, overshootSecs = 0) {
    if (!action || action.kind === 'none') return;
    const arrivalPositionPc = cloneSpatialVector3(activeRoute.arrival.positionPc);
    if (action.kind === 'orbit' && (action.settleSecs ?? 0) > overshootSecs + EPSILON) {
      pendingSettle = {
        action,
        positionPc: arrivalPositionPc,
        elapsedSecs: overshootSecs,
        durationSecs: action.settleSecs ?? 0,
      };
      activeRoute = null;
      activeOrbit = null;
      currentSpeedPcPerSec = 0;
      return;
    }
    const settleOverflowSecs = action.kind === 'orbit'
      ? Math.max(0, overshootSecs - (action.settleSecs ?? 0))
      : overshootSecs;
    activateArrivalAction(action, settleOverflowSecs, arrivalPositionPc);
  }

  /**
   * @param {Exclude<import('./index.d.ts').SpatialArrivalAction, { kind: 'none' }>} action
   * @param {number} overshootSecs
   * @param {import('./index.d.ts').SpatialVector3} arrivalPositionPc
   */
  function activateArrivalAction(action, overshootSecs, arrivalPositionPc) {
    pendingSettle = null;
    if (action.kind === 'orbit' || action.kind === 'orbitalInsert') {
      const handoff = deriveSpatialOrbitHandoff({
        positionPc: arrivalPositionPc,
        orbit: action.orbit,
      });
      activeOrbit = handoff.orbit;
      if (action.kind === 'orbit' && action.preserveAim === true) {
        // Preserve the independently authored orientation lane.
      } else {
        activeAim = (action.kind === 'orbit' ? action.aim : undefined) ?? action.orbit.aim ?? null;
        targetLock = null;
        activeDwell = null;
      }
      activeRoute = null;
      elapsedSecs = overshootSecs;
      orientationSuppressed = false;
      return;
    }
    if (action.kind === 'lookAt' || action.kind === 'lockAt') {
      activeAim = action.aim;
      targetLock = null;
      orientationSuppressed = false;
      if (action.kind === 'lockAt') {
        targetLock = { targetPc: cloneSpatialVector3(action.aim.targetPc), aim: null };
      }
      activeRoute = null;
      const dwellSecs = action.dwellSecs;
      if (dwellSecs !== undefined) {
        if (overshootSecs >= dwellSecs - EPSILON) {
          activeAim = null;
          targetLock = null;
          activeDwell = null;
        } else {
          activeDwell = { elapsedSecs: overshootSecs, durationSecs: dwellSecs };
        }
      } else {
        activeDwell = null;
      }
    }
  }
}

function createManualMotionModel(options, kind) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Spatial motion options must be an object.');
  }
  const moveSpeedPcPerSec = optionalPositiveMotionNumber(options, 'moveSpeedPcPerSec', 1);
  const boostMultiplier = optionalPositiveMotionNumber(options, 'boostMultiplier', 1);
  const moveAxisName = optionalMotionString(options, 'moveAxis', 'move');
  const attitudeAxisName = optionalMotionString(options, 'attitudeAxis', 'attitude');
  const rollModifierButton = optionalMotionString(options, 'rollModifierButton', 'rollModifier');
  const boostButton = optionalMotionString(options, 'boostButton', 'boost');
  const pitchRateRadPerSec = optionalPositiveMotionNumber(options, 'pitchRateRadPerSec', Math.PI / 3);
  const yawRateRadPerSec = optionalPositiveMotionNumber(options, 'yawRateRadPerSec', Math.PI / 3);
  const rollRateRadPerSec = optionalPositiveMotionNumber(options, 'rollRateRadPerSec', Math.PI / 3);
  const accelerationPcPerSec2 = kind === 'inertial'
    ? optionalPositiveMotionNumber(options, 'accelerationPcPerSec2', moveSpeedPcPerSec)
    : moveSpeedPcPerSec;
  const damping = kind === 'inertial'
    ? optionalNonNegativeMotionNumber(options, 'damping', 1)
    : 0;
  const thrustPcPerSec2 = kind === 'thrust'
    ? optionalPositiveMotionNumber(options, 'thrustPcPerSec2', moveSpeedPcPerSec)
    : moveSpeedPcPerSec;
  const mass = kind === 'thrust'
    ? optionalPositiveMotionNumber(options, 'mass', 1)
    : 1;
  const drag = kind === 'thrust'
    ? optionalNonNegativeMotionNumber(options, 'drag', 0)
    : 0;
  const maxSpeedPcPerSec = kind === 'direct'
    ? moveSpeedPcPerSec
    : optionalPositiveMotionNumber(options, 'maxSpeedPcPerSec', moveSpeedPcPerSec);
  let velocityPcPerSec = cloneSpatialVector3(SPATIAL_ZERO_VECTOR);
  let scale = normalizeSpatialScaleProfile();
  return {
    update(input) {
      const dt = normalizeSpatialUpdateDelta(input);
      scale = normalizeSpatialScaleProfile(input.scale);
      const controls = input.controls ?? {};
      const pose = normalizeSpatialPose(input.pose);
      const moveAxis = controls.getAxis?.(moveAxisName) ?? { x: 0, y: 0, magnitude: 0, active: false };
      const attitudeAxis = controls.getAxis?.(attitudeAxisName) ?? { x: 0, y: 0, magnitude: 0, active: false };
      const boosted = isSpatialControlPressed(controls, boostButton);
      const rollModifierActive = isSpatialControlPressed(controls, rollModifierButton);
      let orientationIcrs = pose.orientationIcrs;
      if (attitudeAxis.active) {
        orientationIcrs = rotateSpatialLocalAxis(orientationIcrs, SPATIAL_LOCAL_RIGHT, attitudeAxis.y * pitchRateRadPerSec * dt);
        orientationIcrs = rotateSpatialLocalAxis(
          orientationIcrs,
          rollModifierActive ? SPATIAL_LOCAL_FORWARD : SPATIAL_LOCAL_UP,
          attitudeAxis.x * (rollModifierActive ? rollRateRadPerSec : -yawRateRadPerSec) * dt,
        );
      }
      const roll = controls.getAxis?.('roll') ?? { x: 0, y: 0, magnitude: 0, active: false };
      if (roll.active) {
        orientationIcrs = rotateSpatialLocalAxis(orientationIcrs, SPATIAL_LOCAL_FORWARD, roll.x * rollRateRadPerSec * dt);
      }
      const move = addSpatialVectors(
        addSpatialVectors(
          scaleSpatialVector(applySpatialQuaternion(SPATIAL_LOCAL_RIGHT, orientationIcrs), finiteNumber(moveAxis.x, 0)),
          scaleSpatialVector(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, orientationIcrs), -finiteNumber(moveAxis.y, 0)),
        ),
        SPATIAL_ZERO_VECTOR,
      );
      const inputMagnitude = Math.min(1, getSpatialVectorLength(move));
      const boost = boosted ? boostMultiplier : 1;
      if (kind === 'direct') {
        velocityPcPerSec = inputMagnitude > EPSILON
          ? scaleSpatialVector(normalizeSpatialDirection(move), moveSpeedPcPerSec * boost * inputMagnitude)
          : cloneSpatialVector3(SPATIAL_ZERO_VECTOR);
      } else {
        if (inputMagnitude > EPSILON && dt > 0) {
          const acceleration = kind === 'thrust'
            ? thrustPcPerSec2 / mass
            : accelerationPcPerSec2;
          velocityPcPerSec = addSpatialVectors(
            velocityPcPerSec,
            scaleSpatialVector(
              normalizeSpatialDirection(move),
              acceleration * boost * inputMagnitude * dt,
            ),
          );
        }
        const resistance = kind === 'thrust' ? drag : inputMagnitude <= EPSILON ? damping : 0;
        if (resistance > 0 && dt > 0) {
          velocityPcPerSec = scaleSpatialVector(velocityPcPerSec, Math.exp(-resistance * dt));
        }
        velocityPcPerSec = clampSpatialVectorLength(
          velocityPcPerSec,
          maxSpeedPcPerSec,
        );
      }
      return {
        observerPc: addSpatialVectors(pose.observerPc, scaleSpatialVector(velocityPcPerSec, dt)),
        orientationIcrs,
      };
    },
    getSnapshot() {
      return {
        kind,
        velocityPcPerSec: cloneSpatialVector3(velocityPcPerSec),
        speedPcPerSec: getSpatialVectorLength(velocityPcPerSec),
        scale: { ...scale },
        activeAutomation: null,
      };
    },
    dispose() {},
  };
}

function optionalPositiveMotionNumber(options, field, fallback) {
  return options[field] === undefined
    ? fallback
    : positiveFiniteNumber(options[field], `Spatial motion ${field}`);
}

function optionalNonNegativeMotionNumber(options, field, fallback) {
  return options[field] === undefined
    ? fallback
    : nonNegativeFiniteNumber(options[field], `Spatial motion ${field}`);
}

function optionalMotionString(options, field, fallback) {
  if (options[field] === undefined) return fallback;
  if (typeof options[field] !== 'string' || options[field].length === 0) {
    throw new TypeError(`Spatial motion ${field} must be a non-empty string.`);
  }
  return options[field];
}

function isSpatialControlPressed(controls, name) {
  return controls.isPressed?.(name) === true || controls.getButton?.(name)?.pressed === true;
}

function clampSpatialVectorLength(vector, maxLength) {
  const length = getSpatialVectorLength(vector);
  return length > maxLength && length > 0
    ? scaleSpatialVector(vector, maxLength / length)
    : cloneSpatialVector3(vector);
}

function normalizeSpatialFrameState(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialFrameState object.');
  return {
    ...(input.timeSecs !== undefined ? { timeSecs: nonNegativeFiniteNumber(input.timeSecs, 'timeSecs') } : {}),
    ...(input.frameIndex !== undefined ? { frameIndex: nonNegativeIntegerRequired(input.frameIndex, 'frameIndex') } : {}),
    pose: normalizeSpatialPose(input.pose),
    aim: input.aim == null ? null : input.aim,
    ...(input.targetLock !== undefined ? { targetLock: input.targetLock } : {}),
    ...(input.orbit !== undefined ? { orbit: input.orbit } : {}),
    ...(input.pathFollow !== undefined ? { pathFollow: input.pathFollow } : {}),
    ...(input.fovDeg !== undefined ? { fovDeg: positiveFiniteNumber(input.fovDeg, 'fovDeg') } : {}),
  };
}

function endpointFromSpec(spec, options) {
  let positionPc = spec.positionPc ? cloneSpatialVector3(spec.positionPc) : null;
  let destination = spec.destination ?? null;
  const orbit = Object.prototype.hasOwnProperty.call(spec, 'orbit')
    ? spec.orbit
    : destination?.orbit ?? options.fallbackOrbit ?? null;
  if (!positionPc && orbit) {
    const basis = createSpatialOrbitBasis(orbit);
    positionPc = sampleSpatialOrbitPosition(basis, orbit.initialAngleRad ?? 0);
  }
  if (!positionPc && destination?.radiusPc !== undefined && options.referencePose) {
    const referencePose = normalizeSpatialPose(options.referencePose);
    const radial = normalizeDirectionOr(
      subtractSpatialVectors(referencePose.observerPc, destination.centerPc),
      SPATIAL_LOCAL_RIGHT,
    );
    positionPc = addSpatialVectors(destination.centerPc, scaleSpatialVector(radial, destination.radiusPc));
  }
  if (!positionPc && destination?.centerPc) return null;
  if (!positionPc) return null;
  const endpointOrbit = orbit ? normalizeSpatialOrbitSpec(orbit) : null;
  return {
    kind: destination ? 'destination' : endpointOrbit ? 'orbit' : 'point',
    positionPc,
    ...(destination ? { destination } : {}),
    ...(spec.velocityPcPerSec ? { velocityPcPerSec: cloneSpatialVector3(spec.velocityPcPerSec) } : {}),
    ...(spec.speedPcPerSec !== undefined ? { speedPcPerSec: spec.speedPcPerSec } : {}),
    ...(endpointOrbit ? { orbit: endpointOrbit, orbitBasis: createSpatialOrbitBasis(endpointOrbit) } : {}),
    ...(spec.aim !== undefined ? { aim: spec.aim } : destination?.aim ? { aim: destination.aim } : options.fallbackAim ? { aim: options.fallbackAim } : {}),
    ...copySource(spec),
    ...(spec.metadata ? { metadata: { ...spec.metadata } } : {}),
  };
}

function createRoute(route) {
  return {
    ...route,
    pointsPc: route.pointsPc.map(cloneSpatialVector3),
    segments: route.segments.map((segment) => ({ ...segment, startPc: cloneSpatialVector3(segment.startPc), endPc: cloneSpatialVector3(segment.endPc) })),
  };
}

function buildRouteSegments(pointsPc) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < pointsPc.length; index += 1) {
    const startPc = pointsPc[index - 1];
    const endPc = pointsPc[index];
    const lengthPc = getSpatialVectorLength(subtractSpatialVectors(endPc, startPc));
    if (lengthPc === 0) continue;
    segments.push({
      index: segments.length,
      startPc: cloneSpatialVector3(startPc),
      endPc: cloneSpatialVector3(endPc),
      lengthPc,
      cumulativeStartPc: total,
      cumulativeEndPc: total + lengthPc,
    });
    total += lengthPc;
  }
  return segments;
}

function interpolateRoutePoints(startPc, endPc, travel, timing = null, minimumPointCount = 2) {
  const distance = getSpatialVectorLength(subtractSpatialVectors(endPc, startPc));
  const pointCount = routePointCountForTravel(distance, travel, timing, minimumPointCount);
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    points.push(lerpVector(startPc, endPc, pointCount === 1 ? 1 : index / (pointCount - 1)));
  }
  return points;
}

function routePointCountForTravel(distancePc, travel, timing = null, minimumPointCount = 2) {
  const step = positiveNumber(travel.sampleStepSecs, 1);
  const maxPoints = positiveInteger(travel.maxPoints, 32);
  const sampleBasis = timing?.durationSecs > 0 ? timing.durationSecs : Math.max(distancePc, step);
  return Math.max(2, Math.min(maxPoints, Math.max(minimumPointCount, Math.ceil(sampleBasis / step) + 1)));
}

function createOrbitTransferGeometry(from, to, travel, timing) {
  const startPc = from.positionPc;
  const endPc = to.positionPc;
  const chord = subtractSpatialVectors(endPc, startPc);
  const distancePc = getSpatialVectorLength(chord);
  const fromOrbitFrame = from.orbit ? orbitFrameAtPosition(from.orbit, from.positionPc) : null;
  const toOrbitFrame = to.orbit ? orbitFrameAtPosition(to.orbit, to.positionPc) : null;
  if (!fromOrbitFrame && !toOrbitFrame) {
    return {
      pointsPc: interpolateRoutePoints(startPc, endPc, travel, timing),
      diagnostics: {
        warnings: [warning('linearOrbitTransferFallback', 'Orbit transfer used linear geometry because no endpoint orbit metadata was available.')],
      },
    };
  }
  const chordDirection = normalizeDirectionOr(chord, SPATIAL_LOCAL_FORWARD);
  const startTangent = normalizeDirectionOr(from.velocityPcPerSec, null)
    ?? fromOrbitFrame?.tangent
    ?? chordDirection;
  const endTangent = normalizeDirectionOr(to.velocityPcPerSec, null)
    ?? toOrbitFrame?.tangent
    ?? chordDirection;
  const pointsPc = sampleHermiteRoutePoints({
    startPc,
    endPc,
    startTangent,
    endTangent,
    travel,
    timing,
    minimumPointCount: 4,
  });
  const selectedFrame = toOrbitFrame ?? fromOrbitFrame;
  return {
    pointsPc,
    diagnostics: {
      ...(selectedFrame ? {
        selectedOrbitNormal: selectedFrame.basis.normal,
        selectedRadial: selectedFrame.radial,
        selectedTangent: selectedFrame.tangent,
      } : {}),
      warnings: [],
    },
  };
}

function deriveOrbitalInsertionSelection(from, orbit) {
  const basis = createSpatialOrbitBasis(orbit);
  const departureOffset = subtractSpatialVectors(from.positionPc, basis.centerPc);
  const planeOffsetPc = dot(departureOffset, basis.normal);
  const projectedOffset = subtractSpatialVectors(
    departureOffset,
    scaleSpatialVector(basis.normal, planeOffsetPc),
  );
  const projectedDistancePc = getSpatialVectorLength(projectedOffset);
  const axisScalePc = Math.max(orbit.radiusPc, getSpatialVectorLength(departureOffset));
  const axisTolerancePc = Number.EPSILON * 32 * axisScalePc;
  const onOrbitAxis = projectedDistancePc <= axisTolerancePc;
  const planeWarnings = orbitalInsertionPlaneWarnings(departureOffset, planeOffsetPc, orbit.radiusPc);

  if (orbit.initialAngleRad !== undefined) {
    return orbitalInsertionSelectionAtAngle({
      selection: 'explicitAngle',
      angleRad: orbit.initialAngleRad,
      from,
      orbit,
      planeOffsetPc,
      warnings: planeWarnings,
    });
  }

  if (!onOrbitAxis && projectedDistancePc >= orbit.radiusPc) {
    const projectedRadial = scaleSpatialVector(projectedOffset, 1 / projectedDistancePc);
    const projectedTangent = normalizeDirectionOr(
      cross(basis.normal, projectedRadial),
      basis.tangent,
    );
    const radialAlongDeparture = clamp(orbit.radiusPc / projectedDistancePc, 0, 1);
    const radialAlongTangent = Math.sqrt(Math.max(0, 1 - radialAlongDeparture ** 2));

    // Tangency is solved in the orbit plane. For an off-plane departure, the
    // actual Hermite route also sheds its plane-normal offset before handoff;
    // the selected contact still satisfies (T - projectedDeparture) dot
    // (T - center) = 0 and provides an exact signed orbital end tangent.
    const candidates = [1, -1].map((side) => {
      const contactRadial = normalizeDirectionOr(addSpatialVectors(
        scaleSpatialVector(projectedRadial, radialAlongDeparture),
        scaleSpatialVector(projectedTangent, side * radialAlongTangent),
      ), projectedRadial);
      const positionPc = addSpatialVectors(
        basis.centerPc,
        scaleSpatialVector(contactRadial, orbit.radiusPc),
      );
      const angleRad = Math.atan2(
        dot(contactRadial, basis.tangent),
        dot(contactRadial, basis.radial),
      );
      return orbitalInsertionCandidate({
        angleRad,
        positionPc,
        from,
        orbit,
      });
    });
    const firstApproachAlignment = candidates[0].approachAlignment ?? Number.NEGATIVE_INFINITY;
    const secondApproachAlignment = candidates[1].approachAlignment ?? Number.NEGATIVE_INFINITY;
    const firstDepartureAlignment = candidates[0].departureVelocityAlignment ?? Number.NEGATIVE_INFINITY;
    const secondDepartureAlignment = candidates[1].departureVelocityAlignment ?? Number.NEGATIVE_INFINITY;
    const selected = secondApproachAlignment > firstApproachAlignment
      || (secondApproachAlignment === firstApproachAlignment
        && secondDepartureAlignment > firstDepartureAlignment)
      ? candidates[1]
      : candidates[0];
    return {
      selection: 'tangent',
      angleRad: selected.angleRad,
      positionPc: selected.positionPc,
      approachAlignment: selected.approachAlignment,
      departureVelocityAlignment: selected.departureVelocityAlignment,
      planeOffsetPc,
      warnings: planeWarnings,
    };
  }

  const fallbackReason = onOrbitAxis ? 'onOrbitAxis' : 'insideOrbitRadius';
  const fallbackAngleRad = !onOrbitAxis
    ? Math.atan2(dot(projectedOffset, basis.tangent), dot(projectedOffset, basis.radial))
    : 0;
  return orbitalInsertionSelectionAtAngle({
    selection: 'nearestAngleFallback',
    angleRad: fallbackAngleRad,
    from,
    orbit,
    planeOffsetPc,
    warnings: [
      warning(
        'orbitalInsertTangentFallback',
        'A tangent orbital insertion contact is unavailable; the nearest orbit angle was selected.',
        {
          reason: fallbackReason,
          projectedDistancePc,
          radiusPc: orbit.radiusPc,
        },
      ),
      ...planeWarnings,
    ],
  });
}

function orbitalInsertionPlaneWarnings(departureOffset, planeOffsetPc, radiusPc) {
  const planeScalePc = Math.max(radiusPc, getSpatialVectorLength(departureOffset));
  const planeTolerancePc = Number.EPSILON * 32 * planeScalePc;
  return Math.abs(planeOffsetPc) > planeTolerancePc
    ? [warning(
        'orbitalInsertPlaneChange',
        'The orbital insertion route must shed the departure offset from the orbit plane before handoff.',
        {
          planeOffsetPc,
          absolutePlaneOffsetPc: Math.abs(planeOffsetPc),
        },
      )]
    : [];
}

function orbitalInsertionSelectionAtAngle(options) {
  const positionPc = sampleSpatialOrbitPosition(options.orbit, options.angleRad);
  const candidate = orbitalInsertionCandidate({
    angleRad: options.angleRad,
    positionPc,
    from: options.from,
    orbit: options.orbit,
  });
  return {
    selection: options.selection,
    angleRad: options.angleRad,
    positionPc,
    approachAlignment: candidate.approachAlignment,
    departureVelocityAlignment: candidate.departureVelocityAlignment,
    planeOffsetPc: options.planeOffsetPc,
    warnings: options.warnings,
  };
}

function orbitalInsertionCandidate(options) {
  const approachDirection = normalizeDirectionOr(
    subtractSpatialVectors(options.positionPc, options.from.positionPc),
    null,
  );
  const signedOrbitTangent = orbitFrameAtPosition(options.orbit, options.positionPc).tangent;
  const departureVelocityDirection = normalizeDirectionOr(options.from.velocityPcPerSec, null);
  return {
    angleRad: options.angleRad,
    positionPc: options.positionPc,
    approachAlignment: approachDirection ? dot(approachDirection, signedOrbitTangent) : null,
    departureVelocityAlignment: approachDirection && departureVelocityDirection
      ? dot(approachDirection, departureVelocityDirection)
      : null,
  };
}

function createOrbitalInsertGeometry(from, arrival, arrivalOrbit, travel, timing) {
  const startPc = from.positionPc;
  const endPc = arrival.positionPc;
  const chord = subtractSpatialVectors(endPc, startPc);
  const chordDirection = normalizeDirectionOr(chord, SPATIAL_LOCAL_FORWARD);
  const arrivalFrame = orbitFrameAtPosition(arrivalOrbit, endPc);
  const startTangent = normalizeDirectionOr(from.velocityPcPerSec, null) ?? chordDirection;
  const pointsPc = sampleHermiteRoutePoints({
    startPc,
    endPc,
    startTangent,
    endTangent: arrivalFrame.tangent,
    travel,
    timing,
    minimumPointCount: 4,
  });
  return {
    pointsPc,
    diagnostics: {
      selectedOrbitNormal: arrivalFrame.basis.normal,
      selectedRadial: arrivalFrame.radial,
      selectedTangent: arrivalFrame.tangent,
      warnings: [],
    },
  };
}

function sampleHermiteRoutePoints(options) {
  const distancePc = getSpatialVectorLength(subtractSpatialVectors(options.endPc, options.startPc));
  if (!(distancePc > 0)) return [cloneSpatialVector3(options.startPc), cloneSpatialVector3(options.endPc)];
  const pointCount = routePointCountForTravel(distancePc, options.travel, options.timing, options.minimumPointCount);
  const handleLength = distancePc * 0.55;
  const m0 = scaleSpatialVector(normalizeDirectionOr(options.startTangent, normalizeDirectionOr(subtractSpatialVectors(options.endPc, options.startPc), SPATIAL_LOCAL_FORWARD)), handleLength);
  const m1 = scaleSpatialVector(normalizeDirectionOr(options.endTangent, normalizeDirectionOr(subtractSpatialVectors(options.endPc, options.startPc), SPATIAL_LOCAL_FORWARD)), handleLength);
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    const u = pointCount === 1 ? 1 : index / (pointCount - 1);
    points.push(evaluateCubicHermiteVector(options.startPc, options.endPc, m0, m1, u));
  }
  points[0] = cloneSpatialVector3(options.startPc);
  points[points.length - 1] = cloneSpatialVector3(options.endPc);
  return points;
}

function orbitFrameAtPosition(orbit, positionPc) {
  const normalized = normalizeSpatialOrbitSpec(orbit);
  const basis = createSpatialOrbitBasis(normalized);
  const radial = normalizeDirectionOr(subtractSpatialVectors(positionPc, basis.centerPc), basis.radial);
  const tangentSign = (normalized.handedness === -1 ? -1 : 1) * Math.sign(finiteNumber(normalized.angularSpeedRadPerSec, 0) || 1);
  const tangent = normalizeDirectionOr(scaleSpatialVector(cross(basis.normal, radial), tangentSign), basis.tangent);
  return { basis, radial, tangent };
}

function evaluateCubicHermiteVector(startPc, endPc, startTangent, endTangent, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return combineSpatialVectors([
    [startPc, 2 * t3 - 3 * t2 + 1],
    [startTangent, t3 - 2 * t2 + t],
    [endPc, -2 * t3 + 3 * t2],
    [endTangent, t3 - t2],
  ]);
}

function deriveOrbitalInsertRouteTiming(input) {
  const timing = input.travel?.timing;
  if (isTimingProfile(timing)) return cloneTimingProfileForDistance(timing, input.totalLengthPc);
  if (timing?.kind === 'custom') {
    return deriveTimingProfile({ ...timing, distancePc: input.totalLengthPc });
  }
  const currentSpeedPcPerSec = timing?.departureSpeedPcPerSec ?? input.from.speedPcPerSec;
  const approachSpeedPcPerSec = timing?.speedPcPerSec
    ?? timing?.cruiseSpeedPcPerSec
    ?? timing?.peakSpeedPcPerSec;
  return deriveSpatialOrbitalInsertTiming({
    distancePc: input.totalLengthPc,
    orbitalSpeedPcPerSec: input.orbitalSpeedPcPerSec,
    currentSpeedPcPerSec,
    approachSpeedPcPerSec,
    durationSecs: timing?.durationSecs,
    accelerationPcPerSec2: timing?.accelerationPcPerSec2,
    decelerationPcPerSec2: timing?.decelerationPcPerSec2,
    minDurationSecs: timing?.minDurationSecs,
    maxDurationSecs: timing?.maxDurationSecs,
  });
}

function routeDiagnostics(totalLengthPc, timing, overrides = {}) {
  const averageSpeedPcPerSec = timing.durationSecs > 0 ? totalLengthPc / timing.durationSecs : 0;
  const overrideWarnings = Array.isArray(overrides.warnings) ? overrides.warnings : [];
  const { warnings: _warnings, ...rest } = overrides;
  return {
    durationSecs: timing.durationSecs,
    totalLengthPc,
    averageSpeedPcPerSec,
    peakSpeedPcPerSec: Math.max(averageSpeedPcPerSec, timing.peakSpeedPcPerSec ?? 0),
    departureSpeedPcPerSec: timing.departureSpeedPcPerSec ?? 0,
    arrivalSpeedPcPerSec: timing.arrivalSpeedPcPerSec ?? 0,
    ...rest,
    warnings: [...(timing.diagnostics?.warnings ?? []), ...overrideWarnings],
  };
}

function sampleRouteEndpointVelocity(endpoint) {
  if (!endpoint?.velocityPcPerSec) return null;
  const authoredVelocity = cloneSpatialVector3(endpoint.velocityPcPerSec);
  const authoredMagnitude = getSpatialVectorLength(authoredVelocity);
  if (!(authoredMagnitude > 0)) {
    return {
      velocityPcPerSec: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
      speedPcPerSec: 0,
    };
  }
  const speedPcPerSec = endpoint.speedPcPerSec ?? authoredMagnitude;
  return {
    velocityPcPerSec: scaleSpatialVector(authoredVelocity, speedPcPerSec / authoredMagnitude),
    speedPcPerSec,
  };
}

function sampleRouteAtDistance(route, distancePc, speedPcPerSec = null) {
  if (route.segments.length === 0) {
    return {
      positionPc: cloneSpatialVector3(route.pointsPc[0]),
      velocityPcPerSec: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
      speedPcPerSec: 0,
      segmentIndex: null,
    };
  }
  const clampedDistance = clamp(distancePc, 0, route.totalLengthPc);
  const segment = route.segments.find((candidate) => clampedDistance <= candidate.cumulativeEndPc)
    ?? route.segments[route.segments.length - 1];
  const localDistance = clamp(clampedDistance - segment.cumulativeStartPc, 0, segment.lengthPc);
  const t = segment.lengthPc > 0 ? localDistance / segment.lengthPc : 0;
  const direction = normalizeDirectionOr(subtractSpatialVectors(segment.endPc, segment.startPc), SPATIAL_ZERO_VECTOR);
  const speed = Math.max(0, finiteNumber(speedPcPerSec, route.timing.durationSecs > 0 ? route.totalLengthPc / route.timing.durationSecs : 0));
  return {
    positionPc: lerpVector(segment.startPc, segment.endPc, t),
    velocityPcPerSec: scaleSpatialVector(direction, speed),
    speedPcPerSec: speed,
    segmentIndex: segment.index,
  };
}

function deriveTimingProfile(input) {
  const distancePc = nonNegativeFiniteNumber(input?.distancePc, 'distancePc');
  const spec = normalizeSpatialTimingSpec(input);
  if (spec.kind === 'custom') return deriveCustomTimingProfile(spec, distancePc);
  if (spec.kind === 'constantSpeed') return deriveConstantSpeedTimingProfile(spec, distancePc);
  if (spec.kind === 'trapezoid' || spec.kind === 'triangular') {
    return deriveKinematicTimingProfile(spec, distancePc);
  }
  return deriveDurationTimingProfile(spec, distancePc);
}

function deriveDurationTimingProfile(spec, distancePc) {
  const diagnostics = createTimingDiagnostics(spec);
  const durationSecs = applyTimingDurationConstraints(spec.durationSecs, spec, diagnostics);
  if (distancePc > 0 && !(durationSecs > 0)) {
    throw new RangeError('Timing duration must be greater than zero for a non-zero route distance.');
  }
  const speedPcPerSec = durationSecs > 0 ? distancePc / durationSecs : 0;
  return createUniformTimingProfile('duration', distancePc, durationSecs, speedPcPerSec, diagnostics);
}

function deriveConstantSpeedTimingProfile(spec, distancePc) {
  const diagnostics = createTimingDiagnostics(spec);
  const requestedSpeed = Math.max(0, finiteNumber(spec.speedPcPerSec, 0));
  let durationSecs = spec.durationSecs !== undefined
    ? spec.durationSecs
    : requestedSpeed > 0
      ? distancePc / requestedSpeed
      : 0;
  if (spec.durationSecs !== undefined) {
    diagnostics.durationConstrainedProfile = true;
  }
  if (!(requestedSpeed > 0) && distancePc > 0 && spec.durationSecs === undefined) {
    throw new RangeError('Constant-speed timing requires positive speed for a non-zero route distance.');
  }
  durationSecs = applyTimingDurationConstraints(durationSecs, spec, diagnostics);
  if (distancePc > 0 && !(durationSecs > 0)) {
    throw new RangeError('Constant-speed timing duration must be greater than zero for a non-zero route distance.');
  }
  const speedPcPerSec = durationSecs > 0 ? distancePc / durationSecs : 0;
  if (spec.durationSecs !== undefined && requestedSpeed > 0 && !nearlyEqual(speedPcPerSec, requestedSpeed)) {
    diagnostics.warnings.push(warning('durationOverridesConstantSpeed', 'Timing duration changed the effective constant speed.', {
      requestedSpeedPcPerSec: requestedSpeed,
      effectiveSpeedPcPerSec: speedPcPerSec,
    }));
  }
  return createUniformTimingProfile('constantSpeed', distancePc, durationSecs, speedPcPerSec, diagnostics);
}

function deriveCustomTimingProfile(spec, distancePc) {
  const diagnostics = createTimingDiagnostics(spec);
  const phases = spec.phases.map((phase) => ({ ...phase }));
  const finalPhase = phases[phases.length - 1] ?? null;
  const finalDistance = finalPhase?.endDistancePc ?? 0;
  if (!timingDistanceNearlyEqual(finalDistance, distancePc)) {
    throw new RangeError('Custom timing phase distance must match route distancePc.');
  }
  return finalizeTimingProfile('custom', distancePc, phases, diagnostics);
}

function deriveKinematicTimingProfile(spec, distancePc) {
  const diagnostics = createTimingDiagnostics(spec);
  if (distancePc === 0) {
    const durationSecs = applyTimingDurationConstraints(spec.durationSecs ?? 0, spec, diagnostics);
    return completeKinematicTimingProfile(spec.kind, distancePc, createHoldPhases(durationSecs, 0), diagnostics, spec);
  }
  if (spec.durationSecs !== undefined) {
    return deriveDurationConstrainedKinematicProfile(spec, distancePc, spec.durationSecs, diagnostics);
  }
  const natural = deriveNaturalKinematicPhases(spec, distancePc, diagnostics);
  const naturalDuration = natural.phases[natural.phases.length - 1]?.endTimeSecs ?? 0;
  const constrainedDuration = applyTimingDurationConstraints(naturalDuration, spec, diagnostics);
  if (!nearlyEqual(constrainedDuration, naturalDuration)) {
    return deriveDurationConstrainedKinematicProfile(spec, distancePc, constrainedDuration, diagnostics);
  }
  return completeKinematicTimingProfile(natural.kind, distancePc, natural.phases, diagnostics, spec);
}

function deriveNaturalKinematicPhases(spec, distancePc, diagnostics) {
  const v0 = Math.max(0, finiteNumber(spec.departureSpeedPcPerSec, 0));
  const v1 = Math.max(0, finiteNumber(spec.arrivalSpeedPcPerSec, 0));
  const acceleration = positiveNumber(spec.accelerationPcPerSec2, 0);
  const deceleration = positiveNumber(spec.decelerationPcPerSec2, 0);
  if (acceleration > 0 && deceleration > 0) {
    return deriveTwoRateKinematicPhases(spec, distancePc, v0, v1, acceleration, deceleration, diagnostics);
  }
  if (deceleration > 0 && v0 > v1) {
    return deriveDecelerationOnlyPhases(distancePc, v0, v1, deceleration);
  }
  if (acceleration > 0 && v1 > v0) {
    return deriveAccelerationOnlyPhases(distancePc, v0, v1, acceleration);
  }
  diagnostics.warnings.push(warning('kinematicTimingMissingRate', 'Kinematic timing fell back to constant-speed timing because acceleration or deceleration was not usable.'));
  return { kind: spec.kind, phases: createEndpointBlendFallbackPhases(distancePc, v0, v1, spec) };
}

function deriveTwoRateKinematicPhases(spec, distancePc, v0, v1, acceleration, deceleration, diagnostics) {
  const endpointTransitionDistance = v0 > v1
    ? rampDistance(v1, v0, deceleration)
    : rampDistance(v0, v1, acceleration);
  if (endpointTransitionDistance > distancePc && !timingDistanceNearlyEqual(endpointTransitionDistance, distancePc)) {
    diagnostics.warnings.push(warning(
      'endpointRateFittedToDistance',
      'Requested endpoint speed change cannot fit within the route distance, so its rate was fitted.',
      { requestedTransitionDistancePc: endpointTransitionDistance, availableDistancePc: distancePc },
    ));
    return {
      kind: 'triangular',
      phases: createEndpointBlendFallbackPhases(distancePc, v0, v1, spec),
    };
  }
  const triangularPeak = solveTriangularPeakSpeed(distancePc, v0, v1, acceleration, deceleration);
  if (v0 === v1 && v0 > 0 && timingScalarNearlyEqual(triangularPeak, v0)) {
    return { kind: 'trapezoid', phases: createCruisePhases(distancePc / v0, distancePc, v0) };
  }
  let peakSpeedPcPerSec = triangularPeak;
  let kind = 'triangular';
  if (spec.kind === 'trapezoid' && spec.cruiseSpeedPcPerSec !== undefined) {
    const cruiseSpeedPcPerSec = Math.max(spec.cruiseSpeedPcPerSec, v0, v1);
    const cruiseDistance = rampDistance(v0, cruiseSpeedPcPerSec, acceleration)
      + rampDistance(v1, cruiseSpeedPcPerSec, deceleration);
    if (cruiseSpeedPcPerSec <= 0 && distancePc > 0) {
      diagnostics.warnings.push(warning('trapezoidCollapsedToTriangular', 'Requested cruise speed cannot cover a non-zero distance.'));
    } else if (cruiseDistance < distancePc || timingDistanceNearlyEqual(cruiseDistance, distancePc)) {
      peakSpeedPcPerSec = cruiseSpeedPcPerSec;
      kind = 'trapezoid';
    } else {
      diagnostics.warnings.push(warning('trapezoidCollapsedToTriangular', 'Requested cruise speed cannot be reached over this distance.'));
    }
  } else if (spec.kind === 'triangular' && spec.peakSpeedPcPerSec !== undefined) {
    const requestedPeak = Math.max(spec.peakSpeedPcPerSec, v0, v1);
    const requestedPeakDistance = rampDistance(v0, requestedPeak, acceleration)
      + rampDistance(v1, requestedPeak, deceleration);
    if (requestedPeakDistance < distancePc && !timingDistanceNearlyEqual(requestedPeakDistance, distancePc)) {
      peakSpeedPcPerSec = requestedPeak;
      kind = 'trapezoid';
      diagnostics.warnings.push(warning('triangularPeakRequiresCruise', 'Requested triangular peak is too low, so a cruise phase was inserted.'));
    } else if (requestedPeakDistance > distancePc && !timingDistanceNearlyEqual(requestedPeakDistance, distancePc)) {
      diagnostics.warnings.push(warning('triangularPeakFittedToDistance', 'Requested triangular peak is too high for this distance.'));
    } else {
      peakSpeedPcPerSec = requestedPeak;
    }
  }
  return buildKinematicPhasesForPeak(distancePc, v0, v1, peakSpeedPcPerSec, acceleration, deceleration, kind);
}

function deriveDecelerationOnlyPhases(distancePc, v0, v1, deceleration) {
  const decelDistance = rampDistance(v1, v0, deceleration);
  if (decelDistance < distancePc || timingDistanceNearlyEqual(decelDistance, distancePc)) {
    const phases = [];
    const cruiseDistance = timingDistanceNearlyEqual(decelDistance, distancePc)
      ? 0
      : Math.max(0, distancePc - decelDistance);
    if (cruiseDistance > 0) appendTimingPhase(phases, 'cruise', cruiseDistance / v0, v0, v0);
    appendTimingPhase(phases, 'decelerate', (v0 - v1) / deceleration, v0, v1);
    return { kind: cruiseDistance > 0 ? 'trapezoid' : 'triangular', phases };
  }
  const fittedDeceleration = (v0 * v0 - v1 * v1) / (2 * distancePc);
  const phases = [];
  appendTimingPhase(phases, 'decelerate', (v0 - v1) / fittedDeceleration, v0, v1);
  return { kind: 'triangular', phases };
}

function deriveAccelerationOnlyPhases(distancePc, v0, v1, acceleration) {
  const accelDistance = rampDistance(v0, v1, acceleration);
  if (accelDistance < distancePc || timingDistanceNearlyEqual(accelDistance, distancePc)) {
    const phases = [];
    appendTimingPhase(phases, 'accelerate', (v1 - v0) / acceleration, v0, v1);
    const cruiseDistance = timingDistanceNearlyEqual(accelDistance, distancePc)
      ? 0
      : Math.max(0, distancePc - accelDistance);
    if (cruiseDistance > 0) appendTimingPhase(phases, 'cruise', cruiseDistance / v1, v1, v1);
    return { kind: cruiseDistance > 0 ? 'trapezoid' : 'triangular', phases };
  }
  const fittedAcceleration = (v1 * v1 - v0 * v0) / (2 * distancePc);
  const phases = [];
  appendTimingPhase(phases, 'accelerate', (v1 - v0) / fittedAcceleration, v0, v1);
  return { kind: 'triangular', phases };
}

function buildKinematicPhasesForPeak(distancePc, v0, v1, peakSpeedPcPerSec, acceleration, deceleration, kind) {
  const phases = [];
  const peak = Math.max(peakSpeedPcPerSec, v0, v1);
  if (peak > v0) {
    appendTimingPhase(phases, 'accelerate', (peak - v0) / acceleration, v0, peak);
  }
  const accelDistance = rampDistance(v0, peak, acceleration);
  const decelDistance = rampDistance(v1, peak, deceleration);
  const rampTotalDistance = accelDistance + decelDistance;
  const cruiseDistance = timingDistanceNearlyEqual(rampTotalDistance, distancePc)
    ? 0
    : Math.max(0, distancePc - rampTotalDistance);
  if (cruiseDistance > 0) {
    appendTimingPhase(phases, 'cruise', cruiseDistance / peak, peak, peak);
    kind = 'trapezoid';
  }
  if (peak > v1) {
    appendTimingPhase(phases, 'decelerate', (peak - v1) / deceleration, peak, v1);
  }
  if (phases.length === 0) phases.push(...createCruisePhases(distancePc / peak, distancePc, peak));
  return { kind, phases };
}

function deriveDurationConstrainedKinematicProfile(spec, distancePc, requestedDurationSecs, diagnostics) {
  diagnostics.durationConstrainedProfile = true;
  const durationSecs = applyTimingDurationConstraints(requestedDurationSecs, spec, diagnostics);
  if (!(durationSecs > 0)) {
    throw new RangeError('Kinematic timing duration must be greater than zero for a non-zero route distance.');
  }
  const v0 = Math.max(0, finiteNumber(spec.departureSpeedPcPerSec, 0));
  const v1 = Math.max(0, finiteNumber(spec.arrivalSpeedPcPerSec, 0));
  const requestedPeak = Math.max(
    spec.cruiseSpeedPcPerSec ?? 0,
    spec.peakSpeedPcPerSec ?? 0,
    v0,
    v1,
    distancePc / durationSecs,
  );
  let ta = spec.accelerationPcPerSec2 !== undefined && requestedPeak > v0
    ? Math.min((requestedPeak - v0) / spec.accelerationPcPerSec2, durationSecs * 0.4)
    : durationSecs * 0.2;
  let td = spec.decelerationPcPerSec2 !== undefined && requestedPeak > v1
    ? Math.min((requestedPeak - v1) / spec.decelerationPcPerSec2, durationSecs * 0.4)
    : durationSecs * 0.2;
  const endpointDistancePc = 0.5 * (v0 * ta + v1 * td);
  if (endpointDistancePc >= distancePc && endpointDistancePc > 0) {
    const scale = (distancePc * 0.5) / endpointDistancePc;
    ta *= scale;
    td *= scale;
  }
  const cruiseEndSecs = durationSecs - td;
  const tc = Math.max(0, cruiseEndSecs - ta);
  const materializedTd = durationSecs - (ta + tc);
  const denominator = 0.5 * ta + tc + 0.5 * materializedTd;
  const endpointContributionPc = 0.5 * (v0 * ta + v1 * materializedTd);
  const peakSpeedPcPerSec = (distancePc - endpointContributionPc) / denominator;
  if (!Number.isFinite(peakSpeedPcPerSec) || peakSpeedPcPerSec < 0) {
    throw new RangeError('Unable to derive a non-negative timing speed for the requested duration and endpoint speeds.');
  }
  const phases = [];
  appendTimingPhase(phases, timingPhaseKind(v0, peakSpeedPcPerSec), ta, v0, peakSpeedPcPerSec);
  appendTimingPhase(phases, 'cruise', tc, peakSpeedPcPerSec, peakSpeedPcPerSec);
  appendTimingPhase(phases, timingPhaseKind(peakSpeedPcPerSec, v1), materializedTd, peakSpeedPcPerSec, v1);
  const kind = phases.some((phase) => phase.kind === 'cruise') && phases.some((phase) => phase.kind !== 'cruise')
    ? 'trapezoid'
    : spec.kind;
  return completeKinematicTimingProfile(kind, distancePc, phases, diagnostics, spec);
}

function createUniformTimingProfile(kind, distancePc, durationSecs, speedPcPerSec, diagnostics) {
  return finalizeTimingProfile(
    kind,
    distancePc,
    distancePc > 0 ? createCruisePhases(durationSecs, distancePc, speedPcPerSec) : createHoldPhases(durationSecs, 0),
    diagnostics,
  );
}

function createCruisePhases(durationSecs, distancePc, speedPcPerSec) {
  return [{
    kind: distancePc > 0 ? 'cruise' : 'hold',
    startTimeSecs: 0,
    endTimeSecs: durationSecs,
    startDistancePc: 0,
    endDistancePc: distancePc,
    startSpeedPcPerSec: speedPcPerSec,
    endSpeedPcPerSec: speedPcPerSec,
  }];
}

function createHoldPhases(durationSecs, distancePc) {
  return [{
    kind: 'hold',
    startTimeSecs: 0,
    endTimeSecs: durationSecs,
    startDistancePc: 0,
    endDistancePc: distancePc,
    startSpeedPcPerSec: 0,
    endSpeedPcPerSec: 0,
  }];
}

function createEndpointBlendFallbackPhases(distancePc, departureSpeedPcPerSec, arrivalSpeedPcPerSec, spec) {
  const averageEndpointSpeed = (departureSpeedPcPerSec + arrivalSpeedPcPerSec) * 0.5;
  if (averageEndpointSpeed > 0) {
    return [{
      kind: nearlyEqual(departureSpeedPcPerSec, arrivalSpeedPcPerSec) ? 'cruise' : 'blend',
      startTimeSecs: 0,
      endTimeSecs: distancePc / averageEndpointSpeed,
      startDistancePc: 0,
      endDistancePc: distancePc,
      startSpeedPcPerSec: departureSpeedPcPerSec,
      endSpeedPcPerSec: arrivalSpeedPcPerSec,
    }];
  }
  const fallbackSpeed = Math.max(spec.cruiseSpeedPcPerSec ?? 0, spec.peakSpeedPcPerSec ?? 0, distancePc);
  const durationSecs = fallbackSpeed > 0 ? distancePc / fallbackSpeed : 0;
  return createCruisePhases(durationSecs, distancePc, durationSecs > 0 ? distancePc / durationSecs : 0);
}

function appendTimingPhase(phases, kind, durationSecs, startSpeedPcPerSec, endSpeedPcPerSec) {
  if (!(durationSecs > 0)) return;
  const previous = phases[phases.length - 1];
  const startTimeSecs = previous?.endTimeSecs ?? 0;
  const startDistancePc = previous?.endDistancePc ?? 0;
  const endTimeSecs = startTimeSecs + durationSecs;
  const materializedDurationSecs = endTimeSecs - startTimeSecs;
  const endDistancePc = startDistancePc
    + (startSpeedPcPerSec + endSpeedPcPerSec) * 0.5 * materializedDurationSecs;
  phases.push({
    kind,
    startTimeSecs,
    endTimeSecs,
    startDistancePc,
    endDistancePc,
    startSpeedPcPerSec,
    endSpeedPcPerSec,
  });
}

function timingPhaseKind(startSpeedPcPerSec, endSpeedPcPerSec) {
  if (endSpeedPcPerSec > startSpeedPcPerSec) return 'accelerate';
  if (endSpeedPcPerSec < startSpeedPcPerSec) return 'decelerate';
  return 'cruise';
}

function completeKinematicTimingProfile(kind, distancePc, phases, diagnostics, spec) {
  const profile = finalizeTimingProfile(kind, distancePc, phases, diagnostics);
  markRequestedRateApplication(profile, spec, diagnostics);
  return profile;
}

function finalizeTimingProfile(kind, distancePc, phases, diagnostics) {
  const normalizedPhases = phases.length > 0 ? phases : createHoldPhases(0, distancePc);
  const durationSecs = normalizedPhases[normalizedPhases.length - 1]?.endTimeSecs ?? 0;
  const validatedPhases = normalizeTimingPhases(normalizedPhases, durationSecs);
  const finalDistancePc = validatedPhases[validatedPhases.length - 1]?.endDistancePc ?? 0;
  if (!timingDistanceNearlyEqual(finalDistancePc, distancePc)) {
    throw new RangeError('Derived timing phase distance must match distancePc.');
  }
  const departureSpeedPcPerSec = validatedPhases[0]?.startSpeedPcPerSec ?? 0;
  const arrivalSpeedPcPerSec = validatedPhases[validatedPhases.length - 1]?.endSpeedPcPerSec ?? 0;
  const peakSpeedPcPerSec = validatedPhases.reduce((peak, phase) => Math.max(peak, phase.startSpeedPcPerSec, phase.endSpeedPcPerSec), 0);
  let accelerationPcPerSec2 = 0;
  let decelerationPcPerSec2 = 0;
  for (const phase of validatedPhases) {
    const duration = phase.endTimeSecs - phase.startTimeSecs;
    if (!(duration > 0)) continue;
    const rate = (phase.endSpeedPcPerSec - phase.startSpeedPcPerSec) / duration;
    if (rate > accelerationPcPerSec2) accelerationPcPerSec2 = rate;
    if (-rate > decelerationPcPerSec2) decelerationPcPerSec2 = -rate;
  }
  return {
    kind,
    durationSecs,
    distancePc,
    departureSpeedPcPerSec,
    cruiseSpeedPcPerSec: peakSpeedPcPerSec,
    arrivalSpeedPcPerSec,
    peakSpeedPcPerSec,
    ...(accelerationPcPerSec2 > 0 ? { accelerationPcPerSec2 } : {}),
    ...(decelerationPcPerSec2 > 0 ? { decelerationPcPerSec2 } : {}),
    phases: validatedPhases,
    diagnostics,
  };
}

function markRequestedRateApplication(profile, spec, diagnostics) {
  if (spec.accelerationPcPerSec2 !== undefined) {
    const hasAccelerationPhase = profile.phases.some((phase) => phase.endSpeedPcPerSec > phase.startSpeedPcPerSec);
    const applied = hasAccelerationPhase && nearlyEqual(profile.accelerationPcPerSec2 ?? 0, spec.accelerationPcPerSec2);
    diagnostics.requestedAccelerationApplied = applied;
    if (!hasAccelerationPhase) {
      diagnostics.warnings.push(warning('requestedAccelerationIgnored', 'Requested acceleration was not used by the derived timing profile.', {
        requestedAccelerationPcPerSec2: spec.accelerationPcPerSec2,
      }));
    } else if (!applied) {
      diagnostics.warnings.push(warning('requestedAccelerationFitted', 'Requested acceleration was fitted to satisfy route duration and distance.', {
        requestedAccelerationPcPerSec2: spec.accelerationPcPerSec2,
        effectiveAccelerationPcPerSec2: profile.accelerationPcPerSec2 ?? 0,
      }));
    }
  }
  if (spec.decelerationPcPerSec2 !== undefined) {
    const hasDecelerationPhase = profile.phases.some((phase) => phase.endSpeedPcPerSec < phase.startSpeedPcPerSec);
    const applied = hasDecelerationPhase && nearlyEqual(profile.decelerationPcPerSec2 ?? 0, spec.decelerationPcPerSec2);
    diagnostics.requestedDecelerationApplied = applied;
    if (!hasDecelerationPhase) {
      diagnostics.warnings.push(warning('requestedDecelerationIgnored', 'Requested deceleration was not used by the derived timing profile.', {
        requestedDecelerationPcPerSec2: spec.decelerationPcPerSec2,
      }));
    } else if (!applied) {
      diagnostics.warnings.push(warning('requestedDecelerationFitted', 'Requested deceleration was fitted to satisfy route duration and distance.', {
        requestedDecelerationPcPerSec2: spec.decelerationPcPerSec2,
        effectiveDecelerationPcPerSec2: profile.decelerationPcPerSec2 ?? 0,
      }));
    }
  }
}

function createTimingDiagnostics(spec) {
  return {
    ...(spec.durationSecs !== undefined ? { requestedDurationSecs: spec.durationSecs } : {}),
    ...(spec.accelerationPcPerSec2 !== undefined ? { requestedAccelerationPcPerSec2: spec.accelerationPcPerSec2 } : {}),
    ...(spec.decelerationPcPerSec2 !== undefined ? { requestedDecelerationPcPerSec2: spec.decelerationPcPerSec2 } : {}),
    warnings: [],
  };
}

function applyTimingDurationConstraints(durationSecs, spec, diagnostics) {
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

function solveTriangularPeakSpeed(distancePc, v0, v1, acceleration, deceleration) {
  const numerator = distancePc + (v0 * v0) / (2 * acceleration) + (v1 * v1) / (2 * deceleration);
  const denominator = 1 / (2 * acceleration) + 1 / (2 * deceleration);
  return Math.sqrt(Math.max(v0 * v0, v1 * v1, numerator / denominator));
}

function rampDistance(lowSpeedPcPerSec, highSpeedPcPerSec, ratePcPerSec2) {
  const delta = highSpeedPcPerSec * highSpeedPcPerSec - lowSpeedPcPerSec * lowSpeedPcPerSec;
  return delta > 0 && ratePcPerSec2 > 0 ? delta / (2 * ratePcPerSec2) : 0;
}

function evaluateTimingProfileAt(profile, elapsedSecs) {
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const phases = Array.isArray(profile?.phases) ? profile.phases : [];
  if (phases.length === 0) {
    const durationSecs = Math.max(0, finiteNumber(profile?.durationSecs, 0));
    const distancePc = Math.max(0, finiteNumber(profile?.distancePc, 0));
    const t = durationSecs > 0 ? clamp(elapsed / durationSecs, 0, 1) : 1;
    const speedPcPerSec = durationSecs > 0 ? distancePc / durationSecs : 0;
    return { distancePc: distancePc * t, speedPcPerSec };
  }
  if (elapsed <= phases[0].startTimeSecs || timingTimeNearlyEqual(elapsed, phases[0].startTimeSecs)) {
    return { distancePc: phases[0].startDistancePc, speedPcPerSec: phases[0].startSpeedPcPerSec };
  }
  for (const phase of phases) {
    if (elapsed <= phase.endTimeSecs || timingTimeNearlyEqual(elapsed, phase.endTimeSecs)) {
      const phaseDuration = phase.endTimeSecs - phase.startTimeSecs;
      if (!(phaseDuration > 0)) {
        return { distancePc: phase.endDistancePc, speedPcPerSec: phase.endSpeedPcPerSec };
      }
      const localTime = clamp(elapsed - phase.startTimeSecs, 0, phaseDuration);
      const acceleration = (phase.endSpeedPcPerSec - phase.startSpeedPcPerSec) / phaseDuration;
      return {
        distancePc: phase.startDistancePc + phase.startSpeedPcPerSec * localTime + 0.5 * acceleration * localTime * localTime,
        speedPcPerSec: Math.max(0, phase.startSpeedPcPerSec + acceleration * localTime),
      };
    }
  }
  const last = phases[phases.length - 1];
  return { distancePc: last.endDistancePc, speedPcPerSec: last.endSpeedPcPerSec };
}

function isTimingProfile(input) {
  return Boolean(
    input
    && typeof input === 'object'
    && Array.isArray(input.phases)
    && Number.isFinite(input.durationSecs)
    && input.diagnostics
    && typeof input.diagnostics === 'object',
  );
}

function cloneTimingProfileForDistance(profile, distancePc) {
  return normalizeTimingProfile(profile, distancePc);
}

function normalizeTimingProfile(profile, expectedDistancePc = undefined) {
  if (!profile || typeof profile !== 'object') {
    throw new TypeError('Expected a SpatialTimingProfile object.');
  }
  if (!TIMING_PROFILE_KINDS.has(profile.kind)) {
    throw new TypeError(`Unsupported timing profile kind: ${String(profile.kind)}`);
  }
  const durationSecs = nonNegativeFiniteNumber(profile.durationSecs, 'SpatialTimingProfile.durationSecs');
  const phases = normalizeTimingPhases(profile.phases, durationSecs);
  const finalDistancePc = phases[phases.length - 1]?.endDistancePc ?? 0;
  if (expectedDistancePc !== undefined && !timingDistanceNearlyEqual(finalDistancePc, expectedDistancePc)) {
    throw new RangeError('SpatialTimingProfile final phase distance must match route totalLengthPc.');
  }
  if (profile.distancePc !== undefined) {
    const declaredDistancePc = nonNegativeFiniteNumber(profile.distancePc, 'SpatialTimingProfile.distancePc');
    if (!timingDistanceNearlyEqual(declaredDistancePc, finalDistancePc)) {
      throw new RangeError('SpatialTimingProfile distancePc must match its final phase distance.');
    }
  }
  const departureSpeedPcPerSec = phases[0]?.startSpeedPcPerSec ?? 0;
  const arrivalSpeedPcPerSec = phases[phases.length - 1]?.endSpeedPcPerSec ?? 0;
  const peakSpeedPcPerSec = phases.reduce(
    (peak, phase) => Math.max(peak, phase.startSpeedPcPerSec, phase.endSpeedPcPerSec),
    0,
  );
  let accelerationPcPerSec2 = 0;
  let decelerationPcPerSec2 = 0;
  for (const phase of phases) {
    const phaseDurationSecs = phase.endTimeSecs - phase.startTimeSecs;
    if (!(phaseDurationSecs > 0)) continue;
    const ratePcPerSec2 = (phase.endSpeedPcPerSec - phase.startSpeedPcPerSec) / phaseDurationSecs;
    accelerationPcPerSec2 = Math.max(accelerationPcPerSec2, ratePcPerSec2);
    decelerationPcPerSec2 = Math.max(decelerationPcPerSec2, -ratePcPerSec2);
  }
  const summary = {
    departureSpeedPcPerSec,
    cruiseSpeedPcPerSec: peakSpeedPcPerSec,
    arrivalSpeedPcPerSec,
    peakSpeedPcPerSec,
    accelerationPcPerSec2,
    decelerationPcPerSec2,
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
    kind: profile.kind,
    durationSecs,
    distancePc: finalDistancePc,
    departureSpeedPcPerSec,
    cruiseSpeedPcPerSec: peakSpeedPcPerSec,
    arrivalSpeedPcPerSec,
    peakSpeedPcPerSec,
    ...(accelerationPcPerSec2 > 0 ? { accelerationPcPerSec2 } : {}),
    ...(decelerationPcPerSec2 > 0 ? { decelerationPcPerSec2 } : {}),
    phases,
    diagnostics: {
      ...profile.diagnostics,
      warnings: profile.diagnostics.warnings.map((entry) => (
        entry && typeof entry === 'object' ? { ...entry } : entry
      )),
    },
  };
}

function normalizeSpatialTimeRemap(input, pathDurationSecs) {
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

function normalizeSpatialSamplingOptions(input = {}) {
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
  if (frameRateStep != null && Math.abs(frameRateStep - sampleStepSecs) > 1e-9) {
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

function createSpatialSamplingTimeline(durationSecs, sampling) {
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

function spatialSamplingWouldTruncate(durationSecs, sampling) {
  const duration = nonNegativeFiniteNumber(durationSecs, 'sampling durationSecs');
  return createSpatialSamplingPlan(duration, sampling.sampleStepSecs).requiredSamples > sampling.maxSamples;
}

function createSpatialSamplingPlan(durationSecs, sampleStepSecs) {
  if (durationSecs === 0) {
    return { endpointSampleIndex: 0, requiredSamples: 1 };
  }
  const quotient = durationSecs / sampleStepSecs;
  const gridIndex = Math.floor(quotient);
  const gridTimeSecs = gridIndex * sampleStepSecs;
  const endpointOnGrid = gridIndex > 0
    && Number.isFinite(gridTimeSecs)
    && nearlyEqual(gridTimeSecs, durationSecs, 1e-12);
  const endpointSampleIndex = endpointOnGrid ? gridIndex : gridIndex + 1;
  return {
    endpointSampleIndex,
    requiredSamples: endpointSampleIndex + 1,
  };
}

function addSamplingWarning(samples, diagnosticWarning) {
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

function normalizePositionKeys(keys, duplicateTimePolicy) {
  const normalized = Array.from(keys ?? []).map((key, index) => ({
    id: String(key?.id ?? `position-${index}`),
    timeSecs: finiteTime(key?.timeSecs),
    positionPc: normalizeSpatialVector3(key?.positionPc),
    interpolation: normalizeSpatialPositionInterpolation(key?.interpolation ?? { kind: 'linear' }),
    ...copySource(key ?? {}),
    ...(key?.metadata && typeof key.metadata === 'object' ? { metadata: { ...key.metadata } } : {}),
  })).sort(compareTime);
  return applyDuplicateTimePolicy(normalized, duplicateTimePolicy);
}

function normalizeAimKeys(keys, duplicateTimePolicy) {
  const normalized = Array.from(keys ?? []).map((key, index) => ({
    id: String(key?.id ?? `aim-${index}`),
    timeSecs: finiteTime(key?.timeSecs),
    aim: normalizeSpatialAimSpec(key?.aim),
    ...(key?.interpolation !== undefined ? { interpolation: normalizeSpatialAimInterpolationSpec(key.interpolation) } : {}),
    ...copySource(key ?? {}),
    ...(key?.metadata && typeof key.metadata === 'object' ? { metadata: { ...key.metadata } } : {}),
  })).sort(compareTime);
  return applyDuplicateTimePolicy(normalized, duplicateTimePolicy);
}

function applyDuplicateTimePolicy(keys, policy) {
  const normalizedPolicy = normalizeDuplicateTimePolicy(policy);
  if (keys.length < 2) return keys;
  if (normalizedPolicy === 'error') {
    for (let index = 1; index < keys.length; index += 1) {
      if (Math.abs(keys[index].timeSecs - keys[index - 1].timeSecs) <= EPSILON) {
        throw new RangeError('Duplicate time keys require an explicit non-error duplicateTimePolicy.');
      }
    }
    return keys;
  }
  if (normalizedPolicy === 'coalesceFirst') {
    return keys.filter((key, index) => index === 0 || Math.abs(key.timeSecs - keys[index - 1].timeSecs) > EPSILON);
  }
  if (normalizedPolicy === 'coalesceLast') {
    return keys.filter((key, index) => index === keys.length - 1 || Math.abs(key.timeSecs - keys[index + 1].timeSecs) > EPSILON);
  }
  return keys;
}

function normalizeDuplicateTimePolicy(policy) {
  const normalized = policy ?? 'error';
  if (['error', 'coalesceFirst', 'coalesceLast', 'hold', 'cut', 'preserve'].includes(normalized)) {
    return normalized;
  }
  throw new TypeError(`Unsupported duplicateTimePolicy: ${String(policy)}`);
}

function assertKeysWithinDuration(keys, durationSecs) {
  for (const key of keys) {
    if (key.timeSecs > durationSecs + EPSILON) {
      throw new RangeError('Path key timeSecs cannot exceed durationSecs.');
    }
  }
}

function normalizeSpatialPositionInterpolation(input) {
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
      ...(input.inTangentPc !== undefined ? { inTangentPc: normalizeSpatialVector3(input.inTangentPc) } : {}),
      ...(input.outTangentPc !== undefined ? { outTangentPc: normalizeSpatialVector3(input.outTangentPc) } : {}),
    };
  }
  if (input.kind === 'hermite') {
    return {
      kind: 'hermite',
      ...(input.inVelocityPcPerSec !== undefined ? { inVelocityPcPerSec: normalizeSpatialVector3(input.inVelocityPcPerSec) } : {}),
      ...(input.outVelocityPcPerSec !== undefined ? { outVelocityPcPerSec: normalizeSpatialVector3(input.outVelocityPcPerSec) } : {}),
    };
  }
  throw new TypeError(`Unsupported position interpolation kind: ${String(input.kind)}`);
}

function normalizeSpatialAimInterpolationSpec(input) {
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

function evaluatePositionInterpolation(keys, segmentIndex, t, durationSecs) {
  const left = keys[segmentIndex];
  const right = keys[segmentIndex + 1];
  const interpolation = left.interpolation ?? { kind: 'linear' };
  if (interpolation.kind === 'hold') {
    const positionPc = t >= 1 ? right.positionPc : left.positionPc;
    return {
      positionPc: cloneSpatialVector3(positionPc),
      velocityPcPerSec: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
      accelerationPcPerSec2: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
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

function evaluateLinearPosition(left, right, t, durationSecs) {
  if (left.interpolation?.kind === 'linear' && left.interpolation.easing) {
    const pointAt = (u) => lerpVector(
      left.positionPc,
      right.positionPc,
      applyEasing(left.interpolation.easing, u),
    );
    const derivative = finiteDifferenceVector(pointAt, t);
    return {
      positionPc: pointAt(t),
      velocityPcPerSec: scaleSpatialVector(derivative.first, 1 / durationSecs),
      accelerationPcPerSec2: scaleSpatialVector(derivative.second, 1 / (durationSecs * durationSecs)),
    };
  }
  const velocityPcPerSec = scaleSpatialVector(subtractSpatialVectors(right.positionPc, left.positionPc), 1 / durationSecs);
  return {
    positionPc: lerpVector(left.positionPc, right.positionPc, t),
    velocityPcPerSec,
    accelerationPcPerSec2: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
  };
}

function evaluateCubicBezierPosition(left, right, t, durationSecs) {
  const p0 = left.positionPc;
  const p3 = right.positionPc;
  const delta = subtractSpatialVectors(p3, p0);
  const p1 = addSpatialVectors(
    p0,
    left.interpolation?.kind === 'cubicBezier' && left.interpolation.outTangentPc
      ? left.interpolation.outTangentPc
      : scaleSpatialVector(delta, 1 / 3),
  );
  const p2 = addSpatialVectors(
    p3,
    right.interpolation?.kind === 'cubicBezier' && right.interpolation.inTangentPc
      ? right.interpolation.inTangentPc
      : scaleSpatialVector(delta, -1 / 3),
  );
  const u = clamp(t, 0, 1);
  const oneMinus = 1 - u;
  const positionPc = addSpatialVectors(
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
    positionPc,
    velocityPcPerSec: scaleSpatialVector(derivative, 1 / durationSecs),
    accelerationPcPerSec2: scaleSpatialVector(secondDerivative, 1 / (durationSecs * durationSecs)),
  };
}

function evaluateHermitePosition(left, right, t, durationSecs) {
  const p0 = left.positionPc;
  const p1 = right.positionPc;
  const defaultVelocity = scaleSpatialVector(subtractSpatialVectors(p1, p0), 1 / durationSecs);
  const v0 = left.interpolation?.kind === 'hermite' && left.interpolation.outVelocityPcPerSec
    ? left.interpolation.outVelocityPcPerSec
    : defaultVelocity;
  const v1 = right.interpolation?.kind === 'hermite' && right.interpolation.inVelocityPcPerSec
    ? right.interpolation.inVelocityPcPerSec
    : defaultVelocity;
  const m0 = scaleSpatialVector(v0, durationSecs);
  const m1 = scaleSpatialVector(v1, durationSecs);
  const u = clamp(t, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const positionPc = combineSpatialVectors([
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
    positionPc,
    velocityPcPerSec: scaleSpatialVector(derivative, 1 / durationSecs),
    accelerationPcPerSec2: scaleSpatialVector(secondDerivative, 1 / (durationSecs * durationSecs)),
  };
}

function evaluateCatmullRomPosition(keys, segmentIndex, t, durationSecs, interpolation) {
  const tension = interpolation.tension ?? 0;
  const centripetal = interpolation.centripetal !== false;
  const pointAt = (u) => {
    const catmull = centripetal
      ? centripetalCatmullRomPosition(keys, segmentIndex, u)
      : uniformCatmullRomPosition(keys, segmentIndex, u);
    if (tension <= EPSILON) return catmull;
    const linear = lerpVector(keys[segmentIndex].positionPc, keys[segmentIndex + 1].positionPc, clamp(u, 0, 1));
    return lerpVector(catmull, linear, tension);
  };
  const derivative = finiteDifferenceVector(pointAt, t);
  return {
    positionPc: pointAt(t),
    velocityPcPerSec: scaleSpatialVector(derivative.first, 1 / durationSecs),
    accelerationPcPerSec2: scaleSpatialVector(derivative.second, 1 / (durationSecs * durationSecs)),
  };
}

function catmullRomControlPoints(keys, segmentIndex) {
  const p1 = keys[segmentIndex].positionPc;
  const p2 = keys[segmentIndex + 1].positionPc;
  const p0 = keys[segmentIndex - 1]?.positionPc ?? subtractSpatialVectors(scaleSpatialVector(p1, 2), p2);
  const p3 = keys[segmentIndex + 2]?.positionPc ?? subtractSpatialVectors(scaleSpatialVector(p2, 2), p1);
  return { p0, p1, p2, p3 };
}

function uniformCatmullRomPosition(keys, segmentIndex, t) {
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

function centripetalCatmullRomPosition(keys, segmentIndex, t) {
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

function catmullRomKnot(previousKnot, a, b) {
  return previousKnot + Math.max(Math.sqrt(getSpatialVectorLength(subtractSpatialVectors(a, b))), EPSILON);
}

function interpolateCentripetalVector(a, b, ta, tb, t) {
  if (Math.abs(tb - ta) <= EPSILON) return cloneSpatialVector3(b);
  return addSpatialVectors(
    scaleSpatialVector(a, (tb - t) / (tb - ta)),
    scaleSpatialVector(b, (t - ta) / (tb - ta)),
  );
}

function finiteDifferenceVector(pointAt, t) {
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

function evaluatePositionKeys(keys, timeSecs) {
  const bracket = findTimedBracket(keys, timeSecs);
  const left = bracket.left;
  const right = bracket.right;
  if (!right || left === right) {
    return pathPositionSample(timeSecs, left.positionPc, SPATIAL_ZERO_VECTOR, 0, SPATIAL_ZERO_VECTOR, null, left.id);
  }
  const duration = Math.max(EPSILON, right.timeSecs - left.timeSecs);
  const t = bracket.t;
  const evaluation = evaluatePositionInterpolation(keys, bracket.segmentIndex, t, duration);
  return pathPositionSample(
    timeSecs,
    evaluation.positionPc,
    evaluation.velocityPcPerSec,
    getSpatialVectorLength(evaluation.velocityPcPerSec),
    evaluation.accelerationPcPerSec2,
    bracket.segmentIndex,
    left.id,
  );
}

function pathPositionSample(timeSecs, positionPc, velocityPcPerSec, speedPcPerSec, accelerationPcPerSec2, segmentIndex, segmentId) {
  const acceleration = accelerationPcPerSec2 ?? SPATIAL_ZERO_VECTOR;
  return {
    timeSecs,
    pose: {
      observerPc: cloneSpatialVector3(positionPc),
      orientationIcrs: cloneSpatialQuaternion(SPATIAL_IDENTITY_QUATERNION),
    },
    aim: null,
    velocityPcPerSec: cloneSpatialVector3(velocityPcPerSec),
    speedPcPerSec,
    accelerationPcPerSec2: cloneSpatialVector3(acceleration),
    accelerationMagnitudePcPerSec2: getSpatialVectorLength(acceleration),
    segmentIndex,
    segmentId,
    diagnostics: { warnings: [] },
  };
}

function findTimedBracket(keys, timeSecs) {
  if (keys.length === 1 || timeSecs <= keys[0].timeSecs) {
    return { left: keys[0], right: keys[0], t: 0, segmentIndex: null };
  }
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index];
    const right = keys[index + 1];
    if (timeSecs <= right.timeSecs + EPSILON) {
      const duration = right.timeSecs - left.timeSecs;
      const t = duration > EPSILON ? clamp((timeSecs - left.timeSecs) / duration, 0, 1) : 1;
      return { left, right, t, segmentIndex: index };
    }
  }
  const last = keys[keys.length - 1];
  return { left: last, right: last, t: 1, segmentIndex: null };
}

function selectAimInterpolation(bracket, defaultInterpolation) {
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

function aimInterpolationRequiresObserver(bracket, interpolation) {
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

function interpolateAim(bracket, choice, context) {
  const interpolation = choice.spec;
  const t = clamp(bracket.t, 0, 1);
  const warnings = [];
  const fallbackUpIcrs = context.fallbackUpIcrs === undefined
    ? undefined
    : normalizeSpatialVector3(context.fallbackUpIcrs);
  if (!bracket.right || bracket.left === bracket.right || interpolation.kind === 'hold') {
    const sourceKey = t >= 1 ? bracket.right : bracket.left;
    return {
      aim: aimWithFallbackUp(sourceKey.aim, fallbackUpIcrs),
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
        targetPc: lerpVector(bracket.left.aim.targetPc, bracket.right.aim.targetPc, easedT),
        ...resolvedInterpolatedAimUp(bracket.left.aim, bracket.right.aim, fallbackUpIcrs),
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
        forwardIcrs: slerpSpatialDirections(bracket.left.aim.forwardIcrs, bracket.right.aim.forwardIcrs, easedT),
        ...resolvedInterpolatedAimUp(bracket.left.aim, bracket.right.aim, fallbackUpIcrs),
      },
      sourceKey: null,
      warnings,
    };
  }
  const easedT = applyEasing(interpolation.easing ?? { kind: 'linear' }, t);
  const leftSample = evaluateSpatialAim({
    observerPc: context.observerPc,
    aim: aimWithFallbackUp(bracket.left.aim, fallbackUpIcrs),
    syntheticTargetDistancePc: context.syntheticTargetDistancePc,
  });
  const rightSample = evaluateSpatialAim({
    observerPc: context.observerPc,
    aim: aimWithFallbackUp(bracket.right.aim, fallbackUpIcrs),
    syntheticTargetDistancePc: context.syntheticTargetDistancePc,
  });
  warnings.push(...(leftSample.diagnostics?.warnings ?? []), ...(rightSample.diagnostics?.warnings ?? []));
  return {
    aim: {
      kind: 'orientation',
      orientationIcrs: slerpQuaternions(leftSample.orientationIcrs, rightSample.orientationIcrs, easedT),
    },
    sourceKey: null,
    warnings,
  };
}

function assertAimKind(aim, expectedKind, interpolationKind) {
  if (aim.kind !== expectedKind) {
    throw new TypeError(`${interpolationKind} aim interpolation requires ${expectedKind} aim keys.`);
  }
}

function aimWithFallbackUp(aim, fallbackUpIcrs) {
  if (!fallbackUpIcrs || aim.kind === 'orientation' || aim.upIcrs !== undefined) return aim;
  return { ...aim, upIcrs: fallbackUpIcrs };
}

function resolvedInterpolatedAimUp(leftAim, rightAim, fallbackUpIcrs) {
  const up = leftAim.upIcrs ?? rightAim.upIcrs ?? fallbackUpIcrs;
  return up ? { upIcrs: normalizeSpatialVector3(up) } : {};
}

function endpointSourceMetadata(leftKey, rightKey) {
  const metadata = {};
  if (leftKey.source !== undefined) metadata.leftSource = leftKey.source;
  if (rightKey.source !== undefined) metadata.rightSource = rightKey.source;
  return metadata.leftSource !== undefined || metadata.rightSource !== undefined
    ? metadata
    : undefined;
}

function slerpSpatialDirections(left, right, t) {
  const a = normalizeDirectionOr(left, SPATIAL_LOCAL_FORWARD);
  let b = normalizeDirectionOr(right, SPATIAL_LOCAL_FORWARD);
  let cos = clamp(dot(a, b), -1, 1);
  if (cos > 0.9995) {
    return normalizeDirectionOr(lerpVector(a, b, t), SPATIAL_LOCAL_FORWARD);
  }
  if (cos < -0.9995) {
    const perpendicular = perpendicularTo(a);
    return normalizeDirectionOr(addSpatialVectors(
      scaleSpatialVector(a, Math.cos(Math.PI * t)),
      scaleSpatialVector(perpendicular, Math.sin(Math.PI * t)),
    ), SPATIAL_LOCAL_FORWARD);
  }
  const theta = Math.acos(cos);
  const sinTheta = Math.sin(theta);
  const scaleA = Math.sin((1 - t) * theta) / sinTheta;
  const scaleB = Math.sin(t * theta) / sinTheta;
  b = scaleSpatialVector(b, scaleB);
  return normalizeDirectionOr(addSpatialVectors(scaleSpatialVector(a, scaleA), b), SPATIAL_LOCAL_FORWARD);
}

function remapPathTime(path, elapsedSecs) {
  if (!path.timeRemap) return clamp(elapsedSecs, 0, path.durationSecs);
  const playbackDuration = path.timeRemap.playbackDurationSecs ?? path.durationSecs;
  let t = playbackDuration > EPSILON ? clamp(elapsedSecs / playbackDuration, 0, 1) : 1;
  if (path.timeRemap.kind === 'eased') t = applyEasing(path.timeRemap.easing ?? { kind: 'smoothstep' }, t);
  return t * path.durationSecs;
}

function normalizeEasing(input) {
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

function applyEasing(easing, t) {
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

function applyCubicBezierEasing(easing, t) {
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

function cubicBezierCoordinate(t, p1, p2) {
  const oneMinus = 1 - t;
  return 3 * oneMinus * oneMinus * t * p1 + 3 * oneMinus * t * t * p2 + t * t * t;
}

function cubicBezierDerivative(t, p1, p2) {
  const oneMinus = 1 - t;
  return 3 * oneMinus * oneMinus * p1 + 6 * oneMinus * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

function resolveTransitionLaneTimings(spec) {
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

function resolveTransitionLaneTimingWithTotal(name, lane, durationSecs) {
  const delaySecs = lane?.delaySecs ?? 0;
  if (delaySecs > durationSecs + EPSILON) {
    throw new RangeError(`${name} transition lane delaySecs cannot exceed durationSecs.`);
  }
  const laneDurationSecs = lane?.durationSecs ?? Math.max(0, durationSecs - delaySecs);
  if (delaySecs + laneDurationSecs > durationSecs + EPSILON) {
    throw new RangeError(`${name} transition lane delaySecs plus durationSecs cannot exceed durationSecs.`);
  }
  return { delaySecs, durationSecs: laneDurationSecs };
}

function resolveTransitionLaneTimingWithoutTotal(lane) {
  return {
    delaySecs: lane?.delaySecs ?? 0,
    durationSecs: lane?.durationSecs ?? 1,
  };
}

function materializeTransitionPositionKeys(input) {
  const interpolation = transitionPositionInterpolation(input.lane, input.warnings);
  return materializeTransitionKeys({
    from: input.from,
    to: input.to,
    timing: input.timing,
    durationSecs: input.durationSecs,
    activeInterpolation: interpolation,
    keyPrefix: 'position',
    valueKey: 'positionPc',
  });
}

function materializeTransitionAimKeys(input) {
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

function materializeTransitionKeys(input) {
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

  if (input.durationSecs <= EPSILON) {
    return [makeKey('to', 0, input.to, holdInterpolation)];
  }

  if (activeDurationSecs <= EPSILON) {
    if (delaySecs <= EPSILON) {
      keys.push(makeKey('to', 0, input.to, holdInterpolation));
    } else {
      keys.push(makeKey('from', 0, input.from, holdInterpolation));
      keys.push(makeKey('to', delaySecs, input.to, holdInterpolation));
    }
  } else {
    if (delaySecs > EPSILON) {
      keys.push(makeKey('from', 0, input.from, holdInterpolation));
      keys.push(makeKey('active-start', delaySecs, input.from, input.activeInterpolation));
    } else {
      keys.push(makeKey('active-start', 0, input.from, input.activeInterpolation));
    }
    keys.push(makeKey('active-end', activeEndSecs, input.to, holdInterpolation));
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey.timeSecs < input.durationSecs - EPSILON) {
    keys.push(makeKey('hold-end', input.durationSecs, input.to, holdInterpolation));
  }
  return keys;
}

function transitionPositionInterpolation(lane, warnings) {
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

function transitionAimInterpolation(lane, from, to) {
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

function transitionLaneEasing(lane, interpolation) {
  if (lane?.easing !== undefined) return lane.easing;
  if (interpolation === 'smoothstep') return { kind: 'smoothstep' };
  if (interpolation === 'easeIn') return { kind: 'easeIn' };
  if (interpolation === 'easeOut') return { kind: 'easeOut' };
  if (interpolation === 'easeInOut') return { kind: 'easeInOut' };
  return { kind: 'linear' };
}

function normalizeTransitionLane(input = {}) {
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

function sampleToAimSpec(sample) {
  if (sample.kind === 'target') {
    return {
      kind: 'target',
      targetPc: cloneSpatialVector3(sample.targetPc),
      ...(sample.upIcrs !== undefined ? { upIcrs: cloneSpatialVector3(sample.upIcrs) } : {}),
      ...(sample.positionAngleDeg !== undefined ? { positionAngleDeg: finiteNumber(sample.positionAngleDeg, 0) } : {}),
      ...(sample.lock !== undefined ? { lock: sample.lock === true } : {}),
      ...copySource(sample),
    };
  }
  if (sample.kind === 'direction') {
    return {
      kind: 'direction',
      forwardIcrs: cloneSpatialVector3(sample.forwardIcrs),
      ...(sample.upIcrs !== undefined ? { upIcrs: cloneSpatialVector3(sample.upIcrs) } : {}),
      ...(sample.positionAngleDeg !== undefined ? { positionAngleDeg: finiteNumber(sample.positionAngleDeg, 0) } : {}),
      ...copySource(sample),
    };
  }
  return {
    kind: 'orientation',
    orientationIcrs: cloneSpatialQuaternion(sample.orientationIcrs),
    ...copySource(sample),
  };
}

function frameStateAimSpec(frameState) {
  return frameState.aim?.kind
    ? sampleToAimSpec(frameState.aim)
    : { kind: 'orientation', orientationIcrs: frameState.pose.orientationIcrs };
}

function transitionFrameState(transition, sample, complete) {
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

function buildPoseTransitionViewPath(input) {
  const normalized = normalizeSpatialPoseTransitionSpec(input);
  return buildSpatialViewTransitionPath({
    from: { pose: normalized.from, aim: null },
    to: { pose: normalized.to, aim: null },
    ...(normalized.durationSecs !== undefined ? { durationSecs: normalized.durationSecs } : {}),
    ...(normalized.movement !== undefined ? { position: normalized.movement } : {}),
    ...(normalized.orientation !== undefined ? { aim: normalized.orientation } : {}),
  });
}

function publicTransitionLane(lane, timing) {
  const output = {
    ...(lane ?? {}),
    durationSecs: timing.durationSecs,
  };
  if (lane?.delaySecs !== undefined || timing.delaySecs > EPSILON) {
    output.delaySecs = timing.delaySecs;
  }
  return output;
}

function cloneFrameState(frameState) {
  return {
    ...frameState,
    pose: cloneSpatialPose(frameState.pose),
    aim: frameState.aim ? cloneAimSample(frameState.aim) : null,
    targetLock: frameState.targetLock ? { ...frameState.targetLock, targetPc: cloneSpatialVector3(frameState.targetLock.targetPc) } : null,
  };
}

function cloneAimSample(sample) {
  return {
    ...sample,
    ...(sample.targetPc ? { targetPc: cloneSpatialVector3(sample.targetPc) } : {}),
    ...(sample.syntheticTargetPc ? { syntheticTargetPc: cloneSpatialVector3(sample.syntheticTargetPc) } : {}),
    forwardIcrs: cloneSpatialVector3(sample.forwardIcrs),
    upIcrs: cloneSpatialVector3(sample.upIcrs),
    orientationIcrs: cloneSpatialQuaternion(sample.orientationIcrs),
  };
}

function quaternionFromForwardUp(forward, up) {
  const f = normalizeDirectionOr(forward, SPATIAL_LOCAL_FORWARD);
  let r = cross(f, up);
  if (getSpatialVectorLength(r) <= EPSILON) r = cross(f, SPATIAL_LOCAL_UP);
  if (getSpatialVectorLength(r) <= EPSILON) r = cross(f, SPATIAL_LOCAL_RIGHT);
  r = normalizeDirectionOr(r, SPATIAL_LOCAL_RIGHT);
  const u = normalizeDirectionOr(cross(r, f), SPATIAL_LOCAL_UP);

  const m00 = r.x;
  const m01 = u.x;
  const m02 = -f.x;
  const m10 = r.y;
  const m11 = u.y;
  const m12 = -f.y;
  const m20 = r.z;
  const m21 = u.z;
  const m22 = -f.z;
  const trace = m00 + m11 + m22;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return normalizeSpatialQuaternion({ x, y, z, w });
}

function resolveAimUp(forward, authoredUp, positionAngleDeg, warnings) {
  let up = authoredUp !== undefined
    ? normalizeDirectionOr(authoredUp, null)
    : cloneSpatialVector3(SPATIAL_LOCAL_UP);
  let usedFallback = false;
  if (up) {
    up = subtractSpatialVectors(up, scaleSpatialVector(forward, dot(up, forward)));
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
  if (usedFallback && Math.abs(dot(resolved, forward)) > 1e-7) {
    return perpendicularTo(forward);
  }
  return resolved;
}

function slerpQuaternions(a, b, t) {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return normalizeSpatialQuaternion({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }
  const theta0 = Math.acos(clamp(cos, -1, 1));
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - cos * sinTheta / sinTheta0;
  const s1 = sinTheta / sinTheta0;
  return normalizeSpatialQuaternion({
    x: a.x * s0 + bx * s1,
    y: a.y * s0 + by * s1,
    z: a.z * s0 + bz * s1,
    w: a.w * s0 + bw * s1,
  });
}

function normalizeDirectionOr(vector, fallback) {
  if (!vector) return fallback ? cloneSpatialVector3(fallback) : null;
  const length = getSpatialVectorLength(vector);
  return length > 0 ? scaleSpatialVector(vector, 1 / length) : fallback ? cloneSpatialVector3(fallback) : null;
}

function perpendicularTo(vector) {
  const axis = Math.abs(vector.y) < 0.9 ? SPATIAL_LOCAL_UP : SPATIAL_LOCAL_RIGHT;
  return normalizeDirectionOr(cross(vector, axis), SPATIAL_LOCAL_RIGHT);
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function combineSpatialVectors(terms) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [vector, scalar] of terms) {
    x += vector.x * scalar;
    y += vector.y * scalar;
    z += vector.z * scalar;
  }
  return { x, y, z };
}

function lerp(left, right, t) {
  return left + (right - left) * t;
}

function lerpVector(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteRequiredNumber(value, label) {
  if (typeof value !== 'number') throw new TypeError(`${label} must be a number.`);
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number.`);
  return value;
}

function positiveFiniteNumber(value, label) {
  const number = finiteRequiredNumber(value, label);
  if (!(number > 0)) throw new RangeError(`${label} must be greater than zero.`);
  return number;
}

function nonNegativeFiniteNumber(value, label) {
  const number = finiteRequiredNumber(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative.`);
  return number;
}

function finiteNumberInRange(value, min, max, label) {
  const number = finiteRequiredNumber(value, label);
  if (number < min || number > max) throw new RangeError(`${label} must be between ${min} and ${max}.`);
  return number;
}

function finiteTime(value) {
  return nonNegativeFiniteNumber(value, 'timeSecs');
}

function positiveIntegerRequired(value, label) {
  const number = positiveFiniteNumber(value, label);
  if (!Number.isInteger(number)) throw new RangeError(`${label} must be an integer.`);
  return number;
}

function nonNegativeIntegerRequired(value, label) {
  const number = nonNegativeFiniteNumber(value, label);
  if (!Number.isInteger(number)) throw new RangeError(`${label} must be an integer.`);
  return number;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function withTimingDurationConstraints(output, input) {
  const minDurationSecs = input.minDurationSecs !== undefined
    ? nonNegativeFiniteNumber(input.minDurationSecs, 'minDurationSecs')
    : undefined;
  const maxDurationSecs = input.maxDurationSecs !== undefined
    ? nonNegativeFiniteNumber(input.maxDurationSecs, 'maxDurationSecs')
    : undefined;
  if (minDurationSecs !== undefined && maxDurationSecs !== undefined && minDurationSecs > maxDurationSecs) {
    throw new RangeError('minDurationSecs cannot be greater than maxDurationSecs.');
  }
  return {
    ...output,
    ...(minDurationSecs !== undefined ? { minDurationSecs } : {}),
    ...(maxDurationSecs !== undefined ? { maxDurationSecs } : {}),
  };
}

function normalizeTimingPhases(input, durationSecs) {
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
      startDistancePc: nonNegativeFiniteNumber(value.startDistancePc, `phases[${index}].startDistancePc`),
      endDistancePc: nonNegativeFiniteNumber(value.endDistancePc, `phases[${index}].endDistancePc`),
      startSpeedPcPerSec: nonNegativeFiniteNumber(value.startSpeedPcPerSec, `phases[${index}].startSpeedPcPerSec`),
      endSpeedPcPerSec: nonNegativeFiniteNumber(value.endSpeedPcPerSec, `phases[${index}].endSpeedPcPerSec`),
    };
    if (normalized.endTimeSecs < normalized.startTimeSecs) throw new RangeError('Custom timing phase endTimeSecs cannot be before startTimeSecs.');
    if (normalized.endDistancePc < normalized.startDistancePc) throw new RangeError('Custom timing phase endDistancePc cannot be before startDistancePc.');
    const expectedDistance = (normalized.startSpeedPcPerSec + normalized.endSpeedPcPerSec) * 0.5
      * (normalized.endTimeSecs - normalized.startTimeSecs);
    const actualDistance = normalized.endDistancePc - normalized.startDistancePc;
    const cumulativeDistanceScale = Math.max(normalized.startDistancePc, normalized.endDistancePc);
    if (!timingDistanceNearlyEqual(expectedDistance, actualDistance, cumulativeDistanceScale)) {
      throw new RangeError('Custom timing phase distance must match its speed integral.');
    }
    return normalized;
  });
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    if (index === 0) {
      if (phase.startTimeSecs !== 0 || phase.startDistancePc !== 0) {
        throw new RangeError('Custom timing phases must start at zero time and distance.');
      }
      continue;
    }
    const previous = phases[index - 1];
    if (!timingTimeNearlyEqual(phase.startTimeSecs, previous.endTimeSecs)) {
      throw new RangeError('Custom timing phases must have contiguous times.');
    }
    if (!timingDistanceNearlyEqual(phase.startDistancePc, previous.endDistancePc)) {
      throw new RangeError('Custom timing phases must have contiguous distances.');
    }
    if (!nearlyEqual(phase.startSpeedPcPerSec, previous.endSpeedPcPerSec, 1e-7)) {
      throw new RangeError('Custom timing phases must have contiguous speeds.');
    }
  }
  const last = phases[phases.length - 1] ?? null;
  if (last && !timingTimeNearlyEqual(last.endTimeSecs, durationSecs)) {
    throw new RangeError('Custom timing final phase must end at durationSecs.');
  }
  return phases;
}

function nearlyEqual(left, right, tolerance = 1e-6) {
  return Math.abs(left - right) <= Math.max(tolerance, Math.max(Math.abs(left), Math.abs(right)) * tolerance);
}

function timingDistanceNearlyEqual(left, right, referenceScale = 0) {
  if (left === right) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  const floatingPointTolerance = Number.EPSILON * 32 * Math.abs(referenceScale);
  return Math.abs(left - right) <= Math.max(scale * 1e-9, floatingPointTolerance);
}

function timingTimeNearlyEqual(left, right) {
  if (left === right) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return scale > 0 && Math.abs(left - right) <= scale * 1e-12;
}

function timingScalarNearlyEqual(left, right) {
  if (left === right) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return scale > 0 && Math.abs(left - right) <= scale * 1e-7;
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function radiansToDegrees(radians) {
  return radians * 180 / Math.PI;
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function compareTime(a, b) {
  return a.timeSecs - b.timeSecs;
}

function warning(code, message, metadata) {
  return { code, severity: 'warning', message, ...(metadata ? { metadata } : {}) };
}

function copySource(input) {
  return input.source !== undefined ? { source: input.source } : {};
}

function isVectorLike(input) {
  return Boolean(input && typeof input === 'object' && 'x' in input && 'y' in input && 'z' in input);
}

function isDestinationLike(input) {
  return Boolean(input && typeof input === 'object' && 'centerPc' in input && !('positionPc' in input));
}
