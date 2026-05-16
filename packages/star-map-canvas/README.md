# @found-in-space/star-map-canvas

Status: alpha package.

Reusable Canvas2D star-map adapter for spatial star products.

This package consumes `StarRepresentationStore` data from
`@found-in-space/star-products` and draws observer-relative 2D sky maps. It does
not create octree sessions, load catalogs, own sidecars, import
`anchored-image`, or render Three.js objects.

Provider strategy semantics are outside this package. The examples use
`observer-shell` only as a convenient source of streamed star products; strategy
composition and planning are defined by `@found-in-space/star-octree-provider`.

The intended package path is:

```txt
star-octree-provider -> star-products store -> star-map-canvas
```

The built-in RA/Dec all-sky and FoV projections use sky-chart orientation:
increasing RA/east runs toward the left side of the map.

## Minimal Shape

```js
import {
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  consumeProductDeltas,
  createStarRepresentationStore,
} from '@found-in-space/star-products';
import { createCanvasStarMap } from '@found-in-space/star-map-canvas';

const provider = createStarOctreeProviderService({ url });
const store = createStarRepresentationStore();
const map = createCanvasStarMap(canvas, { store });

const session = provider.createSession({
  strategy: createObserverShellStrategy(),
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
});

void consumeProductDeltas(session.deltas(), store, { throwOnError: false });

store.subscribe(() => {
  map.render({ observerPc, limitingMagnitude: 6.5 });
});

session.updateView({ observerPc, limitingMagnitude: 6.5 });
```

## Projection And Drawing

The high-level API is backed by lower-level steps:

```js
import {
  drawProjectedStarMap,
  projectStarMap,
} from '@found-in-space/star-map-canvas';

const projected = projectStarMap(rect, {
  store,
  observerPc,
  limitingMagnitude: 6.5,
});

drawProjectedStarMap(ctx, projected);
```

`ProjectedStarMap` is a plain draw list. PDF, SVG, print, test, or export code
can consume it without depending on Canvas2D.

## Custom Projection

Use RA/Dec primitives for compact custom projections:

```js
import { createRaDecProjection } from '@found-in-space/star-map-canvas';

const sinusoidal = createRaDecProjection((sky, context) => {
  const ra = sky.raDeg * Math.PI / 180;
  const dec = sky.decDeg * Math.PI / 180;
  return {
    x: context.width * (0.5 + (ra - Math.PI) * Math.cos(dec) / (2 * Math.PI)),
    y: context.height * (0.5 - dec / Math.PI),
  };
}, { id: 'sinusoidal' });

map.render({ projection: sinusoidal });
```

Use `createGnomonicProjection()` for horizontal FoV star charts.

## Layers And Hooks

Use `layers` for Canvas components such as grids, labels, and externally
projected images. Use `mapPoint` to transform final projected points, and
`drawPoint` to replace the default star glyph.
Layer phases are Canvas draw order: `background` renders before stars and
`foreground` renders after stars.
For warped image overlays, use the layer context's `projectRaDecUnclipped`
helper so FoV charts can clip the final image draw instead of dropping boundary
triangles before they reach Canvas.
The browsable use-cases example also includes a demo-only falling-star pile
helper to show game behavior built on projected points without becoming package
API.

```js
map.render({
  timeMs: performance.now(),
  layers: [gridLayer],
  mapPoint(point, context) {
    return {
      ...point,
      alpha: point.alpha * (0.7 + 0.3 * Math.sin(context.timeMs * 0.004)),
    };
  },
});
```

Guide-star catalogs and directional sky catalogs are a future source/product
lane. This package's v1 input is spatial star rows with parsec positions, so
applications can render the sky from arbitrary `observerPc` positions.
