import type {
  BufferGeometry,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type {
  CameraRig,
  CameraRigController,
  CommandBase,
  CommandResultOf,
  DatasetCommand,
  DatasetDescription,
  DatasetEvent,
  DatasetHandle,
  DatasetSessionOptions,
  DatasetSnapshot,
  DecodedStarsOptions,
  DesktopExplorerPreset,
  DesktopExplorerPresetOptions,
  DefaultViewerOptions,
  DefaultViewerState,
  DispatchResult,
  DispatchResultOf,
  EventBase,
  FoundInSpaceDatasetOptions,
  HookMap,
  HookValueOf,
  HRDiagramControl,
  HRDiagramValue,
  HudPreset,
  JourneyCommand,
  JourneyController,
  JourneyControllerOptions,
  JourneyEvent,
  JourneyGraph,
  JourneyResolvedSceneSpec,
  JourneySceneSpec,
  JourneySnapshot,
  JourneyTransitionSpec,
  NearestStarsQueryOptions,
  NearestStarsResult,
  OctreeNodeLike,
  OrbitalInsertRoute,
  PickController,
  PickMeta,
  Point3,
  Point3Like,
  PolylineRoute,
  ResolvedPickMeta,
  ResolvedStar,
  ResolvedStarLookup,
  RuntimeRig,
  SelectionRefreshController,
  SelectionRefreshSnapshot,
  SidecarMetaFields,
  Size2D,
  SkyKitBuiltinHookMap,
  SkyKitPlugin,
  SnapshotController,
  SnapshotControllerEvent,
  SnapshotControllerOptions,
  StarDataId,
  StarFieldMaterialProfile,
  StarFieldState,
  TouchDisplay,
  TouchDisplayHit,
  TouchDisplayItem,
  ViewerJourneyControllerOptions,
  ViewerJourneySceneContext,
  ViewerJourneySceneSpec,
  ViewerCommand,
  ViewerCreateOptions,
  ViewerEvent,
  ViewerHandle,
  ViewerNodeSelection,
  ViewerRuntimeContext,
  ViewerRuntimeFrameContext,
  ViewerRuntimePart,
  ViewerRuntimeResizeContext,
  ViewerSnapshot,
  ViewerXrEnterOptions,
  VisibleSelectionResult,
  VisibleStarsQueryOptions,
  VisibleStarsResult,
  VolumeHRLoader,
} from './types/public.js';

export type * from './types/public.js';

export declare const RUNTIME_LIFECYCLE_METHODS: readonly ['attach', 'start', 'update', 'resize', 'dispose'];

export declare class DatasetSession {
  constructor(options?: DatasetSessionOptions);
  readonly id: string;
  readonly manifestUrl: string | null;
  readonly octreeUrl: string | null;
  readonly metaUrl: string | null;
  readonly identifiersOrderUrl: string | null;
  readonly versionKey: string;
  readonly capabilities: Record<string, unknown>;
  readonly sidecars: Record<string, unknown>;
  readonly persistentCache: unknown;
  readonly datasetUuid: string | null;
  readonly datasetIdentitySource: string | null;
  disposed: boolean;
  getCache(name: string): Map<unknown, unknown>;
  clearCaches(): void;
  recordDatasetIdentity(identity: { datasetUuid?: string; datasetIdentitySource?: string | null } | null | undefined): void;
  recordResolvedSidecar(name: string, descriptor: Record<string, unknown> | null | undefined): void;
  getRenderService(): unknown;
  ensureRenderBootstrap(): Promise<unknown>;
  ensureRenderRootShard(): Promise<unknown>;
  getSidecarDescriptor(name: string): Record<string, unknown> | null;
  getSidecarService(name: string): unknown;
  resolvePrimarySidecarLabel(name: string, pickMeta: PickMeta): Promise<string>;
  resolveSidecarMetaFields(name: string, pickMeta: PickMeta): Promise<SidecarMetaFields | null>;
  normalizeStarDataId(starDataId: string | StarDataId): StarDataId;
  resolvePickMetaByStarId(starDataId: string | StarDataId): Promise<ResolvedPickMeta | null>;
  resolveStarById<TSidecars extends Record<string, unknown> = Record<string, unknown>>(
    starDataId: string | StarDataId,
    options?: { includeSidecars?: readonly string[] },
  ): Promise<ResolvedStarLookup<TSidecars> | null>;
  resolveSidecarMetaByStarId(name: string, starDataId: string | StarDataId): Promise<SidecarMetaFields | null>;
  describe(): DatasetDescription;
  dispose(options?: { clearCaches?: boolean }): void;
}

export declare function getDatasetSession(options?: DatasetSessionOptions): DatasetSession;

export declare function createDesktopRig(camera: PerspectiveCamera): RuntimeRig;
export declare function createXrRig(camera: PerspectiveCamera, options?: Record<string, unknown>): RuntimeRig;

export declare class ViewerRuntime<
  TState extends object = Record<string, unknown>,
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<ViewerSnapshot<TState>> = never,
> {
  constructor(options?: ViewerCreateOptions<TState>);
  readonly id: string;
  readonly datasetSession: DatasetSession | null;
  readonly hostElement: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly navigationRoot: Object3D;
  readonly cameraMount: Object3D;
  readonly attachmentRoot: Object3D | null;
  readonly deck: Object3D | null;
  readonly contentRoot: Object3D;
  readonly mount: Object3D;
  readonly rigType: string;
  readonly interestField: ViewerRuntimePart | null;
  readonly layers: ViewerRuntimePart[];
  readonly controllers: ViewerRuntimePart[];
  readonly overlays: ViewerRuntimePart[];
  readonly state: TState;
  readonly selection: ViewerNodeSelection;
  readonly size: Size2D;
  readonly frameNumber: number;
  initialized: boolean;
  running: boolean;
  disposed: boolean;
  subscribe(listener: (event: ViewerEvent<TState, ViewerCommand<TState> | TExtraCommand, TExtraEvent>) => void): () => void;
  emitEvent<TSpecificEvent extends ViewerEvent<TState, ViewerCommand<TState> | TExtraCommand, TExtraEvent>>(event: TSpecificEvent): TSpecificEvent;
  getSnapshot(): ViewerSnapshot<TState>;
  getSnapshotState(): ViewerSnapshot<TState>;
  select(): ViewerSnapshot<TState>;
  select<TKey extends Extract<keyof ViewerSnapshot<TState>, string>>(key: TKey): ViewerSnapshot<TState>[TKey];
  select<TResult>(selector: (snapshot: ViewerSnapshot<TState>) => TResult): TResult;
  dispatch<TSpecificCommand extends ViewerCommand<TState> | TExtraCommand>(command: TSpecificCommand): Promise<DispatchResult<ViewerSnapshot<TState>, DispatchResultOf<ViewerCommand<TState> | TExtraCommand, TSpecificCommand>>>;
  initialize(): Promise<this>;
  start(): Promise<this>;
  stop(): this;
  frame(timeMs: number, xrFrame?: unknown): void;
  renderOnce(): void;
  refreshSelection(): Promise<ViewerNodeSelection>;
  resize(widthOrSize?: number | Size2D, height?: number): Promise<Size2D>;
  setState(nextState: Partial<TState>): TState;
  isXrModeSupported(mode?: string): Promise<boolean>;
  enterXR(options?: ViewerXrEnterOptions): Promise<unknown>;
  exitXR(): Promise<boolean>;
  dispose(): Promise<void>;
}

export declare function createSnapshotController<
  TSnapshot extends object = Record<string, unknown>,
  TCommand extends CommandBase = CommandBase,
  TEvent extends EventBase<TSnapshot> = SnapshotControllerEvent<TSnapshot, TCommand>,
  THookMap extends HookMap<TSnapshot, TCommand, TEvent> = SkyKitBuiltinHookMap<TSnapshot, TCommand, TEvent>,
>(options?: SnapshotControllerOptions<TSnapshot, TCommand, TEvent, THookMap>): SnapshotController<TSnapshot, TCommand, TEvent, THookMap>;

export declare function createViewer<
  TState extends object = Record<string, unknown>,
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<ViewerSnapshot<TState>> = never,
>(host: HTMLElement | HTMLCanvasElement, options?: ViewerCreateOptions<TState>): Promise<ViewerHandle<TState, ViewerCommand<TState> | TExtraCommand, ViewerEvent<TState, ViewerCommand<TState> | TExtraCommand, TExtraEvent>>>;

export declare function createDefaultViewer<
  TState extends object = DefaultViewerState,
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<ViewerSnapshot<TState>> = never,
>(host: HTMLElement | HTMLCanvasElement, options?: DefaultViewerOptions<TState>): Promise<ViewerHandle<TState, ViewerCommand<TState> | TExtraCommand, ViewerEvent<TState, ViewerCommand<TState> | TExtraCommand, TExtraEvent>>>;

export declare function createDataset<
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<DatasetSnapshot> = never,
  THookMap extends HookMap<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>> = SkyKitBuiltinHookMap<DatasetSnapshot, DatasetCommand | TExtraCommand, DatasetEvent<TExtraEvent>>,
>(
  options?: DatasetSessionOptions | DatasetSession | DatasetHandle<TExtraCommand, TExtraEvent, THookMap> | {
    session?: DatasetSession | null;
    datasetSession?: DatasetSession | null;
  },
): DatasetHandle<TExtraCommand, TExtraEvent, THookMap>;

export declare function unwrapDatasetSession(value: unknown): DatasetSession | null;

export declare function queryNearestStars<TSidecars extends Record<string, unknown> = Record<string, unknown>>(
  dataset: DatasetSession | DatasetHandle<any, any, any>,
  options?: NearestStarsQueryOptions<TSidecars>,
): Promise<NearestStarsResult<TSidecars>>;

export declare function queryVisibleStars<TSidecars extends Record<string, unknown> = Record<string, unknown>>(
  dataset: DatasetSession | DatasetHandle<any, any, any>,
  options?: VisibleStarsQueryOptions<TSidecars>,
): Promise<VisibleStarsResult<TSidecars>>;

export declare const DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL: string;
export declare const DEFAULT_FOUND_IN_SPACE_OCTREE_URL: string;
export declare function createFoundInSpaceDatasetOptions(options?: FoundInSpaceDatasetOptions): FoundInSpaceDatasetOptions;
export declare function deriveMetaOctreeUrlFromRenderUrl(renderUrl?: string | null): string;
export declare function resolveFoundInSpaceDatasetOverrides(search?: string | null): Partial<Pick<FoundInSpaceDatasetOptions, 'octreeUrl' | 'metaUrl'>>;

export declare const DEFAULT_DUST_MAP_NG_URL: string;

export declare function createConstellationArtGroup(...args: any[]): any;
export declare function disposeConstellationArtGroup(...args: any[]): void;
export declare function loadConstellationArtManifest(...args: any[]): Promise<any>;

export declare function buildConstellationDirectionResolver(...args: any[]): any;
export declare function icrsDirectionToTargetPc(direction: Point3Like, distancePc?: number): Point3;
export declare function toRaDec(direction: Point3Like): { raDeg: number; decDeg: number };

export declare function createNoopInterestField(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function createObserverShellField(options?: Record<string, unknown>): ViewerRuntimePart & Required<Pick<ViewerRuntimePart, 'selectNodes'>>;
export declare function createTargetFrustumField(options?: Record<string, unknown>): ViewerRuntimePart & Required<Pick<ViewerRuntimePart, 'selectNodes'>>;
export declare function aabbDistance(...args: number[]): number;
export declare function selectOctreeNodes(context: { datasetSession: DatasetSession }, options?: Record<string, unknown>): Promise<ViewerNodeSelection>;
export declare function decodeSelectedStars<TSidecars extends Record<string, unknown> = Record<string, unknown>>(
  session: DatasetSession,
  nodes: readonly OctreeNodeLike[],
  options?: DecodedStarsOptions<TSidecars>,
): Promise<Array<ResolvedStar<TSidecars>>>;
export declare function normalizePoint(point: Point3Like | null | undefined, fallback?: Point3Like | null): Point3 | null;
export declare function resolveDatasetSession(dataset: DatasetSession | DatasetHandle<any, any, any>): DatasetSession;
export declare function resolveVisibleSelection(session: DatasetSession, options?: VisibleStarsQueryOptions): Promise<VisibleSelectionResult>;
export declare function selectNodesInSphere(session: DatasetSession, options?: {
  centerPc?: Point3Like | null;
  observerPc?: Point3Like | null;
  radiusPc?: number;
  maxLevel?: number;
  sortNodes?: (left: OctreeNodeLike, right: OctreeNodeLike) => number;
}): Promise<ViewerNodeSelection>;

export declare function createCameraRig(options?: Record<string, unknown>): CameraRig;
export declare function createCameraRigController(options?: Record<string, unknown>): CameraRigController;
export declare function buildOrbitalInsertRoute(startPc: Point3Like, options?: Record<string, unknown>): OrbitalInsertRoute;
export declare function buildPolylineRoute(points?: readonly Point3Like[]): PolylineRoute;
export declare function samplePolylineRoutePosition(route: PolylineRoute, distancePc: number): Point3;

export declare function createSceneTouchDisplayController(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function createXrLocomotionController(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function readXrAxes(inputSources: readonly unknown[], options?: Record<string, unknown>): Record<string, unknown>;
export declare function createConstellationCompassController(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function captureSelectionRefreshSnapshot(snapshot: ViewerSnapshot): SelectionRefreshSnapshot;
export declare function createSelectionRefreshController(options?: Record<string, unknown>): SelectionRefreshController;
export declare function getSelectionRefreshReasons(previousSnapshot: ViewerSnapshot | null, nextSnapshot: ViewerSnapshot, options?: Record<string, unknown>): string[];

export declare function createConstellationArtLayer(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function createHaTiledVolumeLayer(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function createHaTiledVolumeMaterial(options?: Record<string, unknown>): unknown;
export declare function createMinimalSceneLayer(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function createStarFieldLayer(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function createIcrsToSceneYUpTransform(targetPc: Point3Like): (x: number, y: number, z: number) => Vector3;
export declare function createSceneOrientationTransforms(targetPc: Point3Like): {
  icrsToScene: ReturnType<typeof createIcrsToSceneYUpTransform>;
  sceneToIcrs: ReturnType<typeof createSceneToIcrsYUpTransform>;
};
export declare function createSceneToIcrsYUpTransform(targetPc: Point3Like): (x: number, y: number, z: number) => Vector3;
export declare function createCartoonStarFieldMaterialProfile(options?: Record<string, unknown>): StarFieldMaterialProfile;
export declare function createDefaultStarFieldMaterialProfile(options?: Record<string, unknown>): StarFieldMaterialProfile;
export declare function createTunedStarFieldMaterialProfile(options?: Record<string, unknown>): StarFieldMaterialProfile;
export declare function createVrStarFieldMaterialProfile(options?: Record<string, unknown>): StarFieldMaterialProfile;
export declare function createDensityFieldMaterialProfile(options?: Record<string, unknown>): Record<string, unknown>;
export declare function createHighlightStarFieldMaterialProfile(options?: Record<string, unknown>): Record<string, unknown>;

export declare const DEFAULT_MAG_LIMIT: number;
export declare const DEFAULT_TUNED_EXPOSURE: number;
export declare const DEFAULT_STAR_FIELD_STATE: Readonly<StarFieldState>;
export declare const DEFAULT_XR_STAR_FIELD_STATE: Readonly<StarFieldState>;

export declare function createDeviceTiltTracker(options?: Record<string, unknown>): Record<string, unknown>;
export declare function computeXrDepthRange(options?: Record<string, unknown>): { near: number; far: number };

export declare function createHud(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function createTouchDisplay(options?: Record<string, unknown>): TouchDisplay;
export declare function buildHRDiagramValue(geometry: BufferGeometry, options?: Record<string, unknown>): HRDiagramValue;
export declare function createHRDiagramControl(options?: Record<string, unknown>): HRDiagramControl;
export declare function decodeTeff(log8Byte: number): number;
export declare function drawHRDiagramGraphic(
  ctx: CanvasRenderingContext2D,
  rect: DOMRect | { x: number; y: number; width: number; height: number },
  value: HRDiagramValue,
  options?: Record<string, unknown>,
): void;
export declare function magToY(mag: number, height: number, margin: number, minMag: number, maxMag: number): number;
export declare function tempToX(tempK: number, width: number, margin: number, coolK: number, hotK: number): number;

export declare const PRESET_ARROWS: Readonly<HudPreset>;
export declare const PRESET_QE: Readonly<HudPreset>;
export declare const PRESET_VERTICALS: Readonly<HudPreset>;
export declare const PRESET_WASD: Readonly<HudPreset>;
export declare const PRESET_WASD_QE: Readonly<HudPreset>;
export declare function resolvePreset(name: string): HudPreset;

export declare const ALCYONE_PC: Readonly<Point3>;
export declare const GALACTIC_CENTER_PC: Readonly<Point3>;
export declare const HYADES_CENTER_PC: Readonly<Point3>;
export declare const OMEGA_CEN_CENTER_PC: Readonly<Point3>;
export declare const ORION_CENTER_PC: Readonly<Point3>;
export declare const ORION_NEBULA_PC: Readonly<Point3>;
export declare const PLEIADES_CENTER_PC: Readonly<Point3>;
export declare const SCENE_TARGETS_PC: Readonly<Record<string, Readonly<Point3>>>;
export declare const SOLAR_ORIGIN_PC: Readonly<Point3>;
export declare const UPPER_SCO_CENTER_PC: Readonly<Point3>;

export declare const SCENE_SCALE: number;
export declare function createRadioBubbleMeshes(options?: Record<string, unknown>): Object3D;

export declare function createConstellationPreset(options?: Record<string, unknown>): Record<string, unknown>;
export declare function createDesktopExplorerPreset<TState extends object = DefaultViewerState>(
  options?: DesktopExplorerPresetOptions<TState>,
): DesktopExplorerPreset<TState>;
export declare function createFullscreenPreset(options?: Record<string, unknown>): Record<string, unknown>;
export declare function createJourneyController<
  TScene extends JourneyResolvedSceneSpec = JourneyResolvedSceneSpec,
  TExtraCommand extends CommandBase = never,
  TExtraEvent extends EventBase<JourneySnapshot> = never,
  THookMap extends HookMap<JourneySnapshot, JourneyCommand<TScene> | TExtraCommand, JourneyEvent<TScene, TExtraEvent>> = SkyKitBuiltinHookMap<JourneySnapshot, JourneyCommand<TScene> | TExtraCommand, JourneyEvent<TScene, TExtraEvent>>,
>(options: JourneyControllerOptions<TScene, TExtraCommand>): JourneyController<TScene, TExtraCommand, TExtraEvent, THookMap>;
export declare function createJourneyGraph<TCommand extends CommandBase = CommandBase>(options?: {
  initialSceneId?: string | null;
  scenes?: Record<string, JourneySceneSpec<TCommand>>;
  transitions?: readonly JourneyTransitionSpec<TCommand>[];
}): JourneyGraph<TCommand>;
export declare function resolveSceneSpec<TCommand extends CommandBase = CommandBase>(
  graph: JourneyGraph<TCommand>,
  sceneId: string,
  fromSceneId?: string | null,
): JourneyResolvedSceneSpec<TCommand> | null;
export declare function applyViewerJourneyScene<
  TScene extends ViewerJourneySceneSpec = ViewerJourneySceneSpec,
>(
  scene: TScene,
  options: {
    viewer: ViewerJourneySceneContext<TScene>['viewer'];
    cameraController: CameraRigController;
    preloadScene?: (scene: TScene, context: ViewerJourneySceneContext<TScene>) => unknown | Promise<unknown>;
    applySceneState?: (scene: TScene, context: ViewerJourneySceneContext<TScene>) => unknown | Promise<unknown>;
  },
): Promise<TScene>;
export declare function createViewerJourneyController<
  TScene extends ViewerJourneySceneSpec = ViewerJourneySceneSpec,
  TExtraCommand extends CommandBase = never,
>(
  options: ViewerJourneyControllerOptions<TScene, TExtraCommand>,
): JourneyController<TScene, TExtraCommand>;
export declare function createParallaxPositionController(options?: Record<string, unknown>): Record<string, unknown>;
export declare function createDistanceReadout(cameraController: CameraRigController, targetPc: Point3Like, options?: Record<string, unknown>): Record<string, unknown>;
export declare function createFlyToAction(cameraController: CameraRigController, targetPc: Point3Like, options?: Record<string, unknown>): Record<string, unknown>;
export declare function createLookAtAction(cameraController: CameraRigController, targetPc: Point3Like, options?: Record<string, unknown>): Record<string, unknown>;
export declare function createSpeedReadout(cameraController: CameraRigController, options?: Record<string, unknown>): Record<string, unknown>;
export declare function formatDistancePc(distancePc: number): string;
export declare function formatSpeedPcPerSec(pcPerSec: number): string;

export declare function createVolumeHRLoader(options?: {
  datasetSession?: DatasetSession;
  selectionMode?: 'sphere' | 'node-cache' | string;
}): VolumeHRLoader;
export declare class HRDiagramRenderer {
  constructor(hostCanvas: HTMLCanvasElement, options?: Record<string, unknown>);
  resize(): void;
  setMode(mode: string): void;
  setAppMagLimit(limit: number): void;
  setVolumeRadiusPc(radiusPc: number): void;
  setHighlightRegion(region: Record<string, unknown> | null): void;
  setStarCount(count: number): void;
  setGeometry(geometry: BufferGeometry): void;
  drawAxes(): void;
  render(cameraWorldPosition?: Point3Like | Vector3): void;
  setViewProjection(matrix: Matrix4): void;
  dispose(): void;
}

export declare const DEFAULT_MCCALLUM_HA_TILED_VOLUME_URL: string;
export declare function loadHaTiledVolume(...args: any[]): Promise<any>;
export declare function resolveHaTiledVolumeLevelIds(...args: any[]): string[];
export declare function resolveHaTiledVolumeUrl(...args: any[]): string;

export declare const DEFAULT_PICK_TOLERANCE_DEG: number;
export declare function computeVisualRadiusPx(mApp: number, options?: Record<string, unknown>): number;
export declare function decodeTemperatureK(teffLog8Raw: number): number;
export declare function pickStar(ray: unknown, starData: unknown, options?: Record<string, unknown>): Record<string, unknown> | null;

export declare function formatBayerDesignation(entry: Record<string, unknown>): string;
export declare function metaEntryDisplayFields(entry: Record<string, unknown>): SidecarMetaFields | null;

export declare function buildSimbadBasicSearch(fields: Record<string, unknown>): string;

export declare function decodeMorton3D(mortonCode: bigint | number | string, level: number): {
  gridX: number;
  gridY: number;
  gridZ: number;
};
export declare function encodeMorton3D(gridX: number, gridY: number, gridZ: number, level: number): bigint;
export declare function fromStarDataId(starDataId: string | StarDataId): StarDataId;
export declare function parseStarDataId(serialized: string): StarDataId;
export declare function serializeStarDataId(starDataId: string | StarDataId): string;
export declare function toStarDataId(pickMeta: PickMeta, datasetIdentity: { datasetUuid: string }): StarDataId;

export declare function createPickController(options?: Record<string, unknown>): PickController;
export declare function createXrPickController(options?: Record<string, unknown>): ViewerRuntimePart;
export declare function projectToHud(worldPosition: Vector3, camera: PerspectiveCamera, distance: number, target?: Vector3): Vector3;

export declare const DEFAULT_METERS_PER_PARSEC: number;
export declare const SCALE: number;
export declare const XR_SUN_EYE_LEVEL_M: number;
export declare const XR_SUN_FORWARD_OFFSET_M: number;
