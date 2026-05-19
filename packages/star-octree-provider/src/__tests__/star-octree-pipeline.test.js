import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarOctreePipeline } from '../star-octree-pipeline.js';
import { STAR_HAS_PAYLOAD } from '../star-octree-format.js';
import { createStarOctreeScheduler } from '../star-octree-scheduler.js';

test('deferred prefetch traversal passes the prefetch lane into shard loading', async () => {
  const scheduler = createStarOctreeScheduler();
  const loadShardLanes = [];
  const bootstrap = createBootstrap();
  const rootNode = createRuntimeNode({
    nodeIndex: 1,
    level: 0,
    childMask: 0b00000001,
    firstChild: 2,
    flags: 0,
    halfSize: 100,
    shardOffset: 4096,
  });
  const childNode = createRuntimeNode({
    nodeIndex: 2,
    level: 1,
    flags: STAR_HAS_PAYLOAD,
    childMask: 0,
    firstChild: 0,
    halfSize: 50,
    payloadOffset: 10_000,
    payloadLength: 16,
  });
  const shard = {
    header: {
      entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
      nodeCount: 2,
    },
    readRuntimeNode(_header, nodeIndex) {
      return nodeIndex === 1 ? rootNode : childNode;
    },
    readFrontierContinuation() {
      return 0;
    },
  };
  const pipeline = createStarOctreePipeline({
    providerId: 'provider-a',
    scheduler,
    indexSource: {
      sourceIdentity: 'test-source',
      persistentCacheAvailable: false,
      ensureBootstrapLoaded() {
        return Promise.resolve(bootstrap);
      },
      ensureRootShardLoaded() {
        return Promise.resolve({ shard, nodes: [rootNode] });
      },
      loadShard(_shardOffset, options = {}) {
        loadShardLanes.push(options.lane);
        return Promise.resolve(shard);
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

  const plan = await pipeline.planPrefetchForContext({
    providerId: 'provider-a',
    strategy: {
      kind: 'motion-lookahead',
      strategy: { kind: 'observer-shell' },
    },
    view: {
      revision: 1,
      observerPc: { x: -10, y: 0, z: 0 },
      limitingMagnitude: 6.5,
      motion: {
        velocityPcPerSec: { x: 10, y: 0, z: 0 },
        lookaheadSecs: 1,
      },
    },
    viewRevision: 1,
    demandRevision: 0,
    attributes: ['position'],
    coordinates: { units: ['pc', 'pc', 'pc'] },
    streaming: { prefetchMode: 'defer' },
  }, []);

  assert.deepEqual(loadShardLanes, ['prefetch']);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].role, 'prefetch');
  assert.equal(scheduler.getSnapshot().stats.startedByLane.prefetch > 0, true);
});

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

function createBootstrap() {
  return {
    kind: 'star-octree-bootstrap',
    providerId: 'provider-a',
    datasetId: 'dataset-a',
    datasetIdentitySource: 'options',
    header: {
      version: 1,
      indexOffset: 4096,
      indexLength: 160,
      worldCenterX: 0,
      worldCenterY: 0,
      worldCenterZ: 0,
      worldHalfSize: 100,
      payloadRecordSize: 16,
      maxLevel: 14,
      magLimit: 6.5,
    },
    completeness: {
      phase: 'complete',
      stable: true,
    },
  };
}

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
