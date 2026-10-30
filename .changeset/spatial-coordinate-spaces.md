---
"@found-in-space/spatial": minor
"@found-in-space/skykit": minor
"@found-in-space/star-map-canvas": patch
---

Make spatial geometry reusable across stellar and Solar System coordinate
systems with explicit frame/unit contexts, contextual poses and rates, separate
presentation scale, and dependency-free anchored transforms. Split the package
implementation without adding public subpaths or runtime dependencies. Preserve
route, path, timing, motion and independent aim/navigation behavior while fixing
small-interval numerical tolerances and mixed-space validation.

Update SkyKit navigation, preload and XR adapters to the new contract while
retaining parsec-based public star/view APIs. XR tracking poses and rays declare
their reference space. Ship a distinct 0.3.0-alpha.0 source package for packed
consumer validation; published 0.2.0 runtimes must retain their compatible
spatial dependency until the coordinated release. Update star-map-canvas's
spatial dependency with the compatible batch.
