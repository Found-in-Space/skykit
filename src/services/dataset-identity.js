function stableHash(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(6) : 'na';
}

function serializeHeaderFingerprint(header) {
  if (!header || typeof header !== 'object') {
    return 'no-header';
  }

  return [
    `version=${header.version ?? 'na'}`,
    `indexOffset=${header.indexOffset ?? 'na'}`,
    `indexLength=${header.indexLength ?? 'na'}`,
    `center=${normalizeNumber(header.worldCenterX)},${normalizeNumber(header.worldCenterY)},${normalizeNumber(header.worldCenterZ)}`,
    `halfSize=${normalizeNumber(header.worldHalfSize)}`,
    `payloadRecordSize=${header.payloadRecordSize ?? 'na'}`,
    `maxLevel=${header.maxLevel ?? 'na'}`,
    `magLimit=${normalizeNumber(header.magLimit)}`,
  ].join('|');
}

export function deriveRenderDatasetUuid(options = {}) {
  const explicitUuid = typeof options.datasetUuid === 'string' ? options.datasetUuid.trim() : '';
  if (explicitUuid) {
    return {
      datasetUuid: explicitUuid,
      datasetIdentitySource: 'explicit',
    };
  }

  const basis = [
    'render-dataset',
    options.manifestUrl ?? '',
    options.octreeUrl ?? '',
    options.identifiersOrderUrl ?? '',
    serializeHeaderFingerprint(options.header),
  ].join('|');

  return {
    datasetUuid: `derived-render-${stableHash(basis)}`,
    datasetIdentitySource: 'derived-render-header',
  };
}

export function deriveSidecarUuid(options = {}) {
  const explicitUuid = typeof options.sidecarUuid === 'string' ? options.sidecarUuid.trim() : '';
  if (explicitUuid) {
    return {
      sidecarUuid: explicitUuid,
      sidecarIdentitySource: 'explicit',
    };
  }

  const basis = [
    'sidecar',
    options.sidecarName ?? '',
    options.url ?? '',
    options.parentDatasetUuid ?? '',
    serializeHeaderFingerprint(options.header),
  ].join('|');

  return {
    sidecarUuid: `derived-sidecar-${stableHash(basis)}`,
    sidecarIdentitySource: 'derived-sidecar-header',
  };
}

