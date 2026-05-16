# XR Architecture

Status: current alpha package documentation for `@found-in-space/xr`.

This note describes the package boundary for XR-related functionality in the
alpha architecture.

The short version:

```txt
XR owns immersive embodiment, input, rays, motion, and spaceship semantics.
touch-os owns interactive and non-interactive visual surfaces.
renderers own their own rendering and pick math.
skykit owns composition and scale policy.
```

The package is:

```txt
@found-in-space/xr
```

The name is intentionally broad. The binding concept is not only navigation.
It is the immersive experience layer: body pose, controller input, spaceship
state, motion models, interaction rays, and the constraints WebXR imposes on
camera ownership.

---

## 1. Why XR Is Its Own Package

XR introduces concerns that are not just "viewer controls":

- WebXR owns headset camera pose.
- Physical space is meter-scale, while Found in Space data may be parsec,
  kiloparsec, AU, or arbitrary simulation scale.
- Controller input is pose-based and continuous.
- The user has a body, hands, a head, and potentially a ship frame.
- Motion comfort and motion simulation both matter.
- Picking is ray-based and often starts from a hand, head, or ship-mounted
  pointer.
- UI panels and HUDs need to be placed in immersive space, but the surface
  system itself belongs to touch-os.

These concerns are large enough to justify a package, but they should not turn
XR into a dumping ground for every homeless viewer feature.

---

## 2. Package Responsibilities

### XR Owns

`@found-in-space/xr` should own:

- WebXR-safe rig topology:
  spaceship, deck, XR origin, head/camera mount, body roots, attachment roots.
- Immersive body model:
  head pose, hand/controller poses, future torso/body frame, ship frame.
- Controller input:
  handedness, axes, buttons, grip poses, target-ray poses, deadzones.
- Ray sources:
  right-hand ray, left-hand ray, head gaze, ship-forward ray, custom ray
  sources.
- Generic interaction routing:
  blockers first, then pick targets, then app callbacks.
- Motion models:
  direct movement, inertial ship motion, thrust/mass flight, fly-to, route
  following, orbit, orbital-insert, look-at, and lock-at helpers where they are
  part of immersive motion.
- Quaternion-safe transforms:
  yaw, pitch, roll, translation, look-at, local/world frame transforms.
- Custom spaceship extension points:
  mount roots for ship geometry, deck props, effects, controller visuals, and
  app-owned objects.
- XR session helpers:
  support checks, reference-space defaults, enter/exit helpers, render-state
  and depth-range helpers when those are genuinely XR-specific.
- Scale profile consumption:
  motion and comfort code can understand the current navigation-to-meter scale
  without owning the data-layer scale policy.
- XR-safe diagnostics:
  support state, active reference space, current body/ship pose, controller
  bindings, scale profile, depth telemetry, and ray routing state.

### XR Does Not Own

`@found-in-space/xr` should not own:

- touch panels, HUD panels, or visual overlay surface rendering.
- star rendering, star shaders, or star geometries.
- star-specific picking math.
- picked-star highlight geometry, selection rings, labels, or callouts.
- octree loading, product streams, sidecars, or data providers.
- H-alpha, dust, galaxy, solar-system, or journey product logic.
- authored lesson/chapter state.
- final application composition.

---

## 3. Relationship To Other Packages

### touch-os

`touch-os` owns visual surfaces, whether interactive or not:

- hand-mounted panels
- head/HUD surfaces
- ship/deck panels
- wall displays
- scene-mounted screens
- canvas/texture/composite-surface lifecycle
- pointer/ray input into those surfaces
- blocking/hit information for surfaces that consume a ray

The target is that a touch-os surface can natively bind to XR placement and
input contracts without a special SkyKit wrapper.

XR may provide poses and rays. touch-os decides how surfaces are mounted,
rendered, interacted with, and whether a ray is consumed.

### three-star-field

`three-star-field` owns star rendering and star picking against its own product
geometries.

XR should provide a ray:

```js
const ray = rightHandRaySource.getRay(frame);
```

`three-star-field` decides whether that ray hits a star:

```js
const hit = starField.pick(ray);
```

This keeps XR generic. It can route rays to stars, meshes, panels, markers, or
future renderers without learning any star-specific rules.

### skykit

Core `skykit` owns composition:

- create the viewer
- create data providers
- create renderers
- create touch-os surfaces
- create XR rig/input/motion parts
- create scene anchor roots for origin-pinned, observer-centric, and
  scale-banded content
- wire scale profile, view state, product streams, and pick callbacks together

SkyKit also owns the scene's scale policy. XR can consume a scale profile, but
SkyKit decides whether navigation units currently mean parsecs, AU, meters,
kiloparsecs, or something lesson-specific. SkyKit also decides which content
root a layer belongs to; XR must not assume that all scene content lives under
one root.

### Data And Product Packages

Data packages remain independent:

- `star-octree-provider` streams star products.
- `star-products` interprets star products.
- `meta-sidecar-provider` resolves star metadata.
- future H-alpha, dust, galaxy, solar-system, and kinematics packages define
  their own product/provider lanes.

XR should not depend on those packages.

---

## 4. Rig And Body Model

The core XR mental model is still a spaceship, but the package should describe
it as a general immersive rig rather than hardcoding one app's ship.

```txt
scene
  -> origin content root
       Gaia stars and other physically located parsec/ICRS data
       local structures, routes, markers, and origin-pinned products

  -> observer-centric content root
       constellation art, skyculture images, angular grids, infinity-like
       overlays; follows observer translation without inheriting ship/head
       rotation

  -> scale-banded content roots
       galaxy-scale, H-alpha, dust, or context layers that recenter/update only
       at coarse movement thresholds

  -> navigation root / spaceship root
       custom ship mesh
       effects and app-owned ship objects

       -> deck root
            static deck offset and deck-fixed objects

            -> xr origin / head root
                 WebXR camera/head pose
                 controller roots

            -> attachment root
                 ship/deck-mounted app objects
```

Important rules:

- WebXR owns headset camera pose.
- The app moves the navigation/spaceship root, not the XR camera orientation.
- Scene content is not one undifferentiated root. Origin-pinned data,
  observer-centric sky layers, and scale-banded context layers need distinct
  anchor roots or equivalent anchoring helpers.
- Observer-centric roots should follow observer translation but should not be
  children of the spaceship if that would make them inherit ship/head rotation.
  Constellation art and other infinity-like layers must stay fixed in ICRS
  direction while remaining centered on the observer.
- Gaia/star-catalog content and other physically located features are
  origin-pinned unless a layer explicitly declares a different anchor policy.
- The deck offset is structural and stable; it is not recalculated each frame
  from the user's head pose.
- Controller visuals and hand-attached objects belong under the XR origin or
  controller roots so they move with the user's embodied frame.
- Custom spaceship geometry should be easy: users should be able to attach a
  ship mesh, cockpit, deck, particles, or props without replacing the rig.

The body model should start simple:

```ts
interface XrBodyModel {
  head: XrPose | null;
  leftHand: XrHandPose | null;
  rightHand: XrHandPose | null;
  ship: XrPose;
  torso?: XrPose | null;
}
```

First alpha may only fill head and controller poses. Naming the body model now
keeps room for torso estimation, hand tracking, comfort locomotion, and body
relative interactions later.

---

## 5. Motion Models

Motion is a first-class extension point. The package should not assume the only
valid motion model is direct translation.

Useful built-ins:

- implemented now: direct/free movement, inertial movement, thrust and mass
  based ship motion, fly-to target, route following, orbit, orbital insert,
  look-at, and lock-at helpers.

The shape should allow applications to replace the model:

```ts
interface XrMotionModel {
  update(input: {
    pose: XrNavigationPose;
    body: XrBodyModel;
    controls: XrControlsState;
    deltaSeconds: number;
    scale: XrScaleProfile;
  }): XrNavigationPose;
}
```

This lets a teaching demo use simple movement while a game can model thrust,
mass, drag, fuel, autopilot, or ship damage without forking the whole XR stack.

All orientation and rotation should be quaternion-based. No Euler/gimbal-lock
paths should become part of the public contract.

---

## 6. Scale Profile

XR should not own parsec-to-meter policy, but it needs a hook into it.

SkyKit or the application supplies a scale profile:

```ts
interface XrScaleProfile {
  navigationUnits: 'pc' | 'au' | 'm' | 'kpc' | string;
  metersPerNavigationUnit: number;
  worldUnitsPerNavigationUnit?: number;
}
```

Motion plugins can then reason about both semantic speed and physical comfort:

```txt
navigation speed: 4 pc/s
immersive perceived speed: 4 m/s at the current scale
```

XR may use this profile for:

- motion speed and acceleration reporting
- comfort limits in meters per second
- controller ray lengths
- depth range calculations
- ship effects that depend on perceived speed

SkyKit remains responsible for telling renderers and data providers what scale
means in their own coordinate systems.

---

## 7. Rays, Blocking, And Picking

Picking in XR is not star-specific. The generic problem is:

```txt
ray source -> blockers -> pick targets -> app callback
```

Ray sources may be:

- right-hand controller
- left-hand controller
- head gaze
- ship-forward ray
- custom app ray

Blockers are usually touch-os surfaces. If a ray hits an interactive panel,
that panel should consume or shorten the ray so it does not also pick a star
behind the panel.

Pick targets are renderer-owned:

- `three-star-field` can pick stars.
- a mesh layer can raycast meshes.
- a marker layer can pick markers.
- a game can supply its own target list.

XR owns the routing mechanics and visual affordances such as a laser pointer.
It does not own the meaning of every possible hit.

Target-specific hit effects should remain target-owned. For example, a picked
star ring, label, or callout should come from `three-star-field`, an anchored
image/marker layer, touch-os, or application code. XR can expose the selected
ray and route the event; it should not become the universal selection-rendering
package.

Example shape:

```js
const pickRouter = createXrPickRouter({
  raySource: xr.rightHandRay(),
  blockers: [touchSurface],
  targets: [starField, markerLayer],
  onPick(hit) {
    app.select(hit);
  },
});
```

---

## 8. Control Bindings

Useful teaching defaults:

- right stick: translation/thrust
- left stick: attitude
- left grip modifier: roll instead of yaw
- right trigger: select
- left hand: tablet/surface placement

Those defaults are not hard-coded semantics. The XR package exposes configurable
control bindings as a clear public surface.

The important split is:

```txt
raw WebXR input sources
  -> named control state
  -> motion / picking / app actions
```

Students should not need to learn WebXR `inputSources`, gamepad axis arrays,
button indices, handedness quirks, and deadzone handling before they can add a
new cockpit action. They should be able to name a control and wire behavior to
that name.

```ts
interface XrControlBindings {
  axes?: Record<string, XrAxisBinding>;
  buttons?: Record<string, XrButtonBinding>;
  deadzone?: number;
}

interface XrAxisBinding {
  hand: 'left' | 'right' | 'any';
  stick?: 'primary' | 'secondary';
  axes?: [number, number];
  invertX?: boolean;
  invertY?: boolean;
}

interface XrButtonBinding {
  hand: 'left' | 'right' | 'any';
  button: 'trigger' | 'grip' | 'primary' | 'secondary' | number;
}
```

Example:

```js
const controls = createXrControlBindings({
  axes: {
    move: { hand: 'right', stick: 'primary' },
    attitude: { hand: 'left', stick: 'primary' },
  },
  buttons: {
    select: { hand: 'right', button: 'trigger' },
    rollModifier: { hand: 'left', button: 'grip' },
    boost: { hand: 'right', button: 'grip' },
    toggleMap: { hand: 'left', button: 'primary' },
  },
});
```

Motion models consume named controls, not raw gamepad slots:

```js
const motion = createInertialShipMotionModel({
  moveAxis: 'move',
  attitudeAxis: 'attitude',
  rollModifier: 'rollModifier',
  boostButton: 'boost',
});
```

Applications and lessons can add behaviors by name:

```js
controls.on('toggleMap', ({ pressedEdge }) => {
  if (pressedEdge) {
    mapSurface.toggle();
  }
});

controls.on('boost', ({ pressed }) => {
  shipEffects.setBoosting(pressed);
});
```

The binding layer should be:

- declarative: bindings are plain data.
- named: behavior refers to `boost`, `select`, `move`, etc.
- remappable: controls can be changed without replacing the motion model.
- inspectable: snapshots/debug output show current bindings and live values.
- event-capable: button edges and held states are both easy to observe.
- polling-capable: motion models can read axis/button state each frame.
- teachable: examples can add one new button behavior in a few lines.

This lets lessons swap hands, support alternative controller layouts, or add
game-specific controls without replacing the whole XR package.

Head pose and ship pose must also remain distinct. Physical head yaw/pitch is
useful for gaze, targeting, and comfort, but it should not silently steer ship
thrust unless the selected motion model asks for that. The old implementation's
important lesson was that ship motion can remain in ship coordinates even while
the user looks around inside the cockpit.

---

## 9. Session And Render Helpers

Some WebXR mechanics are useful enough to expose from the XR package:

- `isXrModeSupported(mode)`
- `enterXrSession({ mode, referenceSpaceType, sessionInit })`
- `exitXrSession()`
- reference space defaults such as `local-floor`
- frame pose extraction helpers
- render-state helpers for near/far depth planes
- depth telemetry for debugging

These helpers must remain renderer/runtime friendly. They should not require a
star viewer, touch surface, or SkyKit lesson.

Core SkyKit may wrap them in friendly viewer factories, but the lower-level XR
package should stay useful to games and custom Three.js applications.

The alpha package also exposes `applyXrDepthRange()` as a small render-state
bridge. It accepts a computed XR depth range and a session/session handle, calls
`updateRenderState({ depthNear, depthFar })` when available, and reports whether
the update was applied. This keeps render-state mutation explicit instead of
hiding it inside the depth calculation itself.

Depth helpers deserve special care. XR far-plane sizing should be
domain-neutral:

```txt
visible bounds / anchor root diagnostics + scale profile + near/far policy
  -> XR render-state depth range + telemetry
```

The helper may accept bounds from star selections, marker layers, sky spheres,
or other products, but it should not import the star provider. It should report
when a minimum or maximum clamp was applied so demos can diagnose missing or
clipped content.

---

## 10. Renderer Readability Is Not XR Ownership

Headset readability often benefits from renderer tuning:

- stronger exposure
- nearby magnitude floors
- nearby minimum point size / alpha floors
- hyperlocal star-size caps
- clip/depth readability tweaks

Those behaviors are important, but the XR package should not own star shader
policy. XR supplies:

- body/head/camera pose
- current scale profile
- render-state/depth telemetry
- ray/input state

Renderer packages decide how to use that information. `three-star-field` may
offer an XR-friendly material profile, while other renderers may do something
entirely different.

---

## 11. Desktop Relationship

The XR package is not a general desktop controls package.

It may include desktop-compatible helpers only when they exercise the same
contracts:

- previewing a spaceship rig without a headset
- testing motion models outside WebXR
- using mouse rays as a stand-in for controller rays
- running unit tests for body/ray/motion logic

Normal desktop camera controls can live in core SkyKit or another composition
layer unless they genuinely share the XR embodiment model.

---

## 12. Current Implementation Status

`@found-in-space/xr` implements:

- plain ESM package with hand-written `.d.ts`.
- XR rig/body roots and custom spaceship mount points.
- controller input helpers for axes, buttons, grip pose, and target rays.
- named, declarative, inspectable, remappable control bindings.
- direct, inertial, thrust, fly-to, route-follow, orbit, orbital-insert,
  look-at, lock-at, and navigation-automation motion helpers.
- ray sources and generic pick router with blocker support.
- scale profile consumption.
- WebXR session helpers, domain-neutral depth telemetry, and explicit
  render-state depth application.
- tests using fake XR frame/session/input-source objects.

Integration with the alpha `@found-in-space/skykit` composition layer should
happen through public rig, motion, ray, and session helpers.

---

## 13. Design Rules

Use these rules when deciding whether a feature belongs in XR:

```txt
Does it describe immersive embodiment, controller/body input, ship motion,
XR session state, or generic ray routing?
  -> XR package

Does it draw or manage a visual surface, panel, HUD, or embedded display?
  -> touch-os

Does it render stars or decide which star a ray hit?
  -> three-star-field / star-products

Does it load data or stream products?
  -> provider package

Does it compose packages into a lesson or viewer?
  -> skykit or journey
```

This keeps XR broad enough to be useful, but narrow enough not to become a
dumping ground.
