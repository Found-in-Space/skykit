# XR And Spatial Architecture

Status: current alpha package documentation.

This note defines the split between shared spatial navigation and WebXR-specific
runtime behavior.

```txt
@found-in-space/spatial
  dependency-free coordinate, target, pose, route, orbit, look-at, and motion helpers

@found-in-space/skykit/xr
  optional WebXR rig, body/input, rays, session, and depth helpers

@found-in-space/skykit
  composition, actions, plugins, view state, debug bridge, and lesson entrypoints
```

The old standalone `@found-in-space/xr` package has been removed. There are no
compatibility aliases or root re-exports: shared navigation imports come from
`@found-in-space/spatial`, while WebXR imports come from
`@found-in-space/skykit/xr`.

---

## 1. Why Spatial Is Separate

Targets, routes, look-at, fly-to, orbit, and smooth navigation are useful beyond
WebXR:

```txt
desktop Three.js viewers
Canvas lessons
journeys and authored videos
games in other engines
Node diagnostics
WebXR viewers
```

Those helpers must not force Three.js, DOM, WebXR, star cell streams, or SkyKit
viewer composition into code that only wants math and route planning. The
spatial package owns this dependency-free layer.

`@found-in-space/spatial` owns:

- vector, quaternion, pose, and scale-profile types.
- local axis constants: forward, right, and up.
- quaternion-safe transform helpers.
- RA/Dec/distance and ICRS coordinate conversion.
- target resolution for vectors, RA/Dec forms, and application-resolved
  bookmarks.
- polyline routes and distance sampling.
- smooth fly-to and route-follow motion.
- orbit and orbital-insertion helpers.
- look-at and lock-at orientation automation.
- direct, inertial, thrust, and fly-to motion models.
- `createSpatialNavigationAutomation()` for movement and orientation lanes.

Spatial does not own:

- WebXR sessions, reference spaces, controller input, or headset poses.
- Three.js objects, cameras, renderers, shaders, or scene roots.
- SkyKit actions, plugins, debug globals, or lesson composition.
- star cell streams, octree loading, catalogs, sidecars, or journey content.

---

## 2. SkyKit XR Boundary

`@found-in-space/skykit/xr` is the optional learner-facing WebXR surface. It is a
subpath because most learners think of VR as a mode of the same sky viewer, but
normal desktop and Canvas usage should not import it.

`@found-in-space/skykit/xr` owns:

- WebXR-safe rig topology:
  origin-pinned content roots, observer-centric roots, scale-banded roots,
  navigation/spaceship/deck roots, XR origin, head/camera mount, hand roots,
  attachment roots, and ship mount roots.
- WebXR body tracking:
  head pose, hand/controller grip poses, target-ray poses, ship pose, and
  future-safe torso/body fields.
- Controller input:
  handedness, axes, buttons, deadzones, edge states, and inspectable bindings.
- Ray sources:
  left/right target ray, left/right grip ray, head gaze, ship-forward ray, and
  custom ray wrappers.
- Generic pick routing:
  blocker-first routing into target-owned `pick(ray)` implementations.
- SkyKit XR plugins:
  observer rig bridging, body tracking, controller navigation controls, session
  enter/exit actions, ray visualization, and star-picking events.
- WebXR session helpers:
  support checks, enter/exit helpers, reference-space defaults, and safe
  render-state depth application.
- XR depth telemetry:
  near/far computation from visible bounds, observer-centric spheres, scale
  profile, and policy clamps.

SkyKit XR does not own:

- shared route/orbit/look-at math. That belongs in `spatial`.
- star rendering, star shaders, or star picking. Those belong in
  `three-star-field`.
- panels, HUDs, embedded displays, or forwarded surface input. Those belong in
  touch-os.
- journeys, authored chapters, star catalogs, sidecars, H-alpha, dust, or
  galaxy products.
- beginner-facing label/facts policy for picked stars. XR picking may transport
  renderer pick details, but public lessons should use bookmarkable public star
  identity when the star stream provides it and optionally enrich through
  sidecars at the facade or app layer. Do not invent fallback IDs unless a real
  feature cannot provide the public identity.

---

## 3. Scene Graph Rules

The multi-root scene graph is not optional.

```txt
originContentRoot
  ICRS/origin-pinned content such as Gaia stars and nearby objects

observerContentRoot
  observer-centric content such as constellation art or infinity-painted guides

scaleBandedContentRoots
  kpc/Mpc context layers, galaxy structure, H-alpha, dust, or other bands

navigationRoot / spaceshipRoot / deckRoot / xrOrigin / headRoot
  the user's ship/body/head hierarchy
```

Rules:

1. Never mutate the WebXR camera directly for headset orientation.
2. Move the navigation/spaceship root for ship motion.
3. Keep scene content roots distinct from the ship/body roots.
4. Observer-centric roots follow observer translation but do not inherit
   ship/head rotation.
5. Origin-pinned content stays in ICRS coordinates, with the Sun/home at the
   origin by convention.
6. Scale-banded layers update at their own semantic scale; they are not forced
   to reload every parsec-scale navigation frame.

---

## 4. Actions And Controls

SkyKit uses semantic action IDs for input and automation. Action names describe
meaning, not component factories.

```txt
skykit:ship.move.forward
skykit:ship.attitude.rollClockwise
skykit:navigation.flyTo
skykit:navigation.orbit
skykit:navigation.lookAt
skykit:viewer.reset
skykit:xr.enter
skykit:xr.exit
skykit:xr.toggle
```

Desktop keyboard/mouse plugins, touch DOM controls, touch-os surfaces, WebXR
controller bindings, debug tools, journeys, and games should drive the same
action registry instead of faking keypresses.

Frame-of-reference guidance:

- `skykit:ship.*` actions are navigation-rig/spaceship-frame semantics.
- WebXR head pose is body/head-frame input and should not steer the ship unless
  a plugin explicitly maps it to ship actions.
- `skykit:navigation.*` actions are authored automation over spatial targets,
  routes, and orientations.
- Apps may register their own namespaces such as `game:*`, `lesson:*`, or
  `website:*`.

---

## 5. Package Imports

Spatial navigation:

```js
import {
  createSpatialNavigationAutomation,
  computeSpatialLookAtOrientation,
  raDecDistanceToIcrs,
} from '@found-in-space/spatial';
```

SkyKit composition:

```js
import {
  SKYKIT_ACTIONS,
  createSkykitNavigationPlugin,
  createSkykitViewer,
} from '@found-in-space/skykit';
```

WebXR helpers:

```js
import {
  createSkykitXrRig,
  createSkykitXrControlBindings,
  createSkykitXrRaySource,
  enterSkykitXrSession,
} from '@found-in-space/skykit/xr';
```

---

## 6. Current Implementation Status

Implemented in `@found-in-space/spatial`:

- dependency-free vector/quaternion/pose helpers.
- RA/Dec/ICRS coordinate helpers and equirectangular projection.
- vector, RA/Dec, and bookmark target resolution.
- polyline routes and route sampling.
- smooth fly-to, route-follow, orbit, orbital insertion, look-at, and lock-at
  automation.
- direct, inertial, thrust, and fly-to motion models.
- timed tracks, smooth paths, and materialized preload hints.

Implemented in `@found-in-space/skykit`:

- `SKYKIT_ACTIONS.navigation.*` semantic actions.
- `SKYKIT_ACTIONS.xr.*` session actions registered by the XR session plugin.
- `createSkykitNavigationPlugin()` backed by spatial automation.
- action payloads that accept vectors, RA/Dec/distance, and application-resolved
  bookmark forms.
- keyboard/mouse plugins that can inform manual look state.
- `@found-in-space/skykit/touch-os` HUD and panel plugins that applications can
  mount in desktop or XR scenes without making XR own surfaces.

Implemented in `@found-in-space/skykit/xr`:

- WebXR rig and multi-root topology.
- body tracker and controller axis/button helpers.
- ray sources and blocker-first pick router.
- depth range calculation and render-state application.
- WebXR support/session enter/exit helpers.
- observer rig bridge, session plugin, controller navigation plugin, ray visual
  plugin, and star-picking plugin.
- `createSkykitVrViewer()` turnkey VR starfield preset built on the public
  viewer, product, layer-host, shared star-source, and XR composition APIs.
- `stars/xr-pick`, `stars/xr-pick-miss`, and blocker events for applications to
  handle without renderer-specific controller code.
- fake-XR tests for rig, controls, rays, routing, depth, and sessions.

Not implemented yet:

- GPU pick routing or built-in star-specific XR pick effects.
- published beginner lessons that use sidecar-enriched XR selections. The
  low-level XR star picking plugin and XR browser facade now propagate
  bookmarkable `StarObjectRef` identity into pick events and product-backed
  selection, and `stars.pick.metadata` can enrich labels/facts from sidecar-like
  providers with `getMeta(ref)`.
- a journey runtime that drives `skykit:navigation.*` actions.
- published lesson docs that replace every legacy XR demo end to end.

Beginner-facing public API and future website lesson planning lives in
[`skykit-public-api-experience-plan.md`](./skykit-public-api-experience-plan.md).
