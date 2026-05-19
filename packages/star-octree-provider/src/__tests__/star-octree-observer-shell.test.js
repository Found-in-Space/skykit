import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarCellKey } from '@found-in-space/star-trees';
import { STAR_HAS_PAYLOAD } from '../star-octree-format.js';
import { planObserverShellDemand } from '../star-octree-observer-shell.js';

test('observer-shell cache reuses stable interior and exterior subtrees', async () => {
  const { indexSource } = createIndexSourceForNodes([
    createNode({
      mortonCode: '0',
      nodeIndex: 1,
      halfSize: 200,
      childMask: 0b00000011,
      firstChild: 2,
    }),
    createNode({
      mortonCode: '1',
      nodeIndex: 2,
      level: 1,
      centerX: 0,
      halfSize: 10,
      flags: STAR_HAS_PAYLOAD,
      payloadLength: 16,
    }),
    createNode({
      mortonCode: '2',
      nodeIndex: 3,
      level: 1,
      centerX: 100,
      halfSize: 10,
      flags: STAR_HAS_PAYLOAD,
      payloadLength: 16,
    }),
  ]);

  const first = await planObserverShellDemand({
    indexSource,
    context: createContext({ observerPc: { x: 0, y: 0, z: 0 } }),
  });
  const loadShardCountAfterFirst = indexSource.loadShardCount;
  const second = await planObserverShellDemand({
    indexSource,
    context: createContext(
      { observerPc: { x: 1, y: 0, z: 0 } },
      first.plannerCache,
    ),
  });

  assert.deepEqual(cellKeys(second.entries), cellKeys(first.entries));
  assert.equal(second.metadata.observerShellCache.reusedSubtreeCount, 1);
  assert.equal(second.metadata.observerShellCache.reEvaluatedBoundaryCount, 0);
  assert.equal(second.metadata.observerShellCache.newEntryCount, 0);
  assert.equal(indexSource.loadShardCount, loadShardCountAfterFirst);
});

test('observer-shell cache re-evaluates boundary subtrees when margin is exhausted', async () => {
  const { indexSource } = createIndexSourceForNodes([
    createNode({
      mortonCode: '0',
      nodeIndex: 1,
      halfSize: 200,
      childMask: 0b00000001,
      firstChild: 2,
    }),
    createNode({
      mortonCode: '1',
      nodeIndex: 2,
      level: 1,
      centerX: 20,
      halfSize: 10,
      flags: STAR_HAS_PAYLOAD,
      payloadLength: 16,
    }),
  ]);

  const first = await planObserverShellDemand({
    indexSource,
    context: createContext({ observerPc: { x: 0, y: 0, z: 0 } }),
  });
  const loadShardCountAfterFirst = indexSource.loadShardCount;
  const second = await planObserverShellDemand({
    indexSource,
    context: createContext(
      { observerPc: { x: -0.1, y: 0, z: 0 } },
      first.plannerCache,
    ),
  });

  assert.deepEqual(cellKeys(first.entries), ['1:1']);
  assert.deepEqual(cellKeys(second.entries), []);
  assert.equal(second.metadata.observerShellCache.reusedSubtreeCount, 0);
  assert.equal(second.metadata.observerShellCache.reEvaluatedBoundaryCount > 0, true);
  assert.equal(indexSource.loadShardCount > loadShardCountAfterFirst, true);
});

test('observer-shell cache is invalidated by limiting magnitude changes', async () => {
  const { indexSource } = createIndexSourceForNodes(createStableTreeNodes());

  const first = await planObserverShellDemand({
    indexSource,
    context: createContext({ observerPc: { x: 0, y: 0, z: 0 } }),
  });
  const loadShardCountAfterFirst = indexSource.loadShardCount;
  const second = await planObserverShellDemand({
    indexSource,
    context: createContext(
      {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 7.5,
      },
      first.plannerCache,
    ),
  });

  assert.equal(second.metadata.observerShellCache.reusedSubtreeCount, 0);
  assert.equal(second.metadata.observerShellCache.newEntryCount, 1);
  assert.equal(indexSource.loadShardCount > loadShardCountAfterFirst, true);
});

test('observer-shell reused subtrees match a fresh traversal current set', async () => {
  const { indexSource } = createIndexSourceForNodes(createStableTreeNodes());

  const first = await planObserverShellDemand({
    indexSource,
    context: createContext({ observerPc: { x: 0, y: 0, z: 0 } }),
  });
  const reused = await planObserverShellDemand({
    indexSource,
    context: createContext(
      { observerPc: { x: 1, y: 0, z: 0 } },
      first.plannerCache,
    ),
  });
  const fresh = await planObserverShellDemand({
    indexSource,
    context: createContext({ observerPc: { x: 1, y: 0, z: 0 } }),
  });

  assert.equal(reused.metadata.observerShellCache.reusedSubtreeCount, 1);
  assert.deepEqual(cellKeys(reused.entries), cellKeys(fresh.entries));
});

function createStableTreeNodes() {
  return [
    createNode({
      mortonCode: '0',
      nodeIndex: 1,
      halfSize: 200,
      childMask: 0b00000011,
      firstChild: 2,
    }),
    createNode({
      mortonCode: '1',
      nodeIndex: 2,
      level: 1,
      centerX: 0,
      halfSize: 10,
      flags: STAR_HAS_PAYLOAD,
      payloadLength: 16,
    }),
    createNode({
      mortonCode: '2',
      nodeIndex: 3,
      level: 1,
      centerX: 100,
      halfSize: 10,
      flags: STAR_HAS_PAYLOAD,
      payloadLength: 16,
    }),
  ];
}

function createIndexSourceForNodes(nodes) {
  const nodesByIndex = new Map(nodes.map((node) => [node.nodeIndex, node]));
  const rootNode = nodesByIndex.get(1);
  let loadShardCount = 0;
  const shard = {
    header: {
      entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
      nodeCount: Math.max(...nodes.map((node) => node.nodeIndex)),
    },
    readRuntimeNode(_header, nodeIndex) {
      return nodesByIndex.get(nodeIndex);
    },
    readFrontierContinuation() {
      return 0;
    },
  };

  return {
    indexSource: {
      get loadShardCount() {
        return loadShardCount;
      },
      ensureBootstrapLoaded() {
        return Promise.resolve(createBootstrap());
      },
      ensureRootShardLoaded() {
        return Promise.resolve({ shard, nodes: rootNode ? [rootNode] : [] });
      },
      loadShard() {
        loadShardCount += 1;
        return Promise.resolve(shard);
      },
    },
  };
}

function createContext(view, plannerCache = undefined) {
  return {
    providerId: 'provider-a',
    strategy: { kind: 'observer-shell' },
    view: {
      revision: 1,
      observerPc: { x: 0, y: 0, z: 0 },
      limitingMagnitude: 6.5,
      ...view,
    },
    viewRevision: 1,
    demandRevision: 0,
    attributes: ['position'],
    coordinates: { units: ['pc', 'pc', 'pc'] },
    streaming: { coarseFirst: true },
    plannerCache,
  };
}

function createBootstrap() {
  return {
    kind: 'star-octree-bootstrap',
    providerId: 'provider-a',
    header: {
      version: 1,
      indexOffset: 0,
      indexLength: 0,
      worldCenterX: 0,
      worldCenterY: 0,
      worldCenterZ: 0,
      worldHalfSize: 200,
      payloadRecordSize: 16,
      maxLevel: 4,
      magLimit: 6.5,
    },
    completeness: {
      phase: 'complete',
      stable: true,
    },
  };
}

function createNode(overrides = {}) {
  return {
    mortonCode: '0',
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 10,
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

function cellKeys(entries) {
  return entries.map((entry) => createStarCellKey(entry.node)).sort();
}
