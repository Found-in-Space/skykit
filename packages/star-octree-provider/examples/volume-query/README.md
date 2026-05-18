# Volume Query

Package-owned browser/Node example for volume-based star streaming through
`@found-in-space/star-octree-provider`.

The example demonstrates the provider-owned strategy surface:

- create a provider from the public octree URL
- request a sphere volume using `streamVolumeCells()`
- consume normal `StarCellDelta` events
- keep volume counting/rendering as application logic

Volume strategies live in the provider because they select octree nodes. They do
not belong in a separate wrapper package, and they should not import old root
`src/` viewer, layer, or demo modules.
