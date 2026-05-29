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
```

The optional `@found-in-space/hr-diagram/touch-os` subpath publishes the WebGL
renderer as a composite embedded surface, matching the high-performance surface
pattern used by `touch-os`.

For the composed SkyKit example, see
`../skykit/examples/hr-diagram-free-roam/`.
