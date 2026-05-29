# @found-in-space/star-map-canvas

Status: current alpha package.

Reusable Canvas2D star-map adapter for spatial star cells.

This package consumes `StarCellStore` data or plain `StarRow` iterables from
`@found-in-space/star-trees` and draws observer-relative 2D sky maps. It does
not create octree sessions, load catalogs, own sidecars, import
`anchored-image`, render Three.js objects, or define provider strategy
semantics.

The intended package path is:

```txt
star-octree-provider -> star-trees cell store -> star-map-canvas
```

Provider strategy composition and planning are defined by
`@found-in-space/star-trees` and `@found-in-space/star-octree-provider`. The
examples use `observer-shell` only as a convenient source of streamed star
cells.

## Minimal Shape

```js
import {
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  consumeStarCellDeltas,
  createObserverShellStrategy,
  createStarCellStore,
} from '@found-in-space/star-trees';
import { createCanvasStarMap } from '@found-in-space/star-map-canvas';

const provider = createStarOctreeProviderService({ url });
const store = createStarCellStore();
const map = createCanvasStarMap(canvas, { store });

const session = provider.createSession({
  strategy: createObserverShellStrategy(),
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
});

void consumeStarCellDeltas(session.deltas(), store, { throwOnError: false });

store.subscribe(() => {
  map.render({ observerPc, limitingMagnitude: 6.5 });
});

await session.updateView({ observerPc, limitingMagnitude: 6.5 });
```

The map handle owns canvas sizing, rendering, last-render cache, picking, and
disposal:

```js
map.resize({ width: 960, height: 480, dpr: 2 });
const result = map.render({ observerPc });
const picked = map.pick({ x, y }, { tolerancePx: 10 });
map.dispose();
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

`ProjectedStarMap` is a plain draw list. PDF, SVG, print, test, export, or game
code can consume it without depending on Canvas2D.

The built-in RA/Dec all-sky and FoV projections use sky-chart orientation:
increasing RA/east runs toward the left side of the map.

## Built-In Projections

Use the default equirectangular all-sky projection from any parsec-space
observer:

```js
map.render({
  observerPc: { x: 140, y: -20, z: 8 },
  limitingMagnitude: 6.5,
});
```

Use `createGnomonicProjection()` for horizontal field-of-view star charts:

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

Use `createRaDecProjection()` for compact custom projections:

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

## Layers And Hooks

Use `layers` for Canvas components such as grids, labels, masks, export marks,
and externally projected images. Layer phases are Canvas draw order:
`background` renders before stars and `foreground` renders after stars.

Use `mapPoint` to transform projected points and `drawPoint` to replace the
default star glyph:

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
  drawPoint(ctx, point) {
    ctx.globalAlpha = point.alpha;
    ctx.fillStyle = point.color;
    ctx.fillRect(point.x - 1, point.y - 1, 3, 3);
  },
});
```

For warped image overlays, use the layer context's `projectRaDecUnclipped`
helper so FoV charts can clip the final image draw instead of dropping boundary
triangles before they reach Canvas:

```js
import {
  drawAnchoredImageMeshCanvas,
} from '@found-in-space/anchored-image/canvas';

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

## Boundary

Guide-star catalogs and directional sky catalogs are a future source lane. This
package's current input is spatial star cells with parsec positions, so
applications can render the sky from arbitrary `observerPc` positions.

The package deliberately does not own physics, animation systems, game logic,
provider demand, sidecar lookup, or cartographic background datasets. It exposes
projected data, draw hooks, layers, and picking so applications can add those
behaviors in their own code.
