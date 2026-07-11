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

Orbital insertion chooses a tangent contact point by default. Leave
`initialAngleRad` unset and the builder selects the tangent whose approach
direction agrees with the signed orbit direction:

```js
import { buildSpatialOrbitalInsertRoute } from '@found-in-space/spatial';

const insertion = buildSpatialOrbitalInsertRoute({
  from: { positionPc: { x: -15, y: 0, z: 9 } },
  orbit: {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 6,
    orbitNormal: { x: 0, y: 1, z: 0 },
    handedness: 1,
    angularSpeedRadPerSec: 0.24,
    // No initialAngleRad: derive a tangent insertion point.
  },
  travel: { kind: 'orbitalInsert' },
});
```

Set `initialAngleRad` when an authored contact point is more important than a
tangent approach. Starts without a valid tangent use the nearest orbit angle
and report an `orbitalInsertTangentFallback` warning in route diagnostics. The
route materializes its selected angle and ends with the exact signed orbital
velocity, so navigation can continue the orbit without a heading snap.

`@found-in-space/spatial` does not know about stars, octrees, renderers, DOM,
WebXR sessions, or authored SkyKit action payloads. Applications resolve those
semantic inputs into canonical spatial objects before calling this package.

## Interactive examples

The package examples use only DOM and Canvas2D around direct spatial API calls:

- `examples/coordinates-aim/`
- `examples/routes-orbits/`
- `examples/paths-transitions/`
- `examples/motion-automation/`

Review them in the deployed
[Spatial Package Labs](https://found-in-space.github.io/skykit/packages/spatial/examples/).
Repository contributors can also run `npm run dev` from the workspace root and
open `/packages/spatial/examples/`. These repository examples are deployed by
the workspace but are intentionally not included in the npm package tarball.
