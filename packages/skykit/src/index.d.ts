import type { ProductDelta } from '@found-in-space/product-stream';
import type { StarObjectBatchProduct } from '@found-in-space/star-products';
import type {
  StarOctreeCoordinateOutput,
  StarOctreeProviderService,
  StarOctreeProviderSession,
  StarOctreeSessionOptions,
  StarOctreeViewPatch,
  ViewUpdateOptions,
} from '@found-in-space/star-octree-provider';
import type { ThreeStarField } from '@found-in-space/three-star-field';
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

export interface SkykitObserverMotion {
  velocityPcPerSec: Vector3Like;
  speedPcPerSec: number;
}

export interface SkykitViewState {
  revision: number;
  observerPc: Vector3Like;
  renderObserverPosition: Vector3Like;
  targetPc?: Vector3Like | null;
  directionIcrs?: Vector3Like | null;
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

export interface SkykitThreeFrame extends SkykitFrameBase {
  renderer: THREE.WebGLRenderer | SkykitRendererLike;
  scene: THREE.Scene;
  camera: THREE.Camera;
  roots: SkykitSceneRoots;
  observerRig: SkykitObserverRig;
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

export interface SkykitPluginContext {
  readonly mode: 'three';
  readonly viewer: SkykitViewer;
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
  render?(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose?(): void;
}

export interface SkykitViewerOptions {
  id?: string;
  host?: { appendChild?: (node: unknown) => void; removeChild?: (node: unknown) => void; clientWidth?: number; clientHeight?: number } | null;
  scene?: THREE.Scene;
  renderer?: THREE.WebGLRenderer | SkykitRendererLike;
  camera?: THREE.Camera;
  roots?: Partial<SkykitSceneRoots>;
  observerRig?: SkykitObserverRig;
  parts?: Iterable<SkykitThreePart>;
  plugins?: Iterable<SkykitPluginInput>;
  view?: Partial<SkykitViewState>;
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
  addPart(part: SkykitThreePart): SkykitPluginTeardown;
  getViewState(): SkykitViewState;
  requestViewState(patch: Partial<SkykitViewState>, reason?: string): void;
  update(deltaSeconds?: number): void;
  render(): void;
  frame(deltaSeconds?: number): void;
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

export interface SkykitObject3dPlugin extends SkykitPlugin {
  getLayer(): SkykitThreePart | null;
  getSnapshot(): unknown;
}

export interface StreamingStarLayerOptions {
  id?: string;
  priority?: number;
  provider: StarOctreeProviderService;
  renderer: ThreeStarField;
  session?: StarOctreeSessionOptions | StarOctreeProviderSession;
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
  apply(delta: ProductDelta<StarObjectBatchProduct>): void;
  getSnapshot(): StreamingStarLayerSnapshot;
}

export interface SkykitStreamingStarsPlugin extends SkykitPlugin {
  getLayer(): StreamingStarLayer | null;
  getSnapshot(): unknown;
}

export type SkykitKeyboardNavigationAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down';

export interface SkykitKeyboardNavigationOptions {
  id?: string;
  priority?: number;
  target?: EventTarget | null;
  enabled?: boolean;
  speedPcPerSec?: number;
  boostMultiplier?: number;
  boostKeys?: readonly string[];
  bindings?: Record<string, SkykitKeyboardNavigationAction>;
  preventDefault?: boolean;
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

export interface SkykitAnimationLoopOptions {
  autoStart?: boolean;
  render?: boolean;
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
  registerViewer(viewer: SkykitViewer, options?: SkykitDebugRegisterOptions): SkykitDebugViewer;
  unregisterViewer(target: string | number | SkykitViewer): boolean;
  getObserverPc(target?: string | number | SkykitViewer): Vector3Like | null;
  setObserverPc(point: Vector3Like, target?: string | number | SkykitViewer): Vector3Like;
  setObserverPc(x: number, y: number, z: number, target?: string | number | SkykitViewer): Vector3Like;
  flyToPc(point: Vector3Like, options?: Record<string, unknown>, target?: string | number | SkykitViewer): Vector3Like;
  lookAtPc(point: Vector3Like, options?: Record<string, unknown>, target?: string | number | SkykitViewer): Vector3Like;
  cancelAutomation(target?: string | number | SkykitViewer): boolean;
}

export interface SkykitDebugRegisterOptions {
  id?: string;
  label?: string;
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
  unregister(): void;
}

export interface InstallSkykitDebugGlobalOptions {
  name?: string;
  target?: Record<string, unknown>;
}

export declare function createSkykitViewer(options?: SkykitViewerOptions): Promise<SkykitViewer>;
export declare function createDesktopSkykitObserverRig(options?: DesktopSkykitObserverRigOptions): SkykitObserverRig;
export declare function createObject3dLayer(options: Object3dLayerOptions): SkykitThreePart;
export declare function createObject3dPlugin(options: Object3dLayerOptions): SkykitObject3dPlugin;
export declare function createStreamingStarLayer(options: StreamingStarLayerOptions): StreamingStarLayer;
export declare function createStreamingStarsPlugin(options: StreamingStarLayerOptions): SkykitStreamingStarsPlugin;
export declare function createKeyboardNavigationPlugin(options?: SkykitKeyboardNavigationOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
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
