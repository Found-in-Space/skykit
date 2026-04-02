# XR Architecture

This document covers WebXR-specific concepts in SkyKit. For the general viewer architecture (data services, interest fields, layers, embedding API), see [viewer-architecture.md](viewer-architecture.md).

## Why A Separate Document

XR introduces constraints and structures that don't apply to desktop rendering:

- WebXR owns the camera pose — you cannot set `camera.rotation` or call `camera.lookAt()`
- Physical space is meter-scale while the star field is parsec-scale
- Input comes from tracked controllers, not mouse/keyboard
- The player exists in a physical room while navigating astronomical distances
- Depth buffer precision matters across wildly different distance scales

These concerns are orthogonal to the data pipeline, interest fields, and layer system, so they live here rather than cluttering the general architecture.

## Separate Viewer Instances

Desktop and XR are **separate viewer instances**, not modes of the same viewer. An XR viewer is created with the spaceship rig from the start — it does not share a canvas with a desktop viewer or transition seamlessly between desktop and VR rendering.

A typical XR page presents configuration UI and a "Enter VR" button rather than a live desktop canvas. The `ViewerRuntime` may be created headless or deferred until the XR session starts. On session end the viewer disposes or returns to the options UI — there is no "fall back to desktop rendering" path.

Desktop and XR viewers may share a `DatasetSession` (data caching and fetch infrastructure), which is safe because `DatasetSession` has no knowledge of rigs, cameras, or scene graphs. They use the same _types_ of reusable modules (interest fields, layers, star picker, scene orientation), but each viewer creates its own instances — no runtime object other than `DatasetSession` is shared between them. A change to the desktop viewer or rig should never require a corresponding change to XR code, and vice versa.

## The Spaceship Model

The central abstraction for XR is the **spaceship**: an invisible reference frame that carries the player through the universe.

The spaceship:

- has a position in parsec space (`observerPc`)
- has an orientation (quaternion) that defines "spaceship forward"
- may have velocity for inertial flight
- has **no visible geometry** in the current version — it is purely a coordinate frame

The player stands on the spaceship's deck. Their physical room movements are local to the deck. When the spaceship moves, everything moves with it — the player, their controllers, and their view of the stars.

This solves a class of recurring bugs where XR controllers, pointer lasers, or HUD elements detach from the player because they were parented incorrectly in the scene graph.

### Scene Graph

```
scene
  ├── universe                      ← Group: contentRoot (stars, constellation art)
  │                                    scaled by starFieldScale / SCALE
  │                                    stays at the scene origin
  │
  └── spaceship                     ← Group: navigationRoot, MOVES through the universe
        └── deck                    ← Group: structural offset (observer DOWN and BACK)
              ├── xrOrigin          ← Group: WebXR local-floor reference point
              │     ├── camera      ← PerspectiveCamera: headset pose (WebXR-driven)
              │     │     └── headHud (optional: visor overlay, always faces user)
              │     │
              │     ├── leftController   ← XR input source (grip or target ray space)
              │     │     └── controlPanel (optional: wrist display, attached UI)
              │     │
              │     └── rightController
              │           └── controlPanel (optional: attached UI)
              │
              └── attachmentRoot    ← deck-fixed UI and overlays
```

The universe and the spaceship are **siblings** under the scene — the same topology as the desktop rig. The universe stays at the scene origin while the spaceship moves to represent the observer's position. This matches the physical intuition: the universe contains the spaceship, not the other way around.

### Mapping To Runtime Rig

The XR rig is built at viewer creation time using `createXrRig(camera, options)` from `src/core/runtime-rig.js`. It uses the same **sibling topology** as the desktop rig — `contentRoot` and `navigationRoot` are independent trees, both added to the scene. The differences from desktop are the universe scale factor and the `deck` group. The rig is passed to `ViewerRuntime` via the `rig` option.

| Spaceship concept | Runtime name | Role |
|---|---|---|
| `spaceship` | `navigationRoot` | Top-level group; **moves** to represent the observer's position |
| `deck` | `deck` | Structural offset: shifts observer DOWN and BACK so Sun appears at eye level |
| `xrOrigin` | `cameraMount` | Where WebXR places the camera and controllers |
| `attachmentRoot` | `attachmentRoot` | Deck-fixed UI and overlays, child of `deck` |
| `headHud` | (future) | Head-locked UI, child of camera |
| controllers | (managed by `xr-pick-controller`) | XR input source target ray / grip spaces, children of `cameraMount` |
| `universe` | `contentRoot` | Stars and scene content, **sibling** of spaceship, stays at scene origin, scaled for XR |

### Why This Structure Matters

- **Universe and spaceship are siblings**, matching the physical intuition that the universe contains the spaceship. Moving the spaceship moves the observer (and everything attached to it) relative to the stationary stars.
- **Locomotion moves the spaceship, not the universe.** `XrLocomotionController` sets `navigationRoot.position` to the observer's scene-space position. The universe stays at the scene origin. Stars appear to move past the player because the camera (inside the spaceship) moves relative to the stationary star field.
- **The `deck` offset shifts the observer DOWN and BACK.** The deck position is `(0, -eyeLevel, +forwardOffset)`, which moves the camera below and behind the universe origin (the Sun). This makes the Sun appear at eye level and slightly in front — the observer looks up at the Sun rather than the universe being pushed down to meet them.
- **The `deck` offset is static**, not recalculated per frame based on head orientation. It is a fixed structural property of the spaceship, set once at rig creation.
- **Controllers are children of `xrOrigin`**, which is inside `spaceship`. Laser pointer and ring sprite visuals are parented to `cameraMount` (xrOrigin) by `createXrPickController`, ensuring they move correctly during locomotion.

## Scale Conventions

Three scale values interact in XR:

| Constant | Value | Meaning |
|---|---|---|
| `SCALE` | 0.001 | Octree internal convention: 1 pc = 0.001 world units. Used by desktop rendering and the data pipeline. |
| `DEFAULT_METERS_PER_PARSEC` | 1.0 | XR default: 1 meter of physical space ≈ 1 parsec. Tunable at runtime. |
| `starFieldScale` | runtime state | The active XR scale. Defaults to `DEFAULT_METERS_PER_PARSEC`. Changing this lets the user zoom in/out. |

The relationship:

- `contentRoot.scale` is set to `starFieldScale / SCALE` — this converts from octree coordinates to XR meters
- When `starFieldScale = 1.0`, walking 1 meter in the real world moves you roughly 1 parsec through the star field
- Increasing `starFieldScale` makes the star field larger (stars spread out); decreasing it compresses them

The pick controller and star-field shader both read `starFieldScale` from runtime state so they stay in sync when the scale changes.

## WebXR Integration

### Reference Space

SkyKit uses `local-floor` as the default XR reference space:

- Y = 0 is the physical floor
- The origin is approximately where the user was standing when the session started
- Head and controller poses are reported relative to this origin

### Session Lifecycle

1. The XR page creates a `ViewerRuntime` with the XR rig topology and XR-configured controllers
2. `ViewerRuntime.enterXR()` requests an `immersive-vr` session with `local-floor`
3. The renderer switches to WebXR's animation loop (`setAnimationLoop`)
4. Near/far clip planes are set for XR distances (default: 0.25m near, 10000m far)
5. The camera-rig controller runs in XR update mode for the lifetime of the session
6. On session end, the viewer disposes or the page returns to its options UI — there is no desktop rendering fallback

### Depth Planes

With `starFieldScale ≈ 1.0`, the XR depth planes are:

- **Near**: 0.25m — close enough for controller-attached UI, far enough to avoid nose clipping
- **Far**: 10,000m — covers stars thousands of parsecs away after scaling

Controller-attached panels and head HUD use `depthTest: false` with high `renderOrder` to render on top of the star field without z-fighting.

## Input Handling

### Controllers

XR controllers are accessed through `session.inputSources`. Each source provides:

- `targetRaySpace` — the pointing direction (used for the laser/pick ray)
- `gripSpace` — the physical hand position (used for attached UI)
- `gamepad` — thumbstick axes and button states

The XR pick controller (`xr-pick-controller.js`) creates a laser `Line` and a ring `Sprite` **parented to `cameraMount` (xrOrigin)**, not to the scene root. It uses the **right** controller (`handedness = 'right'`). On each frame it:

1. Gets the right controller ray from `targetRaySpace`
2. Queries `getLaserOverride()` — if the tablet controller reports a hit, the laser is shortened to the panel surface and star picking is suppressed
3. Updates the laser visual (full length or shortened)
4. On trigger press (when not blocked by the tablet), runs the star picker against the ray
5. Updates the selection ring at a comfortable HUD distance along the pick direction

### Tablet (Hand Menu)

The XR tablet controller (`xr-tablet-controller.js`) renders a canvas-texture panel attached to the **left** controller's grip space. The right controller's laser pointer interacts with it.

The panel is a `THREE.Mesh` with `PlaneGeometry` (0.20m × 0.28m), using `depthTest: false` and high `renderOrder` to render above the star field. The canvas texture is only redrawn when hover/press state changes.

On each frame:

1. Read the left controller's `gripSpace` pose and position the panel mesh
2. Read the right controller's `targetRaySpace` ray and intersect it with the panel plane
3. Convert the intersection to UV coordinates and map to a button/toggle item
4. On right trigger press over a hovered item, fire the item's action via `onChange(id, value)`

The tablet controller runs **before** the pick controller in the update loop. It exposes `getHit()` which returns `{ length, blocked: true }` when the pointer ray hits the panel, or `null` otherwise. The pick controller calls this via `getLaserOverride` to shorten its laser and suppress star picks.

Items are plain config objects:

```js
{ id: 'constellations', label: 'Constellations', type: 'toggle', value: false }
{ id: 'fly-home', label: 'Fly Home', type: 'button' }
```

Supported types: `toggle` (boolean flip) and `button` (momentary action).

### Locomotion

Thumbstick locomotion is handled by `XrLocomotionController` (`xr-locomotion-controller.js`):

1. Read thumbstick axes from `inputSources` via `readXrAxes()`
2. Compute movement direction relative to the **head** orientation (current implementation) or **spaceship** orientation (future option)
3. Advance the observer's position in parsec space via the shared `camera-rig.js` math
4. Set `navigationRoot.position` (the spaceship) to the observer's scene-space position

The universe stays at the scene origin. The spaceship moves to represent the observer's position, and everything attached to it — the camera, the deck, the controllers — moves with it. The player can also walk around on the "deck" (room-scale movement within the playspace) for local movement within the spaceship.

### Controller Separation

Desktop and XR input handling are in **completely separate files** with no shared code paths:

| Concern | Desktop file | XR file |
|---|---|---|
| Navigation | `camera-rig-controller.js` | `xr-locomotion-controller.js` |
| Star picking | `pick-controller.js` | `xr-pick-controller.js` |
| Hand menu | — | `xr-tablet-controller.js` |

Both sides share `camera-rig.js` for pure quaternion math and position tracking, but never import each other. A change to the desktop controller cannot affect XR, and vice versa.

## Structural Offsets

Two fixed offsets position the star-field origin relative to the player:

| Constant | Default | Purpose |
|---|---|---|
| `XR_SUN_EYE_LEVEL_M` | 1.6 | Raises the origin to approximate standing eye level, so the Sun appears at face height rather than at the floor |
| `XR_SUN_FORWARD_OFFSET_M` | 0.5 | Shifts the origin forward so the Sun sits slightly in front of the player — equivalent to taking a half-step back |

These are applied as the `deck` group's position `(0, -eyeLevel, +forwardOffset)`, set once when the XR rig is created. The negative Y shifts the observer DOWN so the Sun appears UP at eye level; the positive Z shifts the observer BACK so the Sun appears slightly in front. These are structural properties of the deck, not dynamic per-frame calculations.

Both values are configurable via options on the XR rig factory.

## Current Scope

The current XR implementation is deliberately minimal:

**Included:**

- Spaceship as invisible reference frame with orientation and velocity
- Head tracking (camera pose from WebXR)
- Two controllers with assigned handedness (right = laser/pick, left = tablet)
- Right-hand laser pointer and star picking, with tablet-aware laser shortening
- Left-hand tablet (hand menu) with canvas-texture UI, toggle and button items
- Thumbstick locomotion
- Tunable star-field scale
- Controller-attached UI (panels parented to grip space)
- Head-locked HUD (elements parented to camera)

**Not yet included:**

- Visible spaceship geometry (floor, panels, hull)
- Body tracking or inferred torso orientation
- Multi-pass rendering with separate depth ranges
- `THREE.Layers` bitmask filtering
- Hand tracking
- AR placement or passthrough

## Agent Rules

These rules apply when modifying XR-related code:

1. **Never mutate the camera directly for VR orientation.** In WebXR, the headset overrides `camera.rotation`, `camera.quaternion`, `camera.lookAt()`, and `camera.up`. Move the rig, not the camera.

2. **Always use the spaceship rig.** The camera must be a descendant of the spaceship group. Never add the camera directly to the scene. XR viewers must be created with the XR rig topology — do not reuse the desktop rig.

3. **Parent controllers inside `xrOrigin`.** Controller visuals (laser, attached UI) must be children of the XR origin group (`cameraMount`), which itself is inside the spaceship. Never add controller objects directly to the scene root.

4. **Keep the deck offset static.** The `deck` group position `(0, -eyeLevel, +forwardOffset)` is set once when the XR rig is created, not recalculated per frame from head pose. Dynamic repositioning causes parallax jitter.

5. **Do not assume a desktop fallback.** XR viewers are separate instances from desktop viewers. On session end, the viewer disposes or the page returns to options UI — there is no "restore desktop transforms" path.

6. **Use `starFieldScale` for XR scale, not `SCALE`.** The octree constant `SCALE` (0.001) is for the data pipeline. XR code should read `state.starFieldScale` (default 1.0 m/pc) for anything that needs to know the relationship between physical meters and parsecs.
