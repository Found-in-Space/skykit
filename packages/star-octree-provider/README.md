# @found-in-space/star-octree-provider

Status: current alpha package.

Alpha package for the clean Star Octree Provider rewrite.

This package is intentionally separate from the existing proof-of-concept SkyKit
source tree. The alpha implementation should be built into this package first,
tested thoroughly, and only then should old code be removed.

Do not add viewer, renderer, UI, sidecar, kinematics, or ephemeris behavior to
this package. Those belong in separate `@found-in-space/*` packages that compose
with emitted star products.

See [`../../docs/star-octree-provider.md`](../../docs/star-octree-provider.md)
for the package contract, API semantics, and current implementation status.

## Examples

- `examples/minimal-stream/` is a small browser scratchpad that creates a
  provider, lets learners edit observer coordinates and magnitude inside
  `streamObjectBatches()`, streams until the current representation is complete,
  and inspects the product shape.
- `examples/nearest-visible/` shows a browser page that creates an
  `observer-shell` provider session, streams object-batch deltas, and keeps a
  nearest-visible table as application-owned logic.
