# @found-in-space/skykit

## 0.3.0-alpha.2

### Minor Changes

- 21b8ca7: Add a renderer-independent guided chapter controller with scoped lifecycle,
  latest-wins activation and terminal operation outcomes. SkyKit exposes awaitable
  pose transitions, a browser navigation handle and a journey driver that preserves
  the live view during interruption. A stellar example shares its controller,
  controls and conformance fixture with the Pas de Géant Earth example.

  Add the optional shared sequence player and SkyKit participant: presentation
  seconds, explicit live rejoin, pause/seek/rate controls, separate arrival and
  playback-end outcomes, and final-frame acknowledgement. Deterministic evaluators
  remain domain-owned, with no Studio dependency.

- 8d4f94f: Add optional interaction adapters for TouchOS 0.4: preserve the aggregate star
  picker's angular policy and complete result in shared panel/scene arbitration;
  bridge semantic WebXR selection and grip placement without per-panel input code.
  The interaction subpaths require TouchOS 0.4.0-alpha.0 and pointer-events 6.6.32.
  SkyKit and three-star-field declare the required 0.4 prerelease, so npm cannot
  accept an incompatible 0.3 graph. The HR diagram retains its compatible 0.3
  range and also admits 0.4. Private development roots prepare locked local
  archives, and isolated consumers exercise the published package contracts.

### Patch Changes

- 847b884: Allow the renderer's native XR session-end handler to complete before detaching
  any remaining session. This prevents Three.js session cleanup from reading a
  session that SkyKit has already cleared, while retaining explicit-exit cleanup.
- Updated dependencies [21b8ca7]
- Updated dependencies [8d4f94f]
- Updated dependencies [aa0bfbc]
  - @found-in-space/guided-journey@0.1.0-alpha.1
  - @found-in-space/three-star-field@0.3.0-alpha.2
  - @found-in-space/hr-diagram@0.3.0-alpha.2
  - @found-in-space/star-octree-provider@0.3.0-alpha.1
  - @found-in-space/meta-sidecar-provider@0.2.1-alpha.1

## 0.3.0-alpha.0

### Minor Changes

- 0a3c842: Add `createSkyOrbitPlugin()` for pointer drag orbit controls, browser `mouseMode: 'orbit'`, and a temporary Hyades orbit example.
- a65737c: Add runtime product registries and product refs so SkyKit plugins can publish and consume running handles such as shared star sources.
- e1ce3b5: Make spatial geometry reusable across stellar and Solar System coordinate
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
- ee57e4f: Debounce octree demand refreshes during continuous movement and add per-cell
  custom GPU vertex attributes for diagnostic overlays such as visual-duplicate
  links.

### Patch Changes

- 3a3ad08: Make view-driven anchored image art follow the camera orientation when selecting the nearest active image, and support clean dynamic replacement of anchored image sky plugins.
- Convert spherical preload radii from the declared coordinate units to catalog
  parsecs, matching point and path-volume conversion. Keep warmup inclusion
  equivalent when physical hints are expressed in metres or parsecs.
- 3e15faf: Implement lane-aware view and pose transition evaluation with delays, easing, strict timing validation, and shared path-backed sampling. Preserve authored transition lane timing through SkyKit navigation actions.
- 17d32a6: Load STAR v2 terminal-packed octrees, expose serialized node star counts,
  terminal state, and exact subtree-brightest levels, reject mixed STAR/OSHR
  versions, and skip coalesced payloads that cannot contain stars relevant to the
  active magnitude limit. Include the new provider in the SkyKit compatibility
  bundle.
- Updated dependencies [e1ce3b5]
- Updated dependencies [7887a87]
- Updated dependencies [436ea98]
- Updated dependencies [3e15faf]
- Updated dependencies [17d32a6]
- Updated dependencies [28a4e4b]
- Updated dependencies [98b453d]
- Updated dependencies [ee57e4f]
  - @found-in-space/spatial@0.3.0-alpha.1
  - @found-in-space/star-octree-provider@0.3.0-alpha.0
  - @found-in-space/star-trees@0.2.1-alpha.0
  - @found-in-space/hr-diagram@0.3.0-alpha.0
  - @found-in-space/three-star-field@0.3.0-alpha.0
  - @found-in-space/meta-sidecar-provider@0.2.1-alpha.0

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
