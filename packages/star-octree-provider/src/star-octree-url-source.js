const PERSISTENT_CACHE_NAME = 'skykit-star-octree-provider-alpha-v1';

/**
 * @typedef {{
 *   rangeRequests: number;
 *   bytesRequested: number;
 *   persistentCacheHits: number;
 *   fetchTimeMs: number;
 * }} RangeSourceStats
 */

/**
 * @param {{
 *   url: string;
 *   persistentCache?: 'on' | 'off';
 *   stats: RangeSourceStats;
 * }} options
 */
export function createUrlRangeSource(options) {
  /** @type {Promise<Cache | null> | null} */
  let persistentCachePromise = null;

  return {
    persistentCacheAvailable:
      options.persistentCache === 'on' && typeof caches !== 'undefined',

    /**
     * @param {number} start
     * @param {number} end
     */
    async fetchRange(start, end) {
      assertValidRange(start, end);

      const cache = await openPersistentCache();
      if (cache) {
        const cacheUrl = createRangeCacheUrl(options.url, start, end);

        try {
          const cached = await cache.match(cacheUrl);
          if (cached) {
            options.stats.persistentCacheHits += 1;
            return cached.arrayBuffer();
          }
        } catch {
          // Cache read failure should not prevent the authoritative range fetch.
        }
      }

      options.stats.rangeRequests += 1;
      options.stats.bytesRequested += end - start + 1;
      const startedAt = nowMs();
      const response = await fetch(options.url, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
      });
      options.stats.fetchTimeMs += nowMs() - startedAt;

      assertRangeResponse(response, options.url, start, end);
      const buffer = await response.arrayBuffer();

      if (cache) {
        const cacheUrl = createRangeCacheUrl(options.url, start, end);
        cache
          .put(new Request(cacheUrl), new Response(buffer.slice(0)))
          .catch(() => {});
      }

      return buffer;
    },
  };

  async function openPersistentCache() {
    if (options.persistentCache !== 'on' || typeof caches === 'undefined') {
      return null;
    }

    if (!persistentCachePromise) {
      persistentCachePromise = caches.open(PERSISTENT_CACHE_NAME).catch(() => null);
    }

    return persistentCachePromise;
  }
}

/**
 * @param {number} start
 * @param {number} end
 */
function assertValidRange(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new RangeError(`Invalid byte range ${start}-${end}`);
  }
}

/**
 * @param {Response} response
 * @param {string} url
 * @param {number} start
 * @param {number} end
 */
function assertRangeResponse(response, url, start, end) {
  if (response.ok || response.status === 206) {
    return;
  }

  throw new Error(`Range fetch failed: ${response.status} ${url} bytes=${start}-${end}`);
}

/**
 * @param {string} url
 * @param {number} start
 * @param {number} end
 */
function createRangeCacheUrl(url, start, end) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_r=${start}-${end}`;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
