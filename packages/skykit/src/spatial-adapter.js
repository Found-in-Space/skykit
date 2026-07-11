import {
  SPATIAL_IDENTITY_QUATERNION,
  evaluateSpatialAim,
  normalizeSpatialQuaternion,
  normalizeSpatialTarget,
  normalizeSpatialVector3,
  raDecDistanceToIcrs,
  resolveSpatialTarget,
} from '@found-in-space/spatial';

const SKYKIT_DEFAULT_LOOK_UP = Object.freeze({ x: 0, y: 0, z: 1 });

/** @typedef {import('@found-in-space/spatial').SpatialQuaternion} SpatialQuaternion */
/** @typedef {import('@found-in-space/spatial').SpatialTargetSpec} SpatialTargetSpec */
/** @typedef {import('@found-in-space/spatial').SpatialVector3} SpatialVector3 */
/** @typedef {import('./index.d.ts').SkykitLookAtSpecInput} SkykitLookAtSpecInput */
/** @typedef {import('./index.d.ts').SkykitRaDecLookAtHelperInput} SkykitRaDecLookAtHelperInput */
/** @typedef {import('./index.d.ts').SkykitRaDecLookAtHelperOptions} SkykitRaDecLookAtHelperOptions */
/** @typedef {import('./index.d.ts').SkykitRightAscensionUnit} SkykitRightAscensionUnit */
/**
 * @typedef {object} SkykitResolveOptions
 * @property {unknown} [observerPc]
 * @property {unknown} [resolveBookmark]
 * @property {unknown} [resolveStar]
 */
/**
 * @typedef {object} ResolvedSkykitLookAt
 * @property {Record<string, any> | null} lookAt
 * @property {SpatialVector3 | null} targetPc
 * @property {SpatialQuaternion | null} orientationIcrs
 * @property {unknown} unresolved
 */

/**
 * @param {unknown | SkykitRaDecLookAtHelperInput} ra
 * @param {unknown} [dec]
 * @param {SkykitRaDecLookAtHelperOptions} [options]
 * @returns {SkykitLookAtSpecInput | null}
 */
export function createRaDecLookAt(ra, dec, options = {}) {
  const source = isPlainObject(ra) && dec === undefined
    ? /** @type {SkykitRaDecLookAtHelperInput} */ (ra)
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
  const parsedRa = parseRightAscension(raInput, { unit: raUnit ?? 'auto' });
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

/** @param {string} text @returns {SkykitLookAtSpecInput | null} */
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
    const decDeg = parseDeclination(parts[1]);
    return ra && decDeg != null ? { ...ra, decDeg } : null;
  }
  if (parts.length === 3) {
    const raDecDistance = parseRaDecDistanceParts(parts);
    if (raDecDistance) return raDecDistance;
    const vector = vectorFromParts(parts);
    return vector ? { targetPc: vector } : null;
  }
  return null;
}

/**
 * @param {unknown} value
 * @param {{ unit?: SkykitRightAscensionUnit }} [options]
 * @returns {{ raDeg: number } | { raHours: number } | null}
 */
export function parseRightAscension(value, options = {}) {
  const text = normalizeAngleText(value);
  if (!text) return null;
  const unit = resolveRightAscensionUnit(text, options.unit);
  const sexagesimal = parseSexagesimalAngle(text);
  if (Number.isFinite(sexagesimal)) {
    return unit === 'degrees' ? { raDeg: sexagesimal } : { raHours: sexagesimal };
  }
  const number = parsePlainNumber(text);
  if (!Number.isFinite(number)) return null;
  return unit === 'hours' ? { raHours: number } : { raDeg: number };
}

/** @param {unknown} value @returns {number | null} */
export function parseDeclination(value) {
  const sexagesimal = parseSexagesimalAngle(value);
  if (Number.isFinite(sexagesimal)) return sexagesimal;
  const degrees = parsePlainNumber(value);
  return Number.isFinite(degrees) ? degrees : null;
}

/** @param {unknown} input @returns {SpatialTargetSpec} */
export function normalizeSkykitTargetInput(input) {
  if (Array.isArray(input) && input.length >= 3) {
    return { kind: 'position', targetPc: normalizeSkykitVector3(input) };
  }
  if (typeof input === 'string') {
    const parsed = parseSpatialLookAtText(input);
    return parsed ? normalizeSkykitTargetInput(parsed) : { kind: 'bookmark', id: input };
  }
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SkyKit target input.');
  }
  const value = /** @type {Record<string, unknown>} */ (input);
  if (value.kind === 'position' || value.kind === 'radec' || value.kind === 'bookmark') {
    return normalizeSpatialTarget({
      ...value,
      ...(value.kind === 'position' ? { targetPc: normalizeSkykitVector3(value.targetPc) } : {}),
      ...(value.kind === 'radec' && value.distancePc === undefined ? { distancePc: 1 } : {}),
    });
  }
  if ('targetPc' in value) {
    return { kind: 'position', targetPc: normalizeSkykitVector3(value.targetPc) };
  }
  if ('positionPc' in value) {
    return { kind: 'position', targetPc: normalizeSkykitVector3(value.positionPc) };
  }
  if ('position' in value) {
    return { kind: 'position', targetPc: normalizeSkykitVector3(value.position) };
  }
  if ('x' in value && 'y' in value && 'z' in value) {
    return { kind: 'position', targetPc: normalizeSkykitVector3(value) };
  }
  if ('raDeg' in value || 'raHours' in value || 'decDeg' in value) {
    return normalizeSpatialTarget({
      kind: 'radec',
      raDeg: value.raDeg,
      raHours: value.raHours,
      decDeg: value.decDeg,
      distancePc: value.distancePc ?? 1,
    });
  }
  if ('bookmarkId' in value) {
    return { kind: 'bookmark', id: String(value.bookmarkId) };
  }
  throw new TypeError('Unsupported SkyKit target input.');
}

/** @param {unknown} input @param {SkykitResolveOptions} [options] @returns {Promise<SpatialVector3 | null>} */
export async function resolveSkykitTarget(input, options = {}) {
  if (isDirectionOnlyTargetInput(input)) return null;
  if (input && typeof input === 'object' && 'star' in input && typeof options.resolveStar === 'function') {
    const resolved = await options.resolveStar(input.star, input);
    return resolved ? resolveSkykitTarget(resolved, options) : null;
  }
  const target = normalizeSkykitTargetInput(input);
  if (target.kind === 'bookmark') {
    if (typeof options.resolveBookmark !== 'function') return null;
    const resolved = await options.resolveBookmark(target.id, target);
    return resolved ? resolveSkykitTarget(resolved, options) : null;
  }
  return await resolveSpatialTarget(target);
}

/** @param {unknown} input @param {SkykitResolveOptions} [options] @returns {SpatialVector3 | null} */
export function resolveSkykitTargetSync(input, options = {}) {
  if (isDirectionOnlyTargetInput(input)) return null;
  const target = normalizeSkykitTargetInput(input);
  if (target.kind === 'bookmark') {
    if (typeof options.resolveBookmark !== 'function') return null;
    const resolved = options.resolveBookmark(target.id, target);
    if (isPromiseLike(resolved)) {
      throw new TypeError('Synchronous target resolution received an async resolver result.');
    }
    return resolved ? resolveSkykitTargetSync(resolved, options) : null;
  }
  return /** @type {SpatialVector3 | null} */ (resolveSpatialTarget(target));
}

/** @param {unknown} input @param {SkykitResolveOptions} [options] @returns {Promise<ResolvedSkykitLookAt>} */
export async function resolveSkykitLookAt(input, options = {}) {
  const normalized = normalizeSkykitLookAtInput(input);
  if (!normalized) {
    return {
      lookAt: null,
      targetPc: null,
      orientationIcrs: null,
      unresolved: input ?? null,
    };
  }
  if ('orientationIcrs' in normalized) {
    return {
      lookAt: normalized,
      targetPc: null,
      orientationIcrs: normalizeSpatialQuaternion(normalized.orientationIcrs, SPATIAL_IDENTITY_QUATERNION),
      unresolved: null,
    };
  }
  if (normalized.kind === 'direction') {
    return resolvedLookFromDirection(normalized, options.observerPc);
  }
  if (normalized.kind === 'bookmark') {
    if (typeof options.resolveBookmark !== 'function') {
      return { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized };
    }
    const resolved = await options.resolveBookmark(normalized.id, normalized);
    return resolved == null
      ? { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized }
      : resolveSkykitLookAt(resolved, { ...options, resolveBookmark: undefined });
  }
  if ('star' in normalized && !('targetPc' in normalized)) {
    if (typeof options.resolveStar !== 'function') {
      return { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized };
    }
    const resolved = await options.resolveStar(normalized.star, normalized);
    if (resolved == null) {
      return { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized };
    }
    return mergeResolvedStarLook(
      normalized,
      await resolveSkykitLookAt(mergeStarResolvedInput(normalized, resolved), { ...options, resolveStar: undefined }),
    );
  }
  const targetPc = await resolveSkykitTarget(normalized, options);
  return resolvedLookFromTarget(normalized, targetPc, options.observerPc);
}

/** @param {unknown} input @param {SkykitResolveOptions} [options] @returns {ResolvedSkykitLookAt} */
export function resolveSkykitLookAtSync(input, options = {}) {
  const normalized = normalizeSkykitLookAtInput(input);
  if (!normalized) return { lookAt: null, targetPc: null, orientationIcrs: null, unresolved: input ?? null };
  if ('orientationIcrs' in normalized) {
    return {
      lookAt: normalized,
      targetPc: null,
      orientationIcrs: normalizeSpatialQuaternion(normalized.orientationIcrs, SPATIAL_IDENTITY_QUATERNION),
      unresolved: null,
    };
  }
  if (normalized.kind === 'direction') {
    return resolvedLookFromDirection(normalized, options.observerPc);
  }
  if (normalized.kind === 'bookmark') {
    if (typeof options.resolveBookmark !== 'function') {
      return { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized };
    }
    const resolved = options.resolveBookmark(normalized.id, normalized);
    if (isPromiseLike(resolved)) {
      throw new TypeError('Synchronous look-at resolution received an async bookmark resolver result.');
    }
    return resolved == null
      ? { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized }
      : resolveSkykitLookAtSync(resolved, { ...options, resolveBookmark: undefined });
  }
  if ('star' in normalized && !('targetPc' in normalized)) {
    if (typeof options.resolveStar !== 'function') {
      return { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized };
    }
    const resolved = options.resolveStar(normalized.star, normalized);
    if (isPromiseLike(resolved)) {
      throw new TypeError('Synchronous look-at resolution received an async star resolver result.');
    }
    if (resolved == null) {
      return { lookAt: normalized, targetPc: null, orientationIcrs: null, unresolved: normalized };
    }
    return mergeResolvedStarLook(
      normalized,
      resolveSkykitLookAtSync(mergeStarResolvedInput(normalized, resolved), { ...options, resolveStar: undefined }),
    );
  }
  const targetPc = resolveSkykitTargetSync(normalized, options);
  return resolvedLookFromTarget(normalized, targetPc, options.observerPc);
}

/**
 * @param {{ observerPc?: unknown; position?: unknown; targetPc?: unknown; target?: unknown; upIcrs?: unknown; up?: unknown; positionAngleDeg?: unknown }} input
 * @returns {SpatialQuaternion}
 */
export function computeSkykitLookAtOrientation(input) {
  const observerPc = normalizeSpatialVector3(input?.observerPc ?? input?.position);
  const targetPc = normalizeSpatialVector3(input?.targetPc ?? input?.target);
  const sample = evaluateSpatialAim({
    observerPc,
    aim: {
      kind: 'target',
      targetPc,
      upIcrs: normalizeSkykitVector3(input?.upIcrs ?? input?.up ?? SKYKIT_DEFAULT_LOOK_UP),
      ...(input?.positionAngleDeg !== undefined ? { positionAngleDeg: -Number(input.positionAngleDeg) } : {}),
    },
  });
  return sample.orientationIcrs;
}

/**
 * @param {Record<string, any>} lookAt
 * @param {SpatialVector3 | null} targetPc
 * @param {unknown} observerPcInput
 * @returns {ResolvedSkykitLookAt}
 */
function resolvedLookFromTarget(lookAt, targetPc, observerPcInput) {
  if (!targetPc) {
    return { lookAt, targetPc: null, orientationIcrs: null, unresolved: lookAt };
  }
  const observerPc = normalizeSpatialVector3(observerPcInput, { x: 0, y: 0, z: 0 });
  const sample = evaluateSpatialAim({
    observerPc,
    aim: {
      kind: 'target',
      targetPc,
      upIcrs: lookAt.upIcrs ?? SKYKIT_DEFAULT_LOOK_UP,
      ...(lookAt.positionAngleDeg !== undefined ? { positionAngleDeg: -Number(lookAt.positionAngleDeg) } : {}),
    },
  });
  return {
    lookAt,
    targetPc,
    orientationIcrs: sample.orientationIcrs,
    unresolved: null,
  };
}

/** @param {Record<string, any>} lookAt @param {unknown} observerPcInput @returns {ResolvedSkykitLookAt} */
function resolvedLookFromDirection(lookAt, observerPcInput) {
  const observerPc = normalizeSpatialVector3(observerPcInput, { x: 0, y: 0, z: 0 });
  const sample = evaluateSpatialAim({
    observerPc,
    aim: {
      kind: 'direction',
      forwardIcrs: normalizeSpatialVector3(lookAt.forwardIcrs),
      upIcrs: lookAt.upIcrs ?? SKYKIT_DEFAULT_LOOK_UP,
      ...(lookAt.positionAngleDeg !== undefined ? { positionAngleDeg: -Number(lookAt.positionAngleDeg) } : {}),
    },
  });
  return {
    lookAt,
    targetPc: null,
    orientationIcrs: sample.orientationIcrs,
    unresolved: null,
  };
}

/** @param {unknown} input @returns {Record<string, any> | null} */
function normalizeSkykitLookAtInput(input) {
  if (typeof input === 'string') {
    const parsed = parseSpatialLookAtText(input);
    return parsed ? normalizeSkykitLookAtInput(parsed) : { kind: 'bookmark', id: input };
  }
  if (!input || typeof input !== 'object') return null;
  if (Array.isArray(input)) return normalizeSkykitTargetInput(input);
  const value = /** @type {Record<string, unknown>} */ (input);
  if ('orientationIcrs' in value) {
    return { orientationIcrs: normalizeSpatialQuaternion(value.orientationIcrs, SPATIAL_IDENTITY_QUATERNION) };
  }
  if ('lookAt' in value && value.lookAt) return normalizeSkykitLookAtInput(value.lookAt);
  if ('targetPc' in value) {
    return {
      ...value,
      targetPc: normalizeSkykitVector3(value.targetPc),
    };
  }
  if ('centerPc' in value && !('targetPc' in value)) {
    return { kind: 'position', targetPc: normalizeSkykitVector3(value.centerPc) };
  }
  if ('star' in value) return value;
  if (value.kind === 'direction' && value.forwardIcrs !== undefined) {
    return {
      kind: 'direction',
      forwardIcrs: normalizeSpatialVector3(value.forwardIcrs),
      ...(value.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(value.upIcrs) } : {}),
      ...(value.positionAngleDeg !== undefined ? { positionAngleDeg: Number(value.positionAngleDeg) } : {}),
    };
  }
  if (('raDeg' in value || 'raHours' in value || 'decDeg' in value) && value.distancePc === undefined) {
    return {
      ...value,
      kind: 'direction',
      forwardIcrs: normalizeSpatialVector3(raDecDistanceToIcrs({
        ...(value.raDeg !== undefined ? { raDeg: Number(value.raDeg) } : {}),
        ...(value.raHours !== undefined ? { raHours: Number(value.raHours) } : {}),
        decDeg: Number(value.decDeg),
        distancePc: 1,
      })),
      ...(value.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(value.upIcrs) } : {}),
      ...(value.positionAngleDeg !== undefined ? { positionAngleDeg: Number(value.positionAngleDeg) } : {}),
    };
  }
  return normalizeSkykitTargetInput(value);
}

/** @param {unknown} targetPc @param {{ upIcrs?: unknown; positionAngleDeg?: unknown }} [options] */
export function skykitTargetToAimSpec(targetPc, options = {}) {
  return {
    kind: 'target',
    targetPc: normalizeSpatialVector3(targetPc),
    upIcrs: normalizeSpatialVector3(options.upIcrs ?? SKYKIT_DEFAULT_LOOK_UP),
    ...(options.positionAngleDeg !== undefined ? { positionAngleDeg: -Number(options.positionAngleDeg) } : {}),
  };
}

/** @param {unknown} point */
export function skykitPointToTargetSpec(point) {
  return { kind: 'position', targetPc: normalizeSpatialVector3(point) };
}

/** @param {unknown} input */
export function skykitRaDecToTargetSpec(input) {
  const target = normalizeSkykitTargetInput(input);
  if (target.kind !== 'radec') return target;
  const targetPc = raDecDistanceToIcrs(target);
  return targetPc ? { kind: 'position', targetPc } : target;
}

/** @param {Record<string, any>} source @param {ResolvedSkykitLookAt} resolved @returns {ResolvedSkykitLookAt} */
function mergeResolvedStarLook(source, resolved) {
  const resolvedLook = resolved.lookAt && typeof resolved.lookAt === 'object'
    ? resolved.lookAt
    : {};
  return {
    ...resolved,
    lookAt: {
      ...source,
      ...resolvedLook,
      star: source.star,
      ...(source.positionAngleDeg !== undefined && resolvedLook.positionAngleDeg === undefined
        ? { positionAngleDeg: source.positionAngleDeg }
        : {}),
    },
  };
}

/** @param {Record<string, any>} source @param {unknown} resolved */
function mergeStarResolvedInput(source, resolved) {
  const inheritedAim = {
    ...(source.positionAngleDeg !== undefined ? { positionAngleDeg: source.positionAngleDeg } : {}),
    ...(source.upIcrs !== undefined ? { upIcrs: source.upIcrs } : {}),
  };
  if (Array.isArray(resolved)) {
    return { targetPc: resolved, ...inheritedAim };
  }
  if (!resolved || typeof resolved !== 'object') return resolved;
  const value = /** @type {Record<string, unknown>} */ (resolved);
  if ('x' in value && 'y' in value && 'z' in value) {
    return { targetPc: value, ...inheritedAim };
  }
  return {
    ...value,
    ...(source.positionAngleDeg !== undefined && value.positionAngleDeg === undefined
      ? { positionAngleDeg: source.positionAngleDeg }
      : {}),
    ...(source.upIcrs !== undefined && value.upIcrs === undefined
      ? { upIcrs: source.upIcrs }
      : {}),
  };
}

/** @param {unknown} input @returns {SpatialVector3} */
function normalizeSkykitVector3(input) {
  if (Array.isArray(input) && input.length >= 3) {
    return normalizeSpatialVector3({ x: input[0], y: input[1], z: input[2] });
  }
  return normalizeSpatialVector3(input);
}

/** @param {string} text @returns {SkykitLookAtSpecInput | null} */
function parseLookAtJson(text) {
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return normalizeSkykitLookAtInput(JSON.parse(text));
  } catch {
    return null;
  }
}

/** @param {string} text @returns {SkykitLookAtSpecInput | null} */
function parseNamedRaDec(text) {
  const result = {};
  for (const { key, rawValue } of extractNamedValues(text)) {
    const normalizedKey = normalizeLookAtKey(key);
    if (
      normalizedKey === 'ra'
      || normalizedKey === 'rightascension'
      || normalizedKey === 'radeg'
      || normalizedKey === 'rahour'
      || normalizedKey === 'rahours'
    ) {
      const ra = parseRaValue(rawValue, normalizedKey);
      if (ra) Object.assign(result, ra);
    } else if (
      normalizedKey === 'dec'
      || normalizedKey === 'declination'
      || normalizedKey === 'decdeg'
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
  return isRaDecLike(result) ? /** @type {SkykitLookAtSpecInput} */ (result) : null;
}

/** @param {unknown} value @param {string} key */
function parseRaValue(value, key) {
  return parseRightAscension(value, {
    unit: key.includes('hour') ? 'hours' : key.includes('deg') ? 'degrees' : 'auto',
  });
}

/** @param {string[]} parts @returns {SkykitLookAtSpecInput | null} */
function parseRaDecDistanceParts(parts) {
  if (!looksParsecDistance(parts[2])) return null;
  const ra = parseRaValue(parts[0], 'ra');
  const decDeg = parseDeclination(parts[1]);
  const distancePc = parsePlainNumber(parts[2]);
  return ra && decDeg != null && Number.isFinite(distancePc)
    ? { ...ra, decDeg, distancePc }
    : null;
}

/** @param {unknown} value */
function looksParsecDistance(value) {
  return /(?:parsecs?|pc)\b/i.test(normalizeAngleText(value));
}

/** @param {unknown} value */
function parsePlainNumber(value) {
  const text = normalizeAngleText(value)
    .trim()
    .toLowerCase()
    .replace(/^\+/, '')
    .replace(/\s*(?:degrees?|deg|°|d|hours?|hrs?|hr|h|parsecs?|pc)$/i, '')
    .trim();
  return text ? Number(text) : Number.NaN;
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
    return { key: match[0], rawValue };
  }).filter((entry) => entry.rawValue.length > 0);
}

const NAMED_LOOK_AT_KEY_PATTERN = /\bright\s+ascension\b|\bright[-_]?ascension\b|\bra[-_\s]?hours?\b|\brahours\b|\bra[-_\s]?deg(?:rees?)?\b|\bradeg\b|\bra\b|\bdeclination\b|\bdec[-_\s]?deg(?:rees?)?\b|\bdecdeg\b|\bdec\b|\bdistance[-_\s]?pc\b|\bdistancepc\b|\bdistance\b|\bposition[-_\s]?angle[-_\s]?deg\b|\bpositionangledeg\b|\bposition[-_\s]?angle\b|\bpositionangle\b|\bpa\b/gi;

/** @param {unknown} key */
function normalizeLookAtKey(key) {
  return String(key ?? '').toLowerCase().replace(/[-_\s]+/g, '');
}

/** @param {unknown} value */
function parseSexagesimalAngle(value) {
  const text = normalizeAngleText(value).toLowerCase();
  if (!looksSexagesimal(text)) return Number.NaN;
  const signMatch = text.match(/^\s*([+-])/);
  let sign = signMatch?.[1] === '-' ? -1 : 1;
  const body = text
    .replace(/^\s*[+-]\s*/, '')
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

/** @param {string} text @param {SkykitRightAscensionUnit} [option] */
function resolveRightAscensionUnit(text, option = 'auto') {
  if (option === 'hours' || option === 'hour') return 'hours';
  if (option === 'degrees' || option === 'degree' || option === 'deg') return 'degrees';
  const lower = normalizeAngleText(text).toLowerCase();
  if (/\bra[-_\s]?hours?\b|\bhours?\b|\bhrs?\b|\bhr\b|h(?=\s|$|\d)/.test(lower)) {
    return 'hours';
  }
  if (/\bra[-_\s]?deg(?:rees?)?\b|\bdegrees?\b|\bdeg\b|°|d(?=\s|$|\d)/.test(lower)) {
    return 'degrees';
  }
  return looksSexagesimal(lower) ? 'hours' : 'degrees';
}

/** @param {string[]} parts @returns {SpatialVector3 | null} */
function vectorFromParts(parts) {
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRaDecLike(value) {
  const candidate = value && typeof value === 'object'
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
  return Boolean(
    candidate
    && (Number.isFinite(Number(candidate.raDeg)) || Number.isFinite(Number(candidate.raHours)))
    && Number.isFinite(Number(candidate.decDeg)),
  );
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** @param {unknown} value */
function isDirectionOnlyRaDec(value) {
  return Boolean(isRaDecLike(value) && value.distancePc === undefined);
}

/** @param {unknown} value */
function isDirectionOnlyTargetInput(value) {
  if (isDirectionOnlyRaDec(value)) return true;
  if (typeof value !== 'string') return false;
  const parsed = parseSpatialLookAtText(value);
  return isDirectionOnlyRaDec(parsed);
}

/** @param {unknown} value @returns {value is PromiseLike<unknown>} */
function isPromiseLike(value) {
  return Boolean(
    value
    && (typeof value === 'object' || typeof value === 'function')
    && typeof /** @type {{ then?: unknown }} */ (value).then === 'function',
  );
}
