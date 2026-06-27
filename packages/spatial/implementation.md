# Spatial Implementation Gaps

This file tracks the implementation gaps found while reviewing
`README.md` and `api-contract.md` against the current `packages/spatial`
code. The public names and many canonical object shapes have landed, but the
items below still need implementation work before the contract can be treated
as complete.

## 1. Route Diagnostics Are Too Shallow

Status: partially landed.

The contract and plan expect route diagnostics to help Studio and website code
inspect generated route quality. The current implementation returns the core
duration/length/speed fields and selected orbit basis for generated orbital
insert/transfer curves, but omits candidate quality terms and segment
diagnostics.

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
- `selectedOrbitNormal`, `selectedRadial`, and `selectedTangent` are populated
  when orbit-aware route geometry is generated.
- Linear orbit-transfer fallback geometry emits a warning.
- `candidateCost`, `candidateRank`, and penalty fields are not produced.
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
- Orbit transfer diagnostics include candidate quality when orbit metadata is
  present.
- Orbital insert diagnostics include candidate cost.
- Segment diagnostics are populated for multi-segment routes.
- Fallback geometry emits a warning.

Done when:

- `SpatialRouteDiagnostics` fields declared in the contract are populated when
  enough information exists.
- Route diagnostics include candidate quality and segment diagnostics.

## 2. Inertial And Thrust Motion Models Are Aliases Of Direct Motion

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
