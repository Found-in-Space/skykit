import assert from 'node:assert/strict';
import test from 'node:test';

import { createDecodedPayloadCache } from '../star-octree-decoded-cache.js';

test('decoded cache lease retains warmed entries under memory budget pressure', () => {
  let nowMs = 1_000;
  const cache = createDecodedPayloadCache({
    sourceIdentity: 'test-source',
    memoryBudgetBytes: 40,
    now: () => nowMs,
  });

  cache.set('leased', createSegment(2), 'p', { key: 'omega-route', ttlMs: 10_000 });
  cache.set('churn', createSegment(2), 'p');

  assert.ok(cache.peek('leased'));
  assert.equal(cache.peek('churn'), null);

  const snapshot = cache.getSnapshot();
  assert.equal(snapshot.decodedPayloads, 1);
  assert.equal(snapshot.decodedCacheLeasedPayloads, 1);
  assert.equal(snapshot.decodedCacheActiveLeases, 1);
  assert.equal(snapshot.decodedCacheLeasedPayloadBytes, 24);

  nowMs += 10_001;
  cache.set('replacement', createSegment(2), 'p');

  assert.equal(cache.peek('leased'), null);
  assert.ok(cache.peek('replacement'));
});

test('decoded cache releaseLease makes retained entries evictable again', () => {
  const cache = createDecodedPayloadCache({
    sourceIdentity: 'test-source',
    memoryBudgetBytes: 40,
  });

  cache.set('leased', createSegment(2), 'p', { key: 'omega-route', ttlMs: 10_000 });

  assert.equal(cache.releaseLease('omega-route'), 1);
  cache.set('replacement', createSegment(2), 'p');

  assert.equal(cache.peek('leased'), null);
  assert.ok(cache.peek('replacement'));
  assert.equal(cache.getSnapshot().decodedCacheActiveLeases, 0);
});

test('decoded cache reports lease pressure when retained payloads exceed budget', () => {
  const cache = createDecodedPayloadCache({
    sourceIdentity: 'test-source',
    memoryBudgetBytes: 40,
  });

  cache.set('leased-a', createSegment(2), 'p', { key: 'omega-route', ttlMs: 10_000 });
  cache.set('leased-b', createSegment(2), 'p', { key: 'omega-route', ttlMs: 10_000 });

  const snapshot = cache.getSnapshot();
  assert.equal(snapshot.decodedPayloads, 2);
  assert.equal(snapshot.decodedCacheLeasedPayloads, 2);
  assert.equal(snapshot.decodedCacheLeasePressureBytes, 8);
  assert.equal(snapshot.decodedCacheLeasesByKey['omega-route'].payloads, 2);
});

test('decoded persistent cache lookup fails open when Cache API access is forbidden', async () => {
  await withForbiddenCaches(async () => {
    const cache = createDecodedPayloadCache({
      sourceIdentity: 'test-source',
      persistentCache: 'on',
    });

    assert.equal(await cache.get('missing', {}, 'dataset-a', 'p'), null);
    cache.set('memory-only', createSegment(1), 'p');

    assert.ok(cache.peek('memory-only'));
    assert.equal(cache.getSnapshot().decodedCacheMisses, 1);
  });
});

function createSegment(count) {
  return {
    count,
    positionsPc: new Float32Array(count * 3),
  };
}

async function withForbiddenCaches(callback) {
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousWarn = console.warn;

  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    get() {
      const error = new Error('Cache API storage is blocked.');
      error.name = 'SecurityError';
      throw error;
    },
  });
  console.warn = () => {};

  try {
    await callback();
  } finally {
    console.warn = previousWarn;
    restoreGlobalProperty('caches', previousCaches);
  }
}

function restoreGlobalProperty(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}
