import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntime } from '@found-in-space/touch-os';
import { createGuidedJourneyController } from '../index.js';
import { createJourneySequencePlayer } from '../sequence.js';
import { createJourneyOperation } from '../operations.js';
import { createJourneyTouchControls, createSequenceTouchControls } from '../touch-os.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function panel(controls, subscribe) {
  const runtime = createRuntime({ root: controls.render(), surface: { width: 480, height: 640 } });
  const unsubscribe = subscribe(() => runtime.setRoot(controls.render()));
  const route = () => { for (const output of runtime.takeOutputs()) controls.handleOutput(output); };
  return { runtime,
    click(id, activationAllowed = true) {
      runtime.render();
      const bounds = runtime.getBounds(id); assert.ok(bounds, `Control ${id} is mounted`);
      const point = { surfaceX: bounds.x + bounds.width / 2, surfaceY: bounds.y + bounds.height / 2, pointerId: 'ray', pointerType: 'ray' };
      runtime.dispatchInput({ type: 'pointer-down', ...point, timestamp: 1 }); route();
      runtime.dispatchInput({ type: 'pointer-up', ...point, timestamp: 2, activationAllowed }); route();
    },
    text() { return runtime.render().commands.filter(command => command.type === 'text').map(command => command.text).join('\n'); },
    dispose() { unsubscribe(); runtime.dispose(); },
  };
}

test('TouchOS chapters use shared outcomes, suppress cancelled presses, and preserve retry/free exploration', async () => {
  const definition = { chapters: [{ id: 'a', title: 'First', scene: 1 }, { id: 'b', title: 'Second', scene: 2 }], id: 'chapters' };
  const operations = []; let fail = true;
  const journey = createGuidedJourneyController({ definition, driver: {
    prepare(scene) { if (scene === 2 && fail) throw new Error('Missing detail'); },
    transition() { const control = createJourneyOperation(); operations.push(control); return control.operation; }, cancel() {},
  } });
  const controls = createJourneyTouchControls({ id: 'chapters', journey, definition });
  const view = panel(controls, journey.subscribe);
  try {
    view.click('chapters:chapter:0', false); assert.equal(journey.getSnapshot().status, 'idle');
    view.click('chapters:chapter:0'); await flush();
    assert.equal(journey.getSnapshot().source, 'touch'); assert.match(view.text(), /Travelling to First/);
    operations[0].settle('completed'); await flush(); assert.equal(journey.getSnapshot().arrivedChapterId, 'a');
    view.click('chapters:next'); await flush(); assert.match(view.text(), /Missing detail/);
    fail = false; view.click('chapters:retry'); await flush(); operations[1].settle('completed'); await flush();
    assert.equal(journey.getSnapshot().arrivedChapterId, 'b');
    view.click('chapters:cancel'); await flush(); assert.match(view.text(), /Free exploration/);
    assert.equal(controls.handleOutput({ type: 'action', actionId: 'another:next', componentId: 'another' }), false);
    // Destroying presentation does not dispose or cancel a borrowed controller.
    view.dispose(); assert.equal(journey.getSnapshot().disposed, false);
  } finally { await journey.dispose(); }
});

test('TouchOS playback uses explicit ownership, pause versus cancel, reverse replay and retained seek cancellation', async () => {
  const applied = [], joins = [], releases = [];
  const player = createJourneySequencePlayer({ sequence: { durationSecs: 10, evaluate: time => time },
    participant: { join() { const op = createJourneyOperation(); joins.push(op); return op.operation; },
      apply(frame) { applied.push(frame.timeSecs); }, release() { releases.push(true); } } });
  const controls = createSequenceTouchControls({ id: 'playback', player, rates: [-1, 1, 2] });
  const view = panel(controls, player.subscribe);
  try {
    view.click('playback:play'); player.update(1);
    assert.equal(player.getSnapshot().frame.timeSecs, 1); assert.equal(player.getSnapshot().ownership, 'detached');
    assert.equal(joins.length, 0); assert.deepEqual(applied, []);
    view.click('playback:play'); assert.equal(player.getSnapshot().status, 'paused');
    const seek = phase => controls.handleOutput({ type: 'change-request', componentId: 'playback:time', field: 'playback:time', value: 4, phase });
    assert.equal(seek('begin'), false); assert.equal(seek('update'), true); assert.equal(seek('cancel'), false);
    assert.equal(player.getSnapshot().frame.timeSecs, 4); assert.equal(player.getSnapshot().ownership, 'detached');
    view.click('playback:join'); assert.equal(player.getSnapshot().ownership, 'joining');
    joins[0].settle('completed'); await flush(); assert.equal(player.getSnapshot().ownership, 'attached');
    view.click('playback:play'); view.click('playback:play'); assert.equal(releases.length, 0);
    assert.equal(player.getSnapshot().ownership, 'attached');
    view.click('playback:rate'); assert.equal(player.getSnapshot().rate, 2);
    view.click('playback:rate'); assert.equal(player.getSnapshot().rate, -1);
    view.click('playback:replay'); assert.equal(player.getSnapshot().frame.timeSecs, 10);
    player.update(1); assert.equal(player.getSnapshot().frame.timeSecs, 9);
    view.click('playback:cancel'); assert.equal(player.getSnapshot().ownership, 'detached'); assert.equal(releases.length, 1);
    view.dispose(); assert.equal(player.getSnapshot().disposed, false);
  } finally { player.dispose(); }
});

test('restricted and zero-duration sequences render without inventing unsupported commands', () => {
  const player = createJourneySequencePlayer({ sequence: { durationSecs: 0, evaluate: () => null },
    participant: { capabilities: { seek: false, rates: [1] }, apply() {}, release() {} } });
  const controls = createSequenceTouchControls({ id: 'hold', player });
  const view = panel(controls, player.subscribe);
  try {
    assert.match(view.text(), /Time 0 seconds/);
    assert.equal(controls.handleOutput({ type: 'action', componentId: 'hold:replay', actionId: 'hold:replay' }), false);
    view.click('hold:rate'); assert.equal(player.getSnapshot().rate, 1);
    player.dispose(); view.click('hold:join'); assert.equal(player.getSnapshot().ownership, 'detached');
  } finally { view.dispose(); player.dispose(); }
});
