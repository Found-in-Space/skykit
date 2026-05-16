# @found-in-space/skykit

Alpha composition package for Found in Space teaching experiences.

SkyKit is intentionally slim: it wires focused packages together and gives
students a friendly place to hack. It does not load octree bytes, interpret star
products, own star shaders, manage touch surfaces, or contain journey/chapter
logic.

Star loading strategies such as `observer-shell`, `target-frustum`,
sphere/path volume, explicit motion-lookahead, custom strategies, composition,
and prefetch semantics are defined by `@found-in-space/star-octree-provider`.
SkyKit passes strategy objects through to provider sessions; it does not
redefine provider demand planning.

## Create A Viewer

```js
import {
  createKeyboardNavigationPlugin,
  createSkykitAnimationLoop,
  createSkykitStatusPlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
} from '@found-in-space/skykit';
import {
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createThreeStarField } from '@found-in-space/three-star-field';

const provider = createStarOctreeProviderService({ url: STAR_OCTREE_URL });
const starField = createThreeStarField({ renderScale: 0.001 });

const viewer = await createSkykitViewer({
  host: document.querySelector('#skykit'),
  plugins: [
    createStreamingStarsPlugin({
      provider,
      renderer: starField,
      session: { strategy: createObserverShellStrategy() },
    }),
    createKeyboardNavigationPlugin({ speedPcPerSec: 2 }),
    createSkykitStatusPlugin({ target: document.querySelector('#status') }),
  ],
});

const loop = createSkykitAnimationLoop(viewer);
loop.start();
```

## Hack With Plugins

A plugin is just a function or object that receives a public context. It can add
parts, listen for events, request view-state changes, keep stores/resources, or
schedule background work.

```js
import * as THREE from 'three';
import { createObject3dPlugin } from '@found-in-space/skykit';

const marker = new THREE.Mesh(
  new THREE.SphereGeometry(0.05),
  new THREE.MeshBasicMaterial({ color: 'hotpink' }),
);

const markerPlugin = createObject3dPlugin({
  id: 'my-marker',
  object3d: marker,
  anchorMode: 'world-space',
});

const viewer = await createSkykitViewer({
  host: document.querySelector('#skykit'),
  plugins: [markerPlugin],
});
```

For a slightly more playful example, see `examples/plugin-lab.js`. It builds a
small falling-marker plugin from the same public hooks a learner would use.

## Debug

```js
import { createSkykitDebugBridge, installSkykitDebugGlobal } from '@found-in-space/skykit';

const debug = createSkykitDebugBridge();
debug.registerViewer(viewer);
installSkykitDebugGlobal(debug);

// Browser console:
skykitDebug.snapshot();
skykitDebug.setObserverPc(10, 0, 0);
```

## Boundary

SkyKit composes reusable modules:

- `star-octree-provider` streams star products.
- `star-products` interprets star product columns.
- `three-star-field` renders streamed star products.
- `touch-os` owns richer panels, HUDs, and surfaces.

Core SkyKit should stay a teaching/composition layer, not a place for sidecars,
journey logic, renderer internals, or experimental data products.
