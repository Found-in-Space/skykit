import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarCellKey } from '@found-in-space/star-products';
import {
  combineStarOctreeStrategies,
  createSphereVolumeStrategy,
  withMotionLookahead,
} from '../index.js';
import { createStarOctreeProviderServiceForTest } from '../star-octree-provider-service.js';

test('updateView accepts view state synchronously and can suppress demand', async () => {
  let planCalls = 0;
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([]);
      },
    },
  );
  const session = provider.createSession({ id: 'session-a' });

  const receipt = session.updateView(
    {
      observerPc: { x: 1, y: 2, z: 3 },
      mDesired: 6.5,
    },
    { demand: 'suppress' },
  );

  assert.equal(receipt.demand, 'suppressed');
  assert.equal(receipt.viewRevision, 1);
  assert.equal(receipt.demandRevision, 0);
  assert.equal(session.getSnapshot().view.limitingMagnitude, 6.5);

  await tick();
  assert.equal(planCalls, 0);
});

test('session deltas and subscribers receive initial upserts and current status', async () => {
  const nodeA = createNode('node-a', { centerX: 1 });
  const nodeB = createNode('node-b', { centerX: 2 });
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    { planDemand: () => createPlan([nodeA, nodeB]) },
  );
  const session = provider.createSession({ id: 'session-a' });
  const iterator = session.deltas()[Symbol.asyncIterator]();
  const subscribed = [];
  const unsubscribe = session.subscribe((delta) => {
    subscribed.push(delta);
  });

  const receipt = session.updateView({
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  });
  assert.equal(receipt.demand, 'queued');
  assert.equal(receipt.viewRevision, 1);
  assert.equal(receipt.demandRevision, 0);

  const deltas = await readUntilCurrent(iterator);
  assert.equal(deltas.filter((delta) => delta.type === 'data/product-upsert').length, 2);
  assert.equal(deltas.at(-1).type, 'data/representation-current');
  assert.equal(subscribed.length, deltas.length);
  assert.deepEqual(
    deltas
      .filter((delta) => delta.type === 'data/product-upsert')
      .map((delta) => createStarCellKey(delta.product.nodes[0])),
    [createStarCellKey(nodeA), createStarCellKey(nodeB)],
  );

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.demand.revision, 1);
  assert.equal(snapshot.demand.status, 'current');
  assert.equal(snapshot.demand.currentProductCount, 2);
  assert.equal(snapshot.memory.liveBytes > 0, true);

  const pending = iterator.next();
  unsubscribe();
  session.dispose();
  assert.deepEqual(await pending, { value: undefined, done: true });
});

test('unchanged demand emits no duplicate upserts', async () => {
  const nodeA = createNode('node-a');
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    { planDemand: () => createPlan([nodeA]) },
  );
  const session = provider.createSession({ id: 'session-a' });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
  await readUntilCurrent(iterator);

  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } });
  const deltas = await readUntilCurrent(iterator);

  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].type, 'data/representation-current');
  assert.equal(session.getSnapshot().demand.revision, 1);
});

test('observer-shell demand thresholds gate tiny observer and magnitude changes', async () => {
  const nodeA = createNode('node-a');
  let planCalls = 0;
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-gate-observer', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([nodeA]);
      },
    },
  );
  const session = provider.createSession({
    id: 'session-gate-observer',
    demandThresholds: {
      observerMoveThresholdPc: 10,
      limitingMagnitudeDelta: 0.5,
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();
  const emitted = [];
  const unsubscribe = session.subscribe((delta) => emitted.push(delta));

  const initial = session.updateView({
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  });
  assert.equal(initial.demand, 'queued');
  await readUntilCurrent(iterator);
  assert.equal(planCalls, 1);
  assert.equal(session.getSnapshot().demand.revision, 1);
  emitted.length = 0;

  const tinyMove = session.updateView({
    observerPc: { x: 5, y: 0, z: 0 },
    limitingMagnitude: 6.7,
  });
  assert.equal(tinyMove.demand, 'unchanged');
  assert.equal(tinyMove.viewRevision, 2);
  assert.equal(tinyMove.demandRevision, 1);
  await tick();
  assert.equal(planCalls, 1);
  assert.equal(emitted.length, 0);
  assert.equal(session.getSnapshot().view.observerPc.x, 5);

  const cumulativeMove = session.updateView({
    observerPc: { x: 11, y: 0, z: 0 },
  });
  assert.equal(cumulativeMove.demand, 'queued');
  assert.deepEqual(cumulativeMove.reasons, ['observer-move-threshold']);
  await readUntilCurrent(iterator);
  assert.equal(planCalls, 2);

  const magnitudeChange = session.updateView({
    limitingMagnitude: 7.3,
  });
  assert.equal(magnitudeChange.demand, 'queued');
  assert.deepEqual(magnitudeChange.reasons, ['limiting-magnitude']);
  await readUntilCurrent(iterator);
  assert.equal(planCalls, 3);

  const motionOnly = session.updateView({
    motion: {
      velocityPcPerSec: { x: 100, y: 0, z: 0 },
      lookaheadSecs: 1,
    },
  });
  assert.equal(motionOnly.demand, 'unchanged');
  await tick();
  assert.equal(planCalls, 3);

  const forced = session.updateView(
    {
      observerPc: { x: 11.1, y: 0, z: 0 },
    },
    { demand: 'force', reason: 'manual' },
  );
  assert.equal(forced.demand, 'forced');
  assert.deepEqual(forced.reasons, ['manual']);
  await readUntilCurrent(iterator);
  assert.equal(planCalls, 4);

  const suppressed = session.updateView(
    {
      observerPc: { x: 200, y: 0, z: 0 },
    },
    { demand: 'suppress' },
  );
  assert.equal(suppressed.demand, 'suppressed');
  await tick();
  assert.equal(planCalls, 4);

  unsubscribe();
});

test('target-frustum demand thresholds gate direction and orientation changes', async () => {
  let planCalls = 0;
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-gate-frustum', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([]);
      },
    },
  );
  const session = provider.createSession({
    id: 'session-gate-frustum',
    strategy: { kind: 'target-frustum' },
    demandThresholds: {
      observerMoveThresholdPc: 10,
      limitingMagnitudeDelta: 0.5,
      directionAngleDeg: 5,
    },
  });

  const initial = session.updateView({
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
    directionIcrs: { x: 0, y: 0, z: -1 },
    verticalFovDeg: 40,
    aspectRatio: 1,
  });
  assert.equal(initial.demand, 'queued');
  await tick();
  assert.equal(planCalls, 1);

  const tinyDirection = session.updateView({
    directionIcrs: { x: 0.01, y: 0, z: -1 },
  });
  assert.equal(tinyDirection.demand, 'unchanged');
  await tick();
  assert.equal(planCalls, 1);

  const largeDirection = session.updateView({
    directionIcrs: { x: 0.2, y: 0, z: -1 },
  });
  assert.equal(largeDirection.demand, 'queued');
  assert.deepEqual(largeDirection.reasons, ['view-volume']);
  await tick();
  assert.equal(planCalls, 2);

  const fovChange = session.updateView({ verticalFovDeg: 45 });
  assert.equal(fovChange.demand, 'queued');
  await tick();
  assert.equal(planCalls, 3);

  const targetChange = session.updateView({
    targetPc: { x: 10, y: 0, z: -100 },
  });
  assert.equal(targetChange.demand, 'queued');
  await tick();
  assert.equal(planCalls, 4);

  const orientationSession = provider.createSession({
    id: 'session-gate-orientation',
    strategy: { kind: 'target-frustum' },
    demandThresholds: {
      directionAngleDeg: 5,
    },
  });

  orientationSession.updateView({
    orientationIcrs: yawQuaternion(0),
    verticalFovDeg: 40,
    aspectRatio: 1,
  });
  await tick();
  assert.equal(planCalls, 5);

  const tinyOrientation = orientationSession.updateView({
    orientationIcrs: yawQuaternion(1),
  });
  assert.equal(tinyOrientation.demand, 'unchanged');
  await tick();
  assert.equal(planCalls, 5);

  const largeOrientation = orientationSession.updateView({
    orientationIcrs: yawQuaternion(10),
  });
  assert.equal(largeOrientation.demand, 'queued');
  await tick();
  assert.equal(planCalls, 6);
});

test('custom strategies may own demand gating policy', async () => {
  const nodeA = createNode('node-a');
  let planCalls = 0;
  let shouldReplan = true;
  const gateContexts = [];
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-gate-custom', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([nodeA]);
      },
    },
  );
  const session = provider.createSession({
    id: 'session-gate-custom',
    strategy: {
      kind: 'custom',
      selectDemand: () => createPlan([nodeA]),
      shouldReplan(context) {
        gateContexts.push(context);
        return shouldReplan
          ? { replan: true, reasons: ['custom-go'] }
          : { replan: false, reasons: ['custom-stay'] };
      },
    },
    demandThresholds: {
      observerMoveThresholdPc: 10,
    },
  });

  const initial = session.updateView({
    observerPc: { x: 0, y: 0, z: 0 },
  });
  assert.equal(initial.demand, 'queued');
  assert.deepEqual(initial.reasons, ['custom-go']);
  await tick();
  assert.equal(planCalls, 1);
  assert.equal(gateContexts[0].previousDemandView, null);

  shouldReplan = false;
  const unchanged = session.updateView({
    observerPc: { x: 1000, y: 0, z: 0 },
  });
  assert.equal(unchanged.demand, 'unchanged');
  assert.deepEqual(unchanged.reasons, ['custom-stay']);
  await tick();
  assert.equal(planCalls, 1);
  assert.equal(gateContexts[1].previousDemandView.revision, 1);
  assert.equal(gateContexts[1].nextView.revision, 2);
  assert.equal(gateContexts[1].thresholds.observerMoveThresholdPc, 10);
  assert.equal(session.getSnapshot().view.observerPc.x, 1000);
});

test('custom strategies without shouldReplan keep always-plan behavior', async () => {
  let planCalls = 0;
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-gate-custom-default', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([]);
      },
    },
  );
  const session = provider.createSession({
    id: 'session-gate-custom-default',
    strategy: {
      kind: 'custom',
      selectDemand: () => createPlan([]),
    },
    demandThresholds: {
      observerMoveThresholdPc: 10,
    },
  });

  assert.equal(session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }).demand, 'queued');
  assert.equal(session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }).demand, 'queued');
  await waitFor(() => planCalls === 2);
});

test('volume strategies ignore unrelated view changes after initial demand', async () => {
  let planCalls = 0;
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-gate-volume', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([]);
      },
    },
  );
  const session = provider.createSession({
    id: 'session-gate-volume',
    strategy: createSphereVolumeStrategy({
      centerPc: { x: 0, y: 0, z: 0 },
      radiusPc: 10,
    }),
    demandThresholds: {
      observerMoveThresholdPc: 10,
    },
  });

  assert.equal(session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }).demand, 'queued');
  await tick();
  assert.equal(planCalls, 1);

  const unchanged = session.updateView({
    observerPc: { x: 1000, y: 0, z: 0 },
    limitingMagnitude: 12,
  });
  assert.equal(unchanged.demand, 'unchanged');
  await tick();
  assert.equal(planCalls, 1);
});

test('motion-lookahead gating can queue prefetch-only demand changes', async () => {
  let planCalls = 0;
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-gate-motion-lookahead', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([]);
      },
    },
  );
  const session = provider.createSession({
    id: 'session-gate-motion-lookahead',
    strategy: withMotionLookahead({ kind: 'observer-shell' }),
    demandThresholds: {
      observerMoveThresholdPc: 10,
      limitingMagnitudeDelta: 0.5,
    },
  });

  assert.equal(session.updateView({
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  }).demand, 'queued');
  await tick();
  assert.equal(planCalls, 1);

  const motionChanged = session.updateView({
    motion: {
      velocityPcPerSec: { x: 100, y: 0, z: 0 },
      lookaheadSecs: 1,
    },
  });
  assert.equal(motionChanged.demand, 'queued');
  assert.equal(motionChanged.reasons.includes('motion-lookahead'), true);
  await tick();
  assert.equal(planCalls, 2);

  const speedOnly = session.updateView({
    motion: {
      speedPcPerSec: 100,
      lookaheadSecs: 1,
    },
  });
  assert.equal(speedOnly.demand, 'queued');
  await tick();
  assert.equal(planCalls, 3);

  const unchanged = session.updateView({
    observerPc: { x: 1, y: 0, z: 0 },
  });
  assert.equal(unchanged.demand, 'unchanged');
  await tick();
  assert.equal(planCalls, 3);
});

test('composite gates queue when any child strategy queues', async () => {
  let planCalls = 0;
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-gate-composite', url: '/data/stars.octree' },
    {
      planDemand() {
        planCalls += 1;
        return createPlan([]);
      },
    },
  );
  const session = provider.createSession({
    id: 'session-gate-composite',
    strategy: combineStarOctreeStrategies([
      { kind: 'observer-shell' },
      createSphereVolumeStrategy({
        centerPc: { x: 0, y: 0, z: 0 },
        radiusPc: 10,
      }),
    ]),
    demandThresholds: {
      observerMoveThresholdPc: 10,
    },
  });

  assert.equal(session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }).demand, 'queued');
  await tick();
  assert.equal(planCalls, 1);

  assert.equal(session.updateView({ observerPc: { x: 5, y: 0, z: 0 } }).demand, 'unchanged');
  await tick();
  assert.equal(planCalls, 1);

  assert.equal(session.updateView({ observerPc: { x: 11, y: 0, z: 0 } }).demand, 'queued');
  await tick();
  assert.equal(planCalls, 2);
});

test('session demand ordering defaults coarse-first and can be disabled', async () => {
  const coarseNode = createNode('coarse-node', {
    level: 1,
  });
  const nearDeepNode = createNode('near-deep-node', {
    level: 3,
  });

  const coarseProvider = createStarOctreeProviderServiceForTest(
    { id: 'provider-coarse', url: '/data/stars.octree' },
    {
      planDemand: () => ({
        entries: [
          {
            node: nearDeepNode,
            priority: 100,
            role: 'current',
            metadata: { distancePc: 1 },
          },
          {
            node: coarseNode,
            priority: 1,
            role: 'current',
            metadata: { distancePc: 100 },
          },
        ],
        signature: 'coarse-order',
      }),
    },
  );
  const coarseSession = coarseProvider.createSession({ id: 'session-coarse' });
  const coarseIterator = coarseSession.deltas()[Symbol.asyncIterator]();
  coarseSession.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
  const coarseDeltas = await readUntilCurrent(coarseIterator);

  assert.deepEqual(
    coarseDeltas
      .filter((delta) => delta.type === 'data/product-upsert')
      .map((delta) => createStarCellKey(delta.product.nodes[0])),
    [createStarCellKey(coarseNode), createStarCellKey(nearDeepNode)],
  );

  const priorityProvider = createStarOctreeProviderServiceForTest(
    { id: 'provider-priority', url: '/data/stars.octree' },
    {
      planDemand: () => ({
        entries: [
          {
            node: nearDeepNode,
            priority: 100,
            role: 'current',
            metadata: { distancePc: 1 },
          },
          {
            node: coarseNode,
            priority: 1,
            role: 'current',
            metadata: { distancePc: 100 },
          },
        ],
        signature: 'priority-order',
      }),
    },
  );
  const prioritySession = priorityProvider.createSession({
    id: 'session-priority',
    streaming: { coarseFirst: false },
  });
  const priorityIterator = prioritySession.deltas()[Symbol.asyncIterator]();
  prioritySession.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
  const priorityDeltas = await readUntilCurrent(priorityIterator);

  assert.deepEqual(
    priorityDeltas
      .filter((delta) => delta.type === 'data/product-upsert')
      .map((delta) => createStarCellKey(delta.product.nodes[0])),
    [createStarCellKey(nearDeepNode), createStarCellKey(coarseNode)],
  );
});

test('session coarse-first ordering honors motion priority within the same level', async () => {
  const trailingNode = createNode('trailing-node', {
    level: 2,
  });
  const leadingNode = createNode('leading-node', {
    level: 2,
  });
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-motion-order', url: '/data/stars.octree' },
    {
      planDemand: () => ({
        entries: [
          {
            node: trailingNode,
            priority: 100,
            role: 'current',
            metadata: {
              distancePc: 1,
              motionPriorityBias: -100,
            },
          },
          {
            node: leadingNode,
            priority: 1,
            role: 'current',
            metadata: {
              distancePc: 100,
              motionPriorityBias: 0,
            },
          },
        ],
        signature: 'motion-order',
      }),
    },
  );
  const session = provider.createSession({ id: 'session-motion-order' });
  const iterator = session.deltas()[Symbol.asyncIterator]();
  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
  const deltas = await readUntilCurrent(iterator);

  assert.deepEqual(
    deltas
      .filter((delta) => delta.type === 'data/product-upsert')
      .map((delta) => createStarCellKey(delta.product.nodes[0])),
    [createStarCellKey(leadingNode), createStarCellKey(trailingNode)],
  );
  const current = deltas.at(-1);
  assert.equal(current.type, 'data/representation-current');
  assert.equal(current.completeness.phase, 'complete');
});

test('changed demand retains shared nodes and stale-removes excluded products', async () => {
  const nodeA = createNode('node-a');
  const nodeB = createNode('node-b');
  const nodeC = createNode('node-c');
  let demandedNodes = [nodeA, nodeB];
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    { planDemand: () => createPlan(demandedNodes) },
  );
  const session = provider.createSession({ id: 'session-a' });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
  const initial = await readUntilCurrent(iterator);
  const productA = initial.find(
    (delta) =>
      delta.type === 'data/product-upsert' &&
      createStarCellKey(delta.product.nodes[0]) === createStarCellKey(nodeA),
  ).product;
  const productB = initial.find(
    (delta) =>
      delta.type === 'data/product-upsert' &&
      createStarCellKey(delta.product.nodes[0]) === createStarCellKey(nodeB),
  ).product;

  demandedNodes = [nodeB, nodeC];
  session.updateView({ observerPc: { x: 2, y: 0, z: 0 } });
  const changed = await readUntilCurrent(iterator);

  assert.equal(session.getSnapshot().demand.revision, 2);
  assert.deepEqual(
    changed.map((delta) => delta.type),
    [
      'data/product-upsert',
      'data/product-stale',
      'data/product-remove',
      'data/representation-current',
    ],
  );
  assert.deepEqual(
    changed
      .filter((delta) => delta.type === 'data/product-upsert')
      .map((delta) => createStarCellKey(delta.product.nodes[0])),
    [createStarCellKey(nodeC)],
  );
  assert.deepEqual(
    changed
      .filter((delta) => delta.type === 'data/product-stale')
      .map((delta) => delta.productId),
    [productA.id],
  );
  assert.deepEqual(
    changed
      .filter((delta) => delta.type === 'data/product-remove')
      .map((delta) => delta.productId),
    [productA.id],
  );
  assert.deepEqual(
    session.getSnapshot().products.map((product) => product.productId),
    [productB.id, 'session-a:live:product:3'],
  );
});

test('outdated async planning results do not overwrite newer demand', async () => {
  const nodeA = createNode('node-a');
  const nodeB = createNode('node-b');
  const resolvers = [];
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    {
      planDemand(context) {
        return new Promise((resolve) => {
          resolvers.push({ context, resolve });
        });
      },
    },
  );
  const session = provider.createSession({ id: 'session-a' });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } });
  session.updateView({ observerPc: { x: 2, y: 0, z: 0 } });
  await waitFor(() => resolvers.length === 2);

  resolvers[1].resolve(createPlan([nodeB]));
  const deltas = await readUntilCurrent(iterator);
  assert.equal(deltas.at(-1).viewRevision, 2);
  assert.deepEqual(
    deltas
      .filter((delta) => delta.type === 'data/product-upsert')
      .map((delta) => createStarCellKey(delta.product.nodes[0])),
    [createStarCellKey(nodeB)],
  );

  resolvers[0].resolve(createPlan([nodeA]));
  await tick();

  assert.equal(session.getSnapshot().demand.revision, 1);
  assert.deepEqual(
    session.getSnapshot().products.map((product) => product.productId),
    ['session-a:live:product:1'],
  );
});

function createPlan(nodes) {
  return {
    entries: nodes.map((node, index) => ({
      node,
      priority: 100 - index,
      role: 'current',
    })),
    signature: nodes.map(createStarCellKey).join('|'),
  };
}

function createNode(nodeKey, overrides = {}) {
  const level = overrides.level ?? 1;
  const maxMortonCode = 2 ** (level * 3) - 1;
  const mortonCode = String(Math.min(
    Number(overrides.mortonCode ?? TEST_MORTON_CODES[nodeKey] ?? 0),
    maxMortonCode,
  ));

  return {
    nodeKey,
    centerX: 1,
    centerY: 2,
    centerZ: 3,
    halfSize: 0.5,
    level,
    mortonCode,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    flags: 0,
    childMask: 0,
    payloadOffset: 0,
    payloadLength: 1,
    firstChild: -1,
    localDepth: 0,
    localPath: 0,
    shardOffset: 0,
    nodeIndex: 0,
    ...overrides,
  };
}

const TEST_MORTON_CODES = {
  'node-a': 1,
  'node-b': 2,
  'node-c': 3,
  'coarse-node': 1,
  'near-deep-node': 2,
  'trailing-node': 1,
  'leading-node': 2,
};

function yawQuaternion(degrees) {
  const radians = degrees * Math.PI / 180;
  return {
    x: 0,
    y: Math.sin(radians / 2),
    z: 0,
    w: Math.cos(radians / 2),
  };
}

async function readUntilCurrent(iterator) {
  const deltas = [];

  for (;;) {
    const result = await nextResult(iterator);
    assert.equal(result.done, false);
    deltas.push(result.value);

    if (result.value.type === 'data/representation-current') {
      return deltas;
    }
  }
}

function nextResult(iterator) {
  let timeoutId;
  return Promise.race([
    iterator.next(),
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Timed out waiting for session delta.')),
        250,
      );
    }),
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function waitFor(predicate) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 250) {
      throw new Error('Timed out waiting for condition.');
    }

    await tick();
  }
}

function tick() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
