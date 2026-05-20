# @found-in-space/hr-diagram

Reusable alpha HR diagram helpers for Found in Space star cells.

This package consumes `StarCellData` values and `StarCellDelta` lifecycle
events. It does not load octrees or own demand strategies. Observer, frustum,
sphere-volume, path-volume, and motion-lookahead demand should be requested
through `@found-in-space/star-octree-provider`, then applied to the HR
renderer/store.

The package has two rendering paths:

- WebGL/Three.js for high-volume interactive diagrams.
- Canvas 2D for small static teaching views and fallback rendering.

The optional `@found-in-space/hr-diagram/touch-os` subpath publishes the WebGL
renderer as a composite embedded surface, matching the high-performance surface
pattern used by `touch-os`.

For the composed SkyKit example, see
`../skykit/examples/hr-diagram-free-roam/`.
