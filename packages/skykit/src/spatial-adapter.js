// @ts-nocheck

import {
  SPATIAL_IDENTITY_QUATERNION,
  evaluateSpatialAim,
  normalizeSpatialQuaternion,
  normalizeSpatialTarget,
  normalizeSpatialVector3,
  raDecDistanceToIcrs,
  resolveSpatialTarget,
} from '@found-in-space/spatial';

const COORDINATE_TEXT_PATTERN = /[-+\u2212]?\d+(?:\.\d+)?/g;
const SKYKIT_DEFAULT_LOOK_UP = Object.freeze({ x: 0, y: 0, z: 1 });

export function createRaDecLookAt(ra, dec, options = {}) {
  const parsedRa = parseRightAscension(ra, { unit: options.raUnit ?? 'auto' });
  const decDeg = parseDeclination(dec);
  if (!parsedRa || decDeg == null) return null;
  return {
    kind: 'radec',
    ...parsedRa,
    decDeg,
    ...(options.distancePc !== undefined ? { distancePc: Number(options.distancePc) } : {}),
    ...(options.positionAngleDeg !== undefined ? { positionAngleDeg: Number(options.positionAngleDeg) } : {}),
  };
}

export function parseSpatialLookAtText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeSkykitLookAtInput(parsed);
    } catch {
      return null;
    }
  }
  const lower = trimmed.toLowerCase();
  const distanceMatch = lower.match(/([-+\u2212]?\d+(?:\.\d+)?)\s*pc\b/);
  const distancePc = distanceMatch ? Number(distanceMatch[1].replace('\u2212', '-')) : undefined;
  const namedRa = lower.match(/(?:ra|right\s*ascension)\s*=?\s*([^,\n]+)/i);
  const namedDec = lower.match(/(?:dec|declination)\s*=?\s*([^,\n]+)/i);
  if (namedRa && namedDec) {
    const ra = parseRightAscension(namedRa[1], { unit: 'auto' });
    const decDeg = parseDeclination(namedDec[1]);
    if (ra && decDeg != null) {
      return { kind: 'radec', ...ra, decDeg, ...(distancePc !== undefined ? { distancePc } : {}) };
    }
  }
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const ra = parseRightAscension(parts[0], { unit: 'auto' });
    const decDeg = parseDeclination(parts[1]);
    if (ra && decDeg != null) {
      return { kind: 'radec', ...ra, decDeg, ...(distancePc !== undefined ? { distancePc } : {}) };
    }
  }
  const numbers = Array.from(trimmed.matchAll(COORDINATE_TEXT_PATTERN), (match) => Number(match[0].replace('\u2212', '-')));
  if (numbers.length >= 3 && numbers.every(Number.isFinite)) {
    return { kind: 'position', targetPc: { x: numbers[0], y: numbers[1], z: numbers[2] } };
  }
  return null;
}

export function parseRightAscension(value, options = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return options.unit === 'deg' ? { raDeg: value } : { raHours: value };
  }
  const text = String(value ?? '').trim().replace(/\u2212/g, '-');
  if (!text) return null;
  const hasHours = /\bh\b|hour|:/.test(text.toLowerCase());
  const numbers = Array.from(text.matchAll(COORDINATE_TEXT_PATTERN), (match) => Number(match[0].replace('\u2212', '-')));
  if (numbers.length === 0 || numbers.some((number) => !Number.isFinite(number))) return null;
  const absolute = Math.abs(numbers[0]) + Math.abs(numbers[1] ?? 0) / 60 + Math.abs(numbers[2] ?? 0) / 3600;
  const signed = numbers[0] < 0 ? -absolute : absolute;
  const unit = options.unit === 'auto' ? (hasHours || Math.abs(signed) <= 24 ? 'hours' : 'deg') : options.unit;
  return unit === 'deg' ? { raDeg: signed } : { raHours: signed };
}

export function parseDeclination(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim().replace(/\u2212/g, '-');
  if (!text) return null;
  const numbers = Array.from(text.matchAll(COORDINATE_TEXT_PATTERN), (match) => Number(match[0].replace('\u2212', '-')));
  if (numbers.length === 0 || numbers.some((number) => !Number.isFinite(number))) return null;
  const sign = text.trim().startsWith('-') ? -1 : 1;
  return sign * (Math.abs(numbers[0]) + Math.abs(numbers[1] ?? 0) / 60 + Math.abs(numbers[2] ?? 0) / 3600);
}

export function normalizeSkykitTargetInput(input) {
  if (Array.isArray(input) && input.length >= 3) {
    return { kind: 'position', targetPc: { x: Number(input[0]), y: Number(input[1]), z: Number(input[2]) } };
  }
  if (typeof input === 'string') {
    const parsed = parseSpatialLookAtText(input);
    return parsed ? normalizeSkykitTargetInput(parsed) : { kind: 'bookmark', id: input };
  }
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SkyKit target input.');
  }
  if (input.kind === 'position' || input.kind === 'radec' || input.kind === 'bookmark') {
    return normalizeSpatialTarget({
      ...input,
      ...(input.kind === 'radec' && input.distancePc === undefined ? { distancePc: 1 } : {}),
    });
  }
  if ('targetPc' in input) {
    return { kind: 'position', targetPc: normalizeSpatialVector3(input.targetPc) };
  }
  if ('positionPc' in input) {
    return { kind: 'position', targetPc: normalizeSpatialVector3(input.positionPc) };
  }
  if ('x' in input && 'y' in input && 'z' in input) {
    return { kind: 'position', targetPc: normalizeSpatialVector3(input) };
  }
  if ('raDeg' in input || 'raHours' in input || 'decDeg' in input) {
    return normalizeSpatialTarget({
      kind: 'radec',
      raDeg: input.raDeg,
      raHours: input.raHours,
      decDeg: input.decDeg,
      distancePc: input.distancePc ?? 1,
    });
  }
  if ('bookmarkId' in input) {
    return { kind: 'bookmark', id: String(input.bookmarkId) };
  }
  throw new TypeError('Unsupported SkyKit target input.');
}

export async function resolveSkykitTarget(input, options = {}) {
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
  return resolveSpatialTarget(target);
}

export function resolveSkykitTargetSync(input, options = {}) {
  const target = normalizeSkykitTargetInput(input);
  if (target.kind === 'bookmark') {
    if (typeof options.resolveBookmark !== 'function') return null;
    const resolved = options.resolveBookmark(target.id, target);
    if (resolved && typeof resolved.then === 'function') {
      throw new TypeError('Synchronous target resolution received an async resolver result.');
    }
    return resolved ? resolveSkykitTargetSync(resolved, options) : null;
  }
  const resolved = resolveSpatialTarget(target);
  if (resolved && typeof resolved.then === 'function') {
    throw new TypeError('Synchronous target resolution received an async resolver result.');
  }
  return resolved;
}

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
  const targetPc = await resolveSkykitTarget(normalized, options);
  return resolvedLookFromTarget(normalized, targetPc, options.observerPc);
}

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
  if ('star' in normalized && !('targetPc' in normalized)) {
    return {
      lookAt: normalized,
      targetPc: null,
      orientationIcrs: null,
      unresolved: normalized,
    };
  }
  const targetPc = resolveSkykitTargetSync(normalized, options);
  return resolvedLookFromTarget(normalized, targetPc, options.observerPc);
}

export function computeSkykitLookAtOrientation(input) {
  const observerPc = normalizeSpatialVector3(input?.observerPc ?? input?.position);
  const targetPc = normalizeSpatialVector3(input?.targetPc ?? input?.target);
  const sample = evaluateSpatialAim({
    observerPc,
    aim: {
      kind: 'target',
      targetPc,
      upIcrs: input?.upIcrs ?? input?.up ?? SKYKIT_DEFAULT_LOOK_UP,
      ...(input?.positionAngleDeg !== undefined ? { positionAngleDeg: -Number(input.positionAngleDeg) } : {}),
    },
  });
  return sample.orientationIcrs;
}

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

function normalizeSkykitLookAtInput(input) {
  if (typeof input === 'string') return parseSpatialLookAtText(input) ?? { kind: 'bookmark', id: input };
  if (!input || typeof input !== 'object') return null;
  if ('orientationIcrs' in input) {
    return { orientationIcrs: normalizeSpatialQuaternion(input.orientationIcrs, SPATIAL_IDENTITY_QUATERNION) };
  }
  if ('lookAt' in input && input.lookAt) return normalizeSkykitLookAtInput(input.lookAt);
  if ('targetPc' in input) {
    return {
      ...input,
      targetPc: normalizeSpatialVector3(input.targetPc),
    };
  }
  if ('centerPc' in input && !('targetPc' in input)) {
    return { kind: 'position', targetPc: normalizeSpatialVector3(input.centerPc) };
  }
  if ('star' in input) return input;
  if (input.kind === 'direction' && input.forwardIcrs !== undefined) {
    return {
      kind: 'direction',
      forwardIcrs: normalizeSpatialVector3(input.forwardIcrs),
      ...(input.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(input.upIcrs) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: Number(input.positionAngleDeg) } : {}),
    };
  }
  if (('raDeg' in input || 'raHours' in input || 'decDeg' in input) && input.distancePc === undefined) {
    return {
      kind: 'direction',
      forwardIcrs: normalizeSpatialVector3(raDecDistanceToIcrs({
        raDeg: input.raDeg,
        raHours: input.raHours,
        decDeg: input.decDeg,
        distancePc: 1,
      })),
      ...(input.upIcrs !== undefined ? { upIcrs: normalizeSpatialVector3(input.upIcrs) } : {}),
      ...(input.positionAngleDeg !== undefined ? { positionAngleDeg: Number(input.positionAngleDeg) } : {}),
    };
  }
  return normalizeSkykitTargetInput(input);
}

export function skykitTargetToAimSpec(targetPc, options = {}) {
  return {
    kind: 'target',
    targetPc: normalizeSpatialVector3(targetPc),
    upIcrs: normalizeSpatialVector3(options.upIcrs ?? SKYKIT_DEFAULT_LOOK_UP),
    ...(options.positionAngleDeg !== undefined ? { positionAngleDeg: -Number(options.positionAngleDeg) } : {}),
  };
}

export function skykitPointToTargetSpec(point) {
  return { kind: 'position', targetPc: normalizeSpatialVector3(point) };
}

export function skykitRaDecToTargetSpec(input) {
  const target = normalizeSkykitTargetInput(input);
  if (target.kind !== 'radec') return target;
  const targetPc = raDecDistanceToIcrs(target);
  return targetPc ? { kind: 'position', targetPc } : target;
}
