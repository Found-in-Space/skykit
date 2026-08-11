# @found-in-space/star-octree-provider

Status: current alpha package.

Alpha package for the clean Star Octree Provider rewrite.

This package is intentionally self-contained. Octree loading, traversal,
planning, payload decode, and star cell emission live here; viewers, renderers,
sidecars, controls, and examples live in separate packages.

Do not add viewer, renderer, UI, sidecar, kinematics, or ephemeris behavior to
this package. Those belong in separate `@found-in-space/*` packages that compose
with emitted star cells.

The provider consumes the shared strategy contract and owns the octree-specific
planner. Strategies decide which semantic cells matter, their priority, and how
demand changes between view states; the provider planner/scheduler owns
materialization, payload batching, cache warming, decode, and cell emission.
Bundled strategy helpers are ordinary implementations of the same public
strategy interface as application strategies.

Both STAR v1 and STAR v2 render octrees are supported. V2 terminal-packed nodes
are exposed through the existing logical-cell stream; runtime traversal nodes
also report `starCount` and `isTerminal` for diagnostics. V1 nodes report
`starCount: null` and `isTerminal: false`. V2 payload decode verifies the
serialized count against the decompressed 16-byte record count.

See [`../../docs/star-octree-provider.md`](../../docs/star-octree-provider.md)
for the package contract, strategy/planner/scheduler semantics, and API
semantics.

## Examples

The package exports `OCTREE_c56103` for the current public Gaia-derived octree
and `OCTREE_DEFAULT` as the teaching-friendly alias used by examples.

- `examples/volume-query/` shows sphere-volume streaming through the same
  provider strategy surface as observer-shell and target-frustum.

Common entry points:

- `createStarOctreeProviderService({ url })` for URL-backed range loading.
- `createStarOctreeFileProviderService({ file })` for Blob/File-backed loading.
- `provider.streamCells(request)` for finite async-iterable cell deltas.
- `provider.fetchCells(request)` for finite decoded cells.
- `provider.warmCells(request)` for prefetch-lane cache warming without visible
  cell deltas.
- `provider.createSession(options)` for retained live views with
  `session.updateView(view)`.
