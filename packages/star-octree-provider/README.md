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

See [`../../docs/star-octree-provider.md`](../../docs/star-octree-provider.md)
for the package contract, strategy/planner/scheduler semantics, and API
semantics.

## Examples

The package exports `OCTREE_c56103` for the current public Gaia-derived octree
and `OCTREE_DEFAULT` as the teaching-friendly alias used by examples.

- `examples/nearest-visible/` shows a browser page that creates an
  `observer-shell` provider session, streams cell deltas, and keeps a
  nearest-visible table as application-owned logic.
- `examples/canvas-star-map/` shows the alpha package ladder from provider
  session to star-trees cell store to `@found-in-space/star-map-canvas`.
- `examples/volume-query/` shows sphere-volume streaming through the same
  provider strategy surface as observer-shell and target-frustum.
- `examples/strategy-diagnostics/` uses `inspectDemand()` and `streamPayloads()`
  to compare strategy demand with actual payload fetching.
- `examples/shared-session/` shows one provider backing two independent
  consumers while sharing source/cache state.
