# Meta Sidecar Provider

Status: current alpha package boundary.

Alpha metadata sidecar provider boundary for Found in Space datasets.

This package is intentionally separate from `@found-in-space/star-octree-provider`.
It consumes canonical object references or pick metadata emitted by star cells
and resolves sidecar-backed facts without adding label lookup behavior to the star
provider itself.

Sidecar inputs use the public star identity:

```txt
datasetId + level + mortonCode + ordinal
```

Cell-level sidecar indexes should key by `createStarCellKey(ref)` and then use
`ordinal` within that cell. They must not depend on octree storage fields such
as `nodeKey`, `shardOffset`, `nodeIndex`, `payloadOffset`, or `payloadLength`.
