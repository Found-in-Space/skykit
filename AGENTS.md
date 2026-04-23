# SkyKit Agent Guide

Read [docs/architecture.md](./docs/architecture.md) before making substantial architectural changes. That file is the source of truth for project goals, design principles, boundaries, and review criteria.

## Mission

SkyKit is an extensible, simple-to-learn, powerful library for working with real-star octree datasets.

Agents should optimize for:

- simple use cases staying simple
- advanced use cases staying possible
- public APIs instead of deep imports
- clear boundaries between loading, query, coordinates, rendering, movement, and journeys

The common denominator is not "3D viewer". It is the ability to load, query, transform, and optionally render relevant star data.

## Hard Rules

### 1. Do not assume user intent

- Do not make a query API assume rendering.
- Do not make a render API assume a lesson, website topic, or journey.
- Do not make a journey API bypass the normal data and viewer boundaries.

### 2. Keep the architecture service-first

Prefer strengthening these public areas:

- `loading`
- `query`
- `coords`
- `render2d`
- `render3d`
- `movement`
- `presets`

Do not blur boundaries just to land a feature quickly.

### 3. Preserve the beginner path

The root package should remain the obvious place for simple work:

- `createDataset`
- `queryNearestStars`
- `queryVisibleStars`
- `createDefaultViewer`

If a change makes a beginner task noticeably harder, stop and reconsider.

### 4. Prefer public APIs over deep imports

- Do not reintroduce website-local shims for package behavior that should be public.
- Do not import from `src/...` across package boundaries.
- If a consumer needs an internal capability, promote it deliberately or keep the behavior local to that consumer.

### 5. Use one-way flow

When designing new runtime or service behavior, prefer:

- commands down
- events up
- snapshots and selectors as the read model

Do not introduce hidden cross-service mutation.

### 6. Keep plugin and extension behavior explicit

Plugins should work through:

- `dispatch`
- `getSnapshot`
- `select`
- `subscribe`
- named hooks

Do not treat private runtime objects as the extension API.

### 7. Keep desktop and XR separate

Desktop and XR may share a `DatasetSession`. They should not share scene-graph runtime objects.

Strict XR rules:

1. Never mutate the WebXR camera directly for orientation.
2. Always use the XR rig model rather than repurposing the desktop rig.
3. Parent XR controller visuals under the XR origin.
4. Keep the deck offset structural and static.
5. Use XR scale state such as `starFieldScale` for XR physical scale decisions.

### 8. Treat journeys as first-class public use cases

- Website topics should keep their authored prose.
- Interactive journeys should run on public SkyKit APIs.
- Do not solve a journey need with website-only internal shortcuts if it belongs in the library.

### 9. Render is optional

- Headless query and coordinate use cases are first-class.
- Do not require a viewer, canvas, or 3D runtime to answer data questions.

### 10. Update the docs when the architecture changes

If you change:

- a public boundary
- the state/command/event model
- the extension model
- the desktop/XR split
- the journey model

then update [docs/architecture.md](./docs/architecture.md) in the same work.

## Project Conventions

### JavaScript / Node.js

- Runtime: plain ES modules (`"type": "module"`).
- No build step for library source entrypoints.
- `src/index.js` is the main package entry.
- Dependency on `three`.

### Standard commands

- Install dependencies: `npm install`
- Run tests: `node --test`
- Watch tests: `node --test --watch`
- Dev server: `npm run dev`
- Build demos: `npm run build`

### Demos

- Demo HTML lives in `demos/`.
- Demo entries live in `src/demo/`.
- `index.html` is the demo directory page.

### Useful constants

- Default magnitude limit is `6.5`
- Scene scale is `SCALE = 0.001` parsecs to scene units

## Architecture Review Prompts

Before landing a non-trivial change, ask:

- Does this assume a user goal that should stay optional?
- Is the responsibility in the right module area?
- Could a headless consumer still use this without a viewer?
- Is the simplest API path still simple?
- Are we creating a real public surface or sneaking in a deep hook?
- Would this force desktop and XR to change together when they should not?
- Should this update `docs/architecture.md`?
