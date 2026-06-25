import type {
  AnchoredImage,
  AnchoredImageManifest,
  LoadAnchoredImageManifestOptions,
} from '@found-in-space/anchored-image';
import type {
  SpatialPreloadHint,
  SpatialNavigationAutomation,
  SpatialNavigationAutomationOptions,
  SpatialScaleProfile,
  SpatialTargetInput,
  SpatialVector3,
} from '@found-in-space/spatial';
import type {
  StarCellDelta,
  StarCellStore,
  StarObjectRef,
  StarPickMeta,
  StarCellStrategy,
} from '@found-in-space/star-trees';
import type {
  StarOctreeCoordinateOutput,
  StarOctreeProviderService,
  StarOctreeProviderSession,
  StarOctreeSessionOptions,
  StarOctreeViewPatch,
  ViewUpdateOptions,
} from '@found-in-space/star-octree-provider';
import type {
  ThreeStarField,
  ThreeStarFieldPickOptions,
  ThreeStarFieldPickResult,
} from '@found-in-space/three-star-field';
import type {
  HrDiagramHighlightRegion,
  HrDiagramMode,
  HrDiagramSelectedStar,
} from '@found-in-space/hr-diagram';
import type { HrDiagramSurfaceSource } from '@found-in-space/hr-diagram/touch-os';
import type {
  DisplayNode,
  EmbeddedSurfaceService,
} from '@found-in-space/touch-os';
import type * as THREE from 'three';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type SkykitLookAtInput = string | SkykitLookAtSpecInput;

export interface SkykitLookAtSpecInput {
  targetPc?: Vector3Like | [number, number, number];
  raDeg?: number;
  raHours?: number;
  decDeg?: number;
  distancePc?: number;
  star?: string | StarObjectRef | StarPickMeta | unknown;
  orientationIcrs?: QuaternionLike;
  positionAngleDeg?: number;
  [key: string]: unknown;
}

export {
  createRaDecLookAt,
  parseDeclination,
  parseRightAscension,
  parseSpatialLookAtText,
} from '@found-in-space/spatial';

export interface SkykitObserverMotion {
  velocityPcPerSec: Vector3Like;
  speedPcPerSec: number;
}

export interface SkykitViewState {
  revision: number;
  observerPc: Vector3Like;
  renderObserverPosition: Vector3Like;
  lookAt?: SkykitLookAtInput | null;
  targetPc?: Vector3Like | null;
  orientationIcrs?: QuaternionLike | null;
  limitingMagnitude: number;
  verticalFovDeg?: number;
  aspectRatio?: number;
  motion?: SkykitObserverMotion | null;
  coordinateUnitsPerParsec: number;
}

export interface SkykitSceneRoots {
  originContentRoot: THREE.Object3D;
  observerContentRoot: THREE.Object3D;
  scaleBandedContentRoots: Map<string, THREE.Object3D>;
  navigationRoot: THREE.Object3D;
}

export interface SkykitFrameBase {
  viewer: SkykitViewer;
  deltaSeconds: number;
  elapsedSeconds: number;
  view: SkykitViewState;
}

export interface SkykitXrFrameState {
  presenting: boolean;
  frame?: unknown;
  session?: unknown;
  referenceSpace?: unknown;
  rig?: unknown;
  body?: unknown;
  rays?: Record<string, unknown>;
}

export interface SkykitFrameOptions {
  xr?: SkykitXrFrameState | null;
}

export interface SkykitThreeFrame extends SkykitFrameBase {
  renderer: THREE.WebGLRenderer | SkykitRendererLike;
  scene: THREE.Scene;
  camera: THREE.Camera;
  roots: SkykitSceneRoots;
  observerRig: SkykitObserverRig;
  xr?: SkykitXrFrameState | null;
}

export interface SkykitDisposable {
  dispose?(): void | Promise<void>;
}

export interface SkykitPart<
  TContext = SkykitThreePluginContext,
  TFrame = SkykitThreeFrame
> {
  id?: string;
  priority?: number;
  object3d?: THREE.Object3D;
  attach?(context: TContext): void | Promise<void>;
  start?(context: TContext): void | Promise<void>;
  update?(frame: TFrame): void;
  beforeRender?(frame: TFrame): void;
  afterRender?(frame: TFrame): void;
  resize?(size: SkykitViewportSize): void;
  setView?(view: SkykitViewState): void;
  detach?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
  getSnapshot?(): unknown;
}

export type SkykitThreePart = SkykitPart<SkykitThreePluginContext, SkykitThreeFrame>;

export interface SkykitViewportSize {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export type SkykitPluginTeardown = () => void | Promise<void>;

export interface SkykitPlugin {
  id?: string;
  setup(
    context: SkykitPluginContext
  ): void | Promise<void> | SkykitPluginTeardown | Promise<SkykitPluginTeardown | void>;
}

export type SkykitPluginInput =
  | SkykitPlugin
  | ((context: SkykitPluginContext) => void | Promise<void> | SkykitPluginTeardown | Promise<SkykitPluginTeardown | void>);

export interface SkykitScheduledTaskContext {
  viewer: SkykitViewer;
  signal: AbortSignal;
  reason?: string;
  priority?: 'frame' | 'background' | string;
}

export type SkykitScheduledTask = (
  context: SkykitScheduledTaskContext
) => void | Promise<void>;

export interface SkykitScheduleOptions {
  priority?: 'frame' | 'background' | string;
  reason?: string;
}

export interface SkykitEvent {
  type: string;
  [key: string]: unknown;
}

export type SkykitActionId = string;

export interface SkykitActionMetadata {
  source?: string;
  [key: string]: unknown;
}

export interface SkykitActionHandlerContext<TPayload = unknown> {
  id: SkykitActionId;
  payload: TPayload;
  metadata: SkykitActionMetadata;
  registry: SkykitActionRegistry;
}

export type SkykitActionHandler<TPayload = unknown, TResult = unknown> = (
  context: SkykitActionHandlerContext<TPayload>
) => TResult | Promise<TResult>;

export interface SkykitActionRegisterOptions {
  priority?: number;
  label?: string;
}

export interface SkykitActionRecord {
  id: SkykitActionId;
  priority: number;
  order: number;
  label?: string;
  handler: SkykitActionHandler;
}

export interface SkykitActionSummary {
  id: SkykitActionId;
  priority: number;
  order: number;
  label?: string;
}

export interface SkykitActionListEntry {
  id: SkykitActionId;
  handlerCount: number;
  handlers: SkykitActionSummary[];
}

export type SkykitActionEvent =
  | (SkykitEvent & {
      type: 'action/register' | 'action/unregister';
      id: SkykitActionId;
      record: SkykitActionSummary;
    })
  | (SkykitEvent & {
      type: 'action/invoke';
      id: SkykitActionId;
      payload?: unknown;
      metadata: SkykitActionMetadata;
      handlerCount: number;
    })
  | (SkykitEvent & {
      type: 'action/press';
      id: SkykitActionId;
      payload?: unknown;
      metadata: SkykitActionMetadata;
      source: string;
      pressed: boolean;
    })
  | (SkykitEvent & {
      type: 'action/release';
      id: SkykitActionId;
      metadata: SkykitActionMetadata;
      source: string;
      pressed: boolean;
    })
  | (SkykitEvent & {
      type: 'action/control';
      id: SkykitActionId;
      value: unknown;
      metadata: SkykitActionMetadata;
    })
  | (SkykitEvent & {
      type: 'action/error';
      id: SkykitActionId;
      payload?: unknown;
      metadata: SkykitActionMetadata;
      error: Error;
      message: string;
      record: SkykitActionSummary;
    });

export interface SkykitActionRegistrySnapshot {
  actions: SkykitActionListEntry[];
  pressed: Array<{ id: SkykitActionId; sources: string[] }>;
  controls: SkykitActionId[];
}

export interface SkykitActionRegistry {
  registerAction(
    id: SkykitActionId,
    handler: SkykitActionHandler,
    options?: SkykitActionRegisterOptions
  ): SkykitPluginTeardown;
  registerContext(
    namespace: string,
    handlers: Record<string, SkykitActionHandler>,
    options?: SkykitActionRegisterOptions
  ): SkykitPluginTeardown;
  invoke(
    id: SkykitActionId,
    payload?: unknown,
    metadata?: SkykitActionMetadata
  ): Promise<PromiseSettledResult<unknown>[]>;
  press(id: SkykitActionId, payload?: unknown, metadata?: SkykitActionMetadata): void;
  release(id: SkykitActionId, metadata?: SkykitActionMetadata): void;
  isPressed(id: SkykitActionId): boolean;
  setControlValue(id: SkykitActionId, value: unknown, metadata?: SkykitActionMetadata): void;
  getControlValue(id: SkykitActionId): unknown;
  listActions(): SkykitActionListEntry[];
  subscribe(listener: (event: SkykitActionEvent) => void): SkykitPluginTeardown;
  getSnapshot(): SkykitActionRegistrySnapshot;
  dispose(): void;
}

export interface SkykitPluginContext {
  readonly mode: 'three';
  readonly viewer: SkykitViewer;
  readonly actions: SkykitActionRegistry;
  addPart(part: SkykitThreePart): SkykitPluginTeardown;
  addDisposable(disposable: SkykitDisposable | SkykitPluginTeardown): SkykitPluginTeardown;
  getViewState(): SkykitViewState;
  requestViewState(patch: Partial<SkykitViewState>, reason?: string): void;
  on<TEvent extends SkykitEvent>(
    type: TEvent['type'],
    listener: (event: TEvent) => void
  ): SkykitPluginTeardown;
  emit(event: SkykitEvent): void;
  useStore<T>(key: symbol | string, factory: () => T): T;
  useResource<T extends SkykitDisposable>(key: symbol | string, factory: () => T): T;
  scheduleTask(task: SkykitScheduledTask, options?: SkykitScheduleOptions): SkykitPluginTeardown;
}

export type SkykitProductKey = string;

export interface SkykitProductMetadata {
  kind?: string;
  label?: string;
  ownerId?: string;
  tags?: readonly string[];
  version?: number | string;
  [key: string]: unknown;
}

export interface SkykitProductRecord<T = unknown> {
  readonly key: SkykitProductKey;
  readonly value: T;
  readonly metadata: SkykitProductMetadata;
}

export interface SkykitProductFilter {
  prefix?: string;
  kind?: string;
  tag?: string;
  ownerId?: string;
}

export interface SkykitProductValueSummary {
  type: string;
  className?: string;
  id?: string;
  length?: number;
  value?: unknown;
}

export interface SkykitProductSnapshotRecord {
  key: SkykitProductKey;
  metadata: SkykitProductMetadata;
  value: SkykitProductValueSummary;
}

export interface SkykitProductRegistrySnapshot {
  productCount: number;
  products: SkykitProductSnapshotRecord[];
}

export interface SkykitProductRegistry {
  provide<T>(
    key: SkykitProductKey,
    value: T,
    metadata?: SkykitProductMetadata
  ): SkykitPluginTeardown;
  get<T = unknown>(key: SkykitProductKey): T | null;
  subscribe<T = unknown>(
    key: SkykitProductKey,
    listener: (value: T | null, record: SkykitProductRecord<T> | null) => void,
    options?: { replay?: boolean }
  ): SkykitPluginTeardown;
  query(filter?: SkykitProductFilter): SkykitProductRecord[];
  getSnapshot(): SkykitProductRegistrySnapshot;
}

export interface SkykitProductRef<T = unknown> {
  readonly type: 'skykit:product-ref';
  readonly key: SkykitProductKey;
}

export interface SkykitProductRegistryPlugin extends SkykitPlugin, SkykitProductRegistry {}

export type SkykitSelectionValue =
  | SkykitStarSelectionValue
  | SkykitUnavailableStarPickSelectionValue
  | SkykitLayerSelectionValue
  | SkykitObjectSelectionValue
  | (Record<string, unknown> & { kind?: string });

export interface SkykitStarSelectionValue {
  kind: 'star';
  identityAvailable: true;
  ref: StarObjectRef;
  label?: string | null;
  facts?: unknown;
  pick?: {
    position?: unknown;
    distancePc?: number | null;
    apparentMagnitude?: number | null;
    visualRadiusPx?: number | null;
    teffLog8?: number | null;
    magAbs?: number | null;
    score?: number | null;
    angularDistanceDeg?: number | null;
  } | null;
  source?: string;
}

export interface SkykitUnavailableStarPickSelectionValue {
  kind: 'star-pick-unavailable';
  identityAvailable: false;
  reason: string;
  label?: string | null;
  diagnostic?: {
    cellKey?: string | null;
    objectIndex?: number | null;
    pickMeta?: unknown;
  } | null;
  source?: string;
}

export interface SkykitObjectSelectionValue {
  kind: 'object' | 'layer' | 'waypoint' | 'route' | string;
  id?: string;
  label?: string | null;
  target?: unknown;
  layerId?: string;
  productKey?: SkykitProductKey;
  pick?: unknown;
  source?: string;
  [key: string]: unknown;
}

export interface SkykitLayerSelectionValue extends SkykitObjectSelectionValue {
  kind: 'object' | 'layer' | 'waypoint' | 'route' | string;
  id?: string;
  label?: string | null;
  target?: unknown;
  layerId?: string;
  productKey?: SkykitProductKey;
  source?: string;
  pick?: SkykitLayerSelectionPickSummary | null;
}

export interface SkykitLayerSelectionPickSummary {
  position?: unknown;
  point?: unknown;
  worldPosition?: unknown;
  localPosition?: unknown;
  distance?: number;
  distancePc?: number;
  t?: number;
  score?: number;
  [key: string]: unknown;
}

export interface SkykitLayerSelectionOptions {
  source?: string;
  productKey?: SkykitProductKey;
  layerId?: string;
}

export interface SkykitLayerPickHit {
  selection?: SkykitSelectionValue | SkykitLayerSelectionValue | null;
  waypoint?: (Record<string, unknown> & {
    id?: string;
    label?: string | null;
    target?: unknown;
    layerId?: string;
    productKey?: SkykitProductKey;
    source?: string;
  }) | null;
  feature?: (Record<string, unknown> & {
    id?: string;
    kind?: string;
    label?: string | null;
    target?: unknown;
    layerId?: string;
    productKey?: SkykitProductKey;
    source?: string;
    properties?: Record<string, unknown>;
  }) | null;
  kind?: string;
  id?: string;
  label?: string | null;
  target?: unknown;
  layerId?: string;
  productKey?: SkykitProductKey;
  source?: string;
  pick?: unknown;
  position?: unknown;
  point?: unknown;
  worldPosition?: unknown;
  localPosition?: unknown;
  distance?: number;
  distancePc?: number;
  t?: number;
  score?: number;
  [key: string]: unknown;
}

export interface SkykitLayerPickRouteLike {
  type?: 'hit' | 'miss' | 'blocked' | string;
  hit?: SkykitLayerPickHit | null;
  [key: string]: unknown;
}

export interface SkykitSelectionStore<T = unknown> {
  getPrimary(): T | null;
  setPrimary(value: T | null, metadata?: Record<string, unknown>): void;
  subscribe(listener: (selection: T | null) => void): SkykitPluginTeardown;
  getSnapshot(): unknown;
}

export interface SkykitSelectionFacade<T = SkykitSelectionValue> {
  get(): T | null;
  set(value: T | null, metadata?: Record<string, unknown>): boolean;
  clear(metadata?: Record<string, unknown>): boolean;
  subscribe(listener: (selection: T | null) => void, options?: { replay?: boolean }): SkykitPluginTeardown;
  getSnapshot(): unknown;
}

export interface SkykitSelectionProductsPluginOptions<T = unknown> {
  id?: string;
  primary?: SkykitSelectionStore<T>;
  hovered?: false | SkykitSelectionStore<T>;
  initialPrimary?: T | null;
  initialHovered?: T | null;
  primaryKey?: SkykitProductKey | false;
  hoveredKey?: SkykitProductKey | false;
  metadata?: SkykitProductMetadata;
}

export interface SkykitLayerSelectionPluginOptions extends SkykitLayerSelectionOptions {
  id?: string;
  selection?: false | SkykitProductKey | SkykitSelectionStore<SkykitSelectionValue> | SkykitSelectionFacade<SkykitSelectionValue>;
  actionId?: SkykitActionId;
  pointerActionId?: false | SkykitActionId;
}

export interface SkykitInspectStreamSummary {
  id: string | null;
  status: string | null;
  sessionId: string | null;
  demandCount: number | null;
  demands: unknown[];
  cellCount: number | null;
  starCount: number | null;
  deltaCount: number | null;
  lastError: string | null;
  diagnostics: unknown;
}

export interface SkykitInspectSelectionSummary {
  kind: string | null;
  identityAvailable?: boolean;
  ref?: unknown;
  label?: string | null;
  facts?: unknown;
  pick?: unknown;
  reason?: string | null;
  diagnostic?: unknown;
  id?: string | null;
  layerId?: string | null;
  target?: unknown;
  productKey?: string | null;
  source?: string | null;
}

export interface SkykitInspectHistoryEntry {
  order: number;
  timeMs: number;
  type: 'action' | 'selection';
  eventType: string;
  actionId?: SkykitActionId;
  source?: string | null;
  payload?: unknown;
  value?: unknown;
  selection?: SkykitInspectSelectionSummary | null;
}

export interface SkykitInspectSnapshot {
  id: string;
  view: SkykitViewState;
  streams: SkykitInspectStreamSummary[];
  products: SkykitProductRegistrySnapshot | null;
  actions: SkykitActionRegistrySnapshot;
  selection: unknown;
  history: SkykitInspectHistoryEntry[];
  xr: unknown;
  diagnostics: {
    viewer: SkykitViewerSnapshot;
    runtime: unknown;
  };
}

export interface SkykitInspectFacade {
  getSnapshot(): SkykitInspectSnapshot;
  getViewState(): SkykitViewState;
  getStreams(): SkykitInspectStreamSummary[];
  getProducts(filter?: SkykitProductFilter): SkykitProductSnapshotRecord[];
  getActions(): SkykitActionRegistrySnapshot;
  getSelection(): unknown;
  getHistory(): SkykitInspectHistoryEntry[];
  dispose(): void;
}

export interface SkykitThreePluginContext extends SkykitPluginContext {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer | SkykitRendererLike;
  readonly camera: THREE.Camera;
  readonly roots: SkykitSceneRoots;
  readonly contentRoot: THREE.Object3D;
  readonly navigationRoot: THREE.Object3D;
  readonly observerRig: SkykitObserverRig;
}

export interface SkykitObserverRig {
  readonly type: 'desktop' | string;
  readonly navigationRoot?: THREE.Object3D;
  readonly roots?: SkykitSceneRoots;
  readonly cameraMount?: THREE.Object3D;
  getObserverPc(): Vector3Like;
  getRenderObserverPosition(): Vector3Like;
  getOrientationIcrs?(): QuaternionLike | null;
  getMotion?(): SkykitObserverMotion | null;
  setObserverPc?(observerPc: Vector3Like): void;
  setOrientationIcrs?(orientation: QuaternionLike): void;
  update?(frame: SkykitThreeFrame): void;
  dispose?(): void | Promise<void>;
}

export interface SkykitRendererLike {
  domElement?: unknown;
  setSize?(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio?(ratio: number): void;
  setAnimationLoop?(callback: ((timeMs: number, xrFrame?: unknown) => void) | null): void;
  render?(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose?(): void;
}

export interface SkykitViewerOptions {
  id?: string;
  host?: { appendChild?: (node: unknown) => void; removeChild?: (node: unknown) => void; clientWidth?: number; clientHeight?: number } | null;
  scene?: THREE.Scene;
  renderer?: THREE.WebGLRenderer | SkykitRendererLike;
  camera?: THREE.Camera;
  cameraRoot?: THREE.Object3D | false;
  roots?: Partial<SkykitSceneRoots>;
  observerRig?: SkykitObserverRig;
  parts?: Iterable<SkykitThreePart>;
  plugins?: Iterable<SkykitPluginInput>;
  view?: Partial<SkykitViewState>;
  resolveLookAtStar?: (star: unknown, lookAt: SkykitLookAtInput) => SkykitLookAtInput | Vector3Like | [number, number, number] | Promise<SkykitLookAtInput | Vector3Like | [number, number, number] | null> | null;
  resolveLookAtBookmark?: (bookmarkId: string, lookAt: unknown) => SkykitLookAtInput | Vector3Like | [number, number, number] | Promise<SkykitLookAtInput | Vector3Like | [number, number, number] | null> | null;
  autoMountRenderer?: boolean;
}

export interface SkykitViewerSnapshot {
  id: string;
  disposed: boolean;
  partCount: number;
  pluginCount: number;
  view: SkykitViewState;
  roots: {
    originContentRoot: string;
    observerContentRoot: string;
    navigationRoot: string;
    scaleBandedContentRoots: string[];
  };
  parts: Array<{
    id: string | null;
    priority: number;
    snapshot: unknown;
  }>;
  scheduledTasks: Array<{
    id: string;
    status: 'active' | 'finished' | 'failed' | 'cancelled';
    reason?: string;
    priority?: string;
    error?: string;
  }>;
  actions: SkykitActionRegistrySnapshot;
}

export interface SkykitViewer {
  readonly id: string;
  readonly mode: 'three';
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer | SkykitRendererLike;
  readonly camera: THREE.Camera;
  readonly roots: SkykitSceneRoots;
  readonly contentRoot: THREE.Object3D;
  readonly navigationRoot: THREE.Object3D;
  readonly observerRig: SkykitObserverRig;
  readonly actions: SkykitActionRegistry;
  addPart(part: SkykitThreePart): SkykitPluginTeardown;
  addPlugin(plugin: SkykitPluginInput): Promise<SkykitPluginTeardown>;
  getViewState(): SkykitViewState;
  requestViewState(patch: Partial<SkykitViewState>, reason?: string): void;
  update(deltaSeconds?: number, frameOptions?: SkykitFrameOptions): void;
  render(frameOptions?: SkykitFrameOptions): void;
  frame(deltaSeconds?: number, frameOptions?: SkykitFrameOptions): void;
  resize(size?: Partial<SkykitViewportSize>): void;
  on<TEvent extends SkykitEvent>(type: TEvent['type'], listener: (event: TEvent) => void): SkykitPluginTeardown;
  emit(event: SkykitEvent): void;
  getSnapshot(): SkykitViewerSnapshot;
  dispose(): Promise<void>;
}

export interface DesktopSkykitObserverRigOptions {
  observerPc?: Vector3Like;
  orientationIcrs?: QuaternionLike;
  coordinateUnitsPerParsec?: number;
}

export type SkykitLayerAnchorMode = 'world-space' | 'observer-centric' | 'scale-banded';

export interface Object3dLayerOptions {
  id?: string;
  priority?: number;
  object3d: THREE.Object3D;
  anchorMode?: SkykitLayerAnchorMode;
  scaleBandId?: string;
  disposeObject?: boolean;
}

export interface SkykitLayerCameraState {
  verticalFovDeg?: number;
  aspectRatio?: number;
  viewProjection?: unknown;
}

export interface SkykitLayerNavigationState {
  observerPc: Vector3Like;
  renderObserverPosition: Vector3Like;
  orientationIcrs: QuaternionLike | null;
  motion: SkykitObserverMotion | null;
}

export interface SkykitLayerState {
  view: SkykitViewState;
  navigation: SkykitLayerNavigationState;
  camera: SkykitLayerCameraState;
  xr?: SkykitLayerXrState | null;
  scale?: SkykitScaleState | null;
}

export interface SkykitLayerXrState extends SkykitXrFrameState {}

export interface SkykitLayerAddObjectOptions {
  anchorMode?: SkykitLayerAnchorMode;
  scaleBandId?: string;
  disposeObject?: boolean;
}

export interface SkykitLayerContext extends SkykitThreePluginContext {
  readonly products: SkykitProductRegistry;
  addObject3D(
    object3d: THREE.Object3D,
    options?: SkykitLayerAddObjectOptions
  ): SkykitPluginTeardown;
  provideProduct<T>(
    key: SkykitProductKey | false | null | undefined,
    value: T,
    metadata?: SkykitProductMetadata
  ): SkykitPluginTeardown;
  addDemand?(
    source:
      | SkykitStarCellSource
      | SkykitSpatialLayerSource
      | SkykitProductRef<SkykitStarCellSource | SkykitSpatialLayerSource>,
    demand: SkykitStarCellDemand | SkykitSpatialDemand
  ): SkykitPluginTeardown;
  addPickTarget?(
    target: unknown,
    options?: SkykitLayerInteractionProductOptions
  ): SkykitPluginTeardown;
  addPickBlocker?(
    blocker: unknown,
    options?: SkykitLayerInteractionProductOptions
  ): SkykitPluginTeardown;
}

export interface SkykitHostedLayer {
  id?: string;
  priority?: number;
  scalePolicy?: SkykitLayerScalePolicy;
  setup?(ctx: SkykitLayerContext): void | Promise<void> | SkykitPluginTeardown | Promise<SkykitPluginTeardown | void>;
  attach?(ctx: SkykitLayerContext): void | Promise<void>;
  start?(ctx: SkykitLayerContext): void | Promise<void>;
  setView?(view: SkykitViewState, ctx: SkykitLayerContext): void;
  setState?(state: SkykitLayerState, ctx: SkykitLayerContext): void | Promise<void>;
  update?(frame: SkykitThreeFrame, ctx: SkykitLayerContext): void;
  beforeRender?(frame: SkykitThreeFrame, ctx: SkykitLayerContext): void;
  afterRender?(frame: SkykitThreeFrame, ctx: SkykitLayerContext): void;
  resize?(size: SkykitViewportSize, ctx: SkykitLayerContext): void;
  detach?(ctx: SkykitLayerContext): void | Promise<void>;
  dispose?(ctx: SkykitLayerContext): void | Promise<void>;
  getBounds?(): SkykitLayerBounds | SkykitLayerBounds[] | null;
  getSnapshot?(): unknown;
}

export interface SkykitLayerHostOptions {
  id?: string;
  layers?: Iterable<SkykitHostedLayer>;
}

export interface SkykitLayerHostSnapshot {
  id: string;
  layerCount: number;
  layers: Array<{
    id: string;
    priority: number | null;
    mounted: boolean;
    started: boolean;
    setupComplete: boolean;
    childPartCount: number;
    localPickBlockerCount?: number;
    localPickTargetCount?: number;
    demandCount?: number;
    activationMode?: SkykitLayerActivationMode;
    bounds?: unknown;
    snapshot: unknown;
  }>;
}

export interface SkykitLayerHostPlugin extends SkykitPlugin {
  addLayer(layer: SkykitHostedLayer): SkykitPluginTeardown;
  getPickBlockers(): unknown[];
  getPickTargets(): unknown[];
  getBounds(): SkykitLayerBounds[];
  getSnapshot(): SkykitLayerHostSnapshot;
}

export interface SkykitLayerInteractionProductOptions {
  key?: SkykitProductKey | false;
  metadata?: SkykitProductMetadata;
}

export type SkykitScaleDomain =
  | 'solar-system'
  | 'stellar'
  | 'galactic'
  | 'extragalactic'
  | (string & {});

export interface SkykitScaleState {
  domain: SkykitScaleDomain;
  previousDomain?: SkykitScaleDomain | null;
  transition?: {
    from: SkykitScaleDomain;
    to: SkykitScaleDomain;
    t: number;
    phase: 'entering' | 'active' | 'leaving';
  } | null;
  coordinateUnitsPerParsec: number;
  skyFixed: boolean;
}

export interface SkykitScaleStore {
  getState(view?: SkykitViewState): SkykitScaleState;
  setState(patch: Partial<SkykitScaleState>, options?: { reason?: string; source?: unknown; emit?: boolean }): void;
  subscribe(listener: (state: SkykitScaleState) => void, options?: { replay?: boolean }): SkykitPluginTeardown;
  getSnapshot(): unknown;
}

export interface SkykitScaleCoordinatorPluginOptions extends Partial<SkykitScaleState> {
  id?: string;
  priority?: number;
  syncViewScale?: boolean;
}

export interface SkykitScaleCoordinatorPlugin extends SkykitPlugin {
  readonly id: string;
  setDomain(domain: SkykitScaleDomain, options?: { coordinateUnitsPerParsec?: number; skyFixed?: boolean; source?: unknown }): void;
  startTransition(transition: NonNullable<SkykitScaleState['transition']> & { coordinateUnitsPerParsec?: number; skyFixed?: boolean }, options?: { source?: unknown }): void;
  completeTransition(payload?: SkykitScaleDomain | Partial<SkykitScaleState> | null, options?: { source?: unknown }): void;
  getState(): SkykitScaleState;
  getSnapshot(): unknown;
}

export type SkykitLayerActivationMode = 'active' | 'frozen' | 'hidden';

export interface SkykitLayerScalePolicy {
  [domain: string]: {
    mode?: SkykitLayerActivationMode;
    anchorMode?: SkykitLayerAnchorMode;
    scaleBandId?: string;
    frame?: SkykitSpatialFeatureFrame;
    demand?: 'live' | 'paused' | 'summary' | string;
  };
}

export type SkykitSpatialFeatureFrame =
  | 'icrs-pc'
  | 'galactic-kpc'
  | 'solar-au'
  | 'observer-sky'
  | (string & {});

export interface SkykitLayerBounds {
  kind: string;
  frame?: SkykitSpatialFeatureFrame;
  center?: SpatialTargetInput;
  radius?: number;
  [key: string]: unknown;
}

export interface SkykitSpatialDemand {
  id?: string;
  frame?: SkykitSpatialFeatureFrame;
  bounds?: SkykitLayerBounds;
  view?: Partial<SkykitViewState>;
  scale?: Partial<SkykitScaleState>;
  attributes?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface SkykitSpatialLayerSource<TDelta = unknown, TStore = unknown> {
  readonly id: string;
  addDemand(demand: SkykitSpatialDemand): SkykitPluginTeardown;
  removeDemand?(id: string): void;
  refreshDemand?(reason?: string): void | Promise<void>;
  subscribe(
    listener: (delta: TDelta) => void,
    options?: { replay?: boolean }
  ): SkykitPluginTeardown;
  getStore(): TStore;
  getSnapshot(): unknown;
}

export interface SkykitSpatialFeature {
  id: string;
  layerId: string;
  kind: string;
  label?: string;
  description?: string;
  frame: SkykitSpatialFeatureFrame;
  target?: SpatialTargetInput;
  position?: Vector3Like;
  bounds?: SkykitLayerBounds;
  metadata?: Record<string, unknown>;
}

export interface SkykitFeatureCollection {
  type: 'FeatureCollection';
  features: SkykitSpatialFeature[];
  metadata: {
    datasetId: string;
    label: string;
    layerKind: string;
    source?: unknown;
  };
}

export interface SkykitWaypoint extends SkykitSpatialFeature {
  target: SpatialTargetInput;
  actionId?: string;
  tags?: readonly string[];
}

export interface SkykitConstellationBoundaryOptions {
  radius?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  renderOrder?: number;
}

export type SkykitConstellationArtMode = 'off' | 'lazy' | 'preload';

export interface SkykitConstellationArtOptions {
  loading?: 'lazy' | 'preload';
  opacity?: number;
  maxAngleDeg?: number;
  skipTextureErrors?: boolean;
}

export interface SkykitConstellationLayerOptions {
  id?: string;
  priority?: number;
  manifest: Record<string, unknown>;
  assetBaseUrl?: string;
  visible?: boolean;
  boundary?: false | SkykitConstellationBoundaryOptions;
  art?: false | SkykitConstellationArtOptions;
  publish?: false | {
    features?: SkykitProductKey | false;
    waypoints?: SkykitProductKey | false;
    catalog?: SkykitProductKey | false;
    metadata?: SkykitProductMetadata;
  };
}

export interface SkykitConstellationLayerSnapshot {
  id: string;
  visible: boolean;
  manifestId: string;
  lineCount: number;
  art: SkykitConstellationArtMode;
  artCatalogCount: number;
  artPlugin: unknown;
}

export interface SkykitConstellationLayer extends SkykitHostedLayer {
  show(): boolean;
  hide(): boolean;
  toggle(force?: boolean): boolean;
  setArt(
    input: false | SkykitConstellationArtOptions | SkykitConstellationArtMode | string
  ): Promise<SkykitConstellationArtMode>;
  getSnapshot(): SkykitConstellationLayerSnapshot;
}

export type SkykitCoordinateFrameId = 'solar' | 'galactic' | (string & {});

export interface SkykitCoordinateFrameMarkerLayerOptions {
  id?: string;
  priority?: number;
  frame: SkykitCoordinateFrameId;
  visible?: boolean;
  radiusPc?: number;
  markers?: Iterable<SkykitCoordinateFrameMarker>;
  publish?: false | {
    features?: SkykitProductKey | false;
    waypoints?: SkykitProductKey | false;
    metadata?: SkykitProductMetadata;
  };
}

export interface SkykitCoordinateFrameMarker {
  id: string;
  label: string;
  kind: 'axis' | 'plane' | 'grid-line' | 'pole' | 'custom';
  targetIcrs?: Vector3Like;
  pathIcrs?: Vector3Like[];
  metadata?: Record<string, unknown>;
}

export interface SkykitCoordinateFrameMarkerLayerSnapshot {
  id: string;
  frame: string;
  visible: boolean;
  markerCount: number;
  mounted: boolean;
}

export interface SkykitCoordinateFrameMarkerLayer extends SkykitHostedLayer {
  show(): boolean;
  hide(): boolean;
  toggle(force?: boolean): boolean;
  getSnapshot(): SkykitCoordinateFrameMarkerLayerSnapshot;
}

export interface AnchoredImageCatalogEntry {
  id: string;
  key: string;
  groupId: string | null;
  label: string;
  image: AnchoredImage;
  centroidIcrs: Vector3Like;
  imageUpIcrs: Vector3Like;
  cornersIcrs: Vector3Like[];
  boundsConeRadiusRad: number;
  metadata: Record<string, unknown>;
}

export interface AnchoredImageMatch {
  entry: AnchoredImageCatalogEntry;
  key: string;
  angleRad: number;
  viewDistanceRad: number;
}

export interface AnchoredImageCatalogOptions extends LoadAnchoredImageManifestOptions {}

export interface AnchoredImageTargetOptions {
  observerPc?: Vector3Like;
  distancePc?: number;
}

export interface AnchoredImageLookAtOptions extends AnchoredImageTargetOptions {
  upIcrs?: Vector3Like;
}

export interface AnchoredImageLookAtResult {
  entry: AnchoredImageCatalogEntry;
  targetPc: Vector3Like;
  upIcrs: Vector3Like;
  orientationIcrs: QuaternionLike | null;
}

export type AnchoredImageSelection =
  | string
  | string[]
  | ((entry: AnchoredImageCatalogEntry) => boolean);

export interface AnchoredImageResolveNearestOptions {
  selection?: AnchoredImageSelection;
  maxAngleDeg?: number;
}

export interface AnchoredImageResolveWithinAngleOptions {
  selection?: AnchoredImageSelection;
  maxAngleDeg: number;
}

export interface AnchoredImageCatalog {
  manifest: AnchoredImageManifest;
  list(): AnchoredImageCatalogEntry[];
  get(key: string): AnchoredImageCatalogEntry | null;
  resolveTargetPc(key: string, options?: AnchoredImageTargetOptions): Vector3Like | null;
  resolveLookAt(key: string, options?: AnchoredImageLookAtOptions): AnchoredImageLookAtResult | null;
  resolveNearest(
    lookDirection: Vector3Like | [number, number, number],
    options?: AnchoredImageResolveNearestOptions
  ): AnchoredImageMatch | null;
  resolveWithinAngle(
    lookDirection: Vector3Like | [number, number, number],
    options: AnchoredImageResolveWithinAngleOptions
  ): AnchoredImageMatch[];
}

export type AnchoredImageSkyLoading = 'preload' | 'lazy';
export type ViewAnchoredImageControllerStrategy = 'nearest' | 'within-angle';

export interface AnchoredImageControllerInput {
  catalog: AnchoredImageCatalog;
  view: SkykitViewState;
  viewDirectionIcrs: Vector3Like;
  deltaSeconds: number;
  elapsedSeconds: number;
}

export interface AnchoredImageController {
  update(input: AnchoredImageControllerInput): AnchoredImageMatch[];
  getSnapshot(): unknown;
  setSelection?(selection?: AnchoredImageSelection): void;
  getSelection?(): AnchoredImageSelection | undefined;
}

export interface ManualAnchoredImageControllerOptions {
  selection?: AnchoredImageSelection;
}

export interface ViewAnchoredImageControllerOptions {
  strategy?: ViewAnchoredImageControllerStrategy;
  selection?: AnchoredImageSelection;
  maxAngleDeg?: number;
  hysteresisSeconds?: number;
}

export interface AnchoredImageStyleState {
  entry: AnchoredImageCatalogEntry | null;
  active: boolean;
  visible: boolean;
  opacity: number;
  targetOpacity: number;
}

export interface AnchoredImageSkyPluginOptions {
  id?: string;
  priority?: number;
  catalog: AnchoredImageCatalog;
  controller: AnchoredImageController;
  loading?: AnchoredImageSkyLoading;
  anchorMode?: SkykitLayerAnchorMode;
  scaleBandId?: string;
  fixedAtInfinity?: boolean;
  radius?: number;
  opacity?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  cutoff?: number;
  subdivisions?: number;
  renderOrder?: number;
  namePrefix?: string;
  textureLoader?: THREE.TextureLoader;
  skipTextureErrors?: boolean;
  onTextureError?: (event: {
    entry: AnchoredImageCatalogEntry;
    image: AnchoredImage;
    imageUrl: string;
    error: unknown;
  }) => void;
  applyImageStyle?: (object: THREE.Object3D, state: AnchoredImageStyleState) => void;
}

export interface AnchoredImageSkyController {
  getActive(): AnchoredImageMatch[];
  getCatalog(): AnchoredImageCatalog;
  getSnapshot(): unknown;
}

export type AnchoredImageSkyPlugin = SkykitPlugin & AnchoredImageSkyController;

export interface SkykitObject3dPlugin extends SkykitPlugin {
  getLayer(): SkykitThreePart | null;
  getSnapshot(): unknown;
}

export interface StreamingStarLayerOptions {
  id?: string;
  priority?: number;
  provider?: StarOctreeProviderService;
  source?: SkykitStarCellSource;
  renderer: ThreeStarField;
  session?: StarOctreeSessionOptions | StarOctreeProviderSession;
  strategy?: StarCellStrategy | ((view: SkykitViewState) => StarCellStrategy | null);
  attributes?: readonly string[];
  coordinates?: StarOctreeCoordinateOutput;
  updateOptions?: ViewUpdateOptions;
}

export interface StreamingStarLayerSnapshot {
  id: string;
  status: 'idle' | 'streaming' | 'current' | 'failed' | 'disposed';
  deltaCount: number;
  sessionId: string | null;
  renderer: unknown;
  session: unknown;
  lastError?: string | null;
}

export interface StreamingStarLayer extends SkykitThreePart {
  readonly object3d: THREE.Object3D;
  apply(delta: StarCellDelta): void;
  getSnapshot(): StreamingStarLayerSnapshot;
}

export interface SkykitStreamingStarsPlugin extends SkykitPlugin {
  getLayer(): StreamingStarLayer | null;
  getSnapshot(): unknown;
}

export interface SkykitStellarSkyLayerOptions {
  id?: string;
  priority?: number;
  source: SkykitStarCellSource | SkykitProductRef<SkykitStarCellSource>;
  renderer: ThreeStarField;
  strategy?: StarCellStrategy | ((view: SkykitViewState) => StarCellStrategy | null);
  attributes?: readonly string[];
  demand?: SkykitStarCellDemand;
  summaryDemand?: SkykitStarCellDemand;
  summaryStrategy?: StarCellStrategy | null;
  summaryAttributes?: readonly string[];
  anchorMode?: SkykitLayerAnchorMode;
  scaleBandId?: string;
  scalePolicy?: SkykitLayerScalePolicy;
  publish?: SkykitStarSourcePublishOptions | false;
  disposeRenderer?: boolean;
}

export interface SkykitStellarSkyLayer extends SkykitHostedLayer {
  readonly scalePolicy: SkykitLayerScalePolicy;
}

export interface SkykitStarCellDemand {
  id?: string;
  strategy?: StarCellStrategy | ((view: SkykitViewState) => StarCellStrategy | null) | null;
  view?: Partial<StarOctreeViewPatch> | ((view: SkykitViewState) => Partial<StarOctreeViewPatch> | null | undefined);
  attributes?: readonly string[];
}

export interface SkykitStarCellSourceSnapshot {
  id: string;
  status: 'idle' | 'streaming' | 'current' | 'failed' | 'disposed';
  deltaCount: number;
  sessionId: string | null;
  demandCount: number;
  demands: Array<{ id: string; attributes: string[] }>;
  store: unknown;
  session: unknown;
  provider?: unknown;
  lastError?: string | null;
  disposed: boolean;
}

export interface SkykitStarCellSource extends SkykitPlugin, SkykitThreePart {
  readonly id: string;
  addDemand(demand: SkykitStarCellDemand): SkykitPluginTeardown;
  registerDemand(demand: SkykitStarCellDemand): SkykitPluginTeardown;
  removeDemand(id: string): void;
  refreshDemand(reason?: string): void | Promise<void>;
  subscribe(
    listener: (delta: StarCellDelta) => void,
    options?: { replay?: boolean }
  ): SkykitPluginTeardown;
  apply(delta: StarCellDelta): void;
  getStore(): StarCellStore;
  getSnapshot(): SkykitStarCellSourceSnapshot;
}

export interface SkykitStarSourcePluginOptions {
  id?: string;
  priority?: number;
  provider?: StarOctreeProviderService;
  session?: StarOctreeSessionOptions | StarOctreeProviderSession;
  strategy?: StarCellStrategy | ((view: SkykitViewState) => StarCellStrategy | null);
  attributes?: readonly string[];
  coordinates?: StarOctreeCoordinateOutput;
  updateOptions?: ViewUpdateOptions;
  retainCellsOnRestart?: SkykitStarSourceRestartRetentionPolicy | false;
  publish?: SkykitStarSourcePublishOptions | false;
}

export interface SkykitStarSourcePublishOptions {
  source?: SkykitProductKey | false;
  store?: SkykitProductKey | false;
  metadata?: SkykitProductMetadata;
}

export interface SkykitStarSourceRestartRetentionPolicy {
  until: 'first-upsert' | 'current';
  maxAgeMs?: number;
}

export interface SkykitHrDiagramTouchOsOptions {
  surfaces?: EmbeddedSurfaceService | (() => EmbeddedSurfaceService | null | undefined);
  sourceId?: string;
  componentId?: string;
  width?: number;
  height?: number;
  root?: DisplayNode | null;
}

export interface SkykitHrDiagramDemandStrategyContext {
  view: SkykitViewState;
  mode: HrDiagramMode;
  volumeRadiusPc: number;
  limitingMagnitude: number;
  volumeDemandCenterPc: SpatialVector3 | null;
  createDefaultStrategy(): StarCellStrategy | null;
}

export type SkykitHrDiagramDemandStrategy = (
  context: SkykitHrDiagramDemandStrategyContext
) => StarCellStrategy | null;

export interface SkykitHrDiagramPluginOptions {
  id?: string;
  priority?: number;
  source: SkykitStarCellSource | SkykitProductRef<SkykitStarCellSource>;
  mode?: HrDiagramMode;
  volumeRadiusPc?: number;
  limitingMagnitude?: number;
  width?: number;
  height?: number;
  highlightRegion?: HrDiagramHighlightRegion | null;
  selectedStars?: Iterable<HrDiagramSelectedStar>;
  demandStrategy?: SkykitHrDiagramDemandStrategy | null;
  touchOs?: SkykitHrDiagramTouchOsOptions;
}

export type SkykitHrDiagramPluginRuntimeOptions = Partial<Omit<SkykitHrDiagramPluginOptions, 'id' | 'priority' | 'source' | 'touchOs'>>;

export interface SkykitHrDiagramPlugin extends SkykitPlugin {
  readonly id: string;
  getSource(): HrDiagramSurfaceSource;
  getNode(): DisplayNode;
  getMode(): HrDiagramMode;
  setMode(mode: HrDiagramMode): Promise<void>;
  setOptions(options: SkykitHrDiagramPluginRuntimeOptions): Promise<void>;
  getSnapshot(): unknown;
}

export interface SkykitStarInstrumentPluginOptions {
  id?: string;
  priority?: number;
  sources: Iterable<SkykitStarCellSource | SkykitProductRef<SkykitStarCellSource>>;
  overlays?: Iterable<
    | SkykitFeatureCollection
    | SkykitWaypoint[]
    | SkykitProductRef<SkykitFeatureCollection | SkykitWaypoint[]>
  >;
  mode?: 'hr' | 'galactic-map' | 'custom' | string;
  touchOs?: SkykitHrDiagramTouchOsOptions;
  surfaceKey?: SkykitProductKey | false;
  surfaceMetadata?: SkykitProductMetadata;
}

export interface SkykitStarInstrumentPlugin extends SkykitPlugin {
  readonly id: string;
  getSource(): HrDiagramSurfaceSource | null;
  getNode(): DisplayNode | null;
  getSnapshot(): unknown;
}

export interface SkykitStarPickingTarget extends EventTarget {
  clientWidth?: number;
  clientHeight?: number;
  getBoundingClientRect?(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface SkykitStarPickPointer {
  pointerId: string;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
  ndcX: number;
  ndcY: number;
}

export interface SkykitStarPickMetadataProvider {
  getMeta?(ref: StarObjectRef): unknown | Promise<unknown>;
  resolvePrimaryLabel?(ref: StarObjectRef | StarPickMeta): string | Promise<string>;
  resolveFacts?(ref: StarObjectRef | StarPickMeta): unknown | Promise<unknown>;
}

export interface SkykitStarPickMetadataResolverContext {
  context: SkykitThreePluginContext;
  viewer: SkykitViewer;
  view: SkykitViewState;
}

export type SkykitStarPickMetadata =
  | string
  | {
      label?: string;
      primaryLabel?: string;
      ref?: StarObjectRef | StarPickMeta | null;
      facts?: unknown;
      [key: string]: unknown;
    }
  | null;

export type SkykitStarPickMetadataResolver = (
  pick: ThreeStarFieldPickResult,
  context: SkykitStarPickMetadataResolverContext
) => SkykitStarPickMetadata | Promise<SkykitStarPickMetadata>;

export interface SkykitStarPickMetadataResolverOptions {
  provider?: SkykitStarPickMetadataProvider | null;
  fallbackLabel?: string | ((pick: ThreeStarFieldPickResult) => string);
}

export interface SkykitStarPickEvent extends SkykitEvent {
  type: 'stars/pick';
  id: string;
  pick: ThreeStarFieldPickResult;
  label: string;
  metadata: SkykitStarPickMetadata;
  pickTimeMs: number;
  pointer: SkykitStarPickPointer;
  ray: THREE.Ray;
  view: SkykitViewState;
}

export interface SkykitStarPickMissEvent extends SkykitEvent {
  type: 'stars/pick-miss';
  id: string;
  pointer: SkykitStarPickPointer;
  ray: THREE.Ray;
  view: SkykitViewState;
}

export interface SkykitStarPickingPluginOptions {
  id?: string;
  target?: SkykitStarPickingTarget | null;
  renderer: ThreeStarField;
  source?: SkykitStarCellSource | null;
  button?: number;
  enabled?: boolean;
  clickMaxMovementPx?: number;
  pickOptions?: ThreeStarFieldPickOptions;
  attributes?: readonly string[];
  metadata?: SkykitStarPickMetadataResolver | SkykitStarPickMetadataProvider | null;
  metadataAttributes?: readonly string[];
  selection?: false | SkykitProductKey | SkykitSelectionStore<SkykitSelectionValue> | SkykitSelectionFacade<SkykitSelectionValue>;
  onPick?: (event: SkykitStarPickEvent) => void | Promise<void>;
  onMiss?: (event: SkykitStarPickMissEvent) => void | Promise<void>;
}

export type SkykitKeyboardNavigationAction = SkykitActionId;

export interface SkykitKeyboardNavigationBindingContext {
  key: string;
  event: Event;
  context: SkykitThreePluginContext;
  viewer: SkykitViewer;
  actions: SkykitActionRegistry;
  getViewState(): SkykitViewState;
  requestViewState(patch: Partial<SkykitViewState>, reason?: string): void;
}

export type SkykitKeyboardNavigationHandler = (
  context: SkykitKeyboardNavigationBindingContext
) => void | Promise<void>;

export type SkykitKeyboardNavigationBinding =
  | SkykitKeyboardNavigationAction
  | SkykitKeyboardNavigationHandler;

export type SkykitKeyboardNavigationBindings = Readonly<Record<string, SkykitKeyboardNavigationBinding>>;

export interface SkykitKeyboardNavigationOptions {
  id?: string;
  priority?: number;
  target?: EventTarget | null;
  enabled?: boolean;
  speedPcPerSec?: number;
  rotationSpeedDegPerSec?: number;
  boostMultiplier?: number;
  boostKeys?: readonly string[];
  /**
   * Complete key-to-action map. When omitted, SkyKit uses
   * SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS. When supplied, this replaces
   * the defaults rather than merging with them.
   */
  bindings?: SkykitKeyboardNavigationBindings;
  verticalMode?: 'view' | 'world';
  preventDefault?: boolean;
}

export interface SkykitDragLookOptions {
  id?: string;
  priority?: number;
  target?: EventTarget | null;
  enabled?: boolean;
  sensitivityRadiansPerPixel?: number;
  pitchLimitDeg?: number;
  button?: number;
  preventDefault?: boolean;
}

export interface SkykitOrbitDragOptions {
  id?: string;
  priority?: number;
  target?: EventTarget | null;
  enabled?: boolean;
  center?: SpatialTargetInput | SkykitLookAtInput | null;
  centerPc?: Vector3Like | null;
  fallbackCenter?: 'targetPc' | 'lookAt' | 'origin' | 'none';
  sensitivityRadiansPerPixel?: number;
  verticalSensitivityRadiansPerPixel?: number;
  horizontalAxisMode?: 'screen-up' | 'world-up';
  worldUp?: Vector3Like;
  button?: number;
  preventDefault?: boolean;
  lockLookAt?: boolean;
}

export interface SkykitOrbitDragSnapshot {
  id: string;
  enabled: boolean;
  attached: boolean;
  dragging: boolean;
  centerPc: Vector3Like | null;
  radiusPc: number | null;
  sensitivityRadiansPerPixel: number;
  verticalSensitivityRadiansPerPixel: number;
  horizontalAxisMode: 'screen-up' | 'world-up';
  worldUp: Vector3Like | null;
}

export interface SkykitOrbitDragPlugin extends SkykitPlugin {
  getSnapshot(): SkykitOrbitDragSnapshot;
  setEnabled(nextEnabled: boolean): void;
  setCenter(nextCenter: SpatialTargetInput | SkykitLookAtInput | Vector3Like | null): void;
}

export interface SkykitStatusPayload {
  viewer: SkykitViewerSnapshot;
  view: SkykitViewState;
}

export interface SkykitStatusPluginOptions {
  id?: string;
  priority?: number;
  target?: { textContent?: string | null } | null;
  intervalSeconds?: number;
  render?: (payload: SkykitStatusPayload) => void;
}

export interface SkykitNavigationPluginOptions extends SpatialNavigationAutomationOptions {
  id?: string;
  priority?: number;
  navigation?: SpatialNavigationAutomation;
  scaleProfile?: SpatialScaleProfile;
  resolveTarget?: (
    input: unknown,
    context: SkykitThreePluginContext
  ) => SpatialVector3 | Promise<SpatialVector3 | null> | null | undefined;
  resolveBookmark?: (
    bookmarkId: string,
    input: SpatialTargetInput,
    context: SkykitThreePluginContext
  ) => SpatialTargetInput | Promise<SpatialTargetInput | null> | null;
}

export interface SkykitSpatialPreloadStrategyOptions {
  combine?: boolean;
  baseStrategy?: StarCellStrategy;
}

export interface SkykitStarPreloadRequest {
  strategy: StarCellStrategy;
  view?: StarOctreeViewPatch;
  sourceHint: SpatialPreloadHint;
}

export interface SkykitAnimationLoopOptions {
  autoStart?: boolean;
  render?: boolean;
  scheduler?: 'window' | 'renderer';
  maxFramesPerSecond?: number;
  maxDeltaSeconds?: number;
  requestAnimationFrame?: (callback: (timeMs: number) => void) => number | ReturnType<typeof setTimeout>;
  cancelAnimationFrame?: (handle: number | ReturnType<typeof setTimeout>) => void;
  now?: () => number;
}

export interface SkykitAnimationLoopSnapshot {
  running: boolean;
  disposed: boolean;
  frameCount: number;
  elapsedSeconds: number;
  lastDeltaSeconds: number;
  lastError: string | null;
}

export interface SkykitAnimationLoop {
  start(): void;
  stop(): void;
  dispose(): void;
  getSnapshot(): SkykitAnimationLoopSnapshot;
}

export interface SkykitDebugBridge {
  listViewers(): SkykitDebugViewerSummary[];
  useViewer(target: string | number | SkykitViewer): SkykitDebugViewer | null;
  getViewer(target?: string | number | SkykitViewer): SkykitDebugViewer | null;
  snapshot(target?: string | number | SkykitViewer): unknown;
  recordDiagnostic(diagnostic: SkykitDebugDiagnosticInput): SkykitDebugDiagnostic;
  listDiagnostics(query?: SkykitDebugDiagnosticQuery): SkykitDebugDiagnostic[];
  clearDiagnostics(): void;
  registerViewer(viewer: SkykitViewer, options?: SkykitDebugRegisterOptions): SkykitDebugViewer;
  unregisterViewer(target: string | number | SkykitViewer): boolean;
  getObserverPc(target?: string | number | SkykitViewer): Vector3Like | null;
  setObserverPc(point: Vector3Like, target?: string | number | SkykitViewer): Vector3Like;
  setObserverPc(x: number, y: number, z: number, target?: string | number | SkykitViewer): Vector3Like;
  flyToPc(point: Vector3Like, options?: Record<string, unknown>, target?: string | number | SkykitViewer): Vector3Like;
  lookAtPc(point: Vector3Like, options?: Record<string, unknown>, target?: string | number | SkykitViewer): Vector3Like;
  cancelAutomation(target?: string | number | SkykitViewer): boolean;
  listActions(target?: string | number | SkykitViewer): SkykitActionListEntry[];
  invokeAction(id: SkykitActionId, payload?: unknown, target?: string | number | SkykitViewer): Promise<PromiseSettledResult<unknown>[]>;
  pressAction(id: SkykitActionId, payload?: unknown, target?: string | number | SkykitViewer): void;
  releaseAction(id: SkykitActionId, target?: string | number | SkykitViewer): void;
}

export interface SkykitDebugRegisterOptions {
  id?: string;
  label?: string;
}

export type SkykitDebugDiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SkykitDebugDiagnosticInput {
  level?: SkykitDebugDiagnosticLevel;
  type?: string;
  message?: string;
  viewerId?: string;
  timestampMs?: number;
  data?: unknown;
  error?: unknown;
}

export interface SkykitDebugDiagnostic {
  id: number;
  timestampMs: number;
  level: SkykitDebugDiagnosticLevel;
  type: string;
  viewerId?: string;
  message?: string;
  data?: unknown;
  error?: unknown;
}

export interface SkykitDebugDiagnosticQuery {
  level?: SkykitDebugDiagnosticLevel;
  type?: string;
  viewerId?: string;
  limit?: number;
}

export interface SkykitDebugViewerSummary {
  id: string;
  label: string;
  disposed: boolean;
}

export interface SkykitDebugViewer extends SkykitDebugViewerSummary {
  viewer: SkykitViewer;
  getSnapshotState(): unknown;
  getObserverPc(): Vector3Like | null;
  setObserverPc(point: Vector3Like): Vector3Like;
  setObserverPc(x: number, y: number, z: number): Vector3Like;
  flyToPc(point: Vector3Like, options?: Record<string, unknown>): Vector3Like;
  lookAtPc(point: Vector3Like, options?: Record<string, unknown>): Vector3Like;
  cancelAutomation(): boolean;
  listActions(): SkykitActionListEntry[];
  invokeAction(id: SkykitActionId, payload?: unknown): Promise<PromiseSettledResult<unknown>[]>;
  pressAction(id: SkykitActionId, payload?: unknown): void;
  releaseAction(id: SkykitActionId): void;
  unregister(): void;
}

export interface InstallSkykitDebugGlobalOptions {
  name?: string;
  target?: Record<string, unknown>;
}

export declare const SKYKIT_ACTION_NAMESPACE: 'skykit:';
export declare const SKYKIT_ACTIONS: {
  readonly viewer: {
    readonly reset: 'skykit:viewer.reset';
  };
  readonly observer: {
    readonly recenterParallax: 'skykit:observer.parallax.recenter';
    readonly enableParallaxTilt: 'skykit:observer.parallax.enableTilt';
  };
  readonly navigation: {
    readonly flyTo: 'skykit:navigation.flyTo';
    readonly flyPolyline: 'skykit:navigation.flyPolyline';
    readonly transitionTo: 'skykit:navigation.transitionTo';
    readonly orbit: 'skykit:navigation.orbit';
    readonly orbitalInsert: 'skykit:navigation.orbitalInsert';
    readonly lookAt: 'skykit:navigation.lookAt';
    readonly lockAt: 'skykit:navigation.lockAt';
    readonly unlockAt: 'skykit:navigation.unlockAt';
    readonly cancelMovement: 'skykit:navigation.cancelMovement';
    readonly cancelOrientation: 'skykit:navigation.cancelOrientation';
    readonly cancel: 'skykit:navigation.cancel';
  };
  readonly ship: {
    readonly moveForward: 'skykit:ship.move.forward';
    readonly moveBack: 'skykit:ship.move.back';
    readonly moveLeft: 'skykit:ship.move.left';
    readonly moveRight: 'skykit:ship.move.right';
    readonly moveUp: 'skykit:ship.move.up';
    readonly moveDown: 'skykit:ship.move.down';
    readonly pitchUp: 'skykit:ship.attitude.pitchUp';
    readonly pitchDown: 'skykit:ship.attitude.pitchDown';
    readonly yawLeft: 'skykit:ship.attitude.yawLeft';
    readonly yawRight: 'skykit:ship.attitude.yawRight';
    readonly rollClockwise: 'skykit:ship.attitude.rollClockwise';
    readonly rollAnticlockwise: 'skykit:ship.attitude.rollAnticlockwise';
    readonly boost: 'skykit:ship.boost';
  };
  readonly layer: {
    readonly toggle: 'skykit:layer.toggle';
    readonly show: 'skykit:layer.show';
    readonly hide: 'skykit:layer.hide';
  };
  readonly scale: {
    readonly setDomain: 'skykit:scale.setDomain';
    readonly startTransition: 'skykit:scale.startTransition';
    readonly completeTransition: 'skykit:scale.completeTransition';
  };
  readonly selection: {
    readonly clear: 'skykit:selection.clear';
    readonly select: 'skykit:selection.select';
    readonly flyToSelected: 'skykit:selection.flyToSelected';
    readonly openExternal: 'skykit:selection.openExternal';
  };
  readonly xr: {
    readonly enter: 'skykit:xr.enter';
    readonly exit: 'skykit:xr.exit';
    readonly toggle: 'skykit:xr.toggle';
    readonly pointerSelect: 'skykit:xr.pointer.select';
  };
};
export declare const SKYKIT_CONTROLS: {
  readonly observer: {
    readonly parallaxOffset: 'skykit:observer.control.parallaxOffset';
  };
  readonly ship: {
    readonly move: 'skykit:ship.control.move';
    readonly attitude: 'skykit:ship.control.attitude';
  };
};
export declare function createSkykitActionRegistry(): SkykitActionRegistry;
export declare function createSkykitInspectFacade(options: {
  viewer: SkykitViewer;
  products?: SkykitProductRegistry | null;
  selection?: SkykitSelectionFacade | null;
  getXrSnapshot?: (() => unknown) | null;
  getRuntimeSnapshot?: (() => unknown) | null;
  historyLimit?: number;
}): SkykitInspectFacade;
export declare function createSkykitProductRegistry(): SkykitProductRegistry;
export declare function getSkykitProductRegistry(ctx: SkykitPluginContext): SkykitProductRegistry;
export declare function createSkykitProductRegistryPlugin(options?: { id?: string }): SkykitProductRegistryPlugin;
export declare function productRef<T = unknown>(key: SkykitProductKey): SkykitProductRef<T>;
export declare function isSkykitProductRef(value: unknown): value is SkykitProductRef;
export declare function resolveSkykitProductRef<T>(
  products: SkykitProductRegistry,
  ref: SkykitProductRef<T>
): T | null;
export declare function resolveSkykitProductInput<T>(
  products: SkykitProductRegistry,
  valueOrRef: T | SkykitProductRef<T> | null | undefined
): T | null;
export declare function createSkykitSelectionStore<T = unknown>(initial?: T | null): SkykitSelectionStore<T>;
export declare function createSkykitSelectionFacade<T = SkykitSelectionValue>(
  options?: {
    store?: SkykitSelectionStore<T> | null;
    products?: SkykitProductRegistry | null;
    key?: SkykitProductKey;
  }
): SkykitSelectionFacade<T>;
export declare function isSkykitSelectionStore(value: unknown): value is SkykitSelectionStore;
export declare function isSkykitSelectionFacade(value: unknown): value is SkykitSelectionFacade;
export declare function createSkykitStarSelectionFromPick(
  pick: ThreeStarFieldPickResult,
  options?: {
    label?: string | null;
    metadata?: SkykitStarPickMetadata;
    source?: string;
    eventType?: string;
  }
): SkykitSelectionValue;
export declare function createSkykitLayerSelectionFromPick(
  hitOrRoute?: SkykitLayerPickHit | SkykitLayerPickRouteLike | null,
  options?: SkykitLayerSelectionOptions
): SkykitSelectionValue | null;
export declare function resolveSkykitStarSelectionLabel(
  metadata: SkykitStarPickMetadata,
  pick: ThreeStarFieldPickResult
): string;
export declare function createSkykitSelectionProductsPlugin<T = unknown>(
  options?: SkykitSelectionProductsPluginOptions<T>
): SkykitPlugin & {
  readonly primary: SkykitSelectionStore<T>;
  readonly hovered: SkykitSelectionStore<T> | null;
  getSnapshot(): unknown;
};
export declare function createSkykitLayerSelectionPlugin(
  options?: SkykitLayerSelectionPluginOptions
): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function createAnchoredImageCatalog(
  options?: AnchoredImageCatalogOptions
): Promise<AnchoredImageCatalog>;
export declare function createManualAnchoredImageController(
  options?: ManualAnchoredImageControllerOptions
): AnchoredImageController;
export declare function createViewAnchoredImageController(
  options?: ViewAnchoredImageControllerOptions
): AnchoredImageController;
export declare function createAnchoredImageSkyPlugin(
  options: AnchoredImageSkyPluginOptions
): AnchoredImageSkyPlugin;
export declare function createSkykitViewer(options?: SkykitViewerOptions): Promise<SkykitViewer>;
export declare function createDesktopSkykitObserverRig(options?: DesktopSkykitObserverRigOptions): SkykitObserverRig;
export declare function createObject3dLayer(options: Object3dLayerOptions): SkykitThreePart;
export declare function createObject3dPlugin(options: Object3dLayerOptions): SkykitObject3dPlugin;
export declare function createSkykitLayerHostPlugin(options?: SkykitLayerHostOptions): SkykitLayerHostPlugin;
export declare function createSkykitScaleCoordinatorPlugin(
  options?: SkykitScaleCoordinatorPluginOptions
): SkykitScaleCoordinatorPlugin;
export declare function getSkykitScaleStore(ctx: SkykitPluginContext): SkykitScaleStore;
export declare function createSkykitConstellationLayer(
  options: SkykitConstellationLayerOptions
): SkykitConstellationLayer;
export declare function createSkykitConstellationPlugin(
  options: SkykitConstellationLayerOptions
): SkykitPlugin & {
  getLayer(): SkykitConstellationLayer;
  getSnapshot(): unknown;
};
export declare function createSkykitCoordinateFrameMarkerLayer(
  options: SkykitCoordinateFrameMarkerLayerOptions
): SkykitCoordinateFrameMarkerLayer;
export declare function createSkykitCoordinateFrameMarkerPlugin(
  options: SkykitCoordinateFrameMarkerLayerOptions
): SkykitPlugin & {
  getLayer(): SkykitCoordinateFrameMarkerLayer;
  getSnapshot(): unknown;
};
export declare function createSkykitStarSourcePlugin(options: SkykitStarSourcePluginOptions): SkykitStarCellSource;
export declare function createStreamingStarLayer(options: StreamingStarLayerOptions): StreamingStarLayer;
export declare function createStreamingStarsPlugin(options: StreamingStarLayerOptions): SkykitStreamingStarsPlugin;
export declare function createSkykitStellarSkyLayer(options: SkykitStellarSkyLayerOptions): SkykitStellarSkyLayer;
export declare function createSkykitHrDiagramPlugin(options: SkykitHrDiagramPluginOptions): SkykitHrDiagramPlugin;
export declare function createSkykitStarInstrumentPlugin(options: SkykitStarInstrumentPluginOptions): SkykitStarInstrumentPlugin;
export declare function createSkykitStarPickingPlugin(options: SkykitStarPickingPluginOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function createSkykitStarPickMetadataResolver(
  options?: SkykitStarPickMetadataResolverOptions
): SkykitStarPickMetadataResolver;
export declare function createSkykitRenderCoordinateOutput(
  coordinateUnitsPerParsec: number
): StarOctreeCoordinateOutput;
export declare const SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS: SkykitKeyboardNavigationBindings;
export declare function createSkykitDefaultKeyboardNavigationBindings(
  overrides?: Partial<Record<string, SkykitKeyboardNavigationBinding>>
): Record<string, SkykitKeyboardNavigationBinding>;
export declare function createKeyboardNavigationPlugin(options?: SkykitKeyboardNavigationOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function createSkykitNavigationPlugin(options?: SkykitNavigationPluginOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function createSkykitStarPreloadRequestsFromSpatialHints(
  hints: Iterable<SpatialPreloadHint>,
  options?: SkykitSpatialPreloadStrategyOptions
): SkykitStarPreloadRequest[];
/**
 * Strategy-only convenience helper. View-bound lookahead hints stay in preload
 * requests so their authored view can travel with the warm-lane strategy.
 */
export declare function createSkykitStarStrategiesFromSpatialHints(
  hints: Iterable<SpatialPreloadHint>,
  options?: SkykitSpatialPreloadStrategyOptions
): StarCellStrategy | StarCellStrategy[] | null;
export declare function createSkyGrabPlugin(options?: SkykitDragLookOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function createMouseLookPlugin(options?: SkykitDragLookOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function createSkyOrbitPlugin(options?: SkykitOrbitDragOptions): SkykitOrbitDragPlugin;
export declare function createSkykitStatusPlugin(options?: SkykitStatusPluginOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function createSkykitAnimationLoop(
  viewer: SkykitViewer,
  options?: SkykitAnimationLoopOptions
): SkykitAnimationLoop;
export declare function createSkykitDebugBridge(): SkykitDebugBridge;
export declare function installSkykitDebugGlobal(
  debugBridge: SkykitDebugBridge,
  options?: InstallSkykitDebugGlobalOptions
): () => void;
