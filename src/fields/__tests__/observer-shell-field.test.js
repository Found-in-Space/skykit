import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserverShellField } from '../observer-shell-field.js';
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
