# SkyKit Core Composition

Status: current alpha package documentation for `@found-in-space/skykit`.

Core SkyKit is the teachable composition layer for the focused
`@found-in-space/*` packages. It should make common lessons and demos small, but
it should not become the owner of data loading, product interpretation, renderer
internals, scientific instruments, sidecars, XR embodiment, or touch surfaces.

The short version:

```txt
packages own reusable implementations;
core skykit owns teachable composition.
```

Read this with [`package-learning-architecture.md`](./package-learning-architecture.md)
for the lesson path and [`alpha-rules.md`](./alpha-rules.md) for package-boundary
rules.

---

## 1. Purpose

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
```

It composes other packages through public objects and functions:

```txt
star-octree-provider -> streams star products
spatial              -> owns coordinates, targets, routes, and navigation math
three-star-field     -> renders star products in Three.js
star-map-canvas      -> renders 2D starmaps
star-products        -> stores and interprets star batches
skykit/xr            -> owns WebXR rig/input/rays/session helpers
touch-os             -> owns panels, HUDs, and visual surfaces
```

SkyKit should not inspect individual stars during normal streaming, rebuild
cumulative render arrays, or hide hardcoded loader/renderer registries behind
string names.

When SkyKit code does need to pass star identity through selections, bookmarks,
or app-owned payloads, it should use `CanonicalObjectRef` from
`@found-in-space/star-products`. Cell-level keys should come from
`createStarCellKey()`. SkyKit must not invent another star ID shape or expose
octree storage details such as `nodeKey`, `shardOffset`, `nodeIndex`,
`payloadOffset`, or `payloadLength`.

---

## 2. Extension Model

The extension surface is object/function based.

Good:

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

Not the core architecture:

```js
createSkykitViewer({
  stars: { renderer: { kind: 'three-star-field' } },
});
```

Named presets may exist as thin teaching conveniences, but they must wrap the
same public factories. SkyKit should not become a central registry for every
renderer, loader, surface, and product type.

---

## 3. Viewer Lifecycle

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

---

## 4. Plugin Context

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
need private viewer internals to add markers, react to products, install controls,
or publish status.

High-throughput star data should still flow through provider sessions, product
stores, and renderer handles. The event bus is for coordination and UI/status
signals, not one event per star.

---

## 5. Action Contexts And Namespaces

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
skykit:journey.goToChapter
game:weapons.fire
lesson:highlight.next
```

The namespace matters because the same word can mean different things in
different frames. `skykit:ship.*` is navigation-rig / spaceship-frame intent.
`head.*` remains body/head-frame territory for XR packages. `journey.*` is for
chapter and time navigation. `layer.*` and `selection.*` are composition-level
commands. These action IDs name behavior, not renderer or loader factories.

Plugins register actions through `ctx.actions.registerAction()` or
`ctx.actions.registerContext()`. Multiple handlers may share an action ID; they
run in priority order. This lets keyboard, touch DOM, touch-os, WebXR, debug
tools, and journey buttons call the same semantic action without faking
keypresses.

`createSkykitJourneyPlugin()` uses this same registry. Interactive journeys
register `skykit:journey.goToChapter`, `next`, and `previous`; timed journeys
register `seek`, `play`, and `pause`; authored view restores can drive
`skykit:navigation.transitionTo` so movement and orientation durations can run
in parallel.

---

## 6. View State

SkyKit view state is the composition-layer signal passed to providers, renderers,
controls, and status helpers.

```txt
observerPc
orientationIcrs
limitingMagnitude
motion
coordinateUnitsPerParsec
scaleProfile
```

`requestViewState()` batches patches so repeated control updates normalize once
per frame. Provider sessions receive the latest relevant state; strategy meaning
stays in `@found-in-space/star-octree-provider`.

---

## 7. Scene Roots And Anchoring

The viewer owns distinct roots:

```txt
originContentRoot
  ICRS/Sun-origin pinned content such as Gaia stars

observerContentRoot
  observer-centric content such as constellation art painted at infinity

scaleBandedContentRoots
  large-scale context layers such as galaxy or structure renderers

navigationRoot
  camera/ship/user navigation transform
```

`contentRoot` may exist as an alias for `originContentRoot`, but code should not
assume one universal content root.

Anchor modes:

```txt
world-space
  mount under originContentRoot

observer-centric
  follow observer translation without inheriting ship/head rotation

scale-banded:<name>
  mount under a named scale root
```

This distinction avoids the common bug where constellation art or infinity-like
layers drift because they were centered on the solar origin instead of the
observer.

---

## 8. Built-In Helpers

The alpha package currently includes:

```txt
createSkykitViewer()
createSkykitActionRegistry()
createObject3dLayer()
createObject3dPlugin()
createStreamingStarLayer()
createStreamingStarsPlugin()
createDesktopSkykitObserverRig()
createKeyboardNavigationPlugin()
createSkykitStatusPlugin()
createSkykitAnimationLoop()
createSkykitDebugBridge()
installSkykitDebugGlobal()
SKYKIT_ACTIONS / SKYKIT_CONTROLS
```

The optional `@found-in-space/skykit/parallax` subpath currently exports:

```txt
createParallaxOffsetInputPlugin()
createParallaxObserverPlugin()
createDeviceTiltTracker()
```

These are learning helpers, not closed presets. Callers can replace the provider,
renderer, strategy, controls, status output, or custom parts.

### Streaming Stars

`createStreamingStarLayer()` composes:

```txt
StarOctreeProviderSession
  -> StarObjectBatchProduct deltas
  -> ThreeStarField renderer
```

It preserves non-cumulative product semantics. The layer does not merge all stars
into one array, does not fetch sidecars, and does not own star interpretation.

### Object3D Layers

`createObject3dLayer()` mounts an app-owned Three object into one of the scene
roots. This is the simplest path for creative plugins such as markers, bubbles,
route previews, or lesson props.

### Plugin Families And Boundaries

Reusable SkyKit plugins should make their reads and writes clear:

```txt
raw input plugins
  browser pointer/touch/tilt, keyboard, XR controls, DOM buttons
  -> write semantic actions or controls

observer/view behavior plugins
  keyboard navigation, mouse look, parallax observer, smooth navigation
  -> read semantic actions/controls and request view-state patches

data/layer plugins
  streaming stars, app-owned Object3D layers, annotations
  -> attach parts or consume providers/renderers

status/debug plugins
  status text, debug bridge, logging helpers
  -> read snapshots and public actions
```

Tiny lesson hacks can still be plain function plugins that call `ctx.addPart()`
or `ctx.requestViewState()`. Reusable plugins should expose snapshots with
useful `readsFrom` / `writesTo` style fields so conflicts are easy to diagnose
without adding a heavy enforcement framework.

Providers stream, renderers render, and plugins compose behavior. A plugin
should not inspect individual stars unless it is deliberately an app-level
teaching helper.

### Keyboard Navigation

`createKeyboardNavigationPlugin()` is a small desktop learning control. Richer
mouse/orbit/game controls should be separate plugins when their boundaries are
clear. Keyboard bindings use either the exported default binding map or a
complete caller-supplied map; SkyKit does not merge custom bindings with the
defaults implicitly. Defaults bind keys to `SKYKIT_ACTIONS.ship.*` action IDs.
Custom maps may bind keys to other action IDs such as
`SKYKIT_ACTIONS.viewer.reset` or `game:weapons.fire`, or to a tiny callback for
one-off lesson hacks. `createSkykitDefaultKeyboardNavigationBindings(overrides)`
returns an explicit complete map for lessons that want default bindings plus a
few deliberate overrides.

### Parallax

Parallax lives under `@found-in-space/skykit/parallax` because it is optional and
browser-oriented, but still uses the normal SkyKit action/control language.

`createParallaxOffsetInputPlugin()` reads pointer hover, pointer drag/touch, and
device orientation. It writes normalized values to:

```txt
SKYKIT_CONTROLS.observer.parallaxOffset
```

It also registers:

```txt
SKYKIT_ACTIONS.observer.recenterParallax
SKYKIT_ACTIONS.observer.enableParallaxTilt
```

`createParallaxObserverPlugin()` reads that semantic control and applies a
target-relative observer offset. It does not accumulate offsets frame to frame;
each frame is recomputed from the anchor observer position, target, right/up
plane, and current normalized input. By default it also updates orientation so
the target stays centered.

### Status And Debug

`createSkykitStatusPlugin()` reads snapshots and writes either compact DOM text
or callback output. `createSkykitDebugBridge()` exposes viewer snapshots and
public observer actions for console-driven teaching and diagnostics.

---

## 9. Integration With Other Packages

SkyKit should pass provider strategies through unchanged:

```js
createStreamingStarsPlugin({
  provider,
  renderer,
  session: {
    strategy: combineStarOctreeStrategies([
      createObserverShellStrategy(),
      createSphereVolumeStrategy({ centerPc, radiusPc }),
    ]),
  },
});
```

Strategy semantics belong in
[`star-octree-provider.md`](./star-octree-provider.md). SkyKit may provide
examples and presets, but it should not redefine how octree nodes are selected,
prioritized, fetched, decoded, or emitted.

Renderer-specific behavior belongs in renderer packages:

```txt
three-star-field owns star geometry, shader material, and star picking
star-map-canvas owns 2D projection drawing and canvas picking
hr-diagram owns HR projection/rendering
anchored-image owns image solving and image adapters
```

Shared target and navigation behavior belongs in `@found-in-space/spatial`.
WebXR-specific rig, input, ray, session, and depth behavior belongs in the
optional `@found-in-space/skykit/xr` subpath. Visual surfaces, panels, HUDs, and
embedded display input belong in touch-os.

---

## 10. Teaching Examples To Keep Small

SkyKit examples should demonstrate composition:

```txt
minimal streamed star viewer
plugin lab with app-owned Three objects, annotations, and guide layers
canvas starmap composition
Three starfield game starter
HR overlay or linked instrument
constellation art layer
XR composition once the viewer integration is ready
```

Package examples should demonstrate direct package use. The same feature should
not need two beginner-facing configuration systems.

---

## 11. Design Rule

When deciding whether to add a feature to core SkyKit, ask:

```txt
Is this reusable viewer composition that makes lessons smaller?
```

If yes, it may belong in core SkyKit.

If it is data loading, product interpretation, shader implementation,
touch-surface mechanics, XR embodiment, or domain-specific scientific modeling,
it belongs in a focused package or remains application-owned until the boundary
is clear.
