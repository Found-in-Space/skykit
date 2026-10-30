import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneySequencePlayer } from '../sequence.js';
import { createJourneyOperation } from '../operations.js';
import { createGuidedJourneyController } from '../index.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const joins = [], applied = [], evaluated = [];
  let releases = 0;
  const sequence = { durationSecs: 10, evaluate(timeSecs) {
    evaluated.push(timeSecs);
    return { frameId: 'fixture-metres', position: { x: timeSecs ** 2, y: 0, z: 0 },
      cue: timeSecs <= 5 ? 'earlier-inclusive' : 'later', getSeconds: 100 + timeSecs * 20 };
  }, ...options.sequence };
  const player = createJourneySequencePlayer({ sequence, participant: {
    join(frame, context) { const control = createJourneyOperation({ signal: context.signal }); joins.push({ frame, context, control }); return control.operation; },
    apply(frame, context) { applied.push({ frame, context }); return options.apply?.(frame, context); },
    release() { releases++; options.release?.(); },
    capabilities: options.capabilities,
  }, ...options.player });
  return { player, joins, applied, evaluated, get releases() { return releases; },
    async join() { const operation = player.join(); joins.at(-1).control.settle('completed'); await flush(); return operation; } };
}

test('out-of-order detached seeks evaluate the same samples/cues without applying or replaying effects', () => {
  const f = fixture();
  const expected = f.player.seek(5);
  f.player.seek(8); f.player.seek(0);
  assert.deepEqual(f.player.seek(5), expected);
  assert.equal(expected.value.cue, 'earlier-inclusive');
  assert.equal(f.player.seek(5.01).value.cue, 'later');
  assert.equal(f.player.seek(100).timeSecs, 10);
  assert.equal(f.applied.length, 0); assert.equal(f.joins.length, 0);
  f.player.dispose();
});

test('live joining holds presentation time and completes independently of playback end', async () => {
  const f = fixture();
  const end = f.player.play(), arrival = f.player.join();
  let ended = false; void end.finished.then(() => { ended = true; });
  f.player.update(20);
  assert.equal(f.player.getSnapshot().frame.timeSecs, 0);
  assert.equal(f.applied.length, 0);
  f.joins[0].control.settle('completed'); await flush();
  assert.equal((await arrival.finished).status, 'completed'); assert.equal(ended, false);
  f.player.update(3); assert.equal(f.applied.at(-1).frame.value.getSeconds, 160);
  f.player.update(7); await flush();
  assert.equal((await end.finished).status, 'completed');
  assert.equal(f.player.getSnapshot().ownership, 'attached');
  f.player.dispose();
});

test('pause holds ownership and time; resume retains the pending operation; cancel releases once', async () => {
  const f = fixture(); await f.join();
  const end = f.player.play(); f.player.update(2); f.player.pause();
  f.player.update(500);
  assert.equal(f.player.getSnapshot().frame.timeSecs, 2);
  assert.equal(f.player.getSnapshot().ownership, 'attached'); assert.equal(f.releases, 0);
  assert.equal(f.player.play(), end);
  f.player.update(1); end.cancel(); await flush();
  assert.equal((await end.finished).status, 'cancelled');
  assert.equal(f.player.getSnapshot().frame.timeSecs, 3); assert.equal(f.releases, 1);
  const count = f.applied.length;
  f.player.seek(6); f.player.update(1); assert.equal(f.applied.length, count);
  f.player.cancel(); f.player.dispose(); assert.equal(f.releases, 1);
});

test('completion waits for applied final state and a seek invalidates stale acknowledgements', async () => {
  const acknowledgements = [];
  const f = fixture({ apply() { const gate = deferred(); acknowledgements.push(gate); return gate.promise; } });
  await f.join(); const end = f.player.play();
  let result; void end.finished.then(value => { result = value; });
  f.player.update(10); await flush(); assert.equal(result, undefined);
  f.player.seek(2); acknowledgements[1].resolve(); await flush();
  assert.equal(result, undefined);
  f.player.play(); f.player.update(8); acknowledgements.at(-1).resolve(); await flush();
  assert.equal(result.status, 'completed');
  f.player.dispose();
  for (const ack of acknowledgements) ack.resolve();
});

test('reverse playback ends at zero and replay requires an explicit seek', async () => {
  const f = fixture(); f.player.seek(10); f.player.setRate(-2); await f.join();
  const reverse = f.player.play(); f.player.update(2);
  assert.equal(f.player.getSnapshot().frame.timeSecs, 6);
  f.player.update(3); await flush(); assert.equal((await reverse.finished).status, 'completed');
  const again = f.player.play(); await flush();
  assert.equal((await again.finished).status, 'completed'); assert.equal(f.player.getSnapshot().frame.timeSecs, 0);
  f.player.seek(4); const replay = f.player.play(); f.player.update(2); await flush();
  assert.equal((await replay.finished).status, 'completed'); f.player.dispose();
});

test('join supersession and AbortSignal prevent old arrival from regaining scene ownership', async () => {
  const f = fixture(); const first = f.player.join(); const signal = new AbortController();
  const second = f.player.join({ signal: signal.signal });
  assert.equal((await first.finished).status, 'superseded');
  f.joins[0].control.settle('completed'); await flush();
  assert.equal(f.player.getSnapshot().ownership, 'joining');
  signal.abort(); assert.equal((await second.finished).status, 'cancelled');
  assert.equal(f.player.getSnapshot().ownership, 'detached'); assert.equal(f.releases, 2);
  const third = f.player.join({ signal: signal.signal });
  assert.equal((await third.finished).status, 'cancelled'); assert.equal(f.releases, 2);
  f.player.dispose();
});

test('seek during joining releases the transfer and requires explicit live re-entry', async () => {
  const f = fixture(); f.player.play(); const first = f.player.join();
  f.player.seek(7); assert.equal((await first.finished).status, 'superseded');
  assert.equal(f.player.getSnapshot().ownership, 'detached');
  assert.equal(f.player.getSnapshot().status, 'paused'); assert.equal(f.applied.length, 0);
  const second = f.player.join(); assert.equal(f.joins.at(-1).frame.timeSecs, 7);
  f.joins.at(-1).control.settle('completed'); await flush();
  assert.equal((await second.finished).status, 'completed'); f.player.dispose();
});

test('unsupported controls and invalid quantities leave the clock and ownership unchanged', async () => {
  const f = fixture({ capabilities: { seek: false, rates: [1, 2] } }); await f.join();
  const before = f.player.getSnapshot();
  assert.throws(() => f.player.seek(4), /not supported/);
  for (const value of [-1, 0, NaN, Infinity]) assert.throws(() => f.player.setRate(value));
  assert.throws(() => f.player.update(-1));
  assert.deepEqual(f.player.getSnapshot(), before);
  f.player.dispose();
});

test('evaluation and participant failures settle playback and release ownership', async () => {
  const f = fixture({ sequence: { evaluate(time) { if (time > 2) throw new Error('no coverage'); return time; } } });
  await f.join(); const end = f.player.play(); f.player.update(3);
  assert.equal((await end.finished).status, 'failed'); assert.equal(f.releases, 1); f.player.dispose();
  const g = fixture({ apply() { return Promise.reject(new Error('renderer failed')); } });
  await g.join(); const failed = g.player.play(); await flush();
  assert.equal((await failed.finished).status, 'failed'); assert.equal(g.releases, 1); g.player.dispose();
  const h = fixture(); const playback = h.player.play(), joining = h.player.join();
  h.joins[0].control.settle('failed', new Error('navigation failed')); await flush();
  assert.equal((await joining.finished).status, 'failed'); assert.equal((await playback.finished).status, 'failed');
  assert.equal(h.releases, 1); h.player.dispose();
});

test('one evaluated envelope reaches scene and subscribers; late failures after disposal cannot mutate state', async () => {
  const ack = deferred(), f = fixture({ apply: () => ack.promise }); await f.join();
  const snapshots = []; f.player.subscribe(snapshot => snapshots.push(snapshot));
  f.player.play(); const before = f.evaluated.length; const frame = f.player.update(.5);
  assert.equal(f.evaluated.length, before + 1);
  assert.equal(frame, snapshots.at(-1).frame); assert.equal(frame, f.applied.at(-1).frame);
  f.player.dispose(); const count = snapshots.length;
  assert.equal(f.applied.at(-1).context.isCurrent(), false);
  ack.reject(new Error('late')); await flush(); assert.equal(snapshots.length, count);
  f.player.dispose(); assert.equal(f.releases, 1);
  assert.equal((await f.player.play().finished).status, 'failed');
});

test('chapter arrival and sequence completion compose without a second chapter activation', async () => {
  const f = fixture(); let enters = 0;
  const journey = createGuidedJourneyController({ driver: { transition: (_scene, ctx) => f.player.join({ signal: ctx.signal }), cancel: () => f.player.cancel() },
    definition: { id: 'sequence-chapter', chapters: [{ id: 'shot', scene: {},
      enter(ctx) { enters++; ctx.addCleanup(() => f.player.cancel()); }, arrive() { f.player.play(); } }],
    } });
  const arrival = journey.start(); await flush(); f.joins[0].control.settle('completed'); await flush();
  assert.equal((await arrival.finished).status, 'completed');
  const end = f.player.getSnapshot().operation;
  f.player.update(5); f.player.seek(1); f.player.update(9); await flush();
  assert.equal((await end.finished).status, 'completed'); assert.equal(enters, 1);
  await journey.dispose(); assert.equal(f.player.getSnapshot().ownership, 'detached'); f.player.dispose();
});

test('reentrant cancellation and failing release settle without recursive aborts or swallowed release errors', async () => {
  let control, calls = 0;
  control = createJourneyOperation({ onCancel() { calls++; control.abort(); } });
  control.abort(); assert.equal((await control.operation.finished).status, 'cancelled'); assert.equal(calls, 1);
  const f = fixture({ release() { throw new Error('release failed'); } }); await f.join();
  f.player.play(); f.player.cancel();
  assert.equal(f.player.getSnapshot().status, 'failed');
  assert.match(f.player.getSnapshot().error.message, /release failed/); assert.equal(f.releases, 1); f.player.dispose();
});
