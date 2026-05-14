# Anchored Image Package

Status: current alpha direction.

`@found-in-space/anchored-image` is the neutral support package for images whose
pixels are anchored to sky or space coordinates. It exists so constellation art,
nebula plates, survey overlays, and future spatial image meshes can share the
same anchor solving and renderer adapters without putting cultural assets or
SkyKit viewer code into one package.

## Package Boundary

The package owns:

- generic anchored image manifests and normalization
- relative asset URL resolution
- 3-anchor affine solving and optional mesh subdivision
- direction targets in ICRS and position targets in ICRS parsecs
- Canvas2D triangle warping helpers
- Three.js object/group helpers behind the `./three` subpath

The package does not own:

- skyculture image assets or cultural naming policy
- guide-star catalogs, star products, or octree sessions
- `star-map-canvas` star rendering
- core SkyKit viewer lifecycle, layer fading, or controller behavior
- advanced homography, thin-plate spline, volumetric texture, or depth
  reconstruction algorithms in v1

## Package Shape

```txt
@found-in-space/anchored-image
  root: data model, manifest loading, affine solving, mesh generation

@found-in-space/anchored-image/canvas
  Canvas2D triangle/image warping using a caller-supplied projection

@found-in-space/anchored-image/three
  Three.js mesh/group creation with optional peer dependency on three
```

The root package and Canvas subpath must stay free of Three.js imports. This
keeps the package usable in learning examples, Node-side preprocessing, and
lightweight 2D applications.

## Data Model

An anchored image has an image source plus pixel anchors:

```ts
type AnchoredImageAnchorTarget =
  | { kind: 'direction'; frame: 'icrs'; x: number; y: number; z: number }
  | { kind: 'position'; frame: 'icrs-pc'; x: number; y: number; z: number };
```

Direction targets are suitable for constellation art and full-sky overlays.
Position targets allow future spatial plates, where moving through parsec space
can change the apparent image shape instead of projecting everything onto a
fixed distant sphere.

Legacy Stellarium-style constellation manifests can be normalized, but the
normalized model uses generic `image`, `groupId`, `label`, and `metadata`
fields so the package itself does not encode Western or constellation-specific
assumptions.

## Canvas Composition

`anchored-image/canvas` draws an already-solved mesh through a projection
callback:

```js
drawAnchoredImageMeshCanvas(ctx, mesh, {
  sourceImage,
  projectTarget(target, context) {
    return projectTargetToMapPixel(target, context);
  },
});
```

This is intentionally adjacent to `@found-in-space/star-map-canvas`, not inside
it. A 2D map can render stars from `star-map-canvas` and then render anchored
images as a separate overlay layer using the same observer and projection
context.

## Three.js Composition

`anchored-image/three` can create generic textured meshes or groups from the
same manifest and mesh data. It is deliberately not a SkyKit layer. Core SkyKit
can later wrap it for viewer lifecycle concerns such as attach/detach, fade
state, observer-relative group placement, and demo controls.

This keeps the future SkyKit migration narrow:

```txt
anchored-image/three
  reusable mesh/material construction

skykit ConstellationArtLayer
  viewer lifecycle and teaching convenience
```

## Learning Architecture Fit

`anchored-image` is a support/render-preparation package, not a star product.
It sits beside renderer adapters such as `star-map-canvas` and future
`three-star-field` work. It consumes image manifests and projection callbacks;
it does not emit product-stream deltas or own star representation stores.
