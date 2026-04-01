import { SCALE } from './scene-scale.js';

const HEADER_SIZE = 64;
const STAR_MAGIC = 0x52415453;
const SHARD_MAGIC = 0x5248534f;
const SHARD_HDR_SIZE = 80;
const SHARD_NODE_SIZE = 20;
const FRONTIER_REF_SIZE = 8;
const PAYLOAD_RECORD_SIZE = 16;
const HAS_PAYLOAD = 0x01;
const IS_FRONTIER = 0x04;
const MIN_SHARD_FETCH_BYTES = 65536;
export const DEFAULT_PAYLOAD_MAX_GAP_BYTES = 131072;
export const DEFAULT_PAYLOAD_MAX_BATCH_BYTES = 512000;
const DEFAULT_MAX_INFLIGHT_PAYLOAD_BATCHES = 8;
const DEFAULT_SHARD_PREFETCH_BYTES = DEFAULT_PAYLOAD_MAX_BATCH_BYTES;

function createCacheKey(namespace, kind, ...parts) {
  return [namespace, kind, ...parts].join(':');
}

function createPayloadCacheKey(namespace, node) {
  return createCacheKey(namespace, 'payload', node.payloadOffset, node.payloadLength);
}

function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function assertRangeResponse(response, url, start, end) {
  if (response.ok || response.status === 206) {
    return;
  }

  throw new Error(`Range fetch failed: ${response.status} ${url} bytes=${start}-${end}`);
}

async function fetchRange(url, start, end) {
  const t0 = performance.now();
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
  });
  assertRangeResponse(response, url, start, end);
  const buffer = await response.arrayBuffer();
  const elapsed = performance.now() - t0;
  return { buffer, elapsed };
}

async function decompressGzip(compressed) {
  const decompressionStream = new DecompressionStream('gzip');
  const writer = decompressionStream.writable.getWriter();
  writer.write(new Uint8Array(compressed));
  writer.close();

  const reader = decompressionStream.readable.getReader();
  const chunks = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

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

export function parseStarHeader(view) {
  const dataView = view instanceof DataView ? view : new DataView(view);
  const magic = dataView.getUint32(0, true);

  if (magic !== STAR_MAGIC) {
    const hint = magic === 0x4f44213c
      ? ' — received HTML instead of octree (check dev server /data path)'
      : '';
    throw new Error(`stars.octree: bad STAR magic 0x${magic.toString(16)}${hint}`);
  }

  const version = dataView.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`stars.octree: unsupported STAR version ${version}`);
  }

  return {
    version,
    indexOffset: Number(dataView.getBigUint64(8, true)),
    indexLength: Number(dataView.getBigUint64(16, true)),
    worldCenterX: dataView.getFloat32(24, true),
    worldCenterY: dataView.getFloat32(28, true),
    worldCenterZ: dataView.getFloat32(32, true),
    worldHalfSize: dataView.getFloat32(36, true),
    payloadRecordSize: dataView.getUint16(40, true),
    maxLevel: dataView.getUint16(42, true),
    magLimit: dataView.getFloat32(44, true),
  };
}

function parseShardHeaderFromBuffer(buffer, shardOffset) {
  const view = buffer instanceof DataView ? buffer : new DataView(buffer);
  if (view.byteLength < SHARD_HDR_SIZE) {
    throw new Error('OSHR: truncated header');
  }

  const magic = view.getUint32(0, true);
  if (magic !== SHARD_MAGIC) {
    throw new Error(`OSHR: bad magic 0x${magic.toString(16)} at ${shardOffset}`);
  }

  const version = view.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`OSHR: unsupported version ${version}`);
  }

  const nodeCount = view.getUint16(18, true);
  const parentGlobalDepth = view.getInt16(22, true);
  const parentGridX = view.getUint32(24, true) >>> 0;
  const parentGridY = view.getUint32(28, true) >>> 0;
  const parentGridZ = view.getUint32(32, true) >>> 0;
  const entryNodes = [];

  for (let index = 0; index < 8; index += 1) {
    entryNodes.push(view.getUint16(36 + index * 2, true));
  }

  return {
    offset: shardOffset,
    nodeCount,
    parentGlobalDepth,
    parentGridX,
    parentGridY,
    parentGridZ,
    entryNodes,
    firstFrontierIndex: view.getUint16(52, true),
    nodeTableOffset: Number(view.getBigUint64(54, true)),
    frontierTableOffset: Number(view.getBigUint64(62, true)),
  };
}

export function readShardNodeRecord(tableView, nodeIndex) {
  const offset = (nodeIndex - 1) * SHARD_NODE_SIZE;

  return {
    firstChild: tableView.getUint16(offset, true),
    localPath: tableView.getUint16(offset + 2, true),
    childMask: tableView.getUint8(offset + 4),
    localDepth: tableView.getUint8(offset + 5),
    flags: tableView.getUint8(offset + 6),
    reserved: tableView.getUint8(offset + 7),
    payloadOffset: Number(tableView.getBigUint64(offset + 8, true)),
    payloadLength: tableView.getUint32(offset + 16, true),
  };
}

export function decodeLocalGrid(parentGridX, parentGridY, parentGridZ, localDepth, localPath) {
  let gridX = parentGridX;
  let gridY = parentGridY;
  let gridZ = parentGridZ;

  for (let index = 0; index < localDepth; index += 1) {
    const shift = 3 * (localDepth - 1 - index);
    const octant = (localPath >> shift) & 7;
    gridX = (gridX << 1) | (octant & 1);
    gridY = (gridY << 1) | ((octant >> 1) & 1);
    gridZ = (gridZ << 1) | ((octant >> 2) & 1);
  }

  return {
    gx: gridX,
    gy: gridY,
    gz: gridZ,
  };
}

export function nodeCenterAndHalfSize(header, gx, gy, gz, level) {
  const n = 1 << level;
  const halfSize = header.worldHalfSize / n;

  return {
    centerX: header.worldCenterX + (2 * (gx + 0.5) - n) * halfSize,
    centerY: header.worldCenterY + (2 * (gy + 0.5) - n) * halfSize,
    centerZ: header.worldCenterZ + (2 * (gz + 0.5) - n) * halfSize,
    halfSize,
    level,
  };
}

export function runtimeNodeGeometry(header, shardHeader, record) {
  const globalLevel = shardHeader.parentGlobalDepth + record.localDepth;
  const { gx, gy, gz } = decodeLocalGrid(
    shardHeader.parentGridX,
    shardHeader.parentGridY,
    shardHeader.parentGridZ,
    record.localDepth,
    record.localPath,
  );
  const { centerX, centerY, centerZ, halfSize, level } = nodeCenterAndHalfSize(
    header,
    gx,
    gy,
    gz,
    globalLevel,
  );

  return {
    centerX,
    centerY,
    centerZ,
    halfSize,
    level,
    gridX: gx,
    gridY: gy,
    gridZ: gz,
  };
}

export function makeNodeKey(shardOffset, nodeIndex) {
  return `${shardOffset}:${nodeIndex}`;
}

function shardBlockSize(nodeCount, firstFrontierIndex) {
  const frontierCount = firstFrontierIndex > 0 && nodeCount >= firstFrontierIndex
    ? nodeCount - firstFrontierIndex + 1
    : 0;

  return SHARD_HDR_SIZE + nodeCount * SHARD_NODE_SIZE + frontierCount * FRONTIER_REF_SIZE;
}

function parseShardFromBlock(buffer, shardOffset) {
  if (buffer.byteLength < SHARD_HDR_SIZE) {
    return null;
  }

  const shardHeader = parseShardHeaderFromBuffer(buffer.slice(0, SHARD_HDR_SIZE), shardOffset);
  const nodeTableStart = SHARD_HDR_SIZE;
  const nodeTableLength = shardHeader.nodeCount * SHARD_NODE_SIZE;
  const nodeTableEnd = nodeTableStart + nodeTableLength;

  if (buffer.byteLength < nodeTableEnd) {
    return null;
  }

  const nodeTableBuffer = buffer.slice(nodeTableStart, nodeTableEnd);

  let frontierBuffer = null;
  if (shardHeader.firstFrontierIndex > 0 && shardHeader.nodeCount >= shardHeader.firstFrontierIndex) {
    const frontierCount = shardHeader.nodeCount - shardHeader.firstFrontierIndex + 1;
    const frontierStart = nodeTableEnd;
    const frontierEnd = frontierStart + frontierCount * FRONTIER_REF_SIZE;
    if (buffer.byteLength < frontierEnd) {
      return null;
    }
    frontierBuffer = buffer.slice(frontierStart, frontierEnd);
  }

  return new ResolvedShard(shardOffset, shardHeader, nodeTableBuffer, frontierBuffer);
}

function cacheContiguousShards(shardCache, namespace, buffer, fileOffset) {
  if (buffer.byteLength < SHARD_HDR_SIZE) {
    return null;
  }

  let cursor = 0;
  let primaryShard = null;

  while (cursor + SHARD_HDR_SIZE <= buffer.byteLength) {
    const probe = new DataView(buffer, cursor, 4);
    if (probe.getUint32(0, true) !== SHARD_MAGIC) {
      break;
    }

    const shardOffset = fileOffset + cursor;
    const resolved = parseShardFromBlock(buffer.slice(cursor), shardOffset);
    if (!resolved) {
      break;
    }

    if (!primaryShard) {
      primaryShard = resolved;
    }

    const cacheKey = createCacheKey(namespace, 'shard', shardOffset);
    if (!shardCache.has(cacheKey)) {
      shardCache.set(cacheKey, Promise.resolve(resolved));
    }

    cursor += shardBlockSize(resolved.hdr.nodeCount, resolved.hdr.firstFrontierIndex);
  }

  return primaryShard;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function runWithConcurrency(tasks, maxConcurrent) {
  const deferreds = tasks.map(() => createDeferred());
  let nextIndex = 0;
  let activeCount = 0;

  function launchNext() {
    while (activeCount < maxConcurrent && nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      activeCount += 1;

      Promise.resolve()
        .then(() => tasks[index]())
        .then(deferreds[index].resolve, deferreds[index].reject)
        .finally(() => {
          activeCount -= 1;
          launchNext();
        });
    }
  }

  launchNext();
  return deferreds.map(({ promise }) => promise);
}

export function planPayloadRangeBatches(
  nodes,
  {
    maxGapBytes = DEFAULT_PAYLOAD_MAX_GAP_BYTES,
    maxBatchBytes = DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  } = {},
) {
  const filtered = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => node && node.payloadLength > 0);

  if (filtered.length === 0) {
    return [];
  }

  const sorted = [...filtered].sort((left, right) => Number(left.payloadOffset) - Number(right.payloadOffset));
  const batches = [];
  let currentBatch = null;

  for (const node of sorted) {
    const nodeStart = Number(node.payloadOffset);
    const nodeEnd = nodeStart + node.payloadLength - 1;

    if (!currentBatch) {
      currentBatch = {
        start: nodeStart,
        end: nodeEnd,
        nodes: [node],
      };
      batches.push(currentBatch);
      continue;
    }

    const gapBytes = nodeStart - currentBatch.end - 1;
    const batchBytes = nodeEnd - currentBatch.start + 1;

    if (gapBytes <= maxGapBytes && batchBytes <= maxBatchBytes) {
      currentBatch.end = nodeEnd;
      currentBatch.nodes.push(node);
      continue;
    }

    currentBatch = {
      start: nodeStart,
      end: nodeEnd,
      nodes: [node],
    };
    batches.push(currentBatch);
  }

  return batches.map((batch) => {
    const payloadBytes = batch.nodes.reduce((sum, node) => sum + node.payloadLength, 0);
    const spanBytes = batch.end - batch.start + 1;
    return {
      ...batch,
      payloadBytes,
      spanBytes,
      gapBytes: Math.max(0, spanBytes - payloadBytes),
    };
  });
}

export class ResolvedShard {
  constructor(shardOffset, header, nodeTableBuffer, frontierBuffer) {
    this.shardOffset = shardOffset;
    this.hdr = header;
    this.nodeTable = new DataView(nodeTableBuffer);
    this.frontier = frontierBuffer && frontierBuffer.byteLength > 0 ? new DataView(frontierBuffer) : null;
  }

  readNode(nodeIndex) {
    return readShardNodeRecord(this.nodeTable, nodeIndex);
  }

  readFrontierContinuation(nodeIndex) {
    const { firstFrontierIndex } = this.hdr;
    if (!this.frontier || firstFrontierIndex <= 0) {
      return 0n;
    }

    const slot = nodeIndex - firstFrontierIndex;
    if (slot < 0) {
      return 0n;
    }

    const offset = slot * FRONTIER_REF_SIZE;
    if (offset + FRONTIER_REF_SIZE > this.frontier.byteLength) {
      return 0n;
    }

    return this.frontier.getBigUint64(offset, true);
  }
}

export function decodeStarPayload(buffer, geom) {
  if (buffer.byteLength % PAYLOAD_RECORD_SIZE !== 0) {
    console.warn('octree payload length not multiple of 16, truncating', buffer.byteLength);
  }

  const count = Math.floor(buffer.byteLength / PAYLOAD_RECORD_SIZE);
  const view = new DataView(buffer);
  const positions = new Float32Array(count * 3);
  const teffLog8 = new Uint8Array(count);
  const magAbs = new Float32Array(count);
  const { centerX, centerY, centerZ, halfSize } = geom;

  for (let index = 0; index < count; index += 1) {
    const offset = index * PAYLOAD_RECORD_SIZE;
    const localX = view.getFloat32(offset, true);
    const localY = view.getFloat32(offset + 4, true);
    const localZ = view.getFloat32(offset + 8, true);
    const magnitude = view.getInt16(offset + 12, true);
    const teff = view.getUint8(offset + 14);

    positions[index * 3] = (centerX + localX * halfSize) * SCALE;
    positions[index * 3 + 1] = (centerY + localY * halfSize) * SCALE;
    positions[index * 3 + 2] = (centerZ + localZ * halfSize) * SCALE;
    magAbs[index] = magnitude / 100;
    teffLog8[index] = teff;
  }

  return {
    positions,
    teffLog8,
    magAbs,
    count,
  };
}

export class OctreeFileService {
  constructor(session, options = {}) {
    this.session = session;
    this.url = options.url ?? null;
    this.namespace = options.namespace ?? 'octree';
    this.bootstrapPromise = null;
    this.bootstrapAndRootPromise = null;
    this.payloadMaxGapBytes = normalizePositiveInteger(
      options.payloadMaxGapBytes,
      DEFAULT_PAYLOAD_MAX_GAP_BYTES,
    );
    this.payloadMaxBatchBytes = normalizePositiveInteger(
      options.payloadMaxBatchBytes,
      DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
    );
    this.maxInflightPayloadBatches = normalizePositiveInteger(
      options.maxInflightPayloadBatches,
      DEFAULT_MAX_INFLIGHT_PAYLOAD_BATCHES,
    );
    this.shardPrefetchBytes = normalizePositiveInteger(
      options.shardPrefetchBytes,
      DEFAULT_SHARD_PREFETCH_BYTES,
    );
    this.stats = {
      headerFetches: 0,
      headerCacheHits: 0,
      shardFetches: 0,
      shardCacheHits: 0,
      payloadFetches: 0,
      payloadNodesFetched: 0,
      payloadCacheHits: 0,
      payloadBatchRequests: 0,
      payloadCompressedBytesRequested: 0,
      payloadSpanBytesRequested: 0,
      payloadGapBytesRequested: 0,
      rangeRequests: 0,
      bytesRequested: 0,
      fetchTimeMs: 0,
    };
  }

  assertUsable() {
    this.session.assertActive();
    if (!this.url) {
      throw new Error(`${this.namespace} service requires a URL`);
    }
  }

  async loadHeader() {
    this.assertUsable();
    const cache = this.session.getCache('bootstrapHeaders');
    const cacheKey = createCacheKey(this.namespace, 'header');

    if (cache.has(cacheKey)) {
      this.stats.headerCacheHits += 1;
    } else {
      cache.set(cacheKey, (async () => {
        this.stats.headerFetches += 1;
        this.stats.rangeRequests += 1;
        this.stats.bytesRequested += HEADER_SIZE;
        const result = await fetchRange(this.url, 0, HEADER_SIZE - 1);
        this.stats.fetchTimeMs += result.elapsed;
        return parseStarHeader(result.buffer);
      })());
    }

    return cache.get(cacheKey);
  }

  async loadBootstrap() {
    this.assertUsable();

    if (!this.bootstrapPromise) {
      this.bootstrapPromise = (async () => {
        const header = await this.loadHeader();
        return {
          header,
          rootShardOffset: header.indexOffset,
          worldHalfSize: header.worldHalfSize,
          magLimit: header.magLimit,
          payloadRecordSize: header.payloadRecordSize,
        };
      })();
    }

    return this.bootstrapPromise;
  }

  async loadBootstrapAndRootShard() {
    this.assertUsable();

    if (!this.bootstrapAndRootPromise) {
      this.bootstrapAndRootPromise = (async () => {
        const headerCache = this.session.getCache('bootstrapHeaders');
        const headerCacheKey = createCacheKey(this.namespace, 'header');
        const shardCache = this.session.getCache('shardHeaders');
        let bootstrap = null;

        if (!this.bootstrapPromise && !headerCache.has(headerCacheKey)) {
          const prefetchBytes = Math.max(this.shardPrefetchBytes, HEADER_SIZE);
          this.stats.headerFetches += 1;
          this.stats.rangeRequests += 1;
          this.stats.bytesRequested += prefetchBytes;
          const result = await fetchRange(this.url, 0, prefetchBytes - 1);
          this.stats.fetchTimeMs += result.elapsed;
          const buffer = result.buffer;
          const header = parseStarHeader(buffer.slice(0, HEADER_SIZE));
          headerCache.set(headerCacheKey, Promise.resolve(header));
          this.bootstrapPromise = Promise.resolve({
            header,
            rootShardOffset: header.indexOffset,
            worldHalfSize: header.worldHalfSize,
            magLimit: header.magLimit,
            payloadRecordSize: header.payloadRecordSize,
          });

          if (header.indexOffset === HEADER_SIZE && buffer.byteLength > HEADER_SIZE) {
            cacheContiguousShards(
              shardCache,
              this.namespace,
              buffer.slice(HEADER_SIZE),
              header.indexOffset,
            );
          }
        }

        bootstrap = await this.loadBootstrap();
        const rootShard = await this.loadShard(bootstrap.rootShardOffset);
        return {
          bootstrap,
          rootShard,
        };
      })().finally(() => {
        this.bootstrapAndRootPromise = null;
      });
    }

    return this.bootstrapAndRootPromise;
  }

  async loadShard(shardOffset) {
    this.assertUsable();
    const cache = this.session.getCache('shardHeaders');
    const cacheKey = createCacheKey(this.namespace, 'shard', shardOffset);

    if (cache.has(cacheKey)) {
      this.stats.shardCacheHits += 1;
    } else {
      cache.set(cacheKey, (async () => {
        const fetchBytes = Math.max(this.shardPrefetchBytes, MIN_SHARD_FETCH_BYTES, SHARD_HDR_SIZE);
        this.stats.shardFetches += 1;
        this.stats.rangeRequests += 1;
        this.stats.bytesRequested += fetchBytes;
        const initialResult = await fetchRange(
          this.url,
          shardOffset,
          shardOffset + fetchBytes - 1,
        );
        this.stats.fetchTimeMs += initialResult.elapsed;
        const initialBuffer = initialResult.buffer;

        let resolved = cacheContiguousShards(cache, this.namespace, initialBuffer, shardOffset);
        if (!resolved) {
          const header = parseShardHeaderFromBuffer(initialBuffer.slice(0, SHARD_HDR_SIZE), shardOffset);
          const totalSize = shardBlockSize(header.nodeCount, header.firstFrontierIndex);

          if (totalSize <= initialBuffer.byteLength) {
            resolved = parseShardFromBlock(initialBuffer.slice(0, totalSize), shardOffset);
          } else {
            this.stats.shardFetches += 1;
            this.stats.rangeRequests += 1;
            this.stats.bytesRequested += totalSize;
            const fullResult = await fetchRange(this.url, shardOffset, shardOffset + totalSize - 1);
            this.stats.fetchTimeMs += fullResult.elapsed;
            resolved = cacheContiguousShards(cache, this.namespace, fullResult.buffer, shardOffset);
          }

          if (!resolved) {
            throw new Error(`Failed to parse shard at offset ${shardOffset}`);
          }

          return resolved;
        }

        return resolved;
      })());
    }

    return cache.get(cacheKey);
  }

  async fetchNodePayload(node) {
    const entries = await this.fetchNodePayloadBatch([node]);
    return entries[0]?.buffer ?? new ArrayBuffer(0);
  }

  async fetchNodePayloadBatch(nodes) {
    return this.fetchNodePayloadBatchProgressive(nodes);
  }

  async fetchNodePayloadBatchProgressive(nodes, options = {}) {
    this.assertUsable();
    const onBatch = typeof options.onBatch === 'function' ? options.onBatch : null;
    const requestedNodes = (Array.isArray(nodes) ? nodes : [])
      .filter((node) => node && node.payloadLength > 0);

    if (requestedNodes.length === 0) {
      return [];
    }

    const cache = this.session.getCache('payloads');
    const cachedNodes = [];
    const missingNodes = [];

    for (const node of requestedNodes) {
      const cacheKey = createPayloadCacheKey(this.namespace, node);
      if (cache.has(cacheKey)) {
        this.stats.payloadCacheHits += 1;
        cachedNodes.push(node);
      } else {
        missingNodes.push(node);
      }
    }

    const batches = planPayloadRangeBatches(missingNodes, {
      maxGapBytes: this.payloadMaxGapBytes,
      maxBatchBytes: this.payloadMaxBatchBytes,
    });

    const batchTasks = batches.map((batch) => async () => {
      this.stats.payloadFetches += batch.nodes.length;
      this.stats.payloadNodesFetched += batch.nodes.length;
      this.stats.payloadBatchRequests += 1;
      this.stats.payloadCompressedBytesRequested += batch.payloadBytes;
      this.stats.payloadSpanBytesRequested += batch.spanBytes;
      this.stats.payloadGapBytesRequested += batch.gapBytes;
      this.stats.rangeRequests += 1;
      this.stats.bytesRequested += batch.spanBytes;

      const batchResult = await fetchRange(this.url, batch.start, batch.end);
      this.stats.fetchTimeMs += batchResult.elapsed;
      const batchBuffer = batchResult.buffer;
      const decodedBuffers = new Map();

      await Promise.all(batch.nodes.map(async (batchNode) => {
        const sliceStart = Number(batchNode.payloadOffset) - batch.start;
        const sliceEnd = sliceStart + batchNode.payloadLength;
        const compressedSlice = batchBuffer.slice(sliceStart, sliceEnd);
        const buffer = await decompressGzip(compressedSlice);
        decodedBuffers.set(
          createPayloadCacheKey(this.namespace, batchNode),
          buffer,
        );
      }));

      return decodedBuffers;
    });

    const batchPromises = runWithConcurrency(batchTasks, this.maxInflightPayloadBatches);

    batches.forEach((batch, batchIndex) => {
      const batchPromise = batchPromises[batchIndex];
      for (const batchNode of batch.nodes) {
        const cacheKey = createPayloadCacheKey(this.namespace, batchNode);
        cache.set(cacheKey, batchPromise.then((decodedBuffers) => decodedBuffers.get(cacheKey)));
      }

      if (onBatch) {
        void batchPromise
          .then((decodedBuffers) => batch.nodes.map((batchNode) => ({
            node: batchNode,
            buffer: decodedBuffers.get(createPayloadCacheKey(this.namespace, batchNode)),
          })))
          .then((entries) => onBatch(entries))
          .catch((error) => {
            console.error('[OctreeFileService] progressive payload batch failed', error);
          });
      }
    });

    if (onBatch && cachedNodes.length > 0) {
      void Promise.all(cachedNodes.map(async (node) => ({
        node,
        buffer: await cache.get(createPayloadCacheKey(this.namespace, node)),
      })))
        .then((entries) => {
          if (entries.length > 0) {
            return onBatch(entries);
          }
          return null;
        })
        .catch((error) => {
          console.error('[OctreeFileService] cached progressive payload batch failed', error);
        });
    }

    return Promise.all(
      requestedNodes.map(async (requestedNode) => ({
        node: requestedNode,
        buffer: await cache.get(
          createPayloadCacheKey(this.namespace, requestedNode),
        ),
      })),
    );
  }

  decodePayload(buffer, geom) {
    return decodeStarPayload(buffer, geom);
  }

  describe() {
    return {
      namespace: this.namespace,
      url: this.url,
      bootstrapReady: this.bootstrapPromise != null,
      batching: {
        payloadMaxGapBytes: this.payloadMaxGapBytes,
        payloadMaxBatchBytes: this.payloadMaxBatchBytes,
        maxInflightPayloadBatches: this.maxInflightPayloadBatches,
        shardPrefetchBytes: this.shardPrefetchBytes,
      },
      stats: { ...this.stats },
    };
  }
}

export {
  HAS_PAYLOAD,
  IS_FRONTIER,
  PAYLOAD_RECORD_SIZE,
};
