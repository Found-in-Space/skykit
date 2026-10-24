# @found-in-space/three-star-field

Reusable alpha Three.js renderer for Found in Space star cells.

This package consumes `StarCellData` values and `StarCellDelta` lifecycle
events. It does not load octrees, own camera controls, fetch sidecars, or know
about lesson runtimes.

The renderer keeps a `Map<cellKey, StarCellData>` and derives one aggregate
Three.js points object from current cells in deterministic `cellKey` order. The
rendered object is stable; retained cells are not removed and re-added because a
transport batch changed shape.

```js
import {
  createProceduralThreeStarFieldMaterialProfile,
  createThreeStarField,
} from '@found-in-space/three-star-field';
import {
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';

const provider = createStarOctreeProviderService({ url });
const field = createThreeStarField({ renderScale: 0.001 });
scene.add(field.object3d);

for await (const delta of provider.streamCells({
  strategy: createObserverShellStrategy(),
  view: {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  },
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
})) {
  field.apply(delta);
}
```

The default material provides the tuned desktop star shader.
`createVrThreeStarFieldMaterialProfile()` provides an XR-friendly profile as a
separate opt-in. The procedural alpha shader is also kept as a teaching profile,
so shader replacement is a one-line renderer configuration:

```js
const field = createThreeStarField({
  materialProfile: createProceduralThreeStarFieldMaterialProfile(),
});
```

Cell coordinates are treated as already being in the requested output profile.
`renderScale` scales the returned `object3d`; it does not mutate cell arrays or
bake in application scene-scale constants.

The field handle also supports explicit cells, picking, visible bounds, view
updates, snapshots, and disposal:

```js
field.setView({
  observerPosition: { x: 0, y: 0, z: 0 },
  limitingMagnitude: 7,
});

const hit = field.pick(ray, {
  toleranceDeg: 2,
  viewportHeight: canvas.height,
});

const bounds = field.getVisibleBounds({ units: 'parsec' });
const snapshot = field.getSnapshot();
field.dispose();
```

Picking returns the public `cellKey`, `objectIndex`, optional `StarObjectRef`,
optional `StarPickMeta`, apparent magnitude, visual radius, and distance. It
does not invent a renderer-specific star ID.

## Shared panel and scene interaction (development)

`@found-in-space/three-star-field/interaction` exports `createThreeStarFieldTarget`.
Register it with TouchOS 0.4's `ui.registerTarget(...)` alongside panel views:

```js
import { createThreeStarFieldTarget } from '@found-in-space/three-star-field/interaction';
const unregister = ui.registerTarget(createThreeStarFieldTarget({
  id: 'stars', field, pickOptions: { toleranceDeg: 0.8 },
  onSelect(result) { selectStar(result.objectRef, result); }
}));
```

The pure query delegates to `field.pick(ray, options)`, preserving its angular
tolerance, scoring, `StarObjectRef`, cell and metadata. It returns one aggregate
target with a semantic entity identity, and converts the chosen local point to
world metres for cross-target arbitration. A domain score is never treated as
panel distance. Panel capture prevents selection behind a slider, including
release outside the panel. Unregister before disposing the field. This subpath
adds no runtime dependency on TouchOS; its type contract uses the optional peer.
Packed composition checks run with TouchOS 0.4.0-alpha.0 and pointer-events 6.6.32.
