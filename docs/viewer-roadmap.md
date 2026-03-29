# SkyKit Roadmap

Historical note:

- this document began as the migration roadmap from the older VR-specific repo into the current reusable runtime
- references to the "next runtime" should now be read as the current SkyKit runtime
- references to `src/next/` should now be read as `src/`

## Delivery Approach

This plan began with a parallel-build strategy:

- keep the current runtime working
- build the new runtime beside it
- cut over only when the new path is stable enough

The goal is steady progress without forcing the experimental app to become the final architecture.

Phases 0, 1, 2, 3, 4, and 5 are complete. Active work now begins at Phase 5B. Accepted decisions are recorded in `viewer-architecture.md`.

## Phase 5: Controllers, Scene Presets, And Apps

Status:

- Completed

Outcome:

- the skykit runtime has a stable controller baseline that proves real free-roam behavior
- the runtime now has an explicit rig split for semantic navigation versus transient view or attachment behavior
- dataset and sidecar configuration can be passed in by host apps, with thin Found in Space defaults layered on top

Completed implementation focus:

- implement `FreeFlyController`
- implement a shared selection refresh scheduler for observer-driven reselection
- move scene targets and orientation onto an explicit top-level configuration path with shared named centers such as Orion
- make render warmup and prefetch behavior explicit, including a root-shard warm path and a minimum legacy-style gap-aware payload batching baseline
- land an explicit runtime rig boundary so transient camera and attachment behavior do not blur into semantic navigation state
- expose the skykit runtime as a source-level dependency surface suitable for Astro-first integration

Notes:

- broader XR validation continues in Phase 5B
- parallax, guided journeys, and richer preset work now continue in Phase 6 rather than blocking closure of the stable Phase 5 baseline

## Phase 5B: XR Free-Roam Validation

Outcome:

- the skykit runtime proves that stripped-down VR free roam behaves acceptably on a headset before broader website work proceeds

Tasks:

- add a minimal XR adapter path to the runtime
- implement a narrow `XRLocomotionController` for free roam only
- build a simple VR free-roam demo using `ObserverShellField`, the new rig split, and the shared selection refresh policy
- reuse the new runtime star-field path rather than chasing full legacy VR feature parity
- validate progressive loading and frame pacing on real headset hardware
- keep scope intentionally narrow: no pointer labels, no advanced HUD, and no broad interaction parity unless needed for diagnosis

Exit criteria:

- a stripped-down VR free-roam demo works on the new runtime
- the rig infrastructure handles XR head pose and locomotion cleanly
- the headset path supports full 4π steradian lookaround without obvious lag, including free movement with full 6DoF head and rig motion
- simple joystick locomotion forward, backward, and sideways works well enough to validate long-distance reselection and reloading behavior
- progressive loading and performance are good enough to proceed with website-facing Phase 6 work

## Phase 6: Embeds And Website Integration

Outcome:

- the viewer becomes easy to consume outside this repo's demo shell

Tasks:

- define the first website journeys and launch use cases
- implement the first website-facing interactive experiences, starting with free roam launch points and parallax
- stabilize and package plain JavaScript `createViewer()` for source-level consumption via npm or GitHub
- document Astro-first source integration for custom website components
- let source-level integrations pass dataset and sidecar URLs explicitly, with Found in Space defaults living in thin app helpers rather than in the generic runtime
- carry shared-`DatasetSession` behavior from demo pages into real host pages
- support app-specific adapters when useful
- ship a generic viewer web component after the website use cases settle
- ship a thin React wrapper when there is real demand

Working distribution assumption:

- the Found in Space website should initially depend on viewer source modules directly rather than using a public web component
- the first website integration should use custom Astro components that can do deeper app-specific composition than a generic web component would allow
- the default web-component distribution path should be an npm package rather than a project-hosted script
- the package should include its required static assets so downstream users do not need to host constellation graphics themselves
- browser-only consumers should be able to use a version-pinned CDN path such as `unpkg`
- asset URLs should resolve relative to the installed module rather than to a hard-coded Found in Space origin

Exit criteria:

- one page can host multiple embeds without repeating bootstrap work
- website journeys can launch or hydrate the new viewer cleanly
- the website can consume the viewer as a normal source dependency without relying on ad hoc copy-paste integration

## Phase 7: XR And AR Adapters

Outcome:

- the runtime supports VR and AR as adapters rather than as the architecture itself

Tasks:

- port VR locomotion and pointer interactions to the new controller model
- add VR-oriented streaming policy improvements such as adaptive batching knobs, predictive prefetch where justified, and stable-versus-volatile queue policy
- decide whether AR uses the local-star octree, a galaxy summary dataset, or both
- implement `ARPlacementController` if AR remains in scope

Exit criteria:

- XR adapters cover more than the narrow Phase 5B validation path, including reusable controller and pointer integration
- the architecture no longer depends on a VR-first app shell

## Phase 8: Cutover

Outcome:

- the new runtime becomes the default path

Tasks:

- compare feature coverage between the migration prototype and the current skykit path
- set a cutover checklist
- switch demo or default entry points
- keep the legacy runtime available briefly as fallback if needed
- remove or archive legacy code only after confidence is high

Exit criteria:

- the default skykit path uses the current runtime
- the website uses the new embeds or adapters
- the legacy path is no longer carrying required product features

## Recommended Cutover Bar

Before cutover, the new runtime should have:

- stable desktop rendering
- shared dataset caching
- `ObserverShellField`
- `TargetFrustumField`
- three real experiences
- one reusable embedding surface
- one authored app that uses direct service composition rather than depending on scene presets
- a VR path if VR remains part of the immediate public offer

## What Not To Do

- do not keep widening the legacy app while the skykit runtime is being designed
- do not hard-code new experience logic into the skykit runtime core
- do not couple website framework decisions to viewer internals
- do not make `SceneDefinition` mandatory for generic library consumers
- do not make VR the organizing principle for all future viewer code

## Tracking Questions

- Which sidecar types should get first-class manifest entries first?
- Which experiences matter most for the first public launch?
- How much performance instrumentation do we need before choosing default interest fields?
- When does it become worth splitting the repo into packages?

## Backlog

- replace the current derived dataset-identity fallback with canonical header UUIDs when the octree format exposes them cleanly

## Completed Phases

### Phase 0: Decisions And Scaffolding

Status:

- Completed

Outcome:

- the architecture is written down
- naming is aligned
- the migration strategy is explicit

Accepted decisions:

- the migration uses a parallel-build model rather than an in-place rewrite
- the current onion concept becomes `ObserverShellField`
- skykit runtime code lives under `src/`
- service composition is the primary generic-library contract
- `SceneDefinition` is optional and mainly supports reusable preset families such as website journeys
- authored apps and games are first-order deliverables
- Three.js remains the rendering backend for the runtime
- desktop and VR are in scope for first cutover, while AR is not required for that cutover
- the minimum cutover bar is accepted as the working threshold for migration

Reference:

- see `viewer-architecture.md`, especially the Phase 0 decision log

### Phase 1: Next-Generation Runtime Skeleton

Status:

- Completed

Outcome:

- a reusable runtime scaffold exists beside the legacy app
- the repo has a separate demo entry that can create, resize, snapshot, and dispose the new runtime cleanly

Accepted implementation decisions:

- `DatasetSession` is now the shared dataset boundary shell, with version keys, capability metadata, sidecar metadata, named caches, and disposal
- `ViewerRuntime` owns renderer and canvas binding, scene lifecycle, frame loop, resize handling, and reverse-order disposal
- runtime parts use optional `attach`, `start`, `update`, `resize`, and `dispose` hooks
- `createViewer()` is the first plain JavaScript embedding surface for the new runtime
- the legacy runtime stayed isolated during migration while the current desktop demo owned `index.html`
- placeholder field and layer implementations are acceptable in Phase 1 when they exist only to prove the runtime skeleton

Reference:

- see `viewer-architecture.md` for Phase 0 decisions and Phase 1 clarifications

### Phase 2: Shared Data Services

Status:

- Completed

Outcome:

- data access now lives in reusable services under `src/`
- multiple viewers can share underlying dataset state through one `DatasetSession`

Accepted implementation decisions:

- shared data services now live under `src/services/`, not in the legacy runtime
- `DatasetSession` owns session-scoped render bootstrap, shard, payload, and metadata caches
- the current render dataset path is implemented through a session-owned render octree service
- the current `meta` sidecar is implemented as the first session-owned sidecar service
- `index-shared.html` now demonstrates two viewers sharing a single `DatasetSession`
- dataset and sidecar identity currently use a derived header-and-URL fallback until real header UUIDs are added in a later sprint
- Phase 2 code in `src/` does not import legacy runtime modules, so the legacy path can be deleted later without breaking the runtime

Notes:

- the current sidecar implementation proof is the existing `meta` family
- the broader named sidecar registry and `identifiers/order` package model remain the architectural direction
- header UUID support is still required later, but it is no longer blocking progress on the Phase 2 service boundary

Reference:

- see `viewer-architecture.md` for the Phase 2 working assumptions and implementation clarifications

### Phase 3: Core Layers

Status:

- Completed

Outcome:

- rendering in the runtime is now layer-based rather than app-based

Accepted implementation decisions:

- `StarFieldLayer` is now the per-viewer star rendering layer for the runtime
- star rendering styles are now expressed as pluggable material profiles rather than as one fixed shader path
- the current demo compares a desktop profile against a deliberately simpler cartoon profile
- constellation art is now a separate `ConstellationArtLayer`, even when it renders in the same space as the stars
- the Stellarium-backed art path is now split into a reusable `three` module plus a thin viewer-layer adapter
- the current Phase 3 demo still uses a temporary radius-based interest field so the star layer can be exercised before Phase 4 fields land

Completion note:

- the Phase 3 exit criteria are met: the runtime now renders the local star field on desktop, and additional overlays or layers can be added without changing the runtime core
- richer pick or label behavior and future semantic layers remain valid follow-on work, but they no longer block the Phase 3 layer boundary

Reference:

- see `viewer-architecture.md` for the layer boundary and packaging notes

### Phase 4: Interest Fields

Status:

- Completed

Outcome:

- node selection is now pluggable for both free-roam and target-locked scenes

Accepted implementation decisions:

- `ObserverShellField` is now the observer-centered free-roam strategy for the runtime
- `TargetFrustumField` is now the target-locked directional strategy for parallax and guided views
- field loading rules are now documented explicitly against octree node AABBs so hidden local overrides do not creep back in
- limiting magnitude is now treated as a top-level runtime setting and is propagated to both node selection and star rendering
- node and request instrumentation now exists for honest shell-versus-frustum comparison, even though perfect post-shader visible-star counting remains follow-on work
- broader fields such as `PathCorridorField`, `TargetClusterField`, and `HybridField` remain deferred until real requirements justify them

Completion note:

- the runtime can switch between shell and target-frustum strategies without changing layer code
- shell and frustum no longer collapse to identical selection behavior because the hidden frustum-side local override has been removed
- Phase 4 now establishes the clean comparison baseline needed before controller and experience work expands in Phase 5

Reference:

- see `viewer-architecture.md` for the accepted field definitions and Phase 4 assumptions
