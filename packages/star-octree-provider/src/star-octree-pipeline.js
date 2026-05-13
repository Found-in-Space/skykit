import { planObserverShellDemand, normalizeObserverShellView } from './star-octree-observer-shell.js';
import { createDecodedPayloadCache } from './star-octree-decoded-cache.js';
import {
  ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY,
  createStarOctreeError,
  toDeltaError,
} from './star-octree-errors.js';
import { decodeStarPayload } from './star-octree-payloads.js';
import { createStarObjectBatchProduct } from './star-octree-products.js';
import { createAsyncQueue } from './star-octree-queue.js';
import {
  normalizeTargetFrustumView,
  planTargetFrustumDemand,
} from './star-octree-target-frustum.js';

/**
 * @typedef {import('./index.js').StarObjectBatchProduct} StarObjectBatchProduct
 * @typedef {import('./index.js').StarOctreeCoordinateOutput} StarOctreeCoordinateOutput
 * @typedef {import('./index.js').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.js').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.js').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('./index.js').StarOctreeObjectBatchStreamOptions} StarOctreeObjectBatchStreamOptions
 * @typedef {import('./index.js').StarOctreePayloadDelta} StarOctreePayloadDelta
 * @typedef {import('./index.js').StarOctreePayloadStreamOptions} StarOctreePayloadStreamOptions
 * @typedef {import('./index.js').StarOctreeProductDelta} StarOctreeProductDelta
 * @typedef {import('./index.js').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.js').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.js').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

export { ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY };

const DEFAULT_STRATEGY = /** @type {const} */ ({ kind: 'observer-shell' });
const DEFAULT_ATTRIBUTES = ['position', 'teffLog8', 'magAbs'];
const DEFAULT_COORDINATES = {
  name: 'position',
  frame: 'icrs',
  units: /** @type {[string, string, string]} */ (['pc', 'pc', 'pc']),
};

/**
 * @param {{
 *   providerId: string;
 *   indexSource: StarOctreeIndexSource;
 *   persistentCache?: 'on' | 'off';
 *   memoryBudgetBytes?: number;
 *   workTracker?: ReturnType<typeof import('./star-octree-work-tracker.js').createStarOctreeWorkTracker>;
 * }} options
 */
export function createStarOctreePipeline(options) {
  let nextStreamId = 1;
  const decodedCache = createDecodedPayloadCache({
    sourceIdentity: options.indexSource.sourceIdentity,
    persistentCache: options.persistentCache,
    memoryBudgetBytes: options.memoryBudgetBytes,
  });

  return {
    getDecodedCacheSnapshot,
    planDemandForContext,
    planDemandForStreamOptions,
    streamPayloads,
    streamObjectBatches,
    streamProductsForEntries,
    warmEntries,
    fetchObjectBatch,
  };

  function getDecodedCacheSnapshot() {
    return decodedCache.getSnapshot();
  }

  /**
   * @param {StarOctreeSelectionContext} context
   * @returns {Promise<StarOctreeDemandPlan>}
   */
  async function planDemandForContext(context) {
    if (context.strategy.kind === 'observer-shell') {
      return planObserverShellDemand({
        indexSource: options.indexSource,
        context,
      });
    }

    if (context.strategy.kind === 'target-frustum') {
      return planTargetFrustumDemand({
        indexSource: options.indexSource,
        context,
      });
    }

    if (context.strategy.kind === 'custom') {
      return context.strategy.selectDemand(context);
    }

    throw createUnsupportedStrategyError('unknown');
  }

  /**
   * @param {StarOctreePayloadStreamOptions | StarOctreeObjectBatchStreamOptions} streamOptions
   * @param {{
   *   sessionId?: string;
   *   viewRevision?: number;
   *   demandRevision?: number;
   * }} extras
   */
  async function planDemandForStreamOptions(streamOptions, extras = {}) {
    const context = createSelectionContext(options.providerId, streamOptions, extras);
    const plan = await planDemandForContext(context);
    return { context, plan };
  }

  /**
   * @param {StarOctreePayloadStreamOptions} streamOptions
   * @returns {AsyncIterable<StarOctreePayloadDelta>}
   */
  function streamPayloads(streamOptions = {}) {
    const streamId = streamOptions.id ?? createStreamId('payload');
    const queue = createAsyncQueue();
    let loadedNodes = 0;
    let loadedBytes = 0;
    let totalNodes = 0;

    void (async () => {
      try {
        const { plan } = await planDemandForStreamOptions(streamOptions);
        const nodes = plan.entries.map((entry) => entry.node);
        totalNodes = nodes.length;
        const work = options.workTracker?.start({
          status: 'fetching',
          nodeCount: totalNodes,
        });

        await options.indexSource.fetchNodePayloadBatchProgressive(nodes, {
          emitCachedFirst: streamOptions.streaming?.emitCachedFirst,
          onBatch(entries) {
            loadedNodes += entries.length;
            loadedBytes += entries.reduce(
              (sum, entry) => sum + entry.buffer.byteLength,
              0,
            );
            queue.push({
              type: 'payload/batch',
              streamId,
              providerId: options.providerId,
              entries,
              completeness: {
                phase: loadedNodes >= totalNodes ? 'complete' : 'partial',
              },
            });
            queue.push({
              type: 'payload/progress',
              streamId,
              providerId: options.providerId,
              loadedNodes,
              totalNodes,
              loadedBytes,
            });
            work?.update({
              status: loadedNodes >= totalNodes ? 'streaming' : 'fetching',
              bytesLoaded: loadedBytes,
            });
          },
        });

        work?.finish();
        queue.push({
          type: 'payload/complete',
          streamId,
          providerId: options.providerId,
        });
      } catch (error) {
        // The queue is the public error channel for bounded streams.
        queue.push({
          type: 'payload/error',
          streamId,
          providerId: options.providerId,
          error: toDeltaError(error),
        });
      } finally {
        queue.close();
      }
    })();

    return queue;
  }

  /**
   * @param {StarOctreeObjectBatchStreamOptions} streamOptions
   * @returns {AsyncIterable<StarOctreeProductDelta>}
   */
  function streamObjectBatches(streamOptions = {}) {
    const streamId = streamOptions.id ?? createStreamId('objects');
    const queue = createAsyncQueue();
    const productIds = [];
    let loadedObjects = 0;
    let loadedNodes = 0;
    let productIndex = 0;

    void (async () => {
      try {
        const { context, plan } = await planDemandForStreamOptions(streamOptions);

        for await (const product of streamProductsForEntries(plan.entries, {
          streamId,
          attributes: streamOptions.attributes,
          coordinates: streamOptions.coordinates,
          viewRevision: streamOptions.viewRevision,
          demandRevision: streamOptions.demandRevision,
          memoryOwnership: streamOptions.memory?.ownership,
          batchMode: streamOptions.streaming?.batchMode ?? 'payload-range',
          nextProductIndex() {
            productIndex += 1;
            return productIndex;
          },
        })) {
          productIds.push(product.id);
          loadedObjects += product.count;
          loadedNodes += product.nodes.length;
          queue.push({
            type: 'data/product-upsert',
            streamId,
            providerId: options.providerId,
            product,
          });
        }

        queue.push({
          type: 'data/representation-current',
          providerId: options.providerId,
          viewRevision: context.viewRevision,
          demandRevision: streamOptions.demandRevision,
          productIds,
          completeness: {
            phase: 'complete',
            stable: true,
            loadedObjects,
            loadedNodes,
            totalNodes: plan.entries.length,
          },
        });
      } catch (error) {
        queue.push({
          type: 'data/product-error',
          streamId,
          providerId: options.providerId,
          error: toDeltaError(error),
        });
      } finally {
        queue.close();
      }
    })();

    return queue;
  }

  /**
   * @param {StarOctreeDemandEntry[]} entries
   * @param {{
   *   streamId: string;
   *   sessionId?: string;
   *   attributes?: string[];
   *   coordinates?: StarOctreeCoordinateOutput;
   *   viewRevision?: number;
   *   demandRevision?: number;
   *   memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
   *   batchMode?: 'payload-range' | 'node';
   *   nextProductIndex: () => number;
   * }} productOptions
   * @returns {AsyncIterable<StarObjectBatchProduct>}
   */
  function streamProductsForEntries(entries, productOptions) {
    const queue = createAsyncQueue();
    const currentEntries = entries.filter((entry) => (entry.role ?? 'current') === 'current');
    const nodes = currentEntries.map((entry) => entry.node);
    const work = options.workTracker?.start({
      sessionId: productOptions.sessionId,
      status: 'fetching',
      nodeCount: nodes.length,
    });

    void (async () => {
      try {
        await options.indexSource.fetchNodePayloadBatchProgressive(nodes, {
          emitCachedFirst: true,
          async onBatch(payloadEntries) {
            work?.update({
              status: 'decoding',
              bytesLoaded: payloadEntries.reduce(
                (sum, entry) => sum + entry.buffer.byteLength,
                0,
              ),
            });
            const productEntries = await Promise.all(
              payloadEntries.map(async (entry) => ({
                node: entry.node,
                decoded: await decodePayloadEntry(entry.node, entry.buffer),
              })),
            );

            if (productOptions.batchMode === 'node') {
              for (const productEntry of productEntries) {
                queue.push(createProduct([productEntry], productOptions));
              }
              work?.update({ status: 'streaming' });
              return;
            }

            if (productEntries.length > 0) {
              queue.push(createProduct(productEntries, productOptions));
              work?.update({ status: 'streaming' });
            }
          },
        });
      } catch (error) {
        work?.fail();
        queue.fail(error);
        return;
      }

      work?.finish();
      queue.close();
    })();

    return queue;
  }

  /**
   * Warm payload and decoded caches for entries without emitting products.
   *
   * @param {StarOctreeDemandEntry[]} entries
   * @param {{ sessionId?: string }} [warmOptions]
   */
  async function warmEntries(entries, warmOptions = {}) {
    const nodes = entries
      .filter((entry) => entry.node.payloadLength > 0)
      .map((entry) => entry.node);
    if (nodes.length === 0) {
      return;
    }

    const work = options.workTracker?.start({
      sessionId: warmOptions.sessionId,
      status: 'fetching',
      nodeCount: nodes.length,
    });

    try {
      await options.indexSource.fetchNodePayloadBatchProgressive(nodes, {
        emitCachedFirst: true,
        async onBatch(payloadEntries) {
          work?.update({ status: 'decoding' });
          await Promise.all(
            payloadEntries.map((entry) =>
              decodePayloadEntry(entry.node, entry.buffer),
            ),
          );
        },
      });
      work?.finish();
    } catch (error) {
      work?.fail();
      throw error;
    }
  }

  /**
   * @param {StarOctreeObjectBatchStreamOptions} streamOptions
   * @returns {Promise<StarObjectBatchProduct>}
   */
  async function fetchObjectBatch(streamOptions = {}) {
    const streamId = streamOptions.id ?? createStreamId('fetch');
    const { plan } = await planDemandForStreamOptions(streamOptions);
    const payloadEntries = await options.indexSource.fetchNodePayloadBatchProgressive(
      plan.entries
        .filter((entry) => (entry.role ?? 'current') === 'current')
        .map((entry) => entry.node),
    );
    const productEntries = await Promise.all(
      payloadEntries.map(async (entry) => ({
        node: entry.node,
        decoded: await decodePayloadEntry(entry.node, entry.buffer),
      })),
    );

    return createStarObjectBatchProduct({
      providerId: options.providerId,
      streamId,
      productIndex: 1,
      entries: productEntries,
      attributes: streamOptions.attributes,
      coordinates: streamOptions.coordinates,
      viewRevision: streamOptions.viewRevision,
      demandRevision: streamOptions.demandRevision,
      memoryOwnership: streamOptions.memory?.ownership,
      completenessPhase: 'complete',
    });
  }

  /**
   * @param {StarOctreeRuntimeNode} node
   * @param {ArrayBuffer} buffer
   */
  async function decodePayloadEntry(node, buffer) {
    const datasetId = options.indexSource.getSnapshot().datasetId;
    const cacheKey = decodedCache.createKey(node, datasetId);
    const cached = await decodedCache.get(cacheKey, node);
    if (cached) {
      return cached;
    }

    const decoded = decodeStarPayload(buffer, node, { datasetId });
    decodedCache.set(cacheKey, decoded);
    return decoded;
  }

  /**
   * @param {Array<{ node: StarOctreeRuntimeNode; decoded: import('./star-octree-products.js').DecodedStarSegment }>} entries
   * @param {{
   *   streamId: string;
   *   sessionId?: string;
   *   attributes?: string[];
   *   coordinates?: StarOctreeCoordinateOutput;
   *   viewRevision?: number;
   *   demandRevision?: number;
   *   memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
   *   nextProductIndex: () => number;
   * }} productOptions
   */
  function createProduct(entries, productOptions) {
    return createStarObjectBatchProduct({
      providerId: options.providerId,
      sessionId: productOptions.sessionId,
      streamId: productOptions.streamId,
      productIndex: productOptions.nextProductIndex(),
      entries,
      attributes: productOptions.attributes,
      coordinates: productOptions.coordinates,
      viewRevision: productOptions.viewRevision,
      demandRevision: productOptions.demandRevision,
      memoryOwnership: productOptions.memoryOwnership,
    });
  }

  /**
   * @param {string} prefix
   */
  function createStreamId(prefix) {
    const id = `${options.providerId}:${prefix}:${nextStreamId}`;
    nextStreamId += 1;
    return id;
  }
}

/**
 * @param {string} providerId
 * @param {StarOctreePayloadStreamOptions | StarOctreeObjectBatchStreamOptions} options
 * @param {{
 *   sessionId?: string;
 *   viewRevision?: number;
 *   demandRevision?: number;
 * }} extras
 * @returns {StarOctreeSelectionContext}
 */
function createSelectionContext(providerId, options, extras = {}) {
  const objectOptions = /** @type {Partial<StarOctreeObjectBatchStreamOptions>} */ (options);
  const strategy = options.strategy ?? DEFAULT_STRATEGY;
  const view = normalizeContextView(strategy, options.view);
  const viewRevision = extras.viewRevision ?? objectOptions.viewRevision ?? 0;

  return {
    providerId,
    ...(extras.sessionId ? { sessionId: extras.sessionId } : {}),
    strategy,
    view: {
      revision: viewRevision,
      ...view,
    },
    viewRevision,
    demandRevision: extras.demandRevision ?? objectOptions.demandRevision ?? 0,
    attributes: objectOptions.attributes ?? DEFAULT_ATTRIBUTES,
    coordinates: {
      ...DEFAULT_COORDINATES,
      ...(objectOptions.coordinates ?? {}),
    },
  };
}

/**
 * @param {string} kind
 * @returns {Error & { code: string }}
 */
function createUnsupportedStrategyError(kind) {
  return createStarOctreeError(
    ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY,
    `Star octree strategy "${kind}" is not supported yet.`,
  );
}

/**
 * @param {StarOctreeFetchStrategy} strategy
 * @param {StarOctreeViewPatch | undefined} view
 */
function normalizeContextView(strategy, view) {
  if (strategy.kind === 'observer-shell') {
    return normalizeObserverShellView(view);
  }

  if (strategy.kind === 'target-frustum') {
    return normalizeTargetFrustumView(view, strategy);
  }

  return view ?? {};
}
