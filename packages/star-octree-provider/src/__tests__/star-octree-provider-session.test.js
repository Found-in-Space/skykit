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

test('superseded demand aborts outstanding stream work before it can emit', async () => {
  const nodeA = createNode('a', { gridX: 0 });
  const nodeB = createNode('b', { gridX: 1 });
  const plans = [
    createPlan([nodeA]),
    createPlan([nodeB]),
  ];
  let releaseFirstStream = () => {};
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
  assert.equal(observedAbort, true);
  assert.deepEqual(upsertCellKeys(deltas), [createStarCellKey(nodeB)]);
  assert.equal(deltas.some((delta) =>
    delta.type === 'stars/cells-upsert' &&
    delta.cells.some((cell) => cell.cellKey === createStarCellKey(nodeA))
  ), false);
});

test('load errors report stars/error without deleting existing visible cells', async () => {
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

function upsertCellKeys(deltas) {
  return deltas
    .filter((delta) => delta.type === 'stars/cells-upsert')
    .flatMap((delta) => delta.cells.map((cell) => cell.cellKey));
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
