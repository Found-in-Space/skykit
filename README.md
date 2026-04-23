# Found in Space — SkyKit

Part of [Found in Space](https://foundin.space/), a project that turns real astronomical measurements into interactive explorations of the solar neighbourhood. See all repositories at [github.com/Found-in-Space](https://github.com/Found-in-Space).

SkyKit is the reusable runtime for building interactive 3D sky experiences. It pulls together dataset services, loading and sharding strategies, scene and controller skeletons, rendering layers, and shader-based star rendering. It can be used as:

- a standalone viewer runtime for desktop or XR demos
- a source-level library for custom visualizations, experiences, or games

If you are reading this README on GitHub, you can open **[SkyKit experiments](https://foundin.space/skykit/)** on the Found in Space site to try the latest interactive demos in the browser—development sandboxes that exercise new ideas in the runtime before they settle into stable APIs.

## Install

```bash
npm install @found-in-space/skykit
```

## Quick Wins

### 1. Headless Query

Use the standard Found in Space dataset helper from `loading` and keep warmup explicit:

```js
import { queryNearestStars } from '@found-in-space/skykit';
import { createFoundInSpaceDataset } from '@found-in-space/skykit/loading';

const dataset = createFoundInSpaceDataset();
await dataset.ensureBootstrap();

const result = await queryNearestStars(dataset, {
  centerPc: { x: 0, y: 0, z: 0 },
  count: 10,
});

console.table(result.stars.map((star) => ({
  id: star.id?.mortonCode ?? 'unknown',
  distancePc: star.distancePc,
  absoluteMagnitude: star.absoluteMagnitude,
})));
```

### 2. Raw Browser / JSFiddle Quickstart

The fastest rendered path is a browser-native ESM import plus the new desktop explorer preset. A full single-file example lives in [docs/browser-quickstart.html](./docs/browser-quickstart.html).

```html
<script type="module">
  import { createFoundInSpaceDataset } from 'https://esm.sh/@found-in-space/skykit/loading';
  import { createDesktopExplorerPreset } from 'https://esm.sh/@found-in-space/skykit/presets';
  import { createViewer } from 'https://esm.sh/@found-in-space/skykit/render3d';

  const mount = document.getElementById('viewer');
  const dataset = createFoundInSpaceDataset();
  await dataset.ensureRootShard();
  await dataset.ensureBootstrap();

  const explorer = createDesktopExplorerPreset({
    fullscreen: true,
    navigationHud: true,
  });

  await createViewer(mount, {
    dataset,
    interestField: explorer.interestField,
    controllers: explorer.controllers,
    layers: explorer.layers,
    state: explorer.state,
    clearColor: 0x02040b,
  });
</script>
```

### 3. Modular Desktop Explorer

For a more honest v1 rendered path, compose from focused subpaths:

```js
import { createFoundInSpaceDataset } from '@found-in-space/skykit/loading';
import { createDesktopExplorerPreset } from '@found-in-space/skykit/presets';
import { createViewer } from '@found-in-space/skykit/render3d';

const dataset = createFoundInSpaceDataset({
  id: 'my-desktop-explorer',
});
await dataset.ensureRootShard();
await dataset.ensureBootstrap();

const explorer = createDesktopExplorerPreset({
  fullscreen: true,
  navigationHud: true,
});

const viewer = await createViewer(document.getElementById('viewer'), {
  dataset,
  interestField: explorer.interestField,
  controllers: explorer.controllers,
  layers: explorer.layers,
  state: explorer.state,
});
```

### 4. Guided Journeys

Use `createJourneyGraph()` with `createViewerJourneyController()` for the common viewer-driven tour cases:

```js
import { createJourneyGraph, createViewerJourneyController } from '@found-in-space/skykit/presets';

const graph = createJourneyGraph({
  initialSceneId: 'intro',
  scenes: {
    intro: {
      type: 'flyAndLook',
      observerPc: { x: 24, y: 8, z: -12 },
      lookAtPc: { x: 0, y: 0, z: 0 },
      flySpeed: 120,
    },
    roam: {
      type: 'free-roam',
      observerPc: { x: 48, y: 12, z: -30 },
      lookAtPc: { x: 0, y: 0, z: 0 },
      flySpeed: 150,
    },
  },
});

const journey = createViewerJourneyController({
  graph,
  viewer,
  cameraController: explorer.cameraController,
});

await journey.activateScene('intro');
```

## v1 Entry Points

SkyKit v1 is moving toward a service-first core with a beginner-friendly root API and focused subpath exports.

For simple tasks, start from the package root:

- `createDataset(options?)`
- `queryNearestStars(dataset, options)`
- `queryVisibleStars(dataset, options)`
- `createDefaultViewer(host, options)`

For more control, import by responsibility:

- `@found-in-space/skykit/loading`
- `@found-in-space/skykit/query`
- `@found-in-space/skykit/coords`
- `@found-in-space/skykit/render2d`
- `@found-in-space/skykit/render3d`
- `@found-in-space/skykit/movement`
- `@found-in-space/skykit/presets`

Recommended v1 subpath helpers:

- `@found-in-space/skykit/loading`
  - `createFoundInSpaceDataset()`
  - `createDataset()`
- `@found-in-space/skykit/render3d`
  - `createViewer()`
- `@found-in-space/skykit/presets`
  - `createDesktopExplorerPreset()`
  - `createJourneyGraph()`
  - `createJourneyController()`
  - `createViewerJourneyController()`

XR remains part of SkyKit, but for v1 it should be treated as an advanced supported path rather than the main beginner learning track.

## TypeScript

SkyKit now ships declaration-first TypeScript support for the root package and every public subpath. Public command, event, snapshot, journey, and plugin surfaces are typed for autocomplete and safer extension work, while the runtime stays in plain JS.

For package validation we run `npm run typecheck:public`, which checks the published declaration surface and TS consumer fixtures against the real export map.

## Architecture

Source lives under `src/` and is organised into purpose-driven sections.

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

High-level convenience API. `createViewer()` wires up a `ViewerRuntime` with a `DatasetSession` in a single call. `createDefaultViewer()` stays intentionally small; the richer public desktop path is `createViewer()` plus `createDesktopExplorerPreset()`.

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

- [`docs/architecture.md`](./docs/architecture.md): authoritative architecture, principles, boundaries, and review checklist
- [`docs/browser-quickstart.html`](./docs/browser-quickstart.html): single-file browser quickstart using public ESM/CDN imports
- [`docs/plans.md`](./docs/plans.md): v1 release planning, real-use-case lessons, and remaining work
