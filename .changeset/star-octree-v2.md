---
'@found-in-space/star-octree-provider': minor
'@found-in-space/star-trees': patch
'@found-in-space/skykit': patch
---

Load STAR v2 terminal-packed octrees, expose serialized node star counts,
terminal state, and exact subtree-brightest levels, reject mixed STAR/OSHR
versions, and skip coalesced payloads that cannot contain stars relevant to the
active magnitude limit. Magnitude-shell pruning uses the natural level's full
node width, matching geometry-driven bins that keep visibility inside the
current cell and its immediate neighbours. Include the new provider in the
SkyKit compatibility bundle.
