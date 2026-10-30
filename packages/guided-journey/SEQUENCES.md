# Shared sequence player

`@found-in-space/guided-journey/sequence` supplies presentation-time playback for
ordinary pure evaluators. It imports neither Studio nor a renderer. The existing
host frame loop calls `update(deltaSecs)` once; the player installs no timer,
animation frame, wall clock, media transport or domain registry.

```js
const player = createJourneySequencePlayer({
  sequence: {
    durationSecs: 20,
    evaluate(timeSecs) { return evaluateAuthoredShot(timeSecs); },
  },
  participant, // omit for a clock/evaluation-only consumer
});
const arrival = player.join(); // live navigation into the current sample
await arrival.finished;
const playback = player.play();
// host frame: player.update(frame.deltaSeconds)
await playback.finished; // sequence end, separately from navigation arrival
```

## Clock and operation semantics

| API | Contract |
| --- | --- |
| `play()` | Return the playback-end operation. Resume the same pending operation after pause. Never join or rewind implicitly. |
| `pause()` | Hold presentation time and scene ownership. Keep the playback operation pending. |
| `seek(timeSecs)` | Evaluate a finite time clamped to `[0, durationSecs]`. While attached, scrub exactly. While detached, update the sample without taking the camera. |
| `setRate(rate)` | Accept a supported nonzero finite rate. Negative rates run towards zero. Use `pause()` rather than a zero rate. |
| `join({signal?})` | Return a separate arrival operation. Supersede a previous join and blend from the live host scene to the current evaluated sample. Hold presentation time throughout the join. |
| `cancel()` | Cancel pending playback/join, release the participant once and retain time and live pose. |
| `update(deltaSecs)` | Advance by nonnegative host seconds times rate, evaluate once, and deliver the same sample to the participant and subscribers. While paused, reapply the cached sample without reevaluating. |
| `getSnapshot()` | Inspect frame, `paused/playing/ended/failed`, `detached/joining/attached`, rate, capabilities, operations, error and disposed state. |
| `subscribe(fn)` | Observe state/sample changes; return an unsubscribe function. Read initial state separately. |
| `dispose()` | Cancel and release, remove subscribers, invalidate late acknowledgements. Idempotent. The host owns removal of its frame callback. |

Playback can advance while detached for preview or captions. It never acquires
scene ownership by itself. A seek during joining supersedes that transfer and
leaves playback paused/detached; explicitly rejoin the new time. Seeking away from
an ended sequence leaves it paused. Replaying is explicit: seek to zero (or the
duration for reverse playback), then play. Calling play at its directional
endpoint completes without rewinding.

`ended` means the clock reached its directional endpoint. The playback operation
finishes only when the participant acknowledges the final applied sample. A seek,
rate change or ownership handover invalidates old acknowledgements. Outcomes use
the same `completed`, `cancelled`, `superseded` and `failed` operation contract as
chapters and navigation. Evaluation/application failures during playback fail the
operation and release scene ownership. Invalid commands fail before changing the
clock; a seek whose evaluation throws also leaves the old state intact.

## Evaluators, participants and cues

An evaluator declares `durationSecs` and `evaluate(timeSecs)`. It must return the
same value for the same time, regardless of seek history. Its value carries
domain-owned quantities and frame labels. The player wraps that value once in
`{timeSecs, durationSecs, value}`; camera, world/model, captions and overlays can
consume that same envelope. The player does not convert presentation seconds to
UTC milliseconds, Apollo GET or Studio `sceneTimeSecs`.

A participant supplies:

- `join(frame, context)` when it needs live navigation. It returns an ordinary
  navigation operation. Omit it for a participant with no navigation.
- `apply(frame, context)` to apply the evaluated state. It can return a promise
  that resolves once a queued host write has been applied. That acknowledgement
  is required to establish rendered completion when the host queues camera work.
- `release()` to remove owned effects/listeners and supersede queued writes while
  retaining the live scene. It does not restore an authored start pose.
- Optional `capabilities: {seek, rates}`. Rates are `'any'` or an explicit list of
  supported nonzero rates; unsupported commands throw rather than being ignored.

Context has `signal`, `isCurrent()` and `cancel()`. Check currentness after
asynchronous work before writing to the host. Manual input or another camera
owner can call `cancel()` through the participant. Late callbacks cannot reclaim
ownership. A participant must release its own navigation, not cancel a newer
owner's operation. The host composes multiple scene consumers in one participant;
there must still be one writer per camera lane.

Cues are evaluated state, not historical events to replay. The evaluator owns
boundary conventions. A future Studio v1 adapter must retain its existing
first-matching inclusive boundary rule. Apollo maps its own event IDs and GET
intervals. The player performs no sorting, cue reinterpretation or recursive
chapter activation. A new evaluator should document its interval endpoints.

## Chapter and renderer composition

A chapter driver may return `player.join({signal: ctx.signal})` from `transition`.
Its arrival hook can start playback; its cleanup/cancel path releases playback.
The chapter then completes arrival independently of the sequence's later end.
This composition is covered by the headless tests. A chapter cue/highlight
subscription must not feed back into another `goTo()` request.

SkyKit exports `createSkykitSequenceParticipant({viewer, navigation, durationSecs})`
from `/journey`. It consumes `{pose: SpatialPose}`, validates `SKYKIT_ICRS_SPACE`
(catalog ICRS/parsecs), blends through the typed navigation controller, and
acknowledges exact samples after SkyKit flushes its queued view patch. Manual
actions, direct camera edits and newer navigation release the sequence without
discarding the new command. Both ordinary disposal and host disposal clean up.

The [sequence example](../skykit/examples/sequence-player/) uses spatial orbit
evaluation for an illustrative camera path, with the shared `/dom`
`mountSequenceControls({root, player})`. It pauses when the page is hidden;
resuming is explicit. Its captions use half-open intervals except for the final
endpoint. This example does not interpret a Studio file or simulate star motion.

Actual viewer tests cover live entry, queued final-frame acknowledgement,
deterministic scrubbing, manual re-entry, cancellation and external camera
handover. The protocol is ready for domain adapters; Apollo/Geant target following
and the optional Studio evaluator export remain separate implementation work.
