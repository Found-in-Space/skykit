import { createStarObjectBatchProduct } from './star-octree-products.js';
import { createAsyncQueue } from './star-octree-queue.js';

/**
 * @typedef {import('./index.d.ts').StarObjectBatchProduct} StarObjectBatchProduct
 * @typedef {import('./index.d.ts').StarOctreeCoordinateOutput} StarOctreeCoordinateOutput
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('./index.d.ts').StarOctreeProductDelta} StarOctreeProductDelta
 * @typedef {import('./index.d.ts').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeSessionOptions} StarOctreeSessionOptions
 * @typedef {import('./index.d.ts').StarOctreeSessionSnapshot} StarOctreeSessionSnapshot
 * @typedef {import('./index.d.ts').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {import('./index.d.ts').StarOctreeViewReceipt} StarOctreeViewReceipt
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
 *       nextProductIndex: () => number;
 *     }
 *   ) => AsyncIterable<StarObjectBatchProduct>;
 * }} SessionSource
 */

/**
 * @typedef {{
 *   providerId: string;
 *   sessionId: string;
 *   options?: StarOctreeSessionOptions;
 *   source: SessionSource;
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
  /** @type {Map<string, { entry: StarOctreeDemandEntry; product: StarObjectBatchProduct; current: boolean }>} */
  const productsByNodeKey = new Map();
  /** @type {Set<number>} */
  const activePlans = new Set();

  /** @type {StarOctreeViewPatch} */
  let currentView = {};
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

      if (updateOptions.demand === 'suppress') {
        lastReasons = [];
        return createReceipt('suppressed', []);
      }

      const reasons = [
        updateOptions.reason ??
          (viewRevision === 1 ? 'initial' : 'demand-changed'),
      ];
      lastReasons = reasons;
      scheduleDemandPlanning({
        force: updateOptions.demand === 'force',
        reasons,
        view: currentView,
        viewRevision,
      });

      return createReceipt(
        updateOptions.demand === 'force' ? 'forced' : 'queued',
        reasons,
      );
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
    const entries = normalizeDemandEntries(plan.entries);
    const nextSignature = plan.signature ?? createDemandSignature(entries);
    const demandChanged = applyOptions.force || nextSignature !== demandSignature;
    lastReasons = plan.reasons?.length ? plan.reasons : applyOptions.reasons;

    if (!demandChanged) {
      demandNodeCount = entries.length;
      status = 'current';
      if (disposed || applyOptions.token !== latestPlanToken) {
        return;
      }
      emitRepresentationCurrent(applyOptions.viewRevision);
      return;
    }

    demandRevision += 1;
    demandSignature = nextSignature;
    demandNodeCount = entries.length;
    status = 'streaming';

    const nextEntriesByNodeKey = new Map(
      entries.map((entry) => [entry.node.nodeKey, entry]),
    );

    for (const [nodeKey, record] of productsByNodeKey) {
      if (nextEntriesByNodeKey.has(nodeKey)) {
        record.entry = /** @type {StarOctreeDemandEntry} */ (
          nextEntriesByNodeKey.get(nodeKey)
        );
        continue;
      }

      record.current = false;
      productsByNodeKey.delete(nodeKey);
      emitDelta({
        type: 'data/product-stale',
        providerId,
        sessionId,
        productId: record.product.id,
        reason: 'demand-excluded',
      });
      emitDelta({
        type: 'data/product-remove',
        providerId,
        sessionId,
        productId: record.product.id,
        reason: 'demand-excluded',
      });
    }

    const entriesToLoad = entries.filter(
      (entry) => !productsByNodeKey.has(entry.node.nodeKey),
    );

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
          batchMode: 'node',
          nextProductIndex() {
            productIndex += 1;
            return productIndex;
          },
        },
      )) {
        if (disposed || applyOptions.token !== latestPlanToken) {
          return;
        }

        for (const productNode of product.nodes) {
          const entry = nextEntriesByNodeKey.get(productNode.nodeKey);
          if (!entry) continue;
          productsByNodeKey.set(productNode.nodeKey, {
            entry,
            product,
            current: true,
          });
        }

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

        productsByNodeKey.set(entry.node.nodeKey, {
          entry,
          product,
          current: true,
        });
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
   * @param {StarOctreeViewPatch} view
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
        ...(view.observerPc ? { observerPc: view.observerPc } : {}),
        ...(view.limitingMagnitude !== undefined
          ? { limitingMagnitude: view.limitingMagnitude }
          : {}),
        ...(view.targetPc ? { targetPc: view.targetPc } : {}),
      },
      viewRevision: nextViewRevision,
      demandRevision,
      attributes: options.attributes,
      coordinates: options.coordinates,
    };
  }

  /**
   * @param {'queued' | 'forced' | 'suppressed'} demand
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
    const productIds = Array.from(productsByNodeKey.values()).map(
      (record) => record.product.id,
    );
    const loadedObjects = Array.from(productsByNodeKey.values()).reduce(
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
    const productSummaries = Array.from(productsByNodeKey.values()).map(
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
        ...(currentView.observerPc ? { observerPc: currentView.observerPc } : {}),
        ...(currentView.limitingMagnitude !== undefined
          ? { limitingMagnitude: currentView.limitingMagnitude }
          : {}),
        ...(currentView.targetPc ? { targetPc: currentView.targetPc } : {}),
      },
      demand: {
        revision: demandRevision,
        status,
        demandNodeCount,
        currentProductCount: productsByNodeKey.size,
        activeWorkItemCount: activePlans.size,
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
}

/**
 * @param {StarOctreeSessionOptions | undefined} options
 * @returns {{
 *   id?: string;
 *   strategy: StarOctreeFetchStrategy;
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
 * @param {StarOctreeDemandEntry[]} entries
 * @returns {StarOctreeDemandEntry[]}
 */
function normalizeDemandEntries(entries) {
  return [...entries].sort((a, b) => {
    const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return a.node.nodeKey.localeCompare(b.node.nodeKey);
  });
}

/**
 * @param {StarOctreeDemandEntry[]} entries
 * @returns {string}
 */
function createDemandSignature(entries) {
  return entries.map((entry) => entry.node.nodeKey).join('|');
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
