# Star Map Canvas Package

Status: alpha package documentation for `@found-in-space/star-map-canvas`.

`@found-in-space/star-map-canvas` is a reusable Canvas2D adapter for spatial
star cells. It consumes `StarCellStore` data from
`@found-in-space/star-products` and renders an observer-relative 2D sky map.

It sits in the package hierarchy as a renderer/representation adapter:

```txt
star-octree-provider
  -> star-products cell store
      -> star-map-canvas
      -> three-star-field
      -> hr-diagram

skykit
  composes these packages as a slim teaching and convenience layer
```

## Purpose

The package owns:

```txt
StarCellStore / StarRow iteration
  -> observer-relative apparent magnitude filtering
  -> RA/Dec or custom 2D projection
  -> Canvas2D drawing
  -> last-render point cache and simple picking
```

It does not own:

```txt
octree provider sessions
source bytes or catalog loading
cell delta consumption
guide-star catalog source design
Three.js/WebGL/XR rendering
sidecar metadata lookup
galaxy-map backgrounds or galactocentric cartography
```

Guide-star or bright-star catalogs are a future source lane. This package's v1
path is spatial stars with parsec positions, so applications can render the sky
from arbitrary `observerPc` positions.

## Normative Use-Cases

The package keeps the friendly `createCanvasStarMap()` surface, but also exposes
lower-level projection and drawing steps so applications can intervene between
them.

### 1. All-Sky From Anywhere

Render an RA/Dec equirectangular all-sky map from any parsec-space observer
position by providing `observerPc` and `limitingMagnitude`. The default all-sky
projection uses sky-chart orientation: increasing RA/east runs toward the left
side of the map.

```js
const map = createCanvasStarMap(canvas, { store });

map.render({
  observerPc: { x: 140, y: -20, z: 8 },
  limitingMagnitude: 6.5,
});
```

### 2. Custom Star Style Or Glyph Renderer

Canvas2D does not have shaders in the WebGL sense, so the package exposes
style, point transforms, and glyph drawing hooks:

```js
map.render({
  drawPoint(ctx, point) {
    ctx.globalAlpha = point.alpha;
    ctx.fillStyle = point.color;
    ctx.fillRect(point.x - 1, point.y - 1, 3, 3);
  },
});
```

### 3. FoV Star Chart

Use `createGnomonicProjection()` for perspective-style charts with a horizontal
field of view:

```js
import { createGnomonicProjection } from '@found-in-space/star-map-canvas';

map.render({
  projection: createGnomonicProjection({
    centerRaDeg: 83,
    centerDecDeg: -5,
    fovDeg: 70,
  }),
});
```

### 4. Projection Dataset

`projectStarMap()` produces a Canvas-free `ProjectedStarMap` draw list. A PDF,
SVG, print, test, or export path can consume that plain projected data without
depending on Canvas2D:

```js
import { projectStarMap } from '@found-in-space/star-map-canvas';

const projected = projectStarMap({ x: 0, y: 0, w: 1200, h: 800 }, {
  store,
  observerPc,
  limitingMagnitude: 6.5,
});

console.log(projected.points.slice(0, 3));
```

### 5. Anchored Images

`star-map-canvas` does not import `anchored-image`, but its layer context is
enough to compose the two packages:

```js
import { drawAnchoredImageMeshCanvas } from '@found-in-space/anchored-image/canvas';

const artLayer = {
  phase: 'background',
  render(context) {
    drawAnchoredImageMeshCanvas(context.ctx, mesh, {
      sourceImage,
      context,
      projectTarget(target, layerContext) {
        const sky = target.kind === 'direction'
          ? layerContext.icrsDirectionToRaDec(target)
          : layerContext.icrsPositionToRaDec(target, layerContext.observerPc);
        return sky
          ? layerContext.projectRaDecUnclipped?.(sky)
            ?? layerContext.projectRaDec?.(sky)
            ?? null
          : null;
      },
    });
  },
};

map.render({ layers: [artLayer] });
```

The unclipped helper matters for warped images in FoV charts: stars should be
clipped to the chart, but image triangles need their full boundary projected so
Canvas can crop the final draw naturally.

### 6. Canvas Hooks And Components

Use background and foreground layers for grids, labels, masks, custom
backgrounds, export marks, or other Canvas2D components:

```js
const gridLayer = {
  phase: 'background',
  render({ ctx, rect }) {
    ctx.strokeStyle = 'rgba(115, 213, 255, 0.25)';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  },
};

map.render({ layers: [gridLayer] });
```

### 7. Deep Interactivity

For unknown-unknowns, intervene in projection-space with `mapPoint`, custom
drawing with `drawPoint`, and picking against the final projected cache:

```js
map.render({
  timeMs: performance.now(),
  mapPoint(point, context) {
    return {
      ...point,
      alpha: point.alpha * (0.65 + 0.35 * Math.sin(context.timeMs * 0.004)),
    };
  },
});

const picked = map.pick({ x, y });
```

The package deliberately does not own physics, animation systems, or game
logic. It exposes enough projected data and draw hooks for applications to add
those behaviors in their own code.

## Minimal Example

```js
import {
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  consumeStarCellDeltas,
  createStarCellStore,
} from '@found-in-space/star-products';
import { createCanvasStarMap } from '@found-in-space/star-map-canvas';

const provider = createStarOctreeProviderService({ url });
const store = createStarCellStore();
const map = createCanvasStarMap(canvas, { store });

const session = provider.createSession({
  strategy: createObserverShellStrategy(),
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
});

void consumeStarCellDeltas(session.deltas(), store);

store.subscribe(() => {
  map.render({ observerPc, limitingMagnitude: 6.5 });
});

session.updateView({ observerPc, limitingMagnitude: 6.5 });
```

The companion browser example lives at
`packages/star-octree-provider/examples/canvas-star-map/`.

The broader use-cases example lives at
`packages/star-map-canvas/examples/use-cases/` and uses the hosted public
octree stream by default.
