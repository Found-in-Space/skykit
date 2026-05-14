# Minimal Stream

Small browser quickstart for `@found-in-space/star-octree-provider`.

It demonstrates the shortest useful flow:

- create a provider
- stream object batches until the current representation is complete
- inspect the returned `StarObjectBatchProduct` records

By convention this example should stay package-owned and should not import old
root `src/` octree, layer, viewer, or demo modules.
