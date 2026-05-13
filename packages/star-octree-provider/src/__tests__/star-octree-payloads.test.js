import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeStarPayload,
  planPayloadRangeBatches,
} from '../star-octree-payloads.js';

test('planPayloadRangeBatches coalesces nearby ranges and respects batch limits', () => {
  const nodes = [
    createNode('a', { payloadOffset: 100, payloadLength: 20 }),
    createNode('b', { payloadOffset: 140, payloadLength: 10 }),
    createNode('c', { payloadOffset: 500, payloadLength: 20 }),
  ];

  const batches = planPayloadRangeBatches(nodes, {
    maxGapBytes: 24,
    maxBatchBytes: 128,
  });

  assert.deepEqual(
    batches.map((batch) => ({
      start: batch.start,
      end: batch.end,
      nodeCount: batch.nodes.length,
      gapBytes: batch.gapBytes,
    })),
    [
      { start: 100, end: 149, nodeCount: 2, gapBytes: 20 },
      { start: 500, end: 519, nodeCount: 1, gapBytes: 0 },
    ],
  );
});

test('decodeStarPayload returns provider-native parsec attributes and refs', () => {
  const node = createNode('node-a', {
    centerX: 10,
    centerY: 20,
    centerZ: 30,
    halfSize: 2,
  });
  const decoded = decodeStarPayload(
    createPayloadBytes([
      { local: [0, 0.5, -0.5], magAbs: 4.25, teffLog8: 128 },
      { local: [1, -1, 0.25], magAbs: -1.46, teffLog8: 222 },
    ]),
    node,
    { datasetId: 'dataset-a' },
  );

  assert.equal(decoded.count, 2);
  assert.deepEqual(Array.from(decoded.positionsPc), [
    10, 21, 29, 12, 18, 30.5,
  ]);
  assertFloatArrayClose(decoded.magAbs, [4.25, -1.46]);
  assert.deepEqual(Array.from(decoded.teffLog8), [128, 222]);
  assert.deepEqual(decoded.refs, [
    { datasetId: 'dataset-a', nodeKey: 'node-a', ordinal: 0 },
    { datasetId: 'dataset-a', nodeKey: 'node-a', ordinal: 1 },
  ]);
});

function createPayloadBytes(records) {
  const buffer = new ArrayBuffer(records.length * 16);
  const view = new DataView(buffer);

  records.forEach((record, index) => {
    const offset = index * 16;
    view.setFloat32(offset, record.local[0], true);
    view.setFloat32(offset + 4, record.local[1], true);
    view.setFloat32(offset + 8, record.local[2], true);
    view.setInt16(offset + 12, Math.round(record.magAbs * 100), true);
    view.setUint8(offset + 14, record.teffLog8);
  });

  return buffer;
}

function assertFloatArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);

  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(Math.abs(actual[index] - expected[index]) < 1e-6, true);
  }
}

function createNode(nodeKey, overrides = {}) {
  return {
    nodeKey,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 1,
    level: 0,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    flags: 0,
    childMask: 0,
    payloadOffset: 0,
    payloadLength: 0,
    firstChild: 0,
    localDepth: 0,
    localPath: 0,
    shardOffset: 0,
    nodeIndex: 1,
    ...overrides,
  };
}
