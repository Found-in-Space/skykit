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
```

It composes other packages through public objects and functions:

```txt
star-octree-provider -> streams star cells
spatial              -> owns coordinates, targets, routes, and navigation math
three-star-field     -> renders star cells in Three.js
star-map-canvas      -> renders 2D starmaps
star-trees        -> stores and interprets star cells
skykit/xr            -> owns WebXR rig/input/rays/session helpers
touch-os             -> owns panels, HUDs, and visual surfaces
```

SkyKit should not inspect individual stars during normal streaming, rebuild
cumulative render arrays, or hide hardcoded loader/renderer registries behind
string names.

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
skykit:journey.goToChapter
game:weapons.fire
lesson:highlight.next
```

Plugins register actions through `ctx.actions.registerAction()` or
`ctx.actions.registerContext()`. Multiple handlers may share an action ID; they
run in priority order. This lets keyboard, touch DOM, touch-os, WebXR, debug
tools, and journey buttons call the same semantic action without faking
keypresses.

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
logic, journey authoring, WebXR embodiment, touch UI, sidecar lookup, or app
gameplay, it belongs outside core SkyKit unless there is a clear thin
composition helper to expose.
