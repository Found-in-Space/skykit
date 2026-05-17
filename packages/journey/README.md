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

Website scroll wiring, video capture/export, and editor UI live outside this
runtime package.
