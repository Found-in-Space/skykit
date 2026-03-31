# Found in Space — SkyKit

Part of [Found in Space](https://foundin.space/), a project that turns real astronomical measurements into interactive explorations of the solar neighbourhood. See all repositories at [github.com/Found-in-Space](https://github.com/Found-in-Space).

SkyKit is the reusable runtime for building interactive 3D sky experiences. It pulls together dataset services, loading and sharding strategies, scene and controller skeletons, rendering layers, and shader-based star rendering. It can be used as:

- a standalone viewer runtime for desktop or XR demos
- a source-level library for custom visualizations, experiences, or games

## Install

```bash
npm install @found-in-space/skykit
```

## Architecture

Source lives under `src/` and is organised into purpose-driven sections.

### `core/`

The runtime engine. `ViewerRuntime` owns the THREE.js renderer, scene graph, animation loop, and the `ViewerRuntimePart` lifecycle (`attach → start → update → resize → dispose`). `DatasetSession` manages shared octree services and caches so multiple viewers can share a single dataset without redundant fetches. `contracts.js` defines the lifecycle type and `runtime-rig.js` builds the THREE.js hierarchy (navigation root, camera mount, content root).

### `controllers/`

Camera state and user input. `camera-rig.js` is a pure-math camera model — position in ICRS parsecs, orientation as a quaternion, velocity vector — with no DOM or input dependencies. `camera-rig-controller.js` wraps it into a `ViewerRuntimePart` that handles keyboard, pointer, XR gamepad, and device-tilt input, plus automation methods (`flyTo`, `orbit`, `lookAt`). All orientation is quaternion-based to avoid gimbal lock. `selection-refresh-controller.js` triggers data reloads when the observer moves far enough.

### `fields/`

Interest-field strategies that decide which octree nodes to load for a given observer. `ObserverShellField` selects nodes in concentric shells around the observer. `TargetFrustumField` selects nodes in a camera-aligned frustum toward a target, pruning nodes behind the observer. `octree-selection.js` contains the shared selection math (magnitude shells, node scoring).

### `layers/`

Renderable scene content, each a `ViewerRuntimePart`. `StarFieldLayer` decodes octree payloads into point-cloud geometry and manages progressive loading. `ConstellationArtLayer` renders constellation stick-figure art from a Stellarium-format manifest. `MinimalSceneLayer` provides a fallback starfield for bootstrapping. `scene-orientation.js` builds ICRS↔scene coordinate transforms so a target like Orion can face the camera naturally. `star-field-materials.js` and `highlight-star-field-materials.js` define shader profiles (desktop, VR, cartoon, highlight).

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

- [`docs/viewer-architecture.md`](./docs/viewer-architecture.md): current architecture and migration context
- [`docs/viewer-roadmap.md`](./docs/viewer-roadmap.md): roadmap and phase notes
