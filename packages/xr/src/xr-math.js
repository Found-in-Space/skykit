export const LOCAL_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
export const LOCAL_UP = Object.freeze({ x: 0, y: 1, z: 0 });
export const LOCAL_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });
export const IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 });

export const DEFAULT_XR_SCALE_PROFILE = Object.freeze({
  navigationUnits: 'pc',
  metersPerNavigationUnit: 1,
  worldUnitsPerNavigationUnit: 1,
});

/**
 * @param {unknown} value
 * @param {{ x: number; y: number; z: number }} [fallback]
 */
export function normalizeVector3(value, fallback = ZERO_VECTOR) {
  if (!value || typeof value !== 'object') {
    return cloneVector3(fallback);
  }
  const point = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (![x, y, z].every(Number.isFinite)) {
    return cloneVector3(fallback);
  }
  return { x, y, z };
}

/**
 * @param {unknown} value
 * @param {{ x: number; y: number; z: number; w: number }} [fallback]
 */
export function normalizeQuaternion(value, fallback = IDENTITY_QUATERNION) {
  if (!value || typeof value !== 'object') {
    return cloneQuaternion(fallback);
  }
  const q = /** @type {{ x?: unknown; y?: unknown; z?: unknown; w?: unknown }} */ (value);
  const x = Number(q.x);
  const y = Number(q.y);
  const z = Number(q.z);
  const w = Number(q.w);
  const length = Math.hypot(x, y, z, w);
  if (!(length > 0)) {
    return cloneQuaternion(fallback);
  }
  return {
    x: x / length,
    y: y / length,
    z: z / length,
    w: w / length,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} value
 */
export function cloneVector3(value) {
  return { x: value.x, y: value.y, z: value.z };
}

/**
 * @param {{ x: number; y: number; z: number; w: number }} value
 */
export function cloneQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

/**
 * @param {{ position?: unknown; orientation?: unknown }} value
 */
export function normalizePose(value = {}) {
  return {
    position: normalizeVector3(value.position, ZERO_VECTOR),
    orientation: normalizeQuaternion(value.orientation, IDENTITY_QUATERNION),
  };
}

/**
 * @param {{ position: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number } }} pose
 */
export function clonePose(pose) {
  return {
    position: cloneVector3(pose.position),
    orientation: cloneQuaternion(pose.orientation),
  };
}

/**
 * @param {unknown} value
 */
export function normalizeScaleProfile(value = DEFAULT_XR_SCALE_PROFILE) {
  const profile = value && typeof value === 'object'
    ? /** @type {{ navigationUnits?: unknown; metersPerNavigationUnit?: unknown; worldUnitsPerNavigationUnit?: unknown }} */ (value)
    : {};
  const metersPerNavigationUnit = positiveFinite(profile.metersPerNavigationUnit, 1);
  return {
    navigationUnits: typeof profile.navigationUnits === 'string'
      ? profile.navigationUnits
      : 'pc',
    metersPerNavigationUnit,
    worldUnitsPerNavigationUnit: positiveFinite(
      profile.worldUnitsPerNavigationUnit,
      metersPerNavigationUnit,
    ),
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * @param {{ x: number; y: number; z: number }} a
 * @param {{ x: number; y: number; z: number }} b
 */
export function addVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * @param {{ x: number; y: number; z: number }} a
 * @param {{ x: number; y: number; z: number }} b
 */
export function subtractVectors(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * @param {{ x: number; y: number; z: number }} v
 * @param {number} scalar
 */
export function scaleVector(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

/**
 * @param {{ x: number; y: number; z: number }} v
 */
export function vectorLength(v) {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * @param {{ x: number; y: number; z: number }} v
 */
export function normalizeDirection(v) {
  const length = vectorLength(v);
  return length > 0 ? scaleVector(v, 1 / length) : cloneVector3(LOCAL_FORWARD);
}

/**
 * @param {{ x: number; y: number; z: number; w: number }} a
 * @param {{ x: number; y: number; z: number; w: number }} b
 */
export function multiplyQuaternions(a, b) {
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

/**
 * @param {{ x: number; y: number; z: number }} axis
 * @param {number} angleRad
 */
export function quaternionFromAxisAngle(axis, angleRad) {
  const direction = normalizeDirection(axis);
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return normalizeQuaternion({
    x: direction.x * s,
    y: direction.y * s,
    z: direction.z * s,
    w: Math.cos(half),
  });
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 * @param {{ x: number; y: number; z: number; w: number }} q
 */
export function applyQuaternion(vector, q) {
  const x = vector.x;
  const y = vector.y;
  const z = vector.z;
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;

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

/**
 * @param {{ x: number; y: number; z: number; w: number }} orientation
 * @param {{ x: number; y: number; z: number }} localAxis
 * @param {number} angleRad
 */
export function rotateLocal(orientation, localAxis, angleRad) {
  if (!(Math.abs(angleRad) > 0)) {
    return cloneQuaternion(orientation);
  }
  return multiplyQuaternions(orientation, quaternionFromAxisAngle(localAxis, angleRad));
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 */
export function isNonZeroVector(vector) {
  return vectorLength(vector) > 0;
}
