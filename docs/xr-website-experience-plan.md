# SkyKit XR Website Experience Plan

Status: branch planning document for the next public SkyKit XR lesson.

This plan describes the website-facing XR direction for SkyKit. The goal is not
to hide the package architecture behind a monolithic viewer. The goal is to make
the first useful XR experience small, then let advanced authors keep composing
the same public pieces: viewer, XR rig/session, products, layer hosts, touch-os
surfaces, spatial navigation, star providers, and app plugins.

Read this with [`xr-architecture.md`](./xr-architecture.md) for the low-level XR
boundary and [`skykit-core-composition.md`](./skykit-core-composition.md) for the
plugin, action, layer, and browser embed model.

## Direction

SkyKit XR should have two explicit paths:

```txt
quickstart
  paste a host element, status target, optional attributes, and one module script
  -> get stars, XR session entry, default navigation, status, resize/lifecycle
  -> keep a live handle for small add-ons

advanced
  import package APIs
  -> create or customize renderer, provider, XR composition, layers, touch apps,
     navigation, journeys, and app-owned products directly
```

The quickstart must be thin. It should call the same public factories an
advanced app would call, register the same actions, publish the same products,
and install ordinary plugins. It should not introduce hidden string registries,
private controller calls, or a separate XR-only wrapper architecture.

## Quickstart Target

The public lesson should be able to start from a shape close to the current
browser embed:

```html
<div
  data-skykit-xr
  data-skykit-status="#skykit-status"
  data-skykit-look-at="05h 36m 12.81s, -01deg 12m 06.9s"
  style="width:100%;height:500px;background:#02040b"
></div>

<pre id="skykit-status">Loading stars...</pre>

<script
  type="module"
  src="https://esm.sh/@found-in-space/skykit@x.y.z/xr-embed?bundle&deps=three@0.170.0"
></script>
```

The exact entrypoint and attribute names can change, but the learner promise is:

- a static-page or CMS user can paste a working XR-capable sky viewer.
- the page gets an explicit WebXR user-gesture control. This may be an injected
  Enter VR button or a button selected by an attribute.
- the same status target can report star loading, XR availability, session state,
  and actionable errors.
- `Skykit.whenReady(...)` or an equivalent global readiness hook returns a live
  handle for small customizations.
- desktop viewing remains useful when immersive WebXR is unavailable.

## Alignment With The 2D/Browser Viewer

The XR quickstart should feel like the current browser viewer grown into XR, not
like a second product with different extension rules. The current browser viewer
has three tiers that should carry over:

```txt
no-code attributes
  -> data-skykit-* startup options and first-party capabilities

small hooks
  -> Skykit.whenReady(...), registerBrowserAddon(...), browser.install(...)

advanced composition
  -> createSkykitBrowser(...), createSkykitViewer(...), hosted layers, products,
     plugins, package-owned data and rendering
```

XR should preserve that shape:

- shared attributes such as `data-skykit-status`, `data-skykit-observer`,
  `data-skykit-look-at`, `data-skykit-magnitude`,
  `data-skykit-persistent-cache`, and first-party capability attributes should
  keep the same meanings where XR supports them.
- first-party capabilities should be lazy and facade-backed. Constellations are
  the model: an embed attribute can request them, while the ready handle can
  still call `constellations.load()`, `show()`, `hide()`, `toggle()`, and
  `setArt()`.
- script-tag add-ons should remain small hooks over ordinary plugins and handles.
  An XR add-on context may expose extra XR handles, but it should still include
  the familiar `{ host, browser, viewer, THREE, skykit }` shape.
- larger examples should switch to package imports and direct composition rather
  than accumulating more `data-skykit-*` attributes.

The quickstart handle should therefore expose the same conceptual affordances as
`SkykitBrowser`: install a plugin or add-on, add a simple object or layer, reach
the underlying viewer/actions, and use named first-party capability facades. XR
adds session entry, rays, rig/body handles, and layer-host/pick-router handles;
it should not change the basic extension ladder.

## Advanced Path

The advanced path should stay visibly composable:

```js
import { createSkykitVrViewer } from '@found-in-space/skykit/xr';
import { createSkykitXrTabletPanelPlugin } from '@found-in-space/skykit/touch-os';

const vr = await createSkykitVrViewer({
  host,
  view,
  stars,
  layers: [constellationLayer, meridianLayer, hailMaryRedDwarfLayer],
  plugins: [
    createSkykitXrTabletPanelPlugin({ apps }),
    journeyPlugin,
    customNavigationBehavior,
  ],
});
```

This is the path for applications that need to own package imports, asset URLs,
content packaging, rendering policy, or lesson-specific behavior. It should not
need private imports from SkyKit internals.

## Capability Goals

### Touch-OS Applications

XR should make it easy to mount touch-os applications without making XR own
their UI model. SkyKit should provide the bridge between XR rays, panel
placement, action routing, and SkyKit products. Apps should remain ordinary
touch-os apps.

Quickstart can offer a small installation convention for common app bundles, but
the durable API should be plugin-based:

```txt
touch-os app registry
  -> SkyKit XR panel plugin
  -> XR rays and blocker products
  -> semantic SkyKit actions and app-owned products
```

CDN examples need an explicit dependency story for `@found-in-space/touch-os`.
Base XR viewing should not force touch-os into every embed.

### Navigation And Behavior

Navigation changes should be made through semantic actions and public navigation
options, not fake keypresses or private rig mutation.

Required hooks:

- configure move/turn speeds, reference frames, deadzones, and enabled inputs.
- add or replace controller mappings through public XR control bindings.
- invoke `skykit:navigation.*` actions for fly-to, route-follow, orbit, look-at,
  reset, and scripted travel.
- listen for navigation progress, arrival, cancellation, manual override, and
  current target changes.
- allow app plugins to temporarily lock, redirect, or annotate navigation for a
  chapter without owning the XR session implementation.

### Infinity Layers

"Infinity" layers are observer-centric or direction-field layers that behave as
sky context rather than nearby physical objects. Examples include constellation
art, constellation boundaries, meridian lines, equatorial grids, ecliptic guides,
and other sky-coordinate overlays.

These should compose as layer-host inputs or plugins that:

- anchor to sky directions or observer-centric roots.
- avoid forcing star provider/session changes.
- expose visibility, style, and pick/block behavior through public handles.
- work in desktop preview and immersive XR.
- can be toggled by touch-os, script, chapter state, or simple embed attributes.

Constellations should keep the current two-path rule. Static pages use the
browser/XR capability facade and attributes. Advanced apps import skyculture or
anchored-image package APIs and install ordinary layers. Both paths should
publish the same product shapes when enabled:

```txt
features:constellations/<skyculture>
waypoints:constellations/<skyculture>
surfaces:constellation-art/<skyculture>
```

Meridian lines, coordinate frames, and grids should follow the same pattern:
simple first-party capability when useful for lessons, direct hosted-layer
composition for application code, and product publication such as
`features:frames/<frame>` and `waypoints:frames/<frame>`.

### Spatial Layers

Spatial layers are content that has a meaningful position, scale, or route in
the world. Examples include extra authored stars, the red dwarf for the Hail Mary
website journey, nebulae, H-alpha or dust structures, and an ultra-large-scale
Milky Way illustration.

These should not be folded into the star octree provider. They should be product
or provider lanes that applications compose beside the star source:

```txt
Gaia star cells
  -> star provider/source/renderer

authored stars, nebulae, galaxy-scale illustration
  -> app or package provider
  -> spatial layer or product
  -> renderer/layer host
```

Required hooks:

- place content in origin-pinned, observer-centric, or scale-banded roots.
- publish pick targets, blockers, labels, bounds, and preload hints.
- coordinate with navigation so authored routes can preload nearby content.
- keep renderers replaceable; SkyKit should not become a registry of nebula,
  galaxy, sidecar, or illustration renderers.

The existing hosted-layer contract is the right shared shape for these layers.
XR layers should be able to use the same hooks:

```txt
setup / attach / start / setView / setState
update / beforeRender / afterRender / resize / detach / dispose
```

and the same layer context:

```txt
addObject3D
provideProduct
addDemand
addPickTarget
addPickBlocker
actions, events, stores, resources, scheduled tasks
```

Layer data should flow through products, sources, and demands rather than a new
XR-only event vocabulary. High-throughput star data stays on star providers,
sources, stores, and renderers. Renderer-independent data examples continue to
use `@found-in-space/skykit/data`; visual layer examples should publish products
such as `features:*`, `waypoints:*`, `surfaces:*`, `stars:*`, or app-owned keys
and consume them through `productRef(...)`.

### Guided Journey Tools

Guided journeys need hooks more than they need a single delivery surface. A
journey may present itself through touch-os, captions, DOM, audio, haptics, or a
website-specific shell. SkyKit should supply the runtime hooks that let those
delivery choices react to and modify the world.

Required hooks:

- authored targets and route segments that invoke SkyKit navigation actions.
- highlighted targets and temporary markers in sky, spatial, or panel layers.
- "nearby interesting facts" providers keyed by star refs, spatial regions, or
  authored waypoints.
- events for journey step start/end, arrival, target focus, user detour, star
  pick, layer pick, and fact availability.
- a way for narration/audio or touch-os apps to request navigation, pause a
  route, focus a target, show a highlight, or change layer visibility.
- status/debug snapshots that show the current step, target, automation state,
  and loaded content.

The journey controller should be an app/plugin-level composition over actions,
products, and events. It should not be a hidden mode inside the star provider or
XR session plugin.

Journey data should follow the same product pattern as browser layers:

```txt
features:journeys/<id>
waypoints:journeys/<id>
facts:journeys/<id>
selection:primary
```

These keys are conventions, not registries. A website may choose its own keys,
but the examples should make discovery and composition obvious.

## Proposed Package Surface

These names are planning placeholders, not final API commitments.

```txt
@found-in-space/skykit/xr
  createSkykitVrViewer()
  createSkykitXrComposition()
  XR rig/session/ray/navigation/picking helpers

@found-in-space/skykit/xr-embed
  side-effect entry for [data-skykit-xr]
  static-page startup, status, enter control, global readiness

@found-in-space/skykit/touch-os
  optional touch-os bridge and XR panel helpers
```

Candidate handles:

```ts
interface SkykitXrBrowser {
  viewer: SkykitViewer;
  vr: SkykitVrViewer;
  enter(): Promise<SkykitXrSessionHandle>;
  exit(): Promise<void>;
  install(plugin: SkykitPluginInput): Promise<SkykitPluginTeardown>;
  addObject(object3d: THREE.Object3D, options?: SkykitBrowserObjectOptions): SkykitBrowserObjectHandle;
  addLayer(layer: SkykitHostedLayer): SkykitLayerHandle;
  constellations: SkykitBrowserConstellationsFacade;
  actions: SkykitActionRegistry;
  products: SkykitProductRegistryPlugin | null;
}
```

The important part is not the exact interface shape. The important part is that
the quickstart handle is a friendly facade over the same viewer, VR preset,
actions, products, and layer host that advanced code already uses.

## Implementation Phases

1. Browser-grade XR preset

   Add a website entry that can create the XR viewer from DOM attributes, report
   status, install a user-gesture Enter VR control, register readiness, and keep
   desktop fallback behavior useful.

2. Layer quickstart capabilities

   Make constellations, meridian/grid overlays, and simple authored spatial
   objects installable without private code. Keep richer app examples on direct
   package composition.

3. Touch-os bridge examples

   Show the smallest touch-os app mounted into XR, then show how an advanced app
   owns its app registry, routes actions, and publishes products. Resolve the CDN
   dependency story before publishing this as a pasteable lesson.

4. Journey hooks

   Build a small journey plugin over public actions/events/products. It should
   demonstrate automated travel, highlighted targets, nearby facts, and an
   interchangeable delivery surface.

5. Website lessons and verification

   Publish the path as lessons that progress from pasteable XR quickstart to
   advanced composition. Add fake-XR and DOM tests for embed startup, status,
   session entry binding, global readiness, and plugin/layer installation.

## Success Criteria

- A static page can create an XR-capable star viewer with one host element, one
  status target, and one module script.
- The quickstart provides a compliant user-gesture path into WebXR and a readable
  fallback when WebXR is unavailable.
- A learner can add a touch-os app without touching renderer, session, or ray
  internals.
- A learner can change navigation behavior through options, actions, or plugins.
- XR quickstart attributes, readiness, add-ons, status, and capability facades
  follow the same patterns as the browser viewer wherever the concepts overlap.
- Constellations and meridian lines install as infinity layers, not star-provider
  changes.
- Constellations keep the same two-path model: browser/XR capability for
  pasteable pages, package-composed layers for advanced apps.
- Authored stars, nebulae, and Milky Way illustrations install as spatial layers
  or product/provider lanes, not octree extensions.
- Layer hooks, product publication, demands, pick targets, and pick blockers work
  the same in desktop preview and immersive XR.
- A guided journey can listen to world state and invoke navigation, highlighting,
  layer visibility, facts, and audio/panel delivery through public hooks.
- The advanced examples can recreate the quickstart behavior with direct package
  imports and no private SkyKit internals.

## Open Decisions

- Should the side-effect entry be `@found-in-space/skykit/xr-embed`, an extension
  of `@found-in-space/skykit/embed`, or both?
- Should the auto-created Enter VR control be injected into the host, adjacent to
  the host, or always supplied by an author-selected button?
- Should `Skykit.whenReady()` return both desktop and XR browser handles, or
  should XR use a distinct readiness namespace?
- Which infinity layers should be first-party quickstart capabilities versus
  package examples?
- What exact product-key conventions should the first journey examples use for
  facts, highlights, active selections, and route state?
- Which guided-journey hooks belong in core SkyKit, and which belong in a
  website/app-owned journey plugin?
