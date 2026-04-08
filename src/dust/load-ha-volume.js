import * as THREE from 'three';

export const HA_VOLUME_FORMAT = 'mccallum_ha_volume_v1';
export const DEFAULT_MCCALLUM_HA_VOLUME_URL = '/volumes/mccallum2025/ha_volume/manifest.json';
export const HA_VOLUME_INDEX_HEADER_BYTES = 64;
export const HA_VOLUME_INDEX_NODE_BYTES = 64;
export const HA_VOLUME_INDEX_MAGIC = 'FHAIDX1';
export const HA_VOLUME_NO_INDEX = 0xffffffff;
export const HA_VOLUME_FLAG_HAS_PAYLOAD = 1 << 0;
export const HA_VOLUME_FLAG_LEAF = 1 << 1;
export const DEFAULT_HA_VOLUME_MAX_RESIDENT_BRICKS = 512;
export const DEFAULT_HA_VOLUME_MAX_INFLIGHT_REQUESTS = 8;
export const DEFAULT_HA_VOLUME_REFINE_PIXEL_THRESHOLD = 80;
export const DEFAULT_HA_VOLUME_MAX_RENDER_BRICKS = 512;

const decoder = new TextDecoder('ascii');

function defaultFetch(...args) {
  return globalThis.fetch(...args);
}

function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function assertArrayBufferLooksBinary(buf, label) {
  if (buf.byteLength >= 1 && new Uint8Array(buf)[0] === 0x3c) {
    throw new Error(`${label} looks like HTML (starts with '<'), not H-alpha volume data`);
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

export function resolveHaVolumeUrl(search = null) {
  const searchValue = typeof search === 'string'
    ? search
    : globalThis.location?.search ?? '';
  const params = new URLSearchParams(searchValue);
  return params.get('haVolumeUrl')?.trim() || DEFAULT_MCCALLUM_HA_VOLUME_URL;
}

export function parseHaVolumeIndexBuffer(buf, options = {}) {
  assertArrayBufferLooksBinary(buf, options.sourceUrl ?? 'H-alpha volume index');
  if (buf.byteLength < HA_VOLUME_INDEX_HEADER_BYTES) {
    throw new Error(
      `File too small for H-alpha volume index header (${buf.byteLength} < ${HA_VOLUME_INDEX_HEADER_BYTES})`,
    );
  }

  const dv = new DataView(buf);
  const magic = decoder.decode(new Uint8Array(buf, 0, 8)).replace(/\0+$/, '');
  if (magic !== HA_VOLUME_INDEX_MAGIC) {
    throw new Error(`Bad H-alpha volume index magic ${JSON.stringify(magic)}`);
  }

  const version = dv.getUint16(8, true);
  const headerBytes = dv.getUint16(10, true);
  const nodeRecordBytes = dv.getUint32(12, true);
  const nodeCount = dv.getUint32(16, true);
  const brickSize = dv.getUint16(20, true);
  const maxDepth = dv.getUint16(22, true);
  const flags = dv.getUint32(24, true);
  const expectedSize = headerBytes + nodeCount * nodeRecordBytes;
  if (headerBytes !== HA_VOLUME_INDEX_HEADER_BYTES) {
    throw new Error(`Unsupported H-alpha volume index header size ${headerBytes}`);
  }
  if (nodeRecordBytes !== HA_VOLUME_INDEX_NODE_BYTES) {
    throw new Error(`Unsupported H-alpha volume node record size ${nodeRecordBytes}`);
  }
  if (buf.byteLength !== expectedSize) {
    throw new Error(
      `Unexpected H-alpha volume index size: ${buf.byteLength} bytes (expected ${expectedSize})`,
    );
  }

  const nodes = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const off = headerBytes + index * nodeRecordBytes;
    nodes.push({
      index,
      level: dv.getUint8(off),
      childMask: dv.getUint8(off + 1),
      flags: dv.getUint16(off + 2, true),
      parentIndex: dv.getUint32(off + 4, true),
      firstChildIndex: dv.getUint32(off + 8, true),
      gridX: dv.getUint16(off + 12, true),
      gridY: dv.getUint16(off + 14, true),
      gridZ: dv.getUint16(off + 16, true),
      encodedMax: dv.getUint8(off + 18),
      maxValue: dv.getFloat32(off + 20, true),
      meanValue: dv.getFloat32(off + 24, true),
      sumValue: dv.getFloat64(off + 28, true),
      nonzeroCount: dv.getUint32(off + 36, true),
      payloadOffset: Number(dv.getBigUint64(off + 40, true)),
      payloadLength: dv.getUint32(off + 48, true),
      children: [],
    });
  }

  for (const node of nodes) {
    if (node.parentIndex !== HA_VOLUME_NO_INDEX && nodes[node.parentIndex]) {
      nodes[node.parentIndex].children.push(node.index);
    }
  }

  return {
    version,
    headerBytes,
    nodeRecordBytes,
    nodeCount,
    brickSize,
    maxDepth,
    flags,
    nodes,
    sourceUrl: options.sourceUrl ?? null,
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

export function createHaVolumeBrickTexture(u8, brickSize) {
  const tex = new THREE.Data3DTexture(u8, brickSize, brickSize, brickSize);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export function getHaVolumeNodeBounds(volume, node) {
  const world = volume.manifest.world_bounds_pc;
  const divisions = 2 ** node.level;
  const x0 = world.x[0] + (world.x[1] - world.x[0]) * (node.gridX / divisions);
  const x1 = world.x[0] + (world.x[1] - world.x[0]) * ((node.gridX + 1) / divisions);
  const y0 = world.y[0] + (world.y[1] - world.y[0]) * (node.gridY / divisions);
  const y1 = world.y[0] + (world.y[1] - world.y[0]) * ((node.gridY + 1) / divisions);
  const z0 = world.z[0] + (world.z[1] - world.z[0]) * (node.gridZ / divisions);
  const z1 = world.z[0] + (world.z[1] - world.z[0]) * ((node.gridZ + 1) / divisions);
  return {
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minY: Math.min(y0, y1),
    maxY: Math.max(y0, y1),
    minZ: Math.min(z0, z1),
    maxZ: Math.max(z0, z1),
  };
}

export function selectHaVolumeNodes(volume, options = {}) {
  const root = volume.nodes[0];
  if (!root) {
    return { renderNodes: [], requestNodes: [], visited: 0 };
  }

  const maxRenderBricks = normalizePositiveInteger(
    options.maxRenderBricks,
    DEFAULT_HA_VOLUME_MAX_RENDER_BRICKS,
  );
  const refinePixelThreshold = Number.isFinite(options.refinePixelThreshold)
    ? options.refinePixelThreshold
    : DEFAULT_HA_VOLUME_REFINE_PIXEL_THRESHOLD;
  const projectedSizeForNode = typeof options.projectedSizeForNode === 'function'
    ? options.projectedSizeForNode
    : () => 0;
  const targetLevelForNode = typeof options.targetLevelForNode === 'function'
    ? options.targetLevelForNode
    : null;
  const isBrickReady = typeof options.isBrickReady === 'function'
    ? options.isBrickReady
    : () => false;
  const isNodeVisible = typeof options.isNodeVisible === 'function'
    ? options.isNodeVisible
    : () => true;
  const canRequestNode = typeof options.canRequestNode === 'function'
    ? options.canRequestNode
    : () => true;
  const nodePriority = typeof options.nodePriority === 'function'
    ? options.nodePriority
    : () => 0;
  const maxRequestBricks = normalizePositiveInteger(
    options.maxRequestBricks,
    maxRenderBricks,
  );
  const maxTraversalNodes = normalizePositiveInteger(
    options.maxTraversalNodes,
    Math.max(1024, maxRenderBricks * 64),
  );

  const renderNodes = [];
  const requestByIndex = new Map();
  const queue = [root];
  let visited = 0;

  // Selection is intentionally conservative:
  // render the coarsest ready parent until every retained child is decoded,
  // and request only within the caller's explicit request/capacity budgets.
  while (
    queue.length > 0
    && renderNodes.length < maxRenderBricks
    && visited < maxTraversalNodes
  ) {
    const node = queue.shift();
    visited += 1;
    if (!isNodeVisible(node)) {
      continue;
    }

    if (targetLevelForNode) {
      const children = node.children
        .map((childIndex) => volume.nodes[childIndex])
        .filter((child) => child && isNodeVisible(child))
        .sort((left, right) => nodePriority(right) - nodePriority(left));
      const rawTargetLevel = targetLevelForNode(node);
      const targetLevel = Number.isFinite(rawTargetLevel)
        ? Math.max(node.level, Math.min(volume.maxDepth, Math.floor(rawTargetLevel)))
        : node.level;

      if (node.level < targetLevel && children.length > 0) {
        queue.push(...children);
        continue;
      }

      if (isBrickReady(node)) {
        renderNodes.push(node);
      } else if (canRequestNode(node) && requestByIndex.size < maxRequestBricks) {
        requestByIndex.set(node.index, node);
      }
      continue;
    }

    if (!isBrickReady(node)) {
      if (canRequestNode(node) && requestByIndex.size < maxRequestBricks) {
        requestByIndex.set(node.index, node);
      }
      renderNodes.push(node);
      continue;
    }

    const children = node.children
      .map((childIndex) => volume.nodes[childIndex])
      .filter((child) => child && isNodeVisible(child))
      .sort((left, right) => nodePriority(right) - nodePriority(left));
    const shouldRefine = children.length > 0
      && projectedSizeForNode(node) > refinePixelThreshold;
    if (shouldRefine) {
      for (const child of children) {
        if (
          !isBrickReady(child)
          && canRequestNode(child)
          && requestByIndex.size < maxRequestBricks
        ) {
          requestByIndex.set(child.index, child);
        }
      }
      if (children.every(isBrickReady)) {
        queue.push(...children);
        continue;
      }
    }

    renderNodes.push(node);
  }

  return {
    renderNodes,
    requestNodes: [...requestByIndex.values()],
    visited,
  };
}

export class HaVolumeBrickCache {
  constructor(maxEntries = DEFAULT_HA_VOLUME_MAX_RESIDENT_BRICKS) {
    this.maxEntries = normalizePositiveInteger(
      maxEntries,
      DEFAULT_HA_VOLUME_MAX_RESIDENT_BRICKS,
    );
    this.map = new Map();
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    return value;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }

  get remainingCapacity() {
    return Math.max(0, this.maxEntries - this.map.size);
  }
}

export class HaVolumeService {
  constructor(volume, options = {}) {
    this.volume = volume;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.decompressImpl = options.decompressImpl ?? decompressGzipBuffer;
    this.cache = options.cache ?? new HaVolumeBrickCache(options.maxResidentBricks);
    this.maxInflightRequests = normalizePositiveInteger(
      options.maxInflightRequests,
      DEFAULT_HA_VOLUME_MAX_INFLIGHT_REQUESTS,
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

  hasDecodedBrick(nodeOrIndex) {
    const index = typeof nodeOrIndex === 'number' ? nodeOrIndex : nodeOrIndex.index;
    return this.cache.has(index);
  }

  isBrickInflight(nodeOrIndex) {
    const index = typeof nodeOrIndex === 'number' ? nodeOrIndex : nodeOrIndex.index;
    return this.inflight.has(index);
  }

  canRequestBrick(nodeOrIndex) {
    const node = typeof nodeOrIndex === 'number'
      ? this.volume.nodes[nodeOrIndex]
      : nodeOrIndex;
    if (!node || !(node.flags & HA_VOLUME_FLAG_HAS_PAYLOAD) || node.payloadLength <= 0) {
      return false;
    }
    if (this.cache.has(node.index) || this.inflight.has(node.index)) {
      return false;
    }
    return this.availableRequestSlots > 0;
  }

  getDecodedBrick(nodeOrIndex) {
    const index = typeof nodeOrIndex === 'number' ? nodeOrIndex : nodeOrIndex.index;
    const brick = this.cache.get(index);
    if (brick) this.stats.cacheHits += 1;
    return brick;
  }

  requestBrick(nodeOrIndex) {
    const node = typeof nodeOrIndex === 'number'
      ? this.volume.nodes[nodeOrIndex]
      : nodeOrIndex;
    if (!node || !(node.flags & HA_VOLUME_FLAG_HAS_PAYLOAD) || node.payloadLength <= 0) {
      return null;
    }
    const cached = this.cache.get(node.index);
    if (cached) {
      this.stats.cacheHits += 1;
      return Promise.resolve(cached);
    }
    if (this.inflight.has(node.index)) {
      return this.inflight.get(node.index);
    }
    if (this.availableRequestSlots <= 0) {
      this.stats.capacitySkipped += 1;
      return null;
    }
    if (this.inflight.size >= this.maxInflightRequests) {
      this.stats.inflightSkipped += 1;
      return null;
    }

    const promise = this.#fetchAndDecodeBrick(node)
      .finally(() => {
        this.inflight.delete(node.index);
      });
    this.inflight.set(node.index, promise);
    return promise;
  }

  requestBricks(nodes) {
    const promises = [];
    for (const node of nodes) {
      const promise = this.requestBrick(node);
      if (promise) promises.push(promise);
    }
    return promises;
  }

  async #fetchAndDecodeBrick(node) {
    const start = node.payloadOffset;
    const end = node.payloadOffset + node.payloadLength - 1;
    this.stats.rangeRequests += 1;
    this.stats.bricksRequested += 1;
    this.stats.bytesRequested += node.payloadLength;
    const response = await this.fetchImpl(this.volume.payloadUrl, {
      headers: { Range: `bytes=${start}-${end}` },
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch H-alpha brick ${node.index}: ${response.status}`);
    }
    const compressed = await response.arrayBuffer();
    if (response.status !== 206 && compressed.byteLength !== node.payloadLength) {
      throw new Error(
        `H-alpha brick range request was not honored for node ${node.index}: received ${compressed.byteLength} bytes, expected ${node.payloadLength}`,
      );
    }

    const decoded = new Uint8Array(await this.decompressImpl(compressed));
    const expectedBytes = this.volume.brickSize ** 3;
    if (decoded.byteLength !== expectedBytes) {
      throw new Error(
        `Decoded H-alpha brick ${node.index} has ${decoded.byteLength} bytes, expected ${expectedBytes}`,
      );
    }
    this.stats.bricksDecoded += 1;
    return this.cache.set(node.index, decoded);
  }

  describe() {
    return {
      url: this.volume.manifestUrl,
      payloadUrl: this.volume.payloadUrl,
      cachedBricks: this.cache.size,
      inflightBricks: this.inflight.size,
      stats: { ...this.stats },
    };
  }
}

export async function loadHaVolume(manifestUrl = DEFAULT_MCCALLUM_HA_VOLUME_URL, options = {}) {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const manifestResp = await fetchImpl(manifestUrl);
  if (!manifestResp.ok) {
    throw new Error(`Failed to fetch ${manifestUrl}: ${manifestResp.status}`);
  }
  const manifest = await manifestResp.json();
  if (manifest.format !== HA_VOLUME_FORMAT) {
    throw new Error(`Unsupported H-alpha volume format ${JSON.stringify(manifest.format)}`);
  }

  const indexUrl = resolveAssetUrl(manifest.index?.path ?? 'ha_volume.idx', manifestUrl);
  const payloadUrl = resolveAssetUrl(manifest.payload?.path ?? 'ha_volume.bin', manifestUrl);
  const indexResp = await fetchImpl(indexUrl);
  if (!indexResp.ok) {
    throw new Error(`Failed to fetch ${indexUrl}: ${indexResp.status}`);
  }
  const index = parseHaVolumeIndexBuffer(await indexResp.arrayBuffer(), {
    sourceUrl: indexUrl,
  });
  const volume = {
    manifest,
    manifestUrl,
    indexUrl,
    payloadUrl,
    index,
    nodes: index.nodes,
    brickSize: index.brickSize,
    maxDepth: index.maxDepth,
    format: manifest.format,
    frame: manifest.runtime_frame,
  };
  return new HaVolumeService(volume, options);
}
