# Found in Space Package Learning Architecture

Status: this is a current alpha-direction document.

This note captures the intended package direction for the alpha architecture:
small reusable `@found-in-space/*` building blocks that let learners and
applications move from raw streamed products to maps, stats, games, and richer
viewers without depending on one large SkyKit monolith.

The proof-of-concept phase is complete. New work should not make core `skykit`
larger by default. Core `skykit` should become a slim composition and teaching
layer over focused packages with explicit boundaries.

The guiding rule is:

```txt
generalize product lifecycle;
specialize product interpretation.
```

The product lifecycle is reusable across stars, H-alpha tiles, meshes, volumes,
galaxy maps, and future datasets. Star facts, astronomy math, picking metadata,
temperature, magnitude, and star-map projections are domain-specific and should
live in star-focused packages.

---

## 1. Learning Ladder

The toolkit should make each step feel like the obvious next move after the
previous one.

```txt
1. Stream stars into a table
2. Keep a coherent current star set
3. Draw a static 2D starmap
4. Add interaction: pan, zoom, hover, pick
5. Calculate stats or draw an HR diagram
6. Feed real stars into a game or simulation framework
7. Compose richer viewers from reusable pieces
```

The target is not literally "50 lines" for every example, but that is a useful
design pressure. A learner should be able to build the next thing without
rewriting stream lifecycle handling, star iteration, apparent magnitude math,
temperature decoding, or coordinate projection.

---

## 2. Package Ladder

Current package ladder and intended direction:

```txt
@found-in-space/product-stream
  implemented generic product delta/store lifecycle

@found-in-space/star-products
  implemented StarObjectBatchProduct types, star representation store, star math,
  star iteration, projections, color helpers

@found-in-space/star-octree-provider
  octree loading/session/streaming, emits star products

@found-in-space/star-volume-query
  reusable sphere/path volume demand helpers on top of star-octree-provider

@found-in-space/star-map-canvas
  2D projected canvas starmap adapter for spatial star products, learning,
  and lightweight apps

@found-in-space/anchored-image
  renderer-neutral anchored image manifests, affine solving, mesh generation,
  and Canvas2D/Three.js image-warp adapters for skyculture art, survey plates,
  nebula overlays, and future spatial image meshes

@found-in-space/hr-diagram
  reusable HR diagram data model, canvas fallback, WebGL renderer, and optional
  touch-os composite-surface controls

@found-in-space/star-kinematics-provider
  proper-motion, radial-velocity, and epoch sidecars for dynamic-universe
  lessons and trajectory/encounter analysis

@found-in-space/solar-ephemeris
  time-aware solar-system and trajectory products at AU scale

@found-in-space/three-star-field
  Three.js star field adapter

@found-in-space/journey
  authored lesson runtime and editor model for chapters, narration, camera
  beats, timed cues, preload hints, and video/story production

@found-in-space/skykit
  slim composition/convenience layer, not the owner of all functionality
```

Support packages that are useful to Found in Space but are not themselves
"universe data" packages should also be split out when they can stand alone. A
good example is `touch-os`, which provides reusable interactive surface
mechanics while `skykit` can depend on it for panels, controls, and teaching
interfaces.

Dependency direction should stay clean:

```txt
product-stream
  <- star-products
      <- star-octree-provider
          <- star-volume-query

star-products
  <- star-map-canvas
  <- hr-diagram
  <- three-star-field

star-products
  <- star-kinematics-provider

product-stream
  <- solar-ephemeris

touch-os
  <- hr-diagram

anchored-image
  <- skyculture / survey / image asset packages
  <- star-map-canvas examples and 2D overlays
  <- skykit viewer-layer wrappers

journey
  imports domain packages only through explicit adapters

skykit
  imports and composes the smaller packages
```

The important consequence: generic lifecycle helpers should not live inside
`@found-in-space/star-octree-provider`, because H-alpha or mesh loaders should
not need to depend on a star octree package to get product stream mechanics.

The same rule applies to interaction and renderer support code. If a module is
not specific to stars, galaxies, solar-system bodies, H-alpha, dust, or another
space-data product, it should usually become its own Found in Space package
rather than being folded into core `skykit`.

`@found-in-space/anchored-image` follows that rule for image warping. It is not
a star product and it does not contain skyculture assets. It provides the
generic representation and renderer-adjacent adapters for images anchored to
ICRS directions or parsec-space positions, while cultural image packages retain
their own assets, names, attribution, and licenses.

---

## 3. Generic Product Stream Contract

The reusable layer understands only product lifecycle. The current public surface
is intentionally small and domain-free:

```ts
export type ProductDelta<Product> =
  | {
      type: 'data/product-upsert';
      product: Product;
      streamId?: string;
      providerId?: string;
      sessionId?: string;
    }
  | {
      type: 'data/product-stale';
      productId: string;
      providerId?: string;
      sessionId?: string;
      reason?: string;
    }
  | {
      type: 'data/product-remove';
      productId: string;
      providerId?: string;
      sessionId?: string;
      reason?: string;
    }
  | {
      type: 'data/representation-current';
      providerId?: string;
      sessionId?: string;
      demandRevision?: number;
      viewRevision?: number;
      productIds?: string[];
      completeness?: unknown;
    }
  | {
      type: 'data/product-error';
      streamId?: string;
      providerId?: string;
      sessionId?: string;
      error: { message: string; code?: string };
    };

export interface RepresentationStoreSnapshot {
  status: 'idle' | 'streaming' | 'current' | 'failed';
  productCount: number;
  bytes: number;
  lastError?: string | null;
  lastCurrentRevision?: {
    viewRevision?: number;
    demandRevision?: number;
  } | null;
}

export interface RepresentationStore<Product> {
  apply(delta: ProductDelta<Product>): void;
  subscribe(listener: () => void): () => void;
  getProducts(): Product[];
  getSnapshot(): RepresentationStoreSnapshot;
  clear(): void;
}
```

This store should not know about `nodeKey`, star count, apparent magnitude,
`pickMeta`, meshes, bricks, tiles, or Three.js. Those belong in product-specific
stores and adapters.

---

## 4. Star Product Layer

`@found-in-space/star-products` is the first specialization.

It understands `StarObjectBatchProduct` and provides:

```ts
export interface StarRepresentationStore {
  apply(delta: ProductDelta<StarObjectBatchProduct>): void;
  subscribe(listener: () => void): () => void;
  getProducts(): StarObjectBatchProduct[];
  getStarCount(): number;
  stars(): Iterable<StarRow>;
  getObjectRef(productId: string, objectIndex: number): CanonicalObjectRef | null;
  getPickMeta(productId: string, objectIndex: number): StarPickMeta | null;
  getSnapshot(): StarRepresentationSnapshot;
  clear(): void;
}
```

It also provides star math and projection helpers:

```ts
apparentMagnitude({ magAbs, distancePc });
decodeTemperatureK(teffLog8);
temperatureToRgb(teffLog8);
icrsToRaDec(positionPc, observerPc);
projectEquirectangular({ raDeg, decDeg, width, height });
```

This is the layer that makes table, starmap, stats, and game examples small.
The octree provider remains responsible for loading and streaming data; the star
product layer is responsible for interpreting emitted star products.

---

## 5. Teaching Shape

A starmap lesson should be able to look roughly like this:

```js
import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';
import {
  createStarRepresentationStore,
  consumeProductDeltas,
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
  map.render({ observerPc, limitingMagnitude });
});

session.updateView({ observerPc, limitingMagnitude });
```

The learner sees three concepts clearly:

```txt
SkyKit query/session
  -> coherent star store
  -> application rendering or analysis
```

The same star store can support:

```txt
table rows
2D canvas starmaps
nearest-star queries
HR diagrams
game entities
Three.js geometry adapters
debug panels
```

---

## 6. Domain Tools And Journey Lessons

Reusable scientific tools and authored lesson frameworks are different package
types and should not be collapsed into one "lesson" package.

An HR diagram is a reusable scientific instrument:

```txt
@found-in-space/hr-diagram
  -> HR diagram data model
  -> Canvas2D fallback renderer
  -> Three/WebGL high-volume renderer
  -> selection/brush helpers
  -> optional touch-os composite embedded-surface controls
```

It may depend on `@found-in-space/star-products` for star iteration,
temperature, magnitude, and store integration. It may depend on `touch-os` for
interactive panel controls. It should not know about Orion-specific lessons,
camera fly-throughs, narrated chapters, or website page structure.

Volume and path selection are reusable star-query concerns, not HR-diagram
concerns. `@found-in-space/star-volume-query` provides sphere and path custom
strategies for `@found-in-space/star-octree-provider`, plus travel-radius
preload request helpers for moving lessons. HR diagrams can consume those
products, but other tools can reuse the same volume/path query package.

A journey framework is allowed to be chunkier because authored experiences have
real machinery:

```txt
@found-in-space/journey
  -> chapter and scene model
  -> narration state
  -> camera actions and timed cues
  -> preload hints and readiness checks
  -> playback controls
  -> editor/runtime shared model
  -> validation and evaluation helpers
```

The website's current journey and video/editor code is a good candidate source
of lessons for this boundary. The alpha package should still be a clean rewrite:
extract the concepts, not the accidental website shape.

A lesson helper such as `createHrDiagramLesson()` should be thin glue:

```txt
createHrDiagramLesson()
  wires:
    star-octree-provider
    star-products store
    hr-diagram tool/panel
    journey runtime
    page-specific copy and presets
```

The website should own content, layout, story data, and small composition calls.
It should not own reusable HR rendering, product-store mechanics, octree
streaming, or generic journey runtime behavior.

---

## 7. Dynamic Stars And Trajectory Lessons

Proper motion should be an attachable sidecar/product lane rather than a
responsibility of the octree provider. The octree provider finds candidate stars
in space; a kinematics sidecar enriches the small relevant subset with motion
vectors, radial velocity, epoch metadata, and uncertainty where available.

This supports lessons such as:

```txt
trajectory or comet path
  -> query nearby static star candidates from the octree
  -> join proper-motion sidecar data for those candidates
  -> propagate only that small subset through time
  -> compute closest approach or render past/future paths
```

This is intentionally not "animate the whole galaxy". We only have proper
motion vectors for a limited subset of stars, and most teaching workflows need a
small candidate set around a path, encounter, or local volume. The architecture
should therefore preserve stable join keys such as `CanonicalObjectRef`,
`pickMeta`, catalog/source ids, dataset identity, and catalog epoch.

The static octree index remains useful for candidate search. Time-dependent
motion is a derived/enrichment layer above it.

---

## 8. Relationship To H-alpha And Other Domains

The generic store pattern should be reusable, but star interpretation should not
be.

For H-alpha:

```txt
HaProviderSession
  -> MeshProduct / FieldTileProduct / VolumeTileProduct
  -> generic RepresentationStore<Product>
  -> HaRepresentationStore
  -> canvas / Three / volume adapter
```

Shared ideas:

```txt
data/product-upsert
data/product-stale
data/product-remove
data/representation-current
data/product-error
snapshot
current product set
memory accounting
completeness
```

Not shared:

```txt
StarObjectBatchProduct
nodeKey-to-star membership assumptions
objectRef / pickMeta helpers
teffLog8 / magAbs
star count
limiting magnitude
observer-shell visibility
```

This keeps each package honest: common lifecycle mechanics are shared, while
domain meaning remains close to the product type that owns it.

---

## 9. Structural Products And Multi-scale Layers

H-alpha is more than a nice visual layer. It is a useful teaching and
architecture example for adding new product lanes that describe structure rather
than individual stars.

That pattern should generalize to future features such as:

```txt
H-alpha clouds and nebular volumes
full Milky Way / galaxy-scale models
extra-solar planetary systems
our own solar system
large-scale dust or density fields
radio bubbles and survey-derived structures
comet or spacecraft trajectories
```

Each of these should be able to follow the same broad path:

```txt
domain provider
  -> domain product stream
  -> generic lifecycle store
  -> domain representation store
  -> rendering or analysis adapter
```

The full galaxy model is the clearest stress test. It needs a very different
coordinate scale from local star data: kiloparsec-scale galactic structure
alongside parsec-scale stellar positions, and possibly extra-galactic context
later. That implies deliberate coordinate switching rather than one universal
render scale.

The final composite should be layered:

```txt
galaxy / kpc-scale layer
  updates when navigation happens at galaxy scale

local star / pc-scale layer
  updates from star-octree provider sessions

solar-system / au-scale layer
  can use a static distant starfield from the Sun because stellar parallax is
  negligible at solar-system scale

planetary-system layers
  render local orbital systems with their own scale and update cadence

trajectory layers
  render sampled paths and encounter windows, often using star or solar-system
  products as inputs rather than owning those datasets directly
```

This layered approach keeps each renderer honest about its scale. A galaxy
renderer should not need to update every time the user makes small parsec-scale
or solar-system-scale moves. A solar-system renderer should not require live
star-octree parallax when a static starfield as seen from the Sun is physically
good enough for the experience.

The architectural lesson: multi-scale space visualization is not one coordinate
system stretched until it hurts. It is a composite of domain products, each with
its own coordinate frame, precision needs, update cadence, and rendering
adapter, combined by a higher-level scene/composition layer.

---

## 10. Current Visual Package Status

The product lifecycle, star product, octree streaming, and first 2D visual
adapter foundations now exist:

```txt
star-octree-provider -> star-products store -> star-map-canvas

anchored-image -> Canvas2D / Three.js image overlays through explicit adapters
```

`@found-in-space/star-map-canvas` consumes `StarRepresentationStore` rows, not
octree provider internals. It should not absorb guide-star catalog products,
Three.js rendering, or galaxy-map backgrounds. Those remain separate source or
renderer lanes.

`@found-in-space/anchored-image` sits beside it as a renderer-neutral support
package for skyculture art, survey plates, and future anchored spatial image
meshes. It should not absorb star rendering, product streams, or SkyKit viewer
lifecycle.

The next learning package should be chosen by the teaching path it unlocks: HR
diagrams and touch panels, a Three.js star-field adapter, journey/runtime
composition, kinematics sidecars, or solar/trajectory products.
