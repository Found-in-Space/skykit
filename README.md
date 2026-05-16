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

If you are reading this README on GitHub, you can open **[SkyKit experiments](https://foundin.space/skykit/)** on the Found in Space site to try the latest interactive demos in the browser—development sandboxes that exercise new ideas in the runtime before they settle into stable APIs.

## Install

```bash
npm install @found-in-space/skykit
```

## Architecture

Reusable alpha code lives under `packages/`. The root package is a workspace and
demo shell; new architecture should be package-owned.

Current package direction:

- `@found-in-space/product-stream`: generic product delta/store lifecycle
- `@found-in-space/star-products`: star product stores, iteration, math, projections, and display helpers
- `@found-in-space/star-octree-provider`: star octree loading, provider-owned strategies, streaming sessions, and product emission
- `@found-in-space/meta-sidecar-provider`: metadata sidecar facts keyed by star product refs
- `@found-in-space/star-map-canvas`: lightweight 2D starmap rendering
- `@found-in-space/three-star-field`: Three.js renderer for streamed star products
- `@found-in-space/hr-diagram`: HR diagram data, Canvas fallback, and WebGL renderer
- `@found-in-space/anchored-image`: renderer-neutral anchored image manifests, solving, and Canvas2D/Three.js image adapters
- `@found-in-space/xr`: immersive rig/input/motion/ray/depth helpers
- `@found-in-space/experimental-structure-layers`: preserved experimental H-alpha/dust helpers, not stable core
- `@found-in-space/star-kinematics-provider`: proper-motion and velocity sidecars for dynamic-universe lessons
- `@found-in-space/solar-ephemeris`: time-aware solar-system and trajectory products
- `@found-in-space/skykit`: friendly composition exports and teaching-oriented examples

This split is not limited to "universe data" packages. Shared interaction or
surface systems should also stand alone when they are broadly reusable. For
example, [`touch-os`](https://github.com/found-in-Space/touch-os/) is a Found in
Space project that `skykit` can depend on for interactive surfaces, but it
should not be folded back into core `skykit`.

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
- [`docs/package-learning-architecture.md`](./docs/package-learning-architecture.md): alpha learning path and lesson direction
- [`docs/star-octree-provider.md`](./docs/star-octree-provider.md): current alpha contract for `@found-in-space/star-octree-provider`
- [`docs/star-map-canvas.md`](./docs/star-map-canvas.md): current alpha contract for `@found-in-space/star-map-canvas`
- [`docs/anchored-image.md`](./docs/anchored-image.md): current alpha contract for `@found-in-space/anchored-image`
- [`docs/skykit-core-composition.md`](./docs/skykit-core-composition.md): current alpha direction for core `@found-in-space/skykit`
- [`docs/xr-architecture.md`](./docs/xr-architecture.md): current alpha boundary for `@found-in-space/xr`
