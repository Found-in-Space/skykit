import { createBrowserPersistentCache } from './browser-persistent-cache.js';

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
  const persistentCache = createBrowserPersistentCache({
    cacheName: PERSISTENT_CACHE_NAME,
    mode: options.persistentCache,
  });

  return {
    get persistentCacheAvailable() {
      return persistentCache.available;
    },

    /**
     * @param {number} start
     * @param {number} end
     * @param {{ signal?: AbortSignal }} [fetchOptions]
     */
    async fetchRange(start, end, fetchOptions = {}) {
      assertValidRange(start, end);
      throwIfAborted(fetchOptions.signal);

      const cache = await persistentCache.open();
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
        signal: fetchOptions.signal,
      });
      options.stats.fetchTimeMs += nowMs() - startedAt;

      assertRangeResponse(response, options.url, start, end);
      throwIfAborted(fetchOptions.signal);
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

}

/**
 * @param {AbortSignal | undefined} signal
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  const error = new Error('Range fetch aborted.');
  error.name = 'AbortError';
  throw error;
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
  if (response.status === 206) {
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
