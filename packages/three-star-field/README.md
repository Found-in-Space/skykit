# @found-in-space/three-star-field

Reusable alpha Three.js renderer for Found in Space star products.

This package consumes `StarObjectBatchProduct` values and product lifecycle
deltas. It does not load octrees, own camera controls, fetch sidecars, or know
about lesson runtimes.

The `observer-shell` strategy in the example belongs to
`@found-in-space/star-octree-provider`; this renderer only consumes the product
deltas that provider emits.

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

for await (const delta of provider.streamObjectBatches({
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

Product coordinates are treated as already being in the requested output
profile. `renderScale` scales the returned `object3d`; it does not mutate product
arrays or bake in application scene-scale constants.

See `examples/shader-tuning/` for a browser lesson that changes the renderer
view and material response without changing star product data.
