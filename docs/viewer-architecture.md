# SkyKit Architecture

## Overview

SkyKit is a viewer platform for interactive 3D star-field exploration across desktop, VR, and (eventually) AR. It is designed as a reusable library, not a single-purpose app.

Target use cases:

1. free travel through space
2. constellation change as the observer moves
3. device-driven parallax on desktop and tablet
4. exploration of nearby faint and invisible stars
5. exoplanet host exploration
6. VR free roam
7. AR "galaxy in your palm" views

These experiences do not all want the same camera model, loading strategy, overlays, or even dataset shape. The architecture separates durable services from experience-specific shells.

## Goals

- Viewer platform, not a single app.
- JavaScript-first reusable modules that can be wrapped for web components, React, Astro, and other hosts.
- Desktop, VR, and AR as separate viewer products that share data services and reusable modules — not a single runtime that switches modes.
- Changes to desktop should not break XR, and changes to XR should not break desktop.
- Separate node selection, data loading, rendering, input, and UI concerns.
- Support more than one spatial loading strategy.
- Allow multiple viewers on one page to share dataset state.

## Non-goals

- Forcing all experiences to use the same star dataset or the same layer set.
- Shipping all target experiences before the runtime becomes useful.

## Design Principles

- One data pipeline, many viewer products. Share data services (`DatasetSession`, octree loading, sidecar caches); do not share rig structure, camera control, or rendering assumptions.
- Separate interest selection from fetch and render.
- Treat experiences as composition, not forks — but keep desktop and XR compositions independent so that changes in one do not break the other.
- Keep the public embedding API smaller than the internal architecture.
- Keep the generic library service-first; let website journeys sit on top as optional presets or apps.

## Standing Design Decisions

### Core Library Contract

- Direct service composition is the primary contract for the generic library.
- `SceneDefinition` is optional and exists mainly for reusable preset families such as website journeys, deep links, and saved states.
- `ExperienceApp` is a first-order deliverable for games, learning experiences, and other authored applications.

### Renderer Scope

- Three.js is the rendering backend.
- No generic renderer abstraction unless a concrete second backend becomes necessary.

### Desktop And XR Split

- Desktop and XR are **separate viewer instances**, not modes of the same viewer.
- A desktop viewer and an XR viewer may run on the same page, but they are not expected to transition seamlessly between each other. There is no requirement to "enter VR" from a running desktop canvas or to "exit VR" back to a desktop view.
- They may share a `DatasetSession` (data caching and fetch infrastructure). This is genuine sharing — the same object serves both viewers.
- They use the same _types_ of reusable modules (interest fields, layers, controllers, scene orientation, star picker), but each viewer creates its own instances. No runtime object is shared between a desktop viewer and an XR viewer except `DatasetSession`.
- They differ in rig topology, camera control, input handling, and scale conventions.
- The desktop rig and XR rig are structurally different scene graphs, each built at viewer creation time — not a single rig that restructures at runtime.
- A change to the desktop rig, desktop controller path, or desktop demo should never require a corresponding change to XR code, and vice versa. If a shared module change would break one side, that module needs a cleaner interface boundary.
- XR-specific architecture is documented separately in [xr-architecture.md](xr-architecture.md).
- AR is not yet in scope but remains a future adapter.

### Runtime Part Lifecycle

- Runtime-managed parts may implement `attach`, `start`, `update`, `resize`, and `dispose`.
- `ViewerRuntime` owns hook order, including reverse-order disposal.
- `InterestField` keeps its separate `selectNodes(context)` contract.

### Interest Field Wiring

- The runtime currently accepts one active `interestField`.
- If several strategies need to be combined later, that composition should live inside a field rather than in the runtime itself.
- The runtime should remain agnostic to how a field produces its selection.

### Dataset Identity

- Each octree header should carry a dataset UUID as the canonical identity for compatibility, cache safety, and sharing.
- Until headers expose UUIDs, `DatasetSession` derives identity from the render URL plus a header fingerprint.
- File-format versions and manifest-format versions remain separate concerns from dataset identity.

### Multi-Sidecar Model

- A dataset may expose more than one named sidecar at the same time.
- Sidecars are addressed by stable names or capability keys, not by a single hard-coded slot.
- Each sidecar declares both a `parentDatasetUuid` and a `sidecarUuid`.
- `DatasetSession` owns the sidecar registry and per-sidecar caches.

Examples of likely sidecars:

- `exoplanets`
- `stellarParameters`
- `curatedRoutes`

### Evaluation Metrics

When comparing loading strategies or runtime behaviour, track at least:

- nodes selected / fetched / rendered
- stars rendered
- startup time
- memory footprint
- path overfetch

## Core Concepts

### DatasetSession

`DatasetSession` is the shared data boundary for one dataset version or manifest.

Responsibilities:

- provide the stable identity for one dataset version or manifest
- own shared caches for shard headers, payloads, sidecar cells, and derived indexes
- expose the canonical dataset UUID, dataset capabilities, sidecar descriptors, and derived version keys
- expose sidecar descriptors that include sidecar name, `parentDatasetUuid`, and `sidecarUuid`
- validate sidecar compatibility against the active dataset UUID
- provide inspection and disposal hooks for dataset-level state
- own bootstrap loading and the current sidecar service path as of Phase 2
- expose explicit warmup and prefetch entry points for render bootstrap, root shards, and payload streaming rather than starting fetches as hidden side effects of passive inspection calls
- own render-payload batching and request instrumentation as shared dataset services rather than leaving each viewer or layer to reinvent fetch policy
- provide optional persistent caching via IndexedDB

Non-responsibilities:

- no canvas ownership
- no camera logic
- no DOM or framework integration

### ViewerRuntime

`ViewerRuntime` is one live viewer instance attached to one rendering host.

Responsibilities:

- own renderer and canvas binding when the host does not supply them
- own scene lifecycle, resize handling, render loop, and disposal
- bind a `DatasetSession`
- host one active `InterestField`
- host layers, controllers, and overlays as lifecycle-managed runtime parts
- receive concrete service configuration and optional scene presets
- expose an imperative API for host frameworks

Non-responsibilities:

- no direct knowledge of Astro or React
- no hard-coded VR or desktop assumptions — the runtime is rig-agnostic and receives its rig at construction time
- no dataset fetch policy beyond calling the active services
- no requirement that consumers use website-oriented scene presets

Runtime-part contract:

```ts
interface ViewerRuntimePart {
  attach?(context: ViewerRuntimeContext): void | Promise<void>;
  start?(context: ViewerRuntimeContext): void | Promise<void>;
  update?(context: ViewerRuntimeFrameContext): void | Promise<void>;
  resize?(context: ViewerRuntimeResizeContext): void | Promise<void>;
  dispose?(context: ViewerRuntimeContext): void | Promise<void>;
}
```

### InterestField

`InterestField` decides which parts of the dataset matter for the current experience state.

This is the abstraction that should absorb the current onion idea.

```ts
interface InterestField {
  selectNodes(context: InterestContext): Promise<NodeSelection>;
}
```

The observer-shell concept is named `ObserverShellField` to read as one strategy among several rather than the whole loading model.

Magnitude handling:

- limiting magnitude is a viewer-level runtime setting: `state.mDesired`
- dataset `header.magLimit` is indexing metadata (`mIndex`) for shell-style node pruning, not a user-facing visibility default
- fields consume that setting for node selection
- render layers consume that same setting for star visibility
- dataset and cache services stay agnostic to it

Current fields:

- `ObserverShellField`
- `TargetFrustumField`

Deferred future candidates:

- `PathCorridorField`
- `TargetClusterField`
- `HybridField`

### Layer

`Layer` is a pluggable visual or semantic slice of the runtime.

Examples:

- `StarFieldLayer`
- `ConstellationProjectionLayer`
- `ConstellationArtLayer`
- `NearbyDwarfsLayer`
- `ExoplanetHostsLayer`
- `GalaxyArmsLayer`
- `LabelsLayer`

Layers should consume data services and experience state, then produce renderable output. A layer should not own the whole viewer.

For example, `StarFieldLayer` owns per-viewer star rendering resources and may swap material profiles without changing the rest of the runtime. `ConstellationArtLayer` remains a separate layer even when it is rendered in the same space as the stars.

When possible, layer-specific asset pipelines should also be separable from the runtime adapter. The current constellation-art path follows this pattern: a plain `three` module builds an art group from a packaged manifest plus image assets, and `ConstellationArtLayer` adapts that module into the viewer lifecycle.

Current constellation-art packaging assumptions:

- the runtime should consume a manifest object or `manifestUrl`, not a hard-coded project-local asset layout
- art packages should keep their own asset licensing and attribution separate from the runtime package
- manifests should carry the resolved 3D anchor directions needed for projection onto the celestial sphere
- image assets may be served from local files, installed package assets, CDN URLs such as `unpkg`, or inline data URLs
- the runtime should stay agnostic about which specific sky-culture or art family is being used

### Controller

`Controller` is a pluggable source of navigation or interaction state.

Desktop controllers:

- `CameraRigController` — keyboard/mouse free-fly, inertial flight, and automation (flyTo, orbit, lookAt, lockAt). Desktop-only — no XR code.
- `PickController` — star selection via 2D pointer click with CSS highlight overlay. Desktop-only — no XR code.

XR controllers:

- `XrLocomotionController` — thumbstick-driven movement, viewer pose for direction, moves the spaceship through the stationary universe. XR-only — no desktop code.
- `XrPickController` — laser pointer and trigger-based star picking, visuals parented to `cameraMount` (xrOrigin). XR-only — no desktop code.

Shared controllers:

- `SelectionRefreshController` — shared policy for when node reselection runs, driven by observer movement thresholds rather than raw input frequency. Usable by both desktop and XR viewers.

Future controllers:

- `ParallaxController` — target-locked website effect with transient rig offsets
- `GuidedPathController` — authored travel routes
- `DeviceOrientationController` — mobile tilt input
- `ARPlacementController` — AR surface placement

Controller ownership model:

- use a two-layer model: serializable semantic state in `runtime.state`, plus transient view-rig transforms for immediate rendering
- controllers should not call dataset services directly
- controllers should not decide which octree nodes get loaded
- controllers may update rig nodes directly when low-latency motion matters, but they should publish canonical semantic state whenever the motion has meaning beyond one frame

### Runtime Rig

The runtime provides a scene-graph rig with named groups for different concerns. Desktop and XR viewers use **different rig topologies**, each built by a dedicated factory at viewer creation time. The `ViewerRuntime` accepts a `rig` option — desktop viewers omit it (uses `createDesktopRig` by default), XR viewers pass the result of `createXrRig`.

**Desktop rig** (`createDesktopRig(camera)` in `src/core/runtime-rig.js`):

```
scene
  ├── contentRoot          ← stars, constellation art, scene content
  └── navigationRoot       ← viewer position in scene space
        ├── cameraMount    ← holds the camera
        └── attachmentRoot ← overlays, compass, etc.
```

- `navigationRoot`: the viewer position in scene space, driven by controller locomotion
- `cameraMount`: sits under `navigationRoot`, holds the camera
- `contentRoot`: stars, constellation art, and other scene content — sibling of `navigationRoot` under the scene

**XR rig** (`createXrRig(camera, options)` in `src/core/runtime-rig.js`):

XR viewers are created with the spaceship scene graph from the start. The rig uses the same **sibling topology** as the desktop rig — `contentRoot` and `navigationRoot` are independent trees. See [xr-architecture.md](xr-architecture.md) for the full scene graph, rationale, and agent rules.

```
scene
  ├── universe (contentRoot)         ← stays at scene origin, scaled by starFieldScale / SCALE
  └── spaceship (navigationRoot)     ← MOVES to represent the observer's position
        └── deck                     ← shifts observer DOWN and BACK, set once at creation
              ├── xrOrigin (cameraMount) → camera
              └── attachmentRoot     ← deck-fixed UI
```

- `contentRoot` (universe) stays at the scene origin, scaled by `starFieldScale / SCALE`
- `navigationRoot` (spaceship) is moved by `XrLocomotionController` to the observer's scene-space position — the camera (and everything attached to the spaceship) moves relative to the stationary stars
- `deck` provides a structural offset `(0, -eyeLevel, +forwardOffset)` that shifts the observer DOWN and BACK so the Sun appears at eye level and slightly in front
- `cameraMount` (xrOrigin) sits under `deck` and is where WebXR places the camera and controllers
- Controller visuals (laser, ring) are children of xrOrigin, ensuring they move with the spaceship

Important split:

- semantic navigation state belongs in `runtime.state` (e.g. `observerPc`, `starFieldScale`)
- transient head pose, drag deltas, parallax jiggle, and controller ray pose belong in the rig

### Canonical Runtime State

The runtime should expose a small stable state surface that is useful for snapshots, presets, and reuse across controllers.

Navigation and target state:

- `observerPc`: `{ x, y, z }` in parsecs relative to the solar origin
- `targetPc`: `{ x, y, z }` in parsecs for target-locked scenes
- `sceneTargetId`: optional named target id such as `orionCenter`

Shared visibility state:

- `mDesired`: faintest apparent magnitude the scene should load and render
- `starFieldScale`: world units per parsec
- `starFieldExtinctionScale`: artistic brightness falloff control
- `starFieldExposure`: render tuning that may vary by preset family

Important default interpretation:

- `mDesired` and `starFieldScale` are conceptually independent controls
- hosts may choose to couple them for a particular experience, but the runtime should not require that coupling

Scene and route state:

- `fieldStrategy`: optional descriptive label for debugging and snapshots
- `routeSegmentIndex`: current authored route segment for guided scenes
- `routeSegmentT`: normalized progress inside the active segment

The following should stay transient by default rather than becoming canonical scene state:

- raw mouse deltas
- raw device-orientation samples
- XR head pose
- controller ray pose
- parallax jiggle offsets

### Selection Refresh Policy

Controllers should not refresh node selection just because an input event happened.

Instead:

- controllers may request a refresh
- a shared scheduler or policy layer decides when `refreshSelection()` actually runs
- reselection should be driven by meaningful canonical state changes, not raw input frequency

Current policy expectations:

- free roam and XR free roam refresh on meaningful `observerPc` movement, using thresholds and a cooldown rather than every frame
- guided scenes may refresh as route progress, target changes, field changes, or `mDesired` changes advance
- parallax should keep ordinary pointer or tilt jiggle cheap and stable; it should only reselection when the base observer, target, FoV, aspect ratio, or other field-defining inputs change materially

### CameraRigController Modes

`CameraRigController` is desktop-only and supports multiple movement modes through options:

- **Direct free-fly** (default): keyboard/mouse desktop navigation; updates `observerPc`; usually pairs with `ObserverShellField`
- **Inertial flight**: thrust-based acceleration with drag; `integration: 'inertial'`
- **Automation**: programmatic movement via `flyTo()`, `orbit()`, `orbitalInsert()`, `lookAt()`, and `lockAt()`

### XrLocomotionController

`XrLocomotionController` is XR-only and handles thumbstick-driven movement relative to head orientation. It moves the spaceship (`navigationRoot`) to the observer's scene-space position while the universe stays at the origin — the camera perceives motion because it moves relative to the stationary stars. Only used by XR viewer instances with the spaceship rig.

Future additions to the guided-route vocabulary:

- `travelTo`
- `orbitAround`
- `hold`

### Service Configuration

The generic library should be usable by directly composing services.

This is the primary contract for the reusable viewer.

Typical service inputs:

- `DatasetSession`
- one `InterestField` instance
- layers
- controllers
- overlays
- runtime options

If several strategies need to be combined later, that composition should usually live inside a dedicated composite field rather than in the runtime itself.

Example shape:

```ts
const viewer = await createViewer(element, {
  datasetSession,
  interestField,
  layers,
  controllers,
  overlays,
});
```

This keeps the core library decoupled from any particular product, CMS, or website model.

### SceneDefinition

`SceneDefinition` is an optional serializable composition layer built on top of service configuration.

It is useful when a whole class of similar use cases needs a reusable preset, especially:

- website journeys
- deep links
- saved states
- reusable learning routes
- a family of similar public-facing scenes

At minimum it should be able to describe:

- the dataset or manifest it uses
- sidecar URLs when those differ from defaults
- a named target and orientation model
- the interest field strategy
- the active layers
- the active controllers, referenced by stable type ids rather than arbitrary functions
- camera defaults and constraints
- initial runtime state
- warmup hints
- selection refresh policy
- UI affordances and feature flags
- which state fields are allowed to participate in public deep links

Important constraint:

- `SceneDefinition` is convenience and portability, not the foundation of the generic library

In other words, the website should not wag the dog. The core viewer must remain fully usable without `SceneDefinition`.

The first website cut may bypass `SceneDefinition` entirely and compose the runtime directly through source-level Astro components. `SceneDefinition` becomes more valuable once multiple journeys need a shared launch format or a simpler public integration surface.

Additional rules:

- it should stay data-first and serializable
- it should resolve named targets through the shared target registry
- it should remain a convenience layer on top of direct service composition, not a replacement for it

Deep links should identify a scene first and then apply a small allowed patch of state rather than trying to encode the whole runtime graph.

The minimum useful public deep-link fields are:

- `scene`
- `routeSegmentIndex`
- `routeSegmentT`
- `mDesired`
- optional `target` overrides only when a preset explicitly allows them

### ExperienceApp

`ExperienceApp` is the real product-facing deliverable.

An app may be:

- a guided learning experience
- a classroom activity
- a public-facing interactive
- a game, such as a spaceship or exploration experience

An `ExperienceApp` can:

- compose services directly
- start from a `SceneDefinition` and extend it
- provide custom HUD, game logic, missions, prompts, or scoring
- choose a stylized renderer rather than a strictly realistic one
- expose itself through its own web component or framework wrapper

This is where first-order learning experiences and games should live.

### Host Adapters

Host adapters expose the runtime to real applications.

Planned surfaces:

- plain JavaScript `createViewer()`
- a source-first Astro integration pattern built directly on the JavaScript module surface
- app-specific adapters such as `<fis-spaceship-game>` where that is genuinely useful
- a custom element, likely `<fis-viewer>`, once the website use cases have settled
- a thin React wrapper when needed

Working distribution assumption for browser-first consumers:

- the Found in Space website should first consume viewer source modules as a normal npm or GitHub dependency and build custom Astro components on top
- those source-first integrations should pass dataset and sidecar URLs explicitly, with project-specific defaults living in thin app helpers rather than in the generic runtime
- the default web-component path should be an npm package that includes its required static assets
- browser-only consumers should be able to load a version-pinned build from a package CDN such as `unpkg`
- asset URLs should resolve relative to the installed module, for example with `import.meta.url`, rather than pointing at a hard-coded Found in Space host
- schools or other downstream users should not need to host constellation graphics themselves just to use the default component

## Scene Targets And Orientation

Top-level apps should choose scene targets and orientation explicitly.

Working assumption:

- useful target centers such as Orion, the galactic center, and other authored points of interest should live in a shared top-level constants module
- lower layers should receive an explicit transform or target rather than quietly defaulting to Orion
- `TargetFrustumField` and scene orientation may often use the same target, but they are separate concerns and should still be wired explicitly
- identity transforms are acceptable as a neutral fallback for generic layers; hidden astronomy-specific defaults are not

## Interest Fields

### ObserverShellField

This loads nodes that are theoretically visible in any direction around the observer, using only the shared magnitude-shell rule. Because the field is observer-centered rather than view-centered, head or look-direction changes alone should not cause a different node set to load.

Best for:

- VR free roam
- general exploration
- experiences where the user may turn quickly in any direction

Benefits:

- orientation agnostic
- robust in VR
- head motion alone does not drive load churn
- simple mental model
- uses the shared magnitude-shell visibility prune directly

Costs:

- loads stars that matter "around" the observer, not necessarily "along" the journey
- can overfetch for guided travel

### TargetFrustumField

This is a refined version of `ObserverShellField`: it applies the same shared magnitude-shell visibility prune, then rejects nodes that fall outside a bounded view frustum. It is intentionally view-centered, so camera orientation is allowed to affect loading when the experience is directed toward a known target.

Best for:

- fly-toward-constellation experiences
- target-locked Orion scenes
- device-driven parallax where the user is not expected to look all around

Benefits:

- avoids loading stars that are clearly outside the visible target view
- stays in sync with `ObserverShellField` by reusing the same magnitude-shell prune before adding the frustum reject
- aligns well with simple mouse or device parallax
- can use modest FoV padding or overscan when a directed view still needs some natural look-around tolerance
- keeps the implementation focused on the current requirement rather than a more general corridor system

Costs:

- not appropriate for full look-around exploration
- needs a known target and a chosen field of view
- head or camera turns can change the selected node set by design
- should not include extra local overrides; narrow-FOV loading should stay directional

### Deferred fields

The following field ideas remain valid, but they are intentionally deferred until a real experience requires them.

#### PathCorridorField

A broader route corridor, cone, or capsule aligned with authored travel.

#### TargetClusterField

A semantic target-set field for curated stars, systems, or sidecar-backed groups.

#### HybridField

A composite field that merges two or more strategies while keeping the runtime itself agnostic.

## Scene Preset Matrix

This matrix describes useful preset families for the current Found in Space use cases. Desktop and XR rows are separate viewer instances with different rig topologies — they share `DatasetSession` but nothing else at runtime.

It is not intended to constrain the generic library.

**Desktop viewer presets:**

| Use case | Primary field | Likely layers | Controller config |
|---|---|---|---|
| Free travel | `ObserverShellField` | `StarFieldLayer`, `LabelsLayer` | `CameraRigController` (direct) |
| Constellation changes | `TargetFrustumField` | `StarFieldLayer`, `ConstellationProjectionLayer`, `ConstellationArtLayer` | `CameraRigController` (automation / guided) |
| Device parallax | `TargetFrustumField` | `StarFieldLayer`, `ConstellationProjectionLayer` | `ParallaxController`, `DeviceOrientationController` |
| Invisible nearby stars | `ObserverShellField` | `StarFieldLayer`, `NearbyDwarfsLayer`, `LabelsLayer` | `CameraRigController` (direct) |
| Exoplanet explorer | `ObserverShellField`; later semantic field | `StarFieldLayer`, `ExoplanetHostsLayer`, `LabelsLayer` | `CameraRigController` (direct + automation) |

**XR viewer presets (separate viewer instance, spaceship rig):**

| Use case | Primary field | Likely layers | Controller config |
|---|---|---|---|
| VR free roam | `ObserverShellField` | `StarFieldLayer`, optional `ConstellationArtLayer` | `CameraRigController` (xr: true) |

**Future (separate viewer instance):**

| Use case | Primary field | Likely layers | Controller config |
|---|---|---|---|
| AR galaxy in your palm | likely a separate galaxy-scale field | `GalaxyArmsLayer`, optional bright-star layer | `ARPlacementController` |

## Data And Caching

`DatasetSession` is the correct boundary for sharing between viewer instances. It owns CPU-side data caches that are independent of any particular rig, scene graph, or rendering mode. A desktop viewer and an XR viewer on the same page can share one `DatasetSession` safely because it has no knowledge of cameras, rigs, or scene nodes.

Recommended shared caches inside `DatasetSession`:

- bootstrap header cache
- shard table cache
- decoded payload cache for hot nodes
- optional compressed byte-span cache for coalesced payload range fetches when over-read gaps are intentionally reused
- per-sidecar metadata or object caches
- semantic index cache for constellations, exoplanet hosts, and curated routes

Recommended constraints:

- GPU buffers stay per viewer instance
- render caches are keyed by dataset UUID
- sidecar caches are keyed by `parentDatasetUuid`, sidecar name, and `sidecarUuid`
- optional persistent storage lives in IndexedDB
- the runtime can opt into prefetch based on the active experience

Multiple viewers on the same page (including a desktop viewer and an XR viewer) should ideally share a single `DatasetSession`. This is safe because `DatasetSession` has no rendering, rig, or camera dependencies.

### Payload Streaming

Render-payload loading should be treated as a first-class shared service concern rather than as an incidental detail inside one layer.

Recommended batching behavior:

- explicit warmup paths may prefetch the root shard together with the header when the index is contiguous after the file header
- otherwise, the first real shard read should fetch a sensible prefetch-sized range rather than a tiny probe, so depth-first traversal can reuse nearby shard bytes
- payload nodes selected by the active field should be sorted by payload byte offset
- nearby payload byte ranges should be coalesced into explicit range batches
- batching should be controlled by explicit knobs such as `maxGapBytes`, `maxBatchBytes`, and `maxInflightBatches`
- the system should prefer fewer network requests even when that means intentionally over-reading small byte gaps between nearby payloads
- the minimum acceptable implementation is the legacy-style gap-aware coalescer for already selected payload nodes; more predictive prefetching can come later

Recommended observability:

- count selected payload nodes separately from network requests
- report raw payload bytes, requested span bytes, and over-read gap bytes separately
- report cache hits separately for shard/header caches and payload/span caches
- make these counters visible in the demo and in service inspection output so field strategies can be compared honestly
- post-shader visible-star counts are desirable, but truthful node and request counts matter first and can ship ahead of perfect visibility instrumentation

Recommended scheduling model:

- distinguish relatively stable coarse payloads from rapidly changing fine payloads
- stable versus volatile is not only a VR concern; it also applies to directed travel such as flying in a straight line toward a constellation or distant star
- coarse nodes often persist across many frames while fine nodes churn near the frontier of motion, so they should be allowed to use different queues or priorities
- this scheduling policy should live in payload streaming services or selection-to-fetch orchestration, not in the generic runtime core

Likely future improvements after the minimum batching baseline:

- optional compressed span caching so intentional over-read gaps can be reused directly
- adaptive batching knobs based on observed latency and throughput rather than fixed defaults alone
- predictive prefetch beyond the already selected node set when a real experience justifies it
- separate stable and volatile queues with policy tuned per experience rather than globally

## Public Embedding API

The runtime should expose a small, host-friendly surface.

```ts
const datasetSession = getDatasetSession({
  manifestUrl,
  octreeUrl,
  identifiersOrderUrl,
  sidecars: {
    exoplanets: { url: exoplanetsUrl },
    stellarParameters: { url: stellarParametersUrl },
  },
});

const viewer = await createViewer(element, {
  datasetSession,
  interestField,
  layers,
  controllers,
  overlays,
});
```

Note:

- `getDatasetSession()` is synchronous — it creates the shared dataset shell rather than performing bootstrap I/O up front
- render bootstrap is resolved behind the shared boundary while keeping `getDatasetSession()` itself synchronous
- the `identifiers/order` artifact is part of the base dataset package, not an ordinary named sidecar
- the current implementation supports a `metaUrl` fallback for convenience, but the intended architecture is a named `sidecars` map with UUID validation

Optional convenience layer:

```ts
const viewer = await createViewerFromScene(element, {
  dataset,
  scene: scenes.constellationMorph({ constellation: 'orion' }),
});
```

Viewer methods:

- `start()`
- `stop()`
- `refreshSelection()`
- `setState()`
- `resize()`
- `dispose()`
- `getSnapshotState()`

XR-specific viewer methods (used by XR viewer instances, not desktop viewers):

- `enterXR(options)` — start an immersive VR session
- `exitXR()` — end the active XR session
- `isXrModeSupported(mode)` — check hardware/browser support

Likely later additions:

- `setScene()`

Useful host-level patterns:

- hydrate once and swap scenes or apps in place
- share one dataset across many small embeds
- deep link into scene state from website journeys
- mount authored apps that use the same underlying services
- publish browser-friendly bundles that can carry their own static assets without depending on a Found in Space origin

## Source Layout

```text
src/
  core/           # ViewerRuntime, runtime-rig (createDesktopRig, createXrRig), contracts
  controllers/    # Desktop: CameraRigController, PickController
                  # XR: XrLocomotionController, XrPickController
                  # Shared: camera-rig (pure math), SelectionRefreshController
  demo/           # Demo entry points (main, xr-free-roam, fly-orbit, etc.)
  fields/         # ObserverShellField, TargetFrustumField, octree selection
  layers/         # StarFieldLayer, ConstellationArtLayer, materials
  services/       # DatasetSession, render octree service, sidecar services
  index.js        # Package entry point — public API exports
```

Demo HTML lives in `demos/`. Each demo page has a corresponding entry in `src/demo/` and is registered in `vite.config.js`.

Desktop demos and XR demos are separate pages with separate entry points. An XR demo creates a viewer with the XR rig; a desktop demo creates a viewer with the desktop rig. They do not share a canvas or transition between modes.

## Anti-Patterns

- Do not hard-code new experience logic into the runtime core.
- Do not couple website framework decisions to viewer internals.
- Do not make `SceneDefinition` mandatory for generic library consumers.
- Do not make VR the organizing principle for all viewer code.
- Do not add experience-specific behaviour to the generic runtime when it belongs in a controller, layer, or app.
- Do not make a desktop change that requires a corresponding XR change, or vice versa. If a shared module needs branching on `xr.presenting`, the module boundary is in the wrong place — split the concern into desktop-specific and XR-specific code behind a clean interface.
- Do not share rig nodes, controllers, or visual objects between desktop and XR viewers. Share `DatasetSession` and reusable pure-logic modules; keep everything tied to a scene graph separate.

## Open Questions

- Should AR use the same octree, a derived summary dataset, or both?
- Does the runtime stay in this repo as direct source, or become a package workspace later?
- Which sidecar descriptors belong in the first manifest version beyond required dataset UUID matching?
- How should deep links encode experience state for the website?

## Backlog

- Replace the current derived dataset-identity fallback with canonical header UUIDs when the octree format exposes them.

## Related Documents

- [xr-architecture.md](xr-architecture.md) — WebXR spaceship rig, scale conventions, input handling, and XR-specific agent rules
