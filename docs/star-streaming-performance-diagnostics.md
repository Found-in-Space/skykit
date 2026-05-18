# Star Streaming Performance Diagnostics

## Purpose

This document records the performance issue that triggered the cell-keyed star
streaming rewrite, and the invariants the new implementation must preserve.

The original symptoms were visible in fast-moving SkyKit viewers:

- stars were slow to appear after large observer changes
- motion became jerky while the observer moved quickly
- stars could appear doubled during demand replacement
- renderer buffer churn was higher than expected

The root design issue was that public streaming identity was tied to transport
batches. A single decoded batch could contain multiple octree cells, so retaining
one cell while dropping another required batch-level remove/upsert work. During
fast movement this created windows where retained cells were removed and re-added,
or existed twice in overlapping batches.

## Current Model

The star stack is now keyed by one semantic identity:

```txt
cell = { level, mortonCode }
cellKey = `${level}:${mortonCode}`
star ref = datasetId + level + mortonCode + ordinal
```

Payload-range batching still exists inside the provider for network and decode
efficiency, but the session, renderer, stores, examples, and public deltas only
see independent `StarCellData` records.

Public star deltas are:

```txt
stars/cells-upsert
stars/cells-remove
stars/current
stars/error
```

There are no public batch lifecycle deltas in the streaming stack.

## Session Replacement Invariant

For an old live set `A + B` and a new demand set `B + C`:

- `B` stays live
- only `C` loads
- `A` is removed after `C` has loaded
- no live store contains duplicate `cellKey` records

The provider session owns `liveCellsByKey`. On every demand revision it computes:

```txt
retain = live ∩ next
load = next - live
deferRemove = live - next
```

Superseded demand revisions abort outstanding fetch/decode work through
`AbortController`. It is not enough to ignore late deltas; obsolete work must be
cancelled so it cannot waste decode time or emit stale cells.

`stars/error` reports planning/loading failures without deleting existing visible
cells.

## Renderer Invariant

`three-star-field` keeps a `Map<cellKey, StarCellData>` and derives one aggregate
geometry from current cells in deterministic `cellKey` order.

Upserts and removes mutate that cell store, then rebuild/coalesce the aggregate
arrays. The Three object itself is stable. Retained cells are not removed and
re-added because a payload batch changed shape.

## Diagnostics To Keep

When investigating streaming performance, prefer cell-level metrics:

- demand revisions queued, aborted, loaded, and made current
- cells loaded per second
- cells removed per second
- stars inserted per second
- stars removed per second
- current live cell count
- current live star count
- duplicate live cell keys, which should always be zero
- largest single cell and largest aggregate rebuild size

Useful checks during rapid motion:

- superseded fetch/decode work receives `AbortSignal` cancellation
- no `stars/cells-upsert` is emitted for an obsolete demand revision
- `stars/error` does not clear visible cells
- renderer object identity remains stable while geometry contents update
- retained `cellKey` entries do not churn across adjacent demands

## Observer-Shell Note

Observer-shell selection should match the original direct SkyKit magnitude-shell
heuristic:

```txt
loadRadiusPc = halfSizePc * 10 ** ((limitingMagnitude - indexMagnitude) / 5)
```

Do not add broad fixed padding to compensate for streaming churn. Future refresh
throttling should be expressed as demand policy such as magnitude-banded shell
cadence, not by weakening cell identity.
