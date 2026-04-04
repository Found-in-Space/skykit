import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createObserverShellField,
  resolveObserverShellTraversalState,
} from '../observer-shell-field.js';
import {
  createFieldTestContext,
  selectedOctantsForFixture,
} from './helpers/fake-octree.js';

test('ObserverShellField expands selection as mDesired increases', async () => {
  const narrowContext = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 60, z: 0 },
      mDesired: 6.5,
    },
  });
  const wideContext = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 60, z: 0 },
      mDesired: 8.0,
    },
  });

  const narrowField = createObserverShellField({
    observerPc: { x: 0, y: 60, z: 0 },
  });
  const wideField = createObserverShellField({
    observerPc: { x: 0, y: 60, z: 0 },
  });

  const narrowSelection = await narrowField.selectNodes(narrowContext);
  const wideSelection = await wideField.selectNodes(wideContext);

  assert.deepEqual(selectedOctantsForFixture(narrowSelection), [2, 3, 6, 7]);
  assert.deepEqual(selectedOctantsForFixture(wideSelection), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(
    wideSelection.meta.selectedNodeCount > narrowSelection.meta.selectedNodeCount,
    'wider magnitude shell should select more payload nodes',
  );
});

test('ObserverShellField caps traversal at octree header maxLevel by default', async () => {
  const context = createFieldTestContext({
    fixture: { maxLevel: 0 },
    state: {
      observerPc: { x: 0, y: 60, z: 0 },
      mDesired: 8.0,
    },
  });

  const field = createObserverShellField({
    observerPc: { x: 0, y: 60, z: 0 },
  });

  const selection = await field.selectNodes(context);

  assert.equal(selection.meta.selectedNodeCount, 0);
});

test('ObserverShellField motionAdaptiveMaxLevel caps traversal when observer speed is high', async () => {
  const context = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 60, z: 0 },
      mDesired: 6.5,
      observerSpeedPcPerSec: 60,
    },
  });

  const field = createObserverShellField({
    observerPc: { x: 0, y: 60, z: 0 },
    motionAdaptiveMaxLevel: {
      lookaheadSecs: 1,
    },
  });

  const selection = await field.selectNodes(context);

  assert.equal(selection.meta.adaptiveMaxLevel, 0);
  assert.equal(selection.meta.effectiveMaxLevel, 0);
  assert.equal(selection.meta.selectedNodeCount, 0);
});

test('resolveObserverShellTraversalState relaxes the adaptive max level when the observer slows down', () => {
  const slowContext = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 60, z: 0 },
      mDesired: 6.5,
      observerSpeedPcPerSec: 20,
    },
  });
  const fastContext = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 60, z: 0 },
      mDesired: 6.5,
      observerSpeedPcPerSec: 60,
    },
  });
  const bootstrapHeader = slowContext.fixture.bootstrap.header;
  const options = {
    observerPc: { x: 0, y: 60, z: 0 },
    motionAdaptiveMaxLevel: {
      lookaheadSecs: 1,
    },
  };

  const slowState = resolveObserverShellTraversalState(slowContext, options, bootstrapHeader);
  const fastState = resolveObserverShellTraversalState(fastContext, options, bootstrapHeader);

  assert.equal(fastState.adaptiveLevelCap.maxLevel, 0);
  assert.equal(slowState.adaptiveLevelCap.maxLevel, 2);
  assert.ok(
    slowState.effectiveMaxLevel > fastState.effectiveMaxLevel,
    'slowing down should relax the effective traversal cap',
  );
});
