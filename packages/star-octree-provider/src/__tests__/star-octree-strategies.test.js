import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTravelVolumeRequests,
  combineStrategies,
  createLookaheadStrategy,
  createObserverShellStrategy,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createTargetFrustumStrategy,
  distancePointToPathPc,
  createStarCellKey,
} from '@found-in-space/star-trees';
import {
  planStarOctreeStrategyDemand,
  streamVolumeCells,
  warmVolumeRequests,
} from '../star-octree-strategies.js';

test('star-tree strategy factories create first-class behavior values', () => {
  const strategies = [
    createObserverShellStrategy(),
    createTargetFrustumStrategy({ verticalFovDeg: 50 }),
    createSphereVolumeStrategy({ centerPc: { x: 1, y: 2, z: 3 }, radiusPc: 4 }),
    createPathVolumeStrategy({
      pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      radiusPc: 1,
    }),
    createLookaheadStrategy({
      base: createObserverShellStrategy(),
      horizonSecs: 1,
      tickSecs: 1,
    }),
    combineStrategies([createObserverShellStrategy()]),
  ];

  for (const strategy of strategies) {
    assert.equal(typeof strategy.createAnchor, 'function');
    assert.equal(typeof strategy.createEvaluator, 'function');
    assert.equal(typeof strategy.diff, 'function');
    for (const key of ['kind', 'id', 'name', 'label', 'debugLabel']) {
      assert.equal(Object.hasOwn(strategy, key), false, key);
    }
  }
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

  assert.deepEqual(plan.entries.map((entry) => entry.node.nodeKey), ['inside', 'edge']);
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

test('custom strategy streams cells without registration', async () => {
  const strategy = {
    createAnchor(view = {}) {
      return { view };
    },
    createEvaluator() {
      return {
        evaluateCell(cell) {
          const include = cell.nodeKey === 'custom';
          return {
            include,
            descend: include,
            emit: include,
            priority: { lane: 'live', band: 0, score: 10 },
            reasons: ['custom-test'],
          };
        },
      };
    },
    diff(previous, _next, context = {}) {
      return previous
        ? { kind: 'none', reasons: ['custom-unchanged'] }
        : { kind: 'reset', reason: context.reason ?? 'initial' };
    },
  };

  const plan = await planStarOctreeStrategyDemand({
    indexSource: {},
    context: createSelectionContext(strategy, [
      createNode({ nodeKey: 'ignored', mortonCode: 1 }),
      createNode({ nodeKey: 'custom', mortonCode: 2 }),
    ]),
  });

  assert.deepEqual(plan.entries.map((entry) => entry.node.nodeKey), ['custom']);
  assert.equal(plan.entries[0].reasons.includes('custom-test'), true);
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

test('combined strategies merge contributors and choose best priority', async () => {
  const nodeA = createNode({ nodeKey: 'node-a', centerX: 0, halfSize: 1, level: 2 });
  const nodeB = createNode({ nodeKey: 'node-b', centerX: 10, halfSize: 1, level: 1 });
  const nodeC = createNode({ nodeKey: 'node-c', centerX: 50, halfSize: 1, level: 3 });
  const strategy = combineStrategies([
    createSphereVolumeStrategy({ centerPc: { x: 0, y: 0, z: 0 }, radiusPc: 2 }),
    createPathVolumeStrategy({
      pointsPc: [{ x: 10, y: -1, z: 0 }, { x: 10, y: 1, z: 0 }],
      radiusPc: 2,
    }),
  ]);

  const plan = await planStarOctreeStrategyDemand({
    indexSource: {},
    context: createSelectionContext(strategy, [nodeA, nodeB, nodeC]),
  });

  assert.deepEqual(
    plan.entries.map((entry) => [entry.node.nodeKey, entry.role ?? 'current']),
    [['node-b', 'current'], ['node-a', 'current']],
  );
  assert.equal(plan.signature, [nodeA, nodeB].map(createStarCellKey).sort().join('|'));
  assert.equal(plan.entries[0].metadata.strategyContributors.length, 2);
  assert.equal(plan.entries[0].metadata.semanticPriority.lane, 'live');
});

test('warm lookahead demand never replaces live demand', async () => {
  const nodeA = createNode({ nodeKey: 'current-node', centerX: 0, halfSize: 10 });
  const nodeB = createNode({ nodeKey: 'future-node', centerX: 100, halfSize: 10 });
  const baseStrategy = createObserverShellStrategy();
  const strategy = combineStrategies([
    baseStrategy,
    createLookaheadStrategy({
      base: createObserverShellStrategy(),
      horizonSecs: 1,
      tickSecs: 1,
    }),
  ]);
  const plan = await planStarOctreeStrategyDemand({
    indexSource: {},
    context: {
      ...createSelectionContext(strategy, [nodeA, nodeB]),
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
  assert.equal(plan.entries[0].metadata.semanticPriority.lane, 'live');
  assert.equal(plan.entries[1].metadata.semanticPriority.lane, 'warm');
});

test('streamVolumeCells passes a built-in volume strategy to the provider', async () => {
  let receivedStrategy = null;
  const provider = {
    streamCells(options) {
      receivedStrategy = options.strategy;
      return [createCurrentDelta()];
    },
  };

  const deltas = [];
  for await (const delta of streamVolumeCells(provider, {
    type: 'sphere',
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 1,
  })) {
    deltas.push(delta);
  }

  assert.equal(typeof receivedStrategy.createEvaluator, 'function');
  assert.equal(Object.hasOwn(receivedStrategy, 'kind'), false);
  assert.equal(deltas[0].type, 'stars/current');
});

test('warmVolumeRequests consumes streams and reports progress with cells', async () => {
  const progress = [];
  const provider = {
    streamCells() {
      return [
        {
          type: 'stars/cells-upsert',
          providerId: 'provider-a',
          cells: [{ count: 2, cellKey: '0:0' }],
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
    cellCount: 1,
    starCount: 2,
    currentCount: 1,
  });
  assert.deepEqual(progress, ['stars/cells-upsert', 'stars/current']);
});

function createCurrentDelta() {
  return {
    type: 'stars/current',
    providerId: 'provider-a',
    cellKeys: [],
    starCount: 0,
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
            queuedDistancePc: options.distanceToNode?.(node) ?? 0,
          });
          visits.push({
            nodeKey: node.nodeKey,
            include: decision.include === true,
            descend: decision.descend !== false && decision.include === true,
          });
          if (decision.include) {
            selectedNodeCount += 1;
            if (decision.emit !== false) {
              entries.push({
                node,
                priority: decision.priority,
                relevance: decision.relevance,
                role: decision.role,
                reasons: decision.reasons,
                metadata: decision.metadata,
              });
            }
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
