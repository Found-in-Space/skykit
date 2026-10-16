/** A frame identifies origin, axes and reference epoch, supplied by its domain owner. */
export interface SpatialCoordinateSpace {
  readonly frameId: string;
  readonly metersPerUnit: number;
}
export interface SpatialCoordinateContext { space: SpatialCoordinateSpace; }
/** Nested specs may inherit their enclosing operation's space. */
export type SpatialInput<T> = T extends unknown ? Omit<T, 'space'> & { space?: SpatialCoordinateSpace } : never;

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
  space: SpatialCoordinateSpace;
  position: SpatialVector3;
  orientation: SpatialQuaternion;
}

export interface SpatialScaleProfile {
  /** Render units per coordinate unit. Does not change physical state or time. */
  worldUnitsPerUnit?: number;
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
export function normalizeSpatialPose(input: { space?: SpatialCoordinateSpace; position?: unknown; orientation?: unknown }, inheritedSpace?: SpatialCoordinateSpace): SpatialPose;
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
  orientation: SpatialQuaternion,
  localAxis: SpatialVector3,
  angleRad: number
): SpatialQuaternion;

export function raDecToIcrsDirection(input: {
  raDeg?: number;
  raHours?: number;
  decDeg: number;
}): SpatialVector3 | null;
export function raDecDistanceToIcrs(input: {
  space: SpatialCoordinateSpace;
  space: SpatialCoordinateSpace;
  raDeg?: number;
  raHours?: number;
  decDeg: number;
  distance: number;
}): SpatialVector3 | null;
export function icrsToRaDec(
  point: SpatialVector3,
  observer?: SpatialVector3
): { raDeg: number; raHours: number; decDeg: number } | null;
export function icrsDirectionToTarget(
  direction: SpatialVector3,
  distance: number,
  space: SpatialCoordinateSpace,
  observer?: SpatialVector3
): SpatialVector3 | null;
export function projectSpatialEquirectangular(input: {
  raDeg: number;
  decDeg: number;
  width: number;
  height: number;
}): { x: number; y: number };

export type SpatialTargetSpec =
  (| { kind: 'position'; target: SpatialVector3; source?: SpatialSourceRef }
  | { kind: 'radec'; raDeg?: number; raHours?: number; decDeg: number; distance: number; source?: SpatialSourceRef }
  | { kind: 'bookmark'; id: string; source?: SpatialSourceRef }) & SpatialCoordinateContext;

export interface ResolveSpatialTargetOptions {
  resolveBookmark?: (
    bookmarkId: string,
    input: Extract<SpatialTargetSpec, { kind: 'bookmark' }>
  ) => SpatialTargetSpec | Promise<SpatialTargetSpec | null> | null;
}

export function normalizeSpatialTarget(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialTargetSpec;
export function resolveSpatialTarget(
  input: SpatialTargetSpec,
  options?: ResolveSpatialTargetOptions
): SpatialVector3 | Promise<SpatialVector3 | null> | null;

export type SpatialAimSpec =
  (| {
      kind: 'target';
      target: SpatialVector3;
      up?: SpatialVector3;
      positionAngleDeg?: number;
      lock?: boolean;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'direction';
      forward: SpatialVector3;
      up?: SpatialVector3;
      positionAngleDeg?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orientation';
      orientation: SpatialQuaternion;
      source?: SpatialSourceRef;
    }) & SpatialCoordinateContext;

export type SpatialAimSample =
  (| {
      kind: 'target';
      target: SpatialVector3;
      forward: SpatialVector3;
      up: SpatialVector3;
      orientation: SpatialQuaternion;
      distance: number;
      source?: SpatialSourceRef;
      diagnostics?: SpatialSampleDiagnostics;
    }
  | {
      kind: 'direction' | 'orientation';
      forward: SpatialVector3;
      up: SpatialVector3;
      orientation: SpatialQuaternion;
      syntheticTarget?: SpatialVector3;
      syntheticTargetDistance?: number;
      source?: SpatialSourceRef;
      diagnostics?: SpatialSampleDiagnostics;
    }) & SpatialCoordinateContext;

export function normalizeSpatialAimSpec(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialAimSpec;
export function evaluateSpatialAim(input: {
  space: SpatialCoordinateSpace;
  position: SpatialVector3;
  aim: SpatialInput<SpatialAimSpec>;
  syntheticTargetDistance?: number;
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
  target: SpatialVector3;
  aim: Extract<SpatialAimSample, { kind: 'target' }> | null;
}

export interface SpatialOrbitState {
  orbit: SpatialOrbitSpec;
  angleRad: number;
  basis: SpatialOrbitBasis;
  speedUnitsPerSec: number;
}

export interface SpatialPathFollowState {
  routeId?: string;
  routeKind: SpatialRouteKind;
  distance: number;
  velocityUnitsPerSec?: SpatialVector3;
  speedUnitsPerSec: number;
  segmentIndex: number | null;
}

export interface SpatialDestinationSpec {
  space: SpatialCoordinateSpace;
  id?: string;
  label?: string;
  center: SpatialVector3;
  radius?: number;
  boundsRadius?: number;
  aim?: SpatialInput<SpatialAimSpec>;
  orbit?: SpatialInput<SpatialOrbitSpec>;
  dwellSecs?: number;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export function normalizeSpatialDestination(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialDestinationSpec;

export interface SpatialOrbitSpec {
  space: SpatialCoordinateSpace;
  center: SpatialVector3;
  radius: number;
  orbitNormal?: SpatialVector3;
  referenceAxis?: SpatialVector3;
  handedness?: 1 | -1;
  initialAngleRad?: number;
  angularSpeedRadPerSec?: number;
  aim?: SpatialInput<SpatialAimSpec>;
  source?: SpatialSourceRef;
}

export interface SpatialOrbitBasis {
  space: SpatialCoordinateSpace;
  center: SpatialVector3;
  radius: number;
  normal: SpatialVector3;
  radial: SpatialVector3;
  tangent: SpatialVector3;
  referenceAxis: SpatialVector3;
  warnings: SpatialDiagnosticWarning[];
}

export interface SpatialOrbitSample {
  space: SpatialCoordinateSpace;
  elapsedSecs: number;
  angleRad: number;
  position: SpatialVector3;
  velocityUnitsPerSec: SpatialVector3;
  speedUnitsPerSec: number;
  radial: SpatialVector3;
  tangent: SpatialVector3;
  basis: SpatialOrbitBasis;
  aim: SpatialAimSample;
}

export function normalizeSpatialOrbitSpec(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialOrbitSpec;
export function createSpatialOrbitBasis(orbit: SpatialOrbitSpec): SpatialOrbitBasis;
export function deriveSpatialOrbitAngle(input: {
  space: SpatialCoordinateSpace;
  center: SpatialVector3;
  position: SpatialVector3;
  orbitNormal?: SpatialVector3;
  referenceAxis?: SpatialVector3;
  handedness?: 1 | -1;
}): number;
export function sampleSpatialOrbitPosition(
  orbit: SpatialOrbitSpec | SpatialOrbitBasis,
  angleRad: number
): SpatialVector3;
export function evaluateSpatialOrbit(orbit: SpatialOrbitSpec, elapsedSecs: number): SpatialOrbitSample;
export function deriveSpatialOrbitHandoff(input: {
  space: SpatialCoordinateSpace;
  position: SpatialVector3;
  orbit: SpatialInput<SpatialOrbitSpec>;
}): {
  orbit: SpatialOrbitSpec & { initialAngleRad: number };
  basis: SpatialOrbitBasis;
  angleRad: number;
};

export type SpatialTimingSpec =
  (| { kind: 'duration'; durationSecs: number; minDurationSecs?: number; maxDurationSecs?: number; source?: SpatialSourceRef }
  | { kind: 'constantSpeed'; speedUnitsPerSec: number; durationSecs?: number; source?: SpatialSourceRef }
  | {
      kind: 'trapezoid';
      departureSpeedUnitsPerSec?: number;
      cruiseSpeedUnitsPerSec?: number;
      arrivalSpeedUnitsPerSec?: number;
      accelerationUnitsPerSec2?: number;
      decelerationUnitsPerSec2?: number;
      durationSecs?: number;
      minDurationSecs?: number;
      maxDurationSecs?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'triangular';
      departureSpeedUnitsPerSec?: number;
      peakSpeedUnitsPerSec?: number;
      arrivalSpeedUnitsPerSec?: number;
      accelerationUnitsPerSec2?: number;
      decelerationUnitsPerSec2?: number;
      durationSecs?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'custom';
      durationSecs: number;
      phases: SpatialTimingPhase[];
      source?: SpatialSourceRef;
    }) & SpatialCoordinateContext;

export interface SpatialTimingPhase {
  kind: 'accelerate' | 'cruise' | 'decelerate' | 'blend' | 'hold';
  startTimeSecs: number;
  endTimeSecs: number;
  startDistance: number;
  endDistance: number;
  startSpeedUnitsPerSec: number;
  endSpeedUnitsPerSec: number;
}

export interface SpatialTimingDiagnostics {
  requestedDurationSecs?: number;
  requestedAccelerationUnitsPerSec2?: number;
  requestedDecelerationUnitsPerSec2?: number;
  requestedAccelerationApplied?: boolean;
  requestedDecelerationApplied?: boolean;
  durationConstrainedProfile?: boolean;
  clampedToMinDuration?: boolean;
  clampedToMaxDuration?: boolean;
  warnings: SpatialDiagnosticWarning[];
}

export interface SpatialTimingProfile {
  space: SpatialCoordinateSpace;
  kind: 'duration' | 'constantSpeed' | 'trapezoid' | 'triangular' | 'custom';
  durationSecs: number;
  distance?: number;
  departureSpeedUnitsPerSec?: number;
  cruiseSpeedUnitsPerSec?: number;
  arrivalSpeedUnitsPerSec?: number;
  peakSpeedUnitsPerSec?: number;
  accelerationUnitsPerSec2?: number;
  decelerationUnitsPerSec2?: number;
  phases: SpatialTimingPhase[];
  diagnostics: SpatialTimingDiagnostics;
}

export function normalizeSpatialTimingSpec(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialTimingSpec;
export function deriveSpatialOrbitalInsertTiming(input: {
  space: SpatialCoordinateSpace;
  distance: number;
  orbitalSpeedUnitsPerSec: number;
  currentSpeedUnitsPerSec?: number;
  approachSpeedUnitsPerSec?: number;
  durationSecs?: number;
  accelerationUnitsPerSec2?: number;
  decelerationUnitsPerSec2?: number;
  minDurationSecs?: number;
  maxDurationSecs?: number;
}): SpatialTimingProfile;

export type SpatialTravelSpec =
  (| {
      kind: 'polyline';
      timing?: SpatialInput<SpatialTimingSpec> | SpatialTimingProfile;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orbitTransfer';
      timing?: SpatialInput<SpatialTimingSpec> | SpatialTimingProfile;
      sampleStepSecs?: number;
      maxPoints?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orbitalInsert';
      timing?: SpatialInput<SpatialTimingSpec> | SpatialTimingProfile;
      sampleStepSecs?: number;
      maxPoints?: number;
      source?: SpatialSourceRef;
    }) & SpatialCoordinateContext;

export function normalizeSpatialTravelSpec(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialTravelSpec;
export function deriveSpatialRouteTiming(input: {
  space: SpatialCoordinateSpace;
  totalLength: number;
  travel?: SpatialInput<SpatialTravelSpec>;
  departureSpeedUnitsPerSec?: number;
  arrivalSpeedUnitsPerSec?: number;
}): SpatialTimingProfile;

export type SpatialRouteKind = 'polyline' | 'orbitTransfer' | 'orbitalInsert';

export interface SpatialRoute {
  space: SpatialCoordinateSpace;
  id?: string;
  kind: SpatialRouteKind;
  points: SpatialVector3[];
  segments: SpatialRouteSegment[];
  totalLength: number;
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
  start: SpatialVector3;
  end: SpatialVector3;
  length: number;
  cumulativeStart: number;
  cumulativeEnd: number;
  durationSecs?: number;
  averageSpeedUnitsPerSec?: number;
  curvatureRadPer?: number;
}

export interface SpatialRouteEndpointSpec {
  space: SpatialCoordinateSpace;
  position?: SpatialVector3;
  destination?: SpatialInput<SpatialDestinationSpec>;
  orbit?: SpatialInput<SpatialOrbitSpec> | null;
  aim?: SpatialInput<SpatialAimSpec> | null;
  velocityUnitsPerSec?: SpatialVector3;
  speedUnitsPerSec?: number;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialRouteEndpoint {
  space: SpatialCoordinateSpace;
  kind: 'point' | 'destination' | 'orbit';
  position: SpatialVector3;
  destination?: SpatialDestinationSpec;
  velocityUnitsPerSec?: SpatialVector3;
  speedUnitsPerSec?: number;
  orbit?: SpatialOrbitSpec | null;
  orbitBasis?: SpatialOrbitBasis | null;
  aim?: SpatialAimSpec | null;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialRouteEndpointBuildOptions {
  space?: SpatialCoordinateSpace;
  role?: 'departure' | 'arrival';
  referencePose?: SpatialInput<SpatialPose>;
  fallbackAim?: SpatialInput<SpatialAimSpec> | null;
  fallbackOrbit?: SpatialInput<SpatialOrbitSpec> | null;
}

export interface SpatialRouteDiagnostics {
  durationSecs: number;
  totalLength: number;
  averageSpeedUnitsPerSec: number;
  peakSpeedUnitsPerSec: number;
  departureSpeedUnitsPerSec: number;
  arrivalSpeedUnitsPerSec: number;
  settleSecs?: number;
  settleBehavior?: 'none' | 'snap' | 'blendToOrbit' | 'continueOrbit';
  selectedOrbitNormal?: SpatialVector3;
  selectedRadial?: SpatialVector3;
  selectedTangent?: SpatialVector3;
  insertionSelection?: 'explicitAngle' | 'tangent' | 'nearestAngleFallback';
  insertionAngleRad?: number;
  insertionPosition?: SpatialVector3;
  /** Cosine alignment between the insertion approach and signed orbital velocity. */
  insertionApproachAlignment?: number;
  /** Cosine alignment between an authored departure velocity and the insertion approach. */
  insertionDepartureVelocityAlignment?: number;
  /** Signed distance from the departure position to the orbit plane. */
  insertionPlaneOffset?: number;
  warnings: SpatialDiagnosticWarning[];
  [key: string]: unknown;
}

export interface SpatialRouteSample {
  space: SpatialCoordinateSpace;
  elapsedSecs: number;
  frameIndex?: number;
  routeId?: string;
  routeKind: SpatialRouteKind;
  position: SpatialVector3;
  velocityUnitsPerSec: SpatialVector3;
  speedUnitsPerSec: number;
  distance: number;
  segmentIndex: number | null;
  complete: boolean;
  diagnostics?: SpatialSampleDiagnostics;
}

export interface SpatialRouteEvaluationOptions {
  frameIndex?: number;
}

export interface SpatialRouteSamplingOptions extends SpatialRouteEvaluationOptions, SpatialSamplingOptions {}

export function normalizeSpatialRouteEndpointSpec(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialRouteEndpointSpec;
export function buildSpatialRouteEndpoint(
  input: SpatialRouteEndpointSpec | SpatialDestinationSpec | SpatialVector3,
  options?: SpatialRouteEndpointBuildOptions
): SpatialRouteEndpoint | null;
export function buildSpatialPolylineRoute(input: {
  space: SpatialCoordinateSpace;
  points: Iterable<SpatialVector3>;
  travel?: Extract<SpatialInput<SpatialTravelSpec>, { kind: 'polyline' }>;
  arrivalAction?: SpatialInput<SpatialArrivalAction> | null;
  source?: SpatialSourceRef;
}): SpatialRoute;
export function buildSpatialOrbitTransferRoute(input: {
  space: SpatialCoordinateSpace;
  from: SpatialInput<SpatialRouteEndpointSpec> | SpatialRouteEndpoint;
  to: SpatialInput<SpatialRouteEndpointSpec> | SpatialRouteEndpoint;
  travel?: Extract<SpatialInput<SpatialTravelSpec>, { kind: 'orbitTransfer' }>;
  arrivalAction?: SpatialInput<SpatialArrivalAction> | null;
  referencePose?: SpatialInput<SpatialPose>;
  source?: SpatialSourceRef;
}): SpatialRoute | null;
export function buildSpatialOrbitalInsertRoute(input: {
  space: SpatialCoordinateSpace;
  from: SpatialInput<SpatialRouteEndpointSpec> | SpatialRouteEndpoint;
  orbit: SpatialInput<SpatialOrbitSpec>;
  destination?: SpatialInput<SpatialDestinationSpec>;
  travel?: Extract<SpatialInput<SpatialTravelSpec>, { kind: 'orbitalInsert' }>;
  referencePose?: SpatialInput<SpatialPose>;
  source?: SpatialSourceRef;
}): SpatialRoute | null;
export function getSpatialRouteDiagnostics(route: SpatialRoute): SpatialRouteDiagnostics & SpatialCoordinateContext;
export function evaluateSpatialRoute(
  route: SpatialRoute,
  elapsedSecs: number,
  options?: SpatialRouteEvaluationOptions
): SpatialRouteSample;
export function sampleSpatialRoute(route: SpatialRoute, options?: SpatialRouteSamplingOptions): SpatialRouteSample[];

export type SpatialArrivalAction =
  (| { kind: 'none' }
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
    }) & SpatialCoordinateContext;

export function normalizeSpatialArrivalAction(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialArrivalAction;

export interface SpatialAimTrack {
  space: SpatialCoordinateSpace;
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
      position: SpatialVector3;
      fallbackUp?: SpatialVector3;
      syntheticTargetDistance?: number;
    }
  | {
      positionSample: SpatialPathSample;
      fallbackUp?: SpatialVector3;
      syntheticTargetDistance?: number;
    };

export interface BuildSpatialAimTrackOptions {
  space: SpatialCoordinateSpace;
  durationSecs?: number;
  defaultInterpolation?: SpatialAimInterpolationSpec;
  duplicateTimePolicy?: SpatialDuplicateTimePolicy;
}

export interface SpatialPathSpec {
  space: SpatialCoordinateSpace;
  durationSecs?: number;
  positionKeys: SpatialPositionKey[];
  aimKeys?: SpatialAimKey[];
  timeRemap?: SpatialTimeRemapSpec | null;
  duplicateTimePolicy?: SpatialDuplicateTimePolicy;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialPositionKey {
  space?: SpatialCoordinateSpace;
  id: string;
  timeSecs: number;
  position: SpatialVector3;
  interpolation?: SpatialPositionInterpolation;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export interface SpatialAimKey {
  space?: SpatialCoordinateSpace;
  id: string;
  timeSecs: number;
  aim: SpatialInput<SpatialAimSpec>;
  interpolation?: SpatialAimInterpolationSpec;
  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}

export type SpatialPositionInterpolation =
  | { kind: 'hold' }
  | { kind: 'linear'; easing?: SpatialEasingSpec }
  | { kind: 'catmullRom'; tension?: number; centripetal?: boolean }
  | { kind: 'cubicBezier'; inTangent?: SpatialVector3; outTangent?: SpatialVector3 }
  | { kind: 'hermite'; inVelocityUnitsPerSec?: SpatialVector3; outVelocityUnitsPerSec?: SpatialVector3 };

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
  space: SpatialCoordinateSpace;
  timeSecs: number;
  playbackElapsedSecs?: number;
  frameIndex?: number;
  pose: SpatialPose;
  aim: SpatialAimSample | null;
  velocityUnitsPerSec: SpatialVector3;
  speedUnitsPerSec: number;
  accelerationUnitsPerSec2?: SpatialVector3;
  accelerationMagnitudeUnitsPerSec2?: number;
  segmentIndex: number | null;
  segmentId?: string | null;
  diagnostics?: SpatialSampleDiagnostics;
}

export interface SpatialPathEvaluationOptions {
  space?: SpatialCoordinateSpace;
  frameIndex?: number;
  syntheticTargetDistance?: number;
}

export interface SpatialPathSamplingOptions extends SpatialPathEvaluationOptions, SpatialSamplingOptions {
  space?: SpatialCoordinateSpace;}
export interface SpatialPathPlaybackEvaluationOptions extends SpatialPathEvaluationOptions {}

export interface SpatialPathDiagnostics {
  durationSecs: number;
  playbackDurationSecs?: number;
  duplicateTimePolicy: SpatialDuplicateTimePolicy;
  timeRemap?: SpatialTimeRemapSpec | null;
  warnings: SpatialDiagnosticWarning[];
}

export function buildSpatialAimTrack(
  keys: Iterable<SpatialAimKey> | undefined,
  options: BuildSpatialAimTrackOptions
): SpatialAimTrack;
export function evaluateSpatialAimTrack(
  track: SpatialAimTrack,
  timeSecs: number,
  context: SpatialAimEvaluationContext
): SpatialAimTrackSample;
export function normalizeSpatialPathSpec(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialPathSpec;
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
  space?: SpatialCoordinateSpace;
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
  space: SpatialCoordinateSpace;
  kind: 'viewTransitionPath';
  durationSecs: number;
  path: SpatialPathSpec;
  from: SpatialFrameState;
  to: SpatialFrameState;
  diagnostics: SpatialViewTransitionDiagnostics;
}

export interface SpatialViewTransitionSample {
  space: SpatialCoordinateSpace;
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
  space?: SpatialCoordinateSpace;
  from: SpatialInput<SpatialPose>;
  to: SpatialInput<SpatialPose>;
  durationSecs?: number;
  movement?: SpatialTransitionLaneSpec;
  orientation?: SpatialTransitionLaneSpec;
}

export interface SpatialPoseTransition {
  space: SpatialCoordinateSpace;
  durationSecs: number;
  from: SpatialPose;
  to: SpatialPose;
  movement?: SpatialTransitionLaneSpec;
  orientation?: SpatialTransitionLaneSpec;
}

export interface SpatialPoseTransitionSample {
  space: SpatialCoordinateSpace;
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
  (| {
      kind: 'pathVolume';
      points: SpatialVector3[];
      radius: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    }
  | {
      kind: 'sphereVolume';
      center: SpatialVector3;
      radius: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    }
  | {
      kind: 'viewLookahead';
      pose: SpatialPose;
      velocityUnitsPerSec: SpatialVector3;
      lookaheadSecs: number;
      timeRangeSecs?: [number, number];
      priority?: number;
    }) & SpatialCoordinateContext;

export interface MaterializeSpatialPreloadHintsOptions extends SpatialPathSamplingOptions {
  pathRadius?: number;
  sphereRadius?: number;
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
  pose: SpatialInput<SpatialPose>;
  controls?: SpatialControlReader;
  deltaSecs: number;
  scale?: SpatialScaleProfile;
}

export function normalizeSpatialUpdateDelta(input: { deltaSecs: number }): number;

export interface SpatialMotionSnapshot {
  space: SpatialCoordinateSpace;
  kind: string;
  velocityUnitsPerSec: SpatialVector3;
  speedUnitsPerSec: number;
  scale: Required<SpatialScaleProfile>;
  activeAutomation: string | null;
}

export interface SpatialMotionModel {
  update(input: SpatialMotionUpdateInput): SpatialPose;
  getSnapshot(): SpatialMotionSnapshot;
  dispose?(): void;
}

export interface SpatialManualMotionOptions {
  space: SpatialCoordinateSpace;
  moveAxis?: string;
  attitudeAxis?: string;
  rollModifierButton?: string;
  boostButton?: string;
  moveSpeedUnitsPerSec?: number;
  boostMultiplier?: number;
  pitchRateRadPerSec?: number;
  yawRateRadPerSec?: number;
  rollRateRadPerSec?: number;
}

export interface SpatialInertialMotionOptions extends SpatialManualMotionOptions {
  accelerationUnitsPerSec2?: number;
  damping?: number;
  maxSpeedUnitsPerSec?: number;
}

export interface SpatialThrustMotionOptions extends SpatialManualMotionOptions {
  thrustUnitsPerSec2?: number;
  mass?: number;
  drag?: number;
  maxSpeedUnitsPerSec?: number;
}

export function createDirectSpatialMotionModel(options: SpatialManualMotionOptions): SpatialMotionModel;
export function createInertialSpatialMotionModel(options: SpatialInertialMotionOptions): SpatialMotionModel;
export function createThrustSpatialMotionModel(options: SpatialThrustMotionOptions): SpatialMotionModel;

export interface SpatialNavigationAutomation {
  flyRoute(route: SpatialRoute): void;
  orbit(orbit: SpatialInput<SpatialOrbitSpec>): void;
  lookAt(aim: SpatialInput<SpatialAimSpec>): void;
  lockAt(aim: SpatialInput<Extract<SpatialAimSpec, { kind: 'target' }>>): void;
  unlockAt(): void;
  cancelMovement(): void;
  cancelOrientation(): void;
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
  space: SpatialCoordinateSpace;
  activeMovement?: SpatialMovementDiagnostics | null;
  activeAim?: SpatialAimDiagnostics | null;
  elapsedSecs: number;
  durationSecs?: number;
  frameState: SpatialFrameState;
  activeRoute?: SpatialRoute | null;
  activeTiming?: SpatialTimingProfile | null;
  currentSpeedUnitsPerSec: number;
  arrivalAction?: SpatialArrivalAction | null;
  pendingSettle?: SpatialSettleDiagnostics | null;
  warnings: SpatialDiagnosticWarning[];
}

export interface SpatialMovementDiagnostics {
  kind: SpatialRouteKind | 'orbit' | 'manual' | 'idle';
  route?: SpatialRoute | null;
  orbit?: SpatialOrbitState | null;
  distance?: number;
  totalLength?: number;
  speedUnitsPerSec?: number;
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

export function createSpatialNavigationAutomation(space: SpatialCoordinateSpace): SpatialNavigationAutomation;

export const SPATIAL_METERS_PER_AU: number;
export const SPATIAL_METERS_PER_PARSEC: number;
export const SPATIAL_Z_UP_TO_Y_UP: Readonly<SpatialQuaternion>;
export function normalizeSpatialCoordinateSpace(input: unknown, inheritedSpace?: SpatialCoordinateSpace): SpatialCoordinateSpace;
export function crossSpatialVectors(a: SpatialVector3, b: SpatialVector3): SpatialVector3;
export function dotSpatialVectors(a: SpatialVector3, b: SpatialVector3): number;
export function invertSpatialQuaternion(input: SpatialQuaternion): SpatialQuaternion;
export function interpolateSpatialQuaternions(a: SpatialQuaternion, b: SpatialQuaternion, t: number): SpatialQuaternion;
export function interpolateSpatialDirections(a: SpatialVector3, b: SpatialVector3, t: number, options?: { antipodalTangent?: SpatialVector3; antipodalCosineThreshold?: number }): SpatialVector3;
export function createSpatialQuaternionFromForwardUp(forward: SpatialVector3, up: SpatialVector3): SpatialQuaternion;

export interface SpatialTransform {
  from: SpatialCoordinateSpace;
  to: SpatialCoordinateSpace;
  sourceOrigin?: SpatialVector3;
  targetOrigin?: SpatialVector3;
  rotation?: SpatialQuaternion;
}
export interface NormalizedSpatialTransform extends SpatialTransform {
  sourceOrigin: SpatialVector3;
  targetOrigin: SpatialVector3;
  rotation: SpatialQuaternion;
}
export function normalizeSpatialTransform(input: SpatialTransform): NormalizedSpatialTransform;
export function transformSpatialPoint(transform: SpatialTransform, point: SpatialVector3): SpatialVector3;
export function transformSpatialDisplacement(transform: SpatialTransform, displacement: SpatialVector3): SpatialVector3;
export function transformSpatialDirection(transform: SpatialTransform, direction: SpatialVector3): SpatialVector3;
export function transformSpatialOrientation(transform: SpatialTransform, orientation: SpatialQuaternion): SpatialQuaternion;
export function transformSpatialPose(transform: SpatialTransform, pose: SpatialPose): SpatialPose;
export function invertSpatialTransform(transform: SpatialTransform): NormalizedSpatialTransform;
export function composeSpatialTransforms(first: SpatialTransform, second: SpatialTransform): NormalizedSpatialTransform;
