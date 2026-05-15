# SkyKit Core Composition Architecture

Status: current alpha planning document.

This document captures the intended shape of core `@found-in-space/skykit` as
the proof-of-concept viewer code is replaced by first-alpha packages. It should
be read alongside [`alpha-rules.md`](./alpha-rules.md) and
[`package-learning-architecture.md`](./package-learning-architecture.md).

The short version:

```txt
packages own reusable implementations;
core skykit owns teachable composition.
```

Core SkyKit should make real examples and website lessons small without
becoming a hidden registry of hardcoded renderer names. The public extension
model should be contract-first: applications and packages pass objects and
factory results that implement narrow interfaces, not string keys that SkyKit
maps to internal factories.

---

## 1. Goals

Core SkyKit should provide:

- a small `createSkykitViewer()` entrypoint for desktop and XR viewer instances
- a small `createSkykitStarMap()` entrypoint for Canvas2D learning views
- a normal DOM-host mounting model that works in a static HTML page with a
  module script
- a lifecycle contract for viewer parts, layers, overlays, controllers, panels,
  and data-driven renderers
- provider/session wiring for streamed star products
- camera and observer-rig composition
- clean support for observer-shell, target-frustum, and custom provider
  strategies
- explicit layer anchoring policies so sky/infinity layers do not accidentally
  stay centered on the Sun
- enough defaults that a learner can build useful scenes in tens of lines
- enough escape hatches that advanced examples can supply custom layers,
  loaders, renderers, strategies, and controls

Core SkyKit should not:

- become the owner of octree loading, star product interpretation, HR diagrams,
  touch surfaces, sidecars, H-alpha loaders, or renderer-specific internals
- use string registries as the main extension mechanism
- force all renderers to depend on star-specific packages
- merge desktop and XR into one mutable rig
- hide journey/story/chapter logic inside the generic viewer

---

## 2. Interface-First Composition

The primary extension surface should be object/function based.

Good:

```js
const viewer = await createSkykitViewer({
  host,
  camera: createDesktopSkykitCamera({ lookAtPc: ORION_CENTER_PC }),
  parts: [
    createStreamingStarLayer({
      provider,
      session: { strategy: { kind: 'observer-shell' } },
      renderer: createThreeStarField({ renderScale: 0.001 }),
    }),
    createConstellationArtSkyLayer({ manifest }),
    createObject3dLayer({ id: 'radio-bubble', object3d: bubbleGroup }),
  ],
});
```

Not the primary architecture:

```js
createSkykitViewer({
  stars: { renderer: { kind: 'three-star-field' } },
});
```

String-named presets may exist as teaching conveniences later, but they must be
thin wrappers over the same public factories and contracts. Core SkyKit should
not become a central factory registry for every renderer and data product.

---

## 3. Core Contracts

The exact TypeScript names can change during implementation, but the shape
should stay small and boring.

```ts
export interface SkykitPart<
  TContext = SkykitRuntimeContext,
  TFrame = SkykitFrameBase
> {
  id?: string;

  attach?(context: TContext): void | Promise<void>;
  start?(context: TContext): void | Promise<void>;
  update?(frame: TFrame): void;
  setView?(view: SkykitViewState): void;
  detach?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface SkykitRuntimeContext {
  viewer: SkykitViewer;
  mode: 'canvas' | 'three';
  getViewState(): SkykitViewState;
  requestViewState(patch: Partial<SkykitViewState>, reason?: string): void;
}

export interface SkykitFrameBase {
  viewer: SkykitViewer;
  deltaSeconds: number;
  elapsedSeconds: number;
  view: SkykitViewState;
}

export interface SkykitThreeContext extends SkykitRuntimeContext {
  mode: 'three';
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  contentRoot: THREE.Object3D;
  navigationRoot: THREE.Object3D;
  observerRig: SkykitObserverRig;
}

export interface SkykitThreeFrame extends SkykitFrameBase {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export interface SkykitThreePart
  extends SkykitPart<SkykitThreeContext, SkykitThreeFrame> {
  object3d?: THREE.Object3D;
}

export interface SkykitCanvasContext extends SkykitRuntimeContext {
  mode: 'canvas';
  canvas: HTMLCanvasElement | OffscreenCanvas;
  context2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  requestRender(reason?: string): void;
}

export type SkykitCanvasPart = SkykitPart<SkykitCanvasContext, SkykitFrameBase>;
```

Parts may be:

- streamed product renderers
- plain `THREE.Object3D` layers
- Canvas2D layers
- controllers
- overlays that run every frame
- touch-os panel hosts
- debug/status adapters
- custom application parts

The runtime should not care which package produced the part.

---

## 4. Friendly Factories Are Open Composition

Core SkyKit may expose friendly factories for common teaching paths:

```txt
createSkykitStarMap()
  Canvas2D star map / learning path

createSkykitViewer()
  Three.js scene / interactive 3D path
```

Those factories should be easy to use as a single dependency, but they must not
be closed presets. Each should accept the same extension philosophy: pass
objects, functions, and parts that implement documented contracts.

### Static Page Entry

The beginner path should be one obvious JavaScript path: create a host element,
import a factory, and pass plain objects/plugins.

```html
<div id="skykit"></div>

<script type="module">
  import {
    createSkykitViewer,
    createStreamingStarLayer,
  } from '@found-in-space/skykit';
  import { createStarOctreeProviderService } from '@found-in-space/star-octree-provider';
  import { createThreeStarField } from '@found-in-space/three-star-field';

  const provider = createStarOctreeProviderService({ url: STAR_OCTREE_URL });
  const renderer = createThreeStarField({ renderScale: 0.001 });

  const viewer = await createSkykitViewer({
    host: document.querySelector('#skykit'),
    parts: [
      createStreamingStarLayer({
        provider,
        renderer,
        session: { strategy: { kind: 'observer-shell' } },
      }),
    ],
  });

  // Hacking starts here: add parts, inspect snapshots, change view state,
  // subscribe to events, or plug in a custom strategy.
  window.viewer = viewer;
</script>
```

This should remain the canonical teaching shape. Core SkyKit should not provide
multiple beginner configuration paths that do the same thing. Advanced wrappers
are fine as exercises or application code, but the core docs and examples
should teach the factory/plugin model directly.

The same rule applies to CDN-style use. A CDN import should still expose the
same factories and plugin contracts, not a separate declarative configuration
surface.

Useful extension categories:

### Loader And Demand Plugins

These change where data comes from and what data is requested.

Examples:

- star octree provider
- file/blob provider
- custom star provider
- observer-shell strategy
- target-frustum strategy
- custom provider strategy
- demand thresholds and cache-warming policy
- volume/path query preloads

### Product And Data Plugins

These add or interpret data products without changing the viewer runtime.

Examples:

- metadata sidecar provider
- proper-motion sidecar
- solar-system ephemeris provider
- H-alpha product provider
- dust/extinction provider
- galaxy structure provider
- derived statistics stores

### Rendering Plugins

These convert products or static data into pixels or `THREE.Object3D`s.

Examples:

- `three-star-field`
- `star-map-canvas`
- HR diagram renderer
- H-alpha volume renderer
- anchored image / skyculture art renderer
- custom marker, trail, mesh, or shader layer

### Interactivity Plugins

These respond to input or drive viewer state.

Examples:

- desktop camera controls
- XR locomotion
- parallax/device-tilt observer controls
- star picking
- route/fly/orbit automation
- hover/selection controllers
- custom game controls

### UI And Overlay Plugins

These present controls, panels, stats, and teaching overlays.

Examples:

- touch-os panels
- DOM control adapters
- HUD readouts
- debug/status overlays
- pick information panels
- HR diagram overlays
- video/test readiness diagnostics

The important rule is that plugins should compose through contracts such as
`SkykitPart`, product stores, provider sessions, and renderer handles.
They should not require core SkyKit to know a string name for every possible
renderer or data source.

---

## 5. Plugin Mechanics

JavaScript plugins should be explicit composition, not classpath discovery or
string-name lookup. A plugin is a function or object supplied by the caller. It
receives a public context object and registers work through documented seams.

```ts
export type SkykitPluginTeardown = () => void | Promise<void>;

export interface SkykitPlugin {
  id?: string;
  setup(
    context: SkykitPluginContext
  ): void | Promise<void> | SkykitPluginTeardown | Promise<SkykitPluginTeardown | void>;
}

export type SkykitPluginFactory<Options> = (
  options: Options
) => SkykitPlugin;
```

Typical usage:

```js
const viewer = await createSkykitViewer({
  host,
  plugins: [
    createStreamingStarsPlugin({
      provider,
      renderer: createThreeStarField({ renderScale: 0.001 }),
      session: { strategy: { kind: 'observer-shell' } },
    }),
    createRadioBubblePlugin(),
    myCustomOverlayPlugin(),
  ],
});
```

The factory form is convenient, but the important part is the returned contract.
An application can always pass a hand-written plugin object.

```js
const customPlugin = {
  id: 'custom-nebula',
  setup(ctx) {
    const layer = createObject3dLayer({ id: 'nebula', object3d: nebulaGroup });
    ctx.addPart(layer);
    return () => layer.dispose?.();
  },
};
```

### Plugin Context

The context is the only supported way for plugins to hook into the viewer. It
should be deliberately small, stable, and efficient.

```ts
export interface SkykitPluginContext {
  readonly mode: 'canvas' | 'three';
  readonly viewer: SkykitViewer;

  addPart(part: SkykitPart): SkykitPluginTeardown;
  addDisposable(disposable: SkykitDisposable): SkykitPluginTeardown;

  getViewState(): SkykitViewState;
  requestViewState(patch: Partial<SkykitViewState>, reason?: string): void;

  on<TEvent extends SkykitEvent>(
    type: TEvent['type'],
    listener: (event: TEvent) => void
  ): SkykitPluginTeardown;
  emit(event: SkykitEvent): void;

  useStore<T>(key: symbol | string, factory: () => T): T;
  useResource<T extends SkykitDisposable>(
    key: symbol | string,
    factory: () => T
  ): T;

  scheduleTask(task: SkykitScheduledTask, options?: SkykitScheduleOptions): SkykitPluginTeardown;
}

export interface SkykitDisposable {
  dispose?(): void | Promise<void>;
}
```

For Three viewers, the context also exposes scene graph roots:

```ts
export interface SkykitThreePluginContext extends SkykitPluginContext {
  readonly mode: 'three';
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.Camera;
  readonly contentRoot: THREE.Object3D;
  readonly navigationRoot: THREE.Object3D;
  readonly observerRig: SkykitObserverRig;
}
```

For Canvas viewers, the context exposes canvas rendering state without forcing a
Three.js dependency:

```ts
export interface SkykitCanvasPluginContext extends SkykitPluginContext {
  readonly mode: 'canvas';
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly context2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  requestRender(reason?: string): void;
}
```

### Lifecycle Hooking

Plugins should not reach into private viewer fields. They add parts or register
listeners. Parts then receive lifecycle calls from the runtime.

```ts
export interface SkykitPart<
  TContext = SkykitPluginContext,
  TFrame = SkykitFrameBase
> {
  id?: string;

  attach?(context: TContext): void | Promise<void>;
  start?(context: TContext): void | Promise<void>;
  update?(frame: TFrame): void;
  beforeRender?(frame: TFrame): void;
  afterRender?(frame: TFrame): void;
  resize?(size: SkykitViewportSize): void;
  setView?(view: SkykitViewState): void;
  detach?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface SkykitThreePart
  extends SkykitPart<SkykitThreePluginContext, SkykitThreeFrame> {
  object3d?: THREE.Object3D;
}
```

The runtime should call hooks in a deterministic order:

```txt
plugin setup
  -> part attach
  -> part start
  -> frame: update
  -> frame: beforeRender
  -> render
  -> frame: afterRender
  -> resize as needed
  -> detach/dispose
```

Parts added earlier run earlier unless the caller gives an explicit ordering
hint. Ordering hints should remain simple:

```ts
priority?: number;
```

The default priority should be `0`. Built-in helpers may use coarse priorities,
but apps must be able to override ordering without replacing the runtime.

### View-State Hooks

Plugins can read view state synchronously, but they should request changes
rather than mutating internal state directly.

```ts
ctx.requestViewState({
  observerPc: nextObserver,
  targetPc: nextTarget,
}, 'camera.flyTo');
```

The runtime should batch requested view-state patches and publish at most one
normalized view update per frame. This matters because navigation controls can
produce many small movements while data providers may be streaming billions of
source objects through coarse product batches.

Provider-facing plugins should pass the normalized provider-relevant view slice
to their provider/session. The provider/session owns strategy-specific demand
thresholds and gates. A tiny pointer movement can update the render camera
without forcing full star-provider traversal.

### Scene Graph Hooks

Three plugins add objects through parts, not by owning the whole scene.

```js
ctx.addPart({
  id: 'markers',
  object3d: markerGroup,
  update(frame) {
    markerGroup.visible = frame.view.limitingMagnitude < 8;
  },
});
```

Core SkyKit owns the root structure:

```txt
scene
  contentRoot       world / sky / data layers
  navigationRoot    observer rig, camera mount, XR spaceship
```

Plugins should choose an anchoring policy rather than assuming solar-origin
placement. The runtime can then call anchoring helpers consistently for
`world-space`, `observer-centric`, and `scale-banded` layers.

### Data-Stream Hooks

Data plugins must be batch-oriented. They should never require core SkyKit to
flatten, clone, sort, or merge all stars into one cumulative array on every
update.

Preferred flow:

```txt
provider/session
  -> async product deltas
  -> product store or renderer
  -> render/update notification
```

Example:

```js
function createStreamingStarsPlugin({ provider, renderer, session }) {
  return {
    id: 'streaming-stars',
    setup(ctx) {
      const layer = createStreamingStarLayer({ provider, renderer, session });
      ctx.addPart(layer);
      return () => layer.dispose();
    },
  };
}
```

Streaming plugins should:

- preserve product-delta semantics
- pass borrowed/transferable buffers through without unnecessary copies
- apply cached products before fresh network work when requested
- avoid cumulative product rebuilds as the default model
- ignore stale async work for superseded view revisions
- expose progress through snapshots/events rather than per-object callbacks
- close sessions and abort/ignore work on dispose

For a billion-star dataset, hooks that run once per product batch are acceptable.
Hooks that run once per source star in the core runtime are not.

Core SkyKit should enforce this shape by keeping stream APIs typed around
products and deltas, not around individual records.

```ts
export interface SkykitProductStreamPart<TProduct> extends SkykitPart {
  apply(delta: ProductDelta<TProduct>): void;
  setProducts?(products: Iterable<TProduct>): void;
  getSnapshot?(): SkykitProductStreamSnapshot;
}

export interface SkykitProductStreamSnapshot {
  productCount: number;
  objectCount?: number;
  memoryBytes?: number;
  status: 'idle' | 'streaming' | 'current' | 'failed' | 'disposed';
  lastError?: unknown;
}
```

The runtime can coordinate these parts, but it should not inspect every star in
their products. Star-specific iteration belongs in `@found-in-space/star-products`
or in application logic such as a nearest-100 table. Renderer packages such as
`three-star-field` may scan their retained products for CPU picking, but that is
renderer-owned work, not a core SkyKit lifecycle hook.

High-volume enforcement rules:

- Core may count products, bytes, batches, and provider work items.
- Core may route `ProductDelta<TProduct>` values to stores and renderers.
- Core may expose product snapshots for UI/status overlays.
- Core must not require a full merged star array for normal rendering.
- Core must not call per-star plugin callbacks during stream consumption.
- Core must not sort or filter all streamed stars unless an application plugin
  explicitly owns that derived calculation.
- Core should treat product buffers as borrowed/transferable according to the
  product metadata and avoid accidental copies.
- Core should keep stale-view protection at the product/session boundary:
  products from superseded demand revisions must not be emitted as current.

### Runtime Enforcement Points

The plugin model only works if the runtime has clear choke points. These are the
places where SkyKit should enforce consistency and performance.

#### Plugin Registration

`createSkykitViewer()` and `createSkykitStarMap()` should normalize plugins once
at construction. After setup, the runtime owns a flat ordered list of parts,
listeners, resources, and scheduled tasks. It should not repeatedly ask plugins
to rediscover dependencies every frame.

#### View Normalization

All view changes should pass through one normalizer before they reach parts or
providers. The normalizer owns:

- parsec units for provider-facing positions
- product-coordinate units for renderer-facing observer positions
- quaternion/direction normalization
- default limiting magnitude
- frame-level batching of repeated `requestViewState()` calls
- separation of provider demand state from render-only camera/head jitter

This lets desktop controls, XR locomotion, target-frustum strategies, and
observer-centric overlays share the same view vocabulary without sharing
implementation details.

#### Demand Dispatch

Streaming star layers should translate normalized view state into provider
session updates. The provider still owns strategy-specific demand thresholds and
planning. Core SkyKit only decides which view slice is relevant and when to pass
it through.

This distinction matters:

```txt
camera/render update
  cheap, may happen every frame

provider demand update
  strategy-gated, may trigger octree traversal and network work
```

The runtime should make this distinction visible in diagnostics so examples can
teach why stars continue streaming while the camera moves.

#### Render Dispatch

Render dispatch should call part hooks in the same order every frame:

```txt
update -> beforeRender -> renderer.render -> afterRender
```

Heavy product ingestion should not happen inside `beforeRender`. Stream
consumers may apply a bounded number of pending product deltas per frame, then
yield, so UI and XR frame timing are not destroyed by a large network batch.

#### Disposal

Disposal must be centralized. When a viewer is disposed, the runtime should:

- stop accepting view patches
- dispose scheduled tasks
- dispose provider sessions started by SkyKit helper parts
- detach listeners
- dispose renderers/stores/resources created through the plugin context
- ignore late async products from stale streams

This avoids the old pattern where long-running fetch/render helpers survived
after the visible example had moved on.

### Event Hooks

Events are for semantic transitions, not per-star data flow.

Good event examples:

```txt
view/change
view/current
products/current
products/error
pick/change
viewer/resize
viewer/dispose
```

Avoid event storms:

- do not emit one event per decoded star
- do not emit raw pointer motion as a global event if a controller can process
  it locally
- do not make product-stream consumption depend on the event bus

The event bus should be useful for UI/status plugins and cross-plugin
coordination, while high-throughput data should stay on async iterables,
stores, or renderer handles.

### Store And Resource Hooks

Plugins sometimes need to share a resource without making it a global singleton.

```js
const selection = ctx.useStore(SELECTION_STORE, () => createSelectionStore());
```

Keys may be symbols or strings. Symbols are preferred for package-private
stores. Stores/resources created through the context should be scoped to the
viewer and disposed when the viewer is disposed.

This keeps examples from manually threading the same sidecar, selection, or
statistics object through many small wrappers.

### Scheduling Hooks

Long-running or lower-priority work should be scheduled through the viewer,
not by each plugin inventing its own untracked timers.

```ts
ctx.scheduleTask(
  () => warmVolumeRequests(provider, requests),
  { priority: 'background', reason: 'hr.volume-preload' }
);
```

The first implementation can be simple, but the contract should make room for:

- frame-priority work
- background/cache-warming work
- cancellation on dispose
- latest-view checks before emitting visible products
- diagnostics for active/finished/failed work

This is especially important for volume preloads, motion lookahead, HR diagram
cache warming, and future kinematics/ephemeris products.

### Plugin Constraints

Plugins must not:

- import old proof-of-concept `src/` internals
- mutate private viewer/runtime fields
- mutate WebXR camera orientation directly
- assume a star provider exists
- assume Three.js exists in Canvas-only viewers
- assume the solar origin is the correct center for observer-centric layers
- require core SkyKit to copy full star arrays on every update
- use string names as the only extension mechanism

Plugins may:

- add lifecycle parts
- add `THREE.Object3D`s through parts
- subscribe to semantic events
- read normalized view state
- request view-state patches
- consume product streams
- expose snapshots and diagnostics
- return teardown/dispose functions

---

## 6. Canvas Star Map Path

The Canvas2D path matters because SkyKit should work as a single-dependency
learning library before a learner commits to Three.js.

Core SkyKit should provide a small composition wrapper around
`@found-in-space/star-map-canvas`, not duplicate the renderer.

```js
const map = await createSkykitStarMap({
  canvas,
  provider,
  session: { strategy: { kind: 'observer-shell' } },
  observerPc: { x: 0, y: 0, z: 0 },
  limitingMagnitude: 6.5,
  layers: [
    createCanvasGridLayer(),
    createAnchoredImageCanvasLayer({ manifest }),
  ],
});
```

It should own:

- creating/accepting a star provider
- consuming streamed star products into a star representation store
- invoking `star-map-canvas`
- resize and rerender policy
- optional pan/zoom/hover plugins
- optional canvas overlay layers

It should not own:

- star projection math already owned by `star-map-canvas`
- octree loading internals
- product interpretation already owned by `star-products`
- DOM page layout

The Canvas and Three paths should share data/provider concepts where practical,
but they should not force a Three dependency on canvas-only learners.

---

## 7. Product Renderer Composition

Product renderers such as `@found-in-space/three-star-field` remain renderer
packages, not viewers. Core SkyKit wires providers to renderers.

For stars, the first composition helper should look roughly like:

```ts
export interface StreamingStarLayerOptions {
  provider: StarOctreeProviderService;
  renderer: ThreeStarField;
  session?: StarOctreeSessionOptions;
  attributes?: readonly string[];
  coordinates?: StarCoordinateOutputProfile;
}
```

It owns:

- creating a provider session
- mapping `SkykitViewState` into `session.updateView()`
- consuming `session.deltas()`
- applying product deltas to the renderer
- exposing the renderer's `object3d`
- disposing the session and renderer

It does not own:

- octree byte loading implementation
- star shader implementation
- sidecar lookup
- camera controls
- application merge logic beyond the renderer's product lifecycle

This pattern should be reusable for future products:

```txt
provider/session -> product deltas -> renderer/store -> SkykitPart
```

---

## 8. Observer Rig Model

The observer is not always the raw camera.

Desktop can usually map camera/navigation state directly to `observerPc`.
XR must not. In XR, WebXR owns head pose, and head micro-movement should not
constantly replan star demand.

Core SkyKit should explicitly model an observer rig:

```ts
export interface SkykitObserverRig {
  readonly type: 'desktop' | 'xr' | string;
  readonly navigationRoot: THREE.Object3D;
  readonly contentRoot: THREE.Object3D;
  readonly cameraMount?: THREE.Object3D;
  readonly deck?: THREE.Object3D;

  getObserverPc(): Vector3Like;
  getRenderObserverPosition(): Vector3Like;
  getOrientationIcrs?(): QuaternionLike;
  getMotion?(): SkykitObserverMotion | null;
  setObserverPc?(observerPc: Vector3Like): void;
  update?(frame: SkykitThreeFrame): void;
  dispose?(): void;
}
```

Important distinction:

```txt
streamObserverPc
  Where provider demand is centered.

renderObserverPosition
  Where shader apparent-magnitude / visual calculations are evaluated.
```

For desktop these are normally the same. For XR they may differ slightly because
the headset moves within the spaceship/deck while the streaming observer should
remain the ship/navigation position.

XR rules inherited from the proof-of-concept remain important:

- desktop and XR are separate viewer instances
- WebXR camera orientation must not be mutated directly
- the XR viewer uses a spaceship rig from creation
- `contentRoot` and `navigationRoot` are siblings
- locomotion moves the spaceship/navigation root through the stationary universe
- controllers and touch panels are parented inside the XR origin/camera mount
- deck offsets are structural, not recalculated every frame from head pose

---

## 9. Layer Anchoring

The old code revealed a recurring source of bugs: not every layer should be
anchored to the solar origin.

Core SkyKit should make anchoring explicit.

```ts
export type SkykitLayerAnchorMode =
  | 'world-space'
  | 'observer-centric'
  | 'scale-banded';
```

### `world-space`

The layer is anchored in physical parsec/ICRS coordinates and moves relative to
the observer as the observer navigates.

Examples:

- streamed stars
- radio bubble
- local sphere/path volume products
- proper-motion trails
- comet or spacecraft trajectories

### `observer-centric`

The layer is centered on the current observer and represents angular or
infinity-like content. It should rotate/project according to ICRS direction but
should not remain centered on the Sun as the observer moves.

Examples:

- constellation art
- skyculture images
- all-sky survey overlays painted at infinity
- angular grids and compass aids

The intended behavior is:

```txt
observerPc + icrsDirection * skyRadiusPc
```

not:

```txt
solarOriginPc + icrsDirection * skyRadiusPc
```

### `scale-banded`

The layer is physically meaningful at large scale but should not update every
local movement. It recenters or refreshes only after coarse thresholds.

Examples:

- galactic structure
- galaxy-scale context meshes
- H-alpha or dust context layers at kpc scale

This policy avoids both extremes: layers should not churn every frame, but they
also should not silently treat the Sun as the permanent center of the universe.

---

## 10. View State

Core SkyKit should maintain a normalized view state and pass relevant slices to
parts. It should be independent from any one provider.

```ts
export interface SkykitViewState {
  observerPc: Vector3Like;
  renderObserverPosition: Vector3Like;
  targetPc?: Vector3Like | null;
  directionIcrs?: Vector3Like | null;
  orientationIcrs?: QuaternionLike | null;
  limitingMagnitude: number;
  verticalFovDeg?: number;
  aspectRatio?: number;
  motion?: SkykitObserverMotion | null;
  coordinateUnitsPerParsec: number;
}
```

Star provider sessions use `observerPc`, target/frustum fields, magnitude, and
motion hints. Renderers such as `three-star-field` use
`renderObserverPosition`, magnitude, and coordinate units. Observer-centric
layers use `observerPc` and angular direction/orientation.

---

## 11. Website And Demo Requirements

The local examples and website examples should become thin compositions over the
same contracts.

### Covered By Core Composition

Core SkyKit should remove repeated boilerplate for:

- renderer, scene, camera, resize, and animation-loop setup
- dataset/provider creation and warmup
- star provider session creation and view updates
- mapping camera/rig state to provider view state
- product delta consumption into `three-star-field`
- camera controls and route automation
- observer-shell, target-frustum, and custom strategy wiring
- common HUD/control panels through touch-os or existing DOM hooks
- pick routing from renderer/controller to application callbacks
- adding plain `THREE.Object3D` layers with lifecycle/disposal
- overlay update hooks for HR diagrams, debug panels, and stats
- snapshot/diagnostics for tests and video capture

### Must Remain App Or Lesson Owned

Applications should continue to own:

- prose, DOM layout, Astro components, and CSS
- journey/chapter timing and story data until the journey package exists
- specific star lists and reveal tables for lessons such as Astrophage
- experimental shader labs
- one-off scientific experiments that have not become stable products

---

## 12. Representative Target Shapes

### Minimal Star Viewer

```js
const provider = createStarOctreeProviderService({ url });
const stars = createThreeStarField({ renderScale: 0.001 });

const viewer = await createSkykitViewer({
  host,
  camera: createDesktopSkykitCamera({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: ORION_CENTER_PC,
  }),
  parts: [
    createStreamingStarLayer({
      provider,
      renderer: stars,
      session: { strategy: { kind: 'observer-shell' } },
    }),
  ],
});
```

### Minimal Canvas Star Map

```js
const map = await createSkykitStarMap({
  canvas,
  provider: createStarOctreeProviderService({ url }),
  session: { strategy: { kind: 'observer-shell' } },
  observerPc: { x: 0, y: 0, z: 0 },
  limitingMagnitude: 6.5,
});
```

### Constellation Art

```js
viewer.addPart(createConstellationArtSkyLayer({
  manifest,
  anchorMode: 'observer-centric',
  radiusPc: 2500,
}));
```

### Plain Object Layer

```js
viewer.addPart(createObject3dLayer({
  id: 'radio-bubble',
  object3d: createRadioBubbleMeshes().group,
}));
```

### Custom Strategy

```js
createStreamingStarLayer({
  provider,
  renderer: createThreeStarField(),
  session: {
    strategy: {
      kind: 'custom',
      selectDemand(context) {
        return mySelection(context);
      },
      shouldReplan(context) {
        return myGate(context);
      },
    },
  },
});
```

### HR Overlay

```js
viewer.addPart(createHrDiagramOverlay({
  renderer: createHrDiagramRenderer(canvas),
  source: starStore,
  volumeQuery,
}));
```

The HR package should own HR-specific rendering and product interpretation.
Core SkyKit should only provide the viewer/overlay lifecycle and convenient
wiring. The source should be a star product store or product stream, not the
`three-star-field` renderer internals.

---

## 13. Implementation Slices

### Slice 1: Contracts And Viewer Shell

- Add `createSkykitViewer()`.
- Add shared composition contracts that can also be used by
  `createSkykitStarMap()`.
- Add `SkykitPart` lifecycle.
- Add desktop observer rig.
- Add `createObject3dLayer()` helper.
- Keep old `createViewer()` in place during transition.
- Add tests for lifecycle ordering, async attach/dispose, and object3d mounting.

### Slice 2: Streaming Star Layer

- Compose `star-octree-provider` + `three-star-field`.
- Accept real provider/session/renderer objects.
- Update provider view from `SkykitViewState`.
- Preserve product-delta streaming semantics.
- Add tests with fake provider/session and real `ThreeStarField`.

### Slice 3: Canvas Star Map Factory

- Compose `star-octree-provider` + `star-products` +
  `star-map-canvas`.
- Accept provider/session objects rather than string presets.
- Support canvas overlay/render plugins.
- Add tests for streaming, resize, render refresh, and custom overlay layers.

### Slice 4: Camera And Refresh Semantics

- Port/reshape desktop camera controller around the new observer rig.
- Replace old selection-refresh controller behavior with provider
  `updateView()` plus demand thresholds.
- Expose fly-to, orbit, look-at, and polyline route helpers.

### Slice 5: Anchoring Policies

- Wrap constellation/anchored image layers using `observer-centric` semantics.
- Add tests proving constellation art recenters around the observer, not the
  solar origin.
- Add a `scale-banded` helper for large-scale layers.

### Slice 6: Website-Shaped Examples

Rewrite a small set of local examples first:

- minimal canvas starmap
- minimal free-roam stars
- constellation fly-through
- radio bubble
- HR diagram overlay

Use these as proof that website wrappers can become thin without moving website
story code into core SkyKit.

### Slice 7: XR Viewer

- Add XR observer rig on the same part contract.
- Preserve spaceship/deck topology.
- Rewire XR locomotion and XR picking as parts.
- Confirm stream observer and render observer semantics are distinct.

---

## 14. Implementation Timing Questions

- Should `createSkykitViewer()` live beside old `createViewer()` during alpha,
  or should old `createViewer()` become a compatibility wrapper around the new
  runtime?
- Should `createSkykitStarMap()` land in the first core slice, or should the
  exact wrapper shape be proven in examples before it becomes public core API?
- Which remaining coordinate helpers are truly viewer-composition helpers after
  `star-products` owns star math and `anchored-image` owns image anchoring?
- How much DOM HUD support should remain in SkyKit once touch-os is available?
- Should radio bubble remain a small core teaching layer, or become a later
  product/layer package if it grows?
- Which H-alpha and dust preserve candidates need formal product-lane plans
  before old-core code can be removed?

---

## 15. Design Rule

When deciding whether to add a feature to core SkyKit, ask:

```txt
Is this reusable viewer composition that makes examples smaller?
```

If yes, it probably belongs in core SkyKit.

If it is data loading, product interpretation, shader implementation,
touch-surface mechanics, or domain-specific scientific modeling, it should
belong in a focused package or remain app-owned until the boundary is clear.

When deciding how to expose a feature, prefer one teachable path:

```txt
mount into a host element -> pass factories/plugins -> hack with plain JS
```

Avoid adding a second beginner-facing configuration system unless it unlocks a
meaningfully different capability. The learner should be able to understand and
modify the same objects that the examples use internally.
