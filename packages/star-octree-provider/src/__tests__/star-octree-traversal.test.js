import assert from 'node:assert/strict';
import test from 'node:test';

import { STAR_HAS_PAYLOAD, STAR_IS_FRONTIER } from '../star-octree-format.js';
import { createStarOctreeIndexSource } from '../star-octree-index-source.js';
import { planObserverShellDemand } from '../star-octree-observer-shell.js';
import { traverseOctree } from '../star-octree-traversal.js';
import {
  concatBytes,
  createMockFetch,
  createOdscDescriptorBytes,
  createShardBytes,
  createShardNodeRecord,
  createStarHeaderBytes,
  DESCRIPTOR_SIZE,
  HEADER_SIZE,
  SHARD_HEADER_SIZE,
  SHARD_NODE_SIZE,
} from './octree-byte-fixtures.js';

test('traversal reads same-shard children deterministically', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        firstChild: 2,
        childMask: 0b00000011,
        localDepth: 1,
        localPath: 0,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 2,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 2,
        localPath: 1,
        payloadOffset: 1010,
        payloadLength: 10,
      }),
    ],
  });
  const { indexSource, restoreFetch } = createIndexSourceForBytes(concatBytes([
    createStarHeaderBytes({ indexOffset, indexLength: rootShard.length }),
    createOdscDescriptorBytes(),
    rootShard,
  ]));

  try {
    const bootstrap = await indexSource.ensureBootstrapLoaded();
    const traversal = await traverseOctree({
      indexSource,
      bootstrap,
      visitor() {
        return { include: true, descend: true };
      },
    });

    assert.deepEqual(
      traversal.nodes.map((node) => node.nodeKey),
      [`${indexOffset}:2`, `${indexOffset}:3`],
    );
    assert.equal(traversal.stats.inspectedNodeCount, 3);
  } finally {
    restoreFetch();
  }
});

test('traversal follows frontier shard continuations', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShardLength = SHARD_HEADER_SIZE + SHARD_NODE_SIZE + 8;
  const childShardOffset = indexOffset + rootShardLength;
  const rootShard = createShardBytes({
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    firstFrontierIndex: 1,
    frontierOffsets: [childShardOffset],
    nodes: [
      createShardNodeRecord({
        flags: STAR_IS_FRONTIER,
        childMask: 0b00000001,
        localDepth: 1,
        localPath: 0,
      }),
    ],
  });
  const childShard = createShardBytes({
    parentGlobalDepth: 0,
    parentGridX: 0,
    parentGridY: 0,
    parentGridZ: 0,
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
    ],
  });
  const { indexSource, restoreFetch } = createIndexSourceForBytes(concatBytes([
    createStarHeaderBytes({
      indexOffset,
      indexLength: rootShard.length + childShard.length,
    }),
    createOdscDescriptorBytes(),
    rootShard,
    childShard,
  ]));

  try {
    const bootstrap = await indexSource.ensureBootstrapLoaded();
    const traversal = await traverseOctree({
      indexSource,
      bootstrap,
      visitor() {
        return { include: true, descend: true };
      },
    });

    assert.deepEqual(
      traversal.nodes.map((node) => node.nodeKey),
      [`${childShardOffset}:1`],
    );
    assert.equal(traversal.stats.frontierShardCount, 1);
  } finally {
    restoreFetch();
  }
});

test('observer-shell demand uses header magLimit for pruning', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
    ],
  });
  const { indexSource, restoreFetch } = createIndexSourceForBytes(concatBytes([
    createStarHeaderBytes({
      indexOffset,
      indexLength: rootShard.length,
      worldHalfSize: 100,
      magLimit: 6.5,
      maxLevel: 99,
    }),
    createOdscDescriptorBytes(),
    rootShard,
  ]));
  const baseContext = {
    providerId: 'provider-a',
    strategy: { kind: 'observer-shell' },
    viewRevision: 1,
    demandRevision: 0,
    attributes: ['position'],
    coordinates: { units: ['pc', 'pc', 'pc'] },
  };

  try {
    const narrow = await planObserverShellDemand({
      indexSource,
      context: {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: 1000, y: 0, z: 0 },
          limitingMagnitude: 6.5,
        },
      },
    });
    const wide = await planObserverShellDemand({
      indexSource,
      context: {
        ...baseContext,
        view: {
          revision: 2,
          observerPc: { x: 1000, y: 0, z: 0 },
          limitingMagnitude: 16.5,
        },
      },
    });

    assert.equal(narrow.entries.length, 0);
    assert.equal(narrow.metadata.prunedNodeCount, 1);
    assert.equal(wide.entries.length, 1);
    assert.equal(wide.entries[0].node.nodeKey, `${indexOffset}:1`);
  } finally {
    restoreFetch();
  }
});

test('observer-shell motion hints cap deeper traversal without public maxLevel', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        firstChild: 2,
        childMask: 0b00000001,
        localDepth: 1,
        localPath: 0,
      }),
      createShardNodeRecord({
        firstChild: 3,
        childMask: 0b00000001,
        localDepth: 2,
        localPath: 0,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 3,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
    ],
  });
  const { indexSource, restoreFetch } = createIndexSourceForBytes(concatBytes([
    createStarHeaderBytes({
      indexOffset,
      indexLength: rootShard.length,
      worldHalfSize: 100,
      magLimit: 6.5,
      maxLevel: 99,
    }),
    createOdscDescriptorBytes(),
    rootShard,
  ]));
  const baseContext = {
    providerId: 'provider-a',
    strategy: { kind: 'observer-shell' },
    viewRevision: 1,
    demandRevision: 0,
    attributes: ['position'],
    coordinates: { units: ['pc', 'pc', 'pc'] },
    streaming: { coarseFirst: true },
  };

  try {
    const staticPlan = await planObserverShellDemand({
      indexSource,
      context: {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: -75, y: -75, z: -75 },
          limitingMagnitude: 6.5,
        },
      },
    });
    const motionPlan = await planObserverShellDemand({
      indexSource,
      context: {
        ...baseContext,
        view: {
          revision: 2,
          observerPc: { x: -75, y: -75, z: -75 },
          limitingMagnitude: 6.5,
          motion: {
            speedPcPerSec: 100,
            lookaheadSecs: 2,
          },
        },
      },
    });

    assert.deepEqual(
      staticPlan.entries.map((entry) => entry.node.nodeKey),
      [`${indexOffset}:3`],
    );
    assert.equal(motionPlan.entries.length, 0);
    assert.equal(motionPlan.metadata.motionAdaptive.enabled, true);
    assert.equal(motionPlan.metadata.motionAdaptive.adaptiveMaxLevel, 1);
    assert.equal(motionPlan.metadata.motionCappedNodeCount, 1);
  } finally {
    restoreFetch();
  }
});

function createIndexSourceForBytes(fileBytes) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, []);

  return {
    indexSource: createStarOctreeIndexSource({
      providerId: 'provider-a',
      options: {
        url: 'memory://stars.octree',
      },
    }),
    restoreFetch() {
      globalThis.fetch = originalFetch;
    },
  };
}
