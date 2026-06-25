import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {
  createObserverShellStrategy,
  createStarCellData,
  encodeMorton3D,
} from '@found-in-space/star-trees';

import {
  LOCAL_UP,
  applyQuaternion,
  computeSpatialLookAtOrientation,
  resolveSpatialTarget,
} from '@found-in-space/spatial';
import {
  SKYKIT_ACTION_NAMESPACE,
  SKYKIT_ACTIONS,
  SKYKIT_CONTROLS,
  SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS,
  createSkykitActionRegistry,
  createKeyboardNavigationPlugin,
  createDesktopSkykitObserverRig,
  createSkykitCoordinateFrameMarkerLayer,
  createSkykitConstellationLayer,
  createObject3dLayer,
  createObject3dPlugin,
  createSkykitLayerHostPlugin,
  createSkykitProductRegistryPlugin,
  createRaDecLookAt,
  createSkykitLayerSelectionFromPick,
  createSkykitLayerSelectionPlugin,
  createSkykitInspectFacade,
  createMouseLookPlugin,
  createSkyGrabPlugin,
  createSkyOrbitPlugin,
  createSkykitSelectionFacade,
  createSkykitSelectionProductsPlugin,
  createSkykitDefaultKeyboardNavigationBindings,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitNavigationPlugin,
  createSkykitStarPreloadRequestsFromSpatialHints,
  createSkykitStarStrategiesFromSpatialHints,
  createSkykitStatusPlugin,
  createSkykitHrDiagramPlugin,
  createSkykitStarPickMetadataResolver,
  createSkykitStarPickingPlugin,
  createSkykitStarSourcePlugin,
  createSkykitViewer,
  createStreamingStarLayer,
  createStreamingStarsPlugin,
  installSkykitDebugGlobal,
  parseSpatialLookAtText,
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

function createTextureRenderer() {
  const renderer = createRenderer();
  return {
    ...renderer,
    xr: { enabled: true },
    currentTarget: null,
    viewport: new THREE.Vector4(0, 0, 1, 1),
    scissor: new THREE.Vector4(0, 0, 1, 1),
    scissorTest: false,
    getRenderTarget() {
      return this.currentTarget;
    },
    setRenderTarget(target) {
      this.currentTarget = target;
    },
    getViewport(target) {
      return target.copy(this.viewport);
    },
    setViewport(value) {
      if (value?.isVector4) this.viewport.copy(value);
    },
    getScissor(target) {
      return target.copy(this.scissor);
    },
    setScissor(value) {
      if (value?.isVector4) this.scissor.copy(value);
    },
    getScissorTest() {
      return this.scissorTest;
    },
    setScissorTest(value) {
      this.scissorTest = Boolean(value);
    },
  };
}

function createEmbeddedSurfaceSpy() {
  const publishCalls = [];
  const unpublishCalls = [];
  return {
    publishCalls,
    unpublishCalls,
    publish(sourceId, update) {
      publishCalls.push({ sourceId, update });
    },
    unpublish(sourceId) {
      unpublishCalls.push(sourceId);
    },
  };
}

async function flushMicrotasks(count = 10) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function assertStrategyBehavior(strategy) {
  assert.equal(typeof strategy.createAnchor, 'function');
  assert.equal(typeof strategy.createEvaluator, 'function');
  assert.equal(typeof strategy.diff, 'function');
  for (const key of ['kind', 'id', 'name', 'label', 'debugLabel']) {
    assert.equal(Object.hasOwn(strategy, key), false, key);
  }
}

function assertCallOrder(calls, expected) {
  let offset = 0;
  for (const call of expected) {
    const index = calls.indexOf(call, offset);
    assert.notEqual(index, -1, `Expected ${call} after ${calls.slice(0, offset).join(', ')}`);
    offset = index + 1;
  }
}

function createLifecycleSpyPart(id, calls, priority = 0) {
  return {
    id,
    priority,
    attach() { calls.push(`${id}.attach`); },
    start() { calls.push(`${id}.start`); },
    setView(view) { calls.push(`${id}.setView:${view.revision}`); },
    update() { calls.push(`${id}.update`); },
    beforeRender() { calls.push(`${id}.beforeRender`); },
    afterRender() { calls.push(`${id}.afterRender`); },
    resize(size) { calls.push(`${id}.resize:${size.width}`); },
    detach() { calls.push(`${id}.detach`); },
    dispose() { calls.push(`${id}.dispose`); },
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

test('createSkykitViewer respects custom camera roots for XR rigs', async () => {
  const renderer = createRenderer();
  const camera = new THREE.PerspectiveCamera();
  const headRoot = new THREE.Group();
  const viewer = await createSkykitViewer({
    renderer,
    camera,
    cameraRoot: headRoot,
  });

  assert.equal(headRoot.children.includes(camera), true);
  assert.equal(viewer.roots.navigationRoot.children.includes(camera), false);

  await viewer.dispose();

  const looseCamera = new THREE.PerspectiveCamera();
  const detachedViewer = await createSkykitViewer({
    renderer: createRenderer(),
    camera: looseCamera,
    cameraRoot: false,
  });

  assert.equal(detachedViewer.roots.navigationRoot.children.includes(looseCamera), false);
  await detachedViewer.dispose();
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
          assert.equal(ctx.actions, ctx.viewer.actions);
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

test('layer host routes lifecycle, state, object mounts, products, and dynamic layers', async () => {
  const calls = [];
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const object = new THREE.Object3D();
  const dynamicObject = new THREE.Object3D();
  const host = createSkykitLayerHostPlugin({
    id: 'host',
    layers: [
      {
        id: 'hosted',
        priority: 2,
        async setup(ctx) {
          calls.push('setup');
          ctx.addObject3D(object, { anchorMode: 'observer-centric', disposeObject: true });
          ctx.provideProduct('features:hosted', { id: 'features' }, { kind: 'features' });
        },
        attach() { calls.push('attach'); },
        start() { calls.push('start'); },
        setView(view) { calls.push(`setView:${view.revision}`); },
        setState(state) { calls.push(`setState:${state.view.revision}`); },
        update() { calls.push('update'); },
        dispose() { calls.push('dispose'); },
      },
    ],
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [products, host],
  });

  assert.deepEqual(calls.slice(0, 4), ['setup', 'attach', 'start', 'setView:0']);
  assert.equal(viewer.roots.observerContentRoot.children.includes(object), true);
  assert.deepEqual(products.get('features:hosted'), { id: 'features' });
  assert.equal(host.getSnapshot().layers[0].mounted, true);

  viewer.frame(0.1);
  assert.ok(calls.includes('update'));
  assert.ok(calls.includes('setState:0'));

  const removeDynamic = host.addLayer({
    id: 'dynamic',
    setup(ctx) {
      ctx.addObject3D(dynamicObject, {
        anchorMode: 'scale-banded',
        scaleBandId: 'galactic',
      });
    },
  });
  await flushMicrotasks();
  assert.equal(viewer.roots.scaleBandedContentRoots.get('galactic')?.children.includes(dynamicObject), true);

  removeDynamic();
  await flushMicrotasks();
  assert.equal(viewer.roots.scaleBandedContentRoots.get('galactic')?.children.includes(dynamicObject), false);

  await viewer.dispose();

  assert.ok(calls.includes('dispose'));
  assert.equal(products.get('features:hosted'), null);
  assert.equal(viewer.roots.observerContentRoot.children.includes(object), false);
});

test('layer host passes XR frame state to hosted layers during frame updates', async () => {
  const states = [];
  const rig = { id: 'rig' };
  const rays = { right: { id: 'right-ray' } };
  const host = createSkykitLayerHostPlugin({
    layers: [
      {
        id: 'xr-aware-layer',
        setState(state) {
          states.push(state);
        },
      },
    ],
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [host],
  });

  assert.equal(states[0].xr, undefined);

  viewer.frame(0.1, {
    xr: {
      presenting: true,
      rig,
      rays,
      session: { id: 'session' },
      referenceSpace: { id: 'reference-space' },
      frame: { id: 'xr-frame' },
    },
  });

  assert.equal(states.at(-1).xr.presenting, true);
  assert.equal(states.at(-1).xr.rig, rig);
  assert.equal(states.at(-1).xr.rays, rays);

  viewer.frame(0.1);
  assert.equal(states.at(-1).xr, null);
  await viewer.dispose();
});

test('layer host owns child parts added through layer context', async () => {
  const calls = [];
  let addDynamicChild = null;
  let removeSetupChild = null;

  const setupChild = createLifecycleSpyPart('setup-child', calls, -1);
  const dynamicChild = createLifecycleSpyPart('dynamic-child', calls, 1);
  const host = createSkykitLayerHostPlugin({
    id: 'host',
    layers: [
      {
        id: 'hosted',
        priority: 0,
        setup(ctx) {
          calls.push('layer.setup');
          removeSetupChild = ctx.addPart(setupChild);
          addDynamicChild = () => ctx.addPart(dynamicChild);
        },
        attach() { calls.push('layer.attach'); },
        start() { calls.push('layer.start'); },
        setView(view) { calls.push(`layer.setView:${view.revision}`); },
        update() { calls.push('layer.update'); },
        beforeRender() { calls.push('layer.beforeRender'); },
        afterRender() { calls.push('layer.afterRender'); },
        resize(size) { calls.push(`layer.resize:${size.width}`); },
        detach() { calls.push('layer.detach'); },
        dispose() { calls.push('layer.dispose'); },
      },
    ],
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [host],
  });

  assertCallOrder(calls, [
    'layer.setup',
    'setup-child.attach',
    'layer.attach',
    'setup-child.start',
    'layer.start',
    'setup-child.setView:0',
    'layer.setView:0',
  ]);
  assert.equal(host.getSnapshot().layers[0].childPartCount, 1);

  viewer.frame(0.1);
  assertCallOrder(calls, ['setup-child.update', 'layer.update']);
  assertCallOrder(calls, ['setup-child.beforeRender', 'layer.beforeRender']);
  assertCallOrder(calls, ['setup-child.afterRender', 'layer.afterRender']);

  viewer.resize({ width: 320, height: 240, devicePixelRatio: 1 });
  assertCallOrder(calls, ['setup-child.resize:320', 'layer.resize:320']);

  removeSetupChild();
  await flushMicrotasks();

  assert.ok(calls.includes('setup-child.detach'));
  assert.ok(calls.includes('setup-child.dispose'));
  assert.equal(host.getSnapshot().layers[0].childPartCount, 0);

  const removeDynamicChild = addDynamicChild();
  await flushMicrotasks();

  assertCallOrder(calls, [
    'dynamic-child.attach',
    'dynamic-child.start',
    'dynamic-child.setView:1',
    'dynamic-child.resize:320',
  ]);
  assert.equal(host.getSnapshot().layers[0].childPartCount, 1);

  viewer.frame(0.1);
  assert.ok(calls.includes('dynamic-child.update'));

  removeDynamicChild();
  await flushMicrotasks();

  assert.ok(calls.includes('dynamic-child.detach'));
  assert.ok(calls.includes('dynamic-child.dispose'));
  assert.equal(host.getSnapshot().layers[0].childPartCount, 0);

  await viewer.dispose();

  assert.ok(calls.includes('layer.detach'));
  assert.ok(calls.includes('layer.dispose'));
});

test('constellation and coordinate-frame layers publish spatial feature and waypoint products', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const constellationLayer = createSkykitConstellationLayer({
    id: 'western-constellations',
    manifest: {
      id: 'western',
      boundaries: {
        edges: ['001:002 M+ 00:00:00 +00:00:00 01:00:00 +00:00:00 AAA BBB'],
      },
      constellations: [
        {
          id: 'orion',
          iau: 'Ori',
          common_name: { native: 'Orion' },
          image: {
            file: 'orion.png',
            anchors: [
              { icrs: { x: 1, y: 0, z: 0 }, pixel: { x: 0, y: 0 } },
              { icrs: { x: 0, y: 1, z: 0 }, pixel: { x: 1, y: 1 } },
            ],
          },
        },
      ],
    },
    art: { loading: 'lazy' },
    publish: {
      features: 'features:constellations/western',
      waypoints: 'waypoints:constellations/western',
      catalog: 'surfaces:constellation-art/western',
    },
  });
  const frameLayer = createSkykitCoordinateFrameMarkerLayer({
    id: 'galactic-frame',
    frame: 'galactic',
    publish: {
      features: 'features:frames/galactic',
      waypoints: 'waypoints:frames/galactic',
    },
  });
  const layerHost = createSkykitLayerHostPlugin({
    layers: [constellationLayer, frameLayer],
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      products,
      layerHost,
    ],
  });

  const constellationFeatures = products.get('features:constellations/western');
  const constellationWaypoints = products.get('waypoints:constellations/western');
  const constellationCatalog = products.get('surfaces:constellation-art/western');
  const frameFeatures = products.get('features:frames/galactic');
  const frameWaypoints = products.get('waypoints:frames/galactic');

  assert.equal(constellationFeatures.type, 'FeatureCollection');
  assert.equal(constellationFeatures.features.some((feature) => feature.frame === 'observer-sky'), true);
  assert.equal(constellationWaypoints[0].target.targetPc.x > 0, true);
  assert.equal(typeof constellationCatalog.list, 'function');
  assert.equal(frameFeatures.features.some((feature) => feature.kind === 'coordinate-frame:axis'), true);
  assert.equal(frameWaypoints.length > 0, true);
  assert.equal(viewer.roots.observerContentRoot.children.some((child) => child.name === 'constellation-boundaries'), true);
  assert.equal(viewer.roots.observerContentRoot.children.some((child) => child.name === 'western-constellations:art'), true);
  assert.equal(layerHost.getSnapshot().layers[0].childPartCount, 1);

  await viewer.dispose();

  assert.equal(products.get('features:constellations/western'), null);
  assert.equal(products.get('surfaces:constellation-art/western'), null);
  assert.equal(products.get('features:frames/galactic'), null);
});

test('viewer exposes action registry, emits action events, and resets to initial view', async () => {
  const events = [];
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc: { x: 1, y: 2, z: 3 },
      limitingMagnitude: 8,
    },
  });
  viewer.on('action/invoke', (event) => events.push(event.id));

  viewer.requestViewState({ observerPc: { x: 9, y: 9, z: 9 }, limitingMagnitude: 5 }, 'test-move');
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 9, y: 9, z: 9 });

  await viewer.actions.invoke(SKYKIT_ACTIONS.viewer.reset, null, { source: 'test' });
  viewer.update(0);

  assert.deepEqual(events, [SKYKIT_ACTIONS.viewer.reset]);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 1, y: 2, z: 3 });
  assert.equal(viewer.getViewState().limitingMagnitude, 8);
  assert.equal(viewer.getSnapshot().actions.actions.some((entry) => entry.id === SKYKIT_ACTIONS.viewer.reset), true);

  await viewer.dispose();
});

test('viewer derives camera orientation from lookAt targets, sky coordinates, and stars', async () => {
  const targetViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      lookAt: { targetPc: { x: 10, y: 0, z: 0 }, positionAngleDeg: 0 },
    },
  });
  let view = targetViewer.getViewState();
  assert.deepEqual(view.targetPc, { x: 10, y: 0, z: 0 });
  assertVectorApprox(localVectorFromView(view, { x: 0, y: 0, z: -1 }), { x: 1, y: 0, z: 0 });
  assertVectorApprox(localVectorFromView(view, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: 1 });
  await targetViewer.dispose();

  const skyViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      lookAt: { raDeg: 0, decDeg: 0, positionAngleDeg: 90 },
    },
  });
  view = skyViewer.getViewState();
  assert.equal(view.targetPc, null);
  assertVectorApprox(localVectorFromView(view, { x: 0, y: 0, z: -1 }), { x: 1, y: 0, z: 0 });
  assertVectorApprox(localVectorFromView(view, { x: 0, y: 1, z: 0 }), { x: 0, y: 1, z: 0 });
  await skyViewer.dispose();

  const alnilamViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      lookAt: createRaDecLookAt('05h 36m 12.81s', '−01° 12′ 06.9″'),
    },
  });
  view = alnilamViewer.getViewState();
  assertVectorApprox(
    localVectorFromView(view, { x: 0, y: 0, z: -1 }),
    directionFromRaDec(84.053375, -1.2019166666666667),
  );
  await alnilamViewer.dispose();

  const siriusSpec = parseSpatialLookAtText('06h 45m 08.9s, -16d 42m 58s, 2.64pc');
  const orionSpec = parseSpatialLookAtText('05h 35m 17.3s, -05d 23m 28s, 414pc');
  const siriusPc = resolveSpatialTarget(siriusSpec);
  const orionPc = resolveSpatialTarget(orionSpec);
  assert.ok(siriusPc && orionPc && orionSpec);
  const solarTargetViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc: siriusPc,
      lookAt: orionSpec,
    },
  });
  view = solarTargetViewer.getViewState();
  assertVectorApprox(view.observerPc, siriusPc);
  assertVectorApprox(view.targetPc, orionPc);
  assertVectorApprox(
    localVectorFromView(view, { x: 0, y: 0, z: -1 }),
    normalizeVector(subtractVectors(orionPc, siriusPc)),
  );

  const movedObserver = { x: -8, y: 3, z: 11 };
  solarTargetViewer.requestViewState({ observerPc: movedObserver, lookAt: orionSpec }, 'test-solar-radec');
  solarTargetViewer.update(0);
  view = solarTargetViewer.getViewState();
  assertVectorApprox(view.targetPc, orionPc);
  assertVectorApprox(
    localVectorFromView(view, { x: 0, y: 0, z: -1 }),
    normalizeVector(subtractVectors(orionPc, movedObserver)),
  );
  await solarTargetViewer.dispose();

  const starViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: { lookAt: { star: 'hyades' } },
    resolveLookAtStar: async (star) => star === 'hyades'
      ? { targetPc: { x: 4, y: 5, z: 6 } }
      : null,
  });
  view = starViewer.getViewState();
  assert.equal(view.lookAt?.star, 'hyades');
  assert.deepEqual(view.targetPc, { x: 4, y: 5, z: 6 });
  assert.ok(view.orientationIcrs);

  starViewer.requestViewState({ lookAt: { star: 'orion' } }, 'test-star-look');
  await new Promise((resolve) => setTimeout(resolve, 0));
  starViewer.update(0);
  assert.deepEqual(starViewer.getViewState().targetPc, null);
  await starViewer.dispose();
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

test('viewer keeps perspective camera projection metadata in view state during resize', async () => {
  const camera = new THREE.PerspectiveCamera(72, 1, 0.01, 1000);
  const renderer = createRenderer();
  const viewer = await createSkykitViewer({ camera, renderer });
  const viewChanges = [];
  viewer.on('view/change', (event) => viewChanges.push(event.view));

  assert.equal(viewer.getViewState().verticalFovDeg, 72);
  assert.equal(viewer.getViewState().aspectRatio, 1);

  viewer.resize({ width: 800, height: 400, devicePixelRatio: 1 });

  assert.equal(camera.aspect, 2);
  assert.equal(viewer.getViewState().verticalFovDeg, 72);
  assert.equal(viewer.getViewState().aspectRatio, 2);
  assert.equal(viewChanges.at(-1).aspectRatio, 2);

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

test('action registry registers contexts, invokes multiple handlers, and reports failures', async () => {
  const registry = createSkykitActionRegistry();
  const calls = [];
  const errors = [];
  registry.subscribe((event) => {
    if (event.type === 'action/error') errors.push(event.message);
  });
  const offLow = registry.registerAction('lesson:demo.run', () => {
    calls.push('low');
    return 'low';
  }, { priority: 10 });
  registry.registerAction('lesson:demo.run', () => {
    calls.push('high');
    return 'high';
  }, { priority: -1 });
  registry.registerAction('lesson:demo.run', () => {
    calls.push('fail');
    throw new Error('demo failed');
  }, { priority: 20 });

  const results = await registry.invoke('lesson:demo.run', { id: 1 }, { source: 'test' });
  assert.deepEqual(calls, ['high', 'low', 'fail']);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.deepEqual(errors, ['demo failed']);

  offLow();
  assert.equal(registry.listActions().find((entry) => entry.id === 'lesson:demo.run')?.handlerCount, 2);

  const offChapters = registry.registerContext('lesson:chapters', {
    goTo({ payload }) {
      calls.push(`chapter:${payload}`);
    },
  });
  await registry.invoke('lesson:chapters.goTo', 'intro');
  assert.equal(calls.at(-1), 'chapter:intro');
  offChapters();
  assert.equal(registry.listActions().some((entry) => entry.id === 'lesson:chapters.goTo'), false);
});

test('action registry tracks held action sources and control values', () => {
  const registry = createSkykitActionRegistry();
  assert.equal(SKYKIT_ACTION_NAMESPACE, 'skykit:');

  registry.press(SKYKIT_ACTIONS.ship.moveForward, null, { source: 'keyboard:KeyW' });
  registry.press(SKYKIT_ACTIONS.ship.moveForward, null, { source: 'touch:dpad-up' });
  assert.equal(registry.isPressed(SKYKIT_ACTIONS.ship.moveForward), true);
  registry.release(SKYKIT_ACTIONS.ship.moveForward, { source: 'keyboard:KeyW' });
  assert.equal(registry.isPressed(SKYKIT_ACTIONS.ship.moveForward), true);
  registry.release(SKYKIT_ACTIONS.ship.moveForward, { source: 'touch:dpad-up' });
  assert.equal(registry.isPressed(SKYKIT_ACTIONS.ship.moveForward), false);

  const move = { x: 0, y: 0, z: -1 };
  registry.setControlValue(SKYKIT_CONTROLS.ship.move, move, { source: 'test' });
  assert.equal(registry.getControlValue(SKYKIT_CONTROLS.ship.move), move);
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
    session: { strategy: createObserverShellStrategy() },
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [plugin],
  });
  assert.equal(plugin.getLayer()?.id, 'stars-plugin');
  assert.equal(plugin.getSnapshot().status, 'idle');

  session.emit({ type: 'stars/cells-upsert', providerId: 'provider', cells: [] });
  assert.ok(rendererCalls.includes('stars/cells-upsert'));

  await viewer.dispose();
  assert.equal(session.disposed, true);
  assert.ok(rendererCalls.includes('dispose'));
});

test('shared star source feeds starfield and HR consumers from one provider session', async () => {
  const session = createFakeSession();
  const provider = {
    id: 'provider',
    sessions: [],
    createSession(options) {
      provider.sessions.push(options);
      return session;
    },
  };
  const source = createSkykitStarSourcePlugin({ provider });
  const rendererCalls = [];
  const starRenderer = {
    object3d: new THREE.Group(),
    apply(delta) { rendererCalls.push(delta.type); },
    setView(view) { rendererCalls.push(`view:${view.coordinateUnitsPerParsec}`); },
    getSnapshot() { return { renderer: 'stars' }; },
    dispose() { rendererCalls.push('dispose'); },
  };
  const stars = createStreamingStarsPlugin({
    id: 'stars',
    source,
    renderer: starRenderer,
    attributes: ['position'],
  });
  const hr = createSkykitHrDiagramPlugin({
    id: 'hr',
    source,
    mode: 'volume-complete',
    volumeRadiusPc: 12,
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [source, stars, hr],
    view: {
      limitingMagnitude: 4,
      coordinateUnitsPerParsec: 0.01,
    },
  });

  assert.equal(provider.sessions.length, 1);
  assertStrategyBehavior(provider.sessions[0].strategy);
  assert.deepEqual(provider.sessions[0].attributes, ['position', 'teffLog8', 'magAbs']);
  assert.equal(session.updateCalls[0].patch.limitingMagnitude, 4);
  assert.equal(source.getSnapshot().demandCount, 2);

  const cell = createTestCell({ keyOrdinal: 1 });
  session.emit({ type: 'stars/cells-upsert', providerId: 'provider', cells: [cell] });

  assert.ok(rendererCalls.includes('stars/cells-upsert'));
  assert.equal(source.getStore().getSnapshot().starCount, 1);
  assert.equal(hr.getSource().getSnapshot().starCount, 1);

  await viewer.dispose();
  assert.equal(session.disposed, true);
  assert.ok(rendererCalls.includes('dispose'));
});

test('shared star source clears cells immediately on demand restarts by default', async () => {
  const { sessions, source, deltas, viewer } = await createRestartingStarSourceFixture();

  await source.refreshDemand('test.restart');

  assert.equal(sessions.length, 2);
  assert.equal(source.getStore().getSnapshot().starCount, 0);
  assert.equal(deltas.filter((delta) => delta.type === 'stars/cells-remove').length, 1);

  await viewer.dispose();
});

test('shared star source can retain restart cells until the first replacement upsert', async () => {
  const { sessions, source, deltas, viewer } = await createRestartingStarSourceFixture({
    until: 'first-upsert',
    maxAgeMs: 1_000,
  });

  await source.refreshDemand('test.restart');

  assert.equal(sessions.length, 2);
  assert.equal(source.getStore().getSnapshot().starCount, 1);
  assert.equal(deltas.filter((delta) => delta.type === 'stars/cells-remove').length, 0);

  const secondCell = createTestCell({ keyOrdinal: 2 });
  sessions[1].emit({ type: 'stars/cells-upsert', providerId: 'provider', cells: [secondCell] });

  assert.equal(source.getStore().getSnapshot().starCount, 1);
  assert.deepEqual(source.getStore().getCells().map((cell) => cell.cellKey), [secondCell.cellKey]);
  assert.equal(deltas.filter((delta) => delta.type === 'stars/cells-remove').length, 1);

  await viewer.dispose();
});

test('shared star source can retain restart cells until replacement current', async () => {
  const { sessions, source, deltas, viewer } = await createRestartingStarSourceFixture({
    until: 'current',
    maxAgeMs: 1_000,
  });

  await source.refreshDemand('test.restart');

  const secondCell = createTestCell({ keyOrdinal: 2 });
  sessions[1].emit({ type: 'stars/cells-upsert', providerId: 'provider', cells: [secondCell] });

  assert.equal(source.getStore().getSnapshot().starCount, 2);
  assert.equal(deltas.filter((delta) => delta.type === 'stars/cells-remove').length, 0);

  sessions[1].emit({
    type: 'stars/current',
    providerId: 'provider',
    cellKeys: [secondCell.cellKey],
    starCount: secondCell.count,
  });

  assert.equal(source.getStore().getSnapshot().starCount, 1);
  assert.deepEqual(source.getStore().getCells().map((cell) => cell.cellKey), [secondCell.cellKey]);
  assert.equal(deltas.filter((delta) => delta.type === 'stars/cells-remove').length, 1);

  await viewer.dispose();
});

test('shared star source clears retained restart cells on replacement errors', async () => {
  const { sessions, source, deltas, viewer } = await createRestartingStarSourceFixture({
    until: 'current',
    maxAgeMs: 1_000,
  });

  await source.refreshDemand('test.restart');
  sessions[1].emit({
    type: 'stars/error',
    providerId: 'provider',
    error: new Error('replacement failed'),
  });

  assert.equal(source.getStore().getSnapshot().starCount, 0);
  assert.equal(deltas.filter((delta) => delta.type === 'stars/cells-remove').length, 1);

  await viewer.dispose();
});

test('shared star source expires retained restart cells after maxAgeMs', async () => {
  const { source, deltas, viewer } = await createRestartingStarSourceFixture({
    until: 'current',
    maxAgeMs: 5,
  });

  await source.refreshDemand('test.restart');
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(source.getStore().getSnapshot().starCount, 0);
  assert.equal(deltas.filter((delta) => delta.type === 'stars/cells-remove').length, 1);

  await viewer.dispose();
});

test('shared star source reports provider errors through the debug bridge', async () => {
  const session = createFakeSession();
  const source = createSkykitStarSourcePlugin({ session });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [source],
  });
  const debug = createSkykitDebugBridge();
  debug.registerViewer(viewer, { id: 'debug-source' });

  session.emit({
    type: 'stars/error',
    providerId: 'provider',
    sessionId: session.id,
    demandRevision: 3,
    error: new Error('verticalFovDeg must be a positive finite number.'),
  });

  const diagnostics = debug.listDiagnostics();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].type, 'stars/source/error');
  assert.equal(diagnostics[0].viewerId, 'debug-source');
  assert.equal(diagnostics[0].message, 'verticalFovDeg must be a positive finite number.');
  assert.equal(diagnostics[0].data.sessionId, session.id);

  await viewer.dispose();
});

test('HR diagram mode changes refresh shared demand and update the renderer view', async () => {
  const sessions = [];
  const provider = {
    id: 'provider',
    createSession(options) {
      const session = createFakeSession({ id: `session-${sessions.length + 1}` });
      sessions.push({ options, session });
      return session;
    },
  };
  const source = createSkykitStarSourcePlugin({ provider });
  const starRenderer = {
    object3d: new THREE.Group(),
    apply() {},
    setView() {},
    getSnapshot() { return { renderer: 'stars' }; },
    dispose() {},
  };
  const stars = createStreamingStarsPlugin({
    id: 'stars',
    source,
    renderer: starRenderer,
    attributes: ['position'],
  });
  const hr = createSkykitHrDiagramPlugin({
    id: 'hr',
    source,
    mode: 'frustum',
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [source, stars, hr],
  });

  assert.equal(sessions.length, 1);
  assertStrategyBehavior(sessions[0].options.strategy);
  assert.equal(hr.getMode(), 'frustum');

  await hr.setMode('magnitude-limited');

  assert.equal(hr.getMode(), 'magnitude-limited');
  assert.equal(sessions.length, 1);

  await hr.setMode('volume-complete');

  assert.equal(hr.getMode(), 'volume-complete');
  assert.equal(hr.getSource().getSnapshot().view.mode, 'volume-complete');
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].session.disposed, true);
  assertStrategyBehavior(sessions[1].options.strategy);

  await viewer.dispose();
});

test('HR diagram touch-os surfaces can be resolved lazily from panel runtimes', async () => {
  const session = createFakeSession();
  const provider = {
    id: 'provider',
    createSession() {
      return session;
    },
  };
  const source = createSkykitStarSourcePlugin({ provider });
  const surfaces = createEmbeddedSurfaceSpy();
  let activeSurfaces = null;
  const hr = createSkykitHrDiagramPlugin({
    id: 'hr',
    source,
    touchOs: {
      sourceId: 'hr:surface',
      surfaces: () => activeSurfaces,
    },
  });
  const viewer = await createSkykitViewer({
    renderer: createTextureRenderer(),
    plugins: [source, hr],
  });

  activeSurfaces = surfaces;
  viewer.frame(0.016);

  assert.equal(surfaces.publishCalls.length, 1);
  assert.equal(surfaces.publishCalls[0].sourceId, 'hr:surface');
  assert.equal(surfaces.publishCalls[0].update.available, true);

  await viewer.dispose();
  assert.deepEqual(surfaces.unpublishCalls, ['hr:surface']);
});

test('HR diagram demand strategy override can be supplied and restored at runtime', async () => {
  const sessions = [];
  const provider = {
    id: 'provider',
    createSession(options) {
      const session = createFakeSession({ id: `session-${sessions.length + 1}` });
      sessions.push({ options, session });
      return session;
    },
  };
  const source = createSkykitStarSourcePlugin({ provider });
  const customStrategy = createObserverShellStrategy();
  const contexts = [];
  const hr = createSkykitHrDiagramPlugin({
    id: 'hr',
    source,
    mode: 'volume-complete',
    volumeRadiusPc: 12,
    demandStrategy(context) {
      contexts.push(context);
      return customStrategy;
    },
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [source, hr],
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].options.strategy, customStrategy);
  assert.equal(contexts[0].mode, 'volume-complete');
  assert.equal(contexts[0].volumeRadiusPc, 12);
  assert.equal(typeof contexts[0].createDefaultStrategy, 'function');
  assert.equal(hr.getSnapshot().demandStrategyActive, true);

  await hr.setOptions({ demandStrategy: null });

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].session.disposed, true);
  assert.notEqual(sessions[1].options.strategy, customStrategy);
  assertStrategyBehavior(sessions[1].options.strategy);
  assert.equal(hr.getSnapshot().demandStrategyActive, false);

  await viewer.dispose();
});

test('star picking plugin emits selected stars from click gestures', async () => {
  const target = createPointerTarget();
  const pickResult = createPickResult();
  const picks = [];
  const emitted = [];
  const renderer = {
    pick(ray, options) {
      picks.push({ ray, options });
      return pickResult;
    },
  };
  const plugin = createSkykitStarPickingPlugin({
    target,
    renderer,
    onPick(event) {
      emitted.push(event);
    },
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    camera: new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100),
    plugins: [plugin],
    view: {
      limitingMagnitude: 6,
      coordinateUnitsPerParsec: 0.001,
    },
  });
  const viewerEvents = [];
  viewer.on('stars/pick', (event) => viewerEvents.push(event));

  target.dispatch('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 300 });
  target.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 300 });
  await flushMicrotasks();

  assert.equal(picks.length, 1);
  assert.equal(picks[0].options.limitingMagnitude, 6);
  assert.equal(picks[0].options.coordinateUnitsPerParsec, 0.001);
  assert.equal(picks[0].options.viewportHeight, 600);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].pick, pickResult);
  assert.equal(emitted[0].label, `${pickResult.cellKey}:${pickResult.objectIndex}`);
  assert.equal(viewerEvents.length, 1);

  await viewer.dispose();
  assert.equal(target.listenerCount('pointerdown'), 0);
  assert.equal(target.listenerCount('pointerup'), 0);
});

test('star picking plugin writes public object refs to product-backed selection', async () => {
  const target = createPointerTarget();
  const objectRef = {
    datasetId: 'gaia-dr3',
    level: 4,
    mortonCode: '00af',
    ordinal: 7,
  };
  const pickResult = createPickResult({ objectRef });
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const selectionProducts = createSkykitSelectionProductsPlugin({ id: 'selection' });
  const plugin = createSkykitStarPickingPlugin({
    target,
    renderer: {
      pick() {
        return pickResult;
      },
    },
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    camera: new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100),
    plugins: [products, selectionProducts, plugin],
  });

  target.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  target.dispatch('pointerup', { pointerId: 1, clientX: 400, clientY: 300 });
  await flushMicrotasks();

  const selection = products.get('selection:primary').getPrimary();
  assert.equal(selection.kind, 'star');
  assert.equal(selection.identityAvailable, true);
  assert.deepEqual(selection.ref, objectRef);
  assert.equal(selection.label, 'Selected star');
  assert.deepEqual(selection.pick.position, pickResult.position);
  assert.equal(selection.diagnostic, undefined);

  await viewer.dispose();
});

test('star picking plugin enriches selections from sidecar-like getMeta providers', async () => {
  const target = createPointerTarget();
  const objectRef = {
    datasetId: 'gaia-dr3',
    level: 5,
    mortonCode: '001abc',
    ordinal: 42,
  };
  const facts = {
    proper_name: 'Sirius',
    hd: 48915,
  };
  const providerCalls = [];
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const selectionProducts = createSkykitSelectionProductsPlugin({ id: 'selection' });
  const plugin = createSkykitStarPickingPlugin({
    target,
    renderer: {
      pick() {
        return createPickResult({ objectRef });
      },
    },
    metadata: {
      async getMeta(ref) {
        providerCalls.push(ref);
        return facts;
      },
    },
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    camera: new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100),
    plugins: [products, selectionProducts, plugin],
  });

  target.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  target.dispatch('pointerup', { pointerId: 1, clientX: 400, clientY: 300 });
  await flushMicrotasks();

  const selection = products.get('selection:primary').getPrimary();
  assert.deepEqual(providerCalls, [objectRef]);
  assert.equal(selection.kind, 'star');
  assert.deepEqual(selection.ref, objectRef);
  assert.equal(selection.label, 'Sirius');
  assert.deepEqual(selection.facts, facts);

  await viewer.dispose();
});

test('star picking plugin writes unavailable selections without deriving fake ids', async () => {
  const target = createPointerTarget();
  const pickResult = createPickResult({
    objectRef: null,
    pickMeta: {
      cellKey: '2:7',
      level: 2,
      mortonCode: '7',
      ordinal: 0,
      gridX: 0,
      gridY: 0,
      gridZ: 0,
      centerX: 0,
      centerY: 0,
      centerZ: 0,
    },
  });
  const providerCalls = [];
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const selectionProducts = createSkykitSelectionProductsPlugin({ id: 'selection' });
  const plugin = createSkykitStarPickingPlugin({
    target,
    renderer: {
      pick() {
        return pickResult;
      },
    },
    metadata: {
      async getMeta(ref) {
        providerCalls.push(ref);
        return { proper_name: 'Should not load' };
      },
    },
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    camera: new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100),
    plugins: [products, selectionProducts, plugin],
  });

  target.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  target.dispatch('pointerup', { pointerId: 1, clientX: 400, clientY: 300 });
  await flushMicrotasks();

  const selection = products.get('selection:primary').getPrimary();
  assert.deepEqual(providerCalls, []);
  assert.equal(selection.kind, 'star-pick-unavailable');
  assert.equal(selection.identityAvailable, false);
  assert.equal(selection.ref, undefined);
  assert.equal(selection.id, undefined);
  assert.equal(selection.label, 'Star identity unavailable');
  assert.deepEqual(selection.diagnostic, {
    cellKey: '2:7',
    objectIndex: 0,
    pickMeta: {
      cellKey: '2:7',
      level: 2,
      mortonCode: '7',
      ordinal: 0,
      gridX: 0,
      gridY: 0,
      gridZ: 0,
      centerX: 0,
      centerY: 0,
      centerZ: 0,
    },
  });

  await viewer.dispose();
});

test('star picking plugin ignores drag gestures and reports misses without clearing selection', async () => {
  const dragTarget = createPointerTarget();
  let pickCalls = 0;
  const dragPicker = createSkykitStarPickingPlugin({
    target: dragTarget,
    renderer: {
      pick() {
        pickCalls += 1;
        return createPickResult();
      },
    },
  });
  const dragViewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [dragPicker],
  });

  dragTarget.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  dragTarget.dispatch('pointermove', { pointerId: 1, clientX: 112, clientY: 100 });
  dragTarget.dispatch('pointerup', { pointerId: 1, clientX: 112, clientY: 100 });
  await flushMicrotasks();

  assert.equal(pickCalls, 0);
  assert.equal(dragPicker.getSnapshot().ignoredDragCount, 1);
  await dragViewer.dispose();

  const missTarget = createPointerTarget();
  let selected = createPickResult({ cellKey: 'existing-cell', objectIndex: 2 });
  const misses = [];
  const missPicker = createSkykitStarPickingPlugin({
    target: missTarget,
    renderer: {
      pick() {
        return null;
      },
    },
    onMiss(event) {
      misses.push(event);
    },
  });
  const missViewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [missPicker],
  });

  missTarget.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 200, clientY: 200 });
  missTarget.dispatch('pointerup', { pointerId: 2, clientX: 200, clientY: 200 });
  await flushMicrotasks();

  assert.equal(misses.length, 1);
  assert.equal(missPicker.getSnapshot().missCount, 1);
  assert.equal(selected.cellKey, 'existing-cell');

  await missViewer.dispose();
});

test('layer selection helper converts only explicit public pick identities', () => {
  assert.deepEqual(
    createSkykitLayerSelectionFromPick({
      selection: { kind: 'layer', id: 'grid:equator', label: 'Equator' },
      productKey: 'features:grid',
      layerId: 'grid',
      distance: 2,
    }, { source: 'lesson' }),
    {
      kind: 'layer',
      id: 'grid:equator',
      label: 'Equator',
      source: 'lesson',
      productKey: 'features:grid',
      layerId: 'grid',
      pick: { distance: 2 },
    },
  );

  assert.deepEqual(
    createSkykitLayerSelectionFromPick({
      waypoint: {
        id: 'galactic:north-pole',
        label: 'Galactic north pole',
        kind: 'coordinate-frame:pole',
        target: { targetPc: { x: 0, y: 0, z: 8 } },
        layerId: 'coordinate-frame:galactic',
      },
      productKey: 'waypoints:frames/galactic',
    }, { source: 'frame-layer' }),
    {
      kind: 'waypoint',
      id: 'galactic:north-pole',
      label: 'Galactic north pole',
      target: { targetPc: { x: 0, y: 0, z: 8 } },
      source: 'frame-layer',
      productKey: 'waypoints:frames/galactic',
      layerId: 'coordinate-frame:galactic',
    },
  );

  assert.deepEqual(
    createSkykitLayerSelectionFromPick({
      feature: {
        id: 'galactic:plane',
        label: 'Galactic plane',
        layerId: 'coordinate-frame:galactic',
      },
      productKey: 'features:frames/galactic',
    }, { source: 'frame-layer' }),
    {
      kind: 'layer',
      id: 'galactic:plane',
      label: 'Galactic plane',
      source: 'frame-layer',
      productKey: 'features:frames/galactic',
      layerId: 'coordinate-frame:galactic',
    },
  );

  assert.deepEqual(
    createSkykitLayerSelectionFromPick({
      feature: {
        id: 'galactic:x-axis',
        kind: 'coordinate-frame:axis',
        label: 'Galactic X axis',
      },
    }, { source: 'frame-layer' }),
    {
      kind: 'coordinate-frame:axis',
      id: 'galactic:x-axis',
      label: 'Galactic X axis',
      source: 'frame-layer',
    },
  );

  assert.deepEqual(
    createSkykitLayerSelectionFromPick({
      kind: 'object',
      id: 'lesson-marker',
      label: 'Lesson marker',
      target: { targetPc: { x: 1, y: 2, z: 3 } },
    }, { source: 'lesson-plugin' }),
    {
      kind: 'object',
      id: 'lesson-marker',
      label: 'Lesson marker',
      target: { targetPc: { x: 1, y: 2, z: 3 } },
      source: 'lesson-plugin',
    },
  );

  assert.equal(createSkykitLayerSelectionFromPick({ object: { name: 'mesh-name' } }), null);
  assert.equal(createSkykitLayerSelectionFromPick({ kind: 'object', label: 'Missing id' }), null);
  assert.equal(createSkykitLayerSelectionFromPick({ type: 'miss', hit: null }), null);
  assert.equal(createSkykitLayerSelectionFromPick({ type: 'blocked', hit: { waypoint: { id: 'blocked' } } }), null);
});

test('layer selection plugin writes semantic selections without clearing on route misses', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const selectionProducts = createSkykitSelectionProductsPlugin({ id: 'selection' });
  const layerSelection = createSkykitLayerSelectionPlugin();
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [products, selectionProducts, layerSelection],
  });

  await viewer.actions.invoke(SKYKIT_ACTIONS.selection.select, {
    waypoint: {
      id: 'route:start',
      label: 'Route start',
      target: { targetPc: { x: 4, y: 5, z: 6 } },
      layerId: 'lesson-route',
    },
    productKey: 'waypoints:lesson-route',
  }, { source: 'test' });

  const selected = products.get('selection:primary').getPrimary();
  assert.deepEqual(selected, {
    kind: 'waypoint',
    id: 'route:start',
    label: 'Route start',
    target: { targetPc: { x: 4, y: 5, z: 6 } },
    source: 'test',
    productKey: 'waypoints:lesson-route',
    layerId: 'lesson-route',
  });

  await viewer.actions.invoke(SKYKIT_ACTIONS.selection.select, { type: 'miss', hit: null }, { source: 'test' });
  assert.equal(products.get('selection:primary').getPrimary(), selected);
  assert.equal(layerSelection.getSnapshot().writeCount, 1);
  assert.equal(layerSelection.getSnapshot().ignoredCount, 1);

  await viewer.dispose();
});

test('star picking demand adds attributes but no extra cell strategy', async () => {
  const sessions = [];
  const provider = {
    id: 'provider',
    createSession(options) {
      const session = createFakeSession({ id: `session-${sessions.length + 1}` });
      sessions.push({ options, session });
      return session;
    },
  };
  const source = createSkykitStarSourcePlugin({ provider });
  const starRenderer = {
    object3d: new THREE.Group(),
    apply() {},
    setView() {},
    pick() { return null; },
    getSnapshot() { return { renderer: 'stars' }; },
    dispose() {},
  };
  const stars = createStreamingStarsPlugin({
    id: 'stars',
    source,
    renderer: starRenderer,
    attributes: ['position'],
  });
  const picker = createSkykitStarPickingPlugin({
    target: createPointerTarget(),
    source,
    renderer: starRenderer,
    metadata: createSkykitStarPickMetadataResolver({
      fallbackLabel: 'Selected star',
    }),
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [source, stars, picker],
  });

  assert.equal(sessions.length, 1);
  assertStrategyBehavior(sessions[0].options.strategy);
  assert.deepEqual(sessions[0].options.attributes, [
    'position',
    'teffLog8',
    'magAbs',
    'objectRef',
    'pickMeta',
  ]);
  const pickerDemand = source.getSnapshot().demands.find((demand) => demand.id === 'skykit-star-picking:attributes');
  assert.deepEqual(pickerDemand.attributes, [
    'position',
    'teffLog8',
    'magAbs',
    'objectRef',
    'pickMeta',
  ]);

  await viewer.dispose();
});

test('star pick metadata resolver uses structural providers and fallback labels', async () => {
  const providerCalls = [];
  const resolver = createSkykitStarPickMetadataResolver({
    provider: {
      getMeta(ref) {
        providerCalls.push(['getMeta', ref]);
        return { proper_name: 'Vega' };
      },
      resolvePrimaryLabel(ref) {
        providerCalls.push(['resolvePrimaryLabel', ref]);
        return 'Ignored';
      },
    },
    fallbackLabel: (pick) => `fallback:${pick.cellKey}:${pick.objectIndex}`,
  });
  const pick = createPickResult({
    objectRef: {
      datasetId: 'dataset-a',
      level: 2,
      mortonCode: '7',
      ordinal: 4,
    },
  });

  const metadata = await resolver(pick, /** @type {any} */ ({}));

  assert.equal(metadata.label, 'Vega');
  assert.deepEqual(providerCalls, [['getMeta', pick.objectRef]]);

  const fallbackResolver = createSkykitStarPickMetadataResolver({
    fallbackLabel: (nextPick) => `fallback:${nextPick.cellKey}:${nextPick.objectIndex}`,
  });
  const fallback = await fallbackResolver(
    createPickResult({ cellKey: 'cell-b', objectIndex: 3 }),
    /** @type {any} */ ({}),
  );

  assert.equal(fallback.label, 'fallback:cell-b:3');

  const unavailableProviderCalls = [];
  const unavailable = await createSkykitStarPickMetadataResolver({
    provider: {
      getMeta(ref) {
        unavailableProviderCalls.push(ref);
        return { proper_name: 'Should not load' };
      },
    },
  })(createPickResult({
    objectRef: null,
    pickMeta: {
      cellKey: 'cell-c',
      level: 1,
      mortonCode: 'c',
      ordinal: 3,
      gridX: 0,
      gridY: 0,
      gridZ: 0,
      centerX: 0,
      centerY: 0,
      centerZ: 0,
    },
  }), /** @type {any} */ ({}));

  assert.deepEqual(unavailableProviderCalls, []);
  assert.equal(unavailable.ref, null);
  assert.equal(unavailable.label, '');
});

test('inspect facade records bounded action and selection history', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const selectionProducts = createSkykitSelectionProductsPlugin({ id: 'selection' });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [products, selectionProducts],
  });
  const selection = createSkykitSelectionFacade({
    store: selectionProducts.primary,
    products,
  });
  const inspect = createSkykitInspectFacade({
    viewer,
    products,
    selection,
    historyLimit: 2,
  });

  viewer.actions.press('skykit:test.press', { amount: 1 }, { source: 'keyboard' });
  selection.set({ kind: 'object', id: 'marker-a', label: 'Marker A', source: 'test' }, { source: 'test' });
  viewer.actions.setControlValue('skykit:test.control', { x: 1 }, { source: 'stick' });

  const history = inspect.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].type, 'selection');
  assert.equal(history[0].eventType, 'selection/change');
  assert.deepEqual(history[0].selection, {
    kind: 'object',
    id: 'marker-a',
    label: 'Marker A',
    productKey: null,
    source: 'test',
  });
  assert.equal(history[1].type, 'action');
  assert.equal(history[1].eventType, 'action/control');
  assert.equal(history[1].actionId, 'skykit:test.control');
  assert.equal(history[1].source, 'stick');
  assert.deepEqual(history[1].value, { x: 1 });
  assert.doesNotThrow(() => JSON.stringify(inspect.getSnapshot().history));

  inspect.dispose();
  selection.set({ kind: 'object', id: 'marker-b' }, { source: 'test' });
  assert.equal(inspect.getHistory().length, 2);

  await viewer.dispose();
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

test('animation loop can throttle rendered frames', async () => {
  const renderer = createRenderer();
  const viewer = await createSkykitViewer({ renderer });
  const callbacks = [];
  let nowMs = 1000;
  const loop = createSkykitAnimationLoop(viewer, {
    maxFramesPerSecond: 30,
    now: () => nowMs,
    requestAnimationFrame(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
  });

  loop.start();
  nowMs = 1016;
  callbacks.shift()(nowMs);
  assert.equal(renderer.renderCalls, 1);
  assert.equal(loop.getSnapshot().frameCount, 1);

  nowMs = 1030;
  callbacks.shift()(nowMs);
  assert.equal(renderer.renderCalls, 1);
  assert.equal(loop.getSnapshot().frameCount, 1);

  nowMs = 1050;
  callbacks.shift()(nowMs);
  assert.equal(renderer.renderCalls, 2);
  assert.equal(loop.getSnapshot().frameCount, 2);
  assert.ok(loop.getSnapshot().lastDeltaSeconds >= 0.033);

  loop.dispose();
  await viewer.dispose();
});

test('renderer-scheduled animation loop passes WebXR frame data to viewer frames', async () => {
  let animationCallback = null;
  const xrFrame = { marker: 'xr-frame' };
  const session = { id: 'session' };
  const referenceSpace = { type: 'local-floor' };
  const frameXrStates = [];
  const renderer = {
    ...createRenderer(),
    xr: {
      isPresenting: true,
      getSession() {
        return session;
      },
      getReferenceSpace() {
        return referenceSpace;
      },
    },
    setAnimationLoop(callback) {
      animationCallback = callback;
    },
  };
  const viewer = await createSkykitViewer({
    renderer,
    parts: [{
      update(frame) {
        frameXrStates.push(frame.xr);
      },
    }],
  });
  const loop = createSkykitAnimationLoop(viewer, {
    scheduler: 'renderer',
    now: () => 1000,
  });

  loop.start();
  assert.equal(typeof animationCallback, 'function');
  animationCallback(1016, xrFrame);

  assert.equal(renderer.renderCalls, 1);
  assert.deepEqual(frameXrStates[0], {
    presenting: true,
    frame: xrFrame,
    session,
    referenceSpace,
  });

  loop.stop();
  assert.equal(animationCallback, null);
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
  assert.equal(SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS.KeyW, SKYKIT_ACTIONS.ship.moveForward);
  assert.equal(SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS.ArrowUp, SKYKIT_ACTIONS.ship.moveForward);

  const target = createEventTarget();
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      createKeyboardNavigationPlugin({
        target,
        speedPcPerSec: 1,
        bindings: {
          KeyI: SKYKIT_ACTIONS.ship.moveForward,
          KeyK: SKYKIT_ACTIONS.ship.moveBack,
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

test('keyboard navigation reads shared ship actions from the registry', async () => {
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [createKeyboardNavigationPlugin({ target: null, speedPcPerSec: 3 })],
  });

  viewer.actions.press(SKYKIT_ACTIONS.ship.moveRight, null, { source: 'touch:dpad-right' });
  viewer.frame(1);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 3, y: 0, z: 0 });
  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.ship.move), { x: 3, y: 0, z: 0 });
  viewer.actions.release(SKYKIT_ACTIONS.ship.moveRight, { source: 'touch:dpad-right' });

  await viewer.dispose();
});

test('default keyboard binding factory returns an explicit override map', async () => {
  const bindings = createSkykitDefaultKeyboardNavigationBindings({
    KeyW: SKYKIT_ACTIONS.ship.rollAnticlockwise,
    KeyI: SKYKIT_ACTIONS.ship.moveForward,
  });
  assert.equal(bindings.KeyW, SKYKIT_ACTIONS.ship.rollAnticlockwise);
  assert.equal(bindings.ArrowUp, SKYKIT_ACTIONS.ship.moveForward);
  assert.equal(bindings.KeyI, SKYKIT_ACTIONS.ship.moveForward);
  assert.equal(SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS.KeyW, SKYKIT_ACTIONS.ship.moveForward);

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

test('keyboard navigation function bindings run callbacks through the plugin context', async () => {
  const target = createEventTarget();
  let callbackCount = 0;
  const bindings = createSkykitDefaultKeyboardNavigationBindings({
    KeyR({ key, event, viewer, getViewState, requestViewState }) {
      callbackCount += 1;
      assert.equal(key, 'KeyR');
      assert.equal(event.code, 'KeyR');
      assert.equal(viewer.id, 'keyboard-callback-viewer');
      assert.deepEqual(getViewState().observerPc, { x: 0, y: 0, z: 0 });
      requestViewState({ observerPc: { x: 4, y: 5, z: 6 } }, 'test-reset');
    },
  });
  const plugin = createKeyboardNavigationPlugin({
    target,
    bindings,
    speedPcPerSec: 1,
  });
  const viewer = await createSkykitViewer({
    id: 'keyboard-callback-viewer',
    renderer: createRenderer(),
    plugins: [plugin],
  });

  const keydown = target.dispatch('keydown', { code: 'KeyR' });
  viewer.update(0);

  assert.equal(callbackCount, 1);
  assert.equal(keydown.defaultPrevented, true);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 4, y: 5, z: 6 });
  assert.deepEqual(plugin.getSnapshot().pressed, []);

  const keyup = target.dispatch('keyup', { code: 'KeyR' });
  assert.equal(keyup.defaultPrevented, true);

  await viewer.dispose();
});

test('keyboard navigation invokes namespaced command bindings through the action registry', async () => {
  const target = createEventTarget();
  const calls = [];
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      (context) => {
        context.actions.registerAction('game:weapons.fire', ({ payload, metadata }) => {
          calls.push({ payload, metadata });
        });
      },
      createKeyboardNavigationPlugin({
        target,
        bindings: createSkykitDefaultKeyboardNavigationBindings({
          KeyF: 'game:weapons.fire',
          KeyR: SKYKIT_ACTIONS.viewer.reset,
        }),
      }),
    ],
    view: {
      observerPc: { x: 3, y: 0, z: 0 },
    },
  });

  viewer.requestViewState({ observerPc: { x: 8, y: 0, z: 0 } }, 'test-move');
  viewer.update(0);
  target.dispatch('keydown', { code: 'KeyF' });
  target.dispatch('keydown', { code: 'KeyR' });
  await Promise.resolve();
  viewer.update(0);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { key: 'KeyF' });
  assert.equal(calls[0].metadata.source, 'keyboard:KeyF');
  assert.deepEqual(viewer.getViewState().observerPc, { x: 3, y: 0, z: 0 });

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
    KeyI: SKYKIT_ACTIONS.ship.pitchUp,
    KeyK: SKYKIT_ACTIONS.ship.pitchDown,
    KeyJ: SKYKIT_ACTIONS.ship.yawLeft,
    KeyL: SKYKIT_ACTIONS.ship.yawRight,
    KeyO: SKYKIT_ACTIONS.ship.rollClockwise,
    KeyU: SKYKIT_ACTIONS.ship.rollAnticlockwise,
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

test('navigation plugin registers semantic actions and resolves RA/Dec and bookmarks', async () => {
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      createSkykitNavigationPlugin({
        speed: 12,
        acceleration: 12,
        deceleration: 12,
        resolveBookmark(bookmarkId) {
          return bookmarkId === 'polaris'
            ? { raDeg: 0, decDeg: 90, distancePc: 10 }
            : null;
        },
      }),
    ],
  });

  assert.equal(viewer.actions.listActions().some((entry) => entry.id === SKYKIT_ACTIONS.navigation.flyTo), true);
  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.flyTo, { raDeg: 0, decDeg: 0, distancePc: 10 });
  viewer.update(0.5);
  viewer.update(0);
  assert.ok(viewer.getViewState().observerPc.x > 0);

  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.lookAt, { bookmarkId: 'polaris', blend: 1 });
  viewer.update(0.5);
  viewer.update(0);
  assert.notDeepEqual(viewer.getViewState().orientationIcrs, { x: 0, y: 0, z: 0, w: 1 });

  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.cancel);
  assert.equal(viewer.getSnapshot().parts.some((part) => part.id === 'navigation'), true);

  await viewer.dispose();
});

test('navigation transition action restores pose with independent lane durations', async () => {
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      createSkykitNavigationPlugin({
        resolveBookmark(bookmarkId) {
          return bookmarkId === 'origin' ? { x: 0, y: 0, z: 0 } : null;
        },
      }),
    ],
  });

  assert.equal(viewer.actions.listActions().some((entry) => entry.id === SKYKIT_ACTIONS.navigation.transitionTo), true);
  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
    observerPc: { x: 10, y: 0, z: 0 },
    orientationIcrs: { x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) },
    movement: { durationSecs: 5 },
    orientation: { durationSecs: 1 },
  });

  viewer.update(1);
  viewer.update(0);
  const afterOneSecond = viewer.getViewState();
  assert.ok(afterOneSecond.observerPc.x > 0 && afterOneSecond.observerPc.x < 10);
  assert.ok(Math.abs(afterOneSecond.orientationIcrs.y - Math.sin(Math.PI / 8)) < 1e-6);

  viewer.update(4);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 10, y: 0, z: 0 });
  const orientationAfterExplicitTransition = viewer.getViewState().orientationIcrs;

  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
    raDeg: 0,
    decDeg: 0,
    distancePc: 10,
    movement: { durationSecs: 1 },
  });
  viewer.update(1);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 10, y: 0, z: 0 });
  assert.deepEqual(viewer.getViewState().orientationIcrs, orientationAfterExplicitTransition);

  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
    target: { bookmarkId: 'origin' },
    movement: { durationSecs: 1 },
  });
  viewer.update(1);
  viewer.update(0);
  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: 0 });
  assert.deepEqual(viewer.getViewState().orientationIcrs, orientationAfterExplicitTransition);

  await viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, {
    lookAt: '05:36:12.81, −01:12:06.9',
    orientation: { durationSecs: 1 },
  });
  viewer.update(1);
  viewer.update(0);
  assertVectorApprox(
    localVectorFromView(viewer.getViewState(), { x: 0, y: 0, z: -1 }),
    directionFromRaDec(84.053375, -1.2019166666666667),
  );

  await viewer.dispose();
});


test('spatial preload hints map to star-octree requests without exposing provider internals', () => {
  const hints = [
    {
      kind: 'path-volume',
      pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      radiusPc: 2,
    },
    {
      kind: 'sphere-volume',
      centerPc: { x: 1, y: 2, z: 3 },
      radiusPc: 4,
    },
    {
      kind: 'view-lookahead',
      pose: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
      velocity: { x: 1, y: 0, z: 0 },
      lookaheadSecs: 5,
    },
  ];
  const requests = createSkykitStarPreloadRequestsFromSpatialHints(hints);

  assert.equal(requests.length, 3);
  for (const request of requests) {
    assertStrategyBehavior(request.strategy);
  }
  assert.equal(requests[0].view, undefined);
  assert.equal(
    requests[0].strategy
      .createEvaluator(requests[0].strategy.createAnchor({}))
      .evaluateCell({
        centerX: 5,
        centerY: 0,
        centerZ: 0,
        halfSize: 1,
        level: 1,
        mortonCode: '0',
      }).priority.lane,
    'warm',
  );
  assert.equal(
    requests[1].strategy
      .createEvaluator(requests[1].strategy.createAnchor({}))
      .evaluateCell({
        centerX: 1,
        centerY: 2,
        centerZ: 3,
        halfSize: 1,
        level: 1,
        mortonCode: '0',
      }).priority.lane,
    'warm',
  );
  assert.equal(requests[2].view.observerPc.x, 0);
  assert.deepEqual(requests[2].view.motion.velocityPcPerSec, { x: 1, y: 0, z: 0 });
  assert.equal(requests[2].view.motion.speedPcPerSec, 1);
  assert.equal(requests[2].view.motion.lookaheadSecs, 5);
  assert.equal(
    requests[2].strategy
      .createEvaluator(requests[2].strategy.createAnchor(requests[2].view), { indexMagnitude: 6.5 })
      .evaluateCell({
        centerX: 5,
        centerY: 0,
        centerZ: 0,
        halfSize: 1,
        level: 1,
        mortonCode: '0',
      }).priority.lane,
    'warm',
  );

  const combined = createSkykitStarStrategiesFromSpatialHints(hints);

  assertStrategyBehavior(combined);
  assert.equal(createSkykitStarStrategiesFromSpatialHints([hints[2]]), null);

  const separate = createSkykitStarStrategiesFromSpatialHints([], { combine: false });
  assert.deepEqual(separate, []);
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

test('sky orbit plugin orbits around the target and cleans pointer listeners', async () => {
  const center = { x: 0, y: 0, z: 0 };
  const target = createEventTarget();
  const plugin = createSkyOrbitPlugin({
    target,
    sensitivityRadiansPerPixel: 0.01,
  });
  const observerPc = { x: 0, y: 0, z: -10 };
  const orientationIcrs = computeSpatialLookAtOrientation({
    position: observerPc,
    target: center,
    up: { x: 0, y: 1, z: 0 },
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc,
      targetPc: center,
      orientationIcrs,
    },
    plugins: [plugin],
  });

  assert.equal(target.listenerCount('pointerdown'), 1);
  assert.equal(target.listenerCount('pointermove'), 1);
  assert.equal(target.listenerCount('pointerup'), 1);
  assert.equal(target.listenerCount('pointercancel'), 1);

  const down = target.dispatch('pointerdown', { button: 0, pointerId: 9, clientX: 100, clientY: 100 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(plugin.getSnapshot().dragging, true);
  assert.deepEqual(plugin.getSnapshot().centerPc, center);
  assert.equal(plugin.getSnapshot().radiusPc, 10);

  const move = target.dispatch('pointermove', { pointerId: 9, clientX: 110, clientY: 100 });
  assert.equal(move.defaultPrevented, true);
  viewer.update(0);

  const view = viewer.getViewState();
  assert.ok(Math.abs(view.observerPc.x) > 0.01);
  assert.ok(Math.abs(distance(view.observerPc, center) - 10) < 1e-9);
  assertVectorApprox(view.targetPc, center);
  assertVectorApprox(
    applyQuaternion({ x: 0, y: 0, z: -1 }, view.orientationIcrs),
    normalizeVector(subtractVectors(center, view.observerPc)),
  );
  assertVectorApprox(applyQuaternion(LOCAL_UP, view.orientationIcrs), { x: 0, y: 1, z: 0 });

  target.dispatch('pointerup', { pointerId: 9 });
  assert.equal(plugin.getSnapshot().dragging, false);

  await viewer.dispose();
  assert.equal(target.listenerCount('pointerdown'), 0);
  assert.equal(target.listenerCount('pointermove'), 0);
  assert.equal(target.listenerCount('pointerup'), 0);
  assert.equal(target.listenerCount('pointercancel'), 0);
});

test('sky orbit plugin ignores pointer down without a concrete center', async () => {
  const center = { x: 0, y: 0, z: 0 };
  const orientationIcrs = computeSpatialLookAtOrientation({
    position: { x: 0, y: 0, z: -10 },
    target: center,
  });
  const target = createEventTarget();
  const plugin = createSkyOrbitPlugin({ target });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc: { x: 0, y: 0, z: -10 },
      orientationIcrs,
    },
    plugins: [plugin],
  });

  const down = target.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 30 });
  assert.equal(down.defaultPrevented, false);
  assert.equal(plugin.getSnapshot().dragging, false);
  assert.equal(plugin.getSnapshot().sensitivityRadiansPerPixel, 0.00115);

  await viewer.dispose();
});

test('sky orbit plugin resolves centerPc shorthand and lets center win over centerPc', async () => {
  const center = { x: 0, y: 0, z: 0 };
  const ignoredCenter = { x: 2, y: 0, z: 0 };
  const orientationIcrs = computeSpatialLookAtOrientation({
    position: { x: 0, y: 0, z: -10 },
    target: center,
  });
  const shorthandTarget = createEventTarget();
  const shorthandPlugin = createSkyOrbitPlugin({
    target: shorthandTarget,
    centerPc: center,
    sensitivityRadiansPerPixel: 0.01,
  });
  const shorthandViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc: { x: 0, y: 0, z: -10 },
      orientationIcrs,
    },
    plugins: [shorthandPlugin],
  });

  shorthandTarget.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
  shorthandTarget.dispatch('pointermove', { pointerId: 2, clientX: 112, clientY: 100 });
  shorthandViewer.update(0);
  assertVectorApprox(shorthandViewer.getViewState().targetPc, center);
  await shorthandViewer.dispose();

  const explicitTarget = createEventTarget();
  const explicitPlugin = createSkyOrbitPlugin({
    target: explicitTarget,
    center: { targetPc: center },
    centerPc: ignoredCenter,
    sensitivityRadiansPerPixel: 0.01,
  });
  const explicitViewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc: { x: 0, y: 0, z: -10 },
      orientationIcrs,
    },
    plugins: [explicitPlugin],
  });

  explicitTarget.dispatch('pointerdown', { button: 0, pointerId: 3, clientX: 100, clientY: 100 });
  explicitTarget.dispatch('pointermove', { pointerId: 3, clientX: 112, clientY: 100 });
  explicitViewer.update(0);
  assertVectorApprox(explicitViewer.getViewState().targetPc, center);
  assert.notDeepEqual(explicitViewer.getViewState().targetPc, ignoredCenter);
  await explicitViewer.dispose();
});

test('sky orbit plugin setEnabled cancels drag and zero-delta moves leave the view unchanged', async () => {
  const center = { x: 0, y: 0, z: 0 };
  const target = createEventTarget();
  const plugin = createSkyOrbitPlugin({
    target,
    centerPc: center,
    sensitivityRadiansPerPixel: 0.01,
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc: { x: 0, y: 0, z: -10 },
      lookAt: { targetPc: center },
    },
    plugins: [plugin],
  });

  target.dispatch('pointerdown', { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
  assert.equal(plugin.getSnapshot().dragging, true);
  const beforeZeroDelta = viewer.getViewState();
  target.dispatch('pointermove', { pointerId: 4, clientX: 100, clientY: 100 });
  viewer.update(0);
  assert.deepEqual(viewer.getViewState(), beforeZeroDelta);

  plugin.setEnabled(false);
  assert.equal(plugin.getSnapshot().dragging, false);
  const beforeDisabledMove = viewer.getViewState();
  target.dispatch('pointermove', { pointerId: 4, clientX: 120, clientY: 100 });
  target.dispatch('pointerdown', { button: 0, pointerId: 5, clientX: 100, clientY: 100 });
  viewer.update(0);
  assert.deepEqual(viewer.getViewState(), beforeDisabledMove);
  assert.equal(plugin.getSnapshot().dragging, false);

  await viewer.dispose();
});

test('sky orbit plugin carries a rolled camera up vector through drag look-at orientation', async () => {
  const center = { x: 0, y: 0, z: 0 };
  const observerPc = { x: 0, y: 0, z: -10 };
  const rolledUp = normalizeVector({ x: 1, y: 1, z: 0 });
  const orientationIcrs = computeSpatialLookAtOrientation({
    position: observerPc,
    target: center,
    up: rolledUp,
  });
  const initialUp = applyQuaternion(LOCAL_UP, orientationIcrs);
  const target = createEventTarget();
  const plugin = createSkyOrbitPlugin({
    target,
    centerPc: center,
    sensitivityRadiansPerPixel: 0.01,
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: {
      observerPc,
      orientationIcrs,
    },
    plugins: [plugin],
  });

  target.dispatch('pointerdown', { button: 0, pointerId: 6, clientX: 100, clientY: 100 });
  target.dispatch('pointermove', { pointerId: 6, clientX: 110, clientY: 100 });
  viewer.update(0);

  assertVectorApprox(
    applyQuaternion(LOCAL_UP, viewer.getViewState().orientationIcrs),
    initialUp,
    1e-9,
  );

  await viewer.dispose();
});

test('hyades orbit package example installs the orbit plugin and object layers', () => {
  const source = readFileSync(
    new URL('../../examples/hyades-orbit/index.html', import.meta.url),
    'utf8',
  );

  assert.match(source, /createSkyOrbitPlugin/);
  assert.match(source, /centerPc:\s*HYADES_CENTER_PC/);
  assert.match(source, /lookAt:\s*\{\s*targetPc:\s*HYADES_CENTER_PC\s*\}/);
  assert.match(source, /id:\s*'hyades-marker'/);
  assert.match(source, /id:\s*'sol-radio-bubble'/);
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
  assert.equal(debugA.listActions().some((entry) => entry.id === SKYKIT_ACTIONS.viewer.reset), true);
  debugA.pressAction(SKYKIT_ACTIONS.ship.moveForward);
  assert.equal(viewerA.actions.isPressed(SKYKIT_ACTIONS.ship.moveForward), true);
  debugA.releaseAction(SKYKIT_ACTIONS.ship.moveForward);
  assert.equal(viewerA.actions.isPressed(SKYKIT_ACTIONS.ship.moveForward), false);
  await debugA.invokeAction(SKYKIT_ACTIONS.viewer.reset);
  assert.equal(debug.listActions('alpha').some((entry) => entry.id === SKYKIT_ACTIONS.viewer.reset), true);
  const diagnostic = debug.recordDiagnostic({
    level: 'warn',
    type: 'test/manual',
    message: 'manual diagnostic',
    viewerId: 'alpha',
  });
  assert.equal(diagnostic.level, 'warn');
  assert.equal(debug.listDiagnostics({ viewerId: 'alpha' })[0].message, 'manual diagnostic');
  debug.clearDiagnostics();
  assert.equal(debug.listDiagnostics().length, 0);

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
    getSnapshot() { return { status: 'current', cellCount: 0 }; },
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
    session: { strategy: createObserverShellStrategy() },
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

  session.emit({ type: 'stars/cells-upsert', providerId: 'provider', cells: [] });
  session.emit({ type: 'stars/current', providerId: 'provider', cellKeys: [], starCount: 0 });
  assert.deepEqual(rendererCalls.slice(-2), ['stars/cells-upsert', 'stars/current']);
  assert.equal(layer.getSnapshot().status, 'current');

  viewer.requestViewState({ observerPc: { x: 2, y: 0, z: 0 }, limitingMagnitude: 6.5 });
  viewer.update(0.5);
  assert.equal(session.updateCalls.at(-1).patch.observerPc.x, 2);
  assert.equal(session.updateCalls.at(-1).patch.motion.speedPcPerSec, 2);

  await viewer.dispose();
  assert.equal(session.disposed, true);
  assert.ok(rendererCalls.includes('renderer.dispose'));
  session.emit({ type: 'stars/cells-upsert', providerId: 'provider', cells: [] });
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

function createTestCell(options = {}) {
  const keyOrdinal = options.keyOrdinal ?? 1;
  const node = {
    level: 2,
    gridX: keyOrdinal,
    gridY: 0,
    gridZ: 0,
    mortonCode: String(encodeMorton3D(keyOrdinal, 0, 0, 2)),
    centerX: options.x ?? keyOrdinal,
    centerY: 0,
    centerZ: 0,
    halfSize: 0.5,
  };
  return createStarCellData({
    node,
    decoded: {
      count: 1,
      positionsPc: new Float32Array([options.x ?? keyOrdinal, 0, 0]),
      teffLog8: new Uint8Array([128]),
      magAbs: new Float32Array([1]),
    },
    attributes: ['position', 'teffLog8', 'magAbs'],
  });
}

function createFakeSession(options = {}) {
  const listeners = new Set();
  return {
    id: options.id ?? 'session',
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

async function createRestartingStarSourceFixture(retainCellsOnRestart) {
  const sessions = [];
  const provider = {
    id: 'provider',
    createSession() {
      const session = createFakeSession({ id: `session-${sessions.length + 1}` });
      sessions.push(session);
      return session;
    },
  };
  const source = createSkykitStarSourcePlugin({
    provider,
    strategy: createObserverShellStrategy(),
    ...(retainCellsOnRestart !== undefined ? { retainCellsOnRestart } : {}),
  });
  const deltas = [];
  source.subscribe((delta) => deltas.push(delta));

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [source],
  });

  const firstCell = createTestCell({ keyOrdinal: 1 });
  sessions[0].emit({ type: 'stars/cells-upsert', providerId: 'provider', cells: [firstCell] });
  assert.equal(source.getStore().getSnapshot().starCount, 1);

  return { sessions, source, deltas, viewer, firstCell };
}

function createPickResult(options = {}) {
  const cellKey = options.cellKey ?? '2:7';
  const objectIndex = options.objectIndex ?? 0;
  return {
    cellKey,
    objectIndex,
    cell: options.cell ?? null,
    position: options.position ?? { x: 1, y: 0, z: 0 },
    distancePc: options.distancePc ?? 100,
    apparentMagnitude: options.apparentMagnitude ?? 4,
    visualRadiusPx: options.visualRadiusPx ?? 3,
    objectRef: options.objectRef ?? null,
    pickMeta: options.pickMeta ?? null,
    teffLog8: options.teffLog8 ?? 128,
    magAbs: options.magAbs ?? 1,
    score: options.score ?? 0,
    angularDistanceDeg: options.angularDistanceDeg ?? 0,
  };
}

function localVectorFromView(view, vector) {
  const q = view.orientationIcrs ?? { x: 0, y: 0, z: 0, w: 1 };
  const result = new THREE.Vector3(vector.x, vector.y, vector.z).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
  );
  return { x: result.x, y: result.y, z: result.z };
}

function assertVectorApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual.x - expected.x) < epsilon, `x ${actual.x} !== ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < epsilon, `y ${actual.y} !== ${expected.y}`);
  assert.ok(Math.abs(actual.z - expected.z) < epsilon, `z ${actual.z} !== ${expected.z}`);
}

function subtractVectors(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function directionFromRaDec(raDeg, decDeg) {
  const ra = raDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  const cosDec = Math.cos(dec);
  return {
    x: Math.cos(ra) * cosDec,
    y: Math.sin(ra) * cosDec,
    z: Math.sin(dec),
  };
}

function createPointerTarget() {
  const target = createEventTarget();
  target.clientWidth = 800;
  target.clientHeight = 600;
  target.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  });
  return target;
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
