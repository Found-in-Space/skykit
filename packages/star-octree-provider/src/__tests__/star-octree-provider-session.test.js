import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStarCellData,
  createStarCellKey,
  encodeMorton3D,
} from '@found-in-space/star-trees';
import { createStarOctreeProviderServiceForTest } from '../star-octree-provider-service.js';
import { createStarOctreeProviderSession } from '../star-octree-provider-session.js';

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

test('session replacement retains B, loads only C, then removes A', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const nodeB = createNode('b', { gridX: 1 });
  const nodeC = createNode('c', { gridX: 2 });
  const loadedCellKeys = [];
  const plans = [
    createPlan([nodeA, nodeB]),
    createPlan([nodeB, nodeC]),
  ];
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    {
      planDemand() {
        return plans.shift() ?? createPlan([nodeB, nodeC]);
      },
      decodeNode(entry) {
        loadedCellKeys.push(createStarCellKey(entry.node));
        return oneStar(entry.node);
      },
    },
  );
  const session = provider.createSession({ id: 'session-a' });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  const initial = await readUntilCurrent(iterator);
  assert.deepEqual(
    upsertCellKeys(initial),
    [createStarCellKey(nodeA), createStarCellKey(nodeB)],
  );

  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  const changed = await readUntilCurrent(iterator);

  assert.deepEqual(upsertCellKeys(changed), [createStarCellKey(nodeC)]);
  assert.deepEqual(
    changed
      .filter((delta) => delta.type === 'stars/cells-remove')
      .flatMap((delta) => delta.cellKeys),
    [createStarCellKey(nodeA)],
  );
  assert.deepEqual(loadedCellKeys, [
    createStarCellKey(nodeA),
    createStarCellKey(nodeB),
    createStarCellKey(nodeC),
  ]);
  assert.deepEqual(
    session.getSnapshot().cells.map((cell) => cell.cellKey),
    [createStarCellKey(nodeB), createStarCellKey(nodeC)],
  );
});

test('superseded demand keeps overlapping in-flight stream work', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const nodeB = createNode('b', { gridX: 1 });
  const plans = [
    createPlan([nodeA]),
    createPlan([nodeA, nodeB]),
  ];
  let releaseFirstStream = () => {};
  let observedAbort = false;
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return plans.shift() ?? createPlan([nodeA, nodeB]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      async *streamCells(entries, options) {
        const key = createStarCellKey(entries[0].node);
        if (key === createStarCellKey(nodeA)) {
          await new Promise((resolve) => {
            releaseFirstStream = resolve;
          });
          if (options.signal?.aborted) {
            observedAbort = true;
            return;
          }
        }

        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  releaseFirstStream();

  const deltas = await readUntilCurrent(iterator);
  assert.equal(observedAbort, false);
  assert.deepEqual(sortKeys(upsertCellKeys(deltas)), [
    createStarCellKey(nodeA),
    createStarCellKey(nodeB),
  ].sort());
});

test('moving views coalesce planning without aborting the active traversal', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  let releaseFirstPlan = () => {};
  let firstPlanSignal = null;
  let planCalls = 0;
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      async planDemand(context) {
        planCalls += 1;
        if (planCalls === 1) {
          firstPlanSignal = context.signal;
          await new Promise((resolve) => {
            releaseFirstPlan = resolve;
          });
        }
        return createPlan([nodeA]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  await tick();

  assert.equal(firstPlanSignal.aborted, false);
  releaseFirstPlan();
  const deltas = await readUntilCurrent(iterator);

  assert.deepEqual(upsertCellKeys(deltas), [createStarCellKey(nodeA)]);
  assert.equal(firstPlanSignal.aborted, false);
  assert.equal(planCalls >= 1, true);
});

test('rapid overlapping demands do not duplicate in-flight loads', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  let releaseStream = () => {};
  let streamCalls = 0;
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return createPlan([nodeA]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      async *streamCells(entries) {
        streamCalls += 1;
        await new Promise((resolve) => {
          releaseStream = resolve;
        });
        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  session.updateView({ observerPc: { x: 2, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  releaseStream();

  const deltas = await readUntilCurrent(iterator);
  assert.equal(streamCalls, 1);
  assert.deepEqual(upsertCellKeys(deltas), [createStarCellKey(nodeA)]);
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 0);
});

test('cached desired cells emit before delayed cold current loads', async () => {
  const cachedNode = createNode('cached', { gridX: 0 });
  const coldNode = createNode('cold', { gridX: 1 });
  let releaseColdStream = () => {};
  let streamCalls = 0;
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return createPlan([cachedNode, coldNode]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      readCachedCells(entries) {
        return entries
          .filter((entry) => createStarCellKey(entry.node) === createStarCellKey(cachedNode))
          .map((entry) => createCell(entry.node));
      },
      async *streamCells(entries) {
        streamCalls += 1;
        assert.deepEqual(entries.map((entry) => createStarCellKey(entry.node)), [
          createStarCellKey(coldNode),
        ]);
        await new Promise((resolve) => {
          releaseColdStream = resolve;
        });
        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  const first = await iterator.next();

  assert.equal(first.done, false);
  assert.equal(first.value.type, 'stars/cells-upsert');
  assert.deepEqual(upsertCellKeys([first.value]), [createStarCellKey(cachedNode)]);
  await tick();
  assert.equal(session.getSnapshot().demand.cachedCurrentCellHitCount, 1);
  assert.equal(session.getSnapshot().demand.coldCurrentCellLoadCount, 1);
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 1);
  assert.equal(streamCalls, 1);

  releaseColdStream();
  const remaining = await readUntilCurrent(iterator);

  assert.deepEqual(upsertCellKeys(remaining), [createStarCellKey(coldNode)]);
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 0);
});

test('cached cells can promote entries that are already in flight', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  let cacheReady = false;
  let releaseColdStream = () => {};
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return createPlan([nodeA]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      readCachedCells(entries) {
        return cacheReady ? entries.map((entry) => createCell(entry.node)) : [];
      },
      async *streamCells(entries) {
        await new Promise((resolve) => {
          releaseColdStream = resolve;
        });
        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 1);

  cacheReady = true;
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  const deltas = await readUntilCurrent(iterator);

  assert.deepEqual(upsertCellKeys(deltas), [createStarCellKey(nodeA)]);
  assert.equal(session.getSnapshot().demand.cachedCurrentCellHitCount, 1);
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 0);

  releaseColdStream();
  await tick();
});

test('incomplete demand polls warm cache while current load remains in flight', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  let cacheReady = false;
  let releaseColdStream = () => {};
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return createPlan([nodeA]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      readCachedCells(entries) {
        return cacheReady ? entries.map((entry) => createCell(entry.node)) : [];
      },
      async *streamCells(entries) {
        await new Promise((resolve) => {
          releaseColdStream = resolve;
        });
        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 1);
  cacheReady = true;

  const deltas = await readUntilCurrent(iterator);

  assert.deepEqual(upsertCellKeys(deltas), [createStarCellKey(nodeA)]);
  assert.equal(session.getSnapshot().demand.cachedCurrentCellHitCount, 1);
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 0);

  releaseColdStream();
  await tick();
});

test('non-overlapping current loads abort when demand moves elsewhere', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const nodeB = createNode('b', { gridX: 1 });
  const plans = [
    createPlan([nodeA]),
    createPlan([nodeB]),
  ];
  let observedAbort = false;
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return plans.shift() ?? createPlan([nodeB]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      async *streamCells(entries, options) {
        const key = createStarCellKey(entries[0].node);
        if (key === createStarCellKey(nodeA)) {
          await new Promise((resolve) => {
            options.signal?.addEventListener('abort', resolve, { once: true });
          });
          observedAbort = options.signal?.aborted === true;
          return;
        }
        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  const deltas = await readUntilCurrent(iterator);

  assert.equal(observedAbort, true);
  assert.deepEqual(upsertCellKeys(deltas), [createStarCellKey(nodeB)]);
  assert.equal(session.getSnapshot().demand.staleCurrentLoadAbortCount, 1);
  assert.equal(session.getSnapshot().demand.inFlightCellCount, 0);
});

test('stale in-flight cells are discarded after demand moves elsewhere', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const nodeB = createNode('b', { gridX: 1 });
  const plans = [
    createPlan([nodeA]),
    createPlan([nodeB]),
  ];
  let releaseStaleStream = () => {};
  const observedDeltas = [];
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return plans.shift() ?? createPlan([nodeB]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      async *streamCells(entries) {
        const key = createStarCellKey(entries[0].node);
        if (key === createStarCellKey(nodeA)) {
          await new Promise((resolve) => {
            releaseStaleStream = resolve;
          });
        }
        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  session.subscribe((delta) => observedDeltas.push(delta));
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  const currentDeltas = await readUntilCurrent(iterator);
  releaseStaleStream();
  await tick();
  await tick();

  assert.deepEqual(upsertCellKeys(currentDeltas), [createStarCellKey(nodeB)]);
  assert.equal(
    observedDeltas.some((delta) =>
      delta.type === 'stars/cells-upsert' &&
      delta.cells.some((cell) => cell.cellKey === createStarCellKey(nodeA))
    ),
    false,
  );
  assert.deepEqual(
    session.getSnapshot().cells.map((cell) => cell.cellKey),
    [createStarCellKey(nodeB)],
  );
  assert.equal(session.getSnapshot().demand.staleCurrentLoadAbortCount, 1);
  assert.equal(session.getSnapshot().demand.staleCurrentCellDropCount, 1);
});

test('stale load failures are ignored without clearing visible cells', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const nodeB = createNode('b', { gridX: 1 });
  const plans = [
    createPlan([nodeA]),
    createPlan([nodeB]),
  ];
  let releaseStaleStream = () => {};
  const observedDeltas = [];
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    source: {
      planDemand() {
        return plans.shift() ?? createPlan([nodeB]);
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      async *streamCells(entries) {
        const key = createStarCellKey(entries[0].node);
        if (key === createStarCellKey(nodeA)) {
          await new Promise((resolve) => {
            releaseStaleStream = resolve;
          });
          throw new Error('stale load failed');
        }
        yield entries.map((entry) => createCell(entry.node));
      },
    },
  });
  session.subscribe((delta) => observedDeltas.push(delta));
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await tick();
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  await readUntilCurrent(iterator);
  releaseStaleStream();
  await tick();
  await tick();

  assert.equal(observedDeltas.some((delta) => delta.type === 'stars/error'), false);
  assert.equal(session.getSnapshot().lastError, null);
  assert.deepEqual(
    session.getSnapshot().cells.map((cell) => cell.cellKey),
    [createStarCellKey(nodeB)],
  );
});

test('still-desired load errors report stars/error without deleting visible cells', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const nodeB = createNode('b', { gridX: 1 });
  const plans = [
    createPlan([nodeA]),
    createPlan([nodeB]),
  ];
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    {
      planDemand() {
        return plans.shift() ?? createPlan([nodeB]);
      },
      decodeNode(entry) {
        if (createStarCellKey(entry.node) === createStarCellKey(nodeB)) {
          throw new Error('decode failed');
        }
        return oneStar(entry.node);
      },
    },
  );
  const session = provider.createSession({ id: 'session-a' });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await readUntilCurrent(iterator);
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } }, { demand: 'force' });
  const error = await readUntilType(iterator, 'stars/error');

  assert.equal(error.error.message, 'decode failed');
  assert.deepEqual(
    session.getSnapshot().cells.map((cell) => cell.cellKey),
    [createStarCellKey(nodeA)],
  );
});

test('unchanged demand emits current without duplicate cell upserts', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const provider = createStarOctreeProviderServiceForTest(
    { id: 'provider-a', url: '/data/stars.octree' },
    { planDemand: () => createPlan([nodeA]) },
  );
  const session = provider.createSession({ id: 'session-a' });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await readUntilCurrent(iterator);
  session.updateView({ observerPc: { x: 1, y: 0, z: 0 } });
  const deltas = await readUntilCurrent(iterator);

  assert.deepEqual(deltas.map((delta) => delta.type), ['stars/current']);
  assert.equal(session.getSnapshot().demand.revision, 1);
});

test('prefetch warming uses the active session attributes', async () => {
  const currentNode = createNode('current', { gridX: 0 });
  const prefetchNode = createNode('prefetch', { gridX: 1 });
  let warmEntries = null;
  let warmOptions = null;
  const session = createStarOctreeProviderSession({
    providerId: 'provider-a',
    sessionId: 'session-a',
    options: { attributes: ['position'] },
    source: {
      planDemand() {
        return {
          entries: [
            { node: currentNode },
            { node: prefetchNode, role: 'prefetch' },
          ],
          signature: [
            createStarCellKey(currentNode),
            `${createStarCellKey(prefetchNode)}:prefetch`,
          ].join('|'),
        };
      },
      decodeNode(entry) {
        return oneStar(entry.node);
      },
      async *streamCells(entries) {
        yield entries.map((entry) => createCell(entry.node));
      },
      async warmEntries(entries, options) {
        warmEntries = entries;
        warmOptions = options;
      },
    },
  });
  const iterator = session.deltas()[Symbol.asyncIterator]();

  session.updateView({ observerPc: { x: 0, y: 0, z: 0 } }, { demand: 'force' });
  await readUntilCurrent(iterator);
  await tick();

  assert.deepEqual(warmEntries.map((entry) => createStarCellKey(entry.node)), [
    createStarCellKey(prefetchNode),
  ]);
  assert.deepEqual(warmOptions.attributes, ['position']);
  assert.equal(warmOptions.sessionId, 'session-a');
});

function upsertCellKeys(deltas) {
  return deltas
    .filter((delta) => delta.type === 'stars/cells-upsert')
    .flatMap((delta) => delta.cells.map((cell) => cell.cellKey));
}

function sortKeys(cellKeys) {
  return [...cellKeys].sort();
}

async function readUntilCurrent(iterator) {
  const deltas = [];
  for (;;) {
    const result = await iterator.next();
    assert.equal(result.done, false);
    deltas.push(result.value);
    if (result.value.type === 'stars/current') {
      return deltas;
    }
  }
}

async function readUntilType(iterator, type) {
  for (;;) {
    const result = await iterator.next();
    assert.equal(result.done, false);
    if (result.value.type === type) {
      return result.value;
    }
  }
}

function createPlan(nodes) {
  return {
    entries: nodes.map((node) => ({ node })),
    signature: nodes.map((node) => createStarCellKey(node)).join('|'),
  };
}

function createCell(node) {
  return createStarCellData({
    node,
    decoded: oneStar(node),
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });
}

function oneStar(node) {
  return {
    count: 1,
    positionsPc: new Float32Array([node.centerX, node.centerY, node.centerZ]),
    teffLog8: new Uint8Array([128]),
    magAbs: new Float32Array([0]),
  };
}

function createNode(label, overrides = {}) {
  const node = {
    mortonCode: '0',
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 0.5,
    level: 2,
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
    ...overrides,
  };
  return {
    ...node,
    nodeKey: label,
    mortonCode: String(encodeMorton3D(node.gridX, node.gridY, node.gridZ, node.level)),
  };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
