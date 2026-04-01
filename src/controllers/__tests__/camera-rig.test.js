import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCameraRig } from '../camera-rig.js';

test('CameraRig initializes position from observerPc', () => {
  const rig = createCameraRig({ observerPc: { x: 10, y: -5, z: 2 } });
  assert.deepEqual(rig.clonePosition(), { x: 10, y: -5, z: 2 });
});

test('CameraRig initializes orientation from lookAtPc', () => {
  const rig = createCameraRig({
    observerPc: { x: 0, y: 0, z: 0 },
    lookAtPc: { x: 0, y: 0, z: -10 },
    sceneScale: 1,
  });

  const forward = rig.getForward();
  assert.ok(forward.z < -0.99, `forward.z should be ~-1, got ${forward.z}`);
});

test('CameraRig.rotateLocal applies incremental quaternion rotation without gimbal lock', () => {
  const rig = createCameraRig({ sceneScale: 1 });
  const initialQ = rig.orientation.clone();

  rig.rotateLocal(new THREE.Vector3(0, 1, 0), Math.PI / 4);

  assert.ok(!rig.orientation.equals(initialQ), 'orientation should have changed');
  assert.ok(Math.abs(rig.orientation.length() - 1) < 1e-6, 'quaternion should stay normalized');

  // Apply 100 small pitch rotations (would lock up at ±90° with Euler clamping)
  for (let i = 0; i < 100; i++) {
    rig.rotateLocal(new THREE.Vector3(1, 0, 0), 0.05);
  }
  assert.ok(Math.abs(rig.orientation.length() - 1) < 1e-6, 'quaternion stays normalized after many rotations');
});

test('CameraRig.moveInSceneDirection advances position in ICRS parsecs', () => {
  const rig = createCameraRig({
    observerPc: { x: 0, y: 0, z: 0 },
    sceneScale: 1,
  });

  rig.moveInSceneDirection(new THREE.Vector3(0, 0, -1), 5);
  assert.ok(Math.abs(rig.positionPc.z - (-5)) < 0.01);
});

test('CameraRig.applyToCamera sets camera position using scene scale', () => {
  const rig = createCameraRig({
    observerPc: { x: 10, y: -5, z: 2 },
  });
  const camera = new THREE.PerspectiveCamera();
  rig.applyToCamera(camera);

  assert.equal(camera.position.x, 0.01);
  assert.equal(camera.position.y, -0.005);
  assert.equal(camera.position.z, 0.002);
});

test('CameraRig.applyLookAtToCamera makes camera face the target', () => {
  const rig = createCameraRig({
    observerPc: { x: 0, y: 0, z: 0 },
    sceneScale: 1,
  });
  const camera = new THREE.PerspectiveCamera();
  rig.applyLookAtToCamera(camera, { x: 10, y: 0, z: 0 });

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  assert.ok(forward.x > 0.99, `camera should face +X, got forward.x=${forward.x}`);
});

test('CameraRig.computeOrientationToward supports custom upIcrs roll', () => {
  const rig = createCameraRig({
    observerPc: { x: 0, y: 0, z: 0 },
    sceneScale: 1,
  });
  const target = { x: 10, y: 0, z: 0 };
  const defaultQ = rig.computeOrientationToward(target);
  const customQ = rig.computeOrientationToward(target, [0, 0, 1]);

  assert.ok(defaultQ);
  assert.ok(customQ);
  assert.ok(defaultQ.angleTo(customQ) > 0.1, 'custom up should produce a different roll');
});
