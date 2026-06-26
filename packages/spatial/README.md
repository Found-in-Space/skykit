# @found-in-space/spatial

Dependency-free spatial semantics for coordinates, poses, aims, paths, routes,
orbits, timing, preload hints, manual motion, and navigation automation.

This package is renderer-neutral. It can be used from Canvas, Three.js, WebXR,
Node scripts, Studio export tooling, or any other spatial experience without
pulling in SkyKit or Three.js.

It owns:

- vector, quaternion, pose, and scale-profile helpers
- RA/Dec, ICRS direction, equirectangular projection, and target resolution
- target, direction, and orientation aim evaluation
- polyline, orbit-transfer, and orbital-insert routes
- path sampling, aim tracks, view transitions, and preload hints
- direct, inertial, and thrust manual motion models
- `createSpatialNavigationAutomation()` over canonical routes, orbits, and aims

```js
import {
  SPATIAL_IDENTITY_QUATERNION,
  buildSpatialOrbitTransferRoute,
  createSpatialNavigationAutomation,
  raDecDistanceToIcrs,
} from '@found-in-space/spatial';

const pleiadesPc = raDecDistanceToIcrs({
  raDeg: 56.75,
  decDeg: 24.12,
  distancePc: 136,
});

const route = buildSpatialOrbitTransferRoute({
  from: { positionPc: { x: 0, y: 0, z: 0 } },
  to: { positionPc: pleiadesPc },
  travel: { kind: 'orbitTransfer', timing: { kind: 'duration', durationSecs: 4 } },
});

const navigation = createSpatialNavigationAutomation();
if (route) navigation.flyRoute(route);

let pose = {
  observerPc: { x: 0, y: 0, z: 0 },
  orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
};

pose = navigation.update({ pose, deltaSecs: 1 / 60 });
```

`@found-in-space/spatial` does not know about stars, octrees, renderers, DOM,
WebXR sessions, or authored SkyKit action payloads. Applications resolve those
semantic inputs into canonical spatial objects before calling this package.
