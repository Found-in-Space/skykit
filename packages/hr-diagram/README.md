# @found-in-space/hr-diagram

Reusable alpha HR diagram helpers for Found in Space star cells.

This package consumes `StarCellData` values and `StarCellDelta` lifecycle
events. It does not load octrees, plan demand, or own strategies. Live,
volume, and warm/lookahead demand should be expressed through the shared
strategy contract and requested through `@found-in-space/star-octree-provider`,
then applied to the HR renderer/store.

The package has two rendering paths:

- WebGL/Three.js for high-volume interactive diagrams.
- Canvas 2D for small static teaching views and fallback rendering.

It supports three projection/filtering modes:

- `magnitude-limited`: render stars visible from an observer and limiting
  apparent magnitude.
- `volume-complete`: render a fixed local volume around an observer.
- `frustum`: render stars that pass a view-projection filter.

```js
import {
  HR_DIAGRAM_MODE_VOLUME,
  createHrDiagramRenderer,
  createHrDiagramSurfaceSource,
  drawHrDiagramCanvas,
} from '@found-in-space/hr-diagram';

drawHrDiagramCanvas(ctx, { x: 0, y: 0, w: 480, h: 320 }, {
  store,
  mode: HR_DIAGRAM_MODE_VOLUME,
  volumeRadiusPc: 25,
});

const renderer = createHrDiagramRenderer({
  mode: 'magnitude-limited',
  limitingMagnitude: 6.5,
});

for await (const delta of session.deltas()) {
  renderer.apply(delta);
}

const surfaceSource = createHrDiagramSurfaceSource({
  sourceId: 'lesson:hr-diagram',
  width: 1024,
  height: 640,
});
```

`createHrDiagramSurfaceSource()` is part of the ordinary package entrypoint. It
creates the Three texture source and render target without importing touch-os,
so data and renderer consumers do not need the optional peer. Its optional
render/publish timestamp is a monotonic host time in milliseconds.

The optional `@found-in-space/hr-diagram/touch-os` subpath creates the touch-os
node that presents that texture as a non-interactive composite surface:

```js
import { createHrDiagramEmbeddedSurfaceNode } from '@found-in-space/hr-diagram/touch-os';

const root = createHrDiagramEmbeddedSurfaceNode({
  componentId: 'lesson:hr-node',
  sourceId: surfaceSource.sourceId,
  title: 'Hertzsprung–Russell diagram',
  fallbackLabel: 'HR diagram offline',
  preserveAspectRatio: true,
});
```

The adapter delegates layout and rendering to touch-os's public embedded-surface
component. A title gets its own header above the padded viewport.
`preserveAspectRatio: true` (the default) centers the source with contain-style
letterboxing; `false` stretches it to the complete padded content bounds. The
touch-os runtime and its embedded-surface service remain caller-owned.

For the composed SkyKit example, see
`../skykit/examples/hr-diagram-free-roam/`.
