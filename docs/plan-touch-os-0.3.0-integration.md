# Plan: Adopt `touch-os` 0.3.0 And Harden SkyKit XR Integration

## Status

Planned and blocked on the stable publication of
`@found-in-space/touch-os@0.3.0`.

Do not implement this plan against `0.3.0-dev.*`, an unpublished tarball, or an
automatic sibling-source alias and then describe the migration as complete. The
normal SkyKit install, tests, typecheck, examples, and release build must resolve
the actual registry release.

The prerequisite work is defined by the `touch-os` repository plan
`docs/plan-0.3.0-release.md`.

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

## Required SkyKit Bridge Changes

### 1. Adapt Frame Time Explicitly

Both HUD and panel frame adapters must populate the touch-os monotonic
millisecond timestamp from the SkyKit frame:

```js
timestamp: frame.elapsedSeconds * 1000
```

The conversion belongs in `createTouchOsHostFrame()` and
`createTouchOsPanelHostFrame()`, not in individual examples.

The bridge must not separately call `runtime.tick()` if the released touch-os
host owns ticking. There must be one documented clock owner and exactly one tick
per SkyKit frame.

Tests must prove that:

- the first update passes zero or the initial elapsed time correctly;
- uneven `deltaSeconds` values remain monotonic through `elapsedSeconds`;
- long-press and repeat actions fire at the expected frame;
- a repeated frame timestamp does not duplicate an action.

### 2. Route Each Intent Exactly Once

The public bridge needs an explicit output-to-action policy rather than always
executing every raw `action` it sees.

Recommended option:

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

- `raw-actions` dispatches top-level touch-os `action` outputs to the SkyKit
  registry and preserves start/stop phases;
- `app-actions` dispatches the inner `app-action` name from a touch-os
  `app-event` and does not also execute forwarded raw component actions;
- `none` leaves all output interpretation to `onOutput` or application code;
- every output is still observable through `onOutput` exactly once;
- forwarding raw app outputs never causes implicit double execution.

The exact option name may be refined during public API review, but implicit
mixed routing is not acceptable.

The XR tablet must choose one route. Recommended behavior:

- process `app-change` once to update `panelState`;
- send `app-action` names through the SkyKit action registry once;
- let registered semantic action handlers perform “Fly to” and “Select Sun”;
- remove direct execution of the same commands from the app-event callback.

A real-runtime integration test must click each action card and assert exactly
one registry invocation and one resulting application transition.

### 3. Cancel On Tracking And Session Loss

touch-os 0.3 should cancel pointer ids omitted by a continuous source, but the
SkyKit bridge must still make its lifecycle explicit.

Required behavior:

- the XR pointer source clears its local edge/pressed state when the session or
  resolved ray disappears;
- XR session-end handling clears the panel pointer immediately;
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
  -> resolve parent, anchor pose, surface metrics, and root context
  -> construct ThreePanelHostFrame with resolved values
  -> driver.update(hostFrame)
```

The public declarations and implementation must agree. Tests should read
`frame.xr`, `frame.roots`, and `frame.view` inside the callback so a reduced host
frame cannot pass accidentally.

### 5. Make Detach And Dispose Match touch-os 0.3

Adopt the released reversible-detach/final-dispose semantics:

- plugin `attach()` may follow `detach()`;
- `detach()` stops input and removes attachment without destroying resources
  needed for reattach;
- plugin `dispose()` invokes the driver's final disposal method once;
- caller-supplied runtime or driver ownership follows explicit options;
- cancellation output is handled before an owned runtime is disposed.

Existing `disposeRuntime` behavior must remain explicit and documented. If a
caller supplies a runtime or driver, the default must be borrowing rather than
surprising ownership transfer.

### 6. Do Not Treat A Cached Hit As An Arbitrary Ray Query

`blockRay(ray, context)` must evaluate the supplied ray. It must not return the
last hit sampled from a different pointer or earlier frame.

Use a public touch-os 0.3 non-dispatching panel hit-test API if one ships. If the
released host intentionally leaves this query to consumers, SkyKit may raycast
the public panel mesh locally, but must not reproduce runtime input dispatch or
depend on touch-os internals.

Required behavior:

- the returned distance belongs to the supplied ray;
- `maxDistance` is applied to that result;
- two different rays in one frame cannot see each other's cached hit;
- a moved panel invalidates the previous geometric result;
- ray blocking does not dispatch a touch event or mutate capture.

If cached-current-pointer behavior remains useful, expose it under a name that
does not accept an ignored ray argument.

### 7. Avoid Unnecessary Bridge Updates

The bridge should not allocate and forward new effective surface metrics or root
descriptors when nothing changed.

touch-os 0.3 no-op guards remain the primary protection, but SkyKit should also:

- retain resolved static metrics;
- call `runtime.setRoot()` only when root identity or an explicit root revision
  changes;
- avoid reconstructing stable plugin configuration each frame;
- leave dynamic app state synchronization explicit.

Add a frame-loop test that holds view, root, metrics, and pose constant and
asserts no repeated touch-os layout, canvas draw, or texture upload after the
first stable frame.

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

Prefer composing the released touch-os `createEmbeddedSurface()` behavior or a
public geometry helper over maintaining a second incomplete embedded-surface
implementation.

### 2. Resolve The `title` Contract

`title` must either:

- render as part of the adapter's measured and laid-out frame; or
- be removed from the public options and declarations in the 0.3 package with a
  migration note.

Keeping a copied but ignored public option is not acceptable. Rendering the title
is preferred if it improves the tablet app without duplicating app-shell chrome.

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
- remove duplicate direct action execution;
- pass the canonical frame timestamp through the bridge;
- clear the right-ray panel pointer on XR session end and tracking loss;
- preserve the HR surface aspect ratio;
- keep panel surface metrics explicit;
- verify material/texture quality through touch-os host policy rather than
  mutating transient textures;
- retain the domain boundary: example state and astronomy actions stay in the
  example, not in touch-os or the generic bridge.

The panel should continue working in non-XR test mode with a synthetic pose, but
that mode must not be described as complete XR lifecycle coverage.

## Public API And Declaration Cleanup

Because SkyKit uses plain JavaScript with hand-written declarations, every bridge
change must update implementation, JSDoc, and `.d.ts` together.

Required cleanup:

- add the explicit action-output mode to HUD and panel options consistently;
- correct parent, anchor, root, metrics, and output callback frame types;
- reflect the required touch-os 0.3 timestamp in host-frame helpers;
- document runtime, driver, ray-source, and texture ownership;
- narrow `blockRay` from `unknown` where the public SkyKit ray contract permits;
- keep `dispatchTouchOsActionOutputs()` focused on its documented output shape,
  or replace it with one clearly named router if app-event routing is added;
- do not expose touch-os internal component or host types through new SkyKit
  wrappers without a teaching or composition need;
- remove options that remain unimplemented rather than preserving dead public
  declarations.

Add declaration conformance tests that import `@found-in-space/skykit/touch-os`
and `@found-in-space/hr-diagram/touch-os` from packed workspace packages against
the installed touch-os 0.3 declarations.

## Required Test Strategy

### 1. Real touch-os Bridge Tests

Keep lightweight fakes for isolated plugin sequencing, but add integration tests
using the actual installed touch-os 0.3 runtime and Three host.

Required cases:

- tablet app button -> one app event -> one SkyKit action invocation;
- app field change -> one state update;
- top-level raw action routing in `raw-actions` mode;
- no action dispatch in `none` mode;
- start/stop hold action across normal release;
- start/stop hold action across ray loss, session end, detach, and disposal;
- long-press and repeat driven by SkyKit elapsed time;
- attach, detach, reattach, and final dispose;
- static-frame no-op behavior;
- parent callback receiving the full SkyKit frame;
- two rays queried independently by `blockRay`.

Mocks must not define no-op `tick()` or lifecycle methods without asserting that
the bridge calls the correct released contract.

### 2. HR Adapter Tests

Use a real touch-os runtime or faithful component context to render commands and
assert aspect, clip, title, fallback, and revision behavior. Existing tests that
only confirm source-cell forwarding are insufficient.

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

## Documentation Changes

Update together with implementation:

- `packages/skykit/README.md` for bridge timing, output modes, and ownership;
- `packages/hr-diagram/README.md` for aspect and title behavior;
- `docs/xr-architecture.md` for panel cancellation and shared ray ownership;
- `docs/skykit-core-composition.md` for the touch-os action boundary;
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
- `@found-in-space/hr-diagram`: minor change if the touch-os peer boundary and
  adapter public behavior move to 0.3;
- other packages only if implementation actually changes their published API or
  behavior.

The documentation-only creation of this plan does not itself require a
Changeset. Add Changesets with the implementation, update the lockfile through
the canonical release command, and review the generated changelogs before
publishing.

## Implementation Phases

### Phase 0: Stable Dependency Verification

- confirm touch-os 0.3.0 exists on the registry;
- remove automatic local aliasing from normal builds;
- update exact development/application pins, peer ranges, and lockfile;
- add the installed-version assertion to CI.

### Phase 1: Bridge Contract

- adapt frame timing;
- resolve SkyKit callbacks before constructing host frames;
- add explicit action-output routing;
- align attach, detach, disposal, and ownership with touch-os 0.3;
- add real-runtime bridge tests.

### Phase 2: XR Lifecycle And Routing

- cancel and drain on ray loss, session end, detach, and disposal;
- fix `blockRay` to evaluate its argument;
- fix borrowed shared-ray disposal;
- extend fake-XR lifecycle and multi-ray tests.

### Phase 3: HR Surface And Example

- implement aspect fitting and resolve title behavior;
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
- broaden unrelated SkyKit package versions merely to force a lockstep release.

## Definition Of Done

The SkyKit migration is complete only when:

- all normal installs and builds resolve published
  `@found-in-space/touch-os@0.3.0`;
- the automatic sibling alias is disabled by default;
- one tablet intent produces one application effect;
- long-press and repeat work from SkyKit frame time;
- tracking loss, session end, detach, and disposal release held actions exactly
  once;
- parent callbacks receive the promised SkyKit frame;
- `blockRay` evaluates the supplied ray;
- shared caller-owned ray sources survive independent consumer disposal;
- the HR texture preserves its source aspect ratio;
- real-runtime, fake-XR, browser, type, package, and lockfile tests pass;
- the package READMEs and architecture docs describe the shipped behavior;
- required Changesets are present for the publishable packages.
