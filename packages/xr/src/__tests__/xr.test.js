import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  computeXrDepthRange,
  createDirectXrMotionModel,
  createFlyToMotionModel,
  createInertialXrMotionModel,
  createThrustXrMotionModel,
  createXrBodyTracker,
  createXrControlBindings,
  createXrPickRouter,
  createXrRaySource,
  createXrRig,
  enterXrSession,
  exitXrSession,
  isXrModeSupported,
} from '../index.js';

test('createXrRig builds multi-root XR hierarchy and observer-centric root does not inherit rotation', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createXrRig({
    id: 'test-rig',
    camera,
    scaleProfile: {
      navigationUnits: 'pc',
      metersPerNavigationUnit: 2,
      worldUnitsPerNavigationUnit: 10,
    },
    scaleBandIds: ['galaxy'],
  });
  const orientation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  );

  rig.setNavigationPose({
    position: { x: 1, y: 2, z: 3 },
    orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
  });

  assert.equal(camera.parent, rig.headRoot);
  assert.notEqual(rig.originContentRoot, rig.observerContentRoot);
  assert.notEqual(rig.originContentRoot, rig.navigationRoot);
  assert.equal(rig.contentRoot, rig.originContentRoot);
  assert.equal(rig.getScaleBandedContentRoot('galaxy'), rig.scaleBandedContentRoots.galaxy);
  assert.deepEqual(rig.navigationRoot.position.toArray(), [10, 20, 30]);
  assert.deepEqual(rig.observerContentRoot.position.toArray(), [10, 20, 30]);
  assert.equal(rig.observerContentRoot.quaternion.x, 0);
  assert.equal(rig.observerContentRoot.quaternion.y, 0);
  assert.equal(rig.observerContentRoot.quaternion.z, 0);
  assert.equal(rig.observerContentRoot.quaternion.w, 1);

  rig.dispose();
  rig.dispose();
  assert.equal(rig.getSnapshot().disposed, true);
});

test('createXrControlBindings reads named axes, buttons, edges, events, and remaps controls', () => {
  const controls = createXrControlBindings({
    deadzone: 0.15,
    axes: {
      move: { hand: 'right', stick: 'primary' },
    },
    buttons: {
      select: { hand: 'right', button: 'trigger' },
    },
  });
  const events = [];
  controls.on('select', (state) => events.push(state));

  controls.update([
    {
      handedness: 'right',
      gamepad: {
        axes: [0, 0, 0.1, -0.8],
        buttons: [{ pressed: true, touched: true, value: 1 }],
      },
    },
  ]);

  assert.deepEqual(controls.getAxis('move'), {
    x: 0,
    y: -0.8,
    active: true,
    magnitude: 0.8,
    activeHand: 'right',
  });
  assert.equal(controls.getButton('select').pressed, true);
  assert.equal(controls.getButton('select').pressedEdge, true);
  assert.equal(events.length, 1);

  controls.update([
    {
      handedness: 'right',
      gamepad: {
        axes: [0, 0, 0, 0],
        buttons: [{ pressed: false, value: 0 }],
      },
    },
  ]);
  assert.equal(controls.getButton('select').releasedEdge, true);

  controls.setBindings({
    axes: {
      move: { hand: 'left', axes: [0, 1] },
    },
  });
  controls.update([
    { handedness: 'left', gamepad: { axes: [0.6, 0], buttons: [] } },
  ]);
  assert.equal(controls.getAxis('move').x, 0.6);
  assert.equal(controls.getSnapshot().bindings.axes.move.hand, 'left');
});

test('motion models move in ship coordinates and keep head pose separate', () => {
  const controls = createXrControlBindings({
    axes: {
      move: { hand: 'right', stick: 'primary' },
    },
    buttons: {
      boost: { hand: 'right', button: 'grip' },
    },
  });
  controls.update([
    {
      handedness: 'right',
      gamepad: {
        axes: [0, 0, 0, -1],
        buttons: [{ pressed: false }, { pressed: true }],
      },
    },
  ]);
  const model = createDirectXrMotionModel({ moveSpeed: 2, boostMultiplier: 3 });
  const next = model.update({
    pose: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    body: {
      head: {
        position: { x: 0, y: 0, z: 0 },
        orientation: new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      },
      leftHand: null,
      rightHand: null,
      ship: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    controls,
    deltaSeconds: 1,
    scale: { navigationUnits: 'pc', metersPerNavigationUnit: 1 },
  });

  assert.equal(next.position.x, 0);
  assert.equal(next.position.y, 0);
  assert.equal(next.position.z, -6);
  assert.equal(model.getSnapshot().speedNavigationUnitsPerSecond, 6);
});

test('inertial, thrust, and fly-to motion models expose predictable state', () => {
  const controls = createXrControlBindings({
    axes: { move: { hand: 'right', stick: 'primary' } },
  });
  controls.update([{ handedness: 'right', gamepad: { axes: [0, 0, 0, -1], buttons: [] } }]);

  const inertial = createInertialXrMotionModel({ acceleration: 4, damping: 2, maxSpeed: 10 });
  const thrust = createThrustXrMotionModel({ thrust: 8, mass: 2, drag: 0.1, maxSpeed: 10 });
  const pose = {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };

  assert.ok(inertial.update({ pose, controls, deltaSeconds: 0.5 }).position.z < 0);
  assert.ok(thrust.update({ pose, controls, deltaSeconds: 0.5 }).position.z < 0);

  const fly = createFlyToMotionModel({ acceleration: 4, deceleration: 6, maxSpeed: 10 });
  fly.flyTo({ x: 0, y: 0, z: -10 });
  const first = fly.update({ pose, deltaSeconds: 0.5 });
  assert.ok(first.position.z < 0);
  assert.equal(fly.getSnapshot().activeAutomation, 'flyTo');
});

test('body tracker and ray sources read fake XR frame poses', () => {
  const gripSpace = { id: 'grip' };
  const raySpace = { id: 'ray' };
  const rig = createXrRig();
  const frame = {
    getViewerPose() {
      return {
        transform: {
          position: { x: 1, y: 2, z: 3 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      };
    },
    getPose(space) {
      return {
        transform: {
          position: space === raySpace ? { x: 4, y: 5, z: 6 } : { x: 7, y: 8, z: 9 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      };
    },
  };
  const inputSources = [{
    handedness: 'right',
    gripSpace,
    targetRaySpace: raySpace,
    gamepad: { axes: [0, 0], buttons: [{ pressed: false }] },
  }];
  const bodyTracker = createXrBodyTracker();
  const body = bodyTracker.update({ frame, referenceSpace: {}, inputSources, rig });
  const raySource = createXrRaySource({ kind: 'target-ray', handedness: 'right', length: 12 });
  const ray = raySource.getRay({ frame, referenceSpace: {}, inputSources, body, rig });

  assert.deepEqual(body.head?.position, { x: 1, y: 2, z: 3 });
  assert.deepEqual(body.rightHand?.targetRay?.position, { x: 4, y: 5, z: 6 });
  assert.deepEqual(ray?.origin, { x: 4, y: 5, z: 6 });
  assert.deepEqual(ray?.direction, { x: 0, y: 0, z: -1 });
  assert.equal(ray?.length, 12);
});

test('pick router applies blockers before generic targets', () => {
  const routes = [];
  const raySource = createXrRaySource({
    kind: 'custom',
    getRay: () => ({
      id: 'ray',
      kind: 'custom',
      handedness: null,
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      length: 100,
    }),
  });
  const targetCalls = [];
  const router = createXrPickRouter({
    raySource,
    blockers: [
      () => ({ distance: 10 }),
    ],
    targets: [
      (ray, context) => {
        targetCalls.push(context.maxDistance);
        return { id: 'target', distance: 9 };
      },
    ],
    onPick: (route) => routes.push(route.type),
  });

  const hit = router.route();
  assert.equal(hit.type, 'hit');
  assert.equal(targetCalls[0], 10);
  assert.equal(routes[0], 'hit');

  router.setBlockers([() => ({ consumed: true, hit: { id: 'panel' } })]);
  const blocked = router.route();
  assert.equal(blocked.type, 'blocked');
  assert.deepEqual(blocked.hit, { id: 'panel' });
});

test('computeXrDepthRange uses bounds, observer-centric spheres, scale, and clamp telemetry', () => {
  const range = computeXrDepthRange({
    observer: { x: 0, y: 0, z: 0 },
    visibleBounds: { min: { x: -2, y: -3, z: -4 }, max: { x: 2, y: 3, z: 4 } },
    observerCentricSpheres: [{ radius: 20 }],
    scale: { navigationUnits: 'pc', metersPerNavigationUnit: 10 },
    policy: { near: 0.25, minFar: 1, maxFar: 100, marginFactor: 1.2 },
  });

  assert.equal(range.far, 100);
  assert.equal(range.telemetry.capApplied, true);
  assert.equal(range.telemetry.farthestObserverCentricSphereDistance, 20);
  assert.equal(range.telemetry.visibleBoundsCount, 1);
});

test('session helpers work with fake navigator/session objects', async () => {
  let ended = false;
  const fakeSession = {
    async requestReferenceSpace(type) {
      return { type };
    },
    async end() {
      ended = true;
    },
    addEventListener() {},
  };
  const navigator = {
    xr: {
      async isSessionSupported(mode) {
        return mode === 'immersive-vr';
      },
      async requestSession(mode, init) {
        assert.equal(mode, 'immersive-vr');
        assert.deepEqual(init, { optionalFeatures: ['local-floor'] });
        return fakeSession;
      },
    },
  };

  assert.equal(await isXrModeSupported('immersive-vr', { navigator }), true);
  const handle = await enterXrSession({
    navigator,
    mode: 'immersive-vr',
    referenceSpaceType: 'local-floor',
    sessionInit: { optionalFeatures: ['local-floor'] },
  });
  assert.equal(handle.presenting, true);
  assert.deepEqual(handle.referenceSpace, { type: 'local-floor' });
  await exitXrSession(handle);
  assert.equal(ended, true);
  assert.equal(handle.presenting, false);
});
