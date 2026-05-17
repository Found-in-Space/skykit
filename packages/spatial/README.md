# @found-in-space/spatial

Dependency-free coordinates, poses, routes, and navigation helpers.

This package is deliberately renderer-neutral. It can be used from Canvas,
Three.js, WebXR, Phaser, Node scripts, future journeys, or any other spatial
experience without pulling in SkyKit or Three.js.

```js
import {
  createSpatialNavigationAutomation,
  raDecDistanceToIcrs,
} from '@found-in-space/spatial';

const pleiades = raDecDistanceToIcrs({
  raDeg: 56.75,
  decDeg: 24.12,
  distancePc: 136,
});

const navigation = createSpatialNavigationAutomation({ speed: 20 });
navigation.flyTo(pleiades);

let pose = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
pose = navigation.update({ pose, deltaSeconds: 1 / 60 });
```

`@found-in-space/spatial` does not know about stars, octrees, renderers, DOM,
WebXR sessions, or journeys. Those packages compose these primitives.
