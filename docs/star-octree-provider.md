# Star Octree Provider Package

Status: current alpha package documentation for
`@found-in-space/star-octree-provider`.

This document describes the package boundary, public API, runtime semantics, and
current implementation status for the alpha star octree provider. New work
should keep this document focused on this one package; broader teaching, lesson,
renderer, sidecar, and application composition concerns belong in
[`package-learning-architecture.md`](./package-learning-architecture.md).

This package is a clean alpha implementation in
`packages/star-octree-provider`. Keep it self-contained and package-shaped:
octree loading belongs here, while renderers, sidecars, controls, lessons, and
application merging belong elsewhere.

---

## 1. Purpose

`@found-in-space/star-octree-provider` loads, navigates, and streams star data
from a `.octree` dataset.

It owns:

```txt
source bytes
  -> octree bootstrap and shard parsing
  -> runtime node traversal
  -> strategy demand planning
  -> payload range fetch/decompression/cache
  -> star payload decode
  -> StarObjectBatchProduct deltas
```

It does not own:

```txt
Three.js objects
viewer runtimes
touch controls or panels
star maps
HR diagrams
sidecar labels or facts
proper motion / kinematics
solar-system ephemerides
journey or lesson runtime
application-level product merging
```

Those belong in separate packages that consume the provider's products.

---

## 2. Package Boundary

The provider exposes two source factories:

```js
import {
  createStarOctreeProviderService,
  createStarOctreeFileProviderService,
} from '@found-in-space/star-octree-provider';
```

Use `createStarOctreeProviderService()` for HTTP/URL range access:

```js
const provider = createStarOctreeProviderService({
  id: 'gaia-stars',
  url: 'https://example.test/stars.octree',
  persistentCache: 'on',
});
```

Use `createStarOctreeFileProviderService()` for a `Blob` or `File` source:

```js
const provider = createStarOctreeFileProviderService({
  id: 'local-stars',
  file,
});
```

Both factories return the same provider/session API. The source adapter differs;
the product and session semantics do not.

The same package also exports the provider-owned strategy helpers:

```js
import {
  buildTravelVolumeRequests,
  combineStarOctreeStrategies,
  createObserverShellStrategy,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createTargetFrustumStrategy,
  streamVolumeProducts,
  warmVolumeRequests,
  withMotionLookahead,
} from '@found-in-space/star-octree-provider';
```

These helpers create strategy objects or bounded volume streams. They do not
fetch, decode, render, or merge products by themselves; provider sessions and
streams still own execution.

---

## 3. Public Service API

The provider service owns shared source, cache, descriptor, snapshot, and stream
state.

```ts
interface StarOctreeProviderService {
  readonly id: string;

  describe(): StarOctreeProviderDescriptor;
  getSnapshot(): StarOctreeProviderSnapshot;
  ensureBootstrap(): Promise<StarOctreeBootstrapProduct>;

  createSession(options?: StarOctreeSessionOptions): StarOctreeProviderSession;

  streamPayloads(
    options: StarOctreePayloadStreamOptions
  ): AsyncIterable<StarOctreePayloadDelta>;

  streamObjectBatches(
    options: StarOctreeObjectBatchStreamOptions
  ): AsyncIterable<StarOctreeProductDelta>;

  fetchObjectBatch(
    options: StarOctreeObjectBatchStreamOptions
  ): Promise<StarObjectBatchProduct>;

  dispose(): void | Promise<void>;
}
```

### Service Methods

`describe()` returns stable provider capabilities and dataset identity. Before
bootstrap the dataset identity may be configured or unknown; after
`ensureBootstrap()` it reflects parsed bootstrap/ODSC identity when available.

`getSnapshot()` reports current dataset, cache, memory, session, work-item, and
range/payload statistics. Snapshots are diagnostics; they are not the product
stream contract.

`ensureBootstrap()` parses and caches the STAR/ODSC header. It returns a
`StarOctreeBootstrapProduct`, not a renderable object batch.

`createSession()` creates an independent live session for a consumer. Multiple
sessions may share provider caches but keep their own view, strategy, working
set, and delta stream.

`streamPayloads()` is a low-level bounded stream of decompressed payload batches.
It is useful for diagnostics, custom consumers, and alternate product builders.
Most applications should use object batches instead.

`streamObjectBatches()` is a bounded object-product stream. It runs a strategy
for a view, fetches/decompresses/decodes payloads, emits non-cumulative
`StarObjectBatchProduct` upserts, and ends with `data/representation-current`.

`fetchObjectBatch()` consumes the object stream and returns one merged product
for bounded one-shot callers. Live viewers should prefer sessions or
`streamObjectBatches()`.

`dispose()` closes sessions and releases provider-owned resources.

---

## 4. Live Sessions

A session is the live streaming contract. It owns one consumer's strategy, view
state, demand revisions, product membership, and delta stream.

```ts
interface StarOctreeProviderSession {
  readonly id: string;

  updateView(
    patch: StarOctreeViewPatch,
    options?: ViewUpdateOptions
  ): StarOctreeViewReceipt;

  subscribe(listener: (delta: StarOctreeProductDelta) => void): () => void;
  deltas(): AsyncIterable<StarOctreeProductDelta>;
  getSnapshot(): StarOctreeSessionSnapshot;
  dispose(): void | Promise<void>;
}
```

`updateView()` is synchronous. It accepts the latest view state, increments
`viewRevision`, and may queue planning work depending on demand options and
strategy-aware gating.

```js
const receipt = session.updateView({
  observerPc: { x: 0, y: 0, z: 0 },
  limitingMagnitude: 6.5,
});
```

The receipt reports:

```ts
demand: 'queued' | 'forced' | 'suppressed' | 'unchanged'
```

`deltas()` stays open across many `updateView()` calls. It closes only when the
session is disposed or fails terminally.

`subscribe()` observes the same deltas as `deltas()` and returns an unsubscribe
function.

`data/representation-current` means current-role work for the latest accepted
demand revision is caught up. It does not mean the session is finished, and it
does not wait for lower-priority prefetch/cache-warming work.

---

## 5. View State

Provider-native strategy coordinates are parsecs.

```ts
interface StarOctreeViewPatch {
  observerPc?: { x: number; y: number; z: number };
  limitingMagnitude?: number;
  mDesired?: number;

  targetPc?: { x: number; y: number; z: number };
  directionIcrs?: { x: number; y: number; z: number };
  orientationIcrs?: { x: number; y: number; z: number; w: number };
  verticalFovDeg?: number;
  aspectRatio?: number;
  nearPc?: number;
  farPc?: number;
  preloadDistancePc?: number;

  motion?: {
    velocityPcPerSec?: { x: number; y: number; z: number };
    speedPcPerSec?: number;
    lookaheadSecs?: number;
  };

  params?: Record<string, unknown>;
}
```

`mDesired` is accepted as an alias for `limitingMagnitude`.

`motion` is a hint for prioritisation and future-position cache warming. It does
not truncate observer-shell visibility and does not make the representation
degraded.

---

## 6. Strategies

Strategies decide which runtime nodes are currently demanded. They own
visibility/relevance math. The scheduler, cache, decoder, and product builder
consume strategy output generically.

This is the canonical document for star-octree strategy semantics. Other
documents may show examples, but should not redefine what a strategy, planner,
or scheduler means.

The core responsibility split is:

```txt
Strategy = semantic demand
Planner = execution economics
Scheduler = async work and revision orchestration
```

A strategy answers:

```txt
which runtime nodes matter?
are they current or prefetch?
what is their semantic priority?
why were they selected?
```

A strategy must not fetch byte ranges, decode payloads, build products, merge
products, render, or own application logic.

```ts
type StarOctreeFetchStrategy =
  | { kind: 'observer-shell' }
  | {
      kind: 'target-frustum';
      verticalFovDeg?: number;
      overscanDeg?: number;
      targetRadiusPc?: number;
      nearPc?: number;
      farPc?: number;
    }
  | { kind: 'sphere-volume'; centerPc: PointPc; radiusPc: number }
  | { kind: 'path-volume'; pointsPc: PointPc[]; radiusPc: number }
  | { kind: 'motion-lookahead'; strategy: StarOctreeFetchStrategy }
  | {
      kind: 'composite';
      mode: 'union';
      strategies: StarOctreeFetchStrategy[];
    }
  | {
      kind: 'custom';
      selectDemand: (context: StarOctreeSelectionContext) =>
        Promise<StarOctreeDemandPlan> | StarOctreeDemandPlan;
      shouldReplan?: (
        context: StarOctreeDemandGateContext
      ) => StarOctreeDemandGateResult;
    };
```

### Strategy, Planner, And Scheduler Responsibilities

Strategies produce `StarOctreeDemandPlan` values. Demand entries are semantic
inputs to later provider components:

```ts
interface StarOctreeDemandEntry {
  node: StarOctreeRuntimeNode;
  role?: 'current' | 'prefetch';
  priority?: number;
  reasons?: string[];
  metadata?: Record<string, unknown>;
}
```

Strategy priority is not a strict download order. It is an ordered hint to the
planner.

The planner may reorder, coalesce, or include lower-priority payloads when that
is cheaper or faster, for example when adjacent payload byte ranges naturally
batch together. That does not change the strategy's semantic result.

The planner owns execution economics:

- payload range batching and over-read gap decisions
- cache hit preference
- decoded-cache reuse
- inflight limits
- source-specific request economics
- memory/budget constraints when explicit budget options exist

The scheduler owns live work orchestration:

- latest-view and demand-revision checks
- current-role work before prefetch work
- stale work suppression
- async failure accounting
- when `data/representation-current` may be emitted

The provider must preserve role semantics even when the planner reorders work:
`current` entries may emit products; `prefetch` entries warm caches only.

### Strategy Composition

All built-in and external strategies should share the same demand-plan surface.
The intended composition model is node-key based:

```txt
strategy A + strategy B + ...
  -> merged StarOctreeDemandPlan
```

Default union composition rules should be:

- merge entries by `node.nodeKey`
- `current` wins over `prefetch`
- within the same role, higher semantic priority wins
- reasons and metadata should preserve all contributing strategies
- the visible/current demand signature should ignore prefetch-only entries
- prefetch-only entries must not stale or remove current products

First-class helpers follow this shape:

```ts
const strategy = combineStarOctreeStrategies([
  createObserverShellStrategy(),
  createSphereVolumeStrategy({ centerPc, radiusPc }),
], {
  mode: 'union',
});
```

`intersection` and `difference` composition may be useful later, but union is
the default alpha model because it preserves the broadest useful demand without
surprising product removals.

External strategies may participate either as standalone `custom` strategies or
as inputs to the combinator. Applications should not need root shard
products or runtime-node construction to compose strategies.

### Observer Shell

`observer-shell` is semantic visibility demand:

```txt
observer position + limiting magnitude + dataset index magnitude
  -> potentially visible node demand
```

It uses the magnitude-shell predicate:

```txt
distanceToNodeAabbPc <= node.halfSize * 10 ** ((limitingMagnitude - header.magLimit) / 5)
```

`header.maxLevel` and `node.level` are source/runtime metadata. They are not
public quality knobs.

Motion may affect ordering, but it must not exclude nodes that are relevant for
the accepted current view. Future-position prefetch is explicit through the
`motion-lookahead` strategy decorator.

### Target Frustum

`target-frustum` applies magnitude-shell pruning and then frustum/AABB pruning.

Exact mode uses `orientationIcrs`, `verticalFovDeg`, and `aspectRatio`.
Target-derived mode may use `targetPc` or `directionIcrs` when orientation is
not supplied. Quaternion and frustum math are plain data; this package does not
import Three.js.

Defaults for target-derived mode are intentionally practical for teaching:

```txt
verticalFovDeg: 40
overscanDeg: 8
targetRadiusPc: 96
aspectRatio: 1
nearPc: 0
```

Omitted `farPc` is derived from target distance, target radius, and preload
distance where applicable.

### Custom

Custom strategies receive a `StarOctreeSelectionContext`, including a provider
owned traversal helper:

```ts
context.traversal.select({
  distanceToNode(node) {
    return /* custom priority distance */;
  },
  visit(node, helpers) {
    return {
      include: true,
      descend: true,
      priority: 0,
      role: 'current',
      reasons: ['custom'],
    };
  },
});
```

Applications should not construct runtime nodes or ask for a public root shard.
The provider owns shard loading, traversal mechanics, cache state, and parsec
geometry.

Custom strategies may provide `shouldReplan()` to participate in
strategy-aware demand-threshold gating. Without it, custom strategies replan on
every non-suppressed update.

### Volume And Path Strategies

Sphere and path/corridor selection are star-octree loading strategies too. They
ask a different semantic question than visibility strategies:

```txt
sphere/path volume:
  stars physically inside this region

observer-shell / target-frustum:
  stars potentially visible from this view
```

Both kinds still produce the same `StarOctreeDemandPlan` entries and are planned,
scheduled, fetched, decoded, and streamed by the same provider pipeline.

The alpha implementation exposes these as first-class provider strategies:

```js
createSphereVolumeStrategy({ centerPc, radiusPc });
createPathVolumeStrategy({ pointsPc, radiusPc });
buildTravelVolumeRequests({ routePointsPc, radiusProfile });
```

---

## 7. Demand Gating

Demand gating is opt-in and strategy-aware. It decides whether a new accepted
view should queue full planning work. It does not change what the strategy means
and it does not cancel active work.

```ts
interface StarOctreeDemandThresholds {
  observerMoveThresholdPc?: number;
  limitingMagnitudeDelta?: number;
  directionAngleDeg?: number;
}

interface StarOctreeSessionOptions {
  demandThresholds?: StarOctreeDemandThresholds;
}
```

Without `demandThresholds`, built-in live-session strategies preserve the
default behavior: each non-suppressed update queues planning.

Volume strategies carry their semantic demand in the strategy object rather
than in viewer pose, so ordinary observer-view updates do not replan a fixed
sphere/path strategy after the initial demand unless the caller forces demand.

With thresholds, tiny changes can return `demand: 'unchanged'`. The latest view
snapshot still updates, but `demandRevision` does not increment and no new
product deltas are emitted for that under-threshold update.

`demand: 'force'` bypasses gating. `demand: 'suppress'` accepts the view without
planning.

---

## 8. Motion Lookahead

Motion lookahead is lower-priority cache warming, not a degraded visibility
model. Architecturally it is best understood as a strategy decorator: evaluate a
base strategy against a future hinted view and emit future-only entries as
`prefetch`.

When `velocityPcPerSec` and positive `lookaheadSecs` are provided, the
`motion-lookahead` decorator computes a future observer position:

```txt
futureObserverPc = observerPc + velocityPcPerSec * lookaheadSecs
```

Future-only demanded nodes are appended as `role: 'prefetch'`.

The intended reusable shape is:

```ts
const strategy = withMotionLookahead(createObserverShellStrategy());
```

or equivalently as part of explicit composition:

```ts
const strategy = combineStarOctreeStrategies([
  createObserverShellStrategy(),
  withMotionLookahead(createObserverShellStrategy()),
]);
```

Prefetch entries:

- warm payload/decoded caches
- do not emit `data/product-upsert`
- do not make current demand stale
- do not block `data/representation-current`
- may finish into cache after a newer view supersedes them
- record active/finished/failed work in snapshots

Current-role work always wins over prefetch.

---

## 9. Streaming Options

Session and bounded stream options share the same core shape:

```ts
interface StarOctreeSessionOptions {
  strategy?: StarOctreeFetchStrategy;
  attributes?: string[];
  coordinates?: StarOctreeCoordinateOutput;
  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
  };
  memory?: {
    ownership?: 'borrowed' | 'copy' | 'transfer';
  };
}
```

Bounded object streams additionally accept:

```ts
streaming?: {
  batchMode?: 'payload-range' | 'node';
  retainOrder?: boolean;
}
```

`payload-range` is the throughput-oriented default for bounded streams.
Node-mode is useful when consumers need node-key product reconciliation.

`coarseFirst` defaults to level-first ordering for built-in strategies. Set it
to `false` to use pure priority/distance ordering.

`emitCachedFirst` controls whether cached decoded payloads are emitted before
new fetch work where practical.

`retainOrder` is reserved until it can be implemented without undermining
payload-range batching.

---

## 10. Coordinates

Strategy input is provider-native parsecs.

Product output defaults to parsecs:

```txt
frame: icrs
units: ['pc', 'pc', 'pc']
```

Consumers may provide `coordinates.transformPosition()` to pack another output
coordinate profile during product building:

```js
coordinates: {
  name: 'render-position',
  units: ['world', 'world', 'world'],
  transformPosition({ xPc, yPc, zPc }) {
    return [xPc * 0.001, yPc * 0.001, zPc * 0.001];
  },
}
```

Transforms may scale, rotate, translate, or otherwise convert positions. They
are output transforms only; they must not be used implicitly as strategy input
transforms.

---

## 11. Product Contract

The primary consumer-visible product is `StarObjectBatchProduct`, owned by
`@found-in-space/star-products`.

```ts
interface StarObjectBatchProduct {
  productType: 'object-batch';
  id: string;
  providerId: string;
  layerId: 'stars';
  objectType: 'star';
  count: number;
  nodes: StarObjectBatchNodeSummary[];
  coordinates: {
    primary: {
      representation: 'cartesian3';
      components: Float32Array;
    };
  };
  attributes: {
    teffLog8?: { values: Uint8Array };
    magAbs?: { values: Float32Array };
  };
  refs?: CanonicalObjectRef[];
  pickMeta?: StarPickMeta[];
  completeness: StarProductCompleteness;
  memory: {
    ownership: 'borrowed' | 'copy' | 'transfer';
    bytes: number;
  };
}
```

Products are non-cumulative batches. The consuming application decides how to
merge, render, index, or discard them.

Requested attributes are emitted when available:

```txt
position
teffLog8
magAbs
objectRef
pickMeta
```

`objectRef` and `pickMeta` are join data for separate sidecar/metadata packages.
They are not label lookups and they are not renderer state.

`teffLog8` is the encoded temperature attribute from the star payload. Decoding
to Kelvin belongs in `@found-in-space/star-products`, not in the octree
provider.

---

## 12. Delta Contract

Object streams emit:

```txt
data/product-upsert
data/product-stale
data/product-remove
data/representation-current
data/product-error
```

Payload streams emit:

```txt
payload/batch
payload/progress
payload/complete
payload/error
```

Live sessions retain still-demanded products, stale/remove products excluded by
new demand, and emit replacement products when grouped products are partially
retained.

The provider emits deltas. Application/store packages own coherent merge
semantics, nearest-N tables, maps, render geometry, and stats.

---

## 13. Runtime Nodes

Runtime nodes are provider facts derived from parsed octree shards:

```ts
interface StarOctreeRuntimeNode {
  nodeKey: string;
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
  level: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  payloadOffset: number;
  payloadLength: number;
  childMask: number;
  shardOffset: number;
  nodeIndex: number;
}
```

They are used by strategies, traversal, diagnostics, product metadata, and
sidecar joins. Applications do not provide external runtime nodes to normal
provider sessions.

There is no public `ensureRootShard()` API. Root shard loading is internal index
state needed for traversal.

---

## 14. Internal Components

The implementation should preserve these responsibility boundaries:

```txt
Source adapter
  URL range source or blob/file source.

Octree index reader
  STAR/ODSC header parsing, shard parsing, runtime node construction.

Traversal engine
  Root entries, same-shard children, frontier shard loading, deterministic walk.

Strategies
  Observer-shell, target-frustum, volume/path, custom, and composed semantic
  demand and metadata.

Planner
  Execution economics for selected demand: batching, cache preference,
  source/request tradeoffs, and budget-aware ordering.

Demand gate
  Strategy-aware "should this view replan?" policy.

Session reconciler
  Latest-view semantics, product membership, stale/remove/replacement deltas.

Work scheduler
  Current-first product work, prefetch warming, stale work suppression.

Payload fetcher / cache
  Range batching, decompression, payload cache, decoded payload cache.

Payload decoder
  16-byte star records into parsec positions, magAbs, teffLog8, refs, pickMeta.

Product builder
  Uses @found-in-space/star-products to pack non-cumulative
  StarObjectBatchProduct batches and output coordinate transforms.

Diagnostics / snapshots
  Dataset, session, cache, memory, work, and source statistics.
```

These components may be internal modules. They should not leak as public
consumer API unless a concrete package use case proves the boundary.

---

## 15. Current Implementation Status

Implemented:

- URL range provider.
- Blob/file provider.
- STAR header parsing.
- Optional ODSC descriptor parsing.
- Root/internal shard loading.
- Runtime node construction.
- Root, child, and frontier traversal.
- `observer-shell` demand.
- exact and target/direction-derived `target-frustum` demand.
- Custom strategy traversal helper.
- Strategy-aware demand gating.
- First-class strategy factories and union composition.
- Sphere/path volume strategies and travel-volume helpers.
- Motion priority metadata and explicit future-position prefetch warming.
- Payload range batching.
- Gzip decompression through browser/platform APIs.
- In-memory payload and decoded payload cache.
- Browser Cache API persistent decoded cache when requested and available.
- 16-byte star payload decode.
- Object batch product building through `@found-in-space/star-products`.
- Generic product lifecycle and star product helpers split into
  `@found-in-space/product-stream` and `@found-in-space/star-products`.
- Live session deltas.
- Bounded payload/object streams.
- One-shot merged object batch fetch.
- Product membership reconciliation.
- Transfer ownership for product buffers where supported.
- Provider/session snapshots and work tracking.

Known later work:

- Fully interleaved traversal/fetch/decode reprioritization.
- Explicit budget/debug caps with truncation metadata and degraded completeness.
- Dedicated worker/WASM decode execution.
- Extinction/dust visibility through a separate strategy/provider boundary.
- Sidecar octree byte loading in the sidecar provider package.

---

## 16. Examples

### Live Session

```js
const provider = createStarOctreeProviderService({ url });

const session = provider.createSession({
  strategy: withMotionLookahead(createObserverShellStrategy()),
  attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  streaming: {
    progressive: true,
    coarseFirst: true,
  },
});

const stop = session.subscribe((delta) => {
  if (delta.type === 'data/product-upsert') {
    store.apply(delta);
  }

  if (delta.type === 'data/product-stale') {
    store.apply(delta);
  }

  if (delta.type === 'data/product-remove') {
    store.apply(delta);
  }

  if (delta.type === 'data/representation-current') {
    renderCurrentStore();
  }
});

session.updateView({
  observerPc: { x: 0, y: 0, z: 0 },
  limitingMagnitude: 6.5,
  motion: {
    velocityPcPerSec: { x: 0.5, y: 0, z: 0 },
    lookaheadSecs: 3,
  },
});
```

### Bounded Object Stream

```js
const products = [];

for await (const delta of provider.streamObjectBatches({
  strategy: createObserverShellStrategy(),
  view: {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  },
  attributes: ['position', 'magAbs', 'teffLog8'],
})) {
  if (delta.type === 'data/product-upsert') {
    products.push(delta.product);
  }

  if (delta.type === 'data/representation-current') {
    break;
  }
}
```

### One-Shot Batch

```js
const product = await provider.fetchObjectBatch({
  strategy: createTargetFrustumStrategy(),
  view: {
    observerPc,
    targetPc,
    limitingMagnitude: 8,
    verticalFovDeg: 40,
    aspectRatio: 16 / 9,
  },
});
```

### Volume Stream

```js
for await (const delta of streamVolumeProducts(provider, {
  type: 'sphere',
  centerPc: { x: 0, y: 0, z: 0 },
  radiusPc: 25,
}, {
  attributes: ['position', 'magAbs', 'teffLog8'],
})) {
  if (delta.type === 'data/product-upsert') {
    consumeVolumeProduct(delta.product);
  }
}
```

---

## 17. Verification

Package-local verification:

```bash
npm run typecheck --workspace @found-in-space/star-octree-provider
npm run test --workspace @found-in-space/star-octree-provider
```

Workspace verification:

```bash
npm run typecheck
npm test
```

The public-octree integration test is opt-in:

```bash
STAR_OCTREE_PROVIDER_INTEGRATION=1 npm run test --workspace @found-in-space/star-octree-provider
```

---

## 18. Design Decisions

Use provider service plus provider sessions:

```txt
provider service = shared source/cache/memory/descriptor
provider session = one live demand state and product stream
```

Navigation state goes to sessions through `updateView()`, not to the provider
service.

Strategies produce demand; applications do not supply runtime nodes for normal
loading.

Products are data products, not renderer objects.

Sidecars are separate providers.

Core `skykit` should compose this package; it should not absorb it.

---

## 19. Related Documents

- [`alpha-rules.md`](./alpha-rules.md): alpha rewrite rules.
- [`package-learning-architecture.md`](./package-learning-architecture.md):
  package learning architecture and non-provider package boundaries.
- `packages/star-octree-provider/README.md`: package-local overview and
  examples.
