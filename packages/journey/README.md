# @found-in-space/journey

Plain authored journey primitives for Found in Space alpha lessons.

This package owns scene/chapter state, timed journey normalization, cue lookup,
generic parameter tracks, and waypoint retiming helpers. It depends on
`@found-in-space/spatial` for path, pose, and orientation math, and it does not
construct viewers, renderers, DOM scrollers, or star providers.

```js
import { createJourney, createJourneyController, createTimedJourneyEvaluator } from '@found-in-space/journey';

const journey = createJourney({
  initial: 'sol',
  order: ['sol', 'hyades'],
  targets: {
    sun: { positionPc: { x: 0, y: 0, z: 0 } },
    hyades: { positionPc: { x: 17.574, y: 42.316, z: 13.963 } },
  },
  scenes: {
    sol: {
      title: 'Start at the Sun',
      view: {
        observerPc: { x: 8, y: 0, z: 0 },
        targetPc: { x: 0, y: 0, z: 0 },
      },
      camera: { type: 'orbit', center: 'sun', radiusPc: 8, angularSpeedRadPerSec: 0.26 },
    },
    hyades: {
      title: 'Fly to the Hyades',
      camera: { type: 'orbit', center: 'hyades', radiusPc: 15, angularSpeedRadPerSec: 0.2 },
    },
  },
  travel: { type: 'orbit-transfer', durationSecs: 5 },
});

const controller = createJourneyController({ graph: journey });
controller.goTo('hyades');

const evaluator = createTimedJourneyEvaluator({
  durationSecs: 10,
  locationWaypoints: [
    { timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
    { timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
  ],
});

const frame = evaluator.evaluate(5);
```

Orbit cameras require `radiusPc` and `angularSpeedRadPerSec`. `normal` is
optional: omit it to let SkyKit/spatial derive a natural insertion plane from
the approach vector, or provide it to request a specific orbital plane.
Scene `view` describes authored viewer state such as the starting observer,
target, or orientation. Put the initial boundary on the initial scene.

Journey waypoints, cues, scenes, and guides are independent authored IDs plus
coordinates. They do not use star IDs directly. A lesson or game that wants a
journey target to follow a star should keep the star's `StarObjectRef` in
app-owned scene payload and resolve it to coordinates before handing data to
`@found-in-space/journey` or `@found-in-space/spatial`.

Website scroll wiring, video capture/export, and editor UI live outside this
runtime package.
