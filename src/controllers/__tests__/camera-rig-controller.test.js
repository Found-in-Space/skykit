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
