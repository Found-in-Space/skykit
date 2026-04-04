import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCameraRigController } from '../camera-rig-controller.js';

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

  keyboardTarget.dispatchEvent(createKeyboardEvent('keydown', 'ArrowUp'));
  controller.update({ camera, canvas: pointerTarget, state, frame: { deltaSeconds: 0.5 } });
  keyboardTarget.dispatchEvent(createKeyboardEvent('keyup', 'ArrowUp'));

  assert.ok(state.observerPc.z < -4.9);
  assert.ok(state.observerPc.z > -5.1);
  assert.ok(camera.position.z < -0.0049);
  assert.ok(camera.position.z > -0.0051);

  controller.dispose();
});

test('CameraRigController KeyC aliases forward (ArrowUp) for movement', () => {
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

  keyboardTarget.dispatchEvent(createKeyboardEvent('keydown', 'KeyC'));
  controller.update({ camera, canvas: pointerTarget, state, frame: { deltaSeconds: 0.5 } });
  keyboardTarget.dispatchEvent(createKeyboardEvent('keyup', 'KeyC'));

  assert.ok(state.observerPc.z < -4.9);
  assert.ok(state.observerPc.z > -5.1);

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

test('CameraRigController lookAt is one-shot and releases after alignment', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  const target = { x: 10, y: 0, z: 0 };
  controller.lookAt(target, { blend: 0.1 });

  for (let i = 0; i < 120; i += 1) {
    controller.update({ camera, state, frame: { deltaSeconds: 1 / 60 } });
  }

  const targetQ = controller.rig.computeOrientationToward(target);
  assert.ok(targetQ);
  assert.ok(controller.rig.orientation.angleTo(targetQ) < 0.01);
  assert.equal(controller.getStats().orientationAutomation, null);

  controller.dispose();
});

test('CameraRigController lookAt supports custom upIcrs roll alignment', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  const target = { x: 10, y: 0, z: 0 };
  const upIcrs = [0, 0, 1];
  controller.lookAt(target, { blend: 0.1, upIcrs });
  for (let i = 0; i < 120; i += 1) {
    controller.update({ camera, state, frame: { deltaSeconds: 1 / 60 } });
  }

  const withUp = controller.rig.computeOrientationToward(target, upIcrs);
  const withoutUp = controller.rig.computeOrientationToward(target);
  assert.ok(withUp);
  assert.ok(withoutUp);
  assert.ok(controller.rig.orientation.angleTo(withUp) < 0.01);
  assert.ok(controller.rig.orientation.angleTo(withoutUp) > 0.1);

  controller.dispose();
});

test('CameraRigController lockAt recenters after dwell delay following manual look input', () => {
  const keyboardTarget = new FakeEventTarget();
  const pointerTarget = new FakeEventTarget();
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    pointerTarget,
    keyboardTarget,
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: pointerTarget, state });

  const target = { x: 10, y: 0, z: 0 };
  controller.lockAt(target, { dwellMs: 300, recenterSpeed: 0.3 });
  for (let i = 0; i < 30; i += 1) {
    controller.update({ camera, state, frame: { deltaSeconds: 1 / 60 } });
  }

  keyboardTarget.dispatchEvent(createKeyboardEvent('keydown', 'KeyA'));
  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  keyboardTarget.dispatchEvent(createKeyboardEvent('keyup', 'KeyA'));

  const targetQ = controller.rig.computeOrientationToward(target);
  assert.ok(targetQ);
  const angleAfterInput = controller.rig.orientation.angleTo(targetQ);

  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  const angleBeforeDwell = controller.rig.orientation.angleTo(targetQ);
  assert.ok(angleBeforeDwell >= angleAfterInput - 1e-6);

  controller.update({ camera, state, frame: { deltaSeconds: 0.25 } });
  const angleAfterDwell = controller.rig.orientation.angleTo(targetQ);
  assert.ok(angleAfterDwell < angleBeforeDwell);

  controller.dispose();
});

test('CameraRigController lockAt supports custom upIcrs roll alignment', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  const target = { x: 10, y: 0, z: 0 };
  const upIcrs = [0, 0, 1];
  controller.lockAt(target, { dwellMs: 0, recenterSpeed: 0.3, upIcrs });
  for (let i = 0; i < 90; i += 1) {
    controller.update({ camera, state, frame: { deltaSeconds: 1 / 60 } });
  }

  const withUp = controller.rig.computeOrientationToward(target, upIcrs);
  const withoutUp = controller.rig.computeOrientationToward(target);
  assert.ok(withUp);
  assert.ok(withoutUp);
  assert.ok(controller.rig.orientation.angleTo(withUp) < 0.02);
  assert.ok(controller.rig.orientation.angleTo(withoutUp) > 0.1);

  controller.dispose();
});

test('CameraRigController orbitalInsert curves smoothly from approach into orbit', () => {
  const controller = createCameraRigController({
    observerPc: { x: 100, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: 0 },
    sceneScale: 1,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  const center = { x: 0, y: 0, z: 0 };
  controller.orbitalInsert(center, {
    orbitRadius: 10,
    angularSpeed: 0.2,
    approachSpeed: 50,
    deceleration: 2,
  });

  assert.equal(controller.getStats().movementAutomation, 'orbitalInsert');

  const positions = [];
  for (let i = 0; i < 600; i += 1) {
    controller.update({ camera, state, frame: { deltaSeconds: 1 / 60 } });
    positions.push({ ...state.observerPc });
    if (controller.getStats().movementAutomation === 'orbit') break;
  }

  assert.equal(
    controller.getStats().movementAutomation,
    'orbit',
    'should have transitioned to parametric orbit',
  );

  const finalDist = Math.hypot(
    state.observerPc.x - center.x,
    state.observerPc.y - center.y,
    state.observerPc.z - center.z,
  );
  assert.ok(
    Math.abs(finalDist - 10) < 0.5,
    `final distance should be ~10, got ${finalDist}`,
  );

  const midIdx = Math.floor(positions.length / 2);
  const midDist = Math.hypot(positions[midIdx].x, positions[midIdx].y, positions[midIdx].z);
  assert.ok(midDist > 10 && midDist < 100, 'mid-flight should be between start and orbit');

  controller.dispose();
});

test('CameraRigController orbitalInsert skips to orbit when already at orbit radius', () => {
  const controller = createCameraRigController({
    observerPc: { x: 10, y: 0, z: 0 },
    sceneScale: 1,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.orbitalInsert({ x: 0, y: 0, z: 0 }, {
    orbitRadius: 10,
    angularSpeed: 0.2,
  });

  assert.equal(
    controller.getStats().movementAutomation,
    'orbit',
    'should jump directly to orbit when at the orbit radius',
  );

  controller.dispose();
});

test('CameraRigController orbitalInsert fires onInserted callback', () => {
  const controller = createCameraRigController({
    observerPc: { x: 30, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: 0 },
    sceneScale: 1,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  let inserted = false;
  controller.orbitalInsert({ x: 0, y: 0, z: 0 }, {
    orbitRadius: 5,
    angularSpeed: 0.3,
    approachSpeed: 80,
    deceleration: 3,
    onInserted: () => { inserted = true; },
  });

  for (let i = 0; i < 600; i += 1) {
    controller.update({ camera, state, frame: { deltaSeconds: 1 / 60 } });
    if (inserted) break;
  }

  assert.ok(inserted, 'onInserted callback should have fired');

  controller.dispose();
});

test('CameraRigController orbit changes position without forcing orientation', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    sceneScale: 1,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  const before = controller.rig.orientation.clone();
  controller.orbit({ x: 10, y: 0, z: 0 }, { radius: 3, angularSpeed: 0.5 });
  controller.update({ camera, state, frame: { deltaSeconds: 1 } });

  assert.ok(state.observerPc.x > 0.1);
  assert.ok(controller.rig.orientation.angleTo(before) < 1e-6);

  controller.dispose();
});

test('simulateKeyDown/simulateKeyUp drive movement the same as physical keyboard events', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 10,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.simulateKeyDown('ArrowUp');
  controller.update({ camera, state, frame: { deltaSeconds: 0.5 } });
  controller.simulateKeyUp('ArrowUp');

  assert.ok(state.observerPc.z < -4.9);
  assert.ok(state.observerPc.z > -5.1);

  controller.dispose();
});

test('simulateKeyDown ignores non-MOVE_KEYS codes', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 10,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.simulateKeyDown('KeyZ');
  controller.update({ camera, state, frame: { deltaSeconds: 0.5 } });
  controller.simulateKeyUp('KeyZ');

  assert.deepEqual(state.observerPc, { x: 0, y: 0, z: 0 });

  controller.dispose();
});

// --- Universal motion stats ---

test('getStats().motion reports position, orientation, and forward direction', () => {
  const controller = createCameraRigController({
    observerPc: { x: 5, y: 3, z: -1 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });
  controller.update({ camera, state, frame: { deltaSeconds: 1 / 60 } });

  const { motion } = controller.getStats();
  assert.ok(motion, 'motion stats should be present');
  assert.ok(motion.observerPc, 'observerPc should be in motion');
  assert.equal(motion.observerPc.x, 5);
  assert.ok(motion.orientationQ, 'orientationQ should be in motion');
  assert.ok(Number.isFinite(motion.orientationQ.w));
  assert.ok(motion.forwardIcrs, 'forwardIcrs should be in motion');
  const fLen = Math.hypot(motion.forwardIcrs.x, motion.forwardIcrs.y, motion.forwardIcrs.z);
  assert.ok(Math.abs(fLen - 1) < 0.01, 'forwardIcrs should be unit length');

  controller.dispose();
});

test('motion.speedPcPerSec reflects actual movement from arrow keys', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 20,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  assert.ok(controller.getStats().motion.speedPcPerSec < 0.001, 'stationary before keys');

  controller.simulateKeyDown('ArrowUp');
  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  controller.simulateKeyUp('ArrowUp');

  const speed = controller.getStats().motion.speedPcPerSec;
  assert.ok(speed > 15, `speed should be ~20 pc/s, got ${speed}`);
  assert.ok(speed < 25, `speed should be ~20 pc/s, got ${speed}`);

  controller.dispose();
});

test('CameraRigController writes observerSpeedPcPerSec into runtime state', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 20,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  assert.equal(state.observerSpeedPcPerSec, 0);

  controller.simulateKeyDown('ArrowUp');
  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  controller.simulateKeyUp('ArrowUp');

  assert.ok(state.observerSpeedPcPerSec > 15, `state speed should be ~20 pc/s, got ${state.observerSpeedPcPerSec}`);
  assert.ok(state.observerSpeedPcPerSec < 25, `state speed should be ~20 pc/s, got ${state.observerSpeedPcPerSec}`);

  controller.dispose();
});

test('motion.speedPcPerSec reports speed during flyTo automation', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 50,
    sceneScale: 1,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  controller.flyTo({ x: 0, y: 0, z: -100 }, { speed: 50 });
  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });

  const speed = controller.getStats().motion.speedPcPerSec;
  assert.ok(speed > 10, `should report movement during flyTo, got ${speed}`);

  controller.dispose();
});

test('motion.velocityPcPerSec has a direction vector consistent with movement', () => {
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    moveSpeed: 10,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget: new FakeEventTarget(),
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  controller.simulateKeyDown('ArrowUp');
  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  controller.simulateKeyUp('ArrowUp');

  const v = controller.getStats().motion.velocityPcPerSec;
  assert.ok(v.z < -5, `velocity z should be negative (forward), got ${v.z}`);

  controller.dispose();
});

test('motion.angularVelocityRadPerSec reports rotation from yaw keys', () => {
  const keyboardTarget = new FakeEventTarget();
  const controller = createCameraRigController({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    keyboardTurnSpeed: 2.0,
    pointerTarget: new FakeEventTarget(),
    keyboardTarget,
  });
  const camera = new THREE.PerspectiveCamera();
  const state = {};
  controller.attach({ camera, canvas: new FakeEventTarget(), state });

  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });

  controller.simulateKeyDown('KeyD');
  controller.update({ camera, state, frame: { deltaSeconds: 0.1 } });
  controller.simulateKeyUp('KeyD');

  const angVel = controller.getStats().motion.angularVelocityRadPerSec;
  assert.ok(angVel > 0.5, `angular velocity should be positive during yaw, got ${angVel}`);

  controller.dispose();
});
