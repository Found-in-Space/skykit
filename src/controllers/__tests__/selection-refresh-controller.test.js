import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSelectionRefreshController,
  getSelectionRefreshReasons,
} from '../selection-refresh-controller.js';

test('getSelectionRefreshReasons reports meaningful observer movement', () => {
  const reasons = getSelectionRefreshReasons(
    {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: null,
      mDesired: 7.5,
      width: 100,
      height: 80,
    },
    {
      observerPc: { x: 20, y: 0, z: 0 },
      targetPc: null,
      mDesired: 7.5,
      width: 100,
      height: 80,
    },
    {
      observerDistancePc: 12,
      watchSize: false,
    },
  );

  assert.deepEqual(reasons, ['observerPc']);
});

test('SelectionRefreshController refreshes immediately, then respects the interval for later updates', async () => {
  const controller = createSelectionRefreshController({
    observerDistancePc: 1,
    minIntervalMs: 250,
    watchSize: false,
  });

  let refreshCount = 0;
  const runtime = {
    refreshSelection: async () => {
      refreshCount += 1;
    },
  };
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    mDesired: 7.5,
  };
  const baseContext = {
    runtime,
    state,
    size: {
      width: 100,
      height: 100,
    },
  };

  await controller.start(baseContext);
  state.observerPc = { x: 2, y: 0, z: 0 };

  await controller.update({
    ...baseContext,
    frame: {
      timeMs: 100,
    },
  });
  assert.equal(refreshCount, 1);

  state.observerPc = { x: 4, y: 0, z: 0 };
  await controller.update({
    ...baseContext,
    frame: {
      timeMs: 200,
    },
  });
  assert.equal(refreshCount, 1);

  await controller.update({
    ...baseContext,
    frame: {
      timeMs: 400,
    },
  });
  assert.equal(refreshCount, 2);
});

test('SelectionRefreshController refreshes when the interest field refresh key changes', async () => {
  const controller = createSelectionRefreshController({
    minIntervalMs: 0,
    watchSize: false,
  });

  let refreshCount = 0;
  let effectiveMaxLevel = 6;
  const runtime = {
    interestField: {
      async captureRefreshSnapshot() {
        return { effectiveMaxLevel };
      },
    },
    refreshSelection: async () => {
      refreshCount += 1;
    },
  };
  const baseContext = {
    runtime,
    state: {
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: 7.5,
    },
    size: {
      width: 100,
      height: 100,
    },
  };

  await controller.start(baseContext);

  effectiveMaxLevel = 3;
  await controller.update({
    ...baseContext,
    frame: {
      timeMs: 100,
    },
  });

  assert.equal(refreshCount, 1);
  assert.deepEqual(controller.getStats().lastReasons, ['interestField']);
});
