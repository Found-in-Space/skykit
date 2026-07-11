# XR And Spatial Architecture

Status: current `0.2.0` package boundary, stable touch-os `0.3.0`
integration, and the remaining SkyKit `0.3.0` composition target.

This note defines the split between shared spatial navigation and WebXR-specific
runtime behavior.

The public website remains pinned to stable SkyKit `0.2.0` while this repository
develops the broader `0.3.0` XR API. The repository bridge and examples resolve
the published `@found-in-space/touch-os@0.3.0` package by default; they do not
silently alias a sibling source checkout. Repository examples and deterministic
fake-XR/browser tests validate the new API until a coordinated stable SkyKit
release is available. See
[`releasing.md`](./releasing.md#public-website-version-policy).

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
- canonical route planning and route-follow automation with explicit timing.
- orbit and orbital-insertion helpers.
- look-at and lock-at orientation automation.
- distinct direct, inertial, and thrust manual motion models.
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
  enter/exit actions, ray visualization, and generic interaction routing. The
  current alpha also contains a star-picking composition adapter; the `0.3.0`
  target moves renderer-specific picking behind a `three-star-field`-owned pick
  target.
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
  evaluateSpatialAim,
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
- route-follow, orbit, orbital-insertion, look-at, and lock-at automation over
  canonical spatial objects.
- distinct direct, inertial, and thrust manual motion models.
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
- `stars/xr-pick`, `stars/xr-pick-miss`, and blocker events for applications to
  handle without renderer-specific controller code.
- fake-XR tests for rig, controls, rays, routing, depth, and sessions.

Implemented at the touch-os `0.3.0` bridge boundary:

- a canonical millisecond clock derived from `SkykitThreeFrame.elapsedSeconds`
  for panel frames, DOM edges, XR samples, clearing, and cancellation;
- one driver update, and therefore one driver-owned runtime tick, for each
  SkyKit part update;
- `raw-actions`, `app-actions`, and `none` output policies, with exactly-once
  output observation and a single validated app-action registry route;
- full-SkyKit-frame root, parent, anchor, metrics, and pointer-source
  resolution before construction of the reduced touch-os host frame;
- immediate pointer clearing and cancellation-output draining on tracking or
  session loss, reversible detach, and final disposal;
- current-mesh geometric `blockRay()` queries that do not dispatch panel input
  or mutate pointer capture;
- owned plugin-created runtimes/drivers and borrowed caller-supplied
  runtimes/drivers/pointer sources;
- borrowed caller-supplied XR ray sources in ray-visual and picking plugins,
  while internally created sources remain owned.

The `xr-free-roam/?skykit-test=1` browser mode is deliberately narrower than
immersive coverage. Its synthetic head-anchored panel and browser-test pointer
verify deterministic tablet, app-action, surface, visibility, and rendering
behavior through normal panel frames. It does not emulate a native session,
reference-space changes, headset/controller tracking, runtime controller
profiles, compositor behavior, or headset rendering.

Current composition gaps:

- a single turnkey SkyKit XR starfield preset.
- one shared per-viewer XR runtime for session, body, input, and interaction
  state.
- explicit reference-space versus navigation-space pose and ray types.
- one authoritative interaction route shared by panels, stars, app objects, and
  ray visuals.
- full shared-runtime ownership semantics beyond the implemented supplied
  ray-source cases.
- semantic XR input mapping separated from spatial motion behavior.
- a guided-journey adapter that moves the navigation rig with XR comfort policy.
- published lesson docs that replace every legacy XR demo end to end.

---

## 7. `0.3.0` Composition Goal

The low-level XR factories remain useful, but a learner should not have to wire
the same camera, rig roots, reference-space state, controls, rays, blockers,
renderer loop, and cleanup into every feature.

The `0.3.0` target is:

```txt
turnkey XR browser
  -> exposes the ordinary viewer, renderer, provider, star field, and XR runtime
  -> accepts normal app plugins and replaceable XR components
  -> is built from the same public factories as the deep composition path

shared XR runtime
  -> owns per-viewer session/body/input/interaction state
  -> updates native WebXR state once per frame
  -> exposes inspectable public handles

focused adapters
  -> map XR input to semantic SkyKit controls/actions
  -> adapt touch-os surfaces and renderer-owned pick targets
  -> never move domain ownership into XR
```

Do not introduce a hidden factory registry or an XR-only viewer implementation.
The preset is a readable composition of normal SkyKit, spatial, renderer, and
Touch OS APIs.

---

## 8. Shared `SkykitXrRuntime`

Create one shared runtime per viewer:

```js
const xr = createSkykitXrRuntime({
  camera,
  navigation: { model: 'direct' },
});

const viewer = await createSkykitViewer({
  host,
  renderer,
  observerRig: xr.observerRig,
  plugins: [
    xr.plugin,
    stars,
    myPanel,
  ],
});
```

The runtime should expose ordinary public handles rather than an opaque facade:

```txt
rig
observerRig
session
body
input
rays
interactions
plugin
getSnapshot()
dispose()
```

The runtime owns frame coordination. It reads the session, reference space,
viewer/head pose, hands, controller buttons/axes, and registered rays once per
XR frame. Consumers read immutable snapshots or subscribe to changes; they do
not independently mutate shared edge-tracking state.

The session handle must observe native `end` events and publish the same
`xr/session-end` lifecycle used by an explicit `exit()`. App cleanup must not
depend on which actor ended the session.

### Viewer topology integration

The XR observer rig should expose the canonical SkyKit `roots`,
`navigationRoot`, and `cameraMount` fields already allowed by the observer-rig
contract. `createSkykitViewer()` should derive its roots and camera mount from the
observer rig unless the application explicitly overrides them.

Precedence is explicit viewer option, then observer-rig value, then the core
desktop default.

Core and XR must use the same live `Map<string, Object3D>` contract for
scale-banded roots. A scale-band root created after viewer startup must be
mounted into the scene through a public root-registration path; copying a
`Record` into a `Map` at startup is not sufficient.

The deep path may still pass roots and camera mounts explicitly for unusual scene
graphs, but the normal XR composition should need only `observerRig`.

### Resource ownership

Ownership follows one rule across XR factories and plugins:

```txt
created internally -> owner disposes it
supplied by caller  -> consumer borrows it
```

Removing a ray visual, picker, panel, or input adapter must not dispose a shared
ray source, controls handle, runtime, or session supplied by the application.
Where transfer of ownership is useful, it must be an explicit option rather than
an implicit side effect.

The current ray visual and star-picking plugins already apply this rule to ray
sources: a source passed by the application is borrowed, while one created by
the plugin is owned and disposed idempotently. The touch-os bridge applies the
same origin rule to runtimes and drivers, with explicit `disposeRuntime` and
`disposeDriver` overrides. Supplied panel pointer sources are borrowed and may
be cleared during cancellation, but are never disposed implicitly.

Because runtime output draining remains a bridge responsibility, a supplied
touch-os driver must be paired with the same supplied runtime used to construct
it. Its pointer sources and construction options are configured before it is
passed to SkyKit.

---

## 9. Coordinate Spaces And Units

Do not alias tracked WebXR poses to parsec navigation poses.

Use distinct contracts:

```txt
SpatialPose
  observerPc + orientationIcrs
  parsec/ICRS navigation semantics

XrReferencePose
  positionMeters + orientation
  WebXR reference-space semantics

RenderWorldPose
  positionWorldUnits + orientation
  Three.js scene/render semantics
```

Rays carry the same clarity:

```ts
type SkykitRaySpace = 'xr-reference' | 'render-world' | 'icrs';
```

A ray includes its space and unit semantics. The XR runtime owns explicit
conversion helpers between reference space, render world, and ICRS/navigation
space using the active rig and scale profile. Applications should not need a
custom wrapper merely to turn a controller ray into a world-space ray.

Head and hand tracking remains reference-space input. Ship/navigation actions
remain navigation-rig-frame intent. A plugin may deliberately map head gaze to
a ship action, but that mapping is visible and optional.

---

## 10. Input And Motion Composition

Separate native input interpretation from motion behavior:

```txt
WebXR axes/buttons/poses
  -> XR binding adapter
  -> typed SkyKit actions and controls
  -> shared spatial motion/navigation plugin
  -> navigation rig pose
```

The XR binding adapter owns handedness, component indices, deadzones, button
edges, and profile-specific defaults. It writes semantic controls such as
`SKYKIT_CONTROLS.ship.move` and `SKYKIT_CONTROLS.ship.attitude`, and invokes
semantic actions for discrete commands. Session exit or tracking loss releases
all action presses owned by that input source and resets its analog controls.

The motion consumer owns direct, inertial, or thrust behavior and makes the
control frame explicit. Desktop keyboard, Touch OS, gamepads, XR, automation,
and games can then drive the same motion model. `createSkykitXrNavigationPlugin`
should become a convenience composition of the binding adapter and shared motion
behavior, not a second private navigation implementation.

At the current panel boundary, a SkyKit-aware touch-os pointer source resets its
local control edges and ray state when the session, tracking pose, or resolved
ray disappears. Native and explicit session end use the same cleanup direction:
reset the source, call the panel's `clearPointer()` immediately, and drain the
resulting action release. The pointer ID can then be reused on re-entry without
stale pressed or capture state.

Built-in action and control payloads should have public TypeScript contracts.
Application namespaces remain open for custom actions.

---

## 11. Authoritative Interaction Routing

One interaction service should route each source sample:

```txt
controller / hand / gaze ray
  -> ordered blockers and interaction targets
      -> Touch OS panel
      -> app object
      -> star-field pick target
  -> one route result
      -> selection/action output
      -> ray visual length/state
      -> diagnostics
```

The router needs composable registration rather than replacement-only arrays:

```txt
addSource(source, options?) -> teardown
addBlocker(blocker, options?) -> teardown
addTarget(target, options?) -> teardown
subscribe(listener) -> teardown
```

Ordering, pointer ownership, capture, blocking, and fallthrough are explicit.
Touch OS already owns panel-local interaction and pointer claim semantics; its
SkyKit adapter registers a panel with the XR interaction service. XR does not
render or interpret the surface.

`three-star-field` should expose a renderer-owned generic pick target or adapter.
The XR router supplies the ray and view context. Selection events should use the
same semantic result and stable `StarObjectRef` identity across mouse, touch, and
XR instead of creating an XR-only star identity or UI contract.

Ray visuals observe the authoritative route result. They do not rerun blocker
tests, and removing a visual does not change interaction behavior.

### Current independent-panel path

The broader authoritative router above remains a composition target. The
current SkyKit touch-os adapter exposes each panel as an independent blocker.
Its `blockRay(ray, context)` creates a geometric answer for that supplied ray by
raycasting the driver's current public mesh, normalizing direction, selecting
the nearest intersection, and honoring both `ray.length` and
`context.maxDistance`. It does not read the cached pointer hit, dispatch touch
input, or alter capture; `getHit()` is only cached current-pointer inspection.

One continuous pointer-source instance belongs to one independent panel plugin.
Applications that need one source to coordinate several touch-os panels should
use touch-os's public panel coordinator/session path. This migration does not
add a competing SkyKit multi-panel coordinator before the authoritative router
exists.

---

## 12. Turnkey XR Browser

Add a thin beginner entrypoint under the optional XR subpath:

```js
const sky = await createSkykitXrBrowser({
  host: '#viewer',
  plugins: [myLessonPlugin],
});

enterButton.addEventListener('click', () => sky.xr.enter());
```

It returns the normal composition handles:

```txt
viewer
xr
renderer
camera
provider
starField
loop
install(plugin)
dispose()
```

The preset should provide a streamed star field, WebXR-safe topology, renderer
animation loop, support/session actions, a documented controller profile,
reasonable depth policy, and a basic interaction ray. Session entry stays lazy
and user-initiated. Before entry, after exit, and when immersive XR is unsupported
or denied, it remains a functioning desktop viewer.

Every convenience is replaceable through an ordinary provider, renderer,
strategy, rig/runtime component, input binding, interaction target, depth policy,
or plugin. Supplying a custom component must not require forking the preset.

The public website should gain an XR lesson only after stable `0.3.0` is
published. Until then, the repository owns the reference example and fake-XR
coverage.

---

## 13. Guided Journeys In XR

XR consumes the shared guided-journey controller described in
[`chapter-and-camera-timeline-architecture.md`](./chapter-and-camera-timeline-architecture.md).
It does not own a separate journey schema.

The SkyKit XR journey adapter:

- moves the navigation rig, never the headset camera;
- resolves chapter camera intent through the shared navigation controller;
- may apply an explicit comfort policy such as smooth travel, shortened travel,
  fade/teleport, or confirmation;
- presents journey state through replaceable Touch OS, voice, controller, or
  application UI;
- preserves the same chapter IDs, history, readiness, and app-owned hooks used on
  desktop.

Comfort policy is runtime/participant policy, not authored astronomical data.
Journey content may state intent and allowable alternatives, but it should not
hard-code a headset-specific locomotion implementation.

---

## 14. `0.3.0` Delivery Plan

### Phase 1: topology, spaces, and ownership

- Complete the observer-rig roots/camera-mount seam.
- Unify the scale-band root contract and dynamic mounting.
- Introduce reference-space pose and tagged ray types with conversions.
- Correct stale example pose fields as the new contracts land.
- Standardize borrowed versus owned resource disposal.
- Propagate native session-end lifecycle.

### Phase 2: shared runtime and semantic input

- Add `SkykitXrRuntime` and update body/input state once per frame.
- Split XR bindings from shared motion behavior.
- Type built-in control values and document their frames.
- Keep direct low-level body, controls, ray, and session factories available.

### Phase 3: interaction composition

- Make one router the authoritative source/target/blocker service.
- Add dynamic registration and route-result subscriptions.
- Adapt Touch OS panels without moving surface ownership into XR.
- Move renderer-specific star picking to a renderer-owned target and use stable
  star identity.

### Phase 4: beginner preset and lessons

- Build `createSkykitXrBrowser()` from public factories.
- Reduce the current XR free-roam example to preset plus visible app-owned
  customization.
- Add a deeper example that replaces input, interaction, and panel pieces.
- Add fake-XR lifecycle, ownership, routing, and session-end tests.

### Phase 5: stable release and website migration

- Publish the coordinated stable `0.3.0` package batch.
- Migrate the website's exact pins in a separate reviewed change.
- Add a user-initiated XR quickstart and fallback lesson to the website only
  after the stable APIs are available.

---

## 15. Acceptance Criteria

The `0.3.0` XR composition slice is ready when:

- a default streamed-star XR viewer needs no manual root mapping, camera mount,
  ray-space wrapper, or renderer-loop wiring;
- the preset returns the normal viewer and all replaceable component handles;
- head/hand reference poses cannot be confused with parsec navigation poses in
  the public types;
- type tests reject a ray supplied to a target that requires a different space;
- body and controller edge state is updated once per frame and safely shared;
- removing one consumer never disposes a caller-owned shared resource;
- XR controls drive the same semantic action/control and spatial motion behavior
  as desktop and Touch OS;
- panels, stars, and app objects share one ordered interaction result;
- ray visuals observe routing without repeating it;
- native and explicit session exit publish the same lifecycle;
- unsupported or denied XR leaves the preset usable as a desktop viewer;
- a guided journey uses the same chapter controller on desktop and in XR;
- all deep XR factories remain directly usable;
- the public website remains on `0.2.0` until stable `0.3.0` is published.
