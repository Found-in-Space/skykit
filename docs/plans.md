# SkyKit v1 Plans

This document is the release-planning companion to
[architecture.md](./architecture.md).

This revision is based on the current SkyKit codebase itself:

- public exports
- demos in `src/demo/`
- docs in `docs/`
- unit tests
- public TypeScript fixtures

It does not assume that external website consumers have already migrated to the
newer public APIs. When this plan says something is "shipped", it means the
capability exists in the current SkyKit repo and public package surface.

## What v1 Should Mean

SkyKit v1 should mean all of the following are true at the same time:

- a beginner can load a dataset, ask simple questions, and make a basic viewer without learning the whole runtime
- a student can get a first success from raw browser HTML or a tool like JSFiddle through a documented ESM/CDN path
- an advanced consumer can assemble a desktop explorer, a guided journey, or a linked 2D/3D lesson from public APIs
- the package boundaries are legible enough that consumers know where to look next
- the common use cases are supported by public presets or helpers instead of repeated local glue
- desktop and XR share data services but remain separate runtime products
- the docs describe the real happy paths rather than idealized ones that current consumers do not actually use
- the learning path emphasizes quick wins before deeper runtime composition

The release bar is not only "possible". It is "obvious, honest, and repeatable".

## What Changed Since The Earlier Plan

Several items that used to be future-tense are now shipped in the codebase:

- `createFoundInSpaceDataset()` now exists in `loading` and returns a public dataset handle with explicit warmup through `ensureRootShard()` and `ensureBootstrap()`.
- A browser-native rendered quickstart now exists in `README.md` and [`browser-quickstart.html`](./browser-quickstart.html).
- `createDesktopExplorerPreset()` now ships as the standard public desktop explorer composition helper.
- Journey support is no longer only graph/controller primitives. `createViewerJourneyController()` and `applyViewerJourneyScene()` now support declarative scene actions, preload hooks, and scene-state application.
- Declaration-first TypeScript support now ships for the root package and every public subpath, with consumer fixtures in `test-types/`.

That changes the v1 plan substantially. The main work left is less about inventing the missing public API and more about making the code, docs, demos, and support promises tell the same story.

## Current v1 Readiness Snapshot

| Area | Snapshot | Main reason |
| --- | --- | --- |
| Headless loading/query/coords | strong | public handles, query APIs, docs, tests, and type fixtures are already in place |
| Dataset setup and warmup | partial-to-strong | the helper path is shipped, but many demos still use manual session bootstrap |
| Desktop explorer | strong public path, partial internal adoption | preset and browser quickstart exist, but repo demos still mostly hand-compose the stack |
| Guided journeys | strong core, partial adoption | viewer-focused journey helpers are shipped, but the canonical public demo story is still thin |
| Linked 2D/3D lessons | partial-to-strong | reusable `render2d` and Touch OS pieces exist, but orchestration stays lesson-heavy |
| Overlays, picking, annotations | partial | good public primitives exist, but higher-level detail and annotation patterns remain local |
| Constellation/parallax experiences | partial-to-strong | public preset/controller pieces exist, but no single high-level explorer preset ties them together |
| XR | advanced supported path | the runtime and tests exist, but XR should stay outside the beginner story |
| Docs and discoverability | partial | subpaths, quickstarts, and typings improved, but the root barrel is still broad |
| Tests and examples | partial-to-strong | module coverage is good, but release-story integration coverage is still light |

## Current Baseline By Area

### 1. Headless Loading, Query, And Coordinates

Shipped now:

- `createDataset()`
- `createFoundInSpaceDataset()`
- `queryNearestStars()`
- `queryVisibleStars()`
- public `coords` helpers and targets
- a headless README example
- tests and public type fixtures

What still matters before v1:

- add at least one more headless example that shows a realistic non-rendered workflow such as star lookup or sidecar use
- keep the docs sequence explicit: headless quick win first, rendered quick win second

Plan status:

- treat this area as strong
- prioritize docs polish and example clarity rather than new API invention

### 2. Dataset Session Creation And Warmup

Shipped now:

- `createFoundInSpaceDataset()` in `loading`
- dataset handles with `dispatch`, `getSnapshot`, `select`, and `subscribe`
- explicit warmup through `ensureRootShard()` and `ensureBootstrap()`
- lower-level access to `DatasetSession` and `getDatasetSession()` for custom cases

Current gap:

- many demos still use `createFoundInSpaceDatasetOptions()` plus `resolveFoundInSpaceDatasetOverrides()` plus `getDatasetSession()` directly
- the docs need to stay clear about when to use the dataset-handle helper and when to use the raw session path

Plan status:

- no new convenience API is required for v1
- the remaining work is migration and guidance, not invention

### 3. Desktop Explorer

Shipped now:

- `createDefaultViewer()`
- `createViewer()`
- `createDesktopExplorerPreset()`
- optional fullscreen, navigation HUD, and picking in the explorer preset
- a browser-native quickstart using `createFoundInSpaceDataset()` plus `createDesktopExplorerPreset()` plus `createViewer()`

Current gap:

- repo demos still mostly hand-compose the viewer stack
- `createDefaultViewer()` remains intentionally small, so docs must not imply that it covers the richer explorer story by itself

Plan status:

- the v1 decision is effectively made: keep `createDefaultViewer()` small and treat `createDesktopExplorerPreset()` as the recommended public desktop composition
- before v1, migrate at least one canonical demo or example to that path so the docs and repo usage match

### 4. Guided Journeys And Scene Graphs

Shipped now:

- `createJourneyGraph()`
- `createJourneyController()`
- `createViewerJourneyController()`
- `applyViewerJourneyScene()`
- declarative viewer scene handling for `flyAndLook`, `free-roam`, `orbit`, and polyline travel
- `preloadScene` and `applySceneState` hooks for viewer-driven journeys
- journey tests and public type fixtures

Current gap:

- there is still no single public demo that clearly says "this is the standard guided-tour story outside the HR lesson"
- highlight and annotation conventions above the scene layer remain app-specific

Plan status:

- the journey abstraction itself is no longer the blocker
- the remaining work is to standardize one public example and decide which scene-local extras should stay local

### 5. Linked 2D And 3D Lessons

Shipped now:

- `render2d` exports for `HRDiagramRenderer`, `createVolumeHRLoader()`, and `createHRDiagramControl()`
- Touch OS support across the demos and shared panel integrations
- working HR diagram demos and tests

Current gap:

- the orchestration between 2D lessons, viewer state, preload timing, and selection still lives mostly in lesson-specific code

Plan status:

- keep `render2d` stable for v1
- document linked 2D/3D lessons as an advanced supported pattern
- only promote more orchestration helpers if a second lesson needs the same abstraction

### 6. Reusable Overlays, Picking, And Annotation Layers

Shipped now:

- star picking controllers and picker services
- sidecar lookup helpers
- constellation art layer and constellation preset
- radio bubble meshes
- custom layer composition through `createViewer()`

Current gap:

- pick-to-detail UI is still local glue
- scene annotation patterns are still one-off
- there is no small public helper that turns pick results plus sidecars into a stable info-card workflow

Plan status:

- keep low-level picking and overlay pieces public
- decide whether v1 needs a tiny pick-detail helper or whether this remains app-owned

### 7. Constellation And Parallax Experiences

Shipped now:

- `createConstellationPreset()`
- `createParallaxPositionController()`
- `createTargetFrustumField()`
- reusable constellation math and art helpers

Current gap:

- there is not yet a single high-level public preset that packages the full constellation/parallax explorer story
- demos still do a lot of experience-specific glue

Plan status:

- treat this area as public-capable but not yet productized at the highest level
- v1 can ship without a giant preset here, but it needs a better documented example

### 8. XR Product Boundary

Shipped now:

- a separate XR rig model
- XR locomotion, pick, and tablet controllers
- XR depth-range helpers and XR-specific star-field state
- an XR demo and controller tests

Current gap:

- XR helpers are still mostly a power-user surface rather than a polished preset layer
- the docs must keep XR out of the beginner story

Plan status:

- SkyKit should describe XR as an advanced supported path for v1
- no further architectural work is required before v1 as long as that support promise stays explicit

### 9. Package Surface And Discoverability

Shipped now:

- root exports plus explicit subpaths
- declaration files for every public subpath
- README and browser quickstart docs that teach the subpath story

Current gap:

- the root barrel is still very broad
- some architecture language still sounds as if the root barrel is already minimal, which is not true in the code

Plan status:

- treat the broad root barrel as a compatibility reality
- teach subpaths as the recommended path for advanced work
- decide separately whether post-v1 pruning is realistic

### 10. Tests, Type Coverage, And Release Examples

Shipped now:

- unit tests across query, controllers, layers, loading, presets, and XR helpers
- public TypeScript consumer fixtures for the root barrel and subpaths
- docs examples for headless query and browser-native rendering

Current gap:

- no smoke test exercises the browser quickstart end to end
- the preset-based desktop path is documented, but repo demos do not yet prove it as the canonical internal story
- there is no standalone public guided-tour demo beyond the generic README example

Plan status:

- the remaining work is integration confidence and example curation, not first-wave API design

## Current Documentation/Code Tensions

- The architecture wants a small beginner root API, but `src/index.js` still re-exports a large advanced surface. Docs should present the recommended path honestly instead of pretending the root barrel is already slim.
- The architecture used to talk about plugins and named hooks in a generic way. In code, `registerHook()` and `registerPlugin()` exist on `SnapshotController`-based surfaces such as dataset handles and journey controllers, but not on `ViewerRuntime` or viewer handles.
- The public dataset helper and desktop explorer preset are shipped, but most demo code still uses lower-level assembly. That is an adoption gap, not a missing API.
- The `movement` subpath is currently math-first. Viewer-coupled controllers such as `createCameraRigController()` and `createXrLocomotionController()` still live under `render3d` or the root barrel because they depend on runtime lifecycle and scene state.
- This plan should not claim current website consumer adoption unless that repo is re-audited. The v1 plan needs to describe the SkyKit codebase as it exists today, then call out external migration separately.

## Must Before v1

- Make the docs explicitly consistent about the recommended desktop path: `createFoundInSpaceDataset()` plus `createDesktopExplorerPreset()` plus `createViewer()`.
- Clarify the extension model: hooks/plugins exist on snapshot-controller surfaces today, not on viewer handles.
- Migrate at least one canonical demo or example to the preset-based desktop path.
- Add one public guided-journey example or demo that is not only the HR-diagram lesson.
- Decide whether v1 needs a tiny public pick-detail helper, or document that detail UIs stay app-local.
- Add one smoke-style regression check for the browser quickstart or equivalent public rendered path.

## Should Before v1

- Add a better constellation/parallax example using the public preset/controller pieces.
- Decide whether any linked 2D/3D orchestration helper should be promoted out of lesson-local code.
- Tighten the docs so they consistently distinguish raw `DatasetSession` and `getDatasetSession()` power-user flows from dataset-handle flows via `createDataset()` and `createFoundInSpaceDataset()`.
- Decide whether the broad root barrel stays as-is for v1 or gets trimmed.

## Better After v1

- A fuller annotation framework for story-specific overlays.
- A higher-level public pick-to-metadata panel system if multiple apps need the same pattern.
- A richer XR preset layer beyond the current controller-level surface.
- Root barrel pruning if the team wants the package surface to enforce boundaries more strongly.

## Current v1 Decisions

- `createDefaultViewer()` stays intentionally small.
- `createDesktopExplorerPreset()` is the recommended public desktop explorer composition.
- `createFoundInSpaceDataset()` is the blessed convenience helper for the standard dataset family.
- `createViewerJourneyController()` plus declarative scenes is the recommended public guided-tour path.
- XR is part of SkyKit v1 as an advanced supported path, not the main beginner track.
- Public subpaths are the recommended learning and composition boundary even while the root barrel remains broad for compatibility.

## v1 Readiness Checklist

- Headless query is documented, tested, and clearly independent from rendering.
- The standard dataset helper path is documented and no longer described as missing.
- The beginner rendered story matches the shipped public APIs.
- The browser-native quickstart is documented and regression-proofed.
- The desktop explorer preset path is proven by at least one canonical example or demo.
- Guided journeys have one public non-HR example.
- Linked 2D/3D lessons are documented as an advanced pattern rather than implied to be beginner-friendly.
- Constellation/parallax exploration has at least one documented public composition example.
- XR support level is explicit.
- The docs distinguish snapshot-controller plugin surfaces from viewer runtime surfaces.
- No release-promised feature depends on deep imports or website-only shims.

## Summary

SkyKit is no longer blocked on the biggest API inventions that the earlier plan
called for. The important public pieces now exist: a standard dataset helper, a
browser quickstart, a desktop explorer preset, a viewer-focused journey helper,
and shipped TypeScript subpaths.

The remaining v1 work is mostly about convergence. The docs, demos, and support
promises need to tell the same story as the code that already ships. That means
tightening the architecture wording, migrating at least one canonical consumer
path to the new presets, and being explicit about the few boundaries that are
still broader or more limited than the ideal architecture.
