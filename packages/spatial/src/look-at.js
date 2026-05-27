// @ts-nocheck

import {
  cloneQuaternion,
  cloneVector3,
  normalizeQuaternion,
} from './math.js';
import {
  raDecDistanceToIcrs,
  raDecToIcrsDirection,
  resolveSpatialTarget,
} from './coordinates.js';
import {
  computeSpatialLookAtOrientation,
  computeSpatialLookDirectionOrientation,
} from './navigation.js';

/**
 * @param {unknown} input
 * @param {import('./index.d.ts').ResolveSpatialLookAtOptions} [options]
 * @returns {import('./index.d.ts').SpatialResolvedLookAt | Promise<import('./index.d.ts').SpatialResolvedLookAt>}
 */
export function resolveSpatialLookAt(input, options = {}) {
  const lookAt = normalizeLookAtInput(input);
  const observerPc = resolveObserverPc(options);
  if (!lookAt) return unresolved(null, 'missing');

  if ('orientationIcrs' in lookAt) {
    const orientationIcrs = normalizeQuaternion(lookAt.orientationIcrs);
    return {
      lookAt: { orientationIcrs },
      targetPc: null,
      orientationIcrs,
      unresolved: null,
    };
  }

  if ('targetPc' in lookAt) {
    return resolveTargetLookAt(lookAt, options, observerPc);
  }

  if (isRaDecLookAt(lookAt)) {
    return resolveRaDecLookAt(lookAt, observerPc);
  }

  if ('star' in lookAt) {
    if (typeof options.resolveStar !== 'function') {
      return unresolved(lookAt, 'star');
    }
    const resolved = options.resolveStar(lookAt.star, lookAt);
    if (isPromiseLike(resolved)) {
      return Promise.resolve(resolved).then((value) => resolveResolvedLookAt(value, lookAt, options));
    }
    return resolveResolvedLookAt(resolved, lookAt, options);
  }

  return resolveTargetLookAt(lookAt, options, observerPc);
}

/**
 * @param {unknown} input
 * @returns {import('./index.d.ts').SpatialLookAtSpec | null}
 */
export function normalizeSpatialLookAt(input) {
  return normalizeLookAtInput(input);
}

/**
 * @param {unknown} resolved
 * @param {import('./index.d.ts').SpatialLookAtStarSpec} source
 * @param {import('./index.d.ts').ResolveSpatialLookAtOptions} options
 */
function resolveResolvedLookAt(resolved, source, options) {
  if (resolved == null) return unresolved(source, 'star');
  const next = normalizeLookAtInput(resolved);
  if (next) {
    const merged = {
      ...source,
      ...next,
      positionAngleDeg: resolvePositionAngleDeg(next, source.positionAngleDeg),
    };
    return resolveSpatialLookAt(merged, options);
  }
  const target = resolveSpatialTarget(resolved, {
    observerPc: resolveObserverPc(options),
    resolveBookmark: options.resolveBookmark,
  });
  if (isPromiseLike(target)) {
    return Promise.resolve(target).then((value) => completeTargetLookAt(source, value, resolveObserverPc(options)));
  }
  return completeTargetLookAt(source, target, resolveObserverPc(options));
}

/**
 * @param {import('./index.d.ts').SpatialLookAtSpec} lookAt
 * @param {import('./index.d.ts').ResolveSpatialLookAtOptions} options
 * @param {import('./index.d.ts').SpatialVector3} observerPc
 */
function resolveTargetLookAt(lookAt, options, observerPc) {
  const targetInput = 'targetPc' in lookAt ? lookAt.targetPc : lookAt;
  const target = resolveSpatialTarget(targetInput, {
    observerPc,
    resolveBookmark: options.resolveBookmark,
  });
  if (isPromiseLike(target)) {
    return Promise.resolve(target).then((value) => completeTargetLookAt(lookAt, value, observerPc));
  }
  return completeTargetLookAt(lookAt, target, observerPc);
}

/**
 * @param {import('./index.d.ts').SpatialLookAtSpec} lookAt
 * @param {import('./index.d.ts').SpatialVector3 | null} targetPc
 * @param {import('./index.d.ts').SpatialVector3} observerPc
 * @returns {import('./index.d.ts').SpatialResolvedLookAt}
 */
function completeTargetLookAt(lookAt, targetPc, observerPc) {
  if (!targetPc) return unresolved(lookAt, 'target');
  const normalizedLookAt = {
    ...copyPublicLookAt(lookAt),
    targetPc: cloneVector3(targetPc),
    positionAngleDeg: resolvePositionAngleDeg(lookAt, 0),
  };
  const orientationIcrs = computeSpatialLookAtOrientation({
    position: observerPc,
    target: targetPc,
    positionAngleDeg: normalizedLookAt.positionAngleDeg,
  });
  return {
    lookAt: normalizedLookAt,
    targetPc: cloneVector3(targetPc),
    orientationIcrs,
    unresolved: orientationIcrs ? null : 'target',
  };
}

/**
 * @param {import('./index.d.ts').SpatialLookAtRaDecSpec} lookAt
 * @param {import('./index.d.ts').SpatialVector3} observerPc
 * @returns {import('./index.d.ts').SpatialResolvedLookAt}
 */
function resolveRaDecLookAt(lookAt, observerPc) {
  const positionAngleDeg = resolvePositionAngleDeg(lookAt, 0);
  const direction = raDecToIcrsDirection(lookAt);
  if (!direction) return unresolved(lookAt, 'radec');
  const orientationIcrs = computeSpatialLookDirectionOrientation({
    direction,
    positionAngleDeg,
  });
  const distancePc = Number(lookAt.distancePc);
  const targetPc = Number.isFinite(distancePc)
    ? raDecDistanceToIcrs({ ...lookAt, distancePc, observerPc })
    : null;
  return {
    lookAt: {
      ...('star' in lookAt ? { star: lookAt.star } : {}),
      ...(Number.isFinite(Number(lookAt.raDeg)) ? { raDeg: Number(lookAt.raDeg) } : {}),
      ...(Number.isFinite(Number(lookAt.raHours)) ? { raHours: Number(lookAt.raHours) } : {}),
      decDeg: Number(lookAt.decDeg),
      ...(targetPc ? { distancePc } : {}),
      positionAngleDeg,
    },
    targetPc: targetPc ? cloneVector3(targetPc) : null,
    orientationIcrs,
    unresolved: orientationIcrs ? null : 'radec',
  };
}

/** @param {unknown} input */
function normalizeLookAtInput(input) {
  if (typeof input === 'string') {
    return { star: input, positionAngleDeg: 0 };
  }
  if (!input || typeof input !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (input);
  if (source.lookAt && typeof source.lookAt === 'object') {
    return normalizeLookAtInput(source.lookAt);
  }
  if (isQuaternionLike(source.orientationIcrs)) {
    return { orientationIcrs: normalizeQuaternion(source.orientationIcrs) };
  }
  if (isRaDecLookAt(source)) {
    return {
      ...(Number.isFinite(Number(source.raDeg)) ? { raDeg: Number(source.raDeg) } : {}),
      ...(Number.isFinite(Number(source.raHours)) ? { raHours: Number(source.raHours) } : {}),
      decDeg: Number(source.decDeg),
      ...(Number.isFinite(Number(source.distancePc)) ? { distancePc: Number(source.distancePc) } : {}),
      positionAngleDeg: resolvePositionAngleDeg(source, 0),
    };
  }
  if ('targetPc' in source || 'position' in source || 'bookmarkId' in source || source.kind === 'bookmark' || isVectorLike(source)) {
    return {
      targetPc: source.targetPc ?? source.position ?? source,
      positionAngleDeg: resolvePositionAngleDeg(source, 0),
      ...('star' in source ? { star: source.star } : {}),
    };
  }
  if ('star' in source) {
    return {
      star: source.star,
      positionAngleDeg: resolvePositionAngleDeg(source, 0),
    };
  }
  return null;
}

/** @param {unknown} value */
function isQuaternionLike(value) {
  if (!value || typeof value !== 'object') return false;
  const q = /** @type {Record<string, unknown>} */ (value);
  return [q.x, q.y, q.z, q.w].every((component) => Number.isFinite(Number(component)));
}

/** @param {unknown} value */
function isVectorLike(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2]].every((component) => Number.isFinite(Number(component)));
  }
  if (!value || typeof value !== 'object') return false;
  const source = /** @type {Record<string, unknown>} */ (value);
  return [source.x, source.y, source.z].every((component) => Number.isFinite(Number(component)));
}

/** @param {unknown} value */
function isRaDecLookAt(value) {
  if (!value || typeof value !== 'object') return false;
  const source = /** @type {Record<string, unknown>} */ (value);
  return (Number.isFinite(Number(source.raDeg)) || Number.isFinite(Number(source.raHours)))
    && Number.isFinite(Number(source.decDeg));
}

/**
 * @param {Record<string, unknown>} source
 * @param {number} fallback
 */
function resolvePositionAngleDeg(source, fallback) {
  const value = Number(source.positionAngleDeg);
  return Number.isFinite(value) ? value : fallback;
}

/** @param {unknown} value */
function isPromiseLike(value) {
  return value && typeof /** @type {Promise<unknown>} */ (value).then === 'function';
}

/** @param {import('./index.d.ts').ResolveSpatialLookAtOptions} options */
function resolveObserverPc(options) {
  return options.observerPc ? cloneVector3(options.observerPc) : { x: 0, y: 0, z: 0 };
}

/**
 * @param {import('./index.d.ts').SpatialLookAtSpec | null} lookAt
 * @param {string} reason
 * @returns {import('./index.d.ts').SpatialResolvedLookAt}
 */
function unresolved(lookAt, reason) {
  return {
    lookAt: lookAt ? copyPublicLookAt(lookAt) : null,
    targetPc: null,
    orientationIcrs: null,
    unresolved: reason,
  };
}

/** @param {import('./index.d.ts').SpatialLookAtSpec} lookAt */
function copyPublicLookAt(lookAt) {
  if ('orientationIcrs' in lookAt) return { orientationIcrs: cloneQuaternion(lookAt.orientationIcrs) };
  return { ...lookAt };
}
