# @found-in-space/skykit

## 0.3.0

### Minor Changes

- 0a3c842: Add `createSkyOrbitPlugin()` for pointer drag orbit controls, browser `mouseMode: 'orbit'`, and a temporary Hyades orbit example.
- a65737c: Add runtime product registries and product refs so SkyKit plugins can publish and consume running handles such as shared star sources.
- 28a4e4b: Reset the spatial alpha API to the canonical contract with strict names,
  data-only routes, paths, and transitions, canonical `deltaSecs` and
  `sampleStepSecs`, destination-preserving route endpoints, public aim tracks,
  distinct manual motion models, and route/orbit/aim navigation. Enforce strict
  runtime validation and update SkyKit, SkyKit XR, and star-map-canvas adapters to
  consume the new spatial surface without losing their public compatibility
  shapes. Honor independent navigation cancellation and arrival settle/dwell
  semantics, and prevent stale async SkyKit navigation resolutions from replacing
  newer commands.
- 98b453d: Adopt the stable touch-os 0.3 bridge with canonical frame timing, explicit
  action-output routing, reversible panel lifecycle, safe ownership and pointer
  cancellation, geometric XR ray blocking, and the optional HR embedded-surface
  adapter with aspect-preserving title layout.

### Patch Changes

- 3a3ad08: Make view-driven anchored image art follow the camera orientation when selecting the nearest active image, and support clean dynamic replacement of anchored image sky plugins.
- 3e15faf: Implement lane-aware view and pose transition evaluation with delays, easing, strict timing validation, and shared path-backed sampling. Preserve authored transition lane timing through SkyKit navigation actions.
- 17d32a6: Load STAR v2 terminal-packed octrees, expose serialized node star counts,
  terminal state, and exact subtree-brightest levels, reject mixed STAR/OSHR
  versions, and skip coalesced payloads that cannot contain stars relevant to the
  active magnitude limit. Include the new provider in the SkyKit compatibility
  bundle.
- Updated dependencies [7887a87]
- Updated dependencies [436ea98]
- Updated dependencies [3e15faf]
- Updated dependencies [17d32a6]
- Updated dependencies [28a4e4b]
- Updated dependencies [98b453d]
  - @found-in-space/spatial@0.3.0
  - @found-in-space/star-octree-provider@0.3.0
  - @found-in-space/star-trees@0.2.1
  - @found-in-space/hr-diagram@0.3.0
  - @found-in-space/meta-sidecar-provider@0.2.1
  - @found-in-space/three-star-field@0.2.1

## 0.2.0

### Minor Changes

- 5edeabd: Add RA/Dec look-at helpers and sexagesimal coordinate parsing for HTML and scripted SkyKit look-at targets.

### Patch Changes

- 4204ef8: Resolve RA/Dec distance targets from the solar origin and allow embed observer coordinates to use RA/Dec distance text.
- Updated dependencies [5edeabd]
- Updated dependencies [4204ef8]
  - @found-in-space/spatial@0.2.0
  - @found-in-space/anchored-image@0.2.0
  - @found-in-space/hr-diagram@0.2.0
  - @found-in-space/meta-sidecar-provider@0.2.0
  - @found-in-space/star-octree-provider@0.2.0
  - @found-in-space/star-trees@0.2.0
  - @found-in-space/three-star-field@0.2.0

## 0.2.0-alpha.20260531

### Patch Changes

- 4204ef8: Resolve RA/Dec distance targets from the solar origin and allow embed observer coordinates to use RA/Dec distance text.
- Updated dependencies [4204ef8]
  - @found-in-space/spatial@0.2.0-alpha.20260530

## 0.2.0-alpha.20260530

### Minor Changes

- 5edeabd: Add RA/Dec look-at helpers and sexagesimal coordinate parsing for HTML and scripted SkyKit look-at targets.

### Patch Changes

- Updated dependencies [5edeabd]
  - @found-in-space/spatial@0.2.0-alpha.20260529

## 0.2.0-alpha.20260529

### Patch Changes

- Fail open when browser Cache API storage is unavailable so sandboxed embeds can still start.
- Updated dependencies
  - @found-in-space/star-octree-provider@0.2.0-alpha.1
  - @found-in-space/meta-sidecar-provider@0.2.0-alpha.1

## 0.2.0-alpha.20260528

### Minor Changes

- 12dbb2b: Add the browser add-on/noob plugin layer, lazy first-party constellation capabilities, shared text parsing for startup look-at targets, and default persistent octree caching for browser embeds with an HTML opt-out.

### Patch Changes

- 12dbb2b: Use the released `@found-in-space/touch-os@0.2.0` dependency and optional peer range instead of prerelease dev builds.
- Updated dependencies [12dbb2b]
- Updated dependencies [12dbb2b]
  - @found-in-space/spatial@0.2.0-alpha.20260528
  - @found-in-space/hr-diagram@0.2.0-alpha.1

## 0.2.0-alpha.2

### Minor Changes

- Add beginner viewer and data subpath entries for website use-cases.

## 0.2.0-alpha.1

### Patch Changes

- Add the pasteable browser/embed starter surface with a ready event and focused helper tests.
