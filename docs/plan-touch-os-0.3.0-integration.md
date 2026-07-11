# Plan: Adopt `touch-os` 0.3.0 And Harden SkyKit XR Integration

## Status

Ready for implementation against the published stable release.

Verified on 2026-07-11:

- `npm view @found-in-space/touch-os@0.3.0 version` resolves `0.3.0`;
- the registry `latest` dist-tag points to `0.3.0`;
- the packed package exposes the documented root, core, component, service,
  coordination, app, host, Three host, and schema-adapter entrypoints;
- the packed declarations include the required frame timing, continuous pointer
  source, panel session, texture policy, and embedded-surface contracts.

Do not implement this plan against `0.3.0-dev.*`, an unpublished tarball, or an
automatic sibling-source alias and then describe the migration as complete. The
normal SkyKit install, tests, typecheck, examples, and release build must resolve
the actual registry release.

The completed prerequisite work is recorded in the touch-os repository plan
`docs/plan-0.3.0-release.md`. SkyKit must still repeat installed-package
verification after updating its own manifests and lockfile.

## Goal

Adopt the stable touch-os 0.3 API through the narrow SkyKit composition boundary,
fix the audited XR integration defects, and leave the XR free-roam example as a
realistic conformance consumer rather than an accidental source-level test.

This work should:

- pin SkyKit development and examples to a published touch-os release;
- guarantee that one touch intent executes one SkyKit action;
- make panel time, tracking loss, session end, detach, and disposal safe;
- correct HR-diagram surface presentation;
- fix ray-query and caller-owned resource behavior;
- preserve the architecture boundary in which touch-os owns panels and surfaces
  while SkyKit owns composition, semantic actions, and XR embodiment;
- add integration tests that use the real touch-os runtime and Three host rather
  than relying only on mocks.

## Sequencing And Dependency Policy

### 1. Verify The Published Prerequisite

Before changing SkyKit dependency ranges:

```sh
npm view @found-in-space/touch-os@0.3.0 version
npm view @found-in-space/touch-os@0.3.0 dist-tags
```

Install the exact package into a clean checkout and confirm that its packed
exports and declarations resolve without a sibling repository.

### 2. Pin Exact Development And Application Dependencies

Use the stable release as follows:

- `packages/skykit` development dependency:
  `"@found-in-space/touch-os": "0.3.0"`;
- `packages/hr-diagram` development dependency:
  `"@found-in-space/touch-os": "0.3.0"`;
- `apps/examples` application dependency:
  `"@found-in-space/touch-os": "0.3.0"`;
- any package-local test dependency that executes the optional integration:
  exact `0.3.0`;
- `packages/skykit` peer dependency:
  `">=0.3.0 <0.4.0"`;
- `packages/hr-diagram` optional peer dependency:
  `">=0.3.0 <0.4.0"`.

The exact development and application pins make CI reproducible. The narrow
peer range communicates the public compatibility contract without silently
claiming compatibility with untested 0.2 behavior or a future 0.4 API.

Update `package-lock.json` and make `npm run release:check-lockfile` mandatory
for the migration.

### 3. Make Local Source Linking Opt-In

The current Vite configuration automatically aliases touch-os to `../touch-os`
or `../../../touch-os` whenever that sibling checkout exists. This means normal
example builds can use 0.3 development source while Node tests and typechecking
use the installed 0.2 package.

Replace that behavior with an explicit development override:

```txt
no TOUCH_OS_LOCAL_PATH -> resolve installed @found-in-space/touch-os@0.3.0
TOUCH_OS_LOCAL_PATH set -> use the requested local source and print that mode
```

CI, release checks, and the default developer build must not set the override.
A separate opt-in compatibility job may use it when developing both repositories
together, but it does not replace installed-package verification.

## Package Boundaries

The migration must preserve these responsibilities:

### touch-os owns

- runtime lifecycle, layout, focus, scroll, and component-local interaction;
- canvas panel and embedded-surface rendering;
- Three panel placement, pointer projection, capture, and cancellation;
- normalized frame timing and panel coordination;
- app-shell output and forwarding semantics.

### `@found-in-space/skykit` owns

- adapting `SkykitThreeFrame` to the public touch-os host frame;
- plugin lifecycle and action-registry routing;
- SkyKit-specific touch roots and semantic ship/navigation commands;
- deciding how app events affect viewer and demo state.

### `@found-in-space/skykit/xr` owns

- XR session, body, controls, and ray-source lifecycle;
- blocker-first pick routing;
- borrowing versus owning XR resources supplied to plugins.

### `@found-in-space/hr-diagram` owns

- the HR texture source and touch-os adapter that presents it;
- preserving source aspect ratio and its adapter-specific frame/title behavior.

Do not copy fixed touch-os internals into SkyKit. If the published API cannot
support a required integration behavior, amend and release touch-os before
adding a private workaround here.

### Optional Dependency Boundary

The ordinary package roots must remain usable without touch-os installed:

- importing `@found-in-space/skykit` must not execute a touch-os import;
- importing `@found-in-space/hr-diagram` must not execute a touch-os import;
- importing `@found-in-space/skykit/touch-os` or
  `@found-in-space/hr-diagram/touch-os` may require the optional peer;
- type-only references must not become an accidental runtime dependency.

This matters when the HR adapter switches to the released
`createEmbeddedSurface()` factory. The current SkyKit HR plugin eagerly imports
`@found-in-space/hr-diagram/touch-os`; that import path must be reorganized so
reusing the real touch-os component does not make touch-os mandatory for every
core SkyKit consumer. Use this concrete split:

- export `createHrDiagramSurfaceSource()` from the ordinary hr-diagram entrypoint
  because it is a Three texture source and does not need touch-os;
- have core `createSkykitHrDiagramPlugin()` import that source from the ordinary
  entrypoint, not `@found-in-space/hr-diagram/touch-os`;
- remove default touch-os node construction from the core plugin and use a
  caller-supplied `touchOs.root` when that integration is requested;
- construct that root through
  `@found-in-space/hr-diagram/touch-os` in touch-os-aware examples or a thin
  `@found-in-space/skykit/touch-os` convenience;
- make `getNode()` nullable when no touch-os root was supplied, and update its
  declaration and documentation accordingly.

Packed-consumer tests must cover both cases: ordinary package roots without
touch-os installed, and the optional subpaths with exact touch-os 0.3.0
installed.

## Required SkyKit Bridge Changes

### 1. Adapt Frame Time Explicitly

Both HUD and panel frame adapters must populate the touch-os monotonic
millisecond timestamp from the SkyKit frame:

```js
timestamp: frame.elapsedSeconds * 1000
```

The conversion belongs in `createTouchOsHostFrame()` and
`createTouchOsPanelHostFrame()`, not in individual examples.

Every timestamp crossing the bridge must use that same clock domain:

- `ThreePanelHostFrame.timestamp`;
- `ThreePointerSample.timestamp`;
- queued `ThreePanelHostInputEvent.timestamp` values;
- explicit clear and cancellation timestamps.

Do not pass raw DOM `event.timeStamp` alongside SkyKit elapsed time unless it has
been deliberately translated into the SkyKit clock. The HUD bridge should stamp
DOM pointer events with the current canonical SkyKit frame time and queue those
edge events for the next `frame.events` update. It must not call
`driver.update()` once from the DOM listener and again from the frame loop.

The bridge must not separately call `runtime.tick()`. The released Three host or
driver owns ticking, and each SkyKit part update must call `driver.update()`
exactly once. If immediate input processing is ever required, use an explicitly
non-ticking input path and keep its timestamp in the same clock domain; do not
turn a DOM event into a second host frame.

Tests must prove that:

- the first update passes zero or the initial elapsed time correctly;
- uneven `deltaSeconds` values remain monotonic through `elapsedSeconds`;
- DOM event timestamps cannot jump the runtime to a different time origin;
- multiple DOM edges between frames are delivered through one driver update;
- long-press and repeat actions fire at the expected frame;
- a repeated frame timestamp does not duplicate an action.

### 2. Route Each Intent Exactly Once

The public bridge needs an explicit output-to-action policy rather than always
executing every raw `action` it sees.

Required public option on both HUD and panel plugins:

```ts
type TouchOsActionOutputMode =
  | "raw-actions"
  | "app-actions"
  | "none";

interface TouchOsPanelPluginOptions {
  actionOutputMode?: TouchOsActionOutputMode;
}
```

Required semantics:

- the default is `raw-actions`, preserving the existing bridge behavior for
  top-level controls;
- `raw-actions` dispatches top-level touch-os `action` outputs to the SkyKit
  registry and preserves start/stop phases;
- `app-actions` dispatches only a validated touch-os output whose outer type is
  `app-event`, inner event type is `app-action`, and inner `name` is a string;
  it forwards the inner payload and does not also execute forwarded raw
  component actions;
- `none` leaves all output interpretation to `onOutput` or application code;
- every output is still observable through `onOutput` exactly once;
- forwarding raw app outputs never causes implicit double execution.

Start and stop routing must derive a stable SkyKit action source identity from
the app/window/instance and action name so cancellation releases the same source
that was pressed. Invalid or unrelated app events remain observable but are not
dispatched.

The XR tablet must choose one route. Recommended behavior:

- process `app-change` once to update `panelState`;
- send `app-action` names through the SkyKit action registry once;
- let registered semantic action handlers perform “Fly to” and “Select Sun”;
- replace direct command execution in the app-event callback with the registry
  route.

Under the touch-os 0.3 default, the shell already emits one scoped `app-event`;
the existing example is not inherently double-dispatching after the dependency
upgrade. Double execution would be introduced only if direct callback execution
were retained while `app-actions` routing was added, or if forwarded raw outputs
were also interpreted in that mode.

A real-runtime integration test must click each action card and assert exactly
one registry invocation and one resulting application transition.

### 3. Cancel On Tracking And Session Loss

touch-os 0.3 cancels pointer ids omitted by a continuous source, but the SkyKit
bridge must still make its lifecycle explicit.

Required behavior:

- the XR pointer source clears its local edge/pressed state when the session or
  resolved ray disappears;
- the panel plugin exposes an explicit pointer-clear operation that uses the
  latest canonical timestamp, drains outputs, and is safe before the first
  frame or after repeated cleanup;
- XR session-end handling resets the XR source and clears the panel pointer
  immediately rather than waiting for a later frame;
- panel plugin detach clears interaction before removing scene attachment;
- cancellation outputs are drained after detach and before runtime disposal;
- a held SkyKit action source is released exactly once;
- a later session can reuse the same pointer id without inheriting hover,
  capture, or pressed state.

Tests must cover session loss between down and up, ray loss while holding a ship
control, explicit plugin detach, viewer disposal, and re-entry with the same
handed pointer.

### 4. Resolve SkyKit Callbacks Before Crossing The Host Boundary

The declarations currently promise a SkyKit frame to `parent(frame)`, while the
callback is passed into touch-os and receives a `ThreePanelHostFrame`.

Resolve all SkyKit-facing callbacks in the bridge:

```txt
SkykitThreeFrame
  -> resolve parent, anchor pose, surface metrics, root context, and SkyKit-aware pointer samples
  -> construct ThreePanelHostFrame with resolved values
  -> driver.update(hostFrame)
```

The public declarations and implementation must agree. Tests should read
`frame.xr`, `frame.roots`, and `frame.view` inside the callback so a reduced host
frame cannot pass accidentally.

The released `ThreePointerSource.sample()` receives a `ThreePanelHostFrame`, not
a `SkykitThreeFrame`. Keep raw touch-os pointer sources clearly typed that way,
and add a SkyKit-frame-aware pointer-source option or adapter for integrations
that need `frame.xr`, roots, or viewer state. The XR example must use that public
adapter and remove its mutable `getLatestPanelFrame` side channel.

Recommended minimum public shape:

```ts
interface SkykitTouchOsPointerSource {
  sample(frame: SkykitThreeFrame): readonly ThreePointerSample[];
  clear?(): void;
}

interface TouchOsPanelPluginOptions {
  pointerSources?: readonly ThreePointerSource[];
  skykitPointerSources?: readonly SkykitTouchOsPointerSource[];
}

interface TouchOsPanelPlugin {
  clearPointer(pointerId?: string): void;
}
```

The bridge may cache the SkyKit-aware samples immediately before the one driver
update and expose them to the driver through internal continuous sources. Do not
augment `ThreePanelHostFrame` with private SkyKit fields or use a global/latest
frame lookup. Clearing all pointers should invoke the SkyKit-aware sources'
`clear()` hooks, clear the driver, and drain outputs; clearing one pointer must
at least clear that driver pointer and drain outputs.

### 5. Make Detach And Dispose Match touch-os 0.3

Adopt the released reversible-detach/final-dispose semantics:

- HUD and panel plugin `attach()` may follow `detach()`;
- `detach()` stops input and removes attachment without destroying resources
  needed for reattach;
- an internally created driver is disposed exactly once during final plugin
  disposal;
- a caller-supplied driver is detached but not disposed by default;
- caller-supplied runtime or driver ownership follows explicit options;
- cancellation output is handled before an owned runtime is disposed.

Use this ownership matrix:

| Resource | Origin | Default |
| --- | --- | --- |
| runtime | created by the plugin or its `createRuntime` factory | owned |
| runtime | supplied through `runtime` | borrowed |
| driver | created by the plugin or its `createDriver` factory | owned |
| driver | supplied as an existing handle | borrowed |
| pointer source | supplied to the plugin | borrowed and clearable, never disposed implicitly |

Keep `disposeRuntime` as an explicit override and add `disposeDriver` as the
equivalent driver override. In the absence of an override, infer ownership from
the matrix above: `disposeRuntime` defaults to true only for a plugin-created
runtime, and `disposeDriver` defaults to true only for a plugin-created driver.
Do not preserve the current behavior in which a supplied runtime is disposed
unless the caller opts out. Draining outputs is required after
`clearPointer()`, `detach()`, and final driver disposal, before an owned runtime
is disposed or references are dropped.

The released `ThreePanelSession` deliberately owns final driver disposal and
flushes outputs, but it does not expose reversible `detach()`. Do not wrap each
SkyKit part in a session and then bypass its lifecycle. The existing bridge
should remain a raw-driver integration with explicit output draining unless a
separate coordinated panel-group abstraction is introduced with a matching
SkyKit lifecycle.

### 6. Do Not Treat A Cached Hit As An Arbitrary Ray Query

`blockRay(ray, context)` must evaluate the supplied ray. It must not return the
last hit sampled from a different pointer or earlier frame.

The released touch-os 0.3 API does not expose a non-dispatching arbitrary-ray
hit-test. Implement this query with a local `THREE.Raycaster` against the public
`driver.host.mesh`:

- normalize the supplied SkyKit ray direction;
- evaluate the current mesh transform on every call rather than caching a
  pointer hit;
- select the nearest mesh intersection;
- apply both the ray's own finite length and `context.maxDistance` when present;
- return the geometric intersection as blocker metadata;
- do not call `PanelInteractor.process()`, because that path dispatches input and
  mutates interaction state.

Required behavior:

- the returned distance belongs to the supplied ray;
- `maxDistance` is applied to that result;
- two different rays in one frame cannot see each other's cached hit;
- a moved panel invalidates the previous geometric result;
- ray blocking does not dispatch a touch event or mutate capture.

Keep `getHit()` as the separately named cached-current-pointer inspection API.
`blockRay()` must never read it to answer an arbitrary ray query.

### 7. Avoid Unnecessary Bridge Updates

The bridge should not allocate and forward new effective surface metrics or root
descriptors when nothing changed.

touch-os 0.3 no-op guards remain the primary protection, but SkyKit should also:

- retain resolved static metrics;
- call `runtime.setRoot()` only when the returned root identity changes;
- avoid reconstructing stable plugin configuration each frame;
- leave dynamic app state synchronization explicit;
- use the released `runtime.invalidateLayout()` and
  `runtime.invalidateRender()` methods for mutable custom services instead of
  replacing an unchanged root merely to force work.

Add a frame-loop test that holds view, root, metrics, and pose constant and
asserts no repeated touch-os layout, canvas draw, or texture upload after the
first stable frame.

### 8. Keep Shared-Pointer Coordination Scope Explicit

touch-os 0.3 ships `createPanelCoordinator()` and `createThreePanelSession()`
for multiple panels that receive samples from one source. This migration does
not create a second coordinator inside each independent SkyKit panel plugin.

For the current bridge and XR fixture, one `ThreePointerSource` instance belongs
to one panel plugin. Consumers that need multiple touch-os panels sharing one
source must coordinate them through the public touch-os session/coordinator
path rather than supplying the same source to independently updating plugins.
The broader authoritative XR interaction-router work remains in
`docs/xr-architecture.md`; it is not silently folded into this dependency
migration.

## Required XR Resource Ownership Changes

Caller-supplied shared XR resources are borrowed.

The current XR example shares one ray source among the panel, ray visual, and
picker. Removing one consumer must not dispose the source used by the others.

Apply the resource rule already documented in `docs/xr-architecture.md`:

```txt
created internally -> owner disposes it
supplied by caller  -> consumer borrows it
```

Required changes:

- ray visual and picker plugins do not dispose supplied ray sources;
- internal ray factories remain owned and disposed by their creating plugin;
- any optional ownership transfer uses a clearly named explicit option;
- dispose is idempotent;
- tests remove visual, picker, and panel independently while the remaining
  consumers continue sampling the shared ray.

## Required HR Diagram Adapter Changes

### 1. Preserve Aspect Ratio In The Draw Command

`preserveAspectRatio: true` must affect the actual surface rectangle.

For a 1024x640 source in a portrait viewport, calculate a centered contain rect
inside the padded content bounds. The resulting surface command must retain the
1.6 source aspect ratio and use the surrounding frame/background as letterbox
space.

`preserveAspectRatio: false` may stretch to the complete content bounds.

The released touch-os `createEmbeddedSurface()` already implements centered
contain geometry from the published source aspect ratio. Replace the copied
`EmbeddedHrSurfaceComponent` with a thin adapter around that public factory.
Forward the HR adapter's `componentId`, `sourceId`, title, fallback label,
`preserveAspectRatio`, non-interactive policy, desired Three texture source, and
composite mode. Do not copy its layout or rendering implementation into
hr-diagram.

Before adding that runtime import, apply the optional dependency boundary above:
ordinary hr-diagram and SkyKit root imports must not load the touch-os adapter.

### 2. Resolve The `title` Contract

Retain `title` and pass it to `createEmbeddedSurface()`. The released component
measures a title header, renders the title, and removes that height from the
available viewport before aspect fitting. The implementation, JSDoc, and
declarations must expose that behavior consistently.

### 3. Test Real Source Geometry

Add tests for:

- 1024x640 into portrait, landscape, square, wide, and tall viewports;
- padding and title height;
- aspect preservation enabled and disabled;
- unavailable-source fallback;
- composite clip propagation;
- source revision and texture replacement;
- exact command geometry, not just service attachment forwarding.

## XR Free-Roam Example Changes

The example is the primary integration fixture and should use only public
released APIs.

Required updates:

- use the installed touch-os 0.3 package by default;
- select the explicit app-action routing mode;
- replace direct app-action execution with the single SkyKit registry route;
- pass the canonical frame timestamp through the bridge;
- use the SkyKit-frame-aware pointer adapter and remove the
  `getLatestPanelFrame` mutation;
- clear the right-ray panel pointer on XR session end and tracking loss;
- preserve the HR surface aspect ratio;
- keep panel surface metrics explicit;
- configure material and texture quality through touch-os driver options,
  including persistent `textureQuality.anisotropy` when renderer capability is
  available, rather than mutating transient textures;
- retain the domain boundary: example state and astronomy actions stay in the
  example, not in touch-os or the generic bridge.

The panel should continue working in non-XR test mode with a synthetic pose, but
that mode must not be described as complete XR lifecycle coverage.

## Public API And Declaration Cleanup

Because SkyKit uses plain JavaScript with hand-written declarations, every bridge
change must update implementation, JSDoc, and `.d.ts` together.

Required cleanup:

- add the explicit action-output mode to HUD and panel options consistently;
- document `raw-actions` as its default;
- correct parent, anchor, root, metrics, and output callback frame types;
- add and type the SkyKit-frame-aware pointer adapter while leaving raw
  `ThreePointerSource` callbacks host-frame typed;
- expose the panel pointer-clear operation and its output-draining behavior;
- reflect the required touch-os 0.3 timestamp in host-frame helpers;
- add and document `disposeDriver`, and document runtime, driver, ray-source,
  and texture ownership defaults;
- narrow `blockRay` from `unknown` where the public SkyKit ray contract permits;
- keep `dispatchTouchOsActionOutputs()` focused on its documented output shape,
  or replace it with one clearly named router if app-event routing is added;
- export `createHrDiagramSurfaceSource()` from the ordinary hr-diagram
  entrypoint, remove the core SkyKit runtime import of the HR touch-os subpath,
  and make `SkykitHrDiagramPlugin.getNode()` nullable without a supplied root;
- do not expose touch-os internal component or host types through new SkyKit
  wrappers without a teaching or composition need;
- remove options that remain unimplemented rather than preserving dead public
  declarations.

Review imports as part of declaration cleanup. Runtime imports for optional
touch-os integration belong only in optional subpaths; type imports in ordinary
entrypoints must remain type-only and must not force runtime resolution.

Add declaration conformance tests that import `@found-in-space/skykit/touch-os`
and `@found-in-space/hr-diagram/touch-os` from packed workspace packages against
the installed touch-os 0.3 declarations.

## Required Test Strategy

### 1. Real touch-os Bridge Tests

Keep lightweight fakes for isolated plugin sequencing, but add integration tests
using the actual installed touch-os 0.3 runtime and Three host.

Required cases:

- tablet app button -> one app event -> one SkyKit action invocation;
- app events plus `forwardAppOutputs: true` still execute once in
  `app-actions` mode;
- app field change -> one state update;
- top-level raw action routing in `raw-actions` mode;
- no action dispatch in `none` mode;
- start/stop hold action across normal release;
- start/stop hold action across ray loss, session end, detach, and disposal;
- stable action-source identity across app-action start, cancellation, and stop;
- long-press and repeat driven by SkyKit elapsed time;
- DOM edge events and XR samples use the same SkyKit millisecond clock;
- several DOM edges between two frames cause one driver update and one runtime
  tick for the later frame;
- attach, detach, reattach, and final dispose;
- internally created runtime/driver resources are disposed once while supplied
  resources are borrowed by default;
- explicit ownership overrides dispose borrowed resources only when requested;
- explicit pointer clearing drains cancellation outputs immediately;
- static-frame no-op behavior;
- parent callback receiving the full SkyKit frame;
- a SkyKit-aware pointer callback receiving the full SkyKit frame without an
  example-owned side channel;
- two rays queried independently by `blockRay`;
- `blockRay` honors ray length and `maxDistance` without dispatching input.

Mocks must not define no-op `tick()` or lifecycle methods without asserting that
the bridge calls the correct released contract.

### 2. HR Adapter Tests

Use a real touch-os runtime or faithful component context to render commands and
assert aspect, clip, title, fallback, and revision behavior. Existing tests that
only confirm source-cell forwarding are insufficient.

Also assert that the adapter node is the public touch-os embedded-surface
component behavior, not another copied component implementation.

Core HR plugin tests must import the texture source without loading the touch-os
subpath, return `null` from `getNode()` when no root was supplied, and preserve
the existing source/demand behavior independently of touch-os.

### 3. XR Lifecycle Tests

Extend the fake-XR harness to cover:

- native session `end` and explicit exit using the same cleanup path;
- transient loss and recovery of target-ray pose;
- controller disconnect while a hold action is active;
- shared ray-source ownership across visual, picker, and panel;
- re-entry without stale edge state;
- multiple rays and blocker priority.

These tests remain deterministic and do not require a physical headset.

### 4. Browser Integration Tests

Add a focused browser smoke path for `xr-free-roam` test mode that verifies:

- the tablet opens and switches apps;
- “Fly to” and “Select Sun” execute once;
- the HR surface is letterboxed rather than stretched;
- a simulated tracking-loss hook releases active input;
- no page error occurs during app switching, surface replacement, or panel
  hide/show;
- DPR 1 and DPR 2 produce stable, legible panel output.

Use explicit readiness and diagnostic hooks rather than arbitrary sleeps.

### 5. Installed-Package And Release Tests

At least one CI job must start from a clean install with no sibling touch-os
checkout and run:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run build:examples
npm run release:check-lockfile
```

The job must print and assert the resolved touch-os version. It should fail if a
Vite alias points at local source unexpectedly.

Add packed-consumer checks that install the generated workspace tarballs into
temporary projects:

1. import the ordinary SkyKit and HR package roots without touch-os installed;
2. install exact touch-os 0.3.0 and import both optional touch-os subpaths;
3. resolve every imported touch-os entrypoint from the installed registry
   package rather than a workspace or sibling path.

## Documentation Changes

Update together with implementation:

- `packages/skykit/README.md` for bridge timing, output modes, and ownership;
- `packages/hr-diagram/README.md` for aspect and title behavior;
- `docs/xr-architecture.md` for panel cancellation and shared ray ownership;
- `docs/skykit-core-composition.md` for the touch-os action boundary;
- package documentation for the optional-import boundary and any HR source/node
  entrypoint split;
- the XR free-roam example notes for the stable dependency and test-mode limits;
- `docs/releasing.md` if stable dependency pinning or local-link policy changes
  release checks.

Documentation must use the released 0.3 imports and must not tell learners to
link a sibling touch-os checkout for normal use.

## Changesets And Release Scope

Implementation changes affect published packages and require Changesets.

Expected package scope:

- `@found-in-space/skykit`: minor change for the touch-os 0.3 peer boundary and
  public bridge semantics;
- `@found-in-space/hr-diagram`: minor change for the touch-os peer boundary,
  adapter behavior, and any entrypoint adjustment required to preserve
  optionality;
- other packages only if implementation actually changes their published API or
  behavior.

The documentation-only creation of this plan does not itself require a
Changeset. Add Changesets with the implementation, update the lockfile through
the canonical release command, and review the generated changelogs before
publishing.

## Implementation Phases

### Phase 0: Stable Dependency Adoption

- retain the recorded registry and packed-package verification above;
- remove automatic local aliasing from normal builds;
- update exact development/application pins, optional peer ranges, package-local
  test dependencies, and lockfile;
- add the installed-version and optional-root import assertions to CI.

### Phase 1: Bridge Contract

- adapt frame, pointer, DOM event, and cleanup timing to one clock;
- ensure one driver update and runtime tick per SkyKit frame;
- resolve SkyKit callbacks and pointer samples before constructing host frames;
- add explicit action-output routing with a documented default;
- align attach, detach, disposal, and ownership with touch-os 0.3;
- add real-runtime bridge tests.

### Phase 2: XR Lifecycle And Routing

- cancel and drain on ray loss, session end, detach, and disposal;
- expose immediate pointer clearing and remove the XR frame side channel;
- raycast the current public panel mesh in `blockRay`;
- fix borrowed shared-ray disposal;
- extend fake-XR lifecycle and multi-ray tests.

### Phase 3: HR Surface And Example

- split optional imports where needed so ordinary roots remain touch-os-free;
- replace the copied HR adapter component with `createEmbeddedSurface()`;
- verify aspect fitting and title behavior;
- update the XR tablet to use one action route;
- add focused HR command and browser rendering tests.

### Phase 4: Documentation And Release

- update package docs and architecture notes;
- add package Changesets;
- run the clean installed-package verification;
- build all examples and browser smoke tests;
- verify lockfile and release status;
- publish the affected SkyKit package batch only after every gate passes.

## Non-Goals

This migration should not:

- move panel, surface, layout, or pointer-capture implementation into SkyKit XR;
- add astronomy concepts to touch-os;
- retain dual execution paths for compatibility;
- use a sibling checkout as the normal package resolution strategy;
- make real headset hardware a prerequisite for deterministic CI;
- dispose caller-owned rays, runtimes, drivers, or textures implicitly;
- make touch-os a mandatory runtime dependency of ordinary SkyKit or HR package
  roots;
- introduce a second SkyKit multi-panel coordinator or complete the broader
  authoritative XR interaction-router plan;
- patch or deep-import touch-os internals when the published public mesh,
  embedded-surface, runtime, and lifecycle contracts already cover this work;
- broaden unrelated SkyKit package versions merely to force a lockstep release.

## Definition Of Done

The SkyKit migration is complete only when:

- all normal installs and builds resolve published
  `@found-in-space/touch-os@0.3.0`;
- ordinary SkyKit and HR package roots import successfully without touch-os,
  while their optional touch-os subpaths work with exact 0.3.0 installed;
- the automatic sibling alias is disabled by default;
- one tablet intent produces one application effect;
- `raw-actions` remains the documented default and `app-actions` never also
  executes forwarded raw output;
- frame, DOM event, XR sample, and cleanup timestamps share the SkyKit
  millisecond clock;
- each SkyKit frame causes one driver update and one host-owned runtime tick;
- long-press and repeat work from that SkyKit frame time;
- tracking loss, session end, detach, and disposal release held actions exactly
  once;
- parent and SkyKit-aware pointer callbacks receive the promised SkyKit frame;
- the XR example has no mutable latest-frame side channel;
- owned resources are disposed once and supplied resources are borrowed unless
  ownership is explicitly transferred;
- `blockRay` raycasts the supplied ray without dispatching panel input;
- shared caller-owned ray sources survive independent consumer disposal;
- the HR adapter delegates to the public embedded-surface component, renders its
  title, and preserves its source aspect ratio;
- real-runtime, fake-XR, browser, type, package, and lockfile tests pass;
- the package READMEs and architecture docs describe the shipped behavior;
- required Changesets are present for the publishable packages.
