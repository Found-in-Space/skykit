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
  ThreePointerSource,
} from '@found-in-space/touch-os/hosts/three';
import type * as THREE from 'three';
import type {
  SkykitActionRegistry,
  SkykitPlugin,
  SkykitPluginContext,
  SkykitThreeFrame,
  SkykitViewer,
  SkykitViewState,
} from './index.js';
import type {
  SkykitXrButtonBinding,
  SkykitXrControlBindingsHandle,
  SkykitXrPickBlocker,
  SkykitXrRaySource,
} from './xr.js';

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

export interface TouchOsHudPluginOptions {
  id?: string;
  target: TouchOsHudTarget;
  enabled?: boolean;
  root: DisplayNode | TouchOsHudRootFactory;
  status?: SkykitTouchStatus | ((context: TouchOsHudRootContext) => SkykitTouchStatus | null | undefined);
  surfaceMetrics?: Partial<SurfaceMetrics> | ((target: TouchOsHudTarget) => Partial<SurfaceMetrics> | null | undefined);
  pointerEvents?: boolean | readonly string[];
  sourcePrefix?: string;
  parent?: THREE.Object3D | ((frame: SkykitThreeFrame) => THREE.Object3D | undefined);
  runtime?: DisplayRuntime;
  runtimeOptions?: Omit<RuntimeOptions, 'root' | 'surface'>;
  createRuntime?: (options: RuntimeOptions) => DisplayRuntime;
  driver?: ThreePanelDriver;
  driverOptions?: Omit<HudPanelDriverOptions, 'runtime'>;
  createDriver?: (options: HudPanelDriverOptions) => ThreePanelDriver;
  disposeRuntime?: boolean;
  onOutput?: (output: RuntimeOutput, context: TouchOsHudOutputContext) => void;
}

export interface TouchOsHudPlugin extends SkykitPlugin {
  id: string;
}

export type TouchOsPanelDriverKind = 'hud' | 'pose-anchored' | 'scene';

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
  | Omit<ScenePanelDriverOptions, 'runtime'>
  | Omit<PoseAnchoredPanelDriverOptions, 'runtime'>
  | Omit<HudPanelDriverOptions, 'runtime'>;

export interface TouchOsPanelPluginOptions {
  id?: string;
  priority?: number;
  enabled?: boolean;
  driver?: TouchOsPanelDriverKind;
  root: DisplayNode | TouchOsPanelRootFactory;
  surfaceMetrics?: TouchOsPanelSurfaceMetricsInput;
  sourcePrefix?: string;
  parent?: THREE.Object3D | ((frame: SkykitThreeFrame) => THREE.Object3D | undefined);
  anchorPose?: ThreeHostPose | ((frame: SkykitThreeFrame) => ThreeHostPose | null | undefined);
  pointerSources?: readonly ThreePointerSource[];
  runtime?: DisplayRuntime;
  runtimeOptions?: Omit<RuntimeOptions, 'root' | 'surface'>;
  createRuntime?: (options: RuntimeOptions) => DisplayRuntime;
  driverHandle?: ThreePanelDriver;
  driverOptions?: TouchOsPanelDriverOptions;
  createDriver?: (options: ScenePanelDriverOptions | PoseAnchoredPanelDriverOptions | HudPanelDriverOptions) => ThreePanelDriver;
  disposeRuntime?: boolean;
  onOutput?: (output: RuntimeOutput, context: TouchOsPanelOutputContext) => void;
}

export interface TouchOsPanelPlugin extends SkykitPlugin {
  id: string;
  getRuntime(): DisplayRuntime | null;
  getDriver(): ThreePanelDriver | null;
  getHit(): ReturnType<ThreePanelDriver['getHit']> | null;
  blockRay(
    ray: unknown,
    context?: { maxDistance?: number | null }
  ): { blocked: true; consumed: true; distance: number; hit: unknown } | null;
}

export interface SkykitXrPanelHostPluginOptions extends Omit<TouchOsPanelPluginOptions, 'pointerSources'> {
  rays?: Iterable<string | SkykitXrRaySource>;
  raySources?: Iterable<SkykitXrRaySource>;
  pointerSources?: readonly ThreePointerSource[];
  controls?: SkykitXrControlBindingsHandle;
  selectButton?: SkykitXrButtonBinding;
  blockerProductKey?: string | false;
  blockerProductMetadata?: Record<string, unknown>;
}

export interface SkykitXrPanelHostPlugin extends TouchOsPanelPlugin, SkykitXrPickBlocker {
  getSnapshot(): unknown;
}

export interface SkykitXrTabletPanelPluginOptions
  extends Omit<
    SkykitXrPanelHostPluginOptions,
    'root' | 'driver' | 'parent' | 'surfaceMetrics'
  > {
  apps: Iterable<TouchAppModule>;
  tablet?: Omit<SkykitTabletRootOptions, 'apps'>;
  hand?: 'left' | 'right';
  surfaceMetrics?: Partial<SurfaceMetrics>;
  panelWidth?: number;
  panelHeight?: number;
  offset?: { x?: number; y?: number; z?: number };
  tiltRadians?: number;
}

export interface DispatchTouchOsActionOutputsOptions {
  sourcePrefix?: string;
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
export declare function createSkykitXrPanelHostPlugin(options: SkykitXrPanelHostPluginOptions): SkykitXrPanelHostPlugin;
export declare function createSkykitXrTabletPanelPlugin(
  options: SkykitXrTabletPanelPluginOptions
): SkykitXrPanelHostPlugin;

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
  target: TouchOsHudTarget
): ThreePanelHostInputEvent | null;

export declare function resolveTouchOsSurfaceMetrics(
  target: TouchOsHudTarget,
  overrides?: Partial<SurfaceMetrics>
): SurfaceMetrics;
