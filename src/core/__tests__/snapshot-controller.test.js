import assert from 'node:assert/strict';
import test from 'node:test';

import { createSnapshotController } from '../snapshot-controller.js';

test('createSnapshotController dispatches commands and emits state changes', async () => {
  const controller = createSnapshotController({
    initialSnapshot: {
      count: 0,
    },
  });
  const eventTypes = [];

  controller.subscribe((event) => {
    eventTypes.push(event.type);
  });

  controller.addCommandHandler('counter/increment', async ({
    command,
    getSnapshot,
    updateSnapshot,
  }) => {
    updateSnapshot((snapshot) => ({
      ...snapshot,
      count: snapshot.count + (command.amount ?? 1),
    }), {
      commandType: command.type,
      reason: 'increment',
    });

    return getSnapshot().count;
  });

  const result = await controller.dispatch({
    type: 'counter/increment',
    amount: 2,
  });

  assert.equal(result.handled, true);
  assert.equal(result.result, 2);
  assert.equal(result.snapshot.count, 2);
  assert.deepEqual(eventTypes, [
    'command/dispatched',
    'state/changed',
    'command/completed',
  ]);
});

test('createSnapshotController runs hooks in sequence', async () => {
  const controller = createSnapshotController();

  controller.registerHook('selection/strategy', async (value) => value + 1);
  controller.registerHook('selection/strategy', async (value) => value * 2);

  const nextValue = await controller.runHook('selection/strategy', 3);
  assert.equal(nextValue, 8);
});

test('plugins only receive the dispatch-oriented extension surface', async () => {
  const controller = createSnapshotController({
    initialSnapshot: {
      enabled: false,
    },
  });
  let apiKeys = null;

  controller.addCommandHandler('plugin/enable', async ({ setSnapshot }) => {
    setSnapshot({
      enabled: true,
    });
    return true;
  });

  await controller.registerPlugin({
    setup(api) {
      apiKeys = Object.keys(api).sort();
      return api.dispatch({
        type: 'plugin/enable',
      });
    },
  });

  assert.deepEqual(apiKeys, [
    'dispatch',
    'getSnapshot',
    'registerHook',
    'select',
    'subscribe',
  ]);
  assert.equal(controller.getSnapshot().enabled, true);
});
