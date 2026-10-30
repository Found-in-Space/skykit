import test from 'node:test';
import assert from 'node:assert/strict';
import { createJourneySequencePlayer } from '@found-in-space/guided-journey/sequence';
import { normalizeSpatialPose } from '@found-in-space/spatial';
import { createSkykitViewer, createSkykitNavigationPlugin, SKYKIT_ICRS_SPACE, SKYKIT_ACTIONS } from '../index.js';
import { createSkykitSequenceParticipant } from '../journey.js';

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
async function fixture() {
  const navigation = createSkykitNavigationPlugin();
  const viewer = await createSkykitViewer({ view: { observerPc: { x: 3, y: 4, z: 5 } }, plugins: [navigation] });
  const participant = createSkykitSequenceParticipant({ viewer, navigation, durationSecs: 1 });
  const sequence = { durationSecs: 2, evaluate(timeSecs) { return { pose: normalizeSpatialPose({ space: SKYKIT_ICRS_SPACE,
    position: { x: 10 + timeSecs, y: timeSecs * 2, z: 0 }, orientation: { x: 0, y: 0, z: 1, w: 0 } }), cue: timeSecs <= 1 ? 'a' : 'b' }; } };
  const player = createJourneySequencePlayer({ sequence, participant });
  const remove = viewer.addPart({ id: 'sequence-clock', priority: 1, update: frame => { player.update(frame.deltaSeconds); } });
  async function join() {
    const result = player.join(); await flush(); viewer.frame(0); viewer.frame(1); viewer.frame(0); await flush();
    assert.equal((await result.finished).status, 'completed');
  }
  async function dispose() { remove(); player.dispose(); participant.dispose(); await viewer.dispose(); }
  return { viewer, navigation, participant, sequence, player, join, dispose };
}

test('sequence joins the real viewer from its live pose and ends only after the last queued sample is applied', async () => {
  const f = await fixture();
  try {
    const before = f.viewer.getViewState(), arrival = f.player.join(); await flush();
    f.viewer.frame(0); f.viewer.frame(0);
    assert.deepEqual(f.viewer.getViewState().observerPc, before.observerPc);
    assert.deepEqual(f.viewer.getViewState().orientationIcrs, before.orientationIcrs);
    f.viewer.frame(1); f.viewer.frame(0); await flush();
    assert.equal((await arrival.finished).status, 'completed');
    const end = f.player.play(); let ended = false; void end.finished.then(() => { ended = true; });
    f.viewer.frame(2); await flush(); assert.equal(ended, false);
    f.viewer.frame(0); await flush(); assert.equal((await end.finished).status, 'completed');
    assert.deepEqual(f.viewer.getViewState().observerPc, f.sequence.evaluate(2).pose.position);
  } finally { await f.dispose(); }
});

test('attached scrubbing is exact; detached seeks do not move the viewer and rejoin blends from manual state', async () => {
  const f = await fixture();
  try {
    await f.join(); f.player.seek(1.5); f.viewer.frame(0);
    const exact = f.viewer.getViewState();
    f.player.seek(.1); f.viewer.frame(0); f.player.seek(1.5); f.viewer.frame(0);
    assert.deepEqual(f.viewer.getViewState().observerPc, exact.observerPc);
    f.player.cancel(); f.viewer.requestViewState({ observerPc: { x: 4, y: -8, z: 2 }, orientationIcrs: { x: 0, y: 1, z: 0, w: 0 } });
    f.viewer.frame(0); const manual = f.viewer.getViewState();
    f.player.seek(.5); f.viewer.frame(0);
    assert.deepEqual(f.viewer.getViewState().observerPc, manual.observerPc);
    const arrival = f.player.join(); await flush(); f.viewer.frame(0); f.viewer.frame(0);
    assert.deepEqual(f.viewer.getViewState().observerPc, manual.observerPc);
    assert.deepEqual(f.viewer.getViewState().orientationIcrs, manual.orientationIcrs);
    f.viewer.frame(1); f.viewer.frame(0); await flush();
    assert.equal((await arrival.finished).status, 'completed');
    assert.deepEqual(f.viewer.getViewState().observerPc, f.sequence.evaluate(.5).pose.position);
  } finally { await f.dispose(); }
});

test('manual commands and raw camera edits release sequence ownership without dropping the new input', async () => {
  const f = await fixture();
  try {
    await f.join(); const end = f.player.play(); f.viewer.frame(.4);
    const live = f.viewer.getViewState();
    await f.viewer.actions.invoke(SKYKIT_ACTIONS.navigation.cancelMovement); f.viewer.frame(0); await flush();
    assert.equal((await end.finished).status, 'cancelled');
    assert.deepEqual(f.viewer.getViewState().observerPc, live.observerPc);
    await f.join(); f.player.play(); f.viewer.frame(.2);
    f.viewer.requestViewState({ observerPc: { x: 99, y: 0, z: 0 } }, 'manual');
    f.viewer.frame(0); await flush();
    assert.equal(f.player.getSnapshot().ownership, 'detached');
    assert.equal(f.viewer.getViewState().observerPc.x, 99);
  } finally { await f.dispose(); }
});

test('a new typed navigation command keeps ownership when it supersedes attached playback', async () => {
  const f = await fixture();
  try {
    await f.join(); const end = f.player.play(); f.viewer.frame(.1);
    const replacement = f.navigation.transitionTo({ observerPc: { x: 30, y: 0, z: 0 }, durationSecs: 1 });
    await flush(); assert.equal((await end.finished).status, 'cancelled');
    f.viewer.frame(1); f.viewer.frame(0); await flush();
    assert.equal((await replacement.finished).status, 'completed');
    assert.equal(f.viewer.getViewState().observerPc.x, 30);
  } finally { await f.dispose(); }
});

test('foreign coordinate frames fail before moving the scene and host disposal releases pending playback', async () => {
  const f = await fixture();
  try {
    const before = f.viewer.getViewState();
    const bad = createJourneySequencePlayer({ participant: f.participant, sequence: { durationSecs: 1,
      evaluate() { return { pose: normalizeSpatialPose({ space: { frameId: 'moon-fixed', metersPerUnit: 1 } }) }; } } });
    assert.equal((await bad.join().finished).status, 'failed');
    assert.deepEqual(f.viewer.getViewState().observerPc, before.observerPc); bad.dispose();
    await f.join(); const end = f.player.play(); await f.viewer.dispose(); await flush();
    assert.equal((await end.finished).status, 'cancelled');
    assert.equal(f.player.getSnapshot().ownership, 'detached');
  } finally { await f.dispose(); }
});
