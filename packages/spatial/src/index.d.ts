export interface SpatialVector3 {
  x: number;
  y: number;
  z: number;
}

export interface SpatialQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SpatialPose {
  position: SpatialVector3;
  orientation: SpatialQuaternion;
}

export interface SpatialScaleProfile {
  navigationUnits?: 'pc' | 'au' | 'm' | 'kpc' | string;
  metersPerNavigationUnit?: number;
  worldUnitsPerNavigationUnit?: number;
}

export interface SpatialControlReader {
  getAxis?(name: string): { x: number; y: number; magnitude: number; active: boolean };
  getButton?(name: string): { pressed: boolean; value: number };
  isPressed?(name: string): boolean;
}

export interface SpatialMotionUpdateInput {
  pose: Partial<SpatialPose>;
  controls?: SpatialControlReader;
  deltaSeconds: number;
  scale?: SpatialScaleProfile;
  manualLookActive?: boolean;
}

export interface SpatialMotionSnapshot {
  type: string;
  velocity: SpatialVector3;
  speedNavigationUnitsPerSecond: number;
  scale: Required<SpatialScaleProfile>;
  activeAutomation: string | null;
}

export interface SpatialMotionModel {
  update(input: SpatialMotionUpdateInput): SpatialPose;
  getSnapshot(): SpatialMotionSnapshot;
}

export interface SpatialMotionOptions {
  moveAxis?: string;
  attitudeAxis?: string;
  rollModifierButton?: string;
  boostButton?: string;
  moveSpeed?: number;
  boostMultiplier?: number;
  pitchRateRadPerSec?: number;
  yawRateRadPerSec?: number;
  rollRateRadPerSec?: number;
}

export interface SpatialDirectMotionOptions extends SpatialMotionOptions {}
export interface SpatialInertialMotionOptions extends SpatialMotionOptions {
  acceleration?: number;
  damping?: number;
  maxSpeed?: number;
}
export interface SpatialThrustMotionOptions extends SpatialMotionOptions {
  thrust?: number;
  mass?: number;
  drag?: number;
  maxSpeed?: number;
}
export interface SpatialFlyToMotionOptions {
  maxSpeed?: number | null;
  acceleration?: number;
  deceleration?: number;
  arrivalThreshold?: number;
}

export interface SpatialFlyToMotionModel extends SpatialMotionModel {
  flyTo(target: SpatialVector3, options?: SpatialFlyToMotionOptions): void;
  cancel(): void;
}

export interface SpatialPolylineSegment {
  start: SpatialVector3;
  end: SpatialVector3;
  length: number;
  cumulativeStart: number;
  cumulativeEnd: number;
}

export interface SpatialPolylineRoute {
  points: SpatialVector3[];
  segments: SpatialPolylineSegment[];
  totalLength: number;
}

export interface SpatialTimedPositionWaypoint {
  id: string;
  timeSecs: number;
  position: SpatialVector3;
  motionGroup?: Record<string, unknown>;
}

export type SpatialTimedOrientationWaypoint =
  | { id: string; timeSecs: number; kind: 'direction'; forward: SpatialVector3; up: SpatialVector3 }
  | { id: string; timeSecs: number; kind: 'target'; target: SpatialVector3; up: SpatialVector3 }
  | { id: string; timeSecs: number; kind: 'quaternion'; orientation: SpatialQuaternion };

export interface SpatialArcSample {
  u: number;
  distance: number;
  point: SpatialVector3;
}

export interface SpatialPositionTrackSegment {
  index: number;
  start: SpatialTimedPositionWaypoint;
  end: SpatialTimedPositionWaypoint;
  durationSecs: number;
  held: boolean;
  length: number;
  speed: number;
  arc: {
    length: number;
    samples: SpatialArcSample[];
  };
}

export interface SpatialPositionTrack {
  waypoints: SpatialTimedPositionWaypoint[];
  segments: SpatialPositionTrackSegment[];
  durationSecs: number;
  samplesPerSegment: number;
}

export interface SpatialOrientationTrack {
  waypoints: SpatialTimedOrientationWaypoint[];
  durationSecs: number;
  useLinearInterpolation: boolean;
}

export interface SpatialPositionTrackSample {
  timeSecs: number;
  position: SpatialVector3;
  velocity: SpatialVector3;
  velocityUnit: SpatialVector3;
  speed: number;
  segmentIndex: number | null;
}

export interface SpatialOrientationTrackSample {
  timeSecs: number;
  orientation: SpatialQuaternion;
  forward: SpatialVector3;
  up: SpatialVector3;
}

export interface CreateSpatialPositionTrackOptions {
  samplesPerSegment?: number;
}

export interface CreateSpatialOrientationTrackOptions {
  useLinearInterpolation?: boolean;
}

export interface CreateSpatialSmoothPathInput {
  durationSecs?: number;
  targetDistance?: number;
  positionWaypoints?: Iterable<unknown>;
  orientationWaypoints?: Iterable<unknown>;
}

export interface CreateSpatialSmoothPathOptions extends CreateSpatialPositionTrackOptions, CreateSpatialOrientationTrackOptions {
  targetDistance?: number;
}

export interface SpatialSmoothPathSample {
  frameIndex?: number;
  timeSecs: number;
  pose: SpatialPose;
  position: SpatialVector3;
  orientation: SpatialQuaternion;
  target: SpatialVector3;
  forward: SpatialVector3;
  up: SpatialVector3;
  velocity: SpatialVector3;
  velocityUnit: SpatialVector3;
  speed: number;
  segmentIndex: number | null;
}

export interface MaterializeSpatialPathSamplesOptions {
  stepSecs?: number;
  pathRadiusPc?: number;
  sphereRadiusPc?: number;
  lookaheadSecs?: number;
  priority?: number;
}

export interface SpatialSmoothPath {
  durationSecs: number;
  positionTrack: SpatialPositionTrack;
  orientationTrack: SpatialOrientationTrack;
  evaluate(timeSecs: number): SpatialSmoothPathSample;
  sample(options?: MaterializeSpatialPathSamplesOptions): SpatialSmoothPathSample[];
  materializePreloadHints(options?: MaterializeSpatialPreloadHintsOptions): SpatialPreloadHint[];
}

export interface SpatialPoseTransitionInput {
  from: Partial<SpatialPose> | { observerPc?: SpatialVector3; orientationIcrs?: SpatialQuaternion };
  to: Partial<SpatialPose> | { observerPc?: SpatialVector3; orientationIcrs?: SpatialQuaternion };
  durationSecs?: number;
  movement?: { durationSecs?: number };
  orientation?: { durationSecs?: number };
}

export interface SpatialPoseTransition {
  durationSecs: number;
  from: SpatialPose;
  to: SpatialPose;
  movement?: { durationSecs?: number };
  orientation?: { durationSecs?: number };
  evaluate(elapsedSecs: number): SpatialPoseTransitionSample;
}

export interface SpatialPoseTransitionSample {
  elapsedSecs: number;
  complete: boolean;
  movementComplete: boolean;
  orientationComplete: boolean;
  pose: SpatialPose;
}

export type SpatialPreloadHint =
  | {
      kind: 'path-volume';
      pointsPc: SpatialVector3[];
      radiusPc: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    }
  | {
      kind: 'sphere-volume';
      centerPc: SpatialVector3;
      radiusPc: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    }
  | {
      kind: 'view-lookahead';
      pose: SpatialPose;
      velocity: SpatialVector3;
      lookaheadSecs: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    };

export interface MaterializeSpatialPreloadHintsOptions extends MaterializeSpatialPathSamplesOptions {}

export interface SpatialOrbitAngleInput {
  center: SpatialVector3;
  position: SpatialVector3;
  orbitNormal?: SpatialVector3;
  referenceAxis?: SpatialVector3;
}

export interface SpatialOrbitOptions {
  radius?: number;
  angularSpeed?: number;
  initialAngle?: number;
  orbitNormal?: SpatialVector3;
}

export interface SpatialFlyToNavigationOptions {
  speed?: number;
  durationSecs?: number;
  acceleration?: number;
  currentSpeed?: number;
  deceleration?: number;
  arrivalThreshold?: number;
  onArrive?: () => void;
}

export type SpatialArrivalAction =
  | {
      type: 'orbit';
      center: SpatialVector3;
      radius: number;
      angularSpeedRadPerSec: number;
      normal?: SpatialVector3;
    }
  | ({
      type: 'orbitalInsert';
      center: SpatialVector3;
      angularSpeedRadPerSec: number;
      normal?: SpatialVector3;
    } & Omit<SpatialOrbitalInsertOptions, 'angularSpeed' | 'orbitNormal'>);

export interface SpatialRouteFollowOptions extends SpatialFlyToNavigationOptions {
  arrivalAction?: SpatialArrivalAction | null;
  arrivalSpeed?: number;
}

export interface SpatialRouteFollowMotionModel extends SpatialMotionModel {
  flyPolyline(points: Iterable<SpatialVector3>, options?: SpatialRouteFollowOptions): void;
  cancel(): void;
  getSnapshot(): SpatialNavigationAutomationSnapshot;
}

export interface SpatialRouteFollowMotionOptions extends SpatialRouteFollowOptions {
  points?: Iterable<SpatialVector3>;
}

export interface SpatialOrbitalInsertOptions extends SpatialFlyToNavigationOptions {
  center?: SpatialVector3;
  radius?: number;
  angularSpeed?: number;
  insertionRadius?: number;
  orbitNormal?: SpatialVector3;
  approachSpeed?: number;
  sampleStepSecs?: number;
  maxPoints?: number;
  mode?: 'current-trajectory' | 'specified-orbit';
  approachVelocity?: SpatialVector3;
  matchApproachDirection?: boolean;
  maxAcceleration?: number;
  onInserted?: () => void;
}

export interface SpatialOrbitMotionOptions extends SpatialOrbitOptions {
  center?: SpatialVector3;
}

export interface SpatialOrbitalInsertMotionOptions extends SpatialOrbitalInsertOptions {}

export interface SpatialOrbitalInsertRoute {
  points: SpatialVector3[];
  arrivalAction: {
    type: 'orbit';
    center: SpatialVector3;
    radius: number;
    angularSpeedRadPerSec: number;
    normal: SpatialVector3;
  };
}

export interface SpatialOrbitTransferOrbit {
  center: SpatialVector3;
  radius: number;
  angularSpeedRadPerSec?: number;
  normal?: SpatialVector3;
}

export interface SpatialOrbitTransferOptions {
  start?: unknown;
  sourceOrbit?: SpatialOrbitTransferOrbit | null;
  destinationOrbit?: SpatialOrbitTransferOrbit | null;
  durationSecs?: number;
  sampleStepSecs?: number;
  maxPoints?: number;
  approachVelocity?: SpatialVector3;
  mode?: 'current-trajectory' | 'specified-orbit';
}

export interface SpatialOrbitTransferRoute {
  points: SpatialVector3[];
  departureSpeed: number;
  arrivalSpeed: number;
  arrivalAction: {
    type: 'orbit';
    center: SpatialVector3;
    radius: number;
    angularSpeedRadPerSec: number;
    normal: SpatialVector3;
  };
}

export interface SpatialOrbitMotionModel extends SpatialMotionModel {
  orbit(center: SpatialVector3, options?: SpatialOrbitOptions): void;
  cancel(): void;
  getSnapshot(): SpatialNavigationAutomationSnapshot;
}

export interface SpatialOrbitalInsertMotionModel extends SpatialMotionModel {
  orbitalInsert(center: SpatialVector3, options?: SpatialOrbitalInsertOptions): void;
  cancel(): void;
  getSnapshot(): SpatialNavigationAutomationSnapshot;
}

export interface SpatialLookAtInput {
  position: SpatialVector3;
  target: SpatialVector3;
  up?: SpatialVector3;
}

export interface SpatialLookAtOptions {
  up?: SpatialVector3;
  blend?: number;
  arrivalThresholdRad?: number;
  onArrive?: () => void;
}

export interface SpatialLockAtOptions {
  up?: SpatialVector3;
  dwellSecs?: number;
  recenterSpeed?: number;
}

export interface SpatialLookAtMotionOptions extends SpatialLookAtOptions, SpatialLockAtOptions {
  target?: SpatialVector3;
  locked?: boolean;
}

export interface SpatialLookAtMotionModel extends SpatialMotionModel {
  lookAt(target: SpatialVector3, options?: SpatialLookAtOptions): void;
  lockAt(target: SpatialVector3, options?: SpatialLockAtOptions): void;
  unlockAt(): void;
  noteManualLookInput(): void;
  cancel(): void;
  getSnapshot(): SpatialNavigationAutomationSnapshot;
}

export interface SpatialNavigationAutomationOptions {
  speed?: number;
  acceleration?: number;
  deceleration?: number;
  arrivalThreshold?: number;
  angularSpeed?: number;
}

export interface SpatialAutomationSummary {
  type: string;
  target?: SpatialVector3;
  center?: SpatialVector3;
  radius?: number;
  angularSpeed?: number;
  angle?: number;
  distance?: number;
  totalLength?: number;
  insertionRadius?: number;
}

export interface SpatialNavigationAutomationSnapshot extends SpatialMotionSnapshot {
  movementAutomation: SpatialAutomationSummary | null;
  orientationAutomation: SpatialAutomationSummary | null;
  secondsSinceManualLookInput: number;
  disposed: boolean;
}

export interface SpatialNavigationAutomation extends SpatialMotionModel {
  flyTo(target: SpatialVector3, options?: SpatialFlyToNavigationOptions): void;
  flyPolyline(points: Iterable<SpatialVector3>, options?: SpatialRouteFollowOptions): void;
  orbit(center: SpatialVector3, options?: SpatialOrbitOptions): void;
  orbitalInsert(center: SpatialVector3, options?: SpatialOrbitalInsertOptions): void;
  lookAt(target: SpatialVector3, options?: SpatialLookAtOptions): void;
  lockAt(target: SpatialVector3, options?: SpatialLockAtOptions): void;
  unlockAt(): void;
  noteManualLookInput(): void;
  cancelMovement(): void;
  cancelOrientation(): void;
  cancel(): void;
  update(input: SpatialMotionUpdateInput): SpatialPose;
  getSnapshot(): SpatialNavigationAutomationSnapshot;
  dispose(): void;
}

export type SpatialTargetInput =
  | SpatialVector3
  | [number, number, number]
  | { position: SpatialVector3 | [number, number, number] }
  | { targetPc: SpatialVector3 | [number, number, number] }
  | { raDeg?: number; raHours?: number; decDeg: number; distancePc: number }
  | { kind: 'bookmark'; id: string }
  | { bookmarkId: string };

export interface ResolveSpatialTargetOptions {
  observerPc?: SpatialVector3;
  /**
   * Application-owned bookmark resolver. Spatial treats bookmark IDs as opaque
   * strings; star references should be resolved to coordinates before they
   * reach spatial math.
   */
  resolveBookmark?: (bookmarkId: string, input: SpatialTargetInput) => SpatialTargetInput | Promise<SpatialTargetInput | null> | null;
}

export declare const DEFAULT_SPATIAL_SCALE_PROFILE: Required<SpatialScaleProfile>;
export declare const IDENTITY_QUATERNION: SpatialQuaternion;
export declare const LOCAL_FORWARD: SpatialVector3;
export declare const LOCAL_RIGHT: SpatialVector3;
export declare const LOCAL_UP: SpatialVector3;
export declare const ZERO_VECTOR: SpatialVector3;

export declare function normalizeVector3(value: unknown, fallback?: SpatialVector3): SpatialVector3;
export declare function normalizeQuaternion(value: unknown, fallback?: SpatialQuaternion): SpatialQuaternion;
export declare function normalizePose(value?: { position?: unknown; orientation?: unknown }): SpatialPose;
export declare function normalizeScaleProfile(value?: SpatialScaleProfile): Required<SpatialScaleProfile>;
export declare function cloneVector3(value: SpatialVector3): SpatialVector3;
export declare function cloneQuaternion(value: SpatialQuaternion): SpatialQuaternion;
export declare function clonePose(pose: SpatialPose): SpatialPose;
export declare function addVectors(a: SpatialVector3, b: SpatialVector3): SpatialVector3;
export declare function subtractVectors(a: SpatialVector3, b: SpatialVector3): SpatialVector3;
export declare function scaleVector(v: SpatialVector3, scalar: number): SpatialVector3;
export declare function vectorLength(v: SpatialVector3): number;
export declare function normalizeDirection(v: SpatialVector3): SpatialVector3;
export declare function multiplyQuaternions(a: SpatialQuaternion, b: SpatialQuaternion): SpatialQuaternion;
export declare function quaternionFromAxisAngle(axis: SpatialVector3, angleRad: number): SpatialQuaternion;
export declare function applyQuaternion(vector: SpatialVector3, q: SpatialQuaternion): SpatialVector3;
export declare function rotateLocal(orientation: SpatialQuaternion, localAxis: SpatialVector3, angleRad: number): SpatialQuaternion;
export declare function isNonZeroVector(vector: SpatialVector3): boolean;
export declare function finiteNumber(value: unknown, fallback: number): number;
export declare function positiveFinite(value: unknown, fallback: number): number;

export declare function raDecToIcrsDirection(input: { raDeg?: number; raHours?: number; decDeg: number }): SpatialVector3 | null;
export declare function raDecDistanceToIcrs(input: { raDeg?: number; raHours?: number; decDeg: number; distancePc: number; observerPc?: SpatialVector3 }): SpatialVector3 | null;
export declare function icrsToRaDec(position: SpatialVector3 | [number, number, number], observerPc?: SpatialVector3 | [number, number, number]): { raDeg: number; raHours: number; decDeg: number } | null;
export declare function icrsDirectionToTargetPc(icrsDirection: SpatialVector3 | [number, number, number], distancePc: number, observerPc?: SpatialVector3 | [number, number, number]): SpatialVector3 | null;
export declare function projectEquirectangular(options: { raDeg: number; decDeg: number; width: number; height: number }): { x: number; y: number };
export declare function resolveSpatialTarget(input: SpatialTargetInput, options?: ResolveSpatialTargetOptions): SpatialVector3 | Promise<SpatialVector3 | null> | null;

export declare function createDirectSpatialMotionModel(options?: SpatialDirectMotionOptions): SpatialMotionModel;
export declare function createInertialSpatialMotionModel(options?: SpatialInertialMotionOptions): SpatialMotionModel;
export declare function createThrustSpatialMotionModel(options?: SpatialThrustMotionOptions): SpatialMotionModel;
export declare function createFlyToSpatialMotionModel(options?: SpatialFlyToMotionOptions): SpatialFlyToMotionModel;
export declare function buildSpatialPolylineRoute(points?: Iterable<unknown>): SpatialPolylineRoute;
export declare function sampleSpatialPolylineRoutePosition(route: SpatialPolylineRoute | null | undefined, distance: number): SpatialVector3 | null;
export declare function deriveSpatialOrbitAngle(input: SpatialOrbitAngleInput): number;
export declare function createOrbitTransferRoute(options?: SpatialOrbitTransferOptions): SpatialOrbitTransferRoute | null;
export declare function computeSpatialLookAtOrientation(input: SpatialLookAtInput): SpatialQuaternion | null;
export declare function createRouteFollowSpatialMotionModel(options?: SpatialRouteFollowOptions & { points?: Iterable<SpatialVector3> }): SpatialRouteFollowMotionModel;
export declare function createOrbitSpatialMotionModel(options?: SpatialOrbitOptions & { center?: SpatialVector3 }): SpatialOrbitMotionModel;
export declare function createOrbitalInsertSpatialMotionModel(options?: SpatialOrbitalInsertOptions): SpatialOrbitalInsertMotionModel;
export declare function createLookAtSpatialMotionModel(options?: SpatialLookAtMotionOptions): SpatialLookAtMotionModel;
export declare function createSpatialNavigationAutomation(options?: SpatialNavigationAutomationOptions): SpatialNavigationAutomation;
export declare function normalizeTimedSpatialPositionWaypoints(waypoints?: Iterable<unknown>): SpatialTimedPositionWaypoint[];
export declare function normalizeTimedSpatialOrientationWaypoints(waypoints?: Iterable<unknown>): SpatialTimedOrientationWaypoint[];
export declare function createSpatialPositionTrack(waypoints?: Iterable<unknown>, options?: CreateSpatialPositionTrackOptions): SpatialPositionTrack;
export declare function evaluateSpatialPositionTrack(track: SpatialPositionTrack, timeSecs: number): SpatialPositionTrackSample;
export declare function createSpatialOrientationTrack(waypoints?: Iterable<unknown>, options?: CreateSpatialOrientationTrackOptions): SpatialOrientationTrack;
export declare function evaluateSpatialOrientationTrack(track: SpatialOrientationTrack, timeSecs: number, context?: { position?: SpatialVector3 }): SpatialOrientationTrackSample;
export declare function createSpatialSmoothPath(input?: CreateSpatialSmoothPathInput, options?: CreateSpatialSmoothPathOptions): SpatialSmoothPath;
export declare function evaluateSpatialSmoothPath(path: SpatialSmoothPath, timeSecs: number, options?: { targetDistance?: number }): SpatialSmoothPathSample;
export declare function createSpatialPoseTransition(input: SpatialPoseTransitionInput): SpatialPoseTransition;
export declare function evaluateSpatialPoseTransition(transition: SpatialPoseTransition, elapsedSecs: number): SpatialPoseTransitionSample;
export declare function materializeSpatialPathSamples(input: SpatialSmoothPath | { sample?: Function; evaluate?: Function; durationSecs?: number } | SpatialSmoothPathSample[], options?: MaterializeSpatialPathSamplesOptions): SpatialSmoothPathSample[];
export declare function materializeSpatialPreloadHints(input: SpatialSmoothPathSample[] | SpatialSmoothPath, options?: MaterializeSpatialPreloadHintsOptions): SpatialPreloadHint[];
