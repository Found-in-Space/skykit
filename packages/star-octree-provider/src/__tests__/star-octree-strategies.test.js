import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarCellKey } from '@found-in-space/star-products';
import {
  buildTravelVolumeRequests,
  combineStarOctreeStrategies,
  createObserverShellStrategy,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createTargetFrustumStrategy,
  distancePointToPathPc,
  planStarOctreeStrategyDemand,
  streamVolumeProducts,
  warmVolumeRequests,
  withMotionLookahead,
} from '../star-octree-strategies.js';

test('strategy factories create first-class provider strategies', () => {
  assert.deepEqual(createObserverShellStrategy(), { kind: 'observer-shell' });
  assert.deepEqual(createTargetFrustumStrategy({ verticalFovDeg: 50 }), {
    kind: 'target-frustum',
    verticalFovDeg: 50,
  });
  assert.deepEqual(createSphereVolumeStrategy({
    centerPc: { x: 1, y: 2, z: 3 },
    radiusPc: 4,
  }), {
    kind: 'sphere-volume',
    centerPc: { x: 1, y: 2, z: 3 },
    radiusPc: 4,
  });
  assert.equal(withMotionLookahead({ kind: 'observer-shell' }).kind, 'motion-lookahead');
  assert.equal(combineStarOctreeStrategies([{ kind: 'observer-shell' }]).kind, 'composite');
});

test('sphere strategy selects nodes whose AABB overlaps the sphere', async () => {
  const strategy = createSphereVolumeStrategy({
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 10,
  });
  const selected = [];
  const plan = await planStarOctreeStrategyDemand({
    indexSource: {},
    context: createSelectionContext(strategy, [
      createNode({ nodeKey: 'inside', centerX: 8, halfSize: 1, level: 2 }),
      createNode({ nodeKey: 'edge', centerX: 11, halfSize: 1, level: 1 }),
      createNode({ nodeKey: 'outside', centerX: 12, halfSize: 1, level: 3 }),
    ], selected),
  });

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
  const plan = await planStarOctreeStrategyDemand({
    indexSource: {},
    context: createSelectionContext(strategy, [
      createNode({ nodeKey: 'path-near', centerX: 5, centerY: 2.5, halfSize: 0.5 }),
      createNode({ nodeKey: 'path-far', centerX: 5, centerY: 4, halfSize: 0.5 }),
    ]),
  });

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

test('composite union dedupes entries and current role wins over prefetch', async () => {
  const nodeA = createNode({ nodeKey: 'node-a', level: 2 });
  const nodeB = createNode({ nodeKey: 'node-b', level: 1 });
  const strategy = combineStarOctreeStrategies([
    createCustomPlanStrategy('current-a', [
      { node: nodeA, role: 'current', priority: 1, reasons: ['current-a'] },
    ]),
    createCustomPlanStrategy('prefetch-a-current-b', [
      { node: nodeA, role: 'prefetch', priority: 100, reasons: ['prefetch-a'] },
      { node: nodeB, role: 'current', priority: 10, reasons: ['current-b'] },
    ]),
  ]);

  const plan = await planStarOctreeStrategyDemand({
    indexSource: {},
    context: createSelectionContext(strategy, []),
  });

  assert.deepEqual(
    plan.entries.map((entry) => [entry.node.nodeKey, entry.role ?? 'current']),
    [['node-b', 'current'], ['node-a', 'current']],
  );
  assert.equal(plan.signature, [nodeA, nodeB].map(createStarCellKey).sort().join('|'));
  assert.deepEqual(plan.entries.find((entry) => entry.node.nodeKey === 'node-a').reasons, [
    'current-a',
    'prefetch-a',
  ]);
  assert.equal(
    plan.entries.find((entry) => entry.node.nodeKey === 'node-a').metadata.strategyContributors.length,
    2,
  );
});

test('motion-lookahead decorator adds future-only prefetch demand', async () => {
  const nodeA = createNode({ nodeKey: 'current-node' });
  const nodeB = createNode({ nodeKey: 'future-node' });
  const baseStrategy = {
    kind: 'custom',
    selectDemand(context) {
      const node = context.view.observerPc?.x >= 50 ? nodeB : nodeA;
      return {
        entries: [{
          node,
          role: 'current',
          priority: 1,
          reasons: ['position-custom'],
          metadata: { strategy: 'position-custom' },
        }],
        reasons: ['position-custom'],
      };
    },
  };
  const strategy = withMotionLookahead(baseStrategy);
  const plan = await planStarOctreeStrategyDemand({
    indexSource: {},
    context: {
      ...createSelectionContext(strategy, []),
      view: {
        revision: 1,
        observerPc: { x: 0, y: 0, z: 0 },
        motion: {
          velocityPcPerSec: { x: 100, y: 0, z: 0 },
          lookaheadSecs: 1,
        },
      },
    },
  });

  assert.deepEqual(
    plan.entries.map((entry) => [entry.node.nodeKey, entry.role ?? 'current']),
    [['current-node', 'current'], ['future-node', 'prefetch']],
  );
  assert.equal(plan.signature, createStarCellKey(nodeA));
  assert.equal(plan.metadata.motionLookahead.enabled, true);
  assert.equal(plan.metadata.motionLookahead.prefetchNodeCount, 1);
});

test('streamVolumeProducts passes a built-in volume strategy to the provider', async () => {
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

  assert.equal(receivedStrategy.kind, 'sphere-volume');
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

function createCustomPlanStrategy(reason, entries) {
  return {
    kind: 'custom',
    selectDemand() {
      return {
        entries,
        reasons: [reason],
      };
    },
  };
}

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

function createSelectionContext(strategy, nodes, visits = []) {
  return {
    providerId: 'provider-a',
    strategy,
    view: { revision: 1 },
    viewRevision: 1,
    demandRevision: 0,
    attributes: ['position'],
    coordinates: { units: ['pc', 'pc', 'pc'] },
    streaming: { coarseFirst: true },
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
            bootstrap: { header: { magLimit: 6.5 } },
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
              role: decision.role,
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
  const nodeKey = overrides.nodeKey ?? 'node';
  const level = overrides.level ?? 1;
  const maxMortonCode = 2 ** (level * 3) - 1;
  const mortonCode = String(Math.min(
    Number(overrides.mortonCode ?? TEST_MORTON_CODES[nodeKey] ?? 0),
    maxMortonCode,
  ));

  return {
    nodeKey,
    centerX: overrides.centerX ?? 0,
    centerY: overrides.centerY ?? 0,
    centerZ: overrides.centerZ ?? 0,
    halfSize: overrides.halfSize ?? 1,
    level,
    mortonCode,
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

const TEST_MORTON_CODES = {
  inside: 1,
  edge: 2,
  outside: 3,
  'path-near': 1,
  'path-far': 2,
  'node-a': 1,
  'node-b': 2,
  'current-node': 1,
  'future-node': 2,
};
