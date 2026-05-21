const DECODED_CACHE_VERSION = 2;
const DEFAULT_DECODED_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
const DEFAULT_DECODED_MEMORY_LEASE_TTL_MS = 60_000;
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
 *   now?: () => number;
 * }} options
 */
export function createDecodedPayloadCache(options) {
  /** @type {Map<string, { segment: DecodedStarSegment; bytes: number; lastUsed: number; leases: Map<string, number> }>} */
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
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

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

    /**
     * Keep an already-decoded memory entry resident for a bounded interval.
     * Persistent cache remains a fallback; promotion paths still use peek().
     *
     * @param {string} key
     * @param {{ key?: string; ttlMs?: number } | null | undefined} leaseOptions
     * @returns {boolean}
     */
    retain(key, leaseOptions) {
      const lease = normalizeLease(leaseOptions, now());
      if (!lease) return false;
      const entry = memory.get(key);
      if (!entry) return false;
      pruneExpiredLeases(entry);
      entry.leases.set(lease.key, lease.expiresAtMs);
      return true;
    },

    /**
     * @param {string} leaseKey
     * @returns {number}
     */
    releaseLease(leaseKey) {
      const key = normalizeLeaseKey(leaseKey);
      if (!key) return 0;
      let released = 0;
      for (const entry of memory.values()) {
        if (entry.leases.delete(key)) {
          released += 1;
        }
      }
      evictToBudget();
      return released;
    },

    getSnapshot() {
      pruneAllExpiredLeases();
      const leaseStats = collectLeaseStats();
      return {
        decodedPayloads: memory.size,
        decodedPayloadBytes: usedBytes,
        decodedCacheLeasedPayloads: leaseStats.payloads,
        decodedCacheLeasedPayloadBytes: leaseStats.bytes,
        decodedCacheActiveLeases: leaseStats.activeLeases,
        decodedCacheLeasePressureBytes: Math.max(0, usedBytes - memoryBudgetBytes),
        decodedCacheLeasesByKey: leaseStats.byKey,
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
   * @param {{ key?: string; ttlMs?: number } | null | undefined} [leaseOptions]
   */
  function set(key, segment, attributeMask = DEFAULT_ATTRIBUTE_MASK, leaseOptions = null) {
    const bytes = estimateDecodedBytes(segment);
    const current = memory.get(key);
    if (current) {
      pruneExpiredLeases(current);
      usedBytes -= current.bytes;
    }
    const leases = current ? new Map(current.leases) : new Map();
    const lease = normalizeLease(leaseOptions, now());
    if (lease) {
      leases.set(lease.key, lease.expiresAtMs);
    }

    clock += 1;
    memory.set(key, {
      segment,
      bytes,
      lastUsed: clock,
      leases,
    });
    usedBytes += bytes;
    writes += 1;
    incrementCounter(writesByMask, attributeMask);
    evictToBudget();
    void writePersistent(key, segment).catch(() => {});
  }

  /**
   * @param {{ segment: DecodedStarSegment; bytes: number; lastUsed: number; leases: Map<string, number> }} entry
   * @param {string} attributeMask
   */
  function recordMemoryHit(entry, attributeMask) {
    pruneExpiredLeases(entry);
    hits += 1;
    incrementCounter(hitsByMask, attributeMask);
    clock += 1;
    entry.lastUsed = clock;
    return entry.segment;
  }

  function evictToBudget() {
    pruneAllExpiredLeases();
    if (usedBytes <= memoryBudgetBytes) {
      return;
    }

    const entries = Array.from(memory.entries())
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [key, entry] of entries) {
      if (usedBytes <= memoryBudgetBytes) {
        return;
      }
      if (hasActiveLease(entry)) {
        continue;
      }
      memory.delete(key);
      usedBytes -= entry.bytes;
      evictions += 1;
    }
  }

  function pruneAllExpiredLeases() {
    for (const entry of memory.values()) {
      pruneExpiredLeases(entry);
    }
  }

  /**
   * @param {{ leases: Map<string, number> }} entry
   */
  function pruneExpiredLeases(entry) {
    if (entry.leases.size === 0) return;
    const currentTimeMs = now();
    for (const [leaseKey, expiresAtMs] of entry.leases) {
      if (expiresAtMs <= currentTimeMs) {
        entry.leases.delete(leaseKey);
      }
    }
  }

  /**
   * @param {{ leases: Map<string, number> }} entry
   */
  function hasActiveLease(entry) {
    pruneExpiredLeases(entry);
    return entry.leases.size > 0;
  }

  function collectLeaseStats() {
    const activeLeaseKeys = new Set();
    /** @type {Record<string, { payloads: number; bytes: number; expiresAtMs: number }>} */
    const byKey = {};
    let payloads = 0;
    let bytes = 0;
    for (const entry of memory.values()) {
      if (entry.leases.size === 0) continue;
      payloads += 1;
      bytes += entry.bytes;
      for (const [leaseKey, expiresAtMs] of entry.leases) {
        activeLeaseKeys.add(leaseKey);
        const current = byKey[leaseKey] ?? {
          payloads: 0,
          bytes: 0,
          expiresAtMs: 0,
        };
        current.payloads += 1;
        current.bytes += entry.bytes;
        current.expiresAtMs = Math.max(current.expiresAtMs, expiresAtMs);
        byKey[leaseKey] = current;
      }
    }
    return {
      payloads,
      bytes,
      activeLeases: activeLeaseKeys.size,
      byKey,
    };
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
 * @param {{ key?: string; ttlMs?: number } | null | undefined} leaseOptions
 * @param {number} nowMs
 */
function normalizeLease(leaseOptions, nowMs) {
  if (!leaseOptions) return null;
  const key = normalizeLeaseKey(leaseOptions.key);
  if (!key) return null;
  const ttlMs = Number(leaseOptions.ttlMs ?? DEFAULT_DECODED_MEMORY_LEASE_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
  return {
    key,
    expiresAtMs: nowMs + ttlMs,
  };
}

/**
 * @param {unknown} value
 */
function normalizeLeaseKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length > 0 ? key : null;
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
