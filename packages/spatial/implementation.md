# Spatial Implementation Gaps

This file tracks the implementation gaps found while reviewing
`README.md` and `api-contract.md` against the current `packages/spatial`
code. The public names and many canonical object shapes have landed, but the
items below still need implementation work before the contract can be treated
as complete.

## 1. View And Pose Transition Lane Semantics Are Stubbed

Status: partially landed.

The contract says view transitions are not route-follow actions. They should
interpolate observer position and aim/orientation lanes, may use independent
lane timing, and evaluate to `SpatialFrameState` samples. It also says
`createSpatialPoseTransition()` remains public, but must compile into the same
canonical view-transition evaluator.

References:

- Contract: [api-contract.md:1172](./api-contract.md#L1172)
- Contract lane shape: [api-contract.md:1195](./api-contract.md#L1195)
- Pose bridge rule: [api-contract.md:1257](./api-contract.md#L1257)
- Current view transition builder creates simple two-key path data:
  [src/index.js:951](./src/index.js#L951)
- Current evaluator ignores lane delay and lane easing during sampling:
  [src/index.js:990](./src/index.js#L990)
- Current pose transition evaluator is separate smoothstep/slerp code:
  [src/index.js:1032](./src/index.js#L1032)

Current behavior:

- `position.delaySecs` is recorded in diagnostics but does not delay movement.
- `aim.delaySecs` is recorded in diagnostics but does not delay aim changes.
- Lane `easing` and `interpolation` are normalized as shallow strings/objects
  but are not applied consistently.
- `createSpatialPoseTransition()` does not compile into a view-transition path;
  it has its own evaluator.

Implementation work:

- Make `SpatialTransitionLaneSpec` normalization strict:
  - non-negative `durationSecs`;
  - non-negative `delaySecs`;
  - supported easing kinds only;
  - supported lane interpolation strings only.
- Materialize transition lanes into path-domain keys that represent delay,
  active interpolation, and hold-after-completion behavior.
- Preserve `from` and `to` frame state metadata where possible.
- Implement `evaluateSpatialViewTransition()` by sampling the canonical path and
  deriving `positionComplete` and `aimComplete` from lane delay plus duration.
- Rebuild `createSpatialPoseTransition()` as a thin bridge over
  `buildSpatialViewTransitionPath()` and `evaluateSpatialViewTransition()`.
- Decide whether pose transitions should expose the internal
  `SpatialViewTransitionPath` or hold it privately; either approach should keep
  behavior shared.

Tests required:

- Position delay holds the source observer position until delay expires.
- Aim delay holds the source aim/orientation until delay expires.
- Different position and aim durations finish independently.
- Lane easing changes sampled values at midpoints.
- Pose transition and view transition produce identical samples for equivalent
  pose-only inputs.
- `positionComplete` and `aimComplete` are true only after delay plus lane
  duration.

Done when:

- View transitions and pose transitions use one implementation path.
- Lane delay, duration, easing, and interpolation affect evaluated samples.
- Diagnostics reflect actual lane behavior, not only authored values.

## 2. Orbital Insert Timing And Route Physics Are Placeholder-Level

Status: public names landed, behavior not fully landed.

The contract calls for a physical `SpatialTimingProfile` with acceleration,
deceleration, min/max duration constraints, phases, and diagnostics. The plan
specifically calls out orbital insert timing as needing deterministic handling
when `durationSecs` conflicts with acceleration or deceleration.

References:

- Contract timing profile: [api-contract.md:632](./api-contract.md#L632)
- Contract orbital insert timing helper:
  [api-contract.md:671](./api-contract.md#L671)
- Plan recommendation: [plan.md:546](./plan.md#L546)
- Current `deriveSpatialOrbitalInsertTiming()` forwards only speed and duration:
  [src/index.js:531](./src/index.js#L531)
- Current generic timing profile always returns one cruise or hold phase:
  [src/index.js:1452](./src/index.js#L1452)
- Current orbit transfer route uses straight interpolated route points:
  [src/index.js:635](./src/index.js#L635)
- Current orbital insert route uses straight interpolated route points:
  [src/index.js:679](./src/index.js#L679)
- Current route point interpolation is simple linear interpolation:
  [src/index.js:1402](./src/index.js#L1402)

Current behavior:

- `accelerationPcPerSec2`, `decelerationPcPerSec2`, `minDurationSecs`, and
  `maxDurationSecs` are ignored by `deriveSpatialOrbitalInsertTiming()`.
- The returned timing profile is `kind: 'constantSpeed'` even when inputs ask
  for acceleration or deceleration behavior.
- Diagnostics do not report whether acceleration or deceleration was applied,
  ignored, fitted, or overridden by duration.
- Orbit transfer and orbital insert routes are straight-line point samples, so
  they do not yet represent the intended orbit-transfer or insert geometry.

Implementation work:

- Implement `normalizeSpatialTimingSpec()` for `duration`, `constantSpeed`,
  `trapezoid`, `triangular`, and `custom` rather than copying complex specs
  through.
- Implement timing profile derivation for:
  - fixed duration;
  - constant speed;
  - trapezoidal acceleration/cruise/deceleration;
  - triangular no-cruise profiles;
  - custom phase validation.
- In `deriveSpatialOrbitalInsertTiming()`, use current speed, approach speed,
  orbital speed, acceleration, deceleration, and duration constraints to build
  phases.
- Populate `SpatialTimingDiagnostics` with `requestedAccelerationApplied`,
  `requestedDecelerationApplied`, `durationConstrainedProfile`,
  `clampedToMinDuration`, `clampedToMaxDuration`, and warnings.
- Make `evaluateSpatialRoute()` sample distance from timing phases instead of
  linear elapsed/duration ratio.
- Replace straight-line orbital insert geometry with a curve that respects
  arrival tangent and orbit handoff. A minimal first pass can use Hermite or
  quintic interpolation with arrival velocity aligned to the orbit tangent.
- Replace straight-line orbit transfer with at least a basis-aware transfer
  curve when source or destination orbit metadata is available.

Tests required:

- Acceleration/deceleration inputs produce non-cruise phases.
- Fixed duration plus incompatible deceleration emits diagnostics.
- Min and max duration constraints clamp and report diagnostics.
- Route evaluation samples distance according to timing phases, not only
  elapsed/duration.
- Orbital insert arrival velocity is tangent to the destination orbit.
- Orbit transfer/insert routes are not straight-line when orbit metadata is
  present.

Done when:

- Timing profiles carry meaningful phases and diagnostics.
- Orbital insert route timing reflects authored acceleration/deceleration
  controls.
- Route evaluation uses the timing profile as the source of distance over time.

## 3. Route Diagnostics Are Too Shallow

Status: partially landed.

The contract and plan expect route diagnostics to help Studio and website code
inspect generated route quality. The current implementation returns the core
duration/length/speed fields, but omits selected orbit basis and candidate
quality terms.

References:

- Contract route diagnostics: [api-contract.md:797](./api-contract.md#L797)
- Plan diagnostics recommendation: [plan.md:511](./plan.md#L511)
- Current diagnostics creation: [src/index.js:1414](./src/index.js#L1414)
- Orbit transfer route attaches shallow diagnostics:
  [src/index.js:654](./src/index.js#L654)
- Orbital insert route attaches shallow diagnostics:
  [src/index.js:705](./src/index.js#L705)

Current behavior:

- `durationSecs`, `totalLengthPc`, `averageSpeedPcPerSec`,
  `peakSpeedPcPerSec`, `departureSpeedPcPerSec`, and
  `arrivalSpeedPcPerSec` are populated.
- `settleBehavior` is set for orbital insert.
- `candidateCost`, `candidateRank`, selected orbit basis fields, and penalty
  fields are not produced.
- Segment diagnostics such as per-segment `durationSecs`,
  `averageSpeedPcPerSec`, and `curvatureRadPerPc` are declared but not filled.

Implementation work:

- Expand `routeDiagnostics()` to accept route-generation metadata:
  selected orbit normal, radial, tangent, candidate score, and penalties.
- Compute segment durations and average speeds from the timing profile.
- Compute curvature estimates for generated curves where there are at least
  three route points.
- For orbit transfer and orbital insert builders, keep candidate scoring data
  and attach it to route diagnostics.
- If a builder uses a trivial fallback path, emit an explicit diagnostic warning
  so tooling can show the route is lower fidelity.

Tests required:

- Polyline diagnostics include core speed and length fields.
- Orbit transfer diagnostics include selected orbit basis when orbit metadata is
  present.
- Orbital insert diagnostics include selected radial/tangent and candidate cost.
- Segment diagnostics are populated for multi-segment routes.
- Fallback geometry emits a warning.

Done when:

- `SpatialRouteDiagnostics` fields declared in the contract are populated when
  enough information exists.
- Route diagnostics distinguish high-fidelity generated routes from fallback
  routes.

## 4. Inertial And Thrust Motion Models Are Aliases Of Direct Motion

Status: public constructors landed, distinct models not landed.

The contract exposes direct, inertial, and thrust manual motion models with
different option sets. The current implementation creates all three through the
same `createManualMotionModel()` implementation.

References:

- Contract motion model options: [api-contract.md:1385](./api-contract.md#L1385)
- Contract constructors: [api-contract.md:1410](./api-contract.md#L1410)
- `createDirectSpatialMotionModel()`:
  [src/index.js:1104](./src/index.js#L1104)
- `createInertialSpatialMotionModel()`:
  [src/index.js:1108](./src/index.js#L1108)
- `createThrustSpatialMotionModel()`:
  [src/index.js:1112](./src/index.js#L1112)
- Shared implementation ignores inertial/thrust-specific options:
  [src/index.js:1274](./src/index.js#L1274)

Current behavior:

- Direct, inertial, and thrust models produce the same movement for the same
  `moveSpeedPcPerSec` input.
- `accelerationPcPerSec2`, `damping`, `maxSpeedPcPerSec`,
  `thrustPcPerSec2`, `mass`, and `drag` are not used.
- The snapshot shape reports canonical velocity and speed fields, but does not
  expose model-specific state beyond `kind`.

Implementation work:

- Keep direct motion as immediate velocity from current controls.
- Implement inertial motion as acceleration toward the input direction, damping
  when input is idle, and max-speed clamping.
- Implement thrust motion as force/mass acceleration, drag, and max-speed
  clamping.
- Keep attitude controls shared, but separate translational velocity integration
  per model.
- Include enough snapshot data to debug each model without expanding the public
  snapshot beyond the declared shape unless the contract is updated.

Tests required:

- Direct model reaches full configured movement in one update.
- Inertial model ramps velocity over multiple updates.
- Inertial damping reduces velocity when input stops.
- Inertial max speed clamps velocity.
- Thrust model uses `thrustPcPerSec2 / mass`.
- Thrust drag reduces velocity when input stops.
- Thrust max speed clamps velocity.

Done when:

- The three constructors produce meaningfully different motion under the same
  input.
- Model-specific options are used and covered by tests.
- Snapshots report canonical `velocityPcPerSec` and `speedPcPerSec` values.

## Verification Baseline

The following checks passed before this document was created:

- `npm test --workspace @found-in-space/spatial`
- `npm run typecheck`
- `node --test`

These checks prove the current surface compiles and existing tests pass. They do
not prove the implementation gaps above are closed, because several declared
features are currently accepted but not behaviorally implemented.
