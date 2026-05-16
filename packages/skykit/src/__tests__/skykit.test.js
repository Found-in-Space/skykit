import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS,
  createKeyboardNavigationPlugin,
  createDesktopSkykitObserverRig,
  createObject3dLayer,
  createObject3dPlugin,
  createMouseLookPlugin,
  createSkyGrabPlugin,
  createSkykitDefaultKeyboardNavigationBindings,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitStatusPlugin,
  createSkykitViewer,
  createStreamingStarLayer,
  createStreamingStarsPlugin,
  installSkykitDebugGlobal,
} from '../index.js';

function createHost() {
  return {
    children: [],
    clientWidth: 800,
    clientHeight: 600,
    appendChild(node) {
      this.children.push(node);
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
    },
  };
}

function createRenderer() {
  return {
    domElement: { nodeName: 'CANVAS' },
    size: null,
    pixelRatio: null,
    renderCalls: 0,
    disposed: false,
    setSize(width, height, updateStyle) {
      this.size = { width, height, updateStyle };
    },
    setPixelRatio(value) {
      this.pixelRatio = value;
    },
    render(scene, camera) {
      this.renderCalls += 1;
      this.lastScene = scene;
      this.lastCamera = camera;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

test('createSkykitViewer creates roots, mounts renderer, runs lifecycle, and disposes cleanly', async () => {
  const host = createHost();
  const renderer = createRenderer();
  const calls = [];
  const part = {
    id: 'part',
    priority: 1,
    attach() { calls.push('attach'); },
    start() { calls.push('start'); },
    setView(view) { calls.push(`setView:${view.revision}`); },
    update() { calls.push('update'); },
    beforeRender() { calls.push('beforeRender'); },
    afterRender() { calls.push('afterRender'); },
    resize(size) { calls.push(`resize:${size.width}`); },
    detach() { calls.push('detach'); },
    dispose() { calls.push('dispose'); },
  };

  const viewer = await createSkykitViewer({
    id: 'viewer',
    host,
    renderer,
    parts: [part],
  });

  assert.equal(host.children[0], renderer.domElement);
  assert.equal(viewer.contentRoot, viewer.roots.originContentRoot);
  assert.ok(viewer.scene.children.includes(viewer.roots.originContentRoot));
  assert.ok(viewer.scene.children.includes(viewer.roots.observerContentRoot));
  assert.ok(viewer.scene.children.includes(viewer.roots.navigationRoot));
  assert.deepEqual(calls.slice(0, 3), ['attach', 'start', 'setView:0']);

  viewer.frame(0.25);
  viewer.resize({ width: 320, height: 200, devicePixelRatio: 2 });
  assert.equal(renderer.renderCalls, 1);
  assert.deepEqual(renderer.size, { width: 320, height: 200, updateStyle: true });
  assert.ok(calls.includes('update'));
  assert.ok(calls.includes('beforeRender'));
  assert.ok(calls.includes('afterRender'));
  assert.ok(calls.includes('resize:320'));

  await viewer.dispose();
  assert.equal(host.children.length, 0);
  assert.ok(calls.includes('detach'));
  assert.ok(calls.includes('dispose'));
  assert.equal(viewer.getSnapshot().disposed, true);
});

test('plugins register ordered parts, events, stores, resources, disposables, and scheduled tasks', async () => {
  const calls = [];
  const disposableCalls = [];
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      {
        id: 'plugin',
        setup(ctx) {
          const store = ctx.useStore('store', () => ({ count: 1 }));
          const again = ctx.useStore('store', () => ({ count: 2 }));
          assert.equal(store, again);

          ctx.useResource('resource', () => ({ dispose: () => disposableCalls.push('resource') }));
          ctx.addDisposable(() => disposableCalls.push('disposable'));
          ctx.on('custom', (event) => calls.push(event.type));
          ctx.emit({ type: 'custom' });
          ctx.scheduleTask(() => { calls.push('task'); }, { reason: 'test-task', priority: 'background' });
          ctx.addPart({
            id: 'late',
            priority: 10,
            attach() { calls.push('late.attach'); },
          });
          ctx.addPart({
            id: 'early',
            priority: -10,
            attach() { calls.push('early.attach'); },
          });
          return () => disposableCalls.push('teardown');
        },
      },
    ],
  });

  await Promise.resolve();
  assert.deepEqual(calls.slice(0, 3), ['custom', 'early.attach', 'late.attach']);
  assert.equal(viewer.getSnapshot().scheduledTasks[0].reason, 'test-task');
  assert.equal(viewer.getSnapshot().scheduledTasks[0].status, 'finished');

  await viewer.dispose();
  assert.ok(disposableCalls.includes('resource'));
  assert.ok(disposableCalls.includes('disposable'));
  assert.ok(disposableCalls.includes('teardown'));
});

test('requestViewState batches patches and observer-centric root follows translation without rotation', async () => {
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
  });
  const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

  viewer.requestViewState({ observerPc: { x: 2, y: 3, z: 4 } }, 'test-a');
  viewer.requestViewState({
    orientationIcrs: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
    limitingMagnitude: 8,
  }, 'test-b');

  assert.equal(viewer.getViewState().revision, 0);
  viewer.update(1);

  const view = viewer.getViewState();
  assert.equal(view.revision, 1);
  assert.deepEqual(view.observerPc, { x: 2, y: 3, z: 4 });
  assert.equal(view.limitingMagnitude, 8);
  assert.deepEqual(view.motion?.velocityPcPerSec, { x: 2, y: 3, z: 4 });
  assert.deepEqual(viewer.roots.observerContentRoot.position.toArray(), [2, 3, 4]);
  assert.equal(viewer.roots.observerContentRoot.quaternion.x, 0);
  assert.equal(viewer.roots.observerContentRoot.quaternion.y, 0);
  assert.equal(viewer.roots.observerContentRoot.quaternion.z, 0);
  assert.equal(viewer.roots.observerContentRoot.quaternion.w, 1);
  assert.ok(Math.abs(viewer.roots.navigationRoot.quaternion.y - orientation.y) < 1e-12);

  await viewer.dispose();
});

test('desktop observer rig reports render observer position in configured scene units', () => {
  const rig = createDesktopSkykitObserverRig({
    observerPc: { x: 10, y: -2, z: 5 },
    coordinateUnitsPerParsec: 0.001,
  });

  assert.deepEqual(rig.getObserverPc(), { x: 10, y: -2, z: 5 });
  assert.deepEqual(rig.getRenderObserverPosition(), { x: 0.01, y: -0.002, z: 0.005 });

  rig.setObserverPc?.({ x: 20, y: 0, z: -4 });
  assert.deepEqual(rig.getRenderObserverPosition(), { x: 0.02, y: 0, z: -0.004 });
});

test('createObject3dLayer mounts layers into world, observer-centric, and scale-banded roots', async () => {
  const world = new THREE.Group();
  const observer = new THREE.Group();
  const banded = new THREE.Group();
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    parts: [
      createObject3dLayer({ id: 'world', object3d: world }),
      createObject3dLayer({ id: 'observer', object3d: observer, anchorMode: 'observer-centric' }),
      createObject3dLayer({ id: 'banded', object3d: banded, anchorMode: 'scale-banded', scaleBandId: 'galaxy' }),
    ],
  });

  assert.equal(world.parent, viewer.roots.originContentRoot);
  assert.equal(observer.parent, viewer.roots.observerContentRoot);
  assert.equal(banded.parent, viewer.roots.scaleBandedContentRoots.get('galaxy'));

  await viewer.dispose();
  assert.equal(world.parent, null);
  assert.equal(observer.parent, null);
  assert.equal(banded.parent, null);
});

test('object3d plugin wraps an object layer without string registries', async () => {
  const object3d = new THREE.Group();
  const plugin = createObject3dPlugin({
    id: 'marker',
    object3d,
    anchorMode: 'observer-centric',
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [plugin],
  });

  assert.equal(plugin.getLayer()?.id, 'marker');
  assert.equal(object3d.parent, viewer.roots.observerContentRoot);
  assert.equal(plugin.getSnapshot().mounted, true);
  assert.equal(viewer.getSnapshot().parts.some((part) => part.id === 'marker'), true);

  await viewer.dispose();
  assert.equal(object3d.parent, null);
});

test('streaming stars plugin owns a streaming layer and exposes its snapshot', async () => {
  const session = createFakeSession();
  const rendererCalls = [];
  const renderer = {
    object3d: new THREE.Group(),
    apply(delta) { rendererCalls.push(delta.type); },
    setView(view) { rendererCalls.push(`view:${view.limitingMagnitude}`); },
    getSnapshot() { return { renderer: 'stars' }; },
    dispose() { rendererCalls.push('dispose'); },
  };
  const provider = {
    id: 'provider',
    createSession() {
      return session;
    },
  };
  const plugin = createStreamingStarsPlugin({
    id: 'stars-plugin',
    provider,
    renderer,
    session: { strategy: { kind: 'observer-shell' } },
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [plugin],
  });
  assert.equal(plugin.getLayer()?.id, 'stars-plugin');
  assert.equal(plugin.getSnapshot().status, 'idle');

  session.emit({ type: 'data/product-upsert', product: { id: 'product' } });
  assert.ok(rendererCalls.includes('data/product-upsert'));

  await viewer.dispose();
  assert.equal(session.disposed, true);
  assert.ok(rendererCalls.includes('dispose'));
});

test('animation loop drives viewer frames with an injected scheduler and clock', async () => {
  const renderer = createRenderer();
  const viewer = await createSkykitViewer({ renderer });
  const callbacks = [];
  const cancelled = [];
  let nowMs = 1000;
  const loop = createSkykitAnimationLoop(viewer, {
    maxDeltaSeconds: 0.05,
    now: () => nowMs,
    requestAnimationFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelAnimationFrame(handle) {
      cancelled.push(handle);
    },
  });

  loop.start();
  assert.equal(loop.getSnapshot().running, true);
  nowMs = 1200;
  callbacks.shift()(nowMs);
  assert.equal(renderer.renderCalls, 1);
  assert.equal(loop.getSnapshot().frameCount, 1);
  assert.equal(loop.getSnapshot().lastDeltaSeconds, 0.05);

  loop.stop();
  assert.equal(loop.getSnapshot().running, false);
  assert.equal(cancelled.length, 1);
  loop.dispose();
  assert.throws(() => loop.start(), /disposed/);
  await viewer.dispose();
});

test('keyboard navigation plugin maps keys to batched observer movement and cleans listeners', async () => {
  const target = createEventTarget();
  const plugin = createKeyboardNavigationPlugin({
    target,
    speedPcPerSec: 2,
    boostMultiplier: 3,
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [plugin],
  });

  assert.equal(target.listenerCount('keydown'), 1);
  target.dispatch('keydown', { code: 'KeyW' });
  viewer.frame(1);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: -2 });
  assert.deepEqual(plugin.getSnapshot().lastVelocityPcPerSec, { x: 0, y: 0, z: -2 });

  target.dispatch('keydown', { code: 'ShiftLeft' });
  viewer.frame(1);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: -8 });

  target.dispatch('keyup', { code: 'KeyW' });
  target.dispatch('keyup', { code: 'ShiftLeft' });
  await viewer.dispose();
  assert.equal(target.listenerCount('keydown'), 0);
  assert.equal(target.listenerCount('keyup'), 0);
});

test('keyboard navigation custom bindings replace defaults instead of merging', async () => {
  assert.equal(SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS.KeyW, 'forward');
  assert.equal(SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS.ArrowUp, 'forward');

  const target = createEventTarget();
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      createKeyboardNavigationPlugin({
        target,
        speedPcPerSec: 1,
        bindings: {
          KeyI: 'forward',
          KeyK: 'back',
        },
      }),
    ],
  });

  target.dispatch('keydown', { code: 'KeyW' });
  viewer.frame(1);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: 0 });

  target.dispatch('keyup', { code: 'KeyW' });
  target.dispatch('keydown', { code: 'KeyI' });
  viewer.frame(1);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: -1 });

  await viewer.dispose();
});

test('default keyboard binding factory returns an explicit override map', async () => {
  const bindings = createSkykitDefaultKeyboardNavigationBindings({
    KeyW: 'rollAnticlockwise',
    KeyI: 'forward',
  });
  assert.equal(bindings.KeyW, 'rollAnticlockwise');
  assert.equal(bindings.ArrowUp, 'forward');
  assert.equal(bindings.KeyI, 'forward');
  assert.equal(SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS.KeyW, 'forward');

  const target = createEventTarget();
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      createKeyboardNavigationPlugin({
        target,
        bindings,
        rotationSpeedDegPerSec: 90,
      }),
    ],
  });

  target.dispatch('keydown', { code: 'KeyW' });
  viewer.frame(1);
  viewer.update(0);
  const up = localVectorFromView(viewer.getViewState(), { x: 0, y: 1, z: 0 });
  assert.ok(up.x < -0.999);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: 0 });

  await viewer.dispose();
});

test('keyboard navigation vertical movement can follow view-up or world-up', async () => {
  const viewTarget = createEventTarget();
  const worldTarget = createEventTarget();
  const pitchDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const viewViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      orientationIcrs: {
        x: pitchDown.x,
        y: pitchDown.y,
        z: pitchDown.z,
        w: pitchDown.w,
      },
    },
    plugins: [createKeyboardNavigationPlugin({ target: viewTarget, speedPcPerSec: 1 })],
  });
  const worldViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      orientationIcrs: {
        x: pitchDown.x,
        y: pitchDown.y,
        z: pitchDown.z,
        w: pitchDown.w,
      },
    },
    plugins: [createKeyboardNavigationPlugin({ target: worldTarget, speedPcPerSec: 1, verticalMode: 'world' })],
  });

  viewTarget.dispatch('keydown', { code: 'KeyE' });
  worldTarget.dispatch('keydown', { code: 'KeyE' });
  viewViewer.frame(1);
  worldViewer.frame(1);
  viewViewer.update(0);
  worldViewer.update(0);

  assert.ok(viewViewer.getViewState().observerPc.z > 0.999);
  assert.ok(Math.abs(viewViewer.getViewState().observerPc.y) < 1e-12);
  assert.deepEqual(worldViewer.getViewState().observerPc, { x: 0, y: 1, z: 0 });

  await viewViewer.dispose();
  await worldViewer.dispose();
});

test('keyboard navigation custom bindings can rotate pitch yaw and roll', async () => {
  const pitchTarget = createEventTarget();
  const yawTarget = createEventTarget();
  const rollTarget = createEventTarget();
  const bindings = {
    KeyI: 'pitchUp',
    KeyK: 'pitchDown',
    KeyJ: 'yawLeft',
    KeyL: 'yawRight',
    KeyO: 'rollClockwise',
    KeyU: 'rollAnticlockwise',
  };
  const pitchViewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [createKeyboardNavigationPlugin({ target: pitchTarget, bindings, rotationSpeedDegPerSec: 90 })],
  });
  const yawViewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [createKeyboardNavigationPlugin({ target: yawTarget, bindings, rotationSpeedDegPerSec: 90 })],
  });
  const rollViewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [createKeyboardNavigationPlugin({ target: rollTarget, bindings, rotationSpeedDegPerSec: 90 })],
  });

  pitchTarget.dispatch('keydown', { code: 'KeyI' });
  yawTarget.dispatch('keydown', { code: 'KeyJ' });
  rollTarget.dispatch('keydown', { code: 'KeyO' });
  pitchViewer.frame(1);
  yawViewer.frame(1);
  rollViewer.frame(1);
  pitchViewer.update(0);
  yawViewer.update(0);
  rollViewer.update(0);

  const pitchForward = localVectorFromView(pitchViewer.getViewState(), { x: 0, y: 0, z: -1 });
  const yawForward = localVectorFromView(yawViewer.getViewState(), { x: 0, y: 0, z: -1 });
  const rollUp = localVectorFromView(rollViewer.getViewState(), { x: 0, y: 1, z: 0 });
  assert.ok(pitchForward.y > 0.999);
  assert.ok(yawForward.x < -0.999);
  assert.ok(rollUp.x > 0.999);

  await pitchViewer.dispose();
  await yawViewer.dispose();
  await rollViewer.dispose();
});

test('sky grab plugin maps drag movement to viewer orientation and cleans listeners', async () => {
  const target = createEventTarget();
  const plugin = createSkyGrabPlugin({
    target,
    sensitivityRadiansPerPixel: 0.01,
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [plugin],
  });

  assert.equal(target.listenerCount('pointerdown'), 1);
  assert.equal(target.listenerCount('pointermove'), 1);
  const down = target.dispatch('pointerdown', { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
  assert.equal(down.defaultPrevented, true);
  const move = target.dispatch('pointermove', { pointerId: 7, clientX: 110, clientY: 95 });
  assert.equal(move.defaultPrevented, true);
  assert.equal(plugin.getSnapshot().dragging, true);

  viewer.update(0);
  const view = viewer.getViewState();
  assert.ok(view.orientationIcrs);
  assert.ok(view.orientationIcrs.y > 0);
  assert.ok(view.orientationIcrs.x < 0);
  assert.ok(plugin.getSnapshot().yawRad > 0);
  assert.ok(plugin.getSnapshot().pitchRad < 0);

  target.dispatch('pointerup', { pointerId: 7 });
  assert.equal(plugin.getSnapshot().dragging, false);
  const yawAfterDrag = plugin.getSnapshot().yawRad;
  viewer.requestViewState({ limitingMagnitude: 7 }, 'test-resync');
  viewer.update(0);
  assert.equal(Math.sign(plugin.getSnapshot().yawRad), Math.sign(yawAfterDrag));

  await viewer.dispose();
  assert.equal(target.listenerCount('pointerdown'), 0);
  assert.equal(target.listenerCount('pointermove'), 0);
  assert.equal(target.listenerCount('pointerup'), 0);
  assert.equal(target.listenerCount('pointercancel'), 0);
});

test('mouse look plugin uses opposite drag direction from sky grab', async () => {
  const target = createEventTarget();
  const plugin = createMouseLookPlugin({
    target,
    sensitivityRadiansPerPixel: 0.01,
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [plugin],
  });

  target.dispatch('pointerdown', { button: 0, pointerId: 3, clientX: 100, clientY: 100 });
  target.dispatch('pointermove', { pointerId: 3, clientX: 110, clientY: 95 });
  viewer.update(0);

  assert.ok(plugin.getSnapshot().yawRad < 0);
  assert.ok(plugin.getSnapshot().pitchRad > 0);

  await viewer.dispose();
});

test('status plugin renders compact viewer snapshots to callback and text targets', async () => {
  const payloads = [];
  const textTarget = { textContent: '' };
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      createSkykitStatusPlugin({ render: (payload) => payloads.push(payload) }),
      createSkykitStatusPlugin({ id: 'text-status', target: textTarget }),
    ],
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].viewer.id, viewer.id);
  assert.match(textTarget.textContent, /"id"/);

  viewer.frame(0.25);
  assert.equal(payloads.length, 2);
  assert.equal(viewer.getSnapshot().parts.some((part) => part.id === 'text-status'), true);

  await viewer.dispose();
});

test('debug bridge registers viewers, switches active viewer, updates observer, and installs a global', async () => {
  const viewerA = await createSkykitViewer({ id: 'a', renderer: createRenderer() });
  const viewerB = await createSkykitViewer({ id: 'b', renderer: createRenderer() });
  const debug = createSkykitDebugBridge();
  const debugA = debug.registerViewer(viewerA, { id: 'alpha', label: 'Alpha' });
  debug.registerViewer(viewerB, { id: 'beta', label: 'Beta' });

  assert.deepEqual(debug.listViewers().map((entry) => entry.id), ['alpha', 'beta']);
  assert.equal(debug.getViewer()?.id, 'alpha');
  assert.equal(debug.useViewer('beta')?.id, 'beta');
  assert.deepEqual(debug.setObserverPc(1, 2, 3), { x: 1, y: 2, z: 3 });
  assert.deepEqual(viewerB.getViewState().observerPc, { x: 1, y: 2, z: 3 });
  assert.deepEqual(debugA.setObserverPc({ x: 4, y: 5, z: 6 }), { x: 4, y: 5, z: 6 });
  assert.deepEqual(debugA.flyToPc({ x: 7, y: 8, z: 9 }), { x: 7, y: 8, z: 9 });
  assert.deepEqual(debugA.lookAtPc({ x: 0, y: 0, z: -1 }), { x: 0, y: 0, z: -1 });

  const target = {};
  const uninstall = installSkykitDebugGlobal(debug, { target, name: 'debug' });
  assert.equal(target.debug, debug);
  uninstall();
  assert.equal('debug' in target, false);

  await viewerA.dispose();
  assert.equal(debug.getViewer('alpha'), null);
  await viewerB.dispose();
});

test('streaming star layer creates a session, maps view updates, applies deltas, and disposes ownership', async () => {
  const object3d = new THREE.Group();
  const rendererCalls = [];
  const renderer = {
    object3d,
    apply(delta) { rendererCalls.push(delta.type); },
    setView(view) { rendererCalls.push(`view:${view.limitingMagnitude}:${view.observerPosition.x}`); },
    getSnapshot() { return { status: 'current', productCount: 0 }; },
    dispose() { rendererCalls.push('renderer.dispose'); },
  };
  const session = createFakeSession();
  const provider = {
    id: 'provider',
    createSession(options) {
      provider.lastOptions = options;
      return session;
    },
  };
  const layer = createStreamingStarLayer({
    provider,
    renderer,
    session: { strategy: { kind: 'observer-shell' } },
    attributes: ['position', 'magAbs'],
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    parts: [layer],
    view: {
      observerPc: { x: 1, y: 0, z: 0 },
      limitingMagnitude: 7,
      coordinateUnitsPerParsec: 0.001,
    },
  });

  assert.equal(object3d.parent, viewer.roots.originContentRoot);
  assert.deepEqual(provider.lastOptions.attributes, ['position', 'magAbs']);
  assert.equal(provider.lastOptions.coordinates.name, 'skykit-render-position');
  assert.deepEqual(provider.lastOptions.coordinates.transformPosition({
    xPc: 10,
    yPc: 20,
    zPc: -30,
  }), { x: 0.01, y: 0.02, z: -0.03 });
  assert.equal(session.updateCalls.length, 1);
  assert.deepEqual(session.updateCalls[0].patch.observerPc, { x: 1, y: 0, z: 0 });
  assert.equal(session.updateCalls[0].patch.limitingMagnitude, 7);
  assert.ok(rendererCalls.includes('view:7:0.001'));

  session.emit({ type: 'data/product-upsert', product: { id: 'p1' } });
  session.emit({ type: 'data/representation-current', completeness: { phase: 'complete' } });
  assert.deepEqual(rendererCalls.slice(-2), ['data/product-upsert', 'data/representation-current']);
  assert.equal(layer.getSnapshot().status, 'current');

  viewer.requestViewState({ observerPc: { x: 2, y: 0, z: 0 }, limitingMagnitude: 6.5 });
  viewer.update(0.5);
  assert.equal(session.updateCalls.at(-1).patch.observerPc.x, 2);
  assert.equal(session.updateCalls.at(-1).patch.motion.speedPcPerSec, 2);

  await viewer.dispose();
  assert.equal(session.disposed, true);
  assert.ok(rendererCalls.includes('renderer.dispose'));
  session.emit({ type: 'data/product-upsert', product: { id: 'late' } });
  assert.equal(rendererCalls.includes('late'), false);
});

test('streaming star layer can use an explicit session without disposing it', async () => {
  const session = createFakeSession();
  const renderer = {
    object3d: new THREE.Group(),
    apply() {},
    setView() {},
    getSnapshot() { return {}; },
    dispose() {},
  };
  const layer = createStreamingStarLayer({
    provider: { id: 'provider', createSession() { throw new Error('should not create session'); } },
    renderer,
    session,
  });
  const viewer = await createSkykitViewer({ renderer: createRenderer(), parts: [layer] });
  await viewer.dispose();
  assert.equal(session.disposed, false);
});

function createFakeSession() {
  const listeners = new Set();
  return {
    id: 'session',
    updateCalls: [],
    disposed: false,
    updateView(patch, options) {
      this.updateCalls.push({ patch, options });
      return {
        sessionId: this.id,
        viewRevision: this.updateCalls.length,
        demandRevision: this.updateCalls.length,
        demand: 'queued',
        reasons: [],
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(delta) {
      for (const listener of listeners) listener(delta);
    },
    async *deltas() {},
    getSnapshot() {
      return { id: this.id, disposed: this.disposed };
    },
    dispose() {
      this.disposed = true;
      listeners.clear();
    },
  };
}

function localVectorFromView(view, vector) {
  const q = view.orientationIcrs ?? { x: 0, y: 0, z: 0, w: 1 };
  const result = new THREE.Vector3(vector.x, vector.y, vector.z).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
  );
  return { x: result.x, y: result.y, z: result.z };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      let typeListeners = listeners.get(type);
      if (!typeListeners) {
        typeListeners = new Set();
        listeners.set(type, typeListeners);
      }
      typeListeners.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}) {
      const keyboardEvent = {
        preventDefault() {
          keyboardEvent.defaultPrevented = true;
        },
        defaultPrevented: false,
        ...event,
      };
      for (const listener of listeners.get(type) ?? []) {
        listener(keyboardEvent);
      }
      return keyboardEvent;
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}
