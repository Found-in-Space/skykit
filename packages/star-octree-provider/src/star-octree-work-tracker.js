/**
 * @typedef {import('./index.d.ts').StarOctreeProviderSnapshot['workItems'][number]} StarOctreeWorkItemSnapshot
 */

let nextWorkId = 1;

export function createStarOctreeWorkTracker() {
  /** @type {Map<string, StarOctreeWorkItemSnapshot>} */
  const items = new Map();

  return {
    /**
     * @param {{
     *   sessionId?: string;
     *   status?: StarOctreeWorkItemSnapshot['status'];
     *   nodeCount?: number;
     *   bytesLoaded?: number;
     * }} options
     */
    start(options = {}) {
      const workId = `work:${nextWorkId}`;
      nextWorkId += 1;
      const item = {
        workId,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        status: options.status ?? 'queued',
        ...(options.nodeCount !== undefined ? { nodeCount: options.nodeCount } : {}),
        ...(options.bytesLoaded !== undefined ? { bytesLoaded: options.bytesLoaded } : {}),
        startedAtMs: nowMs(),
      };
      items.set(workId, item);

      return {
        workId,
        /**
         * @param {Partial<StarOctreeWorkItemSnapshot>} patch
         */
        update(patch) {
          const current = items.get(workId);
          if (!current) return;
          items.set(workId, { ...current, ...patch });
        },
        finish() {
          const current = items.get(workId);
          if (!current) return;
          items.set(workId, {
            ...current,
            status: 'finished',
            finishedAtMs: nowMs(),
          });
        },
        fail() {
          const current = items.get(workId);
          if (!current) return;
          items.set(workId, {
            ...current,
            status: 'failed',
            finishedAtMs: nowMs(),
          });
        },
      };
    },

    snapshot() {
      return Array.from(items.values());
    },

    /**
     * @param {{ sessionId?: string }} [filter]
     */
    countActive(filter = {}) {
      let count = 0;
      for (const item of items.values()) {
        if (
          filter.sessionId !== undefined &&
          item.sessionId !== filter.sessionId
        ) {
          continue;
        }
        if (item.status !== 'finished' && item.status !== 'failed') {
          count += 1;
        }
      }
      return count;
    },

    clearFinished() {
      for (const [workId, item] of items) {
        if (item.status === 'finished' || item.status === 'failed') {
          items.delete(workId);
        }
      }
    },
  };
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
