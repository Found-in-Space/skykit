# Star Octree Provider

Status: current alpha package contract for
`@found-in-space/star-octree-provider`.

The provider owns octree loading, traversal, demand strategies, range fetching,
payload decode, cache warming, and cell-delta emission. Viewers, renderers,
sidecars, controls, lessons, and journeys live in separate packages.

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
  ensureBootstrap(): Promise<StarOctreeBootstrapIndex>;
  inspectDemand(request: StarOctreeDemandRequest): Promise<StarOctreeDemandReceipt>;
  streamPayloads(request: StarOctreeDemandRequest): AsyncIterable<StarOctreePayloadEvent>;
  streamCells(request: StarOctreeCellStreamRequest): AsyncIterable<StarCellDelta>;
  fetchCells(request: StarOctreeCellStreamRequest): Promise<StarCellData[]>;
  createSession(options: StarOctreeProviderSessionOptions): StarOctreeProviderSession;
  snapshot(): StarOctreeProviderSnapshot;
  dispose(): void;
}
```

`ensureBootstrap()` and `streamPayloads()` are diagnostic/lower-level surfaces.
Most consumers should use `streamCells()`, `fetchCells()`, or a session.

`fetchCells()` is a convenience helper for finite requests. It consumes the cell
stream and returns the decoded cells once the demand is current.

## Sessions

A provider session is one live demand state and one cell-delta stream.

```ts
interface StarOctreeProviderSession {
  readonly id: string;
  updateView(view: StarOctreeViewRequest, options?: { force?: boolean }): Promise<StarOctreeDemandReceipt>;
  subscribe(listener: (delta: StarCellDelta) => void): () => void;
  deltas(): AsyncIterable<StarCellDelta>;
  snapshot(): StarOctreeProviderSessionSnapshot;
  dispose(): void;
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

## Strategies

Strategies decide which semantic octree cells matter. They do not fetch byte
ranges, decode payloads, build render data, merge cells, or own application
logic.

Built-in strategies include:

- observer-shell visibility
- target-frustum visibility
- sphere-volume selection
- path-volume selection
- explicit motion-lookahead cache warming
- custom strategies
- union composition

`current` demand entries emit cells. `prefetch` entries warm caches only and must
not remove, stale, or replace current cells.

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
- observer-shell, frustum, sphere, path, lookahead, custom, and union strategies

Non-goals:

- compatibility shims for the old star batch streaming API
- public render identity based on transport batch shape
- renderer-specific data ownership inside the provider
