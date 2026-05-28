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
- `@found-in-space/star-trees`: star tree identities, cell stores, iteration, star math, and display helpers
- `@found-in-space/star-octree-provider`: star octree loading, provider-owned planning, streaming sessions, and cell emission against shared strategy objects
- `@found-in-space/meta-sidecar-provider`: metadata sidecar facts keyed by star refs
- `@found-in-space/star-map-canvas`: lightweight 2D starmap rendering
- `@found-in-space/three-star-field`: Three.js renderer for streamed star cells
- `@found-in-space/hr-diagram`: HR diagram data, Canvas fallback, and WebGL renderer
- `@found-in-space/anchored-image`: renderer-neutral anchored image manifests, solving, and Canvas2D/Three.js image adapters
- `@found-in-space/skykit`: friendly composition exports and teaching-oriented examples
  - `@found-in-space/skykit/xr`: optional WebXR rig/input/ray/session/depth helpers

This split is not limited to "universe data" packages. Shared interaction or
surface systems should also stand alone when they are broadly reusable. For
example, [`touch-os`](https://github.com/found-in-Space/touch-os/) is a Found in
Space project that `skykit` can depend on for interactive surfaces, but it
should not be folded back into core `skykit`.

Camera timeline authoring and deterministic export tooling live in the sibling
`../skykit-studio` project as `@found-in-space/skykit-studio`. It still consumes
SkyKit packages, but it is not part of this workspace.

Historical H-alpha and dust experiments remain available in the sibling
`../skykit-halpha` project. Future structural data packages should be designed
against the current package APIs when there is an active consumer.
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
- [`docs/star-map-canvas.md`](./docs/star-map-canvas.md): current alpha contract for `@found-in-space/star-map-canvas`
- [`docs/anchored-image.md`](./docs/anchored-image.md): current alpha contract for `@found-in-space/anchored-image`
- [`docs/constellations.md`](./docs/constellations.md): constellation loading paths and skyculture metadata naming rules
- [`docs/skykit-core-composition.md`](./docs/skykit-core-composition.md): current alpha direction for core `@found-in-space/skykit`
- [`docs/skykit-browser-plugins.md`](./docs/skykit-browser-plugins.md): browser add-ons and first-party browser capabilities
- [`docs/xr-architecture.md`](./docs/xr-architecture.md): current alpha boundary for `@found-in-space/spatial` and `@found-in-space/skykit/xr`
- [`docs/chapter-and-camera-timeline-architecture.md`](./docs/chapter-and-camera-timeline-architecture.md): current alpha boundary for website chapters and Studio camera timelines
