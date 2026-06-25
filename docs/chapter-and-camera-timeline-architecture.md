# Chapter And Camera Timeline Architecture

This document describes the shared language between Published Website Content
interactive journeys and SkyKit Studio deterministic camera timelines.

SkyKit core does not own a guided-tour runtime. Published Website Content topic
viewers keep chapter behavior in their viewer scripts, and Studio owns
deterministic camera timeline authoring/export. The shared layer is semantic:
the same authoring words should mean the same thing in both places, while each
application compiles or executes them differently.

## Boundary Summary

- `@found-in-space/spatial` owns dependency-free path, orbit, route, pose,
  target, and navigation math.
- `@found-in-space/skykit` owns viewer composition, action registration, plugin
  lifecycle, and runtime execution of semantic navigation actions.
- Published Website Content owns article layout, scroll/nav triggers, chapter
  activation functions, page-specific scene state, and learner-facing copy.
- `@found-in-space/skykit-studio` owns deterministic journey documents,
  timeline editing, shot ranges, cue/title tracks, guide and object authoring,
  retiming helpers, render preflight, and frame-indexed export.

Do not move website chapter orchestration into SkyKit core. Do not move Studio
timeline authoring into SkyKit core. Reusable route math that both need should
live in `@found-in-space/spatial`.

## Shared Vocabulary

Use these terms consistently even when a product surface chooses friendlier UI
labels.

### Journey

A journey is the editorial container for a guided experience.

In Published Website Content, a journey is usually a topic page or narrated
tour such as the cluster tour, radio bubble tour, HR diagram tour, or
Astrophage route. It is interactive: the visitor can scroll, click, drag the
view, or trigger chapters in an order the author cannot fully predict.

In Studio, a journey is a deterministic video sequence. It has fixed duration,
frame rate, camera and scene tracks, cues, render profiles, and export
metadata. Studio UI can call this a sequence because that is familiar to video
and DCC users, but the persisted document still represents an authored journey.

### Chapter

A chapter is an editorial beat that names an intended view, camera behavior,
and scene state.

Website chapters are activation targets. A chapter starts from the live viewer
state at the moment the visitor triggers it, so the exact start position is not
known in advance. A chapter should therefore describe intent, not a baked path.

Studio chapters can appear as story markers or shot ranges. Studio can compile
the same intent into exact observer keys, camera keys, title clips, object
tracks, and preload hints because the timeline start time is known.

### Shot

A shot is a continuous deterministic section of a Studio journey. It is the
video-production equivalent of a website chapter, but it has exact in/out
times. Studio can expose shot tools without requiring website code to adopt a
shot runtime.

### View

A view is desired viewer state: observer position, look target or orientation,
field of view, limiting magnitude, scale settings, and similar frame state.

Use `view` for a patch that can be requested directly from a viewer. Use
`camera` for higher-level camera rig intent such as orbit or orbital insert.

### Destination

A destination is a reusable point of interest for camera motion:

```js
{
  id: 'pleiades',
  label: 'Pleiades',
  centerPc: { x: 67.379, y: 103.162, z: 55.161 },
  radiusPc: 25,
  orbitNormal: { x: 0, y: 0, z: 1 },
  angularSpeedRadPerSec: 0.18,
  lookAtPc: { x: 67.379, y: 103.162, z: 55.161 },
  dwellSecs: 5
}
```

Website chapters can activate destinations from any current viewer pose.
Studio can turn the same destination into an authored orbit shot, fly-to shot,
or orbit-transfer shot.

### Motion Intent

Motion intent names how the observer/camera should move. It is not necessarily
the final sampled path.

The shared runtime action vocabulary is:

- `skykit:navigation.transitionTo`: move and/or orient toward a target view.
- `skykit:navigation.flyPolyline`: follow explicit route points.
- `skykit:navigation.orbit`: enter or continue a parametric orbit.
- `skykit:navigation.orbitalInsert`: naturally approach and hand off into an
  orbit around a target.
- `skykit:navigation.lookAt`: rotate once toward a target.
- `skykit:navigation.lockAt`: keep the camera aimed at a target while movement
  continues or the user pauses.

Studio should use the same names when describing camera rig operations, even if
the editor labels them "Fly To", "Orbit", "Orbit Insert", or "Lock Aim".

### Travel

Travel describes how a chapter or shot reaches its destination:

```js
{
  durationSecs: 5,
  sampleStepSecs: 1 / 24,
  pointsPc: explicitRoutePoints,
  arrivalThreshold: 0.05,
  arrivalAction: {
    type: 'orbit',
    center: destination.centerPc,
    radius: destination.radiusPc,
    angularSpeedRadPerSec: destination.angularSpeedRadPerSec,
    normal: destination.orbitNormal
  }
}
```

Website travel is resolved at activation time from the current viewer state.
Studio travel is resolved at authoring or evaluation time into deterministic
tracks.

### Scene State

Scene state is everything other than camera pose that changes with the journey:
object visibility, annotation visibility, line reveal progress, shader
settings, demand/preload strategy, HR diagram mode, radio bubble radius, cue
text, label state, and similar data-layer or overlay state.

Keep scene state application-owned unless a reusable package boundary becomes
obvious. For example, HR diagram mode belongs with the HR diagram layer and
topic viewer; Studio may store an object-parameter track that drives the same
kind of state during export.

## Semantic Shape

A useful common chapter or shot descriptor has this conceptual shape:

```js
{
  id: 'omega-cen',
  label: 'Omega Centauri',
  view: {
    // Immediate viewer state hints or initial pose.
  },
  navigation: {
    transitionTo: {
      observerPc: { x: 8, y: 0, z: 0 },
      lookAt: { targetPc: { x: 0, y: 0, z: 0 } },
      movement: { durationSecs: 4 },
      orientation: { durationSecs: 2 }
    }
  },
  camera: {
    type: 'orbit',
    center: { x: -3290.566, y: -1309.263, z: -3862.073 },
    radiusPc: 200,
    angularSpeedRadPerSec: 0.08,
    lookAt: { x: -3290.566, y: -1309.263, z: -3862.073 },
    normal: { x: 0, y: 0, z: 1 },
    dwellSecs: 5
  },
  travel: {
    type: 'orbit-transfer',
    durationSecs: 9,
    sampleStepSecs: 1 / 24,
    arrivalThreshold: 0.05
  },
  sceneState: {
    // App-owned layer, annotation, preload, or data-state intent.
  }
}
```

This is not a required published schema yet. It is a naming guide. Website
pages can keep hand-authored objects, and Studio can keep `fis-journey-v1`
documents, but new code should avoid inventing competing words for the same
intent.

## Published Website Content Chapters

A topic viewer should define a `chapters` object keyed by chapter ID. Each
chapter exposes a label and an `activate(ctx)` function:

```js
const chapters = {
  pleiades: {
    label: 'Pleiades',
    camera: {
      type: 'orbit',
      center: PLEIADES_CENTER_PC,
      radiusPc: 25,
      angularSpeedRadPerSec: 0.18,
      lookAt: PLEIADES_CENTER_PC,
      normal: ICRS_NORTH,
      dwellSecs: 5
    },
    travel: { durationSecs: 5 },
    async activate(ctx) {
      await activateChapterCamera(ctx, chapters.pleiades, {
        source: 'website.clusterTour'
      });
    }
  }
};
```

`setupNarratedTour()` is only DOM/article wiring. It should call the viewer
result's `goTo(id)`, and `goTo(id)` should dispatch to
`chapters[id].activate({ viewer, provider, renderer })`. Any preload behavior is
an optional app-owned `chapter.preload?.(ctx)` function.

Chapter activation should generally follow this order:

1. Apply or schedule page-specific scene state.
2. Cancel incompatible movement/orientation automation when needed.
3. Request immediate view hints such as `targetPc` or limiting magnitude.
4. Apply look intent, usually `lockAt` for orbit chapters.
5. Apply movement intent, such as `transitionTo`, `flyPolyline`, or
   `orbitalInsert`.
6. Run arrival behavior, such as switching demand strategy or starting a stable
   orbit.

### Website Use Cases

Cluster tour:

- Each cluster chapter is a destination orbit.
- The exact start point is unknown because the visitor may have dragged the
  view or jumped between chapters.
- `activateChapterCamera()` derives an orbit-transfer route from
  `viewer.getViewState().observerPc` to the destination orbit, then hands off
  to an orbit arrival action.
- Long-distance destinations such as Omega Centauri use longer travel
  durations, but the chapter still names the same destination fields:
  `center`, `radiusPc`, `normal`, `angularSpeedRadPerSec`, and `lookAt`.

Radio bubble:

- Most chapters are ordinary destination orbits around the Sun or Hyades.
- The Marconi chapter is not just camera motion. It drives procedural scene
  state: bubble scale, timeline date label, and camera radius around the
  expanding shell.
- That scene behavior belongs in the topic viewer because it is story-specific,
  but the underlying concepts map cleanly to Studio object parameter tracks:
  radius, opacity/visibility, timeline label, and observer radius.

Astrophage route:

- Chapters combine camera intent with annotation reveal state.
- The camera moves to Sol, Tau Ceti, relay regions, or a lookback pose, while
  markers and connecting lines reveal with delays and draw durations.
- Website code can apply those reveals imperatively at chapter activation time.
  Studio should represent the same idea as object/line visibility tracks and
  event-relative timing.

HR diagram and Omega Centauri:

- Some chapters are view-only `transitionTo` scenes that change the look target
  and HR data mode.
- Cluster chapters are orbit scenes.
- The Omega Centauri jump uses a canonical route corridor and route-aware
  demand strategy. This is an important pattern: the chapter owns story
  semantics, `@found-in-space/spatial` owns the route math, and the topic
  viewer owns preload/demand strategy decisions that are specific to the
  streamed data experience.

## Studio Camera Timelines

Timed video/editor data belongs to the sibling
[`Found-in-Space/skykit-studio`](https://github.com/Found-in-Space/skykit-studio)
repository. Studio owns camera timeline normalization, evaluation, cue/track
helpers, retiming utilities, render pages, and deterministic export metadata.

Studio should support the same chapter-level intent, but it compiles that
intent into exact timeline state:

- observer position keys;
- camera target, direction, quaternion, up, roll, and orbit keys;
- motion or shot ranges;
- time-remap curves and speed ramps;
- cue/title clips;
- guide, annotation, line, object, and data-layer tracks;
- preload/readiness markers;
- render metadata.

The Studio UI may use professional production labels:

- journey -> sequence;
- chapter -> shot, section, or story marker;
- camera intent -> camera rig;
- destination -> destination preset;
- cue -> title clip;
- scene state -> layer/object/data tracks.

Developer-facing docs should keep the storage and runtime terms visible so
authors can move between Studio projects and website chapters without learning
two conceptual systems.

### Studio Use Cases

Cluster fly-to and orbit:

- The author picks a destination preset: center, label, radius, orbit normal,
  angular speed, dwell duration, default aim target, and framing scale.
- Studio samples an orbit-transfer or orbital-insert route from the previous
  shot's evaluated end pose.
- The compiled result becomes deterministic observer and camera tracks.
- Diagnostics should report route length, duration, average speed, peak speed,
  arrival speed, and settle behavior.

Radio bubble video:

- The website's Marconi chapter becomes a shot range where bubble radius,
  opacity, date label, camera radius, and look target are all frame-indexed.
- The exact same visual story can be exported because Studio evaluates by scene
  time and frame index, not by wall-clock animation time.
- Cue/title tracks can be timed to narration while the object track drives the
  expanding shell.

Constellation journey:

- A chapter or shot may begin from an Earth-like establishing view, then fly
  through the 3D star field while keeping constellation line work, labels, or
  reference art visible.
- In the website this would likely be a chapter with custom annotation state.
  In Studio it becomes a deterministic shot with observer keys, camera aim
  keys, guide/annotation tracks, and title-safe cue overlays.

Model-driven reveal:

- The Astrophage-style line reveal is a website chapter behavior today.
- In Studio the same semantics should become event-relative object/line tracks:
  a marker appears, a line reveal starts `0.75` seconds later, and camera
  motion can follow or frame the reveal.

## Shared Motion And Route Math

Reusable motion math belongs in `@found-in-space/spatial`, especially:

- orbit basis, angle, normal, tangent, and arrival-action helpers;
- polyline route construction and sampling;
- orbit-transfer route generation;
- orbital insert route generation;
- smooth pose and path evaluation;
- deterministic samples and preload hints.

SkyKit runtime actions should consume those helpers. Website chapter helpers
and Studio authoring helpers should call the same math instead of copying it.

Important distinction:

- Runtime navigation adapts to the current live pose.
- Studio timeline compilation adapts to the evaluated pose at a known time.

Both can use the same route function, but they should not share stateful
chapter or timeline orchestration.

## When To Add Shared Schema

Do not create a general guided-tour package just because multiple pages have
chapters. The current website pages are intentionally hand-authored because
their science and scene state are bespoke.

Consider a tiny shared schema or helper only when both website and Studio need
to import the same artifact directly. Good candidates are:

- destination preset normalization;
- motion-intent normalization;
- orbit/travel option naming;
- route diagnostic summaries;
- conversion from a destination preset to SkyKit navigation action payloads;
- conversion from a destination preset to Studio camera-rig authoring commands.

Keep that schema dependency-free if possible, and prefer `@found-in-space/spatial`
when the helper is primarily geometry, route, pose, or motion math.

## Naming Rules

- Prefer `centerPc`, `targetPc`, `lookAt`, `radiusPc`, `orbitNormal`, and
  `angularSpeedRadPerSec` in authored data.
- Accept runtime aliases such as `center`, `normal`, `radius`, and
  `angularSpeed` at action boundaries where SkyKit already normalizes them.
- Use `travel` for reaching a destination and `arrivalAction` for what happens
  after the travel completes.
- Use `view` for direct viewer-state hints and `camera` for camera-rig intent.
- Use `sceneState` or domain-specific fields such as `hr`, `reveal`, or
  `bubble` for app-owned data-layer changes.
- Keep page-specific DOM terms such as `data-step`, `data-cluster`, and
  `data-viewpoint` out of shared schema. They can remain page copy and wiring.

Core SkyKit remains focused on reusable viewer, navigation, renderer, star
streaming, action, and plugin primitives. Website and Studio can share language
without sharing orchestration.
