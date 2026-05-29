# @found-in-space/star-trees

Status: current alpha package.

Cell-keyed star data types, stores, Morton helpers, shared strategy interfaces,
semantic cell evaluation helpers, and star math helpers for Found in Space
packages.

This package understands `StarCellData`, shared strategy evaluation semantics,
and star-specific interpretation such as magnitude, temperature, object refs,
pick metadata, and sky projections. It does not load octree bytes, plan
provider demand, or own provider sessions.

It also provides the canonical in-memory cell store:

```js
import {
  consumeStarCellDeltas,
  createStarCellStore,
} from '@found-in-space/star-trees';

const store = createStarCellStore();
void consumeStarCellDeltas(session.deltas(), store, {
  throwOnError: false,
});

for (const row of store.stars()) {
  console.log(row.cellKey, row.objectIndex, row.objectRef);
}
```

Strategies are shared, loader-agnostic objects. They decide which semantic
cells matter, assign priority, and report demand changes between view states.
Provider planners consume strategies and own traversal, batching, cache reuse,
fetch, decode, and cell-delta emission. Bundled strategies should use the same
public interface as application strategies; they are not registry names that
planners special-case.

Bundled strategy helpers include observer-shell visibility, target-frustum
visibility, sphere/path volume selection, lookahead, warm-lane decoration, and
strategy composition. Custom strategies implement the same `StarCellStrategy`
interface.

## Public Star Identity

Stars are identified by `StarObjectRef`:

```txt
datasetId + level + mortonCode + ordinal
```

Cells are identified by `level + mortonCode`; use `createStarCellKey()` when a
map key or diagnostic string is needed:

```txt
cellKey = `${level}:${mortonCode}`
```

`mortonCode` is the logical Morton cell address for the dataset geometry, not an
octree-file node-table key.

Do not use storage details such as `nodeKey`, `shardOffset`, `nodeIndex`,
`payloadOffset`, or `payloadLength` in cells, bookmarks, sidecar lookups,
renderer selections, examples, or app/game save data. Those fields belong only
inside provider loader/planner/cache code.

`StarPickMeta` carries the same logical cell plus ordinal and extra geometry for
selection/proximity helpers. It is not a separate ID system.
