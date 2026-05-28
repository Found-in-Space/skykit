# @found-in-space/spatial

Dependency-free coordinates, poses, routes, and navigation helpers.

This package is deliberately renderer-neutral. It can be used from Canvas,
Three.js, WebXR, Phaser, Node scripts, future journeys, or any other spatial
experience without pulling in SkyKit or Three.js.

```js
import {
  createRaDecLookAt,
  createSpatialNavigationAutomation,
  parseSpatialLookAtText,
  raDecDistanceToIcrs,
} from '@found-in-space/spatial';

const pleiades = raDecDistanceToIcrs({
  raDeg: 56.75,
  decDeg: 24.12,
  distancePc: 136,
});

const navigation = createSpatialNavigationAutomation({ speed: 20 });
navigation.flyTo(pleiades);

const lookAt = createRaDecLookAt('05h 36m 12.81s', '−01° 12′ 06.9″');

let pose = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
pose = navigation.update({ pose, deltaSeconds: 1 / 60 });
```

`createRaDecLookAt()` accepts decimal and sexagesimal RA/Dec values. It handles
forms such as `05h 36m 12.81s`, `05:36:12.81`, `−01° 12′ 06.9″`, and
`-01:12:06.9`. `parseSpatialLookAtText()` is useful at string-oriented
boundaries such as HTML attributes or authored content. It returns ordinary
spatial look-at specs from RA/Dec text, decimal RA/Dec pairs, parsec-space
vectors, or JSON look specs.

RA/Dec with `distancePc` is interpreted as a heliocentric point from the solar
origin `{ x: 0, y: 0, z: 0 }`. RA/Dec without distance remains a directional
look/orientation. Explicit observer-relative coordinate shorthand is deferred;
callers that need it should combine `raDecToIcrsDirection()` with their own
observer vector.

`@found-in-space/spatial` does not know about stars, octrees, renderers, DOM,
WebXR sessions, or journeys. Those packages compose these primitives.

Bookmark targets are deliberately opaque to this package. If an application
uses a bookmark to point at a star, it should serialize the star cell's
`StarObjectRef` and resolve it outside `@found-in-space/spatial`; spatial
helpers only consume the resolved coordinates.
