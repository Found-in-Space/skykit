# SkyKit Constellations

Status: current alpha constellation loading guidance.

SkyKit has two supported constellation paths. Use the browser capability for
pasteable/static-page viewers. Use the published skyculture package APIs when an
application is composing SkyKit plugins itself.

Do not mix the two paths in one example. The browser capability is an
embed-level convenience that fetches a skyculture manifest URL and installs
boundaries/art for a `SkykitBrowser`. The app-composition path imports the
skyculture package and builds ordinary SkyKit anchored-image plugins from
package data.

## Browser Capability

The embed/browser path loads a Stellarium-style skyculture manifest from a URL,
draws constellation boundary lines, and can install anchored art as a lazy
SkyKit plugin.

```html
<div
  data-skykit-browser
  data-skykit-constellations="western"
  data-skykit-constellation-art="lazy"
></div>
```

```js
const browser = await Skykit.whenReady();
await browser.constellations.load({
  skyculture: 'western',
  art: 'lazy',
});

browser.constellations.hide();
browser.constellations.show();
await browser.constellations.setArt('preload');
```

Use this path for no-code embeds, CMS snippets, and simple lessons. It fetches
the skyculture JSON and image assets from the configured manifest/asset URLs.
The implementation lives behind `browser.constellations`; application examples
should not import `@found-in-space/skykit/browser-constellations` as their data
API.

Supported browser/embed constellation attributes:

| Attribute | Meaning |
| --- | --- |
| `data-skykit-constellations` | Presence enables the capability. Use `western` for the bundled default, or provide a manifest URL/`.json` value. Do not use `off`; omit the attribute to disable constellations. |
| `data-skykit-constellation-manifest` | Explicit skyculture manifest URL. This is useful when the `data-skykit-constellations` value is only a label. |
| `data-skykit-constellation-assets` | Base URL for image assets referenced by the manifest. Defaults to the manifest directory. |
| `data-skykit-constellation-art` | `off` by default; `lazy`, `on`, or `true` install art lazily; `preload` loads all art textures. |

The browser path also supports the general embed attributes documented in
[`../packages/skykit/README.md`](../packages/skykit/README.md), such as
`data-skykit-observer`, `data-skykit-look-at`, and
`data-skykit-persistent-cache`.

## Application Composition

Standalone apps should import the published skyculture package directly, then
compose ordinary SkyKit anchored-image plugins.

```js
import {
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createViewAnchoredImageController,
} from '@found-in-space/skykit';
import { createAnchoredImageManifest } from '@found-in-space/stellarium-skycultures-western/anchored-image';
import { bundledManifest } from '@found-in-space/stellarium-skycultures-western/bundled';

const WESTERN_SKYCULTURE_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@found-in-space/stellarium-skycultures-western@x.y.z/dist/';

const catalog = await createAnchoredImageCatalog({
  manifest: createAnchoredImageManifest({
    baseUrl: WESTERN_SKYCULTURE_ASSET_BASE,
  }),
});

const artPlugin = createAnchoredImageSkyPlugin({
  id: 'constellation-art',
  catalog,
  controller: createViewAnchoredImageController({
    strategy: 'nearest',
    maxAngleDeg: 60,
  }),
  loading: 'lazy',
});

// Keep the richer skyculture manifest for app UI, sidebars, and descriptions.
const skycultureMetadata = bundledManifest;
```

The `anchored-image` subpath gives render-ready art. The `bundled` subpath gives
the richer skyculture metadata, including boundary lines, descriptions, IAU
codes, and common names. Keep those concerns separate: use the anchored image
manifest to render art, and use the bundled skyculture manifest to explain what
the user is seeing.

Apps that deliberately want their bundler to own the art files can import
`anchoredImageManifest` from the same `anchored-image` subpath. Apps that should
load art from a CDN should call `createAnchoredImageManifest({ baseUrl })`.
Passing an explicit CDN `baseUrl` also avoids development-server URL rewriting
bugs where dependency-optimized asset URLs can fall through to HTML responses.
Pin `x.y.z` to the published skyculture package version your site depends on.

This package-composition path is the current pattern used by:

- `apps/examples/free-roam/`
- `apps/examples/xr-free-roam/`
- [`found-in-space.github.io/src/scripts/free-roam-viewer.js`](https://github.com/Found-in-Space/found-in-space.github.io/blob/main/src/scripts/free-roam-viewer.js)
- [`found-in-space.github.io/src/scripts/parallax-viewer.js`](https://github.com/Found-in-Space/found-in-space.github.io/blob/main/src/scripts/parallax-viewer.js)

Older website scripts that import legacy constellation helpers directly from
`@found-in-space/skykit` are historical reference material, not the current
alpha package API.

## Metadata Names

Use IAU codes as keys. Use skyculture names as display text.

For the western skyculture, `common_name` follows the Stellarium data shape:

```json
{
  "iau": "Ori",
  "common_name": {
    "english": "Hunter",
    "native": "Orion"
  }
}
```

`common_name.native` is the name used by the skyculture and should be the
default display label. `common_name.english` is a translated gloss or meaning.
For Orion, that gloss is "Hunter"; showing it as the primary name is wrong for
normal constellation UI.

Use this fallback order in examples and app sidebars:

```js
const name =
  constellation.common_name?.native
  ?? constellation.common_name?.english
  ?? anchoredImageEntry.label
  ?? constellation.iau;
```

`anchoredImageEntry.label` from the published anchored-image manifest already
uses this native-first rule. When joining art entries back to skyculture
metadata, join on `metadata.iau`, `groupId`, or `iau`; do not join on display
labels.
