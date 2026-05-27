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
});

test('createTouchOsHudPlugin attaches a HUD part, updates roots, and claims pointer actions', () => {
  const target = createTarget({ width: 800, height: 600 });
  const actions = createSkykitActionRegistry();
  const invoked = [];
  const roots = [];
  const driverFrames = [];
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
    tick() {},
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
    attach() {},
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
    detach() {},
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
    clearPointer() {},
  };

  const plugin = createTouchOsHudPlugin({
    id: 'test-touch-hud',
    target,
    runtime,
    driver,
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

  assert.equal(pointer.defaultPrevented, true);
  assert.equal(pointer.immediatePropagationStopped, true);
  assert.deepEqual(invoked[0], {
    payload: { target: 'sun' },
    metadata: { source: 'touch-os:look-sun' },
  });
  assert.equal(observedOutputs[1].output.type, 'action');

  addedPart.dispose();
  assert.deepEqual(invoked[1], { disposed: true });
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
    tick() {},
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
    dispose() {},
  };
  const driver = {
    attach() {},
    update(frame) {
      driverFrames.push(frame);
    },
    detach() {},
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
    clearPointer() {},
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
  assert.equal(driverFrames.length, frameCount + 1);
  assert.equal(mouseMove.defaultPrevented, false);

  addedPart.dispose();
});

test('createTouchOsPanelPlugin mounts pose-anchored panels, forwards outputs, and blocks XR picks', () => {
  const actions = createSkykitActionRegistry();
  const queuedOutputs = [];
  const observedOutputs = [];
  const driverFrames = [];
  let addedPart = null;
  let latestHit = null;
  let createdDriverOptions = null;
  const pointerSource = {
    sample() {
      return [];
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
    tick() {},
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
  const driver = {
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
    clearPointer() {},
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
  assert.equal(createdDriverOptions.pointerSources[0], pointerSource);
  assert.equal(driverFrames[0].surfaceMetrics.width, 320);
  assert.deepEqual(driverFrames[0].anchorPose.position, { x: 1, y: 2, z: 3 });
  assert.equal(observedOutputs[0].output.type, 'change-request');
  assert.equal(observedOutputs[0].frameElapsedSeconds, 1.25);
  assert.deepEqual(plugin.getHit(), latestHit);
  assert.deepEqual(plugin.blockRay({}), {
    blocked: true,
    consumed: true,
    distance: 0.42,
    hit: latestHit,
  });

  addedPart.dispose();
  assert.equal(driver.attached, false);
  assert.equal(runtime.disposed, true);
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
