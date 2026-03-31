import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCameraRigController, readXrAxes } from '../camera-rig-controller.js';

class FakeEventTarget extends EventTarget {
  constructor() {
    super();
    this.style = {};
  }

  setPointerCapture() {}

  releasePointerCapture() {}
}

function createKeyboardEvent(type, code) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  Object.defineProperty(event, 'key', { value: code });
  return event;
}

test('CameraRigController seeds camera position from observerPc using scene scale', () => {
  const controller = createCameraRigController({
    observerPc: { x: 10, y: -5, z: 2 },
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  assert.deepEqual(state.observerPc, { x: 10, y: -5, z: 2 });
  assert.equal(camera.position.x, 0.01);
  assert.equal(camera.position.y, -0.005);
  assert.equal(camera.position.z, 0.002);

  controller.dispose();
});

test('CameraRigController advances observerPc when forward key is pressed', () => {
  const keyboardTarget = new FakeEventTarget();
  const pointerTarget = new FakeEventTarget();
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 10,
    pointerTarget,
    keyboardTarget,
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: pointerTarget, state });

  keyboardTarget.dispatchEvent(createKeyboardEvent('keydown', 'KeyW'));
  controller.update({ camera, canvas: pointerTarget, state, frame: { deltaSeconds: 0.5 } });
  keyboardTarget.dispatchEvent(createKeyboardEvent('keyup', 'KeyW'));

  assert.ok(state.observerPc.z < -4.9);
  assert.ok(state.observerPc.z > -5.1);
  assert.ok(camera.position.z < -0.0049);
  assert.ok(camera.position.z > -0.0051);

  controller.dispose();
});

test('CameraRigController flyTo moves observer toward target', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 100,
    sceneScale: 1,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.flyTo({ x: 0, y: 0, z: -20 }, { speed: 100 });
  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });

  assert.ok(state.observerPc.z < -0.5, 'should have moved toward target');
  assert.ok(controller.getStats().automation === 'flyTo');

  controller.dispose();
});

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

test('CameraRigController XR mode scales content and advances observer from stick motion', () => {
  const controller = createCameraRigController({
    xr: true,
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

  assert.equal(contentRoot.scale.x, 1000);
  assert.equal(contentRoot.scale.y, 1000);
  assert.equal(contentRoot.scale.z, 1000);
  assert.ok(state.observerPc.z < -1.9);
  assert.ok(Math.abs(navigationRoot.position.z - state.observerPc.z) < 1e-9);
});

test('CameraRigController XR mode derives movement from viewer pose, not stale camera quaternion', () => {
  const controller = createCameraRigController({
    xr: true,
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

test('CameraRigController XR mode moves in full 3D when looking up or down', () => {
  const controller = createCameraRigController({
    xr: true,
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
