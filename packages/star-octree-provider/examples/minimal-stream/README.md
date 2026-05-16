# Provider Scratchpad

Small browser quickstart for `@found-in-space/star-octree-provider`.

It demonstrates the shortest useful flow:

- create a provider
- edit observer coordinates and limiting magnitude inside `streamObjectBatches()`
- stream object batches until the current representation is complete
- inspect the returned `StarObjectBatchProduct` records

Provider strategy semantics are documented in
[`../../../../docs/star-octree-provider.md`](../../../../docs/star-octree-provider.md);
this example keeps to direct provider usage.

By convention this example should stay package-owned and should not import old
root `src/` octree, layer, viewer, or demo modules.
