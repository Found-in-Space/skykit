# @found-in-space/star-octree-provider

Alpha package for the clean Star Octree Provider rewrite.

This package is intentionally separate from the existing proof-of-concept SkyKit
source tree. The alpha implementation should be built into this package first,
tested thoroughly, and only then should old code be removed.

## Examples

- `examples/minimal-stream/` is a small browser quickstart that creates a
  provider, streams until the current representation is complete, and inspects
  the product shape.
- `examples/nearest-visible/` shows a browser page that creates an
  `observer-shell` provider session, streams object-batch deltas, and keeps a
  nearest-visible table as application-owned logic.
