# @found-in-space/journey

Plain authored journey primitives for Found in Space alpha lessons.

This package owns scene/chapter state, timed journey normalization, cue lookup,
generic parameter tracks, and waypoint retiming helpers. It depends on
`@found-in-space/spatial` for path, pose, and orientation math, and it does not
construct viewers, renderers, DOM scrollers, or star providers.

```js
import { createJourneyController, createTimedJourneyEvaluator } from '@found-in-space/journey';

const controller = createJourneyController({
  initialSceneId: 'sol',
  scenes: {
    sol: { title: 'Start at the Sun' },
    hyades: { title: 'Fly to the Hyades' },
  },
});

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

Journey waypoints, cues, scenes, and guides are independent authored IDs plus
coordinates. They do not use star IDs directly. A lesson or game that wants a
journey target to follow a star should keep the star's `CanonicalObjectRef` in
app-owned scene payload and resolve it to coordinates before handing data to
`@found-in-space/journey` or `@found-in-space/spatial`.

Website scroll wiring, video capture/export, and editor UI live outside this
runtime package.
