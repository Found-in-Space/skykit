import * as THREE from 'three';
import { pickStar } from '../services/star-picker.js';
import { SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_LASER_LENGTH = 500;
const LASER_COLOR = 0x44ff66;
const RING_ANGULAR_SCALE = 0.032; // ~1.8° angular diameter
const DEFAULT_HANDEDNESS = 'right';

const _rayOrigin = new THREE.Vector3();
const _rayDirection = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
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
  return { sprite, texture };
}

function getControllerRay(xr, handedness) {
  const xrFrame = xr?.frame;
  const refSpace = xr?.referenceSpace;
  const session = xr?.session;
  if (!xrFrame || !refSpace || !session) return null;

  for (const source of session.inputSources) {
    if (handedness && source.handedness !== handedness) continue;
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

function isSelectPressed(xr, handedness) {
  const session = xr?.session;
  if (!session) return false;
  for (const source of session.inputSources) {
    if (handedness && source.handedness !== handedness) continue;
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
 * The selection ring is parented to `contentRoot` (the universe) and
 * placed at the star's exact position in content space.  THREE.Sprite
 * billboards automatically, so no camera parenting is needed.  Scale
 * is updated each frame proportional to camera distance so the ring
 * subtends a constant angle.  Parenting to content space means the XR
 * compositor's ATW correction warps the ring identically to the stars,
 * eliminating the wobble that camera-parenting caused.
 */
export function createXrPickController(options = {}) {
  const {
    getStarData,
    onPick,
    toleranceDeg = 1.5,
    handedness = DEFAULT_HANDEDNESS,
    getLaserOverride,
  } = options;

  let latestCamera = null;
  let latestState = null;

  // contentRoot-local position of the picked star; valid only when hasPick is true.
  const pickedContentPos = new THREE.Vector3();
  let hasPick = false;

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
      magFadeRange: latestState?.starFieldMagFadeRange,
      exposure: latestState?.starFieldExposure ?? 0.028,
      baseSize: latestState?.starFieldBaseSize ?? latestState?.starFieldSizeMin,
      sizeScale: latestState?.starFieldSizeScale ?? latestState?.starFieldLinearScale,
      sizePower: latestState?.starFieldSizePower,
      sizeMax: latestState?.starFieldSizeMax,
      nearMagLimitFloor: latestState?.starFieldNearMagLimitFloor,
      nearMagLimitRadiusPc: latestState?.starFieldNearMagLimitRadiusPc,
      nearMagLimitFeatherPc: latestState?.starFieldNearMagLimitFeatherPc,
      extinctionScale: latestState?.starFieldExtinctionScale ?? 1.0,
    });
    const pickTimeMs = performance.now() - t0;

    if (typeof onPick === 'function') {
      onPick(result, event, { pickTimeMs, starCount: starData.starCount });
    }
    return result;
  }

  function ensureVisuals(cameraMount, contentRoot) {
    if (laserParent === cameraMount && ringParent === contentRoot) return;
    removeVisuals();

    laserLine = createLaserLine();
    cameraMount.add(laserLine);
    laserParent = cameraMount;

    const ring = createRingSprite();
    ringSprite = ring.sprite;
    ringTexture = ring.texture;
    contentRoot.add(ringSprite);
    ringParent = contentRoot;

    if (hasPick) {
      ringSprite.position.copy(pickedContentPos);
    }
  }

  function updateLaser(controllerRay, length) {
    if (!laserLine) return;
    const len = length ?? DEFAULT_LASER_LENGTH;
    const posAttr = laserLine.geometry.getAttribute('position');
    posAttr.setXYZ(0, controllerRay.origin.x, controllerRay.origin.y, controllerRay.origin.z);
    const endX = controllerRay.origin.x + controllerRay.direction.x * len;
    const endY = controllerRay.origin.y + controllerRay.direction.y * len;
    const endZ = controllerRay.origin.z + controllerRay.direction.z * len;
    posAttr.setXYZ(1, endX, endY, endZ);
    posAttr.needsUpdate = true;
    laserLine.visible = true;
  }

  function updateRing(camera) {
    if (!ringSprite || !hasPick) {
      if (ringSprite) ringSprite.visible = false;
      return;
    }

    // Transform pickedContentPos to world space, then compute distance from camera.
    _v3b.copy(pickedContentPos).applyMatrix4(ringParent.matrixWorld);
    const dist = camera.getWorldPosition(_v3a).distanceTo(_v3b);
    const contentScale = ringParent.matrixWorld.getMaxScaleOnAxis();
    ringSprite.scale.setScalar(dist * RING_ANGULAR_SCALE / contentScale);
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

      ensureVisuals(context.cameraMount, context.contentRoot);

      const controllerRay = getControllerRay(context.xr, handedness);
      if (controllerRay) {
        const laserOverride = typeof getLaserOverride === 'function'
          ? getLaserOverride(controllerRay)
          : null;
        updateLaser(controllerRay, laserOverride?.length ?? null);

        const pressed = isSelectPressed(context.xr, handedness);
        if (pressed && !triggerWasPressed && !laserOverride?.blocked) {
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
            pickedContentPos.set(result.position.x, result.position.y, result.position.z);
            hasPick = true;
            if (ringSprite) {
              ringSprite.position.copy(pickedContentPos);
            }
          } else {
            hasPick = false;
          }
        }
        triggerWasPressed = pressed;
      } else {
        if (laserLine) laserLine.visible = false;
      }

      updateRing(context.camera);
    },

    clearSelection() {
      hasPick = false;
      if (ringSprite) ringSprite.visible = false;
    },

    dispose() {
      removeVisuals();
      latestCamera = null;
      latestState = null;
      hasPick = false;
      triggerWasPressed = false;
    },
  };
}
