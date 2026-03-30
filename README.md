# SkyKit

SkyKit is the reusable Found in Space runtime for building interactive 3D sky experiences.

- GitHub: `https://github.com/Found-in-Space/skykit`
- npm: `@found-in-space/skykit`

SkyKit pulls together dataset services, loading and sharding strategies, scene and controller skeletons, rendering layers, and shader-based star rendering. It can be used as:

- a standalone viewer runtime for desktop or XR demos
- a source-level library for custom visualizations, experiences, or games

## Install

```bash
npm install @found-in-space/skykit
```

## Current Surface

The runtime currently exposes plain JavaScript modules centered around `createViewer()` and shared `DatasetSession` management. Constellation art is manifest-based and can be served from local files, a CDN such as `unpkg`, or other URL-addressable asset hosts.

The shared demo now defaults to Western constellation art from:

- `https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json`

You can override that with:

- `?constellationManifestUrl=...`

Dataset URLs can still be overridden with the existing query parameters documented in the demo modules.

## Development

```bash
npm install
npm run dev
```

The Vite demo entrypoints are:

- `index.html`: desktop free-roam demo
- `index-shared.html`: shared-session desktop demo
- `index-vr.html`: XR free-roam demo
- `index-parallax-debug.html`: device orientation + parallax sensor debug sandbox

## Docs

- [`docs/viewer-architecture.md`](./docs/viewer-architecture.md): current architecture and migration context
- [`docs/viewer-roadmap.md`](./docs/viewer-roadmap.md): roadmap and phase notes
