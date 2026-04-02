import * as THREE from 'three';
import { pickStar } from '../services/star-picker.js';
import { SCALE } from '../services/octree/scene-scale.js';

const MAX_DRAG_DISTANCE_SQ = 25;
const DEFAULT_HUD_DISTANCE = 2.5;
const DEFAULT_LASER_LENGTH = 500;
const LASER_COLOR = 0x44ff66;
const RING_COLOR = 0x44ff66;

const _cameraPos = new THREE.Vector3();
const _hudDir = new THREE.Vector3();
const _hudPoint = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDirection = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _projVec = new THREE.Vector3();

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
 * Controller that wires pointer (2D) and XR controller input to the
 * star-picker algorithm.
 *
 * 2D: click on the canvas → pick → CSS highlight overlay (direction-projected
 * for stability at extreme distances).
 *
 * XR: green laser from controller, trigger to pick, HUD-distance ring sprite
 * locked to the star's direction at a fixed comfortable depth.
 *
 * @param {Object} options
 * @param {Function} options.getStarData   () => starData from a StarFieldLayer.
 * @param {Function} [options.onPick]      Called with (result, event, stats).
 * @param {number}   [options.toleranceDeg]  Angular search half-angle (default 1.0; XR auto-widens to 1.5).
 * @param {number}   [options.xrToleranceDeg]  Override tolerance for XR (default 1.5).
 * @param {number}   [options.scale]         Scene scale override.
 * @param {number}   [options.hudDistance]    Distance in world units for XR ring (default 2.5).
 */
export function createPickController(options = {}) {
  const {
    getStarData,
    onPick,
    scale = SCALE,
    hudDistance = DEFAULT_HUD_DISTANCE,
    xrToleranceDeg = 1.5,
  } = options;

  let toleranceDeg = options.toleranceDeg ?? 1.0;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // 2D state
  let highlightEl = null;
  let canvas = null;
  let pointerDownPos = null;
  let cleanupListeners = null;

  // Shared state
  let latestCamera = null;
  let latestSize = null;
  let latestState = null;
  let pickedPosition = null;

  // XR state
  let laserLine = null;
  let ringSprite = null;
  let ringTexture = null;
  let sceneRef = null;
  let xrSelectHandler = null;
  let xrSessionRef = null;
  let wasPresenting = false;
  let triggerWasPressed = false;

  function runPick(ray, effectiveTolerance, event) {
    const starData = typeof getStarData === 'function' ? getStarData() : null;
    if (!starData) return;

    const fovRad = latestCamera?.isPerspectiveCamera
      ? THREE.MathUtils.degToRad(latestCamera.fov)
      : undefined;

    const t0 = performance.now();
    const result = pickStar(ray, starData, {
      scale,
      toleranceDeg: effectiveTolerance,
      fovRad,
      viewportHeight: latestSize?.height ?? 800,
      magLimit: latestState?.mDesired ?? 6.5,
      exposure: latestState?.starFieldExposure ?? 0.028,
      extinctionScale: latestState?.starFieldExtinctionScale ?? 1.0,
    });
    const pickTimeMs = performance.now() - t0;

    pickedPosition = result?.position ?? null;
    if (typeof onPick === 'function') {
      onPick(result, event, { pickTimeMs, starCount: starData.starCount });
    }
  }

  // --- 2D pointer handling ---

  function handlePointerDown(event) {
    pointerDownPos = { x: event.clientX, y: event.clientY };
  }

  function handleClick(event) {
    if (!pointerDownPos || !latestCamera) return;
    const ddx = event.clientX - pointerDownPos.x;
    const ddy = event.clientY - pointerDownPos.y;
    if (ddx * ddx + ddy * ddy > MAX_DRAG_DISTANCE_SQ) return;

    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, latestCamera);

    runPick(raycaster.ray, toleranceDeg, event);
  }

  // --- 2D highlight (direction-projected for stability) ---

  function update2dHighlight(camera, size) {
    if (!highlightEl || !pickedPosition) {
      if (highlightEl) highlightEl.style.display = 'none';
      return;
    }

    camera.getWorldPosition(_cameraPos);
    _hudDir.set(pickedPosition.x, pickedPosition.y, pickedPosition.z)
      .sub(_cameraPos).normalize();
    _hudPoint.copy(_cameraPos).addScaledVector(_hudDir, 1.0);
    _projVec.copy(_hudPoint).project(camera);

    if (_projVec.z > 1 || _projVec.z < -1) {
      highlightEl.style.display = 'none';
      return;
    }

    const w = size.width;
    const h = size.height;
    const sx = (_projVec.x * 0.5 + 0.5) * w;
    const sy = (-_projVec.y * 0.5 + 0.5) * h;

    highlightEl.style.display = 'block';
    highlightEl.style.left = `${sx}px`;
    highlightEl.style.top = `${sy}px`;
  }

  // --- XR laser + ring ---

  function ensureXrObjects(scene) {
    if (!laserLine) {
      laserLine = createLaserLine();
      scene.add(laserLine);
    }
    if (!ringSprite) {
      const ring = createRingSprite();
      ringSprite = ring.sprite;
      ringTexture = ring.texture;
      scene.add(ringSprite);
    }
    sceneRef = scene;
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

  function updateXrRing(xr) {
    if (!ringSprite || !pickedPosition) {
      if (ringSprite) ringSprite.visible = false;
      return;
    }

    const xrFrame = xr?.frame;
    const refSpace = xr?.referenceSpace;
    if (xrFrame && refSpace) {
      const viewerPose = xrFrame.getViewerPose(refSpace);
      if (viewerPose) {
        const p = viewerPose.transform.position;
        _cameraPos.set(p.x, p.y, p.z);
      }
    }

    _hudDir.set(pickedPosition.x, pickedPosition.y, pickedPosition.z)
      .sub(_cameraPos).normalize();
    ringSprite.position.copy(_cameraPos).addScaledVector(_hudDir, hudDistance);
    ringSprite.visible = true;
  }

  function hideXrObjects() {
    if (laserLine) laserLine.visible = false;
    if (ringSprite) ringSprite.visible = false;
  }

  function removeXrObjects() {
    if (laserLine) {
      sceneRef?.remove(laserLine);
      laserLine.geometry.dispose();
      laserLine.material.dispose();
      laserLine = null;
    }
    if (ringSprite) {
      sceneRef?.remove(ringSprite);
      ringSprite.material.dispose();
      ringTexture?.dispose();
      ringSprite = null;
      ringTexture = null;
    }
    sceneRef = null;
  }

  function bindXrSession(session) {
    if (xrSessionRef === session) return;
    unbindXrSession();
    xrSessionRef = session;
  }

  function unbindXrSession() {
    xrSessionRef = null;
    triggerWasPressed = false;
  }

  // --- Controller API ---

  return {
    id: options.id ?? 'pick-controller',

    attach(context) {
      canvas = context.canvas;
      latestCamera = context.camera;
      latestSize = context.size;
      latestState = context.state;

      highlightEl = document.createElement('div');
      highlightEl.className = 'pick-highlight';
      highlightEl.style.cssText = [
        'display:none',
        'position:absolute',
        'width:28px',
        'height:28px',
        'border:2px solid #73d5ff',
        'border-radius:50%',
        'transform:translate(-50%,-50%)',
        'pointer-events:none',
        'box-shadow:0 0 10px rgba(115,213,255,0.5)',
        'z-index:10',
      ].join(';');

      context.host.style.position = 'relative';
      context.host.appendChild(highlightEl);

      canvas.addEventListener('pointerdown', handlePointerDown);
      canvas.addEventListener('click', handleClick);
      cleanupListeners = () => {
        canvas.removeEventListener('pointerdown', handlePointerDown);
        canvas.removeEventListener('click', handleClick);
      };
    },

    update(context) {
      latestCamera = context.camera;
      latestSize = context.size;
      latestState = context.state;

      const presenting = context.xr?.presenting === true;

      if (presenting) {
        if (!wasPresenting) {
          bindXrSession(context.xr.session);
          if (highlightEl) highlightEl.style.display = 'none';
        }

        ensureXrObjects(context.scene);

        const controllerRay = getControllerRay(context.xr);
        if (controllerRay) {
          updateLaser(controllerRay);

          const pressed = isSelectPressed(context.xr);
          if (pressed && !triggerWasPressed) {
            runPick(
              { origin: controllerRay.origin.clone(), direction: controllerRay.direction.clone() },
              xrToleranceDeg,
              null,
            );
          }
          triggerWasPressed = pressed;
        } else {
          if (laserLine) laserLine.visible = false;
        }

        updateXrRing(context.xr);
      } else {
        if (wasPresenting) {
          unbindXrSession();
          hideXrObjects();
        }
        update2dHighlight(context.camera, context.size);
      }

      wasPresenting = presenting;
    },

    setToleranceDeg(deg) {
      if (Number.isFinite(deg) && deg > 0) toleranceDeg = deg;
    },

    clearSelection() {
      pickedPosition = null;
      if (highlightEl) highlightEl.style.display = 'none';
      if (ringSprite) ringSprite.visible = false;
    },

    dispose() {
      if (cleanupListeners) {
        cleanupListeners();
        cleanupListeners = null;
      }
      if (highlightEl?.parentNode) {
        highlightEl.parentNode.removeChild(highlightEl);
      }
      unbindXrSession();
      removeXrObjects();
      highlightEl = null;
      canvas = null;
      pickedPosition = null;
      latestCamera = null;
      latestSize = null;
      latestState = null;
    },
  };
}
