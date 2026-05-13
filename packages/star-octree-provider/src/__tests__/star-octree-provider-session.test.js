import assert from 'node:assert/strict';
import test from 'node:test';

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
      .map((delta) => delta.product.nodes[0].nodeKey),
    ['node-a', 'node-b'],
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
      .map((delta) => delta.product.nodes[0].nodeKey),
    ['coarse-node', 'near-deep-node'],
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
      .map((delta) => delta.product.nodes[0].nodeKey),
    ['near-deep-node', 'coarse-node'],
  );
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
      delta.product.nodes[0].nodeKey === 'node-a',
  ).product;
  const productB = initial.find(
    (delta) =>
      delta.type === 'data/product-upsert' &&
      delta.product.nodes[0].nodeKey === 'node-b',
  ).product;

  demandedNodes = [nodeB, nodeC];
  session.updateView({ observerPc: { x: 2, y: 0, z: 0 } });
  const changed = await readUntilCurrent(iterator);

  assert.equal(session.getSnapshot().demand.revision, 2);
  assert.deepEqual(
    changed
      .filter((delta) => delta.type === 'data/product-upsert')
      .map((delta) => delta.product.nodes[0].nodeKey),
    ['node-c'],
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
      .map((delta) => delta.product.nodes[0].nodeKey),
    ['node-b'],
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
    signature: nodes.map((node) => node.nodeKey).join('|'),
  };
}

function createNode(nodeKey, overrides = {}) {
  return {
    nodeKey,
    centerX: 1,
    centerY: 2,
    centerZ: 3,
    halfSize: 0.5,
    level: 1,
    gridX: 1,
    gridY: 2,
    gridZ: 3,
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
