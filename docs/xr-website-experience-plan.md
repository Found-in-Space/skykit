# SkyKit XR Beginner Experience Plan

Status: pre-v1 SkyKit interface planning for the pseudo-stable beginner and XR
surface. This is not a website overhaul plan by itself. The next work should
stabilize a feature-rich, beginner-friendly SkyKit interface that the website
can later expose as the public learning path.

This plan describes the beginner-facing XR direction for SkyKit. The goal is not
to hide the package architecture behind a monolithic viewer. The goal is to make
the first useful XR experience small and approachable, then let advanced authors
keep composing the same public pieces: viewer, XR rig/session, products, layer
hosts, touch-os surfaces, spatial navigation, star providers, sidecars, inspect
tools, and app plugins.

Read this with [`xr-architecture.md`](./xr-architecture.md) for the low-level XR
boundary and [`skykit-core-composition.md`](./skykit-core-composition.md) for the
plugin, action, layer, and browser embed model.

## Website Review Baseline

Reviewing the current `../website` implementation changes the planning baseline:

- The website is the beginner public path. Its current SkyKit path lives in
  `../website/src/pages/learn-build/skykit/index.astro`, with runnable examples
  under `../website/src/live-examples/skykit/`. SkyKit repository examples are
  development examples or advanced-use examples unless the website deliberately
  promotes them.
- The current website already teaches a good progression: paste a browser
  viewer, move and automate the view, add app-owned objects, query provider
  streams without Three.js, resolve sidecar metadata, and build a small 2D app.
  The individual lessons in `../website/src/pages/learn-build/skykit/` and
  their live examples make this ladder concrete. SkyKit should preserve that
  ladder instead of replacing it with an XR-only path.
- The website Build pages in `../website/src/pages/build/` already expose
  catalogue download, Gaia/Hipparcos merging, quality flags, overrides, spatial
  indexing, and browser streaming. SkyKit should link to and support that
  reproducibility story; it does not need to own pipeline documentation.
- Public topic viewers in `../website/src/pages/learn/topic/` and
  `../website/src/scripts/*viewer.js` use app-authored scene targets and
  lesson-specific coordinates. Those are application/domain data, not SkyKit
  data. SkyKit should provide clear ICRS/parsec/RA-Dec target contracts and
  inspection hooks, but it should not own curated website lesson coordinates.
- There is no public website XR path yet. The current public SkyKit examples are
  browser/data examples built around `data-skykit-browser`, package imports,
  live notebooks, and app-owned scripts. The next SkyKit work should therefore
  stabilize the beginner facade before the website exposes it as public XR
  learning material.
- Debug and inspect tools are not just developer conveniences. They are part of
  the educational experience: learners should be able to see what data is loaded,
  what frame of reference is active, which strategy is streaming cells, what star
  or layer is selected, and which action changed the world.

## Direction

SkyKit XR should have two explicit paths:

```txt
beginner facade
  paste a host element, status target, optional attributes, and one module script
  -> get stars, XR session entry, default navigation, status, resize/lifecycle
  -> inspect data, selections, actions, and view state
  -> keep a live handle for small add-ons and lesson controls

advanced
  import package APIs
  -> create or customize renderer, provider, XR composition, layers, touch apps,
     navigation, journeys, and app-owned products directly
```

The beginner facade must be thin. It should call the same public factories an
advanced app would call, register the same actions, publish the same products,
install ordinary plugins, and expose inspectable handles. It should not
introduce hidden string registries, private controller calls, fake keypresses, or
a separate XR-only wrapper architecture.

There is a third category: development and advanced examples in this repository.
Those examples may show diagnostics, package internals, fake-XR harnesses, and
larger composition patterns. They should not be treated as the public beginner
path until a website lesson intentionally curates them.

## Quickstart Target

The future website lesson should be able to start from a shape close to the
current browser embed. SkyKit should support this shape before the website
overhaul depends on it:

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
- the ready handle exposes an intentional inspect/debug surface for teaching:
  loaded cells, current products, selected object, active frame of reference,
  view state, action sources, stream status, and sidecar lookup state where
  available.
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

The current website SkyKit path adds another important teaching sequence that
the XR work should preserve:

```txt
viewer first
  -> paste an embed, then get a browser handle

semantic movement
  -> use actions and targets, not camera mutation

data without renderer
  -> stream cells, request attributes, inspect deltas, build app-owned rows

metadata on demand
  -> bootstrap dataset id, derive sidecar URL, resolve StarObjectRef labels

small app
  -> own projection, drawing, interaction, labels, and settings
```

XR should not skip this ladder. It can add embodiment, rays, controller input,
depth, and panels, but the same data concepts and application ownership should
remain visible.

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

### Inspect And Selection

Inspection is a teaching feature. SkyKit should make the runtime legible without
requiring learners to read private state or use browser devtools. This applies
to desktop, 2D/data examples, 3D viewers, and XR.

The beginner handle should expose a small inspect surface that can report:

- package and dataset identifiers.
- current view state: `observerPc`, target or orientation, limiting magnitude,
  field of view, scale profile, and coordinate units per parsec.
- active star stream/session status: strategy name or strategy object summary,
  requested attributes, cells loaded, star count, current/error state, and
  retained cells during transitions.
- active products, layer ids, pick targets, pick blockers, and demand summaries.
- current selection: selected star, layer object, waypoint, route, or authored
  object.
- action trace: recent semantic action ids, sources, payload summaries, and
  cancellation/arrival state.
- XR state when present: support, session state, reference space, controller
  bindings, active rays, blocker hits, and depth range.

Star selection should be consistent across paths. A star picked in desktop, 2D,
3D, or XR should be able to resolve the same public identity and metadata shape:

```txt
pick hit
  -> StarObjectRef when available
  -> semantic cell key + ordinal fallback
  -> sidecar lookup when configured
  -> label/facts policy owned by the app or facade
```

The current XR star-picking event shape must not stop at
`cellKey:objectIndex` for beginner-facing examples. XR picking should expose the
same identity and optional sidecar enrichment path used by the website sidecar
and 2D app lessons. It may keep low-level pick details for advanced uses, but
the beginner path needs a label/facts pipeline that teaches catalogue identity
instead of storage detail.

Debug globals may still exist for development, but the public inspect feature
should be explicit, documented, and available through ordinary handles, actions,
or products.

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
- map continuous XR axes onto the same ship/navigation control values and
  semantic actions used by keyboard, touch, and automation. Controller plugins
  may update view state internally, but the public model should remain
  inspectable as `skykit:ship.*` and `skykit:navigation.*` behavior rather than
  an XR-only movement vocabulary.
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

Curated lesson coordinates and story-specific route targets are application
domain data. SkyKit should not own those manifests or decide their provenance
policy. SkyKit should make them easy to use responsibly by accepting explicit
ICRS parsec targets, RA/Dec/distance targets, app-resolved bookmarks, units, and
frame labels, then exposing them through inspectable actions, products, picks,
and waypoints.

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
  inspect: SkykitInspectFacade;
  selection: SkykitSelectionFacade;
}
```

The important part is not the exact interface shape. The important part is that
the quickstart handle is a friendly facade over the same viewer, VR preset,
actions, products, inspect surface, selection model, and layer host that
advanced code already uses.

## Implementation Phases

1. Beginner facade baseline

   Stabilize the beginner-facing SkyKit facade before the website overhaul
   depends on it. The facade should work for desktop browser viewing first, then
   grow into XR without changing the extension ladder: attributes, readiness,
   installable plugins/add-ons, app-owned objects/layers, actions, products,
   status, inspect, and selection.

2. Inspect and selection parity

   Create the shared inspect/selection model that can be used by 2D data
   examples, desktop 3D viewers, and XR. Include star identity, sidecar-enriched
   labels/facts, layer picks, current products, stream status, view state, action
   trace, and XR session/ray details where available.

3. Browser-grade XR preset

   Add an XR preset and optional embed entry that can create an XR-capable viewer
   from DOM attributes or package options, report status, install a user-gesture
   Enter VR control, register readiness, and keep desktop fallback behavior
   useful. The preset should be recreatable with direct package imports.

4. Layer quickstart capabilities

   Make constellations, meridian/grid overlays, and simple authored spatial
   objects installable without private code. Keep richer app examples on direct
   package composition. Do not move app-authored coordinates or lesson manifests
   into SkyKit.

5. Touch-os bridge examples

   Show the smallest touch-os app mounted into XR, then show how an advanced app
   owns its app registry, routes actions, and publishes products. Resolve the CDN
   dependency story before publishing this as a pasteable lesson.

6. Journey hooks

   Build a small journey plugin over public actions/events/products. It should
   demonstrate automated travel, highlighted targets, nearby facts, and an
   interchangeable delivery surface.

7. Documentation, examples, and website readiness

   Keep repository examples categorized as development or advanced package
   examples. Publish website lessons later, once the SkyKit facade is stable
   enough to be the beginner public path. Add fake-XR, DOM, and smoke tests for
   embed startup, status, session entry binding, global readiness, inspect,
   selection, sidecar lookup, and plugin/layer installation.

## Success Criteria

- SkyKit has a pseudo-stable beginner facade that works as a teaching surface
  before the next website overhaul consumes it.
- A static page can create an XR-capable star viewer with one host element, one
  status target, and one module script.
- The quickstart provides a compliant user-gesture path into WebXR and a readable
  fallback when WebXR is unavailable.
- Desktop, 2D/data, 3D, and XR paths share the same mental model for viewer
  handles, semantic actions, products, selection, sidecar metadata, and
  inspection.
- Inspect/debug is explicit and beginner-usable: learners can see dataset ids,
  loaded cells, requested attributes, selected refs, labels/facts, active
  products, view state, action sources, stream status, and XR session/ray state.
- XR star picking exposes public star identity and optional sidecar enrichment
  rather than only storage-derived labels.
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
- Repository examples are clearly categorized as development examples or
  advanced-use examples. The beginner public path is curated later in the
  website, using the stabilized SkyKit facade.

## Open Decisions

- Should the side-effect entry be `@found-in-space/skykit/xr-embed`, an extension
  of `@found-in-space/skykit/embed`, or both?
- Should the auto-created Enter VR control be injected into the host, adjacent to
  the host, or always supplied by an author-selected button?
- Should `Skykit.whenReady()` return both desktop and XR browser handles, or
  should XR use a distinct readiness namespace?
- What is the smallest stable `inspect` facade shape, and which details remain
  debug-only development output?
- What is the smallest stable `selection` facade shape for star refs, layer
  objects, authored waypoints, XR rays, and sidecar-enriched facts?
- Which sidecar label/facts policy should be first-party beginner behavior, and
  which formatting choices should stay app-owned?
- Which infinity layers should be first-party quickstart capabilities versus
  package examples?
- What exact product-key conventions should the first journey examples use for
  facts, highlights, active selections, and route state?
- Which guided-journey hooks belong in core SkyKit, and which belong in a
  website/app-owned journey plugin?
