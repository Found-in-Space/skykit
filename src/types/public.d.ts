import type { BufferGeometry, Matrix4, Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';

export type Unsubscribe = () => void;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export type Point3Like = Readonly<Point3>;
export type SceneVector3 = readonly [number, number, number];

export interface Size2D {
  width: number;
  height: number;
}

export interface StarDataId {
  version: number;
  datasetUuid: string;
  level: number;
  mortonCode: string;
  ordinal: number;
}

export interface PickMeta {
  nodeKey: string;
  level: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  ordinal: number;
}

export interface OctreeNodeGeometry {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
}

export interface OctreeNodeLike {
  nodeKey: string;
  level: number;
  centerX?: number;
  centerY?: number;
  centerZ?: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  payloadLength?: number;
  geom?: OctreeNodeGeometry;
  [key: string]: unknown;
}

export interface ViewerNodeSelection<Node extends OctreeNodeLike = OctreeNodeLike> {
  strategy: string | null;
  nodes: Node[];
  meta: Record<string, unknown>;
}

export interface RuntimePartStats {
  [key: string]: unknown;
}

export interface ViewerRuntimePart {
  id?: string;
  attach?(context: ViewerRuntimeContext): void | Promise<void>;
  start?(context: ViewerRuntimeContext): void | Promise<void>;
  update?(context: ViewerRuntimeFrameContext): void | Promise<void>;
  resize?(context: ViewerRuntimeResizeContext): void | Promise<void>;
  dispose?(context: ViewerRuntimeContext): void | Promise<void>;
  selectNodes?(context: ViewerRuntimeContext): ViewerNodeSelection | Promise<ViewerNodeSelection>;
  getStats?(): RuntimePartStats | null;
  [key: string]: unknown;
}

export interface ViewerPartSnapshot {
  kind: 'interestField' | 'controller' | 'layer' | 'overlay' | string;
  id: string | null;
  stats: RuntimePartStats | null;
}

export interface ViewerRigSnapshot {
  navigationRoot: {
    position: number[];
  };
  cameraMount: {
    position: number[];
  };
  deck?: {
    position: number[];
  };
  attachmentRoot?: {
    position: number[];
  };
}

export interface ViewerXrSnapshot {
  enabled: boolean;
  presenting: boolean;
  sessionMode: string | null;
  referenceSpaceType: string | null;
}

export interface DatasetSidecarDescriptor {
  name?: string;
  url?: string | null;
  [key: string]: unknown;
}

export interface DatasetDescription {
  id: string;
  manifestUrl: string | null;
  octreeUrl: string | null;
  metaUrl: string | null;
  identifiersOrderUrl: string | null;
  versionKey: string;
  datasetUuid: string | null;
  datasetIdentitySource: string | null;
  capabilities: Record<string, unknown>;
  sidecars: Record<string, DatasetSidecarDescriptor>;
  persistentCache: unknown;
  disposed: boolean;
  cacheSizes: Record<string, number>;
  services: {
    render: unknown;
    sidecars: Record<string, unknown>;
  };
}

export interface DatasetSessionOptions {
  id?: string;
  manifestUrl?: string | null;
  octreeUrl?: string | null;
  metaUrl?: string | null;
  identifiersOrderUrl?: string | null;
  versionKey?: string | null;
  datasetUuid?: string | null;
  capabilities?: Record<string, unknown>;
  sidecars?: Record<string, string | DatasetSidecarDescriptor>;
  persistentCache?: unknown;
}

export interface FoundInSpaceDatasetOptions extends DatasetSessionOptions {
  capabilities?: Record<string, unknown>;
  sidecars?: Record<string, string | DatasetSidecarDescriptor>;
}

export interface DatasetSnapshot {
  kind: 'dataset';
  dataset: DatasetDescription;
  loading: {
    bootstrap: 'idle' | 'loading' | 'ready' | string;
    rootShard: 'idle' | 'loading' | 'ready' | string;
  };
}

export interface ViewerSnapshot<TState extends object = Record<string, unknown>> {
  id: string;
  initialized: boolean;
  running: boolean;
  disposed: boolean;
  size: Size2D;
  state: TState;
  selection: ViewerNodeSelection;
  frameNumber: number;
  datasetSession: DatasetDescription | null;
  xr: ViewerXrSnapshot;
  rigType: string;
  rig: ViewerRigSnapshot;
  parts: ViewerPartSnapshot[];
}

export interface JourneyStateSnapshot {
  activeSceneId: string | null;
  previousSceneId: string | null;
  transitionId: string | null;
  lastSource: string | null;
}

export interface JourneySnapshot {
  journey: JourneyStateSnapshot;
  [key: string]: unknown;
}

export interface QuerySelectionStats {
  [key: string]: unknown;
}

export interface ResolvedStar<TSidecars extends Record<string, unknown> = Record<string, unknown>> {
  id: StarDataId | null;
  pickMeta: PickMeta;
  nodeKey: string;
  positionScene: SceneVector3;
  positionPc: Point3;
  distancePc: number | null;
  absoluteMagnitude: number;
  apparentMagnitude: number | null;
  temperatureK: number | null;
  sidecars?: TSidecars;
}

export interface NearestStarsResult<TSidecars extends Record<string, unknown> = Record<string, unknown>> {
  kind: 'nearest-stars';
  centerPc: Point3;
  count: number;
  radiusPc: number;
  iterationCount: number;
  selection: ViewerNodeSelection | null;
  stars: Array<ResolvedStar<TSidecars>>;
}

export interface VisibleStarsResult<TSidecars extends Record<string, unknown> = Record<string, unknown>> {
  kind: 'visible-stars';
  strategy: string;
  observerPc: Point3;
  targetPc: Point3 | null;
  selection: ViewerNodeSelection | null;
  stats: QuerySelectionStats;
  stars: Array<ResolvedStar<TSidecars>>;
}

export interface VisibleSelectionResult {
  strategy: string;
  selection: ViewerNodeSelection;
}

export interface DecodedStarsOptions<TSidecars extends Record<string, unknown> = Record<string, unknown>> {
  bootstrap?: RenderBootstrapLike;
  observerPc?: Point3Like | null;
  includeSidecars?: readonly string[];
  filterStar?: (star: ResolvedStar<TSidecars>, context: { node: OctreeNodeLike; ordinal: number }) => boolean;
  limit?: number;
  sortBy?: 'distance' | 'apparentMagnitude' | 'absoluteMagnitude' | string;
  sortResults?: (left: ResolvedStar<TSidecars>, right: ResolvedStar<TSidecars>) => number;
}

export interface VisibleStarsQueryOptions<TSidecars extends Record<string, unknown> = Record<string, unknown>>
  extends DecodedStarsOptions<TSidecars> {
  observerPc?: Point3Like | null;
  targetPc?: Point3Like | null;
  strategy?: 'observer-shell' | 'target-frustum' | string;
  width?: number;
  height?: number;
  mDesired?: number;
  verticalFovDeg?: number;
  overscanDeg?: number;
  targetRadiusPc?: number;
  preloadDistancePc?: number;
  nearPc?: number;
  farPc?: number;
  aspectRatio?: number;
  maxLevel?: number;
  motionAdaptiveMaxLevel?: number;
  selectNodes?: (context: ViewerRuntimeContext) => ViewerNodeSelection | Promise<ViewerNodeSelection>;
}

export interface NearestStarsQueryOptions<TSidecars extends Record<string, unknown> = Record<string, unknown>> {
  centerPc?: Point3Like | null;
  observerPc?: Point3Like | null;
  count?: number;
  initialRadiusPc?: number;
  maxRadiusPc?: number;
  expansionFactor?: number;
  maxLevel?: number;
  includeSidecars?: readonly string[];
}

export interface SphereSelectionOptions {
  centerPc?: Point3Like | null;
  observerPc?: Point3Like | null;
  radiusPc?: number;
  maxLevel?: number;
  sortNodes?: (left: OctreeNodeLike, right: OctreeNodeLike) => number;
}

export interface RenderBootstrapLike {
  datasetUuid?: string | null;
  [key: string]: unknown;
}

export interface ResolvedStarLookup<TSidecars extends Record<string, unknown> = Record<string, unknown>> {
  id: StarDataId;
  nodeKey: string;
  pickMeta: PickMeta;
  positionScene: SceneVector3;
  positionPc: number[];
  absoluteMagnitude: number;
  temperatureK?: number;
  sidecars?: TSidecars;
}

export interface SidecarMetaFields {
  properName: string;
  bayer: string;
  hd: string;
  hip: string;
  gaia: string;
  primaryLabel: string;
}

export interface ResolvedPickMeta {
  id: StarDataId;
  pickMeta: PickMeta;
  node: OctreeNodeLike;
}

export interface ViewerFrameSnapshot {
  deltaSeconds: number;
  elapsedSeconds: number;
  frameNumber: number;
  timeMs: number;
}

export interface ViewerRuntimeContext<TState extends object = Record<string, unknown>> {
  runtime: unknown;
  datasetSession: unknown;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  mount: Object3D;
  contentRoot: Object3D;
  navigationRoot: Object3D;
  cameraMount: Object3D;
  attachmentRoot: Object3D | null;
  deck: Object3D | null;
  rigType: string;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  size: Size2D;
  state: TState;
  selection: ViewerNodeSelection;
  xr: {
    enabled: boolean;
    presenting: boolean;
    sessionMode: string | null;
    referenceSpace: unknown;
    referenceSpaceType: string | null;
    session: unknown;
    frame: unknown;
  };
  phase: string;
  [key: string]: unknown;
}

export interface ViewerRuntimeFrameContext<TState extends object = Record<string, unknown>>
  extends ViewerRuntimeContext<TState> {
  frame: ViewerFrameSnapshot;
}

export interface ViewerRuntimeResizeContext<TState extends object = Record<string, unknown>>
  extends ViewerRuntimeContext<TState> {
  previousSize: Size2D | null;
}

export type CameraRigOrientationLike = Vector3 | SceneVector3 | number[];

export interface CameraRig {
  positionPc: Vector3;
  orientation: unknown;
  velocity: Vector3;
  sceneScale: number;
  icrsToScene(x: number, y: number, z: number): Vector3;
  sceneToIcrs(x: number, y: number, z: number): Vector3;
  getForward(target?: Vector3): Vector3;
  getRight(target?: Vector3): Vector3;
  getUp(target?: Vector3): Vector3;
  rotateLocal(yawRadians?: number, pitchRadians?: number, rollRadians?: number): CameraRig;
  moveInSceneDirection(direction: Vector3 | SceneVector3 | number[], distanceSceneUnits: number): CameraRig;
  applyToCamera(camera: PerspectiveCamera): CameraRig;
  applyLookAtToCamera(camera: PerspectiveCamera, targetPc: Point3Like): CameraRig;
  orientToward(targetPc: Point3Like, upHint?: Point3Like | null): CameraRig;
  computeOrientationToward(targetPc: Point3Like, upHint?: Point3Like | null): unknown;
  slerpToward(targetPc: Point3Like, alpha?: number, upHint?: Point3Like | null): CameraRig;
  setPosition(positionPc: Point3Like): CameraRig;
  clonePosition(): Point3;
}

export interface PolylineRoute {
  points: Point3[];
  distancesPc: number[];
  totalDistancePc: number;
}

export interface OrbitalInsertRoute extends Record<string, unknown> {
  type: 'orbital-insert';
  startPc: Point3;
}

export interface CameraRigControllerStats extends Record<string, unknown> {}

export interface CameraRigController extends ViewerRuntimePart {
  rig: CameraRig;
  flyTo(targetPc: Point3Like, options?: Record<string, unknown>): Promise<unknown>;
  orbit(centerPc: Point3Like, options?: Record<string, unknown>): Promise<unknown>;
  orbitalInsert(startPc: Point3Like, options?: Record<string, unknown>): Promise<unknown>;
  flyPolyline(points: readonly Point3Like[], options?: Record<string, unknown>): Promise<unknown>;
  lookAt(targetPc: Point3Like, options?: Record<string, unknown>): void;
  lockAt(targetPc: Point3Like, options?: Record<string, unknown>): void;
  unlockAt(): void;
  cancelMovement(): void;
  cancelOrientation(): void;
  cancelAutomation(): void;
  simulateKeyDown(code: string): void;
  simulateKeyUp(code: string): void;
  getStats(): CameraRigControllerStats;
}

export interface PickController extends ViewerRuntimePart {
  setToleranceDeg(toleranceDeg: number): void;
  clearSelection(): void;
  setSelectionPosition(positionPc: Point3Like | null): void;
}

export interface XrPickController extends ViewerRuntimePart {}

export interface SelectionRefreshSnapshot {
  observerPc: Point3 | null;
  size: Size2D | null;
  mDesired: number | null;
  selectionStrategy: string | null;
}

export interface SelectionRefreshController extends ViewerRuntimePart {
  captureSnapshot(snapshot: ViewerSnapshot): SelectionRefreshSnapshot;
}

export interface HudPresetKey {
  code: string;
  symbol: string;
  gridArea: string;
}

export interface HudPreset {
  id: string;
  label: string;
  gridTemplate: string;
  gridColumns: string;
  keys: HudPresetKey[];
}

export interface TouchDisplayItem extends Record<string, unknown> {
  id: string;
  label?: string;
}

export interface TouchDisplayHit {
  itemId: string | null;
  point: {
    x: number;
    y: number;
  };
}

export interface TouchDisplay {
  canvas: HTMLCanvasElement;
  draw(): void;
  getItem(id: string): TouchDisplayItem | null;
  getRectForItem(id: string): DOMRect | null;
  getItems(): TouchDisplayItem[];
  handlePointer(hit: TouchDisplayHit | null, pressed?: boolean): unknown;
  markDirty(): void;
  emit(target?: EventTarget | null): void;
  setDisplay(id: string, lines: readonly string[]): void;
  setItems(nextItems: readonly TouchDisplayItem[]): void;
  setItemValue(id: string, value: unknown): void;
}

export interface HRDiagramValue extends Record<string, unknown> {}

export interface HRDiagramControl extends Record<string, unknown> {}

export interface VolumeHrLoadProgress extends Record<string, unknown> {
  phase: string;
  nodeCount?: number;
  starCount?: number;
}

export interface VolumeHrLoadResult {
  geometry: BufferGeometry;
  starCount: number;
  nodeCount: number;
  decodedStarCount: number;
  stats: Record<string, unknown> | null;
}

export interface VolumeHRLoader {
  load(options: {
    observerPc: Point3Like;
    maxRadiusPc: number;
    maxLevel?: number;
    onProgress?: (progress: VolumeHrLoadProgress) => void;
    selectionMode?: 'sphere' | 'node-cache' | string;
  }): Promise<VolumeHrLoadResult | null>;
  preloadVolume(options: {
    observerPc: Point3Like;
    maxRadiusPc: number;
    maxLevel?: number;
    onProgress?: (progress: VolumeHrLoadProgress) => void;
  }): Promise<(Pick<VolumeHrLoadResult, 'nodeCount' | 'decodedStarCount' | 'stats'>) | null>;
  preloadPath(options: {
    points: readonly Point3Like[];
    maxRadiusPc: number;
    maxLevel?: number;
    onProgress?: (progress: VolumeHrLoadProgress) => void;
  }): Promise<(Pick<VolumeHrLoadResult, 'nodeCount' | 'decodedStarCount' | 'stats'>) | null>;
  cancel(): void;
}

export interface StarFieldState {
  [key: string]: unknown;
  starFieldScale: number;
  starFieldExtinctionScale: number;
  starFieldExposure: number;
  starFieldMagFadeRange: number;
  starFieldBaseSize: number;
  starFieldSizeMax: number;
  starFieldSizeFluxScale: number;
  starFieldSizeScale: number;
  starFieldSizePower: number;
  starFieldGlowScale: number;
  starFieldGlowPower: number;
  starFieldNearMagLimitFloor: number;
  starFieldNearMagLimitRadiusPc: number;
  starFieldNearMagLimitFeatherPc: number;
  starFieldNearSizeFloor: number;
  starFieldNearAlphaFloor: number;
  mDesired: number;
}

export interface StarFieldMaterialProfile extends Record<string, unknown> {}

export interface RuntimeRig {
  type: string;
  navigationRoot: Object3D;
  cameraMount: Object3D;
  attachmentRoot: Object3D | null;
  deck: Object3D | null;
  contentRoot: Object3D;
  mount: Object3D;
}

export interface ViewerCreateOptions<TState extends object = Record<string, unknown>> {
  id?: string;
  host?: HTMLElement | HTMLCanvasElement;
  datasetSession?: unknown;
  dataset?: unknown;
  datasetOptions?: DatasetSessionOptions;
  interestField?: ViewerRuntimePart | null;
  layers?: readonly ViewerRuntimePart[];
  layer?: ViewerRuntimePart | readonly ViewerRuntimePart[];
  controllers?: readonly ViewerRuntimePart[];
  controller?: ViewerRuntimePart | readonly ViewerRuntimePart[];
  overlays?: readonly ViewerRuntimePart[];
  overlay?: ViewerRuntimePart | readonly ViewerRuntimePart[];
  autoStart?: boolean;
  observeResize?: boolean;
  state?: TState;
  scene?: Scene;
  camera?: PerspectiveCamera;
  renderer?: WebGLRenderer;
  rig?: RuntimeRig;
  antialias?: boolean;
  alpha?: boolean;
  xrCompatible?: boolean;
  pixelRatio?: number;
  clearColor?: number;
}

export interface DefaultViewerState extends StarFieldState {
  observerPc: Point3;
}

export interface DefaultViewerOptions<TState extends object = DefaultViewerState>
  extends ViewerCreateOptions<TState> {
  starFieldLayerId?: string;
  materialFactory?: () => StarFieldMaterialProfile;
  cameraControllerId?: string;
  selectionRefreshControllerId?: string;
  interestFieldId?: string;
}

export interface ViewerHandle<TState extends object = Record<string, unknown>, TCommand extends CommandBase = ViewerCommand<TState>, TEvent extends EventBase<ViewerSnapshot<TState>> = ViewerEvent<TState, TCommand>> {
  runtime: unknown;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  datasetSession: unknown;
  mount: Object3D;
  contentRoot: Object3D;
  navigationRoot: Object3D;
  cameraMount: Object3D;
  attachmentRoot: Object3D | null;
  deck: Object3D | null;
  rigType: string;
  start(): Promise<unknown>;
  stop(): unknown;
  isXrModeSupported(mode?: string): Promise<boolean>;
  enterXR(options?: ViewerXrEnterOptions): Promise<unknown>;
  exitXR(): Promise<boolean>;
  resize(widthOrSize?: number | Size2D, height?: number): Promise<Size2D>;
  refreshSelection(): Promise<ViewerNodeSelection>;
  setState(nextState: Partial<TState>): TState;
  getSnapshotState(): ViewerSnapshot<TState>;
  getSnapshot(): ViewerSnapshot<TState>;
  dispatch<TSpecificCommand extends TCommand>(command: TSpecificCommand): Promise<DispatchResult<ViewerSnapshot<TState>, DispatchResultOf<TCommand, TSpecificCommand>>>;
  select(): ViewerSnapshot<TState>;
  select<TKey extends Extract<keyof ViewerSnapshot<TState>, string>>(key: TKey): ViewerSnapshot<TState>[TKey];
  select<TResult>(selector: (snapshot: ViewerSnapshot<TState>) => TResult): TResult;
  subscribe(listener: (event: TEvent) => void): Unsubscribe;
  dispose(): Promise<void>;
}

export interface ViewerXrEnterOptions {
  mode?: string;
  referenceSpaceType?: string;
  sessionInit?: Record<string, unknown>;
  near?: number;
  far?: number;
  [key: string]: unknown;
}

export type HookHandler<TValue = unknown, TContext = unknown> =
  (value: TValue, context: TContext) => TValue | void | Promise<TValue | void>;

export interface EventBase<TSnapshot = unknown> {
  type: string;
  timeMs?: number;
  snapshot?: TSnapshot | null;
  [key: string]: unknown;
}

export type SkyKitEvent<Type extends string, Payload extends object = {}, TSnapshot = unknown> =
  Payload & {
    type: Type;
    timeMs?: number;
    snapshot?: TSnapshot | null;
  };

export interface CommandBase {
  type: string;
  [key: string]: unknown;
}

export type SkyKitCommand<Type extends string, Payload extends object = {}, Result = unknown> =
  Payload & {
    type: Type;
    readonly __resultType__?: Result;
  };

export interface DispatchResult<TSnapshot, TResult = unknown> {
  handled: boolean;
  result: TResult | null;
  snapshot: TSnapshot;
}

export interface CommandFailedError {
  message: string;
}

export interface SnapshotSetMeta {
  type?: string;
  commandType?: string | null;
  reason?: string | null;
  detail?: unknown;
}

export interface HookInvocationContext<
  TSnapshot,
  TCommand extends CommandBase,
  TEvent extends EventBase<TSnapshot>,
> {
  dispatch<TSpecificCommand extends TCommand>(command: TSpecificCommand): Promise<DispatchResult<TSnapshot, DispatchResultOf<TCommand, TSpecificCommand>>>;
  getSnapshot(): TSnapshot;
  select(): TSnapshot;
  select<TKey extends Extract<keyof TSnapshot, string>>(key: TKey): TSnapshot[TKey];
  select<TResult>(selector: (snapshot: TSnapshot) => TResult): TResult;
  subscribe(listener: (event: TEvent) => void): Unsubscribe;
}

export interface HookMap<
  TSnapshot = unknown,
  TCommand extends CommandBase = CommandBase,
  TEvent extends EventBase<TSnapshot> = EventBase<TSnapshot>,
> {
  [name: string]: HookHandler<any, HookInvocationContext<TSnapshot, TCommand, TEvent>>;
}

export interface SkyKitBuiltinHookMap<
  TSnapshot = unknown,
  TCommand extends CommandBase = CommandBase,
  TEvent extends EventBase<TSnapshot> = EventBase<TSnapshot>,
> extends HookMap<TSnapshot, TCommand, TEvent> {
  'selection:resolve': HookHandler<ViewerNodeSelection | null, HookInvocationContext<TSnapshot, TCommand, TEvent>>;
  'preload:resolve': HookHandler<readonly unknown[], HookInvocationContext<TSnapshot, TCommand, TEvent>>;
  'decode:selected-stars': HookHandler<readonly ResolvedStar[], HookInvocationContext<TSnapshot, TCommand, TEvent>>;
  'material:decorate': HookHandler<Record<string, unknown>, HookInvocationContext<TSnapshot, TCommand, TEvent>>;
  'movement:resolve-strategy': HookHandler<Record<string, unknown>, HookInvocationContext<TSnapshot, TCommand, TEvent>>;
  'journey:resolve-scene': HookHandler<JourneyResolvedSceneSpec, HookInvocationContext<TSnapshot, TCommand, TEvent>>;
}

export type HookValueOf<THandler> = THandler extends (value: infer TValue, context: any) => any ? TValue : unknown;

export interface CommandHandlerContext<
  TSnapshot,
  TCommand extends CommandBase,
  TEvent extends EventBase<TSnapshot>,
  THookMap extends HookMap<TSnapshot, TCommand, TEvent>,
  TSpecificCommand extends TCommand = TCommand,
> extends HookInvocationContext<TSnapshot, TCommand, TEvent> {
  command: TSpecificCommand;
  emit<TSpecificEvent extends TEvent>(event: TSpecificEvent): TSpecificEvent;
  setSnapshot(nextSnapshot: TSnapshot, meta?: SnapshotSetMeta): TSnapshot;
  updateSnapshot(nextSnapshot: TSnapshot | ((currentSnapshot: TSnapshot) => TSnapshot), meta?: SnapshotSetMeta): TSnapshot;
  runHook<Name extends keyof THookMap & string>(name: Name, value: HookValueOf<THookMap[Name]>, context?: Partial<HookInvocationContext<TSnapshot, TCommand, TEvent>>): Promise<HookValueOf<THookMap[Name]>>;
  registerHook<Name extends keyof THookMap & string>(name: Name, handler: THookMap[Name]): Unsubscribe;
}

export type CommandHandler<
  TSnapshot,
  TCommand extends CommandBase,
  TEvent extends EventBase<TSnapshot>,
  THookMap extends HookMap<TSnapshot, TCommand, TEvent>,
  TSpecificCommand extends TCommand = TCommand,
> = (context: CommandHandlerContext<TSnapshot, TCommand, TEvent, THookMap, TSpecificCommand>) => unknown | Promise<unknown>;

export interface SkyKitPluginApi<
  TSnapshot,
  TCommand extends CommandBase,
  TEvent extends EventBase<TSnapshot>,
  THookMap extends HookMap<TSnapshot, TCommand, TEvent>,
> extends HookInvocationContext<TSnapshot, TCommand, TEvent> {
  registerHook<Name extends keyof THookMap & string>(name: Name, handler: THookMap[Name]): Unsubscribe;
}

export interface SkyKitPlugin<
  TSnapshot = unknown,
  TCommand extends CommandBase = CommandBase,
  TEvent extends EventBase<TSnapshot> = EventBase<TSnapshot>,
  THookMap extends HookMap<TSnapshot, TCommand, TEvent> = HookMap<TSnapshot, TCommand, TEvent>,
> {
  name?: string;
  setup(api: SkyKitPluginApi<TSnapshot, TCommand, TEvent, THookMap>): unknown;
}

export interface SnapshotControllerOptions<
  TSnapshot,
  TCommand extends CommandBase,
  TEvent extends EventBase<TSnapshot>,
  THookMap extends HookMap<TSnapshot, TCommand, TEvent>,
> {
  initialSnapshot?: TSnapshot;
  commandHandlers?: Partial<{
    [Type in TCommand['type']]: CommandHandler<TSnapshot, TCommand, TEvent, THookMap, Extract<TCommand, { type: Type }>>
      | ReadonlyArray<CommandHandler<TSnapshot, TCommand, TEvent, THookMap, Extract<TCommand, { type: Type }>>>;
  }>;
}

export interface SnapshotController<
  TSnapshot,
  TCommand extends CommandBase = CommandBase,
  TEvent extends EventBase<TSnapshot> = SnapshotControllerEvent<TSnapshot, TCommand>,
  THookMap extends HookMap<TSnapshot, TCommand, TEvent> = SkyKitBuiltinHookMap<TSnapshot, TCommand, TEvent>,
> extends SkyKitPluginApi<TSnapshot, TCommand, TEvent, THookMap> {
  emit<TSpecificEvent extends TEvent>(event: TSpecificEvent): TSpecificEvent;
  getSnapshot(): TSnapshot;
  select(): TSnapshot;
  select<TKey extends Extract<keyof TSnapshot, string>>(key: TKey): TSnapshot[TKey];
  select<TResult>(selector: (snapshot: TSnapshot) => TResult): TResult;
  subscribe(listener: (event: TEvent) => void): Unsubscribe;
  setSnapshot(nextSnapshot: TSnapshot, meta?: SnapshotSetMeta): TSnapshot;
  updateSnapshot(nextSnapshot: TSnapshot | ((currentSnapshot: TSnapshot) => TSnapshot), meta?: SnapshotSetMeta): TSnapshot;
  addCommandHandler<Type extends TCommand['type']>(
    type: Type,
    handler: CommandHandler<TSnapshot, TCommand, TEvent, THookMap, Extract<TCommand, { type: Type }>>,
  ): Unsubscribe;
  registerHook<Name extends keyof THookMap & string>(name: Name, handler: THookMap[Name]): Unsubscribe;
  runHook<Name extends keyof THookMap & string>(name: Name, value: HookValueOf<THookMap[Name]>, context?: Partial<HookInvocationContext<TSnapshot, TCommand, TEvent>>): Promise<HookValueOf<THookMap[Name]>>;
  registerPlugin(plugin: SkyKitPlugin<TSnapshot, TCommand, TEvent, THookMap>): unknown;
}

export type SnapshotStateChangedEvent<TSnapshot, TCommand extends CommandBase = CommandBase> = SkyKitEvent<
  'state/changed',
  {
    commandType?: TCommand['type'] | null;
    reason?: string | null;
    detail?: unknown;
  },
  TSnapshot
>;

export type CommandDispatchedEvent<TSnapshot, TCommand extends CommandBase = CommandBase> = SkyKitEvent<
  'command/dispatched',
  {
    command: TCommand;
  },
  TSnapshot
>;

export type CommandCompletedEvent<TSnapshot, TCommand extends CommandBase = CommandBase> = SkyKitEvent<
  'command/completed',
  {
    command: TCommand;
    result: CommandResultOf<TCommand> | null;
  },
  TSnapshot
>;

export type CommandFailedEvent<TSnapshot, TCommand extends CommandBase = CommandBase> = SkyKitEvent<
  'command/failed',
  {
    command: TCommand;
    error: CommandFailedError;
  },
  TSnapshot
>;

export type DiagnosticWarnEvent<TSnapshot, TCommand extends CommandBase = CommandBase> = SkyKitEvent<
  'diagnostic/warn',
  {
    code: string;
    command?: TCommand;
  },
  TSnapshot
>;

export type SnapshotControllerEvent<TSnapshot, TCommand extends CommandBase = CommandBase> =
  | SnapshotStateChangedEvent<TSnapshot, TCommand>
  | CommandDispatchedEvent<TSnapshot, TCommand>
  | CommandCompletedEvent<TSnapshot, TCommand>
  | CommandFailedEvent<TSnapshot, TCommand>
  | DiagnosticWarnEvent<TSnapshot, TCommand>;

export type DatasetRefreshCommand = SkyKitCommand<'dataset/refresh', {}, DatasetDescription>;
export type DatasetEnsureBootstrapCommand = SkyKitCommand<'dataset/ensure-bootstrap', {}, RenderBootstrapLike>;
export type DatasetEnsureRootShardCommand = SkyKitCommand<'dataset/ensure-root-shard', {}, unknown>;
export type DatasetDisposeCommand = SkyKitCommand<'dataset/dispose', {}, true>;

export type DatasetCommand =
  | DatasetRefreshCommand
  | DatasetEnsureBootstrapCommand
  | DatasetEnsureRootShardCommand
  | DatasetDisposeCommand;

export type ViewerStateMergeCommand<TState extends object = Record<string, unknown>> =
  SkyKitCommand<'state/merge', {
    state?: Partial<TState>;
    patch?: Partial<TState>;
  }, TState>;

export type ViewerSelectionRefreshCommand = SkyKitCommand<'selection/refresh', {}, ViewerNodeSelection>;
export type ViewerStartCommand = SkyKitCommand<'viewer/start', {}, { running: boolean }>;
export type ViewerStopCommand = SkyKitCommand<'viewer/stop', {}, { running: boolean }>;
export type ViewerRenderOnceCommand = SkyKitCommand<'viewer/render-once', {}, null>;
export type ViewerResizeCommand = SkyKitCommand<'viewer/resize', {
  size?: Size2D;
  width?: number;
  height?: number;
}, Size2D>;
export type ViewerEnterXrCommand = SkyKitCommand<'xr/enter', ViewerXrEnterOptions & {
  options?: ViewerXrEnterOptions;
}, {
  sessionMode: string | null;
  presenting: boolean;
  session: unknown;
}>;
export type ViewerExitXrCommand = SkyKitCommand<'xr/exit', {}, {
  exited: boolean;
  presenting: boolean;
}>;

export type ViewerCommand<TState extends object = Record<string, unknown>> =
  | ViewerStateMergeCommand<TState>
  | ViewerSelectionRefreshCommand
  | ViewerStartCommand
  | ViewerStopCommand
  | ViewerRenderOnceCommand
  | ViewerResizeCommand
  | ViewerEnterXrCommand
  | ViewerExitXrCommand;

export interface JourneySceneSpec<TCommand extends CommandBase = CommandBase> {
  sceneId?: string;
  commands?: readonly TCommand[];
  [key: string]: unknown;
}

export type JourneyTransitionEndpoints =
  | {
    fromSceneId: string;
    toSceneId: string;
    from?: never;
    to?: never;
  }
  | {
    from: string;
    to: string;
    fromSceneId?: never;
    toSceneId?: never;
  }
  | {
    fromSceneId: string;
    to: string;
    from?: never;
    toSceneId?: never;
  }
  | {
    from: string;
    toSceneId: string;
    fromSceneId?: never;
    to?: never;
  };

export type JourneyTransitionSpec<TCommand extends CommandBase = CommandBase> = JourneySceneSpec<TCommand> & JourneyTransitionEndpoints & {
  id?: string;
};

export interface JourneyResolvedSceneSpec<TCommand extends CommandBase = CommandBase> extends JourneySceneSpec<TCommand> {
  sceneId: string;
  transitionId?: string | null;
  fromSceneId?: string | null;
  toSceneId?: string | null;
}

export type JourneyGoToSceneCommand = SkyKitCommand<'journey/go-to-scene', {
  sceneId?: string;
  toSceneId?: string;
  fromSceneId?: string | null;
  source?: string | null;
}, JourneyResolvedSceneSpec>;

export type JourneyApplySceneCommand<TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec> = SkyKitCommand<
  'journey/apply-scene',
  {
    scene: TScene;
    sceneId?: string | null;
    fromSceneId?: string | null;
    transitionId?: string | null;
    source?: string | null;
  },
  unknown
>;

export type JourneyCommand<TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec> =
  | JourneyGoToSceneCommand
  | JourneyApplySceneCommand<TScene>;

export type BuiltinCommand<TState extends object = Record<string, unknown>, TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec> =
  | DatasetCommand
  | ViewerCommand<TState>
  | JourneyCommand<TScene>;

export type CommandResultOf<TCommand extends CommandBase> =
  TCommand extends { readonly __resultType__?: infer TResult }
    ? TResult
    : unknown;

export type ResolveKnownCommand<
  TKnownCommand extends CommandBase,
  TSpecificCommand extends CommandBase,
> = Extract<TKnownCommand, { type: TSpecificCommand['type'] }> extends never
  ? TSpecificCommand
  : Extract<TKnownCommand, { type: TSpecificCommand['type'] }>;

export type DispatchResultOf<
  TKnownCommand extends CommandBase,
  TSpecificCommand extends CommandBase,
> = CommandResultOf<ResolveKnownCommand<TKnownCommand, TSpecificCommand>>;

export type LoadingChangedEvent<TSnapshot = DatasetSnapshot> = SkyKitEvent<
  'loading/changed',
  {
    commandType?: string | null;
    reason?: string | null;
  },
  TSnapshot
>;

export type LoadingStartedEvent<TSnapshot = DatasetSnapshot> = SkyKitEvent<
  'loading/started',
  {
    stage: 'bootstrap' | 'root-shard' | string;
  },
  TSnapshot
>;

export type LoadingCompletedEvent<TSnapshot = DatasetSnapshot> = SkyKitEvent<
  'loading/completed',
  {
    stage: 'bootstrap' | 'root-shard' | string;
    dataset: DatasetDescription;
  },
  TSnapshot
>;

export type DatasetDisposedEvent<TSnapshot = DatasetSnapshot> = SkyKitEvent<
  'dataset/disposed',
  {
    dataset: DatasetDescription;
  },
  TSnapshot
>;

export type QueryStartedEvent<TSnapshot = DatasetSnapshot> = SkyKitEvent<
  'query/started',
  {
    query: 'nearest-stars' | 'visible-stars' | string;
    centerPc?: Point3;
    observerPc?: Point3;
    targetPc?: Point3 | null;
    count?: number;
  },
  TSnapshot
>;

export type QueryCompletedEvent<TSnapshot = DatasetSnapshot> = SkyKitEvent<
  'query/completed',
  {
    query: 'nearest-stars' | 'visible-stars' | string;
    strategy?: string;
    centerPc?: Point3;
    observerPc?: Point3;
    targetPc?: Point3 | null;
    count?: number;
    radiusPc?: number;
    starCount?: number;
  },
  TSnapshot
>;

export type DatasetEvent<TExtraEvent extends EventBase<DatasetSnapshot> = never> =
  | SnapshotControllerEvent<DatasetSnapshot, DatasetCommand>
  | LoadingChangedEvent<DatasetSnapshot>
  | LoadingStartedEvent<DatasetSnapshot>
  | LoadingCompletedEvent<DatasetSnapshot>
  | DatasetDisposedEvent<DatasetSnapshot>
  | QueryStartedEvent<DatasetSnapshot>
  | QueryCompletedEvent<DatasetSnapshot>
  | TExtraEvent;

export type ViewerInitializedEvent<TSnapshot> = SkyKitEvent<'viewer/initialized', {}, TSnapshot>;
export type ViewerStartedEvent<TSnapshot> = SkyKitEvent<'viewer/started', {}, TSnapshot>;
export type ViewerStoppedEvent<TSnapshot> = SkyKitEvent<'viewer/stopped', {}, TSnapshot>;
export type ViewerResizedEvent<TSnapshot> = SkyKitEvent<'viewer/resized', { size: Size2D }, TSnapshot>;
export type ViewerSelectionChangedEvent<TSnapshot> = SkyKitEvent<'selection/changed', { selection: ViewerNodeSelection }, TSnapshot>;
export type ViewerStateChangedEvent<TState extends object, TSnapshot> = SkyKitEvent<'state/changed', { state: TState }, TSnapshot>;
export type ViewerXrSessionEndedEvent<TSnapshot> = SkyKitEvent<'xr/session-ended', {}, TSnapshot>;
export type ViewerDisposedEvent<TSnapshot> = SkyKitEvent<'viewer/disposed', {}, TSnapshot>;

export type ViewerEvent<
  TState extends object = Record<string, unknown>,
  TCommand extends CommandBase = ViewerCommand<TState>,
  TExtraEvent extends EventBase<ViewerSnapshot<TState>> = never,
> =
  | CommandDispatchedEvent<ViewerSnapshot<TState>, TCommand>
  | CommandCompletedEvent<ViewerSnapshot<TState>, TCommand>
  | CommandFailedEvent<ViewerSnapshot<TState>, TCommand>
  | DiagnosticWarnEvent<ViewerSnapshot<TState>, TCommand>
  | ViewerInitializedEvent<ViewerSnapshot<TState>>
  | ViewerStartedEvent<ViewerSnapshot<TState>>
  | ViewerStoppedEvent<ViewerSnapshot<TState>>
  | ViewerResizedEvent<ViewerSnapshot<TState>>
  | ViewerSelectionChangedEvent<ViewerSnapshot<TState>>
  | ViewerStateChangedEvent<TState, ViewerSnapshot<TState>>
  | ViewerXrSessionEndedEvent<ViewerSnapshot<TState>>
  | ViewerDisposedEvent<ViewerSnapshot<TState>>
  | TExtraEvent;

export type JourneySceneExitedEvent<TSnapshot = JourneySnapshot> = SkyKitEvent<
  'journey/scene-exited',
  {
    sceneId: string;
    toSceneId: string;
    source?: string | null;
  },
  TSnapshot
>;

export type JourneySceneEnteredEvent<TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec, TSnapshot = JourneySnapshot> = SkyKitEvent<
  'journey/scene-entered',
  {
    sceneId: string;
    fromSceneId: string | null;
    transitionId: string | null;
    source?: string | null;
    scene: TScene;
  },
  TSnapshot
>;

export type JourneyEvent<
  TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec,
  TExtraEvent extends EventBase<JourneySnapshot> = never,
> =
  | SnapshotControllerEvent<JourneySnapshot, JourneyCommand<TScene>>
  | JourneySceneExitedEvent<JourneySnapshot>
  | JourneySceneEnteredEvent<TScene, JourneySnapshot>
  | TExtraEvent;

export interface DatasetHandle<
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<DatasetSnapshot> = never,
  THookMap extends HookMap<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>> = SkyKitBuiltinHookMap<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>>,
> extends SkyKitPluginApi<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>, THookMap> {
  session: unknown;
  emit<TSpecificEvent extends DatasetEvent<TExtraEvent>>(event: TSpecificEvent): TSpecificEvent;
  getSnapshot(): DatasetSnapshot;
  describe(): DatasetDescription;
  ensureBootstrap(): Promise<RenderBootstrapLike>;
  ensureRootShard(): Promise<unknown>;
  getRenderService(): unknown;
  getSidecarService(name: string): unknown;
  resolveStarById<TSidecars extends Record<string, unknown> = Record<string, unknown>>(starDataId: string | StarDataId, datasetOptions?: { includeSidecars?: readonly string[] }): Promise<ResolvedStarLookup<TSidecars> | null>;
  resolveSidecarMetaByStarId(name: string, starDataId: string | StarDataId): Promise<SidecarMetaFields | null>;
  dispose(): Promise<void>;
  registerPlugin(plugin: SkyKitPlugin<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>, THookMap>): unknown;
}

export interface JourneyGraph<TCommand extends CommandBase = CommandBase> {
  initialSceneId: string | null;
  getScene(sceneId: string): JourneyResolvedSceneSpec<TCommand> | null;
  getTransition(fromSceneId: string | null, toSceneId: string | null): JourneyTransitionSpec<TCommand> | null;
  resolveSceneSpec(sceneId: string, options?: { fromSceneId?: string | null }): JourneyResolvedSceneSpec<TCommand> | null;
  listResolvedTransitionSpecs(): Array<JourneyResolvedSceneSpec<TCommand>>;
  sceneIds: string[];
  transitions: Array<JourneyTransitionSpec<TCommand>>;
}

export interface JourneyControllerOptions<
  TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec,
  TExtraCommand extends CommandBase = never,
> {
  graph: JourneyGraph<TExtraCommand | JourneyApplySceneCommand<TScene>>;
  autoInitialize?: boolean;
  applyScene?: (scene: TScene, command: JourneyApplySceneCommand<TScene> | TExtraCommand) => unknown | Promise<unknown>;
  dispatch?: (command: JourneyApplySceneCommand<TScene> | TExtraCommand) => unknown | Promise<unknown>;
}

export interface JourneyController<
  TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec,
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<JourneySnapshot> = never,
  THookMap extends HookMap<JourneySnapshot, JourneyCommand<TScene> | TExtraCommand, JourneyEvent<TScene, TExtraEvent>> = SkyKitBuiltinHookMap<JourneySnapshot, JourneyCommand<TScene> | TExtraCommand, JourneyEvent<TScene, TExtraEvent>>,
> extends SkyKitPluginApi<JourneySnapshot, JourneyCommand<TScene> | TExtraCommand, JourneyEvent<TScene, TExtraEvent>, THookMap> {
  graph: JourneyGraph<TExtraCommand | JourneyApplySceneCommand<TScene>>;
  emit<TSpecificEvent extends JourneyEvent<TScene, TExtraEvent>>(event: TSpecificEvent): TSpecificEvent;
  getSnapshot(): JourneySnapshot;
  resolveSceneSpec(sceneId: string, fromSceneId?: string | null): TScene | null;
  activateScene(sceneId: string, options?: Omit<JourneyGoToSceneCommand, 'type' | 'sceneId' | '__resultType__'>): Promise<TScene | null>;
  registerPlugin(plugin: SkyKitPlugin<JourneySnapshot, JourneyCommand<TScene> | TExtraCommand, JourneyEvent<TScene, TExtraEvent>, THookMap>): unknown;
}
