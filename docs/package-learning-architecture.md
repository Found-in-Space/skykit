# Found in Space Package Learning Architecture

Status: current alpha-direction document.

This document describes the package-learning architecture for this repository.
Technical Documentation and Examples and Demos live in this repository. The
public beginner path is Published Website Content in
`Found-in-Space/found-in-space.github.io`. SkyKit repository Examples and Demos
are development-oriented or advanced-use material unless Published Website
Content deliberately curates them into lessons.

The next work is not a Published Website Content overhaul. It is to stabilize a
pseudo-stable, feature-rich, beginner-friendly SkyKit interface first, so
Published Website Content can expose that interface later without teaching
temporary alpha seams.

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
into teachable viewers and Examples and Demos; it should not take ownership of
data loading, rendering, XR, sidecars, or scientific star interpretation.
Beginner subpaths such as `@found-in-space/skykit/data` may re-export and
lightly compose focused packages for Published Website Content use-cases, but
the durable package boundaries stay with the focused packages.

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
`skykit:navigation.transitionTo`; lessons, games, and applications can register
their own namespaces such as `lesson:*`, `game:*`, or `website:*`.

## Published Website Content Baseline And Example Categories

The current Published Website Content SkyKit path is use-case based:

```txt
found-in-space.github.io/src/pages/learn-build/skykit/
  -> paste a browser viewer
  -> use a ready browser handle
  -> automate semantic navigation
  -> add app-owned objects
  -> query data without Three.js
  -> enrich StarObjectRef rows with sidecar metadata
  -> build a small 2D app
```

That ladder is the public beginner baseline. Repository Examples and Demos
should support it as reproducible source material, but they are not
automatically public lessons. When creating repository Examples and Demos,
choose the category deliberately:

```txt
development example
  -> tests package internals, fake XR, diagnostics, or migration behavior

advanced-use example
  -> teaches direct package composition for authors already past the beginner facade

Published Website Content lesson
  -> lives in found-in-space.github.io with beginner copy, stable imports, and reproducible links
```

Every Published Website Content lesson should use the same mental model across
2D/data, desktop 3D, and XR: viewer handles, semantic actions, products, public
star identity, sidecar metadata, selection, inspect/debug, and app-owned
extensions.

## Package Examples Versus SkyKit Composition

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

SkyKit repository Examples and Demos and future Published Website Content
lessons teach composition:

```txt
viewer
  + provider
  + strategy
  + renderer
  + controls
  + status/debug
  + small custom plugin
```

Published Website Content lessons are use-case bounded rather than
package-bundle bounded:

```txt
Viewer: embed.js for no-code, viewer.js for JavaScript customization
Data: data.js for rows, labels, lists, maps, and renderer-independent games
```

Root `demos/` pages and the old root `src/` implementation are legacy
transition sandboxes. App-level examples should be explicit about whether they
are development material, advanced-use material, or candidates for Published
Website Content.
Focused package learning work should prefer:

```txt
apps/examples/
packages/<package>/examples/
packages/skykit/examples/
found-in-space.github.io/src/live-examples/skykit/    # only when curated as public lessons
```

## Current Package Reference

```txt
@found-in-space/spatial
  implemented: dependency-free coordinate conversion, target resolution, poses,
  routes, smooth paths, timed pose tracks, materialized warm/preload hints, smooth
  fly-to/route-follow, orbit, orbital insertion, look-at, lock-at, and motion
  models

@found-in-space/skykit-studio (sibling project)
  implemented: standalone alpha camera timeline editor, editor document/state
  helpers, JSON import/export, projection/perspective/SkyKit preview tiles,
  guide/timeline retiming workflows, deterministic browser export page,
  JavaScript sky-frame capture, cached overlay block rendering, ffmpeg composite
  helpers, and the skykit-studio-render CLI

@found-in-space/star-trees
  implemented: StarCellData types, StarCellStore, StarObjectRef identity,
  Morton helpers, star math, star iteration, color helpers, shared strategy
  interfaces, observer-shell/frustum/volume/lookahead/warm strategy helpers, and
  strategy composition

@found-in-space/star-octree-provider
  implemented: octree loading/session/streaming, provider-owned planning against
  shared strategies, volume/path helpers, demand inspection, and cell delta
  emission, finite fetches, warmCells prefetch-lane cache warming, URL and File
  providers; physical node/storage IDs stay inside provider loader/planner code

@found-in-space/meta-sidecar-provider
  implemented: metadata sidecar provider keyed by star object refs, cell-level
  metadata reads, URL derivation, persistent cache support, and display-field
  normalization helpers

@found-in-space/star-map-canvas
  implemented: 2D projected Canvas2D starmap adapter for spatial star cells,
  all-sky and FoV projections, draw-list export, layers, hooks, and point
  picking

@found-in-space/anchored-image
  implemented: renderer-neutral anchored image manifests, affine solving,
  mesh generation, direction resolution helpers, and Canvas2D/Three.js
  image-warp adapters

@found-in-space/three-star-field
  implemented: Three.js renderer for star cell stores and deltas, stable
  aggregate geometry, material profiles, picking, visible bounds, and snapshots

@found-in-space/hr-diagram
  implemented: reusable HR diagram data model, Canvas fallback, WebGL renderer,
  magnitude-limited/volume/frustum modes, selected/highlight overlays, and
  optional display-only touch-os composite-surface adapter

@found-in-space/skykit
  implemented alpha composition slice: slim Three.js viewer, plugin/part
  lifecycle, streaming star plugin/layer, object3d plugin/layer, keyboard
  navigation helper, sky-grab and mouse-look helpers, parallax subpath plugins,
  status helper, navigation actions/plugin backed by spatial, animation loop,
  desktop observer rig, debug bridge, browser embed/add-on global, lazy
  constellation and coordinate-frame browser/XR capabilities, touch-os bridge,
  beginner `viewer` and `data` subpaths for Published Website Content use-cases,
  and optional `skykit/xr` WebXR rig/input/ray/session/depth/navigation/picking
  helpers
```

Historical H-alpha tiled-volume and Dust Map NG pipeline work remains in
[`Found-in-Space/pipeline-dust`](https://github.com/Found-in-Space/pipeline-dust)
as reference material. It is not part of the current alpha package map; future
structural data packages should be designed against the then-current
SkyKit/provider APIs when there is an active consumer.

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
  composes focused packages into teachable viewers and examples
```

Star streaming uses `@found-in-space/star-trees` cell deltas directly. There is
no generic product stream layer in the alpha package map.

## Lesson And Example Design Checklist

A good alpha package example or Published Website Content lesson should:

- open directly into a usable experience
- show one package capability clearly
- keep custom application logic local to the lesson
- use semantic SkyKit actions for controls
- expose star identity as `StarObjectRef` and cells as `StarCellKey`
- avoid octree storage details in UI, bookmarks, and save data
- avoid private viewer internals
- expose inspect/debug as a learning surface, not only as development state
- point learners to the package that owns the behavior they want to change

When a lesson needs high-throughput star data, it should use provider sessions,
cell stores, and renderer handles. It should not use the SkyKit event bus as a
per-star transport.
