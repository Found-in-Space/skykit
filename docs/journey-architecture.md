# Journey Architecture

Status: alpha implementation note.

Found in Space has two useful journey patterns in the website today:

```txt
interactive, event-driven journeys
  user or scroll position chooses scenes/chapters
  scenes have clear transitions
  examples: narrated article chapters, HR diagram scenes, cluster tours

timed, automatic journeys
  a clock chooses camera/cue state
  useful for autoplay, video recording, and deterministic exports
  examples: radio bubble video renderer and journey editor
```

These should become shared package infrastructure rather than website-only
scripts, but they should not be folded into core `@found-in-space/skykit`.

---

## 1. Package Boundary

The alpha runtime package is:

```txt
@found-in-space/journey
```

It should own plain data, normalization, state machines, and evaluators:

```txt
interactive scene graphs
timed journey schema/evaluator
cue lookup
waypoint normalization
route/path sampling
camera look interpolation
retiming helpers
plain vector/quaternion outputs
```

It should not own:

```txt
SkyKit viewer construction
star loading
Three.js rendering
DOM scroll wiring
website layouts
video capture
timeline editor UI
```

Optional packages can sit on top:

```txt
@found-in-space/journey-video
  standalone alpha editor for timed journey JSON, projection/perspective/SkyKit
  preview tiles, guide/timeline editing, retiming tools, draft storage, and
  future deterministic render/export orchestration
```

The editor is available outside the website through `@found-in-space/journey-video`.
It is an optional extra project rather than a core runtime dependency.

DOM scroll/nav wiring should stay in the website or consuming application for
now. The current reusable part is small once scene changes are triggered through
standard actions such as `skykit:journey.goToChapter`.

A future DOM support package is only worth considering if it becomes a genuine
no-code static-page helper:

```txt
author writes HTML sections + text
includes one script tag
journey navigation is created automatically
```

Until then, a `journey-dom` package would likely be too thin.

---

## 2. Interactive Lane

The interactive lane is now package-owned through `createJourney()`.

Core concepts:

```txt
scene
  named chapter/state with app-owned payload

transition
  optional app-owned payload from one scene to another

journey graph
  resolves the active scene plus transition metadata
```

The package should expose one authored interactive journey surface:

```js
const journey = createJourney({
  initial: 'sol',
  order: ['sol', 'hyades'],
  targets: {
    sun: { positionPc: { x: 0, y: 0, z: 0 } },
    hyades: { positionPc: { x: 17.574, y: 42.316, z: 13.963 } },
  },
  scenes: {
    sol: {
      view: {
        observerPc: { x: 8, y: 0, z: 0 },
        targetPc: { x: 0, y: 0, z: 0 },
      },
      camera: { type: 'orbit', center: 'sun', radiusPc: 8, angularSpeedRadPerSec: 0.26 },
    },
    hyades: {
      camera: { type: 'orbit', center: 'hyades', radiusPc: 15, angularSpeedRadPerSec: 0.2 },
    },
  },
  travel: { type: 'orbit-transfer', durationSecs: 5 },
});

const scene = journey.resolveSceneSpec('hyades', { fromSceneId: 'sol' });
```

For orbit cameras, `normal` is optional. If omitted, SkyKit asks spatial to
derive the insertion plane from the approach vector. If supplied, spatial plans
a smooth insertion into that requested plane.

Scene `view` is the authored boundary for viewer state such as
observer/target/orientation. Put the starting boundary on the initial scene
instead of scattering that state through application mount code.

The interactive runtime should be event-driven:

```txt
goTo(sceneId, { source })
next()
previous()
getSnapshot()
subscribe(listener)
```

Scene payloads stay app-owned. A star lesson might store camera targets and
volume preload hints; a game might store spawn rules or UI state. The journey
package should not try to understand those fields.

Journeys do not own star IDs. If a scene payload points at a streamed star, it
should carry the star cell's `StarObjectRef` and resolve that reference
to coordinates in the application/SkyKit layer before the journey runtime sees
it. Do not store octree storage identifiers such as `nodeKey`, `shardOffset`,
`nodeIndex`, `payloadOffset`, or `payloadLength` in journey schema.

---

## 3. Timed Lane

The website's current `fis-journey-v1` evaluator is the seed for the timed lane.

Core concepts:

```txt
durationSecs
locationWaypoints
cameraLookWaypoints
cues
guides
```

Location evaluation should preserve the existing useful behavior:

```txt
timestamped waypoints
centripetal Catmull-Rom path interpolation
arc-length sampling so segment speed is stable between timestamps
speed / velocity metadata for streaming lookahead
```

Camera evaluation should preserve:

```txt
direction look keys
target look keys
up vectors
quaternion/slerp interpolation
plain output quaternion + forward/up vectors
```

The runtime surface should remain plain:

```js
const evaluator = createTimedJourneyEvaluator(journey);

const frame = evaluator.evaluate(12.5);

// frame:
// observerPc
// targetPc
// cameraQuaternion
// cameraForwardPc
// cameraUpPc
// velocityUnitVectorPc
// speedPcPerSec
```

Timed journeys should also expose cue helpers:

```txt
getCueAt(timeSecs)
getCueOpacity(timeSecs, fadeSecs)
sample({ stepSecs })
```

Video capture and render settling are not part of `@found-in-space/journey`.
Those belong to a renderer/export adapter.

---

## 4. Relationship To SkyKit Actions

Core SkyKit now has a namespaced action registry. Journey runtimes should use
that instead of faking keypresses or calling private viewer methods.

Reserved action IDs:

```txt
skykit:journey.goToChapter
skykit:journey.next
skykit:journey.previous
skykit:journey.seek
skykit:journey.play
skykit:journey.pause
```

A SkyKit journey plugin can register these actions:

```js
ctx.actions.registerContext('skykit:journey', {
  goToChapter({ payload }) {
    controller.goTo(payload.chapterId, { source: payload.source ?? 'action' });
  },
  seek({ payload }) {
    timedRuntime.seek(payload.timeSecs);
  },
});
```

The journey package itself should not depend on SkyKit. SkyKit adapters translate
journey state into:

```txt
viewer.requestViewState(...)
navigation automation
layer visibility
preload requests
status/debug output
```

---

## 5. What The Website Already Proves

Useful website references:

```txt
src/scripts/narrated-tour.js
  DOM scroll/nav adapter for chapter activation

src/scripts/journey-evaluator.js
  timed journey normalization and camera/path evaluation

src/scripts/journey-retiming.js
  authoring helpers for speed/ease cleanup

src/pages/video/journey-editor.astro
  standalone editor direction

src/pages/video/radio-bubble-full.astro
  deterministic video/export use case
```

These are reference implementations. New alpha packages should rewrite the
useful behavior into package-shaped APIs rather than importing website scripts.

---

## 6. Current Alpha Status

Implemented first slice:

```txt
@found-in-space/spatial
  smooth paths, timed position/orientation tracks, pose transitions, and
  provider-neutral preload hint materialization

@found-in-space/journey
  createJourney()
  createJourneyController()
  normalizeTimedJourney()
  createTimedJourneyEvaluator()
  evaluateTimedJourneyAtTime()
  cue helpers
  speed/ease retiming helpers

@found-in-space/skykit
  createSkykitJourneyPlugin()
  skykit:journey.* action registration
  semantic orbit-transfer execution for authored scenes
  spatial preload hint to star-octree preload request mapping

@found-in-space/journey-video
  JOURNEY_VIDEO_PACKAGE_STATUS = 'alpha-editor'
  createJourneyVideoEditor()
  editor document/state import/export helpers
  projection, perspective, and SkyKit streamed-stars preview tiles
  guide/timeline editing and retiming/ease tools
  deterministic browser render page
  JavaScript sky-frame capture
  cached transparent overlay block rendering
  ffmpeg compositing helpers and journey-video-render CLI
```

Still deferred:

```txt
rich video export UI
alternate codecs/containers
editor-side overlay block authoring beyond cue text
legacy website export route removal
no-code static-page journey helper
```

This keeps the package useful immediately while richer editorial tooling remains
a later slice. Blender interchange and earlier benchmark/capture experiments are
not live alpha paths.
