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
 *   file: Blob;
 *   stats: RangeSourceStats;
 * }} options
 */
export function createBlobRangeSource(options) {
  return {
    persistentCacheAvailable: false,

    /**
     * @param {number} start
     * @param {number} end
     */
    async fetchRange(start, end) {
      assertValidRange(start, end);
      options.stats.rangeRequests += 1;
      options.stats.bytesRequested += end - start + 1;
      const startedAt = nowMs();
      const slice = options.file.slice(start, end + 1);
      const buffer = await slice.arrayBuffer();
      options.stats.fetchTimeMs += nowMs() - startedAt;
      return buffer;
    },
  };
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

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
