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
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';

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

The default material preserves the tuned desktop star shader used by the old
free-roam demo. `createVrThreeStarFieldMaterialProfile()` preserves the old XR
star shader as a separate opt-in profile. The earlier procedural alpha shader is
also kept as a teaching profile, so shader replacement is a one-line renderer
configuration:

```js
const field = createThreeStarField({
  materialProfile: createProceduralThreeStarFieldMaterialProfile(),
});
```

Cell coordinates are treated as already being in the requested output profile.
`renderScale` scales the returned `object3d`; it does not mutate cell arrays or
bake in application scene-scale constants.

See `examples/shader-tuning/` for a browser lesson that changes the renderer
view and material response without changing star cell data.
