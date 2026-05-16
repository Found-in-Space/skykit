import type {
  StarCoordinateOutput,
  StarObjectBatchProduct,
} from '@found-in-space/star-products';

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

export interface StarOctreeDemandThresholds {
  observerMoveThresholdPc?: number;
  limitingMagnitudeDelta?: number;
  directionAngleDeg?: number;
}

export interface StarOctreePointPc {
  x: number;
  y: number;
  z: number;
}

export interface StarOctreeObserverShellStrategy {
  kind: 'observer-shell';
}

export interface StarOctreeTargetFrustumStrategy {
  kind: 'target-frustum';
  verticalFovDeg?: number;
  overscanDeg?: number;
  targetRadiusPc?: number;
  nearPc?: number;
  farPc?: number;
}

export interface StarOctreeSphereVolumeStrategy {
  kind: 'sphere-volume';
  centerPc: StarOctreePointPc;
  radiusPc: number;
}

export interface StarOctreePathVolumeStrategy {
  kind: 'path-volume';
  pointsPc: StarOctreePointPc[];
  radiusPc: number;
}

export interface StarOctreeMotionLookaheadStrategy {
  kind: 'motion-lookahead';
  strategy: StarOctreeFetchStrategy;
}

export interface StarOctreeCompositeStrategy {
  kind: 'composite';
  mode: 'union';
  strategies: StarOctreeFetchStrategy[];
}

export interface StarOctreeCustomStrategy {
  kind: 'custom';
  selectDemand: (
    context: StarOctreeSelectionContext
  ) => Promise<StarOctreeDemandPlan> | StarOctreeDemandPlan;
  shouldReplan?: (
    context: StarOctreeDemandGateContext
  ) => StarOctreeDemandGateResult;
}

export type StarOctreeFetchStrategy =
  | StarOctreeObserverShellStrategy
  | StarOctreeTargetFrustumStrategy
  | StarOctreeSphereVolumeStrategy
  | StarOctreePathVolumeStrategy
  | StarOctreeMotionLookaheadStrategy
  | StarOctreeCompositeStrategy
  | StarOctreeCustomStrategy;

export interface StarOctreeSphereVolumeRequest {
  type: 'sphere';
  centerPc: StarOctreePointPc;
  radiusPc: number;
}

export interface StarOctreePathVolumeRequest {
  type: 'path';
  pointsPc: StarOctreePointPc[];
  radiusPc: number;
}

export type StarOctreeVolumeRequest =
  | StarOctreeSphereVolumeRequest
  | StarOctreePathVolumeRequest;

export interface TravelRadiusProfilePoint {
  progress: number;
  radiusPc: number;
}

export interface BuildTravelVolumeRequestsOptions {
  routePointsPc: StarOctreePointPc[];
  radiusProfile?: TravelRadiusProfilePoint[];
  defaultRadiusPc?: number;
  paddingPc?: number;
  quantizeStepPc?: number;
}

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
  demandThresholds?: StarOctreeDemandThresholds;
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

export type StarOctreeCoordinateOutput = StarCoordinateOutput<StarOctreeRuntimeNode>;

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

export interface StarOctreeDemandGateContext {
  strategy: StarOctreeFetchStrategy;
  thresholds?: StarOctreeDemandThresholds;
  previousDemandView: StarOctreeViewState | null;
  nextView: StarOctreeViewState;
  reason?: string;
}

export type StarOctreeDemandGateResult =
  | boolean
  | {
      replan: boolean;
      reasons?: string[];
    };

export interface ViewUpdateOptions {
  demand?: 'auto' | 'force' | 'suppress';
  reason?: string;
}

export interface StarOctreeViewReceipt {
  sessionId: string;
  viewRevision: number;
  demandRevision: number;
  demand: 'queued' | 'forced' | 'suppressed' | 'unchanged';
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

export interface WarmVolumeProgress {
  request: StarOctreeVolumeRequest;
  requestIndex: number;
  delta: StarOctreeProductDelta;
}

export interface WarmVolumeResult {
  requestCount: number;
  productCount: number;
  starCount: number;
  currentCount: number;
}

export declare function createStarOctreeProviderService(
  options: StarOctreeProviderServiceOptions
): StarOctreeProviderService;

export declare function createStarOctreeFileProviderService(
  options: StarOctreeFileProviderServiceOptions
): StarOctreeProviderService;

export declare function createObserverShellStrategy(): StarOctreeObserverShellStrategy;

export declare function createTargetFrustumStrategy(
  options?: Omit<StarOctreeTargetFrustumStrategy, 'kind'>
): StarOctreeTargetFrustumStrategy;

export declare function createSphereVolumeStrategy(
  options: Omit<StarOctreeSphereVolumeRequest, 'type'>
): StarOctreeSphereVolumeStrategy;

export declare function createPathVolumeStrategy(
  options: Omit<StarOctreePathVolumeRequest, 'type'>
): StarOctreePathVolumeStrategy;

export declare function withMotionLookahead(
  strategy: StarOctreeFetchStrategy
): StarOctreeMotionLookaheadStrategy;

export declare function combineStarOctreeStrategies(
  strategies: StarOctreeFetchStrategy[],
  options?: { mode?: 'union' }
): StarOctreeCompositeStrategy;

export declare function buildTravelVolumeRequests(
  options: BuildTravelVolumeRequestsOptions
): StarOctreePathVolumeRequest[];

export declare function streamVolumeProducts(
  provider: StarOctreeProviderService,
  request: StarOctreeVolumeRequest,
  options?: Omit<StarOctreeObjectBatchStreamOptions, 'strategy'>
): AsyncIterable<StarOctreeProductDelta>;

export declare function warmVolumeRequests(
  provider: StarOctreeProviderService,
  requests: StarOctreeVolumeRequest[],
  options?: Omit<StarOctreeObjectBatchStreamOptions, 'strategy'> & {
    onProgress?: (progress: WarmVolumeProgress) => void;
  }
): Promise<WarmVolumeResult>;

export declare function distancePointToPathPc(
  point: StarOctreePointPc,
  pointsPc: StarOctreePointPc[]
): number;
