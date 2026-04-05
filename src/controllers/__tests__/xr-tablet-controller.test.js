import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createXrTabletController } from '../xr-tablet-controller.js';

const PANEL_WIDTH = 0.20;
const PANEL_HEIGHT = 0.28;
const PAGE_SELECTION_V = 1 - ((20 + 50 + 30) / 560);

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

test('XR tablet keeps blocking picks for the frame that switches menu pages', () => {
  const restoreDocument = installFakeDocument();

  try {
    const cameraMount = new THREE.Group();
    const leftGripSpace = {};
    const rightTargetRaySpace = {};
    let gripPose = makePose(new THREE.Vector3(0, 0, 0));
    let targetRayPose = makePose(new THREE.Vector3(0, 0, 0.25));
    let pageSelectionCount = 0;
    let controller = null;

    const homeItems = [
      { id: 'page-selection', label: 'Selection', type: 'button' },
      { id: 'page-rendering', label: 'Rendering', type: 'button' },
      { id: 'page-waypoints', label: 'Waypoints', type: 'button' },
    ];
    const selectionItems = [
      { id: 'back-home', label: '< Back', type: 'button' },
    ];

    controller = createXrTabletController({
      items: homeItems,
      onChange(id) {
        if (id === 'page-selection') {
          pageSelectionCount += 1;
          controller.setItems(selectionItems);
        }
      },
    });

    const rightGamepad = { buttons: [{ pressed: false }] };
    const context = {
      cameraMount,
      xr: {
        presenting: true,
        referenceSpace: {},
        session: {
          inputSources: [
            { handedness: 'left', gripSpace: leftGripSpace },
            { handedness: 'right', targetRaySpace: rightTargetRaySpace, gamepad: rightGamepad },
          ],
        },
        frame: {
          getPose(space) {
            if (space === leftGripSpace) return gripPose;
            if (space === rightTargetRaySpace) return targetRayPose;
            return null;
          },
        },
      },
    };

    controller.update(context);

    const panelMesh = cameraMount.children[0];
    assert.ok(panelMesh, 'tablet panel should be attached after first update');
    panelMesh.updateMatrixWorld(true);

    const localButtonPoint = new THREE.Vector3(
      0,
      (PAGE_SELECTION_V - 0.5) * PANEL_HEIGHT,
      0,
    );
    const worldButtonPoint = panelMesh.localToWorld(localButtonPoint.clone());
    const panelNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(panelMesh.quaternion);
    const rayOrigin = worldButtonPoint.clone().addScaledVector(panelNormal, 0.25);
    targetRayPose = makeTargetRayPose(rayOrigin, worldButtonPoint);
    rightGamepad.buttons[0].pressed = true;

    controller.update(context);

    assert.equal(pageSelectionCount, 1, 'menu button should activate');
    assert.deepEqual(controller.getHit()?.blocked, true, 'panel should still block star picking this frame');
    assert.ok(controller.getHit()?.length > 0, 'panel hit length should still be available');
  } finally {
    restoreDocument();
  }
});
