# SkyKit Architecture

Historical note:

- this document started as the migration architecture for the "next runtime" developed beside the older VR-specific app
- references to the "next runtime" should now be read as the current SkyKit runtime
- references to `src/next/` should now be read as `src/`

## Status

- Accepted as the working migration architecture
- Phase 1 runtime skeleton is implemented under `src/`
- Phase 2 shared data services are now implemented under `src/services/`
- Phase 3 core layers are now implemented under `src/layers/`
- Phase 5 and Phase 5B controller, rig, and scene-composition decisions are now absorbed into this document
- The migration from the earlier VR-specific app has now landed in the current `src/` runtime.
- The older prototype remains historical reference material only.

## Why This Exists

The original VR viewer was a successful experiment for WebXR starfield exploration, but it was shaped like an app rather than a reusable platform.

That matters because the project now has a wider set of use cases:

1. free travel through space
2. constellation change as the observer moves
3. device-driven parallax on desktop and tablet
4. exploration of nearby faint and invisible stars
5. exoplanet host exploration
6. VR free roam
7. AR "galaxy in your palm" views

Those experiences do not all want the same camera model, loading strategy, overlays, or even dataset shape. The architecture therefore needs to separate the durable services from the experience-specific shells.

## Goals

- Treat this repository as a viewer platform, not only as a VR app.
- Support JavaScript-first reusable modules that can be wrapped for web components, React, Astro, and other hosts.
- Keep VR, desktop, and AR as modes or adapters, not as separate products by default.
- Separate node selection, data loading, rendering, input, and UI concerns.
- Support more than one spatial loading strategy.
- Allow multiple viewers on one page to share dataset state where possible.
- Preserve a low-risk path from the current code to the new code.

## Non-goals

- Rewriting the legacy viewer in place.
- Preserving the current module boundaries forever.
- Forcing all experiences to use the same star dataset or the same layer set.
- Shipping all seven target experiences before the new runtime becomes useful.

## Design Principles

- Build new services beside the legacy code, then cut over.
- One loader and cache layer, many experiences.
- Separate interest selection from fetch and render.
- Treat experiences as composition, not forks.
- Keep the public embedding API smaller than the internal architecture.
- Keep the generic library service-first; let website journeys sit on top as optional presets or apps.

## Phase 0 Decisions

The following Phase 0 decisions are accepted as the working plan for the runtime.

### D1. Migration Model

- Build the new runtime beside the legacy code.
- Do not try to "fix" the current experimental app in place.
- Cut over only when the new runtime has earned it.

### D2. Source Layout For New Work

- Runtime work now lives under `src/`.
- The old split between `src/` and `src/next/` is no longer part of the current structure.
- Do not create churn by moving legacy files before the new structure starts paying for itself.

### D3. Legacy Policy

- The legacy path remains the reference implementation and fallback while migration is in progress.
- Legacy code should receive bug fixes and essential maintenance only.
- Major new capabilities should not land only in the legacy path.

### D4. Core Library Contract

- Direct service composition is the primary contract for the generic library.
- `SceneDefinition` is optional and exists mainly for reusable preset families such as website journeys, deep links, and saved states.
- `ExperienceApp` is a first-order deliverable for games, learning experiences, and other authored applications.

### D5. Interest Field Naming

- The current onion concept becomes the conceptual `ObserverShellField`.
- Legacy class names do not need to change immediately.
- New docs and new code should use the `ObserverShellField` terminology.

### D6. Renderer Scope

- Three.js remains the rendering backend for the runtime.
- Do not introduce a generic renderer abstraction in Phase 0.
- Revisit renderer abstraction only if a concrete second backend becomes necessary later.

### D7. First Proof Deliverables

The first proof set for the new runtime should be:

- free travel
- constellation changes
- device parallax
- one non-website-style app, such as a spaceship game, to prove the generic library is not coupled to journey presets

### D8. Initial Cutover Scope

- Desktop and VR are in scope for the first cutover.
- AR is explicitly not required for the first cutover.
- AR remains an important later adapter, not a blocker for the initial migration.

### D9. Evaluation Metrics

When comparing old and new loading strategies or runtime behaviour, track at least:

- nodes selected
- nodes fetched
- stars rendered
- startup time
- memory footprint
- path overfetch

### D10. Minimum Cutover Bar

The initial cutover bar is accepted as:

- stable desktop rendering
- shared dataset caching
- `ObserverShellField`
- a target-locked field for Orion-style parallax scenes, currently `TargetFrustumField`
- three real experiences
- one reusable embedding surface
- one authored app that uses direct service composition rather than depending on scene presets
- a VR path if VR remains part of the immediate public offer

## Phase 1 Clarifications

The following Phase 1 implementation decisions are accepted as clarifications to the working architecture.

### D11. Scope Boundary For Phase 1

- Phase 1 is about runtime structure, lifecycle, and host surface only.
- Shared octree bootstrap, payload loading, and metadata services were intentionally deferred to Phase 2.
- Placeholder fields and layers are acceptable in Phase 1 when they exist only to prove boot, resize, snapshot, and disposal behaviour.

### D12. Runtime Part Lifecycle

- Runtime-managed parts may implement `attach`, `start`, `update`, `resize`, and `dispose`.
- `ViewerRuntime` owns hook order, including reverse-order disposal.
- `InterestField` keeps its separate `selectNodes(context)` contract.

### D13. Interest Field Wiring

- The runtime currently accepts one active `interestField`.
- If several strategies need to be combined later, that composition should live inside a field rather than in the runtime itself.
- The runtime should remain agnostic to how a field produces its selection.

### D14. Initial Embed Surface

- `createViewer(host, options)` is the first generic embedding entry point.
- The returned handle currently supports `start`, `stop`, `resize`, `refreshSelection`, `setState`, `getSnapshotState`, and `dispose`.
- The public embedding API may grow later, but it should remain smaller than the internal runtime API.

### D15. Parallel Demo Entry

- The runtime should keep separate HTML demo entries from older prototypes while migration and validation are still useful.
- `index.html` now hosts the current free-roam demo.
- Additional demo pages are acceptable when they keep one milestone proof isolated from another.
- Multi-entry build tooling is acceptable while historical prototype demos and current runtime demos coexist.

## Phase 2 Working Assumptions

The following assumptions are accepted as the current working plan for shared data services.

### D16. Canonical Dataset Identity

- Each octree header should carry a dataset UUID.
- That UUID is the canonical identity for dataset compatibility, cache safety, and same-page sharing.
- `DatasetSession` may still expose a derived `versionKey`, but it should ultimately come from the dataset UUID rather than from URLs alone.
- File-format versions and manifest-format versions remain separate concerns from dataset identity.

### D17. Multi-Sidecar Model

- A dataset may expose more than one named sidecar at the same time.
- Sidecars should be addressed by stable names or capability keys, not by a single hard-coded `meta` slot.
- Each sidecar should declare both a `parentDatasetUuid` and a `sidecarUuid`.
- `parentDatasetUuid` binds the sidecar to the render octree whose star order it matches.
- `sidecarUuid` identifies one concrete version of that sidecar for caching and invalidation.
- `DatasetSession` should own the sidecar registry and the per-sidecar caches.
- The foundational Stage 2 `identifiers/order` artifact belongs to the base dataset package, not to the optional named sidecar registry.

Examples of likely sidecars:

- `exoplanets`
- `stellarParameters`
- `curatedRoutes`

## Phase 2 Implementation Clarifications

The following Phase 2 implementation decisions are accepted as clarifications to the working architecture.

### D18. Phase 2 Source Boundary

- Shared data services now live under `src/services/`.
- The current runtime should not depend on imports from the older prototype path.
- The older prototype remains a reference implementation only and should be removable without breaking the runtime.

### D19. Current Shared Render Service

- `DatasetSession` now owns a session-scoped render octree service.
- That service owns render bootstrap loading, root-shard warmup, shard reads, and payload fetch/decode.
- Bootstrap, shard, and payload caches are CPU-side session caches and are shareable across viewer instances.

### D20. Current Shared Sidecar Service

- The current `meta` sidecar is implemented as the first concrete runtime sidecar service.
- Metadata cell lookup and parsed cell caches now live on the session rather than on individual viewer instances.
- The broader named sidecar model remains the target architecture, but the current implementation proof is the existing `meta` family.

### D21. Temporary Dataset Identity Fallback

- Until octree headers expose canonical dataset UUIDs, `DatasetSession` derives dataset identity from the render URL plus a header fingerprint.
- The current `meta` sidecar service similarly derives `sidecarUuid` when no explicit UUID is available.
- This derived identity model is a temporary compatibility bridge and should be replaced when real header UUIDs arrive.

### D22. Phase 2 Demo Proof

- `index-shared.html` now proves shared session behavior with two viewer instances on one page.
- The demo warms render bootstrap and root-shard state once per shared `DatasetSession`.
- The same demo also validates the current `meta` sidecar through the session-owned service path.

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
- no hard-coded VR-only controls
- no dataset fetch policy beyond calling the active services
- no requirement that consumers use website-oriented scene presets

Phase 1 runtime-part contract:

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

The current onion concept should be renamed conceptually to `ObserverShellField` so it reads as one strategy among several rather than the whole loading model.

Phase 4 working assumption:

- limiting magnitude is a viewer-level runtime setting such as `state.mDesired`
- dataset `header.magLimit` is indexing metadata (`mIndex`) for shell-style node pruning, not a user-facing visibility default
- fields consume that setting for node selection
- render layers consume that same setting for star visibility
- dataset and cache services stay agnostic to it

Current Phase 4 working fields:

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

Examples:

- `FreeFlyController`
- `ParallaxController`
- `DeviceOrientationController`
- `XRLocomotionController`
- `ARPlacementController`
- `GuidedPathController`

Controllers should update runtime state. They should not decide what gets loaded by themselves.

Accepted controller ownership model:

- use a two-layer model: serializable semantic state in `runtime.state`, plus transient view-rig transforms for immediate rendering
- controllers should not call dataset services directly
- controllers should not decide which octree nodes get loaded
- controllers may update rig nodes directly when low-latency motion matters, but they should publish canonical semantic state whenever the motion has meaning beyond one frame

Useful runtime rig parts:

- `navigationRoot`: the authored or locomoted viewer position
- `cameraMount`: the node the camera sits under
- `attachmentRoot`: user-local attachments such as controller rays, pointers, or a ship shell
- `contentRoot`: stars, constellation art, and other scene content

Important split:

- semantic navigation state belongs in `runtime.state`
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

### Current Controller Roles

- `FreeFlyController`: desktop free roam; updates `observerPc`; usually pairs with `ObserverShellField`
- `XRLocomotionController`: XR input path for the same observer-centered model; locomotion moves the user, while scale changes the rendered model and is not a substitute for locomotion
- `ParallaxController`: target-locked website effect; preserves a stable base `observerPc` and `targetPc` while applying small transient rig offsets, usually with `TargetFrustumField`
- `GuidedPathController`: authored travel toward, around, or between points of interest; updates `observerPc`, `targetPc`, `routeSegmentIndex`, and `routeSegmentT`, and may hand off from target-locked travel into local exploration

The initial guided-route vocabulary only needs:

- `travelTo`
- `lookAt`
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

This matrix describes useful preset families for the current Found in Space use cases.

It is not intended to constrain the generic library.

| Use case | Primary field | Likely layers | Likely controllers |
|---|---|---|---|
| Free travel | `ObserverShellField` | `StarFieldLayer`, `LabelsLayer` | `FreeFlyController` |
| Constellation changes | `TargetFrustumField` | `StarFieldLayer`, `ConstellationProjectionLayer`, `ConstellationArtLayer` | `GuidedPathController` or `ParallaxController` |
| Device parallax | `TargetFrustumField` | `StarFieldLayer`, `ConstellationProjectionLayer` | `ParallaxController`, `DeviceOrientationController` |
| Invisible nearby stars | `ObserverShellField` | `StarFieldLayer`, `NearbyDwarfsLayer`, `LabelsLayer` | `FreeFlyController` |
| Exoplanet explorer | `ObserverShellField` first; later semantic field if needed | `StarFieldLayer`, `ExoplanetHostsLayer`, `LabelsLayer` | `GuidedPathController`, `FreeFlyController` |
| VR free roam | `ObserverShellField` | `StarFieldLayer`, `LabelsLayer`, optional `ConstellationArtLayer` | `XRLocomotionController` |
| AR galaxy in your palm | likely a separate galaxy-scale field or none | `GalaxyArmsLayer`, optional bright-star layer | `ARPlacementController` |

## Data And Caching

The new architecture should share CPU-side state aggressively.

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

Multiple viewers on the same page should ideally share a single `DatasetSession`.

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

- `getDatasetSession()` is currently synchronous in Phase 1 because it creates the shared dataset shell rather than performing bootstrap I/O up front
- Phase 2 now resolves render bootstrap behind that shared boundary while keeping `getDatasetSession()` itself synchronous
- the Stage 2 `identifiers/order` artifact should be modeled as part of the base dataset package rather than as an ordinary named sidecar family
- the current implementation still supports a legacy-style `metaUrl` fallback for convenience, but the intended architecture is a named `sidecars` map backed by dataset UUID, `parentDatasetUuid`, and `sidecarUuid` validation

Optional convenience layer:

```ts
const viewer = await createViewerFromScene(element, {
  dataset,
  scene: scenes.constellationMorph({ constellation: 'orion' }),
});
```

Useful viewer methods:

- `start()`
- `stop()`
- `refreshSelection()`
- `setState()`
- `resize()`
- `dispose()`
- `getSnapshotState()`

Likely later additions:

- `setScene()`
- `enterXR()`

Useful host-level patterns:

- hydrate once and swap scenes or apps in place
- share one dataset across many small embeds
- deep link into scene state from website journeys
- mount authored apps that use the same underlying services
- publish browser-friendly bundles that can carry their own static assets without depending on a Found in Space origin

## Suggested Source Layout

The immediate goal is not a monorepo or a package split. The immediate goal is to create parallel structure inside the current repository.

One workable near-term layout:

```text
src/
  ...legacy files remain in place for now
  next/
    core/
    demo/
    embeds/
    fields/
    layers/
    services/
```

`services/` now exists as part of Phase 2. Additional directories such as `controllers/`, `scenes/`, and `apps/` are still expected as later phases land.

A future `src/legacy/` move remains optional. It should only happen if it starts reducing confusion rather than creating churn.

If the repository later needs a package workspace, this structure can be promoted without changing the conceptual model.

## Migration Strategy

Do not "fix" the legacy app in place.

Instead:

1. Freeze the current runtime as the legacy reference.
2. Build new services and runtime code beside it.
3. Reuse pieces from legacy code only through deliberate adapters or copied logic where that is genuinely helpful.
4. Stand up a separate demo entry point for the current runtime.
5. Port scenes and apps one by one.
6. Swap the default entry point only when the new runtime has earned it.

This is a strangler-style migration. It keeps risk low, preserves momentum, and gives the new architecture room to become coherent before it has to carry the whole product.

## Immediate Priorities

- create the new core service boundaries
- make the current onion logic one `InterestField` strategy
- ship a target-locked field for Orion-style parallax scenes
- prove same-page dataset sharing
- ship two or three flagship scenes or apps before full cutover

## Open Questions

- Should AR use the same octree, a derived summary dataset, or both?
- Does the runtime stay in this repo as direct source, or become a package workspace later?
- Which sidecar descriptors belong in the first manifest version beyond required dataset UUID matching?
- How should deep links encode experience state for the website?
- Which scenes or apps are required before the new runtime becomes the default?
