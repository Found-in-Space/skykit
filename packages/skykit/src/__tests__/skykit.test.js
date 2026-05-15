import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  createDesktopSkykitObserverRig,
  createObject3dLayer,
  createSkykitDebugBridge,
  createSkykitViewer,
  createStreamingStarLayer,
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
    },
  });

  assert.equal(object3d.parent, viewer.roots.originContentRoot);
  assert.deepEqual(provider.lastOptions.attributes, ['position', 'magAbs']);
  assert.equal(session.updateCalls.length, 1);
  assert.deepEqual(session.updateCalls[0].patch.observerPc, { x: 1, y: 0, z: 0 });
  assert.equal(session.updateCalls[0].patch.limitingMagnitude, 7);
  assert.ok(rendererCalls.includes('view:7:1'));

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
