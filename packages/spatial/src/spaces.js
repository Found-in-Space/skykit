import {
  SPATIAL_IDENTITY_QUATERNION,
  SPATIAL_ZERO_VECTOR,
  addSpatialVectors,
  applySpatialQuaternion,
  invertSpatialQuaternion,
  multiplySpatialQuaternions,
  normalizeSpatialDirection,
  normalizeSpatialQuaternion,
  normalizeSpatialVector3,
  scaleSpatialVector,
  subtractSpatialVectors,
} from './math.js';

export const SPATIAL_METERS_PER_AU = 149_597_870_700;

export const SPATIAL_METERS_PER_PARSEC = 648_000 / Math.PI * SPATIAL_METERS_PER_AU;

/** Frame identity includes origin and axes. It is supplied by the domain owner. */
export function normalizeSpatialCoordinateSpace(input, inheritedSpace) {
  const value = input ?? inheritedSpace;
  if (!value || typeof value !== 'object' || typeof value.frameId !== 'string' || !value.frameId.trim()) {
    throw new TypeError('A coordinate space with a nonempty frameId is required.');
  }
  if (typeof value.metersPerUnit !== 'number') throw new TypeError('metersPerUnit must be a number.');
  if (!Number.isFinite(value.metersPerUnit) || value.metersPerUnit <= 0) {
    throw new RangeError('metersPerUnit must be positive and finite.');
  }
  const space = { frameId: value.frameId, metersPerUnit: value.metersPerUnit };
  if (input != null && inheritedSpace != null) assertSpatialCoordinateSpace(space, inheritedSpace);
  return space;
}

export function assertSpatialCoordinateSpace(actual, expected) {
  const a = normalizeSpatialCoordinateSpace(actual);
  const b = normalizeSpatialCoordinateSpace(expected);
  if (a.frameId !== b.frameId || a.metersPerUnit !== b.metersPerUnit) {
    throw new RangeError('Coordinate spaces differ; transform explicitly before combining them.');
  }
  return a;
}

/** Internal inheritance at semantic boundaries; never translates legacy fields. */
export function spatialSpaceFor(input, inheritedSpace) {
  if (input && typeof input === 'object') {
    for (const key of Object.keys(input)) {
      if (/Pc(?:PerSec2?)?$|Icrs$/.test(key)) {
        throw new TypeError(`Noncanonical spatial field ${key}; use contextual coordinates and an explicit space.`);
      }
    }
  }
  return normalizeSpatialCoordinateSpace(input?.space, inheritedSpace);
}

export function attachSpatialSpace(value, space) {
  return value == null ? null : { ...value, space };
}

export function normalizeSpatialTransform(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Expected a spatial transform.');
  return {
    from: normalizeSpatialCoordinateSpace(input.from),
    to: normalizeSpatialCoordinateSpace(input.to),
    sourceOrigin: normalizeSpatialVector3(input.sourceOrigin, SPATIAL_ZERO_VECTOR),
    targetOrigin: normalizeSpatialVector3(input.targetOrigin, SPATIAL_ZERO_VECTOR),
    rotation: normalizeSpatialQuaternion(input.rotation, SPATIAL_IDENTITY_QUATERNION),
  };
}

/** Rotation maps source axes to target axes; origins are in their own space units. */
export function transformSpatialPoint(transform, point) {
  const t = normalizeSpatialTransform(transform);
  return addSpatialVectors(t.targetOrigin, transformSpatialDisplacement(t,
    subtractSpatialVectors(normalizeSpatialVector3(point), t.sourceOrigin)));
}

export function transformSpatialDisplacement(transform, displacement) {
  const t = normalizeSpatialTransform(transform);
  return scaleSpatialVector(applySpatialQuaternion(normalizeSpatialVector3(displacement), t.rotation),
    t.from.metersPerUnit / t.to.metersPerUnit);
}

export function transformSpatialDirection(transform, direction) {
  const t = normalizeSpatialTransform(transform);
  const vector = normalizeSpatialVector3(direction);
  if (Math.hypot(vector.x, vector.y, vector.z) === 0) throw new RangeError('Direction must be nonzero.');
  return normalizeSpatialDirection(applySpatialQuaternion(normalizeSpatialDirection(vector), t.rotation));
}

export function transformSpatialOrientation(transform, orientation) {
  return multiplySpatialQuaternions(normalizeSpatialTransform(transform).rotation,
    normalizeSpatialQuaternion(orientation));
}

export function transformSpatialPose(transform, pose) {
  const t = normalizeSpatialTransform(transform);
  assertSpatialCoordinateSpace(pose.space, t.from);
  return { space: t.to, position: transformSpatialPoint(t, pose.position),
    orientation: transformSpatialOrientation(t, pose.orientation) };
}

export function invertSpatialTransform(transform) {
  const t = normalizeSpatialTransform(transform);
  return { from: t.to, to: t.from, sourceOrigin: t.targetOrigin, targetOrigin: t.sourceOrigin,
    rotation: invertSpatialQuaternion(t.rotation) };
}

/** Apply first, then second. Keeps the first source anchor instead of expanding absolutes. */
export function composeSpatialTransforms(first, second) {
  const a = normalizeSpatialTransform(first);
  const b = normalizeSpatialTransform(second);
  assertSpatialCoordinateSpace(a.to, b.from);
  return { from: a.from, to: b.to, sourceOrigin: a.sourceOrigin,
    targetOrigin: transformSpatialPoint(b, a.targetOrigin),
    rotation: multiplySpatialQuaternions(b.rotation, a.rotation) };
}
