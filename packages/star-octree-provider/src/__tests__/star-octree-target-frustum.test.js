import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFrustumTester,
  normalizeTargetFrustumView,
  quaternionToCameraBasis,
} from '../star-octree-target-frustum.js';

test('quaternionToCameraBasis follows SkyKit camera orientation convention', () => {
  const basis = quaternionToCameraBasis({ x: 0, y: 0, z: 0, w: 1 });

  assert.deepEqual(roundVector(basis.right), { x: 1, y: 0, z: 0 });
  assert.deepEqual(roundVector(basis.up), { x: 0, y: 1, z: 0 });
  assert.deepEqual(roundVector(basis.forward), { x: 0, y: 0, z: -1 });
});

test('target-frustum view validation requires exact orientation and projection state', () => {
  assert.throws(
    () => normalizeTargetFrustumView(
      { verticalFovDeg: 70, aspectRatio: 1 },
      { kind: 'target-frustum' },
    ),
    /orientationIcrs/,
  );

  assert.throws(
    () => normalizeTargetFrustumView(
      {
        orientationIcrs: { x: 0, y: 0, z: 0, w: 1 },
        verticalFovDeg: 70,
      },
      { kind: 'target-frustum' },
    ),
    /aspectRatio/,
  );
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
    { kind: 'target-frustum' },
  );
  const frustum = createFrustumTester(view);

  assert.equal(frustum.intersectsNode(createNode({ centerZ: -10 })), true);
  assert.equal(frustum.intersectsNode(createNode({ centerX: 100, centerZ: -10 })), false);
  assert.equal(frustum.intersectsNode(createNode({ centerZ: 10 })), false);
  assert.equal(frustum.intersectsNode(createNode({ centerZ: -150 })), false);
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
    x: Math.round(vector.x * 1e6) / 1e6,
    y: Math.round(vector.y * 1e6) / 1e6,
    z: Math.round(vector.z * 1e6) / 1e6,
  };
}
