export const HA_TILED_VOLUME_FORMAT = 'mccallum_ha_tiled_volume_v1';
export const DEFAULT_MCCALLUM_HA_TILED_VOLUME_URL = 'https://d1kwci8ql2abxm.cloudfront.net/mccallum2025/15fe84ad/manifest.json';
export const HA_TILED_LEVEL_MAGIC = 'FHATILE1';
export const HA_TILED_LEVEL_HEADER_BYTES = 128;
export const HA_TILED_LEVEL_RECORD_BYTES = 32;
export const DEFAULT_HA_TILED_MAX_RESIDENT_BRICKS = 128;
export const DEFAULT_HA_TILED_MAX_INFLIGHT_REQUESTS = 8;
export const DEFAULT_HA_TILED_BATCH_MAX_BRICKS = 8;
export const DEFAULT_HA_TILED_BATCH_MAX_BYTES = 32 * 1024 * 1024;

const decoder = new TextDecoder('ascii');

function defaultFetch(...args) {
  return globalThis.fetch(...args);
}

function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function assertArrayBufferLooksBinary(buf, label) {
  if (buf.byteLength >= 1 && new Uint8Array(buf)[0] === 0x3c) {
    throw new Error(`${label} looks like HTML (starts with '<'), not H-alpha tiled volume data`);
  }
}

function resolveAssetUrl(assetPath, baseUrl) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(assetPath)) {
    return assetPath;
  }
  const cut = baseUrl.lastIndexOf('/');
  if (cut < 0) return assetPath;
  return `${baseUrl.slice(0, cut + 1)}${assetPath}`;
}

function keyForBrick(brick) {
  return `${brick.levelId}:${brick.slotIndex}`;
}

async function fetchRange(fetchImpl, url, start, end, label) {
  const expectedBytes = end - start + 1;
  const response = await fetchImpl(url, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Failed to fetch ${label}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `${label} range request returned ${buffer.byteLength} bytes, expected ${expectedBytes}`,
    );
  }
  return buffer;
}

export function resolveHaTiledVolumeUrl(search = null) {
  const searchValue = typeof search === 'string'
    ? search
    : globalThis.location?.search ?? '';
  const params = new URLSearchParams(searchValue);
  return (
    params.get('haTiledUrl')?.trim()
    || params.get('haVolumeUrl')?.trim()
    || DEFAULT_MCCALLUM_HA_TILED_VOLUME_URL
  );
}

export function resolveHaTiledVolumeLevelIds(search = null) {
  const searchValue = typeof search === 'string'
    ? search
    : globalThis.location?.search ?? '';
  const params = new URLSearchParams(searchValue);
  return {
    initialLevelId: (
      params.get('haInitialLevel')?.trim()
      || params.get('haLowLevel')?.trim()
      || null
    ),
    finalLevelId: (
      params.get('haFinalLevel')?.trim()
      || params.get('haHighLevel')?.trim()
      || params.get('haDisplayLevel')?.trim()
      || null
    ),
  };
}

export async function decompressGzipBuffer(compressed) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream("gzip") is not available in this runtime');
  }

  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(compressed));
  writer.close();

  const reader = stream.readable.getReader();
  const chunks = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

function parseHeader(buf, options = {}) {
  assertArrayBufferLooksBinary(buf, options.sourceUrl ?? 'H-alpha tiled volume level');
  if (buf.byteLength < HA_TILED_LEVEL_HEADER_BYTES) {
    throw new Error(
      `File too small for H-alpha tiled level header (${buf.byteLength} < ${HA_TILED_LEVEL_HEADER_BYTES})`,
    );
  }

  const dv = new DataView(buf);
  const magic = decoder.decode(new Uint8Array(buf, 0, 8)).replace(/\0+$/, '');
  if (magic !== HA_TILED_LEVEL_MAGIC) {
    throw new Error(`Bad H-alpha tiled level magic ${JSON.stringify(magic)}`);
  }

  const header = {
    version: dv.getUint16(8, true),
    headerBytes: dv.getUint16(10, true),
    recordBytes: dv.getUint32(12, true),
    brickCount: dv.getUint32(16, true),
    levelIndex: dv.getUint16(20, true),
    tileGridSize: dv.getUint16(22, true),
    dimension: dv.getUint32(24, true),
    sampleSize: dv.getUint32(28, true),
    flags: dv.getUint32(32, true),
    scalarMax: dv.getFloat32(36, true),
    centerBoundsPc: {
      x: [dv.getFloat32(40, true), dv.getFloat32(44, true)],
      y: [dv.getFloat32(48, true), dv.getFloat32(52, true)],
      z: [dv.getFloat32(56, true), dv.getFloat32(60, true)],
    },
    worldBoundsPc: {
      x: [dv.getFloat32(64, true), dv.getFloat32(68, true)],
      y: [dv.getFloat32(72, true), dv.getFloat32(76, true)],
      z: [dv.getFloat32(80, true), dv.getFloat32(84, true)],
    },
    payloadStart: Number(dv.getBigUint64(88, true)),
    fileBytes: Number(dv.getBigUint64(96, true)),
    compressedPayloadBytes: Number(dv.getBigUint64(104, true)),
    uncompressedPayloadBytes: Number(dv.getBigUint64(112, true)),
    sourceUrl: options.sourceUrl ?? null,
  };
  header.tableBytes = header.headerBytes + header.brickCount * header.recordBytes;

  if (header.headerBytes !== HA_TILED_LEVEL_HEADER_BYTES) {
    throw new Error(`Unsupported H-alpha tiled level header size ${header.headerBytes}`);
  }
  if (header.recordBytes !== HA_TILED_LEVEL_RECORD_BYTES) {
    throw new Error(`Unsupported H-alpha tiled level record size ${header.recordBytes}`);
  }
  if (header.tileGridSize ** 3 !== header.brickCount) {
    throw new Error(
      `H-alpha tiled brick count ${header.brickCount} does not match ${header.tileGridSize}^3`,
    );
  }
  if (header.dimension !== header.sampleSize * header.tileGridSize) {
    throw new Error(
      `H-alpha tiled dimension ${header.dimension} does not match ${header.sampleSize} * ${header.tileGridSize}`,
    );
  }

  return header;
}

export function parseHaTiledLevelBuffer(buf, options = {}) {
  const header = parseHeader(buf, options);
  if (buf.byteLength < header.tableBytes) {
    throw new Error(
      `File too small for H-alpha tiled records (${buf.byteLength} < ${header.tableBytes})`,
    );
  }

  const dv = new DataView(buf);
  const levelId = options.levelId ?? `l${header.levelIndex}`;
  const manifestLevel = options.manifestLevel ?? {};
  const inferredTextureSize = Math.round(
    Math.cbrt(header.uncompressedPayloadBytes / header.brickCount),
  );
  const textureSampleSize = normalizePositiveInteger(
    options.textureSampleSize
      ?? manifestLevel.texture_sample_size
      ?? inferredTextureSize,
    header.sampleSize,
  );
  const inferredHaloCells = Math.max(
    0,
    Math.round((textureSampleSize - header.sampleSize) / 2),
  );
  const tileHaloCells = normalizeNonNegativeInteger(
    options.tileHaloCells
      ?? manifestLevel.tile_halo_cells
      ?? inferredHaloCells,
    0,
  );
  if (textureSampleSize !== header.sampleSize + 2 * tileHaloCells) {
    throw new Error(
      `H-alpha tiled level texture size ${textureSampleSize} does not match sample size ${header.sampleSize} plus halo ${tileHaloCells}`,
    );
  }

  const bricks = [];
  for (let index = 0; index < header.brickCount; index += 1) {
    const off = header.headerBytes + index * header.recordBytes;
    const slotIndex = dv.getUint32(off, true);
    const brick = {
      index,
      slotIndex,
      levelIndex: header.levelIndex,
      levelId,
      sampleSize: header.sampleSize,
      textureSampleSize,
      tileHaloCells,
      gridX: dv.getUint16(off + 4, true),
      gridY: dv.getUint16(off + 6, true),
      gridZ: dv.getUint16(off + 8, true),
      encodedMax: dv.getUint8(off + 12),
      flags: dv.getUint8(off + 13),
      nonzeroCount: dv.getUint32(off + 16, true),
      payloadOffset: Number(dv.getBigUint64(off + 20, true)),
      payloadLength: dv.getUint32(off + 28, true),
    };
    bricks[slotIndex] = brick;
  }

  return {
    ...header,
    id: levelId,
    url: options.sourceUrl ?? null,
    textureSampleSize,
    tileHaloCells,
    bricks,
  };
}

export function getHaTiledVolumeBrickBounds(volume, brick) {
  const world = volume.manifest.world_bounds_pc ?? volume.worldBoundsPc;
  const grid = volume.tileGridSize;
  const x0 = world.x[0] + (world.x[1] - world.x[0]) * (brick.gridX / grid);
  const x1 = world.x[0] + (world.x[1] - world.x[0]) * ((brick.gridX + 1) / grid);
  const y0 = world.y[0] + (world.y[1] - world.y[0]) * (brick.gridY / grid);
  const y1 = world.y[0] + (world.y[1] - world.y[0]) * ((brick.gridY + 1) / grid);
  const z0 = world.z[0] + (world.z[1] - world.z[0]) * (brick.gridZ / grid);
  const z1 = world.z[0] + (world.z[1] - world.z[0]) * ((brick.gridZ + 1) / grid);
  return {
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minY: Math.min(y0, y1),
    maxY: Math.max(y0, y1),
    minZ: Math.min(z0, z1),
    maxZ: Math.max(z0, z1),
  };
}

class HaTiledVolumeBrickCache {
  constructor(maxEntries = DEFAULT_HA_TILED_MAX_RESIDENT_BRICKS) {
    this.maxEntries = normalizePositiveInteger(
      maxEntries,
      DEFAULT_HA_TILED_MAX_RESIDENT_BRICKS,
    );
    this.map = new Map();
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    return this.map.get(key) ?? null;
  }

  set(key, value) {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      return null;
    }
    this.map.set(key, value);
    return value;
  }

  delete(key) {
    return this.map.delete(key);
  }

  get size() {
    return this.map.size;
  }
}

export class HaTiledVolumeService {
  constructor(volume, options = {}) {
    this.volume = volume;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.decompressImpl = options.decompressImpl ?? decompressGzipBuffer;
    this.cache = options.cache ?? new HaTiledVolumeBrickCache(options.maxResidentBricks);
    this.maxInflightRequests = normalizePositiveInteger(
      options.maxInflightRequests,
      DEFAULT_HA_TILED_MAX_INFLIGHT_REQUESTS,
    );
    this.inflight = new Map();
    this.stats = {
      rangeRequests: 0,
      bricksRequested: 0,
      bricksDecoded: 0,
      cacheHits: 0,
      inflightSkipped: 0,
      capacitySkipped: 0,
      bytesRequested: 0,
    };
  }

  get availableRequestSlots() {
    return Math.max(0, this.cache.maxEntries - this.cache.size - this.inflight.size);
  }

  hasDecodedBrick(brick) {
    return this.cache.has(keyForBrick(brick));
  }

  isBrickInflight(brick) {
    return this.inflight.has(keyForBrick(brick));
  }

  getDecodedBrick(brick) {
    const decoded = this.cache.get(keyForBrick(brick));
    if (decoded) this.stats.cacheHits += 1;
    return decoded;
  }

  deleteDecodedBrick(brick) {
    return this.cache.delete(keyForBrick(brick));
  }

  requestBrick(brick) {
    return this.requestBricks([brick], { maxBatchBricks: 1 })[0] ?? null;
  }

  requestBricks(bricks, options = {}) {
    const maxBatchBricks = normalizePositiveInteger(
      options.maxBatchBricks,
      DEFAULT_HA_TILED_BATCH_MAX_BRICKS,
    );
    const maxBatchBytes = normalizePositiveInteger(
      options.maxBatchBytes,
      DEFAULT_HA_TILED_BATCH_MAX_BYTES,
    );
    const candidates = [];
    for (const brick of bricks) {
      if (!brick || candidates.length >= this.availableRequestSlots) break;
      const key = keyForBrick(brick);
      if (this.cache.has(key) || this.inflight.has(key)) continue;
      if (brick.payloadLength <= 0) continue;
      candidates.push(brick);
    }
    if (candidates.length === 0) return [];

    const batches = [];
    let current = [];
    let currentStart = 0;
    let currentEnd = 0;
    for (const brick of [...candidates].sort((left, right) => {
      if (left.levelId !== right.levelId) return left.levelId.localeCompare(right.levelId);
      return left.payloadOffset - right.payloadOffset;
    })) {
      if (current.length > 0 && current[0].levelUrl !== brick.levelUrl) {
        batches.push(current);
        current = [];
      }

      const start = brick.payloadOffset;
      const end = brick.payloadOffset + brick.payloadLength - 1;
      const nextStart = current.length === 0 ? start : Math.min(currentStart, start);
      const nextEnd = current.length === 0 ? end : Math.max(currentEnd, end);
      if (
        current.length > 0
        && (current.length >= maxBatchBricks || nextEnd - nextStart + 1 > maxBatchBytes)
      ) {
        batches.push(current);
        current = [];
      }

      if (current.length === 0) {
        currentStart = start;
        currentEnd = end;
      } else {
        currentStart = Math.min(currentStart, start);
        currentEnd = Math.max(currentEnd, end);
      }
      current.push(brick);
    }
    if (current.length > 0) batches.push(current);

    const promises = [];
    for (const batch of batches) {
      if (this.inflight.size + batch.length > this.maxInflightRequests) {
        this.stats.inflightSkipped += batch.length;
        continue;
      }
      const promise = this.#requestBatch(batch)
        .finally(() => {
          for (const brick of batch) {
            this.inflight.delete(keyForBrick(brick));
          }
        });
      for (const brick of batch) {
        this.inflight.set(keyForBrick(brick), promise);
      }
      promises.push(promise);
    }
    return promises;
  }

  async #requestBatch(bricks) {
    const start = Math.min(...bricks.map((brick) => brick.payloadOffset));
    const end = Math.max(...bricks.map((brick) => brick.payloadOffset + brick.payloadLength - 1));
    const url = bricks[0].levelUrl;
    const rangeBytes = end - start + 1;
    this.stats.rangeRequests += 1;
    this.stats.bricksRequested += bricks.length;
    this.stats.bytesRequested += rangeBytes;

    const range = await fetchRange(this.fetchImpl, url, start, end, `H-alpha tiled bricks ${start}-${end}`);
    for (const brick of bricks) {
      const sliceStart = brick.payloadOffset - start;
      const sliceEnd = sliceStart + brick.payloadLength;
      const decoded = new Uint8Array(await this.decompressImpl(range.slice(sliceStart, sliceEnd)));
      const expectedBytes = brick.textureSampleSize ** 3;
      if (decoded.byteLength !== expectedBytes) {
        throw new Error(
          `Decoded H-alpha tiled brick ${keyForBrick(brick)} has ${decoded.byteLength} bytes, expected ${expectedBytes}`,
        );
      }
      const cached = this.cache.set(keyForBrick(brick), decoded);
      if (!cached) {
        this.stats.capacitySkipped += 1;
        continue;
      }
      this.stats.bricksDecoded += 1;
    }
    return bricks;
  }

  describe() {
    const readyByLevel = {};
    const totalByLevel = {};
    for (const level of this.volume.levels) {
      totalByLevel[level.id] = level.bricks.length;
      readyByLevel[level.id] = level.bricks.reduce(
        (count, brick) => count + (this.hasDecodedBrick(brick) ? 1 : 0),
        0,
      );
    }
    return {
      url: this.volume.manifestUrl,
      cachedBricks: this.cache.size,
      inflightBricks: this.inflight.size,
      readyByLevel,
      totalByLevel,
      stats: { ...this.stats },
    };
  }
}

async function loadHaTiledLevel(levelUrl, manifestLevel, options = {}) {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const headerBuffer = await fetchRange(
    fetchImpl,
    levelUrl,
    0,
    HA_TILED_LEVEL_HEADER_BYTES - 1,
    `H-alpha tiled level header ${levelUrl}`,
  );
  const header = parseHeader(headerBuffer, { sourceUrl: levelUrl });
  const tableBuffer = await fetchRange(
    fetchImpl,
    levelUrl,
    0,
    header.tableBytes - 1,
    `H-alpha tiled level table ${levelUrl}`,
  );
  const level = parseHaTiledLevelBuffer(tableBuffer, {
    sourceUrl: levelUrl,
    levelId: manifestLevel.id,
    manifestLevel,
  });
  for (const brick of level.bricks) {
    brick.level = level;
    brick.levelUrl = levelUrl;
  }
  return {
    ...level,
    manifestLevel,
    path: manifestLevel.path,
  };
}

export async function loadHaTiledVolume(
  manifestUrl = DEFAULT_MCCALLUM_HA_TILED_VOLUME_URL,
  options = {},
) {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const manifestResp = await fetchImpl(manifestUrl);
  if (!manifestResp.ok) {
    throw new Error(`Failed to fetch ${manifestUrl}: ${manifestResp.status}`);
  }
  const manifest = await manifestResp.json();
  if (manifest.format !== HA_TILED_VOLUME_FORMAT) {
    throw new Error(`Unsupported H-alpha tiled volume format ${JSON.stringify(manifest.format)}`);
  }

  const lowLevelId = options.lowLevelId ?? manifest.runtime_policy?.low_level_id ?? 'l3';
  const highLevelId = options.highLevelId ?? manifest.runtime_policy?.high_level_id ?? 'l0';
  const manifestLevels = new Map((manifest.lod?.levels ?? []).map((level) => [level.id, level]));
  const lowManifest = manifestLevels.get(lowLevelId);
  const highManifest = manifestLevels.get(highLevelId);
  if (!lowManifest || !highManifest) {
    throw new Error(`H-alpha tiled manifest must include ${lowLevelId} and ${highLevelId}`);
  }

  const loaded = new Map();
  for (const manifestLevel of [lowManifest, highManifest]) {
    if (loaded.has(manifestLevel.id)) continue;
    const levelUrl = resolveAssetUrl(manifestLevel.path, manifestUrl);
    loaded.set(manifestLevel.id, await loadHaTiledLevel(levelUrl, manifestLevel, { fetchImpl }));
  }

  const lowLevel = loaded.get(lowLevelId);
  const highLevel = loaded.get(highLevelId);
  if (lowLevel.tileGridSize !== highLevel.tileGridSize) {
    throw new Error(
      `H-alpha tiled levels must use the same tile grid (${lowLevel.tileGridSize} !== ${highLevel.tileGridSize})`,
    );
  }

  const volume = {
    manifest,
    manifestUrl,
    levels: [lowLevel, highLevel].sort((left, right) => left.levelIndex - right.levelIndex),
    levelsById: loaded,
    lowLevel,
    highLevel,
    tileGridSize: lowLevel.tileGridSize,
    slotCount: lowLevel.brickCount,
    worldBoundsPc: manifest.world_bounds_pc ?? lowLevel.worldBoundsPc,
    format: manifest.format,
    frame: manifest.runtime_frame,
  };
  return new HaTiledVolumeService(volume, options);
}
