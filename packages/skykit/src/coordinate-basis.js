import { raDecToIcrsDirection } from '@found-in-space/spatial';

const GALACTIC_CENTER_RA_DEG = 266.4051;
const GALACTIC_CENTER_DEC_DEG = -28.936175;
const GALACTIC_NORTH_RA_DEG = 192.85948;
const GALACTIC_NORTH_DEC_DEG = 27.12825;
const EARTH_OBLIQUITY_DEG = 23.43928;

/**
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 * @typedef {{ x: Vector3Like; y: Vector3Like; z: Vector3Like }} CoordinateBasis
 */

/**
 * @param {string} frame
 * @returns {CoordinateBasis}
 */
export function basisForFrame(frame) {
  if (frame.toLowerCase() === 'galactic') {
    const north = raDecToIcrsDirection({ raDeg: GALACTIC_NORTH_RA_DEG, decDeg: GALACTIC_NORTH_DEC_DEG })
      ?? { x: 0, y: 0, z: 1 };
    const center = raDecToIcrsDirection({ raDeg: GALACTIC_CENTER_RA_DEG, decDeg: GALACTIC_CENTER_DEC_DEG })
      ?? { x: 1, y: 0, z: 0 };
    const y = normalizeVector(cross(north, center)) ?? { x: 0, y: 1, z: 0 };
    const x = normalizeVector(cross(y, north)) ?? center;
    return { x, y, z: normalizeVector(north) ?? north };
  }
  if (frame.toLowerCase() === 'solar') {
    const obliquity = EARTH_OBLIQUITY_DEG * Math.PI / 180;
    const x = { x: 1, y: 0, z: 0 };
    const z = normalizeVector({ x: 0, y: -Math.sin(obliquity), z: Math.cos(obliquity) })
      ?? { x: 0, y: 0, z: 1 };
    const y = normalizeVector(cross(z, x)) ?? { x: 0, y: 1, z: 0 };
    return { x, y, z };
  }
  return {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 },
  };
}

/**
 * @param {CoordinateBasis} basis
 * @param {number} longitudeDeg
 * @param {number} latitudeDeg
 * @param {number} radius
 * @returns {Vector3Like}
 */
export function basisSphericalToIcrs(basis, longitudeDeg, latitudeDeg, radius) {
  const longitude = longitudeDeg * Math.PI / 180;
  const latitude = latitudeDeg * Math.PI / 180;
  const cosLat = Math.cos(latitude);
  return {
    x: (
      Math.cos(longitude) * cosLat * basis.x.x +
      Math.sin(longitude) * cosLat * basis.y.x +
      Math.sin(latitude) * basis.z.x
    ) * radius,
    y: (
      Math.cos(longitude) * cosLat * basis.x.y +
      Math.sin(longitude) * cosLat * basis.y.y +
      Math.sin(latitude) * basis.z.y
    ) * radius,
    z: (
      Math.cos(longitude) * cosLat * basis.x.z +
      Math.sin(longitude) * cosLat * basis.y.z +
      Math.sin(latitude) * basis.z.z
    ) * radius,
  };
}

/**
 * @param {Vector3Like} xAxis
 * @param {Vector3Like} yAxis
 * @param {number} radius
 * @param {number} steps
 * @returns {Vector3Like[]}
 */
export function createPlanePath(xAxis, yAxis, radius, steps) {
  /** @type {Vector3Like[]} */
  const points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = index / steps * Math.PI * 2;
    points.push({
      x: (Math.cos(angle) * xAxis.x + Math.sin(angle) * yAxis.x) * radius,
      y: (Math.cos(angle) * xAxis.y + Math.sin(angle) * yAxis.y) * radius,
      z: (Math.cos(angle) * xAxis.z + Math.sin(angle) * yAxis.z) * radius,
    });
  }
  return points;
}

/**
 * @param {Vector3Like} vector
 * @param {number} scale
 * @returns {Vector3Like}
 */
export function scaleVector(vector, scale) {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

/**
 * @param {Vector3Like} left
 * @param {Vector3Like} right
 * @returns {Vector3Like}
 */
export function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

/**
 * @param {Vector3Like} value
 * @returns {Vector3Like | null}
 */
export function normalizeVector(value) {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length <= 0) return null;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  };
}
