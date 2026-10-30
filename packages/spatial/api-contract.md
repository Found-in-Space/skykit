# Spatial API contract

Status: canonical contract for source version **0.3.0-alpha.1**. This is a
breaking alpha reset. Published 0.2.0 and earlier source APIs are not compatible.
There are no legacy input aliases, deprecated exports, or compatibility paths.

## Ownership and public surface

Import from `@found-in-space/spatial`. Internal module paths are unsupported.
The package uses plain ES modules, handwritten declarations, plain data objects,
and no runtime dependencies. Its implementation is divided into math,
spaces/transforms, celestial coordinates, pose/aim, orbits, timing, routes,
paths/transitions, motion, and internal numerical helpers.

Spatial owns generic geometry and navigation mathematics. It does not define
body catalogs, ephemerides, geodetic datums, time standards, astronomical frame
corrections, terrain contact, UI, renderers, WebXR sessions, or application policy.
A route's circular orbit or orbital insertion describes authored navigation;
it does not claim physical spacecraft dynamics.

## Spaces, units, and presentation

```ts
interface SpatialCoordinateSpace {
  readonly frameId: string;
  readonly metersPerUnit: number;
}
interface SpatialPose {
  space: SpatialCoordinateSpace;
  position: SpatialVector3;
  orientation: SpatialQuaternion;
}
interface SpatialScaleProfile {
  worldUnitsPerUnit?: number;
}
```

`frameId` is a nonempty opaque identity supplied by the domain owner. Its
contract identifies an origin, axes, and reference epoch where applicable.
Two frames with matching axes can still have different origins. The labels
J2000 and ICRS alone do not establish a transformation between physical systems.
Spatial neither interprets labels nor looks up transforms in a registry.

`metersPerUnit` is a positive finite physical conversion. Use
`SPATIAL_METERS_PER_AU` and `SPATIAL_METERS_PER_PARSEC` for those units. Metre
spaces use `1`. Frame identity and units are independent: the same frame can be
expressed in different units, but those representations still require explicit
unit conversion before being combined.

Semantic specs and samples declare a space. Nested aims, destinations, endpoints,
orbits, travel/timing specs, and path keys may omit it and inherit their owning
operation's context. An explicitly supplied nested space must match **both**
frame identity and physical units. Normalizers accept an explicit inherited-space
argument for this purpose. Bare vectors and quaternions are algebraic values;
they do not carry or resolve frame identities themselves.

All lengths in contextual objects use that space's units: `position`, `target`,
`center`, `radius`, `distance`, `points`, and `totalLength`. Rates use names such
as `velocityUnitsPerSec`, `speedUnitsPerSec`, and `accelerationUnitsPerSec2`.
Angles retain `Rad` or `Deg`; durations retain `Secs`.

`worldUnitsPerUnit` is a presentation factor, defaulting to `1`. It is separate
from physical conversion and never changes a pose's physical location, route
timing, or motion speed. For Geant's 1:N convention with rendered metres, its
adapter derives `worldUnitsPerUnit = space.metersPerUnit / N`. Geant owns N,
scale-input behavior, detents, and formatting. Terrain exaggeration remains a
separate domain choice.

Generic operations have no implicit parsec context. Stateful navigation takes
its space at construction; motion models take it in their options. SkyKit's
adapter supplies `SKYKIT_ICRS_SPACE` while preserving its public `observerPc`,
`targetPc`, `orientationIcrs`, and provider contracts.

## Algebra and transformations

All spaces are right handed. Quaternions use `{ x, y, z, w }` and map a pose's
local basis into its containing frame. Local right is +X, up is +Y, and forward
is -Z. Multiplication `multiplySpatialQuaternions(a, b)` applies b, then a.
Low-level quaternion application expects a unit quaternion; semantic transform
and pose normalization normalizes quaternion inputs.

The root also exposes cross/dot products, quaternion inversion, forward/up basis
construction, quaternion interpolation, and direction interpolation.
`SPATIAL_Z_UP_TO_Y_UP` is the fixed rotation mapping `(x, y, z)` to `(x, z, -y)`.
It does not imply any astronomical origin conversion or renderer dependency.

```ts
interface SpatialTransform {
  from: SpatialCoordinateSpace;
  to: SpatialCoordinateSpace;
  sourceOrigin?: SpatialVector3; // in source units; default zero
  targetOrigin?: SpatialVector3; // in target units; default zero
  rotation?: SpatialQuaternion; // source axes -> target axes; default identity
}
```

For a point p:

```text
pTarget = targetOrigin
        + rotate(p - sourceOrigin, rotation)
        * from.metersPerUnit / to.metersPerUnit
```

- `transformSpatialPoint()` subtracts the source origin before scaling/rotation.
- `transformSpatialDisplacement()` applies rotation and unit conversion only.
- `transformSpatialDirection()` rotates and returns a unit vector; translation
  and unit scale have no effect. A zero direction is invalid.
- `transformSpatialOrientation()` composes the source-to-target rotation with
  the authored orientation.
- `transformSpatialPose()` checks the pose's source space and transforms both
  position and orientation.
- `invertSpatialTransform()` reverses spaces, origins, and rotation.
- `composeSpatialTransforms(first, second)` applies first, then second, and
  requires first.to to match second.from. It preserves an anchored source origin.

These are geometric snapshots. A velocity in a rotating or moving frame can
require additional time derivatives; transforming a displacement is not such a
dynamics calculation. The domain owner supplies transforms for the chosen
simulation time and any necessary physical corrections.

Keep physical state in double precision and rebase before render/GPU conversion.
Maintain small local offsets separately where adding them to a distant absolute
position would lose precision. Converting units cannot recover bits already
lost by floating-point addition. Round-trip tolerances must account for the
magnitude of the represented absolute coordinates.

## Coordinates, targets, and aims

`raDecToIcrsDirection()` describes equatorial/ICRS axes explicitly. Supply
exactly one of `raDeg` or `raHours`, and `decDeg` in [-90, 90]. RA wraps by a
full turn. `raDecDistanceToIcrs()` additionally requires space and a positive
distance in its units. Its caller must establish the declared origin and axes.

`icrsToRaDec(point, observer?)` operates on a relative offset in those axes;
coincident points return null. RA at a pole is conventional rather than a unique
physical direction. `icrsDirectionToTarget(direction, distance, space, observer?)`
creates a finite point and returns null for an impossible zero direction.
`projectSpatialEquirectangular()` validates finite angles and positive dimensions;
its RA increases left-to-right. Sky-map adapters may deliberately reverse X.

Targets remain explicit position, RA/Dec/distance, or bookmark specs. Bookmark
lookup is injected by the caller; spatial owns no catalog or bookmark registry.
Synchronous and asynchronous resolver results must retain the requested space.

Aim kinds remain distinct:

- `target` retains a real target point and its distance.
- `direction` retains a direction independently from observer translation.
- `orientation` retains an authored quaternion.

Synthetic targets in direction/orientation samples are diagnostics, not real
look targets. The default synthetic distance is one coordinate unit. Coincident
targets and parallel up vectors use documented deterministic fallbacks and
emit warnings. Generic default up is local +Y; SkyKit explicitly supplies
catalog north (+Z) and its astronomical position-angle convention.

Direction interpolation preserves normalized endpoints, follows the short arc,
and handles antipodes deterministically. Callers may supply an
`antipodalTangent` and `antipodalCosineThreshold` to retain an authored arc choice.
These options specify geometry, not a physical model.

## Routes, timing, paths, and preload hints

Existing capabilities remain, expressed in the declared space:

- destination-preserving endpoints, polyline routes, orbit-transfer routes,
  and tangent orbital insertion with explicit fallback diagnostics;
- signed orbit direction, exact arrival endpoint velocity, derived handoff
  angle, independent aim, and arrival settle/dwell behavior;
- duration, constant-speed, triangular, trapezoidal, and custom timing profiles;
- hold, linear, Catmull-Rom, Bézier, and Hermite position interpolation;
- target/direction/orientation aim tracks, independent view-transition lanes,
  and pose transitions compiled through the same view-transition evaluator;
- path/sphere preload volumes and view-lookahead hints, each retaining space.

Reusable timing profiles retain their space; reuse in another unit or frame is
rejected. Derived timing integrates velocity and preserves endpoint speeds.
Infeasible authored constraints remain visible in diagnostics. Default numeric
speeds and distances are expressed in the declared units; applications choose
physical travel policy explicitly.

Path keys use authored `timeSecs`. `durationSecs` defines the path end and never
rescales key times. Final values hold when duration extends beyond the last key.
Only `timeRemap` maps playback time into authored path time. Empty position-key
lists are invalid. Duplicate times require an explicit policy. Distinct positive
intervals are not collapsed by a fixed epsilon.

Sampling uses `sampleStepSecs`, or matching `frameRate`; absent sampling options
use 1/60 second. Samples include the endpoint unless an explicitly supplied
`maxSamples` truncates them, in which case diagnostics report truncation.
No new distance, scale, zoom, or sample-count ceilings are introduced.

Preload hints describe geometry and time windows. Providers retain fetching
policy. The SkyKit adapter converts same-frame hints into catalog parsecs once
and rejects unrelated origins instead of interpreting their numbers as parsecs.

## Motion and automation

`createDirectSpatialMotionModel`, `createInertialSpatialMotionModel`, and
`createThrustSpatialMotionModel` accept `{ space, ...options }`. Updates consume
a canonical pose, controls, and nonnegative `deltaSecs`. Rates and snapshots use
the same coordinate units. Presentation scale is retained for adapters and
telemetry; it does not modify physical integration.

`createSpatialNavigationAutomation(space)` consumes canonical routes, orbit
specs, and aims. Manual look can override the current orientation without
removing aim state. Movement and orientation cancellation remain independent.
Updates, commands, frame state, and diagnostics remain in the declared space.
Dispose stops automation; disposed navigation rejects further commands.

## Validation, migration, and verification

Malformed canonical shapes throw TypeError; invalid numeric ranges or mismatched
spaces throw RangeError. A null result is reserved for explicitly documented
impossible or unresolved geometry. Old `Pc`/`Icrs` fields in generic specs and the
old combined scale profile are rejected rather than translated.

Migration is an edit to callers:

1. Declare the physical frame and metres-per-unit conversion.
2. Replace generic star-specific fields with contextual fields and unit rates.
3. Supply or inherit space at semantic construction boundaries.
4. Keep domain-facing star/view fields at the adapter edge.
5. Separate rendered size from physical conversion.
6. Install a matching package set; do not replace spatial beneath a released
   SkyKit runtime that expects its older API.

Public declarations are in `src/index.d.ts`; companion module declarations keep
those contracts centralized. Package typechecks include valid and invalid typed
consumer examples. JavaScript behavior is verified by the geometry/navigation
suite, cross-unit and mixed-space tests, SkyKit/XR integration tests, Geant tests,
and packed-consumer checks. No browser or physical Quest performance claim is
established by numeric tests or compilation.
