# SkyKit Architecture

This is the authoritative architecture document for SkyKit v1.

It replaces the older split between `viewer-architecture.md`, `xr-architecture.md`, and `hr-diagram-touch-display.md`. Those files are kept as short redirects so old links do not break, but new work should treat this file as the source of truth.

## Project Goal

SkyKit exists to make real-star datasets usable across a wide range of experiences without forcing users into one application model.

The project goal is:

- simple enough for students and beginners to do useful things with very little code
- powerful enough for advanced apps, guided lessons, XR, and games
- extensible without deep hooks, hidden framework coupling, or private imports
- modular enough that consumers only use the parts they need

The common denominator across all use cases is not "render a 3D viewer". It is:

- load relevant parts of an octree dataset
- query and transform star data
- optionally render, guide, annotate, or interact with that data

SkyKit must support the full path from:

- "show the 10 nearest stars to a coordinate in a table"
- "show visible stars in a direction from an observer"
- "embed a guided journey in a website topic"
- "build a VR or game-like experience around real stars"

## Success Criteria

We should periodically review the project against these success criteria.

### Beginner success

- A simple task should not require understanding the full runtime.
- The root package should offer sensible defaults.
- A user should be able to work headlessly without creating a canvas or a viewer.

### Architecture success

- Loading, query, coordinates, rendering, movement, and journeys have clear boundaries.
- Changes in one area do not silently leak assumptions into another.
- Desktop and XR share data services, not runtime objects tied to a scene graph.

### Product success

- Website topics keep their authored content and prose.
- Journeys are supported through public APIs, not website-only glue.
- Advanced consumers can extend behavior through explicit APIs rather than deep imports or internal mutation.

## Non-Goals

- SkyKit is not a single monolithic app.
- SkyKit should not assume the user wants a 3D viewer, a website journey, or a game.
- SkyKit should not hide behavior behind deep hooks, source-level private imports, or framework-specific conventions.
- SkyKit should not require one rendering mode, one movement model, or one UI shell.
- SkyKit should not make simple use cases pay the complexity cost of advanced ones.

## Design Principles

### 1. No hidden intent

Nothing in SkyKit should assume why the user wants the data.

- A query API should not assume rendering.
- A render API should not assume a lesson or journey.
- A journey API should not bypass the normal data and viewer boundaries.

### 2. Service-first, query-first

The reusable core starts with services:

- loading
- query
- coordinates

Rendering, movement, and journeys compose on top of that core.

### 3. Simple things should be simple

The beginner path matters as much as the advanced path.

- Root entrypoints should be small and clear.
- Sensible defaults should reduce setup work.
- Common headless use cases should not require a viewer runtime.

### 4. One-way flow

SkyKit should speak a clear language:

- commands go down
- events come up
- snapshots and selectors are the read model

This keeps data flow debuggable and makes extensions safer.

### 5. Hybrid state model

Not all state belongs in one place.

- semantic state should be serializable and suitable for snapshots, journeys, and deep-linkable app intent
- private service state should own caches, in-flight work, and decoded payloads
- render adapters may own transient state such as scene nodes, matrices, hover state, or shader internals

### 6. Public APIs over deep imports

If the website or another consumer needs functionality, we should either:

- promote it into a public API, or
- keep it clearly local to that app

We should not normalize imports from package internals such as `src/...`.

### 7. Extensibility through explicit surfaces

Plugins and extension logic should work through:

- typed commands
- typed events
- selectors
- named hooks

They should not mutate private runtime internals directly.

### 8. Optional composition

Consumers should be able to use only the parts they need.

- headless query app: loading + query
- table or teaching aid: loading + query + coords
- 2D diagnostic or panel UI: add render2d
- 3D viewer: add render3d
- game or XR app: add movement and app-specific logic

### 9. Journeys are first-class, not special cases

Guided scenes and transitions are a core supported mode of use, especially for the website. They should be built on public APIs and share the same command/state/event language as everything else.

### 10. Separate products may share data, not scene-graph objects

Desktop and XR may share a `DatasetSession`, but they should not share controllers, rig nodes, or other runtime objects bound to a specific scene graph.

## Architecture Overview

SkyKit is organized as a layered system:

```text
Apps / websites / games / lessons
  -> presets and journeys
  -> movement, render3d, render2d
  -> coords, query, loading
  -> octree dataset + sidecars
```

The package surface mirrors that structure.

### Beginner-oriented root API

The root package should stay focused on the common entrypoints:

- `createDataset(options?)`
- `queryNearestStars(dataset, options)`
- `queryVisibleStars(dataset, options)`
- `createDefaultViewer(host, options)`

These are the first APIs a beginner should find.

### Advanced subpaths

For more control, the public module boundaries are:

- `@found-in-space/skykit/loading`
- `@found-in-space/skykit/query`
- `@found-in-space/skykit/coords`
- `@found-in-space/skykit/render2d`
- `@found-in-space/skykit/render3d`
- `@found-in-space/skykit/movement`
- `@found-in-space/skykit/presets`

New work should prefer reinforcing these boundaries rather than expanding the root export surface indiscriminately.

## Areas Of Responsibility

### `loading`

Purpose:

- dataset identity
- bootstrap and root shard loading
- shared caches
- sidecar access
- prefetch and warmup entrypoints

Primary boundary:

- `DatasetSession`
- `createDataset()`

Must not own:

- camera behavior
- rendering assumptions
- website journey logic

### `query`

Purpose:

- select relevant nodes
- decode star payloads
- answer headless questions such as nearest or visible stars

Primary examples:

- `queryNearestStars()`
- `queryVisibleStars()`

Must not own:

- canvas creation
- renderer-specific scene objects

### `coords`

Purpose:

- coordinate transforms
- named targets
- orientation helpers

Must stay:

- pure where possible
- reusable by both headless and rendered flows

### `render2d`

Purpose:

- 2D visualizations and panel-friendly renderers
- touch-display-compatible controls
- diagnostic graphics that do not require a 3D viewer

Current examples:

- `HRDiagramRenderer`
- `createVolumeHRLoader`
- `createHRDiagramControl`

### `render3d`

Purpose:

- viewer runtime
- scene graph and rig integration
- star-field and other layers
- picking and 3D overlays

Current examples:

- `ViewerRuntime`
- `createViewer()`
- `createDefaultViewer()`

### `movement`

Purpose:

- reusable camera and route math
- locomotion and movement strategies

Must stay separate from:

- loading logic
- query decisions

### `presets`

Purpose:

- reusable scene and journey composition
- declarative scene graphs for guided experiences

Current examples:

- `createJourneyGraph()`
- `createJourneyController()`

Important rule:

- presets are a convenience layer on top of public services, not a back door into internals

## State, Commands, Events, And Plugins

SkyKit should use a stable language across services and viewers.

### Read/write contract

Advanced surfaces should follow this pattern where appropriate:

- `dispatch(command)`
- `getSnapshot()`
- `subscribe(listener)`
- `select(selector)`

### State model

Use three categories of state deliberately:

- semantic snapshot state
- private service state
- transient adapter-local render state

Examples of semantic state:

- `observerPc`
- `targetPc`
- `mDesired`
- `fieldStrategy`
- active journey scene

Examples of private service state:

- payload caches
- sidecar caches
- in-flight requests
- decoded node payload cache

Examples of transient adapter state:

- `THREE.Object3D` instances
- shader uniforms
- hover hit regions
- XR ray pose

### Command families

Typical command areas include:

- dataset load and preload
- observer or target changes
- query configuration
- viewer control
- journey navigation
- plugin-specific namespaced commands

### Event families

Typical event areas include:

- loading started, changed, completed, failed
- query started and completed
- selection changed
- pick and interaction events
- journey scene entered and exited
- diagnostics and warnings

### Plugin rule

Plugins are dispatch-oriented.

They may:

- dispatch commands
- read snapshots and selectors
- subscribe to events
- register named hooks

They may not:

- mutate private runtime fields directly
- depend on deep source imports
- require hidden knowledge of scene-graph internals

### Hook rule

If a new extension point is needed, add it explicitly and name it clearly. Do not introduce generic "reach into internals" escape hatches just to get a feature shipped.

## Data, Identity, And Caching

`DatasetSession` is the shared data boundary for one dataset identity.

It should own:

- render bootstrap and root shard access
- shared loading and payload services
- sidecar registry and validation
- canonical dataset identity
- optional shared caches across viewers

It should not own:

- DOM
- camera logic
- scene nodes

### Canonical star identity

Persistent star references should be dataset-scoped and stable within a dataset UUID/version. Resolution from star ID to star details should be on demand through dataset services.

### Sidecars

Sidecars are named, optional, and dataset-scoped.

- they are not a single hard-coded slot
- they should validate against the active dataset identity
- they should be addressable by stable names

### Shared vs per-viewer state

Share:

- bootstrap and shard knowledge
- payload and sidecar caches

Do not share:

- GPU buffers
- scene objects
- camera rigs
- controller instances

## Rendering And Viewer Products

Rendering is optional.

The headless core should remain useful even if a user never creates a viewer.

### Desktop

Desktop viewers are typically free-fly or guided 3D experiences using `render3d`, desktop controllers, and a desktop rig.

### Breakout: XR

XR is a separate viewer product, not a desktop mode toggle.

Key rules:

- desktop and XR may share a `DatasetSession`, but not scene-graph runtime objects
- the XR mental model is a spaceship moving through a stationary universe
- the deck offset is structural and static
- controller visuals belong under the XR origin, not the scene root
- do not mutate the WebXR camera directly for orientation
- use XR scale state such as `starFieldScale` for physical scale decisions, not the octree pipeline scale constant alone

The XR rig should be treated as a dedicated composition of the general architecture, not as a branch that reshapes a desktop viewer at runtime.

## Journeys, Topics, And Apps

Journeys are a primary public use case.

### Journey model

Journeys should be declarative scene graphs:

- scenes
- transitions
- optional scene command bundles

The public journey surface exists so guided flows can be built on the same foundations as queries and viewers instead of bypassing them.

### Website rule

Website topics are authored content and should keep their prose structure. The interactive layer underneath them should rely on public SkyKit APIs rather than website-local shims or deep imports.

### App rule

A game or highly authored experience is allowed to compose services directly and then layer custom logic on top. That is a supported model, not an escape hatch.

## Breakout: Touch Display And HR Diagram

The touch display is a single 2D canvas UI surface. Custom controls should fit into that model rather than trying to smuggle in extra WebGL contexts or app-specific assumptions.

### Touch display rules

- controls render into a shared 2D canvas
- item values should be plain data payloads
- controls may optionally expose hit targets and press behavior
- custom controls should preprocess heavy data outside the hot render path when possible

### HR diagram rules

The HR diagram exists in two useful forms:

- a dedicated renderer
- a touch-display control

Important constraints:

- touch-display integration should not require a second WebGL context
- the control should consume star geometry data in a plain value object
- filtering modes should remain explicit rather than inferred

This is a good example of the broader SkyKit rule: 2D and 3D presentations can share data and semantics without being forced into the same rendering implementation.

## Current Source Map

```text
src/
  core/        shared runtime primitives and dataset/session machinery
  loading/     dataset-first public loading surface
  query/       headless query helpers and decoding
  coords/      targets and coordinate transforms
  render2d/    2D renderers and touch-display-friendly controls
  render3d/    viewer runtime, layers, and 3D helpers
  movement/    camera and route math
  presets/     journeys and preset helpers
```

## Architecture Review Checklist

Use this checklist when reviewing a proposal, PR, or refactor.

### Mission fit

- Does this help the library stay simple to learn and powerful to extend?
- Does it support at least one real use case without assuming all others?
- Would a student or beginner still have a reasonable path through the API?

### Boundary fit

- Is the responsibility in the right module area?
- Does loading stay separate from movement and rendering?
- Does query stay usable without a viewer?
- Does journey logic compose with public APIs rather than bypassing them?

### API fit

- Is the simplest public entrypoint still simple?
- Is a new root export truly common enough to belong there?
- Would a subpath export be clearer?
- Are we exposing a real public API instead of forcing consumers into deep imports?

### Flow and state fit

- Is the change compatible with commands down, events up?
- Is semantic state separate from transient render state?
- Are async results and preload flows explicit rather than hidden?

### Extensibility fit

- Can this be extended through explicit commands, events, selectors, or named hooks?
- Are we avoiding internal mutation as the extension model?
- Are plugin or preset assumptions being kept out of the headless core?

### Product fit

- Does this preserve website topic content while supporting the interactive journey underneath?
- Does this keep desktop and XR as separate viewer products that only share data services?
- Does this allow non-website consumers to benefit too?

### Simplicity fit

- Can consumers use only the parts they need?
- Does a headless user avoid paying for rendering setup?
- Are defaults sensible without becoming magical or surprising?

### Documentation fit

- Does this change invalidate a principle, boundary, or review rule in this file?
- If yes, update this document and `AGENTS.md` in the same work.

## When To Update This Document

Update `docs/architecture.md` whenever a change affects:

- the mission or success criteria
- a public module boundary
- the command/event/state model
- the extension model
- desktop/XR separation
- the journey model
- the touch-display or render2d/render3d contract

If a change is important enough to guide future work, it belongs here.
