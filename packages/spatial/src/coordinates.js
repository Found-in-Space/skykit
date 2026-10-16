import {
  SPATIAL_ZERO_VECTOR,
  addSpatialVectors,
  getSpatialVectorLength,
  normalizeDirectionOr,
  normalizeSpatialVector3,
  scaleSpatialVector,
  subtractSpatialVectors,
} from './math.js';
import {
  clamp,
  degreesToRadians,
  finiteNumberInRange,
  finiteRequiredNumber,
  positiveFiniteNumber,
  radiansToDegrees,
} from './numerics.js';
import {
  normalizeSpatialCoordinateSpace,
  spatialSpaceFor,
} from './spaces.js';

export function raDecToIcrsDirection(input) {
  if (!input || typeof input !== 'object' || (input.raDeg !== undefined) === (input.raHours !== undefined)) throw new TypeError('Supply exactly one of raDeg or raHours.');
  const decDeg = finiteNumberInRange(input.decDeg, -90, 90, 'decDeg');
  const rawRa = input.raDeg !== undefined ? finiteRequiredNumber(input.raDeg, 'raDeg') : finiteRequiredNumber(input.raHours, 'raHours') * 15;
  const ra = degreesToRadians(((rawRa % 360) + 360) % 360);
  const dec = degreesToRadians(decDeg);
  const cosDec = Math.cos(dec);
  return { x: cosDec * Math.cos(ra), y: cosDec * Math.sin(ra), z: Math.sin(dec) };
}

export function raDecDistanceToIcrs(input) {
  spatialSpaceFor(input);
  return scaleSpatialVector(raDecToIcrsDirection(input), positiveFiniteNumber(input.distance, 'distance'));
}

export function icrsToRaDec(point, observer = SPATIAL_ZERO_VECTOR) {
  const offset = subtractSpatialVectors(normalizeSpatialVector3(point), normalizeSpatialVector3(observer));
  const length = getSpatialVectorLength(offset);
  if (length === 0) return null;
  const unit = scaleSpatialVector(offset, 1 / length);
  const raDeg = (radiansToDegrees(Math.atan2(unit.y, unit.x)) + 360) % 360;
  return { raDeg, raHours: raDeg / 15, decDeg: radiansToDegrees(Math.asin(clamp(unit.z, -1, 1))) };
}

export function icrsDirectionToTarget(direction, distance, space, observer = SPATIAL_ZERO_VECTOR) {
  normalizeSpatialCoordinateSpace(space);
  const unit = normalizeDirectionOr(normalizeSpatialVector3(direction), null);
  const length = positiveFiniteNumber(distance, 'distance');
  return unit ? addSpatialVectors(normalizeSpatialVector3(observer), scaleSpatialVector(unit, length)) : null;
}

export function projectSpatialEquirectangular(input) {
  const width = positiveFiniteNumber(input?.width, 'width');
  const height = positiveFiniteNumber(input?.height, 'height');
  const raDeg = finiteRequiredNumber(input?.raDeg, 'raDeg');
  const decDeg = finiteNumberInRange(input?.decDeg, -90, 90, 'decDeg');
  return { x: ((raDeg % 360) + 360) % 360 / 360 * width, y: (0.5 - decDeg / 180) * height };
}
