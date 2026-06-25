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

## Published Website Content Use-Cases

The beginner Published Website Content entries are use-case bounded:

| Use-case | Content owner says | Public entry |
| --- | --- | --- |
| Viewer | "Put stars on my page and let me customize the scene." | `embed.js`, `viewer.js` |
| Data | "Give me star data so I can render, list, map, or game it myself." | `data.js` |

`embed.js` is the no-code viewer entry. It is not a separate use-case.
`viewer.js` is the JavaScript-customizable viewer entry. `data.js` is renderer
independent. Authored chapters stay in Published Website Content or Examples and
Demos code and call SkyKit navigation actions directly.

The public beginner lessons live in the
`Found-in-Space/found-in-space.github.io` repository. Examples and Demos in this
package are package-development or advanced-use material until Published Website
Content deliberately curates them into lessons with stable imports and checked
links.

## Runtime Products

SkyKit plugins can publish runtime products: typed handles for things that are
currently running, not factory entries for constructing hidden systems. Product
keys are readable conventions, not globally reserved names. Recommended initial
patterns include `stars:stellar/source`, `stars:stellar/store`,
`features:constellations/western`, `waypoints:constellations/western`,
`features:frames/galactic`, `waypoints:frames/galactic`,
`features:grids/equatorial`, `waypoints:grids/equatorial`,
`features:grids/galactic`, `waypoints:grids/galactic`,
`surfaces:constellation-art/western`, `media:extinction/rezaei2024`,
`media:emission/halpha/mccallum2025`, and `selection:primary`. Here
`selection:primary` means the current/default selection slot, not a final
beginner-facing label. Participating-media products such as dust and H-alpha
should be consumed by an optical-path compositor rather than rendered as
independent transparent overlays; see
[`docs/participating-media.md`](../../docs/participating-media.md).

The browser-style handles expose the same public runtime surfaces:
`actions`, `products`, `selection`, and `inspect`. These are not wrapper
registries; they are the viewer action registry, runtime product registry, the
product-backed current selection facade, and a read-only inspect facade for
snapshots, streams, products, actions, bounded action/selection history,
selection, view state, and XR details when XR exists.

Browser-style handles also expose lazy first-party capability facades.
`browser.constellations` loads skyculture boundaries/art, and `browser.frames`
loads standard coordinate-frame marker layers that publish
`features:frames/<frame>` and `waypoints:frames/<frame>`. `browser.grids`
loads observer-centric equatorial and galactic coordinate grids that publish
`features:grids/<system>` and `waypoints:grids/<system>`.

When the star renderer supports `pick()`, `createSkykitBrowser()` installs
desktop star picking by default and exposes the plugin as `browser.starPicking`.
Use `pick: false` to opt out, or pass `pick: { metadata }` to enrich public
star selections from a sidecar-like provider with `getMeta(ref)`. Public star
selections use `StarObjectRef` when available; unavailable identity is reported
as `kind: 'star-pick-unavailable'` with storage details kept under
`diagnostic`.

Browser-style handles also install a small layer-selection bridge by default.
Invoke `SKYKIT_ACTIONS.selection.select` with an explicit public hit such as
`{ waypoint }`, `{ feature }`, `{ selection }`, or `{ kind, id }` to write the
same compact value to `selection:primary`. XR pointer routes use the same bridge
through `SKYKIT_ACTIONS.xr.pointerSelect` when their route hit has public
identity. Misses, blockers, Three.js object names, storage offsets, and route
internals do not become public selection IDs.

Use the registry directly from a plugin when one plugin owns a handle and another
plugin should discover it later:

```js
import {
  getSkykitProductRegistry,
  productRef,
  createSkykitHrDiagramPlugin,
  createSkykitStarSourcePlugin,
} from '@found-in-space/skykit';

const stellarSource = createSkykitStarSourcePlugin({
  id: 'stellar-source',
  provider,
  publish: {
    source: 'stars:stellar/source',
    store: 'stars:stellar/store',
    metadata: { kind: 'stars', label: 'Stellar source' },
  },
});

const hr = createSkykitHrDiagramPlugin({
  source: productRef('stars:stellar/source'),
});
```

Small authored products use the same path as streaming sources:

```js
const routeProducts = {
  id: 'lesson-route-products',
  setup(ctx) {
    const products = getSkykitProductRegistry(ctx);
    return products.provide('features:lesson-route', {
      type: 'FeatureCollection',
      features: [
        {
          id: 'sol',
          layerId: 'lesson-route',
          kind: 'star-waypoint',
          label: 'Sol',
          frame: 'icrs-pc',
          target: { targetPc: { x: 0, y: 0, z: 0 } },
          position: { x: 0, y: 0, z: 0 },
        },
      ],
      metadata: {
        datasetId: 'lesson-route',
        label: 'Lesson route',
        layerKind: 'authored-route',
      },
    }, {
      kind: 'features',
      ownerId: 'lesson-route',
      tags: ['authored'],
    });
  },
};
```

Hosted layers are ordinary plugin-friendly composition units. They can mount
Three.js content, receive view/state updates, and publish products without
becoming hidden factories:

```js
import {
  createSkykitConstellationLayer,
  createSkykitCoordinateGridLayer,
  createSkykitCoordinateFrameMarkerLayer,
  createSkykitLayerHostPlugin,
} from '@found-in-space/skykit';

const layers = createSkykitLayerHostPlugin({
  layers: [
    createSkykitConstellationLayer({
      manifest: westernSkycultureManifest,
      assetBaseUrl: '/skycultures/western/',
      publish: {
        features: 'features:constellations/western',
        waypoints: 'waypoints:constellations/western',
        catalog: 'surfaces:constellation-art/western',
      },
    }),
    createSkykitCoordinateFrameMarkerLayer({
      frame: 'galactic',
      publish: {
        features: 'features:frames/galactic',
        waypoints: 'waypoints:frames/galactic',
      },
    }),
    createSkykitCoordinateGridLayer({
      system: 'galactic',
      publish: {
        features: 'features:grids/galactic',
        waypoints: 'waypoints:grids/galactic',
      },
    }),
  ],
});
```

## XR viewer presets

`createSkykitVrViewer()` is the current package-level WebXR preset and the
lower-level foundation for authored XR examples. It is a convenience over
`createSkykitViewer()` plus `createSkykitXrComposition()`: the returned object
still exposes the viewer, XR composition, product registry, shared star source,
star field, layer host, rays, pick bridge, animation loop, and other public
handles.

`createSkykitXrBrowser()` is the browser-style XR handle. It keeps the same
beginner handle model as `createSkykitBrowser()` and adds `vr`, `xr`, `rig`,
`session`, `rays`, `enter()`, `exit()`, layer helpers, and XR-specific runtime
handles. Its default star picking writes public `StarObjectRef` selections to
`selection:primary` when identity is available; storage details such as
`cellKey:objectIndex` stay diagnostic rather than beginner-facing identity.
`stars.pick.metadata` accepts the same resolver or sidecar-like provider shape
as desktop picking. It also exposes the same first-party capability handles,
including `constellations`, `frames`, and `grids`. XR pointer targets that
return explicit waypoint, feature, selection, or `{ kind, id }` hits update the
same public selection slot through the default layer-selection bridge.

```js
import { createSkykitXrBrowser } from '@found-in-space/skykit/xr';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';

const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
const sky = await createSkykitXrBrowser({
  host: document.querySelector('#viewer'),
  stars: { provider },
});

button.addEventListener('click', () => {
  void sky.enter();
});
```

Hosted layers and app plugins are ordinary SkyKit pieces. This keeps creative
application code visible while the preset handles the repetitive XR viewer
setup:

```js
import { productRef } from '@found-in-space/skykit';

const targetProduct = 'interaction:lesson/target';
await createSkykitVrViewer({
  host,
  stars: { provider },
  layers: [{
    setup(ctx) {
      ctx.provideProduct(targetProduct, { pick: () => ({ distance: 1 }) });
    },
  }],
  pickBridge: {
    targetProducts: [productRef(targetProduct)],
    routeOnFrame: true,
  },
  plugins: [myLessonPlugin],
});
```

WebXR session entry must be called from a user gesture. Advanced applications
can still spell out the raw path with `createSkykitViewer()`,
`createSkykitXrComposition()`, `createSkykitStarSourcePlugin()`, and ordinary
plugins; the preset does not replace those lower-level APIs.

For static-page XR experiments, use the separate `xr-embed` entry so normal
embeds do not import XR code:

```html
<div
  data-skykit-xr
  data-skykit-status="#xr-status"
  data-skykit-xr-mode="immersive-vr"
  data-skykit-reference-space="local-floor"
  data-skykit-frames="galactic"
  data-skykit-grids="equatorial,galactic"
  style="width:100%;height:70vh;background:#02040b"
></div>

<pre id="xr-status">Starting XR...</pre>

<script type="module" src="https://esm.sh/@found-in-space/skykit@0.2.0/xr-embed?bundle&deps=three@0.170.0"></script>
```

`xr-embed` injects an accessible Enter VR button by default. Provide
`data-skykit-enter-vr="#my-button"` to use an authored button. Checklist rows
with `data-preflight-check="skykit"`, `"stars"`, or `"xr"` receive `data-state`
updates, and child `[data-preflight-check-status]` elements receive the status
text. Published Website Content XR lessons should still wait until the API is
deliberately curated into `Found-in-Space/found-in-space.github.io`.

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
  src="https://esm.sh/@found-in-space/skykit@0.2.0/embed?bundle&deps=three@0.170.0"
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
  data-skykit-mouse-mode="strafe"
  data-skykit-persistent-cache="off"
  style="width: 100%; height: 520px; background: #02040b"
></div>
```

Supported embed attributes:

| Attribute | Meaning |
| --- | --- |
| `data-skykit-browser` | Marks a host element for auto-booting. Presence is enough. |
| `data-skykit-status` | CSS selector for a text status target. |
| `data-skykit-magnitude` | Initial limiting magnitude. |
| `data-skykit-speed` | Keyboard navigation speed in parsecs per second. |
| `data-skykit-exposure` | Star-field exposure value. |
| `data-skykit-observer` | Initial observer target. Accepts `x,y,z` parsec coordinates or RA/Dec/distance text. |
| `data-skykit-look-at` | Initial look target. Accepts RA/Dec text, decimal RA/Dec, RA/Dec/distance text, or `x,y,z` parsec coordinates. |
| `data-skykit-mouse-mode` | `grab` by default; `look`, `mouse-look`, `mouselook`, `game`, or `strafe` use mouse-look dragging; `orbit`, `object-orbit`, `orbital`, or `inspect` orbit around a concrete target; `none`, `off`, or `false` disable pointer drag. |
| `data-skykit-persistent-cache` | Persistent Cache API storage is on by default; use `off`, `false`, `no`, `0`, or `disabled` to opt out. |
| `data-skykit-constellations` | Turns on the browser constellation capability. Use `western`, a manifest URL, or pair it with `data-skykit-constellation-manifest`. Omit the attribute to disable constellations. |
| `data-skykit-constellation-manifest` | Explicit skyculture manifest URL for the browser constellation capability. |
| `data-skykit-constellation-assets` | Asset base URL for images referenced by the constellation manifest. Defaults to the manifest directory. |
| `data-skykit-constellation-art` | `off` by default; `lazy`, `on`, or `true` lazy-load art; `preload` loads all art textures. |
| `data-skykit-frames` | Turns on standard coordinate-frame marker layers. Use `galactic`, `solar`, or a comma-separated list. An empty attribute defaults to `galactic`; `off` or `false` disables the capability. |
| `data-skykit-grids` | Turns on standard coordinate grid overlays. Use `equatorial`, `galactic`, or a comma-separated list. An empty attribute defaults to both grids; `off`, `false`, `none`, or `0` disables the capability. |

RA/Dec/distance resolves from the solar origin. Pure RA/Dec remains a
directional look. Observer-relative shorthand and
`data-skykit-coordinate-origin` are not part of the embed attribute API; use the
JavaScript `createSkykitBrowser()` or `createSkykitViewer()` path for custom
startup state beyond the table above.

Orbit mouse mode uses a resolved `targetPc` as its default center, so pair it
with a concrete look target:

```html
<div
  data-skykit-browser
  data-skykit-look-at="17.574, 42.316, 13.963"
  data-skykit-mouse-mode="orbit"
  style="width: 100%; height: 520px; background: #02040b"
></div>
```

The host dispatches `skykit-browser-ready` with `{ browser, viewer }` in
`event.detail` after startup, and `skykit-browser-error` if startup fails. The
embed also installs a small `Skykit` global for beginner-path scripts:

```js
const browser = await Skykit.whenReady();
```

Pages can host multiple viewers. Pass a selector or element to choose one:

```js
const browser = await Skykit.whenReady('#orion-viewer');
```

Browser add-ons are script-tag conveniences for static pages, CMS snippets, and
small lessons. They install ordinary SkyKit plugins or expose small beginner
APIs on an existing browser handle:

```js
Skykit.registerBrowserAddon({
  id: 'example:marker',
  async install({ browser, THREE }) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.02),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
    );

    const handle = browser.addObject(marker, {
      id: 'example-marker',
      positionPc: { x: 17.574, y: 42.316, z: 13.963 },
    });

    return () => handle.dispose();
  },
});
```

`install(context)` receives `{ host, browser, viewer, THREE, skykit }`. The
optional `id` is only for diagnostics and per-browser de-duping; it is not a
factory name or registry key. Add-ons may load before the base embed by pushing
onto `globalThis.Skykit.browserAddons`.

Pin the package CDN URL to a released SkyKit version when publishing long-lived
pages, for example
`https://esm.sh/@found-in-space/skykit@x.y.z/embed?bundle&deps=three@0.170.0`.

Optional first-party capabilities stay out of the initial browser until they are
requested. This keeps the one-script beginner path while avoiding bundle bloat.

```html
<div
  data-skykit-browser
  data-skykit-constellations="western"
  data-skykit-constellation-art="off"
  data-skykit-frames="galactic,solar"
  data-skykit-grids="equatorial,galactic"
  style="width:100%;height:520px;background:#02040b"
></div>
```

The browser handle can also load and toggle these capabilities after startup:

```js
const browser = await Skykit.whenReady();
await browser.constellations.load({ skyculture: 'western', art: 'lazy' });
browser.constellations.hide();
browser.constellations.show();
await browser.constellations.setArt('preload');

await browser.frames.load({ frames: ['galactic', 'solar'] });
browser.frames.hide();
browser.frames.show();

await browser.grids.load({ grids: ['equatorial', 'galactic'] });
browser.grids.hide();
browser.grids.show();
```

The frame capability is for standard marker layers. Apps with custom markers
should install `createSkykitCoordinateFrameMarkerLayer()` directly through a
layer host. The grid capability is for standard equatorial and galactic
overlays; custom authored overlays should use ordinary hosted layers. The
constellation browser capability is one of two supported constellation loading
paths.
For standalone applications that compose SkyKit plugins directly, import the
published skyculture package APIs instead:

```js
import { createAnchoredImageManifest } from '@found-in-space/stellarium-skycultures-western/anchored-image';
import { bundledManifest } from '@found-in-space/stellarium-skycultures-western/bundled';
```

Use the anchored-image manifest for art rendering and the bundled skyculture
manifest for UI metadata. When displaying names, prefer
`common_name.native` before `common_name.english`; in the western package the
English value can be a gloss such as "Hunter", while the native display name is
"Orion". See [`../../docs/constellations.md`](../../docs/constellations.md) for the
full loading and metadata rules.

## Orbit Around An Object

Use `createSkyOrbitPlugin()` when drag should move around a target rather than
rotate the view in place. Specify centers in parsecs:

```js
createSkyOrbitPlugin({
  target: host,
  centerPc: HYADES_CENTER_PC,
});
```

If the initial view resolves a concrete `targetPc`, the plugin can use that as
the default center:

```js
const viewer = await createSkykitViewer({
  host,
  renderer,
  camera,
  view: {
    observerPc: { x: 0, y: 0, z: 0 },
    lookAt: { targetPc: HYADES_CENTER_PC },
  },
  plugins: [
    createSkyOrbitPlugin({ target: host }),
  ],
});
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
  import { createSkykitBrowser } from 'https://esm.sh/@found-in-space/skykit@0.2.0/viewer?bundle&deps=three@0.170.0';

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
import { loadStarRows } from 'https://esm.sh/@found-in-space/skykit@0.2.0/data?bundle';

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

Keep named chapters in Published Website Content or the Example and Demo script
that owns the lesson flow. Each chapter can call navigation actions such as
`skykit:navigation.transitionTo` and `skykit:navigation.orbit` from its own
`goTo(id)` dispatcher.

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

The pasteable browser embed has the smaller browser add-on convention described
above. It is a no-code path convenience. Larger examples
should switch to `createSkykitViewer()` or `createSkykitBrowser({ plugins })`
and install ordinary core plugins directly.

Standalone browser Examples and Demos live in this repository at
`../../apps/examples/`:

- `../../apps/examples/free-roam/` composes streamed stars, picking, metadata,
  deep links, navigation, shader controls, touch-os HUD controls, and
  constellation art.
- `../../apps/examples/vr-viewer/` wraps the XR preset with app-owned provider,
  star renderer, hosted layer, and pick target wiring.
- `../../apps/examples/xr-free-roam/` composes alpha XR session/navigation helpers
  with a pose-anchored touch-os panel.
- `examples/hr-diagram-free-roam/` embeds the reusable HR diagram as a
  touch-os panel inside a free-roam SkyKit viewer.

## Touch-OS Bridge

The optional `@found-in-space/skykit/touch-os` subpath wires touch-os HUD
outputs into SkyKit actions. It keeps richer panel rendering in touch-os while
removing repeated app glue for action buttons and status displays.

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
