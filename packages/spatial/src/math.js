import {
  EPSILON,
  clamp,
  finiteNumber,
  finiteRequiredNumber,
  positiveFiniteNumber,
} from './numerics.js';

export const SPATIAL_ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });

export const SPATIAL_LOCAL_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });

export const SPATIAL_LOCAL_UP = Object.freeze({ x: 0, y: 1, z: 0 });

export const SPATIAL_LOCAL_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });

export const SPATIAL_IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const DEFAULT_SPATIAL_SCALE_PROFILE = Object.freeze({ worldUnitsPerUnit: 1 });

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

export function normalizeSpatialScaleProfile(input = DEFAULT_SPATIAL_SCALE_PROFILE) {
  if (input == null) input = DEFAULT_SPATIAL_SCALE_PROFILE;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected a spatial scale profile.');
  if ('metersPerUnit' in input || 'frameId' in input || 'space' in input || 'navigationUnits' in input || 'metersPerNavigationUnit' in input || 'worldUnitsPerNavigationUnit' in input) throw new TypeError('Physical units belong to space; use worldUnitsPerUnit for presentation scale.');
  if (input.worldUnitsPerUnit !== undefined && typeof input.worldUnitsPerUnit !== 'number') throw new TypeError('worldUnitsPerUnit must be a number.');
  return { worldUnitsPerUnit: input.worldUnitsPerUnit === undefined ? 1 : positiveFiniteNumber(input.worldUnitsPerUnit, 'worldUnitsPerUnit') };
}

export function cloneSpatialVector3(value) {
  return { x: value.x, y: value.y, z: value.z };
}

export function cloneSpatialQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
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
  const { x, y, z } = vector;
  const { x: qx, y: qy, z: qz, w: qw } = quaternion;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return { x: x + qw * tx + qy * tz - qz * ty,
    y: y + qw * ty + qz * tx - qx * tz,
    z: z + qw * tz + qx * ty - qy * tx };
}

export function rotateSpatialLocalAxis(orientation, localAxis, angleRad) {
  if (!(Math.abs(finiteNumber(angleRad, 0)) > 0)) {
    return cloneSpatialQuaternion(orientation);
  }
  return multiplySpatialQuaternions(
    orientation,
    createSpatialQuaternionFromAxisAngle(localAxis, angleRad),
  );
}

export function interpolateSpatialDirections(left, right, fraction, options = {}) {
  const from = normalizeSpatialVector3(left);
  const to = normalizeSpatialVector3(right);
  if (getSpatialVectorLength(from) === 0 || getSpatialVectorLength(to) === 0) throw new RangeError('Direction interpolation requires nonzero directions.');
  const a = normalizeSpatialDirection(from);
  const b = normalizeSpatialDirection(to);
  const t = clamp(finiteRequiredNumber(fraction, 'fraction'), 0, 1);
  if (t === 0) return a;
  if (t === 1) return b;
  const cos = clamp(dotSpatialVectors(a, b), -1, 1);
  if (cos > 0.9995) return normalizeSpatialDirection(lerpVector(a, b, t));
  const threshold = options.antipodalCosineThreshold ?? -1 + 1e-12;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < -1 || threshold >= 0) throw new RangeError('antipodalCosineThreshold must be in [-1, 0).');
  if (cos <= threshold) {
    const authored = options.antipodalTangent === undefined ? perpendicularTo(a) : normalizeSpatialVector3(options.antipodalTangent);
    const projected = subtractSpatialVectors(authored, scaleSpatialVector(a, dotSpatialVectors(authored, a)));
    if (getSpatialVectorLength(projected) === 0) throw new RangeError('Antipodal tangent must not be parallel to the direction.');
    const tangent = normalizeSpatialDirection(projected);
    return normalizeSpatialDirection(addSpatialVectors(
      scaleSpatialVector(a, Math.cos(Math.PI * t)), scaleSpatialVector(tangent, Math.sin(Math.PI * t)),
    ));
  }
  const angle = Math.atan2(getSpatialVectorLength(crossSpatialVectors(a, b)), cos);
  const sine = Math.sin(angle);
  return normalizeSpatialDirection(addSpatialVectors(
    scaleSpatialVector(a, Math.sin((1 - t) * angle) / sine),
    scaleSpatialVector(b, Math.sin(t * angle) / sine),
  ));
}

export function createSpatialQuaternionFromForwardUp(forward, up) {
  const f = normalizeDirectionOr(forward, SPATIAL_LOCAL_FORWARD);
  let r = crossSpatialVectors(f, up);
  if (getSpatialVectorLength(r) <= EPSILON) r = crossSpatialVectors(f, SPATIAL_LOCAL_UP);
  if (getSpatialVectorLength(r) <= EPSILON) r = crossSpatialVectors(f, SPATIAL_LOCAL_RIGHT);
  r = normalizeDirectionOr(r, SPATIAL_LOCAL_RIGHT);
  const u = normalizeDirectionOr(crossSpatialVectors(r, f), SPATIAL_LOCAL_UP);

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

export function interpolateSpatialQuaternions(a, b, t) {
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

export function normalizeDirectionOr(vector, fallback) {
  if (!vector) return fallback ? cloneSpatialVector3(fallback) : null;
  const length = getSpatialVectorLength(vector);
  return length > 0 ? scaleSpatialVector(vector, 1 / length) : fallback ? cloneSpatialVector3(fallback) : null;
}

export function perpendicularTo(vector) {
  const axis = Math.abs(vector.y) < 0.9 ? SPATIAL_LOCAL_UP : SPATIAL_LOCAL_RIGHT;
  return normalizeDirectionOr(crossSpatialVectors(vector, axis), SPATIAL_LOCAL_RIGHT);
}

export function crossSpatialVectors(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function dotSpatialVectors(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function combineSpatialVectors(terms) {
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

export function lerp(left, right, t) {
  return left + (right - left) * t;
}

export function lerpVector(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function invertSpatialQuaternion(value) {
  const q = normalizeSpatialQuaternion(value);
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export const SPATIAL_Z_UP_TO_Y_UP = Object.freeze({ x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 });

/** Required semantic coordinates must not silently default to the origin. */
export function requiredSpatialVector3(value, label) {
  if (value == null) throw new TypeError(label + ' is required.');
  return normalizeSpatialVector3(value);
}
