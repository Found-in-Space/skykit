# Found in Space Learning Path

Status: current alpha-direction document.

This document is about replacing this repository's local SkyKit proof-of-concept
demos with clear lessons that teach how to use the package-based project. It is
not describing the public website lesson status, and it is not a wishlist for
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

Core `@found-in-space/skykit` should stay slim. It composes focused packages
into teachable viewers and examples; it should not absorb data loading,
rendering, XR, sidecars, or scientific star interpretation.

## Teaching Principles

The current migration goal is:

```txt
replace demos with lessons
replace wrapper code with package APIs
replace hidden demo machinery with readable composition
```

The guiding architecture rule for star streaming is:

```txt
provider owns demand and cell deltas;
domain packages own interpretation and rendering.
```

Star cell lifecycle is public and semantic:

```txt
stars/cells-upsert
stars/cells-remove
stars/current
stars/error
```

The "50-line lesson" target is design pressure, not a literal rule. A learner
should not need to rewrite stream lifecycle handling, star math, provider
strategies, renderer glue, or viewer lifecycle code just to try an idea.
Trying an idea may still mean providing a new strategy object. That should be an
application-level extension over the shared strategy contract, not a request to
add another strategy kind to SkyKit or a provider planner.

Lesson controls should use semantic actions rather than fake keypresses. SkyKit
reserves the `skykit:` namespace for built-in meanings such as
`skykit:ship.move.forward`, `skykit:viewer.reset`, and
`skykit:journey.goToChapter`; lessons and games can register their own
namespaces such as `lesson:*` or `game:*`.

## Package Examples Versus SkyKit Lessons

Package examples teach one package directly:

```txt
star-octree-provider
  -> create a provider
  -> choose a strategy
  -> stream cell deltas
  -> inspect cells

star-trees
  -> keep a coherent cell store
  -> iterate stars
  -> compute apparent magnitude, temperature, color
  -> convert between StarCellKey, StarCellRef, and Morton coordinates

spatial
  -> convert RA/Dec/distance targets
  -> build routes, look-at targets, orbits, and smooth navigation

star-map-canvas
  -> draw a store of stars into Canvas2D

three-star-field
  -> apply star cell deltas to a stable Three.js object
  -> render progressively without exposing transport batch identity

hr-diagram
  -> project stars into temperature / magnitude space
  -> render with Canvas2D or WebGL

skykit/xr
  -> build WebXR rigs, bindings, rays, and session helpers

skykit/parallax
  -> turn pointer/touch/device tilt into semantic controls
  -> consume those controls as target-relative observer motion
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

Root `demos/` pages in this repository are transition sandboxes. New package
learning work should prefer:

```txt
packages/<package>/examples/
packages/skykit/examples/
```

## Current Package Reference

```txt
@found-in-space/spatial
  implemented: dependency-free coordinate conversion, target resolution, poses,
  routes, smooth paths, timed pose tracks, materialized warm/preload hints, smooth
  fly-to/route-follow, orbit, orbital insertion, look-at, lock-at, and motion
  models

@found-in-space/journey
  implemented: authored interactive scene graphs, timed journey normalization
  and evaluation, cues, generic tracks, preload hints that adapt into warm
  strategy demand, and retiming helpers

@found-in-space/journey-video (sibling project)
  implemented: standalone alpha journey video editor, editor document/state
  helpers, JSON import/export, projection/perspective/SkyKit preview tiles,
  guide/timeline retiming workflows, deterministic browser export page,
  JavaScript sky-frame capture, cached overlay block rendering, ffmpeg composite
  helpers, and the journey-video-render CLI

@found-in-space/star-trees
  implemented: StarCellData types, StarCellStore, StarObjectRef identity,
  Morton helpers, star math, star iteration, and color helpers

@found-in-space/star-octree-provider
  implemented: octree loading/session/streaming, provider-owned planning against
  shared strategies, volume/path helpers, demand inspection, and cell delta
  emission; physical node/storage IDs stay inside provider loader/planner code

@found-in-space/meta-sidecar-provider
  implemented: metadata sidecar provider keyed by star object refs

@found-in-space/star-map-canvas
  implemented: 2D projected Canvas2D starmap adapter for spatial star cells

@found-in-space/anchored-image
  implemented: renderer-neutral anchored image manifests, affine solving,
  mesh generation, and Canvas2D/Three.js image-warp adapters

@found-in-space/three-star-field
  implemented: Three.js renderer for star cell stores and deltas

@found-in-space/hr-diagram
  implemented: reusable HR diagram data model, Canvas fallback, WebGL renderer,
  and optional display-only touch-os composite-surface adapter

@found-in-space/skykit
  implemented alpha composition slice: slim Three.js viewer, plugin/part
  lifecycle, streaming star plugin/layer, object3d plugin/layer, keyboard
  navigation helper, sky-grab and mouse-look helpers, parallax subpath plugins,
  status helper, navigation actions/plugin backed by spatial, journey
  plugin/action bridge, animation loop, desktop observer rig, debug bridge, and
  optional `skykit/xr` WebXR rig/input/ray/session/depth helpers

@found-in-space/experimental-structure-layers
  implemented: experimental preservation package for H-alpha tiled volumes,
  Dust Map NG helpers, and density/structure rendering experiments; not stable
  core
```

Dependency direction should stay clean:

```txt
star-trees
  <- star-octree-provider
  <- meta-sidecar-provider
  <- star-map-canvas
  <- hr-diagram
  <- three-star-field

spatial
  imports no renderer/runtime dependencies and supplies shared target,
  coordinate, route, and navigation helpers

skykit/xr
  imports Three.js through SkyKit, consumes spatial poses/scale profiles, and
  routes WebXR input/rays to renderer/touch-os contracts without owning data or
  surfaces

skykit
  composes focused packages into teachable viewers and lessons
```

Star streaming uses `@found-in-space/star-trees` cell deltas directly. There is
no generic product stream layer in the alpha package map.

## Lesson Design Checklist

A good alpha lesson should:

- open directly into a usable experience
- show one package capability clearly
- keep custom application logic local to the lesson
- use semantic SkyKit actions for controls
- expose star identity as `StarObjectRef` and cells as `StarCellKey`
- avoid octree storage details in UI, bookmarks, and save data
- avoid private viewer internals
- point learners to the package that owns the behavior they want to change

When a lesson needs high-throughput star data, it should use provider sessions,
cell stores, and renderer handles. It should not use the SkyKit event bus as a
per-star transport.
