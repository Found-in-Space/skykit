import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createButton,
  createHoldButton,
  createNode,
  createRepeatButton,
  createRuntime as createTouchOsRuntime,
  createToggle,
} from '@found-in-space/touch-os';
import {
  createHudPanelDriver,
  createScenePanelDriver,
} from '@found-in-space/touch-os/hosts/three';
import * as THREE from 'three';

import {
  createSkykitSurfaceApp,
  createSkykitTabletRoot,
  createTouchOsHudPlugin,
  createTouchOsPanelPlugin,
} from '../touch-os.js';

test('real touch-os app intents route exactly once in app-actions mode', async (t) => {
  for (const forwardAppOutputs of [false, true]) {
    await t.test(`forwardAppOutputs=${forwardAppOutputs}`, () => {
      const source = createPointerSource('tablet-pointer');
      const actions = createActionRecorder();
      const app = createSkykitSurfaceApp({
        id: 'test.app.navigation',
        name: 'Navigation',
        node: createButton('fly-to-sun', {
          label: 'Fly to Sun',
          actionId: 'test.navigation.flyTo',
          payload: { target: 'sun' },
        }),
      });
      const root = createSkykitTabletRoot({
        id: 'test-tablet',
        apps: [app],
        initialSessions: [{
          appId: app.manifest.id,
          instanceId: 'navigation-instance',
          windowId: 'navigation-window',
          focused: true,
        }],
        forwardAppOutputs,
      });
      const harness = createRealPanelHarness({
        root,
        source,
        actions,
        actionOutputMode: 'app-actions',
      });

      harness.update(0);
      const button = findCommand(harness.runtime.render(), 'button-face', 'fly-to-sun');
      clickSurface(harness, source, button.rect, 0.1, 0.2);

      assert.deepEqual(actions.calls, [[
        'invoke',
        'test.navigation.flyTo',
        { target: 'sun' },
        {
          source: 'touch-os:app:test.app.navigation:navigation-window:navigation-instance:test.navigation.flyTo',
        },
      ]]);

      const appEvents = harness.outputs.filter((output) => output.type === 'app-event');
      const rawActions = harness.outputs.filter((output) => output.type === 'action');
      assert.equal(appEvents.length, 1);
      assert.equal(appEvents[0].event.type, 'app-action');
      assert.equal(appEvents[0].event.name, 'test.navigation.flyTo');
      assert.equal(rawActions.length, forwardAppOutputs ? 1 : 0);
      assert.equal(harness.outputs.length, forwardAppOutputs ? 2 : 1);

      harness.dispose();
    });
  }
});

test('real touch-os app field changes synchronize state once without action dispatch', () => {
  const source = createPointerSource('settings-pointer');
  const actions = createActionRecorder();
  const appChanges = [];
  const app = createSkykitSurfaceApp({
    id: 'test.app.settings',
    name: 'Settings',
    node: ({ state }) => createToggle('show-guides', {
      label: 'Show guides',
      field: 'showGuides',
      value: state?.showGuides === true,
    }),
  });
  const root = createSkykitTabletRoot({
    id: 'settings-tablet',
    apps: [app],
    initialSessions: [{
      appId: app.manifest.id,
      instanceId: 'settings-instance',
      windowId: 'settings-window',
      focused: true,
    }],
    appStates: {
      [app.manifest.id]: { showGuides: false },
    },
    onAppEvent(event) {
      if (event.type === 'app-change') appChanges.push(event);
    },
  });
  const harness = createRealPanelHarness({
    root,
    source,
    actions,
    actionOutputMode: 'app-actions',
  });

  harness.update(0);
  const toggle = findCommand(harness.runtime.render(), 'toggle-switch', 'show-guides');
  clickSurface(harness, source, toggle.rect, 0.1, 0.2);

  assert.equal(appChanges.length, 1);
  assert.equal(appChanges[0].name, 'showGuides.change');
  assert.deepEqual(appChanges[0].payload, { field: 'showGuides', value: true });
  assert.equal(actions.calls.length, 0);
  assert.equal(harness.outputs.filter((output) => output.type === 'app-event').length, 1);

  harness.dispose();
});

test('real touch-os raw-actions and none modes preserve output observability', async (t) => {
  for (const actionOutputMode of ['raw-actions', 'none']) {
    await t.test(actionOutputMode, () => {
      const source = createPointerSource(`mode-${actionOutputMode}`);
      const actions = createActionRecorder();
      const harness = createRealPanelHarness({
        root: createButton(`button-${actionOutputMode}`, {
          label: 'Select',
          actionId: 'test.selection.select',
          payload: { id: 'sol' },
        }),
        source,
        actions,
        actionOutputMode,
      });

      harness.update(0);
      const button = findCommand(harness.runtime.render(), 'button-face');
      clickSurface(harness, source, button.rect, 0.1, 0.2);

      assert.equal(harness.outputs.length, 1);
      assert.deepEqual(harness.outputs[0], {
        type: 'action',
        actionId: 'test.selection.select',
        componentId: `button-${actionOutputMode}`,
        payload: { id: 'sol' },
      });
      assert.equal(actions.calls.length, actionOutputMode === 'raw-actions' ? 1 : 0);
      if (actionOutputMode === 'raw-actions') {
        assert.deepEqual(actions.calls[0], [
          'invoke',
          'test.selection.select',
          { id: 'sol' },
          { source: `touch-os:button-${actionOutputMode}` },
        ]);
      }

      harness.dispose();
    });
  }
});

test('real HUD queues a DOM edge burst for one canonical driver update and tick', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  const target = createHudTarget(320, 240);
  const actions = createActionRecorder();
  const tickTimestamps = [];
  const driverFrames = [];
  let runtime = null;
  let part = null;

  const plugin = createTouchOsHudPlugin({
    target,
    root: createButton('dom-clock-button', {
      label: 'DOM clock',
      actionId: 'test.dom.clock',
    }),
    driverOptions: {
      createCanvas: createFakeCanvas,
    },
    createRuntime(options) {
      runtime = createTouchOsRuntime(options);
      const tick = runtime.tick.bind(runtime);
      runtime.tick = (timestamp) => {
        tickTimestamps.push(timestamp);
        return tick(timestamp);
      };
      return runtime;
    },
    createDriver(options) {
      const driver = createHudPanelDriver(options);
      const update = driver.update.bind(driver);
      driver.update = (frame) => {
        driverFrames.push(frame);
        return update(frame);
      };
      return driver;
    },
  });
  plugin.setup(createContext(actions, (value) => {
    part = value;
  }));
  assert.ok(part);
  part.attach();
  part.update(createFrame(0.1, scene, camera));

  target.dispatchPointerEvent('pointerdown', { pointerId: 4, timeStamp: 900_000 });
  target.dispatchPointerEvent('pointermove', { pointerId: 4, timeStamp: 900_001 });
  target.dispatchPointerEvent('pointerup', { pointerId: 4, timeStamp: 900_002 });
  assert.equal(driverFrames.length, 1);
  assert.deepEqual(tickTimestamps, [100]);

  part.update(createFrame(0.25, scene, camera));
  assert.equal(driverFrames.length, 2);
  assert.deepEqual(driverFrames[1].events.map((event) => event.type), [
    'pointer-down',
    'pointer-move',
    'pointer-up',
  ]);
  assert.deepEqual(driverFrames[1].events.map((event) => event.timestamp), [100, 100, 100]);
  assert.equal(driverFrames[1].timestamp, 250);
  assert.deepEqual(tickTimestamps, [100, 250]);

  part.dispose();
});

test('real Three driver uses one tick per SkyKit frame and canonical pointer timestamps', () => {
  const source = createPointerSource('timed-hold');
  const actions = createActionRecorder();
  const harness = createRealPanelHarness({
    root: createHoldButton('timed-hold-button', {
      label: 'Hold',
      actionId: 'test.ship.hold',
      startPayload: { phase: 'start' },
      stopPayload: { phase: 'stop' },
    }),
    source,
    actions,
  });

  harness.update(0);
  const hold = findCommand(harness.runtime.render(), 'hold-button-face');
  const point = centerOf(hold.rect);

  source.set(surfaceSample(source.pointerId, 'down', point, 900_000));
  harness.update(0.125);
  harness.update(0.125);
  harness.update(0.5);
  source.set(surfaceSample(source.pointerId, 'up', point, 1));
  harness.update(0.75);

  assert.deepEqual(harness.driverFrameTimestamps, [0, 125, 125, 500, 750]);
  assert.deepEqual(harness.tickTimestamps, harness.driverFrameTimestamps);
  assert.equal(harness.driverUpdateCount, 5);
  assert.equal(harness.tickTimestamps.length, 5);
  assert.deepEqual(
    harness.pointerSamples.map((sample) => sample.timestamp),
    [125, 125, 500, 750],
  );
  assert.deepEqual(actions.calls, [
    [
      'press',
      'test.ship.hold',
      { phase: 'start' },
      { source: 'touch-os:timed-hold-button' },
    ],
    [
      'release',
      'test.ship.hold',
      { source: 'touch-os:timed-hold-button' },
    ],
  ]);
  assert.deepEqual(
    harness.outputs.map((output) => output.payload?.phase),
    ['start', 'stop'],
  );

  harness.dispose();
});

test('real runtime fires long-press from SkyKit elapsed time once at the threshold', () => {
  const source = createPointerSource('long-press-pointer');
  const actions = createActionRecorder();
  const harness = createRealPanelHarness({
    root: createLongPressActionNode('long-press-target', 'test.longPress'),
    source,
    actions,
    runtimeOptions: { longPressDelay: 300 },
  });

  harness.update(0);
  const target = findCommand(harness.runtime.render(), 'long-press-target');
  const point = centerOf(target.rect);
  source.set(surfaceSample(source.pointerId, 'down', point));
  harness.update(0.1);
  harness.update(0.399);
  assert.deepEqual(actions.calls, []);

  harness.update(0.4);
  assert.deepEqual(actions.calls, [[
    'invoke',
    'test.longPress',
    { timestamp: 400 },
    { source: 'touch-os:long-press-target' },
  ]]);

  harness.update(0.4);
  harness.update(0.8);
  assert.equal(actions.calls.length, 1);
  assert.deepEqual(harness.driverFrameTimestamps, [0, 100, 399, 400, 400, 800]);
  assert.deepEqual(harness.tickTimestamps, harness.driverFrameTimestamps);

  source.set(surfaceSample(source.pointerId, 'up', point));
  harness.update(0.9);
  assert.equal(actions.calls.length, 1);
  harness.dispose();
});

test('real repeat button advances from SkyKit elapsed time without repeated-timestamp duplication', () => {
  const source = createPointerSource('repeat-pointer');
  const actions = createActionRecorder();
  const harness = createRealPanelHarness({
    root: createRepeatButton('repeat-target', {
      label: 'Repeat',
      actionId: 'test.repeat',
      payload: { step: 1 },
      repeatDelayMs: 300,
      repeatIntervalMs: 100,
    }),
    source,
    actions,
  });

  harness.update(0);
  const target = findCommand(harness.runtime.render(), 'repeat-button-face');
  const point = centerOf(target.rect);
  source.set(surfaceSample(source.pointerId, 'down', point));
  harness.update(0.1);
  assert.equal(actions.calls.length, 1);

  harness.update(0.399);
  assert.equal(actions.calls.length, 1);
  harness.update(0.4);
  assert.equal(actions.calls.length, 2);
  harness.update(0.4);
  assert.equal(actions.calls.length, 2);
  harness.update(0.65);
  assert.equal(actions.calls.length, 4);
  harness.update(0.65);
  assert.equal(actions.calls.length, 4);

  assert.deepEqual(actions.calls, Array.from({ length: 4 }, () => [
    'invoke',
    'test.repeat',
    { step: 1 },
    { source: 'touch-os:repeat-target' },
  ]));
  assert.deepEqual(harness.driverFrameTimestamps, [0, 100, 399, 400, 400, 650, 650]);
  assert.deepEqual(harness.tickTimestamps, harness.driverFrameTimestamps);

  source.set(surfaceSample(source.pointerId, 'up', point));
  harness.update(0.7);
  harness.update(1);
  assert.equal(actions.calls.length, 4);
  harness.dispose();
});

test('real Three host reuses a stable render without another canvas draw or texture upload', () => {
  const harness = createRealPanelHarness({
    root: createButton('stable-button', {
      label: 'Stable',
      actionId: 'test.stable',
    }),
    actions: createActionRecorder(),
  });

  harness.update(0);
  const firstSnapshot = harness.runtime.render();
  const firstDrawCount = harness.canvasDrawCount;
  const firstTextureVersion = harness.driver.host.texture.version;
  assert.equal(firstDrawCount, 1);

  harness.update(0.1);
  harness.update(0.2);
  harness.update(0.2);

  assert.equal(harness.driverUpdateCount, 4);
  assert.deepEqual(harness.tickTimestamps, [0, 100, 200, 200]);
  assert.equal(harness.canvasDrawCount, firstDrawCount);
  assert.equal(harness.driver.host.texture.version, firstTextureVersion);
  assert.equal(harness.runtime.render().revision, firstSnapshot.revision);
  harness.dispose();
});

test('real Three driver drains hold cancellation on clear, detach, and disposal', async (t) => {
  for (const cleanup of ['clear', 'detach', 'dispose']) {
    await t.test(cleanup, () => {
      const source = createPointerSource(`cleanup-${cleanup}`);
      const actions = createActionRecorder();
      const harness = createRealPanelHarness({
        root: createHoldButton(`hold-${cleanup}`, {
          label: 'Hold',
          actionId: 'test.ship.cleanup',
          startPayload: { phase: 'start', cleanup },
          stopPayload: { phase: 'stop', cleanup },
        }),
        source,
        actions,
      });

      harness.update(0);
      const hold = findCommand(harness.runtime.render(), 'hold-button-face');
      const point = centerOf(hold.rect);
      source.set(surfaceSample(source.pointerId, 'down', point));
      harness.update(0.1);
      assert.deepEqual(actions.calls.map(([kind]) => kind), ['press']);

      if (cleanup === 'clear') {
        harness.plugin.clearPointer(source.pointerId);
      } else if (cleanup === 'detach') {
        harness.part.detach();
      } else {
        harness.part.dispose();
      }

      assert.deepEqual(actions.calls.map(([kind]) => kind), ['press', 'release']);
      assert.equal(actions.calls[0][3].source, `touch-os:hold-${cleanup}`);
      assert.equal(actions.calls[1][2].source, actions.calls[0][3].source);
      assert.deepEqual(
        harness.outputs.map((output) => output.payload?.phase),
        ['start', 'stop'],
      );

      if (cleanup === 'clear') {
        source.set(surfaceSample(source.pointerId, 'down', point));
        harness.update(0.2);
        source.set(surfaceSample(source.pointerId, 'up', point));
        harness.update(0.3);
        assert.deepEqual(actions.calls.map(([kind]) => kind), [
          'press',
          'release',
          'press',
          'release',
        ]);
        harness.dispose();
      } else if (cleanup === 'detach') {
        harness.part.attach();
        source.set(surfaceSample(source.pointerId, 'down', point));
        harness.update(0.2);
        assert.deepEqual(actions.calls.map(([kind]) => kind), [
          'press',
          'release',
          'press',
        ]);
        harness.plugin.clearPointer(source.pointerId);
        assert.deepEqual(actions.calls.map(([kind]) => kind), [
          'press',
          'release',
          'press',
          'release',
        ]);
        harness.dispose();
      } else {
        harness.part.dispose();
        assert.deepEqual(actions.calls.map(([kind]) => kind), ['press', 'release']);
      }
    });
  }
});

test('real panel blocker raycasts each current ray without dispatching input', () => {
  const harness = createRealPanelHarness({
    root: createButton('blocker-button', {
      label: 'Do not dispatch',
      actionId: 'test.blocker.action',
    }),
    actions: createActionRecorder(),
  });

  harness.update(0);
  const before = harness.runtime.getInteraction();
  const dispatchCount = harness.dispatchInputCount;
  const first = harness.plugin.blockRay(testRay(
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: -4 },
    3,
  ));
  const independentMiss = harness.plugin.blockRay(testRay(
    { x: 2, y: 0, z: 2 },
    { x: 0, y: 0, z: -1 },
    3,
  ));

  assert.equal(first?.distance, 2);
  assert.equal(independentMiss, null);
  assert.equal(harness.plugin.blockRay(testRay(
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: -1 },
    1.5,
  )), null);
  assert.equal(harness.plugin.blockRay(testRay(
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: -1 },
    3,
  ), { maxDistance: 1.5 }), null);

  harness.driver.host.mesh.position.z = 1;
  const moved = harness.plugin.blockRay(testRay(
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: -1 },
    3,
  ));
  assert.equal(moved?.distance, 1);
  assert.equal(harness.dispatchInputCount, dispatchCount);
  assert.deepEqual(harness.runtime.getInteraction(), before);
  assert.equal(harness.driver.getPointerState('blocker-query'), undefined);
  assert.equal(harness.driver.getHit(), null);
  assert.deepEqual(harness.outputs, []);

  harness.part.detach();
  assert.equal(harness.plugin.blockRay(testRay(
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: -1 },
    3,
  )), null);
  harness.dispose();
});

function createRealPanelHarness({
  root,
  source,
  actions,
  actionOutputMode = 'raw-actions',
  runtimeOptions,
}) {
  const outputs = [];
  const tickTimestamps = [];
  const driverFrameTimestamps = [];
  const pointerSamples = [];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.z = 2;
  camera.lookAt(0, 0, 0);
  let runtime;
  let driver;
  let part;
  let driverUpdateCount = 0;
  let dispatchInputCount = 0;
  const canvasStats = { drawCount: 0 };

  const plugin = createTouchOsPanelPlugin({
    id: `real-panel-${root.id}`,
    root,
    actionOutputMode,
    ...(runtimeOptions ? { runtimeOptions } : {}),
    ...(source ? { pointerSources: [source] } : {}),
    surfaceMetrics: { width: 320, height: 240, pixelDensity: 1 },
    driverOptions: {
      panelWidth: 1,
      panelHeight: 1,
      createCanvas(metrics) {
        return createFakeCanvas(metrics, canvasStats);
      },
    },
    createRuntime(options) {
      runtime = createTouchOsRuntime(options);
      const tick = runtime.tick.bind(runtime);
      runtime.tick = (timestamp) => {
        tickTimestamps.push(timestamp);
        return tick(timestamp);
      };
      const dispatchInput = runtime.dispatchInput.bind(runtime);
      runtime.dispatchInput = (event) => {
        dispatchInputCount += 1;
        return dispatchInput(event);
      };
      return runtime;
    },
    createDriver(options) {
      const pointerSources = (options.pointerSources ?? []).map((pointerSource) => ({
        sample(frame) {
          const samples = pointerSource.sample(frame);
          pointerSamples.push(...samples.map((sample) => ({ ...sample })));
          return samples;
        },
        ...(pointerSource.clear
          ? {
              clear() {
                pointerSource.clear();
              },
            }
          : {}),
      }));
      driver = createScenePanelDriver({
        ...options,
        pointerSources,
      });
      const update = driver.update.bind(driver);
      driver.update = (frame) => {
        driverUpdateCount += 1;
        driverFrameTimestamps.push(frame.timestamp);
        return update(frame);
      };
      return driver;
    },
    onOutput(output) {
      outputs.push(output);
    },
  });

  plugin.setup(createContext(actions ?? createActionRecorder(), (value) => {
    part = value;
  }));
  assert.ok(runtime, 'the plugin should create a real touch-os runtime');
  assert.ok(driver, 'the plugin should create a real Three panel driver');
  assert.ok(part, 'the plugin should install a SkyKit part');
  part.attach();

  return {
    plugin,
    part,
    runtime,
    driver,
    outputs,
    tickTimestamps,
    driverFrameTimestamps,
    pointerSamples,
    get driverUpdateCount() {
      return driverUpdateCount;
    },
    get dispatchInputCount() {
      return dispatchInputCount;
    },
    get canvasDrawCount() {
      return canvasStats.drawCount;
    },
    update(elapsedSeconds) {
      part.update(createFrame(elapsedSeconds, scene, camera));
    },
    dispose() {
      part.dispose();
    },
  };
}

function createActionRecorder() {
  const calls = [];
  return {
    calls,
    press(actionId, payload, metadata) {
      calls.push(['press', actionId, payload, metadata]);
    },
    release(actionId, metadata) {
      calls.push(['release', actionId, metadata]);
    },
    invoke(actionId, payload, metadata) {
      calls.push(['invoke', actionId, payload, metadata]);
      return Promise.resolve([]);
    },
  };
}

function createPointerSource(pointerId) {
  let current = null;
  return {
    pointerId,
    set(sample) {
      current = sample;
    },
    sample() {
      return current ? [current] : [];
    },
    clear() {
      current = null;
    },
  };
}

function surfaceSample(pointerId, phase, point, timestamp = 999_999) {
  return {
    pointerId,
    pointerType: 'controller',
    transport: 'surface',
    phase,
    timestamp,
    surfaceX: point.x,
    surfaceY: point.y,
  };
}

function clickSurface(harness, source, rect, downSeconds, upSeconds) {
  const point = centerOf(rect);
  source.set(surfaceSample(source.pointerId, 'down', point));
  harness.update(downSeconds);
  source.set(surfaceSample(source.pointerId, 'up', point));
  harness.update(upSeconds);
  source.set(null);
}

function findCommand(snapshot, role, componentIdSuffix) {
  const command = snapshot.commands.find((candidate) => (
    candidate.role === role
    && (componentIdSuffix === undefined || candidate.componentId.endsWith(componentIdSuffix))
  ));
  assert.ok(command, `expected a rendered ${role} command`);
  return command;
}

function centerOf(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function createLongPressActionNode(id, actionId) {
  return createNode(id, {
    kind: 'test-long-press-action',
    measure(ctx) {
      return {
        width: ctx.constraints.maxWidth,
        height: ctx.constraints.maxHeight,
      };
    },
    render(ctx) {
      return [{
        type: 'rect',
        componentId: ctx.id,
        role: 'long-press-target',
        rect: ctx.bounds,
        fill: '#000000',
      }];
    },
    hitTest(ctx) {
      const { x, y, width, height } = ctx.bounds;
      return ctx.point.x >= x
        && ctx.point.x <= x + width
        && ctx.point.y >= y
        && ctx.point.y <= y + height
        ? { targetId: `${ctx.id}:face`, role: 'long-press-target' }
        : null;
    },
    handleEvent(ctx) {
      if (ctx.event.type === 'long-press') {
        ctx.emit({
          type: 'action',
          actionId,
          componentId: ctx.id,
          payload: { timestamp: ctx.event.timestamp },
        });
      }
    },
  }, {});
}

function createContext(actions, addPart) {
  return {
    mode: 'three',
    viewer: { id: 'real-touch-os-test-viewer', actions },
    actions,
    addPart(value) {
      addPart(value);
      return () => {};
    },
    addDisposable() {
      return () => {};
    },
    getViewState() {
      return createViewState();
    },
    requestViewState() {},
    on() {
      return () => {};
    },
    emit() {},
    useStore(_key, factory) {
      return factory();
    },
    useResource(_key, factory) {
      return factory();
    },
    scheduleTask() {
      return () => {};
    },
  };
}

function createFrame(elapsedSeconds, scene, camera) {
  const view = createViewState();
  return {
    viewer: { id: 'real-touch-os-test-viewer' },
    deltaSeconds: 0.016,
    elapsedSeconds,
    view,
    renderer: {},
    scene,
    camera,
    roots: {
      originContentRoot: scene,
      observerContentRoot: scene,
      scaleBandedContentRoots: new Map(),
      navigationRoot: scene,
    },
    observerRig: {
      type: 'test',
      getObserverPc() {
        return view.observerPc;
      },
      getRenderObserverPosition() {
        return view.renderObserverPosition;
      },
    },
  };
}

function createViewState() {
  return {
    revision: 0,
    observerPc: { x: 0, y: 0, z: 0 },
    renderObserverPosition: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6,
    coordinateUnitsPerParsec: 1,
  };
}

function createFakeCanvas(metrics, stats = { drawCount: 0 }) {
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    setTransform() {},
    translate() {},
    scale() {},
    clearRect() {
      stats.drawCount += 1;
    },
    beginPath() {},
    rect() {},
    clip() {},
    roundRect() {},
    fillRect() {},
    strokeRect() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
    fillText() {},
    measureText(text) {
      return { width: String(text).length * 8 };
    },
    drawImage() {},
    closePath() {},
  };
  return {
    width: Math.max(1, Math.round(metrics.width * metrics.pixelDensity)),
    height: Math.max(1, Math.round(metrics.height * metrics.pixelDensity)),
    getContext(type) {
      return type === '2d' ? context : null;
    },
  };
}

function createHudTarget(width, height) {
  const listeners = new Map();
  return {
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect() {
      return { left: 0, top: 0, width, height };
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchPointerEvent(type, overrides = {}) {
      const event = {
        type,
        pointerId: overrides.pointerId ?? 1,
        pointerType: overrides.pointerType ?? 'mouse',
        clientX: overrides.clientX ?? width / 2,
        clientY: overrides.clientY ?? height / 2,
        pressure: overrides.pressure ?? (type === 'pointerup' ? 0 : 1),
        timeStamp: overrides.timeStamp ?? 0,
        defaultPrevented: false,
        immediatePropagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
          this.immediatePropagationStopped = true;
        },
      };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
  };
}

function testRay(origin, direction, length) {
  return {
    id: 'blocker-query',
    kind: 'custom',
    handedness: null,
    origin,
    direction,
    length,
  };
}
