export interface StarOctreeProviderServiceOptions {
  id?: string;
  url: string;
  datasetId?: string | null;
  persistentCache?: 'on' | 'off';
  limits?: {
    memoryBudgetBytes?: number;
    maxInflightPayloadBatches?: number;
    payloadMaxGapBytes?: number;
    payloadMaxBatchBytes?: number;
  };
}

export interface StarOctreeFileProviderServiceOptions {
  id?: string;
  file: Blob;
  datasetId?: string | null;
  limits?: StarOctreeProviderServiceOptions['limits'];
}

export type StarOctreeFetchStrategy =
  | {
      kind: 'observer-shell';
    }
  | {
      kind: 'target-frustum';
      verticalFovDeg?: number;
      overscanDeg?: number;
      targetRadiusPc?: number;
      nearPc?: number;
      farPc?: number;
    }
  | {
      kind: 'custom';
      selectDemand: (
        context: StarOctreeSelectionContext
      ) => Promise<StarOctreeDemandPlan> | StarOctreeDemandPlan;
    };

export interface StarOctreeDemandEntry {
  node: StarOctreeRuntimeNode;
  priority?: number;
  relevance?: number;
  role?: 'current' | 'prefetch';
  reasons?: string[];
  metadata?: Record<string, unknown>;
}

export interface StarOctreeDemandPlan {
  entries: StarOctreeDemandEntry[];
  signature?: string;
  reasons?: string[];
  metadata?: Record<string, unknown>;
}

export interface StarOctreeTraversalDecision {
  include?: boolean;
  descend?: boolean;
  priority?: number;
  relevance?: number;
  role?: 'current' | 'prefetch';
  reasons?: string[];
  metadata?: Record<string, unknown>;
  distancePc?: number;
}

export interface StarOctreeTraversalSelectionResult {
  entries: StarOctreeDemandEntry[];
  stats: {
    inspectedNodeCount: number;
    selectedNodeCount: number;
    prunedNodeCount: number;
    payloadNodeCount: number;
    frontierShardCount: number;
    maxLevelInspected: number | null;
  };
}

export interface StarOctreeSelectionContext {
  providerId: string;
  sessionId?: string;
  strategy: StarOctreeFetchStrategy;
  view: StarOctreeViewState;
  viewRevision: number;
  demandRevision: number;
  attributes: string[];
  coordinates: StarOctreeCoordinateOutput;
  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
  };
  traversal: {
    select(options: {
      distanceToNode?: (node: StarOctreeRuntimeNode) => number;
      visit: (
        node: StarOctreeRuntimeNode,
        helpers: {
          context: StarOctreeSelectionContext;
          bootstrap: StarOctreeBootstrapProduct;
        }
      ) =>
        | Promise<StarOctreeTraversalDecision>
        | StarOctreeTraversalDecision;
    }): Promise<StarOctreeTraversalSelectionResult>;
  };
}

export interface StarOctreeSessionOptions {
  id?: string;
  strategy?: StarOctreeFetchStrategy;
  attributes?: Array<
    | 'position'
    | 'teffLog8'
    | 'magAbs'
    | 'objectRef'
    | 'pickMeta'
    | string
  >;
  coordinates?: StarOctreeCoordinateOutput;
  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
  };
  memory?: {
    ownership?: 'borrowed' | 'copy' | 'transfer';
  };
}

export interface StarOctreeCoordinateOutput {
  name?: string;
  frame?: 'icrs' | string;
  units?: [string, string, string];
  transformPosition?: (position: {
    xPc: number;
    yPc: number;
    zPc: number;
    node: StarOctreeRuntimeNode;
    ordinal: number;
  }) => [number, number, number] | { x: number; y: number; z: number };
}

export interface StarOctreeViewPatch {
  observerPc?: { x: number; y: number; z: number };
  mDesired?: number;
  limitingMagnitude?: number;
  targetPc?: { x: number; y: number; z: number };
  directionIcrs?: { x: number; y: number; z: number };
  orientationIcrs?: { x: number; y: number; z: number; w: number };
  verticalFovDeg?: number;
  aspectRatio?: number;
  nearPc?: number;
  farPc?: number;
  preloadDistancePc?: number;
  motion?: {
    velocityPcPerSec?: { x: number; y: number; z: number };
    speedPcPerSec?: number;
    lookaheadSecs?: number;
  };
  params?: Record<string, unknown>;
}

export interface StarOctreeViewState extends StarOctreeViewPatch {
  revision: number;
}

export interface ViewUpdateOptions {
  demand?: 'auto' | 'force' | 'suppress';
  reason?: string;
}

export interface StarOctreeViewReceipt {
  sessionId: string;
  viewRevision: number;
  demandRevision: number;
  demand: 'queued' | 'forced' | 'suppressed';
  reasons: string[];
}

export interface StarOctreeRuntimeNode {
  nodeKey: string;
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
  level: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  flags: number;
  childMask: number;
  payloadOffset: number;
  payloadLength: number;
  firstChild: number;
  localDepth: number;
  localPath: number;
  shardOffset: number;
  nodeIndex: number;
}

export interface StarOctreeProviderDescriptor {
  id: string;
  providerType: 'star-octree';
  datasetId?: string | null;
  datasetIdentitySource?: string | null;
  url?: string | null;
  produces: Array<'index' | 'object-batch'>;
  objectTypes: ['star'];
  attributes: Array<
    'position' | 'teffLog8' | 'magAbs' | 'objectRef' | 'pickMeta'
  >;
  capabilities: {
    progressive: boolean;
    rangeRequestable: boolean;
    payloadBatching: boolean;
    persistentCache: boolean;
    decodedCache: boolean;
    borrowedBuffers: boolean;
    transferableBuffers: boolean;
    sessions: boolean;
  };
  limits: {
    memoryBudgetBytes?: number;
    maxInflightPayloadBatches?: number;
    payloadMaxGapBytes?: number;
    payloadMaxBatchBytes?: number;
  };
}

export interface StarOctreeBootstrapProduct {
  productType: 'index';
  indexKind: 'star-octree-bootstrap';
  providerId: string;
  datasetId?: string | null;
  datasetIdentitySource?: string | null;
  header: {
    version: number;
    indexOffset: number;
    indexLength: number;
    worldCenterX: number;
    worldCenterY: number;
    worldCenterZ: number;
    worldHalfSize: number;
    payloadRecordSize: number;
    maxLevel: number;
    magLimit: number;
  };
  completeness: {
    phase: 'complete';
    stable: true;
  };
}

export interface CanonicalObjectRef {
  datasetId?: string | null;
  nodeKey: string;
  ordinal: number;
}

export interface StarObjectBatchProduct {
  productType: 'object-batch';
  id: string;
  providerId: string;
  layerId: 'stars';
  objectType: 'star';
  streamId: string;
  sessionId?: string;
  viewRevision?: number;
  demandRevision?: number;
  count: number;
  nodes: Array<{
    nodeKey: string;
    level: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
    halfSize: number;
    count: number;
    offset: number;
  }>;
  coordinates: {
    primary: {
      name: string;
      frame: string;
      representation: 'cartesian3';
      units: [string, string, string];
      stride: 3;
      components: Float32Array;
    };
  };
  attributes: {
    teffLog8?: {
      name: 'teffLog8';
      kind: 'number';
      values: Uint8Array;
    };
    magAbs?: {
      name: 'magAbs';
      kind: 'number';
      unit: 'mag';
      values: Float32Array;
    };
  };
  refs?: CanonicalObjectRef[];
  pickMeta?: Array<{
    nodeKey: string;
    ordinal: number;
    level: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
  }>;
  completeness: {
    phase: 'coarse' | 'partial' | 'complete' | 'stale';
    stable: boolean;
    loadedObjects: number;
    loadedNodes: number;
    totalNodes?: number;
  };
  memory: {
    ownership: 'borrowed' | 'copy' | 'transfer';
    bytes: number;
  };
  metadata?: Record<string, unknown>;
}

export type StarOctreePayloadDelta =
  | {
      type: 'payload/batch';
      streamId: string;
      providerId: string;
      sessionId?: string;
      entries: Array<{
        node: StarOctreeRuntimeNode;
        buffer: ArrayBuffer;
      }>;
      cached?: boolean;
      completeness: {
        phase: 'partial' | 'complete';
      };
    }
  | {
      type: 'payload/progress';
      streamId: string;
      providerId: string;
      sessionId?: string;
      loadedNodes: number;
      totalNodes: number;
      loadedBytes?: number;
    }
  | {
      type: 'payload/complete';
      streamId: string;
      providerId: string;
      sessionId?: string;
    }
  | {
      type: 'payload/error';
      streamId: string;
      providerId: string;
      sessionId?: string;
      error: {
        message: string;
        code?: string;
      };
    };

export type StarOctreeProductDelta =
  | {
      type: 'data/product-upsert';
      streamId: string;
      providerId: string;
      sessionId?: string;
      product: StarObjectBatchProduct;
    }
  | {
      type: 'data/product-stale';
      providerId: string;
      sessionId?: string;
      productId: string;
      reason?: string;
    }
  | {
      type: 'data/product-remove';
      providerId: string;
      sessionId?: string;
      productId: string;
      reason?: string;
    }
  | {
      type: 'data/representation-current';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      productIds?: string[];
      completeness: StarObjectBatchProduct['completeness'];
    }
  | {
      type: 'data/product-error';
      streamId: string;
      providerId: string;
      sessionId?: string;
      error: {
        message: string;
        code?: string;
      };
    };

export interface StarOctreeSessionSnapshot {
  id: string;
  strategy: StarOctreeFetchStrategy;
  view: StarOctreeViewState;
  demand: {
    revision: number;
    status:
      | 'idle'
      | 'planning'
      | 'loading'
      | 'streaming'
      | 'current'
      | 'failed'
      | 'disposed';
    demandNodeCount: number;
    currentProductCount: number;
    activeWorkItemCount: number;
  };
  products: Array<{
    productId: string;
    nodeCount: number;
    starCount: number;
    phase: 'coarse' | 'partial' | 'complete' | 'stale';
    current: boolean;
    bytes: number;
  }>;
  memory: {
    liveBytes: number;
    borrowedBytes: number;
    evictableBytes: number;
  };
  lastReasons: string[];
  lastError?: string | null;
}

export interface StarOctreeProviderSnapshot {
  id: string;
  providerType: 'star-octree';
  dataset: {
    datasetId?: string | null;
    identitySource?: string | null;
    url?: string | null;
    bootstrapReady: boolean;
    rootShardReady: boolean;
  };
  cache: {
    bootstrapHeaders: number;
    shardHeaders: number;
    payloads: number;
    decodedPayloads?: number;
    products?: number;
  };
  sessions: Array<{
    id: string;
    status: StarOctreeSessionSnapshot['demand']['status'];
    demandNodeCount: number;
    activeWorkItemCount: number;
    productCount: number;
    liveBytes: number;
  }>;
  workItems: Array<{
    workId: string;
    sessionId?: string;
    status: 'queued' | 'fetching' | 'decoding' | 'streaming' | 'finished' | 'failed';
    nodeCount?: number;
    bytesLoaded?: number;
    startedAtMs?: number;
    finishedAtMs?: number;
  }>;
  memory: {
    budgetBytes?: number;
    usedBytes?: number;
    rawPayloadBytes?: number;
    decodedPayloadBytes?: number;
    liveProductBytes?: number;
    borrowedBytes?: number;
    evictableBytes?: number;
  };
  stats: {
    rangeRequests: number;
    bytesRequested: number;
    payloadBatchRequests: number;
    payloadNodesFetched: number;
    payloadCacheHits: number;
    payloadCompressedBytesRequested?: number;
    payloadSpanBytesRequested?: number;
    payloadGapBytesRequested?: number;
    shardCacheHits: number;
    headerCacheHits: number;
    persistentCacheHits: number;
    decodedCacheHits?: number;
    decodedPersistentCacheHits?: number;
    decodedCacheEvictions?: number;
    fetchTimeMs: number;
  };
}

export interface StarOctreeObjectBatchStreamOptions {
  id?: string;
  strategy?: StarOctreeFetchStrategy;
  view?: StarOctreeViewPatch;
  viewRevision?: number;
  demandRevision?: number;
  attributes?: string[];
  coordinates?: StarOctreeCoordinateOutput;
  streaming?: {
    progressive?: boolean;
    batchMode?: 'payload-range' | 'node';
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
    retainOrder?: boolean;
  };
  memory?: {
    ownership?: 'borrowed' | 'copy' | 'transfer';
  };
}

export interface StarOctreePayloadStreamOptions {
  id?: string;
  strategy?: StarOctreeFetchStrategy;
  view?: StarOctreeViewPatch;
  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
  };
}

export interface StarOctreeProviderSession {
  readonly id: string;
  updateView(
    patch: StarOctreeViewPatch,
    options?: ViewUpdateOptions
  ): StarOctreeViewReceipt;
  subscribe(listener: (delta: StarOctreeProductDelta) => void): () => void;
  deltas(): AsyncIterable<StarOctreeProductDelta>;
  getSnapshot(): StarOctreeSessionSnapshot;
  dispose(): void | Promise<void>;
}

export interface StarOctreeProviderService {
  readonly id: string;
  describe(): StarOctreeProviderDescriptor;
  getSnapshot(): StarOctreeProviderSnapshot;
  ensureBootstrap(): Promise<StarOctreeBootstrapProduct>;
  createSession(options?: StarOctreeSessionOptions): StarOctreeProviderSession;
  streamPayloads(
    options: StarOctreePayloadStreamOptions
  ): AsyncIterable<StarOctreePayloadDelta>;
  streamObjectBatches(
    options: StarOctreeObjectBatchStreamOptions
  ): AsyncIterable<StarOctreeProductDelta>;
  fetchObjectBatch(
    options: StarOctreeObjectBatchStreamOptions
  ): Promise<StarObjectBatchProduct>;
  dispose(): void | Promise<void>;
}

export declare function createStarOctreeProviderService(
  options: StarOctreeProviderServiceOptions
): StarOctreeProviderService;

export declare function createStarOctreeFileProviderService(
  options: StarOctreeFileProviderServiceOptions
): StarOctreeProviderService;
