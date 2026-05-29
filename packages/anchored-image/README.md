# @found-in-space/anchored-image

Status: current alpha package.

Renderer-neutral anchored image math for sky and space overlays.

This package describes image pixels that are anchored to ICRS directions or
parsec-space positions, solves those anchors into mesh data, and offers small
Canvas2D and Three.js adapters. It does not include skyculture images,
constellation assumptions, star loading, octree sessions, sidecar metadata, or
SkyKit viewer lifecycle code.

The intended package path is:

```txt
skyculture / survey / nebula image package
  -> anchored-image
      -> anchored-image/canvas
      -> anchored-image/three
```

The root package and `./canvas` subpath stay free of Three.js imports. The
`./three` subpath uses `three` as an optional peer dependency.

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
  format: 'found-in-space/anchored-image-manifest@1',
  images: [
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
    },
  ],
}
```

The canonical manifest schema is exported from:

```txt
@found-in-space/anchored-image/schemas/anchored-image-manifest.v1.schema.json
```

`kind: "direction"` targets project onto a sky direction. `kind: "position"`
targets are parsec-space coordinates for spatial image meshes such as nebula or
survey plates with approximate depth anchors.

Skyculture, survey, and astrophotography packages should export this canonical
format directly, or provide a small adapter from their richer package format
before calling this package.

## Resolution Helpers

`buildAnchoredImageDirectionResolver()` creates a renderer-neutral lookup helper
for image catalogs whose anchors are ICRS directions:

```js
import { buildAnchoredImageDirectionResolver } from '@found-in-space/anchored-image';

const resolver = buildAnchoredImageDirectionResolver(manifest);
const hit = resolver.resolve([0.12, -0.4, 0.91]);
const images = resolver.listImages();
```

Use this for constellation art selection, guide overlays, and UI lists. It
returns anchored-image summaries and generic labels; skyculture descriptions,
stories, boundaries, and cultural naming policy remain in the skyculture
package or application.

For Stellarium-style `common_name` metadata, prefer `native` as the display
name and treat `english` as a translated gloss. See
[`../../docs/constellations.md`](../../docs/constellations.md) for the SkyKit
loading paths and metadata naming rules.

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

For repeated map rendering, create a Canvas layer:

```js
import {
  createAnchoredImageCanvasLayer,
} from '@found-in-space/anchored-image/canvas';

const layer = createAnchoredImageCanvasLayer({
  manifestUrl,
  projectTarget(target, context) {
    return context.projectTargetToMapPixel(target);
  },
});

await layer.load();
layer.render({ ctx, projectTargetToMapPixel });
```

`@found-in-space/star-map-canvas` can host this layer by passing its
projection helpers through the layer context, but the two packages do not import
each other.

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
scene.add(group);
```

The Three.js subpath also exports `createAnchoredImageMeshObject()` for callers
that already solved and loaded one image mesh, plus `disposeAnchoredImageObject()`
for releasing texture/material/geometry resources.

`createAnchoredImageGroup()` accepts filters, group filters, a caller-provided
`THREE.TextureLoader`, transform hooks for direction and position targets, and
texture-error policy options. It creates generic objects; SkyKit plugins own
viewer lifecycle, fade state, observer-relative placement, and controls.

## Boundary

Skyculture/content packages own images, cultural naming, attribution, license
details, and rich metadata. `@found-in-space/anchored-image` owns only the
reusable representation, URL normalization, anchor solving, mesh generation,
direction resolution, and renderer-adjacent draw/object helpers.
