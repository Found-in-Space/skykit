import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createXrLocomotionController, readXrLocomotionAxes } from '../xr-locomotion-controller.js';

test('readXrLocomotionAxes prefers the stick with the strongest active motion', () => {
  const axes = readXrLocomotionAxes([
    { handedness: 'left', gamepad: { axes: [0, 0, 0.2, -0.4] } },
    { handedness: 'right', gamepad: { axes: [0, 0, 0.8, -0.1] } },
  ]);

  assert.deepEqual(axes, {
    x: 0.8,
    y: 0,
    activeHand: 'right',
  });
});

test('XRLocomotionController scales content and advances observer state from XR stick motion', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeedWorldUnitsPerSecond: 2,
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
    frame: {
      deltaSeconds: 1,
    },
  };

  controller.attach(context);
  controller.update(context);

  assert.equal(contentRoot.scale.x, 1000);
  assert.equal(contentRoot.scale.y, 1000);
  assert.equal(contentRoot.scale.z, 1000);
  assert.ok(state.observerPc.z < -1.9);
  assert.ok(Math.abs(navigationRoot.position.z - state.observerPc.z) < 1e-9);
});
