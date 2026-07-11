---
"@found-in-space/spatial": minor
"@found-in-space/skykit": minor
"@found-in-space/star-map-canvas": patch
---

Reset the spatial alpha API to the canonical contract with strict names,
data-only routes, paths, and transitions, canonical `deltaSecs` and
`sampleStepSecs`, destination-preserving route endpoints, public aim tracks,
distinct manual motion models, and route/orbit/aim navigation. Enforce strict
runtime validation and update SkyKit, SkyKit XR, and star-map-canvas adapters to
consume the new spatial surface without losing their public compatibility
shapes. Honor independent navigation cancellation and arrival settle/dwell
semantics, and prevent stale async SkyKit navigation resolutions from replacing
newer commands.
