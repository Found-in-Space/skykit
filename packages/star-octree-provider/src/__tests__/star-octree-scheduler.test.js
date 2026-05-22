import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarOctreeScheduler } from '../star-octree-scheduler.js';

test('scheduler orders foreground lanes before prefetch while preserving priority', async () => {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightPayloadBatches: 1,
      maxInflightPrefetchPayloadBatches: 1,
    },
  });
  const started = [];

  const active = scheduleGated(scheduler, started, {
    label: 'active-current',
    lane: 'current',
    priority: 0,
  });
  await tick();

  const prefetch = scheduleGated(scheduler, started, {
    label: 'prefetch',
    lane: 'prefetch',
    priority: 100,
  });
  const replacement = scheduleGated(scheduler, started, {
    label: 'replacement',
    lane: 'replacement',
    priority: 50,
  });
  const current = scheduleGated(scheduler, started, {
    label: 'current',
    lane: 'current',
    priority: 1,
  });
  await tick();

  assert.deepEqual(started, ['active-current']);

  active.resolve();
  await active.task.promise;
  await tick();
  assert.deepEqual(started, ['active-current', 'current']);

  current.resolve();
  await current.task.promise;
  await tick();
  assert.deepEqual(started, ['active-current', 'current', 'replacement']);

  replacement.resolve();
  await replacement.task.promise;
  await tick();
  assert.deepEqual(started, ['active-current', 'current', 'replacement', 'prefetch']);

  prefetch.resolve();
  await prefetch.task.promise;
});

test('scheduler promotion cannot demote queued foreground work back to prefetch', async () => {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightShardFetches: 1,
      maxInflightPrefetchShardFetches: 1,
    },
  });
  const started = [];
  const active = scheduleGated(scheduler, started, {
    label: 'active-current',
    kind: 'shard',
    lane: 'current',
  });
  await tick();

  const promoted = scheduleGated(scheduler, started, {
    label: 'promoted',
    kind: 'shard',
    lane: 'prefetch',
  });
  promoted.task.promote('current', 1);
  promoted.task.promote('prefetch', 999);

  const snapshot = scheduler.getSnapshot();
  assert.equal(snapshot.queuedByLane.current, 1);
  assert.equal(snapshot.queuedByLane.prefetch, 0);

  active.resolve();
  await active.task.promise;
  await tick();
  assert.deepEqual(started, ['active-current', 'promoted']);

  promoted.resolve();
  await promoted.task.promise;
});

test('scheduler holds prefetch while foreground work is queued or active', async () => {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightPayloadBatches: 1,
      maxInflightPrefetchDecodeTasks: 1,
    },
  });
  const started = [];
  const activePayload = scheduleGated(scheduler, started, {
    label: 'active-payload',
    kind: 'payload',
    lane: 'current',
  });
  await tick();

  const queuedPayload = scheduleGated(scheduler, started, {
    label: 'queued-payload',
    kind: 'payload',
    lane: 'current',
  });
  const prefetchDecode = scheduleGated(scheduler, started, {
    label: 'prefetch-decode',
    kind: 'decode',
    lane: 'prefetch',
  });
  await tick();

  assert.deepEqual(started, ['active-payload']);

  activePayload.resolve();
  await activePayload.task.promise;
  await tick();
  assert.deepEqual(started, ['active-payload', 'queued-payload']);

  queuedPayload.resolve();
  await queuedPayload.task.promise;
  await tick();
  assert.deepEqual(started, ['active-payload', 'queued-payload', 'prefetch-decode']);

  prefetchDecode.resolve();
  await prefetchDecode.task.promise;
});

test('scheduler preempts running prefetch when current work is queued', async () => {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightPayloadBatches: 1,
      maxInflightPrefetchPayloadBatches: 1,
    },
  });
  const started = [];
  let preemptReason = null;
  const prefetch = scheduleGated(scheduler, started, {
    label: 'prefetch',
    kind: 'payload',
    lane: 'prefetch',
    preempt: 'foreground',
    onPreempt(reason) {
      preemptReason = reason;
      prefetch.reject(reason);
    },
  });
  await tick();

  const current = scheduleGated(scheduler, started, {
    label: 'current',
    kind: 'payload',
    lane: 'current',
  });
  await assert.rejects(prefetch.task.promise, { name: 'AbortError' });
  await tick();

  assert.equal(preemptReason?.name, 'AbortError');
  assert.deepEqual(started, ['prefetch', 'current']);
  const snapshot = scheduler.getSnapshot();
  assert.equal(snapshot.stats.preempted, 1);
  assert.equal(snapshot.stats.preemptedByKind.payload, 1);
  assert.equal(snapshot.stats.preemptedByLane.prefetch, 1);
  assert.equal(snapshot.stats.cancelled, 0);

  current.resolve();
  await current.task.promise;
});

test('scheduler preempts running prefetch when replacement work is queued', async () => {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightShardFetches: 1,
      maxInflightPrefetchShardFetches: 1,
    },
  });
  const started = [];
  const prefetch = scheduleGated(scheduler, started, {
    label: 'prefetch-shard',
    kind: 'shard',
    lane: 'prefetch',
    preempt: 'foreground',
    onPreempt(reason) {
      prefetch.reject(reason);
    },
  });
  await tick();

  const replacement = scheduleGated(scheduler, started, {
    label: 'replacement-shard',
    kind: 'shard',
    lane: 'replacement',
  });
  await assert.rejects(prefetch.task.promise, { name: 'AbortError' });
  await tick();

  assert.deepEqual(started, ['prefetch-shard', 'replacement-shard']);
  const snapshot = scheduler.getSnapshot();
  assert.equal(snapshot.stats.preempted, 1);
  assert.equal(snapshot.stats.preemptedByKind.shard, 1);
  assert.equal(snapshot.stats.preemptedByLane.prefetch, 1);

  replacement.resolve();
  await replacement.task.promise;
});

test('scheduler does not preempt prefetch after it is promoted to foreground', async () => {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightPayloadBatches: 1,
      maxInflightPrefetchPayloadBatches: 1,
    },
  });
  const started = [];
  let preempted = false;
  const promoted = scheduleGated(scheduler, started, {
    label: 'promoted-prefetch',
    kind: 'payload',
    lane: 'prefetch',
    preempt: 'foreground',
    onPreempt(reason) {
      preempted = true;
      promoted.reject(reason);
    },
  });
  await tick();

  promoted.task.promote('current', 10);
  const current = scheduleGated(scheduler, started, {
    label: 'current',
    kind: 'payload',
    lane: 'current',
  });
  await tick();

  assert.equal(preempted, false);
  assert.deepEqual(started, ['promoted-prefetch']);
  assert.equal(scheduler.getSnapshot().stats.preempted, 0);

  promoted.resolve();
  await promoted.task.promise;
  await tick();
  assert.deepEqual(started, ['promoted-prefetch', 'current']);

  current.resolve();
  await current.task.promise;
});

test('scheduler cancels queued work and keeps FIFO ties deterministic', async () => {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightDecodeTasks: 1,
      maxInflightPrefetchDecodeTasks: 1,
    },
  });
  const started = [];
  const active = scheduleGated(scheduler, started, {
    label: 'active',
    kind: 'decode',
    lane: 'current',
  });
  await tick();

  const cancelled = scheduleGated(scheduler, started, {
    label: 'cancelled',
    kind: 'decode',
    lane: 'prefetch',
  });
  const cancelledRejection = assert.rejects(
    cancelled.task.promise,
    /Star octree scheduled work aborted/,
  );
  cancelled.task.cancel();
  await cancelledRejection;

  const first = scheduleGated(scheduler, started, {
    label: 'first',
    kind: 'decode',
    lane: 'current',
    priority: 10,
  });
  const second = scheduleGated(scheduler, started, {
    label: 'second',
    kind: 'decode',
    lane: 'current',
    priority: 10,
  });
  const third = scheduleGated(scheduler, started, {
    label: 'third',
    kind: 'decode',
    lane: 'current',
    priority: 10,
  });

  assert.equal(scheduler.getSnapshot().queuedByLane.prefetch, 0);

  active.resolve();
  await active.task.promise;
  await tick();
  first.resolve();
  await first.task.promise;
  await tick();
  second.resolve();
  await second.task.promise;
  await tick();
  third.resolve();
  await third.task.promise;

  assert.deepEqual(started, ['active', 'first', 'second', 'third']);
});

function scheduleGated(scheduler, started, options) {
  const gate = createDeferred();
  const task = scheduler.schedule({
    kind: options.kind ?? 'payload',
    lane: options.lane,
    priority: options.priority,
    preempt: options.preempt,
    onPreempt: options.onPreempt,
  }, async () => {
    started.push(options.label);
    await gate.promise;
    return options.label;
  });

  return {
    task,
    resolve() {
      gate.resolve();
    },
    reject(error) {
      gate.reject(error);
    },
  };
}

function createDeferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  /** @type {(error?: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
