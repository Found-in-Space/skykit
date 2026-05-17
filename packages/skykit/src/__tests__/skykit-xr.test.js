import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  applySkykitXrDepthRange,
  computeSkykitXrDepthRange,
  createSkykitXrBodyTracker,
  createSkykitXrControlBindings,
  createSkykitXrPickRouter,
  createSkykitXrRaySource,
  createSkykitXrRig,
  enterSkykitXrSession,
  exitSkykitXrSession,
  isSkykitXrModeSupported,
} from '../xr.js';

test('skykit/xr rig builds multi-root hierarchy', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createSkykitXrRig({
    camera,
    navigationPose: {
      position: { x: 1, y: 2, z: 3 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scaleBandIds: ['galaxy'],
  });
  assert.equal(rig.headRoot.children.includes(camera), true);
  assert.notEqual(rig.originContentRoot, rig.observerContentRoot);
  assert.notEqual(rig.originContentRoot, rig.navigationRoot);
  assert.ok(rig.getScaleBandedContentRoot('galaxy'));
  rig.syncObserverContentRoot();
  assert.deepEqual(rig.observerContentRoot.position.toArray(), [1, 2, 3]);
  rig.dispose();
  rig.dispose();
});

test('skykit/xr control bindings read axes and button edges', () => {
  const source = {
    handedness: 'right',
    gamepad: {
      axes: [0.5, -0.75],
      buttons: [{ pressed: true, touched: true, value: 1 }],
    },
  };
  const controls = createSkykitXrControlBindings({
    axes: { move: { hand: 'right', axes: [0, 1] } },
    buttons: { select: { hand: 'right', button: 'trigger' } },
  });
  controls.update({ inputSources: [source] });
  assert.equal(controls.getAxis('move').x, 0.5);
  assert.equal(controls.getButton('select').pressed, true);
  assert.equal(controls.getButton('select').pressedEdge, true);
  controls.update({ inputSources: [source] });
  assert.equal(controls.getButton('select').pressedEdge, false);
  controls.dispose();
});

test('skykit/xr body, rays, and pick router compose generic route results', () => {
  const rig = createSkykitXrRig();
  const body = createSkykitXrBodyTracker().update({
    rig,
    shipPose: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  });
  const raySource = createSkykitXrRaySource({ kind: 'ship-forward', length: 12 });
  const ray = raySource.getRay({ rig, body });
  assert.ok(ray);
  assert.equal(ray.direction.z, -1);

  const router = createSkykitXrPickRouter({
    raySource,
    targets: [() => ({ distance: 3, object: 'target' })],
  });
  const route = router.route({ rig, body });
  assert.equal(route.type, 'hit');
  assert.equal(route.hit.object, 'target');
});

test('skykit/xr depth helpers compute and apply render state', () => {
  const range = computeSkykitXrDepthRange({
    visibleBounds: { min: { x: -1, y: -1, z: -20 }, max: { x: 1, y: 1, z: -10 } },
    scale: { navigationUnits: 'pc', metersPerNavigationUnit: 10 },
    observerCentricSpheres: [{ radiusNavigationUnits: 30 }],
  });
  assert.ok(range.depthFar >= 100);

  let state = null;
  const result = applySkykitXrDepthRange({
    updateRenderState(next) {
      state = next;
    },
  }, range);
  assert.equal(result.applied, true);
  assert.deepEqual(state, { depthNear: range.depthNear, depthFar: range.depthFar });
});

test('skykit/xr session helpers use injected navigator', async () => {
  let ended = false;
  const session = {
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
      async requestSession() {
        return session;
      },
    },
  };
  assert.equal(await isSkykitXrModeSupported('immersive-vr', { navigator }), true);
  const handle = await enterSkykitXrSession({ navigator, mode: 'immersive-vr' });
  assert.equal(handle.presenting, true);
  await exitSkykitXrSession(handle);
  assert.equal(ended, true);
});
