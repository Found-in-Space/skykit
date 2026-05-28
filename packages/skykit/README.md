# @found-in-space/skykit

Alpha composition package for Found in Space teaching experiences.

SkyKit is intentionally slim: it wires focused packages together and gives
students a friendly place to hack. It does not load octree bytes, interpret
star cells, own star shaders, manage touch surfaces, or contain journey/chapter
logic.

SkyKit examples and plugins should preserve the star identity boundary from
`@found-in-space/star-trees`: use `StarObjectRef` for stars and
`createStarCellKey()` for cell-level maps or display. Do not introduce
SkyKit-specific star IDs or expose octree storage details such as `nodeKey`,
`shardOffset`, `nodeIndex`, `payloadOffset`, or `payloadLength`.

Star loading strategies are shared strategy objects/functions. Bundled
observer-shell, target-frustum, sphere/path volume, lookahead, and composition
helpers are conveniences over the same public contract used by application
strategies. SkyKit passes strategies through to provider sessions; it does not
redefine planning, inspect strategy kinds, or hide loader registries behind
string names.

## Website Use-Cases

The beginner website entries are use-case bounded:

| Use-case | Website owner says | Public entry |
| --- | --- | --- |
| Viewer | "Put stars on my page and let me customize the scene." | `embed.js`, `viewer.js` |
| Data | "Give me star data so I can render, list, map, or game it myself." | `data.js` |

`embed.js` is the no-code viewer entry. It is not a separate use-case.
`viewer.js` is the JavaScript-customizable viewer entry. `data.js` is renderer
independent. Authored chapters stay in website or example code and call SkyKit
navigation actions directly.

## Paste into a static page or CMS

For the beginner path, use the auto-booting embed. Paste this into a static HTML
page or a CMS custom HTML block:

```html
<div
  data-skykit-browser
  data-skykit-status="#skykit-status"
  style="width: 100%; height: 70vh; min-height: 420px; background: #02040b"
></div>

<pre id="skykit-status">Loading stars...</pre>

<script
  type="module"
  src="https://esm.sh/@found-in-space/skykit@0.2.0-alpha.2/embed?bundle&deps=three@0.170.0"
></script>
```

The embed script finds every `[data-skykit-browser]` element and creates the
standard star browser there. It owns the normal beginner plumbing: Three.js
renderer and camera, the public star provider, the star-field renderer, streaming
stars, keyboard navigation, drag-to-look controls, resize handling, the animation
loop, and page-lifecycle cleanup.

Optional attributes keep small tweaks HTML-only:

```html
<div
  data-skykit-browser
  data-skykit-status="#skykit-status"
  data-skykit-magnitude="7"
  data-skykit-speed="4"
  data-skykit-exposure="2600"
  data-skykit-observer="06h 45m 08.9s, -16d 42m 58s, 2.64pc"
  data-skykit-look-at="05h 35m 17.3s, -05d 23m 28s, 414pc"
  data-skykit-coordinate-origin="solar"
  data-skykit-mouse-mode="strafe"
  data-skykit-persistent-cache="off"
  style="width: 100%; height: 520px; background: #02040b"
></div>
```

`data-skykit-observer` accepts fixed parsec-space `x,y,z` coordinates or
RA/Dec/distance text such as `06h 45m 08.9s, -16d 42m 58s, 2.64pc`.
`data-skykit-look-at` accepts RA/Dec text such as
`05h 36m 12.81s, −01° 12′ 06.9″`, decimal degrees such as
`84.053393,-1.201926`, RA/Dec/distance text for a fixed heliocentric target,
or a parsec-space `x,y,z` target for exact generated coordinates.
RA/Dec/distance resolves from the solar origin; pure RA/Dec remains a
directional look. `data-skykit-coordinate-origin="solar"` is accepted as
clarifying markup, while observer-relative shorthand is not part of this alpha
embed yet. `data-skykit-mouse-mode` defaults to `grab`; use `look` or
`strafe` for the first-person mouse-look direction, or `none` to disable mouse
drag controls. Persistent browser Cache API storage is enabled by default for
octree ranges; set
`data-skykit-persistent-cache="off"` to keep caching session-only.

The host dispatches `skykit-browser-ready` with `{ browser, viewer }` in
`event.detail` after startup, and `skykit-browser-error` if startup fails. The
embed also installs a small `Skykit` global for noob-path scripts:

```js
const browser = await Skykit.whenReady();
```

Pages can host multiple viewers. Pass a selector or element to choose one:

```js
const browser = await Skykit.whenReady('#orion-viewer');
```

Pin the package CDN URL to a released SkyKit version when publishing long-lived
pages, for example
`https://esm.sh/@found-in-space/skykit@x.y.z/embed?bundle&deps=three@0.170.0`.

Optional first-party capabilities stay out of the initial browser until they are
requested. This keeps the one-script noob path while avoiding bundle bloat.

```html
<div
  data-skykit-browser
  data-skykit-constellations="western"
  data-skykit-constellation-art="off"
  style="width:100%;height:520px;background:#02040b"
></div>
```

For small scripted interactions, use the browser handle:

```html
<script type="module">
  import {
    SKYKIT_ACTIONS,
    createRaDecLookAt,
    createSkykitNavigationPlugin,
  } from 'https://esm.sh/@found-in-space/skykit';

  const browser = await Skykit.whenReady();
  await browser.install(createSkykitNavigationPlugin());
  const alnilam = createRaDecLookAt('05h 36m 12.81s', '−01° 12′ 06.9″');

  document.querySelector('#orion').addEventListener('click', () => {
    browser.viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
      view: { lookAt: alnilam },
      movement: { durationSecs: 3 },
    });
  });
</script>
```

## Create a Viewer from JavaScript

If your site has a module script, npm, or a bundler, call the helper directly:

```html
<div id="viewer" style="width: 100vw; height: 100vh"></div>
<pre id="status">Loading stars...</pre>

<script type="module">
  import { createSkykitBrowser } from 'https://esm.sh/@found-in-space/skykit@0.2.0-alpha.2/viewer?bundle&deps=three@0.170.0';

  await createSkykitBrowser({
    host: '#viewer',
    status: '#status',
  });
</script>
```

The helper still returns the pieces when an example wants to grow:

```js
const sky = await createSkykitBrowser('#viewer');

sky.viewer.requestViewState({ observerPc: { x: 4, y: 0, z: -8 } });
sky.addObject(marker, {
  positionPc: { x: 17.574, y: 42.316, z: 13.963 },
});
sky.loop.stop();
await sky.dispose();
```

For npm or bundlers, use the same beginner entry:

```js
import { THREE, createSkykitBrowser } from '@found-in-space/skykit/viewer';
```

## Use Star Data Without a Viewer

Use `data.js` when SkyKit should supply rows and your app should own rendering:

```js
import { loadStarRows } from 'https://esm.sh/@found-in-space/skykit@0.2.0-alpha.2/data?bundle';

const stars = await loadStarRows({
  limitingMagnitude: 6.5,
  maxStars: 100,
  sortBy: 'apparentMagnitude',
});

console.table(stars);
```

For games and maps, load a local volume and hand rows to Canvas, PixiJS,
Phaser, SVG, or your own renderer:

```js
const stars = await loadStarRows({
  centerPc: { x: 0, y: 0, z: 0 },
  radiusPc: 50,
  maxStars: 2000,
});
```

## Author Chapters

Keep named chapters in the website or example script. Each chapter can call
navigation actions such as `skykit:navigation.transitionTo` and
`skykit:navigation.orbit` from its own `goTo(id)` dispatcher.

Use the lower-level factories when an example is teaching composition or replacing
a part of the stack:

```js
import {
  createKeyboardNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitAnimationLoop,
  createSkykitViewer,
  createStreamingStarsPlugin,
} from '@found-in-space/skykit';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

const host = document.querySelector('#viewer');
const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
const starField = createThreeStarField();

const viewer = await createSkykitViewer({
  host,
  view: { coordinateUnitsPerParsec: 0.001 },
  plugins: [
    createStreamingStarsPlugin({
      provider,
      renderer: starField,
      session: { strategy: createObserverShellStrategy() },
    }),
    createKeyboardNavigationPlugin({ speedPcPerSec: 2 }),
    createSkyGrabPlugin({ target: host }),
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
import {
  SKYKIT_ACTIONS,
  createKeyboardNavigationPlugin,
  createSkykitDefaultKeyboardNavigationBindings,
} from '@found-in-space/skykit';

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

## Optional Parallax

Parallax is split into two small plugins so learners can replace either half:
one plugin turns browser input into a semantic control, and the other turns that
control into observer motion.

```js
import {
  createParallaxObserverPlugin,
  createParallaxOffsetInputPlugin,
} from '@found-in-space/skykit/parallax';

const viewer = await createSkykitViewer({
  host: document.querySelector('#skykit'),
  plugins: [
    createParallaxOffsetInputPlugin({
      target: document.querySelector('#skykit'),
      pointer: { mode: 'hover' },
      tilt: true,
    }),
    createParallaxObserverPlugin({
      targetPc: { x: 0, y: 0, z: -10 },
      offsetPc: 0.25,
    }),
  ],
});
```

`createParallaxOffsetInputPlugin()` writes
`SKYKIT_CONTROLS.observer.parallaxOffset`. It never moves the viewer. That makes
it easy to swap pointer, touch, tilt, or custom game input without changing the
view behavior plugin.

## Actions

SkyKit reserves `skykit:` for built-in semantic actions. These are behavior
names, not renderer or loader factory names:

```js
SKYKIT_ACTIONS.ship.moveForward; // "skykit:ship.move.forward"
SKYKIT_CONTROLS.observer.parallaxOffset; // "skykit:observer.control.parallaxOffset"
SKYKIT_ACTIONS.viewer.reset; // "skykit:viewer.reset"
SKYKIT_ACTIONS.navigation.transitionTo; // "skykit:navigation.transitionTo"
```

Plugins can add their own namespaces:

```js
const firePlugin = (ctx) => {
  ctx.actions.registerAction('game:weapons.fire', ({ payload }) => {
    console.log('pew', payload);
  });
};
```

DOM buttons, touch surfaces, keyboard bindings, XR controls, app-owned chapters,
and debug tools can all call the same action:

```js
button.addEventListener('click', () => {
  viewer.actions.invoke('website:chapter.goTo', {
    id: 'hyades-arrival',
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

For a slightly more playful example, see `examples/plugin-lab.js`. It builds
app-owned Three objects and action-driven annotations from the same public hooks
a learner would use.

The pasteable browser embed has a smaller add-on convention for noob pages:

```js
Skykit.registerBrowserAddon({
  id: 'example:marker',
  install({ browser, THREE }) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
    );
    const handle = browser.addObject(marker, {
      positionPc: { x: 17.574, y: 42.316, z: 13.963 },
    });
    return () => handle.dispose();
  },
});
```

See `docs/skykit-browser-plugins.md` for the browser add-on spec,
`Skykit.whenReady()`, and first-party constellation support.

Browser development examples:

- `examples/free-roam-console/` composes streamed stars, picking, metadata,
  deep links, navigation, shader controls, touch-os HUD controls, and
  constellation art.
- `examples/hr-diagram-free-roam/` embeds the reusable HR diagram as a
  touch-os panel inside a free-roam SkyKit viewer.
- `examples/xr-free-roam/` composes alpha XR session/navigation helpers with a
  pose-anchored touch-os panel.
- `examples/custom-object-layer/` shows that app-owned Three.js visuals can be
  small plugins instead of core SkyKit features.

## Touch-OS Bridge

The optional `@found-in-space/skykit/touch-os` subpath wires touch-os HUD
outputs into SkyKit actions. It keeps richer panel rendering in touch-os while
removing repeated app glue for pseudo-keys and status displays.

```js
import {
  createSkykitShipControlsRoot,
  createTouchOsHudPlugin,
} from '@found-in-space/skykit/touch-os';

createTouchOsHudPlugin({
  target: mount,
  root: createSkykitShipControlsRoot({
    commands: [{ id: 'look-home', label: 'Home', actionId: 'app.lookHome' }],
  }),
});
```

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

- `star-octree-provider` streams star cells.
- `star-trees` interprets star cell columns.
- `three-star-field` renders streamed star cells.
- `touch-os` owns richer panels, HUDs, and surfaces.

Core SkyKit should stay a teaching/composition layer, not a place for sidecars,
journey logic, renderer internals, or experimental data lanes.
