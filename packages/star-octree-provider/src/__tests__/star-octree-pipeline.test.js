import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarOctreePipeline } from '../star-octree-pipeline.js';
import { STAR_HAS_PAYLOAD } from '../star-octree-format.js';

test('streamCellsForEntries forwards planner priority to payload and decode scheduling', async () => {
  const scheduledRequests = [];
  const scheduler = {
    schedule(request, run) {
      scheduledRequests.push(request);
      return {
        promise: Promise.resolve().then(run),
        cancel() {},
        promote() {},
      };
    },
  };
  const nodeA = createRuntimeNode({
    mortonCode: '0',
    flags: STAR_HAS_PAYLOAD,
    payloadOffset: 100,
    payloadLength: 16,
  });
  const nodeB = createRuntimeNode({
    mortonCode: '1',
    nodeIndex: 2,
    gridX: 1,
    flags: STAR_HAS_PAYLOAD,
    payloadOffset: 200,
    payloadLength: 16,
  });
  const capturedPriorities = [];
  const pipeline = createStarOctreePipeline({
    providerId: 'provider-a',
    scheduler,
    indexSource: {
      sourceIdentity: 'test-source',
      persistentCacheAvailable: false,
      fetchNodePayloadBatchProgressive(nodes, options = {}) {
        capturedPriorities.push(
          ...nodes.map((node) => options.priorityByNode?.get(node)),
        );
        const entries = nodes.map((node) => ({
          node,
          buffer: createDecodedPayloadBuffer(),
        }));
        return Promise.resolve()
          .then(() => options.onBatch?.(entries))
          .then(() => entries);
      },
      getSnapshot() {
        return {
          datasetId: 'dataset-a',
          stats: {},
          cache: {},
        };
      },
    },
  });
  const batches = [];

  for await (const cells of pipeline.streamCellsForEntries([
    { node: nodeA, priority: 2 },
    { node: nodeB, priority: 9 },
  ], {
    attributes: ['position'],
    lane: 'current',
  })) {
    batches.push(cells);
  }

  assert.deepEqual(capturedPriorities, [2, 9]);
  assert.deepEqual(
    scheduledRequests
      .filter((request) => request.kind === 'decode')
      .map((request) => request.priority),
    [2, 9],
  );
  assert.equal(batches.flat().length, 2);
});

function createDecodedPayloadBuffer() {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  view.setFloat32(0, 0, true);
  view.setFloat32(4, 0, true);
  view.setFloat32(8, 0, true);
  view.setInt16(12, 0, true);
  view.setUint8(14, 0);
  return buffer;
}

function createRuntimeNode(overrides = {}) {
  return {
    mortonCode: '0',
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 100,
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
    shardOffset: 4096,
    nodeIndex: 1,
    ...overrides,
  };
}
