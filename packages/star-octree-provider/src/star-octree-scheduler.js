/**
 * @typedef {'current' | 'replacement' | 'prefetch'} StarOctreeSchedulerLane
 * @typedef {'traversal' | 'shard' | 'payload' | 'decode'} StarOctreeSchedulerKind
 */

const DEFAULT_KIND_LIMITS = Object.freeze({
  traversal: 2,
  shard: 8,
  payload: 8,
  decode: 4,
});
const DEFAULT_PREFETCH_LIMITS = Object.freeze({
  traversal: 1,
  shard: 1,
  payload: 1,
  decode: 1,
});
const LANE_ORDER = Object.freeze({
  current: 0,
  replacement: 1,
  prefetch: 2,
});
const KINDS = /** @type {const} */ (['traversal', 'shard', 'payload', 'decode']);
const LANES = /** @type {const} */ (['current', 'replacement', 'prefetch']);

/**
 * @typedef {{
 *   maxInflightTraversalTasks?: number;
 *   maxInflightShardFetches?: number;
 *   maxInflightPayloadBatches?: number;
 *   maxInflightDecodeTasks?: number;
 *   maxInflightPrefetchTraversalTasks?: number;
 *   maxInflightPrefetchShardFetches?: number;
 *   maxInflightPrefetchPayloadBatches?: number;
 *   maxInflightPrefetchDecodeTasks?: number;
 * }} StarOctreeSchedulerLimits
 */

/**
 * @typedef {{
 *   kind: StarOctreeSchedulerKind;
 *   lane?: StarOctreeSchedulerLane;
 *   key?: string;
 *   priority?: number;
 *   signal?: AbortSignal;
 *   preempt?: 'foreground';
 *   onPreempt?: (reason: unknown) => void;
 * }} StarOctreeSchedulerRequest
 */

/**
 * @template T
 * @typedef {{
 *   promise: Promise<T>;
 *   cancel(reason?: unknown): void;
 *   promote(lane: StarOctreeSchedulerLane, priority?: number): void;
 * }} StarOctreeScheduledTask
 */

/**
 * @param {{ limits?: StarOctreeSchedulerLimits }} [options]
 */
export function createStarOctreeScheduler(options = {}) {
  const limits = normalizeSchedulerLimits(options.limits);
  const queues = createQueueBuckets();
  const queuedByKind = createKindCounts();
  const queuedByLane = createLaneCounts();
  const activeByKind = createKindCounts();
  const activeByLane = createLaneCounts();
  const activePrefetchByKind = createKindCounts();
  /** @type {Set<ScheduledTaskRecord>} */
  const activeTasks = new Set();
  const stats = createSchedulerStats();
  let queuedTaskCount = 0;
  let queuedForegroundTaskCount = 0;
  let nextSequence = 1;

  return {
    schedule,
    getSnapshot,
  };

  /**
   * @template T
   * @param {StarOctreeSchedulerRequest} request
   * @param {() => Promise<T> | T} run
   * @returns {StarOctreeScheduledTask<T>}
   */
  function schedule(request, run) {
    const lane = normalizeLane(request.lane);
    const kind = normalizeKind(request.kind);
    const priority = normalizePriority(request.priority);
    /** @type {(value: T) => void} */
    let resolvePromise = () => {};
    /** @type {(error: unknown) => void} */
    let rejectPromise = () => {};
    /** @type {ScheduledTaskRecord} */
    const task = {
      kind,
      lane,
      key: request.key,
      priority,
      sequence: nextSequence,
      signal: request.signal,
      preempt: request.preempt,
      onPreempt: request.onPreempt,
      preempted: false,
      run,
      state: 'queued',
      heapIndex: -1,
      resolve(value) {
        resolvePromise(/** @type {T} */ (value));
      },
      reject(error) {
        rejectPromise(error);
      },
    };
    nextSequence += 1;

    const promise = /** @type {Promise<T>} */ (new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }));

    if (request.signal?.aborted) {
      stats.cancelled += 1;
      stats.cancelledByKind[kind] += 1;
      stats.cancelledByLane[lane] += 1;
      rejectPromise(createAbortError(request.signal.reason));
      return {
        promise,
        cancel() {},
        promote() {},
      };
    }

    const abortListener = () => cancelQueuedTask(task, request.signal?.reason);
    task.abortListener = abortListener;
    request.signal?.addEventListener('abort', abortListener, { once: true });

    enqueueTask(task);
    stats.queued += 1;
    stats.queuedByKind[kind] += 1;
    stats.queuedByLane[lane] += 1;
    pump();

    return {
      promise,
      cancel(reason) {
        cancelQueuedTask(task, reason);
      },
      promote(nextLane, nextPriority) {
        promoteTask(task, nextLane, nextPriority);
      },
    };
  }

  function pump() {
    for (;;) {
      const task = pickStartableTask();
      if (!task) {
        return;
      }
      startTask(task);
    }
  }

  /**
   * @returns {ScheduledTaskRecord | null}
   */
  function pickStartableTask() {
    /** @type {ScheduledTaskRecord | null} */
    let bestTask = null;

    for (const lane of LANES) {
      for (const kind of KINDS) {
        const task = queues[lane][kind].peek();
        if (!task || !canStart(task)) {
          continue;
        }
        if (!bestTask || compareTasks(task, bestTask) < 0) {
          bestTask = task;
        }
      }
    }

    if (!bestTask) {
      return null;
    }

    dequeueTask(bestTask);
    return bestTask;
  }

  /**
   * @param {ScheduledTaskRecord} task
   */
  function canStart(task) {
    if (activeByKind[task.kind] >= limits.maxActiveByKind[task.kind]) {
      return false;
    }

    if (
      task.lane === 'prefetch' &&
      activePrefetchByKind[task.kind] >= limits.maxActivePrefetchByKind[task.kind]
    ) {
      return false;
    }

    if (
      task.lane === 'prefetch' &&
      (queuedForegroundTaskCount > 0 || hasActiveForegroundWork())
    ) {
      return false;
    }

    return true;
  }

  /**
   * @param {ScheduledTaskRecord} task
   */
  function startTask(task) {
    task.state = 'running';
    if (task.abortListener) {
      task.signal?.removeEventListener('abort', task.abortListener);
    }
    activeByKind[task.kind] += 1;
    activeByLane[task.lane] += 1;
    if (task.lane === 'prefetch') {
      activePrefetchByKind[task.kind] += 1;
    }
    activeTasks.add(task);
    stats.started += 1;
    stats.startedByKind[task.kind] += 1;
    stats.startedByLane[task.lane] += 1;

    Promise.resolve()
      .then(task.run)
      .then(
        (value) => {
          task.state = 'completed';
          stats.completed += 1;
          stats.completedByKind[task.kind] += 1;
          stats.completedByLane[task.lane] += 1;
          task.resolve(value);
        },
        (error) => {
          if (isAbortError(error) && task.preempted) {
            task.state = 'preempted';
          } else if (isAbortError(error)) {
            task.state = 'cancelled';
            stats.cancelled += 1;
            stats.cancelledByKind[task.kind] += 1;
            stats.cancelledByLane[task.lane] += 1;
          } else {
            task.state = 'failed';
            stats.failed += 1;
            stats.failedByKind[task.kind] += 1;
            stats.failedByLane[task.lane] += 1;
          }
          task.reject(error);
        },
      )
      .finally(() => {
        activeTasks.delete(task);
        activeByKind[task.kind] -= 1;
        activeByLane[task.lane] -= 1;
        if (task.lane === 'prefetch') {
          activePrefetchByKind[task.kind] -= 1;
        }
        pump();
      });
  }

  /**
   * @param {ScheduledTaskRecord} task
   */
  function enqueueTask(task) {
    queues[task.lane][task.kind].push(task);
    queuedTaskCount += 1;
    queuedByKind[task.kind] += 1;
    queuedByLane[task.lane] += 1;
    if (task.lane !== 'prefetch') {
      queuedForegroundTaskCount += 1;
      preemptRunningPrefetch('foreground');
    }
  }

  /**
   * @param {ScheduledTaskRecord} task
   */
  function dequeueTask(task) {
    if (!queues[task.lane][task.kind].remove(task)) {
      return;
    }
    queuedTaskCount -= 1;
    queuedByKind[task.kind] -= 1;
    queuedByLane[task.lane] -= 1;
    if (task.lane !== 'prefetch') {
      queuedForegroundTaskCount -= 1;
    }
  }

  /**
   * @param {ScheduledTaskRecord} task
   * @param {unknown} reason
   */
  function cancelQueuedTask(task, reason) {
    if (task.state !== 'queued') {
      return;
    }

    dequeueTask(task);
    task.state = 'cancelled';
    if (task.abortListener) {
      task.signal?.removeEventListener('abort', task.abortListener);
    }
    stats.cancelled += 1;
    stats.cancelledByKind[task.kind] += 1;
    stats.cancelledByLane[task.lane] += 1;
    task.reject(createAbortError(reason));
    pump();
  }

  /**
   * @param {ScheduledTaskRecord} task
   * @param {StarOctreeSchedulerLane} nextLane
   * @param {number | undefined} nextPriority
   */
  function promoteTask(task, nextLane, nextPriority) {
    const promotedLane = normalizeLane(nextLane);
    const canPromoteLane = LANE_ORDER[promotedLane] < LANE_ORDER[task.lane];
    const normalizedPriority = nextPriority === undefined
      ? undefined
      : normalizePriority(nextPriority);
    const nextTaskPriority = normalizedPriority === undefined
      ? task.priority
      : Math.max(task.priority, normalizedPriority);

    if (task.state === 'queued') {
      const laneChanged = canPromoteLane;
      const priorityChanged = nextTaskPriority !== task.priority;
      if (!laneChanged && !priorityChanged) {
        return;
      }

      if (laneChanged) {
        dequeueTask(task);
        const previousLane = task.lane;
        task.lane = promotedLane;
        task.priority = nextTaskPriority;
        enqueueTask(task);
        stats.promoted += 1;
        stats.promotedByLane[previousLane] += 1;
        if (promotedLane !== 'prefetch') {
          preemptRunningPrefetch('foreground');
        }
        pump();
        return;
      }

      task.priority = nextTaskPriority;
      queues[task.lane][task.kind].rescore(task);
      pump();
      return;
    }

    if (task.state !== 'running') {
      return;
    }

    if (canPromoteLane) {
      const previousLane = task.lane;
      activeByLane[previousLane] -= 1;
      if (previousLane === 'prefetch') {
        activePrefetchByKind[task.kind] -= 1;
      }
      task.lane = promotedLane;
      activeByLane[task.lane] += 1;
      stats.promoted += 1;
      stats.promotedByLane[previousLane] += 1;
      if (promotedLane !== 'prefetch') {
        preemptRunningPrefetch('foreground');
      }
    }

    task.priority = nextTaskPriority;
  }

  /**
   * @param {'foreground'} reason
   */
  function preemptRunningPrefetch(reason) {
    const preemptReason = createPreemptError(reason);
    for (const task of activeTasks) {
      if (
        task.state !== 'running' ||
        task.lane !== 'prefetch' ||
        task.preempt !== 'foreground' ||
        task.preempted
      ) {
        continue;
      }

      task.preempted = true;
      stats.preempted += 1;
      stats.preemptedByKind[task.kind] += 1;
      stats.preemptedByLane[task.lane] += 1;
      try {
        task.onPreempt?.(preemptReason);
      } catch {
        // The running task owns its promise; preemption callbacks are best-effort abort hooks.
      }
    }
  }

  function hasActiveForegroundWork() {
    return activeByLane.current + activeByLane.replacement > 0;
  }

  function getSnapshot() {
    return {
      queued: queuedTaskCount,
      active: activeByKind.traversal +
        activeByKind.shard +
        activeByKind.payload +
        activeByKind.decode,
      queuedByKind: { ...queuedByKind },
      queuedByLane: { ...queuedByLane },
      activeByKind: { ...activeByKind },
      activeByLane: { ...activeByLane },
      activePrefetchByKind: { ...activePrefetchByKind },
      stats: {
        queued: stats.queued,
        started: stats.started,
        completed: stats.completed,
        cancelled: stats.cancelled,
        preempted: stats.preempted,
        failed: stats.failed,
        queuedByKind: { ...stats.queuedByKind },
        queuedByLane: { ...stats.queuedByLane },
        startedByKind: { ...stats.startedByKind },
        startedByLane: { ...stats.startedByLane },
        completedByKind: { ...stats.completedByKind },
        completedByLane: { ...stats.completedByLane },
        cancelledByKind: { ...stats.cancelledByKind },
        cancelledByLane: { ...stats.cancelledByLane },
        preemptedByKind: { ...stats.preemptedByKind },
        preemptedByLane: { ...stats.preemptedByLane },
        failedByKind: { ...stats.failedByKind },
        failedByLane: { ...stats.failedByLane },
      },
      limits: {
        maxActiveByKind: { ...limits.maxActiveByKind },
        maxActivePrefetchByKind: { ...limits.maxActivePrefetchByKind },
      },
    };
  }
}

/**
 * @typedef {{
 *   kind: StarOctreeSchedulerKind;
 *   lane: StarOctreeSchedulerLane;
 *   key?: string;
 *   priority: number;
 *   sequence: number;
 *   signal?: AbortSignal;
 *   abortListener?: () => void;
 *   preempt?: 'foreground';
 *   onPreempt?: (reason: unknown) => void;
 *   preempted: boolean;
 *   run: () => Promise<unknown> | unknown;
 *   state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'preempted';
 *   heapIndex: number;
 *   resolve: (value: unknown) => void;
 *   reject: (error: unknown) => void;
 * }} ScheduledTaskRecord
 */

class SchedulerTaskHeap {
  constructor() {
    /** @type {ScheduledTaskRecord[]} */
    this.items = [];
  }

  peek() {
    return this.items[0] ?? null;
  }

  /**
   * @param {ScheduledTaskRecord} task
   */
  push(task) {
    task.heapIndex = this.items.length;
    this.items.push(task);
    this.siftUp(task.heapIndex);
  }

  /**
   * @param {ScheduledTaskRecord} task
   */
  remove(task) {
    const index = task.heapIndex;
    if (index < 0 || index >= this.items.length || this.items[index] !== task) {
      return false;
    }

    const last = this.items.pop();
    task.heapIndex = -1;
    if (index < this.items.length && last) {
      this.items[index] = last;
      last.heapIndex = index;
      this.rescore(last);
    }
    return true;
  }

  /**
   * @param {ScheduledTaskRecord} task
   */
  rescore(task) {
    if (task.heapIndex < 0) {
      return;
    }
    this.siftUp(task.heapIndex);
    this.siftDown(task.heapIndex);
  }

  /**
   * @param {number} index
   */
  siftUp(index) {
    let childIndex = index;
    while (childIndex > 0) {
      const parentIndex = Math.floor((childIndex - 1) / 2);
      if (compareTasks(this.items[parentIndex], this.items[childIndex]) <= 0) {
        break;
      }
      this.swap(parentIndex, childIndex);
      childIndex = parentIndex;
    }
  }

  /**
   * @param {number} index
   */
  siftDown(index) {
    let parentIndex = index;
    for (;;) {
      const leftIndex = parentIndex * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = parentIndex;

      if (
        leftIndex < this.items.length &&
        compareTasks(this.items[leftIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = leftIndex;
      }

      if (
        rightIndex < this.items.length &&
        compareTasks(this.items[rightIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === parentIndex) {
        break;
      }

      this.swap(parentIndex, smallestIndex);
      parentIndex = smallestIndex;
    }
  }

  /**
   * @param {number} left
   * @param {number} right
   */
  swap(left, right) {
    const item = this.items[left];
    this.items[left] = this.items[right];
    this.items[right] = item;
    this.items[left].heapIndex = left;
    this.items[right].heapIndex = right;
  }
}

function createQueueBuckets() {
  /** @type {Record<StarOctreeSchedulerLane, Record<StarOctreeSchedulerKind, SchedulerTaskHeap>>} */
  const buckets = {
    current: createKindQueues(),
    replacement: createKindQueues(),
    prefetch: createKindQueues(),
  };
  return buckets;
}

function createKindQueues() {
  return {
    traversal: new SchedulerTaskHeap(),
    shard: new SchedulerTaskHeap(),
    payload: new SchedulerTaskHeap(),
    decode: new SchedulerTaskHeap(),
  };
}

/**
 * @param {ScheduledTaskRecord} left
 * @param {ScheduledTaskRecord} right
 */
function compareTasks(left, right) {
  const laneDelta = LANE_ORDER[left.lane] - LANE_ORDER[right.lane];
  if (laneDelta !== 0) return laneDelta;

  const priorityDelta = right.priority - left.priority;
  if (priorityDelta !== 0) return priorityDelta;

  return left.sequence - right.sequence;
}

/**
 * @param {StarOctreeSchedulerLimits | undefined} limits
 */
function normalizeSchedulerLimits(limits) {
  return {
    maxActiveByKind: {
      traversal: normalizePositiveInteger(
        limits?.maxInflightTraversalTasks,
        DEFAULT_KIND_LIMITS.traversal,
      ),
      shard: normalizePositiveInteger(
        limits?.maxInflightShardFetches,
        DEFAULT_KIND_LIMITS.shard,
      ),
      payload: normalizePositiveInteger(
        limits?.maxInflightPayloadBatches,
        DEFAULT_KIND_LIMITS.payload,
      ),
      decode: normalizePositiveInteger(
        limits?.maxInflightDecodeTasks,
        DEFAULT_KIND_LIMITS.decode,
      ),
    },
    maxActivePrefetchByKind: {
      traversal: normalizePositiveInteger(
        limits?.maxInflightPrefetchTraversalTasks,
        DEFAULT_PREFETCH_LIMITS.traversal,
      ),
      shard: normalizePositiveInteger(
        limits?.maxInflightPrefetchShardFetches,
        DEFAULT_PREFETCH_LIMITS.shard,
      ),
      payload: normalizePositiveInteger(
        limits?.maxInflightPrefetchPayloadBatches,
        DEFAULT_PREFETCH_LIMITS.payload,
      ),
      decode: normalizePositiveInteger(
        limits?.maxInflightPrefetchDecodeTasks,
        DEFAULT_PREFETCH_LIMITS.decode,
      ),
    },
  };
}

function createSchedulerStats() {
  return {
    queued: 0,
    started: 0,
    completed: 0,
    cancelled: 0,
    preempted: 0,
    failed: 0,
    promoted: 0,
    queuedByKind: createKindCounts(),
    queuedByLane: createLaneCounts(),
    startedByKind: createKindCounts(),
    startedByLane: createLaneCounts(),
    completedByKind: createKindCounts(),
    completedByLane: createLaneCounts(),
    cancelledByKind: createKindCounts(),
    cancelledByLane: createLaneCounts(),
    preemptedByKind: createKindCounts(),
    preemptedByLane: createLaneCounts(),
    failedByKind: createKindCounts(),
    failedByLane: createLaneCounts(),
    promotedByLane: createLaneCounts(),
  };
}

function createKindCounts() {
  return {
    traversal: 0,
    shard: 0,
    payload: 0,
    decode: 0,
  };
}

function createLaneCounts() {
  return {
    current: 0,
    replacement: 0,
    prefetch: 0,
  };
}

/**
 * @param {unknown} kind
 * @returns {StarOctreeSchedulerKind}
 */
function normalizeKind(kind) {
  return KINDS.includes(/** @type {StarOctreeSchedulerKind} */ (kind))
    ? /** @type {StarOctreeSchedulerKind} */ (kind)
    : 'payload';
}

/**
 * @param {unknown} lane
 * @returns {StarOctreeSchedulerLane}
 */
export function normalizeSchedulerLane(lane) {
  return normalizeLane(lane);
}

/**
 * @param {unknown} lane
 * @returns {StarOctreeSchedulerLane}
 */
function normalizeLane(lane) {
  return LANES.includes(/** @type {StarOctreeSchedulerLane} */ (lane))
    ? /** @type {StarOctreeSchedulerLane} */ (lane)
    : 'current';
}

/**
 * @param {unknown} value
 */
function normalizePriority(value) {
  const priority = Number(value);
  return Number.isFinite(priority) ? priority : 0;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/**
 * @param {unknown} reason
 */
function createAbortError(reason) {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error('Star octree scheduled work aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * @param {'foreground'} reason
 */
function createPreemptError(reason) {
  const error = new Error(`Star octree prefetch preempted by ${reason} work.`);
  error.name = 'AbortError';
  return error;
}

/**
 * @param {unknown} error
 */
function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}
