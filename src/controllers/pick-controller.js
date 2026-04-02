import * as THREE from 'three';
import { pickStar } from '../services/star-picker.js';
import { SCALE } from '../services/octree/scene-scale.js';

const MAX_DRAG_DISTANCE_SQ = 25;

/**
 * Controller that wires pointer input to the star-picker algorithm and
 * manages a screen-space highlight ring over the selected star.
 *
 * Works as a viewer-runtime part (attach / update / dispose lifecycle).
 *
 * @param {Object} options
 * @param {Function} options.getStarData   () => starData from a StarFieldLayer.
 * @param {Function} [options.onPick]      Called with (result, event) on pick.
 * @param {number}   [options.toleranceDeg]  Angular search half-angle.
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
  const projVec = new THREE.Vector3();

  let highlightEl = null;
  let canvas = null;
  let pickedPosition = null;
  let pointerDownPos = null;
  let cleanupListeners = null;
  let latestCamera = null;
  let latestSize = null;
  let latestState = null;

  function handlePointerDown(event) {
    pointerDownPos = { x: event.clientX, y: event.clientY };
  }

  function handleClick(event) {
    if (!pointerDownPos || !latestCamera) return;
    const ddx = event.clientX - pointerDownPos.x;
    const ddy = event.clientY - pointerDownPos.y;
    if (ddx * ddx + ddy * ddy > MAX_DRAG_DISTANCE_SQ) return;

    const starData = typeof getStarData === 'function' ? getStarData() : null;
    if (!starData) return;

    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, latestCamera);

    const fovRad = latestCamera.isPerspectiveCamera
      ? THREE.MathUtils.degToRad(latestCamera.fov)
      : undefined;

    const t0 = performance.now();
    const result = pickStar(raycaster.ray, starData, {
      scale,
      toleranceDeg,
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

      if (!highlightEl || !pickedPosition) {
        if (highlightEl) highlightEl.style.display = 'none';
        return;
      }

      projVec.set(pickedPosition.x, pickedPosition.y, pickedPosition.z);
      projVec.project(context.camera);

      if (projVec.z > 1 || projVec.z < -1) {
        highlightEl.style.display = 'none';
        return;
      }

      const w = context.size.width;
      const h = context.size.height;
      const sx = (projVec.x * 0.5 + 0.5) * w;
      const sy = (-projVec.y * 0.5 + 0.5) * h;

      highlightEl.style.display = 'block';
      highlightEl.style.left = `${sx}px`;
      highlightEl.style.top = `${sy}px`;
    },

    setToleranceDeg(deg) {
      if (Number.isFinite(deg) && deg > 0) toleranceDeg = deg;
    },

    clearSelection() {
      pickedPosition = null;
      if (highlightEl) highlightEl.style.display = 'none';
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
