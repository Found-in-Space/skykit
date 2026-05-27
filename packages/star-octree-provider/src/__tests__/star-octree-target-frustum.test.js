import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFrustumTester,
  normalizeTargetFrustumView,
  quaternionToCameraBasis,
} from '@found-in-space/star-trees';

test('quaternionToCameraBasis follows SkyKit camera orientation convention', () => {
  const basis = quaternionToCameraBasis({ x: 0, y: 0, z: 0, w: 1 });

  assert.deepEqual(roundVector(basis.right), { x: 1, y: 0, z: 0 });
  assert.deepEqual(roundVector(basis.up), { x: 0, y: 1, z: 0 });
  assert.deepEqual(roundVector(basis.forward), { x: 0, y: 0, z: -1 });
});

test('target-frustum view validation requires a target or orientation', () => {
  assert.throws(
    () => normalizeTargetFrustumView(
      { verticalFovDeg: 70, aspectRatio: 1 },
      {},
    ),
    /targetPc or orientationIcrs/,
  );

  assert.throws(
    () => normalizeTargetFrustumView(
      {
        orientationIcrs: { x: 0, y: 0, z: 0, w: 1 },
        verticalFovDeg: 70,
      },
      {},
    ),
    /aspectRatio/,
  );
});

test('target-frustum derives a POC-parity target frustum with defaults', () => {
  const view = normalizeTargetFrustumView(
    {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: 0, z: -10 },
    },
    {},
  );
  const frustum = createFrustumTester(view);

  assert.equal(view.frustumMode, 'target');
  assert.equal(view.verticalFovDeg, 40);
  assert.equal(view.overscanDeg, 8);
  assert.equal(view.aspectRatio, 1);
  assert.equal(view.targetRadiusPc, 96);
  assert.equal(view.farPc, 106);
  assert.deepEqual(roundVector(frustum.basis.forward), { x: 0, y: 0, z: -1 });
  assert.equal(frustum.intersectsCell(createNode({ centerZ: -10 })), true);
  assert.equal(frustum.intersectsCell(createNode({ centerZ: 10 })), false);
});

test('target-frustum can derive from orientation without a target distance', () => {
  const view = normalizeTargetFrustumView(
    {
      observerPc: { x: 0, y: 0, z: 0 },
      orientationIcrs: { x: 0, y: -0.7071067811865475, z: 0, w: 0.7071067811865476 },
      verticalFovDeg: 60,
      aspectRatio: 1,
    },
    {},
  );
  const frustum = createFrustumTester(view);

  assert.equal(view.frustumMode, 'orientation');
  assert.equal(view.farPc, undefined);
  assert.deepEqual(roundVector(frustum.basis.forward), { x: 1, y: 0, z: 0 });
  assert.equal(frustum.intersectsCell(createNode({ centerX: 10 })), true);
  assert.equal(frustum.intersectsCell(createNode({ centerX: -10 })), false);
});

test('frustum tester intersects axis-aligned octree nodes exactly enough for pruning', () => {
  const view = normalizeTargetFrustumView(
    {
      observerPc: { x: 0, y: 0, z: 0 },
      orientationIcrs: { x: 0, y: 0, z: 0, w: 1 },
      verticalFovDeg: 90,
      aspectRatio: 1,
      nearPc: 0,
      farPc: 100,
    },
    {},
  );
  const frustum = createFrustumTester(view);

  assert.equal(frustum.intersectsCell(createNode({ centerZ: -10 })), true);
  assert.equal(frustum.intersectsCell(createNode({ centerX: 100, centerZ: -10 })), false);
  assert.equal(frustum.intersectsCell(createNode({ centerZ: 10 })), false);
  assert.equal(frustum.intersectsCell(createNode({ centerZ: -150 })), false);
});

test('frustum tester measures the closest visible witness instead of raw box distance', () => {
  const view = normalizeTargetFrustumView(
    {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: 100, z: 0 },
      verticalFovDeg: 60,
      aspectRatio: 1,
      nearPc: 0,
    },
    { overscanDeg: 0 },
  );
  const frustum = createFrustumTester(view);
  const witness = frustum.nearestVisiblePointToCell(createNode({
    centerX: 75,
    centerY: 75,
    centerZ: 0,
    halfSize: 25,
  }));

  assert.ok(witness);
  assert.deepEqual(roundVector(witness.point), { x: 50, y: 86.60254, z: 0 });
  assert.equal(Math.round(witness.distancePc * 1e6) / 1e6, 100);
});

function createNode(overrides = {}) {
  return {
    nodeKey: 'node',
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 1,
    level: 1,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    flags: 0,
    childMask: 0,
    payloadOffset: 0,
    payloadLength: 0,
    firstChild: 0,
    localDepth: 1,
    localPath: 0,
    shardOffset: 0,
    nodeIndex: 1,
    ...overrides,
  };
}

function roundVector(vector) {
  return {
    x: roundNumber(vector.x),
    y: roundNumber(vector.y),
    z: roundNumber(vector.z),
  };
}

function roundNumber(value) {
  return Math.round(value * 1e6) / 1e6 || 0;
}
