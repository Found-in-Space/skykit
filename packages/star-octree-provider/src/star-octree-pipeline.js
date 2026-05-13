import { planObserverShellDemand, normalizeObserverShellView } from './star-octree-observer-shell.js';
import { decodeStarPayload } from './star-octree-payloads.js';
import { createStarObjectBatchProduct } from './star-octree-products.js';
import { createAsyncQueue } from './star-octree-queue.js';

/**
 * @typedef {import('./index.d.ts').StarObjectBatchProduct} StarObjectBatchProduct
 * @typedef {import('./index.d.ts').StarOctreeCoordinateOutput} StarOctreeCoordinateOutput
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('./index.d.ts').StarOctreeObjectBatchStreamOptions} StarOctreeObjectBatchStreamOptions
 * @typedef {import('./index.d.ts').StarOctreePayloadDelta} StarOctreePayloadDelta
 * @typedef {import('./index.d.ts').StarOctreePayloadStreamOptions} StarOctreePayloadStreamOptions
 * @typedef {import('./index.d.ts').StarOctreeProductDelta} StarOctreeProductDelta
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

export const ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY =
  'ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY';

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
 * }} options
 */
export function createStarOctreePipeline(options) {
  let nextStreamId = 1;

  return {
    planDemandForContext,
    planDemandForStreamOptions,
    streamPayloads,
    streamObjectBatches,
    streamProductsForEntries,
    fetchObjectBatch,
  };

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

    if (context.strategy.kind === 'custom') {
      return context.strategy.selectDemand(context);
    }

    throw createUnsupportedStrategyError(context.strategy.kind);
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
          },
        });

        queue.push({
          type: 'payload/complete',
          streamId,
          providerId: options.providerId,
        });
      } catch (error) {
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
    const nodes = entries.map((entry) => entry.node);

    void (async () => {
      try {
        await options.indexSource.fetchNodePayloadBatchProgressive(nodes, {
          onBatch(payloadEntries) {
            const productEntries = payloadEntries.map((entry) => ({
              node: entry.node,
              decoded: decodePayloadEntry(entry.node, entry.buffer),
            }));

            if (productOptions.batchMode === 'node') {
              for (const productEntry of productEntries) {
                queue.push(createProduct([productEntry], productOptions));
              }
              return;
            }

            if (productEntries.length > 0) {
              queue.push(createProduct(productEntries, productOptions));
            }
          },
        });
      } catch (error) {
        queue.fail(error);
        return;
      }

      queue.close();
    })();

    return queue;
  }

  /**
   * @param {StarOctreeObjectBatchStreamOptions} streamOptions
   * @returns {Promise<StarObjectBatchProduct>}
   */
  async function fetchObjectBatch(streamOptions = {}) {
    const streamId = streamOptions.id ?? createStreamId('fetch');
    const { plan } = await planDemandForStreamOptions(streamOptions);
    const payloadEntries = await options.indexSource.fetchNodePayloadBatchProgressive(
      plan.entries.map((entry) => entry.node),
    );
    const productEntries = payloadEntries.map((entry) => ({
      node: entry.node,
      decoded: decodePayloadEntry(entry.node, entry.buffer),
    }));

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
  function decodePayloadEntry(node, buffer) {
    return decodeStarPayload(buffer, node, {
      datasetId: options.indexSource.getSnapshot().datasetId,
    });
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
  const view = strategy.kind === 'observer-shell'
    ? normalizeObserverShellView(options.view)
    : options.view ?? {};
  const viewRevision = extras.viewRevision ?? objectOptions.viewRevision ?? 0;

  return {
    providerId,
    ...(extras.sessionId ? { sessionId: extras.sessionId } : {}),
    strategy,
    view: {
      revision: viewRevision,
      ...(view.observerPc ? { observerPc: view.observerPc } : {}),
      ...(view.limitingMagnitude !== undefined
        ? { limitingMagnitude: view.limitingMagnitude }
        : {}),
      ...(view.targetPc ? { targetPc: view.targetPc } : {}),
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
  const error = new Error(`Star octree strategy "${kind}" is not supported yet.`);
  return Object.assign(error, {
    code: ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY,
  });
}

/**
 * @param {unknown} error
 */
function toDeltaError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(error && typeof error === 'object' && 'code' in error
      ? { code: String(/** @type {{ code: unknown }} */ (error).code) }
      : {}),
  };
}
