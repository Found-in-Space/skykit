# @found-in-space/star-octree-provider

Status: current alpha package.

Alpha package for the clean Star Octree Provider rewrite.

This package is intentionally separate from the existing proof-of-concept SkyKit
source tree. The alpha implementation should be built into this package first,
tested thoroughly, and only then should old code be removed.

Do not add viewer, renderer, UI, sidecar, kinematics, or ephemeris behavior to
this package. Those belong in separate `@found-in-space/*` packages that compose
with emitted star products.

The provider is also the single home for star-octree demand strategies. Built-in
strategy helpers include observer-shell visibility, target-frustum visibility,
sphere/path volume selection, explicit motion-lookahead cache warming, custom
strategies, and union composition. Strategies decide which octree nodes matter;
the provider planner/scheduler still owns payload batching, cache warming,
decode, and product emission.

See [`../../docs/star-octree-provider.md`](../../docs/star-octree-provider.md)
for the package contract, strategy/planner/scheduler semantics, API semantics,
and current implementation status.

## Examples

- `examples/minimal-stream/` is a small browser scratchpad that creates a
  provider, lets learners edit observer coordinates and magnitude inside
  `streamObjectBatches()`, streams until the current representation is complete,
  and inspects the product shape.
- `examples/nearest-visible/` shows a browser page that creates an
  `observer-shell` provider session, streams object-batch deltas, and keeps a
  nearest-visible table as application-owned logic.
- `examples/canvas-star-map/` shows the alpha package ladder from provider
  session to star-products store to `@found-in-space/star-map-canvas`.
- `examples/volume-query/` shows sphere-volume streaming through the same
  provider strategy surface as observer-shell and target-frustum.
