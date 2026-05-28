export type StarCellKey = `${number}:${string}`;

export interface StarCellRef {
  level: number;
  mortonCode: string;
}

/**
 * Canonical public identity for a star within one dataset.
 *
 * `level + mortonCode` identifies the logical octree cell. `ordinal`
 * identifies the star within that cell's emitted payload order.
 */
export interface StarObjectRef extends StarCellRef {
  datasetId?: string | null;
  ordinal: number;
}

/**
 * Pick/join metadata for renderer selections.
 *
 * This repeats the public logical cell and ordinal, plus geometry useful for
 * proximity and sidecar lookups. It is not a separate object ID scheme.
 */
export interface StarPickMeta extends StarCellRef {
  cellKey: StarCellKey;
  ordinal: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
}

export interface StarCellSourceNode extends StarCellRef {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
  gridX: number;
  gridY: number;
  gridZ: number;
}

export interface StarTreePointPc {
  x: number;
  y: number;
  z: number;
}

export interface StarTreeCellGeometry extends StarCellRef {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
  level: number;
  gridX?: number;
  gridY?: number;
  gridZ?: number;
}

export interface TargetFrustumStrategyOptions {
  verticalFovDeg?: number;
  overscanDeg?: number;
  targetRadiusPc?: number;
  nearPc?: number;
  farPc?: number;
}

export interface SphereVolumeStrategyOptions {
  centerPc: StarTreePointPc;
  radiusPc: number;
}

export interface PathVolumeStrategyOptions {
  pointsPc: StarTreePointPc[];
  radiusPc: number;
}

export interface LookaheadStrategyOptions {
  base: StarCellStrategy;
  horizonSecs: number;
  tickSecs: number;
  blackoutSecs?: number;
}

export interface WarmStrategyOptions {
  lane?: StarCellPriorityLane;
  band?: number;
  scoreBias?: number;
  reason?: string;
}

export interface StarTreeSphereVolumeRequest {
  type: 'sphere';
  centerPc: StarTreePointPc;
  radiusPc: number;
}

export interface StarTreePathVolumeRequest {
  type: 'path';
  pointsPc: StarTreePointPc[];
  radiusPc: number;
}

export type StarTreeVolumeRequest =
  | StarTreeSphereVolumeRequest
  | StarTreePathVolumeRequest;

export interface TravelRadiusProfilePoint {
  progress: number;
  radiusPc: number;
}

export interface BuildTravelVolumeRequestsOptions {
  routePointsPc: StarTreePointPc[];
  radiusProfile?: TravelRadiusProfilePoint[];
  defaultRadiusPc?: number;
  paddingPc?: number;
  quantizeStepPc?: number;
}

export interface StarTreeViewPatch {
  observerPc?: StarTreePointPc;
  mDesired?: number;
  limitingMagnitude?: number;
  targetPc?: StarTreePointPc;
  orientationIcrs?: { x: number; y: number; z: number; w: number };
  verticalFovDeg?: number;
  aspectRatio?: number;
  nearPc?: number;
  farPc?: number;
  preloadDistancePc?: number;
  motion?: {
    velocityPcPerSec?: StarTreePointPc;
    speedPcPerSec?: number;
    lookaheadSecs?: number;
  };
  params?: Record<string, unknown>;
}

export interface StarTreeViewState extends StarTreeViewPatch {
  revision: number;
}

export type StarCellPriorityLane = 'live' | 'warm' | string;

export interface StarCellPriority {
  lane: StarCellPriorityLane;
  band: number;
  score?: number;
}

export interface StrategyContribution {
  role?: 'current' | 'prefetch';
  priority?: StarCellPriority;
  relevance?: number;
  reasons?: string[];
  metadata?: Record<string, unknown>;
}

export interface StarCellDecision {
  include: boolean;
  descend?: boolean;
  emit?: boolean;
  priority?: StarCellPriority;
  relevance?: number;
  distancePc?: number;
  reasons?: string[];
  metadata?: Record<string, unknown>;
  contributors?: StrategyContribution[];
}

export interface StarStrategyAnchor {
  view: StarTreeViewPatch;
  params?: Record<string, unknown>;
}

export interface StarStrategyEvaluationContext {
  role?: 'current' | 'prefetch';
  indexMagnitude?: number;
  currentObserverPc?: StarTreePointPc;
}

export interface StarCellEvaluator {
  view: StarTreeViewPatch;
  distanceToCell?(cell: StarTreeCellGeometry): number;
  evaluateCell(
    cell: StarTreeCellGeometry,
    helpers?: { queuedDistancePc?: number }
  ): StarCellDecision;
}

export interface CellRegion {
  centerPc?: StarTreePointPc;
  radiusPc?: number;
  minPc?: StarTreePointPc;
  maxPc?: StarTreePointPc;
}

export type StarStrategyChange =
  | { kind: 'none'; reasons?: string[] }
  | { kind: 'priority-only'; regions?: CellRegion[]; priorityFloor?: StarCellPriority; reasons?: string[] }
  | { kind: 'tail-changed'; regions?: CellRegion[]; belowPriority: StarCellPriority; reasons?: string[] }
  | { kind: 'regions-changed'; regions: CellRegion[]; priorityFloor?: StarCellPriority; reasons?: string[] }
  | { kind: 'reset'; reason: string; reasons?: string[] };

export interface StarStrategyDiffContext {
  thresholds?: StarTreeDemandThresholds;
  reason?: string;
}

export interface StarCellStrategy<TView = StarTreeViewPatch> {
  createAnchor(view?: TView): StarStrategyAnchor;
  createEvaluator(
    anchor: StarStrategyAnchor,
    context?: StarStrategyEvaluationContext
  ): StarCellEvaluator;
  diff(
    previous: StarStrategyAnchor | null,
    next: StarStrategyAnchor,
    context?: StarStrategyDiffContext
  ): StarStrategyChange;
}

export interface StarTreeDemandThresholds {
  observerMoveThresholdPc?: number;
  limitingMagnitudeDelta?: number;
  directionAngleDeg?: number;
}

export type StarTreeDemandGateResult =
  | boolean
  | {
      replan: boolean;
      reasons?: string[];
    };

export interface StarCoordinateOutput<Node = StarCellSourceNode> {
  name?: string;
  frame?: 'icrs' | string;
  units?: [string, string, string];
  transformPosition?: (position: {
    xPc: number;
    yPc: number;
    zPc: number;
    node: Node;
    ordinal: number;
  }) => [number, number, number] | { x: number; y: number; z: number };
}

export interface DecodedStarSegment {
  count: number;
  positionsPc: Float32Array;
  teffLog8?: Uint8Array;
  magAbs?: Float32Array;
  refs?: StarObjectRef[];
}

export interface StarCellData {
  cellKey: StarCellKey;
  cell: StarCellRef;
  bounds: {
    centerPc: { x: number; y: number; z: number };
    halfSizePc: number;
    gridX: number;
    gridY: number;
    gridZ: number;
  };
  count: number;
  coordinates: {
    name: string;
    frame: string;
    units: [string, string, string];
    components: Float32Array;
  };
  attributes: {
    magAbs?: Float32Array;
    teffLog8?: Uint8Array;
  };
  refs?: StarObjectRef[];
  pickMeta?: StarPickMeta[];
}

export interface CreateStarCellDataOptions<Node = StarCellSourceNode> {
  node: Node & StarCellSourceNode;
  decoded: DecodedStarSegment;
  datasetId?: string | null;
  attributes?: string[];
  coordinates?: StarCoordinateOutput<Node & StarCellSourceNode>;
  memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
}

export type StarCellDelta =
  | {
      type: 'stars/cells-upsert';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cells: StarCellData[];
    }
  | {
      type: 'stars/cells-remove';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cellKeys: StarCellKey[];
      reason?: string;
    }
  | {
      type: 'stars/current';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cellKeys: StarCellKey[];
      starCount: number;
    }
  | {
      type: 'stars/error';
      providerId: string;
      sessionId?: string;
      demandRevision?: number;
      error: { message: string; code?: string };
    };

export interface StarRow {
  cell: StarCellData;
  cellKey: StarCellKey;
  objectIndex: number;
  position: { x: number; y: number; z: number };
  teffLog8?: number;
  magAbs?: number;
  objectRef?: StarObjectRef | null;
  pickMeta?: StarPickMeta | null;
}

export interface StarCellStoreSnapshot {
  cellCount: number;
  starCount: number;
  bytes: number;
  lastDelta: StarCellDelta | null;
  lastError: Extract<StarCellDelta, { type: 'stars/error' }> | null;
}

export interface StarCellStore {
  apply(delta: StarCellDelta): void;
  subscribe(listener: () => void): () => void;
  getCells(): StarCellData[];
  getCell(cellKey: StarCellKey): StarCellData | null;
  getStarCount(): number;
  stars(): Iterable<StarRow>;
  getObjectRef(cellKey: StarCellKey, objectIndex: number): StarObjectRef | null;
  getPickMeta(cellKey: StarCellKey, objectIndex: number): StarPickMeta | null;
  getSnapshot(): StarCellStoreSnapshot;
  clear(): void;
}

export interface ConsumeStarCellDeltasResult {
  processed: number;
  stoppedOn: 'current' | null;
}

export interface ApparentMagnitudeInput {
  magAbs: number;
  distancePc: number;
}

export declare const ERR_STAR_CELLS_TRANSFER_UNAVAILABLE: 'ERR_STAR_CELLS_TRANSFER_UNAVAILABLE';
export declare const ERR_STAR_TREE_INVALID_VIEW: 'ERR_STAR_TREE_INVALID_VIEW';

export declare function createObserverShellStrategy(): StarCellStrategy;

export declare function createStarCellRefStrategy(
  refOrRefs: StarCellRef | StarObjectRef | Iterable<StarCellRef | StarObjectRef>
): StarCellStrategy;

export declare function createTargetFrustumStrategy(
  options?: TargetFrustumStrategyOptions
): StarCellStrategy;

export declare function createSphereVolumeStrategy(
  options: SphereVolumeStrategyOptions
): StarCellStrategy;

export declare function createPathVolumeStrategy(
  options: PathVolumeStrategyOptions
): StarCellStrategy;

export declare function createLookaheadStrategy(
  options: LookaheadStrategyOptions
): StarCellStrategy;

export declare function createWarmStrategy(
  base: StarCellStrategy,
  options?: WarmStrategyOptions
): StarCellStrategy;

export declare function combineStrategies(
  strategies: StarCellStrategy[]
): StarCellStrategy;

export declare function compareStarCellPriority(
  left?: StarCellPriority,
  right?: StarCellPriority
): number;

export declare function normalizeStarCellStrategyView(
  strategy: StarCellStrategy,
  view?: StarTreeViewPatch
): StarTreeViewPatch;

export declare function normalizeObserverShellView(
  view?: StarTreeViewPatch
): StarTreeViewPatch & {
  observerPc: StarTreePointPc;
  limitingMagnitude: number;
};

export declare function normalizeTargetFrustumView(
  view?: StarTreeViewPatch,
  strategy?: TargetFrustumStrategyOptions
): StarTreeViewPatch & {
  observerPc: StarTreePointPc;
  limitingMagnitude: number;
  verticalFovDeg: number;
  aspectRatio: number;
  nearPc: number;
  frustumMode: 'orientation' | 'target' | 'direction';
};

export declare function loadRadiusForMagnitudeShell(
  halfSize: number,
  limitingMagnitude: number,
  indexMagnitude: number
): number;

export declare function distanceToCellAabbPc(
  point: StarTreePointPc,
  cell: StarTreeCellGeometry
): number;

export declare function distancePointToPathPc(
  point: StarTreePointPc,
  pointsPc: StarTreePointPc[]
): number;

export declare function createPathDistanceEvaluator(
  pointsPc: StarTreePointPc[]
): {
  points: StarTreePointPc[];
  distanceToPoint(point: StarTreePointPc): number;
  distanceToCoordinates(x: number, y: number, z: number): number;
};

export declare function buildTravelVolumeRequests(
  options: BuildTravelVolumeRequestsOptions
): StarTreePathVolumeRequest[];

export declare function createStrategyForVolumeRequest(
  request: StarTreeVolumeRequest
): StarCellStrategy;

export declare function resolveMotionLookahead(
  motion: StarTreeViewPatch['motion'],
  observerPc: StarTreePointPc
): {
  enabled: boolean;
  lookaheadSecs: number;
  lookaheadDistancePc: number;
  velocityPcPerSec: StarTreePointPc | null;
  futureObserverPc: StarTreePointPc | null;
};

export declare function evaluateStarCellStrategyChange(options: {
  strategy: StarCellStrategy;
  thresholds?: StarTreeDemandThresholds;
  previousAnchor: StarStrategyAnchor | null;
  nextAnchor: StarStrategyAnchor;
  reason?: string;
}): { replan: boolean; reasons: string[] };

export declare function normalizeStarTreeDemandThresholds(
  thresholds?: StarTreeDemandThresholds
): StarTreeDemandThresholds;

export declare function createFrustumTester(
  view: ReturnType<typeof normalizeTargetFrustumView>
): {
  basis: {
    right: StarTreePointPc;
    up: StarTreePointPc;
    forward: StarTreePointPc;
  };
  containsPoint(point: StarTreePointPc): boolean;
  intersectsCell(cell: StarTreeCellGeometry): boolean;
  nearestVisiblePointToCell(cell: StarTreeCellGeometry): {
    point: StarTreePointPc;
    distancePc: number;
    forwardDistancePc: number;
  } | null;
};

export declare function quaternionToCameraBasis(
  quaternion: { x: number; y: number; z: number; w: number }
): {
  right: StarTreePointPc;
  up: StarTreePointPc;
  forward: StarTreePointPc;
};

export declare function createStarCellData<Node = StarCellSourceNode>(
  options: CreateStarCellDataOptions<Node>
): StarCellData;

export declare function estimateStarCellBytes(cell: StarCellData): number;

export declare function createStarCellStore(): StarCellStore;

export declare function consumeStarCellDeltas(
  deltas: AsyncIterable<StarCellDelta> | Iterable<StarCellDelta>,
  store: StarCellStore,
  options?: { stopOnCurrent?: boolean; throwOnError?: boolean }
): Promise<ConsumeStarCellDeltasResult>;

export declare function encodeMorton3D(
  gridX: number,
  gridY: number,
  gridZ: number,
  level: number
): bigint;

export declare function decodeMorton3D(
  mortonCode: bigint | number | string,
  level: number
): { gridX: number; gridY: number; gridZ: number };

export declare function createStarCellKey(
  levelOrCell: number | { level: number; mortonCode?: string | number | bigint; gridX?: number; gridY?: number; gridZ?: number },
  mortonCode?: string | number | bigint
): StarCellKey;

export declare function parseStarCellKey(cellKey: string): StarCellRef;

export declare function apparentMagnitude(input: ApparentMagnitudeInput): number;

export declare function decodeTemperatureK(teffLog8: number): number;

export declare function temperatureToRgb(
  teffLog8OrTemperatureK: number,
  options?: { input?: 'teffLog8' | 'kelvin' }
): [number, number, number];

export declare function supportsTransferableBuffers(): boolean;
