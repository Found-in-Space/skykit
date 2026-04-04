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

test('readXrAxes can filter by handedness', () => {
  const axes = readXrAxes([
    { handedness: 'left', gamepad: { axes: [0, 0, 0.8, -0.8] } },
    { handedness: 'right', gamepad: { axes: [0, 0, 0.1, -0.2] } },
  ], { handedness: 'right' });

  assert.deepEqual(axes, {
    x: 0,
    y: -0.2,
    activeHand: 'right',
  });
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
          { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
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

test('XR locomotion controller right-stick thrust scales with the universe', () => {
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
    starFieldScale: 10.0,
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
          { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
        ],
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.ok(state.observerPc.z < -1.9, 'observer motion should stay strong at large world scales');
  assert.ok(navigationRoot.position.z < -19.9, 'world-space ship motion should grow with starFieldScale');
});

test('XR locomotion controller movement stays in ship coordinates despite viewer yaw', () => {
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
          { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
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

  assert.ok(state.observerPc.z < -1.9, 'should still move along ship forward');
  assert.ok(Math.abs(state.observerPc.x) < 0.01, 'viewer yaw should not steer thrust sideways');
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
          { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
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
          { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
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

test('XR locomotion controller ignores viewer pitch for thrust direction', () => {
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
          { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
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

  assert.ok(Math.abs(state.observerPc.y) < 0.01, 'viewer pitch should not add vertical thrust');
  assert.ok(state.observerPc.z < -1.9, 'ship forward thrust should still advance through space');
});

test('XR locomotion controller yaws and pitches the spaceship from the left stick', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
    yawRateRadPerSec: 1.0,
    pitchRateRadPerSec: 1.0,
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
          { handedness: 'left', gamepad: { axes: [0, 0, 0.5, -0.5] } },
        ],
      },
      referenceSpace: {},
      frame: {
        getViewerPose() {
          return {
            transform: {
              orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
          };
        },
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.ok(Math.abs(navigationRoot.quaternion.x) > 0.1, 'pitch should rotate the spaceship root');
  assert.ok(Math.abs(navigationRoot.quaternion.y) > 0.1, 'yaw should rotate the spaceship root');
  assert.ok(Math.abs(state.observerOrientation.x) > 0.1, 'orientation should be written into runtime state');
});

test('XR locomotion controller rolls the spaceship when the left grip modifier is held', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
    rollRateRadPerSec: 1.0,
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
          {
            handedness: 'left',
            gamepad: {
              axes: [0, 0, 0.5, 0],
              buttons: [{ pressed: false }, { pressed: true }],
            },
          },
        ],
      },
      referenceSpace: {},
      frame: {
        getViewerPose() {
          return {
            transform: {
              orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
          };
        },
      },
    },
    frame: { deltaSeconds: 1 },
  };

  controller.attach(context);
  controller.update(context);

  assert.ok(Math.abs(navigationRoot.quaternion.z) > 0.1, 'grip-modified horizontal stick should roll the spaceship');
  assert.equal(controller.getStats().attitudeMode, 'roll-pitch');
});

test('XR locomotion controller movement follows the downward-pitched spaceship frame', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
    pitchRateRadPerSec: 1.0,
  });
  const navigationRoot = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(0, 0, -1);
  const state = {
    observerPc: { x: 0, y: 0, z: 0 },
    starFieldScale: 1.0,
  };
  const baseXr = {
    presenting: true,
    referenceSpace: {},
    frame: {
      getViewerPose() {
        return {
          transform: {
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
        };
      },
    },
  };
  const context = {
    state,
    camera,
    navigationRoot,
    contentRoot,
    xr: {
      ...baseXr,
      session: {
        inputSources: [
          { handedness: 'left', gamepad: { axes: [0, 0, 0, -1] } },
        ],
      },
    },
    frame: { deltaSeconds: 0.5 },
  };

  controller.attach(context);
  controller.update(context);

  context.xr.session.inputSources = [
    { handedness: 'right', gamepad: { axes: [0, 0, 0, -1] } },
  ];
  controller.update(context);

  assert.ok(state.observerPc.y < -0.4, 'forward motion should descend after pitching the spaceship down');
  assert.ok(state.observerPc.z < -0.5, 'forward motion should still advance through space');
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

  assert.ok(state.observerPc.z < -0.4 && state.observerPc.z > -0.6,
    'should ramp in smoothly instead of lurching forward');
  assert.equal(state.observerPc.x, 0, 'should stay on straight-line path (x)');
  assert.equal(state.observerPc.y, 0, 'should stay on straight-line path (y)');
  assert.equal(controller.getStats().movementAutomation, 'flyTo');
});

test('XR locomotion controller flyTo keeps accelerating when no max speed cap is given', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
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
    z: -50,
  }, {
    acceleration: 4,
    deceleration: 6,
    arrivalThreshold: 0.01,
  });

  controller.update(context);
  const firstStep = Math.abs(state.observerPc.z);
  controller.update(context);
  const secondStep = Math.abs(state.observerPc.z) - firstStep;

  assert.ok(secondStep > firstStep,
    `uncapped flight should keep accelerating (first ${firstStep}, second ${secondStep})`);
  assert.equal(controller.getStats().movementAutomationMaxSpeedPcPerSec, null);
});

test('XR locomotion controller flyTo respects an explicit max speed cap', () => {
  const controller = createXrLocomotionController({
    sceneScale: 1.0,
    moveSpeed: 2,
    flyAcceleration: 8,
    flyDeceleration: 8,
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
    z: -50,
  }, {
    maxSpeed: 3,
    acceleration: 8,
    deceleration: 8,
    arrivalThreshold: 0.01,
  });

  controller.update(context);
  const firstStep = Math.abs(state.observerPc.z);
  controller.update(context);
  const secondStep = Math.abs(state.observerPc.z) - firstStep;
  const stats = controller.getStats();

  assert.ok(firstStep <= 0.8, `first capped step should stay modest, got ${firstStep}`);
  assert.ok(secondStep <= 1.6, `second capped step should respect the 3 pc/s ceiling, got ${secondStep}`);
  assert.equal(stats.movementAutomationMaxSpeedPcPerSec, 3);
  assert.ok(stats.movementAutomationSpeedPcPerSec <= 3);
});
