import {
  createStarCellData,
  createStarCellKey,
  estimateStarCellBytes,
} from '@found-in-space/star-trees';
import { createAsyncQueue } from './star-octree-queue.js';
import {
  evaluateDemandGate,
  normalizeDemandThresholds,
} from './star-octree-demand-gate.js';

/**
 * @typedef {import('@found-in-space/star-trees').DecodedStarSegment} DecodedStarSegment
 * @typedef {import('@found-in-space/star-trees').StarCellData} StarCellData
 * @typedef {import('@found-in-space/star-trees').StarCellKey} StarCellKey
 * @typedef {import('./index.d.ts').StarOctreeCellDelta} StarOctreeCellDelta
 * @typedef {import('./index.d.ts').StarOctreeCoordinateOutput} StarOctreeCoordinateOutput
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('@found-in-space/star-trees').StarTreeDemandThresholds} StarTreeDemandThresholds
 * @typedef {import('@found-in-space/star-trees').StarTreeStrategy} StarTreeStrategy
 * @typedef {import('./index.d.ts').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeSessionOptions} StarOctreeSessionOptions
 * @typedef {import('./index.d.ts').StarOctreeSessionSnapshot} StarOctreeSessionSnapshot
 * @typedef {import('./index.d.ts').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {import('./index.d.ts').StarOctreeViewReceipt} StarOctreeViewReceipt
 * @typedef {import('./index.d.ts').StarOctreeViewState} StarOctreeViewState
 * @typedef {import('./index.d.ts').ViewUpdateOptions} ViewUpdateOptions
 */

const DEFAULT_STRATEGY = /** @type {const} */ ({ kind: 'observer-shell' });
const DEFAULT_ATTRIBUTES = ['position', 'teffLog8', 'magAbs'];
const DEFAULT_COORDINATES = {
  name: 'position',
  frame: 'icrs',
  units: /** @type {[string, string, string]} */ (['pc', 'pc', 'pc']),
};

/**
 * @typedef {{
 *   planDemand(context: StarOctreeSelectionContext): Promise<StarOctreeDemandPlan> | StarOctreeDemandPlan;
 *   decodeNode(entry: StarOctreeDemandEntry, context: StarOctreeSelectionContext): DecodedStarSegment;
 *   streamCells?: (
 *     entries: StarOctreeDemandEntry[],
 *     options: {
 *       sessionId?: string;
 *       attributes?: string[];
 *       coordinates?: StarOctreeCoordinateOutput;
 *       memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
 *       batchMode?: 'payload-range' | 'node';
 *       emitCachedFirst?: boolean;
 *       signal?: AbortSignal;
 *     }
 *   ) => AsyncIterable<StarCellData[]>;
 *   warmEntries?: (
 *     entries: StarOctreeDemandEntry[],
 *     options?: { sessionId?: string; attributes?: string[]; emitCachedFirst?: boolean; signal?: AbortSignal }
 *   ) => Promise<void>;
 * }} SessionSource
 */

/**
 * @typedef {{
 *   providerId: string;
 *   sessionId: string;
 *   options?: StarOctreeSessionOptions;
 *   source: SessionSource;
 *   getActiveWorkItemCount?: (sessionId: string) => number;
 *   onDispose?: (sessionId: string) => void;
 * }} CreateSessionOptions
 */

/**
 * @param {CreateSessionOptions} createOptions
 * @returns {StarOctreeProviderSession}
 */
export function createStarOctreeProviderSession(createOptions) {
  const providerId = createOptions.providerId;
  const sessionId = createOptions.sessionId;
  const options = normalizeSessionOptions(createOptions.options);
  /** @type {Set<(delta: StarOctreeCellDelta) => void>} */
  const listeners = new Set();
  /** @type {Set<ReturnType<typeof createAsyncQueue<StarOctreeCellDelta>>>} */
  const deltaQueues = new Set();
  /** @type {Map<StarCellKey, StarCellData>} */
  const liveCellsByKey = new Map();
  /** @type {Map<StarCellKey, StarOctreeDemandEntry>} */
  const entriesByCellKey = new Map();
  /** @type {Set<number>} */
  const activePlans = new Set();
  /** @type {Set<Promise<void>>} */
  const activePrefetches = new Set();

  /** @type {StarOctreeViewPatch} */
  let currentView = {};
  /** @type {StarOctreeViewState | null} */
  let demandAnchorView = null;
  /** @type {AbortController | null} */
  let activeAbortController = null;
  let viewRevision = 0;
  let demandRevision = 0;
  let demandSignature = '';
  let demandNodeCount = 0;
  let latestPlanToken = 0;
  /** @type {StarOctreeSessionSnapshot['demand']['status']} */
  let status = 'idle';
  /** @type {string[]} */
  let lastReasons = [];
  /** @type {string | null} */
  let lastError = null;
  let disposed = false;

  /** @type {StarOctreeProviderSession} */
  const session = {
    get id() {
      return sessionId;
    },

    updateView(patch, updateOptions = {}) {
      assertActive();

      viewRevision += 1;
      currentView = normalizeViewPatch(currentView, patch);
      const nextViewState = createViewState(currentView, viewRevision);

      if (updateOptions.demand === 'suppress') {
        lastReasons = [];
        return createReceipt('suppressed', []);
      }

      if (updateOptions.demand !== 'force') {
        const gate = evaluateDemandGate({
          strategy: options.strategy,
          thresholds: options.demandThresholds,
          previousDemandView: demandAnchorView,
          nextView: nextViewState,
          reason: updateOptions.reason,
        });

        if (!gate.replan) {
          lastReasons = gate.reasons;
          return createReceipt('unchanged', gate.reasons);
        }

        demandAnchorView = nextViewState;
        lastReasons = gate.reasons;
        scheduleDemandPlanning({
          force: false,
          reasons: gate.reasons,
          view: nextViewState,
          viewRevision,
        });

        return createReceipt('queued', gate.reasons);
      }

      const reasons = [
        updateOptions.reason ??
          (viewRevision === 1 ? 'initial' : 'demand-changed'),
      ];
      demandAnchorView = nextViewState;
      lastReasons = reasons;
      scheduleDemandPlanning({
        force: true,
        reasons,
        view: nextViewState,
        viewRevision,
      });

      return createReceipt('forced', reasons);
    },

    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    deltas() {
      const queue = createAsyncQueue();

      if (disposed) {
        queue.close();
      } else {
        deltaQueues.add(queue);
      }

      return createDeltaIterable(queue, () => {
        deltaQueues.delete(queue);
      });
    },

    getSnapshot() {
      return createSnapshot();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      status = 'disposed';
      abortActiveWork();
      activePlans.clear();
      listeners.clear();

      for (const queue of deltaQueues) {
        queue.close();
      }

      deltaQueues.clear();
      createOptions.onDispose?.(sessionId);
    },
  };

  return session;

  /**
   * @param {{
   *   force: boolean;
   *   reasons: string[];
   *   view: StarOctreeViewPatch;
   *   viewRevision: number;
   * }} planOptions
   */
  function scheduleDemandPlanning(planOptions) {
    abortActiveWork();
    const abortController = new AbortController();
    activeAbortController = abortController;
    const token = latestPlanToken + 1;
    latestPlanToken = token;
    activePlans.add(token);
    status = 'planning';

    Promise.resolve()
      .then(async () => {
        const context = createSelectionContext(planOptions.view, planOptions.viewRevision);
        const plan = await createOptions.source.planDemand(context);

        if (disposed || token !== latestPlanToken || abortController.signal.aborted) {
          return;
        }

        await applyDemandPlan(plan, {
          context,
          force: planOptions.force,
          reasons: planOptions.reasons,
          viewRevision: planOptions.viewRevision,
          token,
          signal: abortController.signal,
        });
      })
      .catch((error) => {
        if (
          disposed ||
          token !== latestPlanToken ||
          abortController.signal.aborted ||
          isAbortError(error)
        ) {
          return;
        }

        failSession(error);
      })
      .finally(() => {
        activePlans.delete(token);
      });
  }

  /**
   * @param {StarOctreeDemandPlan} plan
   * @param {{
   *   context: StarOctreeSelectionContext;
   *   force: boolean;
   *   reasons: string[];
   *   viewRevision: number;
   *   token: number;
   *   signal: AbortSignal;
   * }} applyOptions
   */
  async function applyDemandPlan(plan, applyOptions) {
    const entries = normalizeDemandEntries(plan.entries, {
      coarseFirst: options.streaming.coarseFirst !== false,
    });
    const currentEntries = entries.filter(
      (entry) => (entry.role ?? 'current') === 'current',
    );
    const prefetchEntries = entries.filter((entry) => entry.role === 'prefetch');
    const nextSignature = plan.signature ?? createDemandSignature(entries);
    const demandChanged = applyOptions.force || nextSignature !== demandSignature;
    lastReasons = plan.reasons?.length ? plan.reasons : applyOptions.reasons;

    if (!demandChanged) {
      demandNodeCount = currentEntries.length;
      status = 'current';
      if (!isActivePlan(applyOptions)) {
        return;
      }
      emitCurrent(applyOptions.viewRevision);
      if (!isActivePlan(applyOptions)) {
        return;
      }
      startPrefetch(prefetchEntries, applyOptions.token, applyOptions.signal);
      return;
    }

    demandRevision += 1;
    demandSignature = nextSignature;
    demandNodeCount = currentEntries.length;
    status = 'loading';

    const nextEntriesByCellKey = new Map(
      currentEntries.map((entry) => [createStarCellKey(entry.node), entry]),
    );
    const entriesToLoad = currentEntries.filter(
      (entry) => !liveCellsByKey.has(createStarCellKey(entry.node)),
    );
    const cellKeysToRemoveAfterReplacement = Array.from(liveCellsByKey.keys())
      .filter((cellKey) => !nextEntriesByCellKey.has(cellKey));

    if (createOptions.source.streamCells) {
      for await (const cells of createOptions.source.streamCells(
        entriesToLoad,
        {
          sessionId,
          attributes: options.attributes,
          coordinates: options.coordinates,
          memoryOwnership: options.memory.ownership,
          batchMode: 'payload-range',
          emitCachedFirst: options.streaming.emitCachedFirst,
          signal: applyOptions.signal,
        },
      )) {
        if (!isActivePlan(applyOptions)) {
          return;
        }

        const acceptedCells = storeLoadedCells(cells, nextEntriesByCellKey);
        if (acceptedCells.length > 0) {
          status = 'streaming';
          emitDelta({
            type: 'stars/cells-upsert',
            providerId,
            sessionId,
            viewRevision: applyOptions.viewRevision,
            demandRevision,
            cells: acceptedCells,
          });
        }
      }
    } else {
      for (const entry of entriesToLoad) {
        if (!isActivePlan(applyOptions)) {
          return;
        }
        const decoded = createOptions.source.decodeNode(entry, applyOptions.context);
        const cell = createStarCellData({
          node: entry.node,
          decoded,
          attributes: options.attributes,
          coordinates: options.coordinates,
          memoryOwnership: options.memory.ownership,
        });
        const acceptedCells = storeLoadedCells([cell], nextEntriesByCellKey);
        if (acceptedCells.length > 0) {
          status = 'streaming';
          emitDelta({
            type: 'stars/cells-upsert',
            providerId,
            sessionId,
            viewRevision: applyOptions.viewRevision,
            demandRevision,
            cells: acceptedCells,
          });
        }
      }
    }

    if (!isActivePlan(applyOptions)) {
      return;
    }

    removeCellsAfterReplacement(cellKeysToRemoveAfterReplacement, applyOptions.viewRevision);

    if (!isActivePlan(applyOptions)) {
      return;
    }

    status = 'current';
    emitCurrent(applyOptions.viewRevision);
    if (!isActivePlan(applyOptions)) {
      return;
    }
    startPrefetch(prefetchEntries, applyOptions.token, applyOptions.signal);
  }

  /**
   * @param {StarCellData[]} cells
   * @param {Map<StarCellKey, StarOctreeDemandEntry>} nextEntriesByCellKey
   * @returns {StarCellData[]}
   */
  function storeLoadedCells(cells, nextEntriesByCellKey) {
    /** @type {StarCellData[]} */
    const acceptedCells = [];
    for (const cell of cells) {
      const entry = nextEntriesByCellKey.get(cell.cellKey);
      if (!entry) {
        continue;
      }

      liveCellsByKey.set(cell.cellKey, cell);
      entriesByCellKey.set(cell.cellKey, entry);
      acceptedCells.push(cell);
    }
    return acceptedCells;
  }

  /**
   * @param {StarCellKey[]} cellKeys
   * @param {number} currentViewRevision
   */
  function removeCellsAfterReplacement(cellKeys, currentViewRevision) {
    /** @type {StarCellKey[]} */
    const removedCellKeys = [];
    for (const cellKey of cellKeys) {
      if (!liveCellsByKey.has(cellKey)) {
        continue;
      }
      liveCellsByKey.delete(cellKey);
      entriesByCellKey.delete(cellKey);
      removedCellKeys.push(cellKey);
    }

    if (removedCellKeys.length > 0) {
      emitDelta({
        type: 'stars/cells-remove',
        providerId,
        sessionId,
        viewRevision: currentViewRevision,
        demandRevision,
        cellKeys: removedCellKeys.sort(),
        reason: 'demand-excluded',
      });
    }
  }

  /**
   * @param {StarOctreeDemandEntry[]} prefetchEntries
   * @param {number} token
   * @param {AbortSignal} signal
   */
  function startPrefetch(prefetchEntries, token, signal) {
    if (
      prefetchEntries.length === 0 ||
      !createOptions.source.warmEntries ||
      disposed ||
      token !== latestPlanToken ||
      signal.aborted
    ) {
      return;
    }

    const prefetch = createOptions.source.warmEntries(prefetchEntries, {
      sessionId,
      attributes: options.attributes,
      emitCachedFirst: options.streaming.emitCachedFirst,
      signal,
    });
    activePrefetches.add(prefetch);
    prefetch.then(
      () => {
        activePrefetches.delete(prefetch);
      },
      () => {
        activePrefetches.delete(prefetch);
      },
    );
  }

  /**
   * @param {StarOctreeViewPatch | StarOctreeViewState} view
   * @param {number} nextViewRevision
   * @returns {StarOctreeSelectionContext}
   */
  function createSelectionContext(view, nextViewRevision) {
    return {
      providerId,
      sessionId,
      strategy: options.strategy,
      view: {
        revision: nextViewRevision,
        ...view,
      },
      viewRevision: nextViewRevision,
      demandRevision,
      attributes: options.attributes,
      coordinates: options.coordinates,
      streaming: options.streaming,
      traversal: createUnavailableTraversal(),
    };
  }

  /**
   * @param {'queued' | 'forced' | 'suppressed' | 'unchanged'} demand
   * @param {string[]} reasons
   * @returns {StarOctreeViewReceipt}
   */
  function createReceipt(demand, reasons) {
    return {
      sessionId,
      viewRevision,
      demandRevision,
      demand,
      reasons,
    };
  }

  /**
   * @param {StarOctreeCellDelta} delta
   */
  function emitDelta(delta) {
    if (disposed) return;

    for (const queue of deltaQueues) {
      queue.push(delta);
    }

    for (const listener of listeners) {
      listener(delta);
    }
  }

  /**
   * @param {number} currentViewRevision
   */
  function emitCurrent(currentViewRevision) {
    const cellKeys = Array.from(liveCellsByKey.keys()).sort();
    const starCount = cellKeys.reduce(
      (sum, cellKey) => sum + (liveCellsByKey.get(cellKey)?.count ?? 0),
      0,
    );

    emitDelta({
      type: 'stars/current',
      providerId,
      sessionId,
      viewRevision: currentViewRevision,
      demandRevision,
      cellKeys,
      starCount,
    });
  }

  /**
   * @param {unknown} error
   */
  function failSession(error) {
    const message = error instanceof Error ? error.message : String(error);
    status = 'failed';
    lastError = message;
    emitDelta({
      type: 'stars/error',
      providerId,
      sessionId,
      demandRevision,
      error: {
        message,
      },
    });
  }

  function createSnapshot() {
    const cellSummaries = Array.from(liveCellsByKey.values())
      .sort((left, right) => left.cellKey.localeCompare(right.cellKey))
      .map((cell) => ({
        cellKey: cell.cellKey,
        level: cell.cell.level,
        mortonCode: cell.cell.mortonCode,
        starCount: cell.count,
        current: true,
        bytes: estimateStarCellBytes(cell),
      }));
    const liveBytes = cellSummaries.reduce(
      (sum, cell) => sum + cell.bytes,
      0,
    );

    return {
      id: sessionId,
      strategy: options.strategy,
      view: {
        revision: viewRevision,
        ...currentView,
      },
      demand: {
        revision: demandRevision,
        status,
        demandNodeCount,
        currentCellCount: liveCellsByKey.size,
        activeWorkItemCount: getActiveWorkItemCount(),
      },
      cells: cellSummaries,
      memory: {
        liveBytes,
        borrowedBytes: options.memory.ownership === 'borrowed' ? liveBytes : 0,
        evictableBytes: 0,
      },
      lastReasons,
      lastError,
    };
  }

  function abortActiveWork() {
    if (!activeAbortController || activeAbortController.signal.aborted) {
      return;
    }
    activeAbortController.abort(createAbortError());
  }

  function assertActive() {
    if (disposed) {
      throw new Error(`Star octree provider session "${sessionId}" is disposed.`);
    }
  }

  function getActiveWorkItemCount() {
    const sourceWorkCount = createOptions.getActiveWorkItemCount?.(sessionId);
    return activePlans.size + (sourceWorkCount ?? activePrefetches.size);
  }

  /**
   * @param {{ token: number; signal: AbortSignal }} applyOptions
   */
  function isActivePlan(applyOptions) {
    return !disposed &&
      applyOptions.token === latestPlanToken &&
      !applyOptions.signal.aborted;
  }
}

/**
 * @param {StarOctreeSessionOptions | undefined} options
 * @returns {{
 *   id?: string;
 *   strategy: StarTreeStrategy;
 *   demandThresholds?: StarTreeDemandThresholds;
 *   attributes: string[];
 *   coordinates: StarOctreeCoordinateOutput;
 *   streaming: {
 *     progressive: boolean;
 *     emitCachedFirst: boolean;
 *     coarseFirst?: boolean;
 *   };
 *   memory: {
 *     ownership: 'borrowed' | 'copy' | 'transfer';
 *   };
 * }}
 */
function normalizeSessionOptions(options) {
  return {
    ...(options?.id ? { id: options.id } : {}),
    strategy: options?.strategy ?? DEFAULT_STRATEGY,
    ...(options?.demandThresholds !== undefined
      ? { demandThresholds: normalizeDemandThresholds(options.demandThresholds) }
      : {}),
    attributes: options?.attributes
      ? [...options.attributes]
      : [...DEFAULT_ATTRIBUTES],
    coordinates: {
      ...DEFAULT_COORDINATES,
      ...(options?.coordinates ?? {}),
    },
    streaming: {
      progressive: options?.streaming?.progressive ?? true,
      emitCachedFirst: options?.streaming?.emitCachedFirst ?? true,
      ...(options?.streaming?.coarseFirst !== undefined
        ? { coarseFirst: options.streaming.coarseFirst }
        : {}),
    },
    memory: {
      ownership: options?.memory?.ownership ?? 'borrowed',
    },
  };
}

/**
 * @param {StarOctreeViewPatch} currentView
 * @param {StarOctreeViewPatch} patch
 * @returns {StarOctreeViewPatch}
 */
function normalizeViewPatch(currentView, patch) {
  const nextView = {
    ...currentView,
    ...patch,
  };

  if (
    patch.limitingMagnitude === undefined &&
    patch.mDesired !== undefined
  ) {
    nextView.limitingMagnitude = patch.mDesired;
  }

  delete nextView.mDesired;
  return nextView;
}

/**
 * @param {StarOctreeViewPatch} view
 * @param {number} revision
 * @returns {StarOctreeViewState}
 */
function createViewState(view, revision) {
  return {
    revision,
    ...view,
    ...(view.observerPc ? { observerPc: { ...view.observerPc } } : {}),
    ...(view.targetPc ? { targetPc: { ...view.targetPc } } : {}),
    ...(view.directionIcrs ? { directionIcrs: { ...view.directionIcrs } } : {}),
    ...(view.orientationIcrs
      ? { orientationIcrs: { ...view.orientationIcrs } }
      : {}),
    ...(view.motion
      ? {
          motion: {
            ...view.motion,
            ...(view.motion.velocityPcPerSec
              ? { velocityPcPerSec: { ...view.motion.velocityPcPerSec } }
              : {}),
          },
        }
      : {}),
    ...(view.params ? { params: { ...view.params } } : {}),
  };
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 * @param {{ coarseFirst: boolean }} sortOptions
 * @returns {StarOctreeDemandEntry[]}
 */
function normalizeDemandEntries(entries, sortOptions) {
  return [...entries].sort((a, b) => {
    const roleDelta = roleOrder(a) - roleOrder(b);
    if (roleDelta !== 0) return roleDelta;

    if (sortOptions.coarseFirst) {
      const levelDelta = a.node.level - b.node.level;
      if (levelDelta !== 0) return levelDelta;

      const motionDelta = compareMetadataNumberDescending(
        a,
        b,
        'motionPriorityBias',
      );
      if (motionDelta !== 0) return motionDelta;

      const forwardDelta = compareMetadataNumber(a, b, 'forwardDistancePc');
      if (forwardDelta !== 0) return forwardDelta;

      const distanceDelta = compareMetadataNumber(a, b, 'distancePc');
      if (distanceDelta !== 0) return distanceDelta;
    }

    const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return createStarCellKey(a.node).localeCompare(createStarCellKey(b.node));
  });
}

/**
 * @param {StarOctreeDemandEntry} entry
 */
function roleOrder(entry) {
  return (entry.role ?? 'current') === 'current' ? 0 : 1;
}

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {string} key
 */
function compareMetadataNumber(left, right, key) {
  const leftValue = metadataNumber(left, key);
  const rightValue = metadataNumber(right, key);
  return leftValue === rightValue ? 0 : leftValue - rightValue;
}

/**
 * @param {StarOctreeDemandEntry} left
 * @param {StarOctreeDemandEntry} right
 * @param {string} key
 */
function compareMetadataNumberDescending(left, right, key) {
  const leftValue = optionalMetadataNumber(left, key);
  const rightValue = optionalMetadataNumber(right, key);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  return leftValue === rightValue ? 0 : rightValue - leftValue;
}

/**
 * @param {StarOctreeDemandEntry} entry
 * @param {string} key
 */
function metadataNumber(entry, key) {
  const value = Number(entry.metadata?.[key]);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * @param {StarOctreeDemandEntry} entry
 * @param {string} key
 */
function optionalMetadataNumber(entry, key) {
  const value = Number(entry.metadata?.[key]);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 * @returns {string}
 */
function createDemandSignature(entries) {
  return entries
    .filter((entry) => (entry.role ?? 'current') === 'current')
    .map((entry) => `${createStarCellKey(entry.node)}:${entry.role ?? 'current'}`)
    .join('|');
}

/**
 * @param {ReturnType<typeof createAsyncQueue<StarOctreeCellDelta>>} queue
 * @param {() => void} onReturn
 * @returns {AsyncIterable<StarOctreeCellDelta>}
 */
function createDeltaIterable(queue, onReturn) {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        yield* queue;
      } finally {
        onReturn();
      }
    },
  };
}

function createUnavailableTraversal() {
  return {
    async select() {
      throw new Error('Star octree traversal context is only available through the provider pipeline.');
    },
  };
}

function createAbortError() {
  const error = new Error('Superseded star demand revision aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * @param {unknown} error
 */
function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}
