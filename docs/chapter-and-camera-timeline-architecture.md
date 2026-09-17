# Guided Journey And Camera Sequence Architecture

Status: `0.2.0` baseline and `0.3.0` target plan.

The stable public website currently keeps chapter behavior in its viewer scripts,
while SkyKit Studio owns deterministic camera timeline authoring and export. For
`0.3.0`, add a reusable, user-paced guided-journey runtime without collapsing
website presentation, spatial navigation, or Studio timelines into SkyKit core.

The public website remains pinned to stable `0.2.0` until the coordinated
`0.3.0` package batch has been published. Repository examples and tests validate
the in-development API. See
[`releasing.md`](./releasing.md#public-website-version-policy).

## 1. Vocabulary

Use these terms consistently:

- **learning path**: an editorial sequence across topics, lessons, or activities;
- **guided journey** or **tour**: a user-paced interactive experience;
- **chapter**: a stable authored stop in a guided journey;
- **scene**: the desired view, product, layer, selection, and app-owned state for
  a chapter;
- **transition**: the edge from one chapter to another, including movement and
  preparation;
- **camera sequence**: a deterministic, time-indexed Studio artifact.

This distinction matters. A learner can pause, skip, reverse, or interrupt a
guided journey. A Studio camera sequence must evaluate to the same frame at the
same time during scrubbing and export.

## 2. Current `0.2.0` Baseline

Website topic viewers define ordinary chapter objects and app-owned dispatch:

```js
const chapters = {
  pleiades: {
    label: 'Pleiades',
    async activate({ viewer }) {
      await viewer.actions.invoke('skykit:navigation.cancel');
      await viewer.actions.invoke('skykit:navigation.transitionTo', {
        view: { lookAt: { targetPc: { x: -3, y: 4, z: 130 } } },
        movement: { durationSecs: 4 },
      });
    },
  },
};
```

`setupNarratedTour()` is DOM/article wiring. It calls a viewer result's
`goTo(id)`, and app code dispatches to `chapters[id].activate(ctx)`. More complex
topics also coordinate annotation visibility, model animation, data demand, and
arrival state.

This convention preserves app ownership, but it does not provide:

- an awaitable navigation arrival result;
- latest-wins cancellation or an explicit queue policy;
- standard prepare, enter, arrive, and leave phases;
- active/pending state, history, subscriptions, or errors;
- edge-specific `from -> to` transition overrides;
- a reusable readiness/preload seam;
- URL, scroll, button, Touch OS, or XR presentation adapters.

The `0.3.0` work should extract these repeated runtime semantics while keeping
lesson-specific content and effects in the application.

## Mandatory continuity contract (all versions)

This is required behavior for the current website baseline and all future
navigation/journey adapters. It is not deferred to the `0.3.0` plan.

- Every interactive transition MUST start from the currently displayed live
  position and orientation, including manual looking and unfinished movement.
  Never use the previous chapter's authored pose as the source. Reverse, skip,
  repeat, initial-chapter revisit, and rapid activation have the same contract.
- At zero elapsed transition time the displayed pose MUST be unchanged; as
  elapsed time approaches zero, displacement and angular change MUST approach
  zero. One-frame flashes and teleports to path starts violate the contract even
  if later frames interpolate smoothly.
- Destination camera intent MUST pass through navigation. Applying destination
  `lookAt`, `targetPc`, or pose values through `requestViewState` before animating
  is forbidden: these are immediate camera writes. Initial placement is allowed
  during viewer creation and must not be repeated during chapter activation.
- Explicit routes MUST connect from the live source pose. Generated orbit
  transfers must consume live motion/phase where available. An authored route
  anchor or previous chapter ID is never proof of the current camera state.
- A handover MUST supersede the old operation's queued camera samples as well
  as its automation. A newer activation must prevent older asynchronous
  preparation, camera commands, and arrival callbacks from regaining control.
- Exactly one component owns each camera lane at a time. App-owned model and
  annotation effects must not secretly write camera poses during navigation.
  Deterministic sequence playback has its own explicit ownership handover.
- Changes to view-state meaning, navigation semantics, or dependency versions
  MUST audit downstream callers, not just preserve their method signatures.
  The website regression caused by treating orientation-resolving `targetPc`
  input as passive metadata is a concrete example of this failure mode.

Verification MUST exercise actual viewer updates with the installed runtime:
zero/tiny-time starts, arbitrary live poses and orbit phases, manual looking,
interruption/reversal, rapid activation, delayed preparation, and final arrival.
Check rendered frames after queued view patches flush. Test camera ownership
separately from scene data/model effects. Offline Studio/video continuity tests
do not substitute for these interactive tests.

The website's public repository records the regression history, implementation
rules, and reproduction coverage in `docs/camera-transitions.md`; its
`npm test` suite runs before Pages deployment. Keep the contract valid when
migrating the website from its released baseline to the future controller.

## 3. Target Package Boundaries

```txt
@found-in-space/spatial
  coordinates, targets, aims, poses, routes, transitions, timing, preload hints

SkyKit navigation controller
  typed viewer navigation operations and semantic action adapters

headless guided-journey controller
  chapter lifecycle, cancellation, state, history, and transition selection

@found-in-space/skykit/journey
  SkyKit navigation, action, product, and readiness adapter

website / Touch OS / XR / app UI
  presentation and user input adapters

@found-in-space/skykit-studio
  deterministic camera sequences, editor state, retiming, and export
```

The dependency direction runs from Studio toward the reusable runtime packages:
`skykit-studio` may depend on public SkyKit, guided-journey, spatial, renderer,
and product packages, but none of those packages may depend on Studio. A host
application may compose both. That composition does not make Studio a SkyKit
dependency.

The guided controller contract must be renderer-neutral. The preferred durable
boundary is a focused `@found-in-space/guided-journey` package with a thin
`@found-in-space/skykit/journey` adapter. If `0.3.0` has only one SkyKit
consumer, the same protocol may incubate in the SkyKit subpath and move to a
focused package when a second host such as Star Pilot adopts it. Do not create a
generic content-management package around it.

## 4. Navigation Operations Come First

The action registry is appropriate for semantic commands, held controls, and
multiple listeners. It is not the primary orchestration API for a guided
journey: `actions.invoke()` completes after handlers have accepted a command,
not after the viewer has arrived.

`createSkykitNavigationPlugin()` should expose a typed controller in addition to
registering semantic actions:

```js
const navigation = createSkykitNavigationPlugin();
const operation = navigation.transitionTo(spec, { signal });
const result = await operation.finished;
```

A navigation operation should expose:

- a stable operation ID;
- affected movement/orientation lanes;
- `finished`, resolving to `completed`, `cancelled`, `superseded`, or `failed`;
- `cancel()` and an `AbortSignal` path;
- an inspectable snapshot and lifecycle subscription;
- typed navigation payloads and outcomes;
- final target, aim, lock, orbit, and arrival semantics.

Finite operations settle after their movement/orientation arrival work. A
persistent orbit or target lock may remain active after arrival without keeping
the operation pending forever.

The existing `skykit:navigation.*` actions should delegate to the same
controller. Keyboard, Touch OS, XR, debug tools, and app-owned controls therefore
keep one semantic command surface, while journey orchestration gets reliable
completion and cancellation.

The beginner browser should expose the same controller through a small
`browser.navigation` facade. This removes the need for first lessons to install
a plugin and unpack `PromiseSettledResult[]`, without hiding the underlying
viewer or action registry.

## 5. Guided Journey Model

The authored shape should remain ordinary data with function escape hatches:

```js
const journey = defineGuidedJourney({
  id: 'clusters',
  chapters: [
    {
      id: 'pleiades',
      title: 'Pleiades',
      scene: {
        view: { limitingMagnitude: 7.5 },
        camera: {
          kind: 'orbit',
          target: pleiades,
          radiusPc: 25,
        },
      },
      prepare(ctx) {},
      enter(ctx) {},
      arrive(ctx) {},
      leave(ctx) {},
    },
  ],
  transitions: [
    {
      from: 'omega-cen',
      to: 'home',
      route: omegaReturnRoute,
    },
  ],
});
```

Chapter IDs are stable application identity. A chapter may contain copy and
presentation metadata, but the runtime does not render prose or own article
markup. Scene data is generic to the headless controller and interpreted by a
driver. The SkyKit driver understands viewer state, spatial camera intent,
semantic actions, and registered readiness/preload adapters.

Hooks receive a context containing at least:

- the journey and chapter IDs;
- previous and requested chapter IDs;
- the activation source;
- an `AbortSignal`;
- driver-owned services;
- a scoped cleanup registration path.

Custom hooks remain ordinary functions and may return scoped cleanup work.
Cleanup runs exactly once on leave, cancellation, supersession, failure, or
disposal. Declarative shortcuts may compile into public spatial objects or
semantic action descriptors; they must not introduce a string-based factory
registry.

## 6. Controller Lifecycle

The headless controller should expose:

```txt
start(id?)
goTo(id, options?)
next()
previous()
cancel()
getSnapshot()
subscribe(listener)
dispose()
```

`goTo()` returns a journey operation immediately. Callers may ignore it for a
button click or await `operation.finished` when sequencing work.

Default activation is latest-wins:

```txt
request chapter
  -> supersede and abort pending activation
  -> prepare target and transition while the current chapter remains usable
  -> leave previous active chapter and run its cleanup
  -> enter target scene
  -> run/await transition
  -> run arrival work
  -> publish active target
```

The snapshot should distinguish at least `idle`, `preparing`, `transitioning`,
`active`, `cancelled`, and `failed`, and include active/pending IDs, history, the
current operation, source metadata, and the latest error.

It should distinguish the latest requested chapter, the entered chapter, and the
last successfully arrived chapter. A stale operation must never run `arrive` or
publish settled state after a newer request wins.

An explicit queue policy may be added for authored autoplay, but overlapping
async activations must never occur accidentally.

## 7. Preload And Readiness

Preparation is an orchestration concern; data transport remains package-owned.
The generic controller awaits ordinary preparation tasks. The SkyKit adapter may
provide focused helpers that:

- materialize spatial preload hints;
- warm star-provider cells through the provider's public warm lane;
- await `stars/current` or another plugin-owned readiness handle;
- prepare images, sidecars, volumes, or app-owned resources;
- report progress and respect the operation's `AbortSignal`.

Do not send per-star data through the action or journey event bus. A journey
coordinates product readiness; providers and renderers retain their existing
high-throughput streams.

## 8. Presentation Adapters

Presentation is replaceable and stays outside the headless controller:

- website scroll position and chapter pills;
- ordinary DOM buttons;
- URL/hash deep links and history;
- autoplay or presenter controls;
- Touch OS panels;
- XR controller, gaze, voice, or in-world controls.

Adapters call `goTo()`, `next()`, or `previous()` and subscribe to controller
state. They do not duplicate chapter lifecycle or navigation choreography.

The same journey must be usable on desktop and in XR. The XR navigation driver
moves the navigation rig and applies comfort policy; it never mutates headset
orientation or creates a second journey model.

## 9. Studio Camera Sequences

SkyKit Studio is a downstream authoring application. It depends on public SkyKit
and spatial contracts; SkyKit and the headless guided-journey controller never
depend on `@found-in-space/skykit-studio`.

Studio remains the owner of deterministic time-based authoring and export. Its
current `fis-journey-v1` implementation contains observer waypoints, camera
aim/orientation waypoints, cues, guides, tracks, evaluation, preload hints, and
retiming helpers.

The guided-journey or SkyKit side should define only a small, format-neutral
camera-sequence player protocol. Studio should publish a browser-safe evaluator
and a Studio-side adapter that implements that protocol. An application that
wants both features imports the adapter from Studio and passes it to the journey
controller. SkyKit does not import Studio, probe for it, or interpret
`fis-journey-v1` data.

If both runtimes need the same camera pose or evaluated-frame value objects,
those neutral contracts belong in `@found-in-space/spatial`. Timeline keyframes,
editor state, render profiles, Playwright, and ffmpeg remain Studio-owned. The
browser-safe evaluator is not currently present in Studio's public export map,
so the Studio-side adapter follows that export rather than creating a deep
import from either repository.

## 10. `0.3.0` Delivery Plan

### Phase 1: typed navigation controller

- Add typed payload and operation contracts.
- Make arrival, cancellation, supersession, and failure observable.
- Preserve final aim/lock/orbit semantics.
- Delegate existing navigation actions to the controller.
- Add the beginner `browser.navigation` facade.

### Phase 2: headless journey controller

- Implement normalization, ordered chapters, edge transitions, lifecycle, state,
  history, subscriptions, cancellation, and disposal.
- Test rapid activation, failed preparation, cleanup, next/previous, and custom
  hooks without DOM, Three.js, or SkyKit.

### Phase 3: SkyKit adapter

- Apply viewer scene state and drive typed navigation operations.
- Add semantic action and focused preload/readiness adapters.
- Expose a plugin/controller handle without hiding the underlying journey.
- Add button, scroll, and URL examples inside this repository.

### Phase 4: XR and downstream Studio adapters

- Drive the same journey controller through XR/Touch OS inputs.
- Apply XR comfort policy in the navigation adapter.
- Define the optional, format-neutral camera-sequence player protocol on the
  guided-journey/SkyKit side.
- After Studio exports its browser-safe evaluator, implement the protocol in a
  Studio-owned adapter and test composition in Studio or a host application.

### Phase 5: stable website migration

- Publish the coordinated stable `0.3.0` package batch.
- Update the website's exact dependency and CDN pins in a separate change.
- Port website chapter tables onto the released controller incrementally.
- Build and smoke-test all live examples before deployment.

## 11. Acceptance Criteria

The `0.3.0` guided-journey slice is ready when:

- the mandatory live-state continuity contract above passes actual-runtime
  tests, including interrupted and out-of-order activation;
- awaiting navigation means awaiting actual arrival;
- every navigation and journey operation settles exactly once with a terminal
  outcome;
- rapid scroll/button activation deterministically supersedes older work;
- prepare, enter, arrive, and leave work is abortable and cleaned up;
- an edge-specific route can depend on both previous and target chapters;
- camera, product, layer, and app-owned state can be coordinated without a
  central registry of domain types;
- the same journey controller works with buttons, scroll, URL, and XR adapters;
- low-level actions, spatial routes, providers, renderers, and app plugins remain
  directly usable;
- Studio timelines remain deterministic and independently evaluable;
- no SkyKit or guided-journey package imports SkyKit Studio or declares it as a
  dependency;
- no public website dependency moves off `0.2.0` before stable `0.3.0` is
  published.
