# Canvas Star Map

Package-owned browser example for the first 2D star-map adapter path.

The example keeps the boundary deliberately simple:

- `@found-in-space/star-octree-provider` creates the provider/session query.
- `@found-in-space/star-products` keeps the coherent current star set.
- `@found-in-space/star-map-canvas` renders the current store into Canvas2D.

It should not import old root `src/` octree, viewer, layer, or demo modules.
