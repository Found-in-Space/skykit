# Found in Space Learning Path

Status: current alpha-direction document.

This document is about replacing the current SkyKit demos with clear lessons
that teach how to use the new package-based project. It is not a wishlist for
future packages.

The proof-of-concept phase is complete. The old root demos and old `src/`
implementation are still useful as reference material, but the live learning
path should teach the alpha packages:

```txt
learner opens a lesson
  -> sees one real project capability
  -> uses package APIs, not old demo internals
  -> changes a small amount of code
  -> understands where application logic begins
```

Core `@found-in-space/skykit` should stay slim. It composes the focused
packages into teachable viewers and examples; it should not absorb data loading,
rendering, XR, sidecars, or scientific product interpretation.

---

## 1. Teaching Principles

The current migration goal is:

```txt
replace demos with lessons
replace wrapper code with package APIs
replace hidden demo machinery with readable composition
```

The guiding architecture rule remains:

```txt
generalize product lifecycle;
specialize product interpretation.
```

Product lifecycle is reusable:

```txt
upsert
stale
remove
current
error
snapshot
memory accounting
```

Product meaning is domain-specific:

```txt
stars know about magnitude, temperature, object refs, and pick metadata
HR diagrams know about temperature / absolute magnitude projection
H-alpha and dust experiments know about volumes and structural fields
XR knows about bodies, input, motion, rays, and sessions
SkyKit knows how to compose these pieces into lessons
```

The "50-line lesson" target is design pressure, not a literal rule. A learner
should not need to rewrite stream lifecycle handling, star math, provider
strategies, renderer glue, or viewer lifecycle code just to try an idea.

Lesson controls should use semantic actions rather than fake keypresses. SkyKit
reserves the `skykit:` namespace for built-in meanings such as
`skykit:ship.move.forward`, `skykit:viewer.reset`, and
`skykit:journey.goToChapter`; lessons and games can register their own namespaces
such as `lesson:*` or `game:*`.

---

## 2. Package Examples Versus SkyKit Lessons

Package examples teach one package directly:

```txt
star-octree-provider
  -> create a provider
  -> choose a strategy
  -> stream product deltas
  -> inspect the products

star-products
  -> keep a coherent product store
  -> iterate stars
  -> compute apparent magnitude, temperature, color, RA/Dec

star-map-canvas
  -> draw a store of stars into Canvas2D

three-star-field
  -> apply star products to a Three.js object
  -> render progressively without rebuilding cumulative arrays

hr-diagram
  -> project stars into temperature / magnitude space
  -> render with Canvas2D or WebGL

xr
  -> build rigs, bindings, motion, rays, and WebXR helpers
```

SkyKit lessons teach composition:

```txt
viewer
  + provider
  + strategy
  + renderer
  + controls
  + status/debug
  + small custom plugin
```

Root demos are transition sandboxes. New learning work should prefer:

```txt
packages/<package>/examples/
packages/skykit/examples/
```

The root `index.html` should eventually become a lesson directory, not a list of
old development demos.

---

## 3. Current Demo Replacement Map

This section is the practical migration guide. It names the current demos and
where their alpha lesson should live.

### 3.1 Free Roam Console

Current demo:

```txt
demos/free-roam.html
src/demo/free-roam.js
```

Replacement lesson:

```txt
packages/skykit/examples/free-roam-lesson/
```

Teaches:

```txt
createSkykitViewer
createStreamingStarsPlugin
createKeyboardNavigationPlugin
createSkykitStatusPlugin
createSkykitDebugBridge
three-star-field renderer
optional metadata lookup
```

Do not port old console glue wholesale. The new lesson should show how to create
a viewer, stream stars, move around, and inspect state. Plugin hacking belongs
in the custom-object/plugin lessons.

Current alpha lesson:

```txt
packages/skykit/examples/free-roam-lesson/
```

### 3.2 Fly And Orbit

Current demo:

```txt
demos/fly-orbit.html
src/demo/fly-orbit.js
```

Replacement lesson:

```txt
packages/xr/examples/navigation-automation/
packages/skykit/examples/navigation-automation/
```

Teaches:

```txt
route following
orbit
orbital insertion
lookAt / lockAt
quaternion-safe navigation
debuggable automation state
```

The lower-level math belongs in `@found-in-space/xr`. The SkyKit lesson should
compose that navigation with a visible starfield.

Current alpha lessons:

```txt
packages/xr/examples/navigation-automation/
packages/skykit/examples/navigation-automation/
```

### 3.3 Shared Session

Current demo:

```txt
demos/shared-session.html
```

Replacement lesson:

```txt
packages/star-octree-provider/examples/shared-session/
or packages/skykit/examples/shared-session/
```

Teaches:

```txt
one provider
multiple sessions or consumers
product delta lifecycle
representation-current semantics
no cumulative array rebuilding
```

This lesson should be very explicit about what is shared: provider cache/source
state can be shared, but each consumer owns how it merges or displays deltas.

Current alpha lesson:

```txt
packages/star-octree-provider/examples/shared-session/
```

### 3.4 Shader Tuning

Current demo:

```txt
demos/shader-tuning.html
src/demo/shader-tuning.js
```

Replacement lesson:

```txt
packages/three-star-field/examples/shader-tuning/
```

Teaches:

```txt
ThreeStarField view settings
material profile
apparent magnitude response
temperature color
halo and point-size controls
```

This is renderer-specific and should not live in core SkyKit except as a viewer
composition example.

Current alpha lesson:

```txt
packages/three-star-field/examples/shader-tuning/
```

### 3.5 HR Diagram

Current demos:

```txt
demos/hr-diagram.html
demos/hr-diagram-touch.html
```

Replacement lessons:

```txt
packages/hr-diagram/examples/minimal-hr/
packages/hr-diagram/examples/volume-hr/
packages/hr-diagram/examples/path-preload/
```

Teaches:

```txt
HR projection
Canvas fallback
WebGL product renderer
volume/path provider strategies
touch-os display surface where relevant
```

The HR package should stay a reusable scientific instrument. Website narration,
scene chapters, and touch panel layout are application or touch-os concerns.

### 3.6 Canvas Star Map

Current alpha examples:

```txt
packages/star-octree-provider/examples/canvas-star-map/
packages/star-map-canvas/examples/use-cases/
```

Replacement lesson role:

```txt
package documentation first
SkyKit composition lesson second
```

Teaches:

```txt
StarRepresentationStore
RA/Dec projection
Canvas2D rendering
hover/pick application logic
```

The canvas package example should remain direct usage. A SkyKit lesson can later
show the same canvas as an overlay or companion view.

### 3.7 Provider Scratchpad And Nearest Visible

Current alpha examples:

```txt
packages/star-octree-provider/examples/minimal-stream/
packages/star-octree-provider/examples/nearest-visible/
```

Replacement lesson role:

```txt
keep as provider lessons
```

Teaches:

```txt
create provider
choose strategy
stream deltas
log products
process products in application code
```

Nearest visible stars are intentionally application logic, not a provider API.

### 3.8 Data Shape

Current demo:

```txt
demos/data-shape.html
src/demo/data-shape.js
```

Replacement lesson:

```txt
packages/star-octree-provider/examples/strategy-diagnostics/
```

Teaches:

```txt
observer-shell
target-frustum
sphere-volume
path-volume
motion-lookahead
composite union
planned nodes versus fetched payloads
strategy priority versus planner range batching
```

This should become a provider strategy diagnostic, not a viewer demo with hidden
octree internals.

Current alpha lesson:

```txt
packages/star-octree-provider/examples/strategy-diagnostics/
```

### 3.9 Clusters And Galaxy Map Desktop

Current demos:

```txt
demos/clusters.html
demos/galaxy-map.html
```

Replacement lessons:

```txt
packages/skykit/examples/navigation-targets/
packages/skykit/examples/scale-banded-roots/
```

Teaches:

```txt
named targets
flyTo/orbit composition
origin-pinned star data
observer-centric layers
scale-banded content roots
application-owned presets and annotations
```

These should not become catalog-specific core APIs. The useful part is the
composition pattern.

### 3.10 XR Free Roam

Current demo:

```txt
demos/xr-free-roam.html
src/demo/xr-free-roam.js
```

Replacement lessons:

```txt
packages/xr/examples/free-roam/
packages/skykit/examples/xr-starfield/
```

Teaches:

```txt
multi-root XR rig
navigation root and spaceship root
controller bindings
motion models
ray sources
generic pick routing
WebXR depth/session helpers
star renderer composition
touch-os surfaces where needed
```

XR owns embodiment, input, motion, rays, and session helpers. SkyKit composes XR
with star renderers and data providers.

### 3.11 Parallax Sensor Debug

Current demo:

```txt
demos/parallax-debug.html
src/demo/parallax-sensor-debug.js
```

Replacement lesson:

```txt
not first priority
```

This is useful, but it is not central to the current package learning path. If
kept, it should become a small interactivity/plugin lesson rather than core
SkyKit behavior.

### 3.12 Radio Bubble

Current demo:

```txt
demos/radio-bubble.html
src/demo/radio-bubble.js
```

Replacement lesson:

```txt
packages/skykit/examples/custom-object-layer/
```

Teaches:

```txt
createObject3dPlugin
custom Three.js object layer
observer/view-state-driven updates
application-owned visual model
```

The package should not contain a special radio-bubble feature. It is a good
example of a small custom layer.

Current alpha lesson:

```txt
packages/skykit/examples/custom-object-layer/
```

### 3.13 Dust And H-alpha

Current demos:

```txt
demos/dust-roam.html
demos/h-alpha-volume.html
```

Replacement lesson:

```txt
packages/experimental-structure-layers/examples/
```

Teaches:

```txt
experimental structural layers
volume data
scale-banded roots
external layers composed by SkyKit
```

These are explicitly not core SkyKit and not stable product-lane APIs yet.

Current alpha placeholder:

```txt
packages/experimental-structure-layers/examples/
```

---

## 4. Strategy Lessons

Strategies are the learner-facing language for "what stars should I load?"

Implemented strategy families live in `@found-in-space/star-octree-provider`:

```txt
observer-shell
  stars potentially visible from an observer at a limiting magnitude

target-frustum
  stars visible through a target/camera frustum

sphere-volume
  stars inside or near a spherical teaching/game volume

path-volume
  stars near a route, trajectory, or lesson path

motion-lookahead
  lower-priority future-position cache warming around another strategy

composite union
  combine strategies and dedupe demanded nodes

custom
  let learners or applications define their own selection policy
```

The important lesson:

```txt
Strategy = what matters
Planner = what to fetch next
Scheduler = when async work may emit products
Renderer = how products appear
Application = what the products mean for this lesson
```

Strategy priority is a hint, not an exact byte-download order. The provider may
fetch nearby lower-priority payloads early when range batching makes that faster.

---

## 5. Current Package Reference

```txt
@found-in-space/product-stream
  implemented: generic product delta/store lifecycle

@found-in-space/star-products
  implemented: StarObjectBatchProduct types, star representation store,
  star math, star iteration, projections, color helpers

@found-in-space/star-octree-provider
  implemented: octree loading/session/streaming, provider-owned demand
  strategies, volume/path helpers, demand inspection, emits star products

@found-in-space/meta-sidecar-provider
  implemented: metadata sidecar provider keyed by star product object refs

@found-in-space/star-map-canvas
  implemented: 2D projected canvas starmap adapter for spatial star products

@found-in-space/anchored-image
  implemented: renderer-neutral anchored image manifests, affine solving,
  mesh generation, and Canvas2D/Three.js image-warp adapters

@found-in-space/three-star-field
  implemented: Three.js product renderer for star batches and deltas

@found-in-space/hr-diagram
  implemented: reusable HR diagram data model, Canvas fallback, WebGL renderer,
  and optional display-only touch-os composite-surface adapter

@found-in-space/xr
  implemented: immersive embodiment, WebXR rig/input, body/ship model, motion
  models, ray sources, generic ray routing, depth/session helpers, diagnostics

@found-in-space/skykit
  implemented alpha composition slice: slim Three.js viewer, plugin/part
  lifecycle, streaming star plugin/layer, object3d plugin/layer, keyboard
  navigation helper, sky-grab and mouse-look helpers, status helper,
  animation loop, desktop observer rig, debug bridge

@found-in-space/experimental-structure-layers
  implemented: experimental preservation package for H-alpha tiled volumes,
  Dust Map NG helpers, and density/structure rendering experiments; not stable
  core
```

Dependency direction should stay clean:

```txt
product-stream
  <- star-products
      <- star-octree-provider

star-products
  <- meta-sidecar-provider
  <- star-map-canvas
  <- hr-diagram
  <- three-star-field

xr
  imports Three.js, consumes application scale profiles, and routes to
  renderer/touch-os contracts without owning data or surfaces

skykit
  imports and composes the smaller packages
```

---

## 6. What To Build Next

The next work should replace current demos with lessons, not invent new lesson
families.

Completed first migration pass:

```txt
SkyKit free-roam lesson
provider strategy diagnostics lesson
provider shared-session lesson
three-star-field shader tuning lesson
SkyKit custom object layer lesson
SkyKit/XR navigation automation lessons
experimental structure lesson placeholder
root index lesson directory with legacy demos marked
```

Remaining demo replacements:

```txt
1. XR Free Roam -> XR package free-roam lesson plus SkyKit XR starfield lesson.
2. Clusters / Galaxy Map -> navigation-targets and scale-banded-roots lessons.
3. Dust / H-alpha -> full experimental structure browser lessons.
4. Parallax Sensor Debug -> defer or rebuild as a small interactivity plugin lesson.
5. Remove old root demo links once their replacement lessons are good enough.
```

Later ideas such as kinematics sidecars, solar ephemerides, authored journeys,
and galaxy models remain valuable, but they are not the current migration task.
They should wait until the existing demo surface has been replaced by clean
"how to use this project" lessons.
