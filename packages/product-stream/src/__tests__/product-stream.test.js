import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeProductDeltas,
  createRepresentationStore,
} from '../index.js';

test('createRepresentationStore applies upsert, stale, remove, current, and error deltas', () => {
  const store = createRepresentationStore({
    getProductId: (product) => product.id,
    getProductBytes: (product) => product.bytes,
  });

  store.apply({
    type: 'data/product-upsert',
    product: { id: 'a', bytes: 10 },
  });
  store.apply({
    type: 'data/product-upsert',
    product: { id: 'b', bytes: 20 },
  });

  assert.deepEqual(store.getProducts().map((product) => product.id), ['a', 'b']);
  assert.deepEqual(store.getSnapshot(), {
    status: 'streaming',
    productCount: 2,
    bytes: 30,
    lastError: null,
    lastCurrentRevision: null,
  });

  store.apply({
    type: 'data/product-stale',
    productId: 'a',
    reason: 'test',
  });

  assert.deepEqual(store.getProducts().map((product) => product.id), ['b']);

  store.apply({
    type: 'data/product-remove',
    productId: 'a',
  });
  store.apply({
    type: 'data/representation-current',
    viewRevision: 2,
    demandRevision: 3,
  });

  assert.deepEqual(store.getSnapshot(), {
    status: 'current',
    productCount: 1,
    bytes: 20,
    lastError: null,
    lastCurrentRevision: {
      viewRevision: 2,
      demandRevision: 3,
    },
  });

  store.apply({
    type: 'data/product-error',
    error: {
      message: 'boom',
    },
  });

  assert.equal(store.getSnapshot().status, 'failed');
  assert.equal(store.getSnapshot().lastError, 'boom');
});

test('replacement upsert updates product bytes and product list', () => {
  const store = createRepresentationStore({
    getProductId: (product) => product.id,
    getProductBytes: (product) => product.bytes,
  });

  store.apply({
    type: 'data/product-upsert',
    product: { id: 'a', bytes: 10, value: 'old' },
  });
  store.apply({
    type: 'data/product-upsert',
    product: { id: 'a', bytes: 32, value: 'new' },
  });

  assert.deepEqual(store.getProducts(), [{ id: 'a', bytes: 32, value: 'new' }]);
  assert.equal(store.getSnapshot().bytes, 32);
});

test('subscribers are notified when store state changes', () => {
  const store = createRepresentationStore({
    getProductId: (product) => product.id,
  });
  let notificationCount = 0;
  const unsubscribe = store.subscribe(() => {
    notificationCount += 1;
  });

  store.apply({
    type: 'data/product-upsert',
    product: { id: 'a' },
  });
  unsubscribe();
  store.apply({
    type: 'data/product-upsert',
    product: { id: 'b' },
  });

  assert.equal(notificationCount, 1);
});

test('consumeProductDeltas can stop on representation-current', async () => {
  const store = createRepresentationStore({
    getProductId: (product) => product.id,
  });
  const result = await consumeProductDeltas(createDeltas([
    { type: 'data/product-upsert', product: { id: 'a' } },
    { type: 'data/representation-current' },
    { type: 'data/product-upsert', product: { id: 'b' } },
  ]), store, { stopOnCurrent: true });

  assert.deepEqual(result, {
    deltaCount: 2,
    stoppedOn: 'current',
  });
  assert.deepEqual(store.getProducts(), [{ id: 'a' }]);
});

test('consumeProductDeltas records product errors and can return without throwing', async () => {
  const store = createRepresentationStore({
    getProductId: (product) => product.id,
  });
  const result = await consumeProductDeltas(createDeltas([
    { type: 'data/product-error', error: { message: 'nope' } },
  ]), store, { throwOnError: false });

  assert.deepEqual(result, {
    deltaCount: 1,
    stoppedOn: 'error',
  });
  assert.equal(store.getSnapshot().status, 'failed');
});

test('consumeProductDeltas throws by default on product errors', async () => {
  const store = createRepresentationStore({
    getProductId: (product) => product.id,
  });

  await assert.rejects(
    () => consumeProductDeltas(createDeltas([
      { type: 'data/product-error', error: { message: 'nope' } },
    ]), store),
    /nope/,
  );
});

async function* createDeltas(deltas) {
  for (const delta of deltas) {
    yield delta;
  }
}
