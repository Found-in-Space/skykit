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
  };
}

function createDeferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
