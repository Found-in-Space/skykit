import {
  parseShardFromBlock,
  parseShardHeader,
  parseStarHeader,
  shardBlockSize,
  SHARD_HEADER_SIZE,
  SHARD_MAGIC,
  STAR_HEADER_BLOCK_BYTES,
  STAR_HEADER_SIZE,
} from './star-octree-format.js';
import {
  DEFAULT_MAX_INFLIGHT_PAYLOAD_BATCHES,
  DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  DEFAULT_PAYLOAD_MAX_GAP_BYTES,
  decompressGzip,
  planPayloadRangeBatches,
  runWithConcurrency,
} from './star-octree-payloads.js';
import { createUrlRangeSource } from './star-octree-url-source.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeBootstrapProduct} StarOctreeBootstrapProduct
 * @typedef {import('./index.d.ts').StarOctreeProviderServiceOptions} StarOctreeProviderServiceOptions
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./star-octree-format.js').ParsedStarHeader} ParsedStarHeader
 * @typedef {import('./star-octree-format.js').ResolvedStarOctreeShard} ResolvedStarOctreeShard
 */

const DEFAULT_SHARD_PREFETCH_BYTES = 65_536;

/**
 * @typedef {{
 *   headerFetches: number;
 *   headerCacheHits: number;
 *   shardFetches: number;
 *   shardCacheHits: number;
 *   payloadBatchRequests: number;
 *   payloadNodesFetched: number;
 *   payloadCacheHits: number;
 *   payloadCompressedBytesRequested: number;
 *   payloadSpanBytesRequested: number;
 *   payloadGapBytesRequested: number;
 *   rangeRequests: number;
 *   bytesRequested: number;
 *   persistentCacheHits: number;
 *   fetchTimeMs: number;
 * }} StarOctreeIndexStats
 */

/**
 * @typedef {{
 *   shard: ResolvedStarOctreeShard;
 *   nodes: StarOctreeRuntimeNode[];
 * }} LoadedRootShard
 */

/**
 * @typedef {{
 *   node: StarOctreeRuntimeNode;
 *   buffer: ArrayBuffer;
 * }} StarOctreePayloadEntry
 */

/**
 * @param {{
 *   providerId: string;
 *   options: StarOctreeProviderServiceOptions;
 *   rangeSource?: {
 *     persistentCacheAvailable: boolean;
 *     fetchRange(start: number, end: number): Promise<ArrayBuffer>;
 *   };
 *   createRangeSource?: (stats: StarOctreeIndexStats) => {
 *     persistentCacheAvailable: boolean;
 *     fetchRange(start: number, end: number): Promise<ArrayBuffer>;
 *   };
 *   sourceIdentity?: string;
 * }} createOptions
 */
export function createStarOctreeIndexSource(createOptions) {
  const stats = createInitialStats();
  const rangeSource = createOptions.rangeSource ??
    createOptions.createRangeSource?.(stats) ??
    createUrlRangeSource({
      url: createOptions.options.url,
      persistentCache: createOptions.options.persistentCache,
      stats,
    });
  /** @type {Promise<StarOctreeBootstrapProduct> | null} */
  let bootstrapPromise = null;
  /** @type {StarOctreeBootstrapProduct | null} */
  let bootstrapProduct = null;
  /** @type {ParsedStarHeader | null} */
  let parsedHeader = null;
  /** @type {Promise<LoadedRootShard> | null} */
  let rootShardPromise = null;
  /** @type {LoadedRootShard | null} */
  let rootShard = null;
  /** @type {Map<number, Promise<ResolvedStarOctreeShard>>} */
  const shardCache = new Map();
  /** @type {Map<string, Promise<ArrayBuffer>>} */
  const payloadCache = new Map();
  const payloadMaxGapBytes =
    createOptions.options.limits?.payloadMaxGapBytes ??
    DEFAULT_PAYLOAD_MAX_GAP_BYTES;
  const payloadMaxBatchBytes =
    createOptions.options.limits?.payloadMaxBatchBytes ??
    DEFAULT_PAYLOAD_MAX_BATCH_BYTES;
  const maxInflightPayloadBatches =
    createOptions.options.limits?.maxInflightPayloadBatches ??
    DEFAULT_MAX_INFLIGHT_PAYLOAD_BATCHES;

  return {
    persistentCacheAvailable: rangeSource.persistentCacheAvailable,
    sourceIdentity:
      createOptions.sourceIdentity ??
      createOptions.options.url ??
      createOptions.providerId,

    async ensureBootstrapLoaded() {
      if (bootstrapPromise) {
        stats.headerCacheHits += 1;
        return bootstrapPromise;
      }

      bootstrapPromise = loadBootstrap({ prefetchRoot: false });
      return bootstrapPromise;
    },

    async ensureRootShardLoaded() {
      if (rootShardPromise) {
        stats.shardCacheHits += 1;
        return rootShardPromise;
      }

      rootShardPromise = (async () => {
        const bootstrap = await ensureBootstrapForRoot();
        const shard = await loadShard(bootstrap.header.indexOffset);
        const nodes = shard.readRuntimeNodes(bootstrap.header);
        rootShard = { shard, nodes };
        return rootShard;
      })();

      return rootShardPromise;
    },

    loadShard,

    fetchNodePayloadBatchProgressive,

    getSnapshot() {
      return {
        datasetId: bootstrapProduct?.datasetId ?? createOptions.options.datasetId ?? null,
        datasetIdentitySource:
          bootstrapProduct?.datasetIdentitySource ??
          (createOptions.options.datasetId ? 'options' : null),
        bootstrapReady: Boolean(bootstrapProduct),
        rootShardReady: Boolean(rootShard),
        cache: {
          bootstrapHeaders: bootstrapPromise ? 1 : 0,
          shardHeaders: shardCache.size,
          payloads: payloadCache.size,
          decodedPayloads: 0,
          products: 0,
        },
        stats: {
          ...stats,
        },
      };
    },
  };

  async function ensureBootstrapForRoot() {
    if (!bootstrapPromise) {
      bootstrapPromise = loadBootstrap({ prefetchRoot: true });
    } else {
      stats.headerCacheHits += 1;
    }

    return bootstrapPromise;
  }

  /**
   * @param {{ prefetchRoot: boolean }} options
   * @returns {Promise<StarOctreeBootstrapProduct>}
   */
  async function loadBootstrap(options) {
    stats.headerFetches += 1;
    const fetchBytes = options.prefetchRoot
      ? Math.max(DEFAULT_SHARD_PREFETCH_BYTES, STAR_HEADER_BLOCK_BYTES)
      : STAR_HEADER_BLOCK_BYTES;
    const buffer = await rangeSource.fetchRange(0, fetchBytes - 1);
    parsedHeader = parseStarHeader(buffer);
    bootstrapProduct = createBootstrapProduct({
      providerId: createOptions.providerId,
      options: createOptions.options,
      header: parsedHeader,
    });

    if (options.prefetchRoot) {
      warmContiguousShards(buffer, parsedHeader);
    }

    return bootstrapProduct;
  }

  /**
   * @param {number} shardOffset
   * @returns {Promise<ResolvedStarOctreeShard>}
   */
  async function loadShard(shardOffset) {
    if (shardCache.has(shardOffset)) {
      stats.shardCacheHits += 1;
      return /** @type {Promise<ResolvedStarOctreeShard>} */ (shardCache.get(shardOffset));
    }

    const shardPromise = loadShardUncached(shardOffset);
    shardCache.set(shardOffset, shardPromise);
    return shardPromise;
  }

  /**
   * @param {number} shardOffset
   * @returns {Promise<ResolvedStarOctreeShard>}
   */
  async function loadShardUncached(shardOffset) {
    stats.shardFetches += 1;
    const initialBuffer = await rangeSource.fetchRange(
      shardOffset,
      shardOffset + DEFAULT_SHARD_PREFETCH_BYTES - 1,
    );
    const warmed = cacheContiguousShards(initialBuffer, shardOffset);
    if (warmed) {
      return warmed;
    }

    const shardHeader = parseShardHeader(
      initialBuffer.slice(0, SHARD_HEADER_SIZE),
      shardOffset,
    );
    const totalSize = shardBlockSize(
      shardHeader.nodeCount,
      shardHeader.firstFrontierIndex,
    );

    if (totalSize <= initialBuffer.byteLength) {
      const parsed = parseShardFromBlock(initialBuffer.slice(0, totalSize), shardOffset);
      if (parsed) {
        return parsed;
      }
    }

    stats.shardFetches += 1;
    const fullBuffer = await rangeSource.fetchRange(
      shardOffset,
      shardOffset + totalSize - 1,
    );
    const parsed = cacheContiguousShards(fullBuffer, shardOffset);

    if (!parsed) {
      throw new Error(`Failed to parse shard at offset ${shardOffset}`);
    }

    return parsed;
  }

  /**
   * @param {ArrayBuffer} buffer
   * @param {ParsedStarHeader} header
   */
  function warmContiguousShards(buffer, header) {
    if (header.indexOffset === STAR_HEADER_SIZE && buffer.byteLength > STAR_HEADER_SIZE) {
      cacheContiguousShards(buffer.slice(STAR_HEADER_SIZE), header.indexOffset);
      return;
    }

    if (
      header.indexOffset === STAR_HEADER_BLOCK_BYTES &&
      buffer.byteLength > STAR_HEADER_BLOCK_BYTES
    ) {
      cacheContiguousShards(buffer.slice(STAR_HEADER_BLOCK_BYTES), header.indexOffset);
    }
  }

  /**
   * @param {ArrayBuffer} buffer
   * @param {number} fileOffset
   * @returns {ResolvedStarOctreeShard | null}
   */
  function cacheContiguousShards(buffer, fileOffset) {
    if (buffer.byteLength < SHARD_HEADER_SIZE) {
      return null;
    }

    let cursor = 0;
    /** @type {ResolvedStarOctreeShard | null} */
    let primaryShard = null;

    while (cursor + SHARD_HEADER_SIZE <= buffer.byteLength) {
      const probe = new DataView(buffer, cursor, 4);
      if (probe.getUint32(0, true) !== SHARD_MAGIC) {
        break;
      }

      const shardOffset = fileOffset + cursor;
      const parsed = parseShardFromBlock(buffer.slice(cursor), shardOffset);
      if (!parsed) {
        break;
      }

      if (!primaryShard) {
        primaryShard = parsed;
      }

      if (!shardCache.has(shardOffset)) {
        shardCache.set(shardOffset, Promise.resolve(parsed));
      }

      cursor += shardBlockSize(
        parsed.header.nodeCount,
        parsed.header.firstFrontierIndex,
      );
    }

    return primaryShard;
  }

  /**
   * @param {StarOctreeRuntimeNode[]} nodes
   * @param {{
   *   onBatch?: (entries: StarOctreePayloadEntry[]) => void | Promise<void>;
   *   emitCachedFirst?: boolean;
   * }} options
   * @returns {Promise<StarOctreePayloadEntry[]>}
   */
  async function fetchNodePayloadBatchProgressive(nodes, options = {}) {
    const requestedNodes = nodes.filter((node) => node && node.payloadLength > 0);
    if (requestedNodes.length === 0) {
      return [];
    }

    /** @type {StarOctreeRuntimeNode[]} */
    const cachedNodes = [];
    /** @type {StarOctreeRuntimeNode[]} */
    const missingNodes = [];
    /** @type {Promise<unknown>[]} */
    const notifyPromises = [];

    for (const node of requestedNodes) {
      const cacheKey = createPayloadCacheKey(node);
      if (payloadCache.has(cacheKey)) {
        stats.payloadCacheHits += 1;
        cachedNodes.push(node);
      } else {
        missingNodes.push(node);
      }
    }

    if (options.emitCachedFirst !== false && cachedNodes.length > 0) {
      notifyPromises.push(
        Promise.all(cachedNodes.map(async (node) => ({
          node,
          buffer: await /** @type {Promise<ArrayBuffer>} */ (
            payloadCache.get(createPayloadCacheKey(node))
          ),
        }))).then((entries) => options.onBatch?.(entries)),
      );
    }

    const batches = planPayloadRangeBatches(missingNodes, {
      maxGapBytes: payloadMaxGapBytes,
      maxBatchBytes: payloadMaxBatchBytes,
    });

    const batchTasks = batches.map((batch) => async () => {
      stats.payloadBatchRequests += 1;
      stats.payloadNodesFetched += batch.nodes.length;
      stats.payloadCompressedBytesRequested += batch.payloadBytes;
      stats.payloadSpanBytesRequested += batch.spanBytes;
      stats.payloadGapBytesRequested += batch.gapBytes;
      const batchBuffer = await rangeSource.fetchRange(batch.start, batch.end);
      /** @type {Map<string, ArrayBuffer>} */
      const decodedBuffers = new Map();

      await Promise.all(batch.nodes.map(async (node) => {
        const sliceStart = node.payloadOffset - batch.start;
        const sliceEnd = sliceStart + node.payloadLength;
        decodedBuffers.set(
          createPayloadCacheKey(node),
          await decompressGzip(batchBuffer.slice(sliceStart, sliceEnd)),
        );
      }));

      return decodedBuffers;
    });

    const batchPromises = runWithConcurrency(
      batchTasks,
      maxInflightPayloadBatches,
    );

    if (
      options.emitCachedFirst === false &&
      cachedNodes.length > 0 &&
      options.onBatch
    ) {
      notifyPromises.push(
        Promise.all(batchPromises)
          .then(() => Promise.all(cachedNodes.map(async (node) => ({
            node,
            buffer: await /** @type {Promise<ArrayBuffer>} */ (
              payloadCache.get(createPayloadCacheKey(node))
            ),
          }))))
          .then((entries) => options.onBatch?.(entries)),
      );
    }

    batches.forEach((batch, batchIndex) => {
      const batchPromise = batchPromises[batchIndex];

      for (const node of batch.nodes) {
        const cacheKey = createPayloadCacheKey(node);
        const payloadPromise = batchPromise.then((decodedBuffers) => {
          const buffer = decodedBuffers.get(cacheKey);
          if (!buffer) {
            throw new Error(`Missing decoded payload buffer for ${cacheKey}`);
          }
          return buffer;
        });
        payloadPromise.catch(() => {
          if (payloadCache.get(cacheKey) === payloadPromise) {
            payloadCache.delete(cacheKey);
          }
        });
        payloadCache.set(cacheKey, payloadPromise);
      }

      if (options.onBatch) {
        notifyPromises.push(batchPromise
          .then((decodedBuffers) => batch.nodes.map((node) => {
            const buffer = decodedBuffers.get(createPayloadCacheKey(node));
            if (!buffer) {
              throw new Error(`Missing decoded payload buffer for ${node.nodeKey}`);
            }
            return { node, buffer };
          }))
          .then((entries) => options.onBatch?.(entries)));
      }
    });

    try {
      const entries = await Promise.all(requestedNodes.map(async (node) => ({
        node,
        buffer: await /** @type {Promise<ArrayBuffer>} */ (
          payloadCache.get(createPayloadCacheKey(node))
        ),
      })));
      await Promise.all(notifyPromises);
      return entries;
    } catch (error) {
      await Promise.allSettled(notifyPromises);
      throw error;
    }
  }
}

/**
 * @returns {StarOctreeIndexStats}
 */
function createInitialStats() {
  return {
    headerFetches: 0,
    headerCacheHits: 0,
    shardFetches: 0,
    shardCacheHits: 0,
    payloadBatchRequests: 0,
    payloadNodesFetched: 0,
    payloadCacheHits: 0,
    payloadCompressedBytesRequested: 0,
    payloadSpanBytesRequested: 0,
    payloadGapBytesRequested: 0,
    rangeRequests: 0,
    bytesRequested: 0,
    persistentCacheHits: 0,
    fetchTimeMs: 0,
  };
}

/**
 * @param {StarOctreeRuntimeNode} node
 */
function createPayloadCacheKey(node) {
  return `${node.payloadOffset}:${node.payloadLength}`;
}

/**
 * @param {{
 *   providerId: string;
 *   options: StarOctreeProviderServiceOptions;
 *   header: ParsedStarHeader;
 * }} productOptions
 * @returns {StarOctreeBootstrapProduct}
 */
function createBootstrapProduct(productOptions) {
  const datasetId =
    productOptions.options.datasetId ?? productOptions.header.datasetUuid ?? null;
  const datasetIdentitySource = productOptions.options.datasetId
    ? 'options'
    : productOptions.header.datasetUuid
      ? 'octree-descriptor'
      : null;

  return {
    productType: 'index',
    indexKind: 'star-octree-bootstrap',
    providerId: productOptions.providerId,
    datasetId,
    datasetIdentitySource,
    header: {
      version: productOptions.header.version,
      indexOffset: productOptions.header.indexOffset,
      indexLength: productOptions.header.indexLength,
      worldCenterX: productOptions.header.worldCenterX,
      worldCenterY: productOptions.header.worldCenterY,
      worldCenterZ: productOptions.header.worldCenterZ,
      worldHalfSize: productOptions.header.worldHalfSize,
      payloadRecordSize: productOptions.header.payloadRecordSize,
      maxLevel: productOptions.header.maxLevel,
      magLimit: productOptions.header.magLimit,
    },
    completeness: {
      phase: 'complete',
      stable: true,
    },
  };
}
