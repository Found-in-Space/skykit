import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createXrLocomotionController, readXrAxes } from '../xr-locomotion-controller.js';

test('readXrAxes prefers the stick with the strongest active motion', () => {
  const axes = readXrAxes([
    { handedness: 'left', gamepad: { axes: [0, 0, 0.2, -0.4] } },
    { handedness: 'right', gamepad: { axes: [0, 0, 0.8, -0.1] } },
  ]);

  assert.deepEqual(axes, {
    x: 0.8,
    y: 0,
    activeHand: 'right',
  });
});

test('readXrAxes applies deadzone', () => {
  const axes = readXrAxes([
    { handedness: 'left', gamepad: { axes: [0, 0, 0.1, -0.05] } },
  ], { deadzone: 0.15 });

  assert.equal(axes.x, 0);
  assert.equal(axes.y, 0);
  assert.equal(axes.activeHand, null);
});

test('XR locomotion controller scales content and advances observer from stick motion', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(0, 0, -1);
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };
  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: {
      presenting: true,
      session: {
        inputSources: [
          { handedness: 'left', gamepad: { axes: [0, 0, 0, -1] } },
        ],
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.equal(contentRoot.scale.x, 1000, 'universe scale = starFieldScale / SCALE');
  assert.ok(state.observerPc.z < -1.9, 'should have moved forward');
});

test('XR locomotion controller derives movement from viewer pose', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(0, 0, -1);
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };

  const yaw90 = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -Math.PI / 2,
  );

  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: {
      presenting: true,
      session: {
        inputSources: [
          { handedness: 'left', gamepad: { axes: [0, 0, 0, -1] } },
        ],
      },
      referenceSpace: {},
      frame: {
        getViewerPose() {
          return {
            transform: {
              orientation: { x: yaw90.x, y: yaw90.y, z: yaw90.z, w: yaw90.w },
            },
          };
        },
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.ok(Math.abs(state.observerPc.z) < 0.01, 'should not move along Z when facing +X');
  assert.ok(state.observerPc.x > 1.9, 'should move along +X (headset forward)');
});

test('XR locomotion controller moves spaceship to observer scene position', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(0, 0, -1);
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };
  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: {
      presenting: true,
      session: {
        inputSources: [
          { handedness: 'left', gamepad: { axes: [0, 0, 0, -1] } },
        ],
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.ok(state.observerPc.z < 0, 'observer moved forward (negative Z)');
  assert.ok(navigationRoot.position.z < 0,
    'spaceship moved forward (same direction as observer)');
});

test('XR locomotion controller keeps universe at origin', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(0, 0, -1);
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };
  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: {
      presenting: true,
      session: {
        inputSources: [
          { handedness: 'left', gamepad: { axes: [0, 0, 0, -1] } },
        ],
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.equal(contentRoot.position.x, 0, 'universe stays at origin x');
  assert.equal(contentRoot.position.y, 0, 'universe stays at origin y');
  assert.equal(contentRoot.position.z, 0, 'universe stays at origin z');
});

test('XR locomotion controller does nothing when not presenting', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };
  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: { presenting: false, session: null },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.deepEqual(state.observerPc, { x: 0, y: 0, z: 0 }, 'observer should not move');
  assert.equal(contentRoot.scale.x, 1, 'universe scale unchanged');
});

test('XR locomotion controller moves in full 3D when looking up or down', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(0, 0, -1);
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };

  const pitchDown45 = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 4,
  );

  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: {
      presenting: true,
      session: {
        inputSources: [
          { handedness: 'left', gamepad: { axes: [0, 0, 0, -1] } },
        ],
      },
      referenceSpace: {},
      frame: {
        getViewerPose() {
          return {
            transform: {
              orientation: {
                x: pitchDown45.x,
                y: pitchDown45.y,
                z: pitchDown45.z,
                w: pitchDown45.w,
              },
            },
          };
        },
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.ok(state.observerPc.y < -0.5, 'should move downward when looking down');
  assert.ok(state.observerPc.z < -0.5, 'should still move forward along Z');
});

test('XR locomotion controller flyTo advances toward target without thumbstick input', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
    flySpeed: 10,
    flyAcceleration: 4,
    flyDeceleration: 6,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(0, 0, -1);
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };
  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: {
      presenting: true,
      session: {
        inputSources: [],
      },
    },
    frame: { deltaSeconds: 0.5 },
  };

  controller.attach(context);
  controller.flyTo({
    x: 0,
    y: 0,
    z: -10,
  }, {
    speed: 10,
    acceleration: 4,
    deceleration: 6,
    arrivalThreshold: 0.01,
  });
  controller.update(context);

  assert.ok(state.observerPc.z < -0.9 && state.observerPc.z > -1.1,
    'should ramp in smoothly instead of lurching forward');
  assert.equal(state.observerPc.x, 0, 'should stay on straight-line path (x)');
  assert.equal(state.observerPc.y, 0, 'should stay on straight-line path (y)');
  assert.equal(controller.getStats().movementAutomation, 'flyTo');
});
