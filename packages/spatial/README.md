# @found-in-space/spatial

Dependency-free coordinates, transforms, poses, aims, routes, paths, timing,
preload volumes, manual motion, and navigation automation.

This source implements the **breaking 0.3.0-alpha.0 API**. It is distinct from
published spatial 0.2.0. Use the matching packed alpha or a compatible release
batch; changing an installed 0.2.0 package in place will break its consumers.

Coordinates declare their space. Stellar applications can use parsecs; Solar
System applications can use metres or AU. An operation's nested geometry inherits
its space. Different spaces require an explicit transformation.

```js
import {
  buildSpatialPolylineRoute,
  createSpatialNavigationAutomation,
  SPATIAL_IDENTITY_QUATERNION,
} from '@found-in-space/spatial';

const space = { frameId: 'my-simulation:heliocentric-j2000', metersPerUnit: 1 };
const route = buildSpatialPolylineRoute({
  space,
  points: [{ x: 0, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }],
  travel: { kind: 'polyline', timing: { kind: 'constantSpeed', speedUnitsPerSec: 100 } },
});
const navigation = createSpatialNavigationAutomation(space);
navigation.flyRoute(route);
const pose = navigation.update({
  pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
  deltaSecs: 1,
});
// pose.position.x === 100 metres; display scale does not alter this result.
```

The package owns generic algebra and geometry. Domain owners define origins,
axes, epochs, astronomical corrections, body models, and datums. Renderer and XR
adapters own scene graphs, GPU coordinates, tracking acquisition, and physical
presentation policy. A circular spatial orbit is navigation geometry, not an
orbital mechanics prediction.

See [the API contract](api-contract.md) for coordinate inheritance, transformation
semantics, precision, timing, and migration. [The declarations](src/index.d.ts)
are the complete public signatures. Only the package root is a supported import.

## Direct-package labs

Run the workspace with `npm run dev` and open `packages/spatial/examples/`.
The four Canvas2D labs demonstrate coordinates/aim, routes/orbits,
paths/transitions, and motion/automation. Each declares its coordinate space and
imports spatial directly, without SkyKit or Three.js. These source examples are
not included in the npm archive.
