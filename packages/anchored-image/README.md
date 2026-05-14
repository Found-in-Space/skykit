# @found-in-space/anchored-image

Status: alpha package.

Renderer-neutral anchored image math for sky and space overlays.

This package describes image pixels that are anchored to ICRS directions or
parsec-space positions, solves those anchors into mesh data, and offers small
Canvas2D and Three.js adapters. It does not include skyculture images,
constellation assumptions, star loading, octree sessions, or SkyKit viewer
lifecycle code.

The intended package path is:

```txt
skyculture / survey / nebula image package
  -> anchored-image
      -> anchored-image/canvas
      -> anchored-image/three
```

## Core

```js
import {
  loadAnchoredImageManifest,
  solveAnchoredImageMesh,
} from '@found-in-space/anchored-image';

const manifest = await loadAnchoredImageManifest({ manifestUrl });
const mesh = solveAnchoredImageMesh(manifest.images[0], {
  subdivisions: 2,
});
```

Images use generic anchors:

```js
{
  id: 'orion-art',
  groupId: 'Ori',
  image: {
    src: 'orion.webp',
    width: 1024,
    height: 1024,
    anchors: [
      {
        pixel: { x: 100, y: 200 },
        target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 0 },
      },
    ],
  },
}
```

`kind: "direction"` targets project onto a sky direction. `kind: "position"`
targets are parsec-space coordinates for future spatial image meshes such as
nebula or survey plates with approximate depth anchors.

Legacy constellation-art manifests with `constellations`, `image.file`,
`image.size`, `image.anchors[].pos`, and `image.anchors[].direction` are
accepted and normalized into the generic model.

## Canvas

```js
import {
  drawAnchoredImageMeshCanvas,
} from '@found-in-space/anchored-image/canvas';

drawAnchoredImageMeshCanvas(ctx, mesh, {
  sourceImage,
  wrapWidth: canvas.width,
  projectTarget(target) {
    return projectDirectionOrPosition(target);
  },
});
```

The Canvas adapter accepts a caller-supplied projection function. It does not
own star-map projection policy, star iteration, catalogs, or map backgrounds.

## Three.js

```js
import {
  createAnchoredImageGroup,
} from '@found-in-space/anchored-image/three';

const group = await createAnchoredImageGroup({
  manifestUrl,
  radius: 8,
  opacity: 0.22,
});
```

`three` is an optional peer dependency used only by the `./three` subpath. The
root package and `./canvas` do not import Three.js.

## Boundary

Skyculture/content packages own images, cultural naming, attribution, and
license details. `@found-in-space/anchored-image` only owns the reusable
representation, loading normalization, anchor solving, and renderer-adjacent
mesh/draw helpers.
