import { createDecodedPayloadCache } from './star-octree-decoded-cache.js';
import {
  createStarCellData,
  createStarCellKey,
} from '@found-in-space/star-products';
import { toDeltaError } from './star-octree-errors.js';
import { decodeStarPayload } from './star-octree-payloads.js';
import { createAsyncQueue } from './star-octree-queue.js';
import { STAR_HAS_PAYLOAD } from './star-octree-format.js';
import {
  normalizeStrategyView,
  planStarOctreeStrategyDemand,
} from './star-octree-strategies.js';
import { traverseOctree } from './star-octree-traversal.js';

/**
 * @typedef {import('@found-in-space/star-products').DecodedStarSegment} DecodedStarSegment
 * @typedef {import('@found-in-space/star-products').StarCellData} StarCellData
 * @typedef {import('./index.js').StarOctreeCellDelta} StarOctreeCellDelta
 * @typedef {import('./index.js').StarOctreeCellStreamOptions} StarOctreeCellStreamOptions
 * @typedef {import('./index.js').StarOctreeCoordinateOutput} StarOctreeCoordinateOutput
 * @typedef {import('./index.js').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.js').StarOctreeDemandInspection} StarOctreeDemandInspection
 * @typedef {import('./index.js').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.js').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('./index.js').StarOctreePayloadDelta} StarOctreePayloadDelta
 * @typedef {import('./index.js').StarOctreePayloadStreamOptions} StarOctreePayloadStreamOptions
 * @typedef {import('./index.js').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.js').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.js').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

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
    streamCells,
    inspectDemand,
    streamCellsForEntries,
    warmEntries,
    fetchCells,
  };

  function getDecodedCacheSnapshot() {
    return decodedCache.getSnapshot();
  }

  /**
   * @param {StarOctreeSelectionContext} context
   * @returns {Promise<StarOctreeDemandPlan>}
   */
  async function planDemandForContext(context) {
    const enrichedContext = withTraversalContext(context);
    return planStarOctreeStrategyDemand({
      indexSource: options.indexSource,
      context: enrichedContext,
    });
  }

  /**
   * @param {StarOctreePayloadStreamOptions | StarOctreeCellStreamOptions} streamOptions
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
   * @param {StarOctreeCellStreamOptions} streamOptions
   * @returns {Promise<StarOctreeDemandInspection>}
   */
  async function inspectDemand(streamOptions = {}) {
    const streamId = streamOptions.id ?? createStreamId('inspect');
    const { context, plan } = await planDemandForStreamOptions(streamOptions);
    const entries = plan.entries;
    const levels = entries.map((entry) => entry.node.level);
    const currentEntries = entries.filter((entry) => (entry.role ?? 'current') === 'current');
    const prefetchEntries = entries.filter((entry) => entry.role === 'prefetch');
    const payloadEntries = entries.filter((entry) => entry.node.payloadLength > 0);

    return {
      providerId: options.providerId,
      streamId,
      strategy: context.strategy,
      view: context.view,
      reasons: plan.reasons ?? [],
      signature: plan.signature,
      metadata: plan.metadata,
      counts: {
        nodeCount: entries.length,
        currentNodeCount: currentEntries.length,
        prefetchNodeCount: prefetchEntries.length,
        payloadNodeCount: payloadEntries.length,
        totalPayloadBytes: payloadEntries.reduce(
          (sum, entry) => sum + entry.node.payloadLength,
          0,
        ),
        minLevel: levels.length ? Math.min(...levels) : null,
        maxLevel: levels.length ? Math.max(...levels) : null,
      },
      nodes: entries.map((entry) => ({
        level: entry.node.level,
        mortonCode: entry.node.mortonCode,
        centerPc: {
          x: entry.node.centerX,
          y: entry.node.centerY,
          z: entry.node.centerZ,
        },
        halfSizePc: entry.node.halfSize,
        payloadBytes: entry.node.payloadLength,
        role: entry.role ?? 'current',
        priority: entry.priority,
        relevance: entry.relevance,
        reasons: entry.reasons,
        metadata: entry.metadata,
      })),
    };
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
          signal: streamOptions.signal,
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
        if (!isAbortError(error)) {
          queue.push({
            type: 'payload/error',
            streamId,
            providerId: options.providerId,
            error: toDeltaError(error),
          });
        }
      } finally {
        queue.close();
      }
    })();

    return queue;
  }

  /**
   * @param {StarOctreeCellStreamOptions} streamOptions
   * @returns {AsyncIterable<StarOctreeCellDelta>}
   */
  function streamCells(streamOptions = {}) {
    const queue = createAsyncQueue();
    /** @type {Set<import('@found-in-space/star-products').StarCellKey>} */
    const cellKeys = new Set();
    let starCount = 0;

    void (async () => {
      try {
        const { context, plan } = await planDemandForStreamOptions(streamOptions);

        for await (const cells of streamCellsForEntries(plan.entries, {
          sessionId: streamOptions.sessionId,
          attributes: streamOptions.attributes,
          coordinates: streamOptions.coordinates,
          memoryOwnership: streamOptions.memory?.ownership,
          batchMode: streamOptions.streaming?.batchMode ?? 'payload-range',
          emitCachedFirst: streamOptions.streaming?.emitCachedFirst,
          signal: streamOptions.signal,
        })) {
          if (cells.length === 0) continue;
          for (const cell of cells) {
            cellKeys.add(cell.cellKey);
            starCount += cell.count;
          }
          queue.push({
            type: 'stars/cells-upsert',
            providerId: options.providerId,
            sessionId: streamOptions.sessionId,
            viewRevision: context.viewRevision,
            demandRevision: streamOptions.demandRevision,
            cells,
          });
        }

        queue.push({
          type: 'stars/current',
          providerId: options.providerId,
          sessionId: streamOptions.sessionId,
          viewRevision: context.viewRevision,
          demandRevision: streamOptions.demandRevision,
          cellKeys: Array.from(cellKeys).sort(),
          starCount,
        });
      } catch (error) {
        if (!isAbortError(error)) {
          queue.push({
            type: 'stars/error',
            providerId: options.providerId,
            sessionId: streamOptions.sessionId,
            demandRevision: streamOptions.demandRevision,
            error: toDeltaError(error),
          });
        }
      } finally {
        queue.close();
      }
    })();

    return queue;
  }

  /**
   * @param {StarOctreeDemandEntry[]} entries
   * @param {{
   *   sessionId?: string;
   *   attributes?: string[];
   *   coordinates?: StarOctreeCoordinateOutput;
   *   memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
   *   batchMode?: 'payload-range' | 'node';
   *   emitCachedFirst?: boolean;
   *   signal?: AbortSignal;
   * }} cellOptions
   * @returns {AsyncIterable<StarCellData[]>}
   */
  function streamCellsForEntries(entries, cellOptions) {
    const queue = createAsyncQueue();
    const currentEntries = entries.filter((entry) => (entry.role ?? 'current') === 'current');
    const nodes = currentEntries.map((entry) => entry.node);
    const work = options.workTracker?.start({
      sessionId: cellOptions.sessionId,
      status: 'fetching',
      nodeCount: nodes.length,
    });

    void (async () => {
      try {
        throwIfAborted(cellOptions.signal);
        await options.indexSource.fetchNodePayloadBatchProgressive(nodes, {
          emitCachedFirst: cellOptions.emitCachedFirst,
          signal: cellOptions.signal,
          async onBatch(payloadEntries) {
            throwIfAborted(cellOptions.signal);
            work?.update({
              status: 'decoding',
              bytesLoaded: payloadEntries.reduce(
                (sum, entry) => sum + entry.buffer.byteLength,
                0,
              ),
            });
            const cellEntries = await Promise.all(
              payloadEntries.map(async (entry) => ({
                node: entry.node,
                decoded: await decodePayloadEntry(entry.node, entry.buffer, {
                  signal: cellOptions.signal,
                }),
              })),
            );
            throwIfAborted(cellOptions.signal);

            if (cellOptions.batchMode === 'node') {
              for (const cellEntry of cellEntries) {
                queue.push([createCell(cellEntry, cellOptions)]);
              }
              work?.update({ status: 'streaming' });
              return;
            }

            if (cellEntries.length > 0) {
              queue.push(cellEntries.map((entry) => createCell(entry, cellOptions)));
              work?.update({ status: 'streaming' });
            }
          },
        });
      } catch (error) {
        if (isAbortError(error)) {
          work?.finish();
          queue.close();
          return;
        }
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
   * Warm payload and decoded caches for entries without emitting cells.
   *
   * @param {StarOctreeDemandEntry[]} entries
   * @param {{ sessionId?: string; emitCachedFirst?: boolean; signal?: AbortSignal }} [warmOptions]
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
      throwIfAborted(warmOptions.signal);
      await options.indexSource.fetchNodePayloadBatchProgressive(nodes, {
        emitCachedFirst: warmOptions.emitCachedFirst,
        signal: warmOptions.signal,
        async onBatch(payloadEntries) {
          throwIfAborted(warmOptions.signal);
          work?.update({ status: 'decoding' });
          await Promise.all(
            payloadEntries.map((entry) =>
              decodePayloadEntry(entry.node, entry.buffer, {
                signal: warmOptions.signal,
              }),
            ),
          );
        },
      });
      work?.finish();
    } catch (error) {
      if (isAbortError(error)) {
        work?.finish();
        return;
      }
      work?.fail();
      throw error;
    }
  }

  /**
   * @param {StarOctreeCellStreamOptions} streamOptions
   * @returns {Promise<StarCellData[]>}
   */
  async function fetchCells(streamOptions = {}) {
    const { plan } = await planDemandForStreamOptions(streamOptions);
    const payloadEntries = await options.indexSource.fetchNodePayloadBatchProgressive(
      plan.entries
        .filter((entry) => (entry.role ?? 'current') === 'current')
        .map((entry) => entry.node),
      { signal: streamOptions.signal },
    );
    const cellEntries = await Promise.all(
      payloadEntries.map(async (entry) => ({
        node: entry.node,
        decoded: await decodePayloadEntry(entry.node, entry.buffer, {
          signal: streamOptions.signal,
        }),
      })),
    );

    return cellEntries.map((entry) => createCell(entry, {
      attributes: streamOptions.attributes,
      coordinates: streamOptions.coordinates,
      memoryOwnership: streamOptions.memory?.ownership,
    }));
  }

  /**
   * @param {StarOctreeRuntimeNode} node
   * @param {ArrayBuffer} buffer
   * @param {{ signal?: AbortSignal }} [decodeOptions]
   */
  async function decodePayloadEntry(node, buffer, decodeOptions = {}) {
    throwIfAborted(decodeOptions.signal);
    const datasetId = options.indexSource.getSnapshot().datasetId;
    const cacheKey = decodedCache.createKey(node, datasetId);
    const cached = await decodedCache.get(cacheKey, node, datasetId);
    throwIfAborted(decodeOptions.signal);
    if (cached) {
      return cached;
    }

    const decoded = decodeStarPayload(buffer, node, { datasetId });
    decodedCache.set(cacheKey, decoded);
    return decoded;
  }

  /**
   * @param {{ node: StarOctreeRuntimeNode; decoded: DecodedStarSegment }} entry
   * @param {{
   *   attributes?: string[];
   *   coordinates?: StarOctreeCoordinateOutput;
   *   memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
   * }} cellOptions
   */
  function createCell(entry, cellOptions) {
    return createStarCellData({
      node: entry.node,
      decoded: entry.decoded,
      attributes: cellOptions.attributes,
      coordinates: cellOptions.coordinates,
      memoryOwnership: cellOptions.memoryOwnership,
    });
  }

  /**
   * @param {StarOctreeSelectionContext} context
   * @returns {StarOctreeSelectionContext}
   */
  function withTraversalContext(context) {
    return {
      ...context,
      traversal: createTraversalApi(context),
    };
  }

  /**
   * @param {StarOctreeSelectionContext} context
   */
  function createTraversalApi(context) {
    const api = {
      /**
       * @param {{
       *   distanceToNode?: (node: StarOctreeRuntimeNode) => number;
       *   visit: (
       *     node: StarOctreeRuntimeNode,
       *     helpers: {
       *       context: StarOctreeSelectionContext;
       *       bootstrap: import('./index.js').StarOctreeBootstrapIndex;
       *     }
       *   ) => Promise<import('./index.js').StarOctreeTraversalDecision> | import('./index.js').StarOctreeTraversalDecision;
       * }} selectionOptions
       */
      async select(selectionOptions) {
        const bootstrap = await options.indexSource.ensureBootstrapLoaded();
        /** @type {StarOctreeDemandEntry[]} */
        const entries = [];
        const traversalContext = /** @type {StarOctreeSelectionContext} */ ({
          ...context,
          traversal: api,
        });
        const traversal = await traverseOctree({
          indexSource: options.indexSource,
          bootstrap,
          distanceToNode: selectionOptions.distanceToNode,
          async visitor(node) {
            const decision = await selectionOptions.visit(node, {
              context: traversalContext,
              bootstrap,
            });
            const include = decision.include === true;
            const emit = decision.emit !== false;
            const descend = decision.descend !== false;

            if (
              include &&
              emit &&
              (node.flags & STAR_HAS_PAYLOAD) &&
              node.payloadLength > 0
            ) {
              entries.push({
                node,
                priority: decision.priority,
                relevance: decision.relevance,
                role: decision.role ?? 'current',
                reasons: decision.reasons,
                metadata: decision.metadata,
              });
            }

            return {
              include,
              emit,
              descend: include && descend,
              distancePc: decision.distancePc,
            };
          },
        });

        return {
          entries,
          stats: traversal.stats,
        };
      },
    };

    return api;
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
 * @param {StarOctreePayloadStreamOptions | StarOctreeCellStreamOptions} options
 * @param {{
 *   sessionId?: string;
 *   viewRevision?: number;
 *   demandRevision?: number;
 * }} extras
 * @returns {StarOctreeSelectionContext}
 */
function createSelectionContext(providerId, options, extras = {}) {
  const cellOptions = /** @type {Partial<StarOctreeCellStreamOptions>} */ (options);
  const strategy = options.strategy ?? DEFAULT_STRATEGY;
  const view = normalizeContextView(strategy, options.view);
  const viewRevision = extras.viewRevision ?? cellOptions.viewRevision ?? 0;

  return {
    providerId,
    ...(extras.sessionId ? { sessionId: extras.sessionId } : {}),
    strategy,
    view: {
      revision: viewRevision,
      ...view,
    },
    viewRevision,
    demandRevision: extras.demandRevision ?? cellOptions.demandRevision ?? 0,
    attributes: cellOptions.attributes ?? DEFAULT_ATTRIBUTES,
    coordinates: {
      ...DEFAULT_COORDINATES,
      ...(cellOptions.coordinates ?? {}),
    },
    streaming: {
      progressive: options.streaming?.progressive ?? true,
      emitCachedFirst: options.streaming?.emitCachedFirst ?? true,
      ...(options.streaming?.coarseFirst !== undefined
        ? { coarseFirst: options.streaming.coarseFirst }
        : {}),
    },
    traversal: createUnavailableTraversal(),
  };
}

function createUnavailableTraversal() {
  return {
    async select() {
      throw new Error('Star octree traversal context is not initialized.');
    },
  };
}

/**
 * @param {StarOctreeFetchStrategy} strategy
 * @param {StarOctreeViewPatch | undefined} view
 */
function normalizeContextView(strategy, view) {
  return normalizeStrategyView(strategy, view);
}

/**
 * @param {AbortSignal | undefined} signal
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  const error = new Error('Star cell stream was aborted.');
  error.name = 'AbortError';
  throw error;
}

/**
 * @param {unknown} error
 */
function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}
