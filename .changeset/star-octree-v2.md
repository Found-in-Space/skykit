---
'@found-in-space/star-octree-provider': minor
'@found-in-space/star-trees': patch
'@found-in-space/skykit': patch
---

Load STAR v2 terminal-packed octrees, expose serialized node star counts,
terminal state, and exact subtree-brightest levels, reject mixed STAR/OSHR
versions, and skip coalesced payloads that cannot contain stars relevant to the
active magnitude limit. Include the new provider in the SkyKit compatibility
bundle.
