# @found-in-space/star-map-canvas

Status: alpha package.

Reusable Canvas2D star-map adapter for spatial star products.

This package consumes `StarRepresentationStore` data from
`@found-in-space/star-products` and draws an observer-relative 2D sky map. It
does not create octree sessions, load catalogs, own sidecars, or render Three.js
objects.

The intended package path is:

```txt
star-octree-provider -> star-products store -> star-map-canvas
```

## Minimal Shape

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

void consumeProductDeltas(session.deltas(), store, { throwOnError: false });

store.subscribe(() => {
  map.render({ observerPc, limitingMagnitude: 6.5 });
});

session.updateView({ observerPc, limitingMagnitude: 6.5 });
```

Guide-star catalogs and directional sky catalogs are a future source/product
lane. This package's v1 input is spatial star rows with parsec positions.
