# Guided journeys

One chapter controller for stellar, planetary and other viewers. The root is
plain JavaScript with TypeScript declarations and no DOM, Three.js, SkyKit or
Studio dependency. A host supplies a driver; the controller owns lifecycle and
operation outcomes. This is an unreleased development package.

```js
import { defineGuidedJourney, createGuidedJourneyController } from '@found-in-space/guided-journey';

const definition = defineGuidedJourney({
  id: 'landscapes',
  transition: { durationSecs: 4 },
  chapters: [
    { id: 'overview', title: 'Overview', scene: overviewScene },
    { id: 'detail', title: 'A closer look', scene: detailScene,
      enter(ctx) { return mountAnnotation(ctx); } },
  ],
});
const journey = createGuidedJourneyController({ definition, driver });
const operation = journey.start();
const result = await operation.finished;
// result.status: completed | cancelled | superseded | failed
```

## Shared behavior

| Command or state | Meaning in every host |
| --- | --- |
| `start(id?)`, `goTo(id, {source?, signal?})` | Return an operation immediately; `finished` resolves after navigation and arrival hooks. |
| `next()`, `previous()` | Follow chapter order from the latest request. Boundaries are completed no-ops; no wrap. |
| Explicit `goTo` of the same chapter | Prepare and enter again from the live view. |
| Unknown ID or disposed controller | Failed operation; no mutation of the current journey. |
| New request | Supersedes pending work; stale hooks cannot enter or publish arrival. |
| `cancel()` | Release navigation and chapter resources at the live pose. It does not restore a saved pose. |
| Operation `cancel()` | Cancel that pending operation. A completed operation stays completed; use controller cancellation to leave its chapter. |
| `requestedChapterId` | Most recent accepted request, including a failed or cancelled request. |
| `enteredChapterId` | Most recently entered scene; preparation alone does not change it. |
| `arrivedChapterId`, `history` | Last successful arrival and ordered successful arrivals, including revisits. |
| `dispose()` | Abort work, close scopes, unsubscribe and await registered cleanup. Safe to call again. |

Snapshots distinguish `idle`, `preparing`, `transitioning`, `active`, `cancelled`
and `failed`. IDs describe historical milestones; use status to distinguish an
active chapter from free exploration. `subscribe(listener)` reports changes and
returns an unsubscribe function. Read the initial state with `getSnapshot()`.

Preparation runs driver `prepare`, then chapter `prepare`, while the previous
scene remains available. Once prepared, the controller awaits the previous
chapter's `leave` and cleanup, runs driver `enter` and chapter `enter`, starts
the driver's transition, then awaits chapter `arrive`. A failed preparation
retains the previous chapter's resources. A failed entry/transition closes the
new scope. Edge overrides match the entered chapter and target, then fall back
to chapter and journey transition settings.

Hooks receive IDs, `source`, `signal`, `services`, `scene`, `transition`,
`isCurrent()`, `throwIfAborted()`, `reportProgress(value)` and `addCleanup(fn)`.
They may also return cleanup. Each registered cleanup runs once; all cleanup
callbacks are attempted even if one fails, and `dispose()` reports aggregated
cleanup errors. Leave is called only for an entered chapter. Asynchronous leave
finishes before the next chapter can enter, including during rapid requests.

Hooks must honor the signal and check it after asynchronous work before changing
external state. The controller cannot undo arbitrary side effects in a hook that
ignores cancellation. Cleanup returned by a stale hook runs immediately when it
eventually returns; disposal does not wait forever for uncooperative preparation.

## Drivers and units

A driver has `prepare?`, `enter?`, `transition`, `cancel` and optional `services`.
The transition returns a `JourneyOperation` from the `/operations` contract;
host-specific navigation uses `createJourneyOperation` to settle it. Finite
arrival is distinct from accepting an action or retaining a target afterwards.
Drivers capture live displayed poses, supersede queued camera writes, and settle
after the final pose is applied. They borrow hosts; disposing a controller does
not dispose its viewer.

`durationSecs` means presentation seconds. Scene data declares its own units:
SkyKit uses ICRS parsecs; Geant uses body-relative geographic degrees, physical
metres, an explicit altitude datum and a dimensionless scale denominator. World
UTC milliseconds and mission elapsed seconds are separate quantities. There is
an optional [shared sequence player](SEQUENCES.md) on `/sequence`. It owns
presentation playback and participant handover; Studio format interpretation
remains downstream.

## Presentation and conformance

`@found-in-space/guided-journey/dom` exports `mountJourneyControls({root,
definition, journey})`, used unchanged by both examples. It supplies chapter,
previous/next, free-exploration and retry buttons, pending/arrival status and
accessible current-step state. Its `destroy()` removes only its own UI. It does
not auto-start a journey or render article prose. DOM code is outside the root
import graph; URL and scroll adapters can use the same controller.

The optional `/touch-os` export supplies `createJourneyTouchControls({id,
definition, journey})` and `createSequenceTouchControls({id, player, title?,
rates?, seekStepSecs?})`. Install the optional TouchOS peer only for that subpath.
The root and sequence player remain dependency-free. Both DOM and TouchOS
presentations use the same status and playback helpers.

```js
import {createSequenceTouchControls} from '@found-in-space/guided-journey/touch-os';
const controls = createSequenceTouchControls({id: 'journey-player', player});
const panel = environment.mountPanel({id: 'journey-player',
  content: controls.render, surface: {width: 480, height: 640},
  // Supply canvas or spatial placement and inputs through the existing host.
  bind: output => { controls.handleOutput(output); },
});
const unsubscribe = player.subscribe(() => panel.setContent(controls.render()));
// Teardown: unsubscribe(); panel.dispose(); — player ownership stays with its host.
```

TouchOS owns layout, scrolling, focus and gesture cancellation. These controls
borrow the controller/player: rendering or mounting neither starts a chapter nor
joins a sequence, and removing a panel does not dispose the experience. Play and
Replay never implicitly join. Rejoin retains the existing live-entry operation;
pause retains ownership, while Explore freely releases it. A cancelled slider
gesture retains its last applied time. Capability restrictions disable seeking
and restrict rate choices. Unrestricted players default to a small rate menu;
authors may provide other finite nonzero choices without limiting the player API.
A zero-duration sequence displays time without creating an invalid slider.

The host still supplies spatial placement, input and scheduling, and must decide
its motion/comfort policy. A working panel does not establish physical-headset
acceptance or make continuous travel automatic.

`@found-in-space/guided-journey/testing` exports a Node-only
`exerciseJourneyDriver({driver, scenes: [a, b, c], advance})`. Both real host
test suites run this fixture, checking latest-wins preparation, arrival, cleanup,
order, invalid IDs, revisit and cancellation. Coordinate and rendered-pose checks
remain in each host. The testing subpath is never imported by browser entrypoints.

The stellar chapter and sequence examples also mount TouchOS canvas previews
beside their DOM controls, sharing the live controller/player. These previews do
not install an XR session or claim headset acceptance.

The paired examples are SkyKit's
[`guided-journey`](../skykit/examples/guided-journey/) and Pas de Géant's
`integration/earth-journey.html`. See the
[architecture](../../docs/chapter-and-camera-timeline-architecture.md) for the
remaining domain adapters, XR presentation and release work.
