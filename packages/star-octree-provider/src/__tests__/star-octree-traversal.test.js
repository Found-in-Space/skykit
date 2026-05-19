import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarCellKey } from '@found-in-space/star-trees';
import { STAR_HAS_PAYLOAD, STAR_IS_FRONTIER } from '../star-octree-format.js';
import { createStarOctreeIndexSource } from '../star-octree-index-source.js';
import {
  loadRadiusForMagnitudeShell,
  planObserverShellDemand,
} from '../star-octree-observer-shell.js';
import {
  planStarOctreeStrategyDemand,
  withMotionLookahead,
} from '../star-octree-strategies.js';
import { planTargetFrustumDemand } from '../star-octree-target-frustum.js';
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
      traversal.nodes.map(createStarCellKey),
      ['1:0', '1:1'],
    );
    assert.equal(traversal.stats.inspectedNodeCount, 3);
  } finally {
    restoreFetch();
  }
});

test('traversal can descend through a node without emitting its payload', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        firstChild: 2,
        childMask: 0b00000011,
        localDepth: 1,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 2,
        localPath: 0,
        payloadOffset: 1010,
        payloadLength: 10,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 2,
        localPath: 1,
        payloadOffset: 1020,
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
      visitor(node) {
        return {
          include: true,
          descend: true,
          emit: node.nodeIndex !== 1,
        };
      },
    });

    assert.deepEqual(
      traversal.nodes.map(createStarCellKey),
      ['1:0', '1:1'],
    );
    assert.equal(traversal.stats.selectedNodeCount, 3);
    assert.equal(traversal.stats.payloadNodeCount, 2);
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
      traversal.nodes.map(createStarCellKey),
      ['1:0'],
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
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: 1000, y: 0, z: 0 },
          limitingMagnitude: 6.5,
        },
      }),
    });
    const wide = await planObserverShellDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 2,
          observerPc: { x: 1000, y: 0, z: 0 },
          limitingMagnitude: 16.5,
        },
      }),
    });

    assert.equal(narrow.entries.length, 0);
    assert.equal(narrow.metadata.prunedNodeCount, 1);
    assert.equal(wide.entries.length, 1);
    assert.equal(createStarCellKey(wide.entries[0].node), '0:0');
  } finally {
    restoreFetch();
  }
});

test('observer-shell demand matches the legacy half-size magnitude shell', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    parentGlobalDepth: 0,
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
    assert.equal(loadRadiusForMagnitudeShell(50, 6.5, 6.5), 50);

    const included = await planObserverShellDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: 50, y: -50, z: -50 },
          limitingMagnitude: 6.5,
        },
      }),
    });
    const pruned = await planObserverShellDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 2,
          observerPc: { x: 51, y: -50, z: -50 },
          limitingMagnitude: 6.5,
        },
      }),
    });
    assert.equal(included.entries.length, 1);
    assert.equal(included.entries[0].metadata.loadRadiusPc, 50);
    assert.equal(pruned.entries.length, 0);
    assert.equal(pruned.metadata.prunedNodeCount, 1);
  } finally {
    restoreFetch();
  }
});

test('observer-shell motion hints do not cap visible demand', async () => {
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
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: -75, y: -75, z: -75 },
          limitingMagnitude: 6.5,
        },
      }),
    });
    const motionPlan = await planObserverShellDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
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
      }),
    });

    assert.deepEqual(
      staticPlan.entries.map((entry) => createStarCellKey(entry.node)),
      ['2:0'],
    );
    assert.deepEqual(
      motionPlan.entries.map((entry) => createStarCellKey(entry.node)),
      ['2:0'],
    );
    assert.equal(motionPlan.signature, staticPlan.signature);
    assert.equal(motionPlan.metadata.motion.enabled, true);
    assert.equal(motionPlan.metadata.motion.lookaheadDistancePc, 200);
    assert.equal(motionPlan.metadata.motionAdaptive, undefined);
    assert.equal(motionPlan.metadata.motionCappedNodeCount, undefined);
    assert.equal(motionPlan.entries[0].metadata.motionAdaptiveMaxLevel, undefined);
    assert.equal(motionPlan.entries[0].metadata.motionPriorityBias, 0);
  } finally {
    restoreFetch();
  }
});

test('observer-shell motion lookahead decorator adds future-only prefetch demand', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    parentGlobalDepth: 0,
    entryNodes: [1, 2, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 1,
        payloadOffset: 1010,
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
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: -125, y: -75, z: -75 },
          limitingMagnitude: 6.5,
        },
      }),
    });
    const motionPlan = await planStarOctreeStrategyDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        strategy: withMotionLookahead({ kind: 'observer-shell' }),
        view: {
          revision: 2,
          observerPc: { x: -125, y: -75, z: -75 },
          limitingMagnitude: 6.5,
          motion: {
            velocityPcPerSec: { x: 150, y: 0, z: 0 },
            lookaheadSecs: 1,
          },
        },
      }),
    });
    const noVelocityPlan = await planStarOctreeStrategyDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        strategy: withMotionLookahead({ kind: 'observer-shell' }),
        view: {
          revision: 3,
          observerPc: { x: -125, y: -75, z: -75 },
          limitingMagnitude: 6.5,
          motion: {
            speedPcPerSec: 150,
            lookaheadSecs: 1,
          },
        },
      }),
    });

    assert.deepEqual(
      staticPlan.entries.map((entry) => createStarCellKey(entry.node)),
      ['1:0'],
    );
    assert.deepEqual(
      motionPlan.entries
        .filter((entry) => (entry.role ?? 'current') === 'current')
        .map((entry) => createStarCellKey(entry.node)),
      ['1:0'],
    );
    assert.deepEqual(
      motionPlan.entries
        .filter((entry) => entry.role === 'prefetch')
        .map((entry) => createStarCellKey(entry.node)),
      ['1:1'],
    );
    assert.equal(motionPlan.signature, staticPlan.signature);
    assert.equal(motionPlan.metadata.motionLookahead.enabled, true);
    assert.deepEqual(motionPlan.metadata.motionLookahead.futureObserverPc, {
      x: 25,
      y: -75,
      z: -75,
    });
    assert.equal(motionPlan.metadata.motionLookahead.prefetchNodeCount, 1);
    assert.equal(motionPlan.metadata.motionLookahead.prefetchOverlapCount, 1);
    assert.equal(noVelocityPlan.metadata.motionLookahead.enabled, false);
    assert.equal(
      noVelocityPlan.entries.some((entry) => entry.role === 'prefetch'),
      false,
    );
  } finally {
    restoreFetch();
  }
});

test('observer-shell motion hints prioritize same-level nodes without changing demand', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    parentGlobalDepth: 0,
    entryNodes: [1, 2, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 1,
        payloadOffset: 1010,
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
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: 0, y: 0, z: 0 },
          limitingMagnitude: 6.5,
        },
      }),
    });
    const motionPlan = await planObserverShellDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 2,
          observerPc: { x: 0, y: 0, z: 0 },
          limitingMagnitude: 6.5,
          motion: {
            velocityPcPerSec: { x: 100, y: 0, z: 0 },
            lookaheadSecs: 0.5,
          },
        },
      }),
    });

    assert.deepEqual(
      staticPlan.entries.map((entry) => createStarCellKey(entry.node)),
      ['1:0', '1:1'],
    );
    assert.deepEqual(
      motionPlan.entries.map((entry) => createStarCellKey(entry.node)),
      ['1:1', '1:0'],
    );
    assert.deepEqual(
      new Set(motionPlan.entries.map((entry) => createStarCellKey(entry.node))),
      new Set(staticPlan.entries.map((entry) => createStarCellKey(entry.node))),
    );
    assert.equal(motionPlan.signature, staticPlan.signature);
    assert.equal(motionPlan.metadata.motion.enabled, true);
    assert.equal(motionPlan.metadata.motion.lookaheadDistancePc, 50);
    assert.equal(motionPlan.entries[0].metadata.motionForwardDistancePc, 50);
    assert.ok(
      motionPlan.entries[0].metadata.motionPriorityBias >
        motionPlan.entries[1].metadata.motionPriorityBias,
    );
  } finally {
    restoreFetch();
  }
});

test('target-frustum motion lookahead decorator adds future-only prefetch demand', async () => {
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShard = createShardBytes({
    parentGlobalDepth: 0,
    entryNodes: [1, 2, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 0,
        payloadOffset: 1000,
        payloadLength: 10,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 1,
        localPath: 1,
        payloadOffset: 1010,
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
    strategy: { kind: 'target-frustum' },
    viewRevision: 1,
    demandRevision: 0,
    attributes: ['position'],
    coordinates: { units: ['pc', 'pc', 'pc'] },
    streaming: { coarseFirst: true },
  };

  try {
    const staticPlan = await planTargetFrustumDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        view: {
          revision: 1,
          observerPc: { x: -125, y: -75, z: -75 },
          limitingMagnitude: 6.5,
          directionIcrs: { x: 1, y: 0, z: 0 },
          verticalFovDeg: 120,
          aspectRatio: 1,
        },
      }),
    });
    const motionPlan = await planStarOctreeStrategyDemand({
      indexSource,
      context: withTraversalContext(indexSource, {
        ...baseContext,
        strategy: withMotionLookahead({ kind: 'target-frustum' }),
        view: {
          revision: 2,
          observerPc: { x: -125, y: -75, z: -75 },
          limitingMagnitude: 6.5,
          directionIcrs: { x: 1, y: 0, z: 0 },
          verticalFovDeg: 120,
          aspectRatio: 1,
          motion: {
            velocityPcPerSec: { x: 150, y: 0, z: 0 },
            lookaheadSecs: 1,
          },
        },
      }),
    });

    assert.deepEqual(
      motionPlan.entries
        .filter((entry) => (entry.role ?? 'current') === 'current')
        .map((entry) => createStarCellKey(entry.node)),
      staticPlan.entries.map((entry) => createStarCellKey(entry.node)),
    );
    assert.deepEqual(
      motionPlan.entries
        .filter((entry) => entry.role === 'prefetch')
        .map((entry) => createStarCellKey(entry.node)),
      ['1:1'],
    );
    assert.equal(motionPlan.signature, staticPlan.signature);
    assert.equal(motionPlan.metadata.motionLookahead.enabled, true);
    assert.equal(motionPlan.metadata.motionLookahead.prefetchNodeCount, 1);
  } finally {
    restoreFetch();
  }
});

function withTraversalContext(indexSource, context) {
  const wrapped = { ...context };
  const traversalApi = {
    async select(options) {
      const bootstrap = await indexSource.ensureBootstrapLoaded();
      const entries = [];
      const traversal = await traverseOctree({
        indexSource,
        bootstrap,
        distanceToNode: options.distanceToNode,
        async visitor(node) {
          const decision = await options.visit(node, {
            context: wrapped,
            bootstrap,
          });
          const include = decision.include === true;
          const emit = decision.emit !== false;
          const descend = decision.descend !== false;

          if (
            include &&
            emit &&
            (node.flags & STAR_HAS_PAYLOAD) &&
            node.payloadLength > 0
          ) {
            entries.push({
              node,
              priority: decision.priority,
              relevance: decision.relevance,
              role: decision.role ?? 'current',
              reasons: decision.reasons,
              metadata: decision.metadata,
            });
          }

          return {
            include,
            emit,
            descend: include && descend,
            distancePc: decision.distancePc,
          };
        },
      });

      return {
        entries,
        stats: traversal.stats,
      };
    },
  };

  wrapped.traversal = traversalApi;
  return wrapped;
}

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
