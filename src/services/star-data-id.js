const STAR_DATA_ID_VERSION = 1;
const MAX_OCTREE_LEVEL = 21;
const UUID_V1_TO_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertIntegerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }

  return value;
}

function parseNonNegativeInteger(value, label) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${label} must be a non-negative integer`);
    }

    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw new RangeError(`${label} must be <= ${Number.MAX_SAFE_INTEGER}`);
    }

    return parsed;
  }

  throw new TypeError(`${label} must be a non-negative integer`);
}

function parseMortonCode(value) {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new RangeError('mortonCode must be >= 0');
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('mortonCode must be a non-negative safe integer');
    }
    return BigInt(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new TypeError('mortonCode must be a bigint, number, or numeric string');
}

function parseBase36Integer(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-z]+$/i.test(value)) {
    throw new Error(`${label} must be a base36 token`);
  }

  let parsed = 0n;
  const normalized = value.toLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const digit = code >= 48 && code <= 57
      ? BigInt(code - 48)
      : BigInt(code - 87);
    parsed = parsed * 36n + digit;
  }

  return parsed;
}

function assertDatasetUuid(value) {
  if (typeof value !== 'string' || !UUID_V1_TO_V5_PATTERN.test(value.trim())) {
    throw new TypeError('datasetUuid must be an RFC 4122 UUID string');
  }

  return value.trim().toLowerCase();
}

function assertMortonBounds(mortonCode, level) {
  const bitCount = BigInt(level * 3);
  const maxMortonCode = bitCount === 0n ? 0n : (1n << bitCount) - 1n;
  if (mortonCode > maxMortonCode) {
    throw new RangeError(`mortonCode exceeds the maximum value for level ${level}`);
  }
}

export function encodeMorton3D(gridX, gridY, gridZ, level) {
  const normalizedLevel = assertIntegerInRange(level, 0, MAX_OCTREE_LEVEL, 'level');
  const axisLimit = 2 ** normalizedLevel;

  const x = assertIntegerInRange(gridX, 0, axisLimit - 1, 'gridX');
  const y = assertIntegerInRange(gridY, 0, axisLimit - 1, 'gridY');
  const z = assertIntegerInRange(gridZ, 0, axisLimit - 1, 'gridZ');

  let mortonCode = 0n;
  for (let bit = 0; bit < normalizedLevel; bit += 1) {
    const shift = BigInt(bit * 3);
    mortonCode |= BigInt((x >> bit) & 1) << shift;
    mortonCode |= BigInt((y >> bit) & 1) << (shift + 1n);
    mortonCode |= BigInt((z >> bit) & 1) << (shift + 2n);
  }

  return mortonCode;
}

export function decodeMorton3D(mortonCode, level) {
  const normalizedLevel = assertIntegerInRange(level, 0, MAX_OCTREE_LEVEL, 'level');
  const normalizedMorton = parseMortonCode(mortonCode);
  assertMortonBounds(normalizedMorton, normalizedLevel);

  let gridX = 0;
  let gridY = 0;
  let gridZ = 0;

  for (let bit = 0; bit < normalizedLevel; bit += 1) {
    const shift = BigInt(bit * 3);
    gridX |= Number((normalizedMorton >> shift) & 1n) << bit;
    gridY |= Number((normalizedMorton >> (shift + 1n)) & 1n) << bit;
    gridZ |= Number((normalizedMorton >> (shift + 2n)) & 1n) << bit;
  }

  return { gridX, gridY, gridZ };
}

export function toStarDataId(pickMeta, datasetIdentity) {
  if (!pickMeta || typeof pickMeta !== 'object') {
    throw new TypeError('pickMeta must be an object');
  }

  const datasetUuid = assertDatasetUuid(datasetIdentity?.datasetUuid);
  const level = assertIntegerInRange(pickMeta.level, 0, MAX_OCTREE_LEVEL, 'pickMeta.level');
  const ordinal = parseNonNegativeInteger(pickMeta.ordinal, 'pickMeta.ordinal');

  const mortonCode = encodeMorton3D(
    pickMeta.gridX,
    pickMeta.gridY,
    pickMeta.gridZ,
    level,
  );

  return {
    version: STAR_DATA_ID_VERSION,
    datasetUuid,
    level,
    mortonCode: mortonCode.toString(10),
    ordinal,
  };
}

export function fromStarDataId(starDataId) {
  if (!starDataId || typeof starDataId !== 'object') {
    throw new TypeError('starDataId must be an object');
  }

  const version = starDataId.version == null
    ? STAR_DATA_ID_VERSION
    : assertIntegerInRange(starDataId.version, STAR_DATA_ID_VERSION, STAR_DATA_ID_VERSION, 'version');
  const datasetUuid = assertDatasetUuid(starDataId.datasetUuid);
  const level = assertIntegerInRange(starDataId.level, 0, MAX_OCTREE_LEVEL, 'level');
  const mortonCode = parseMortonCode(starDataId.mortonCode);
  assertMortonBounds(mortonCode, level);
  const ordinal = parseNonNegativeInteger(starDataId.ordinal, 'ordinal');

  return {
    version,
    datasetUuid,
    level,
    mortonCode: mortonCode.toString(10),
    ordinal,
  };
}

export function serializeStarDataId(starDataId) {
  const normalized = fromStarDataId(starDataId);

  return [
    `sdi${normalized.version}`,
    normalized.datasetUuid,
    normalized.level.toString(36),
    BigInt(normalized.mortonCode).toString(36),
    normalized.ordinal.toString(36),
  ].join('.');
}

export function parseStarDataId(serialized) {
  if (typeof serialized !== 'string') {
    throw new TypeError('serialized starDataId must be a string');
  }

  const parts = serialized.split('.');
  if (parts.length !== 5) {
    throw new Error('serialized starDataId must have 5 dot-separated parts');
  }

  const [versionToken, datasetUuid, levelToken, mortonToken, ordinalToken] = parts;
  const versionMatch = /^sdi(\d+)$/.exec(versionToken);
  if (!versionMatch) {
    throw new Error('serialized starDataId has invalid version token');
  }

  const level = Number(parseBase36Integer(levelToken, 'level token'));
  const ordinal = Number(parseBase36Integer(ordinalToken, 'ordinal token'));
  const mortonCode = parseBase36Integer(mortonToken, 'morton token');

  return fromStarDataId({
    version: Number.parseInt(versionMatch[1], 10),
    datasetUuid,
    level,
    mortonCode,
    ordinal,
  });
}
