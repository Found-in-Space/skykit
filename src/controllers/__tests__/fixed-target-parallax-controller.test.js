import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFixedTargetParallaxController } from '../fixed-target-parallax-controller.js';

class FakePointerTarget extends EventTarget {
  constructor() {
    super();
    this.style = {};
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    };
  }
}

function createPointerEvent(type, clientX, clientY) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return event;
}

test('FixedTargetParallaxController converts pointer motion into observer offsets while keeping the target fixed', () => {
  const pointerTarget = new FakePointerTarget();
  const controller = createFixedTargetParallaxController({
    pointerTarget,
    sceneScale: 1,
    offsetPc: 1,
    easing: 1,
    targetPc: { x: 0, y: 0, z: -10 },
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  const context = {
    camera,
    canvas: pointerTarget,
    state,
  };

  controller.attach(context);
  pointerTarget.dispatchEvent(createPointerEvent('pointermove', 100, 50));
  controller.update({
    ...context,
    frame: {
      deltaSeconds: 1 / 60,
    },
  });

  assert.deepEqual(state.observerPc, { x: 1, y: 0, z: 0 });
  assert.deepEqual(state.targetPc, { x: 0, y: 0, z: -10 });
  assert.equal(camera.position.x, 1);
  assert.equal(camera.position.y, 0);
  assert.equal(camera.position.z, 0);

  controller.dispose();
});

test('FixedTargetParallaxController can invert pointer X without affecting pointer Y', () => {
  const pointerTarget = new FakePointerTarget();
  const controller = createFixedTargetParallaxController({
    pointerTarget,
    pointer: {
      invertX: true,
    },
    sceneScale: 1,
    offsetPc: 1,
    easing: 1,
    targetPc: { x: 0, y: 0, z: -10 },
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  const context = {
    camera,
    canvas: pointerTarget,
    state,
  };

  controller.attach(context);
  pointerTarget.dispatchEvent(createPointerEvent('pointermove', 100, 0));
  controller.update({
    ...context,
    frame: {
      deltaSeconds: 1 / 60,
    },
  });

  assert.deepEqual(state.observerPc, { x: -1, y: -1, z: 0 });

  controller.dispose();
});
