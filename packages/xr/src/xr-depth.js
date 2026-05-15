import { normalizeScaleProfile, normalizeVector3, positiveFinite } from './xr-math.js';

/**
 * @param {import('./index.d.ts').XrDepthRangeOptions} [options]
 * @returns {import('./index.d.ts').XrDepthRange}
 */
export function computeXrDepthRange(options = {}) {
  const policy = options.policy ?? {};
  const near = positiveFinite(policy.near, 0.25);
  const marginFactor = positiveFinite(policy.marginFactor, 1.2);
  const minFar = positiveFinite(policy.minFar, 100);
  const maxFar = positiveFinite(policy.maxFar, 2_000_000);
  const scale = normalizeScaleProfile(options.scale);
  const observerInput = options.observer && typeof options.observer === 'object' && 'position' in options.observer
    ? options.observer.position
    : options.observer;
  const observer = normalizeVector3(observerInput, { x: 0, y: 0, z: 0 });
  const farthestBoundsDistance = computeFarthestVisibleBoundsDistance(options.visibleBounds, observer);
  const farthestObserverSphereDistance = computeFarthestObserverCentricSphereDistance(options.observerCentricSpheres);
  const requiredNavigationUnits = Math.max(
    farthestBoundsDistance,
    farthestObserverSphereDistance,
    near / scale.metersPerNavigationUnit,
  );
  const requiredMeters = requiredNavigationUnits * scale.metersPerNavigationUnit;
  const unclampedFar = requiredMeters * marginFactor;
  const far = Math.min(maxFar, Math.max(minFar, unclampedFar));

  return {
    near,
    far,
    depthNear: near,
    depthFar: far,
    telemetry: {
      near,
      far,
      requiredNavigationUnits,
      requiredMeters,
      marginFactor,
      unclampedFar,
      minFar,
      maxFar,
      minClampApplied: far === minFar && unclampedFar < minFar,
      capApplied: far === maxFar && unclampedFar > maxFar,
      scale,
      observer,
      farthestVisibleBoundsDistance: farthestBoundsDistance,
      farthestObserverCentricSphereDistance: farthestObserverSphereDistance,
      visibleBoundsCount: normalizeBoundsList(options.visibleBounds).length,
      observerCentricSphereCount: Array.from(options.observerCentricSpheres ?? []).length,
    },
  };
}

/**
 * @param {unknown} visibleBounds
 * @param {{ x: number; y: number; z: number }} observer
 */
function computeFarthestVisibleBoundsDistance(visibleBounds, observer) {
  let farthest = 0;
  for (const bounds of normalizeBoundsList(visibleBounds)) {
    const xs = [bounds.min.x, bounds.max.x];
    const ys = [bounds.min.y, bounds.max.y];
    const zs = [bounds.min.z, bounds.max.z];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          farthest = Math.max(
            farthest,
            Math.hypot(x - observer.x, y - observer.y, z - observer.z),
          );
        }
      }
    }
  }
  return farthest;
}

/**
 * @param {unknown} spheres
 */
function computeFarthestObserverCentricSphereDistance(spheres) {
  let farthest = 0;
  for (const sphere of Array.from(/** @type {Iterable<unknown>} */ (spheres ?? []))) {
    const radius = positiveFinite(/** @type {{ radius?: unknown; radiusNavigationUnits?: unknown }} */ (sphere)?.radiusNavigationUnits
      ?? /** @type {{ radius?: unknown }} */ (sphere)?.radius, 0);
    farthest = Math.max(farthest, radius);
  }
  return farthest;
}

/**
 * @param {unknown} visibleBounds
 * @returns {Array<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>}
 */
function normalizeBoundsList(visibleBounds) {
  const values = Array.isArray(visibleBounds)
    ? visibleBounds
    : visibleBounds
      ? [visibleBounds]
      : [];
  const bounds = [];
  for (const value of values) {
    const normalized = normalizeBounds(value);
    if (normalized) {
      bounds.push(normalized);
    }
  }
  return bounds;
}

/**
 * @param {unknown} value
 * @returns {{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null}
 */
function normalizeBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const bounds = /** @type {{ min?: unknown; max?: unknown; minX?: unknown; minY?: unknown; minZ?: unknown; maxX?: unknown; maxY?: unknown; maxZ?: unknown }} */ (value);
  const min = bounds.min
    ? normalizeVector3(bounds.min, nullVector())
    : normalizeVector3({ x: bounds.minX, y: bounds.minY, z: bounds.minZ }, nullVector());
  const max = bounds.max
    ? normalizeVector3(bounds.max, nullVector())
    : normalizeVector3({ x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ }, nullVector());
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) {
    return null;
  }
  return {
    min: {
      x: Math.min(min.x, max.x),
      y: Math.min(min.y, max.y),
      z: Math.min(min.z, max.z),
    },
    max: {
      x: Math.max(min.x, max.x),
      y: Math.max(min.y, max.y),
      z: Math.max(min.z, max.z),
    },
  };
}

function nullVector() {
  return {
    x: Number.NaN,
    y: Number.NaN,
    z: Number.NaN,
  };
}
