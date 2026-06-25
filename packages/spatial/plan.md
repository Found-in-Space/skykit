Can you review 
GitHub
 git@github.com:Found-in-Space/skykit.git this branch: feature/layer-hosts-and-products In particular the 'spatial' sub-project. We have some review findings: Findings High: authored aim target is lost during smooth-path evaluation. Studio frame state requires camera target, target lock, orbit, and path-follow state ([architecture.md (line 525)](/Users/kws/work/fis/skykit-studio/docs/architecture.md:525)). Spatial accepts target orientation waypoints ([index.d.ts (line 109)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:109)), but SpatialOrientationTrackSample only returns quaternion/forward/up ([index.d.ts (line 156)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:156)). evaluateSpatialSmoothPath() then synthesizes target = position + forward * targetDistance ([smooth-paths.js (line 218)](/Users/kws/work/fis/skykit/packages/spatial/src/smooth-paths.js:218)). Impact: Studio cannot preserve “look at this authored target” versus “face this direction,” so export metadata and target-lock semantics become lossy. Spatial should return target, kind, and probably source waypoint/group metadata when the orientation came from a target. High: buildSpatialOrbitalInsertRoute() is implemented but not public. The function exists ([navigation.js (line 130)](/Users/kws/work/fis/skykit/packages/spatial/src/navigation.js:130)), and the README claims spatial owns orbital-insert routes ([README.md (line 13)](/Users/kws/work/fis/skykit/packages/spatial/README.md:13)). But root exports omit it ([index.js (line 42)](/Users/kws/work/fis/skykit/packages/spatial/src/index.js:42)), and the declarations expose createOrbitTransferRoute() but not the insert builder ([index.d.ts (line 588)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:588)). The package only exports "." ([package.json (line 17)](/Users/kws/work/fis/skykit/packages/spatial/package.json:17)), so consumers cannot safely import the module directly. Recommendation: export and declare buildSpatialOrbitalInsertRoute(). High: orbital insert deceleration is not actually an authored timing control. SpatialOrbitalInsertOptions inherits deceleration ([index.d.ts (line 319)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:319)), but beginOrbitalInsert() derives or passes a fixed durationSecs ([navigation.js (line 631)](/Users/kws/work/fis/skykit/packages/spatial/src/navigation.js:631)). Once durationSecs exists, updateFlyPolyline() uses duration interpolation and bypasses acceleration/deceleration stepping ([navigation.js (line 794)](/Users/kws/work/fis/skykit/packages/spatial/src/navigation.js:794)). Impact: the requested “travel speed to orbital speed” behavior cannot be controlled through deceleration in a predictable way. Spatial should expose a pure timing/profile helper, e.g. deriveSpatialOrbitalInsertTiming({ distance, currentSpeed, approachSpeed, orbitalSpeed, deceleration }), and route builders should return the derived profile. Medium: route diagnostics required by Studio are mostly discarded. Studio explicitly needs route length, duration, average speed, peak speed, arrival speed, and settle behavior ([functionality.md (line 115)](/Users/kws/work/fis/skykit-studio/docs/functionality.md:115)). SpatialOrbitTransferRoute returns only points and endpoint speeds ([index.d.ts (line 365)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:365)). Internally, spatial computes useful scoring terms such as length, center penalty, smoothness, curvature, and arrival penalty ([navigation.js (line 1392)](/Users/kws/work/fis/skykit/packages/spatial/src/navigation.js:1392)), but they are not returned. Recommendation: add diagnostics to route results: durationSecs, totalLength, averageSpeed, peakSpeed, departureSpeed, arrivalSpeed, settleSecs, selected orbit normal/radial, and candidate cost. Medium: orbit basis and orbit sampling are private, but Studio and website both need them. The shared architecture says spatial should own orbit basis, angle, normal, tangent, and arrival-action helpers ([chapter-and-camera-timeline-architecture.md (line 353)](/Users/kws/work/fis/skykit/docs/chapter-and-camera-timeline-architecture.md:353)). Public API exposes only deriveSpatialOrbitAngle() ([index.d.ts (line 590)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:590)). The actual basis and position helpers are private ([navigation.js (line 1647)](/Users/kws/work/fis/skykit/packages/spatial/src/navigation.js:1647), [navigation.js (line 1671)](/Users/kws/work/fis/skykit/packages/spatial/src/navigation.js:1671)). Recommendation: expose createSpatialOrbitBasis(), sampleSpatialOrbitPosition(), and maybe evaluateSpatialOrbit(). Add referenceAxis to SpatialOrbitOptions; currently only SpatialOrbitAngleInput has it ([index.d.ts (line 265)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:265)). Medium: orbit option names are inconsistent across APIs and docs. Shared destination presets use centerPc, radiusPc, orbitNormal, angularSpeedRadPerSec ([chapter-and-camera-timeline-architecture.md (line 75)](/Users/kws/work/fis/skykit/docs/chapter-and-camera-timeline-architecture.md:75)). Runtime SpatialOrbitOptions uses radius, angularSpeed, orbitNormal ([index.d.ts (line 272)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:272)). Arrival actions use angularSpeedRadPerSec and normal ([index.d.ts (line 289)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:289)). Recommendation: add normalizers such as normalizeSpatialOrbitSpec() / normalizeSpatialDestination() that accept both authored names and runtime aliases, then return one canonical shape. Medium-low: interpolation API is not yet Studio-grade. Studio wants hold, linear, ease in/out, Bezier tangents, separated spatial/timing interpolation, and velocity/acceleration diagnostics ([functionality.md (line 293)](/Users/kws/work/fis/skykit-studio/docs/functionality.md:293)). Spatial currently exposes only samplesPerSegment for positions and useLinearInterpolation for orientations ([index.d.ts (line 163)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:163)); orientation interpolation is linear or smoothstep slerp only ([smooth-paths.js (line 167)](/Users/kws/work/fis/skykit/packages/spatial/src/smooth-paths.js:167)). Studio should still own editor retiming commands, but spatial should provide lower-level interpolation primitives and derivative/diagnostic sampling. Low: navigation snapshots are useful for runtime UI, not enough for editor/debug tooling. SpatialAutomationSummary has only basic fields ([index.d.ts (line 489)](/Users/kws/work/fis/skykit/packages/spatial/src/index.d.ts:489)), and serialization omits elapsed time, duration, current speed, arrival speed, arrival action, and profile data ([navigation.js (line 2003)](/Users/kws/work/fis/skykit/packages/spatial/src/navigation.js:2003)). Recommendation: expand snapshots or add getSpatialNavigationDiagnostics(). Low risk: duplicate-time position keys can sample the first waypoint unexpectedly. Zero-duration segments are possible after sorted waypoints ([smooth-paths.js (line 72)](/Users/kws/work/fis/skykit/packages/spatial/src/smooth-paths.js:72)), and evaluation falls back to the first waypoint when the selected segment duration is zero ([smooth-paths.js (line 110)](/Users/kws/work/fis/skykit/packages/spatial/src/smooth-paths.js:110)). If Studio uses generated helper keys at the same timestamp, this needs explicit coalescing or tests. Boundary Recommendation Put pure route/orbit math in @found-in-space/spatial: destination/orbit normalization, orbit basis/sampling, route construction, orbital insert timing, route diagnostics, and target-preserving path samples. Keep Studio-specific pieces local: visual editor commands, generated key groups, rebuild/delete workflows, timeline document normalization, export metadata assembly, and retiming UI. What I'm particularly interested in are what common API objects, shapes, names etc should we use for this project. I would like you to review the spatial codebase and then make recommendations for overal architecture and designb uninhibited by the current implementation. I'm interested in what the package SHOULD look like, not what it currently looks like.

 ---

I broadly agree with the findings, but I would treat them as symptoms of a larger API-design problem: `@found-in-space/spatial` needs a canonical camera/route contract, not just more exported helpers. The package should become the shared, dependency-free **spatial intent and evaluation kernel** for SkyKit website experiences and Studio. Studio should not have to infer whether a sample meant “look at this object” or “face this direction”; website chapter code should not have to duplicate orbit basis or route diagnostics; runtime navigation should consume the same pure route/timing objects that Studio compiles into frame-indexed tracks.

I reviewed the branch through the public GitHub source/docs. I did not run the test suite locally, so this is an API/architecture review rather than a green-build patch review.

## Current direction is right, but the public contract is too runtime-shaped

The README already says `@found-in-space/spatial` is renderer-neutral and can be used from Canvas, Three.js, WebXR, Node scripts, and future journeys without pulling in SkyKit or Three.js. It also says the package owns vector/quaternion/pose helpers, target resolution, polyline routes, orbit/orbital-insert routes, smooth path sampling, timed tracks, preload hints, and navigation motion models. ([GitHub][1]) That is the right ownership boundary.

The shared chapter/camera architecture doc says the same thing more explicitly: `@found-in-space/spatial` owns dependency-free path, orbit, route, pose, target, and navigation math, while SkyKit, website pages, and Studio own orchestration/editor/runtime concerns. ([GitHub][2]) It also says reusable motion math belongs in `spatial`, including orbit basis/angle/normal/tangent helpers, route construction/sampling, orbit-transfer generation, orbital-insert generation, smooth pose/path evaluation, deterministic samples, and preload hints. ([GitHub][2])

The gap is that the current public API is shaped like a runtime helper library, not a shared authoring/evaluation schema. For example, the declarations accept `SpatialTimedOrientationWaypoint` values of kind `direction`, `target`, or `quaternion`, but `SpatialOrientationTrackSample` returns only `orientation`, `forward`, and `up`. The smooth-path sample has a `target`, but the evaluator synthesizes it from `position + forward * targetDistance`, which loses whether the source was an authored target or just a direction. ([GitHub][3]) ([GitHub][4]) That is exactly the wrong failure mode for Studio.

My recommendation: make `spatial`’s central abstraction:

> **authored intent → normalized spatial spec → pure evaluated samples → diagnostics → optional runtime automation wrapper**

The runtime automation layer should be a consumer of the pure route/orbit/path APIs, not the place where route semantics are hidden.

---

# 1. Canonical naming rules

Use one canonical shape for authored/project data and allow short runtime aliases only at normalization boundaries.

The shared architecture doc already gives the best naming baseline: prefer `centerPc`, `targetPc`, `lookAt`, `radiusPc`, `orbitNormal`, and `angularSpeedRadPerSec` in authored data; accept runtime aliases like `center`, `normal`, `radius`, and `angularSpeed` only at action boundaries. ([GitHub][2]) I would make that formal.

## Canonical units

Use explicit unit suffixes everywhere a scalar crosses an API boundary:

```ts
durationSecs
elapsedSecs
timeSecs
sampleStepSecs
settleSecs

radiusPc
distancePc
totalLengthPc
observerPc
centerPc
targetPc
lookAtPc
pointsPc

speedPcPerSec
averageSpeedPcPerSec
peakSpeedPcPerSec
departureSpeedPcPerSec
arrivalSpeedPcPerSec
approachSpeedPcPerSec
orbitalSpeedPcPerSec

accelerationPcPerSec2
decelerationPcPerSec2

angleRad
initialAngleRad
angularSpeedRadPerSec
curvatureRadPerPc
```

Avoid bare `speed`, `radius`, `center`, `target`, `normal`, and `angularSpeed` in canonical outputs. Keep them as accepted input aliases for compatibility.

## Canonical authored names versus computed names

Use authored names in specs:

```ts
centerPc
radiusPc
orbitNormal
referenceAxis
angularSpeedRadPerSec
lookAtPc
targetPc
```

Use mathematical names in computed basis/results:

```ts
normal
radial
tangent
binormal
angleRad
positionPc
velocityPcPerSec
```

That distinction is valuable: `orbitNormal` is what the author asked for; `basis.normal` is what the math actually used after fallback/orthonormalization.

---

# 2. Core common objects

These should be the stable vocabulary used by Studio, website chapter helpers, SkyKit runtime actions, and tests.

## `SpatialVector3` and `SpatialQuaternion`

Keep the existing plain-object vector/quaternion shapes. They are dependency-free and already match the package’s renderer-neutral promise. ([GitHub][5])

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
```

Do not introduce classes. They will leak allocation/lifecycle semantics into website and Studio code.

## `SpatialPose`

Keep this as the low-level evaluated pose:

```ts
export interface SpatialPose {
  position: SpatialVector3;
  orientation: SpatialQuaternion;
}
```

But do not make `SpatialPose` carry authored aim/target/lock semantics. Pose is purely evaluated geometry.

## `SpatialFrameState`

Studio needs more than pose. Define an explicit frame state that preserves runtime/editor camera semantics:

```ts
export interface SpatialFrameState {
  timeSecs?: number;
  frameIndex?: number;

  observerPc: SpatialVector3;
  orientationIcrs: SpatialQuaternion;

  /**
   * Preserved camera intent.
   * This is not derivable from orientation alone.
   */
  aim: SpatialAimSample | null;

  /**
   * Current target-lock state, if any.
   */
  targetLock?: SpatialTargetLockState | null;

  /**
   * Current orbit state, if any.
   */
  orbit?: SpatialOrbitState | null;

  /**
   * Current route/path-follow state, if any.
   */
  pathFollow?: SpatialPathFollowState | null;

  fovDeg?: number;
}
```

Studio can store/evaluate/export `SpatialFrameState`. Runtime viewers can still project it down to renderer camera pose.

---

# 3. Aim should be first-class, not derived

This is the highest-priority API fix.

The current declarations already acknowledge three orientation waypoint kinds: `direction`, `target`, and `quaternion`. ([GitHub][3]) The evaluator should preserve that distinction all the way to samples and diagnostics.

## Proposed aim model

Use `aim`, not `orientation`, for authored intent. Keep `orientationIcrs` for evaluated camera orientation.

```ts
export type SpatialAimSpec =
  | SpatialTargetAimSpec
  | SpatialDirectionAimSpec
  | SpatialOrientationAimSpec;

export interface SpatialTargetAimSpec {
  kind: 'target';
  targetPc: SpatialVector3;
  up?: SpatialVector3;
  positionAngleDeg?: number;
  lock?: boolean;
  source?: SpatialSourceRef;
}

export interface SpatialDirectionAimSpec {
  kind: 'direction';
  forward: SpatialVector3;
  up?: SpatialVector3;
  positionAngleDeg?: number;
  source?: SpatialSourceRef;
}

export interface SpatialOrientationAimSpec {
  kind: 'orientation';
  orientationIcrs: SpatialQuaternion;
  source?: SpatialSourceRef;
}
```

## Evaluated aim sample

```ts
export type SpatialAimSample =
  | {
      kind: 'target';
      targetPc: SpatialVector3;
      forward: SpatialVector3;
      up: SpatialVector3;
      orientationIcrs: SpatialQuaternion;
      distancePc: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'direction';
      forward: SpatialVector3;
      up: SpatialVector3;
      orientationIcrs: SpatialQuaternion;
      syntheticTargetPc?: SpatialVector3;
      syntheticTargetDistancePc?: number;
      source?: SpatialSourceRef;
    }
  | {
      kind: 'orientation';
      orientationIcrs: SpatialQuaternion;
      forward: SpatialVector3;
      up: SpatialVector3;
      syntheticTargetPc?: SpatialVector3;
      syntheticTargetDistancePc?: number;
      source?: SpatialSourceRef;
    };
```

The important bit: `targetPc` exists only when the aim is actually target-authored. A synthesized target should be explicitly named `syntheticTargetPc`.

## Waypoint/group metadata

Studio needs source lineage. Add a tiny generic source ref:

```ts
export interface SpatialSourceRef {
  id?: string;
  kind?: string;        // 'waypoint' | 'group' | 'destination' | 'shot' | app-owned string
  label?: string;
  groupId?: string;
  index?: number;
  metadata?: Record<string, unknown>;
}
```

Do not make `spatial` understand Studio timeline groups. It should just preserve opaque source metadata.

## Smooth path sample

Replace the current target-erasing sample with:

```ts
export interface SpatialPathSample {
  timeSecs: number;
  frameIndex?: number;

  pose: SpatialPose;
  observerPc: SpatialVector3;
  orientationIcrs: SpatialQuaternion;

  aim: SpatialAimSample | null;

  velocityPcPerSec: SpatialVector3;
  speedPcPerSec: number;
  accelerationPcPerSec2?: SpatialVector3;
  accelerationMagnitudePcPerSec2?: number;

  segmentIndex: number | null;
  segmentId?: string | null;

  diagnostics?: SpatialSampleDiagnostics;
}
```

Keep the old `target` field for one migration cycle if needed, but document it as:

```ts
targetPc?: SpatialVector3;          // only for kind:'target'
syntheticTargetPc?: SpatialVector3; // for direction/orientation preview UI
```

Do not keep a single ambiguous `target`.

---

# 4. Destination should be a canonical shared object

The architecture doc already gives the destination shape: `centerPc`, `radiusPc`, `orbitNormal`, `angularSpeedRadPerSec`, `lookAtPc`, and `dwellSecs`. ([GitHub][2]) Turn that into the official `SpatialDestinationSpec`.

```ts
export interface SpatialDestinationSpec {
  id?: string;
  label?: string;

  centerPc: SpatialVector3;
  radiusPc?: number;

  /**
   * Default camera aim for this destination.
   * Usually { kind: 'target', targetPc: centerPc }.
   */
  aim?: SpatialAimSpec;

  /**
   * Convenience alias accepted at normalization, emitted as aim.
   */
  lookAtPc?: SpatialVector3;

  orbit?: SpatialOrbitSpec;

  /**
   * Optional framing/preload hints.
   */
  boundsRadiusPc?: number;
  dwellSecs?: number;

  source?: SpatialSourceRef;
  metadata?: Record<string, unknown>;
}
```

Normalize website and Studio destination presets through:

```ts
normalizeSpatialDestination(input): SpatialDestinationSpec
```

The normalizer should accept all current aliases:

```ts
center       -> centerPc
radius       -> radiusPc
normal       -> orbit.orbitNormal
orbitNormal  -> orbit.orbitNormal
angularSpeed -> orbit.angularSpeedRadPerSec
lookAt       -> aim or lookAtPc
target       -> targetPc or aim depending on context
```

Canonical output should never use the short aliases.

---

# 5. Orbit API should be public, pure, and basis-oriented

The current public API exposes `deriveSpatialOrbitAngle()` but not the orbit basis/sampling helpers, while the architecture doc says shared orbit basis, angle, normal, tangent, and arrival-action helpers belong in `spatial`. ([GitHub][3]) ([GitHub][2]) Make the orbit API explicit.

## Canonical orbit spec

```ts
export interface SpatialOrbitSpec {
  centerPc: SpatialVector3;
  radiusPc: number;

  orbitNormal?: SpatialVector3;
  referenceAxis?: SpatialVector3;

  initialAngleRad?: number;
  angularSpeedRadPerSec?: number;

  aim?: SpatialAimSpec;      // default: target centerPc
  handedness?: 1 | -1;       // optional, only if needed
  source?: SpatialSourceRef;
}
```

Add `referenceAxis` here, not only to angle input. The absence of `referenceAxis` from `SpatialOrbitOptions` is a cross-API inconsistency.

## Public orbit helpers

```ts
export function normalizeSpatialOrbitSpec(input: unknown): SpatialOrbitSpec | null;

export function createSpatialOrbitBasis(
  spec: SpatialOrbitSpec,
): SpatialOrbitBasis;

export function deriveSpatialOrbitAngle(
  input: SpatialOrbitAngleInput,
): number;

export function sampleSpatialOrbitPosition(
  orbit: SpatialOrbitSpec | SpatialOrbitBasis,
  angleRad: number,
): SpatialVector3;

export function evaluateSpatialOrbit(
  orbit: SpatialOrbitSpec,
  elapsedSecs: number,
): SpatialOrbitSample;
```

## Computed basis/result shapes

```ts
export interface SpatialOrbitBasis {
  centerPc: SpatialVector3;
  radiusPc: number;

  normal: SpatialVector3;
  radial: SpatialVector3;
  tangent: SpatialVector3;
  referenceAxis: SpatialVector3;

  warnings?: SpatialDiagnosticWarning[];
}

export interface SpatialOrbitSample {
  elapsedSecs: number;
  angleRad: number;

  positionPc: SpatialVector3;
  velocityPcPerSec: SpatialVector3;
  speedPcPerSec: number;

  basis: SpatialOrbitBasis;
  aim: SpatialAimSample;
}
```

This lets Studio show orbit normals/radials/tangents and lets the website avoid copying hidden math.

---

# 6. Routes should return points, timing, arrival action, and diagnostics together

The current declaration for `SpatialOrbitTransferRoute` exposes `points`, endpoint speeds, and an `arrivalAction`, but it does not carry full duration/length/cost/settle diagnostics. ([GitHub][3]) The shared architecture specifically says Studio diagnostics should report route length, duration, average speed, peak speed, arrival speed, and settle behavior. ([GitHub][2])

Make diagnostics part of every route result.

## Base route result

```ts
export interface SpatialRoute {
  id?: string;
  kind: 'polyline' | 'orbit-transfer' | 'orbital-insert';

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
```

## Route segment

```ts
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
```

## Endpoint

```ts
export interface SpatialRouteEndpoint {
  positionPc: SpatialVector3;
  velocityPcPerSec?: SpatialVector3;
  speedPcPerSec?: number;

  orbit?: SpatialOrbitSpec;
  orbitBasis?: SpatialOrbitBasis;

  aim?: SpatialAimSpec;
}
```

## Diagnostics

```ts
export interface SpatialRouteDiagnostics {
  durationSecs: number;
  totalLengthPc: number;

  averageSpeedPcPerSec: number;
  peakSpeedPcPerSec: number;
  departureSpeedPcPerSec: number;
  arrivalSpeedPcPerSec: number;

  settleSecs?: number;
  settleBehavior?: 'none' | 'snap' | 'blend-to-orbit' | 'continue-orbit';

  candidateCost?: number;
  candidateRank?: number;

  selectedOrbitNormal?: SpatialVector3;
  selectedRadial?: SpatialVector3;
  selectedTangent?: SpatialVector3;

  centerPenalty?: number;
  smoothnessPenalty?: number;
  curvaturePenalty?: number;
  arrivalPenalty?: number;

  warnings?: SpatialDiagnosticWarning[];
}
```

This should be available to both Studio and website code. Studio can surface the full diagnostics panel; website code can ignore it.

---

# 7. Orbital insert should have a pure timing/profile helper

The finding about deceleration is correct at the API level: deceleration should not be merely a field that may or may not be bypassed once a fixed duration exists. `durationSecs` and `decelerationPcPerSec2` need a deterministic relationship.

Add a pure function:

```ts
export interface SpatialOrbitalInsertTimingInput {
  distancePc: number;

  currentSpeedPcPerSec?: number;
  approachSpeedPcPerSec?: number;
  orbitalSpeedPcPerSec: number;

  durationSecs?: number;
  accelerationPcPerSec2?: number;
  decelerationPcPerSec2?: number;

  minDurationSecs?: number;
  maxDurationSecs?: number;
}

export interface SpatialTimingProfile {
  kind: 'duration' | 'trapezoid' | 'triangular' | 'constant-speed' | 'custom';

  durationSecs: number;

  distancePc?: number;

  departureSpeedPcPerSec?: number;
  cruiseSpeedPcPerSec?: number;
  arrivalSpeedPcPerSec?: number;
  peakSpeedPcPerSec?: number;

  accelerationPcPerSec2?: number;
  decelerationPcPerSec2?: number;

  phases: SpatialTimingPhase[];
  diagnostics?: SpatialTimingDiagnostics;
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
```

Public helper:

```ts
export function deriveSpatialOrbitalInsertTiming(
  input: SpatialOrbitalInsertTimingInput,
): SpatialTimingProfile;
```

Then orbital-insert route building becomes deterministic:

```ts
export function buildSpatialOrbitalInsertRoute(
  input: SpatialOrbitalInsertRouteInput,
): SpatialRoute | null;
```

If `durationSecs` is supplied, the profile should explicitly say whether deceleration was ignored, fitted, clamped, or incompatible:

```ts
diagnostics: {
  requestedDecelerationApplied: boolean;
  durationConstrainedProfile: boolean;
  warnings: [
    { code: 'duration-overrides-deceleration', severity: 'info', message: '...' }
  ]
}
```

That is much better than silently switching stepping modes.

---

# 8. Public exports should match ownership claims

The package currently exports only `"."`, so consumers cannot rely on importing private modules directly. ([GitHub][6]) The root export currently includes `createOrbitTransferRoute()` but not the orbital insert route builder. ([GitHub][7]) Since the README says spatial owns orbit/orbital-insert routes, the pure builder should be public. ([GitHub][1])

I would do both of these:

## Root exports

Export the canonical public helpers from `"."`:

```ts
export {
  normalizeSpatialDestination,
  normalizeSpatialOrbitSpec,
  normalizeSpatialTravelSpec,

  createSpatialOrbitBasis,
  deriveSpatialOrbitAngle,
  sampleSpatialOrbitPosition,
  evaluateSpatialOrbit,

  buildSpatialPolylineRoute,
  buildSpatialOrbitTransferRoute,
  buildSpatialOrbitalInsertRoute,

  deriveSpatialRouteTiming,
  deriveSpatialOrbitalInsertTiming,

  createSpatialPath,
  evaluateSpatialPath,
  materializeSpatialPathSamples,
  materializeSpatialPreloadHints,

  getSpatialRouteDiagnostics,
  getSpatialNavigationDiagnostics,
};
```

## Optional subpath exports

Add subpath exports for discoverability and tree-shaking clarity:

```json
"exports": {
  ".": {
    "types": "./src/index.d.ts",
    "default": "./src/index.js"
  },
  "./math": {
    "types": "./src/math.d.ts",
    "default": "./src/math.js"
  },
  "./camera": {
    "types": "./src/camera.d.ts",
    "default": "./src/camera.js"
  },
  "./orbits": {
    "types": "./src/orbits.d.ts",
    "default": "./src/orbits.js"
  },
  "./routes": {
    "types": "./src/routes.d.ts",
    "default": "./src/routes.js"
  },
  "./timing": {
    "types": "./src/timing.d.ts",
    "default": "./src/timing.js"
  },
  "./navigation": {
    "types": "./src/navigation.d.ts",
    "default": "./src/navigation.js"
  }
}
```

I would still keep root exports as the primary import path. Subpaths are mostly for humans and bundlers.

---

# 9. Interpolation should be split into spatial curve and timing curve

The current smooth-path API has `samplesPerSegment` for position and `useLinearInterpolation` for orientation. ([GitHub][3]) That is too small for Studio, but the answer is not to make `spatial` own Studio retiming UI. The answer is to expose deterministic interpolation primitives.

## Position interpolation

```ts
export type SpatialPositionInterpolation =
  | { kind: 'hold' }
  | { kind: 'linear' }
  | { kind: 'catmull-rom'; tension?: number; centripetal?: boolean }
  | { kind: 'cubic-bezier'; inTangentPc?: SpatialVector3; outTangentPc?: SpatialVector3 }
  | { kind: 'hermite'; inVelocityPcPerSec?: SpatialVector3; outVelocityPcPerSec?: SpatialVector3 };
```

## Aim/orientation interpolation

```ts
export type SpatialAimInterpolation =
  | { kind: 'hold' }
  | { kind: 'slerp'; easing?: SpatialEasingSpec }
  | { kind: 'look-at-target'; easing?: SpatialEasingSpec }
  | { kind: 'squad'; easing?: SpatialEasingSpec };
```

## Timing interpolation

```ts
export type SpatialEasingSpec =
  | { kind: 'linear' }
  | { kind: 'smoothstep' }
  | { kind: 'ease-in'; power?: number }
  | { kind: 'ease-out'; power?: number }
  | { kind: 'ease-in-out'; power?: number }
  | { kind: 'cubic-bezier'; x1: number; y1: number; x2: number; y2: number };
```

## Track keys

```ts
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
```

## Evaluator

```ts
export interface SpatialPathSpec {
  durationSecs?: number;
  positionKeys: SpatialPositionKey[];
  aimKeys: SpatialAimKey[];

  timing?: SpatialTimingProfile | SpatialEasingSpec;

  duplicateTimePolicy?: 'error' | 'coalesce-last' | 'coalesce-first' | 'hold' | 'preserve';
}

export function normalizeSpatialPathSpec(input: unknown): SpatialPathSpec;

export function evaluateSpatialPath(
  path: SpatialPathSpec,
  timeSecs: number,
  options?: SpatialPathEvaluationOptions,
): SpatialPathSample;

export function sampleSpatialPathDiagnostics(
  path: SpatialPathSpec,
  options?: SpatialSamplingOptions,
): SpatialPathDiagnostics;
```

This cleanly serves Studio without embedding Studio commands in `spatial`.

---

# 10. Duplicate-time keys need an explicit policy

Do not silently “fall back to the first waypoint” on zero-duration segments. For authoring systems, duplicate times are not always invalid: they may represent a cut, hold, generated helper key, or instantaneous retarget. But the behavior must be declared.

Use:

```ts
duplicateTimePolicy:
  | 'error'
  | 'coalesce-first'
  | 'coalesce-last'
  | 'hold'
  | 'cut'
  | 'preserve';
```

My default recommendations:

For low-level math constructors: default to `'error'`.

For compatibility normalizers: default to `'coalesce-last'` with diagnostics.

For Studio compilation: require the caller to choose.

Return diagnostics:

```ts
{
  warnings: [
    {
      code: 'duplicate-time-key',
      severity: 'warning',
      timeSecs: 12.5,
      keyIds: ['cam-4', 'helper-4b'],
      resolution: 'coalesce-last'
    }
  ]
}
```

---

# 11. Navigation snapshots and diagnostics should be separate

Keep `getSnapshot()` small for runtime UI. Add diagnostics for tooling.

The current declarations expose a compact `SpatialAutomationSummary` with fields like type, target, center, radius, angle, distance, and totalLength. ([GitHub][3]) That is fine for a runtime HUD. It is not enough for Studio/debug.

Add:

```ts
export interface SpatialNavigationDiagnostics {
  activeMovement: SpatialMovementDiagnostics | null;
  activeAim: SpatialAimDiagnostics | null;

  elapsedSecs: number;
  durationSecs?: number;

  currentPose: SpatialPose;
  currentFrameState: SpatialFrameState;

  currentSpeedPcPerSec: number;
  arrivalSpeedPcPerSec?: number;

  route?: SpatialRoute;
  timing?: SpatialTimingProfile;

  arrivalAction?: SpatialArrivalAction | null;
  pendingSettle?: SpatialSettleDiagnostics | null;

  warnings: SpatialDiagnosticWarning[];
}

export function getSpatialNavigationDiagnostics(
  navigation: SpatialNavigationAutomation | SpatialMotionModel,
): SpatialNavigationDiagnostics;
```

Do not stuff everything into the runtime snapshot. Studio/debug tooling can call diagnostics intentionally.

---

# 12. Arrival action should be canonical and unit-explicit

Current arrival action shapes use `center`, `radius`, `angularSpeedRadPerSec`, and `normal`. ([GitHub][3]) Normalize these into canonical authored names and keep aliases only at the action boundary.

```ts
export type SpatialArrivalAction =
  | SpatialOrbitArrivalAction
  | SpatialOrbitalInsertArrivalAction
  | SpatialLookAtArrivalAction
  | SpatialNoneArrivalAction;

export interface SpatialOrbitArrivalAction {
  type: 'orbit';
  orbit: SpatialOrbitSpec;
  settleSecs?: number;
  preserveAim?: boolean;
}

export interface SpatialOrbitalInsertArrivalAction {
  type: 'orbitalInsert';
  destination: SpatialDestinationSpec;
  orbit: SpatialOrbitSpec;
  timing?: SpatialTimingProfile;
}

export interface SpatialLookAtArrivalAction {
  type: 'lookAt' | 'lockAt';
  aim: SpatialAimSpec;
  dwellSecs?: number;
}

export interface SpatialNoneArrivalAction {
  type: 'none';
}
```

At runtime, `navigation.flyPolyline(points, { arrivalAction })` can still accept the old shape, but `normalizeSpatialArrivalAction()` should produce the canonical one.

---

# 13. Recommended package architecture

I would split the source internally like this:

```txt
src/
  index.js
  index.d.ts

  math/
    vector.js
    quaternion.js
    basis.js

  coordinates/
    icrs.js
    radec.js
    target-resolution.js

  camera/
    aim.js
    frame-state.js
    pose-transition.js
    look-at-orientation.js

  paths/
    keys.js
    interpolation.js
    path-evaluator.js
    path-diagnostics.js
    preload-hints.js

  orbits/
    orbit-spec.js
    orbit-basis.js
    orbit-sampling.js
    orbit-arrival.js

  routes/
    polyline-route.js
    orbit-transfer-route.js
    orbital-insert-route.js
    route-diagnostics.js

  timing/
    timing-profile.js
    orbital-insert-timing.js
    easing.js

  navigation/
    automation.js
    motion-models.js
    snapshots.js
    diagnostics.js
```

The dependency direction should be one-way:

```txt
math
  -> coordinates
  -> camera/aim
  -> timing
  -> paths/orbits/routes
  -> navigation runtime
```

`navigation` should not contain private orbit-transfer/orbital-insert math that Studio needs. It should call `routes/*`, `orbits/*`, and `timing/*`.

---

# 14. Boundary recommendation

Keep this boundary strict:

## `@found-in-space/spatial` should own

* vector/quaternion/basis math;
* ICRS/RA-Dec coordinate conversion and target resolution;
* normalized `SpatialAimSpec`, `SpatialDestinationSpec`, `SpatialOrbitSpec`, `SpatialTravelSpec`;
* orbit basis, angle, tangent, position, velocity, and evaluated orbit samples;
* polyline/orbit-transfer/orbital-insert route construction;
* route and timing diagnostics;
* timing profiles, including orbital-insert timing;
* smooth deterministic path evaluation;
* target-preserving path samples;
* preload hint materialization from evaluated path samples;
* stateful runtime navigation as an optional wrapper over pure math.

This matches the architecture doc’s statement that reusable route math should live in `spatial`, while runtime and Studio orchestration stay outside. ([GitHub][2])

## `@found-in-space/skykit` should own

* viewer composition;
* renderer/plugin lifecycle;
* action dispatch;
* runtime chapter action registration;
* mapping canonical `spatial` specs into actual viewer state changes.

## Website pages should own

* chapter activation functions;
* DOM/scroll triggers;
* story-specific scene state;
* demand/preload strategy decisions;
* article copy and interactive ordering.

The architecture doc explicitly says website chapters are interactive and should describe intent because their exact start pose is not known in advance. ([GitHub][2])

## Studio should own

* deterministic journey/timeline documents;
* camera/key editing commands;
* generated helper key groups;
* shot ranges;
* retiming UI;
* title/cue tracks;
* guide/object/data-layer tracks;
* render preflight;
* export metadata assembly.

The architecture doc says Studio compiles intent into exact observer/camera tracks, cue/title clips, object/data-layer tracks, preload markers, and render metadata. ([GitHub][2])

---

# 15. Specific API additions I would prioritize

## P0: intent-preserving aim/path samples

Add:

```ts
SpatialAimSpec
SpatialAimSample
SpatialFrameState
SpatialPathSample
normalizeSpatialAimSpec()
evaluateSpatialAimTrack()
evaluateSpatialPath()
```

Change smooth-path evaluation so target-authored samples return `aim.kind === 'target'` and `targetPc`, not just a synthetic target. Keep old fields temporarily for compatibility.

## P0: public orbital insert route and timing

Add and export:

```ts
buildSpatialOrbitalInsertRoute()
deriveSpatialOrbitalInsertTiming()
```

The current package is root-export-only, so direct module imports are not safe public API. ([GitHub][6]) Export the builder from root.

## P0: route diagnostics on route results

Add `diagnostics` to:

```ts
SpatialPolylineRoute
SpatialOrbitTransferRoute
SpatialOrbitalInsertRoute
```

Prefer migrating all three to a shared `SpatialRoute` base shape.

## P1: orbit basis/sampling API

Add:

```ts
normalizeSpatialOrbitSpec()
createSpatialOrbitBasis()
sampleSpatialOrbitPosition()
evaluateSpatialOrbit()
```

Also add `referenceAxis` to canonical orbit options.

## P1: destination/travel normalizers

Add:

```ts
normalizeSpatialDestination()
normalizeSpatialTravelSpec()
normalizeSpatialArrivalAction()
```

These should accept both authored names and runtime aliases, but emit only canonical names.

## P1: navigation diagnostics

Add:

```ts
getSpatialNavigationDiagnostics()
```

Keep `getSnapshot()` compact.

## P2: interpolation primitives

Add path/key interpolation types and derivative diagnostics. Studio can then build authoring tools without forking math.

---

# 16. Example: what a Studio/website-shared destination should look like

```ts
const pleiadesDestination: SpatialDestinationSpec = {
  id: 'pleiades',
  label: 'Pleiades',

  centerPc: { x: 67.379, y: 103.162, z: 55.161 },
  radiusPc: 25,

  aim: {
    kind: 'target',
    targetPc: { x: 67.379, y: 103.162, z: 55.161 },
    lock: true
  },

  orbit: {
    centerPc: { x: 67.379, y: 103.162, z: 55.161 },
    radiusPc: 25,
    orbitNormal: { x: 0, y: 0, z: 1 },
    angularSpeedRadPerSec: 0.18,
    referenceAxis: { x: 1, y: 0, z: 0 }
  },

  dwellSecs: 5
};
```

Website chapter code can activate it from the live pose. Studio can compile it from the previous shot’s evaluated end pose. Both call the same `normalizeSpatialDestination()`, `buildSpatialOrbitTransferRoute()`, and `evaluateSpatialOrbit()`.

---

# 17. Example: route result Studio can inspect

```ts
const route = buildSpatialOrbitTransferRoute({
  from: {
    positionPc: previousFrame.observerPc,
    velocityPcPerSec: previousFrame.pathFollow?.velocityPcPerSec,
    aim: previousFrame.aim ?? undefined
  },

  to: {
    destination: pleiadesDestination,
    orbit: pleiadesDestination.orbit
  },

  travel: {
    type: 'orbit-transfer',
    durationSecs: 9,
    sampleStepSecs: 1 / 24,
    arrivalThresholdPc: 0.05
  }
});

route?.diagnostics;
// {
//   durationSecs,
//   totalLengthPc,
//   averageSpeedPcPerSec,
//   peakSpeedPcPerSec,
//   departureSpeedPcPerSec,
//   arrivalSpeedPcPerSec,
//   settleSecs,
//   selectedOrbitNormal,
//   selectedRadial,
//   candidateCost,
//   ...
// }
```

That is the object Studio wants. Runtime navigation can ignore most of it and follow `route.pointsPc`.

---

# 18. Migration strategy

I would not break the current API immediately. Do this additively.

## Phase 1: Add canonical types and normalizers

* Add `SpatialAimSpec`, `SpatialAimSample`, `SpatialDestinationSpec`, `SpatialOrbitSpec`, `SpatialRoute`, `SpatialTimingProfile`.
* Add normalizers that accept existing names.
* Export `buildSpatialOrbitalInsertRoute()` and declarations.

## Phase 2: Make current runtime helpers consume canonical objects internally

* `createSpatialNavigationAutomation().orbit()` normalizes to `SpatialOrbitSpec`.
* `orbitalInsert()` calls `buildSpatialOrbitalInsertRoute()` and `deriveSpatialOrbitalInsertTiming()`.
* `flyPolyline()` consumes `SpatialRoute` when supplied, not just `points`.

## Phase 3: Expand smooth path samples

* Return `aim`.
* Preserve `targetPc` only for real target aim.
* Rename synthesized target to `syntheticTargetPc`.
* Add duplicate-time key policy and diagnostics.

## Phase 4: Deprecate ambiguous fields

Mark these as compatibility aliases:

```ts
center
target
radius
normal
angularSpeed
speed
totalLength
```

Use canonical output names everywhere new.

---

## Bottom line

The package should not become a Studio schema package, but it should become the canonical **spatial semantics** package. The most important design choice is to preserve intent:

* `targetPc` is not the same thing as `forward`.
* `orbitNormal` is not the same thing as a computed `basis.normal`.
* `durationSecs` is not the same thing as a deceleration profile.
* `pointsPc[]` without timing/diagnostics is not a route suitable for editor tooling.

The public API should be built around explicit, unit-suffixed, discriminated objects: `SpatialAimSpec`, `SpatialFrameState`, `SpatialDestinationSpec`, `SpatialOrbitSpec`, `SpatialRoute`, `SpatialTimingProfile`, and `SpatialRouteDiagnostics`. Runtime automation should remain, but it should sit on top of those objects rather than hiding them.

[1]: https://raw.githubusercontent.com/Found-in-Space/skykit/feature/layer-hosts-and-products/packages/spatial/README.md "raw.githubusercontent.com"
[2]: https://raw.githubusercontent.com/Found-in-Space/skykit/feature/layer-hosts-and-products/docs/chapter-and-camera-timeline-architecture.md "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/Found-in-Space/skykit/feature/layer-hosts-and-products/packages/spatial/src/index.d.ts "raw.githubusercontent.com"
[4]: https://github.com/Found-in-Space/skykit/raw/refs/heads/feature/layer-hosts-and-products/packages/spatial/src/smooth-paths.js "raw.githubusercontent.com"
[5]: https://raw.githubusercontent.com/Found-in-Space/skykit/feature/layer-hosts-and-products/packages/spatial/src/math.js "raw.githubusercontent.com"
[6]: https://raw.githubusercontent.com/Found-in-Space/skykit/feature/layer-hosts-and-products/packages/spatial/package.json "raw.githubusercontent.com"
[7]: https://raw.githubusercontent.com/Found-in-Space/skykit/feature/layer-hosts-and-products/packages/spatial/src/index.js "raw.githubusercontent.com"
