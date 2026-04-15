import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __resetDemoViewerDebugConsoleForTests,
  installDemoViewerDebugConsole,
} from '../viewer-debug-console.js';

function createViewerStub(overrides = {}) {
  const state = { observerPc: { x: 1, y: 2, z: 3 }, targetPc: null };
  const calls = {
    setState: [],
    refreshSelection: 0,
    flyTo: [],
    lookAt: [],
    cancelAutomation: 0,
    dispose: 0,
  };
  const navigationController = {
    flyTo(targetPc, options = {}) {
      calls.flyTo.push({ targetPc, options });
      options.onArrive?.();
    },
    lookAt(targetPc, options = {}) {
      calls.lookAt.push({ targetPc, options });
    },
    cancelAutomation() {
      calls.cancelAutomation += 1;
    },
  };
  const viewer = {
    runtime: {
      id: overrides.id ?? 'stub-viewer',
      rigType: overrides.rigType ?? 'desktop',
      controllers: overrides.controllers ?? [navigationController],
    },
    getSnapshotState() {
      return { state: { ...state } };
    },
    setState(nextState) {
      calls.setState.push(nextState);
      Object.assign(state, nextState);
    },
    async refreshSelection() {
      calls.refreshSelection += 1;
    },
    async dispose() {
      calls.dispose += 1;
    },
  };
  return { viewer, calls, state, navigationController };
}

test.afterEach(() => {
  __resetDemoViewerDebugConsoleForTests();
});

test('demo viewer debug console exposes active viewer observer and flyTo', async () => {
  const { viewer, calls } = createViewerStub();

  installDemoViewerDebugConsole(viewer, { id: 'free-roam' });

  assert.deepEqual(globalThis.skykitDebug.listViewers(), [
    {
      index: 0,
      id: 'free-roam',
      label: 'free-roam',
      rigType: 'desktop',
      active: true,
      canFlyTo: true,
      canLookAt: true,
    },
  ]);
  assert.deepEqual(globalThis.skykitDebug.getObserverPc(), { x: 1, y: 2, z: 3 });

  const targetPc = globalThis.skykitDebug.flyToPc(10, 20, 30, { speed: 42 });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(targetPc, { x: 10, y: 20, z: 30 });
  assert.deepEqual(calls.flyTo[0].targetPc, { x: 10, y: 20, z: 30 });
  assert.equal(calls.flyTo[0].options.speed, 42);
  assert.equal(calls.refreshSelection, 1);
});

test('demo viewer debug console can switch active viewer and falls back to setState without flyTo', async () => {
  const first = createViewerStub({ id: 'first' });
  const second = createViewerStub({ id: 'second', controllers: [] });

  installDemoViewerDebugConsole(first.viewer, { id: 'first', makeActive: true });
  installDemoViewerDebugConsole(second.viewer, { id: 'second', makeActive: false });

  assert.equal(globalThis.skykitDebug.getViewer().id, 'first');
  assert.equal(globalThis.skykitDebug.useViewer('second').id, 'second');

  const targetPc = globalThis.skykitDebug.flyToPc({ x: -4, y: 5, z: 6 });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(targetPc, { x: -4, y: 5, z: 6 });
  assert.deepEqual(second.calls.setState, [
    { observerPc: { x: -4, y: 5, z: 6 } },
  ]);
  assert.equal(second.calls.refreshSelection, 1);
});

test('demo viewer debug console unregisters viewers on dispose', async () => {
  const { viewer, calls } = createViewerStub({ id: 'dispose-me' });

  installDemoViewerDebugConsole(viewer, { id: 'dispose-me' });
  assert.equal(globalThis.skykitDebug.listViewers().length, 1);

  await viewer.dispose();

  assert.equal(calls.dispose, 1);
  assert.equal(globalThis.skykitDebug.listViewers().length, 0);
});

test('demo viewer debug console supports galactic-frame getters and flyTo', async () => {
  const { viewer, calls, state } = createViewerStub();

  installDemoViewerDebugConsole(viewer, { id: 'galactic-demo' });

  const galacticPc = globalThis.skykitDebug.getGalacticPc();
  assert.ok(galacticPc && Number.isFinite(galacticPc.x));
  assert.ok(Number.isFinite(galacticPc.y));
  assert.ok(Number.isFinite(galacticPc.z));

  const targetGalacticPc = { x: -500, y: 0, z: 0 };
  const returnedTarget = globalThis.skykitDebug.flyToGalacticPc(targetGalacticPc);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(returnedTarget, targetGalacticPc);
  assert.equal(calls.flyTo.length, 1);
  assert.notDeepEqual(calls.flyTo[0].targetPc, targetGalacticPc);
  assert.ok(Math.abs(calls.flyTo[0].targetPc.x - 27.4377802) < 1e-6);
  assert.ok(Math.abs(calls.flyTo[0].targetPc.y - 436.7185451) < 1e-6);
  assert.ok(Math.abs(calls.flyTo[0].targetPc.z - 241.91750775) < 1e-6);

  const roundTrippedGalacticPc = globalThis.skykitDebug.getViewer().getGalacticPc();
  const directGalacticPc = globalThis.skykitDebug.getViewer().getGalacticPc();
  assert.deepEqual(roundTrippedGalacticPc, directGalacticPc);
  assert.deepEqual(state.observerPc, { x: 1, y: 2, z: 3 });
});
