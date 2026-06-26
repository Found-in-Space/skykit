const EPSILON = 1e-9;
const DEFAULT_SAMPLE_STEP_SECS = 1 / 60;
const DEFAULT_SYNTHETIC_TARGET_DISTANCE_PC = 1;

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
  if (input == null) return cloneSpatialVector3(fallback);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a spatial vector object.');
  }
  const value = input;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (![x, y, z].every(Number.isFinite)) {
    throw new RangeError('Spatial vector components must be finite numbers.');
  }
  return { x, y, z };
}

export function normalizeSpatialQuaternion(input, fallback = SPATIAL_IDENTITY_QUATERNION) {
  if (input == null) return cloneSpatialQuaternion(fallback);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a spatial quaternion object.');
  }
  const value = input;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  const w = Number(value.w);
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
  const metersPerNavigationUnit = positiveNumber(
    input.metersPerNavigationUnit,
    DEFAULT_SPATIAL_SCALE_PROFILE.metersPerNavigationUnit,
  );
  return {
    navigationUnits: typeof input.navigationUnits === 'string' ? input.navigationUnits : 'pc',
    metersPerNavigationUnit,
    worldUnitsPerNavigationUnit: positiveNumber(
      input.worldUnitsPerNavigationUnit,
      metersPerNavigationUnit,
    ),
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
  const length = getSpatialVectorLength(vector);
  return length > EPSILON ? scaleSpatialVector(vector, 1 / length) : cloneSpatialVector3(SPATIAL_LOCAL_FORWARD);
}

export function isNonZeroSpatialVector(vector) {
  return getSpatialVectorLength(vector) > EPSILON;
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
  if (!(length > EPSILON)) return null;
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
    const decDeg = finiteNumber(input.decDeg, Number.NaN);
    const hasRaDeg = input.raDeg !== undefined;
    const hasRaHours = input.raHours !== undefined;
    const ra = hasRaDeg ? finiteNumber(input.raDeg, Number.NaN) : finiteNumber(input.raHours, Number.NaN);
    const distancePc = positiveNumber(input.distancePc, Number.NaN);
    if (!Number.isFinite(decDeg) || !Number.isFinite(ra) || !Number.isFinite(distancePc)) {
      throw new RangeError('Invalid radec target values.');
    }
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
    return {
      kind: 'target',
      targetPc: normalizeSpatialVector3(input.targetPc),
      ...(input.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(input.upIcrs) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: finiteNumber(input.positionAngleDeg, 0) } : {}),
      ...(input.lock !== undefined ? { lock: input.lock === true } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'direction') {
    return {
      kind: 'direction',
      forwardIcrs: normalizeDirectionOr(normalizeSpatialVector3(input.forwardIcrs), SPATIAL_LOCAL_FORWARD),
      ...(input.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(input.upIcrs) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: finiteNumber(input.positionAngleDeg, 0) } : {}),
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
    const forwardIcrs = distancePc > EPSILON
      ? scaleSpatialVector(offset, 1 / distancePc)
      : cloneSpatialVector3(SPATIAL_LOCAL_FORWARD);
    if (!(distancePc > EPSILON)) {
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
  return {
    ...(input.id !== undefined ? { id: String(input.id) } : {}),
    ...(input.label !== undefined ? { label: String(input.label) } : {}),
    centerPc: normalizeSpatialVector3(input.centerPc),
    ...(input.radiusPc !== undefined ? { radiusPc: positiveNumber(input.radiusPc, 0) } : {}),
    ...(input.boundsRadiusPc !== undefined ? { boundsRadiusPc: positiveNumber(input.boundsRadiusPc, 0) } : {}),
    ...(input.aim !== undefined ? { aim: normalizeSpatialAimSpec(input.aim) } : {}),
    ...(input.orbit !== undefined ? { orbit: normalizeSpatialOrbitSpec(input.orbit) } : {}),
    ...(input.dwellSecs !== undefined ? { dwellSecs: positiveNumber(input.dwellSecs, 0) } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function normalizeSpatialOrbitSpec(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialOrbitSpec object.');
  }
  const radiusPc = positiveNumber(input.radiusPc, Number.NaN);
  if (!Number.isFinite(radiusPc)) throw new RangeError('Orbit radiusPc must be positive.');
  return {
    centerPc: normalizeSpatialVector3(input.centerPc),
    radiusPc,
    ...(input.orbitNormal !== undefined ? { orbitNormal: normalizeSpatialVector3(input.orbitNormal) } : {}),
    ...(input.referenceAxis !== undefined ? { referenceAxis: normalizeSpatialVector3(input.referenceAxis) } : {}),
    ...(input.handedness !== undefined ? { handedness: input.handedness === -1 ? -1 : 1 } : {}),
    ...(input.initialAngleRad !== undefined ? { initialAngleRad: finiteNumber(input.initialAngleRad, 0) } : {}),
    ...(input.angularSpeedRadPerSec !== undefined ? { angularSpeedRadPerSec: finiteNumber(input.angularSpeedRadPerSec, 0) } : {}),
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
  if (input.kind === 'duration') {
    return {
      kind: 'duration',
      durationSecs: positiveNumber(input.durationSecs, Number.NaN),
      ...(input.minDurationSecs !== undefined ? { minDurationSecs: positiveNumber(input.minDurationSecs, 0) } : {}),
      ...(input.maxDurationSecs !== undefined ? { maxDurationSecs: positiveNumber(input.maxDurationSecs, 0) } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'constantSpeed') {
    return {
      kind: 'constantSpeed',
      speedPcPerSec: positiveNumber(input.speedPcPerSec, Number.NaN),
      ...(input.durationSecs !== undefined ? { durationSecs: positiveNumber(input.durationSecs, 0) } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'trapezoid' || input.kind === 'triangular' || input.kind === 'custom') {
    return { ...input };
  }
  throw new TypeError(`Unsupported timing kind: ${String(input.kind)}`);
}

export function deriveSpatialOrbitalInsertTiming(input) {
  return deriveTimingProfile({
    kind: 'constantSpeed',
    distancePc: Math.max(0, finiteNumber(input?.distancePc, 0)),
    durationSecs: input?.durationSecs,
    speedPcPerSec: input?.approachSpeedPcPerSec ?? input?.orbitalSpeedPcPerSec,
    departureSpeedPcPerSec: input?.currentSpeedPcPerSec,
    arrivalSpeedPcPerSec: input?.orbitalSpeedPcPerSec,
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
    ...(input.timing !== undefined ? { timing: isTimingProfile(input.timing) ? cloneTimingProfile(input.timing) : normalizeSpatialTimingSpec(input.timing) } : {}),
    ...(input.sampleStepSecs !== undefined ? { sampleStepSecs: positiveNumber(input.sampleStepSecs, 0) } : {}),
    ...(input.maxPoints !== undefined ? { maxPoints: positiveInteger(input.maxPoints, 2) } : {}),
    ...copySource(input),
  };
}

export function deriveSpatialRouteTiming(input) {
  const totalLengthPc = Math.max(0, finiteNumber(input?.totalLengthPc, 0));
  const timing = input?.travel?.timing;
  if (isTimingProfile(timing)) return cloneTimingProfile(timing);
  if (timing) {
    return deriveTimingProfile({
      ...normalizeSpatialTimingSpec(timing),
      distancePc: totalLengthPc,
      departureSpeedPcPerSec: input?.departureSpeedPcPerSec,
      arrivalSpeedPcPerSec: input?.arrivalSpeedPcPerSec,
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
    ...(input.speedPcPerSec !== undefined ? { speedPcPerSec: Math.max(0, finiteNumber(input.speedPcPerSec, 0)) } : {}),
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
  return createRoute({
    kind: 'polyline',
    pointsPc,
    segments,
    totalLengthPc,
    timing,
    departure,
    arrival,
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
  const pointsPc = interpolateRoutePoints(from.positionPc, to.positionPc, travel);
  const segments = buildRouteSegments(pointsPc);
  const totalLengthPc = segments.reduce((sum, segment) => sum + segment.lengthPc, 0);
  const timing = deriveSpatialRouteTiming({ totalLengthPc, travel, departureSpeedPcPerSec: from.speedPcPerSec, arrivalSpeedPcPerSec: to.speedPcPerSec });
  const arrivalAction = to.orbit ? normalizeSpatialArrivalAction({
    kind: 'orbit',
    destination: to.destination,
    orbit: deriveSpatialOrbitHandoff({ positionPc: to.positionPc, orbit: to.orbit }).orbit,
    aim: to.aim ?? to.destination?.aim ?? to.orbit.aim ?? null,
  }) : null;
  return createRoute({
    kind: 'orbitTransfer',
    pointsPc,
    segments,
    totalLengthPc,
    timing,
    departure: from,
    arrival: to,
    arrivalAction,
    diagnostics: routeDiagnostics(totalLengthPc, timing),
    ...copySource(input),
  });
}

export function buildSpatialOrbitalInsertRoute(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected orbital insert route input.');
  const orbit = normalizeSpatialOrbitSpec(input.orbit);
  const from = buildSpatialRouteEndpoint(input.from, { role: 'departure', referencePose: input.referencePose });
  if (!from) return null;
  const nearestAngle = deriveSpatialOrbitAngle({
    centerPc: orbit.centerPc,
    positionPc: from.positionPc,
    orbitNormal: orbit.orbitNormal,
    referenceAxis: orbit.referenceAxis,
  });
  const arrivalOrbit = { ...orbit, initialAngleRad: orbit.initialAngleRad ?? nearestAngle };
  const arrivalPosition = sampleSpatialOrbitPosition(arrivalOrbit, arrivalOrbit.initialAngleRad);
  const arrival = buildSpatialRouteEndpoint({
    positionPc: arrivalPosition,
    destination: input.destination,
    orbit: arrivalOrbit,
    aim: orbit.aim ?? input.destination?.aim ?? null,
  }, { role: 'arrival' });
  const travel = input.travel ? normalizeSpatialTravelSpec(input.travel) : { kind: 'orbitalInsert' };
  const pointsPc = interpolateRoutePoints(from.positionPc, arrival.positionPc, travel);
  const segments = buildRouteSegments(pointsPc);
  const totalLengthPc = segments.reduce((sum, segment) => sum + segment.lengthPc, 0);
  const orbitalSpeedPcPerSec = Math.abs(finiteNumber(orbit.angularSpeedRadPerSec, 0)) * orbit.radiusPc;
  const timing = travel.timing && isTimingProfile(travel.timing)
    ? cloneTimingProfile(travel.timing)
    : deriveSpatialOrbitalInsertTiming({
        distancePc: totalLengthPc,
        orbitalSpeedPcPerSec,
        approachSpeedPcPerSec: travel.timing?.speedPcPerSec,
        durationSecs: travel.timing?.durationSecs,
      });
  return createRoute({
    kind: 'orbitalInsert',
    pointsPc,
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
    diagnostics: routeDiagnostics(totalLengthPc, timing, { settleBehavior: 'continueOrbit' }),
    ...copySource(input),
  });
}

export function normalizeSpatialArrivalAction(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialArrivalAction object.');
  if (input.kind === 'none') return { kind: 'none' };
  if (input.kind === 'orbit') {
    return {
      kind: 'orbit',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
      orbit: normalizeSpatialOrbitSpec(input.orbit),
      ...(input.aim !== undefined ? { aim: input.aim == null ? null : normalizeSpatialAimSpec(input.aim) } : {}),
      ...(input.settleSecs !== undefined ? { settleSecs: positiveNumber(input.settleSecs, 0) } : {}),
      ...(input.preserveAim !== undefined ? { preserveAim: input.preserveAim === true } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'orbitalInsert') {
    return {
      kind: 'orbitalInsert',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
      orbit: normalizeSpatialOrbitSpec(input.orbit),
      ...(input.timing !== undefined ? { timing: isTimingProfile(input.timing) ? cloneTimingProfile(input.timing) : input.timing } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'lookAt') {
    return {
      kind: 'lookAt',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination) } : {}),
      aim: normalizeSpatialAimSpec(input.aim),
      ...(input.dwellSecs !== undefined ? { dwellSecs: positiveNumber(input.dwellSecs, 0) } : {}),
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
      ...(input.dwellSecs !== undefined ? { dwellSecs: positiveNumber(input.dwellSecs, 0) } : {}),
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
  const t = duration > EPSILON ? clamp(elapsed / duration, 0, 1) : 1;
  const distancePc = route.totalLengthPc * t;
  const sample = sampleRouteAtDistance(route, distancePc);
  return {
    elapsedSecs: elapsed,
    ...(options.frameIndex !== undefined ? { frameIndex: options.frameIndex } : {}),
    ...(route.id !== undefined ? { routeId: route.id } : {}),
    routeKind: route.kind,
    positionPc: sample.positionPc,
    velocityPcPerSec: sample.velocityPcPerSec,
    speedPcPerSec: sample.speedPcPerSec,
    distancePc,
    segmentIndex: sample.segmentIndex,
    complete: elapsed >= duration - EPSILON,
    diagnostics: { warnings: [] },
  };
}

export function sampleSpatialRoute(route, options = {}) {
  const sampling = normalizeSpatialSamplingOptions(options);
  const duration = Math.max(0, route.timing?.durationSecs ?? route.diagnostics?.durationSecs ?? 0);
  const samples = [];
  let frameIndex = 0;
  for (let timeSecs = 0; timeSecs <= duration + sampling.sampleStepSecs * 0.5; timeSecs += sampling.sampleStepSecs) {
    if (samples.length >= sampling.maxSamples) break;
    samples.push(evaluateSpatialRoute(route, Math.min(timeSecs, duration), { frameIndex }));
    frameIndex += 1;
    if (timeSecs >= duration - EPSILON) break;
  }
  if (samples.length === 0 || samples[samples.length - 1].elapsedSecs < duration) {
    samples.push(evaluateSpatialRoute(route, duration, { frameIndex }));
  }
  return samples;
}

export function buildSpatialAimTrack(keys = [], options = {}) {
  const normalizedKeys = normalizeAimKeys(keys, options.duplicateTimePolicy ?? 'error');
  const durationSecs = options.durationSecs !== undefined
    ? positiveNumber(options.durationSecs, 0)
    : normalizedKeys.length > 0
      ? normalizedKeys[normalizedKeys.length - 1].timeSecs
      : 0;
  assertKeysWithinDuration(normalizedKeys, durationSecs);
  return {
    keys: normalizedKeys,
    durationSecs,
    ...(options.defaultInterpolation !== undefined ? { defaultInterpolation: options.defaultInterpolation } : {}),
    duplicateTimePolicy: options.duplicateTimePolicy ?? 'error',
    diagnostics: { durationSecs, duplicateTimePolicy: options.duplicateTimePolicy ?? 'error', warnings: [] },
  };
}

export function evaluateSpatialAimTrack(track, timeSecs, context = {}) {
  const keys = Array.isArray(track?.keys) ? track.keys : [];
  if (keys.length === 0) throw new TypeError('Aim tracks require at least one key.');
  const clampedTime = clamp(finiteNumber(timeSecs, 0), 0, Math.max(0, finiteNumber(track.durationSecs, 0)));
  const bracket = findTimedBracket(keys, clampedTime);
  const key = bracket.left;
  const observerPc = context.observerPc ?? context.positionSample?.pose?.observerPc;
  if (!observerPc && key.aim?.kind === 'target') {
    throw new TypeError('Target aim track evaluation requires observerPc or positionSample.pose.observerPc.');
  }
  const sample = evaluateSpatialAim({
    observerPc: observerPc ?? SPATIAL_ZERO_VECTOR,
    aim: interpolateAim(bracket, clampedTime, context),
    syntheticTargetDistancePc: context.syntheticTargetDistancePc,
  });
  return {
    timeSecs: clampedTime,
    aim: sample,
    segmentIndex: bracket.segmentIndex,
    ...copySource(key),
    diagnostics: { warnings: [] },
  };
}

export function normalizeSpatialPathSpec(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialPathSpec object.');
  const duplicateTimePolicy = input.duplicateTimePolicy ?? 'error';
  const positionKeys = normalizePositionKeys(input.positionKeys, duplicateTimePolicy);
  if (positionKeys.length === 0) throw new TypeError('SpatialPathSpec.positionKeys must contain at least one key.');
  const aimKeys = input.aimKeys === undefined ? [] : normalizeAimKeys(input.aimKeys, duplicateTimePolicy);
  const durationSecs = input.durationSecs !== undefined
    ? positiveNumber(input.durationSecs, 0)
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
  const samples = [];
  let frameIndex = 0;
  for (let elapsedSecs = 0; elapsedSecs <= duration + sampling.sampleStepSecs * 0.5; elapsedSecs += sampling.sampleStepSecs) {
    if (samples.length >= sampling.maxSamples) break;
    const sample = normalized.timeRemap
      ? evaluateSpatialPathPlayback(normalized, Math.min(elapsedSecs, duration), { ...options, frameIndex })
      : evaluateSpatialPath(normalized, Math.min(elapsedSecs, normalized.durationSecs), { ...options, frameIndex });
    samples.push(sample);
    frameIndex += 1;
    if (elapsedSecs >= duration - EPSILON) break;
  }
  return samples;
}

export function sampleSpatialPathDiagnostics(path, options = {}) {
  const normalized = normalizeSpatialPathSpec(path);
  const warnings = [];
  const sampling = normalizeSpatialSamplingOptions(options);
  const duration = normalized.timeRemap?.playbackDurationSecs ?? normalized.durationSecs;
  if (Math.ceil(duration / sampling.sampleStepSecs) + 1 > sampling.maxSamples) {
    warnings.push(warning('maxSamplesTruncatesPath', 'maxSamples truncates path sampling before the end time.'));
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
    ...(input.durationSecs !== undefined ? { durationSecs: positiveNumber(input.durationSecs, 0) } : {}),
    ...(input.position !== undefined ? { position: normalizeTransitionLane(input.position) } : {}),
    ...(input.aim !== undefined ? { aim: normalizeTransitionLane(input.aim) } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function buildSpatialViewTransitionPath(spec, options = {}) {
  const normalized = normalizeSpatialViewTransitionSpec(spec);
  const durationSecs = normalized.durationSecs
    ?? Math.max(normalized.position?.durationSecs ?? 0, normalized.aim?.durationSecs ?? 0, 1);
  const path = normalizeSpatialPathSpec({
    durationSecs,
    positionKeys: [
      { id: 'from', timeSecs: 0, positionPc: normalized.from.pose.observerPc },
      { id: 'to', timeSecs: durationSecs, positionPc: normalized.to.pose.observerPc },
    ],
    aimKeys: normalized.to.aim
      ? [
          { id: 'fromAim', timeSecs: 0, aim: normalized.from.aim?.kind ? sampleToAimSpec(normalized.from.aim) : { kind: 'orientation', orientationIcrs: normalized.from.pose.orientationIcrs } },
          { id: 'toAim', timeSecs: durationSecs, aim: sampleToAimSpec(normalized.to.aim) },
        ]
      : [
          { id: 'fromOrientation', timeSecs: 0, aim: { kind: 'orientation', orientationIcrs: normalized.from.pose.orientationIcrs } },
          { id: 'toOrientation', timeSecs: durationSecs, aim: { kind: 'orientation', orientationIcrs: normalized.to.pose.orientationIcrs } },
        ],
  });
  const diagnostics = {
    durationSecs,
    positionDurationSecs: normalized.position?.durationSecs ?? durationSecs,
    aimDurationSecs: normalized.aim?.durationSecs ?? durationSecs,
    positionDelaySecs: normalized.position?.delaySecs ?? 0,
    aimDelaySecs: normalized.aim?.delaySecs ?? 0,
    pathDiagnostics: sampleSpatialPathDiagnostics(path, options),
    warnings: [],
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
  return {
    elapsedSecs: elapsed,
    complete: elapsed >= transition.durationSecs - EPSILON,
    positionComplete: elapsed >= transition.diagnostics.positionDurationSecs - EPSILON,
    aimComplete: elapsed >= transition.diagnostics.aimDurationSecs - EPSILON,
    frameState: {
      timeSecs: sample.timeSecs,
      pose: cloneSpatialPose(sample.pose),
      aim: sample.aim,
    },
    pose: cloneSpatialPose(sample.pose),
    diagnostics: { warnings: [] },
  };
}

export function normalizeSpatialPoseTransitionSpec(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialPoseTransitionSpec object.');
  return {
    from: normalizeSpatialPose(input.from),
    to: normalizeSpatialPose(input.to),
    ...(input.durationSecs !== undefined ? { durationSecs: positiveNumber(input.durationSecs, 0) } : {}),
    ...(input.movement !== undefined ? { movement: normalizeTransitionLane(input.movement) } : {}),
    ...(input.orientation !== undefined ? { orientation: normalizeTransitionLane(input.orientation) } : {}),
  };
}

export function createSpatialPoseTransition(input) {
  const normalized = normalizeSpatialPoseTransitionSpec(input);
  const movementDuration = normalized.movement?.durationSecs ?? normalized.durationSecs ?? 1;
  const orientationDuration = normalized.orientation?.durationSecs ?? normalized.durationSecs ?? 1;
  return {
    durationSecs: Math.max(movementDuration, orientationDuration),
    from: normalized.from,
    to: normalized.to,
    movement: normalized.movement ?? { durationSecs: movementDuration },
    orientation: normalized.orientation ?? { durationSecs: orientationDuration },
  };
}

export function evaluateSpatialPoseTransition(transition, elapsedSecs) {
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const movementDuration = positiveNumber(transition.movement?.durationSecs, transition.durationSecs);
  const orientationDuration = positiveNumber(transition.orientation?.durationSecs, transition.durationSecs);
  const moveT = movementDuration <= EPSILON ? 1 : smoothstep01(clamp(elapsed / movementDuration, 0, 1));
  const orientationT = orientationDuration <= EPSILON ? 1 : smoothstep01(clamp(elapsed / orientationDuration, 0, 1));
  return {
    elapsedSecs: elapsed,
    complete: elapsed >= transition.durationSecs - EPSILON,
    movementComplete: elapsed >= movementDuration - EPSILON,
    orientationComplete: elapsed >= orientationDuration - EPSILON,
    pose: {
      observerPc: lerpVector(transition.from.observerPc, transition.to.observerPc, moveT),
      orientationIcrs: slerpQuaternions(transition.from.orientationIcrs, transition.to.orientationIcrs, orientationT),
    },
    diagnostics: { warnings: [] },
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
  return Math.max(0, finiteNumber(input.deltaSecs, 0));
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

export function createSpatialNavigationAutomation(options = {}) {
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
  let disposed = false;

  return {
    flyRoute(route) {
      assertNavigationActive();
      activeRoute = route;
      activeOrbit = null;
      elapsedSecs = 0;
    },
    orbit(orbit) {
      assertNavigationActive();
      activeOrbit = normalizeSpatialOrbitSpec(orbit);
      activeRoute = null;
      elapsedSecs = 0;
    },
    lookAt(aim) {
      assertNavigationActive();
      activeAim = normalizeSpatialAimSpec(aim);
      targetLock = null;
    },
    lockAt(aim) {
      assertNavigationActive();
      const normalized = normalizeSpatialAimSpec(aim);
      if (normalized.kind !== 'target') throw new TypeError('lockAt() requires target aim.');
      activeAim = normalized;
      targetLock = { targetPc: cloneSpatialVector3(normalized.targetPc), aim: null };
    },
    unlockAt() {
      assertNavigationActive();
      if (targetLock) {
        targetLock = null;
        activeAim = null;
      }
    },
    cancel() {
      assertNavigationActive();
      activeRoute = null;
      activeOrbit = null;
      activeAim = null;
      targetLock = null;
      elapsedSecs = 0;
    },
    update(input) {
      assertNavigationActive();
      const dt = normalizeSpatialUpdateDelta(input);
      elapsedSecs += dt;
      let pose = normalizeSpatialPose(input.pose);
      if (activeRoute) {
        const sample = evaluateSpatialRoute(activeRoute, elapsedSecs);
        pose = { ...pose, observerPc: sample.positionPc };
        currentSpeedPcPerSec = sample.speedPcPerSec;
        if (sample.complete) {
          applyArrivalAction(activeRoute.arrivalAction);
          if (!activeOrbit) activeRoute = null;
        }
      }
      if (activeOrbit) {
        const sample = evaluateSpatialOrbit(activeOrbit, elapsedSecs);
        pose = { observerPc: sample.positionPc, orientationIcrs: sample.aim.orientationIcrs };
        currentSpeedPcPerSec = sample.speedPcPerSec;
      }
      let aim = null;
      const aimSpec = activeAim ?? activeOrbit?.aim ?? null;
      if (aimSpec) {
        aim = evaluateSpatialAim({ observerPc: pose.observerPc, aim: aimSpec });
        pose = { ...pose, orientationIcrs: aim.orientationIcrs };
      }
      if (targetLock && aim?.kind === 'target') {
        targetLock = { targetPc: cloneSpatialVector3(aim.targetPc), aim };
      }
      frameState = {
        pose: cloneSpatialPose(pose),
        aim,
        targetLock,
        orbit: activeOrbit ? {
          orbit: activeOrbit,
          angleRad: finiteNumber(activeOrbit.initialAngleRad, 0) + finiteNumber(activeOrbit.angularSpeedRadPerSec, 0) * elapsedSecs,
          basis: createSpatialOrbitBasis(activeOrbit),
          speedPcPerSec: Math.abs(finiteNumber(activeOrbit.angularSpeedRadPerSec, 0)) * activeOrbit.radiusPc,
        } : null,
        pathFollow: activeRoute ? {
          routeId: activeRoute.id,
          routeKind: activeRoute.kind,
          distancePc: Math.min(activeRoute.totalLengthPc, activeRoute.totalLengthPc * elapsedSecs / Math.max(activeRoute.timing.durationSecs, EPSILON)),
          speedPcPerSec: currentSpeedPcPerSec,
          segmentIndex: null,
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
        activeAim: { aim: frameState.aim, targetLock, manualLookActive: false },
        elapsedSecs,
        durationSecs: activeRoute?.timing?.durationSecs,
        frameState: cloneFrameState(frameState),
        activeRoute,
        activeTiming: activeRoute?.timing ?? null,
        currentSpeedPcPerSec,
        arrivalAction: activeRoute?.arrivalAction ?? null,
        pendingSettle: null,
        warnings: [],
      };
    },
    dispose() {
      disposed = true;
      activeRoute = null;
      activeOrbit = null;
      activeAim = null;
      targetLock = null;
    },
  };

  function assertNavigationActive() {
    if (disposed) throw new Error('Spatial navigation automation is disposed.');
  }

  function applyArrivalAction(action) {
    if (!action || action.kind === 'none') return;
    if (action.kind === 'orbit' || action.kind === 'orbitalInsert') {
      const handoff = deriveSpatialOrbitHandoff({
        positionPc: activeRoute.arrival.positionPc,
        orbit: action.orbit,
      });
      activeOrbit = handoff.orbit;
      activeAim = action.aim ?? action.orbit.aim ?? activeAim;
      activeRoute = null;
      elapsedSecs = 0;
      return;
    }
    if (action.kind === 'lookAt' || action.kind === 'lockAt') {
      activeAim = action.aim;
      if (action.kind === 'lockAt') {
        targetLock = { targetPc: cloneSpatialVector3(action.aim.targetPc), aim: null };
      }
    }
  }
}

function createManualMotionModel(options, kind) {
  const moveSpeedPcPerSec = positiveNumber(options.moveSpeedPcPerSec, 1);
  const boostMultiplier = positiveNumber(options.boostMultiplier, 1);
  const pitchRateRadPerSec = positiveNumber(options.pitchRateRadPerSec, Math.PI / 3);
  const yawRateRadPerSec = positiveNumber(options.yawRateRadPerSec, Math.PI / 3);
  const rollRateRadPerSec = positiveNumber(options.rollRateRadPerSec, Math.PI / 3);
  let velocityPcPerSec = cloneSpatialVector3(SPATIAL_ZERO_VECTOR);
  return {
    update(input) {
      const dt = normalizeSpatialUpdateDelta(input);
      const controls = input.controls ?? {};
      const pose = normalizeSpatialPose(input.pose);
      const moveAxis = controls.getAxis?.(options.moveAxis ?? 'move') ?? { x: 0, y: 0, magnitude: 0, active: false };
      const attitudeAxis = controls.getAxis?.(options.attitudeAxis ?? 'attitude') ?? { x: 0, y: 0, magnitude: 0, active: false };
      const boosted = controls.isPressed?.(options.boostButton ?? 'boost') === true;
      let orientationIcrs = pose.orientationIcrs;
      if (attitudeAxis.active) {
        orientationIcrs = rotateSpatialLocalAxis(orientationIcrs, SPATIAL_LOCAL_RIGHT, attitudeAxis.y * pitchRateRadPerSec * dt);
        orientationIcrs = rotateSpatialLocalAxis(orientationIcrs, SPATIAL_LOCAL_UP, -attitudeAxis.x * yawRateRadPerSec * dt);
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
      const speed = moveSpeedPcPerSec * (boosted ? boostMultiplier : 1);
      velocityPcPerSec = getSpatialVectorLength(move) > EPSILON
        ? scaleSpatialVector(normalizeSpatialDirection(move), speed)
        : cloneSpatialVector3(SPATIAL_ZERO_VECTOR);
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
        scale: normalizeSpatialScaleProfile(),
        activeAutomation: null,
      };
    },
    dispose() {},
  };
}

function normalizeSpatialFrameState(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialFrameState object.');
  return {
    ...(input.timeSecs !== undefined ? { timeSecs: finiteNumber(input.timeSecs, 0) } : {}),
    ...(input.frameIndex !== undefined ? { frameIndex: Math.max(0, Math.floor(finiteNumber(input.frameIndex, 0))) } : {}),
    pose: normalizeSpatialPose(input.pose),
    aim: input.aim == null ? null : input.aim,
    ...(input.targetLock !== undefined ? { targetLock: input.targetLock } : {}),
    ...(input.orbit !== undefined ? { orbit: input.orbit } : {}),
    ...(input.pathFollow !== undefined ? { pathFollow: input.pathFollow } : {}),
    ...(input.fovDeg !== undefined ? { fovDeg: positiveNumber(input.fovDeg, 0) } : {}),
  };
}

function endpointFromSpec(spec, options) {
  let positionPc = spec.positionPc ? cloneSpatialVector3(spec.positionPc) : null;
  let destination = spec.destination ?? null;
  const orbit = spec.orbit ?? destination?.orbit ?? options.fallbackOrbit ?? null;
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
    if (!(lengthPc > EPSILON)) continue;
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

function interpolateRoutePoints(startPc, endPc, travel) {
  const distance = getSpatialVectorLength(subtractSpatialVectors(endPc, startPc));
  const step = positiveNumber(travel.sampleStepSecs, 1);
  const maxPoints = positiveInteger(travel.maxPoints, 32);
  const pointCount = Math.max(2, Math.min(maxPoints, Math.ceil(distance / step) + 1));
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    points.push(lerpVector(startPc, endPc, pointCount === 1 ? 1 : index / (pointCount - 1)));
  }
  return points;
}

function routeDiagnostics(totalLengthPc, timing, overrides = {}) {
  const averageSpeedPcPerSec = timing.durationSecs > EPSILON ? totalLengthPc / timing.durationSecs : 0;
  return {
    durationSecs: timing.durationSecs,
    totalLengthPc,
    averageSpeedPcPerSec,
    peakSpeedPcPerSec: Math.max(averageSpeedPcPerSec, timing.peakSpeedPcPerSec ?? 0),
    departureSpeedPcPerSec: timing.departureSpeedPcPerSec ?? 0,
    arrivalSpeedPcPerSec: timing.arrivalSpeedPcPerSec ?? 0,
    warnings: [],
    ...overrides,
  };
}

function sampleRouteAtDistance(route, distancePc) {
  if (route.segments.length === 0) {
    return {
      positionPc: cloneSpatialVector3(route.pointsPc[0]),
      velocityPcPerSec: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
      speedPcPerSec: 0,
      segmentIndex: null,
    };
  }
  const clampedDistance = clamp(distancePc, 0, route.totalLengthPc);
  const segment = route.segments.find((candidate) => clampedDistance <= candidate.cumulativeEndPc + EPSILON)
    ?? route.segments[route.segments.length - 1];
  const localDistance = clamp(clampedDistance - segment.cumulativeStartPc, 0, segment.lengthPc);
  const t = segment.lengthPc > EPSILON ? localDistance / segment.lengthPc : 0;
  const direction = normalizeDirectionOr(subtractSpatialVectors(segment.endPc, segment.startPc), SPATIAL_ZERO_VECTOR);
  const speed = route.timing.durationSecs > EPSILON ? route.totalLengthPc / route.timing.durationSecs : 0;
  return {
    positionPc: lerpVector(segment.startPc, segment.endPc, t),
    velocityPcPerSec: scaleSpatialVector(direction, speed),
    speedPcPerSec: speed,
    segmentIndex: segment.index,
  };
}

function deriveTimingProfile(input) {
  const distancePc = Math.max(0, finiteNumber(input.distancePc, 0));
  const requestedDuration = input.durationSecs !== undefined ? positiveNumber(input.durationSecs, 0) : null;
  const requestedSpeed = input.speedPcPerSec !== undefined ? positiveNumber(input.speedPcPerSec, 0) : null;
  const durationSecs = requestedDuration ?? (requestedSpeed && requestedSpeed > EPSILON ? distancePc / requestedSpeed : distancePc);
  const speedPcPerSec = durationSecs > EPSILON ? distancePc / durationSecs : 0;
  return {
    kind: input.kind ?? 'duration',
    durationSecs,
    distancePc,
    departureSpeedPcPerSec: Math.max(0, finiteNumber(input.departureSpeedPcPerSec, 0)),
    cruiseSpeedPcPerSec: speedPcPerSec,
    arrivalSpeedPcPerSec: Math.max(0, finiteNumber(input.arrivalSpeedPcPerSec, speedPcPerSec)),
    peakSpeedPcPerSec: speedPcPerSec,
    phases: [{
      kind: distancePc > EPSILON ? 'cruise' : 'hold',
      startTimeSecs: 0,
      endTimeSecs: durationSecs,
      startDistancePc: 0,
      endDistancePc: distancePc,
      startSpeedPcPerSec: speedPcPerSec,
      endSpeedPcPerSec: speedPcPerSec,
    }],
    diagnostics: { requestedDurationSecs: requestedDuration ?? undefined, warnings: [] },
  };
}

function isTimingProfile(input) {
  return Boolean(input && typeof input === 'object' && Array.isArray(input.phases) && Number.isFinite(input.durationSecs));
}

function cloneTimingProfile(profile) {
  return {
    ...profile,
    phases: profile.phases.map((phase) => ({ ...phase })),
    diagnostics: { ...(profile.diagnostics ?? {}), warnings: [...(profile.diagnostics?.warnings ?? [])] },
  };
}

function normalizeSpatialTimeRemap(input, pathDurationSecs) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialTimeRemapSpec object.');
  if (input.kind !== 'linear' && input.kind !== 'eased') {
    throw new TypeError('Path timeRemap supports only linear and eased.');
  }
  return {
    kind: input.kind,
    ...(input.playbackDurationSecs !== undefined ? { playbackDurationSecs: positiveNumber(input.playbackDurationSecs, 0) } : { playbackDurationSecs: pathDurationSecs }),
    ...(input.easing !== undefined ? { easing: normalizeEasing(input.easing) } : {}),
  };
}

function normalizeSpatialSamplingOptions(input = {}) {
  if ('stepSecs' in input) throw new TypeError('Use sampleStepSecs instead of stepSecs.');
  const frameRateStep = input.frameRate !== undefined ? 1 / positiveNumber(input.frameRate, 1) : null;
  const sampleStepSecs = input.sampleStepSecs !== undefined
    ? positiveNumber(input.sampleStepSecs, 0)
    : frameRateStep ?? DEFAULT_SAMPLE_STEP_SECS;
  if (frameRateStep != null && Math.abs(frameRateStep - sampleStepSecs) > 1e-9) {
    throw new RangeError('sampleStepSecs and frameRate imply different sampling intervals.');
  }
  return {
    sampleStepSecs,
    maxSamples: input.maxSamples !== undefined ? positiveInteger(input.maxSamples, 1) : Number.POSITIVE_INFINITY,
  };
}

function normalizePositionKeys(keys, duplicateTimePolicy) {
  const normalized = Array.from(keys ?? []).map((key, index) => ({
    id: String(key?.id ?? `position-${index}`),
    timeSecs: finiteTime(key?.timeSecs),
    positionPc: normalizeSpatialVector3(key?.positionPc),
    ...(key?.interpolation !== undefined ? { interpolation: key.interpolation } : {}),
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
    ...(key?.interpolation !== undefined ? { interpolation: key.interpolation } : {}),
    ...copySource(key ?? {}),
    ...(key?.metadata && typeof key.metadata === 'object' ? { metadata: { ...key.metadata } } : {}),
  })).sort(compareTime);
  return applyDuplicateTimePolicy(normalized, duplicateTimePolicy);
}

function applyDuplicateTimePolicy(keys, policy) {
  if (keys.length < 2) return keys;
  if (policy === 'error' || policy == null) {
    for (let index = 1; index < keys.length; index += 1) {
      if (Math.abs(keys[index].timeSecs - keys[index - 1].timeSecs) <= EPSILON) {
        throw new RangeError('Duplicate time keys require an explicit non-error duplicateTimePolicy.');
      }
    }
    return keys;
  }
  if (policy === 'coalesceFirst') {
    return keys.filter((key, index) => index === 0 || Math.abs(key.timeSecs - keys[index - 1].timeSecs) > EPSILON);
  }
  if (policy === 'coalesceLast') {
    return keys.filter((key, index) => index === keys.length - 1 || Math.abs(key.timeSecs - keys[index + 1].timeSecs) > EPSILON);
  }
  if (policy === 'hold' || policy === 'cut' || policy === 'preserve') return keys;
  throw new TypeError(`Unsupported duplicateTimePolicy: ${String(policy)}`);
}

function assertKeysWithinDuration(keys, durationSecs) {
  for (const key of keys) {
    if (key.timeSecs > durationSecs + EPSILON) {
      throw new RangeError('Path key timeSecs cannot exceed durationSecs.');
    }
  }
}

function evaluatePositionKeys(keys, timeSecs) {
  const bracket = findTimedBracket(keys, timeSecs);
  const left = bracket.left;
  const right = bracket.right;
  if (!right || left === right) {
    return pathPositionSample(timeSecs, left.positionPc, SPATIAL_ZERO_VECTOR, 0, null, left.id);
  }
  const duration = Math.max(EPSILON, right.timeSecs - left.timeSecs);
  const t = clamp((timeSecs - left.timeSecs) / duration, 0, 1);
  const positionPc = lerpVector(left.positionPc, right.positionPc, smoothstep01(t));
  const velocityPcPerSec = scaleSpatialVector(subtractSpatialVectors(right.positionPc, left.positionPc), 1 / duration);
  return pathPositionSample(timeSecs, positionPc, velocityPcPerSec, getSpatialVectorLength(velocityPcPerSec), bracket.segmentIndex, left.id);
}

function pathPositionSample(timeSecs, positionPc, velocityPcPerSec, speedPcPerSec, segmentIndex, segmentId) {
  return {
    timeSecs,
    pose: {
      observerPc: cloneSpatialVector3(positionPc),
      orientationIcrs: cloneSpatialQuaternion(SPATIAL_IDENTITY_QUATERNION),
    },
    aim: null,
    velocityPcPerSec: cloneSpatialVector3(velocityPcPerSec),
    speedPcPerSec,
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

function interpolateAim(bracket) {
  if (!bracket.right || bracket.left === bracket.right || bracket.left.aim.kind !== 'orientation' || bracket.right.aim.kind !== 'orientation') {
    return bracket.t >= 1 ? bracket.right.aim : bracket.left.aim;
  }
  return {
    kind: 'orientation',
    orientationIcrs: slerpQuaternions(bracket.left.aim.orientationIcrs, bracket.right.aim.orientationIcrs, smoothstep01(bracket.t)),
  };
}

function remapPathTime(path, elapsedSecs) {
  if (!path.timeRemap) return clamp(elapsedSecs, 0, path.durationSecs);
  const playbackDuration = positiveNumber(path.timeRemap.playbackDurationSecs, path.durationSecs);
  let t = playbackDuration > EPSILON ? clamp(elapsedSecs / playbackDuration, 0, 1) : 1;
  if (path.timeRemap.kind === 'eased') t = applyEasing(path.timeRemap.easing ?? { kind: 'smoothstep' }, t);
  return t * path.durationSecs;
}

function normalizeEasing(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialEasingSpec object.');
  if (!['linear', 'smoothstep', 'easeIn', 'easeOut', 'easeInOut', 'cubicBezier'].includes(input.kind)) {
    throw new TypeError(`Unsupported easing kind: ${String(input.kind)}`);
  }
  return { ...input };
}

function applyEasing(easing, t) {
  if (easing.kind === 'linear') return t;
  if (easing.kind === 'easeIn') return t ** positiveNumber(easing.power, 2);
  if (easing.kind === 'easeOut') return 1 - (1 - t) ** positiveNumber(easing.power, 2);
  if (easing.kind === 'easeInOut') {
    const power = positiveNumber(easing.power, 2);
    return t < 0.5 ? 0.5 * (2 * t) ** power : 1 - 0.5 * (2 * (1 - t)) ** power;
  }
  return smoothstep01(t);
}

function normalizeTransitionLane(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialTransitionLaneSpec object.');
  return {
    ...(input.durationSecs !== undefined ? { durationSecs: positiveNumber(input.durationSecs, 0) } : {}),
    ...(input.delaySecs !== undefined ? { delaySecs: Math.max(0, finiteNumber(input.delaySecs, 0)) } : {}),
    ...(input.easing !== undefined ? { easing: normalizeEasing(input.easing) } : {}),
    ...(input.interpolation !== undefined ? { interpolation: String(input.interpolation) } : {}),
  };
}

function sampleToAimSpec(sample) {
  if (sample.kind === 'target') {
    return { kind: 'target', targetPc: sample.targetPc, upIcrs: sample.upIcrs };
  }
  return { kind: 'orientation', orientationIcrs: sample.orientationIcrs };
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
  let up = authoredUp ? normalizeDirectionOr(authoredUp, null) : cloneSpatialVector3(SPATIAL_LOCAL_UP);
  up = subtractSpatialVectors(up, scaleSpatialVector(forward, dot(up, forward)));
  if (getSpatialVectorLength(up) <= EPSILON) {
    warnings.push(warning('degenerateAimUp', 'Aim up vector was parallel to forward.'));
    up = perpendicularTo(forward);
  }
  up = normalizeDirectionOr(up, SPATIAL_LOCAL_UP);
  if (positionAngleDeg !== undefined) {
    up = applySpatialQuaternion(up, createSpatialQuaternionFromAxisAngle(forward, degreesToRadians(positionAngleDeg)));
  }
  return normalizeDirectionOr(up, SPATIAL_LOCAL_UP);
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
  return length > EPSILON ? scaleSpatialVector(vector, 1 / length) : fallback ? cloneSpatialVector3(fallback) : null;
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

function finiteTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError('timeSecs must be a non-negative finite number.');
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
