import * as THREE from 'three';
import { createTouchDisplay } from '../ui/touch-display.js';

const DEFAULT_HANDEDNESS = 'left';
const PANEL_WIDTH = 0.20;
const PANEL_HEIGHT = 0.28;
const PANEL_RENDER_ORDER = 998;

const _plane = new THREE.Plane();
const _intersect = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _localPt = new THREE.Vector3();
const _rayOrig = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

function getGripPose(xr, handedness) {
  const { frame, referenceSpace, session } = xr ?? {};
  if (!frame || !referenceSpace || !session) return null;

  for (const source of session.inputSources) {
    if (source.handedness !== handedness) continue;
    if (!source.gripSpace) continue;
    const pose = frame.getPose(source.gripSpace, referenceSpace);
    if (pose) return pose;
  }
  return null;
}

function getTargetRayPose(xr, handedness) {
  const { frame, referenceSpace, session } = xr ?? {};
  if (!frame || !referenceSpace || !session) return null;

  for (const source of session.inputSources) {
    if (source.handedness !== handedness) continue;
    if (!source.targetRaySpace) continue;
    const pose = frame.getPose(source.targetRaySpace, referenceSpace);
    if (pose) return pose;
  }
  return null;
}

function isTriggerPressed(xr, handedness) {
  const session = xr?.session;
  if (!session) return false;
  for (const source of session.inputSources) {
    if (source.handedness !== handedness) continue;
    const btn = source.gamepad?.buttons?.[0];
    if (btn?.pressed) return true;
  }
  return false;
}

function hitTestPanel(panelMesh, rayOrigin, rayDirection) {
  _normal.set(0, 0, 1).applyQuaternion(panelMesh.quaternion);
  _plane.setFromNormalAndCoplanarPoint(_normal, panelMesh.position);

  const denom = _normal.dot(rayDirection);
  if (Math.abs(denom) < 1e-6) return null;

  const t = _plane.distanceToPoint(rayOrigin) / -denom;
  if (t < 0) return null;

  _intersect.copy(rayOrigin).addScaledVector(rayDirection, t);

  _tmpQuat.copy(panelMesh.quaternion).invert();
  _localPt.copy(_intersect).sub(panelMesh.position).applyQuaternion(_tmpQuat);
  const u = _localPt.x / PANEL_WIDTH + 0.5;
  const v = _localPt.y / PANEL_HEIGHT + 0.5;

  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, distance: t, point: _intersect.clone() };
}

/**
 * XR tablet controller — XR host for a reusable touch-display runtime.
 *
 * The display owns canvas rendering, layout, hover/press state, and
 * control dispatch. This controller only attaches the panel to the XR
 * rig, ray-tests it, and forwards pointer input to the display.
 */
export function createXrTabletController(options = {}) {
  const {
    items: initialItems = [],
    onChange,
    handedness = DEFAULT_HANDEDNESS,
    title,
  } = options;

  const pointerHand = handedness === 'left' ? 'right' : 'left';
  const display = createTouchDisplay({
    title,
    items: initialItems,
    onAction(id, value, detail) {
      if (typeof onChange === 'function') {
        onChange(id, value, detail);
      }
    },
  });

  const texture = new THREE.CanvasTexture(display.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const panelGeo = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
  const panelMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.renderOrder = PANEL_RENDER_ORDER;
  panelMesh.visible = false;

  let parent = null;
  let currentHit = null;

  function ensureParented(cameraMount) {
    if (parent === cameraMount) return;
    if (parent) parent.remove(panelMesh);
    cameraMount.add(panelMesh);
    parent = cameraMount;
  }

  function positionPanel(xr) {
    const pose = getGripPose(xr, handedness);
    if (!pose) {
      panelMesh.visible = false;
      return false;
    }

    const p = pose.transform.position;
    const o = pose.transform.orientation;
    panelMesh.position.set(p.x, p.y, p.z);
    panelMesh.quaternion.set(o.x, o.y, o.z, o.w);

    // Tilt the panel toward the user and float it slightly above the grip.
    panelMesh.rotateX(-Math.PI * 0.35);
    panelMesh.translateZ(-0.02);
    panelMesh.translateY(0.08);

    panelMesh.visible = true;
    return true;
  }

  function readPointerHit(xr) {
    const pose = getTargetRayPose(xr, pointerHand);
    if (!pose || !panelMesh.visible) {
      currentHit = null;
      return null;
    }

    const p = pose.transform.position;
    const o = pose.transform.orientation;
    _rayOrig.set(p.x, p.y, p.z);
    _rayDir.set(0, 0, -1).applyQuaternion(_tmpQuat.set(o.x, o.y, o.z, o.w));

    currentHit = hitTestPanel(panelMesh, _rayOrig, _rayDir);
    return currentHit;
  }

  return {
    id: options.id ?? 'xr-tablet-controller',

    getHit() {
      if (!currentHit) return null;
      return { length: currentHit.distance, blocked: true };
    },

    attach(_context) {},

    update(context) {
      if (context.xr?.presenting !== true) {
        panelMesh.visible = false;
        currentHit = null;
        display.handlePointer(null, false);
        return;
      }

      ensureParented(context.cameraMount);
      positionPanel(context.xr);
      const hit = readPointerHit(context.xr);
      const pressed = isTriggerPressed(context.xr, pointerHand);
      display.handlePointer(hit, pressed);

      if (display.draw()) {
        texture.needsUpdate = true;
      }
    },

    setDisplay(id, lines) {
      display.setDisplay(id, lines);
    },

    setItems(nextItems) {
      display.setItems(nextItems);
    },

    setItemValue(id, value) {
      display.setItemValue(id, value);
    },

    dispose() {
      if (parent) parent.remove(panelMesh);
      panelGeo.dispose();
      panelMat.dispose();
      texture.dispose();
      parent = null;
      currentHit = null;
    },
  };
}
