# @found-in-space/experimental-structure-layers

Status: experimental preservation package.

This package preserves the old SkyKit H-alpha tiled volume and dust/structure
layer code outside core `@found-in-space/skykit`. It is intentionally not a
stable product/provider API yet.

Use it when an existing experiment needs the current H-alpha or dust rendering
helpers. New core SkyKit work should treat these as external layers that can be
composed by a viewer, not as core runtime responsibilities.

```js
import {
  createHaTiledVolumeLayer,
  resolveHaTiledVolumeUrl,
} from '@found-in-space/experimental-structure-layers';

const layer = createHaTiledVolumeLayer({
  manifestUrl: resolveHaTiledVolumeUrl(),
});
```

The package may change or be replaced once the H-alpha/dust datasets have a
proper structural product/provider boundary.
