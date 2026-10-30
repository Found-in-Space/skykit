# @found-in-space/three-star-field

## 0.3.0-alpha.2

### Minor Changes

- 8d4f94f: Add optional interaction adapters for TouchOS 0.4: preserve the aggregate star
  picker's angular policy and complete result in shared panel/scene arbitration;
  bridge semantic WebXR selection and grip placement without per-panel input code.
  The interaction subpaths require TouchOS 0.4.0-alpha.0 and pointer-events 6.6.32.
  SkyKit and three-star-field declare the required 0.4 prerelease, so npm cannot
  accept an incompatible 0.3 graph. The HR diagram retains its compatible 0.3
  range and also admits 0.4. Private development roots prepare locked local
  archives, and isolated consumers exercise the published package contracts.

## 0.3.0-alpha.0

### Minor Changes

- ee57e4f: Debounce octree demand refreshes during continuous movement and add per-cell
  custom GPU vertex attributes for diagnostic overlays such as visual-duplicate
  links.

### Patch Changes

- Updated dependencies [17d32a6]
  - @found-in-space/star-trees@0.2.1-alpha.0

## 0.2.0

### Patch Changes

- @found-in-space/star-trees@0.2.0
