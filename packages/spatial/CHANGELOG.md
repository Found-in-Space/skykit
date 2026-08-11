# @found-in-space/spatial

## 0.3.0

### Minor Changes

- 7887a87: Implement physical route timing profiles for orbital inserts and route
  evaluation, including acceleration/deceleration phases, duration constraint
  diagnostics, custom and derived phase-integral validation, distance-safe timing
  profile reuse, orbit-aware curved transfer geometry, and handedness-compatible
  tangent orbital insertion when no arrival angle is authored.
- 3e15faf: Implement lane-aware view and pose transition evaluation with delays, easing, strict timing validation, and shared path-backed sampling. Preserve authored transition lane timing through SkyKit navigation actions.
- 28a4e4b: Reset the spatial alpha API to the canonical contract with strict names,
  data-only routes, paths, and transitions, canonical `deltaSecs` and
  `sampleStepSecs`, destination-preserving route endpoints, public aim tracks,
  distinct manual motion models, and route/orbit/aim navigation. Enforce strict
  runtime validation and update SkyKit, SkyKit XR, and star-map-canvas adapters to
  consume the new spatial surface without losing their public compatibility
  shapes. Honor independent navigation cancellation and arrival settle/dwell
  semantics, and prevent stale async SkyKit navigation resolutions from replacing
  newer commands.

### Patch Changes

- 436ea98: Implement canonical path and aim interpolation behavior.

## 0.2.0

### Minor Changes

- 5edeabd: Add RA/Dec look-at helpers and sexagesimal coordinate parsing for HTML and scripted SkyKit look-at targets.

### Patch Changes

- 4204ef8: Resolve RA/Dec distance targets from the solar origin and allow embed observer coordinates to use RA/Dec distance text.

## 0.2.0-alpha.20260530

### Patch Changes

- 4204ef8: Resolve RA/Dec distance targets from the solar origin and allow embed observer coordinates to use RA/Dec distance text.

## 0.2.0-alpha.20260529

### Minor Changes

- 5edeabd: Add RA/Dec look-at helpers and sexagesimal coordinate parsing for HTML and scripted SkyKit look-at targets.

## 0.2.0-alpha.20260528

### Minor Changes

- 12dbb2b: Add the browser add-on/noob plugin layer, lazy first-party constellation capabilities, shared text parsing for startup look-at targets, and default persistent octree caching for browser embeds with an HTML opt-out.
