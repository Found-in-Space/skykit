import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuidedJourneyController, defineGuidedJourney } from '../index.js';
import { createJourneyOperation } from '../operations.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('scoped cancellation cannot cancel a replacement, including while the previous chapter remains active', async () => {
  const contexts = [], gate = deferred();
  const f = fixture([{ id: 'a', prepare: ctx => { contexts.push(ctx); } },
    { id: 'b', prepare: ctx => { contexts.push(ctx); return gate.promise; } }]);
  f.journey.start(); await f.arrive();
  const b = f.journey.goTo('b'); await flush();
  contexts[0].cancel();
  assert.equal(f.journey.getSnapshot().status, 'preparing');
  contexts[1].cancel(); await flush();
  assert.equal((await b.finished).status, 'cancelled');
  assert.ok(contexts.every(ctx => ctx.signal.aborted));
  const replacement = f.journey.goTo('a'); await flush();
  contexts[1].cancel(); gate.resolve(); await f.arrive();
  assert.equal((await replacement.finished).status, 'completed');
  contexts[2].cancel(); assert.equal(f.journey.getSnapshot().status, 'cancelled');
  await f.journey.dispose();
  contexts[2].cancel(); assert.equal(f.journey.getSnapshot().disposed, true);
});
function fixture(chapters, options = {}) {
  const trace = [], motions = [];
  const driver = {
    prepare: options.prepare,
    enter(scene) { trace.push(`enter:${scene}`); },
    transition(scene, ctx) {
      const control = createJourneyOperation({ signal: ctx.signal });
      motions.push({ scene, ctx, control }); trace.push(`move:${scene}`);
      return control.operation;
    },
    cancel() { for (const motion of motions) motion.control.abort(); },
  };
  const journey = createGuidedJourneyController({ driver, definition: defineGuidedJourney({ id: 'test',
    chapters: chapters.map(chapter => ({ ...chapter, scene: chapter.id })), ...options.definition }) });
  return { journey, trace, motions, async arrive() { await flush(); motions.at(-1).control.settle('completed'); await flush(); } };
}

test('navigation acceptance, entry and arrival have distinct state and one terminal result', async () => {
  const f = fixture([{ id: 'a', arrive: () => { f.trace.push('arrive:a'); } }]);
  const operation = f.journey.start(); let result;
  operation.finished.then(value => { result = value; });
  assert.equal(f.journey.getSnapshot().status, 'preparing');
  await flush();
  assert.equal(result, undefined);
  assert.equal(f.journey.getSnapshot().enteredChapterId, 'a');
  assert.equal(f.journey.getSnapshot().arrivedChapterId, null);
  await f.arrive();
  assert.equal(result.status, 'completed');
  operation.cancel();
  assert.deepEqual(f.journey.getSnapshot().history, ['a']);
  assert.deepEqual(f.trace, ['enter:a', 'move:a', 'arrive:a']);
  await f.journey.dispose();
});

test('A B C latest wins even when preparation ignores abort and returns cleanup late', async () => {
  const delay = deferred(); let cleaned = 0;
  const f = fixture([{ id: 'a' }, { id: 'b', prepare: async () => { await delay.promise; return () => { cleaned++; }; } }, { id: 'c' }]);
  const a = f.journey.start(); await f.arrive(); await a.finished;
  const b = f.journey.next(); await flush();
  const c = f.journey.next();
  assert.equal((await b.finished).status, 'superseded');
  await f.arrive(); assert.equal((await c.finished).status, 'completed');
  delay.resolve(); await flush();
  assert.equal(cleaned, 1);
  assert.deepEqual(f.trace, ['enter:a', 'move:a', 'enter:c', 'move:c']);
  assert.deepEqual(f.journey.getSnapshot().history, ['a', 'c']);
  await f.journey.dispose();
});

test('failed preparation retains the previous scope and retry closes it exactly once', async () => {
  let fail = true, leaves = 0, cleanups = 0;
  const f = fixture([{ id: 'a', enter: ctx => { ctx.addCleanup(() => { cleanups++; }); }, leave: () => { leaves++; } },
    { id: 'b', prepare: () => { if (fail) throw new Error('offline'); } }]);
  f.journey.start(); await f.arrive();
  assert.equal((await f.journey.goTo('b').finished).status, 'failed');
  assert.equal(f.journey.getSnapshot().enteredChapterId, 'a');
  assert.equal(cleanups, 0); assert.equal(leaves, 0);
  fail = false; const retry = f.journey.goTo('b'); await f.arrive();
  assert.equal((await retry.finished).status, 'completed');
  assert.equal(cleanups, 1); assert.equal(leaves, 1);
  await f.journey.dispose(); assert.equal(cleanups, 1);
});

test('edge selection uses entered chapter and live driver state, not an unentered request', async () => {
  const delay = deferred();
  const f = fixture([{ id: 'a' }, { id: 'b', prepare: () => delay.promise }, { id: 'c' }], {
    definition: { transition: { durationSecs: 5 }, transitions: [{ from: 'a', to: 'c', durationSecs: 2 }] },
  });
  f.journey.start(); await f.arrive(); f.journey.goTo('b'); await flush();
  f.journey.goTo('c'); await flush();
  assert.equal(f.motions.at(-1).ctx.previousChapterId, 'a');
  assert.equal(f.motions.at(-1).ctx.transition.durationSecs, 2);
  delay.resolve(); await f.arrive(); await f.journey.dispose();
});

test('cancel and disposal abort pending work, release active work and never restore a snapshot', async () => {
  let cleaned = 0;
  const f = fixture([{ id: 'a', enter: () => () => { cleaned++; } }]);
  const operation = f.journey.start(); await flush(); operation.cancel();
  assert.equal((await operation.finished).status, 'cancelled');
  await flush(); assert.equal(cleaned, 1);
  f.motions[0].control.settle('completed'); await flush();
  assert.equal(f.journey.getSnapshot().arrivedChapterId, null);
  const retry = f.journey.start(); await f.arrive(); assert.equal((await retry.finished).status, 'completed');
  await f.journey.dispose(); await f.journey.dispose(); assert.equal(cleaned, 2);
  assert.equal((await f.journey.start().finished).status, 'failed');
});

test('external abort, invalid IDs, boundaries and explicit revisits share operation semantics', async () => {
  const f = fixture([{ id: 'a' }, { id: 'b' }]);
  const abort = new AbortController();
  const operation = f.journey.start('a', { signal: abort.signal });
  abort.abort(); assert.equal((await operation.finished).status, 'cancelled');
  f.journey.start(); await f.arrive();
  assert.equal((await f.journey.previous().finished).status, 'completed');
  const snapshot = f.journey.getSnapshot();
  assert.equal((await f.journey.goTo('unknown').finished).status, 'failed');
  assert.deepEqual(f.journey.getSnapshot(), snapshot);
  f.journey.goTo('a'); await f.arrive();
  assert.deepEqual(f.journey.getSnapshot().history, ['a', 'a']);
  await f.journey.dispose();
});

test('a reentrant subscriber supersedes activation before any old hook can run', async () => {
  const f = fixture([{ id: 'a' }, { id: 'b' }]);
  f.journey.subscribe(state => { if (state.status === 'preparing' && state.requestedChapterId === 'a') f.journey.goTo('b'); });
  const a = f.journey.start(); await f.arrive();
  assert.equal((await a.finished).status, 'superseded');
  assert.deepEqual(f.trace, ['enter:b', 'move:b']);
  await f.journey.dispose();
});

test('all cleanup runs even if one disposer throws, with errors observable on disposal', async () => {
  const called = [];
  const f = fixture([{ id: 'a', enter(ctx) {
    ctx.addCleanup(() => { called.push('first'); });
    ctx.addCleanup(() => { called.push('second'); throw new Error('cleanup'); });
  } }]);
  f.journey.start(); await f.arrive();
  await assert.rejects(f.journey.dispose(), AggregateError);
  assert.deepEqual(called, ['second', 'first']);
});

test('superseding a transition during asynchronous leave waits for the same departure cleanup', async () => {
  const delay = deferred();
  const f = fixture([{ id: 'a', leave: () => delay.promise }, { id: 'b' }, { id: 'c' }]);
  f.journey.start(); await f.arrive();
  const b = f.journey.goTo('b'); await flush();
  const c = f.journey.goTo('c'); await flush();
  assert.equal((await b.finished).status, 'superseded');
  assert.deepEqual(f.trace, ['enter:a', 'move:a']);
  delay.resolve(); await f.arrive();
  assert.equal((await c.finished).status, 'completed');
  assert.deepEqual(f.trace, ['enter:a', 'move:a', 'enter:c', 'move:c']);
  await f.journey.dispose();
});
