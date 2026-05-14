import { createStarObjectBatchProduct } from './star-octree-products.js';
import { createAsyncQueue } from './star-octree-queue.js';
import {
  evaluateDemandGate,
  normalizeDemandThresholds,
} from './star-octree-demand-gate.js';

/**
 * @typedef {import('./index.d.ts').StarObjectBatchProduct} StarObjectBatchProduct
 * @typedef {import('./index.d.ts').StarOctreeCoordinateOutput} StarOctreeCoordinateOutput
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeDemandThresholds} StarOctreeDemandThresholds
 * @typedef {import('./index.d.ts').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('./index.d.ts').StarOctreeProductDelta} StarOctreeProductDelta
 * @typedef {import('./index.d.ts').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeSessionOptions} StarOctreeSessionOptions
 * @typedef {import('./index.d.ts').StarOctreeSessionSnapshot} StarOctreeSessionSnapshot
 * @typedef {import('./index.d.ts').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {import('./index.d.ts').StarOctreeViewReceipt} StarOctreeViewReceipt
 * @typedef {import('./index.d.ts').StarOctreeViewState} StarOctreeViewState
 * @typedef {import('./index.d.ts').ViewUpdateOptions} ViewUpdateOptions
 * @typedef {import('./star-octree-products.js').DecodedStarSegment} DecodedStarSegment
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
 *   streamObjectProducts?: (
 *     entries: StarOctreeDemandEntry[],
 *     options: {
 *       streamId: string;
 *       sessionId?: string;
 *       attributes?: string[];
 *       coordinates?: StarOctreeCoordinateOutput;
 *       viewRevision?: number;
 *       demandRevision?: number;
 *       memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
 *       batchMode?: 'payload-range' | 'node';
 *       emitCachedFirst?: boolean;
 *       nextProductIndex: () => number;
 *     }
 *   ) => AsyncIterable<StarObjectBatchProduct>;
 *   warmEntries?: (
 *     entries: StarOctreeDemandEntry[],
 *     options?: { sessionId?: string; emitCachedFirst?: boolean }
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
  const streamId = `${sessionId}:live`;
  /** @type {Set<(delta: StarOctreeProductDelta) => void>} */
  const listeners = new Set();
  /** @type {Set<ReturnType<typeof createAsyncQueue<StarOctreeProductDelta>>>} */
  const deltaQueues = new Set();
  /** @type {Map<string, { product: StarObjectBatchProduct; nodeKeys: Set<string>; current: boolean }>} */
  const productsById = new Map();
  /** @type {Map<string, string>} */
  const productIdByNodeKey = new Map();
  /** @type {Map<string, StarOctreeDemandEntry>} */
  const entriesByNodeKey = new Map();
  /** @type {Set<number>} */
  const activePlans = new Set();
  /** @type {Set<Promise<void>>} */
  const activePrefetches = new Set();

  /** @type {StarOctreeViewPatch} */
  let currentView = {};
  /** @type {StarOctreeViewState | null} */
  let demandAnchorView = null;
  let viewRevision = 0;
  let demandRevision = 0;
  let demandSignature = '';
  let demandNodeCount = 0;
  let productIndex = 0;
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
    const token = latestPlanToken + 1;
    latestPlanToken = token;
    activePlans.add(token);
    status = 'planning';

    Promise.resolve()
      .then(async () => {
        const context = createSelectionContext(planOptions.view, planOptions.viewRevision);
        const plan = await createOptions.source.planDemand(context);

        if (disposed || token !== latestPlanToken) {
          return;
        }

        await applyDemandPlan(plan, {
          context,
          force: planOptions.force,
          reasons: planOptions.reasons,
          viewRevision: planOptions.viewRevision,
          token,
        });
      })
      .catch((error) => {
        if (disposed || token !== latestPlanToken) {
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
      if (disposed || applyOptions.token !== latestPlanToken) {
        return;
      }
      emitRepresentationCurrent(applyOptions.viewRevision);
      return;
    }

    demandRevision += 1;
    demandSignature = nextSignature;
    demandNodeCount = currentEntries.length;
    status = 'streaming';

    const nextEntriesByNodeKey = new Map(
      currentEntries.map((entry) => [entry.node.nodeKey, entry]),
    );
    const productsToRemove = new Map();

    for (const [productId, record] of productsById) {
      const retainedNodeKeys = Array.from(record.nodeKeys)
        .filter((nodeKey) => nextEntriesByNodeKey.has(nodeKey));
      if (retainedNodeKeys.length === record.nodeKeys.size) {
        for (const nodeKey of retainedNodeKeys) {
          entriesByNodeKey.set(
            nodeKey,
            /** @type {StarOctreeDemandEntry} */ (nextEntriesByNodeKey.get(nodeKey)),
          );
        }
        continue;
      }

      productsToRemove.set(productId, record);
    }

    for (const [productId, record] of productsToRemove) {
      record.current = false;
      productsById.delete(productId);
      for (const nodeKey of record.nodeKeys) {
        productIdByNodeKey.delete(nodeKey);
        entriesByNodeKey.delete(nodeKey);
      }
      emitDelta({
        type: 'data/product-stale',
        providerId,
        sessionId,
        productId,
        reason: 'demand-excluded',
      });
      emitDelta({
        type: 'data/product-remove',
        providerId,
        sessionId,
        productId,
        reason: 'demand-excluded',
      });
    }

    const entriesToLoad = currentEntries.filter(
      (entry) => !productIdByNodeKey.has(entry.node.nodeKey),
    );

    if (prefetchEntries.length > 0 && createOptions.source.warmEntries) {
      const prefetch = createOptions.source.warmEntries(prefetchEntries, {
        sessionId,
        emitCachedFirst: options.streaming.emitCachedFirst,
      });
      activePrefetches.add(prefetch);
      prefetch.then(
        () => {
          activePrefetches.delete(prefetch);
        },
        () => {
          // Prefetch is cache-warming work; failures are reported via work
          // snapshots but do not make the visible representation stale.
          activePrefetches.delete(prefetch);
        },
      );
    }

    if (createOptions.source.streamObjectProducts) {
      status = entriesToLoad.length > 0 ? 'loading' : 'current';
      for await (const product of createOptions.source.streamObjectProducts(
        entriesToLoad,
        {
          streamId,
          sessionId,
          attributes: options.attributes,
          coordinates: options.coordinates,
          viewRevision: applyOptions.viewRevision,
          demandRevision,
          memoryOwnership: options.memory.ownership,
          batchMode: 'payload-range',
          emitCachedFirst: options.streaming.emitCachedFirst,
          nextProductIndex() {
            productIndex += 1;
            return productIndex;
          },
        },
      )) {
        if (disposed || applyOptions.token !== latestPlanToken) {
          return;
        }

        storeProduct(product, nextEntriesByNodeKey);

        emitDelta({
          type: 'data/product-upsert',
          streamId,
          providerId,
          sessionId,
          product,
        });
      }
    } else {
      for (const entry of entriesToLoad) {
        const decoded = createOptions.source.decodeNode(entry, applyOptions.context);
        productIndex += 1;
        const product = createStarObjectBatchProduct({
          providerId,
          sessionId,
          streamId,
          productIndex,
          entries: [{ node: entry.node, decoded }],
          attributes: options.attributes,
          coordinates: options.coordinates,
          viewRevision: applyOptions.viewRevision,
          demandRevision,
          memoryOwnership: options.memory.ownership,
        });

        storeProduct(product, nextEntriesByNodeKey);
        emitDelta({
          type: 'data/product-upsert',
          streamId,
          providerId,
          sessionId,
          product,
        });
      }
    }

    if (disposed || applyOptions.token !== latestPlanToken) {
      return;
    }

    status = 'current';
    emitRepresentationCurrent(applyOptions.viewRevision);
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
   * @param {StarObjectBatchProduct} product
   * @param {Map<string, StarOctreeDemandEntry>} nextEntriesByNodeKey
   */
  function storeProduct(product, nextEntriesByNodeKey) {
    const nodeKeys = new Set(product.nodes.map((node) => node.nodeKey));
    productsById.set(product.id, {
      product,
      nodeKeys,
      current: true,
    });

    for (const nodeKey of nodeKeys) {
      productIdByNodeKey.set(nodeKey, product.id);
      const entry = nextEntriesByNodeKey.get(nodeKey);
      if (entry) {
        entriesByNodeKey.set(nodeKey, entry);
      }
    }
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
   * @param {StarOctreeProductDelta} delta
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
  function emitRepresentationCurrent(currentViewRevision) {
    const productIds = Array.from(productsById.values()).map(
      (record) => record.product.id,
    );
    const loadedObjects = Array.from(productsById.values()).reduce(
      (sum, record) => sum + record.product.count,
      0,
    );

    emitDelta({
      type: 'data/representation-current',
      providerId,
      sessionId,
      viewRevision: currentViewRevision,
      demandRevision,
      productIds,
      completeness: {
        phase: 'complete',
        stable: true,
        loadedObjects,
        loadedNodes: demandNodeCount,
        totalNodes: demandNodeCount,
      },
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
      type: 'data/product-error',
      streamId,
      providerId,
      sessionId,
      error: {
        message,
      },
    });
  }

  function createSnapshot() {
    const productSummaries = Array.from(productsById.values()).map(
      (record) => ({
        productId: record.product.id,
        nodeCount: record.product.nodes.length,
        starCount: record.product.count,
        phase: record.product.completeness.phase,
        current: record.current,
        bytes: record.product.memory.bytes,
      }),
    );
    const liveBytes = productSummaries.reduce(
      (sum, product) => sum + product.bytes,
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
        currentProductCount: productsById.size,
        activeWorkItemCount: getActiveWorkItemCount(),
      },
      products: productSummaries,
      memory: {
        liveBytes,
        borrowedBytes: options.memory.ownership === 'borrowed' ? liveBytes : 0,
        evictableBytes: 0,
      },
      lastReasons,
      lastError,
    };
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
}

/**
 * @param {StarOctreeSessionOptions | undefined} options
 * @returns {{
 *   id?: string;
 *   strategy: StarOctreeFetchStrategy;
 *   demandThresholds?: StarOctreeDemandThresholds;
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
    return a.node.nodeKey.localeCompare(b.node.nodeKey);
  });
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
    .map((entry) => `${entry.node.nodeKey}:${entry.role ?? 'current'}`)
    .join('|');
}

/**
 * @param {ReturnType<typeof createAsyncQueue<StarOctreeProductDelta>>} queue
 * @param {() => void} onReturn
 * @returns {AsyncIterable<StarOctreeProductDelta>}
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
