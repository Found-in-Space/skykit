import {
  createObserverShellStrategy,
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
 * @typedef {import('@found-in-space/star-trees').StarCellStrategy} StarCellStrategy
 * @typedef {import('@found-in-space/star-trees').StarStrategyAnchor} StarStrategyAnchor
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

const DEFAULT_STRATEGY = createObserverShellStrategy();
const DEFAULT_ATTRIBUTES = ['position', 'teffLog8', 'magAbs'];
const DEFAULT_COORDINATES = {
  name: 'position',
  frame: 'icrs',
  units: /** @type {[string, string, string]} */ (['pc', 'pc', 'pc']),
};
const CACHED_CURRENT_PROMOTION_INTERVAL_MS = 50;

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
 *   readCachedCells?: (
 *     entries: StarOctreeDemandEntry[],
 *     options: {
 *       sessionId?: string;
 *       attributes?: string[];
 *       coordinates?: StarOctreeCoordinateOutput;
 *       memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
 *     }
 *   ) => StarCellData[] | Promise<StarCellData[]>;
 *   warmEntries?: (
 *     entries: StarOctreeDemandEntry[],
 *     options?: { sessionId?: string; attributes?: string[]; emitCachedFirst?: boolean; signal?: AbortSignal }
 *   ) => Promise<unknown>;
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
 * @typedef {{
 *   controller: AbortController;
 *   entriesByCellKey: Map<StarCellKey, StarOctreeDemandEntry>;
 *   promise?: Promise<void>;
 * }} CurrentLoadRecord
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
  /** @type {Map<StarCellKey, StarOctreeDemandEntry>} */
  let desiredCurrentEntriesByCellKey = new Map();
  /** @type {Map<StarCellKey, StarOctreeDemandEntry>} */
  const inFlightCurrentEntriesByCellKey = new Map();
  /** @type {Set<StarCellKey>} */
  let pendingRemovalCellKeys = new Set();
  /** @type {Set<number>} */
  const activePlans = new Set();
  /** @type {Set<CurrentLoadRecord>} */
  const activeCurrentLoads = new Set();
  /** @type {Set<Promise<unknown>>} */
  const activePrefetches = new Set();
  /** @type {Set<() => void>} */
  const activePrefetchCancels = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let cachedCurrentPromotionTimeout = null;

  /** @type {StarOctreeViewPatch} */
  let currentView = {};
  /** @type {StarStrategyAnchor | null} */
  let demandAnchor = null;
  /** @type {AbortController | null} */
  let activePlanningAbortController = null;
  /** @type {{
   *   force: boolean;
   *   reasons: string[];
   *   view: StarOctreeViewPatch;
   *   anchor: StarStrategyAnchor;
   *   viewRevision: number;
   * } | null} */
  let queuedPlanOptions = null;
  /** @type {unknown} */
  let plannerCache = null;
  let viewRevision = 0;
  let demandRevision = 0;
  let demandSignature = '';
  let demandNodeCount = 0;
  let latestCurrentViewRevision = 0;
  let latestDemandHasProduced = false;
  let lastCurrentEmittedViewRevision = 0;
  let lastCurrentEmittedDemandRevision = -1;
  let latestPlanToken = 0;
  let lastAppliedPlanToken = 0;
  /** @type {StarOctreeSessionSnapshot['demand']['status']} */
  let status = 'idle';
  /** @type {string[]} */
  let lastReasons = [];
  /** @type {string | null} */
  let lastError = null;
  const demandStats = {
    cachedCurrentCellHitCount: 0,
    coldCurrentCellLoadCount: 0,
    staleCurrentLoadAbortCount: 0,
    staleCurrentCellDropCount: 0,
  };
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
      const nextAnchor = options.strategy.createAnchor(nextViewState);

      if (updateOptions.demand === 'suppress') {
        lastReasons = [];
        return createReceipt('suppressed', []);
      }

      if (updateOptions.demand !== 'force') {
        const gate = evaluateDemandGate({
          strategy: options.strategy,
          thresholds: options.demandThresholds,
          previousAnchor: demandAnchor,
          nextAnchor,
          reason: updateOptions.reason,
        });

        if (!gate.replan) {
          lastReasons = gate.reasons;
          return createReceipt('unchanged', gate.reasons);
        }

        demandAnchor = nextAnchor;
        lastReasons = gate.reasons;
        scheduleDemandPlanning({
          force: false,
          reasons: gate.reasons,
          view: nextAnchor.view,
          anchor: nextAnchor,
          viewRevision,
        });

        return createReceipt('queued', gate.reasons);
      }

      const reasons = [
        updateOptions.reason ??
          (viewRevision === 1 ? 'initial' : 'demand-changed'),
      ];
      demandAnchor = nextAnchor;
      lastReasons = reasons;
      scheduleDemandPlanning({
        force: true,
        reasons,
        view: nextAnchor.view,
        anchor: nextAnchor,
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
   *   anchor: StarStrategyAnchor;
   *   viewRevision: number;
   * }} planOptions
   */
  function scheduleDemandPlanning(planOptions) {
    cancelScheduledPrefetch();
    cancelScheduledCachedCurrentPromotion();
    if (activePlanningAbortController) {
      queuedPlanOptions = planOptions;
      status = 'planning';
      return;
    }
    startDemandPlanning(planOptions);
  }

  /**
   * @param {{
   *   force: boolean;
   *   reasons: string[];
   *   view: StarOctreeViewPatch;
   *   anchor: StarStrategyAnchor;
   *   viewRevision: number;
   * }} planOptions
   */
  function startDemandPlanning(planOptions) {
    const abortController = new AbortController();
    activePlanningAbortController = abortController;
    const token = latestPlanToken + 1;
    latestPlanToken = token;
    activePlans.add(token);
    status = 'planning';

    Promise.resolve()
      .then(async () => {
        const context = createSelectionContext(
          planOptions.view,
          planOptions.anchor,
          planOptions.viewRevision,
          abortController.signal,
        );
        const plan = await createOptions.source.planDemand(context);

        if (
          disposed ||
          abortController.signal.aborted ||
          token <= lastAppliedPlanToken
        ) {
          return;
        }

        if ('plannerCache' in plan) {
          plannerCache = plan.plannerCache;
        }

        await applyDemandPlan(plan, {
          context,
          force: planOptions.force,
          reasons: planOptions.reasons,
          viewRevision: planOptions.viewRevision,
          token,
          signal: abortController.signal,
        });
        lastAppliedPlanToken = token;
      })
      .catch((error) => {
        if (
          disposed ||
          token <= lastAppliedPlanToken ||
          abortController.signal.aborted ||
          isAbortError(error)
        ) {
          return;
        }

        failSession(error);
      })
      .finally(() => {
        activePlans.delete(token);
        if (activePlanningAbortController === abortController) {
          activePlanningAbortController = null;
        }
        const queued = queuedPlanOptions;
        queuedPlanOptions = null;
        if (!disposed && queued) {
          startDemandPlanning(queued);
        }
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

    if (demandChanged) {
      demandRevision += 1;
      demandSignature = nextSignature;
    }
    demandNodeCount = currentEntries.length;
    latestCurrentViewRevision = applyOptions.viewRevision;

    const nextEntriesByCellKey = new Map(
      currentEntries.map((entry) => [createStarCellKey(entry.node), entry]),
    );
    desiredCurrentEntriesByCellKey = nextEntriesByCellKey;
    abortStaleCurrentLoads(nextEntriesByCellKey);
    latestDemandHasProduced = false;
    pendingRemovalCellKeys = new Set(
      Array.from(liveCellsByKey.keys())
        .filter((cellKey) => !desiredCurrentEntriesByCellKey.has(cellKey)),
    );
    await promoteCachedCurrentEntries(currentEntries, applyOptions);
    if (!isActivePlan(applyOptions) || queuedPlanOptions) {
      return;
    }
    const entriesToLoad = currentEntries.filter((entry) => {
      const cellKey = createStarCellKey(entry.node);
      return !liveCellsByKey.has(cellKey) &&
        !inFlightCurrentEntriesByCellKey.has(cellKey);
    });

    if (entriesToLoad.length > 0) {
      status = 'loading';
      startCurrentLoad(entriesToLoad, applyOptions.context);
    } else if (hasIncompleteDesiredCells()) {
      status = 'loading';
    } else {
      finishCurrentDemandIfReady();
    }
    if (hasIncompleteDesiredCells()) {
      scheduleCachedCurrentPromotion(applyOptions);
    }

    if (!isActivePlan(applyOptions) || queuedPlanOptions) {
      return;
    }
    schedulePrefetch(
      prefetchEntries,
      applyOptions.token,
      applyOptions.signal,
    );
  }

  /**
   * @param {StarOctreeDemandEntry[]} currentEntries
   * @param {{
   *   context: StarOctreeSelectionContext;
   *   token?: number;
   *   signal: AbortSignal;
   * }} applyOptions
   * @returns {Promise<number>}
   */
  async function promoteCachedCurrentEntries(currentEntries, applyOptions) {
    if (!createOptions.source.readCachedCells) {
      return 0;
    }
    const cacheCandidates = currentEntries.filter((entry) => {
      const cellKey = createStarCellKey(entry.node);
      return !liveCellsByKey.has(cellKey);
    });
    if (cacheCandidates.length === 0) {
      return 0;
    }

    throwIfAborted(applyOptions.signal);
    const cells = await createOptions.source.readCachedCells(cacheCandidates, {
      sessionId,
      attributes: options.attributes,
      coordinates: options.coordinates,
      memoryOwnership: options.memory.ownership,
    });
    throwIfAborted(applyOptions.signal);
    if (cells?.length > 0) {
      return acceptLoadedCells(cells, { source: 'cache' });
    }
    return 0;
  }

  /**
   * @param {{
   *   context: StarOctreeSelectionContext;
   *   token: number;
   *   signal: AbortSignal;
   * }} applyOptions
   */
  function scheduleCachedCurrentPromotion(applyOptions) {
    if (
      cachedCurrentPromotionTimeout ||
      !createOptions.source.readCachedCells ||
      !isActivePlan(applyOptions)
    ) {
      return;
    }

    cachedCurrentPromotionTimeout = setTimeout(() => {
      cachedCurrentPromotionTimeout = null;
      void runCachedCurrentPromotion(applyOptions);
    }, CACHED_CURRENT_PROMOTION_INTERVAL_MS);
  }

  /**
   * @param {{
   *   context: StarOctreeSelectionContext;
   *   token: number;
   *   signal: AbortSignal;
   * }} applyOptions
   */
  async function runCachedCurrentPromotion(applyOptions) {
    if (!isActivePlan(applyOptions) || !hasIncompleteDesiredCells()) {
      return;
    }

    try {
      await promoteCachedCurrentEntries(
        Array.from(desiredCurrentEntriesByCellKey.values()),
        applyOptions,
      );
    } catch (error) {
      if (!isAbortError(error)) {
        failSession(error);
      }
      return;
    }

    if (
      isActivePlan(applyOptions) &&
      hasIncompleteDesiredCells() &&
      activeCurrentLoads.size > 0
    ) {
      scheduleCachedCurrentPromotion(applyOptions);
    }
  }

  /**
   * @param {StarOctreeDemandEntry[]} entries
   * @param {StarOctreeSelectionContext} context
   */
  function startCurrentLoad(entries, context) {
    if (entries.length === 0) return;
    /** @type {Map<StarCellKey, StarOctreeDemandEntry>} */
    const loadingEntriesByCellKey = new Map();
    for (const entry of entries) {
      const cellKey = createStarCellKey(entry.node);
      if (
        liveCellsByKey.has(cellKey) ||
        inFlightCurrentEntriesByCellKey.has(cellKey)
      ) {
        continue;
      }
      loadingEntriesByCellKey.set(cellKey, entry);
      inFlightCurrentEntriesByCellKey.set(cellKey, entry);
    }
    if (loadingEntriesByCellKey.size === 0) return;

    const controller = new AbortController();
    demandStats.coldCurrentCellLoadCount += loadingEntriesByCellKey.size;
    /** @type {CurrentLoadRecord} */
    const record = {
      controller,
      entriesByCellKey: loadingEntriesByCellKey,
    };
    activeCurrentLoads.add(record);
    const load = (async () => {
      try {
        await loadCurrentEntries(
          Array.from(loadingEntriesByCellKey.values()),
          context,
          controller.signal,
        );
      } catch (error) {
        handleCurrentLoadError(error, loadingEntriesByCellKey);
      } finally {
        activeCurrentLoads.delete(record);
        clearInFlightEntries(loadingEntriesByCellKey);
        finishCurrentDemandIfReady();
      }
    })();
    record.promise = load;
  }

  /**
   * @param {StarOctreeDemandEntry[]} entries
   * @param {StarOctreeSelectionContext} context
   * @param {AbortSignal} signal
   */
  async function loadCurrentEntries(entries, context, signal) {
    if (createOptions.source.streamCells) {
      for await (const cells of createOptions.source.streamCells(
        entries,
        {
          sessionId,
          attributes: options.attributes,
          coordinates: options.coordinates,
          memoryOwnership: options.memory.ownership,
          batchMode: 'payload-range',
          emitCachedFirst: options.streaming.emitCachedFirst,
          signal,
        },
      )) {
        acceptLoadedCells(cells);
      }
      return;
    }

    for (const entry of entries) {
      throwIfAborted(signal);
      const decoded = createOptions.source.decodeNode(entry, context);
      const cell = createStarCellData({
        node: entry.node,
        decoded,
        attributes: options.attributes,
        coordinates: options.coordinates,
        memoryOwnership: options.memory.ownership,
      });
      acceptLoadedCells([cell]);
    }
  }

  /**
   * @param {StarCellData[]} cells
   * @param {{ source?: 'cache' | 'cold' }} [acceptOptions]
   * @returns {number}
   */
  function acceptLoadedCells(cells, acceptOptions = {}) {
    const { acceptedCells, droppedCellCount } = storeLoadedCells(cells);
    demandStats.staleCurrentCellDropCount += droppedCellCount;
    if (acceptedCells.length === 0) return 0;
    if (acceptOptions.source === 'cache') {
      demandStats.cachedCurrentCellHitCount += acceptedCells.length;
      clearInFlightCellKeys(acceptedCells.map((cell) => cell.cellKey));
    }
    latestDemandHasProduced = true;
    status = 'streaming';
    removePendingCellsAfterReplacement();
    emitDelta({
      type: 'stars/cells-upsert',
      providerId,
      sessionId,
      viewRevision: latestCurrentViewRevision,
      demandRevision,
      cells: acceptedCells,
    });
    finishCurrentDemandIfReady();
    return acceptedCells.length;
  }

  /**
   * @param {StarCellData[]} cells
   * @returns {{ acceptedCells: StarCellData[]; droppedCellCount: number }}
   */
  function storeLoadedCells(cells) {
    /** @type {StarCellData[]} */
    const acceptedCells = [];
    let droppedCellCount = 0;
    for (const cell of cells) {
      const entry = desiredCurrentEntriesByCellKey.get(cell.cellKey);
      if (!entry) {
        droppedCellCount += 1;
        continue;
      }
      if (liveCellsByKey.has(cell.cellKey)) {
        continue;
      }

      liveCellsByKey.set(cell.cellKey, cell);
      entriesByCellKey.set(cell.cellKey, entry);
      acceptedCells.push(cell);
    }
    return { acceptedCells, droppedCellCount };
  }

  /**
   * @param {Map<StarCellKey, StarOctreeDemandEntry>} loadingEntriesByCellKey
   */
  function clearInFlightEntries(loadingEntriesByCellKey) {
    for (const [cellKey, entry] of loadingEntriesByCellKey) {
      if (inFlightCurrentEntriesByCellKey.get(cellKey) === entry) {
        inFlightCurrentEntriesByCellKey.delete(cellKey);
      }
    }
  }

  /**
   * @param {StarCellKey[]} cellKeys
   */
  function clearInFlightCellKeys(cellKeys) {
    for (const cellKey of cellKeys) {
      inFlightCurrentEntriesByCellKey.delete(cellKey);
    }
  }

  /**
   * @param {Map<StarCellKey, StarOctreeDemandEntry>} nextEntriesByCellKey
   */
  function abortStaleCurrentLoads(nextEntriesByCellKey) {
    for (const record of activeCurrentLoads) {
      if (
        record.controller.signal.aborted ||
        currentLoadOverlapsDemand(record, nextEntriesByCellKey)
      ) {
        continue;
      }
      demandStats.staleCurrentLoadAbortCount += 1;
      record.controller.abort(createAbortError());
      clearInFlightEntries(record.entriesByCellKey);
    }
  }

  /**
   * @param {CurrentLoadRecord} record
   * @param {Map<StarCellKey, StarOctreeDemandEntry>} nextEntriesByCellKey
   */
  function currentLoadOverlapsDemand(record, nextEntriesByCellKey) {
    for (const cellKey of record.entriesByCellKey.keys()) {
      if (nextEntriesByCellKey.has(cellKey)) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {unknown} error
   * @param {Map<StarCellKey, StarOctreeDemandEntry>} loadingEntriesByCellKey
   */
  function handleCurrentLoadError(error, loadingEntriesByCellKey) {
    if (disposed || isAbortError(error)) return;
    const stillDesired = Array.from(loadingEntriesByCellKey.keys())
      .some((cellKey) => desiredCurrentEntriesByCellKey.has(cellKey));
    if (!stillDesired) return;
    failSession(error);
  }

  function removePendingCellsAfterReplacement() {
    if (!latestDemandHasProduced && pendingRemovalCellKeys.size > 0) {
      return;
    }
    /** @type {StarCellKey[]} */
    const removedCellKeys = [];
    for (const cellKey of pendingRemovalCellKeys) {
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
        viewRevision: latestCurrentViewRevision,
        demandRevision,
        cellKeys: removedCellKeys.sort(),
        reason: 'demand-excluded',
      });
    }
    pendingRemovalCellKeys.clear();
  }

  function finishCurrentDemandIfReady() {
    if (disposed || hasIncompleteDesiredCells()) {
      return;
    }
    latestDemandHasProduced = true;
    removePendingCellsAfterReplacement();
    status = 'current';
    if (
      lastCurrentEmittedViewRevision === latestCurrentViewRevision &&
      lastCurrentEmittedDemandRevision === demandRevision
    ) {
      return;
    }
    lastCurrentEmittedViewRevision = latestCurrentViewRevision;
    lastCurrentEmittedDemandRevision = demandRevision;
    emitCurrent(latestCurrentViewRevision);
  }

  function hasIncompleteDesiredCells() {
    for (const cellKey of desiredCurrentEntriesByCellKey.keys()) {
      if (!liveCellsByKey.has(cellKey)) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {StarOctreeDemandEntry[]} prefetchEntries
   * @param {number} token
   * @param {AbortSignal} signal
   */
  function schedulePrefetch(prefetchEntries, token, signal) {
    if (
      disposed ||
      token !== latestPlanToken ||
      signal.aborted ||
      prefetchEntries.length === 0
    ) {
      return;
    }

    let cancel = () => {};
    cancel = scheduleIdleTask(() => {
      activePrefetchCancels.delete(cancel);
      if (!isActivePrefetch(token, signal)) {
        return;
      }

      startPrefetch(prefetchEntries, token, signal);
    });
    activePrefetchCancels.add(cancel);
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
   * @param {StarStrategyAnchor} anchor
   * @param {number} nextViewRevision
   * @param {AbortSignal} [signal]
   * @returns {StarOctreeSelectionContext}
   */
  function createSelectionContext(view, anchor, nextViewRevision, signal) {
    return {
      providerId,
      sessionId,
      strategy: options.strategy,
      strategyAnchor: anchor,
      view: {
        revision: nextViewRevision,
        ...view,
      },
      viewRevision: nextViewRevision,
      demandRevision,
      attributes: options.attributes,
      coordinates: options.coordinates,
      streaming: {
        ...options.streaming,
      },
      plannerCache,
      traversalLane: 'current',
      signal,
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
        desiredCellCount: desiredCurrentEntriesByCellKey.size,
        currentCellCount: liveCellsByKey.size,
        inFlightCellCount: inFlightCurrentEntriesByCellKey.size,
        activeWorkItemCount: getActiveWorkItemCount(),
        cachedCurrentCellHitCount: demandStats.cachedCurrentCellHitCount,
        coldCurrentCellLoadCount: demandStats.coldCurrentCellLoadCount,
        staleCurrentLoadAbortCount: demandStats.staleCurrentLoadAbortCount,
        staleCurrentCellDropCount: demandStats.staleCurrentCellDropCount,
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
    abortActivePlanning();
    cancelScheduledCachedCurrentPromotion();
    for (const record of activeCurrentLoads) {
      if (!record.controller.signal.aborted) {
        record.controller.abort(createAbortError());
      }
    }
    activeCurrentLoads.clear();
    inFlightCurrentEntriesByCellKey.clear();
  }

  function abortActivePlanning() {
    if (activePlanningAbortController && !activePlanningAbortController.signal.aborted) {
      activePlanningAbortController.abort(createAbortError());
    }
    activePlanningAbortController = null;
    queuedPlanOptions = null;
    cancelScheduledPrefetch();
    cancelScheduledCachedCurrentPromotion();
  }

  function cancelScheduledPrefetch() {
    for (const cancel of activePrefetchCancels) {
      cancel();
    }
    activePrefetchCancels.clear();
  }

  function cancelScheduledCachedCurrentPromotion() {
    if (cachedCurrentPromotionTimeout) {
      clearTimeout(cachedCurrentPromotionTimeout);
      cachedCurrentPromotionTimeout = null;
    }
  }

  function assertActive() {
    if (disposed) {
      throw new Error(`Star octree provider session "${sessionId}" is disposed.`);
    }
  }

  function getActiveWorkItemCount() {
    const sourceWorkCount = createOptions.getActiveWorkItemCount?.(sessionId);
    return activePlans.size +
      activeCurrentLoads.size +
      (sourceWorkCount ?? activePrefetches.size);
  }

  /**
   * @param {{ token: number; signal: AbortSignal }} applyOptions
   */
  function isActivePlan(applyOptions) {
    return !disposed &&
      applyOptions.token === latestPlanToken &&
      !applyOptions.signal.aborted;
  }

  /**
   * @param {number} token
   * @param {AbortSignal} signal
   */
  function isActivePrefetch(token, signal) {
    return !disposed && token === latestPlanToken && !signal.aborted;
  }
}

/**
 * @param {StarOctreeSessionOptions | undefined} options
 * @returns {{
 *   id?: string;
 *   strategy: StarCellStrategy;
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
  const cellKeyForEntry = createEntryCellKeyCache();
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
    return cellKeyForEntry(a).localeCompare(cellKeyForEntry(b));
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

function createEntryCellKeyCache() {
  /** @type {WeakMap<StarOctreeDemandEntry, string>} */
  const cache = new WeakMap();
  /** @type {(entry: StarOctreeDemandEntry) => string} */
  const cellKeyForEntry = (entry) => {
    let cellKey = cache.get(entry);
    if (!cellKey) {
      cellKey = createStarCellKey(entry.node);
      cache.set(entry, cellKey);
    }
    return cellKey;
  };
  return cellKeyForEntry;
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

/** @param {AbortSignal | undefined} signal */
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

/**
 * @param {unknown} error
 */
function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * @param {() => void} callback
 * @returns {() => void}
 */
function scheduleIdleTask(callback) {
  const idleCallback = globalThis.requestIdleCallback;
  if (typeof idleCallback === 'function') {
    const idleId = idleCallback.call(globalThis, callback, { timeout: 1_000 });
    return () => {
      if (typeof globalThis.cancelIdleCallback === 'function') {
        globalThis.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = setTimeout(callback, 0);
  return () => clearTimeout(timeoutId);
}
