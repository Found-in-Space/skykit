import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFreeFlyController } from '../free-fly-controller.js';

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

test('FreeFlyController seeds camera position from observerPc using scene scale', () => {
  const controller = createFreeFlyController({
    observerPc: { x: 10, y: -5, z: 2 },
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  const context = {
    camera,
    canvas: new FakeEventTarget(),
    state,
  };

  controller.attach(context);

  assert.deepEqual(state.observerPc, { x: 10, y: -5, z: 2 });
  assert.equal(camera.position.x, 0.01);
  assert.equal(camera.position.y, -0.005);
  assert.equal(camera.position.z, 0.002);

  controller.dispose();
});

test('FreeFlyController advances observerPc when forward movement keys are pressed', () => {
  const keyboardTarget = new FakeEventTarget();
  const pointerTarget = new FakeEventTarget();
  const controller = createFreeFlyController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeedPcPerSecond: 10,
    pointerTarget,
    keyboardTarget,
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  const context = {
    camera,
    canvas: pointerTarget,
    state,
  };

  controller.attach(context);
  keyboardTarget.dispatchEvent(createKeyboardEvent('keydown', 'KeyW'));
  controller.update({
    ...context,
    frame: {
      deltaSeconds: 0.5,
    },
  });
  keyboardTarget.dispatchEvent(createKeyboardEvent('keyup', 'KeyW'));

  assert.ok(state.observerPc.z < -4.9);
  assert.ok(state.observerPc.z > -5.1);
  assert.ok(camera.position.z < -0.0049);
  assert.ok(camera.position.z > -0.0051);

  controller.dispose();
});
