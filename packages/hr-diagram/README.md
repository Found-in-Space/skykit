# @found-in-space/hr-diagram

Reusable alpha HR diagram helpers for Found in Space star products.

The package has two rendering paths:

- WebGL/Three.js for high-volume interactive diagrams.
- Canvas 2D for small static teaching views and fallback rendering.

The optional `@found-in-space/hr-diagram/touch-os` subpath publishes the WebGL
renderer as a composite embedded surface, matching the high-performance surface
pattern used by `touch-os`.

