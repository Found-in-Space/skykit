import type {
  SpatialPose,
  SpatialQuaternion,
  SpatialScaleProfile,
  SpatialVector3,
} from '@found-in-space/spatial';
import type {
  ThreeStarField,
  ThreeStarFieldPickOptions,
  ThreeStarFieldPickResult,
} from '@found-in-space/three-star-field';
import type * as THREE from 'three';
import type {
  SkykitEvent,
  SkykitPlugin,
  SkykitStarCellSource,
  SkykitViewState,
} from './index.js';

export type SkykitXrVector3 = SpatialVector3;
export type SkykitXrQuaternion = SpatialQuaternion;
export type SkykitXrPose = SpatialPose;
export type SkykitXrScaleProfile = SpatialScaleProfile;

export interface CreateSkykitXrRigOptions {
  id?: string;
  camera?: THREE.Camera;
  deckOffset?: Partial<SkykitXrVector3>;
  navigationPose?: Partial<SkykitXrPose>;
  scaleProfile?: SkykitXrScaleProfile;
  scaleBandIds?: Iterable<string>;
}

export interface SkykitXrRigSnapshot {
  id: string;
  disposed: boolean;
  navigationPose: SkykitXrPose;
  scaleProfile: Required<SkykitXrScaleProfile>;
  deckOffset: SkykitXrVector3;
  rootNames: Record<string, string | string[]>;
}

export interface SkykitXrRig {
  readonly id: string;
  readonly originContentRoot: THREE.Group;
  readonly observerContentRoot: THREE.Group;
  readonly scaleBandedContentRoots: Record<string, THREE.Group>;
  readonly navigationRoot: THREE.Group;
  readonly spaceshipRoot: THREE.Group;
  readonly deckRoot: THREE.Group;
  readonly xrOrigin: THREE.Group;
  readonly headRoot: THREE.Group;
  readonly cameraMount: THREE.Group;
  readonly leftHandRoot: THREE.Group;
  readonly rightHandRoot: THREE.Group;
  readonly attachmentRoot: THREE.Group;
  readonly shipMountRoot: THREE.Group;
  readonly contentRoot: THREE.Group;
  getScaleBandedContentRoot(id: string): THREE.Group;
  setNavigationPose(pose: Partial<SkykitXrPose>): void;
  getNavigationPose(): SkykitXrPose;
  setScaleProfile(profile: SkykitXrScaleProfile): void;
  getScaleProfile(): Required<SkykitXrScaleProfile>;
  syncObserverContentRoot(): void;
  attachCamera(camera: THREE.Camera): void;
  getSnapshot(): SkykitXrRigSnapshot;
  dispose(): void;
}

export interface SkykitXrHandPose {
  handedness: 'left' | 'right';
  grip: SkykitXrPose | null;
  targetRay: SkykitXrPose | null;
  buttons: number;
  axes: number;
}

export interface SkykitXrBodyModel {
  head: SkykitXrPose | null;
  leftHand: SkykitXrHandPose | null;
  rightHand: SkykitXrHandPose | null;
  ship: SkykitXrPose;
  torso?: SkykitXrPose | null;
}

export interface CreateSkykitXrBodyTrackerOptions {
  id?: string;
  shipPose?: Partial<SkykitXrPose>;
}

export interface SkykitXrBodyUpdateContext {
  frame?: any;
  referenceSpace?: any;
  session?: { inputSources?: Iterable<any> };
  inputSources?: Iterable<any>;
  rig?: SkykitXrRig;
  shipPose?: Partial<SkykitXrPose>;
}

export interface SkykitXrBodyTracker {
  readonly id: string;
  update(context?: SkykitXrBodyUpdateContext): SkykitXrBodyModel;
  getBody(): SkykitXrBodyModel;
  getSnapshot(): { id: string; disposed: boolean; body: SkykitXrBodyModel };
  dispose(): void;
}

export interface SkykitXrAxisBinding {
  hand?: 'left' | 'right' | 'any';
  stick?: 'primary' | 'secondary';
  axes?: [number, number];
  invertX?: boolean;
  invertY?: boolean;
}

export interface SkykitXrButtonBinding {
  hand?: 'left' | 'right' | 'any';
  button?: number | 'trigger' | 'grip' | 'primary' | 'secondary' | string;
  threshold?: number;
}

export interface SkykitXrControlBindingsOptions {
  id?: string;
  axes?: Record<string, SkykitXrAxisBinding>;
  buttons?: Record<string, SkykitXrButtonBinding>;
  deadzone?: number;
}

export interface SkykitXrAxisState {
  x: number;
  y: number;
  magnitude: number;
  active: boolean;
  activeHand: string | null;
}

export interface SkykitXrButtonState {
  pressed: boolean;
  touched: boolean;
  pressedEdge: boolean;
  releasedEdge: boolean;
  value: number;
  activeHand: string | null;
}

export interface SkykitXrControlBindingsHandle {
  readonly id: string;
  update(context?: Iterable<any> | { inputSources?: Iterable<any>; session?: { inputSources?: Iterable<any> } }): void;
  getAxis(name: string): SkykitXrAxisState;
  getButton(name: string): SkykitXrButtonState;
  isPressed(name: string): boolean;
  on(name: string, listener: (state: SkykitXrAxisState | SkykitXrButtonState) => void): () => void;
  setBindings(options: SkykitXrControlBindingsOptions): void;
  getSnapshot(): {
    id: string;
    disposed: boolean;
    axes: Record<string, SkykitXrAxisState>;
    buttons: Record<string, SkykitXrButtonState>;
    bindings: Required<Pick<SkykitXrControlBindingsOptions, 'axes' | 'buttons'>> & { deadzone?: number };
  };
  dispose(): void;
}

export interface SkykitXrRay {
  id: string;
  kind: string;
  handedness: string | null;
  origin: SkykitXrVector3;
  direction: SkykitXrVector3;
  length: number | null;
}

export interface SkykitXrRayContext {
  frame?: any;
  referenceSpace?: any;
  session?: { inputSources?: Iterable<any> };
  inputSources?: Iterable<any>;
  body?: SkykitXrBodyModel;
  rig?: SkykitXrRig;
  [key: string]: any;
}

export interface SkykitXrRaySourceOptions {
  id?: string;
  kind?: 'target-ray' | 'grip' | 'head-gaze' | 'ship-forward' | 'custom';
  handedness?: 'left' | 'right' | string | null;
  length?: number | null;
  getRay?: (context: SkykitXrRayContext) => SkykitXrRay | null;
}

export interface SkykitXrRaySource {
  readonly id: string;
  getRay(context?: SkykitXrRayContext): SkykitXrRay | null;
  getSnapshot(): {
    id: string;
    kind: string;
    handedness: string | null;
    disposed: boolean;
    lastRay: SkykitXrRay | null;
  };
  dispose(): void;
}

export type SkykitXrPickBlocker =
  | ((ray: SkykitXrRay, context: SkykitXrRayContext & { maxDistance?: number | null }) => SkykitXrBlockerResult | null)
  | {
      blockRay?: (ray: SkykitXrRay, context: SkykitXrRayContext & { maxDistance?: number | null }) => SkykitXrBlockerResult | null;
      pick?: (ray: SkykitXrRay, context: SkykitXrRayContext & { maxDistance?: number | null }) => SkykitXrBlockerResult | null;
    };

export interface SkykitXrBlockerResult {
  consumed?: boolean;
  blocked?: boolean;
  distance?: number;
  maxDistance?: number;
  hit?: unknown;
}

export type SkykitXrPickTarget =
  | ((ray: SkykitXrRay, context: SkykitXrRayContext & { maxDistance?: number | null }) => any)
  | { pick?: (ray: SkykitXrRay, context: SkykitXrRayContext & { maxDistance?: number | null }) => any };

export interface SkykitXrPickRouteResult {
  type: 'hit' | 'miss' | 'blocked';
  ray: SkykitXrRay | null;
  hit: any;
  blocker: SkykitXrPickBlocker | null;
  target: SkykitXrPickTarget | null;
  maxDistance: number | null | undefined;
}

export interface SkykitXrPickRouterOptions {
  id?: string;
  raySource?: SkykitXrRaySource | ((context: SkykitXrRayContext) => SkykitXrRay | null) | null;
  blockers?: Iterable<SkykitXrPickBlocker>;
  targets?: Iterable<SkykitXrPickTarget>;
  onPick?: (result: SkykitXrPickRouteResult) => void;
}

export interface SkykitXrPickRouter {
  readonly id: string;
  route(context?: SkykitXrRayContext): SkykitXrPickRouteResult;
  setRaySource(source: SkykitXrPickRouterOptions['raySource']): void;
  setBlockers(blockers: Iterable<SkykitXrPickBlocker>): void;
  setTargets(targets: Iterable<SkykitXrPickTarget>): void;
  getSnapshot(): {
    id: string;
    disposed: boolean;
    blockerCount: number;
    targetCount: number;
    lastRoute: SkykitXrPickRouteResult | null;
  };
  dispose(): void;
}

export interface SkykitXrDepthRangeOptions {
  visibleBounds?: SkykitXrBounds | SkykitXrBounds[];
  observer?: SkykitXrVector3 | { position: SkykitXrVector3 };
  observerCentricSpheres?: Iterable<{ radius?: number; radiusNavigationUnits?: number }>;
  scale?: SkykitXrScaleProfile;
  policy?: {
    near?: number;
    marginFactor?: number;
    minFar?: number;
    maxFar?: number;
  };
}

export interface SkykitXrBounds {
  min?: SkykitXrVector3;
  max?: SkykitXrVector3;
  minX?: number;
  minY?: number;
  minZ?: number;
  maxX?: number;
  maxY?: number;
  maxZ?: number;
}

export interface SkykitXrDepthRange {
  near: number;
  far: number;
  depthNear: number;
  depthFar: number;
  telemetry: {
    near: number;
    far: number;
    requiredNavigationUnits: number;
    requiredMeters: number;
    marginFactor: number;
    unclampedFar: number;
    minFar: number;
    maxFar: number;
    minClampApplied: boolean;
    capApplied: boolean;
    scale: Required<SkykitXrScaleProfile>;
    observer: SkykitXrVector3;
    farthestVisibleBoundsDistance: number;
    farthestObserverCentricSphereDistance: number;
    visibleBoundsCount: number;
    observerCentricSphereCount: number;
  };
}

export type SkykitXrDepthRangeApplyTarget =
  | SkykitXrSessionHandle
  | {
      session?: unknown;
      updateRenderState?: (state: { depthNear: number; depthFar: number }) => void;
    };

export interface SkykitXrDepthRangeApplyOptions {
  throwOnUnavailable?: boolean;
}

export interface SkykitXrDepthRangeApplyResult {
  applied: boolean;
  depthNear: number;
  depthFar: number;
  reason?: string;
  error?: unknown;
}

export interface EnterSkykitXrSessionOptions {
  mode?: string;
  referenceSpaceType?: string;
  sessionInit?: unknown;
  navigator?: unknown;
  requestReferenceSpace?: boolean;
  onSessionStarted?: (handle: SkykitXrSessionHandle) => void;
}

export interface SkykitXrSessionHandle {
  mode: string;
  referenceSpaceType: string;
  session: any;
  referenceSpace: any;
  readonly presenting: boolean;
  exit(): Promise<void>;
  getSnapshot(): {
    mode: string;
    referenceSpaceType: string;
    presenting: boolean;
    hasReferenceSpace: boolean;
  };
}

export interface CreateSkykitXrObserverRigOptions {
  rig: SkykitXrRig;
  coordinateUnitsPerParsec?: number;
}

export interface SkykitXrSessionPluginOptions {
  id?: string;
  renderer?: THREE.WebGLRenderer | { xr?: unknown } | null;
  mode?: string;
  referenceSpaceType?: string;
  sessionInit?: unknown;
  navigator?: unknown;
  priority?: number;
  onSessionStarted?: (handle: SkykitXrSessionHandle) => void;
}

export interface SkykitXrSessionPlugin extends SkykitPlugin {
  readonly id: string;
  enter(): Promise<SkykitXrSessionHandle>;
  exit(): Promise<void>;
  getSnapshot(): unknown;
}

export interface SkykitXrNavigationPluginOptions {
  id?: string;
  priority?: number;
  rig?: SkykitXrRig;
  controls?: SkykitXrControlBindingsHandle;
  moveAxis?: SkykitXrAxisBinding;
  attitudeAxis?: SkykitXrAxisBinding;
  rollModifierButton?: SkykitXrButtonBinding;
  boostButton?: SkykitXrButtonBinding;
  deadzone?: number;
  moveSpeedPcPerSec?: number;
  boostMultiplier?: number;
  yawRateRadPerSec?: number;
  pitchRateRadPerSec?: number;
  rollRateRadPerSec?: number;
}

export interface SkykitXrNavigationPlugin extends SkykitPlugin {
  readonly id: string;
  getSnapshot(): unknown;
}

export interface SkykitXrRayVisualPluginOptions {
  id?: string;
  priority?: number;
  raySource: SkykitXrRaySource;
  rig?: SkykitXrRig;
  blockers?: Iterable<SkykitXrPickBlocker>;
  parent?: THREE.Object3D | ((context: import('./index.js').SkykitThreePluginContext) => THREE.Object3D | null | undefined);
  material?: THREE.Material;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  depthTest?: boolean;
  renderOrder?: number;
  length?: number;
}

export interface SkykitXrRayVisualPlugin extends SkykitPlugin {
  readonly id: string;
  getSnapshot(): unknown;
}

export interface SkykitXrStarPickEvent extends SkykitEvent {
  type: 'stars/xr-pick';
  id: string;
  pick: ThreeStarFieldPickResult;
  label: string;
  ray: SkykitXrRay;
  view: SkykitViewState;
}

export interface SkykitXrStarPickMissEvent extends SkykitEvent {
  type: 'stars/xr-pick-miss';
  id: string;
  ray: SkykitXrRay;
  view: SkykitViewState;
}

export interface SkykitXrStarPickingPluginOptions {
  id?: string;
  priority?: number;
  renderer: ThreeStarField;
  source?: SkykitStarCellSource | null;
  rig?: SkykitXrRig;
  raySource?: SkykitXrRaySource;
  blockers?: Iterable<SkykitXrPickBlocker>;
  controls?: SkykitXrControlBindingsHandle;
  handedness?: 'left' | 'right' | string;
  selectButton?: SkykitXrButtonBinding;
  attributes?: readonly string[];
  pickOptions?: ThreeStarFieldPickOptions;
  onPick?: (event: SkykitXrStarPickEvent) => void | Promise<void>;
  onMiss?: (event: SkykitXrStarPickMissEvent) => void | Promise<void>;
}

export declare function createSkykitXrRig(options?: CreateSkykitXrRigOptions): SkykitXrRig;
export declare function createSkykitXrBodyTracker(options?: CreateSkykitXrBodyTrackerOptions): SkykitXrBodyTracker;
export declare function createSkykitXrControlBindings(options?: SkykitXrControlBindingsOptions): SkykitXrControlBindingsHandle;
export declare function readSkykitXrAxis(inputSources: Iterable<any>, binding?: SkykitXrAxisBinding & { deadzone?: number }): SkykitXrAxisState;
export declare function readSkykitXrButton(inputSources: Iterable<any>, binding?: SkykitXrButtonBinding, previous?: SkykitXrButtonState | null): SkykitXrButtonState;
export declare function createSkykitXrRaySource(options?: SkykitXrRaySourceOptions): SkykitXrRaySource;
export declare function createSkykitXrPickRouter(options?: SkykitXrPickRouterOptions): SkykitXrPickRouter;
export declare function createSkykitXrObserverRig(options: CreateSkykitXrObserverRigOptions): import('./index.js').SkykitObserverRig;
export declare function createSkykitXrSessionPlugin(options?: SkykitXrSessionPluginOptions): SkykitXrSessionPlugin;
export declare function createSkykitXrNavigationPlugin(options?: SkykitXrNavigationPluginOptions): SkykitXrNavigationPlugin;
export declare function createSkykitXrRayVisualPlugin(options: SkykitXrRayVisualPluginOptions): SkykitXrRayVisualPlugin;
export declare function createSkykitXrStarPickingPlugin(options: SkykitXrStarPickingPluginOptions): SkykitPlugin & {
  getSnapshot(): unknown;
};
export declare function computeSkykitXrDepthRange(options?: SkykitXrDepthRangeOptions): SkykitXrDepthRange;
export declare function applySkykitXrDepthRange(
  target: SkykitXrDepthRangeApplyTarget,
  range: SkykitXrDepthRange | { near?: number; far?: number; depthNear?: number; depthFar?: number },
  options?: SkykitXrDepthRangeApplyOptions,
): SkykitXrDepthRangeApplyResult;
export declare function isSkykitXrModeSupported(mode?: string, options?: { navigator?: unknown }): Promise<boolean>;
export declare function enterSkykitXrSession(options?: EnterSkykitXrSessionOptions): Promise<SkykitXrSessionHandle>;
export declare function exitSkykitXrSession(sessionOrHandle: unknown): Promise<void>;
export declare function poseFromTransform(transform: unknown): SkykitXrPose | null;
export declare function poseFromViewer(xrViewerPose: unknown): SkykitXrPose | null;
export declare function poseFromSkykitXrPose(xrPose: unknown): SkykitXrPose | null;
export declare function forwardFromPose(pose: SkykitXrPose): SkykitXrVector3;
