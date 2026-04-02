import * as THREE from 'three';
import { pickStar } from '../services/star-picker.js';
import { SCALE } from '../services/octree/scene-scale.js';
import { projectToHud } from './xr-hud.js';

const DEFAULT_HUD_DISTANCE = 2.5;
const DEFAULT_LASER_LENGTH = 500;
const LASER_COLOR = 0x44ff66;

const _rayOrigin = new THREE.Vector3();
const _rayDirection = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _hudDir = new THREE.Vector3();
const _xformMat = new THREE.Matrix4();
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();

function createLaserLine() {
  const positions = new Float32Array(6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: LASER_COLOR,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.visible = false;
  line.renderOrder = 999;
  return line;
}

function createRingSprite() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#44ff66';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.visible = false;
  sprite.renderOrder = 1000;
  sprite.scale.setScalar(0.08);
  return { sprite, texture };
}

function getControllerRay(xr) {
  const xrFrame = xr?.frame;
  const refSpace = xr?.referenceSpace;
  const session = xr?.session;
  if (!xrFrame || !refSpace || !session) return null;

  for (const source of session.inputSources) {
    if (!source.targetRaySpace) continue;
    const pose = xrFrame.getPose(source.targetRaySpace, refSpace);
    if (!pose) continue;

    const p = pose.transform.position;
    const o = pose.transform.orientation;
    _rayOrigin.set(p.x, p.y, p.z);
    _rayDirection.set(0, 0, -1).applyQuaternion(_tmpQuat.set(o.x, o.y, o.z, o.w));
    return { origin: _rayOrigin, direction: _rayDirection, source };
  }

  return null;
}

function isSelectPressed(xr) {
  const session = xr?.session;
  if (!session) return false;
  for (const source of session.inputSources) {
    const btn = source.gamepad?.buttons?.[0];
    if (btn?.pressed) return true;
  }
  return false;
}

/**
 * XR pick controller — laser pointer and trigger-based star picking.
 *
 * The laser is parented to `cameraMount` (xrOrigin) so it stays
 * attached to the spaceship and moves correctly during locomotion.
 *
 * The selection ring is parented to the **camera** and positioned via
 * `projectToHud` so it appears at a comfortable focal distance while
 * visually overlapping the picked star.  This gives correct stereo
 * convergence — each eye sees the ring at a genuinely different angle.
 */
export function createXrPickController(options = {}) {
  const {
    getStarData,
    onPick,
    hudDistance = DEFAULT_HUD_DISTANCE,
    toleranceDeg = 1.5,
  } = options;

  let latestCamera = null;
  let latestState = null;
  let pickedWorldPos = null;

  let laserLine = null;
  let ringSprite = null;
  let ringTexture = null;
  let laserParent = null;
  let ringParent = null;
  let triggerWasPressed = false;

  function runPick(ray, event) {
    const starData = typeof getStarData === 'function' ? getStarData() : null;
    if (!starData) return null;

    const fovRad = latestCamera?.isPerspectiveCamera
      ? THREE.MathUtils.degToRad(latestCamera.fov)
      : undefined;

    const t0 = performance.now();
    const result = pickStar(ray, starData, {
      scale: SCALE,
      toleranceDeg,
      fovRad,
      viewportHeight: 800,
      magLimit: latestState?.mDesired ?? 6.5,
      exposure: latestState?.starFieldExposure ?? 0.028,
      extinctionScale: latestState?.starFieldExtinctionScale ?? 1.0,
    });
    const pickTimeMs = performance.now() - t0;

    if (typeof onPick === 'function') {
      onPick(result, event, { pickTimeMs, starCount: starData.starCount });
    }
    return result;
  }

  function ensureVisuals(cameraMount, camera) {
    if (laserParent === cameraMount && ringParent === camera) return;
    removeVisuals();

    laserLine = createLaserLine();
    cameraMount.add(laserLine);
    laserParent = cameraMount;

    const ring = createRingSprite();
    ringSprite = ring.sprite;
    ringTexture = ring.texture;
    camera.add(ringSprite);
    ringParent = camera;
  }

  function updateLaser(controllerRay) {
    if (!laserLine) return;
    const posAttr = laserLine.geometry.getAttribute('position');
    posAttr.setXYZ(0, controllerRay.origin.x, controllerRay.origin.y, controllerRay.origin.z);
    const endX = controllerRay.origin.x + controllerRay.direction.x * DEFAULT_LASER_LENGTH;
    const endY = controllerRay.origin.y + controllerRay.direction.y * DEFAULT_LASER_LENGTH;
    const endZ = controllerRay.origin.z + controllerRay.direction.z * DEFAULT_LASER_LENGTH;
    posAttr.setXYZ(1, endX, endY, endZ);
    posAttr.needsUpdate = true;
    laserLine.visible = true;
  }

  function updateRing(camera) {
    if (!ringSprite || !pickedWorldPos) {
      if (ringSprite) ringSprite.visible = false;
      return;
    }

    _hudDir.set(pickedWorldPos.x, pickedWorldPos.y, pickedWorldPos.z);
    projectToHud(_hudDir, camera, hudDistance, ringSprite.position);
    ringSprite.visible = true;
  }

  function hideVisuals() {
    if (laserLine) laserLine.visible = false;
    if (ringSprite) ringSprite.visible = false;
  }

  function removeVisuals() {
    if (laserLine) {
      laserParent?.remove(laserLine);
      laserLine.geometry.dispose();
      laserLine.material.dispose();
      laserLine = null;
    }
    if (ringSprite) {
      ringParent?.remove(ringSprite);
      ringSprite.material.dispose();
      ringTexture?.dispose();
      ringSprite = null;
      ringTexture = null;
    }
    laserParent = null;
    ringParent = null;
  }

  return {
    id: options.id ?? 'xr-pick-controller',

    attach(context) {
      latestCamera = context.camera;
      latestState = context.state;
    },

    update(context) {
      latestCamera = context.camera;
      latestState = context.state;

      if (context.xr?.presenting !== true) {
        hideVisuals();
        return;
      }

      ensureVisuals(context.cameraMount, context.camera);

      const controllerRay = getControllerRay(context.xr);
      if (controllerRay) {
        updateLaser(controllerRay);

        const pressed = isSelectPressed(context.xr);
        if (pressed && !triggerWasPressed) {
          context.cameraMount.updateWorldMatrix(true, false);
          context.contentRoot.updateWorldMatrix(true, false);

          _xformMat.copy(context.contentRoot.matrixWorld).invert()
            .multiply(context.cameraMount.matrixWorld);
          _v3a.copy(controllerRay.origin).applyMatrix4(_xformMat);
          _v3b.addVectors(controllerRay.origin, controllerRay.direction)
            .applyMatrix4(_xformMat)
            .sub(_v3a).normalize();

          const result = runPick(
            { origin: _v3a.clone(), direction: _v3b.clone() },
            null,
          );

          if (result?.position) {
            _v3a.set(result.position.x, result.position.y, result.position.z)
              .applyMatrix4(context.contentRoot.matrixWorld);
            pickedWorldPos = { x: _v3a.x, y: _v3a.y, z: _v3a.z };
          } else {
            pickedWorldPos = null;
          }
        }
        triggerWasPressed = pressed;
      } else {
        if (laserLine) laserLine.visible = false;
      }

      updateRing(context.camera);
    },

    clearSelection() {
      pickedWorldPos = null;
      if (ringSprite) ringSprite.visible = false;
    },

    dispose() {
      removeVisuals();
      latestCamera = null;
      latestState = null;
      pickedWorldPos = null;
      triggerWasPressed = false;
    },
  };
}
