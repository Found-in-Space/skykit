const DECODED_CACHE_VERSION = 2;
const DEFAULT_DECODED_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
const PERSISTENT_DECODED_CACHE_NAME =
  'skykit-star-octree-provider-decoded-alpha-v2';
const DEFAULT_ATTRIBUTE_MASK = 'p+t+m';

/**
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('@found-in-space/star-trees').DecodedStarSegment} DecodedStarSegment
 */

/**
 * @param {{
 *   sourceIdentity: string;
 *   datasetId?: string | null;
 *   memoryBudgetBytes?: number;
 *   persistentCache?: 'on' | 'off';
 * }} options
 */
export function createDecodedPayloadCache(options) {
  /** @type {Map<string, { segment: DecodedStarSegment; bytes: number; lastUsed: number }>} */
  const memory = new Map();
  /** @type {Promise<Cache | null> | null} */
  let persistentCachePromise = null;
  let hits = 0;
  let misses = 0;
  let writes = 0;
  let persistentHits = 0;
  let evictions = 0;
  let usedBytes = 0;
  let clock = 0;
  /** @type {Record<string, number>} */
  const hitsByMask = {};
  /** @type {Record<string, number>} */
  const missesByMask = {};
  /** @type {Record<string, number>} */
  const writesByMask = {};
  /** @type {Record<string, number>} */
  const persistentHitsByMask = {};

  const memoryBudgetBytes =
    options.memoryBudgetBytes ?? DEFAULT_DECODED_CACHE_BUDGET_BYTES;

  return {
    /**
     * @param {StarOctreeRuntimeNode} node
     */
    createKey(node, datasetId = options.datasetId, attributeMask = DEFAULT_ATTRIBUTE_MASK) {
      return createDecodedCacheKey({
        sourceIdentity: options.sourceIdentity,
        datasetId,
        node,
        attributeMask,
      });
    },

    /**
     * @param {string} key
     * @param {StarOctreeRuntimeNode} node
     * @param {string | null | undefined} datasetId
     * @param {string} [attributeMask]
     * @returns {Promise<DecodedStarSegment | null>}
     */
    async get(key, node, datasetId = options.datasetId, attributeMask = DEFAULT_ATTRIBUTE_MASK) {
      const entry = memory.get(key);
      if (entry) {
        return recordMemoryHit(entry, attributeMask);
      }

      const persistent = await readPersistent(key, node, datasetId);
      if (persistent) {
        persistentHits += 1;
        incrementCounter(persistentHitsByMask, attributeMask);
        set(key, persistent, attributeMask);
        return persistent;
      }

      misses += 1;
      incrementCounter(missesByMask, attributeMask);
      return null;
    },

    /**
     * Memory-only lookup for hot promotion paths. This intentionally avoids
     * persistent cache reads so current-demand reconciliation stays synchronous.
     *
     * @param {string} key
     * @param {StarOctreeRuntimeNode} [_node]
     * @param {string | null | undefined} [_datasetId]
     * @param {string} [attributeMask]
     * @returns {DecodedStarSegment | null}
     */
    peek(key, _node, _datasetId = options.datasetId, attributeMask = DEFAULT_ATTRIBUTE_MASK) {
      const entry = memory.get(key);
      return entry ? recordMemoryHit(entry, attributeMask) : null;
    },

    set,

    getSnapshot() {
      return {
        decodedPayloads: memory.size,
        decodedPayloadBytes: usedBytes,
        decodedCacheHits: hits,
        decodedCacheMisses: misses,
        decodedCacheWrites: writes,
        decodedPersistentCacheHits: persistentHits,
        decodedCacheEvictions: evictions,
        decodedCacheBudgetBytes: memoryBudgetBytes,
        decodedCacheHitsByMask: { ...hitsByMask },
        decodedCacheMissesByMask: { ...missesByMask },
        decodedCacheWritesByMask: { ...writesByMask },
        decodedPersistentCacheHitsByMask: { ...persistentHitsByMask },
      };
    },
  };

  /**
   * @param {string} key
   * @param {DecodedStarSegment} segment
   * @param {string} [attributeMask]
   */
  function set(key, segment, attributeMask = DEFAULT_ATTRIBUTE_MASK) {
    const bytes = estimateDecodedBytes(segment);
    const current = memory.get(key);
    if (current) {
      usedBytes -= current.bytes;
    }

    clock += 1;
    memory.set(key, {
      segment,
      bytes,
      lastUsed: clock,
    });
    usedBytes += bytes;
    writes += 1;
    incrementCounter(writesByMask, attributeMask);
    evictToBudget();
    void writePersistent(key, segment).catch(() => {});
  }

  /**
   * @param {{ segment: DecodedStarSegment; bytes: number; lastUsed: number }} entry
   * @param {string} attributeMask
   */
  function recordMemoryHit(entry, attributeMask) {
    hits += 1;
    incrementCounter(hitsByMask, attributeMask);
    clock += 1;
    entry.lastUsed = clock;
    return entry.segment;
  }

  function evictToBudget() {
    if (usedBytes <= memoryBudgetBytes) {
      return;
    }

    const entries = Array.from(memory.entries())
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [key, entry] of entries) {
      if (usedBytes <= memoryBudgetBytes) {
        return;
      }
      memory.delete(key);
      usedBytes -= entry.bytes;
      evictions += 1;
    }
  }

  async function openPersistentCache() {
    if (options.persistentCache !== 'on' || typeof caches === 'undefined') {
      return null;
    }

    if (!persistentCachePromise) {
      persistentCachePromise = caches.open(PERSISTENT_DECODED_CACHE_NAME)
        .catch(() => null);
    }

    return persistentCachePromise;
  }

  /**
   * @param {string} key
   * @param {StarOctreeRuntimeNode} node
   * @param {string | null | undefined} datasetId
   * @returns {Promise<DecodedStarSegment | null>}
   */
  async function readPersistent(key, node, datasetId) {
    const cache = await openPersistentCache();
    if (!cache) return null;

    try {
      const cached = await cache.match(createPersistentUrl(key));
      if (!cached) return null;
      return decodePersistentSegment(await cached.arrayBuffer(), node, datasetId);
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {DecodedStarSegment} segment
   */
  async function writePersistent(key, segment) {
    const cache = await openPersistentCache();
    if (!cache) return;
    await cache.put(
      new Request(createPersistentUrl(key)),
      new Response(encodePersistentSegment(segment)),
    );
  }
}

/**
 * @param {{
 *   sourceIdentity: string;
 *   datasetId?: string | null;
 *   node: StarOctreeRuntimeNode;
 *   attributeMask?: string;
 * }} options
 */
export function createDecodedCacheKey(options) {
  return [
    `v${DECODED_CACHE_VERSION}`,
    options.sourceIdentity,
    options.datasetId ?? 'unknown-dataset',
    'star-record-16',
    `attrs:${options.attributeMask ?? DEFAULT_ATTRIBUTE_MASK}`,
    options.node.payloadOffset,
    options.node.payloadLength,
  ].join(':');
}

/**
 * @param {DecodedStarSegment} segment
 */
export function estimateDecodedBytes(segment) {
  return (
    segment.positionsPc.byteLength +
    (segment.teffLog8?.byteLength ?? 0) +
    (segment.magAbs?.byteLength ?? 0)
  );
}

/**
 * @param {DecodedStarSegment} segment
 */
function encodePersistentSegment(segment) {
  const teffLength = segment.teffLog8?.byteLength ?? 0;
  const magLength = segment.magAbs?.byteLength ?? 0;
  const bytes = new Uint8Array(
    16 + segment.positionsPc.byteLength + teffLength + magLength,
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, DECODED_CACHE_VERSION, true);
  view.setUint32(4, segment.count, true);
  view.setUint32(8, teffLength, true);
  view.setUint32(12, magLength, true);
  let offset = 16;
  bytes.set(new Uint8Array(segment.positionsPc.buffer), offset);
  offset += segment.positionsPc.byteLength;
  if (segment.teffLog8) {
    bytes.set(segment.teffLog8, offset);
    offset += segment.teffLog8.byteLength;
  }
  if (segment.magAbs) {
    bytes.set(new Uint8Array(segment.magAbs.buffer), offset);
  }
  return bytes;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {StarOctreeRuntimeNode} node
 * @param {string | null | undefined} datasetId
 * @returns {DecodedStarSegment | null}
 */
function decodePersistentSegment(buffer, node, datasetId) {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== DECODED_CACHE_VERSION) return null;
  const count = view.getUint32(4, true);
  const teffLength = view.getUint32(8, true);
  const magLength = view.getUint32(12, true);
  const positionLength = count * 3 * Float32Array.BYTES_PER_ELEMENT;
  const expectedLength = 16 + positionLength + teffLength + magLength;
  if (buffer.byteLength !== expectedLength) return null;

  let offset = 16;
  const positionsPc = new Float32Array(
    buffer.slice(offset, offset + positionLength),
  );
  offset += positionLength;
  const teffLog8 = teffLength > 0
    ? new Uint8Array(buffer.slice(offset, offset + teffLength))
    : undefined;
  offset += teffLength;
  const magAbs = magLength > 0
    ? new Float32Array(buffer.slice(offset, offset + magLength))
    : undefined;

  return {
    count,
    positionsPc,
    ...(teffLog8 ? { teffLog8 } : {}),
    ...(magAbs ? { magAbs } : {}),
  };
}

/**
 * @param {string} key
 */
function createPersistentUrl(key) {
  return `https://cache.local/skykit/star-octree-provider/decoded/${encodeURIComponent(key)}`;
}

/**
 * @param {Record<string, number>} counter
 * @param {string} key
 */
function incrementCounter(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1;
}
