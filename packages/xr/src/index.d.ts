import type * as THREE from 'three';

export interface XrVector3 {
  x: number;
  y: number;
  z: number;
}

export interface XrQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface XrPose {
  position: XrVector3;
  orientation: XrQuaternion;
}

export interface XrScaleProfile {
  navigationUnits: 'pc' | 'au' | 'm' | 'kpc' | string;
  metersPerNavigationUnit: number;
  worldUnitsPerNavigationUnit?: number;
}

export declare const DEFAULT_XR_SCALE_PROFILE: Required<XrScaleProfile>;
export declare const IDENTITY_QUATERNION: XrQuaternion;
export declare const LOCAL_FORWARD: XrVector3;
export declare const LOCAL_RIGHT: XrVector3;
export declare const LOCAL_UP: XrVector3;

export interface CreateXrRigOptions {
  id?: string;
  camera?: THREE.Camera;
  deckOffset?: Partial<XrVector3>;
  navigationPose?: Partial<XrPose>;
  scaleProfile?: XrScaleProfile;
  scaleBandIds?: Iterable<string>;
}

export interface XrRigSnapshot {
  id: string;
  disposed: boolean;
  navigationPose: XrPose;
  scaleProfile: Required<XrScaleProfile>;
  deckOffset: XrVector3;
  rootNames: Record<string, string | string[]>;
}

export interface XrRig {
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
  setNavigationPose(pose: Partial<XrPose>): void;
  getNavigationPose(): XrPose;
  setScaleProfile(profile: XrScaleProfile): void;
  getScaleProfile(): Required<XrScaleProfile>;
  syncObserverContentRoot(): void;
  attachCamera(camera: THREE.Camera): void;
  getSnapshot(): XrRigSnapshot;
  dispose(): void;
}

export interface XrHandPose {
  handedness: 'left' | 'right';
  grip: XrPose | null;
  targetRay: XrPose | null;
  buttons: number;
  axes: number;
}

export interface XrBodyModel {
  head: XrPose | null;
  leftHand: XrHandPose | null;
  rightHand: XrHandPose | null;
  ship: XrPose;
  torso?: XrPose | null;
}

export interface CreateXrBodyTrackerOptions {
  id?: string;
  shipPose?: Partial<XrPose>;
}

export interface XrBodyUpdateContext {
  frame?: any;
  referenceSpace?: any;
  session?: { inputSources?: Iterable<any> };
  inputSources?: Iterable<any>;
  rig?: XrRig;
  shipPose?: Partial<XrPose>;
}

export interface XrBodyTracker {
  readonly id: string;
  update(context?: XrBodyUpdateContext): XrBodyModel;
  getBody(): XrBodyModel;
  getSnapshot(): { id: string; disposed: boolean; body: XrBodyModel };
  dispose(): void;
}

export interface XrAxisBinding {
  hand?: 'left' | 'right' | 'any';
  stick?: 'primary' | 'secondary';
  axes?: [number, number];
  invertX?: boolean;
  invertY?: boolean;
}

export interface XrButtonBinding {
  hand?: 'left' | 'right' | 'any';
  button?: 'trigger' | 'grip' | 'primary' | 'secondary' | number;
}

export interface XrControlBindingsOptions {
  axes?: Record<string, XrAxisBinding>;
  buttons?: Record<string, XrButtonBinding>;
  deadzone?: number;
}

export interface XrAxisState {
  x: number;
  y: number;
  active: boolean;
  magnitude: number;
  activeHand: string | null;
}

export interface XrButtonState {
  pressed: boolean;
  touched: boolean;
  value: number;
  pressedEdge: boolean;
  releasedEdge: boolean;
  activeHand: string | null;
}

export interface XrControlReader {
  getAxis(name: string): XrAxisState;
  getButton(name: string): XrButtonState;
  isPressed(name: string): boolean;
}

export interface XrControlBindingsHandle extends XrControlReader {
  update(source?: Iterable<any> | { inputSources?: Iterable<any>; session?: { inputSources?: Iterable<any> } }): void;
  on(name: string, listener: (state: XrAxisState | XrButtonState) => void): () => void;
  setBindings(options: XrControlBindingsOptions): void;
  getSnapshot(): {
    disposed: boolean;
    deadzone: number;
    axes: Record<string, XrAxisState>;
    buttons: Record<string, XrButtonState>;
    bindings: Required<Pick<XrControlBindingsOptions, 'axes' | 'buttons'>> & { deadzone?: number };
  };
  dispose(): void;
}

export interface XrMotionOptions {
  moveAxis?: string;
  attitudeAxis?: string;
  rollModifierButton?: string;
  boostButton?: string;
  moveSpeed?: number;
  boostMultiplier?: number;
  yawRateRadPerSec?: number;
  pitchRateRadPerSec?: number;
  rollRateRadPerSec?: number;
}

export interface XrDirectMotionOptions extends XrMotionOptions {}
export interface XrInertialMotionOptions extends XrMotionOptions {
  acceleration?: number;
  damping?: number;
  maxSpeed?: number;
}
export interface XrThrustMotionOptions extends XrMotionOptions {
  thrust?: number;
  mass?: number;
  drag?: number;
  maxSpeed?: number;
}

export interface XrMotionUpdateInput {
  pose: Partial<XrPose>;
  body?: XrBodyModel;
  controls?: XrControlReader;
  deltaSeconds: number;
  scale?: XrScaleProfile;
}

export interface XrMotionSnapshot {
  type: string;
  velocity: XrVector3;
  speedNavigationUnitsPerSecond: number;
  scale: Required<XrScaleProfile>;
  activeAutomation: string | null;
}

export interface XrMotionModel {
  update(input: XrMotionUpdateInput): XrPose;
  getSnapshot(): XrMotionSnapshot;
}

export interface XrFlyToMotionOptions {
  maxSpeed?: number | null;
  acceleration?: number;
  deceleration?: number;
  arrivalThreshold?: number;
}

export interface XrFlyToMotionModel extends XrMotionModel {
  flyTo(target: XrVector3, options?: XrFlyToMotionOptions): void;
  cancel(): void;
}

export interface XrRay {
  id: string;
  kind: string;
  handedness: string | null;
  origin: XrVector3;
  direction: XrVector3;
  length: number | null;
}

export interface XrRayContext {
  frame?: any;
  referenceSpace?: any;
  session?: { inputSources?: Iterable<any> };
  inputSources?: Iterable<any>;
  body?: XrBodyModel;
  rig?: XrRig;
  [key: string]: any;
}

export interface XrRaySourceOptions {
  id?: string;
  kind?: 'target-ray' | 'grip' | 'head-gaze' | 'ship-forward' | 'custom';
  handedness?: 'left' | 'right' | string | null;
  length?: number | null;
  getRay?: (context: XrRayContext) => XrRay | null;
}

export interface XrRaySource {
  readonly id: string;
  getRay(context?: XrRayContext): XrRay | null;
  getSnapshot(): {
    id: string;
    kind: string;
    handedness: string | null;
    disposed: boolean;
    lastRay: XrRay | null;
  };
  dispose(): void;
}

export type XrPickBlocker =
  | ((ray: XrRay, context: XrRayContext & { maxDistance?: number | null }) => XrBlockerResult | null)
  | {
      blockRay?: (ray: XrRay, context: XrRayContext & { maxDistance?: number | null }) => XrBlockerResult | null;
      pick?: (ray: XrRay, context: XrRayContext & { maxDistance?: number | null }) => XrBlockerResult | null;
    };

export interface XrBlockerResult {
  consumed?: boolean;
  blocked?: boolean;
  distance?: number;
  maxDistance?: number;
  hit?: unknown;
}

export type XrPickTarget =
  | ((ray: XrRay, context: XrRayContext & { maxDistance?: number | null }) => any)
  | { pick?: (ray: XrRay, context: XrRayContext & { maxDistance?: number | null }) => any };

export interface XrPickRouteResult {
  type: 'hit' | 'miss' | 'blocked';
  ray: XrRay | null;
  hit: any;
  blocker: XrPickBlocker | null;
  target: XrPickTarget | null;
  maxDistance: number | null | undefined;
}

export interface XrPickRouterOptions {
  id?: string;
  raySource?: XrRaySource | ((context: XrRayContext) => XrRay | null) | null;
  blockers?: Iterable<XrPickBlocker>;
  targets?: Iterable<XrPickTarget>;
  onPick?: (result: XrPickRouteResult) => void;
}

export interface XrPickRouter {
  readonly id: string;
  route(context?: XrRayContext): XrPickRouteResult;
  setRaySource(source: XrPickRouterOptions['raySource']): void;
  setBlockers(blockers: Iterable<XrPickBlocker>): void;
  setTargets(targets: Iterable<XrPickTarget>): void;
  getSnapshot(): {
    id: string;
    disposed: boolean;
    blockerCount: number;
    targetCount: number;
    lastRoute: XrPickRouteResult | null;
  };
  dispose(): void;
}

export interface XrDepthRangeOptions {
  visibleBounds?: XrBounds | XrBounds[];
  observer?: XrVector3 | { position: XrVector3 };
  observerCentricSpheres?: Iterable<{ radius?: number; radiusNavigationUnits?: number }>;
  scale?: XrScaleProfile;
  policy?: {
    near?: number;
    marginFactor?: number;
    minFar?: number;
    maxFar?: number;
  };
}

export interface XrBounds {
  min?: XrVector3;
  max?: XrVector3;
  minX?: number;
  minY?: number;
  minZ?: number;
  maxX?: number;
  maxY?: number;
  maxZ?: number;
}

export interface XrDepthRange {
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
    scale: Required<XrScaleProfile>;
    observer: XrVector3;
    farthestVisibleBoundsDistance: number;
    farthestObserverCentricSphereDistance: number;
    visibleBoundsCount: number;
    observerCentricSphereCount: number;
  };
}

export interface EnterXrSessionOptions {
  mode?: string;
  referenceSpaceType?: string;
  sessionInit?: unknown;
  navigator?: unknown;
  onSessionStarted?: (handle: XrSessionHandle) => void;
}

export interface XrSessionHandle {
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

export declare function createXrRig(options?: CreateXrRigOptions): XrRig;
export declare function createXrBodyTracker(options?: CreateXrBodyTrackerOptions): XrBodyTracker;
export declare function createXrControlBindings(options?: XrControlBindingsOptions): XrControlBindingsHandle;
export declare function readXrAxis(inputSources: Iterable<any>, binding?: XrAxisBinding & { deadzone?: number }): XrAxisState;
export declare function readXrButton(inputSources: Iterable<any>, binding?: XrButtonBinding, previous?: XrButtonState | null): XrButtonState;
export declare function createDirectXrMotionModel(options?: XrDirectMotionOptions): XrMotionModel;
export declare function createInertialXrMotionModel(options?: XrInertialMotionOptions): XrMotionModel;
export declare function createThrustXrMotionModel(options?: XrThrustMotionOptions): XrMotionModel;
export declare function createFlyToMotionModel(options?: XrFlyToMotionOptions): XrFlyToMotionModel;
export declare function createXrRaySource(options?: XrRaySourceOptions): XrRaySource;
export declare function createXrPickRouter(options?: XrPickRouterOptions): XrPickRouter;
export declare function computeXrDepthRange(options?: XrDepthRangeOptions): XrDepthRange;
export declare function isXrModeSupported(mode?: string, options?: { navigator?: unknown }): Promise<boolean>;
export declare function enterXrSession(options?: EnterXrSessionOptions): Promise<XrSessionHandle>;
export declare function exitXrSession(sessionOrHandle: unknown): Promise<void>;
export declare function poseFromTransform(transform: unknown): XrPose | null;
export declare function poseFromViewer(xrViewerPose: unknown): XrPose | null;
export declare function poseFromXrPose(xrPose: unknown): XrPose | null;
export declare function forwardFromPose(pose: XrPose): XrVector3;
