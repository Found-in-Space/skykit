# Nearest Visible Stream

Package-owned browser example for `@found-in-space/star-octree-provider`.

The example keeps the boundary deliberately simple:

- SkyKit creates the provider/session query.
- SkyKit streams object-batch deltas.
- The page owns nearest-star calculation, sorting, and table rendering.

Provider strategy semantics are documented in
[`../../../../docs/star-octree-provider.md`](../../../../docs/star-octree-provider.md);
this example only demonstrates one `observer-shell` session.

By convention this example should import only the provider package source and
files in this example directory. It should not import old root `src/` octree,
layer, viewer, or demo modules.
