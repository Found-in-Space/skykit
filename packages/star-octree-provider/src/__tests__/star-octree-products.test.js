import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStarObjectBatchProduct,
} from '../star-octree-products.js';

test('createStarObjectBatchProduct builds typed product arrays and metadata', () => {
  const node = createNode('node-a', { centerX: 10, centerY: 20, centerZ: 30 });
  const product = createStarObjectBatchProduct({
    providerId: 'provider-a',
    sessionId: 'session-a',
    streamId: 'stream-a',
    productIndex: 1,
    entries: [
      {
        node,
        decoded: {
          count: 2,
          positionsPc: new Float32Array([1, 2, 3, 4, 5, 6]),
          teffLog8: new Uint8Array([100, 120]),
          magAbs: new Float32Array([1.5, 2.5]),
        },
      },
    ],
    attributes: ['position', 'teffLog8', 'magAbs', 'pickMeta'],
    viewRevision: 3,
    demandRevision: 4,
  });

  assert.equal(product.productType, 'object-batch');
  assert.equal(product.id, 'stream-a:product:1');
  assert.equal(product.count, 2);
  assert.deepEqual(Array.from(product.coordinates.primary.components), [
    1, 2, 3, 4, 5, 6,
  ]);
  assert.deepEqual(Array.from(product.attributes.teffLog8.values), [100, 120]);
  assert.deepEqual(Array.from(product.attributes.magAbs.values), [1.5, 2.5]);
  assert.equal(product.nodes[0].nodeKey, 'node-a');
  assert.equal(product.nodes[0].offset, 0);
  assert.equal(product.nodes[0].count, 2);
  assert.equal(product.pickMeta?.[1].ordinal, 1);
  assert.equal(product.pickMeta?.[1].gridZ, node.gridZ);
  assert.equal(product.memory.ownership, 'borrowed');
  assert.equal(product.memory.bytes, 34);
});

test('createStarObjectBatchProduct omits unrequested attributes', () => {
  const product = createStarObjectBatchProduct({
    providerId: 'provider-a',
    streamId: 'stream-a',
    productIndex: 1,
    entries: [
      {
        node: createNode('node-a'),
        decoded: {
          count: 1,
          positionsPc: new Float32Array([1, 2, 3]),
          teffLog8: new Uint8Array([100]),
          magAbs: new Float32Array([1.5]),
        },
      },
    ],
    attributes: ['position'],
  });

  assert.equal(product.attributes.teffLog8, undefined);
  assert.equal(product.attributes.magAbs, undefined);
  assert.equal(product.pickMeta, undefined);
  assert.equal(product.memory.bytes, 12);
});

test('createStarObjectBatchProduct applies coordinate transforms during packing', () => {
  const product = createStarObjectBatchProduct({
    providerId: 'provider-a',
    streamId: 'stream-a',
    productIndex: 1,
    entries: [
      {
        node: createNode('node-a'),
        decoded: {
          count: 1,
          positionsPc: new Float32Array([10, 20, 30]),
        },
      },
    ],
    attributes: ['position'],
    coordinates: {
      name: 'render-position',
      units: ['render', 'render', 'render'],
      transformPosition({ xPc, yPc, zPc }) {
        return {
          x: xPc * 0.001,
          y: yPc * 0.001 + 1,
          z: -zPc * 0.001,
        };
      },
    },
  });

  assert.equal(product.coordinates.primary.name, 'render-position');
  assert.deepEqual(product.coordinates.primary.units, [
    'render',
    'render',
    'render',
  ]);
  assertFloatArrayClose(product.coordinates.primary.components, [
    0.01, 1.02, -0.03,
  ]);
});

test('createStarObjectBatchProduct uses unique ids for progressive batches', () => {
  const first = createStarObjectBatchProduct({
    providerId: 'provider-a',
    streamId: 'stream-a',
    productIndex: 1,
    entries: [{ node: createNode('node-a'), decoded: oneStar() }],
  });
  const second = createStarObjectBatchProduct({
    providerId: 'provider-a',
    streamId: 'stream-a',
    productIndex: 2,
    entries: [{ node: createNode('node-b'), decoded: oneStar() }],
  });

  assert.notEqual(first.id, second.id);
});

function oneStar() {
  return {
    count: 1,
    positionsPc: new Float32Array([1, 2, 3]),
  };
}

function createNode(nodeKey, overrides = {}) {
  return {
    nodeKey,
    centerX: 1,
    centerY: 2,
    centerZ: 3,
    halfSize: 0.5,
    level: 1,
    gridX: 1,
    gridY: 2,
    gridZ: 3,
    flags: 0,
    childMask: 0,
    payloadOffset: 0,
    payloadLength: 1,
    firstChild: -1,
    localDepth: 0,
    localPath: 0,
    shardOffset: 0,
    nodeIndex: 0,
    ...overrides,
  };
}

function assertFloatArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);

  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(Math.abs(actual[index] - expected[index]) < 1e-6, true);
  }
}
