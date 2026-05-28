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
 * @param {string} text
 * @returns {import('./index.d.ts').SpatialLookAtSpec | null}
 */
export function parseSpatialLookAtText(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const json = parseLookAtJson(value);
  if (json) return json;
  const named = parseNamedRaDec(value);
  if (named) return named;
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) {
    const ra = parseRaValue(parts[0], 'ra');
    const decDeg = parseDegrees(parts[1]);
    return ra && Number.isFinite(decDeg) ? { ...ra, decDeg } : null;
  }
  if (parts.length === 3) {
    const vector = vectorFromParts(parts);
    return vector ? { targetPc: vector } : null;
  }
  return null;
}

/**
 * @param {unknown} ra
 * @param {unknown} dec
 * @param {{ distancePc?: unknown; positionAngleDeg?: unknown; raUnit?: 'auto' | 'hours' | 'degrees' }} [options]
 * @returns {import('./index.d.ts').SpatialLookAtRaDecSpec | null}
 */
export function createRaDecLookAt(ra, dec, options = {}) {
  const source = isPlainObject(ra) && dec === undefined
    ? /** @type {Record<string, unknown>} */ (ra)
    : null;
  const raInput = source
    ? source.ra ?? source.rightAscension ?? source.raDeg ?? source.raHours
    : ra;
  const decInput = source
    ? source.dec ?? source.declination ?? source.decDeg
    : dec;
  const raUnit = source
    ? source.raUnit ?? (source.raHours !== undefined ? 'hours' : source.raDeg !== undefined ? 'degrees' : options.raUnit)
    : options.raUnit;
  const parsedRa = parseRightAscension(raInput, {
    unit: /** @type {'auto' | 'hours' | 'degrees' | undefined} */ (raUnit),
  });
  const decDeg = source && Number.isFinite(Number(source.decDeg))
    ? Number(source.decDeg)
    : parseDeclination(decInput);

  if (!parsedRa || decDeg == null) return null;

  const distancePc = Number(source?.distancePc ?? options.distancePc);
  const positionAngleDeg = Number(source?.positionAngleDeg ?? options.positionAngleDeg);

  return {
    ...parsedRa,
    decDeg,
    ...(Number.isFinite(distancePc) ? { distancePc } : {}),
    ...(Number.isFinite(positionAngleDeg) ? { positionAngleDeg } : {}),
  };
}

/**
 * @param {unknown} value
 * @param {{ unit?: 'auto' | 'hours' | 'degrees' }} [options]
 * @returns {{ raDeg: number } | { raHours: number } | null}
 */
export function parseRightAscension(value, options = {}) {
  const text = normalizeAngleText(value);
  if (!text) return null;
  const unit = resolveRightAscensionUnit(text, options.unit);
  const sexagesimal = parseSexagesimalAngle(text);
  if (Number.isFinite(sexagesimal)) {
    return unit === 'degrees'
      ? { raDeg: sexagesimal }
      : { raHours: sexagesimal };
  }

  const number = parsePlainNumber(text);
  if (!Number.isFinite(number)) return null;
  return unit === 'hours'
    ? { raHours: number }
    : { raDeg: number };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseDeclination(value) {
  const sexagesimal = parseSexagesimalAngle(value);
  if (Number.isFinite(sexagesimal)) return sexagesimal;
  const degrees = parsePlainNumber(value);
  return Number.isFinite(degrees) ? degrees : null;
}

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
    return parseSpatialLookAtText(input) ?? { star: input, positionAngleDeg: 0 };
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

/** @param {string} text */
function parseLookAtJson(text) {
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return normalizeLookAtInput(JSON.parse(text));
  } catch {
    return null;
  }
}

/** @param {string} text */
function parseNamedRaDec(text) {
  const result = {};
  for (const { key, rawValue } of extractNamedValues(text)) {
    const normalizedKey = normalizeLookAtKey(key);
    if (
      normalizedKey === 'ra' ||
      normalizedKey === 'rightascension' ||
      normalizedKey === 'radeg' ||
      normalizedKey === 'rahour' ||
      normalizedKey === 'rahours'
    ) {
      const ra = parseRaValue(rawValue, normalizedKey);
      if (ra) Object.assign(result, ra);
    } else if (
      normalizedKey === 'dec' ||
      normalizedKey === 'declination' ||
      normalizedKey === 'decdeg'
    ) {
      const decDeg = parseDeclination(rawValue);
      if (decDeg != null) result.decDeg = decDeg;
    } else if (normalizedKey === 'distance' || normalizedKey === 'distancepc') {
      const distancePc = parsePlainNumber(rawValue);
      if (Number.isFinite(distancePc)) result.distancePc = distancePc;
    } else if (normalizedKey === 'pa' || normalizedKey === 'positionangle' || normalizedKey === 'positionangledeg') {
      const positionAngleDeg = parseDeclination(rawValue);
      if (positionAngleDeg != null) result.positionAngleDeg = positionAngleDeg;
    }
  }
  return isRaDecLookAt(result) ? result : null;
}

/**
 * @param {string} value
 * @param {string} key
 */
function parseRaValue(value, key) {
  return parseRightAscension(value, {
    unit: key.includes('hour') ? 'hours' : key.includes('deg') ? 'degrees' : 'auto',
  });
}

/** @param {string} value */
function parseDegrees(value) {
  return parseDeclination(value) ?? Number.NaN;
}

/** @param {string} value */
function parsePlainNumber(value) {
  return Number(
    normalizeAngleText(value)
      .trim()
      .toLowerCase()
      .replace(/^\+/, '')
      .replace(/\s*(?:degrees?|deg|°|d|hours?|hrs?|hr|h|pc)$/i, '')
      .trim(),
  );
}

/** @param {unknown} value */
function normalizeAngleText(value) {
  return String(value ?? '')
    .trim()
    .replace(/[−‒–—]/g, '-')
    .replace(/[＋﹢]/g, '+')
    .replace(/[º˚]/g, '°')
    .replace(/[′‘’ʼ]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/[ʰ]/gi, 'h')
    .replace(/[ᵐ]/gi, 'm')
    .replace(/[ˢ]/gi, 's');
}

/** @param {string} text */
function extractNamedValues(text) {
  const matches = Array.from(text.matchAll(NAMED_LOOK_AT_KEY_PATTERN));
  if (matches.length === 0) return [];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const rawValue = text
      .slice((match.index ?? 0) + match[0].length, next?.index ?? text.length)
      .replace(/^\s*[:=]\s*/, '')
      .replace(/^[\s,;]+|[\s,;]+$/g, '');
    return {
      key: match[0],
      rawValue,
    };
  }).filter((entry) => entry.rawValue.length > 0);
}

const NAMED_LOOK_AT_KEY_PATTERN = /\bright\s+ascension\b|\bright[-_]?ascension\b|\bra[-_\s]?hours?\b|\brahours\b|\bra[-_\s]?deg(?:rees?)?\b|\bradeg\b|\bra\b|\bdeclination\b|\bdec[-_\s]?deg(?:rees?)?\b|\bdecdeg\b|\bdec\b|\bdistance[-_\s]?pc\b|\bdistancepc\b|\bdistance\b|\bposition[-_\s]?angle[-_\s]?deg\b|\bpositionangledeg\b|\bposition[-_\s]?angle\b|\bpositionangle\b|\bpa\b/gi;

/** @param {string} key */
function normalizeLookAtKey(key) {
  return String(key ?? '').toLowerCase().replace(/[-_\s]+/g, '');
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function parseSexagesimalAngle(value) {
  const text = normalizeAngleText(value).toLowerCase();
  if (!looksSexagesimal(text)) return Number.NaN;

  const signMatch = text.match(/^\s*([+-])/);
  let sign = signMatch?.[1] === '-' ? -1 : 1;
  let body = text.replace(/^\s*[+-]\s*/, '');
  body = body
    .replace(/hours?|hrs?|hr|h(?=\s|$|\d)/g, ' ')
    .replace(/degrees?|deg|°|d(?=\s|$|\d)/g, ' ')
    .replace(/minutes?|mins?|min|m(?=\s|$|\d)/g, ' ')
    .replace(/seconds?|secs?|sec|s(?=\s|$|\d)/g, ' ')
    .replace(/['":]/g, ' ');

  const numbers = Array.from(body.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g))
    .map((match) => Number(match[0]));
  if (numbers.length === 0 || numbers.length > 3 || numbers.some((number) => !Number.isFinite(number))) {
    return Number.NaN;
  }
  if (!signMatch && numbers[0] < 0) sign = -1;

  const major = Math.abs(numbers[0]);
  const minutes = Math.abs(numbers[1] ?? 0);
  const seconds = Math.abs(numbers[2] ?? 0);
  if (minutes >= 60 || seconds >= 60) return Number.NaN;
  return sign * (major + minutes / 60 + seconds / 3600);
}

/** @param {string} text */
function looksSexagesimal(text) {
  if (/[:hms°'"]|hours?|hrs?|hr|degrees?|deg|minutes?|mins?|min|seconds?|secs?|sec/i.test(text)) {
    return true;
  }
  return Array.from(text.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g)).length > 1;
}

/**
 * @param {string} text
 * @param {'auto' | 'hours' | 'degrees' | undefined} option
 * @returns {'hours' | 'degrees'}
 */
function resolveRightAscensionUnit(text, option = 'auto') {
  if (option === 'hours' || option === 'degrees') return option;
  const lower = normalizeAngleText(text).toLowerCase();
  if (/\bra[-_\s]?hours?\b|\bhours?\b|\bhrs?\b|\bhr\b|h(?=\s|$|\d)/.test(lower)) {
    return 'hours';
  }
  if (/\bra[-_\s]?deg(?:rees?)?\b|\bdegrees?\b|\bdeg\b|°|d(?=\s|$|\d)/.test(lower)) {
    return 'degrees';
  }
  return looksSexagesimal(lower) ? 'hours' : 'degrees';
}

/** @param {string[]} parts */
function vectorFromParts(parts) {
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
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

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
