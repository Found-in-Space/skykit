import assert from 'node:assert/strict';
import { createGuidedJourneyController } from '../src/index.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

/** The same behavioral exercise runs against real host drivers, outside browser bundles. */
export async function exerciseJourneyDriver({ driver, scenes, advance }) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let delay = false, fail = false, lateCleanup = 0, entered = 0, left = 0, cleaned = 0;
  const outcomes = [];
  const journey = createGuidedJourneyController({ driver, definition: {
    id: 'conformance', transition: { durationSecs: .1 }, chapters: [
      { id: 'a', scene: scenes[0] },
      { id: 'b', scene: scenes[1], prepare: async () => {
        if (fail) throw new Error('Unavailable fixture resource');
        if (delay) { await gate; return () => { lateCleanup++; }; }
      } },
      { id: 'c', scene: scenes[2] },
    ].map(chapter => ({ ...chapter,
      enter(ctx) { entered++; ctx.addCleanup(() => { cleaned++; }); },
      leave() { left++; },
    })),
  } });
  try {
    const first = journey.start(); await flush();
    assert.equal(journey.getSnapshot().arrivedChapterId, null);
    await advance(); outcomes.push((await first.finished).status);
    assert.equal(journey.getSnapshot().arrivedChapterId, 'a');
    assert.equal((await journey.previous().finished).status, 'completed');
    const snapshot = journey.getSnapshot();
    assert.equal((await journey.goTo('unknown').finished).status, 'failed');
    assert.deepEqual(journey.getSnapshot(), snapshot);

    delay = true;
    const second = journey.next(); await flush();
    assert.equal(journey.getSnapshot().enteredChapterId, 'a');
    const third = journey.next(); await flush();
    outcomes.push((await second.finished).status);
    release(); await flush(); assert.equal(lateCleanup, 1);
    await advance(); outcomes.push((await third.finished).status);
    assert.equal(journey.getSnapshot().arrivedChapterId, 'c');
    assert.equal((await journey.next().finished).status, 'completed');
    const revisit = journey.goTo('c'); await flush(); await advance();
    outcomes.push((await revisit.finished).status);

    const cancelled = journey.goTo('a'); await flush(); journey.cancel();
    outcomes.push((await cancelled.finished).status);
    await advance(); assert.equal(journey.getSnapshot().arrivedChapterId, 'c');
    assert.deepEqual(outcomes, ['completed', 'superseded', 'completed', 'completed', 'cancelled']);
    assert.deepEqual(journey.getSnapshot().history, ['a', 'c', 'c']);
    delay = false; fail = true;
    assert.equal((await journey.goTo('b').finished).status, 'failed');
    assert.equal(journey.getSnapshot().arrivedChapterId, 'c');
    fail = false;
    const retry = journey.goTo('b'); await flush(); await advance();
    assert.equal((await retry.finished).status, 'completed');
    assert.equal(journey.getSnapshot().arrivedChapterId, 'b');
    await journey.dispose();
    assert.equal(left, entered); assert.equal(cleaned, entered);
    return { outcomes, history: journey.getSnapshot().history };
  } finally {
    release(); await journey.dispose();
  }
}
