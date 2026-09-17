# @found-in-space/star-octree-provider

## 0.3.0

### Minor Changes

- 17d32a6: Load STAR v2 terminal-packed octrees, expose serialized node star counts,
  terminal state, and exact subtree-brightest levels, reject mixed STAR/OSHR
  versions, and skip coalesced payloads that cannot contain stars relevant to the
  active magnitude limit. Include the new provider in the SkyKit compatibility
  bundle.

### Patch Changes

- Updated dependencies [17d32a6]
  - @found-in-space/star-trees@0.2.1

## 0.2.0

### Patch Changes

- @found-in-space/star-trees@0.2.0

## 0.2.0-alpha.1

### Patch Changes

- Fail open when browser Cache API storage is unavailable so sandboxed embeds can still start.
