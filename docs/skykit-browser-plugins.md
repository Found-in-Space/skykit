# SkyKit Browser Plugins

Status: alpha browser/noob extension contract for `@found-in-space/skykit/embed`.

SkyKit has two plugin layers:

- **Core plugins** are ordinary functions or objects passed to
  `createSkykitViewer()` or `createSkykitBrowser({ plugins })`.
- **Browser add-ons** are embed/noob conveniences. They discover browser handles
  created by the pasteable script and install core plugins or expose small
  beginner APIs.

The core plugin model remains the durable package API. Browser add-ons are for
static pages, CMS snippets, lessons, and one-script beginner examples.

## Browser Global

The embed script installs a small global:

```js
const browser = await Skykit.whenReady();
const second = await Skykit.whenReady('#second-viewer');
```

`Skykit.whenReady(selectorOrElement?)` resolves to a `SkykitBrowser`. The
existing `skykit-browser-ready` DOM event is still emitted for compatibility.

Multiple viewers are supported. With no argument, `whenReady()` resolves to the
first started browser. Pass a selector or element when a page has more than one.

The embed enables persistent browser Cache API storage for octree range and
decoded payload reuse by default. Static pages can opt out per viewer:

```html
<div data-skykit-browser data-skykit-persistent-cache="off"></div>
```

## Browser Add-On Contract

A browser add-on is plain code:

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

`install(context)` receives `{ host, browser, viewer, THREE, skykit }`.
The optional `id` is only for diagnostics and per-browser de-duping; it is not a
factory name or registry key.

Add-ons may load before or after the base embed. If an add-on script needs to
run first, it can queue itself:

```js
globalThis.Skykit ??= {};
globalThis.Skykit.browserAddons ??= [];
globalThis.Skykit.registerBrowserAddon ??= (addon) => {
  globalThis.Skykit.browserAddons.push(addon);
};

Skykit.registerBrowserAddon(myAddon);
```

When the embed loads, it upgrades that queue into the real registry and applies
queued add-ons to current and future browsers.

## First-Party Capabilities

First-party browser capabilities are lazy-loaded by the base embed/browser
handle. The learner still uses one script include, while optional code and data
load only when requested.

Constellations:

```html
<div
  data-skykit-browser
  data-skykit-constellations="western"
  data-skykit-constellation-art="off"
></div>
```

The constellation capability fetches the skyculture manifest on demand, renders
boundary lines, and can lazy-load anchored art when requested:

```js
const browser = await Skykit.whenReady();
await browser.constellations.setArt('lazy');
browser.constellations.hide();
browser.constellations.show();
```

This is the browser/embed loading path. It is meant for pasteable pages and
small lessons, and the browser handle owns manifest fetching and art plugin
installation. Standalone apps that are already composing SkyKit plugins should
use the published skyculture package APIs instead:

```js
import { createAnchoredImageManifest } from '@found-in-space/stellarium-skycultures-western/anchored-image';
import { bundledManifest } from '@found-in-space/stellarium-skycultures-western/bundled';
```

In that app-composition path, build art with
`createAnchoredImageManifest({ baseUrl })` and keep `bundledManifest` for UI
metadata. Display names should prefer `common_name.native` before
`common_name.english`; the western skyculture uses values such as
`{ english: 'Hunter', native: 'Orion' }`, where the English value is a gloss.
See [`constellations.md`](./constellations.md) for the full rules and examples.

Navigation:

```js
import {
  createRaDecLookAt,
  createSkykitNavigationPlugin,
} from '@found-in-space/skykit';

const browser = await Skykit.whenReady();
await browser.install(createSkykitNavigationPlugin());
const alnilam = createRaDecLookAt('05h 36m 12.81s', '−01° 12′ 06.9″');

await browser.viewer.actions.invoke('skykit:navigation.transitionTo', {
  view: { lookAt: alnilam },
  movement: { durationSecs: 3 },
});
```

Named chapters belong to the website or lesson script. Keep the chapter table
in app code and have each chapter call viewer actions directly.

## Core Plugin Installation

The browser handle can install a core plugin after startup:

```js
const browser = await Skykit.whenReady();

const uninstall = await browser.install((ctx) => {
  ctx.actions.registerAction('lesson:reset-view', () => {
    ctx.requestViewState({ lookAt: { raHours: 4.496, decDeg: 16.948 } });
  });
});
```

Use this when a lesson grows beyond the first-party browser capabilities but
does not yet need to switch to the full `createSkykitViewer()` composition path.
