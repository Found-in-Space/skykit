# @found-in-space/star-map-canvas

## 0.2.1

### Patch Changes

- 28a4e4b: Reset the spatial alpha API to the canonical contract with strict names,
  data-only routes, paths, and transitions, canonical `deltaSecs` and
  `sampleStepSecs`, destination-preserving route endpoints, public aim tracks,
  distinct manual motion models, and route/orbit/aim navigation. Enforce strict
  runtime validation and update SkyKit, SkyKit XR, and star-map-canvas adapters to
  consume the new spatial surface without losing their public compatibility
  shapes. Honor independent navigation cancellation and arrival settle/dwell
  semantics, and prevent stale async SkyKit navigation resolutions from replacing
  newer commands.
- Updated dependencies [7887a87]
- Updated dependencies [436ea98]
- Updated dependencies [3e15faf]
- Updated dependencies [17d32a6]
- Updated dependencies [28a4e4b]
  - @found-in-space/spatial@0.3.0
  - @found-in-space/star-trees@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [5edeabd]
- Updated dependencies [4204ef8]
  - @found-in-space/spatial@0.2.0
  - @found-in-space/star-trees@0.2.0

## 0.2.0-alpha.3

### Patch Changes

- Updated dependencies [4204ef8]
  - @found-in-space/spatial@0.2.0-alpha.20260530

## 0.2.0-alpha.2

### Patch Changes

- Updated dependencies [5edeabd]
  - @found-in-space/spatial@0.2.0-alpha.20260529

## 0.2.0-alpha.1

### Patch Changes

- 12dbb2b: Add the browser add-on/noob plugin layer, lazy first-party constellation capabilities, shared text parsing for startup look-at targets, and default persistent octree caching for browser embeds with an HTML opt-out.
- Updated dependencies [12dbb2b]
  - @found-in-space/spatial@0.2.0-alpha.20260528
