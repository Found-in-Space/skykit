import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJourneyController,
  createJourneyGraph,
  resolveSceneSpec,
} from '../journey-controller.js';

test('createJourneyGraph resolves scenes with transition overrides', () => {
  const graph = createJourneyGraph({
    initialSceneId: 'all-stars',
    scenes: {
      'all-stars': {
        mode: 0,
      },
      pleiades: {
        mode: 1,
        radius: 25,
      },
    },
    transitions: [
      {
        from: 'all-stars',
        to: 'pleiades',
        radius: 50,
        travelTimeSecs: 5,
      },
    ],
  });

  const resolved = resolveSceneSpec(graph, 'pleiades', 'all-stars');

  assert.equal(resolved.sceneId, 'pleiades');
  assert.equal(resolved.transitionId, 'all-stars->pleiades');
  assert.equal(resolved.fromSceneId, 'all-stars');
  assert.equal(resolved.travelTimeSecs, 5);
  assert.equal(resolved.radius, 50);
});

test('createJourneyController dispatches scene commands and emits lifecycle events', async () => {
  const graph = createJourneyGraph({
    initialSceneId: 'all-stars',
    scenes: {
      'all-stars': {
        mode: 0,
      },
      pleiades: {
        mode: 1,
        radius: 25,
      },
    },
    transitions: [
      {
        from: 'all-stars',
        to: 'pleiades',
        travelTimeSecs: 5,
      },
    ],
  });
  const events = [];
  const commands = [];
  const controller = createJourneyController({
    graph,
    autoInitialize: false,
    dispatch(command) {
      commands.push(command);
      return Promise.resolve(command);
    },
  });

  controller.subscribe((event) => {
    events.push(event.type);
  });

  const scene = await controller.activateScene('pleiades', {
    source: 'test',
  });

  assert.equal(scene.sceneId, 'pleiades');
  assert.deepEqual(commands.map((command) => command.type), [
    'journey/apply-scene',
  ]);
  assert.equal(commands[0].scene.sceneId, 'pleiades');
  assert.equal(commands[0].fromSceneId, 'all-stars');
  assert.deepEqual(controller.getSnapshot().journey, {
    activeSceneId: 'pleiades',
    previousSceneId: 'all-stars',
    transitionId: 'all-stars->pleiades',
    lastSource: 'test',
  });
  assert.deepEqual(events, [
    'command/dispatched',
    'journey/scene-exited',
    'state/changed',
    'journey/scene-entered',
    'command/completed',
  ]);
});
