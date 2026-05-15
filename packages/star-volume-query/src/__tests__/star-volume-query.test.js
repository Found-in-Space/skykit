import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTravelVolumeRequests,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  distancePointToPathPc,
  streamVolumeProducts,
  warmVolumeRequests,
} from '../index.js';

test('sphere strategy selects nodes whose AABB overlaps the sphere', async () => {
  const strategy = createSphereVolumeStrategy({
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 10,
  });
  const selected = [];
  const plan = await strategy.selectDemand(createSelectionContext([
    createNode({ nodeKey: 'inside', centerX: 8, halfSize: 1, level: 2 }),
    createNode({ nodeKey: 'edge', centerX: 11, halfSize: 1, level: 1 }),
    createNode({ nodeKey: 'outside', centerX: 12, halfSize: 1, level: 3 }),
  ], selected));

  assert.deepEqual(plan.entries.map((entry) => entry.node.nodeKey), ['edge', 'inside']);
  assert.equal(plan.metadata.strategy, 'sphere-volume');
  assert.equal(plan.metadata.selectedNodeCount, 2);
  assert.deepEqual(selected, [
    { nodeKey: 'inside', include: true, descend: true },
    { nodeKey: 'edge', include: true, descend: true },
    { nodeKey: 'outside', include: false, descend: false },
  ]);
});

test('path strategy uses node-center capsule overlap with half-size padding', async () => {
  const strategy = createPathVolumeStrategy({
    pointsPc: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
    radiusPc: 2,
  });
  const plan = await strategy.selectDemand(createSelectionContext([
    createNode({ nodeKey: 'path-near', centerX: 5, centerY: 2.5, halfSize: 0.5 }),
    createNode({ nodeKey: 'path-far', centerX: 5, centerY: 4, halfSize: 0.5 }),
  ]));

  assert.deepEqual(plan.entries.map((entry) => entry.node.nodeKey), ['path-near']);
  assert.equal(distancePointToPathPc({ x: 5, y: 4, z: 0 }, [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ]), 4);
});

test('travel volume requests split by radius profile and merge adjacent same-radius slices', () => {
  const requests = buildTravelVolumeRequests({
    routePointsPc: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
    ],
    radiusProfile: [
      { progress: 0, radiusPc: 2 },
      { progress: 0.5, radiusPc: 2.2 },
      { progress: 1, radiusPc: 4.1 },
    ],
    paddingPc: 0.5,
    quantizeStepPc: 1,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].radiusPc, 3);
  assert.equal(requests[0].pointsPc.length, 2);
  assert.equal(requests[1].radiusPc, 5);
  assert.deepEqual(requests[1].pointsPc[0], { x: 10, y: 0, z: 0 });
});

test('travel volume requests fall back to a single full-path request', () => {
  const requests = buildTravelVolumeRequests({
    routePointsPc: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
    ],
    defaultRadiusPc: 3.1,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, 'path');
  assert.equal(requests[0].radiusPc, 4);
});

test('streamVolumeProducts passes a custom volume strategy to the provider', async () => {
  let receivedStrategy = null;
  const provider = {
    streamObjectBatches(options) {
      receivedStrategy = options.strategy;
      return [createCurrentDelta()];
    },
  };

  const deltas = [];
  for await (const delta of streamVolumeProducts(provider, {
    type: 'sphere',
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 1,
  })) {
    deltas.push(delta);
  }

  assert.equal(receivedStrategy.kind, 'custom');
  assert.equal(deltas[0].type, 'data/representation-current');
});

test('warmVolumeRequests consumes streams and reports progress without exposing products', async () => {
  const progress = [];
  const provider = {
    streamObjectBatches() {
      return [
        {
          type: 'data/product-upsert',
          product: { count: 2 },
        },
        createCurrentDelta(),
      ];
    },
  };

  const result = await warmVolumeRequests(provider, [
    {
      type: 'sphere',
      centerPc: { x: 0, y: 0, z: 0 },
      radiusPc: 1,
    },
  ], {
    onProgress(event) {
      progress.push(event.delta.type);
    },
  });

  assert.deepEqual(result, {
    requestCount: 1,
    productCount: 1,
    starCount: 2,
    currentCount: 1,
  });
  assert.deepEqual(progress, ['data/product-upsert', 'data/representation-current']);
});

function createCurrentDelta() {
  return {
    type: 'data/representation-current',
    completeness: {
      phase: 'complete',
      stable: true,
      loadedObjects: 0,
      loadedNodes: 0,
    },
  };
}

function createSelectionContext(nodes, visits = []) {
  return {
    traversal: {
      async select(options) {
        const entries = [];
        let inspectedNodeCount = 0;
        let selectedNodeCount = 0;
        let prunedNodeCount = 0;
        let maxLevelInspected = null;
        for (const node of nodes) {
          inspectedNodeCount += 1;
          maxLevelInspected = Math.max(maxLevelInspected ?? node.level, node.level);
          const decision = await options.visit(node, {
            context: {},
            bootstrap: {},
          });
          visits.push({
            nodeKey: node.nodeKey,
            include: decision.include === true,
            descend: decision.descend !== false && decision.include === true,
          });
          if (decision.include) {
            selectedNodeCount += 1;
            entries.push({
              node,
              priority: decision.priority,
              reasons: decision.reasons,
              metadata: decision.metadata,
            });
          } else {
            prunedNodeCount += 1;
          }
        }
        return {
          entries,
          stats: {
            inspectedNodeCount,
            selectedNodeCount,
            prunedNodeCount,
            payloadNodeCount: entries.length,
            frontierShardCount: 0,
            maxLevelInspected,
          },
        };
      },
    },
  };
}

function createNode(overrides = {}) {
  return {
    nodeKey: overrides.nodeKey ?? 'node',
    centerX: overrides.centerX ?? 0,
    centerY: overrides.centerY ?? 0,
    centerZ: overrides.centerZ ?? 0,
    halfSize: overrides.halfSize ?? 1,
    level: overrides.level ?? 1,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    flags: 1,
    childMask: 0,
    payloadOffset: 0,
    payloadLength: 16,
    firstChild: 0,
    localDepth: 0,
    localPath: 0,
    shardOffset: 0,
    nodeIndex: 0,
  };
}
