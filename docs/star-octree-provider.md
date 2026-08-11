# Star Octree Provider

Status: current alpha package contract for
`@found-in-space/star-octree-provider`.

The provider owns octree loading, traversal, demand planning, range fetching,
payload decode, cache warming, and cell-delta emission. Strategies are a shared
semantic contract consumed by loaders and planners. Viewers, renderers,
sidecars, controls, lessons, and journeys live in separate packages.

The loader accepts STAR v1 and v2 artifacts and requires every OSHR shard to
match the top-level STAR version. V2's 24-byte node records add a serialized
payload star count and may mark a payload-bearing leaf as terminal. Terminal
nodes need no special strategy behavior: they preserve logical cell identity,
carry the collapsed subtree payload, and naturally stop traversal because they
have no children.

## Core Contract

The public star streaming model is cell-keyed:

```txt
cell = { level, mortonCode }
cellKey = `${level}:${mortonCode}`
star ref = datasetId + level + mortonCode + ordinal
```

`level` and `mortonCode` are the semantic octree cell identity. Storage details
such as `nodeKey`, `nodeIndex`, `shardOffset`, `payloadOffset`, and
`payloadLength` are provider internals and must not appear in public bookmarks,
renderer IDs, sidecar IDs, examples, or app save data.

Payload-range batching may group network and decode work internally. Decoded
output is always split back into independent `StarCellData` records before it
reaches a provider session, renderer, or store.

## Public Deltas

Provider sessions and streams emit `StarCellDelta` values:

```ts
type StarCellDelta =
  | {
      type: 'stars/cells-upsert';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cells: StarCellData[];
    }
  | {
      type: 'stars/cells-remove';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cellKeys: StarCellKey[];
      reason?: string;
    }
  | {
      type: 'stars/current';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cellKeys: StarCellKey[];
      starCount: number;
    }
  | {
      type: 'stars/error';
      providerId: string;
      sessionId?: string;
      demandRevision?: number;
      error: { message: string; code?: string };
    };
```

`stars/error` reports planning, fetch, or decode failure without clearing
existing visible cells.

## Service API

```ts
interface StarOctreeProviderService {
  readonly id: string;
  describe(): StarOctreeProviderDescriptor;
  getSnapshot(): StarOctreeProviderSnapshot;
  ensureBootstrap(): Promise<StarOctreeBootstrapIndex>;
  createSession(options?: StarOctreeSessionOptions): StarOctreeProviderSession;
  streamPayloads(options: StarOctreePayloadStreamOptions): AsyncIterable<StarOctreePayloadDelta>;
  streamCells(options: StarOctreeCellStreamOptions): AsyncIterable<StarCellDelta>;
  inspectDemand(options: StarOctreeCellStreamOptions): Promise<StarOctreeDemandInspection>;
  fetchCells(options: StarOctreeCellStreamOptions): Promise<StarCellData[]>;
  warmCells(options: StarOctreeCellStreamOptions): Promise<StarOctreeWarmCellsResult>;
  dispose(): void | Promise<void>;
}
```

`ensureBootstrap()` and `streamPayloads()` are diagnostic/lower-level surfaces.
Most consumers should use `streamCells()`, `fetchCells()`, `warmCells()`, or a
session.

`fetchCells()` is a convenience helper for finite requests. It consumes the cell
stream and returns the decoded cells once the demand is current.

`warmCells()` plans the same strategy request in the prefetch scheduler lane and
warms index shards, payload bytes, and decoded payload caches without emitting
visible cell deltas.

## Sessions

A provider session is one live demand state and one cell-delta stream.

```ts
interface StarOctreeProviderSession {
  readonly id: string;
  updateView(view: StarOctreeViewPatch, options?: ViewUpdateOptions): StarOctreeViewReceipt;
  subscribe(listener: (delta: StarCellDelta) => void): () => void;
  deltas(): AsyncIterable<StarCellDelta>;
  getSnapshot(): StarOctreeSessionSnapshot;
  dispose(): void | Promise<void>;
}
```

The session owns `liveCellsByKey`. On demand replacement it computes:

```txt
retain = live ∩ next
load = next - live
deferRemove = live - next
```

For old demand `A + B` and new demand `B + C`, `B` is retained, only `C` loads,
and `A` is removed after `C` has arrived. A live session must never contain two
records with the same `cellKey`.

Superseded demand revisions abort outstanding fetch/decode work. Late obsolete
work is not merely ignored; it receives abort cancellation so decode and range
fetches stop promptly.

## Streaming Performance Invariants

The cell-keyed model replaced the old transport-batch public identity. Payload
range batching may still group network and decode work internally, but public
sessions, stores, renderers, and examples only see independent `StarCellData`
records keyed by `cellKey`.

Keep these invariants when changing the provider, store, or renderer:

- retained `cellKey` entries do not churn across adjacent demands.
- no live store contains duplicate `cellKey` records.
- superseded fetch/decode work receives `AbortSignal` cancellation.
- no `stars/cells-upsert` is emitted for an obsolete demand revision.
- `stars/error` does not clear visible cells.
- renderer object identity remains stable while geometry contents update.

Payload decode is attribute-aware. Positions are always decoded; optional
numeric columns such as `teffLog8` and `magAbs` are decoded only when requested
by the active stream/session/fetch attributes. Object refs and pick metadata are
generated when the emitted cell asks for `objectRef` or `pickMeta`; they are not
payload decode work.

The default same-thread fast path uses borrowed typed-array memory when the
cell is created without a coordinate transform and with borrowed ownership.
Borrowed decoded buffers must be treated as immutable after emission.

`SharedArrayBuffer` is not part of the current streaming path. A future
decode-worker design may revisit it, but that requires browser cross-origin
isolation and render-path validation for WebGL uploads.

## Strategies And Planners

Strategies decide which semantic cells matter for a view. A strategy evaluates
semantic cell geometry, assigns priority, and reports how its demand changes as
the view changes. It does not fetch byte ranges, decode payloads, build render
data, merge cells, or own application logic.

Planners are loader/provider internals. A planner consumes a strategy,
materializes prioritized demand for a concrete storage format, and owns
traversal, batching, cache reuse, byte-range fetches, decode, retention, and
cell-delta emission. Planners may optimize tied or equivalent-priority cells
for batching, cache locality, and transport cost, but they must not require core
changes for application strategies and must not switch on a closed list of
strategy names.

The public strategy contract is object/function based. Bundled strategies such
as observer-shell visibility, target-frustum visibility, sphere/path volume
selection, lookahead warming, warm-decorated strategies, and composition are
ordinary strategy implementations. Custom strategies are first-class strategy
objects, not registry entries or new provider enum cases.

The alpha implementation follows this open strategy contract in `star-trees`,
`star-octree-provider`, and SkyKit composition. Provider planning code should
remain guarded against closed `strategy.kind` dispatch as additional strategies
are added.

Interface sketch:

```ts
interface StarCellStrategy<TView = StarViewState> {
  createAnchor(view: TView): StarStrategyAnchor;
  createEvaluator(anchor: StarStrategyAnchor): StarCellEvaluator;
  diff(
    previous: StarStrategyAnchor | null,
    next: StarStrategyAnchor,
    context: StarStrategyDiffContext
  ): StarStrategyChange;
}

interface StarCellEvaluator {
  evaluateCell(cell: StarCellGeometry): StarCellDecision;
}

interface StarCellPriority {
  lane: 'live' | 'warm' | string;
  band: number;
  score?: number;
}

interface StarCellDecision {
  include: boolean;
  descend?: boolean;
  emit?: boolean;
  priority: StarCellPriority;
  contributors?: StrategyContribution[];
  reasons?: string[];
  metadata?: Record<string, unknown>;
}

type StarStrategyChange =
  | { kind: 'none' }
  | {
      kind: 'priority-only';
      regions?: CellRegion[];
      priorityFloor?: StarCellPriority;
    }
  | {
      kind: 'tail-changed';
      regions?: CellRegion[];
      belowPriority: StarCellPriority;
    }
  | {
      kind: 'regions-changed';
      regions: CellRegion[];
      priorityFloor?: StarCellPriority;
    }
  | { kind: 'reset'; reason: string };
```

`StarCellGeometry` is semantic geometry only: cell key, level, Morton code,
center parsecs, half-size parsecs, and logical grid coordinates. Strategy-visible
cells must not expose storage fields such as `payloadOffset`, `payloadLength`,
`nodeIndex`, `shardOffset`, byte ranges, or loader-specific node keys.

Priority is a partial order. Cells may draw/tie in priority, and the planner may
load tied cells in whichever order is most efficient for batching, cache reuse,
or traversal locality. `live` demand always outranks `warm` demand. Warm cells
may prefetch or prewarm caches, but they must not remove, stale, or replace live
cells. If a warm cell later becomes live, the planner should reuse it.

Strategies must support incremental planning. They create stable anchors for
view states and report changes between anchors so planners can re-evaluate
affected regions, priority bands, or tail ranges instead of rebuilding the full
priority list every animation tick. Low-priority faint-cell churn is expected;
it must not force high-priority live cells to churn.

`combineStrategies()` returns an ordinary strategy. A combined cell takes the
best semantic priority from its contributors, keeps contributor metadata, and
still presents the same interface to the planner. Composition is not a
privileged planner mode.

`createWarmStrategy(base)` also returns an ordinary strategy. It delegates
selection to `base`, evaluates it with prefetch role context, and rewrites
included demand into the `warm` lane. Applications can warm built-in or custom
strategies, including app-owned shapes such as StarPilot's pizza slice, without
adding provider cases.

Preload, prewarm, and lookahead are lower-priority strategy demand, not a
separate loading subsystem. A forward-lookahead strategy may evaluate a base
strategy against predicted view states, optionally skipping a near-future
blackout period to account for roundtrip and decode delay, then emit those cells
in the `warm` lane. Lookahead scoring favors cells that appear in more predicted
samples, which biases fast movement toward cells likely to remain useful over
one-frame churn.

Observer-shell selection should match the direct magnitude-shell heuristic:

```txt
loadRadiusPc = halfSizePc * 10 ** ((limitingMagnitude - indexMagnitude) / 5)
```

Do not add broad fixed padding to compensate for streaming churn. Refresh
throttling should be expressed through strategy change/diff policy, such as
magnitude-banded shell cadence or low-priority tail invalidation, not by
weakening cell identity.

## Coordinates And Identity

Cell helpers live in `@found-in-space/star-trees`:

```ts
createStarCellKey({ level, mortonCode });
parseStarCellKey(cellKey);
encodeMorton3D(x, y, z, level);
decodeMorton3D(mortonCode, level);
```

Star references use the same Morton identity plus dataset and ordinal:

```txt
datasetId + level + mortonCode + ordinal
```

The `cellKey` string and `{ level, mortonCode }` object are two representations
of the same semantic cell and round-trip through the shared helpers.

## Package Boundaries

The provider emits decoded star cells. It does not own:

- Three.js/WebGL rendering
- Canvas rendering
- SkyKit viewer controls
- journey/chapter behavior
- sidecar metadata lookup
- persistent app IDs outside the semantic star identity

It also does not own static reference or scenario stars. Those belong to
separate provider lanes composed by applications or SkyKit. See the accepted
[multiple-provider direction](./multiple-star-providers.md).

`@found-in-space/star-trees` owns star cell data shapes, stores, Morton
helpers, object refs, pick metadata, and star math helpers.

`@found-in-space/three-star-field`, `@found-in-space/star-map-canvas`, and
`@found-in-space/hr-diagram` consume cell stores or cell deltas and render their
own views.

## Examples

```js
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';

const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });

for await (const delta of provider.streamCells({
  strategy: createObserverShellStrategy(),
  view: {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  },
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
})) {
  if (delta.type === 'stars/cells-upsert') {
    for (const cell of delta.cells) {
      console.log(cell.cellKey, cell.count);
    }
  }
}
```

For finite volume requests:

```js
import { streamVolumeCells } from '@found-in-space/star-octree-provider';

for await (const delta of streamVolumeCells(provider, {
  centerPc: { x: 0, y: 0, z: 0 },
  radiusPc: 25,
  attributes: ['position', 'magAbs'],
})) {
  if (delta.type === 'stars/cells-upsert') {
    consumeCells(delta.cells);
  }
}
```

For retained live views:

```js
const session = provider.createSession({
  strategy: createObserverShellStrategy(),
  attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
});

const unsubscribe = session.subscribe((delta) => {
  starField.apply(delta);
});

await session.updateView({
  observerPc: { x: 0, y: 0, z: 0 },
  limitingMagnitude: 6.5,
});
```

## Implementation Status

Implemented:

- semantic cell-keyed public star streaming
- session-level live cell retention
- deferred removal after replacement load
- abort cancellation for superseded demand revisions
- internal range batching split back into cell records
- persistent source/cache reuse across sessions
- current bundled observer-shell, frustum, sphere, path, lookahead, warm
  decorator, and composition helpers
- provider-level `warmCells()` for prefetch-lane index, payload, and decoded
  cache warming without visible cell emission

Diagnostics to preserve:

- demand revisions queued, aborted, loaded, and made current
- cells and stars inserted/removed per second
- current live cell count and star count
- duplicate live cell keys, which should always be zero
- largest single cell and largest aggregate rebuild size
- decoded-cache hits, misses, and writes by attribute mask
- copied versus borrowed cell bytes
- generated object refs and pick metadata counts

Non-goals:

- compatibility shims for the old star batch streaming API
- public render identity based on transport batch shape
- renderer-specific data ownership inside the provider
