import * as THREE from 'three';
import { normalizePoint } from '../fields/octree-selection.js';
import { identityIcrsToSceneTransform, identitySceneToIcrsTransform } from '../layers/scene-orientation.js';
import { SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

const _scratch = new THREE.Object3D();
_scratch.isCamera = true;

export { LOCAL_RIGHT, LOCAL_UP, LOCAL_FORWARD };

export function createCameraRig(options = {}) {
  const sceneScale = positiveFinite(options.sceneScale, SCALE);
  const icrsToScene = typeof options.icrsToSceneTransform === 'function'
    ? options.icrsToSceneTransform
    : identityIcrsToSceneTransform;
  const sceneToIcrs = typeof options.sceneToIcrsTransform === 'function'
    ? options.sceneToIcrsTransform
    : identitySceneToIcrsTransform;

  const positionPc = normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC)
    ?? { ...DEFAULT_OBSERVER_PC };
  const orientation = new THREE.Quaternion();
  const velocity = new THREE.Vector3();

  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  function computeOrientationToward(targetPc) {
    const [sx, sy, sz] = icrsToScene(
      (targetPc.x - positionPc.x) * sceneScale,
      (targetPc.y - positionPc.y) * sceneScale,
      (targetPc.z - positionPc.z) * sceneScale,
    );
    const len = Math.hypot(sx, sy, sz);
    if (!(len > 0)) return null;
    _scratch.position.set(0, 0, 0);
    _scratch.up.set(0, 1, 0);
    _scratch.lookAt(sx / len, sy / len, sz / len);
    return _scratch.quaternion.clone();
  }

  function orientToward(targetPc) {
    const q = computeOrientationToward(targetPc);
    if (q) orientation.copy(q);
  }

  if (options.lookAtPc) {
    const target = normalizePoint(options.lookAtPc, null);
    if (target) orientToward(target);
  }

  return {
    positionPc,
    orientation,
    velocity,
    sceneScale,
    icrsToScene,
    sceneToIcrs,

    getForward() { return _v.copy(LOCAL_FORWARD).applyQuaternion(orientation); },
    getRight() { return _v.copy(LOCAL_RIGHT).applyQuaternion(orientation); },
    getUp() { return _v.copy(LOCAL_UP).applyQuaternion(orientation); },

    rotateLocal(axis, angleRad) {
      _q.setFromAxisAngle(axis, angleRad);
      orientation.multiply(_q).normalize();
    },

    moveInSceneDirection(direction, distancePc) {
      if (!(distancePc > 0) || direction.lengthSq() === 0) return;
      const [ix, iy, iz] = sceneToIcrs(direction.x, direction.y, direction.z);
      const len = Math.hypot(ix, iy, iz);
      if (!(len > 0)) return;
      positionPc.x += (ix / len) * distancePc;
      positionPc.y += (iy / len) * distancePc;
      positionPc.z += (iz / len) * distancePc;
    },

    applyToCamera(camera) {
      const [sx, sy, sz] = icrsToScene(
        positionPc.x * sceneScale,
        positionPc.y * sceneScale,
        positionPc.z * sceneScale,
      );
      camera.position.set(sx, sy, sz);
      camera.quaternion.copy(orientation);
    },

    applyLookAtToCamera(camera, targetPc) {
      const [sx, sy, sz] = icrsToScene(
        positionPc.x * sceneScale,
        positionPc.y * sceneScale,
        positionPc.z * sceneScale,
      );
      const [tx, ty, tz] = icrsToScene(
        targetPc.x * sceneScale,
        targetPc.y * sceneScale,
        targetPc.z * sceneScale,
      );
      camera.position.set(sx, sy, sz);
      camera.lookAt(tx, ty, tz);
      orientation.copy(camera.quaternion);
    },

    orientToward,
    computeOrientationToward,

    slerpToward(targetQ, alpha) {
      orientation.slerp(targetQ, Math.min(1, Math.max(0, alpha)));
    },

    setPosition(pc) {
      positionPc.x = pc.x;
      positionPc.y = pc.y;
      positionPc.z = pc.z;
    },

    clonePosition() {
      return clonePoint(positionPc);
    },
  };
}
