# Found in Space — SkyKit

Part of [Found in Space](https://foundin.space/), a project that turns real astronomical measurements into interactive explorations of the solar neighbourhood. See all repositories at [github.com/Found-in-Space](https://github.com/Found-in-Space).

SkyKit is becoming a slim teaching toolkit built from narrow-purpose, reusable
`@found-in-space/*` modules. The goal is that students and builders can start
with real astronomical data, then progressively learn how to stream it, analyse
it, draw it, enrich it with sidecars, and compose it into interactive scenes
without needing to adopt a large monolithic viewer.

The live alpha path is package-first: reusable work lands in focused packages
under `packages/`, with `@found-in-space/skykit` serving as the friendly
composition layer.

If you are reading this README on GitHub, you can open the public **[SkyKit lessons](https://foundin.space/learn-build/skykit/)** on the Found in Space site.

## Install

```bash
npm install @found-in-space/skykit
```

## Architecture

Reusable alpha code lives under `packages/`. The root package is a workspace and
demo shell; new architecture should be package-owned.

Current package direction:

- `@found-in-space/spatial`: dependency-free coordinates, poses, smooth paths, timed pose tracks, preload hints, routes, targets, and smooth navigation helpers
- `@found-in-space/star-trees`: star tree identities, cell stores, iteration, strategies, star math, and display helpers
- `@found-in-space/star-octree-provider`: star octree loading, provider-owned planning, streaming sessions, warm/fetch helpers, and cell emission against shared strategy objects
- `@found-in-space/meta-sidecar-provider`: metadata sidecar facts keyed by star refs
- `@found-in-space/star-map-canvas`: lightweight 2D starmap rendering, projections, layers, hooks, and picking
- `@found-in-space/three-star-field`: Three.js renderer, material profiles, bounds, and picking for streamed star cells
- `@found-in-space/hr-diagram`: HR diagram data, Canvas fallback, WebGL renderer, and optional touch-os surface adapter
- `@found-in-space/anchored-image`: renderer-neutral anchored image manifests, solving, direction resolution, and Canvas2D/Three.js image adapters
- `@found-in-space/skykit`: friendly composition exports, browser embed/data/viewer subpaths, touch-os bridge, and teaching-oriented examples
  - `@found-in-space/skykit/xr`: optional WebXR rig/input/ray/session/depth/navigation/picking helpers

This split is not limited to "universe data" packages. Shared interaction or
surface systems should also stand alone when they are broadly reusable. For
example, [`touch-os`](https://github.com/Found-in-Space/touch-os) is a Found in
Space project that `skykit` can depend on for interactive surfaces, but it
should not be folded back into core `skykit`.

Camera timeline authoring and deterministic export tooling live in the sibling
[`Found-in-Space/skykit-studio`](https://github.com/Found-in-Space/skykit-studio)
repository as `@found-in-space/skykit-studio`. Studio is downstream: it consumes
public SkyKit and spatial APIs, while SkyKit never depends on Studio. Studio is
not part of this workspace.

Historical H-alpha and dust pipeline work remains available in
[`Found-in-Space/pipeline-dust`](https://github.com/Found-in-Space/pipeline-dust).
Future structural data packages should be designed against the current package
APIs when there is an active consumer.
The local legacy demo index keeps Dust Roam and H-alpha Volume visible as
porting references, not current alpha examples.

## Development

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5173/
npm run build        # build the single GitHub Pages demo site into dist/
node --test          # run all tests
node --test --watch  # watch mode
```

Standalone SkyKit app examples live under `apps/examples/`. Focused package
examples can still live under `packages/*/examples/`; the old root `demos/`
proof-of-concept sandboxes stay as legacy reference material. Public lessons
live on the website. The deploy build keeps the selected demo pages under one
root `dist/index.html` so GitHub Pages can publish a single linked demo site.

Constellation art examples use the published
`@found-in-space/stellarium-skycultures-western` package APIs. See
[`docs/constellations.md`](./docs/constellations.md) for the browser capability
path, the app-composition path, and skyculture metadata naming rules.

## Docs

- [`docs/alpha-rules.md`](./docs/alpha-rules.md): current alpha rewrite rules and package-boundary guidance
- [`docs/package-learning-architecture.md`](./docs/package-learning-architecture.md): alpha learning path and package-example direction
- [`docs/star-octree-provider.md`](./docs/star-octree-provider.md): current alpha contract for `@found-in-space/star-octree-provider`
- [`docs/multiple-star-providers.md`](./docs/multiple-star-providers.md): accepted direction for composing octree, static reference, scenario, and session star providers
- [`packages/star-map-canvas/README.md`](./packages/star-map-canvas/README.md): package API guide for `@found-in-space/star-map-canvas`
- [`packages/anchored-image/README.md`](./packages/anchored-image/README.md): package API guide for `@found-in-space/anchored-image`
- [`docs/constellations.md`](./docs/constellations.md): constellation loading paths and skyculture metadata naming rules
- [`docs/skykit-core-composition.md`](./docs/skykit-core-composition.md): current alpha direction for core `@found-in-space/skykit`
- [`docs/xr-architecture.md`](./docs/xr-architecture.md): current XR/spatial boundary and the `0.3.0` XR composition plan
- [`docs/chapter-and-camera-timeline-architecture.md`](./docs/chapter-and-camera-timeline-architecture.md): current chapter/Studio boundary and the `0.3.0` guided-journey plan
- [`docs/releasing.md`](./docs/releasing.md): Changesets release flow for publishable packages
