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
  SKYKIT_ACTIONS,
  SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS,
  createKeyboardNavigationPlugin,
  createSkykitDefaultKeyboardNavigationBindings,
  createSkyGrabPlugin,
  createSkykitAnimationLoop,
  createSkykitStatusPlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
} from '@found-in-space/skykit';
import {
  OCTREE_DEFAULT,
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createThreeStarField } from '@found-in-space/three-star-field';

const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
const starField = createThreeStarField();

const viewer = await createSkykitViewer({
  host: document.querySelector('#skykit'),
  view: { coordinateUnitsPerParsec: 0.001 },
  plugins: [
    createStreamingStarsPlugin({
      provider,
      renderer: starField,
      session: { strategy: createObserverShellStrategy() },
    }),
    createKeyboardNavigationPlugin({ speedPcPerSec: 2 }),
    createSkyGrabPlugin({ target: document.querySelector('#skykit') }),
    createSkykitStatusPlugin({ target: document.querySelector('#status') }),
  ],
});

const loop = createSkykitAnimationLoop(viewer);
loop.start();
```

Keyboard bindings are either default or custom. If `bindings` is omitted,
SkyKit uses `SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS`; if `bindings` is
supplied, it is the complete key map. Multiple keys can still point to the same
action:

```js
createKeyboardNavigationPlugin({
  rotationSpeedDegPerSec: 45,
  bindings: createSkykitDefaultKeyboardNavigationBindings({
    KeyJ: SKYKIT_ACTIONS.ship.yawLeft,
    KeyL: SKYKIT_ACTIONS.ship.yawRight,
    KeyI: SKYKIT_ACTIONS.ship.pitchUp,
    KeyK: SKYKIT_ACTIONS.ship.pitchDown,
    KeyU: SKYKIT_ACTIONS.ship.rollAnticlockwise,
    KeyO: SKYKIT_ACTIONS.ship.rollClockwise,
    KeyR: SKYKIT_ACTIONS.viewer.reset,
  }),
});
```

Default bindings cover movement only. Custom bindings may also use other
namespaced actions such as `SKYKIT_ACTIONS.viewer.reset` or app-owned actions
like `game:weapons.fire`. `createSkykitDefaultKeyboardNavigationBindings()`
returns a fresh complete map, so overrides are explicit rather than implicit.

## Actions

SkyKit reserves `skykit:` for built-in semantic actions. These are behavior
names, not renderer or loader factory names:

```js
SKYKIT_ACTIONS.ship.moveForward; // "skykit:ship.move.forward"
SKYKIT_ACTIONS.viewer.reset; // "skykit:viewer.reset"
SKYKIT_ACTIONS.journey.goToChapter; // "skykit:journey.goToChapter"
```

Plugins can add their own namespaces:

```js
const firePlugin = (ctx) => {
  ctx.actions.registerAction('game:weapons.fire', ({ payload }) => {
    console.log('pew', payload);
  });
};
```

DOM buttons, touch surfaces, keyboard bindings, XR controls, journeys, and debug
tools can all call the same action:

```js
button.addEventListener('click', () => {
  viewer.actions.invoke(SKYKIT_ACTIONS.journey.goToChapter, {
    chapterId: 'hyades-arrival',
  });
});
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

Browser lessons:

- `examples/free-roam-lesson/` composes streamed stars, keyboard navigation,
  sky-grab look controls, status, and debug.
- `examples/custom-object-layer/` shows that app-owned Three.js visuals can be
  small plugins instead of core SkyKit features.
- `examples/navigation-automation/` uses the XR navigation helpers to drive a
  desktop SkyKit viewer.

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
