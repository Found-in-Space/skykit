# Alpha Implementation Spec: Star Octree Provider Package

This document is the normative implementation plan for the alpha **Star Octree Provider** package: `@found-in-space/star-octree-provider`, located at `packages/star-octree-provider`.

## 1. Goal

Build a focused **Star Octree Provider Service** that ports the star-octree loading, decoding, streaming, caching, and snapshot behavior into an encapsulated provider API.

This sprint should **not** attempt the full SkyKit object-layer kernel or global message bus. It should create the first concrete provider boundary that future architecture can build on.

The provider should support a live streaming mode first, plus bounded convenience streams for tools and one-shot callers:

```txt
1. Live provider session
   const session = provider.createSession(...)
   session.updateView(view)
   session.deltas()

2. Bounded strategy stream
   provider.streamObjectBatches({ strategy, view, ... })
```

The live session model is the purpose of the package. The provider service owns shared source/cache state. The provider session owns one consumer’s configured loading strategy, current working set, navigation-related demand state, products, and stream lifecycle. Bounded streams are convenience APIs for diagnostics, tools, and callers that want a finite iterable.

---

## 2. Reference-code basis

Current SkyKit already contains reference behavior for most of the lower-level functionality needed for this sprint. These files are reference material only. The alpha package is a clean rewrite into the new shape, not a migration of old modules.

`DatasetSession` currently owns dataset identity, named caches, service instances, sidecar descriptors, and render-service construction. It exposes cache sizes and service snapshots through `describe()`.

`RenderOctreeService` currently wraps the lower-level octree file service and exposes methods such as `ensureBootstrap()`, `ensureRootShard()`, `loadShard()`, `fetchNodePayloadBatchProgressive()`, `resolveNodeByLevelMorton()`, `decodePayload()`, and `describe()`.

`OctreeFileService` currently implements range requests, header parsing, shard parsing, shard prefetch, payload range batching, gzip decompression, persistent cache reads, progressive payload batch callbacks, and detailed statistics counters.

The current `StarFieldLayer` demonstrates the downstream operation we want to formalize: fetch selected node payloads progressively, decode them into typed arrays, concatenate `positions`, `teffLog8`, and `magAbs`, then commit those arrays into geometry.

Sprint 1 should port the useful behavior into the standalone provider/session API without importing, re-exporting, or depending on the old `src/` services.

---

## 3. Non-goals

This sprint must **not**:

```txt
- rewrite ViewerRuntime
- rewrite StarFieldLayer
- implement the full object-layer kernel
- implement the global message bus
- implement workers
- implement WASM
- implement sidecar fact providers
- change current demos
- import, re-export, or depend on current POC `src/` service or layer modules
- introduce Three.js objects into provider products
- introduce Touch OS concepts
```

This sprint is about a clean provider/session boundary for the current star octree.

---

## 4. Architectural boundary

The alpha package should keep three concepts separate:

```txt
source facts
  what the octree file says exists

demand planning
  what this session currently wants from those facts

product streaming
  how demanded payloads become consumer-visible data deltas
```

Provider internals may be implemented with the following responsibility boundaries.

```txt
Source adapter
  Owns byte access: URL range requests, future file handles, cache policy,
  range batching economics, and decompression inputs.
  It does not know about magnitude, observer state, frustums, or render scale.

Octree index reader
  Parses bootstrap/header/shards and produces provider-native runtime node
  records: source bounds, payload offsets, child references, and source
  metadata such as level.
  It exposes facts, not loading policy.

Traversal engine
  Walks the octree using a strategy-supplied visitor or predicate.
  It owns mechanics such as can-descend, has-payload, read-child, and
  cross-shard traversal.
  It does not hard-code observer-shell, target-frustum, extinction, freshness,
  or render behavior.

Strategy / demand planner
  Consumes provider-relevant view state plus source facts and emits a demand
  plan. Built-in and future strategies own relevance math, freshness policy,
  priority, and strategy-specific metadata.

Demand reconciler
  Compares the previous demand plan with the latest demand plan and decides
  which node/product identities remain current, become stale, are removed, or
  require new work.
  It does not understand magnitude, extinction, frustums, or motion logic.

Work scheduler
  Turns reconciled demand into asynchronous work: prioritize, dedupe, avoid
  duplicate fetches, coalesce ranges, and keep latest-view work ahead of stale
  work.
  It does not decide why a node is relevant.

Payload fetcher / cache
  Fetches compressed payload ranges for demanded nodes, applies payload cache
  policy, range batching, and decompression.
  It only cares about payload offsets, lengths, cache keys, and source
  economics.

Payload decoder
  Converts node-local payload records into canonical provider attributes,
  including native coordinate positions.
  It may apply an output coordinate transform during decode, but it does not
  decide which nodes to load.

Product builder
  Packs decoded batches into StarObjectBatchProduct deltas. It preserves
  node/product metadata and coordinate profile, but does not perform demand
  logic.

Session state / delta stream
  Owns the live session contract: latest view revision, demand revision,
  current representation, deltas, current/caught-up status, and disposal.
  It orchestrates provider internals but does not contain strategy-specific
  formulas.

Diagnostics / snapshots
  Reports source/cache/session/work/demand/product state. It may expose
  strategy metadata for inspection, but it must not become a second
  implementation of strategy logic.
```

### 4.0.1 Alpha implementation status

This section tracks the alpha package implementation boundary. It is normative
for the first real vertical slice: implemented items are expected to work
through the provider/session APIs, not through diagnostic side paths.

| Component | Alpha status | Notes |
| --- | --- | --- |
| URL range source | Implemented | Range fetches, bootstrap/shard cache, and basic stats. |
| Octree index reader | Implemented | STAR/ODSC header parsing, root shard loading, shard loading, runtime nodes. |
| Traversal engine | Implemented | Root entries, same-shard children, frontier shards, deterministic traversal. |
| observer-shell strategy | POC-parity implemented | Public strategy shape is pure `{ kind: 'observer-shell' }` and uses provider-native parsec view coordinates plus header `magLimit` shell pruning. `view.motion` may add priority metadata/order, but it does not exclude otherwise visible nodes. |
| target-frustum strategy | POC-parity implemented | Supports exact `orientationIcrs` demand and target/direction-derived demand. Applies shell pruning then frustum/AABB pruning without importing Three.js. |
| Demand reconciler | Second pass implemented | Product membership indexes support grouped live products, stale/remove, and replacement products for partial retention. |
| Work scheduler | Second pass partial | Latest-view stale-work gating, strategy-aware demand-threshold gating, duplicate demand-signature suppression, role-aware prefetch warming, progressive payload work, and work snapshots are implemented. Fully interleaved traversal/fetch reprioritization remains later work. |
| Payload fetcher/cache | POC-parity implemented | Payload range batching, decompression, in-memory decompressed payload cache, cache-first/deferred-cache emission, and range span/gap stats. |
| Payload decoder | First pass implemented | 16-byte star records into parsec `position`, `magAbs`, `teffLog8`, and object refs. |
| Product builder | First pass implemented | Non-cumulative object batches and decode-time coordinate transforms. |
| Live sessions | First pass implemented | `updateView()` stays synchronous; products stream through `session.deltas()`. |
| Bounded streams | First pass implemented | `streamPayloads()`, `streamObjectBatches()`, and `fetchObjectBatch()` share the same pipeline. |
| Persistent decoded cache | Second pass implemented | Memory LRU decoded payload cache is implemented; persistent decoded cache is used when browser Cache API is available and requested. |
| File/blob providers | Second pass implemented | `createStarOctreeFileProviderService()` shares the provider/session API with a blob/file range source. |
| Transfer/workers/WASM | Second pass partial | Transfer ownership is implemented for product buffers when transferable structured clone is available. Dedicated worker/WASM execution remains later. |
| Extinction/dust | Second pass | Apparent visibility is geometric only in this provider slice. |
| Sidecars/names/catalog labels | Second pass partial | A separate `@found-in-space/meta-sidecar-provider` boundary resolves facts from emitted refs/pick metadata. Sidecar octree byte loading remains outside the star provider. |

The demand planner is the only component that should decide relevance. It may use the whole octree header, runtime node facts, limiting magnitude, indexing magnitude, extinction or falloff formulas, frustum tests, view-volume tests, or dataset-specific rules. Those are strategy concerns, not provider-wide assumptions.

Strategy input coordinates should be explicit provider-native view coordinates. For the current star octree this means parsecs unless the source/index metadata declares a different native frame. Product output coordinate transforms are one-way decode/output transforms and must not be used implicitly as strategy input transforms.

A demand plan should be richer than a flat node list when the strategy needs it. It may carry priority, relevance, retention intent, reason codes, and strategy metadata per node. The reconciler and scheduler consume that plan generically; they should not need to know how the strategy calculated it.

There is no universal `observerDistancePc`. Demand-threshold options use explicit names such as `observerMoveThresholdPc`, `limitingMagnitudeDelta`, and `directionAngleDeg`, and they decide when a session replans. They must not change what `observer-shell` means.

### 4.0.2 Known gaps and next-sprint corrections

This list separates current alpha behavior from planned cleanup so implementers
do not accidentally treat POC-parity shortcuts as final architecture.

Implemented today:

- `observer-shell` is public API pure: `{ kind: 'observer-shell' }`.
- `header.maxLevel` and runtime `node.level` are source/runtime metadata, not public detail controls.
- Live sessions accept every `updateView()` synchronously and suppress stale async results from older view revisions.
- Demand-threshold gating is opt-in and strategy-aware. Under-threshold updates still advance `viewRevision`, but they return `demand: 'unchanged'` and do not schedule full traversal/planning.
- Demand revisions increment only after planned node demand actually changes.
- Bounded and live streams emit `data/representation-current` when current-role work for the latest accepted demand revision is caught up.
- Motion hints can influence product ordering/priority metadata, but they do not truncate observer-shell demand.

Known gaps:

- **Budget/debug truncation metadata.** Explicit caps such as `budget.maxTraversalLevel`, `budget.maxPayloadNodes`, `budget.maxBytes`, or `debug.maxTraversalLevel` are not part of the current public API. If added, products, demand metadata, and `data/representation-current` completeness must say the representation is current only within a degraded/truncated budget.
- **Motion prefetch policy.** Motion priority exists for current work ordering. Future motion prefetch should additionally warm likely-future caches through prefetch roles without changing current observer-shell demand.
- **Fully interleaved scheduling.** Current streaming is progressive after demand planning. Fully interleaved traversal/fetch/decode reprioritization remains a later maturity pass.

Implemented demand-threshold option shape:

```ts
export interface StarOctreeDemandThresholds {
  observerMoveThresholdPc?: number;
  limitingMagnitudeDelta?: number;
  directionAngleDeg?: number;
}

interface StarOctreeSessionOptions {
  demandThresholds?: StarOctreeDemandThresholds;
}
```

Planned option shape, not implemented yet:

```ts
interface StarOctreeSessionOptions {
  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
    motionPrefetch?: {
      enabled?: boolean;
      lookaheadSecs?: number;
    };
  };

  budget?: {
    maxTraversalLevel?: number;
    maxPayloadNodes?: number;
    maxBytes?: number;
  };

  debug?: {
    maxTraversalLevel?: number;
  };
}
```

If a budget/debug cap truncates demand, metadata should make it explicit:

```ts
metadata: {
  truncatedBy: 'budget.maxTraversalLevel',
  requestedLimitingMagnitude: 8.0,
}
```

### 4.1 Provider service

The provider service is long-lived and shared.

```txt
StarOctreeProviderService
  owns source access, bootstrap, shard/payload caches, octree traversal,
  runtime-node production, decode helpers,
  provider-level stats, memory accounting, and provider snapshots.
```

It should **not** own current camera state, current app state, renderer state, UI state, XR state, or labels.

### 4.2 Provider session

The provider session is per consumer or per live working set.

```txt
StarOctreeProviderSession
  owns one consumer’s loading strategy, latest provider-relevant view state,
  current node demand, active provider work, product stream, and current representation products,
  and session snapshot.
```

Navigation updates should go to the **session**, not the service.

### 4.3 Why this split matters

Two renderers may share one provider service but use different sessions:

```txt
same provider:
  shared bootstrap
  shared shard cache
  shared payload cache
  shared decoded cache, later

different sessions:
  different observer state
  different magnitude limit
  different configured strategies and internal node demand
  different products
  different stream lifecycle
```

---

## 5. Package source layout

Normative layout:

```txt
packages/star-octree-provider/
  package.json
  src/
    index.js
    index.d.ts
    star-octree-provider-service.js
    star-octree-provider-session.js
    star-octree-products.js
    star-octree-queue.js
    __tests__/
      star-octree-provider-service.test.js
      star-octree-provider-session.test.js
      star-octree-products.test.js
```

---

## 6. Public API

### 6.1 Creation

```js
import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';

const provider = createStarOctreeProviderService({
  url: '/data/stars.octree',
});
```

The alpha package uses clean source configuration. It should not require or accept SkyKit `DatasetSession` / render-service objects as its primary construction path.

The alpha factory is specifically the URL/range-request provider. Its constructor should stay narrow and should only expose options that this source mode implements.

Normative alpha constructor:

```ts
export interface StarOctreeProviderServiceOptions {
  id?: string;
  url: string;
  datasetId?: string | null;
  persistentCache?: 'on' | 'off';

  limits?: {
    memoryBudgetBytes?: number;
    maxInflightPayloadBatches?: number;
    payloadMaxGapBytes?: number;
    payloadMaxBatchBytes?: number;
  };
}
```

Example:

```js
const provider = createStarOctreeProviderService({
  url: '/data/stars.octree',
  datasetId: 'example-dataset',
  persistentCache: 'on',
});
```

The common provider/session API is the important contract. Different source implementations may have different internal economics and should not be forced into one constructor.

Non-URL sources should be exposed as separate factories or source-specific adapters with their own options. The alpha file/blob source is:

```ts
export interface StarOctreeFileProviderServiceOptions {
  id?: string;
  file: Blob;
  datasetId?: string | null;
  limits?: StarOctreeProviderServiceOptions['limits'];
}

export function createStarOctreeFileProviderService(
  options: StarOctreeFileProviderServiceOptions
): StarOctreeProviderService;
```

A file/blob source shares the common provider/session API, but it does not use HTTP range cache semantics or URL range-gap economics.

### 6.2 Provider service API

```ts
export interface StarOctreeProviderService {
  id: string;

  describe(): StarOctreeProviderDescriptor;

  getSnapshot(): StarOctreeProviderSnapshot;

  ensureBootstrap(): Promise<StarOctreeBootstrapProduct>;

  createSession(
    options?: StarOctreeSessionOptions
  ): StarOctreeProviderSession;

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

### 6.3 Provider session API

```ts
export interface StarOctreeProviderSession {
  id: string;

  updateView(
    patch: StarOctreeViewPatch,
    options?: ViewUpdateOptions
  ): StarOctreeViewReceipt;

  subscribe(
    listener: (delta: StarOctreeProductDelta) => void
  ): () => void;

  deltas(): AsyncIterable<StarOctreeProductDelta>;

  getSnapshot(): StarOctreeSessionSnapshot;

  dispose(): void | Promise<void>;
}
```

Sprint 1 should implement `updateView()` as a synchronous live-state update for configured loading strategies. Public callers provide source configuration, strategy configuration, and view state. They do not provide `StarOctreeRuntimeNode[]`; the provider/session produces runtime nodes by loading and navigating the octree index. Demand planning, fetching, pruning, and product emission continue asynchronously after the view update is accepted.

---

## 7. Provider descriptor

```ts
export interface StarOctreeProviderDescriptor {
  id: string;
  providerType: 'star-octree';

  datasetId?: string | null;
  datasetIdentitySource?: string | null;

  url?: string | null;

  produces: Array<'index' | 'object-batch'>;

  objectTypes: ['star'];

  attributes: Array<
    | 'position'
    | 'teffLog8'
    | 'magAbs'
    | 'objectRef'
    | 'pickMeta'
  >;

  capabilities: {
    progressive: boolean;
    rangeRequestable: boolean;
    payloadBatching: boolean;
    persistentCache: boolean;
    decodedCache: boolean;
    borrowedBuffers: boolean;
    transferableBuffers: boolean;
    sessions: boolean;
  };

  limits: {
    memoryBudgetBytes?: number;
    maxInflightPayloadBatches?: number;
    payloadMaxGapBytes?: number;
    payloadMaxBatchBytes?: number;
  };
}
```

Values should be derived from the package's own internal source/cache/scheduler state. Capabilities describe implemented behavior, not future intent; for example `decodedCache` and `transferableBuffers` should only be true when those paths are active in the current runtime.

---

## 8. Session options

```ts
export interface StarOctreeDemandThresholds {
  observerMoveThresholdPc?: number;
  limitingMagnitudeDelta?: number;
  directionAngleDeg?: number;
}

export type StarOctreeFetchStrategy =
  | {
      kind: 'observer-shell';
    }
  | {
      kind: 'target-frustum';
      verticalFovDeg?: number;
      overscanDeg?: number;
      targetRadiusPc?: number;
      nearPc?: number;
      farPc?: number;
    }
  | {
      kind: 'custom';
      /**
       * Custom strategies select from provider-supplied traversal context.
       * They must not require externally-created runtime nodes.
       */
      selectDemand: (
        context: StarOctreeSelectionContext
      ) => Promise<StarOctreeDemandPlan> | StarOctreeDemandPlan;
      shouldReplan?: (
        context: StarOctreeDemandGateContext
      ) => StarOctreeDemandGateResult;
    };

export interface StarOctreeDemandGateContext {
  strategy: StarOctreeFetchStrategy;
  thresholds?: StarOctreeDemandThresholds;
  previousDemandView: StarOctreeViewState | null;
  nextView: StarOctreeViewState;
  reason?: string;
}

export type StarOctreeDemandGateResult =
  | boolean
  | {
      replan: boolean;
      reasons?: string[];
    };

export interface StarOctreeDemandEntry {
  node: StarOctreeRuntimeNode;
  priority?: number;
  relevance?: number;
  role?: 'current' | 'prefetch';
  reasons?: StarOctreeViewReceipt['reasons'];
  metadata?: Record<string, unknown>;
}

export interface StarOctreeDemandPlan {
  entries: StarOctreeDemandEntry[];
  signature?: string;
  reasons?: StarOctreeViewReceipt['reasons'];
  metadata?: Record<string, unknown>;
}

export interface StarOctreeTraversalDecision {
  include?: boolean;
  descend?: boolean;
  priority?: number;
  relevance?: number;
  role?: 'current' | 'prefetch';
  reasons?: StarOctreeViewReceipt['reasons'];
  metadata?: Record<string, unknown>;
  distancePc?: number;
}

export interface StarOctreeTraversalSelectionResult {
  entries: StarOctreeDemandEntry[];
  stats: {
    inspectedNodeCount: number;
    selectedNodeCount: number;
    prunedNodeCount: number;
    payloadNodeCount: number;
    frontierShardCount: number;
    maxLevelInspected: number | null;
  };
}

export interface StarOctreeSelectionContext {
  providerId: string;
  sessionId?: string;
  strategy: StarOctreeFetchStrategy;
  view: StarOctreeViewState;
  viewRevision: number;
  demandRevision: number;
  attributes: string[];
  coordinates: StarOctreeCoordinateOutput;

  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
  };

  /**
   * Provider-owned traversal helper for custom strategies. Applications may
   * choose relevance, descend/prune decisions, roles, priority, and metadata,
   * but they do not construct root shards or runtime nodes themselves.
   */
  traversal: {
    select(options: {
      distanceToNode?: (node: StarOctreeRuntimeNode) => number;
      visit: (
        node: StarOctreeRuntimeNode,
        helpers: {
          context: StarOctreeSelectionContext;
          bootstrap: StarOctreeBootstrapProduct;
        }
      ) =>
        | Promise<StarOctreeTraversalDecision>
        | StarOctreeTraversalDecision;
    }): Promise<StarOctreeTraversalSelectionResult>;
  };
}

export interface StarOctreeSessionOptions {
  id?: string;

  strategy?: StarOctreeFetchStrategy;

  demandThresholds?: StarOctreeDemandThresholds;

  attributes?: Array<
    | 'position'
    | 'teffLog8'
    | 'magAbs'
    | 'objectRef'
    | 'pickMeta'
    | string
  >;

  /**
   * Native star-octree positions are parsecs. A coordinate output profile may
   * translate those parsec positions while decoding, so render scale can be
   * encapsulated without allocating a second converted array.
   */
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

`level` is octree source metadata, not a public quality or loading-control concept. Different valid star-octree files may use different subdivision limits and still represent the same physical demand. Public strategies must therefore select demand with physical and perceptual inputs such as observer position, limiting magnitude, and view volume. Motion may influence priority or prefetch policy, but it must not make normal observer-shell demand incomplete.

Built-in strategy semantics:

```txt
observer-shell:
  apply the magnitude-indexed shell predicate to provider-owned octree traversal
  and emit deterministic coarse-first demand by default. The normal meaning is:
  observer position + limiting magnitude + dataset index magnitude determine
  potentially visible node demand.

target-frustum:
  apply the same magnitude-indexed shell predicate, then prune by frustum/AABB
  intersection. The frustum may be exact from `orientationIcrs`, or derived
  from `targetPc`/`directionIcrs` using provider-owned plain-data math.

custom:
  may implement its own demand predicate with the provider traversal helper,
  but should still treat runtime node level as source metadata unless the custom
  strategy is explicitly dataset-specific. Custom strategies may also provide
  `shouldReplan()` when they need strategy-specific demand-threshold policy;
  otherwise they replan on every non-suppressed update.
```

Normative magnitude-shell predicate:

```txt
distanceToNodeAabbPc <= node.halfSize * 10 ** ((limitingMagnitude - header.magLimit) / 5)
```

`header.magLimit` is the dataset indexing magnitude. `limitingMagnitude` / `mDesired` is the session's requested apparent-magnitude demand. `header.maxLevel` is only descriptive source metadata and an internal traversal boundary where the file has no deeper children; it must not be exposed as the strategy's detail control.

The runtime node `halfSize`, center coordinates, and distance calculations in this predicate are in native parsecs.

Current alpha behavior: `view.motion` can add ordering metadata such as
`motionPriorityBias` and `motionLookaheadDistancePc`. It does not prevent
descent into magnitude-shell-relevant nodes. If an explicit future budget/debug
cap truncates traversal, that cap must be visible through degraded completeness
and truncation metadata.

Demand-threshold gating is opt-in. If `demandThresholds` is omitted, built-in
strategies preserve the always-plan behavior. If thresholds are present, missing
or invalid threshold fields are treated as unset, which means any change to that
provider-relevant field queues planning; `0` means any non-zero change is
meaningful. Thresholds decide whether to run a new plan. They do not cancel
active work and they do not change strategy eligibility.

Default sprint-1 options:

```js
{
  strategy: { kind: 'observer-shell' },
  attributes: ['position', 'teffLog8', 'magAbs'],
  coordinates: {
    name: 'position',
    units: ['pc', 'pc', 'pc'],
  },
  streaming: {
    progressive: true,
    emitCachedFirst: true,
  },
  memory: {
    ownership: 'borrowed',
  },
}
```

Coordinate output profile:

```ts
export interface StarOctreeCoordinateOutput {
  name?: string;
  frame?: 'icrs' | string;
  units?: [string, string, string];

  transformPosition?: (
    position: {
      xPc: number;
      yPc: number;
      zPc: number;
      node: StarOctreeRuntimeNode;
      ordinal: number;
    }
  ) => [number, number, number] | { x: number; y: number; z: number };
}
```

---

## 9. View patch shape

```ts
export interface StarOctreeViewPatch {
  observerPc?: { x: number; y: number; z: number };

  /**
   * Alias accepted for current SkyKit naming.
   */
  mDesired?: number;

  /**
   * Preferred provider-session naming.
   */
  limitingMagnitude?: number;

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

export interface ViewUpdateOptions {
  demand?: 'auto' | 'force' | 'suppress';
  reason?: string;
}
```

`target-frustum` uses the same camera convention as `camera-rig.js`: local forward is `(0, 0, -1)`, right is `(1, 0, 0)`, and up is `(0, 1, 0)`. The provider must not import Three.js or camera objects. For exact frustum demand, `orientationIcrs`, `verticalFovDeg`, and `aspectRatio` are required. For POC-parity target demand, `orientationIcrs` may be omitted when `targetPc` or `directionIcrs` is present. Target-derived demand defaults `verticalFovDeg` to `40`, `overscanDeg` to `8`, `aspectRatio` to `1`, and `targetRadiusPc` to `96`. `nearPc` defaults to `0`; omitted `farPc` means no explicit far plane for exact/direction demand, or `targetDistancePc + targetRadiusPc + preloadDistancePc` for target-derived demand.

Sprint 1 behavior:

```txt
updateView()
  - normalizes and stores provider-relevant view state
  - increments viewRevision
  - returns a receipt immediately after accepting the new state
  - schedules demand planning for the latest view unless suppressed or gated as
    unchanged
  - uses provider-owned octree traversal to produce runtime nodes during planning
  - increments demandRevision only when planned node demand changes
  - streams product deltas for the current demand revision
  - uses motion fields as priority hints only; they do not change
    observer-shell eligibility
  - updates the session's current representation for the latest accepted view
```

---

## 10. View receipt

```ts
export interface StarOctreeViewReceipt {
  sessionId: string;

  viewRevision: number;
  demandRevision: number;

  demand: 'queued' | 'forced' | 'suppressed' | 'unchanged';

  reasons: string[];
}
```

Common built-in reasons include `initial`, `demand-changed`,
`observer-move-threshold`, `threshold-unchanged`, `limiting-magnitude`,
`strategy`, `view-volume`, `manual`, and `unsupported-strategy`. Custom
strategies may return their own reason strings.

Current alpha receipt behavior:

- `queued`: automatic update accepted and full demand planning was scheduled.
- `forced`: update accepted and demand planning was scheduled while bypassing
  demand-threshold gating.
- `suppressed`: update accepted, but the caller explicitly asked not to schedule
  demand planning.
- `unchanged`: update accepted and `viewRevision` advanced, but the configured
  strategy-aware gate determined that no new demand planning was needed.

Example:

```js
const receipt = session.updateView({
  observerPc,
  limitingMagnitude: 6.5,
});

if (receipt.demand === 'queued' || receipt.demand === 'forced') {
  // Planning/fetching continues through session deltas.
}
```

---

## 11. Strategy-driven demand update

The provider package loads and navigates the octree. Applications do not supply runtime nodes. A session is configured with a loading strategy, and applications provide the state that strategy needs through `updateView()`.

A live session is not a request/response API where each `updateView()` owns a discrete batch to await or cancel. `updateView()` is a current-state signal. It accepts state synchronously, returns a receipt, and lets provider work continue in the background. View state is expected to age immediately and update repeatedly while batches are still arriving. Current motion hints may influence work priority. Future motion prefetch may fetch objects before the app has actually moved the view there.

Normal viewer flow:

```txt
1. Create a session with an initial strategy and view.
2. Batches start appearing.
3. The app calls updateView() as navigation changes.
4. More batches arrive while more view updates happen.
5. The session uses the latest view state to plan current demand. Future motion policy may prefetch near-future demand without changing what is current.
6. Deltas continue until the session representation is current for the latest accepted view.
```

Expected behavior for `session.updateView(patch, options)`:

```txt
1. Normalize and store view patch.
2. Increment viewRevision.
3. If suppressed, stop after accepting the view and return `suppressed`.
4. If forced, queue demand planning and return `forced`.
5. Otherwise, run the strategy-aware demand gate. If the gate says no replan,
   keep the current demand revision, emit no deltas for this update, and return
   `unchanged`.
6. If the gate queues demand, store the latest view as the demand anchor and
   return `queued`.
7. Compute strategy demand asynchronously using provider-owned octree traversal.
8. Normalize runtime nodes produced by the provider.
9. If demand changed, increment demandRevision.
10. Start or reprioritize progressive object-batch streaming for the current demand.
11. Emit upsert/remove/stale deltas so the session representation matches current demand.
12. Reach current status when there is no more fetching, pruning, or recalculation pending for the latest demand revision.
```

This is the most important sprint-1 behavior.

Demand-threshold gating:

```txt
Opt-in, strategy-aware demand-threshold gating runs before full traversal/planning.
```

Thresholds decide **when to replan**, not **what a strategy means**. For
example, a live session may accept a tiny observer movement immediately,
increment `viewRevision`, and keep the existing demand revision if the movement
does not exceed `observerMoveThresholdPc`. A meaningful movement, limiting
magnitude change, frustum direction/orientation/volume change, strategy change,
or future budget/debug change should schedule planning.

Built-in gates:

- `observer-shell` compares observer position and limiting magnitude.
- `target-frustum` compares observer position, limiting magnitude, target,
  direction, orientation-derived forward vector, FOV, aspect, near/far planes,
  and preload distance.
- `directionAngleDeg` applies to `directionIcrs` and orientation-derived
  forward vectors.
- Missing threshold values mean any change to that field is meaningful.
- Invalid or negative threshold values are ignored; `0` means any non-zero
  change is meaningful.

Custom strategies may provide `shouldReplan(context)`. If omitted, they preserve
the always-plan behavior. A custom gate can inspect `previousDemandView`,
`nextView`, `thresholds`, `strategy`, and the caller-supplied reason.

Coordinate output profile changes do not change node demand; they may require
product repacking/re-emission, but they should not be treated as observer-shell
traversal changes.

---

## 12. Stream Option Shapes

### 12.1 Object batch stream options

```ts
export interface StarOctreeObjectBatchStreamOptions {
  id?: string;

  strategy?: StarOctreeFetchStrategy;
  view?: StarOctreeViewPatch;

  viewRevision?: number;
  demandRevision?: number;

  attributes?: Array<
    | 'position'
    | 'teffLog8'
    | 'magAbs'
    | 'objectRef'
    | 'pickMeta'
    | string
  >;

  coordinates?: StarOctreeCoordinateOutput;

  streaming?: {
    progressive?: boolean;
    batchMode?: 'payload-range' | 'node';
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
    retainOrder?: boolean;
  };

  memory?: {
    ownership?: 'borrowed' | 'copy' | 'transfer';
  };
}
```

### 12.2 Progressive object-batch semantics

`streamObjectBatches()` uses efficient batch semantics.

Each `data/product-upsert` delta contains a `StarObjectBatchProduct` for the newly decoded payload entries represented by that delta. It is not a cumulative snapshot of all objects loaded so far for the stream.

Consequences:

```txt
- product ids are unique per emitted object batch
- product node offsets are local to that product
- provider streams do not repeatedly re-merge previously emitted objects
- deltas are not add-only; remove/stale deltas are part of maintaining the current representation
- consumers own merge, prune, stale/remove handling, throttling, and render-commit policy
- provider/session code may offer helper utilities, but merge policy belongs to the consuming application
```

`fetchObjectBatch({ strategy, view })` is the required convenience API that returns one merged complete product for one-shot callers.

`coarseFirst` defaults to `true` for built-in strategy demand ordering, matching
the POC's useful "coarser spatial representation before deeper detail"
streaming behavior. Set `coarseFirst: false` to prefer pure strategy priority
or distance ordering. `retainOrder` is reserved for a later strict-order
streaming mode; high-throughput payload-range batching is the current default.

### 12.3 Payload stream options

```ts
export interface StarOctreePayloadStreamOptions {
  id?: string;
  strategy?: StarOctreeFetchStrategy;
  view?: StarOctreeViewPatch;

  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    coarseFirst?: boolean;
  };
}
```

---

## 13. Runtime node shape

Use this runtime node shape for provider-produced demand plans, payload entries, and product metadata. It corresponds to the current render-octree node shape, but the alpha package owns its own implementation. Applications should not need to construct these nodes to use the provider.

```ts
export interface StarOctreeRuntimeNode {
  nodeKey: string;

  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;

  level: number;
  gridX: number;
  gridY: number;
  gridZ: number;

  flags: number;
  childMask: number;

  payloadOffset: number;
  payloadLength: number;

  firstChild: number;
  localDepth: number;
  localPath: number;

  shardOffset: number;
  nodeIndex: number;
}
```

The alpha provider builds these runtime nodes from shard records and node geometry.

---

## 14. Product shapes

### 14.1 Bootstrap product

```ts
export interface StarOctreeBootstrapProduct {
  productType: 'index';
  indexKind: 'star-octree-bootstrap';

  providerId: string;

  datasetId?: string | null;
  datasetIdentitySource?: string | null;

  header: {
    version: number;
    indexOffset: number;
    indexLength: number;
    worldCenterX: number;
    worldCenterY: number;
    worldCenterZ: number;
    worldHalfSize: number;
    payloadRecordSize: number;
    /**
     * Source metadata only. This is not a public strategy/detail knob.
     */
    maxLevel: number;
    /**
     * Dataset indexing magnitude used by magnitude-shell traversal.
     */
    magLimit: number;
  };

  completeness: {
    phase: 'complete';
    stable: true;
  };
}
```

### 14.2 Internal root shard

The root shard is an internal index/traversal starting point, not a normal
consumer-facing product. The provider may expose diagnostics about root-shard
readiness through snapshots, but live sessions and bounded streams should load
and navigate the root shard internally from the bootstrap `header.indexOffset`.

Applications should not need to request or inspect root shard records to use the
provider. Runtime nodes are provider-produced facts consumed by strategies,
traversal, payload fetching, and diagnostics.

### 14.3 Object batch product

```ts
export interface StarObjectBatchProduct {
  productType: 'object-batch';

  id: string;
  providerId: string;

  layerId: 'stars';
  objectType: 'star';

  streamId: string;
  sessionId?: string;

  viewRevision?: number;
  demandRevision?: number;

  count: number;

  nodes: Array<{
    nodeKey: string;
    level: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
    halfSize: number;
    count: number;
    offset: number;
  }>;

  coordinates: {
    primary: {
      name: string;
      frame: string;
      representation: 'cartesian3';
      units: [string, string, string];
      stride: 3;
      components: Float32Array;
    };
  };

  attributes: {
    teffLog8?: {
      name: 'teffLog8';
      kind: 'number';
      values: Uint8Array;
    };

    magAbs?: {
      name: 'magAbs';
      kind: 'number';
      unit: 'mag';
      values: Float32Array;
    };
  };

  refs?: CanonicalObjectRef[];

  pickMeta?: Array<{
    nodeKey: string;
    ordinal: number;
    level: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
  }>;

  completeness: {
    phase: 'coarse' | 'partial' | 'complete' | 'stale';
    stable: boolean;
    loadedObjects: number;
    loadedNodes: number;
    totalNodes?: number;
  };

  memory: {
    ownership: 'borrowed' | 'copy' | 'transfer';
    bytes: number;
  };

  metadata?: Record<string, unknown>;
}
```

---

## 15. Delta shapes

### 15.1 Payload deltas

```ts
export type StarOctreePayloadDelta =
  | {
      type: 'payload/batch';
      streamId: string;
      providerId: string;
      sessionId?: string;

      entries: Array<{
        node: StarOctreeRuntimeNode;
        buffer: ArrayBuffer;
      }>;

      cached?: boolean;

      completeness: {
        phase: 'partial' | 'complete';
      };
    }
  | {
      type: 'payload/progress';
      streamId: string;
      providerId: string;
      sessionId?: string;

      loadedNodes: number;
      totalNodes: number;
      loadedBytes?: number;
    }
  | {
      type: 'payload/complete';
      streamId: string;
      providerId: string;
      sessionId?: string;
    }
  | {
      type: 'payload/error';
      streamId: string;
      providerId: string;
      sessionId?: string;

      error: {
        message: string;
        code?: string;
      };
    };
```

### 15.2 Product deltas

For progressive object-batch streams, product deltas maintain the session's current representation of the latest accepted `updateView()` state. `data/product-upsert` means "incorporate this product according to the consumer's policy." `data/product-remove` and `data/product-stale` mean previously emitted products are no longer current for the session's demand. The stream is not add-only.

`data/representation-current` means the session's display/current representation is caught up for the referenced demand revision: all `role: 'current'` planning, fetching, decoding, pruning, and product emission for that demand is complete. It does not mean the entire octree or all stars are loaded, and it does not close the live session stream.

`role: 'prefetch'` entries are cache-warming freshness work. They must not emit products and they must not block `data/representation-current`; active or failed prefetch work should be visible through provider/session work snapshots instead.

```ts
export type StarOctreeProductDelta =
  | {
      type: 'data/product-upsert';
      streamId: string;
      providerId: string;
      sessionId?: string;
      product: StarObjectBatchProduct;
    }
  | {
      type: 'data/product-stale';
      providerId: string;
      sessionId?: string;
      productId: string;
      reason?: string;
    }
  | {
      type: 'data/product-remove';
      providerId: string;
      sessionId?: string;
      productId: string;
      reason?: string;
    }
  | {
      type: 'data/representation-current';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      productIds?: string[];
      completeness: StarObjectBatchProduct['completeness'];
    }
  | {
      type: 'data/product-error';
      streamId: string;
      providerId: string;
      sessionId?: string;

      error: {
        message: string;
        code?: string;
      };
    };
```

---

## 16. Session snapshot

```ts
export interface StarOctreeSessionSnapshot {
  id: string;

  strategy: StarOctreeFetchStrategy;

  view: StarOctreeViewState;

  demand: {
    revision: number;

    status:
      | 'idle'
      | 'planning'
      | 'loading'
      | 'streaming'
      | 'current'
      | 'failed'
      | 'disposed';

    demandNodeCount: number;
    currentProductCount: number;
    activeWorkItemCount: number;
  };

  products: Array<{
    productId: string;
    nodeCount: number;
    starCount: number;
    phase: 'coarse' | 'partial' | 'complete' | 'stale';
    current: boolean;
    bytes: number;
  }>;

  memory: {
    liveBytes: number;
    borrowedBytes: number;
    evictableBytes: number;
  };

  lastReasons: string[];

  lastError?: string | null;
}
```

---

## 17. Provider snapshot

```ts
export interface StarOctreeProviderSnapshot {
  id: string;
  providerType: 'star-octree';

  dataset: {
    datasetId?: string | null;
    identitySource?: string | null;
    url?: string | null;
    bootstrapReady: boolean;
    rootShardReady: boolean;
  };

  cache: {
    bootstrapHeaders: number;
    shardHeaders: number;
    payloads: number;
    decodedPayloads?: number;
    products?: number;
  };

  sessions: Array<{
    id: string;
    status: StarOctreeSessionSnapshot['demand']['status'];
    demandNodeCount: number;
    activeWorkItemCount: number;
    productCount: number;
    liveBytes: number;
  }>;

  workItems: Array<{
    workId: string;
    sessionId?: string;

    status:
      | 'queued'
      | 'fetching'
      | 'decoding'
      | 'streaming'
      | 'finished'
      | 'failed';

    nodeCount?: number;
    bytesLoaded?: number;
    startedAtMs?: number;
    finishedAtMs?: number;
  }>;

  memory: {
    budgetBytes?: number;
    usedBytes?: number;
    rawPayloadBytes?: number;
    decodedPayloadBytes?: number;
    liveProductBytes?: number;
    borrowedBytes?: number;
    evictableBytes?: number;
  };

  stats: {
    rangeRequests: number;
    bytesRequested: number;
    payloadBatchRequests: number;
    payloadNodesFetched: number;
    payloadCacheHits: number;
    payloadCompressedBytesRequested?: number;
    payloadSpanBytesRequested?: number;
    payloadGapBytesRequested?: number;
    shardCacheHits: number;
    headerCacheHits: number;
    persistentCacheHits: number;
    decodedCacheHits?: number;
    decodedPersistentCacheHits?: number;
    decodedCacheEvictions?: number;
    fetchTimeMs: number;
  };
}
```

---

## 18. Implementation details

### 18.1 Async queue helper

Because the source implementation may expose progressive payload callbacks internally, create a small async queue.

```js
export function createAsyncQueue() {
  const values = [];
  const waiters = [];
  let closed = false;
  let error = null;

  function push(value) {
    if (closed) return;

    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      values.push(value);
    }
  }

  function close() {
    closed = true;

    while (waiters.length) {
      waiters.shift().resolve({ value: undefined, done: true });
    }
  }

  function fail(nextError) {
    error = nextError;
    closed = true;

    while (waiters.length) {
      waiters.shift().reject(nextError);
    }
  }

  return {
    push,
    close,
    fail,

    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (values.length) {
          yield values.shift();
          continue;
        }

        if (error) {
          throw error;
        }

        if (closed) {
          return;
        }

        const next = await new Promise((resolve, reject) => {
          waiters.push({ resolve, reject });
        });

        if (next.done) {
          return;
        }

        yield next.value;
      }
    },
  };
}
```

### 18.2 `streamPayloads()`

Expose progressive payload fetches from the package's own octree source implementation. This is a lower-level public stream for custom consumers, diagnostics, analytics, alternate renderers, offline tools, and applications the provider does not yet know about. It emits provider-resolved, decompressed payload buffers plus runtime node metadata. Consumers of this stream own decoding and interpretation.

`streamPayloads()` is bounded by the supplied strategy/view options. It is not the primary viewer API; live viewers should usually use provider sessions.

Pseudo-code:

```js
async function* streamPayloads(options) {
  const streamId = options.id ?? createStreamId('payload');
  const queue = createAsyncQueue();
  const demand = await planDemandFromStreamOptions(options);
  const nodes = demand.entries.map((entry) => entry.node);

  registerWorkItem(streamId, {
    status: 'fetching',
    nodeCount: nodes.length,
  });

  const finalPromise = octreeSource.fetchNodePayloadBatchProgressive(nodes, {
    onBatch(entries) {
      queue.push({
        type: 'payload/batch',
        streamId,
        providerId,
        entries,
        completeness: { phase: 'partial' },
      });
    },
  });

  finalPromise
    .then(() => {
      queue.push({
        type: 'payload/complete',
        streamId,
        providerId,
      });
      finishWorkItem(streamId);
      queue.close();
    })
    .catch((error) => {
      failWorkItem(streamId, error);
      queue.push({
        type: 'payload/error',
        streamId,
        providerId,
        error: { message: error.message ?? String(error) },
      });
      queue.close();
    });

  yield* queue;
}
```

### 18.3 Decode entries into one batch product

This helper creates a product for one emitted batch. It must not use the same product id for every batch in a stream.

```js
function createStarObjectBatchProduct({
  providerId,
  sessionId,
  streamId,
  productIndex,
  entries,
  attributes,
  coordinates,
  viewRevision,
  demandRevision,
}) {
  const decodedSegments = [];

  let totalCount = 0;

  for (const { node, buffer } of entries) {
    const decoded = octreeSource.decodePayload(buffer, node, {
      coordinates,
    });

    decodedSegments.push({ node, decoded });
    totalCount += decoded.count;
  }

  const positions = new Float32Array(totalCount * 3);
  const teffLog8 = attributes.includes('teffLog8')
    ? new Uint8Array(totalCount)
    : null;
  const magAbs = attributes.includes('magAbs')
    ? new Float32Array(totalCount)
    : null;

  const nodes = [];
  const pickMeta = attributes.includes('pickMeta') ? [] : null;

  let offset = 0;

  for (const { node, decoded } of decodedSegments) {
    positions.set(decoded.positions, offset * 3);

    if (teffLog8) teffLog8.set(decoded.teffLog8, offset);
    if (magAbs) magAbs.set(decoded.magAbs, offset);

    nodes.push({
      nodeKey: node.nodeKey,
      level: node.level,
      gridX: node.gridX,
      gridY: node.gridY,
      gridZ: node.gridZ,
      centerX: node.centerX,
      centerY: node.centerY,
      centerZ: node.centerZ,
      halfSize: node.halfSize,
      count: decoded.count,
      offset,
    });

    if (pickMeta) {
      for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
        pickMeta.push({
          nodeKey: node.nodeKey,
          ordinal,
          level: node.level,
          gridX: node.gridX,
          gridY: node.gridY,
          gridZ: node.gridZ,
          centerX: node.centerX,
          centerY: node.centerY,
          centerZ: node.centerZ,
        });
      }
    }

    offset += decoded.count;
  }

  return {
    productType: 'object-batch',
    id: createProductId(streamId, productIndex),
    providerId,
    sessionId,
    layerId: 'stars',
    objectType: 'star',
    streamId,
    viewRevision,
    demandRevision,
    count: totalCount,
    nodes,
    coordinates: {
      primary: {
        name: coordinates?.name ?? 'position',
        frame: coordinates?.frame ?? 'icrs',
        representation: 'cartesian3',
        units: coordinates?.units ?? ['pc', 'pc', 'pc'],
        stride: 3,
        components: positions,
      },
    },
    attributes: {
      ...(teffLog8 ? { teffLog8: { name: 'teffLog8', kind: 'number', values: teffLog8 } } : {}),
      ...(magAbs ? { magAbs: { name: 'magAbs', kind: 'number', unit: 'mag', values: magAbs } } : {}),
    },
    ...(pickMeta ? { pickMeta } : {}),
    completeness: {
      phase: 'partial',
      stable: true,
      loadedObjects: totalCount,
      loadedNodes: entries.length,
    },
    memory: {
      ownership: 'borrowed',
      bytes: positions.byteLength
        + (teffLog8?.byteLength ?? 0)
        + (magAbs?.byteLength ?? 0),
    },
  };
}
```

### 18.4 Session `updateView()`

Pseudo-flow:

```js
function updateView(patch, options = {}) {
  assertActive();

  const nextView = normalizeViewPatch(currentView, patch);

  viewRevision += 1;
  currentView = nextView;

  if (options.demand === 'suppress') {
    return {
      sessionId,
      viewRevision,
      demandRevision,
      demand: 'suppressed',
      reasons: [],
    };
  }

  scheduleDemandPlanning({
    strategy: sessionOptions.strategy,
    view: currentView,
    viewRevision,
    force: options.demand === 'force',
    reason: options.reason ?? 'demand-changed',
  });

  return {
    sessionId,
    viewRevision,
    demandRevision,
    demand: options.demand === 'force' ? 'forced' : 'queued',
    reasons: [options.reason ?? 'demand-changed'],
  };
}
```

The scheduled demand-planning work item then loads and navigates the octree, computes the latest node demand, reconciles the session representation, and emits deltas. Work items are internal provider bookkeeping; callers observe their effects through product deltas and snapshots.

### 18.5 Session deltas

The session should have its own async queue and listener set.

```js
session.subscribe(listener)
session.deltas()
```

Both should receive the same deltas. Unlike bounded provider streams, `session.deltas()` is a live stream: it stays open across many `updateView()` calls and closes only when the session is disposed or fails terminally. Reaching `data/representation-current` for one demand revision must not close the session delta stream.

---

## 19. Memory policy for sprint 1

Use simple same-thread semantics.

```txt
ownership: 'borrowed'
```

Rules:

```txt
- Provider/session emits typed arrays.
- Provider/session must not mutate emitted arrays.
- Consumer may use arrays directly.
- Provider/session may mark products stale/remove them from the current representation, but no lease mechanism yet.
- Worker transfer is not implemented in sprint 1.
```

Add metadata now:

```ts
memory: {
  ownership: 'borrowed',
  bytes,
}
```

Future memory modes:

```txt
copy      for safety or small products
transfer  for worker-to-main
shared    for SharedArrayBuffer/WASM pools
```

Do not implement those in sprint 1.

---

## 20. Position units and transforms

The native star-octree spatial unit is parsecs. Decode should first interpret node-local payload coordinates into canonical parsec positions:

```txt
node-local payload position + runtime node bounds -> xPc, yPc, zPc
```

By default, provider products emit those parsec coordinates:

```js
coordinates: {
  name: 'position',
  units: ['pc', 'pc', 'pc'],
}
```

Consumers that need render coordinates may provide a coordinate transform. The transform may apply rotation, translation, scale, axis remapping, or another deterministic mapping from parsecs into the requested output space. It is applied during decode, so the provider does not need to allocate parsec positions and then allocate a second converted array:

```js
coordinates: {
  name: 'render-position',
  units: ['render', 'render', 'render'],
  transformPosition({ xPc, yPc, zPc }) {
    return [xPc * 0.001, yPc * 0.001, zPc * 0.001];
  },
}
```

This keeps the data contract physically meaningful by default while allowing SkyKit or another renderer to choose its own presentation scale without baking renderer-specific names such as `scene` into the provider.

---

## 21. Sidecars and fact providers

Sidecars are out of scope for the star provider.

`StarOctreeProviderService` should not resolve names, identifiers, or metadata.

Reason:

```txt
StarOctreeProviderService
  → bulk object-batch products

MetaSidecarProviderService
  → fact-batch products
```

The alpha sidecar boundary is a separate `@found-in-space/meta-sidecar-provider` package. It accepts `CanonicalObjectRef` or `pickMeta`-shaped references emitted by star products, validates parent dataset identity, and resolves display facts without creating a dependency from the star provider back into labels/catalog UI.

The sidecar package should evolve independently. Its byte-level sidecar octree source can reuse the same architectural boundaries as the star provider later, but it must not be folded into `packages/star-octree-provider`.

---

## 22. Testing plan

### 22.1 Unit tests with fake octree source

Avoid live network tests.

Mock:

```txt
ensureBootstrap()
ensureRootShardLoaded()
planDemandFromStrategy()
fetchNodePayloadBatchProgressive()
decodePayload()
describe()
```

Test fixture:

```js
const nodeA = { nodeKey: '1:1', payloadLength: 16, ... };
const nodeB = { nodeKey: '1:2', payloadLength: 16, ... };

planDemandFromStrategy() => ({
  entries: [
    { node: nodeA, priority: 100, role: 'current' },
    { node: nodeB, priority: 80, role: 'prefetch' },
  ],
  signature: '1:1|1:2',
})

decodePayload(buffer, nodeA) => {
  positions: Float32Array([1, 2, 3]),
  teffLog8: Uint8Array([128]),
  magAbs: Float32Array([4.5]),
  count: 1,
}
```

### 22.2 Provider tests

Test:

```txt
- provider.describe() returns expected capabilities
- provider.getSnapshot() reports dataset/cache/work-item state
- ensureBootstrap() returns bootstrap product
- internal root-shard loading parses provider-produced runtime nodes
- built-in strategies use magnitude-shell traversal, not public max-level/detail controls
- streamPayloads() emits payload/batch then payload/complete
- streamObjectBatches() emits non-cumulative batch data/product-upsert
- fetchObjectBatch() merges progressive products into one product
- errors produce data/product-error
```

### 22.3 Session tests

Test:

```txt
- createSession() returns independent session
- session.updateView(view) accepts view state synchronously and schedules demand planning
- session.deltas() yields product deltas
- session.subscribe() receives same deltas
- repeated updateView() with unchanged demand emits no unnecessary representation changes
- updateView() with changed demand increments demandRevision
- updateView() stores view state
- session.getSnapshot() reports status/products/memory
- deltas maintain the current session representation and are not add-only
- session reaches current status when no fetching, pruning, or recalculation is pending
- interleaved flow: batches arrive, updateView() changes demand, more batches arrive, still-relevant products remain current, irrelevant products emit stale/remove
- session.deltas() stays open across multiple updateView() calls and closes only on dispose or terminal failure
- session.dispose() clears listeners/queue and marks disposed
```

### 22.4 Product shape tests

Test:

```txt
- positions are Float32Array
- teffLog8 is Uint8Array when requested
- magAbs is Float32Array when requested
- omitted attributes are omitted
- node metadata offsets are correct
- memory.bytes equals sum of emitted arrays
- default coordinates are emitted in parsecs
- coordinate transform is applied during decode and reflected in product units
- progressive products contain only newly decoded batch data
- progressive products use unique product ids per emitted batch
```

---

## 23. Acceptance criteria

Sprint 1 is done when:

1. `createStarOctreeProviderService()` exists.
2. It is implemented inside `packages/star-octree-provider` without importing existing SkyKit `src/` services.
3. `ensureBootstrap()` returns a bootstrap product.
4. Root-shard loading is internal and produces provider-owned runtime nodes for traversal.
5. Provider/session code produces runtime nodes by loading and navigating the octree source.
6. `streamObjectBatches({ strategy, view })` progressively emits non-cumulative batch `data/product-upsert` deltas.
7. `fetchObjectBatch({ strategy, view })` returns a merged `StarObjectBatchProduct`.
8. `createSession()` exists.
9. `session.updateView(patch)` stores provider-relevant view state and returns a receipt synchronously.
10. Accepted view updates schedule/reprioritize strategy planning and progressive product deltas.
11. `provider.getSnapshot()` reports cache/work-item/session/stats state.
12. `session.getSnapshot()` reports view/demand/product/memory state.
13. No Three.js object is emitted by the provider.
14. No sidecar metadata is resolved by the star provider.
15. Existing viewer behavior remains unchanged.
16. Existing tests still pass.
17. New tests cover provider, session, product shape, and error handling.
18. Built-in strategies implement magnitude-indexed traversal and expose no public max-level/detail knob.

---

## 24. Example usage

### 24.1 Live viewer session

```js
const provider = createStarOctreeProviderService({
  url: '/data/stars.octree',
});

const session = provider.createSession({
  id: 'main-stars',

  strategy: {
    kind: 'observer-shell',
  },

  coordinates: {
    name: 'render-position',
    units: ['render', 'render', 'render'],
    transformPosition({ xPc, yPc, zPc }) {
      return [xPc * 0.001, yPc * 0.001, zPc * 0.001];
    },
  },
  attributes: ['position', 'teffLog8', 'magAbs'],
  streaming: {
    progressive: true,
    emitCachedFirst: true,
  },
});

session.subscribe((delta) => {
  if (delta.type === 'data/product-upsert') {
    renderer.upsertStarProduct(delta.product);
    return;
  }

  if (delta.type === 'data/product-remove') {
    renderer.removeStarProduct(delta.productId);
    return;
  }

  if (delta.type === 'data/product-stale') {
    renderer.markStarProductStale(delta.productId);
    return;
  }

  if (delta.type === 'data/representation-current') {
    renderer.commitCurrentRepresentation(delta.demandRevision);
  }
});

session.updateView({
  observerPc,
  limitingMagnitude: 6.5,
  motion: {
    speedPcPerSec: 12,
    lookaheadSecs: 3,
  },
});

// Later, as navigation changes. Batches from earlier work may still arrive,
// and the session reconciles them against the current demand revision.
session.updateView({
  observerPc: nextObserverPc,
  limitingMagnitude: 6.5,
  motion: {
    velocityPcPerSec,
    lookaheadSecs: 3,
  },
}, {
  reason: 'navigation/changed',
});
```

### 24.2 Bounded strategy stream

```js
const provider = createStarOctreeProviderService({
  url: '/data/stars.octree',
});

await provider.ensureBootstrap();

for await (const delta of provider.streamObjectBatches({
  strategy: {
    kind: 'observer-shell',
  },
  view: {
    observerPc,
    limitingMagnitude: 6.5,
  },
  coordinates: {
    name: 'render-position',
    units: ['render', 'render', 'render'],
    transformPosition({ xPc, yPc, zPc }) {
      return [xPc * 0.001, yPc * 0.001, zPc * 0.001];
    },
  },

  attributes: ['position', 'teffLog8', 'magAbs'],

  streaming: {
    progressive: true,
    emitCachedFirst: true,
  },
})) {
  if (delta.type === 'data/product-upsert') {
    renderer.upsertStarProduct(delta.product);
  }
}
```

Bounded streams use the same strategy and view language, but they are convenience iterables. They do not replace the live session model for viewers.

---

## 25. Migration path after sprint 1

### Sprint 2: Meta sidecar provider

```txt
MetaSidecarProviderService
  accepts pickMeta or CanonicalObjectRef
  emits FactBatchProduct
```

The alpha sidecar provider boundary exists as a separate package. The remaining migration work is to add its real sidecar octree byte source and compatibility checks against render dataset bootstrap data, using the old `MetaSidecarService` only as reference.

### Sprint 3: StarFieldLayer adapter

Update `StarFieldLayer` to consume `StarObjectBatchProduct` rather than directly owning all fetch/decode steps.

Current:

```txt
StarFieldLayer
  fetch payloads
  decode payloads
  assemble arrays
  create geometry
```

Future:

```txt
StarOctreeProviderSession
  fetch/decode/assemble products

StarFieldLayer or Three adapter
  products → geometry
```

### Sprint 4: Provider maturity and demand policy

The POC-parity provider now includes pure public observer-shell strategy shape,
exact and target/direction-derived `target-frustum` demand, progressive payload
streaming, motion-hinted current-work prioritisation, and live session
reconciliation. The first demand-policy pass adds opt-in strategy-aware
demand-threshold gating before traversal. The next maturity pass should focus on
prefetch policy and budget/debug completeness before adding more API surface:

1. Keep observer-shell semantically pure: magnitude shell demand should not be
   silently truncated by a strategy-level max-level concept.
2. Keep demand-threshold gating as a scheduling policy, not a strategy
   eligibility rule.
3. Extend motion lookahead into prefetch/freshness policy while preserving
   current observer-shell demand.
4. Add explicit budget/debug caps only with truncation metadata and degraded
   completeness.
5. Continue later with fully interleaved traversal/fetch reprioritization and
   cache-aware prefetch.

### Sprint 5: Message bus wrapper

Wrap provider/session deltas into the larger SkyKit bus protocol.

---

## 26. Key design decisions

### Decision 1: Provider service plus provider sessions

Use both.

```txt
provider service = shared source/cache/memory
provider session = one live demand/working set
```

### Decision 2: Navigation goes to session, not provider

Do not push arbitrary app state to the provider service.

Use:

```js
session.updateView(...)
```

not:

```js
provider.updateState(...)
```

### Decision 3: Strategy-driven node demand

The provider package is responsible for loading and navigating the octree file. Applications do not supply runtime nodes. They configure a session strategy and provide state through `updateView()`.

### Decision 4: Products, not renderer objects

Emit:

```txt
StarObjectBatchProduct
```

not:

```txt
THREE.BufferGeometry
```

### Decision 5: Sidecars are separate providers

Do not fold sidecars into the star provider.

### Decision 6: Borrowed buffers for sprint 1

Use direct typed arrays with `ownership: 'borrowed'`.

Add transfer/shared ownership later.

---

## 27. Summary

Sprint 1 should produce a concrete, reusable provider boundary:

```txt
StarOctreeProviderService
  shared source/cache/memory/snapshot

StarOctreeProviderSession
  live node-demand working set and product stream

StarObjectBatchProduct
  typed arrays + node metadata + completeness + memory metadata
```

This gives SkyKit an immediately useful data service while also establishing the architecture needed for the later bus, object layers, sidecars, workers, and renderer adapters.
