import {
  cloneVector3,
  normalizeVector3,
  scaleVector,
  vectorLength,
} from './math.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * @param {{ raDeg?: number; raHours?: number; decDeg: number }} input
 * @returns {import('./index.d.ts').SpatialVector3 | null}
 */
export function raDecToIcrsDirection(input) {
  const raDeg = resolveRaDeg(input);
  const decDeg = Number(input?.decDeg);
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null;
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const cosDec = Math.cos(dec);
  return {
    x: Math.cos(ra) * cosDec,
    y: Math.sin(ra) * cosDec,
    z: Math.sin(dec),
  };
}

/**
 * @param {{ raDeg?: number; raHours?: number; decDeg: number; distancePc: number; observerPc?: import('./index.d.ts').SpatialVector3 }} input
 * @returns {import('./index.d.ts').SpatialVector3 | null}
 */
export function raDecDistanceToIcrs(input) {
  const direction = raDecToIcrsDirection(input);
  const distancePc = Number(input?.distancePc);
  if (!direction || !Number.isFinite(distancePc) || distancePc < 0) return null;
  const observer = normalizeVector3(input?.observerPc, DEFAULT_OBSERVER_PC);
  return {
    x: observer.x + direction.x * distancePc,
    y: observer.y + direction.y * distancePc,
    z: observer.z + direction.z * distancePc,
  };
}

/**
 * @param {import('./index.d.ts').SpatialVector3 | [number, number, number]} position
 * @param {import('./index.d.ts').SpatialVector3 | [number, number, number]} [observerPc]
 * @returns {{ raDeg: number; raHours: number; decDeg: number } | null}
 */
export function icrsToRaDec(position, observerPc = [0, 0, 0]) {
  const pos = vectorFrom(position);
  const obs = vectorFrom(observerPc);
  if (!pos || !obs) return null;

  const x = pos.x - obs.x;
  const y = pos.y - obs.y;
  const z = pos.z - obs.z;
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) return null;

  const nx = x / length;
  const ny = y / length;
  const nz = z / length;
  const raRawDeg = Math.atan2(ny, nx) * RAD_TO_DEG;
  const raDeg = (raRawDeg + 360) % 360;
  const decDeg = Math.asin(clamp(nz, -1, 1)) * RAD_TO_DEG;
  return {
    raDeg,
    raHours: raDeg / 15,
    decDeg,
  };
}

/**
 * @param {import('./index.d.ts').SpatialVector3 | [number, number, number]} icrsDirection
 * @param {number} distancePc
 * @param {import('./index.d.ts').SpatialVector3 | [number, number, number]} [observerPc]
 * @returns {import('./index.d.ts').SpatialVector3 | null}
 */
export function icrsDirectionToTargetPc(icrsDirection, distancePc, observerPc = DEFAULT_OBSERVER_PC) {
  const direction = vectorFrom(icrsDirection);
  const observer = vectorFrom(observerPc);
  const distance = Number(distancePc);
  if (!direction || !observer || !Number.isFinite(distance) || distance <= 0) return null;
  const length = vectorLength(direction);
  if (!(length > 0)) return null;
  const unit = scaleVector(direction, 1 / length);
  return {
    x: observer.x + unit.x * distance,
    y: observer.y + unit.y * distance,
    z: observer.z + unit.z * distance,
  };
}

/**
 * @param {{ raDeg: number; decDeg: number; width: number; height: number }} options
 */
export function projectEquirectangular(options) {
  return {
    x: ((Number(options.raDeg) % 360 + 360) % 360) / 360 * options.width,
    y: (90 - clamp(Number(options.decDeg), -90, 90)) / 180 * options.height,
  };
}

/**
 * @param {import('./index.d.ts').SpatialTargetInput} input
 * @param {import('./index.d.ts').ResolveSpatialTargetOptions} [options]
 * @returns {Promise<import('./index.d.ts').SpatialVector3 | null> | import('./index.d.ts').SpatialVector3 | null}
 */
export function resolveSpatialTarget(input, options = {}) {
  const direct = resolveDirectSpatialTarget(input, options);
  if (direct || !input || typeof input !== 'object' || typeof options.resolveBookmark !== 'function') {
    return direct;
  }
  const maybeBookmark = /** @type {{ bookmarkId?: unknown; id?: unknown; kind?: unknown }} */ (input);
  const bookmarkId = typeof maybeBookmark.bookmarkId === 'string'
    ? maybeBookmark.bookmarkId
    : maybeBookmark.kind === 'bookmark' && typeof maybeBookmark.id === 'string'
      ? maybeBookmark.id
      : null;
  if (!bookmarkId) return null;
  const resolved = options.resolveBookmark(bookmarkId, input);
  if (resolved && typeof /** @type {Promise<unknown>} */ (resolved).then === 'function') {
    return Promise.resolve(resolved).then((value) => resolveDirectSpatialTarget(value, options));
  }
  return resolveDirectSpatialTarget(resolved, options);
}

/**
 * @param {unknown} input
 * @param {import('./index.d.ts').ResolveSpatialTargetOptions} [options]
 * @returns {import('./index.d.ts').SpatialVector3 | null}
 */
function resolveDirectSpatialTarget(input, options = {}) {
  if (!input || typeof input !== 'object') return null;
  if (Array.isArray(input) && input.length >= 3) {
    return vectorFrom(input);
  }
  const value = /** @type {{ x?: unknown; y?: unknown; z?: unknown; raDeg?: unknown; raHours?: unknown; decDeg?: unknown; distancePc?: unknown; position?: unknown; targetPc?: unknown }} */ (input);
  if (value.position) return resolveDirectSpatialTarget(value.position, options);
  if (value.targetPc) return resolveDirectSpatialTarget(value.targetPc, options);
  if ([value.x, value.y, value.z].every((component) => Number.isFinite(Number(component)))) {
    return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
  }
  if ((Number.isFinite(Number(value.raDeg)) || Number.isFinite(Number(value.raHours)))
    && Number.isFinite(Number(value.decDeg))
    && Number.isFinite(Number(value.distancePc))) {
    return raDecDistanceToIcrs({
      raDeg: Number(value.raDeg),
      raHours: Number(value.raHours),
      decDeg: Number(value.decDeg),
      distancePc: Number(value.distancePc),
      observerPc: options.observerPc,
    });
  }
  return null;
}

/**
 * @param {unknown} input
 * @returns {import('./index.d.ts').SpatialVector3 | null}
 */
function vectorFrom(input) {
  if (Array.isArray(input) && input.length >= 3) {
    const x = Number(input[0]);
    const y = Number(input[1]);
    const z = Number(input[2]);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }
  if (!input || typeof input !== 'object') return null;
  const vector = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (input);
  const x = Number(vector.x);
  const y = Number(vector.y);
  const z = Number(vector.z);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

/**
 * @param {{ raDeg?: unknown; raHours?: unknown } | null | undefined} input
 */
function resolveRaDeg(input) {
  const raDeg = Number(input?.raDeg);
  if (Number.isFinite(raDeg)) return raDeg;
  const raHours = Number(input?.raHours);
  return Number.isFinite(raHours) ? raHours * 15 : Number.NaN;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
