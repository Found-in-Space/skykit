# @found-in-space/star-products

Status: current alpha package.

Star product types, stores, and math helpers for Found in Space packages.

This package understands `StarObjectBatchProduct` and star-specific
interpretation such as magnitude, temperature, object refs, pick metadata, and
sky projections. It does not load octree bytes or own provider sessions.

## Public Star Identity

Stars are identified by `CanonicalObjectRef`:

```txt
datasetId + level + mortonCode + ordinal
```

Cells are identified by `level + mortonCode`; use `createStarCellKey()` when a
map key or diagnostic string is needed. `mortonCode` is the logical Morton cell
address for the dataset geometry, not an octree-file node-table key.

Do not use storage details such as `nodeKey`, `shardOffset`, `nodeIndex`,
`payloadOffset`, or `payloadLength` in products, bookmarks, sidecar lookups,
renderer selections, examples, or app/game save data. Those fields belong only
inside provider loader/planner/cache code.

`StarPickMeta` carries the same logical cell plus ordinal and extra geometry for
selection/proximity helpers. It is not a separate ID system.
