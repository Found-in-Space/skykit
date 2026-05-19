import type {
  StarCellData,
  StarCellDelta,
  StarCellKey,
  StarCoordinateOutput,
  StarTreeDemandThresholds,
  StarTreePointPc,
  StarTreeStrategy,
  StarTreeVolumeRequest,
} from '@found-in-space/star-trees';

export declare const OCTREE_c56103: string;
export declare const OCTREE_DEFAULT: string;

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
  emit?: boolean;
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
  strategy: StarTreeStrategy;
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
          bootstrap: StarOctreeBootstrapIndex;
          queuedDistancePc: number;
        }
      ) =>
        | Promise<StarOctreeTraversalDecision>
        | StarOctreeTraversalDecision;
    }): Promise<StarOctreeTraversalSelectionResult>;
  };
}

export interface StarOctreeSessionOptions {
  id?: string;
  strategy?: StarTreeStrategy;
  demandThresholds?: StarTreeDemandThresholds;
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

/**
 * Runtime traversal node exposed to strategies as logical cell geometry.
 *
 * `level + mortonCode` is the public cell identity. The physical fields on this
 * execution object are for provider planners/loaders only; public cells,
 * bookmarks, sidecars, renderers, and examples must reduce nodes to
 * `StarObjectRef` or `createStarCellKey()`.
 */
export interface StarOctreeRuntimeNode {
  mortonCode: string;
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
  produces: Array<'index' | 'star-cells'>;
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

export interface StarOctreeBootstrapIndex {
  kind: 'star-octree-bootstrap';
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

export type StarOctreeCellDelta = StarCellDelta;

export interface StarOctreeSessionSnapshot {
  id: string;
  strategy: StarTreeStrategy;
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
    currentCellCount: number;
    activeWorkItemCount: number;
  };
  cells: Array<{
    cellKey: StarCellKey;
    level: number;
    mortonCode: string;
    starCount: number;
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
    cells?: number;
  };
  sessions: Array<{
    id: string;
    status: StarOctreeSessionSnapshot['demand']['status'];
    demandNodeCount: number;
    activeWorkItemCount: number;
    cellCount: number;
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
    liveCellBytes?: number;
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

export interface StarOctreeCellStreamOptions {
  id?: string;
  sessionId?: string;
  strategy?: StarTreeStrategy;
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
  signal?: AbortSignal;
}

export interface StarOctreeDemandInspection {
  providerId: string;
  streamId?: string;
  strategy: StarTreeStrategy;
  view: StarOctreeViewState;
  reasons: string[];
  signature?: string;
  metadata?: Record<string, unknown>;
  counts: {
    nodeCount: number;
    currentNodeCount: number;
    prefetchNodeCount: number;
    payloadNodeCount: number;
    totalPayloadBytes: number;
    minLevel: number | null;
    maxLevel: number | null;
  };
  nodes: Array<{
    level: number;
    mortonCode: string;
    centerPc: StarTreePointPc;
    halfSizePc: number;
    payloadBytes: number;
    role: 'current' | 'prefetch';
    priority?: number;
    relevance?: number;
    reasons?: string[];
    metadata?: Record<string, unknown>;
  }>;
}

export interface StarOctreePayloadStreamOptions {
  id?: string;
  strategy?: StarTreeStrategy;
  view?: StarOctreeViewPatch;
  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
  };
  signal?: AbortSignal;
}

export interface StarOctreeProviderSession {
  readonly id: string;
  updateView(
    patch: StarOctreeViewPatch,
    options?: ViewUpdateOptions
  ): StarOctreeViewReceipt;
  subscribe(listener: (delta: StarOctreeCellDelta) => void): () => void;
  deltas(): AsyncIterable<StarOctreeCellDelta>;
  getSnapshot(): StarOctreeSessionSnapshot;
  dispose(): void | Promise<void>;
}

export interface StarOctreeProviderService {
  readonly id: string;
  describe(): StarOctreeProviderDescriptor;
  getSnapshot(): StarOctreeProviderSnapshot;
  ensureBootstrap(): Promise<StarOctreeBootstrapIndex>;
  createSession(options?: StarOctreeSessionOptions): StarOctreeProviderSession;
  streamPayloads(
    options: StarOctreePayloadStreamOptions
  ): AsyncIterable<StarOctreePayloadDelta>;
  streamCells(
    options: StarOctreeCellStreamOptions
  ): AsyncIterable<StarOctreeCellDelta>;
  inspectDemand(
    options: StarOctreeCellStreamOptions
  ): Promise<StarOctreeDemandInspection>;
  fetchCells(
    options: StarOctreeCellStreamOptions
  ): Promise<StarCellData[]>;
  dispose(): void | Promise<void>;
}

export interface WarmVolumeProgress {
  request: StarTreeVolumeRequest;
  requestIndex: number;
  delta: StarOctreeCellDelta;
}

export interface WarmVolumeResult {
  requestCount: number;
  cellCount: number;
  starCount: number;
  currentCount: number;
}

export declare function createStarOctreeProviderService(
  options: StarOctreeProviderServiceOptions
): StarOctreeProviderService;

export declare function createStarOctreeFileProviderService(
  options: StarOctreeFileProviderServiceOptions
): StarOctreeProviderService;

export declare function streamVolumeCells(
  provider: StarOctreeProviderService,
  request: StarTreeVolumeRequest,
  options?: Omit<StarOctreeCellStreamOptions, 'strategy'>
): AsyncIterable<StarOctreeCellDelta>;

export declare function warmVolumeRequests(
  provider: StarOctreeProviderService,
  requests: StarTreeVolumeRequest[],
  options?: Omit<StarOctreeCellStreamOptions, 'strategy'> & {
    onProgress?: (progress: WarmVolumeProgress) => void;
  }
): Promise<WarmVolumeResult>;
