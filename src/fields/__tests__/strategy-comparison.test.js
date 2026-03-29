import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserverShellField } from '../observer-shell-field.js';
import { createTargetFrustumField } from '../target-frustum-field.js';
import {
  createFieldTestContext,
  selectedOctantsForFixture,
} from './helpers/fake-octree.js';

function createShellField(observerPc, overrides = {}) {
  return createObserverShellField({
    observerPc,
    ...overrides,
  });
}

function createWideFrustumField(observerPc, targetPc, overrides = {}) {
  return createTargetFrustumField({
    observerPc,
    targetPc,
    verticalFovDeg: 170,
    overscanDeg: 0,
    targetRadiusPc: 400,
    nearPc: 0.01,
    ...overrides,
  });
}

test('Frustum outperforms shell in the axis-aligned origin case', async () => {
  const observerPc = { x: 0, y: 0, z: 0 };
  const targetPc = { x: 0, y: 200, z: 0 };
  const context = createFieldTestContext({
    state: {
      observerPc,
      targetPc,
      mDesired: 6.5,
    },
  });

  const shellField = createShellField(observerPc);
  const frustumField = createWideFrustumField(observerPc, targetPc);

  const shellSelection = await shellField.selectNodes(context);
  const frustumSelection = await frustumField.selectNodes(context);

  assert.deepEqual(selectedOctantsForFixture(shellSelection), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(selectedOctantsForFixture(frustumSelection), [2, 3, 6, 7]);
  assert.equal(shellSelection.meta.selectedNodeCount, 8);
  assert.equal(frustumSelection.meta.selectedNodeCount, 4);
  assert.ok(
    frustumSelection.meta.selectedNodeCount < shellSelection.meta.selectedNodeCount,
    'frustum should select fewer nodes than shell in the axis-aligned case',
  );
});

test('Frustum still outperforms shell in the symmetric diagonal origin case', async () => {
  const observerPc = { x: 0, y: 0, z: 0 };
  const targetPc = { x: 200, y: 200, z: 200 };
  const context = createFieldTestContext({
    state: {
      observerPc,
      targetPc,
      mDesired: 6.5,
    },
  });

  const shellField = createShellField(observerPc);
  const frustumField = createWideFrustumField(observerPc, targetPc);

  const shellSelection = await shellField.selectNodes(context);
  const frustumSelection = await frustumField.selectNodes(context);

  assert.deepEqual(selectedOctantsForFixture(shellSelection), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(selectedOctantsForFixture(frustumSelection), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(shellSelection.meta.selectedNodeCount, 8);
  assert.equal(frustumSelection.meta.selectedNodeCount, 7);
  assert.ok(
    frustumSelection.meta.selectedNodeCount < shellSelection.meta.selectedNodeCount,
    'frustum should still select fewer nodes than shell in the diagonal case',
  );
});
