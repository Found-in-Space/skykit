# SkyKit Core Composition

Status: current alpha package documentation for `@found-in-space/skykit`.

Core SkyKit is the teachable composition layer for the focused
`@found-in-space/*` packages. It should make common lessons and demos small, but
it should not become the owner of data loading, star interpretation, renderer
internals, scientific instruments, sidecars, XR embodiment, or touch surfaces.

The short version:

```txt
packages own reusable implementations;
core skykit owns teachable composition.
```

Read this with [`package-learning-architecture.md`](./package-learning-architecture.md)
for the lesson path and [`alpha-rules.md`](./alpha-rules.md) for package-boundary
rules.

## Purpose

`@found-in-space/skykit` provides:

```txt
viewer shell
plugin and part lifecycle
scene roots and anchoring
view-state batching
action/context registry
streaming star layer/plugin
plain Object3D layer/plugin
desktop learning navigation
optional browser parallax controls
status helper
animation loop helper
debug bridge
browser embed and add-on convenience
touch-os bridge
```

It composes other packages through public objects and functions:

```txt
star-octree-provider -> streams star cells
spatial              -> owns coordinates, targets, routes, and navigation math
three-star-field     -> renders star cells in Three.js
star-map-canvas      -> renders 2D starmaps
star-trees           -> stores and interprets star cells
skykit/xr            -> owns WebXR rig/input/rays/session helpers
touch-os             -> owns panels, HUDs, and visual surfaces
```

SkyKit should not inspect individual stars during normal streaming, rebuild
cumulative render arrays, or hide hardcoded loader/renderer registries behind
string names.

Star loading strategies are part of the shared star-data contract, not SkyKit
registries. SkyKit may pass strategy objects or strategy-producing functions to
provider sessions, but it must not redefine provider planning, inspect a closed
set of strategy kinds, or require SkyKit/core changes for application-specific
strategy behavior.

When SkyKit code needs to pass star identity through selections, bookmarks, or
app-owned payloads, it should use `StarObjectRef` from
`@found-in-space/star-trees`. Cell-level keys should come from
`createStarCellKey()`. SkyKit must not invent another star ID shape or expose
octree storage details such as `nodeKey`, `shardOffset`, `nodeIndex`,
`payloadOffset`, or `payloadLength`.

## Extension Model

The extension surface is object/function based.

```js
const viewer = await createSkykitViewer({
  host,
  view: { coordinateUnitsPerParsec: 0.001 },
  plugins: [
    createStreamingStarsPlugin({
      provider,
      renderer: createThreeStarField(),
      session: { strategy: createObserverShellStrategy() },
    }),
    createObject3dPlugin({
      id: 'radio-bubble',
      object3d: bubbleGroup,
      anchorMode: 'world-space',
    }),
  ],
});
```

Named presets may exist as thin teaching conveniences, but they must wrap the
same public factories. SkyKit should not become a central registry for every
renderer, loader, surface, and data type.

## Browser Embed And Add-Ons

The browser embed is the static-page/CMS path for learners who do not want to
write a full app yet. It installs a small `Skykit` global:

```js
const browser = await Skykit.whenReady();
const second = await Skykit.whenReady('#second-viewer');
```

`Skykit.whenReady(selectorOrElement?)` resolves to a `SkykitBrowser`. With no
argument, it returns the first started browser; selector/element targeting is
for pages with multiple viewers.

Browser add-ons are plain script-tag conveniences:

```js
Skykit.registerBrowserAddon({
  id: 'example:marker',
  install({ browser, THREE }) {
    const marker = new THREE.Object3D();
    const handle = browser.addObject(marker);
    return () => handle.dispose();
  },
});
```

`install(context)` receives `{ host, browser, viewer, THREE, skykit }`.
The optional `id` is diagnostic and used for per-browser de-duping. It is not a
factory name or registry key. Add-ons install ordinary plugins or use the
browser handle; they do not replace the core plugin model.

First-party browser capabilities are lazy-loaded by the browser handle. The
current built-in capability is constellation loading and optional anchored art:

```html
<div
  data-skykit-browser
  data-skykit-constellations="western"
  data-skykit-constellation-art="lazy"
></div>
```

Standalone applications that already compose SkyKit plugins should use package
APIs directly instead of importing `@found-in-space/skykit/browser-constellations`
as a data API.

The browser embed only reads the documented `data-skykit-*` attributes from
`@found-in-space/skykit`'s README. Other viewer setup belongs in
`createSkykitBrowser({ ... })` options or the lower-level `createSkykitViewer()`
composition path.

## Viewer Lifecycle

The viewer owns a deterministic lifecycle:

```txt
setup plugins
attach parts
start parts
frame update
beforeRender
render
afterRender
resize
dispose in reverse ownership order
```

Parts are small lifecycle objects. They may be renderers, stream consumers,
controls, overlays, status helpers, panels, or application-owned objects.

```ts
interface SkykitPart {
  id?: string;
  priority?: number;
  attach?(context: SkykitPluginContext): void | Promise<void>;
  start?(context: SkykitPluginContext): void | Promise<void>;
  update?(frame: SkykitFrameData): void;
  beforeRender?(frame: SkykitFrameData): void;
  afterRender?(frame: SkykitFrameData): void;
  resize?(size: SkykitSize): void;
  dispose?(): void | Promise<void>;
}
```

Lower `priority` values run first. Plugins can add parts through
`ctx.addPart(part)`.

## Plugin Context

Plugins receive a context that exposes public hooks only:

```txt
addPart(part)
addDisposable(disposable)
getViewState()
requestViewState(patch, reason?)
on(eventName, listener)
emit(eventName, payload)
useStore(key, factory)
useResource(key, factory)
scheduleTask(task, options?)
actions
```

This is the main "hack here" surface for learners. A custom plugin should not
need private viewer internals to add markers, react to star cells, install
controls, or publish status.

High-throughput star data should flow through provider sessions, cell stores,
and renderer handles. The event bus is for coordination and UI/status signals,
not one event per star.

## Streaming Stars

SkyKit's streaming star plugin is glue:

```txt
view state
  -> provider session update
  -> StarCellDelta stream
  -> renderer.apply(delta)
```

It does not merge cells itself. The provider owns live cell replacement, and the
renderer owns its aggregate geometry or projected view.

The layer should pass through:

- `stars/cells-upsert`
- `stars/cells-remove`
- `stars/current`
- `stars/error`

It should not introduce SkyKit-specific star lifecycle events or support the old
star batch API.

The current streaming helper is centered on one octree provider. The accepted
[multiple-provider direction](./multiple-star-providers.md) keeps octree,
static reference, scenario, and session providers as independent lanes whose
products can be composed without merging their source datasets or discarding
provider identity.

## Actions

SkyKit has a small semantic action registry. It is for shared commands and held
controls, not for factory lookup or component discovery.

```txt
skykit:* is reserved for SkyKit-defined semantics
game:* / lesson:* / website:* are application or plugin namespaces
```

Examples:

```txt
skykit:ship.move.forward
skykit:ship.attitude.rollClockwise
skykit:viewer.reset
skykit:navigation.transitionTo
website:chapter.goTo
game:weapons.fire
lesson:highlight.next
```

Plugins register actions through `ctx.actions.registerAction()` or
`ctx.actions.registerContext()`. Multiple handlers may share an action ID; they
run in priority order. This lets keyboard, touch DOM, touch-os, WebXR, debug
tools, and app-owned chapter buttons call the same semantic action without
faking keypresses.

## Touch-OS Action Boundary

The optional `@found-in-space/skykit/touch-os` subpath adapts the published
`@found-in-space/touch-os@0.3.0` host contract. The normal SkyKit entrypoint does
not load touch-os, so composition that does not use surfaces does not need the
optional peer.

Touch-os remains the source of runtime outputs; SkyKit chooses whether any of
those outputs enter its semantic action registry. Both HUD and panel plugins
accept the same policy:

```txt
raw-actions (default)
  route top-level action outputs, including held start/stop phases

app-actions
  route only outer app-event outputs containing a validated app-action name
  forward the inner payload and ignore forwarded raw component actions

none
  do not route outputs into the action registry
```

When supplied, `onOutput` observes every runtime output exactly once regardless
of the policy. An app using `app-actions` should update app-owned state from
events such as `app-change` in its callback, while registered SkyKit action
handlers execute commands. It should not also execute the same `app-action` in
that callback.
Held app actions use a stable source derived from their app, window, instance,
and action identity so pointer cancellation releases the matching press.

The bridge translates a `SkykitThreeFrame` into the touch-os host contract
before one driver update per part update. Host frames, DOM edges, XR samples,
pointer clearing, and cancellation all use `frame.elapsedSeconds * 1000`; the
touch-os driver owns the one runtime tick. SkyKit-aware callbacks are resolved
before that boundary. Raw touch-os pointer sources continue to receive
`ThreePanelHostFrame`, while `createSkykitTouchOsPointerSource()` and the
`skykitPointerSources` option expose the complete SkyKit frame without a
latest-frame side channel.
Pointer sources, parent resolution, and surface metrics use those top-level
bridge options; `driverOptions` remains limited to host presentation settings
so input cannot bypass clock normalization.

Detach is reversible. Explicit `clearPointer()` and detach/final cleanup drain
cancellation output before references are dropped. Plugin-created runtimes and
drivers are owned; caller-supplied runtimes, drivers, and pointer/ray sources
are borrowed by default. The runtime and driver defaults can be overridden with
the explicit `disposeRuntime` and `disposeDriver` options, but supplied pointer
sources are never disposed implicitly.

When supplying a driver, the caller also supplies the same runtime used to
construct it and configures the driver's pointer sources and construction
options beforehand. The bridge rejects conflicting construction options rather
than silently ignoring them.

Panel blocker queries preserve the interaction boundary. `blockRay()` raycasts
the current public panel mesh for the supplied XR ray and applies both finite
distance limits without dispatching touch input or changing capture.
`getHit()` remains cached current-pointer inspection and is not used as an
arbitrary-ray answer.

## Optional HR Surface Composition

The ordinary `@found-in-space/hr-diagram` entrypoint exports
`createHrDiagramSurfaceSource()`, a Three texture source that does not import
touch-os. Core `createSkykitHrDiagramPlugin()` composes that source and the HR
data/rendering lifecycle. It does not manufacture a touch-os node.

Touch-aware applications create a root through
`@found-in-space/hr-diagram/touch-os` and pass it as `touchOs.root`. That optional
adapter delegates title, padding, clipping, fallback, and contain/stretch
geometry to touch-os's public embedded-surface component. Without a supplied
root, `getNode()` returns `null`; the texture source and HR renderer remain
usable independently.

## Boundary

Keep the package responsibilities narrow:

- `star-octree-provider` owns octree source, planning, sessions, and cell deltas.
- `star-trees` owns star identity, cell stores, iteration, and star math.
- `three-star-field` owns the Three.js star renderer.
- `star-map-canvas` owns projected Canvas2D sky maps.
- `hr-diagram` owns temperature/magnitude projection and rendering.
- `spatial` owns coordinate, pose, route, and navigation helpers.
- `skykit` composes these pieces into viewers and lessons.

If it is data loading, star interpretation, shader implementation, instrument
logic, chapter authoring, camera timelines, WebXR embodiment, touch UI, sidecar
lookup, or app gameplay, it belongs outside core SkyKit unless there is a clear
thin composition helper to expose.
