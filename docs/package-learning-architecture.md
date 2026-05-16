# Found in Space Learning Path

Status: current alpha-direction document.

This note describes the teaching path we want SkyKit and the surrounding
`@found-in-space/*` packages to support.

New work should not make core `skykit` larger by default. Core `skykit` should
be a slim composition and teaching layer over focused packages with explicit
boundaries.

The learning goal is simple:

```txt
learners start with real streamed stars
  -> inspect them
  -> draw them
  -> interact with them
  -> combine them with scientific instruments and extra data products
  -> build their own scenes, games, and lessons
```

Package boundaries still matter, but they are in service of this path. A package
is successful when it makes the next lesson smaller, clearer, and easier to hack.

---

## 1. Teaching Principles

The guiding rule is:

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
stars know about magnitude, temperature, object refs, pick metadata
H-alpha products know about fields, tiles, meshes, or volumes
solar-system products know about time, bodies, and trajectories
galaxy products know about large-scale structure and coordinate frames
```

This keeps examples short without hiding the data model. Learners should be able
to see where data comes from, how it streams, and where application logic begins.

The "50-line lesson" target is not a literal rule, but it is useful design
pressure. A learner should not need to rewrite stream lifecycle handling,
temperature decoding, apparent magnitude math, coordinate projection, product
stores, or renderer glue just to reach the next idea.

---

## 2. Package Examples Versus SkyKit Lessons

Each package should have direct examples that teach the package in isolation:

```txt
star-octree-provider
  -> create a provider
  -> run a strategy
  -> stream product deltas
  -> inspect product shape

star-map-canvas
  -> draw a store of stars into Canvas2D
  -> customize projection, layers, hover, and picking

three-star-field
  -> apply star products to a Three.js object
  -> render progressively without rebuilding cumulative arrays

hr-diagram
  -> project stars into temperature / magnitude space
  -> render with Canvas2D or WebGL
```

Core `@found-in-space/skykit` examples should teach how packages plug together:

```txt
viewer
  + provider
  + renderer
  + controls
  + status/debug
  + small custom plugin
```

New teaching examples should prefer package-owned examples or
`packages/skykit/examples/`. Root demos are transition sandboxes, not the live
architecture path.

---

## 3. Lesson Ladder

The toolkit should make each step feel like the obvious next move after the
previous one.

```txt
1. Stream stars into a table
2. Keep a coherent current star set
3. Draw a static 2D starmap
4. Add lightweight interaction and custom visuals
5. Render a progressive 3D starfield
6. Use scientific instruments such as HR diagrams
7. Query volumes and paths through the same provider strategy model
8. Compose a hackable viewer with plugins
9. Add skyculture art, labels, and sidecar facts
10. Add XR embodiment, navigation, and picking
11. Explore dynamic universe and trajectory lessons
12. Compose multi-scale structural layers
```

This is a learning path, not a dependency graph. A motivated learner may jump
straight to games or XR, but the packages should still let each idea stand on its
own.

---

## 4. Lessons To Support

### 4.1 Stream Stars Into A Table

Question:

```txt
How do I ask SkyKit for real stars and watch them arrive?
```

Learner-facing shape:

```js
const provider = createStarOctreeProviderService({ url });

for await (const delta of provider.streamObjectBatches({
  strategy: createObserverShellStrategy(),
  view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
})) {
  console.log(delta);
}
```

Packages:

```txt
@found-in-space/star-octree-provider
@found-in-space/star-products
```

Teaching points:

```txt
provider URL
strategy
view state
progressive product deltas
current means caught up, not stream permanently closed
application code decides how to process the products
```

Application-owned logic:

```txt
table rendering
nearest-100 sorting
custom filtering
summary stats
```

This is the role of the existing provider scratchpad and nearest-visible demo.
Nearest stars are deliberately application logic, not a core provider feature.

### 4.2 Keep A Coherent Current Star Set

Question:

```txt
How do I turn streaming deltas into "the stars I currently have"?
```

Packages:

```txt
@found-in-space/product-stream
@found-in-space/star-products
```

Teaching points:

```txt
product lifecycle
upsert / stale / remove / current / error
StarRepresentationStore
star iteration
objectRef and pickMeta lookup
memory and count snapshots
```

The generic store teaches lifecycle. The star store teaches star-specific
interpretation. H-alpha, mesh, galaxy, or solar-system products should reuse the
lifecycle pattern without inheriting star-specific assumptions.

### 4.3 Draw A Static 2D Starmap

Question:

```txt
How do I turn streamed stars into a simple map?
```

Packages:

```txt
@found-in-space/star-products
@found-in-space/star-map-canvas
optional: @found-in-space/anchored-image
```

Direct package example:

```txt
provider stream -> StarRepresentationStore -> Canvas2D starmap
```

SkyKit lesson example:

```txt
create viewer
add canvas or overlay plugin
add a tiny custom visual plugin, such as twinkle or falling markers
```

Teaching points:

```txt
RA/Dec and projection helpers
apparent magnitude
temperature color
small custom layers
hover/pick logic that stays in application code
```

The canvas example should remain package-focused: it teaches the renderer in
isolation. SkyKit examples should show how to compose it with controls, status,
and plugins.

### 4.4 Render A Progressive 3D Starfield

Question:

```txt
How do I put streamed stars into a Three.js scene or game?
```

Packages:

```txt
@found-in-space/three-star-field
@found-in-space/star-products
@found-in-space/star-octree-provider
optional: @found-in-space/skykit
```

Teaching points:

```txt
one geometry per product
no cumulative array rebuilding
shader-owned visual response
product/object index preservation for picking
nearfield/farfield composition by using multiple renderer instances
```

`three-star-field` owns star rendering and star picking. It does not own the
provider session, camera controls, sidecars, or scene composition.

Game lessons should be able to use the same stream and renderer, then add their
own motion model, markers, objectives, or entity system.

### 4.5 Build A Hackable Viewer With Plugins

Question:

```txt
How do I combine streamed stars, controls, status, and my own visual code?
```

Packages:

```txt
@found-in-space/skykit
@found-in-space/star-octree-provider
@found-in-space/three-star-field
```

Teaching points:

```txt
viewer roots
plugins as caller-supplied functions/objects, not string registries
parts and lifecycle
requestViewState batching
debug bridge
object3d plugin for creative additions
keyboard navigation as a small learning control
```

This is where "falling stars" style demos belong: not as special core behavior,
but as small plugins that show learners how to extend the viewer.

SkyKit should provide enough composition machinery that adding a custom layer,
marker field, constellation art layer, or debug overlay is a small focused
exercise.

### 4.6 Explore Stars With An HR Diagram

Question:

```txt
What can I learn from the stars once I have loaded them?
```

Packages:

```txt
@found-in-space/hr-diagram
@found-in-space/star-products
@found-in-space/star-octree-provider
optional: touch-os
```

Teaching points:

```txt
temperature versus absolute magnitude
Canvas fallback for small teaching views
WebGL renderer for high-volume products
direct product delta consumption
highlight regions for explanation
```

The HR diagram is a reusable scientific instrument. It should not know about
Orion-specific narration, website routes, or viewer internals.

Touch displays and wall panels should use touch-os-native surfaces where
possible. The HR package can provide a touch-os subpath for publishing the WebGL
renderer as a composite surface, but touch-os owns panels, HUDs, and forwarded
surface input.

### 4.7 Query Volumes And Paths

Question:

```txt
How do I load stars near a place, route, comet path, or lesson volume?
```

Packages:

```txt
@found-in-space/star-octree-provider
@found-in-space/star-products
```

Teaching points:

```txt
sphere-volume strategy
path-volume strategy
travel radius profiles
warmVolumeRequests for preload/cache warming
strategies say what matters
planner decides how to fetch efficiently
```

Volume and path demand are star-octree strategies, not a separate wrapper
package. They share the same provider strategy surface as observer-shell and
target-frustum, and can be composed with them.

This supports HR volume lessons, route preload lessons, and trajectory lessons
without making learners understand root shards or octree internals.

### 4.8 Add Skyculture Art And Image Overlays

Question:

```txt
How do I add constellation art, survey plates, or anchored images?
```

Packages:

```txt
@found-in-space/anchored-image
@found-in-space/star-map-canvas
optional: @found-in-space/skykit
```

Teaching points:

```txt
direction anchors
position anchors
affine solving
Canvas2D image warping
Three.js image meshes
observer-centric anchoring for painted-at-infinity layers
```

Observer-centric layers should follow observer translation without inheriting
ship/head rotation. Origin-pinned layers, such as Gaia star positions, stay in
the ICRS/Sun-origin frame. Large-scale context layers may use their own
scale-banded roots.

This distinction matters: constellation art should not appear to drift just
because the viewer moves toward it.

### 4.9 Add Metadata And Labels

Question:

```txt
How do I turn a picked star into a name, catalog id, or fact panel?
```

Packages:

```txt
@found-in-space/meta-sidecar-provider
@found-in-space/star-products
@found-in-space/skykit
```

Teaching points:

```txt
CanonicalObjectRef
pickMeta
dataset identity
sidecar lookup
application-owned labels and panels
```

The octree provider emits stable refs. Sidecar providers enrich those refs.
Renderers and UI decide how to display the result.

### 4.10 Build XR And Spaceship Experiences

Question:

```txt
How do I navigate space with a body, ship, controllers, and rays?
```

Packages:

```txt
@found-in-space/xr
@found-in-space/three-star-field
touch-os for visual surfaces
@found-in-space/skykit for composition
```

Teaching points:

```txt
multi-root scene graph
origin-pinned content
observer-centric content
scale-banded content
navigation root / spaceship root
head and hand/controller poses
control bindings
motion models
ray sources and blocker-first pick routing
depth range helpers
```

XR owns embodiment, input, motion, rays, picking routes, and WebXR session
helpers. It does not own star rendering, star labels, HUDs, touch panels, or
lesson content.

Motion plugins need access to scale profiles so they can reason about semantic
speed and physical comfort without baking parsec-to-meter policy into the XR
package.

### 4.11 Explore A Dynamic Universe

Question:

```txt
How do stars and objects move through time?
```

Planned packages:

```txt
@found-in-space/star-kinematics-provider
@found-in-space/solar-ephemeris
future trajectory helpers
```

Teaching points:

```txt
proper motion sidecars
radial velocity
catalog epochs
small candidate subsets
path and closest-approach analysis
comet or spacecraft trajectories
```

This is intentionally not "animate every star in the galaxy". The useful lesson
is usually:

```txt
query a small volume/path from the static octree
  -> join motion data for the subset that has it
  -> propagate those objects through time
  -> inspect encounters, uncertainty, or relative paths
```

The comet-path example from the website is the right teaching shape: follow a
path backward and forward, then find stars that may have been near it.

### 4.12 Compose Multi-scale Structure

Question:

```txt
How do local stars, galaxy structure, dust, nebulae, solar systems, and
extra-galactic context coexist?
```

Packages:

```txt
@found-in-space/experimental-structure-layers for preserved H-alpha/dust work
future stable galaxy / dust / nebula product lanes
@found-in-space/skykit for scene composition
```

Teaching points:

```txt
not one coordinate system stretched until it hurts
domain products with their own scale
different update cadences
origin-pinned local stellar data
observer-centric painted-at-infinity layers
scale-banded galaxy or structural context
solar-system scale where stellar parallax may be ignored
```

H-alpha is a useful lesson in how new structural products can be added. It
should remain outside core SkyKit until the dataset and API become stable.

The future galaxy model is the stress test: parsec-scale Gaia stars and
kiloparsec-scale galactic structure should render as layered products with
deliberate coordinate switching.

---

## 5. Strategy Lessons

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

## 6. Current Package Reference

This section is deliberately compact. It exists to help decide where a lesson
should live; it is not the main story of this document.

```txt
@found-in-space/product-stream
  implemented: generic product delta/store lifecycle

@found-in-space/star-products
  implemented: StarObjectBatchProduct types, star representation store,
  star math, star iteration, projections, color helpers

@found-in-space/star-octree-provider
  implemented: octree loading/session/streaming, provider-owned demand
  strategies, volume/path helpers, emits star products

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
  navigation helper, status helper, animation loop, desktop observer rig, debug
  bridge

@found-in-space/experimental-structure-layers
  implemented: experimental preservation package for H-alpha tiled volumes,
  Dust Map NG helpers, and density/structure rendering experiments; not stable
  core

@found-in-space/star-kinematics-provider
  planned: proper-motion, radial-velocity, and epoch sidecars

@found-in-space/solar-ephemeris
  planned: time-aware solar-system and trajectory products at AU scale

@found-in-space/journey
  planned: authored lesson runtime and editor model for chapters, narration,
  camera beats, timed cues, preload hints, and production workflows
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

touch-os
  <- HR / XR / SkyKit visual surface composition

xr
  imports Three.js, consumes application scale profiles, and routes to
  renderer/touch-os contracts without owning data or surfaces

skykit
  imports and composes the smaller packages
```

Core `skykit` is also the right home for the browser debug bridge. The debug
bridge intentionally crosses viewer, navigation, product, renderer, XR, and
lesson boundaries, so it should be a composition/devtools surface over public
snapshots and public actions rather than a feature hidden inside any one data or
rendering package.

---

## 7. What To Build Next

Choose the next package or lesson by the teaching path it unlocks, not by whether
there is a spare abstraction looking for a home.

High-value next steps:

```txt
SkyKit lesson examples
  minimal streamed star viewer
  plugin lab with custom falling/twinkle markers
  canvas starmap composition
  Three starfield game starter

Journey/runtime
  authored lesson playback
  camera/navigation cues
  readiness checks and preload hints
  editor/runtime shared model

Kinematics sidecars
  proper motion subset joins
  dynamic-universe path lessons
  closest-approach analysis

Solar/trajectory products
  AU-scale bodies and paths
  static distant starfield when parallax is irrelevant

Interactive scientific instruments
  HR brushing
  touch-os forwarded input
  linked selection between starfield, table, and HR diagram
```

The next step should make one of these lessons shorter and clearer. That is the
test that keeps the architecture honest.
