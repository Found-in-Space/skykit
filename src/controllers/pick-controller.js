import * as THREE from 'three';
import { DEFAULT_TUNED_EXPOSURE } from '../layers/star-field-materials.js';
import { pickStar } from '../services/star-picker.js';
import { SCALE } from '../services/octree/scene-scale.js';

const MAX_DRAG_DISTANCE_SQ = 25;

const _cameraPos = new THREE.Vector3();
const _hudDir = new THREE.Vector3();
const _hudPoint = new THREE.Vector3();
const _projVec = new THREE.Vector3();

/**
 * Desktop pick controller — pointer click-based star picking with a CSS
 * highlight overlay projected to the star's direction for stability at
 * extreme distances.
 *
 * @param {Object} options
 * @param {Function} options.getStarData   () => starData from a StarFieldLayer.
 * @param {Function} [options.onPick]      Called with (result, event, stats).
 * @param {number}   [options.toleranceDeg]  Angular search half-angle (default 1.0).
 * @param {number}   [options.scale]         Scene scale override.
 */
export function createPickController(options = {}) {
  const {
    getStarData,
    onPick,
    scale = SCALE,
  } = options;

  let toleranceDeg = options.toleranceDeg ?? 1.0;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  let highlightEl = null;
  let canvas = null;
  let pointerDownPos = null;
  let cleanupListeners = null;

  let latestCamera = null;
  let latestSize = null;
  let latestState = null;
  let pickedPosition = null;

  function runPick(ray, effectiveTolerance, event) {
    const starData = typeof getStarData === 'function' ? getStarData() : null;
    if (!starData) return;

    const fovRad = latestCamera?.isPerspectiveCamera
      ? THREE.MathUtils.degToRad(latestCamera.fov)
      : undefined;

    const pickScale = Number.isFinite(latestState?.starFieldScale) && latestState.starFieldScale > 0
      ? latestState.starFieldScale
      : scale;

    const t0 = performance.now();
    const result = pickStar(ray, starData, {
      scale: pickScale,
      toleranceDeg: effectiveTolerance,
      fovRad,
      viewportHeight: latestSize?.height ?? 800,
      magLimit: latestState?.mDesired ?? 6.5,
      exposure: latestState?.starFieldExposure ?? DEFAULT_TUNED_EXPOSURE,
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
      update2dHighlight(context.camera, context.size);
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
      highlightEl = null;
      canvas = null;
      pickedPosition = null;
      latestCamera = null;
      latestSize = null;
      latestState = null;
    },
  };
}
