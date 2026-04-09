import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSceneTouchDisplayController } from '../scene-touch-display-controller.js';

const PANEL_WIDTH = 0.20;
const PANEL_HEIGHT = 0.28;

function createFakeCanvasContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    clearRect() {},
    fill() {},
    stroke() {},
    beginPath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fillText() {},
    measureText() { return { width: 40 }; },
  };
}

function installFakeDocument() {
  const savedDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') {
        throw new Error(`Unsupported element: ${tag}`);
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return createFakeCanvasContext();
        },
      };
    },
  };
  return () => {
    globalThis.document = savedDocument;
  };
}

function createPointerTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 200, height: 200 };
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
}

function createBaseContext(pointerTarget) {
  const scene = new THREE.Scene();
  const cameraMount = new THREE.Group();
  const contentRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  cameraMount.add(camera);
  scene.add(cameraMount);
  scene.add(contentRoot);

  return {
    scene,
    camera,
    canvas: pointerTarget,
    cameraMount,
    contentRoot,
    attachmentRoot: new THREE.Group(),
    navigationRoot: new THREE.Group(),
    xr: { presenting: false },
  };
}

function makePose(position, quaternion = new THREE.Quaternion()) {
  return {
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
    },
  };
}

function makeTargetRayPose(origin, target) {
  const direction = new THREE.Vector3().subVectors(target, origin).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    direction,
  );
  return makePose(origin, quaternion);
}

test('scene touch display can mount under arbitrary scene parents', () => {
  const restoreDocument = installFakeDocument();

  try {
    const pointerTarget = createPointerTarget();
    const context = createBaseContext(pointerTarget);
    const controller = createSceneTouchDisplayController({
      items: [{ id: 'selection', label: 'Selection', type: 'button' }],
      parent: 'contentRoot',
      position: { x: 0, y: 0, z: -0.5 },
    });

    controller.attach(context);
    controller.update(context);

    assert.equal(context.contentRoot.children[0], controller.mesh);
  } finally {
    restoreDocument();
  }
});

test('scene touch display accepts mouse interaction on the in-scene panel', () => {
  const restoreDocument = installFakeDocument();

  try {
    const pointerTarget = createPointerTarget();
    const context = createBaseContext(pointerTarget);
    const actions = [];
    const controller = createSceneTouchDisplayController({
      items: [{ id: 'selection', label: 'Selection', type: 'button' }],
      mouseControls: true,
      parent: 'cameraMount',
      position: { x: 0, y: 0, z: -0.5 },
      onChange(id) {
        actions.push(id);
      },
    });

    controller.attach(context);
    controller.update(context);

    const rect = controller.display.getRectForItem('selection');
    const u = (rect.x + rect.w / 2) / 400;
    const v = 1 - ((rect.y + rect.h / 2) / 560);
    const localPoint = new THREE.Vector3(
      (u - 0.5) * PANEL_WIDTH,
      (v - 0.5) * PANEL_HEIGHT,
      0,
    );
    const worldPoint = controller.mesh.localToWorld(localPoint);
    const projected = worldPoint.clone().project(context.camera);
    const pointerEvent = {
      button: 0,
      pointerId: 1,
      clientX: (projected.x * 0.5 + 0.5) * 200,
      clientY: (-projected.y * 0.5 + 0.5) * 200,
      preventDefault() {},
      stopImmediatePropagation() {},
    };

    pointerTarget.listeners.get('pointerdown')(pointerEvent);
    pointerTarget.listeners.get('pointerup')(pointerEvent);
    pointerTarget.listeners.get('click')(pointerEvent);

    assert.deepEqual(actions, ['selection']);
  } finally {
    restoreDocument();
  }
});

test('scene touch display accepts XR interaction while mounted as a scene object', () => {
  const restoreDocument = installFakeDocument();

  try {
    const pointerTarget = createPointerTarget();
    const context = createBaseContext(pointerTarget);
    const wall = new THREE.Group();
    wall.position.set(0.15, 0.05, -0.75);
    wall.rotation.set(0, -0.2, 0);
    context.contentRoot.add(wall);

    const actions = [];
    const rightTargetRaySpace = {};
    const rightGamepad = { buttons: [{ pressed: false }] };
    let targetRayPose = makePose(new THREE.Vector3(0, 0, 0.25));

    context.xr = {
      presenting: true,
      referenceSpace: {},
      session: {
        inputSources: [
          { handedness: 'right', targetRaySpace: rightTargetRaySpace, gamepad: rightGamepad },
        ],
      },
      frame: {
        getPose(space) {
          if (space === rightTargetRaySpace) {
            return targetRayPose;
          }
          return null;
        },
      },
    };

    const controller = createSceneTouchDisplayController({
      items: [{ id: 'selection', label: 'Selection', type: 'button' }],
      parent: wall,
      xrControls: {
        pointerHand: 'right',
      },
      onChange(id) {
        actions.push(id);
      },
    });

    controller.attach(context);
    controller.update(context);

    const rect = controller.display.getRectForItem('selection');
    const u = (rect.x + rect.w / 2) / 400;
    const v = 1 - ((rect.y + rect.h / 2) / 560);
    const localPoint = new THREE.Vector3(
      (u - 0.5) * PANEL_WIDTH,
      (v - 0.5) * PANEL_HEIGHT,
      0,
    );
    const worldButtonPoint = controller.mesh.localToWorld(localPoint);
    const panelNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(controller.mesh.quaternion);
    const rayOrigin = worldButtonPoint.clone().addScaledVector(panelNormal, 0.25);
    targetRayPose = makeTargetRayPose(rayOrigin, worldButtonPoint);
    rightGamepad.buttons[0].pressed = true;

    controller.update(context);

    assert.deepEqual(actions, ['selection']);
    assert.equal(controller.mesh.parent, wall);
    assert.equal(controller.getHit()?.blocked, true);
  } finally {
    restoreDocument();
  }
});
