# Participating Media Products And Optical-Path Composition

Status: architecture guidance for current and future SkyKit dust, gas, and
volume-rendering work.

This note describes how SkyKit should compose datasets that change the optical
path through space. The motivating examples are:

- Rezaei et al. 2024 dust, which dims and reddens background light.
- McCallum et al. 2025 H-alpha gas, which adds line emission.

These datasets may be loaded, configured, and toggled as separate products, but
they should not be rendered as separate transparent overlays when the goal is a
physically meaningful visual result. They are participating media. The renderer
must combine them in depth order along each camera ray.

## Terms

Participating media are volumes that affect light as it travels:

- Extinction media remove light through absorption or scattering out of the ray.
  Dust is the current example.
- Emission media add light along the ray. H-alpha gas is the current example.
- Scattering media may be added later, but are out of scope for the first
  optical-path compositor.

"Opaque" in this context should not mean a solid mesh that writes depth. Dust
and gas are better described as optically active volumes. A dust column can make
background objects effectively invisible, but the correct model is still
integration through a volume, not an opaque surface.

## Rule

Products can be independent. Optical-path rendering should be shared.

```txt
dust loader/product        -> publishes extinction medium
H-alpha loader/product     -> publishes emission medium
star renderer              -> samples extinction to each star
optical-path compositor    -> samples all media in one ordered ray integration
debug visualizations       -> optional, non-authoritative overlays
```

The product registry is for discovery and ownership. It is not render order.
Three.js transparent sorting cannot produce correct results for mixed dust and
emission volumes because the correct equation depends on where each sample lies
along the ray.

## Product Shape

A participating medium product should publish a sampling handle and enough
metadata for a compositor to place and combine it. Product keys are conventions,
not reserved global names, but these prefixes are recommended:

```txt
media:extinction/rezaei2024
media:emission/halpha/mccallum2025
render:optical-path/local-ism
```

Recommended product metadata:

```js
{
  kind: 'participating-medium',
  role: 'extinction', // or 'emission'
  ownerId: 'dust-layer',
  pathId: 'local-ism',
  tags: ['optical-path', 'optical-path:local-ism'],
}
```

An extinction medium value should provide, directly or through a small adapter:

```js
{
  role: 'extinction',
  frame: 'galactic_cartesian_sun_centered',
  boundsPc,
  texture,
  worldToVolumeMatrix,
  units: 'density_cm3',
  sampleEncoding: 'uint8_normalized',
  extinctionLaw: {
    name: 'Milky Way Rv 3.1',
    channels: 'rgb',
  },
}
```

An emission medium value should provide:

```js
{
  role: 'emission',
  frame: 'galactic_cartesian_sun_centered',
  boundsPc,
  textureOrService,
  worldToVolumeMatrix,
  units: 'encoded_emissivity',
  line: 'H-alpha',
  sampleEncoding: 'asinh_uint8',
}
```

The exact value shape can evolve with package APIs. The important contract is
semantic: each product describes what it contributes to the optical path and how
to sample it in a known coordinate frame.

## Compositor Responsibility

An optical-path compositor consumes a group of participating-medium products,
usually by querying product metadata such as:

```js
products.query({ kind: 'participating-medium', tag: 'optical-path:local-ism' });
```

For each rendered pixel or volume surface fragment, the compositor casts one ray
through the active medium bounds and integrates front to back:

```txt
transmittance = vec3(1)
radiance = vec3(0)

for sample from camera outward:
  extinction = sum(extinction media at sample)
  emission = sum(emission media at sample)

  radiance += transmittance * emission * stepLength
  transmittance *= exp(-extinction * stepLength)

final = radiance + transmittance * background
```

This is the critical behavior: H-alpha emission behind dust is attenuated by the
dust between the gas and the camera, and background light is attenuated by the
total dust column. Rendering gas and dust as independent transparent meshes loses
that ordering.

The compositor should also own:

- common ray bounds and step count policy
- unit conversion into extinction and emission coefficients
- color mapping and exposure for display
- LOD selection policy for tiled media
- debug readouts for active products, bounds, and sampling quality

Debug views may render one medium alone, but those views should be labelled as
diagnostic or educational overlays, not the authoritative optical-path result.

## Stars And Point Sources

Stars are not just background pixels. They are point sources at known distances.
The star renderer should attenuate each star by integrating extinction from the
observer to that star:

```txt
starColor = intrinsicStarColor * exp(-dustColumnToStar)
starFlux = geometricFlux * luminance(exp(-dustColumnToStar))
```

The current `dust-roam` demo already follows this general direction by sampling
dust in the star material and in pick readouts. A screen-space volume overlay
alone cannot reliably dim and redden stars unless the compositor also owns the
star pass or receives enough depth and source information to integrate only up to
each star.

Diffuse gas emission is different. It is accumulated along the camera ray and is
attenuated by foreground dust on the way to the camera.

## Large Volumes And Variable Resolution

Large media should be represented as logical volumes with bricked or tiled
storage, not as independent octree meshes. Recommended storage and runtime
rules:

- Keep each medium in a documented spatial frame and unit system.
- Prefer fixed world-space tile identities for runtime replacement.
- Include halo voxels around every tile so trilinear filtering and gradients do
  not create tile-edge seams.
- Load coarse tiles first, then replace slots with higher-resolution tiles.
- Keep LOD transitions inside the sampler/compositor, not in independent
  transparent mesh boundaries.
- Allow different media to have different native grids; the compositor samples
  each through its own transform.

If mesh extraction is needed for an isosurface or diagnostic surface, it should
remain separate from the optical-path compositor. Crack-free mesh LOD requires
balanced trees, shared boundaries, or transition-cell algorithms such as
Transvoxel. That is a different rendering problem from participating-media
composition.

## Current SkyKit State

The current workspace has transitional pieces:

- `src/dust/load-dust-map-ng.js` loads the Rezaei `dust_map_ng.bin` artifact.
- `src/demo/dust-roam.js` applies dust extinction to stars and can display a
  dust-map visualization.
- `src/dust/load-ha-tiled-volume.js` loads the McCallum tiled H-alpha artifact.
- `src/layers/h-alpha-tiled-volume-layer.js` raymarches H-alpha as an additive
  volume.

The desired direction is to keep the independent loader/product boundaries, then
add a participating-media compositor that consumes both dust and gas products.
The existing H-alpha and dust visual layers can remain useful debug or teaching
views, but they should not be the final combined optical-path renderer.

## Package Boundary

`pipeline-dust` should document artifact formats, units, coordinate frames, and
build commands. SkyKit should document composition semantics and runtime product
contracts.

Core `@found-in-space/skykit` should remain the product/layer composition
surface. Concrete loaders, shader implementations, and high-throughput media
services may belong in focused packages once the design hardens. They should not
be folded into the star octree provider, and they should not require hidden
string registries.
