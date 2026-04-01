import assert from 'node:assert/strict';
import test from 'node:test';
import { createConstellationCompassController } from '../constellation-compass-controller.js';

const MANIFEST = {
  id: 'controller-manifest',
  constellations: [
    {
      id: 'ori-id',
      iau: 'Ori',
      image: {
        size: [100, 100],
        anchors: [
          { pos: [0, 0], direction: [1, 0, 0] },
          { pos: [100, 0], direction: [1, 1, 0] },
          { pos: [0, 100], direction: [1, 0, 1] },
        ],
      },
    },
    {
      id: 'tau-id',
      iau: 'Tau',
      image: {
        size: [100, 100],
        anchors: [
          { pos: [0, 0], direction: [-1, 0, 0] },
          { pos: [100, 0], direction: [-1, -1, 0] },
          { pos: [0, 100], direction: [-1, 0, 1] },
        ],
      },
    },
  ],
};

function createCamera(directionRef) {
  return {
    getWorldDirection(target) {
      target.set(directionRef.x, directionRef.y, directionRef.z);
      return target;
    },
  };
}

test('ConstellationCompassController applies hysteresis before changing constellation', async () => {
  const direction = { x: 1, y: 0, z: 0 };
  const events = [];
  const controller = createConstellationCompassController({
    manifest: MANIFEST,
    hysteresisSecs: 0.2,
    onConstellationIn: ({ iau }) => events.push(`in:${iau}`),
    onConstellationOut: ({ iau }) => events.push(`out:${iau}`),
  });

  const context = {
    camera: createCamera(direction),
    state: {},
    frame: { deltaSeconds: 0.1, timeMs: 100 },
  };

  await controller.attach(context);
  controller.update(context);
  assert.deepEqual(events, []);

  context.frame = { deltaSeconds: 0.11, timeMs: 210 };
  controller.update(context);
  assert.deepEqual(events, ['in:Ori']);
  assert.equal(context.state.activeConstellationIau, 'Ori');

  direction.x = -1;
  context.frame = { deltaSeconds: 0.05, timeMs: 260 };
  controller.update(context);
  assert.deepEqual(events, ['in:Ori']);

  context.frame = { deltaSeconds: 0.2, timeMs: 460 };
  controller.update(context);
  assert.deepEqual(events, ['in:Ori', 'out:Ori', 'in:Tau']);
  assert.equal(context.state.activeConstellationIau, 'Tau');
});

test('ConstellationCompassController with null hysteresis keeps first committed constellation', async () => {
  const direction = { x: 1, y: 0, z: 0 };
  const events = [];
  const controller = createConstellationCompassController({
    manifest: MANIFEST,
    hysteresisSecs: null,
    onConstellationIn: ({ iau }) => events.push(`in:${iau}`),
    onConstellationOut: ({ iau }) => events.push(`out:${iau}`),
  });

  const context = {
    camera: createCamera(direction),
    state: {},
    frame: { deltaSeconds: 0.1, timeMs: 100 },
  };

  await controller.attach(context);
  controller.update(context);
  assert.deepEqual(events, ['in:Ori']);
  assert.equal(context.state.activeConstellationIau, 'Ori');

  direction.x = -1;
  context.frame = { deltaSeconds: 1.0, timeMs: 1100 };
  controller.update(context);

  assert.deepEqual(events, ['in:Ori']);
  assert.equal(context.state.activeConstellationIau, 'Ori');
});
