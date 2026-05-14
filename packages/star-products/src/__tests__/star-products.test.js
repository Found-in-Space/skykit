import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apparentMagnitude,
  consumeProductDeltas,
  createStarObjectBatchProduct,
  createStarRepresentationStore,
  decodeTemperatureK,
  icrsToRaDec,
  projectEquirectangular,
  supportsTransferableBuffers,
  temperatureToRgb,
} from '../index.js';

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

test('createStarObjectBatchProduct supports transfer ownership when available', () => {
  if (!supportsTransferableBuffers()) {
    return;
  }

  const product = createStarObjectBatchProduct({
    providerId: 'provider-a',
    streamId: 'stream-a',
    productIndex: 1,
    entries: [{
      node: createNode('node-a'),
      decoded: {
        count: 1,
        positionsPc: new Float32Array([1, 2, 3]),
        teffLog8: new Uint8Array([120]),
      },
    }],
    attributes: ['position', 'teffLog8'],
    memoryOwnership: 'transfer',
  });

  assert.equal(product.memory.ownership, 'transfer');
  assert.deepEqual(Array.from(product.coordinates.primary.components), [1, 2, 3]);
  assert.deepEqual(Array.from(product.attributes.teffLog8.values), [120]);
});

test('createStarRepresentationStore applies deltas and exposes star helpers', async () => {
  const store = createStarRepresentationStore();
  const product = createStarObjectBatchProduct({
    providerId: 'provider-a',
    streamId: 'stream-a',
    productIndex: 1,
    entries: [{
      node: createNode('node-a'),
      decoded: {
        count: 2,
        positionsPc: new Float32Array([1, 2, 3, 4, 5, 6]),
        teffLog8: new Uint8Array([100, 120]),
        magAbs: new Float32Array([1.5, 2.5]),
        refs: [
          { datasetId: 'dataset-a', nodeKey: 'node-a', ordinal: 0 },
          { datasetId: 'dataset-a', nodeKey: 'node-a', ordinal: 1 },
        ],
      },
    }],
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });

  const result = await consumeProductDeltas(createDeltas([
    { type: 'data/product-upsert', product },
    { type: 'data/representation-current', demandRevision: 1 },
  ]), store, { stopOnCurrent: true });

  assert.equal(result.stoppedOn, 'current');
  assert.equal(store.getStarCount(), 2);
  assert.equal(store.getObjectRef(product.id, 1)?.ordinal, 1);
  assert.equal(store.getPickMeta(product.id, 1)?.gridZ, 3);
  assert.equal(store.getSnapshot().starCount, 2);

  const rows = Array.from(store.stars());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].position, { x: 4, y: 5, z: 6 });
  assert.equal(rows[1].teffLog8, 120);
  assert.equal(rows[1].magAbs, 2.5);
});

test('star math helpers compute apparent magnitude, temperatures, colors, and sky projection', () => {
  assert.equal(apparentMagnitude({ magAbs: 5, distancePc: 10 }), 5);
  assert.equal(decodeTemperatureK(255), 5800);

  const cool = decodeTemperatureK(0);
  const hot = decodeTemperatureK(200);
  assert.ok(cool < hot);

  const rgb = temperatureToRgb(5800, { input: 'kelvin' });
  assert.equal(rgb.length, 3);
  assert.ok(rgb.every((channel) => channel >= 0 && channel <= 255));

  assert.deepEqual(icrsToRaDec([1, 0, 0]), {
    raDeg: 0,
    raHours: 0,
    decDeg: 0,
  });
  assert.deepEqual(icrsToRaDec([0, 1, 0]), {
    raDeg: 90,
    raHours: 6,
    decDeg: 0,
  });

  assert.deepEqual(projectEquirectangular({
    raDeg: 180,
    decDeg: 0,
    width: 360,
    height: 180,
  }), {
    x: 180,
    y: 90,
  });
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
    ...overrides,
  };
}

function assertFloatArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);

  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(Math.abs(actual[index] - expected[index]) < 1e-6, true);
  }
}

async function* createDeltas(deltas) {
  for (const delta of deltas) {
    yield delta;
  }
}
