import { supportsTransferableBuffers } from '@found-in-space/star-trees';
import { createBlobRangeSource } from './star-octree-blob-source.js';
import { createStarOctreeIndexSource } from './star-octree-index-source.js';
import { createStarOctreePipeline } from './star-octree-pipeline.js';
import { createStarOctreeProviderSession } from './star-octree-provider-session.js';
import { createStarOctreeScheduler } from './star-octree-scheduler.js';
import { createStarOctreeWorkTracker } from './star-octree-work-tracker.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeCellStreamOptions} StarOctreeCellStreamOptions
 * @typedef {import('./index.d.ts').StarOctreePayloadStreamOptions} StarOctreePayloadStreamOptions
 * @typedef {import('./index.d.ts').StarOctreeCellDelta} StarOctreeCellDelta
 * @typedef {import('./index.d.ts').StarOctreeProviderDescriptor} StarOctreeProviderDescriptor
 * @typedef {import('./index.d.ts').StarOctreeProviderService} StarOctreeProviderService
 * @typedef {import('./index.d.ts').StarOctreeProviderServiceOptions} StarOctreeProviderServiceOptions
 * @typedef {import('./index.d.ts').StarOctreeProviderSnapshot} StarOctreeProviderSnapshot
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeSessionOptions} StarOctreeSessionOptions
 * @typedef {import('@found-in-space/star-trees').DecodedStarSegment} DecodedStarSegment
 */

let nextProviderId = 1;
let nextSessionId = 1;

/**
 * @typedef {{
 *   planDemand?: (context: StarOctreeSelectionContext) => Promise<StarOctreeDemandPlan> | StarOctreeDemandPlan;
 *   decodeNode?: (entry: StarOctreeDemandEntry, context: StarOctreeSelectionContext) => DecodedStarSegment;
 *   useRealPipeline?: boolean;
 * }} StarOctreeProviderTestInternals
 */

/**
 * @typedef {{
 *   url?: string | null;
 *   sourceIdentity?: string;
 *   createRangeSource?: (stats: {
 *     rangeRequests: number;
 *     bytesRequested: number;
 *     persistentCacheHits: number;
 *     fetchTimeMs: number;
 *   }) => {
 *     persistentCacheAvailable: boolean;
 *     fetchRange(start: number, end: number, options?: { signal?: AbortSignal }): Promise<ArrayBuffer>;
 *   };
 * }} StarOctreeSourceConfig
 */

/**
 * @param {StarOctreeProviderServiceOptions} options
 * @returns {StarOctreeProviderService}
 */
export function createStarOctreeProviderService(options) {
  return createProviderService(options, {});
}

/**
 * @param {import('./index.d.ts').StarOctreeFileProviderServiceOptions} options
 * @returns {StarOctreeProviderService}
 */
export function createStarOctreeFileProviderService(options) {
  validateFileProviderOptions(options);
  const fileName = getBlobName(options.file);

  return createProviderService(
    {
      id: options.id,
      url: `file://${fileName}`,
      datasetId: options.datasetId,
      persistentCache: 'off',
      limits: options.limits,
    },
    {},
    {
      url: null,
      sourceIdentity: `file:${fileName}:${options.file.size}`,
      createRangeSource(stats) {
        return createBlobRangeSource({
          file: options.file,
          stats,
        });
      },
    },
  );
}

/**
 * Internal test seam. This is deliberately not re-exported from package index.
 *
 * @param {StarOctreeProviderServiceOptions} options
 * @param {StarOctreeProviderTestInternals} internals
 * @returns {StarOctreeProviderService}
 */
export function createStarOctreeProviderServiceForTest(options, internals = {}) {
  return createProviderService(options, internals);
}

/**
 * @param {StarOctreeProviderServiceOptions} options
 * @param {StarOctreeProviderTestInternals} internals
 * @param {StarOctreeSourceConfig} [sourceConfig]
 * @returns {StarOctreeProviderService}
 */
function createProviderService(options, internals, sourceConfig = {}) {
  validateProviderOptions(options);

  const providerId = options.id ?? `star-octree-provider-${nextProviderId}`;
  nextProviderId += 1;
  /** @type {Map<string, ReturnType<typeof createStarOctreeProviderSession>>} */
  const sessions = new Map();
  const scheduler = createStarOctreeScheduler({ limits: options.limits });
  const indexSource = createStarOctreeIndexSource({
    providerId,
    options,
    scheduler,
    ...(sourceConfig.createRangeSource
      ? { createRangeSource: sourceConfig.createRangeSource }
      : {}),
    ...(sourceConfig.sourceIdentity
      ? { sourceIdentity: sourceConfig.sourceIdentity }
      : {}),
  });
  const workTracker = createStarOctreeWorkTracker();
  const pipeline = createStarOctreePipeline({
    providerId,
    indexSource,
    persistentCache: options.persistentCache,
    memoryBudgetBytes: options.limits?.memoryBudgetBytes,
    workTracker,
    scheduler,
  });
  const usePipelineSource =
    internals.useRealPipeline || !(internals.planDemand || internals.decodeNode);
  let disposed = false;

  const source = {
    planDemand:
      internals.planDemand ??
      ((context) => pipeline.planDemandForContext(context)),
    ...(usePipelineSource
      ? {
          /**
           * @param {StarOctreeSelectionContext} context
           * @param {StarOctreeDemandEntry[]} currentEntries
           */
          planPrefetch(context, currentEntries) {
            return pipeline.planPrefetchForContext(context, currentEntries);
          },
        }
      : {}),
    decodeNode:
      internals.decodeNode ??
      ((entry) => createDefaultDecodedStarSegment(entry.node)),
    ...(usePipelineSource
      ? {
          /**
           * @param {StarOctreeDemandEntry[]} entries
           * @param {Parameters<ReturnType<typeof createStarOctreePipeline>['streamCellsForEntries']>[1]} streamOptions
           */
          streamCells(entries, streamOptions) {
            return pipeline.streamCellsForEntries(entries, streamOptions);
          },
          /**
           * @param {StarOctreeDemandEntry[]} entries
           * @param {{ sessionId?: string; attributes?: string[]; emitCachedFirst?: boolean; signal?: AbortSignal }} [warmOptions]
           */
          warmEntries(entries, warmOptions) {
            return pipeline.warmEntries(entries, warmOptions);
          },
        }
      : {}),
  };

  /** @type {StarOctreeProviderService} */
  const service = {
    get id() {
      return providerId;
    },

    describe() {
      return createDescriptor(providerId, options, indexSource, sourceConfig);
    },

    getSnapshot() {
      return createProviderSnapshot(
        providerId,
        options,
        sessions,
        indexSource,
        pipeline,
        scheduler,
        workTracker,
        sourceConfig,
      );
    },

    async ensureBootstrap() {
      assertActive();
      return indexSource.ensureBootstrapLoaded();
    },

    createSession(sessionOptions = {}) {
      assertActive();

      const sessionId =
        sessionOptions.id ?? `${providerId}:session:${nextSessionId}`;
      nextSessionId += 1;
      const session = createStarOctreeProviderSession({
        providerId,
        sessionId,
        options: sessionOptions,
        source,
        getActiveWorkItemCount(id) {
          return workTracker.countActive({ sessionId: id });
        },
        onDispose(id) {
          sessions.delete(id);
        },
      });

      sessions.set(sessionId, session);
      return session;
    },

    streamPayloads(_options) {
      assertActive();
      return pipeline.streamPayloads(_options);
    },

    streamCells(_options) {
      assertActive();
      return pipeline.streamCells(_options);
    },

    async inspectDemand(_options) {
      assertActive();
      return pipeline.inspectDemand(_options);
    },

    async fetchCells(_options) {
      assertActive();
      return pipeline.fetchCells(_options);
    },

    dispose() {
      if (disposed) return;
      disposed = true;

      for (const session of sessions.values()) {
        session.dispose();
      }

      sessions.clear();
    },
  };

  return service;

  function assertActive() {
    if (disposed) {
      throw new Error(`Star octree provider "${providerId}" is disposed.`);
    }
  }
}

/**
 * @param {StarOctreeProviderServiceOptions} options
 */
function validateProviderOptions(options) {
  if (!options || typeof options.url !== 'string' || options.url.length === 0) {
    throw new TypeError('createStarOctreeProviderService() requires a URL.');
  }
}

/**
 * @param {import('./index.d.ts').StarOctreeFileProviderServiceOptions} options
 */
function validateFileProviderOptions(options) {
  if (!options?.file || typeof options.file.slice !== 'function') {
    throw new TypeError('createStarOctreeFileProviderService() requires a Blob or File.');
  }
}

/**
 * @param {Blob} file
 */
function getBlobName(file) {
  if ('name' in file && typeof file.name === 'string' && file.name.length > 0) {
    return file.name;
  }
  return 'stars.octree';
}

/**
 * @param {string} providerId
 * @param {StarOctreeProviderServiceOptions} options
 * @param {ReturnType<typeof createStarOctreeIndexSource>} indexSource
 * @param {StarOctreeSourceConfig} [sourceConfig]
 * @returns {StarOctreeProviderDescriptor}
 */
function createDescriptor(providerId, options, indexSource, sourceConfig = {}) {
  const indexSnapshot = indexSource.getSnapshot();
  return {
    id: providerId,
    providerType: 'star-octree',
    datasetId: indexSnapshot.datasetId,
    datasetIdentitySource: indexSnapshot.datasetIdentitySource,
    url: sourceConfig.url === null ? null : options.url,
    produces: ['index', 'star-cells'],
    objectTypes: ['star'],
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
    capabilities: {
      progressive: true,
      rangeRequestable: true,
      payloadBatching: true,
      persistentCache: indexSource.persistentCacheAvailable,
      decodedCache: true,
      borrowedBuffers: true,
      transferableBuffers: supportsTransferableBuffers(),
      sessions: true,
    },
    limits: {
      ...(options.limits?.memoryBudgetBytes !== undefined
        ? { memoryBudgetBytes: options.limits.memoryBudgetBytes }
        : {}),
      ...(options.limits?.maxInflightPayloadBatches !== undefined
        ? { maxInflightPayloadBatches: options.limits.maxInflightPayloadBatches }
        : {}),
      ...(options.limits?.payloadMaxGapBytes !== undefined
        ? { payloadMaxGapBytes: options.limits.payloadMaxGapBytes }
        : {}),
      ...(options.limits?.payloadMaxBatchBytes !== undefined
        ? { payloadMaxBatchBytes: options.limits.payloadMaxBatchBytes }
        : {}),
      ...(options.limits?.maxInflightShardFetches !== undefined
        ? { maxInflightShardFetches: options.limits.maxInflightShardFetches }
        : {}),
      ...(options.limits?.maxInflightPrefetchShardFetches !== undefined
        ? { maxInflightPrefetchShardFetches: options.limits.maxInflightPrefetchShardFetches }
        : {}),
      ...(options.limits?.maxInflightPrefetchPayloadBatches !== undefined
        ? { maxInflightPrefetchPayloadBatches: options.limits.maxInflightPrefetchPayloadBatches }
        : {}),
      ...(options.limits?.maxInflightDecodeTasks !== undefined
        ? { maxInflightDecodeTasks: options.limits.maxInflightDecodeTasks }
        : {}),
      ...(options.limits?.maxInflightPrefetchDecodeTasks !== undefined
        ? { maxInflightPrefetchDecodeTasks: options.limits.maxInflightPrefetchDecodeTasks }
        : {}),
      ...(options.limits?.maxInflightTraversalTasks !== undefined
        ? { maxInflightTraversalTasks: options.limits.maxInflightTraversalTasks }
        : {}),
      ...(options.limits?.maxInflightPrefetchTraversalTasks !== undefined
        ? { maxInflightPrefetchTraversalTasks: options.limits.maxInflightPrefetchTraversalTasks }
        : {}),
    },
  };
}

/**
 * @param {string} providerId
 * @param {StarOctreeProviderServiceOptions} options
 * @param {Map<string, ReturnType<typeof createStarOctreeProviderSession>>} sessions
 * @param {ReturnType<typeof createStarOctreeIndexSource>} indexSource
 * @param {ReturnType<typeof createStarOctreePipeline>} pipeline
 * @param {ReturnType<typeof createStarOctreeScheduler>} scheduler
 * @param {ReturnType<typeof createStarOctreeWorkTracker>} workTracker
 * @param {StarOctreeSourceConfig} [sourceConfig]
 * @returns {StarOctreeProviderSnapshot}
 */
function createProviderSnapshot(
  providerId,
  options,
  sessions,
  indexSource,
  pipeline,
  scheduler,
  workTracker,
  sourceConfig = {},
) {
  const sessionSnapshots = Array.from(sessions.values()).map((session) =>
    session.getSnapshot(),
  );
  const indexSnapshot = indexSource.getSnapshot();
  const decodedSnapshot = pipeline.getDecodedCacheSnapshot();
  const schedulerSnapshot = scheduler.getSnapshot();
  const liveCellBytes = sessionSnapshots.reduce(
    (sum, session) => sum + session.memory.liveBytes,
    0,
  );
  const borrowedBytes = sessionSnapshots.reduce(
    (sum, session) => sum + session.memory.borrowedBytes,
    0,
  );

  return {
    id: providerId,
    providerType: 'star-octree',
    dataset: {
      datasetId: indexSnapshot.datasetId,
      identitySource: indexSnapshot.datasetIdentitySource,
      url: sourceConfig.url === null ? null : options.url,
      bootstrapReady: indexSnapshot.bootstrapReady,
      rootShardReady: indexSnapshot.rootShardReady,
    },
    cache: {
      ...indexSnapshot.cache,
      decodedPayloads: decodedSnapshot.decodedPayloads,
    },
    sessions: sessionSnapshots.map((session) => ({
      id: session.id,
      status: session.demand.status,
      demandNodeCount: session.demand.demandNodeCount,
      activeWorkItemCount: session.demand.activeWorkItemCount,
      cellCount: session.demand.currentCellCount,
      liveBytes: session.memory.liveBytes,
    })),
    workItems: workTracker.snapshot(),
    scheduler: schedulerSnapshot,
    memory: {
      budgetBytes: decodedSnapshot.decodedCacheBudgetBytes,
      usedBytes: liveCellBytes + decodedSnapshot.decodedPayloadBytes,
      rawPayloadBytes: 0,
      decodedPayloadBytes: decodedSnapshot.decodedPayloadBytes,
      liveCellBytes,
      borrowedBytes,
      evictableBytes: decodedSnapshot.decodedPayloadBytes,
    },
    stats: {
      rangeRequests: indexSnapshot.stats.rangeRequests,
      bytesRequested: indexSnapshot.stats.bytesRequested,
      payloadBatchRequests: indexSnapshot.stats.payloadBatchRequests,
      payloadNodesFetched: indexSnapshot.stats.payloadNodesFetched,
      payloadCacheHits: indexSnapshot.stats.payloadCacheHits,
      payloadCompressedBytesRequested: indexSnapshot.stats.payloadCompressedBytesRequested,
      payloadSpanBytesRequested: indexSnapshot.stats.payloadSpanBytesRequested,
      payloadGapBytesRequested: indexSnapshot.stats.payloadGapBytesRequested,
      shardCacheHits: indexSnapshot.stats.shardCacheHits,
      headerCacheHits: indexSnapshot.stats.headerCacheHits,
      persistentCacheHits: indexSnapshot.stats.persistentCacheHits,
      decodedCacheHits: decodedSnapshot.decodedCacheHits,
      decodedPersistentCacheHits: decodedSnapshot.decodedPersistentCacheHits,
      decodedCacheEvictions: decodedSnapshot.decodedCacheEvictions,
      decodedCacheHitsByMask: decodedSnapshot.decodedCacheHitsByMask,
      decodedCacheMissesByMask: decodedSnapshot.decodedCacheMissesByMask,
      decodedCacheWritesByMask: decodedSnapshot.decodedCacheWritesByMask,
      decodedPersistentCacheHitsByMask: decodedSnapshot.decodedPersistentCacheHitsByMask,
      cellCopiedBytes: decodedSnapshot.cellCopiedBytes,
      cellBorrowedBytes: decodedSnapshot.cellBorrowedBytes,
      cellGeneratedRefs: decodedSnapshot.cellGeneratedRefs,
      cellGeneratedPickMeta: decodedSnapshot.cellGeneratedPickMeta,
      fetchTimeMs: indexSnapshot.stats.fetchTimeMs,
    },
  };
}

/**
 * Create deterministic fake decoded data for package-internal session tests.
 *
 * @param {import('./index.d.ts').StarOctreeRuntimeNode} node
 * @returns {DecodedStarSegment}
 */
function createDefaultDecodedStarSegment(node) {
  return {
    count: 1,
    positionsPc: new Float32Array([node.centerX, node.centerY, node.centerZ]),
    teffLog8: new Uint8Array([128]),
    magAbs: new Float32Array([0]),
  };
}
