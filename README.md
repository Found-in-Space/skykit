# Found in Space — SkyKit

Part of [Found in Space](https://foundin.space/), a project that turns real astronomical measurements into interactive explorations of the solar neighbourhood. See all repositories at [github.com/Found-in-Space](https://github.com/Found-in-Space).

SkyKit is currently the reusable runtime for building interactive 3D sky experiences. It pulls together dataset services, loading and sharding strategies, scene and controller skeletons, rendering layers, and shader-based star rendering. It can be used as:

- a standalone viewer runtime for desktop or XR demos
- a source-level library for custom visualizations, experiences, or games

The proof-of-concept phase is complete. The alpha architecture is moving core `skykit` toward a slimmer teaching toolkit built from narrow-purpose, reusable `@found-in-space/*` modules. The goal is that students and builders can start with real astronomical data, then progressively learn how to stream it, analyse it, draw it, enrich it with sidecars, and compose it into interactive scenes without needing to adopt a large monolithic viewer.

If you are reading this README on GitHub, you can open **[SkyKit experiments](https://foundin.space/skykit/)** on the Found in Space site to try the latest interactive demos in the browser—development sandboxes that exercise new ideas in the runtime before they settle into stable APIs.

## Install

```bash
npm install @found-in-space/skykit
```

## Architecture

Source lives under `src/` and is organised into purpose-driven sections.

The current `src/` runtime remains the working viewer implementation. New alpha work should prefer focused workspace packages under `packages/` when a capability can stand on its own. Core `skykit` should become the slim composition layer that brings those packages together for teaching and demos, while package code owns the reusable implementation.

Examples of the intended package direction:

- `@found-in-space/product-stream`: generic product delta/store lifecycle
- `@found-in-space/star-products`: star product stores, iteration, math, projections, and display helpers
- `@found-in-space/star-octree-provider`: star octree loading, streaming, sessions, and product emission
- `@found-in-space/star-map-canvas`: lightweight 2D starmap rendering
- `@found-in-space/star-kinematics-provider`: proper-motion and velocity sidecars for dynamic-universe lessons
- `@found-in-space/solar-ephemeris`: time-aware solar-system and trajectory products
- `@found-in-space/skykit`: friendly composition exports and teaching-oriented examples

This split is not limited to "universe data" packages. Shared interaction or
surface systems should also stand alone when they are broadly reusable. For
example, [`touch-os`](https://github.com/found-in-Space/touch-os/) is a Found in
Space project that `skykit` can depend on for interactive surfaces, but it
should not be folded back into core `skykit`.

### `core/`

The runtime engine. `ViewerRuntime` owns the THREE.js renderer, scene graph, animation loop, and the `ViewerRuntimePart` lifecycle (`attach → start → update → resize → dispose`). `DatasetSession` manages shared octree services and caches so multiple viewers can share a single dataset without redundant fetches. `contracts.js` defines the lifecycle type and `runtime-rig.js` builds the THREE.js hierarchy (navigation root, camera mount, content root).

### `controllers/`

Camera state and user input. `camera-rig.js` is a pure-math camera model — position in ICRS parsecs, orientation as a quaternion, velocity vector — with no DOM or input dependencies. `camera-rig-controller.js` wraps it into a `ViewerRuntimePart` that handles keyboard, pointer, XR gamepad, and device-tilt input, plus automation methods (`flyTo`, `orbit`, `lookAt`). All orientation is quaternion-based to avoid gimbal lock. `selection-refresh-controller.js` triggers data reloads when the observer moves far enough.

### `fields/`

Interest-field strategies that decide which octree nodes to load for a given observer. `ObserverShellField` selects nodes in concentric shells around the observer. `TargetFrustumField` selects nodes in a camera-aligned frustum toward a target, pruning nodes behind the observer. `octree-selection.js` contains the shared selection math (magnitude shells, node scoring).

### `layers/`

Renderable scene content, each a `ViewerRuntimePart`. `StarFieldLayer` decodes octree payloads into point-cloud geometry and manages progressive loading. `ConstellationArtLayer` renders constellation stick-figure art from a Stellarium-format manifest. `MinimalSceneLayer` provides a fallback starfield for bootstrapping. `scene-orientation.js` builds ICRS↔scene coordinate transforms so a target like Orion can face the camera naturally. `star-field-materials.js` and `highlight-star-field-materials.js` define shader profiles (default/tuned, VR, cartoon, highlight), with `createDefaultStarFieldMaterialProfile()` + `DEFAULT_STAR_FIELD_STATE` as the baseline for most apps.

### `constellations/`

Manifest loading and THREE.js mesh generation for Stellarium-format constellation art packages.

### `services/`

Data plumbing. `services/octree/` contains `OctreeFileService` (binary octree I/O with HTTP range requests, shard parsing, payload batching) and `RenderOctreeService` (session-scoped wrapper). `services/sidecars/` has `MetaSidecarService` for the metadata octree (star names, identifiers). `services/input/` has `DeviceTiltTracker` for gyroscope-based parallax. `dataset-identity.js` provides stable cache-key hashing.

### `embeds/`

High-level convenience API. `createViewer()` wires up a `ViewerRuntime` with a `DatasetSession` in a single call.

### `diagnostics/`

Offline analysis tools. `observer-shell-diagnostic.js` evaluates shell-field node selection without a renderer, useful for tuning magnitude limits and shell radii.

### `demo/`

Vite dev-server entry points for the demo pages in `demos/`.

### Root modules

`found-in-space-dataset.js` resolves default octree URLs and query-parameter overrides. `scene-targets.js` exports well-known ICRS coordinates (solar origin, Orion centre, galactic centre).

## Development

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5173/
node --test          # run all tests
node --test --watch  # watch mode
```

Demo pages live in `demos/` and share `demos/shared.css`. The root `index.html` is a directory page linking to each demo.

Constellation art defaults to Western art from:

- `https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json`

Override with `?constellationManifestUrl=...`. Dataset URLs can be overridden with existing query parameters documented in the demo modules.

## Docs

- [`docs/alpha-rules.md`](./docs/alpha-rules.md): current alpha rewrite rules and package-boundary guidance
- [`docs/package-learning-architecture.md`](./docs/package-learning-architecture.md): alpha package direction for teaching-oriented modules
- [`docs/octree-service.md`](./docs/octree-service.md): current alpha contract for `@found-in-space/star-octree-provider`
- [`docs/viewer-architecture.md`](./docs/viewer-architecture.md): legacy proof-of-concept viewer architecture; may be stale
- [`docs/xr-architecture.md`](./docs/xr-architecture.md): legacy proof-of-concept XR architecture; may be stale
- [`docs/hr-diagram-touch-display.md`](./docs/hr-diagram-touch-display.md): legacy proof-of-concept touch-display design; may be stale
