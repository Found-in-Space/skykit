# Star Map Canvas Package

Status: alpha package documentation for `@found-in-space/star-map-canvas`.

`@found-in-space/star-map-canvas` is a reusable Canvas2D adapter for spatial
star products. It consumes `StarRepresentationStore` data from
`@found-in-space/star-products` and renders an observer-relative 2D sky map.

It sits in the package hierarchy as a renderer/representation adapter:

```txt
product-stream
  <- star-products
      <- star-octree-provider

star-products
  <- star-map-canvas
  <- three-star-field
  <- hr-diagram

skykit
  composes these packages as a slim teaching and convenience layer
```

## Purpose

The package owns:

```txt
StarRepresentationStore / StarRow iteration
  -> observer-relative apparent magnitude filtering
  -> RA/Dec or custom 2D projection
  -> Canvas2D drawing
  -> last-render point cache and simple picking
```

It does not own:

```txt
octree provider sessions
source bytes or catalog loading
product delta consumption
guide-star catalog product design
Three.js/WebGL/XR rendering
sidecar metadata lookup
galaxy-map backgrounds or galactocentric cartography
```

Guide-star or bright-star catalogs are a future source/product lane. This
package's v1 path is spatial stars with parsec positions, so applications can
render the sky from arbitrary `observerPc` positions.

## Minimal Example

```js
import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';
import {
  consumeProductDeltas,
  createStarRepresentationStore,
} from '@found-in-space/star-products';
import { createCanvasStarMap } from '@found-in-space/star-map-canvas';

const provider = createStarOctreeProviderService({ url });
const store = createStarRepresentationStore();
const map = createCanvasStarMap(canvas, { store });

const session = provider.createSession({
  strategy: { kind: 'observer-shell' },
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
});

void consumeProductDeltas(session.deltas(), store);

store.subscribe(() => {
  map.render({ observerPc, limitingMagnitude: 6.5 });
});

session.updateView({ observerPc, limitingMagnitude: 6.5 });
```

The companion browser example lives at
`packages/star-octree-provider/examples/canvas-star-map/`.
