import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuidedJourneyController } from '@found-in-space/guided-journey';
import { exerciseJourneyDriver } from '@found-in-space/guided-journey/testing';
import { createSkykitNavigationPlugin, createSkykitViewer, SKYKIT_ACTIONS } from '../index.js';
import { createSkykitJourneyDriver } from '../journey.js';

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
async function fixture() {
  const navigation = createSkykitNavigationPlugin();
  const viewer = await createSkykitViewer({ view: { observerPc: { x: 3, y: 4, z: 5 } }, plugins: [navigation] });
  const driver = createSkykitJourneyDriver({ viewer, navigation });
  const journey = createGuidedJourneyController({ driver, definition: { id: 'stars', transition: { durationSecs: 1 }, chapters: [
    { id: 'a', scene: { camera: { observerPc: { x: 20, y: 0, z: 0 }, lookAt: { targetPc: { x: 0, y: 0, z: 0 } } } } },
    { id: 'b', scene: { camera: { observerPc: { x: -10, y: 2, z: 3 }, lookAt: { targetPc: { x: 0, y: 0, z: 0 } } } } },
  ] } });
  return { viewer, navigation, journey };
}

test('journey preserves the first rendered pose and only arrives after the final queued sample is applied', async () => {
  const { viewer, journey } = await fixture();
  const before = viewer.getViewState();
  const operation = journey.start(); await flush();
  viewer.frame(0); viewer.frame(0);
  assert.deepEqual(viewer.getViewState().observerPc, before.observerPc);
  assert.deepEqual(viewer.getViewState().orientationIcrs, before.orientationIcrs);
  viewer.frame(1e-7); viewer.frame(0);
  const tiny = viewer.getViewState();
  assert.ok(Math.hypot(tiny.observerPc.x - before.observerPc.x, tiny.observerPc.y - before.observerPc.y,
    tiny.observerPc.z - before.observerPc.z) < 1e-5);
  assert.ok(Math.hypot(...['x', 'y', 'z', 'w'].map(axis => tiny.orientationIcrs[axis] - before.orientationIcrs[axis])) < 1e-5);
  viewer.frame(1); await flush();
  assert.equal(journey.getSnapshot().arrivedChapterId, null);
  viewer.frame(0); await flush();
  assert.equal((await operation.finished).status, 'completed');
  assert.deepEqual(viewer.getViewState().observerPc, { x: 20, y: 0, z: 0 });
  await journey.dispose(); await viewer.dispose();
});

test('cancel supersedes queued camera writes and re-entry starts at manual live pose', async () => {
  const { viewer, journey } = await fixture();
  const first = journey.start(); await flush(); viewer.frame(0.4); viewer.frame(0.2);
  const displayed = viewer.getViewState();
  journey.cancel(); viewer.frame(0); await flush();
  assert.equal((await first.finished).status, 'cancelled');
  assert.deepEqual(viewer.getViewState().observerPc, displayed.observerPc);
  viewer.requestViewState({ observerPc: { x: 8, y: -3, z: 9 }, orientationIcrs: { x: 0, y: 1, z: 0, w: 0 } });
  viewer.frame(0); const manual = viewer.getViewState();
  const next = journey.goTo('b'); await flush(); viewer.frame(0); viewer.frame(0);
  assert.deepEqual(viewer.getViewState().observerPc, manual.observerPc);
  assert.deepEqual(viewer.getViewState().orientationIcrs, manual.orientationIcrs);
  viewer.frame(1); viewer.frame(0); await flush();
  assert.equal((await next.finished).status, 'completed');
  await journey.dispose(); await viewer.dispose();
});

test('semantic commands and typed operations share supersession and manual lane cancellation', async () => {
  const { viewer, navigation, journey } = await fixture();
  const op = navigation.transitionTo({ observerPc: { x: 10, y: 0, z: 0 }, durationSecs: 2 }); await flush();
  const result = await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, { observerPc: { x: 30, y: 0, z: 0 }, durationSecs: 1 });
  assert.equal((await op.finished).status, 'superseded');
  const replacement = result[0].value;
  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.cancelMovement);
  assert.equal((await replacement.finished).status, 'cancelled');
  await journey.dispose(); await viewer.dispose();
});

test('shared cross-host conformance fixture runs through the actual stellar viewer', async () => {
  const { viewer, navigation, journey } = await fixture();
  const driver = createSkykitJourneyDriver({ viewer, navigation });
  try {
    await exerciseJourneyDriver({ driver,
      scenes: [0, 1, 2].map(x => ({ camera: { observerPc: { x, y: 0, z: 0 } } })),
      async advance() { await flush(); viewer.frame(0); viewer.frame(.2); viewer.frame(0); await flush(); },
    });
  } finally { await journey.dispose(); await viewer.dispose(); }
});
