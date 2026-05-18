import type {
  DisplayNode,
  DisplayRuntime,
  RuntimeOptions,
  SurfaceMetrics,
} from '@found-in-space/touch-os';
import type {
  HudPanelDriverOptions,
  ThreePanelDriver,
  ThreePanelHostFrame,
  ThreePanelHostInputEvent,
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
}

export interface TouchOsHudPlugin extends SkykitPlugin {
  id: string;
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

export declare function createTouchOsHudPlugin(options: TouchOsHudPluginOptions): TouchOsHudPlugin;

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

export declare function pointerEventToTouchOs(
  event: Event & Partial<PointerEvent>,
  target: TouchOsHudTarget
): ThreePanelHostInputEvent | null;

export declare function resolveTouchOsSurfaceMetrics(
  target: TouchOsHudTarget,
  overrides?: Partial<SurfaceMetrics>
): SurfaceMetrics;
