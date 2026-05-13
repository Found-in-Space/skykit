import { createDefaultDecodedStarSegment } from './star-octree-products.js';
import { createStarOctreeIndexSource } from './star-octree-index-source.js';
import { createStarOctreeProviderSession } from './star-octree-provider-session.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeObjectBatchStreamOptions} StarOctreeObjectBatchStreamOptions
 * @typedef {import('./index.d.ts').StarOctreePayloadStreamOptions} StarOctreePayloadStreamOptions
 * @typedef {import('./index.d.ts').StarOctreeProductDelta} StarOctreeProductDelta
 * @typedef {import('./index.d.ts').StarOctreeProviderDescriptor} StarOctreeProviderDescriptor
 * @typedef {import('./index.d.ts').StarOctreeProviderService} StarOctreeProviderService
 * @typedef {import('./index.d.ts').StarOctreeProviderServiceOptions} StarOctreeProviderServiceOptions
 * @typedef {import('./index.d.ts').StarOctreeProviderSnapshot} StarOctreeProviderSnapshot
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeSessionOptions} StarOctreeSessionOptions
 * @typedef {import('./star-octree-products.js').DecodedStarSegment} DecodedStarSegment
 */

export const ERR_STAR_OCTREE_NOT_IMPLEMENTED = 'ERR_STAR_OCTREE_NOT_IMPLEMENTED';

let nextProviderId = 1;
let nextSessionId = 1;

/**
 * @typedef {{
 *   planDemand?: (context: StarOctreeSelectionContext) => Promise<StarOctreeDemandPlan> | StarOctreeDemandPlan;
 *   decodeNode?: (entry: StarOctreeDemandEntry, context: StarOctreeSelectionContext) => DecodedStarSegment;
 * }} StarOctreeProviderTestInternals
 */

/**
 * @param {StarOctreeProviderServiceOptions} options
 * @returns {StarOctreeProviderService}
 */
export function createStarOctreeProviderService(options) {
  return createProviderService(options, {});
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
 * @returns {StarOctreeProviderService}
 */
function createProviderService(options, internals) {
  validateProviderOptions(options);

  const providerId = options.id ?? `star-octree-provider-${nextProviderId}`;
  nextProviderId += 1;
  /** @type {Map<string, ReturnType<typeof createStarOctreeProviderSession>>} */
  const sessions = new Map();
  const indexSource = createStarOctreeIndexSource({
    providerId,
    options,
  });
  let disposed = false;

  const source = {
    planDemand:
      internals.planDemand ??
      (() => ({
        entries: [],
        signature: '',
      })),
    decodeNode:
      internals.decodeNode ??
      ((entry) => createDefaultDecodedStarSegment(entry.node)),
  };

  /** @type {StarOctreeProviderService} */
  const service = {
    get id() {
      return providerId;
    },

    describe() {
      return createDescriptor(providerId, options, indexSource);
    },

    getSnapshot() {
      return createProviderSnapshot(providerId, options, sessions, indexSource);
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
        onDispose(id) {
          sessions.delete(id);
        },
      });

      sessions.set(sessionId, session);
      return session;
    },

    streamPayloads(_options) {
      return createThrowingAsyncIterable('streamPayloads');
    },

    streamObjectBatches(_options) {
      return createThrowingAsyncIterable('streamObjectBatches');
    },

    async fetchObjectBatch(_options) {
      throw createNotImplementedError('fetchObjectBatch');
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
 * @param {string} providerId
 * @param {StarOctreeProviderServiceOptions} options
 * @param {ReturnType<typeof createStarOctreeIndexSource>} indexSource
 * @returns {StarOctreeProviderDescriptor}
 */
function createDescriptor(providerId, options, indexSource) {
  return {
    id: providerId,
    providerType: 'star-octree',
    datasetId: options.datasetId ?? null,
    datasetIdentitySource: null,
    url: options.url,
    produces: ['index'],
    objectTypes: ['star'],
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
    capabilities: {
      progressive: true,
      rangeRequestable: true,
      payloadBatching: false,
      persistentCache: indexSource.persistentCacheAvailable,
      decodedCache: false,
      borrowedBuffers: true,
      transferableBuffers: false,
      sessions: true,
    },
    limits: {
      ...(options.limits?.maxInflightPayloadBatches !== undefined
        ? { maxInflightPayloadBatches: options.limits.maxInflightPayloadBatches }
        : {}),
      ...(options.limits?.payloadMaxGapBytes !== undefined
        ? { payloadMaxGapBytes: options.limits.payloadMaxGapBytes }
        : {}),
      ...(options.limits?.payloadMaxBatchBytes !== undefined
        ? { payloadMaxBatchBytes: options.limits.payloadMaxBatchBytes }
        : {}),
    },
  };
}

/**
 * @param {string} providerId
 * @param {StarOctreeProviderServiceOptions} options
 * @param {Map<string, ReturnType<typeof createStarOctreeProviderSession>>} sessions
 * @param {ReturnType<typeof createStarOctreeIndexSource>} indexSource
 * @returns {StarOctreeProviderSnapshot}
 */
function createProviderSnapshot(providerId, options, sessions, indexSource) {
  const sessionSnapshots = Array.from(sessions.values()).map((session) =>
    session.getSnapshot(),
  );
  const indexSnapshot = indexSource.getSnapshot();
  const liveProductBytes = sessionSnapshots.reduce(
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
      url: options.url,
      bootstrapReady: indexSnapshot.bootstrapReady,
      rootShardReady: indexSnapshot.rootShardReady,
    },
    cache: indexSnapshot.cache,
    sessions: sessionSnapshots.map((session) => ({
      id: session.id,
      status: session.demand.status,
      demandNodeCount: session.demand.demandNodeCount,
      activeWorkItemCount: session.demand.activeWorkItemCount,
      productCount: session.demand.currentProductCount,
      liveBytes: session.memory.liveBytes,
    })),
    workItems: [],
    memory: {
      usedBytes: liveProductBytes,
      rawPayloadBytes: 0,
      decodedPayloadBytes: 0,
      liveProductBytes,
      borrowedBytes,
      evictableBytes: 0,
    },
    stats: {
      rangeRequests: indexSnapshot.stats.rangeRequests,
      bytesRequested: indexSnapshot.stats.bytesRequested,
      payloadBatchRequests: 0,
      payloadNodesFetched: 0,
      payloadCacheHits: 0,
      shardCacheHits: indexSnapshot.stats.shardCacheHits,
      headerCacheHits: indexSnapshot.stats.headerCacheHits,
      persistentCacheHits: indexSnapshot.stats.persistentCacheHits,
      fetchTimeMs: indexSnapshot.stats.fetchTimeMs,
    },
  };
}

/**
 * @param {string} methodName
 * @returns {Error & { code: string }}
 */
function createNotImplementedError(methodName) {
  const error = new Error(
    `${methodName}() is not implemented in the contract-spine slice.`,
  );
  return Object.assign(error, {
    code: ERR_STAR_OCTREE_NOT_IMPLEMENTED,
  });
}

/**
 * @template T
 * @param {string} methodName
 * @returns {AsyncIterable<T>}
 */
function createThrowingAsyncIterable(methodName) {
  return {
    async *[Symbol.asyncIterator]() {
      throw createNotImplementedError(methodName);
    },
  };
}
