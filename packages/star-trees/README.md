# @found-in-space/star-trees

Status: current alpha package.

Cell-keyed star data types, stores, Morton helpers, shared strategy interfaces,
semantic cell evaluation helpers, and star math helpers for Found in Space
packages.

This package understands `StarCellData`, shared strategy evaluation semantics,
and star-specific interpretation such as magnitude, temperature, object refs,
pick metadata, and sky projections. It does not load octree bytes, plan
provider demand, or own provider sessions.

Strategies are shared, loader-agnostic objects. They decide which semantic
cells matter, assign priority, and report demand changes between view states.
Provider planners consume strategies and own traversal, batching, cache reuse,
fetch, decode, and cell-delta emission. Bundled strategies should use the same
public interface as application strategies; they are not registry names that
planners special-case.

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
