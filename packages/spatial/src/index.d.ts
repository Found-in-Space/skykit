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
  observerPc: SpatialVector3;
  orientationIcrs: SpatialQuaternion;
}

export interface SpatialScaleProfile {
  navigationUnits?: 'pc' | 'au' | 'm' | 'kpc' | string;
  metersPerNavigationUnit?: number;
  worldUnitsPerNavigationUnit?: number;
}

export interface SpatialSourceRef {
  id?: string;
  kind?: string;
  label?: string;
  groupId?: string;
  index?: number;
  metadata?: Record<string, unknown>;
}

export interface SpatialDiagnosticWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message?: string;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialSampleDiagnostics {
  warnings: SpatialDiagnosticWarning[];
}

export type SpatialDuplicateTimePolicy =
  | 'error'
  | 'coalesceFirst'
  | 'coalesceLast'
  | 'hold'
  | 'cut'
  | 'preserve';

export interface SpatialTrackDiagnostics {
  durationSecs: number;
  duplicateTimePolicy: SpatialDuplicateTimePolicy;
  warnings: SpatialDiagnosticWarning[];
}

export interface SpatialSamplingOptions {
  sampleStepSecs?: number;
  frameRate?: number;
  maxSamples?: number;
}

export const SPATIAL_ZERO_VECTOR: Readonly<SpatialVector3>;
export const SPATIAL_LOCAL_FORWARD: Readonly<SpatialVector3>;
export const SPATIAL_LOCAL_RIGHT: Readonly<SpatialVector3>;
export const SPATIAL_LOCAL_UP: Readonly<SpatialVector3>;
export const SPATIAL_IDENTITY_QUATERNION: Readonly<SpatialQuaternion>;
export const DEFAULT_SPATIAL_SCALE_PROFILE: Readonly<Required<SpatialScaleProfile>>;

export function normalizeSpatialVector3(input: unknown, fallback?: SpatialVector3): SpatialVector3;
export function normalizeSpatialQuaternion(input: unknown, fallback?: SpatialQuaternion): SpatialQuaternion;
export function normalizeSpatialPose(input?: { observerPc?: unknown; orientationIcrs?: unknown }): SpatialPose;
export function normalizeSpatialScaleProfile(input?: SpatialScaleProfile): Required<SpatialScaleProfile>;
export function cloneSpatialVector3(value: SpatialVector3): SpatialVector3;
export function cloneSpatialQuaternion(value: SpatialQuaternion): SpatialQuaternion;
export function cloneSpatialPose(pose: SpatialPose): SpatialPose;
export function addSpatialVectors(a: SpatialVector3, b: SpatialVector3): SpatialVector3;
export function subtractSpatialVectors(a: SpatialVector3, b: SpatialVector3): SpatialVector3;
export function scaleSpatialVector(vector: SpatialVector3, scalar: number): SpatialVector3;
export function getSpatialVectorLength(vector: SpatialVector3): number;
export function normalizeSpatialDirection(vector: SpatialVector3): SpatialVector3;
export function isNonZeroSpatialVector(vector: SpatialVector3): boolean;
export function multiplySpatialQuaternions(a: SpatialQuaternion, b: SpatialQuaternion): SpatialQuaternion;
export function createSpatialQuaternionFromAxisAngle(axis: SpatialVector3, angleRad: number): SpatialQuaternion;
export function applySpatialQuaternion(vector: SpatialVector3, quaternion: SpatialQuaternion): SpatialVector3;
export function rotateSpatialLocalAxis(
  orientationIcrs: SpatialQuaternion,
  localAxis: SpatialVector3,
  angleRad: number
): SpatialQuaternion;

export function raDecToIcrsDirection(input: {
  raDeg?: number;
  raHours?: number;
  decDeg: number;
}): SpatialVector3 | null;
export function raDecDistanceToIcrs(input: {
  raDeg?: number;
  raHours?: number;
  decDeg: number;
  distancePc: number;
}): SpatialVector3 | null;
export function icrsToRaDec(
  positionPc: SpatialVector3,
  observerPc?: SpatialVector3
): { raDeg: number; raHours: number; decDeg: number } | null;
export function icrsDirectionToTargetPc(
  directionIcrs: SpatialVector3,
  distancePc: number,
  observerPc?: SpatialVector3
): SpatialVector3 | null;
export function projectSpatialEquirectangular(input: {
  raDeg: number;
  decDeg: number;
  width: number;
  height: number;
}): { x: number; y: number };

export type SpatialTargetSpec =
  | { kind: 'position'; targetPc: SpatialVector3; source?: SpatialSourceRef }
  | { kind: 'radec'; raDeg?: number; raHours?: number; decDeg: number; distancePc: number; source?: SpatialSourceRef }
  | { kind: 'bookmark'; id: string; source?: SpatialSourceRef };

export interface ResolveSpatialTargetOptions {
  resolveBookmark?: (
    bookmarkId: string,
    input: Extract<SpatialTargetSpec, { kind: 'bookmark' }>
  ) => SpatialTargetSpec | Promise<SpatialTargetSpec | null> | null;
}

export function normalizeSpatialTarget(input: unknown): SpatialTargetSpec;
export function resolveSpatialTarget(
  input: SpatialTargetSpec,
  options?: ResolveSpatialTargetOptions
): SpatialVector3 | Promise<SpatialVector3 | null> | null;

export type SpatialAimSpec =
  | {
      kind: 'target';
      targetPc: SpatialVector3;
      upIcrs?: SpatialVector3;
      positionAngleDeg?: number;
      lock?: boolean;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'direction';
      forwardIcrs: SpatialVector3;
      upIcrs?: SpatialVector3;
      positionAngleDeg?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orientation';
      orientationIcrs: SpatialQuaternion;
      source?: SpatialSourceRef;
    };

export type SpatialAimSample =
  | {
      kind: 'target';
      targetPc: SpatialVector3;
      forwardIcrs: SpatialVector3;
      upIcrs: SpatialVector3;
      orientationIcrs: SpatialQuaternion;
      distancePc: number;
      source?: SpatialSourceRef;
      diagnostics?: SpatialSampleDiagnostics;
    }
  | {
      kind: 'direction' | 'orientation';
      forwardIcrs: SpatialVector3;
      upIcrs: SpatialVector3;
      orientationIcrs: SpatialQuaternion;
      syntheticTargetPc?: SpatialVector3;
      syntheticTargetDistancePc?: number;
      source?: SpatialSourceRef;
      diagnostics?: SpatialSampleDiagnostics;
    };

export function normalizeSpatialAimSpec(input: unknown): SpatialAimSpec;
export function evaluateSpatialAim(input: {
  observerPc: SpatialVector3;
  aim: SpatialAimSpec;
  syntheticTargetDistancePc?: number;
}): SpatialAimSample;

export interface SpatialFrameState {
  timeSecs?: number;
  frameIndex?: number;
  pose: SpatialPose;
  aim: SpatialAimSample | null;
  targetLock?: SpatialTargetLockState | null;
  orbit?: SpatialOrbitState | null;
  pathFollow?: SpatialPathFollowState | null;
  fovDeg?: number;
}

export interface SpatialTargetLockState {
  targetPc: SpatialVector3;
  aim: Extract<SpatialAimSample, { kind: 'target' }> | null;
}

export interface SpatialOrbitState {
  orbit: SpatialOrbitSpec;
  angleRad: number;
  basis: SpatialOrbitBasis;
  speedPcPerSec: number;
}

export interface SpatialPathFollowState {
  routeId?: string;
  routeKind: SpatialRouteKind;
  distancePc: number;
  velocityPcPerSec?: SpatialVector3;
  speedPcPerSec: number;
  segmentIndex: number | null;
}

export interface SpatialDestinationSpec {
  id?: string;
  label?: string;
  centerPc: SpatialVector3;
  radiusPc?: number;
  boundsRadiusPc?: number;
  aim?: SpatialAimSpec;
  orbit?: SpatialOrbitSpec;
  dwellSecs?: number;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export function normalizeSpatialDestination(input: unknown): SpatialDestinationSpec;

export interface SpatialOrbitSpec {
  centerPc: SpatialVector3;
  radiusPc: number;
  orbitNormal?: SpatialVector3;
  referenceAxis?: SpatialVector3;
  handedness?: 1 | -1;
  initialAngleRad?: number;
  angularSpeedRadPerSec?: number;
  aim?: SpatialAimSpec;
  source?: SpatialSourceRef;
}

export interface SpatialOrbitBasis {
  centerPc: SpatialVector3;
  radiusPc: number;
  normal: SpatialVector3;
  radial: SpatialVector3;
  tangent: SpatialVector3;
  referenceAxis: SpatialVector3;
  warnings: SpatialDiagnosticWarning[];
}

export interface SpatialOrbitSample {
  elapsedSecs: number;
  angleRad: number;
  positionPc: SpatialVector3;
  velocityPcPerSec: SpatialVector3;
  speedPcPerSec: number;
  radial: SpatialVector3;
  tangent: SpatialVector3;
  basis: SpatialOrbitBasis;
  aim: SpatialAimSample;
}

export function normalizeSpatialOrbitSpec(input: unknown): SpatialOrbitSpec;
export function createSpatialOrbitBasis(orbit: SpatialOrbitSpec): SpatialOrbitBasis;
export function deriveSpatialOrbitAngle(input: {
  centerPc: SpatialVector3;
  positionPc: SpatialVector3;
  orbitNormal?: SpatialVector3;
  referenceAxis?: SpatialVector3;
}): number;
export function sampleSpatialOrbitPosition(
  orbit: SpatialOrbitSpec | SpatialOrbitBasis,
  angleRad: number
): SpatialVector3;
export function evaluateSpatialOrbit(orbit: SpatialOrbitSpec, elapsedSecs: number): SpatialOrbitSample;
export function deriveSpatialOrbitHandoff(input: {
  positionPc: SpatialVector3;
  orbit: SpatialOrbitSpec;
}): {
  orbit: SpatialOrbitSpec & { initialAngleRad: number };
  basis: SpatialOrbitBasis;
  angleRad: number;
};

export type SpatialTimingSpec =
  | { kind: 'duration'; durationSecs: number; minDurationSecs?: number; maxDurationSecs?: number; source?: SpatialSourceRef }
  | { kind: 'constantSpeed'; speedPcPerSec: number; durationSecs?: number; source?: SpatialSourceRef }
  | Record<string, unknown>;

export interface SpatialTimingPhase {
  kind: 'accelerate' | 'cruise' | 'decelerate' | 'blend' | 'hold';
  startTimeSecs: number;
  endTimeSecs: number;
  startDistancePc: number;
  endDistancePc: number;
  startSpeedPcPerSec: number;
  endSpeedPcPerSec: number;
}

export interface SpatialTimingDiagnostics {
  requestedDurationSecs?: number;
  requestedAccelerationPcPerSec2?: number;
  requestedDecelerationPcPerSec2?: number;
  requestedAccelerationApplied?: boolean;
  requestedDecelerationApplied?: boolean;
  durationConstrainedProfile?: boolean;
  clampedToMinDuration?: boolean;
  clampedToMaxDuration?: boolean;
  warnings: SpatialDiagnosticWarning[];
}

export interface SpatialTimingProfile {
  kind: string;
  durationSecs: number;
  distancePc?: number;
  departureSpeedPcPerSec?: number;
  cruiseSpeedPcPerSec?: number;
  arrivalSpeedPcPerSec?: number;
  peakSpeedPcPerSec?: number;
  accelerationPcPerSec2?: number;
  decelerationPcPerSec2?: number;
  phases: SpatialTimingPhase[];
  diagnostics: SpatialTimingDiagnostics;
}

export function normalizeSpatialTimingSpec(input: unknown): SpatialTimingSpec;
export function deriveSpatialOrbitalInsertTiming(input: {
  distancePc: number;
  orbitalSpeedPcPerSec: number;
  currentSpeedPcPerSec?: number;
  approachSpeedPcPerSec?: number;
  durationSecs?: number;
  accelerationPcPerSec2?: number;
  decelerationPcPerSec2?: number;
  minDurationSecs?: number;
  maxDurationSecs?: number;
}): SpatialTimingProfile;

export type SpatialTravelSpec =
  | {
      kind: 'polyline';
      timing?: SpatialTimingSpec | SpatialTimingProfile;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orbitTransfer';
      timing?: SpatialTimingSpec | SpatialTimingProfile;
      sampleStepSecs?: number;
      maxPoints?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orbitalInsert';
      timing?: SpatialTimingSpec | SpatialTimingProfile;
      sampleStepSecs?: number;
      maxPoints?: number;
      source?: SpatialSourceRef;
    };

export function normalizeSpatialTravelSpec(input: unknown): SpatialTravelSpec;
export function deriveSpatialRouteTiming(input: {
  totalLengthPc: number;
  travel?: SpatialTravelSpec;
  departureSpeedPcPerSec?: number;
  arrivalSpeedPcPerSec?: number;
}): SpatialTimingProfile;

export type SpatialRouteKind = 'polyline' | 'orbitTransfer' | 'orbitalInsert';

export interface SpatialRoute {
  id?: string;
  kind: SpatialRouteKind;
  pointsPc: SpatialVector3[];
  segments: SpatialRouteSegment[];
  totalLengthPc: number;
  timing: SpatialTimingProfile;
  departure: SpatialRouteEndpoint;
  arrival: SpatialRouteEndpoint;
  arrivalAction?: SpatialArrivalAction | null;
  diagnostics: SpatialRouteDiagnostics;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialRouteSegment {
  index: number;
  startPc: SpatialVector3;
  endPc: SpatialVector3;
  lengthPc: number;
  cumulativeStartPc: number;
  cumulativeEndPc: number;
  durationSecs?: number;
  averageSpeedPcPerSec?: number;
  curvatureRadPerPc?: number;
}

export interface SpatialRouteEndpointSpec {
  positionPc?: SpatialVector3;
  destination?: SpatialDestinationSpec;
  orbit?: SpatialOrbitSpec | null;
  aim?: SpatialAimSpec | null;
  velocityPcPerSec?: SpatialVector3;
  speedPcPerSec?: number;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialRouteEndpoint {
  kind: 'point' | 'destination' | 'orbit';
  positionPc: SpatialVector3;
  destination?: SpatialDestinationSpec;
  velocityPcPerSec?: SpatialVector3;
  speedPcPerSec?: number;
  orbit?: SpatialOrbitSpec | null;
  orbitBasis?: SpatialOrbitBasis | null;
  aim?: SpatialAimSpec | null;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialRouteEndpointBuildOptions {
  role?: 'departure' | 'arrival';
  referencePose?: SpatialPose;
  fallbackAim?: SpatialAimSpec | null;
  fallbackOrbit?: SpatialOrbitSpec | null;
}

export interface SpatialRouteDiagnostics {
  durationSecs: number;
  totalLengthPc: number;
  averageSpeedPcPerSec: number;
  peakSpeedPcPerSec: number;
  departureSpeedPcPerSec: number;
  arrivalSpeedPcPerSec: number;
  settleSecs?: number;
  settleBehavior?: 'none' | 'snap' | 'blendToOrbit' | 'continueOrbit';
  warnings: SpatialDiagnosticWarning[];
  [key: string]: unknown;
}

export interface SpatialRouteSample {
  elapsedSecs: number;
  frameIndex?: number;
  routeId?: string;
  routeKind: SpatialRouteKind;
  positionPc: SpatialVector3;
  velocityPcPerSec: SpatialVector3;
  speedPcPerSec: number;
  distancePc: number;
  segmentIndex: number | null;
  complete: boolean;
  diagnostics?: SpatialSampleDiagnostics;
}

export interface SpatialRouteEvaluationOptions {
  frameIndex?: number;
}

export interface SpatialRouteSamplingOptions extends SpatialRouteEvaluationOptions, SpatialSamplingOptions {}

export function normalizeSpatialRouteEndpointSpec(input: unknown): SpatialRouteEndpointSpec;
export function buildSpatialRouteEndpoint(
  input: SpatialRouteEndpointSpec | SpatialDestinationSpec | SpatialVector3,
  options?: SpatialRouteEndpointBuildOptions
): SpatialRouteEndpoint | null;
export function buildSpatialPolylineRoute(input: {
  pointsPc: Iterable<SpatialVector3>;
  travel?: Extract<SpatialTravelSpec, { kind: 'polyline' }>;
  source?: SpatialSourceRef;
}): SpatialRoute;
export function buildSpatialOrbitTransferRoute(input: {
  from: SpatialRouteEndpointSpec | SpatialRouteEndpoint;
  to: SpatialRouteEndpointSpec | SpatialRouteEndpoint;
  travel?: Extract<SpatialTravelSpec, { kind: 'orbitTransfer' }>;
  referencePose?: SpatialPose;
  source?: SpatialSourceRef;
}): SpatialRoute | null;
export function buildSpatialOrbitalInsertRoute(input: {
  from: SpatialRouteEndpointSpec | SpatialRouteEndpoint;
  orbit: SpatialOrbitSpec;
  destination?: SpatialDestinationSpec;
  travel?: Extract<SpatialTravelSpec, { kind: 'orbitalInsert' }>;
  referencePose?: SpatialPose;
  source?: SpatialSourceRef;
}): SpatialRoute | null;
export function getSpatialRouteDiagnostics(route: SpatialRoute): SpatialRouteDiagnostics;
export function evaluateSpatialRoute(
  route: SpatialRoute,
  elapsedSecs: number,
  options?: SpatialRouteEvaluationOptions
): SpatialRouteSample;
export function sampleSpatialRoute(route: SpatialRoute, options?: SpatialRouteSamplingOptions): SpatialRouteSample[];

export type SpatialArrivalAction =
  | { kind: 'none' }
  | {
      kind: 'orbit';
      destination?: SpatialDestinationSpec;
      orbit: SpatialOrbitSpec;
      aim?: SpatialAimSpec | null;
      settleSecs?: number;
      preserveAim?: boolean;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orbitalInsert';
      destination?: SpatialDestinationSpec;
      orbit: SpatialOrbitSpec;
      timing?: SpatialTimingProfile;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'lookAt';
      destination?: SpatialDestinationSpec;
      aim: SpatialAimSpec;
      dwellSecs?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'lockAt';
      destination?: SpatialDestinationSpec;
      aim: Extract<SpatialAimSpec, { kind: 'target' }>;
      dwellSecs?: number;
      source?: SpatialSourceRef;
    };

export function normalizeSpatialArrivalAction(input: unknown): SpatialArrivalAction;

export interface SpatialAimTrack {
  keys: SpatialAimKey[];
  durationSecs: number;
  defaultInterpolation?: SpatialAimInterpolationSpec;
  duplicateTimePolicy?: SpatialDuplicateTimePolicy;
  diagnostics?: SpatialTrackDiagnostics;
}

export interface SpatialAimTrackSample {
  timeSecs: number;
  aim: SpatialAimSample;
  segmentIndex: number | null;
  source?: SpatialSourceRef;
  diagnostics?: SpatialSampleDiagnostics;
}

export type SpatialAimEvaluationContext =
  | {
      observerPc: SpatialVector3;
      fallbackUpIcrs?: SpatialVector3;
      syntheticTargetDistancePc?: number;
    }
  | {
      positionSample: SpatialPathSample;
      fallbackUpIcrs?: SpatialVector3;
      syntheticTargetDistancePc?: number;
    };

export interface BuildSpatialAimTrackOptions {
  durationSecs?: number;
  defaultInterpolation?: SpatialAimInterpolationSpec;
  duplicateTimePolicy?: SpatialDuplicateTimePolicy;
}

export interface SpatialPathSpec {
  durationSecs?: number;
  positionKeys: SpatialPositionKey[];
  aimKeys?: SpatialAimKey[];
  timeRemap?: SpatialTimeRemapSpec | null;
  duplicateTimePolicy?: SpatialDuplicateTimePolicy;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialPositionKey {
  id: string;
  timeSecs: number;
  positionPc: SpatialVector3;
  interpolation?: SpatialPositionInterpolation;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialAimKey {
  id: string;
  timeSecs: number;
  aim: SpatialAimSpec;
  interpolation?: SpatialAimInterpolationSpec;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export type SpatialPositionInterpolation =
  | { kind: 'hold' }
  | { kind: 'linear'; easing?: SpatialEasingSpec }
  | { kind: 'catmullRom'; tension?: number; centripetal?: boolean }
  | { kind: 'cubicBezier'; inTangentPc?: SpatialVector3; outTangentPc?: SpatialVector3 }
  | { kind: 'hermite'; inVelocityPcPerSec?: SpatialVector3; outVelocityPcPerSec?: SpatialVector3 };

export type SpatialAimInterpolationSpec =
  | { kind: 'hold' }
  | { kind: 'slerp'; easing?: SpatialEasingSpec }
  | { kind: 'targetLinear'; easing?: SpatialEasingSpec }
  | { kind: 'targetBezier'; easing?: SpatialEasingSpec }
  | { kind: 'directionSlerp'; easing?: SpatialEasingSpec };

export type SpatialEasingSpec =
  | { kind: 'linear' }
  | { kind: 'smoothstep' }
  | { kind: 'easeIn'; power?: number }
  | { kind: 'easeOut'; power?: number }
  | { kind: 'easeInOut'; power?: number }
  | { kind: 'cubicBezier'; x1: number; y1: number; x2: number; y2: number };

export interface SpatialTimeRemapSpec {
  kind: 'linear' | 'eased';
  playbackDurationSecs?: number;
  easing?: SpatialEasingSpec;
}

export interface SpatialPathSample {
  timeSecs: number;
  playbackElapsedSecs?: number;
  frameIndex?: number;
  pose: SpatialPose;
  aim: SpatialAimSample | null;
  velocityPcPerSec: SpatialVector3;
  speedPcPerSec: number;
  accelerationPcPerSec2?: SpatialVector3;
  accelerationMagnitudePcPerSec2?: number;
  segmentIndex: number | null;
  segmentId?: string | null;
  diagnostics?: SpatialSampleDiagnostics;
}

export interface SpatialPathEvaluationOptions {
  frameIndex?: number;
  syntheticTargetDistancePc?: number;
}

export interface SpatialPathSamplingOptions extends SpatialPathEvaluationOptions, SpatialSamplingOptions {}
export interface SpatialPathPlaybackEvaluationOptions extends SpatialPathEvaluationOptions {}

export interface SpatialPathDiagnostics {
  durationSecs: number;
  playbackDurationSecs?: number;
  duplicateTimePolicy: SpatialDuplicateTimePolicy;
  timeRemap?: SpatialTimeRemapSpec | null;
  warnings: SpatialDiagnosticWarning[];
}

export function buildSpatialAimTrack(
  keys?: Iterable<SpatialAimKey>,
  options?: BuildSpatialAimTrackOptions
): SpatialAimTrack;
export function evaluateSpatialAimTrack(
  track: SpatialAimTrack,
  timeSecs: number,
  context: SpatialAimEvaluationContext
): SpatialAimTrackSample;
export function normalizeSpatialPathSpec(input: unknown): SpatialPathSpec;
export function evaluateSpatialPath(
  path: SpatialPathSpec,
  timeSecs: number,
  options?: SpatialPathEvaluationOptions
): SpatialPathSample;
export function evaluateSpatialPathPlayback(
  path: SpatialPathSpec,
  elapsedSecs: number,
  options?: SpatialPathPlaybackEvaluationOptions
): SpatialPathSample;
export function sampleSpatialPath(path: SpatialPathSpec, options?: SpatialPathSamplingOptions): SpatialPathSample[];
export function sampleSpatialPathDiagnostics(
  path: SpatialPathSpec,
  options?: SpatialPathSamplingOptions
): SpatialPathDiagnostics;

export interface SpatialViewTransitionSpec {
  from: SpatialFrameState;
  to: SpatialFrameState;
  durationSecs?: number;
  position?: SpatialTransitionLaneSpec;
  aim?: SpatialTransitionLaneSpec;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialTransitionLaneSpec {
  durationSecs?: number;
  delaySecs?: number;
  easing?: SpatialEasingSpec;
  interpolation?: 'hold' | 'linear' | 'smoothstep' | 'easeIn' | 'easeOut' | 'easeInOut' | 'slerp';
}

export interface SpatialViewTransitionPath {
  kind: 'viewTransitionPath';
  durationSecs: number;
  path: SpatialPathSpec;
  from: SpatialFrameState;
  to: SpatialFrameState;
  diagnostics: SpatialViewTransitionDiagnostics;
}

export interface SpatialViewTransitionSample {
  elapsedSecs: number;
  complete: boolean;
  positionComplete: boolean;
  aimComplete: boolean;
  frameState: SpatialFrameState;
  pose: SpatialPose;
  diagnostics?: SpatialSampleDiagnostics;
}

export interface SpatialViewTransitionDiagnostics {
  durationSecs: number;
  positionDurationSecs: number;
  aimDurationSecs: number;
  positionDelaySecs: number;
  aimDelaySecs: number;
  pathDiagnostics: SpatialPathDiagnostics;
  warnings: SpatialDiagnosticWarning[];
}

export type SpatialViewTransitionBuildOptions = SpatialPathEvaluationOptions;

export function normalizeSpatialViewTransitionSpec(input: unknown): SpatialViewTransitionSpec;
export function buildSpatialViewTransitionPath(
  spec: SpatialViewTransitionSpec,
  options?: SpatialViewTransitionBuildOptions
): SpatialViewTransitionPath;
export function evaluateSpatialViewTransition(
  transition: SpatialViewTransitionPath,
  elapsedSecs: number
): SpatialViewTransitionSample;

export interface SpatialPoseTransitionSpec {
  from: SpatialPose;
  to: SpatialPose;
  durationSecs?: number;
  movement?: SpatialTransitionLaneSpec;
  orientation?: SpatialTransitionLaneSpec;
}

export interface SpatialPoseTransition {
  durationSecs: number;
  from: SpatialPose;
  to: SpatialPose;
  movement?: SpatialTransitionLaneSpec;
  orientation?: SpatialTransitionLaneSpec;
}

export interface SpatialPoseTransitionSample {
  elapsedSecs: number;
  complete: boolean;
  movementComplete: boolean;
  orientationComplete: boolean;
  pose: SpatialPose;
  diagnostics?: SpatialSampleDiagnostics;
}

export function normalizeSpatialPoseTransitionSpec(input: unknown): SpatialPoseTransitionSpec;
export function createSpatialPoseTransition(input: SpatialPoseTransitionSpec): SpatialPoseTransition;
export function evaluateSpatialPoseTransition(
  transition: SpatialPoseTransition,
  elapsedSecs: number
): SpatialPoseTransitionSample;

export type SpatialPreloadHint =
  | {
      kind: 'pathVolume';
      pointsPc: SpatialVector3[];
      radiusPc: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    }
  | {
      kind: 'sphereVolume';
      centerPc: SpatialVector3;
      radiusPc: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    }
  | {
      kind: 'viewLookahead';
      pose: SpatialPose;
      velocityPcPerSec: SpatialVector3;
      lookaheadSecs: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    };

export interface MaterializeSpatialPreloadHintsOptions extends SpatialPathSamplingOptions {
  pathRadiusPc?: number;
  sphereRadiusPc?: number;
  lookaheadSecs?: number;
  priority?: number;
}

export function materializeSpatialPreloadHints(
  input: SpatialPathSpec | SpatialPathSample[],
  options?: MaterializeSpatialPreloadHintsOptions
): SpatialPreloadHint[];

export interface SpatialControlReader {
  getAxis?(name: string): { x: number; y: number; magnitude: number; active: boolean };
  getButton?(name: string): { pressed: boolean; value: number };
  isPressed?(name: string): boolean;
}

export interface SpatialMotionUpdateInput {
  pose: SpatialPose;
  controls?: SpatialControlReader;
  deltaSecs: number;
  scale?: SpatialScaleProfile;
  manualLookActive?: boolean;
}

export function normalizeSpatialUpdateDelta(input: { deltaSecs: number }): number;

export interface SpatialMotionSnapshot {
  kind: string;
  velocityPcPerSec: SpatialVector3;
  speedPcPerSec: number;
  scale: Required<SpatialScaleProfile>;
  activeAutomation: string | null;
}

export interface SpatialMotionModel {
  update(input: SpatialMotionUpdateInput): SpatialPose;
  getSnapshot(): SpatialMotionSnapshot;
  dispose?(): void;
}

export interface SpatialManualMotionOptions {
  moveAxis?: string;
  attitudeAxis?: string;
  rollModifierButton?: string;
  boostButton?: string;
  moveSpeedPcPerSec?: number;
  boostMultiplier?: number;
  pitchRateRadPerSec?: number;
  yawRateRadPerSec?: number;
  rollRateRadPerSec?: number;
}

export interface SpatialInertialMotionOptions extends SpatialManualMotionOptions {
  accelerationPcPerSec2?: number;
  damping?: number;
  maxSpeedPcPerSec?: number;
}

export interface SpatialThrustMotionOptions extends SpatialManualMotionOptions {
  thrustPcPerSec2?: number;
  mass?: number;
  drag?: number;
  maxSpeedPcPerSec?: number;
}

export function createDirectSpatialMotionModel(options?: SpatialManualMotionOptions): SpatialMotionModel;
export function createInertialSpatialMotionModel(options?: SpatialInertialMotionOptions): SpatialMotionModel;
export function createThrustSpatialMotionModel(options?: SpatialThrustMotionOptions): SpatialMotionModel;

export interface SpatialNavigationAutomation {
  flyRoute(route: SpatialRoute): void;
  orbit(orbit: SpatialOrbitSpec): void;
  lookAt(aim: SpatialAimSpec): void;
  lockAt(aim: Extract<SpatialAimSpec, { kind: 'target' }>): void;
  unlockAt(): void;
  cancel(): void;
  update(input: {
    pose: SpatialPose;
    deltaSecs: number;
    manualLookActive?: boolean;
  }): SpatialPose;
  getFrameState(): SpatialFrameState;
  getDiagnostics(): SpatialNavigationDiagnostics;
  dispose(): void;
}

export interface SpatialNavigationDiagnostics {
  activeMovement?: SpatialMovementDiagnostics | null;
  activeAim?: SpatialAimDiagnostics | null;
  elapsedSecs: number;
  durationSecs?: number;
  frameState: SpatialFrameState;
  activeRoute?: SpatialRoute | null;
  activeTiming?: SpatialTimingProfile | null;
  currentSpeedPcPerSec: number;
  arrivalAction?: SpatialArrivalAction | null;
  pendingSettle?: SpatialSettleDiagnostics | null;
  warnings: SpatialDiagnosticWarning[];
}

export interface SpatialMovementDiagnostics {
  kind: SpatialRouteKind | 'orbit' | 'manual' | 'idle';
  route?: SpatialRoute | null;
  orbit?: SpatialOrbitState | null;
  distancePc?: number;
  totalLengthPc?: number;
  speedPcPerSec?: number;
}

export interface SpatialAimDiagnostics {
  aim: SpatialAimSample | null;
  targetLock?: SpatialTargetLockState | null;
  manualLookActive?: boolean;
}

export interface SpatialSettleDiagnostics {
  behavior: NonNullable<SpatialRouteDiagnostics['settleBehavior']>;
  elapsedSecs: number;
  durationSecs: number;
  targetOrbit?: SpatialOrbitSpec;
}

export function createSpatialNavigationAutomation(options?: {
  defaultTiming?: SpatialTimingProfile;
}): SpatialNavigationAutomation;
