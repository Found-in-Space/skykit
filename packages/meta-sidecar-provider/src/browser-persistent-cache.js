let hasWarnedPersistentCacheUnavailable = false;

/**
 * @param {{
 *   cacheName: string;
 *   mode?: 'on' | 'off';
 * }} options
 */
export function createBrowserPersistentCache(options) {
  /** @type {Promise<Cache | null> | null} */
  let cachePromise = null;
  let disabled = false;

  return {
    get available() {
      if (options.mode !== 'on') {
        return false;
      }
      const cacheStorage = readCacheStorage();
      return cacheStorage !== null && readCacheOpen(cacheStorage) !== null;
    },

    open() {
      if (options.mode !== 'on') {
        return Promise.resolve(null);
      }

      const cacheStorage = readCacheStorage();
      if (!cacheStorage) {
        return Promise.resolve(null);
      }

      if (!cachePromise) {
        const openCache = readCacheOpen(cacheStorage);
        if (!openCache) {
          return Promise.resolve(null);
        }

        try {
          cachePromise = Promise.resolve(openCache.call(cacheStorage, options.cacheName))
            .catch((error) => {
              disabled = true;
              warnPersistentCacheUnavailable(error);
              return null;
            });
        } catch (error) {
          disabled = true;
          warnPersistentCacheUnavailable(error);
          return Promise.resolve(null);
        }
      }

      return cachePromise;
    },
  };

  /**
   * @returns {CacheStorage | null}
   */
  function readCacheStorage() {
    if (disabled) {
      return null;
    }

    try {
      return globalThis.caches ?? null;
    } catch (error) {
      disabled = true;
      warnPersistentCacheUnavailable(error);
      return null;
    }
  }

  /**
   * @param {CacheStorage} cacheStorage
   * @returns {((cacheName: string) => Promise<Cache>) | null}
   */
  function readCacheOpen(cacheStorage) {
    try {
      if (typeof cacheStorage.open !== 'function') {
        disabled = true;
        return null;
      }
      return cacheStorage.open;
    } catch (error) {
      disabled = true;
      warnPersistentCacheUnavailable(error);
      return null;
    }
  }
}

/**
 * @param {unknown} error
 */
function warnPersistentCacheUnavailable(error) {
  if (
    hasWarnedPersistentCacheUnavailable ||
    typeof console === 'undefined' ||
    typeof console.warn !== 'function'
  ) {
    return;
  }

  hasWarnedPersistentCacheUnavailable = true;
  console.warn(
    '[SkyKit] Persistent browser cache is unavailable; continuing without Cache API storage.',
    error,
  );
}
