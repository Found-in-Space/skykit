import test from 'node:test';
import assert from 'node:assert/strict';
import { createTargetFrustumField } from '../target-frustum-field.js';
import {
  createFieldTestContext,
  selectedOctantsForFixture,
} from './helpers/fake-octree.js';

function createWideFrustumField(targetPc, overrides = {}) {
  return createTargetFrustumField({
    observerPc: { x: 0, y: 0, z: 0 },
    targetPc,
    verticalFovDeg: 170,
    overscanDeg: 0,
    targetRadiusPc: 400,
    nearPc: 0.01,
    ...overrides,
  });
}

test('TargetFrustumField prunes rear octants in the plain axis-aligned case', async () => {
  const context = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: 200, z: 0 },
      mDesired: 6.5,
    },
  });

  const field = createWideFrustumField({ x: 0, y: 200, z: 0 }, {
    targetRadiusPc: 250,
  });

  const selection = await field.selectNodes(context);

  assert.deepEqual(selectedOctantsForFixture(selection), [2, 3, 6, 7]);
});

test('TargetFrustumField keeps exactly the front half of octants for an axis-aligned target', async () => {
  const context = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: 200, z: 0 },
      mDesired: 6.5,
    },
  });

  const field = createWideFrustumField({ x: 0, y: 200, z: 0 });

  const selection = await field.selectNodes(context);

  assert.deepEqual(selectedOctantsForFixture(selection), [2, 3, 6, 7]);
  assert.equal(selection.meta.selectedNodeCount, 4);
});

test('TargetFrustumField drops only the single fully-behind octant for a symmetric diagonal target', async () => {
  const context = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 200, y: 200, z: 200 },
      mDesired: 6.5,
    },
  });

  const field = createWideFrustumField({ x: 200, y: 200, z: 200 });

  const selection = await field.selectNodes(context);

  assert.deepEqual(selectedOctantsForFixture(selection), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(selection.meta.selectedNodeCount, 7);
});

test('TargetFrustumField prunes coarse rear octants even when they touch the observer corner', async () => {
  const context = createFieldTestContext({
    state: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: 200, z: 0 },
      mDesired: 6.5,
    },
  });

  const field = createTargetFrustumField({
    observerPc: { x: 0, y: 0, z: 0 },
    targetPc: { x: 0, y: 200, z: 0 },
    verticalFovDeg: 140,
    overscanDeg: 0,
    targetRadiusPc: 400,
    nearPc: 0.01,
  });

  const selection = await field.selectNodes(context);

  assert.deepEqual(selectedOctantsForFixture(selection), [2, 3, 6, 7]);
});
