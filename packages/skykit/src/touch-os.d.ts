import type {
  AppShellChange,
  AppShellPresentation,
  AppShellSession,
  AppShellSessionSeed,
  DisplayNode,
  DisplayRuntime,
  EmbeddedSurfaceService,
  RuntimeOutput,
  RuntimeOptions,
  SurfaceMetrics,
  TabletHomeLauncherLayoutOptions,
  TouchAppCapability,
  TouchAppContext,
  TouchAppEvent,
  TouchAppModule,
  TouchAppPreferredWindow,
  TouchAppRegistry,
  TouchAppStorage,
  TouchIconDescriptor,
  WindowManagerAppHostMode,
} from '@found-in-space/touch-os';
import type {
  HudPanelDriverOptions,
  PoseAnchoredPanelDriverOptions,
  ScenePanelDriverOptions,
  ThreeHostPose,
  ThreePanelDriver,
  ThreePanelHostFrame,
  ThreePanelHostInputEvent,
  ThreePointerSample,
  ThreePointerSource,
} from '@found-in-space/touch-os/hosts/three';
import type * as THREE from 'three';
import type { SkykitXrRay } from './xr.js';
import type {
  SkykitActionRegistry,
  SkykitPlugin,
  SkykitPluginContext,
  SkykitThreeFrame,
  SkykitViewer,
  SkykitViewState,
} from './index.js';

export interface TouchOsHudTarget {
  clientWidth?: number;
  clientHeight?: number;
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void;
  getBoundingClientRect(): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
}

export type SkykitTouchStatus =
  | string
  | number
  | {
      id?: string;
      label?: string;
      value?: string | number;
      text?: string;
      tone?: 'default' | 'muted';
      align?: 'left' | 'center' | 'right';
    }
  | null;

export interface TouchOsHudRootContext {
  id: string;
  context: SkykitPluginContext;
  viewer: SkykitViewer;
  frame: SkykitThreeFrame | null;
  view: SkykitViewState;
  target: TouchOsHudTarget;
  surfaceMetrics: SurfaceMetrics;
  status: SkykitTouchStatus | null;
}

export type TouchOsHudRootFactory = (
  context: TouchOsHudRootContext
) => DisplayNode | null | undefined;

export interface TouchOsHudOutputContext {
  context: SkykitPluginContext;
  viewer: SkykitViewer;
  actions: SkykitActionRegistry;
  runtime: DisplayRuntime;
  driver: ThreePanelDriver;
  frame: SkykitThreeFrame | null;
  target: TouchOsHudTarget;
}

export type TouchOsHudDriverOptions = Omit<
  HudPanelDriverOptions,
  'runtime' | 'surface' | 'parent' | 'pointerSources'
>;

export interface TouchOsHudPluginOptions {
  id?: string;
  target: TouchOsHudTarget;
  enabled?: boolean;
  root: DisplayNode | TouchOsHudRootFactory;
  status?: SkykitTouchStatus | ((context: TouchOsHudRootContext) => SkykitTouchStatus | null | undefined);
  surfaceMetrics?: Partial<SurfaceMetrics> | ((target: TouchOsHudTarget) => Partial<SurfaceMetrics> | null | undefined);
  pointerEvents?: boolean | readonly string[];
  sourcePrefix?: string;
  /** Controls which touch-os outputs enter the SkyKit action registry. Defaults to `raw-actions`. */
  actionOutputMode?: TouchOsActionOutputMode;
  parent?: THREE.Object3D | ((frame: SkykitThreeFrame) => THREE.Object3D | undefined);
  runtime?: DisplayRuntime;
  runtimeOptions?: Omit<RuntimeOptions, 'root' | 'surface'>;
  createRuntime?: (options: RuntimeOptions) => DisplayRuntime;
  /** Borrowed driver. Supply the same runtime used to construct it; driverOptions/createDriver do not apply. */
  driver?: ThreePanelDriver;
  /** Host presentation options; frame parent, surface metrics, and pointer input are managed by SkyKit. */
  driverOptions?: TouchOsHudDriverOptions;
  createDriver?: (options: HudPanelDriverOptions) => ThreePanelDriver;
  /** Override inferred runtime ownership. Supplied runtimes are borrowed by default. */
  disposeRuntime?: boolean;
  /** Override inferred driver ownership. Supplied drivers are borrowed by default. */
  disposeDriver?: boolean;
  onOutput?: (output: RuntimeOutput, context: TouchOsHudOutputContext) => void;
}

export interface TouchOsHudPlugin extends SkykitPlugin {
  id: string;
}

export type TouchOsPanelDriverKind = 'hud' | 'pose-anchored' | 'scene';

export type TouchOsActionOutputMode = 'raw-actions' | 'app-actions' | 'none';

export interface SkykitTabletRootOptions {
  id?: string;
  apps?: readonly TouchAppModule<unknown>[];
  registry?: TouchAppRegistry;
  presentation?: AppShellPresentation;
  appHostMode?: WindowManagerAppHostMode;
  homeKey?: boolean;
  keepAlive?: boolean;
  initialSessions?: readonly AppShellSessionSeed[];
  appStates?: Readonly<Record<string, unknown>>;
  getAppState?: (session: AppShellSession) => unknown;
  forwardAppOutputs?: boolean;
  storage?: TouchAppStorage;
  surfaces?: EmbeddedSurfaceService;
  onAppEvent?: (event: TouchAppEvent) => void;
  onShellChange?: (change: AppShellChange) => void;
  homeControl?: 'button' | 'bar' | 'none';
  taskSwitcher?: 'cards' | 'list' | 'none';
  taskCloseControl?: 'button' | 'none';
  launcherLayout?: TabletHomeLauncherLayoutOptions;
}

export interface SkykitSurfaceAppRenderContext<TState = unknown> {
  context: TouchAppContext;
  state: TState;
}

export interface SkykitSurfaceAppOutputContext {
  context: TouchAppContext;
}

export interface SkykitSurfaceAppOptions<TState = unknown> {
  id: string;
  name: string;
  version?: string;
  icon?: TouchIconDescriptor;
  capabilities?: readonly TouchAppCapability[];
  preferredWindow?: TouchAppPreferredWindow;
  rootId?: string;
  node:
    | DisplayNode
    | ((context: SkykitSurfaceAppRenderContext<TState>) => DisplayNode | null | undefined);
  padding?: number;
  pointerOpaque?: boolean;
  backgroundColor?: string;
  emptyLabel?: string;
  onOutput?: (output: RuntimeOutput, context: SkykitSurfaceAppOutputContext) => void;
}

export interface TouchOsPanelRootContext {
  id: string;
  context: SkykitPluginContext;
  viewer: SkykitViewer;
  frame: SkykitThreeFrame | null;
  view: SkykitViewState;
  surfaceMetrics: SurfaceMetrics;
}

export type TouchOsPanelRootFactory = (
  context: TouchOsPanelRootContext
) => DisplayNode | null | undefined;

export interface TouchOsPanelOutputContext {
  context: SkykitPluginContext;
  viewer: SkykitViewer;
  actions: SkykitActionRegistry;
  runtime: DisplayRuntime;
  driver: ThreePanelDriver;
  frame: SkykitThreeFrame | null;
}

export type TouchOsPanelSurfaceMetricsInput =
  | Partial<SurfaceMetrics>
  | ((frame: SkykitThreeFrame | null) => Partial<SurfaceMetrics> | null | undefined);

export type TouchOsPanelDriverOptions =
  | Omit<ScenePanelDriverOptions, 'runtime' | 'surface' | 'parent' | 'pointerSources'>
  | Omit<PoseAnchoredPanelDriverOptions, 'runtime' | 'surface' | 'parent' | 'pointerSources'>
  | Omit<HudPanelDriverOptions, 'runtime' | 'surface' | 'parent' | 'pointerSources'>;

export interface SkykitTouchOsPointerSource {
  /** Receives the complete SkyKit frame. Returned sample timestamps are normalized by the bridge. */
  sample(frame: SkykitThreeFrame): readonly ThreePointerSample[];
  /** Clears source-owned pressed and edge state without disposing the source. */
  clear?(): void;
}

export type SkykitTouchOsPointerResolver = (
  frame: SkykitThreeFrame
) => ThreePointerSample | readonly ThreePointerSample[] | null | undefined;

export interface SkykitTouchOsPointerSourceOptions {
  sample: SkykitTouchOsPointerResolver;
  clear?(): void;
}

export interface TouchOsPanelPluginOptions {
  id?: string;
  priority?: number;
  enabled?: boolean;
  driver?: TouchOsPanelDriverKind;
  root: DisplayNode | TouchOsPanelRootFactory;
  surfaceMetrics?: TouchOsPanelSurfaceMetricsInput;
  sourcePrefix?: string;
  /** Controls which touch-os outputs enter the SkyKit action registry. Defaults to `raw-actions`. */
  actionOutputMode?: TouchOsActionOutputMode;
  parent?: THREE.Object3D | ((frame: SkykitThreeFrame) => THREE.Object3D | undefined);
  anchorPose?: ThreeHostPose | ((frame: SkykitThreeFrame) => ThreeHostPose | null | undefined);
  /** Raw touch-os sources whose callbacks receive `ThreePanelHostFrame`. Borrowed and never disposed. */
  pointerSources?: readonly ThreePointerSource[];
  /** SkyKit-aware sources sampled before host-frame construction. Borrowed and never disposed. */
  skykitPointerSources?: readonly SkykitTouchOsPointerSource[];
  runtime?: DisplayRuntime;
  runtimeOptions?: Omit<RuntimeOptions, 'root' | 'surface'>;
  createRuntime?: (options: RuntimeOptions) => DisplayRuntime;
  /** Borrowed driver. Supply its runtime; configure pointer sources and driver options before passing it here. */
  driverHandle?: ThreePanelDriver;
  /** Host presentation options; frame parent, surface metrics, and pointer input are managed by SkyKit. */
  driverOptions?: TouchOsPanelDriverOptions;
  createDriver?: (options: ScenePanelDriverOptions | PoseAnchoredPanelDriverOptions | HudPanelDriverOptions) => ThreePanelDriver;
  /** Override inferred runtime ownership. Supplied runtimes are borrowed by default. */
  disposeRuntime?: boolean;
  /** Override inferred driver ownership. Supplied drivers are borrowed by default. */
  disposeDriver?: boolean;
  onOutput?: (output: RuntimeOutput, context: TouchOsPanelOutputContext) => void;
}

export interface TouchOsPanelPlugin extends SkykitPlugin {
  id: string;
  getRuntime(): DisplayRuntime | null;
  getDriver(): ThreePanelDriver | null;
  getHit(): ReturnType<ThreePanelDriver['getHit']> | null;
  /** Clear one or all panel pointers at the latest SkyKit timestamp and drain cancellation outputs immediately. */
  clearPointer(pointerId?: string): void;
  blockRay(
    ray: SkykitXrRay,
    context?: { maxDistance?: number | null }
  ): { blocked: true; consumed: true; distance: number; hit: THREE.Intersection<THREE.Object3D> } | null;
}

export interface DispatchTouchOsActionOutputsOptions {
  sourcePrefix?: string;
  actionOutputMode?: TouchOsActionOutputMode;
}

export interface SkykitTouchCommand {
  id: string;
  label: string;
  actionId: string;
  hold?: boolean;
  disabled?: boolean;
  startPayload?: Record<string, unknown>;
  stopPayload?: Record<string, unknown>;
}

export interface SkykitTouchActionButtonOptions {
  startPayload?: Record<string, unknown>;
  stopPayload?: Record<string, unknown>;
}

export interface SkykitShipControlsRootOptions {
  id?: string;
  padding?: number;
  movePad?: boolean;
  movePadMaxWidth?: number;
  movePadMaxHeight?: number;
  verticalControls?: boolean;
  controlsMaxWidth?: number;
  controlsMaxHeight?: number;
  controlsGap?: number;
  status?: SkykitTouchStatus;
  statusAlign?: 'left' | 'center' | 'right';
  statusMaxWidth?: number;
  statusMaxHeight?: number;
  actions?: Partial<Record<'forward' | 'back' | 'left' | 'right' | 'up' | 'down', string>>;
  labels?: Partial<Record<'forward' | 'back' | 'left' | 'right' | 'up' | 'down', string>>;
  commands?: readonly SkykitTouchCommand[];
  startPayload?: Record<string, unknown>;
  stopPayload?: Record<string, unknown>;
}

export interface SkykitTouchStatusNodeOptions {
  id?: string;
  tone?: 'default' | 'muted';
  align?: 'left' | 'center' | 'right';
}

export interface CreateTouchOsHostFrameOptions {
  surfaceMetrics?: SurfaceMetrics;
  parent?: THREE.Object3D | ((frame: SkykitThreeFrame) => THREE.Object3D | undefined);
  events?: readonly ThreePanelHostInputEvent[];
}

export declare function createSkykitTabletRoot(options?: SkykitTabletRootOptions): DisplayNode;

export declare function createSkykitSurfaceApp<TState = unknown>(
  options: SkykitSurfaceAppOptions<TState>
): TouchAppModule<TState>;

export declare function createTouchOsHudPlugin(options: TouchOsHudPluginOptions): TouchOsHudPlugin;
export declare function createTouchOsPanelPlugin(options: TouchOsPanelPluginOptions): TouchOsPanelPlugin;
export declare function createSkykitTouchOsPointerSource(
  options: SkykitTouchOsPointerSourceOptions | SkykitTouchOsPointerResolver
): SkykitTouchOsPointerSource;

export declare function dispatchTouchOsActionOutputs(
  outputs: Iterable<unknown>,
  actions: SkykitActionRegistry,
  options?: DispatchTouchOsActionOutputsOptions
): number;

export declare function createSkykitShipControlsRoot(options?: SkykitShipControlsRootOptions): DisplayNode;

export declare function createSkykitTouchActionButton(
  command: SkykitTouchCommand,
  options?: SkykitTouchActionButtonOptions
): DisplayNode;

export declare function createSkykitTouchStatusNode(
  status?: SkykitTouchStatus,
  options?: SkykitTouchStatusNodeOptions
): DisplayNode | null;

export declare function createTouchOsHostFrame(
  frame: SkykitThreeFrame,
  target: TouchOsHudTarget,
  options?: CreateTouchOsHostFrameOptions
): ThreePanelHostFrame;

export declare function createTouchOsPanelHostFrame(
  frame: SkykitThreeFrame,
  options: TouchOsPanelPluginOptions,
  rootContext: TouchOsPanelRootContext
): ThreePanelHostFrame;

export declare function pointerEventToTouchOs(
  event: Event & Partial<PointerEvent>,
  target: TouchOsHudTarget,
  timestamp?: number
): ThreePanelHostInputEvent | null;

export declare function resolveTouchOsSurfaceMetrics(
  target: TouchOsHudTarget,
  overrides?: Partial<SurfaceMetrics>
): SurfaceMetrics;
