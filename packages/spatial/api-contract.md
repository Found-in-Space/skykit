# Spatial API Contract

Status: target contract for the breaking spatial API rewrite.

This document is the implementation target for the next `@found-in-space/spatial`
shape. It is intentionally smaller and stricter than `plan.md`. The rewrite is a
breaking change: downstream SkyKit, website, examples, and Studio code must be
updated to the new contract. Do not add legacy shims, compatibility aliases, or
dual-path adapters inside `@found-in-space/spatial`.

## Purpose

`@found-in-space/spatial` is the dependency-free spatial semantics package. It
owns vector/quaternion math, scale profiles, coordinate conversion, target
resolution, aim, pose, path, orbit, route, timing, preload hint, motion, and
navigation math. It does not own renderers, DOM, WebXR sessions, Studio
documents, chapter orchestration, star identity, data loading, or UI editing
workflows.

The public API should be small enough to teach and support:

- plain data objects;
- pure normalize, build, derive, evaluate, and sample functions;
- one optional stateful navigation wrapper over the pure objects.

## Breaking Change Policy

This rewrite removes the old surface instead of preserving it.

- No deprecated exports.
- No input aliases for old field names.
- No runtime detection of old object shapes.
- No compatibility wrappers that translate old routes, poses, or waypoints.
- No hidden private imports from old module files as a supported path.
- Downstream packages and applications must be modified to canonical names.

Migration tables in this document are instructions for editing callers, not
accepted input formats.

All `normalize*` functions accept only the canonical target-contract shape. They
return a canonical object or throw for malformed input. Use `TypeError` for
invalid object shape and `RangeError` for invalid finite/range values. Builders
and evaluators may return `null` only where their contract explicitly allows an
impossible geometric result. Recoverable mathematical fallbacks must be reported
with diagnostics rather than by accepting legacy aliases.

### Validation And Defaults

Canonical APIs may still offer defaults for omitted optional input. Omitted
objects, `null`, `undefined`, and omitted optional fields may be filled with the
documented default. Explicit fallback parameters on low-level math normalizers
are used only for nullish input.

A non-null malformed object is not a defaulting case. Normalizers throw
`TypeError` for malformed canonical object shape and `RangeError` for
non-finite, negative, or otherwise out-of-range values. Builders and evaluators
return `null` only where the function contract explicitly names an impossible
geometric result.

## Public Surface

Use the package root as the public import path:

```ts
import {
  buildSpatialOrbitTransferRoute,
  createSpatialNavigationAutomation,
  evaluateSpatialPath,
  normalizeSpatialDestination,
} from '@found-in-space/spatial';
```

Internal folders may be split for maintainability, but they are not public API
unless a future document explicitly adds subpath exports. Keeping one public
surface is part of keeping the package small.

Function naming:

- `normalize*` validates and returns canonical objects.
- `build*` constructs routes or durable derived objects.
- `derive*` computes scalar or profile values.
- `evaluate*` samples a continuous spec at a time or angle.
- `sample*` materializes repeated samples.
- `get*` reads existing state or extracts diagnostics without mutating input.
- `create*` is reserved for stateful runtime wrappers and established reusable
  math objects such as orbit bases.

## Naming Conventions

Use explicit units for every public scalar and spatial point.

```ts
timeSecs
elapsedSecs
durationSecs
sampleStepSecs
settleSecs

observerPc
positionPc
centerPc
targetPc
syntheticTargetPc
radiusPc
distancePc
totalLengthPc
pointsPc

speedPcPerSec
averageSpeedPcPerSec
peakSpeedPcPerSec
departureSpeedPcPerSec
arrivalSpeedPcPerSec
velocityPcPerSec
accelerationPcPerSec2
decelerationPcPerSec2

angleRad
initialAngleRad
angularSpeedRadPerSec
curvatureRadPerPc
```

Use `kind` for discriminated unions. Use lower camel case discriminants:

```ts
'target'
'direction'
'orientation'
'orbitTransfer'
'orbitalInsert'
'catmullRom'
'cubicBezier'
```

Specs use authored names. Computed samples use mathematical names.

```ts
// Authored spec.
orbitNormal
referenceAxis

// Computed result.
normal
radial
tangent
```

## Removed Name Map

These old names must be edited downstream. Spatial should not accept them.

| Old name | Canonical name |
| --- | --- |
| `position` on camera pose | `observerPc` |
| `orientation` on camera pose | `orientationIcrs` |
| `center` | `centerPc` |
| `target` | `targetPc` for real target aim only |
| synthesized `target` | `syntheticTargetPc` |
| `radius` | `radiusPc` |
| `points` | `pointsPc` |
| `totalLength` | `totalLengthPc` |
| `speed` | `speedPcPerSec` |
| `departureSpeed` | `departureSpeedPcPerSec` |
| `arrivalSpeed` | `arrivalSpeedPcPerSec` |
| `angularSpeed` | `angularSpeedRadPerSec` |
| `initialAngle` | `initialAngleRad` |
| `normal` in authored orbit input | `orbitNormal` |

`normal` remains valid only as a computed basis/sample field.

## Core Objects

Keep vectors and quaternions as plain objects. Do not introduce classes.

```ts
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
```

`SpatialSourceRef` is opaque. Spatial preserves it but does not interpret Studio
groups, website chapters, or application-specific source kinds.

## Foundational Math, Coordinates, Targets, And Scale

The rewrite keeps dependency-free math and coordinate helpers public. These are
the primitives other packages use before they build aims, paths, routes, or
navigation automation.

```ts
export const SPATIAL_ZERO_VECTOR: SpatialVector3;
export const SPATIAL_LOCAL_FORWARD: SpatialVector3;
export const SPATIAL_LOCAL_RIGHT: SpatialVector3;
export const SPATIAL_LOCAL_UP: SpatialVector3;
export const SPATIAL_IDENTITY_QUATERNION: SpatialQuaternion;
export const DEFAULT_SPATIAL_SCALE_PROFILE: Required<SpatialScaleProfile>;

export function normalizeSpatialVector3(input: unknown, fallback?: SpatialVector3): SpatialVector3;
export function normalizeSpatialQuaternion(input: unknown, fallback?: SpatialQuaternion): SpatialQuaternion;
export function normalizeSpatialPose(input?: {
  observerPc?: unknown;
  orientationIcrs?: unknown;
}): SpatialPose;
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

export function multiplySpatialQuaternions(
  a: SpatialQuaternion,
  b: SpatialQuaternion,
): SpatialQuaternion;
export function createSpatialQuaternionFromAxisAngle(
  axis: SpatialVector3,
  angleRad: number,
): SpatialQuaternion;
export function applySpatialQuaternion(
  vector: SpatialVector3,
  quaternion: SpatialQuaternion,
): SpatialVector3;
export function rotateSpatialLocalAxis(
  orientationIcrs: SpatialQuaternion,
  localAxis: SpatialVector3,
  angleRad: number,
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
  observerPc?: SpatialVector3,
): { raDeg: number; raHours: number; decDeg: number } | null;
export function icrsDirectionToTargetPc(
  directionIcrs: SpatialVector3,
  distancePc: number,
  observerPc?: SpatialVector3,
): SpatialVector3 | null;
export function projectSpatialEquirectangular(input: {
  raDeg: number;
  decDeg: number;
  width: number;
  height: number;
}): { x: number; y: number };
```

Target resolution stays coordinate-only. Spatial does not resolve star objects or
interpret bookmark IDs itself.

```ts
export type SpatialTargetSpec =
  | {
      kind: 'position';
      targetPc: SpatialVector3;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'radec';
      raDeg?: number;
      raHours?: number;
      decDeg: number;
      distancePc: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'bookmark';
      id: string;
      source?: SpatialSourceRef;
    };

export interface ResolveSpatialTargetOptions {
  resolveBookmark?: (
    bookmarkId: string,
    input: Extract<SpatialTargetSpec, { kind: 'bookmark' }>,
  ) => SpatialTargetSpec | Promise<SpatialTargetSpec | null> | null;
}

export function normalizeSpatialTarget(input: unknown): SpatialTargetSpec;
export function resolveSpatialTarget(
  input: SpatialTargetSpec,
  options?: ResolveSpatialTargetOptions,
): SpatialVector3 | Promise<SpatialVector3 | null> | null;
```

## Aim

Aim is first-class. Do not infer target-lock or authored-target intent from a
quaternion.

```ts
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
```

Only target-authored aim returns `targetPc`. Direction and orientation previews
may return `syntheticTargetPc`, but never `targetPc`.

Recoverable aim fallbacks, such as degenerate target vectors, invalid up vectors,
or orientation fallback to identity, must be reported through
`SpatialSampleDiagnostics`.

```ts
export function normalizeSpatialAimSpec(input: unknown): SpatialAimSpec;
export function evaluateSpatialAim(input: {
  observerPc: SpatialVector3;
  aim: SpatialAimSpec;
  syntheticTargetDistancePc?: number;
}): SpatialAimSample;
```

## Frame State

Frame state is the shared evaluated camera state for Studio export, website
runtime diagnostics, and navigation handoff.

```ts
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
  aim: Extract<SpatialAimSample, { kind: 'target' }>;
  source?: SpatialSourceRef;
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
```

## Destinations

Destinations are shared authored targets for website chapters, examples, and
Studio. Canonical output contains `aim`, not `lookAtPc`.

```ts
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
```

Applications that currently store `lookAt`, `target`, `center`, or `radius`
must rewrite those documents before passing data into spatial.

## Orbits

Orbit specs are authored. Orbit basis and samples are computed.

```ts
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
  radialAxis: SpatialVector3;
  tangentAxis: SpatialVector3;
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
  angleRad: number,
): SpatialVector3;
export function evaluateSpatialOrbit(orbit: SpatialOrbitSpec, elapsedSecs: number): SpatialOrbitSample;
```

## Timing

Timing specs are authored timing intent. Timing profiles are derived timing
plans with phases and diagnostics. Route following, orbital insert, and path
sampling consume profiles, but callers author timing through specs unless they
already have a derived profile.

```ts
export type SpatialTimingSpec =
  | {
      kind: 'duration';
      durationSecs: number;
      minDurationSecs?: number;
      maxDurationSecs?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'constantSpeed';
      speedPcPerSec: number;
      durationSecs?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'trapezoid';
      departureSpeedPcPerSec?: number;
      cruiseSpeedPcPerSec?: number;
      arrivalSpeedPcPerSec?: number;
      accelerationPcPerSec2?: number;
      decelerationPcPerSec2?: number;
      durationSecs?: number;
      minDurationSecs?: number;
      maxDurationSecs?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'triangular';
      departureSpeedPcPerSec?: number;
      peakSpeedPcPerSec?: number;
      arrivalSpeedPcPerSec?: number;
      accelerationPcPerSec2?: number;
      decelerationPcPerSec2?: number;
      durationSecs?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'custom';
      durationSecs: number;
      phases: SpatialTimingPhase[];
      source?: SpatialSourceRef;
    };

export interface SpatialTimingProfile {
  kind: 'duration' | 'constantSpeed' | 'trapezoid' | 'triangular' | 'custom';
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

export interface SpatialTimingPhase {
  kind: 'accelerate' | 'cruise' | 'decelerate' | 'blend' | 'hold';
  startTimeSecs: number;
  endTimeSecs: number;
  startDistancePc: number;
  endDistancePc: number;
  startSpeedPcPerSec: number;
  endSpeedPcPerSec: number;
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
```

## Travel

Travel specs are reusable authored motion intent for route builders and runtime
navigation. They keep sampling and timing policy out of ad hoc option bags.

```ts
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
```

Fixed-duration travel uses `timing: { kind: 'duration', durationSecs }`. Travel
variants do not expose standalone `durationSecs` fields. If duration conflicts
with acceleration or deceleration, the derived profile reports the decision in
diagnostics.

## Routes

Routes return geometry, timing, endpoints, arrival action, and diagnostics
together. A route without timing and diagnostics is not a public route object.

```ts
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

export interface SpatialRouteEndpoint {
  positionPc: SpatialVector3;
  velocityPcPerSec?: SpatialVector3;
  speedPcPerSec?: number;
  orbit?: SpatialOrbitSpec;
  orbitBasis?: SpatialOrbitBasis;
  aim?: SpatialAimSpec;
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
  candidateCost?: number;
  candidateRank?: number;
  selectedOrbitNormal?: SpatialVector3;
  selectedRadial?: SpatialVector3;
  selectedTangent?: SpatialVector3;
  centerPenalty?: number;
  smoothnessPenalty?: number;
  curvaturePenalty?: number;
  arrivalPenalty?: number;
  warnings: SpatialDiagnosticWarning[];
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

export interface SpatialRouteSamplingOptions extends SpatialRouteEvaluationOptions {
  stepSecs?: number;
  frameRate?: number;
}

export function buildSpatialPolylineRoute(input: {
  pointsPc: Iterable<SpatialVector3>;
  travel?: Extract<SpatialTravelSpec, { kind: 'polyline' }>;
  source?: SpatialSourceRef;
}): SpatialRoute;

export function buildSpatialOrbitTransferRoute(input: {
  from: SpatialRouteEndpoint;
  to: SpatialRouteEndpoint;
  travel?: Extract<SpatialTravelSpec, { kind: 'orbitTransfer' }>;
  source?: SpatialSourceRef;
}): SpatialRoute | null;

export function buildSpatialOrbitalInsertRoute(input: {
  from: SpatialRouteEndpoint;
  orbit: SpatialOrbitSpec;
  travel?: Extract<SpatialTravelSpec, { kind: 'orbitalInsert' }>;
  source?: SpatialSourceRef;
}): SpatialRoute | null;

export function getSpatialRouteDiagnostics(route: SpatialRoute): SpatialRouteDiagnostics;
export function evaluateSpatialRoute(
  route: SpatialRoute,
  elapsedSecs: number,
  options?: SpatialRouteEvaluationOptions,
): SpatialRouteSample;
export function sampleSpatialRoute(
  route: SpatialRoute,
  options?: SpatialRouteSamplingOptions,
): SpatialRouteSample[];
```

Route samples are movement-only. They do not synthesize camera aim or
orientation. Navigation and path APIs combine route movement with aim when a
camera pose is required.

## Arrival Actions

Arrival actions are canonical objects, not ad hoc option bags.

```ts
export type SpatialArrivalAction =
  | { kind: 'none' }
  | { kind: 'orbit'; orbit: SpatialOrbitSpec; settleSecs?: number; preserveAim?: boolean }
  | { kind: 'orbitalInsert'; orbit: SpatialOrbitSpec; timing?: SpatialTimingProfile }
  | { kind: 'lookAt'; aim: SpatialAimSpec; dwellSecs?: number }
  | { kind: 'lockAt'; aim: Extract<SpatialAimSpec, { kind: 'target' }>; dwellSecs?: number };

export function normalizeSpatialArrivalAction(input: unknown): SpatialArrivalAction;
```

The normalizer validates canonical arrival actions. It must not accept old
`{ type, center, radius, normal }` actions.

## Paths

Paths evaluate authored camera tracks. Position, aim, and timing interpolation
are separate.

Standalone aim tracks are intentionally not public in this contract. Public aim
interpolation is represented by `SpatialPathSpec.aimKeys`.

```ts
export interface SpatialPathSpec {
  durationSecs?: number;
  positionKeys: SpatialPositionKey[];
  aimKeys: SpatialAimKey[];
  timing?: SpatialTimingSpec | SpatialTimingProfile | SpatialEasingSpec;
  duplicateTimePolicy: 'error' | 'coalesceFirst' | 'coalesceLast' | 'hold' | 'cut' | 'preserve';
  source?: SpatialSourceRef;
}

export interface SpatialPositionKey {
  id: string;
  timeSecs: number;
  positionPc: SpatialVector3;
  interpolation?: SpatialPositionInterpolation;
  source?: SpatialSourceRef;
}

export interface SpatialAimKey {
  id: string;
  timeSecs: number;
  aim: SpatialAimSpec;
  interpolation?: SpatialAimInterpolation;
  source?: SpatialSourceRef;
}

export type SpatialPositionInterpolation =
  | { kind: 'hold' }
  | { kind: 'linear' }
  | { kind: 'catmullRom'; tension?: number; centripetal?: boolean }
  | { kind: 'cubicBezier'; inTangentPc?: SpatialVector3; outTangentPc?: SpatialVector3 }
  | { kind: 'hermite'; inVelocityPcPerSec?: SpatialVector3; outVelocityPcPerSec?: SpatialVector3 };

export type SpatialAimInterpolation =
  | { kind: 'hold' }
  | { kind: 'slerp'; easing?: SpatialEasingSpec }
  | { kind: 'lookAtTarget'; easing?: SpatialEasingSpec }
  | { kind: 'squad'; easing?: SpatialEasingSpec };

export type SpatialEasingSpec =
  | { kind: 'linear' }
  | { kind: 'smoothstep' }
  | { kind: 'easeIn'; power?: number }
  | { kind: 'easeOut'; power?: number }
  | { kind: 'easeInOut'; power?: number }
  | { kind: 'cubicBezier'; x1: number; y1: number; x2: number; y2: number };

export interface SpatialPathSample {
  timeSecs: number;
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

export interface SpatialPathSamplingOptions extends SpatialPathEvaluationOptions {
  stepSecs?: number;
  frameRate?: number;
}

export interface SpatialPathDiagnostics {
  durationSecs: number;
  duplicateTimePolicy: SpatialPathSpec['duplicateTimePolicy'];
  warnings: SpatialDiagnosticWarning[];
}

export function normalizeSpatialPathSpec(input: unknown): SpatialPathSpec;
export function evaluateSpatialPath(
  path: SpatialPathSpec,
  timeSecs: number,
  options?: SpatialPathEvaluationOptions,
): SpatialPathSample;
export function sampleSpatialPath(
  path: SpatialPathSpec,
  options?: SpatialPathSamplingOptions,
): SpatialPathSample[];
export function sampleSpatialPathDiagnostics(
  path: SpatialPathSpec,
  options?: SpatialPathSamplingOptions,
): SpatialPathDiagnostics;
```

Duplicate-time keys are invalid unless the caller explicitly chooses a
`duplicateTimePolicy`. Do not silently fall back to the first key.

## Preload Hints

Preload hints are dependency-free spatial volumes derived from evaluated paths.
Applications decide how aggressively to fetch data; spatial only materializes the
geometry and time windows.

```ts
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
  options?: MaterializeSpatialPreloadHintsOptions,
): SpatialPreloadHint[];
```

## Manual Motion Models

Low-level motion models remain dependency-free and input-agnostic. They are for
manual ship/camera motion. Automated fly-to, route-follow, orbit, and insert
behavior should use canonical routes, orbits, timings, and the navigation
wrapper instead of legacy command-shaped methods.

```ts
export interface SpatialControlReader {
  getAxis?(name: string): { x: number; y: number; magnitude: number; active: boolean };
  getButton?(name: string): { pressed: boolean; value: number };
  isPressed?(name: string): boolean;
}

export interface SpatialMotionUpdateInput {
  pose: SpatialPose;
  controls?: SpatialControlReader;
  deltaSeconds: number;
  scale?: SpatialScaleProfile;
  manualLookActive?: boolean;
}

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
```

## Navigation Wrapper

Runtime navigation remains useful, but it must sit on top of the canonical
objects. It should not contain separate private route, orbit, or timing math.

```ts
export interface SpatialNavigationAutomation {
  flyRoute(route: SpatialRoute): void;
  orbit(orbit: SpatialOrbitSpec): void;
  lookAt(aim: SpatialAimSpec): void;
  lockAt(aim: Extract<SpatialAimSpec, { kind: 'target' }>): void;
  unlockAt(): void;
  cancel(): void;
  update(input: {
    pose: SpatialPose;
    deltaSeconds: number;
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
```

The old command-style methods such as `flyTo(center, options)`,
`flyPolyline(points, options)`, and `orbitalInsert(center, options)` should be
removed from spatial. Callers should build canonical routes or specs first, then
give those objects to navigation.

## Implementation Rules

Before the rewrite is considered complete:

- `src/index.d.ts` must define only the canonical public contract.
- `src/index.js` must export only canonical names.
- Tests must cover target-preserving aim samples, route diagnostics, orbit basis
  sampling, orbital-insert timing, and duplicate-time path policy.
- Tests should assert that removed legacy field names are not part of normalized
  output.
- SkyKit, examples, docs, and Studio-facing call sites must be updated instead
  of relying on compatibility code.
- Release notes must clearly state that this is a breaking alpha API reset.
