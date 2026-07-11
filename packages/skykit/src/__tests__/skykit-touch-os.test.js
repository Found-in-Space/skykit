import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createRuntime } from '@found-in-space/touch-os';

import {
  SKYKIT_ACTIONS,
  createSkykitActionRegistry,
} from '../index.js';
import {
  createSkykitShipControlsRoot,
  createSkykitSurfaceApp,
  createSkykitTabletRoot,
  createSkykitTouchOsPointerSource,
  createTouchOsHudPlugin,
  createTouchOsPanelPlugin,
  dispatchTouchOsActionOutputs,
  pointerEventToTouchOs,
  resolveTouchOsSurfaceMetrics,
} from '../touch-os.js';

test('dispatchTouchOsActionOutputs maps touch-os action phases to SkyKit actions', () => {
  const calls = [];
  const actions = {
    press(id, payload, metadata) {
      calls.push(['press', id, payload, metadata]);
    },
    release(id, metadata) {
      calls.push(['release', id, metadata]);
    },
    invoke(id, payload, metadata) {
      calls.push(['invoke', id, payload, metadata]);
      return Promise.resolve([]);
    },
  };

  const count = dispatchTouchOsActionOutputs([
    { type: 'ignored' },
    { type: 'action', actionId: 'ship.forward', componentId: 'forward', payload: { phase: 'start' } },
    { type: 'action', actionId: 'ship.forward', componentId: 'forward', payload: { phase: 'stop' } },
    { type: 'action', actionId: 'app.look', componentId: 'look', payload: { target: 'sun' } },
  ], actions, { sourcePrefix: 'test-touch' });

  assert.equal(count, 3);
  assert.deepEqual(calls, [
    ['press', 'ship.forward', { phase: 'start' }, { source: 'test-touch:forward' }],
    ['release', 'ship.forward', { source: 'test-touch:forward' }],
    ['invoke', 'app.look', { target: 'sun' }, { source: 'test-touch:look' }],
  ]);
});

test('dispatchTouchOsActionOutputs validates app events and never mixes forwarded raw actions', () => {
  const calls = [];
  const actions = {
    press(id, payload, metadata) {
      calls.push(['press', id, payload, metadata]);
    },
    release(id, metadata) {
      calls.push(['release', id, metadata]);
    },
    invoke(id, payload, metadata) {
      calls.push(['invoke', id, payload, metadata]);
      return Promise.resolve([]);
    },
  };
  const appStart = {
    type: 'app-event',
    appId: 'space.found.controls',
    windowId: 'controls-window',
    instanceId: 'controls-instance',
    componentId: 'controls-window:hold',
    event: {
      type: 'app-action',
      name: 'ship:boost',
      payload: { phase: 'start', amount: 2 },
    },
  };
  const appStop = {
    ...appStart,
    event: {
      type: 'app-action',
      name: 'ship:boost',
      payload: { phase: 'stop' },
    },
  };
  const forwardedRaw = {
    type: 'action',
    actionId: 'ship:boost',
    componentId: 'controls-window:hold',
    payload: { phase: 'start' },
  };

  assert.equal(dispatchTouchOsActionOutputs([
    appStart,
    forwardedRaw,
    { type: 'app-event', event: { type: 'app-action', name: 42 } },
    appStop,
  ], actions, {
    actionOutputMode: 'app-actions',
    sourcePrefix: 'tablet',
  }), 2);

  const stableSource = 'tablet:app:space.found.controls:controls-window:controls-instance:ship%3Aboost';
  assert.deepEqual(calls, [
    ['press', 'ship:boost', { phase: 'start', amount: 2 }, { source: stableSource }],
    ['release', 'ship:boost', { source: stableSource }],
  ]);

  assert.equal(dispatchTouchOsActionOutputs([appStart, forwardedRaw], actions, {
    actionOutputMode: 'none',
  }), 0);
  assert.equal(calls.length, 2);
});

test('createSkykitShipControlsRoot builds reusable pseudo-key controls and status', () => {
  const root = createSkykitShipControlsRoot({
    id: 'test-ship-controls',
    status: { label: 'Stars', value: '42k' },
    commands: [
      { id: 'look-sun', label: 'Look Sun', actionId: 'app.lookSun' },
      { id: 'boost', label: 'Boost', actionId: SKYKIT_ACTIONS.ship.boost, hold: true },
    ],
  });

  assert.equal(root.id, 'test-ship-controls');
  assert.equal(root.component.kind, 'dock-layout');
  assert.equal(root.props.topCenter.child.component.kind, 'value-readout');
  assert.equal(root.props.bottomLeft.child.props.up.actionId, SKYKIT_ACTIONS.ship.moveForward);
  assert.equal(root.props.bottomLeft.child.props.left.actionId, SKYKIT_ACTIONS.ship.moveLeft);
  assert.equal(root.props.bottomRight.child.component.kind, 'column');
  assert.deepEqual(
    root.props.bottomRight.child.props.children.map((child) => [child.id, child.component.kind]),
    [
      ['test-ship-controls:up', 'hold-button'],
      ['test-ship-controls:down', 'hold-button'],
      ['look-sun', 'button'],
      ['boost', 'hold-button'],
    ],
  );
});

test('createSkykitTabletRoot builds a tablet app shell from touch apps', () => {
  const app = createSkykitSurfaceApp({
    id: 'app.surface',
    name: 'Surface',
    node: createSkykitShipControlsRoot({ id: 'surface-child', movePad: false, verticalControls: false }),
  });
  const root = createSkykitTabletRoot({
    id: 'test-tablet',
    apps: [app],
    appStates: { 'app.surface': { ready: true } },
  });

  assert.equal(root.id, 'test-tablet');
  assert.equal(root.component.kind, 'app-shell');
  assert.equal(root.props.presentation.kind, 'tablet-home');
  assert.equal(root.props.appHostMode, 'same-runtime');
  assert.equal(root.props.homeKey, true);
  assert.deepEqual(root.props.registry.list().map((manifest) => manifest.id), ['app.surface']);

  const runtime = createRuntime({
    root,
    surface: { width: 320, height: 240 },
  });
  const snapshot = runtime.render();
  assert.equal(snapshot.commands.some((command) => command.role === 'tablet-home-button'), true);
  assert.equal(snapshot.commands.some((command) => command.role === 'tablet-home-bar'), false);
});

test('createSkykitSurfaceApp wraps display nodes and emits app events', () => {
  const emitted = [];
  const app = createSkykitSurfaceApp({
    id: 'app.hr',
    name: 'HR',
    node: () => createSkykitShipControlsRoot({ id: 'hr-child', movePad: false, verticalControls: false }),
  });
  const instance = app.createApp({
    appId: 'app.hr',
    instanceId: 'app-1',
    windowId: 'app-1-window',
    surface: { width: 420, height: 300, pixelDensity: 1, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } },
    theme: { getTokens() { return {}; } },
    actions: { emit(event) { emitted.push(event); } },
    windows: {
      setTitle() {},
      requestClose() {},
      requestResize() {},
      openApp() {},
    },
  });

  const root = instance.render({});
  assert.equal(app.manifest.id, 'app.hr');
  assert.deepEqual(app.manifest.capabilities, ['surfaces']);
  assert.equal(root.component.kind, 'skykit-surface-app-frame');
  assert.equal(root.props.child.id, 'hr-child');

  instance.handleOutput({ type: 'action', actionId: 'app.fly', componentId: 'fly', payload: { target: 'sun' } });
  assert.deepEqual(emitted, [{
    type: 'app-action',
    appId: 'app.hr',
    instanceId: 'app-1',
    windowId: 'app-1-window',
    name: 'app.fly',
    payload: { target: 'sun' },
    componentId: 'fly',
  }]);
});

test('touch-os pointer helpers resolve screen input and surface metrics', () => {
  const target = createTarget({ width: 640, height: 360, pixelRatio: 3 });
  const metrics = resolveTouchOsSurfaceMetrics(target, { pixelDensity: 1.5 });
  const event = target.createPointerEvent('pointerdown', {
    pointerId: 7,
    clientX: 640,
    clientY: 360,
  });
  const hostEvent = pointerEventToTouchOs(event, target);
  const canonicalEvent = pointerEventToTouchOs(event, target, 250);

  assert.deepEqual(metrics, {
    width: 640,
    height: 360,
    pixelDensity: 1.5,
    orientation: 'landscape',
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  assert.equal(hostEvent.type, 'pointer-down');
  assert.equal(hostEvent.pointerId, '7');
  assert.equal(hostEvent.ndcX, 1);
  assert.equal(hostEvent.ndcY, -1);
  assert.equal(hostEvent.timestamp, 0);
  assert.equal(canonicalEvent.timestamp, 250);
});

test('createTouchOsHudPlugin attaches a HUD part, updates roots, and claims pointer actions', () => {
  const target = createTarget({ width: 800, height: 600 });
  const actions = createSkykitActionRegistry();
  const invoked = [];
  const roots = [];
  const driverFrames = [];
  const driverLifecycle = { attach: 0, detach: 0, clear: 0 };
  const queuedOutputs = [];
  const observedOutputs = [];
  let addedPart = null;
  let latestHit = null;

  actions.registerAction('app.lookSun', ({ payload, metadata }) => {
    invoked.push({ payload, metadata });
  });

  const runtime = {
    setRoot(root) {
      roots.push(root);
    },
    render() {
      return { commands: [], sharedSurfaceRevision: 0 };
    },
    dispatchInput() {
      return { handled: false, componentId: undefined, targetId: undefined, outputs: [] };
    },
    resize() {},
    tick() {
      assert.fail('The SkyKit bridge must let the touch-os driver own runtime.tick().');
    },
    takeOutputs() {
      return queuedOutputs.splice(0);
    },
    getServices() {
      return {};
    },
    getInteraction() {
      return {};
    },
    getBounds() {
      return undefined;
    },
    isLayoutDirty() {
      return false;
    },
    isRenderDirty() {
      return false;
    },
    dispose() {
      invoked.push({ disposed: true });
    },
  };
  const driver = {
    attach() {
      driverLifecycle.attach += 1;
    },
    update(frame) {
      driverFrames.push(frame);
      if (frame.events?.length) {
        latestHit = {
          blocked: true,
          componentId: 'look-sun',
          targetId: 'look-sun:face',
          pointerId: frame.events[0].pointerId,
        };
      }
    },
    detach() {
      driverLifecycle.detach += 1;
    },
    render() {
      return { commands: [], sharedSurfaceRevision: 0 };
    },
    getHit() {
      return latestHit;
    },
    getCompositeSurfaces() {
      return [];
    },
    getPointerState() {
      return undefined;
    },
    clearPointer() {
      driverLifecycle.clear += 1;
    },
    dispose() {
      invoked.push({ driverDisposed: true });
    },
  };

  const plugin = createTouchOsHudPlugin({
    id: 'test-touch-hud',
    target,
    runtime,
    driver,
    disposeRuntime: true,
    disposeDriver: true,
    root: ({ status }) => createSkykitShipControlsRoot({
      id: 'test-root',
      status,
      commands: [{ id: 'look-sun', label: 'Look Sun', actionId: 'app.lookSun' }],
    }),
    status: ({ frame }) => (frame ? { label: 't', value: frame.elapsedSeconds.toFixed(1) } : 'starting'),
    onOutput(output, outputContext) {
      observedOutputs.push({
        output,
        frameElapsedSeconds: outputContext.frame?.elapsedSeconds ?? null,
        viewerId: outputContext.viewer.id,
      });
    },
  });
  plugin.setup(createContext(actions, (part) => {
    addedPart = part;
  }));

  assert.ok(addedPart);
  addedPart.attach();
  assert.equal(driverLifecycle.attach, 1);
  addedPart.update(createFrame(0.25));
  assert.equal(roots.length, 1);
  assert.equal(driverFrames[0].surfaceMetrics.width, 800);
  assert.equal(driverFrames[0].surfaceMetrics.height, 600);

  queuedOutputs.push({
    type: 'change-request',
    componentId: 'hr-mode',
    field: 'hrMode',
    value: 'volume-complete',
  });
  addedPart.update(createFrame(0.5));
  assert.deepEqual(observedOutputs[0], {
    output: {
      type: 'change-request',
      componentId: 'hr-mode',
      field: 'hrMode',
      value: 'volume-complete',
    },
    frameElapsedSeconds: 0.5,
    viewerId: 'test-viewer',
  });

  queuedOutputs.push({ type: 'action', actionId: 'app.lookSun', componentId: 'look-sun', payload: { target: 'sun' } });
  const pointer = target.dispatchPointerEvent('pointerdown', {
    pointerId: 2,
    clientX: 760,
    clientY: 560,
  });

  assert.equal(pointer.defaultPrevented, false);
  assert.equal(pointer.immediatePropagationStopped, false);
  assert.equal(driverFrames.length, 2);
  addedPart.update(createFrame(0.75));
  assert.equal(driverFrames.length, 3);
  assert.equal(driverFrames[2].timestamp, 750);
  assert.equal(driverFrames[2].events[0].timestamp, 500);
  assert.deepEqual(invoked[0], {
    payload: { target: 'sun' },
    metadata: { source: 'touch-os:look-sun' },
  });
  assert.equal(observedOutputs[1].output.type, 'action');

  addedPart.dispose();
  assert.deepEqual(driverLifecycle, { attach: 1, detach: 1, clear: 1 });
  assert.deepEqual(invoked.slice(1), [
    { driverDisposed: true },
    { disposed: true },
  ]);
});

test('createTouchOsHudPlugin skips unclaimed touch pointer moves before HUD work', () => {
  const target = createTarget({ width: 800, height: 600 });
  const actions = createSkykitActionRegistry();
  const driverFrames = [];
  let addedPart = null;

  const runtime = {
    setRoot() {},
    render() {
      return { commands: [], sharedSurfaceRevision: 0 };
    },
    dispatchInput() {
      return { handled: false, componentId: undefined, targetId: undefined, outputs: [] };
    },
    resize() {},
    tick() {
      assert.fail('The SkyKit bridge must let the touch-os driver own runtime.tick().');
    },
    takeOutputs() {
      return [];
    },
    getServices() {
      return {};
    },
    getInteraction() {
      return {};
    },
    getBounds() {
      return undefined;
    },
    isLayoutDirty() {
      return false;
    },
    isRenderDirty() {
      return false;
    },
    dispose() {
      assert.fail('The borrowed HUD runtime must not be disposed.');
    },
  };
  const driverLifecycle = { attach: 0, detach: 0, clear: 0 };
  const driver = {
    attach() {
      driverLifecycle.attach += 1;
    },
    update(frame) {
      driverFrames.push(frame);
    },
    detach() {
      driverLifecycle.detach += 1;
    },
    render() {
      return { commands: [], sharedSurfaceRevision: 0 };
    },
    getHit() {
      return null;
    },
    getCompositeSurfaces() {
      return [];
    },
    getPointerState() {
      return undefined;
    },
    clearPointer() {
      driverLifecycle.clear += 1;
    },
  };

  const plugin = createTouchOsHudPlugin({
    id: 'test-touch-hud-scroll',
    target,
    runtime,
    driver,
    root: createSkykitShipControlsRoot({ id: 'test-root-scroll' }),
  });
  plugin.setup(createContext(actions, (part) => {
    addedPart = part;
  }));

  assert.ok(addedPart);
  addedPart.attach();
  addedPart.update(createFrame(0.25));
  const frameCount = driverFrames.length;

  const touchMove = target.dispatchPointerEvent('pointermove', {
    pointerId: 9,
    pointerType: 'touch',
    clientX: 400,
    clientY: 300,
  });
  assert.equal(driverFrames.length, frameCount);
  assert.equal(touchMove.defaultPrevented, false);
  assert.equal(touchMove.immediatePropagationStopped, false);

  const mouseMove = target.dispatchPointerEvent('pointermove', {
    pointerId: 10,
    pointerType: 'mouse',
    clientX: 400,
    clientY: 300,
  });
  assert.equal(driverFrames.length, frameCount);
  assert.equal(mouseMove.defaultPrevented, false);
  addedPart.update(createFrame(0.5));
  assert.equal(driverFrames.length, frameCount + 1);
  assert.equal(driverFrames.at(-1).events.length, 1);
  assert.equal(driverFrames.at(-1).events[0].timestamp, 250);

  addedPart.dispose();
  assert.deepEqual(driverLifecycle, { attach: 1, detach: 1, clear: 1 });
});

test('createTouchOsPanelPlugin mounts pose-anchored panels, forwards outputs, and blocks XR picks', () => {
  const actions = createSkykitActionRegistry();
  const queuedOutputs = [];
  const observedOutputs = [];
  const driverFrames = [];
  let addedPart = null;
  let latestHit = null;
  let createdDriverOptions = null;
  let rawPointerHostFrame = null;
  const pointerSource = {
    sample(frame) {
      rawPointerHostFrame = frame;
      return [{
        pointerId: 'raw',
        pointerType: 'mouse',
        transport: 'screen',
        phase: 'move',
        timestamp: 999999,
        ndcX: 0,
        ndcY: 0,
      }];
    },
  };
  const runtime = {
    setRoot(root) {
      this.root = root;
    },
    render() {
      return { commands: [], sharedSurfaceRevision: 0 };
    },
    dispatchInput() {
      return { handled: false, componentId: undefined, targetId: undefined, outputs: [] };
    },
    resize() {},
    tick() {
      assert.fail('The SkyKit bridge must let the touch-os driver own runtime.tick().');
    },
    takeOutputs() {
      return queuedOutputs.splice(0);
    },
    getServices() {
      return {};
    },
    getInteraction() {
      return {};
    },
    getBounds() {
      return undefined;
    },
    isLayoutDirty() {
      return false;
    },
    isRenderDirty() {
      return false;
    },
    dispose() {
      this.disposed = true;
    },
  };
  const panelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  const driver = {
    host: { mesh: panelMesh },
    attach() {
      this.attached = true;
    },
    update(frame) {
      driverFrames.push(frame);
      latestHit = {
        blocked: true,
        length: 0.42,
        componentId: 'rendering',
        targetId: 'rendering:face',
        pointerId: 'right-trigger',
        source: 'ray',
      };
    },
    detach() {
      this.attached = false;
    },
    render() {
      return { commands: [], sharedSurfaceRevision: 0 };
    },
    getHit() {
      return latestHit;
    },
    getCompositeSurfaces() {
      return [];
    },
    getPointerState() {
      return undefined;
    },
    clearPointer() {
      this.clearCount = (this.clearCount ?? 0) + 1;
    },
    dispose() {
      this.disposed = true;
      this.attached = false;
    },
  };

  const plugin = createTouchOsPanelPlugin({
    id: 'test-touch-panel',
    driver: 'pose-anchored',
    runtime,
    createDriver(options) {
      createdDriverOptions = options;
      return driver;
    },
    pointerSources: [pointerSource],
    root: createSkykitShipControlsRoot({ id: 'test-panel-root' }),
    surfaceMetrics: { width: 320, height: 240 },
    anchorPose: () => ({
      position: { x: 1, y: 2, z: 3 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    }),
    onOutput(output, outputContext) {
      observedOutputs.push({
        output,
        frameElapsedSeconds: outputContext.frame?.elapsedSeconds ?? null,
      });
    },
  });
  plugin.setup(createContext(actions, (part) => {
    addedPart = part;
  }));

  assert.ok(addedPart);
  addedPart.attach();
  queuedOutputs.push({ type: 'change-request', componentId: 'rendering', field: 'exposure', value: 4 });
  addedPart.update(createFrame(1.25));

  assert.equal(driver.attached, true);
  const normalizedSamples = createdDriverOptions.pointerSources[0].sample(driverFrames[0]);
  assert.equal(rawPointerHostFrame, driverFrames[0]);
  assert.equal(normalizedSamples[0].timestamp, 1250);
  assert.equal(driverFrames[0].surfaceMetrics.width, 320);
  assert.equal(driverFrames[0].timestamp, 1250);
  assert.deepEqual(driverFrames[0].anchorPose.position, { x: 1, y: 2, z: 3 });
  assert.equal(observedOutputs[0].output.type, 'change-request');
  assert.equal(observedOutputs[0].frameElapsedSeconds, 1.25);
  assert.deepEqual(plugin.getHit(), latestHit);
  const blockerHit = plugin.blockRay({
    id: 'query',
    kind: 'custom',
    handedness: null,
    origin: { x: 0, y: 0, z: 1 },
    direction: { x: 0, y: 0, z: -2 },
    length: 2,
  });
  assert.equal(blockerHit?.blocked, true);
  assert.equal(blockerHit?.consumed, true);
  assert.equal(blockerHit?.distance, 1);
  assert.equal(blockerHit?.hit.object, panelMesh);
  assert.equal(plugin.blockRay({
    id: 'short-query',
    kind: 'custom',
    handedness: null,
    origin: { x: 0, y: 0, z: 1 },
    direction: { x: 0, y: 0, z: -1 },
    length: 0.5,
  }), null);

  addedPart.dispose();
  assert.equal(driver.attached, false);
  assert.equal(driver.disposed, true);
  assert.equal(runtime.disposed, undefined);
});

test('panel callbacks and SkyKit-aware pointer sources receive the full frame and canonical clock', () => {
  const actionCalls = [];
  const actions = {
    press(id, payload, metadata) {
      actionCalls.push(['press', id, payload, metadata]);
    },
    release(id, metadata) {
      actionCalls.push(['release', id, metadata]);
    },
    invoke(id, payload, metadata) {
      actionCalls.push(['invoke', id, payload, metadata]);
      return Promise.resolve([]);
    },
  };
  const outputs = [];
  const observed = [];
  const callbackFrames = [];
  const driverFrames = [];
  const sourceFrames = [];
  let sourceClears = 0;
  let attachCount = 0;
  let detachCount = 0;
  let disposeCount = 0;
  let held = true;
  let addedPart = null;
  let createdDriverOptions = null;
  const runtime = createFakeRuntime(outputs);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  const driver = {
    host: { mesh },
    attach() {
      attachCount += 1;
    },
    update(frame) {
      driverFrames.push(frame);
      for (const source of createdDriverOptions.pointerSources) {
        this.samples = source.sample(frame);
      }
    },
    detach() {
      detachCount += 1;
      if (held) {
        held = false;
        outputs.push({
          type: 'action',
          actionId: 'ship.hold',
          componentId: 'hold',
          payload: { phase: 'stop' },
        });
      }
    },
    dispose() {
      disposeCount += 1;
    },
    clearPointer(_pointerId, timestamp) {
      this.clearTimestamp = timestamp;
      if (held) {
        held = false;
        outputs.push({
          type: 'action',
          actionId: 'ship.hold',
          componentId: 'hold',
          payload: { phase: 'stop' },
        });
      }
    },
    getHit() {
      return null;
    },
  };
  const skykitSource = createSkykitTouchOsPointerSource({
    sample(frame) {
      sourceFrames.push(frame);
      return {
        pointerId: 'right-trigger',
        pointerType: 'xr-controller',
        transport: 'ray',
        phase: 'down',
        timestamp: 987654,
        origin: { x: 0, y: 0, z: 1 },
        direction: { x: 0, y: 0, z: -1 },
      };
    },
    clear() {
      sourceClears += 1;
    },
  });
  const root = createSkykitShipControlsRoot({ id: 'full-frame-root' });
  const plugin = createTouchOsPanelPlugin({
    runtime,
    root(rootContext) {
      if (rootContext.frame) callbackFrames.push(['root', rootContext.frame]);
      return root;
    },
    surfaceMetrics(frame) {
      if (frame) callbackFrames.push(['metrics', frame]);
      return { width: 320, height: 200 };
    },
    parent(frame) {
      callbackFrames.push(['parent', frame]);
      return frame.roots.navigationRoot;
    },
    anchorPose(frame) {
      callbackFrames.push(['anchor', frame]);
      return frame.xr.pose;
    },
    skykitPointerSources: [skykitSource],
    createDriver(options) {
      createdDriverOptions = options;
      return driver;
    },
    onOutput(output) {
      observed.push(output);
    },
  });
  plugin.setup(createContext(actions, (part) => {
    addedPart = part;
  }));

  const frame = {
    ...createFrame(1.5),
    xr: {
      presenting: true,
      pose: {
        position: { x: 1, y: 2, z: 3 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
  };
  outputs.push({
    type: 'action',
    actionId: 'ship.hold',
    componentId: 'hold',
    payload: { phase: 'start' },
  });
  addedPart.attach();
  addedPart.update(frame);

  assert.equal(driverFrames.length, 1);
  assert.equal(driverFrames[0].timestamp, 1500);
  assert.equal(driver.samples[0].timestamp, 1500);
  assert.equal(sourceFrames[0], frame);
  assert.deepEqual(
    callbackFrames.map(([name, callbackFrame]) => [name, callbackFrame === frame]).sort(),
    [['anchor', true], ['metrics', true], ['parent', true], ['root', true]],
  );
  assert.equal(observed.length, 1);
  assert.equal(actionCalls[0][0], 'press');

  plugin.clearPointer();
  assert.equal(sourceClears, 1);
  assert.equal(driver.clearTimestamp, 1500);
  assert.equal(observed.length, 2);
  assert.equal(actionCalls[1][0], 'release');

  addedPart.detach();
  addedPart.attach();
  addedPart.update({ ...frame, elapsedSeconds: 2 });
  assert.equal(attachCount, 2);
  assert.equal(detachCount, 1);
  assert.equal(driverFrames.length, 2);
  addedPart.dispose();
  addedPart.dispose();
  assert.equal(detachCount, 2);
  assert.equal(disposeCount, 1);
  assert.equal(runtime.disposed, undefined);
});

test('supplied panel runtime and driver are borrowed unless ownership is explicitly transferred', () => {
  const actions = createSkykitActionRegistry();
  const borrowedOutputs = [];
  const borrowedRuntime = createFakeRuntime(borrowedOutputs);
  const borrowedDriver = createFakePanelDriver();
  let borrowedPart = null;
  const borrowedPlugin = createTouchOsPanelPlugin({
    runtime: borrowedRuntime,
    driverHandle: borrowedDriver,
    root: createSkykitShipControlsRoot({ id: 'borrowed-root' }),
  });
  borrowedPlugin.setup(createContext(actions, (part) => {
    borrowedPart = part;
  }));
  borrowedPart.attach();
  borrowedPart.dispose();
  borrowedPart.dispose();
  assert.equal(borrowedDriver.disposeCount, 0);
  assert.equal(borrowedRuntime.disposed, undefined);

  const ownedRuntime = createFakeRuntime([]);
  const ownedDriver = createFakePanelDriver();
  let ownedPart = null;
  const ownedPlugin = createTouchOsPanelPlugin({
    runtime: ownedRuntime,
    driverHandle: ownedDriver,
    disposeRuntime: true,
    disposeDriver: true,
    root: createSkykitShipControlsRoot({ id: 'transferred-root' }),
  });
  ownedPlugin.setup(createContext(actions, (part) => {
    ownedPart = part;
  }));
  ownedPart.attach();
  ownedPart.dispose();
  ownedPart.dispose();
  assert.equal(ownedDriver.disposeCount, 1);
  assert.equal(ownedRuntime.disposed, true);
});

test('supplied touch-os drivers require their runtime and reject ignored construction options', () => {
  const root = createSkykitShipControlsRoot({ id: 'supplied-driver-root' });
  const target = createTarget({ width: 640, height: 360 });
  const runtime = createFakeRuntime([]);
  const driver = createFakePanelDriver();

  assert.throws(() => createTouchOsHudPlugin({
    target,
    root,
    driver,
  }), /requires the driver's DisplayRuntime/);
  assert.throws(() => createTouchOsHudPlugin({
    target,
    root,
    runtime,
    driver,
    driverOptions: { transparent: false },
  }), /cannot apply createDriver or driverOptions/);

  assert.throws(() => createTouchOsPanelPlugin({
    root,
    driverHandle: driver,
  }), /requires the driver's DisplayRuntime/);
  assert.throws(() => createTouchOsPanelPlugin({
    root,
    runtime,
    driverHandle: driver,
    pointerSources: [{ sample() { return []; } }],
  }), /cannot configure the kind, factory, options, or pointer sources/);
  assert.throws(() => createTouchOsPanelPlugin({
    root,
    driverOptions: {
      pointerSources: [],
    },
  }), /driverOptions cannot set SkyKit-managed pointerSources/);
  assert.throws(() => createTouchOsHudPlugin({
    target,
    root,
    driverOptions: {
      parent: new THREE.Group(),
    },
  }), /driverOptions cannot set SkyKit-managed parent/);
});

test('blockRay evaluates each supplied ray against the current mesh without reading cached pointer state', () => {
  const actions = createSkykitActionRegistry();
  const runtime = createFakeRuntime([]);
  const driver = createFakePanelDriver();
  let part = null;
  let getHitCalls = 0;
  let processCalls = 0;
  driver.getHit = () => {
    getHitCalls += 1;
    return { blocked: true, length: 99 };
  };
  driver.interactor = {
    process() {
      processCalls += 1;
    },
  };
  const plugin = createTouchOsPanelPlugin({
    runtime,
    driverHandle: driver,
    root: createSkykitShipControlsRoot({ id: 'ray-query-root' }),
  });
  plugin.setup(createContext(actions, (nextPart) => {
    part = nextPart;
  }));
  part.attach();
  part.update(createFrame(1));

  const first = plugin.blockRay(createTestRay({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -4 }, 3));
  const miss = plugin.blockRay(createTestRay({ x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }, 3));
  assert.equal(first?.distance, 2);
  assert.equal(miss, null);

  driver.host.mesh.position.z = 1;
  const moved = plugin.blockRay(createTestRay({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }, 3));
  assert.equal(moved?.distance, 1);
  assert.equal(plugin.blockRay(createTestRay({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 }, 3), {
    maxDistance: 0.5,
  }), null);
  assert.equal(getHitCalls, 0);
  assert.equal(processCalls, 0);
  part.dispose();
});

function createContext(actions, addPart) {
  return {
    mode: 'three',
    viewer: { id: 'test-viewer', actions },
    actions,
    addPart(part) {
      addPart(part);
      return () => {};
    },
    addDisposable() {
      return () => {};
    },
    getViewState() {
      return {
        revision: 0,
        observerPc: { x: 0, y: 0, z: 0 },
        renderObserverPosition: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6,
        coordinateUnitsPerParsec: 1,
      };
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

function createFrame(elapsedSeconds) {
  const scene = new THREE.Scene();
  return {
    viewer: { id: 'test-viewer' },
    deltaSeconds: 0.016,
    elapsedSeconds,
    view: {
      revision: 0,
      observerPc: { x: 0, y: 0, z: 0 },
      renderObserverPosition: { x: 0, y: 0, z: 0 },
      limitingMagnitude: 6,
      coordinateUnitsPerParsec: 1,
    },
    renderer: {},
    scene,
    camera: new THREE.PerspectiveCamera(),
    roots: {
      originContentRoot: scene,
      observerContentRoot: scene,
      scaleBandedContentRoots: new Map(),
      navigationRoot: scene,
    },
    observerRig: {
      type: 'test',
      getObserverPc() {
        return { x: 0, y: 0, z: 0 };
      },
      getRenderObserverPosition() {
        return { x: 0, y: 0, z: 0 };
      },
    },
  };
}

function createTarget({ width, height, pixelRatio = 1 }) {
  const listeners = new Map();
  return {
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect() {
      return { left: 0, top: 0, width, height };
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    createPointerEvent(type, init = {}) {
      return {
        type,
        pointerId: init.pointerId ?? 1,
        pointerType: init.pointerType ?? 'touch',
        clientX: init.clientX ?? width / 2,
        clientY: init.clientY ?? height / 2,
        timeStamp: init.timeStamp ?? 12,
        pressure: init.pressure ?? 0.5,
        devicePixelRatio: pixelRatio,
        defaultPrevented: false,
        immediatePropagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopImmediatePropagation() {
          this.immediatePropagationStopped = true;
        },
      };
    },
    dispatchPointerEvent(type, init = {}) {
      const event = this.createPointerEvent(type, init);
      listeners.get(type)?.(event);
      return event;
    },
  };
}

function createFakeRuntime(outputs = []) {
  return {
    setRoot(root) {
      this.root = root;
    },
    render() {
      return { commands: [], sharedSurfaceRevision: 0 };
    },
    dispatchInput() {
      return { handled: false, componentId: undefined, targetId: undefined, outputs: [] };
    },
    resize() {},
    tick() {
      assert.fail('The SkyKit bridge must let the touch-os driver own runtime.tick().');
    },
    takeOutputs() {
      return outputs.splice(0);
    },
    getServices() {
      return {};
    },
    getInteraction() {
      return {};
    },
    getBounds() {
      return undefined;
    },
    isLayoutDirty() {
      return false;
    },
    isRenderDirty() {
      return false;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function createFakePanelDriver() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  return {
    host: { mesh },
    disposeCount: 0,
    attach() {
      this.attached = true;
    },
    update(frame) {
      this.frame = frame;
    },
    detach() {
      this.attached = false;
    },
    clearPointer(_pointerId, timestamp) {
      this.clearTimestamp = timestamp;
    },
    getHit() {
      return null;
    },
    dispose() {
      this.disposeCount += 1;
      this.attached = false;
    },
  };
}

function createTestRay(origin, direction, length) {
  return {
    id: 'test-ray',
    kind: 'custom',
    handedness: null,
    origin,
    direction,
    length,
  };
}
