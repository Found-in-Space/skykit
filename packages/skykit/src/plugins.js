import * as THREE from 'three';

import { createObject3dLayer } from './layers.js';
import { createStreamingStarLayer } from './streaming-stars.js';
import {
  cloneVector3,
  finiteNumber,
  normalizeQuaternion,
  normalizeVector3,
  positiveFinite,
  IDENTITY_QUATERNION,
} from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 * @typedef {import('./index.d.ts').SkykitObject3dPlugin} SkykitObject3dPlugin
 * @typedef {import('./index.d.ts').SkykitStreamingStarsPlugin} SkykitStreamingStarsPlugin
 * @typedef {import('./index.d.ts').Object3dLayerOptions} Object3dLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayerOptions} StreamingStarLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayer} StreamingStarLayer
 * @typedef {import('./index.d.ts').SkykitKeyboardNavigationOptions} SkykitKeyboardNavigationOptions
 * @typedef {import('./index.d.ts').SkykitKeyboardNavigationBindingContext} SkykitKeyboardNavigationBindingContext
 * @typedef {import('./index.d.ts').SkykitDragLookOptions} SkykitDragLookOptions
 * @typedef {import('./index.d.ts').SkykitStatusPluginOptions} SkykitStatusPluginOptions
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

export const SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS = Object.freeze({
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyE: 'up',
  PageUp: 'up',
  KeyQ: 'down',
  PageDown: 'down',
});

const DEFAULT_BOOST_KEYS = Object.freeze(['ShiftLeft', 'ShiftRight', 'Shift']);

/**
 * @param {Partial<Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>>} [overrides]
 * @returns {Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>}
 */
export function createSkykitDefaultKeyboardNavigationBindings(overrides = {}) {
  return {
    ...SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS,
    ...overrides,
  };
}

/**
 * @param {Object3dLayerOptions} options
 * @returns {SkykitObject3dPlugin}
 */
export function createObject3dPlugin(options) {
  /** @type {SkykitThreePart | null} */
  let layer = null;
  const id = options?.id ?? 'object3d-plugin';
  return {
    id,
    setup(context) {
      layer = createObject3dLayer(options);
      context.addPart(layer);
    },
    getLayer() {
      return layer;
    },
    getSnapshot() {
      return layer?.getSnapshot?.() ?? { id, layer: null };
    },
  };
}

/**
 * @param {StreamingStarLayerOptions} options
 * @returns {SkykitStreamingStarsPlugin}
 */
export function createStreamingStarsPlugin(options) {
  /** @type {StreamingStarLayer | null} */
  let layer = null;
  const id = options?.id ?? 'streaming-stars-plugin';
  return {
    id,
    setup(context) {
      layer = createStreamingStarLayer(options);
      context.addPart(layer);
    },
    getLayer() {
      return layer;
    },
    getSnapshot() {
      return layer?.getSnapshot?.() ?? { id, layer: null };
    },
  };
}

/**
 * @param {SkykitKeyboardNavigationOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createKeyboardNavigationPlugin(options = {}) {
  const id = options.id ?? 'keyboard-navigation';
  const speedPcPerSec = positiveFinite(options.speedPcPerSec, 1);
  const rotationSpeedDegPerSec = positiveFinite(options.rotationSpeedDegPerSec, 60);
  const boostMultiplier = positiveFinite(options.boostMultiplier, 10);
  const bindings = /** @type {Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>} */ (
    options.bindings ?? SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS
  );
  const boostKeys = new Set(options.boostKeys ?? DEFAULT_BOOST_KEYS);
  const verticalMode = options.verticalMode ?? 'view';
  const pressed = new Set();
  let enabled = options.enabled !== false;
  let attached = false;
  /** @type {import('./index.d.ts').SkykitThreePluginContext | null} */
  let pluginContext = null;
  /** @type {EventTarget | null} */
  let activeTarget = null;
  /** @type {Vector3Like} */
  let lastVelocityPcPerSec = { x: 0, y: 0, z: 0 };

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    attach(context) {
      pluginContext = context;
      activeTarget = options.target ?? getDefaultEventTarget();
      activeTarget?.addEventListener?.('keydown', onKeyDown);
      activeTarget?.addEventListener?.('keyup', onKeyUp);
      attached = Boolean(activeTarget);
    },
    update(frame) {
      if (!enabled) return;
      const deltaSeconds = Math.max(0, finiteNumber(frame.deltaSeconds, 0));
      const boosted = isBoostPressed(pressed, boostKeys);
      const patch = /** @type {Partial<import('./index.d.ts').SkykitViewState>} */ ({});
      const movement = resolveMovementVector(frame.view.orientationIcrs, pressed, bindings, verticalMode);
      const length = Math.hypot(movement.x, movement.y, movement.z);
      if (length > 0) {
        const speed = speedPcPerSec * (boosted ? boostMultiplier : 1);
        const distance = speed * deltaSeconds;
        const unit = {
          x: movement.x / length,
          y: movement.y / length,
          z: movement.z / length,
        };
        patch.observerPc = {
          x: frame.view.observerPc.x + unit.x * distance,
          y: frame.view.observerPc.y + unit.y * distance,
          z: frame.view.observerPc.z + unit.z * distance,
        };
        lastVelocityPcPerSec = {
          x: unit.x * speed,
          y: unit.y * speed,
          z: unit.z * speed,
        };
      } else {
        lastVelocityPcPerSec = { x: 0, y: 0, z: 0 };
      }

      const rotation = resolveRotationInput(pressed, bindings);
      const rotationLength = Math.hypot(rotation.pitch, rotation.yaw, rotation.roll);
      if (rotationLength > 0) {
        const radiansPerSecond = (rotationSpeedDegPerSec * Math.PI) / 180;
        const angle = radiansPerSecond * (boosted ? boostMultiplier : 1) * deltaSeconds;
        patch.orientationIcrs = rotateOrientationByKeyboard(frame.view.orientationIcrs, {
          pitchRad: (rotation.pitch / rotationLength) * angle,
          yawRad: (rotation.yaw / rotationLength) * angle,
          rollRad: (rotation.roll / rotationLength) * angle,
        });
      }

      if (patch.observerPc || patch.orientationIcrs) {
        frame.viewer.requestViewState(patch, 'keyboard-navigation');
      }
    },
    detach() {
      activeTarget?.removeEventListener?.('keydown', onKeyDown);
      activeTarget?.removeEventListener?.('keyup', onKeyUp);
      activeTarget = null;
      pluginContext = null;
      attached = false;
      pressed.clear();
    },
    dispose() {
      this.detach?.();
    },
    getSnapshot,
  };

  return {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSnapshot,
  };

  /** @param {Event} event */
  function onKeyDown(event) {
    const key = getEventKey(event);
    if (!key) return;
    const binding = bindings[key];
    if (typeof binding === 'function') {
      pressed.delete(key);
      if (options.preventDefault !== false) event.preventDefault?.();
      void binding(createKeyboardBindingContext(key, event));
      return;
    }
    if (binding || boostKeys.has(key)) {
      pressed.add(key);
      if (options.preventDefault !== false) event.preventDefault?.();
    }
  }

  /** @param {Event} event */
  function onKeyUp(event) {
    const key = getEventKey(event);
    if (!key) return;
    pressed.delete(key);
    if (bindings[key] || boostKeys.has(key)) {
      if (options.preventDefault !== false) event.preventDefault?.();
    }
  }

  /**
   * @param {string} key
   * @param {Event} event
   * @returns {SkykitKeyboardNavigationBindingContext}
   */
  function createKeyboardBindingContext(key, event) {
    if (!pluginContext) {
      throw new Error('Keyboard binding callback fired before the keyboard plugin was attached.');
    }
    const context = pluginContext;
    return {
      key,
      event,
      context,
      viewer: context.viewer,
      getViewState() {
        return context.getViewState();
      },
      requestViewState(patch, reason = 'keyboard-navigation') {
        context.requestViewState(patch, reason);
      },
    };
  }

  function getSnapshot() {
    return {
      id,
      enabled,
      attached,
      pressed: Array.from(pressed),
      speedPcPerSec,
      rotationSpeedDegPerSec,
      boostMultiplier,
      verticalMode,
      lastVelocityPcPerSec: cloneVector3(lastVelocityPcPerSec),
    };
  }

  /**
   * @param {boolean} nextEnabled
   */
  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) pressed.clear();
  }

  // Expose a tiny imperative seam for lessons/tests without introducing a registry.
  Object.assign(part, { setEnabled });
}

/**
 * @param {SkykitDragLookOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkyGrabPlugin(options = {}) {
  return createDragLookPlugin({
    ...options,
    id: options.id ?? 'sky-grab',
    dragMode: 'grab',
  });
}

/**
 * @param {SkykitDragLookOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createMouseLookPlugin(options = {}) {
  return createDragLookPlugin({
    ...options,
    id: options.id ?? 'mouse-look',
    dragMode: 'look',
  });
}

/**
 * @param {SkykitDragLookOptions & { dragMode: 'grab' | 'look' }} options
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
function createDragLookPlugin(options) {
  const id = options.id ?? 'drag-look';
  const sensitivityRadiansPerPixel = positiveFinite(options.sensitivityRadiansPerPixel, 0.0009);
  const pitchLimitRad = Math.min(
    Math.max((positiveFinite(options.pitchLimitDeg, 89) * Math.PI) / 180, 0),
    Math.PI / 2 - 1e-4,
  );
  const button = Number.isInteger(options.button) ? Number(options.button) : 0;
  let enabled = options.enabled !== false;
  let dragging = false;
  let attached = false;
  let pointerId = /** @type {number | null} */ (null);
  /** @type {import('./index.d.ts').QuaternionLike} */
  let orientation = { ...IDENTITY_QUATERNION };
  let yawRad = 0;
  let pitchRad = 0;
  let lastClientX = /** @type {number | null} */ (null);
  let lastClientY = /** @type {number | null} */ (null);
  /** @type {EventTarget | null} */
  let activeTarget = null;
  /** @type {import('./index.d.ts').SkykitViewer | null} */
  let viewer = null;

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    attach(context) {
      viewer = context.viewer;
      syncAnglesFromOrientation(context.getViewState().orientationIcrs);
      activeTarget = options.target ?? getDefaultEventTarget();
      activeTarget?.addEventListener?.('pointerdown', onPointerDown);
      activeTarget?.addEventListener?.('pointermove', onPointerMove);
      activeTarget?.addEventListener?.('pointerup', onPointerUp);
      activeTarget?.addEventListener?.('pointercancel', onPointerUp);
      attached = Boolean(activeTarget);
    },
    setView(view) {
      if (!dragging) syncAnglesFromOrientation(view.orientationIcrs);
    },
    detach() {
      activeTarget?.removeEventListener?.('pointerdown', onPointerDown);
      activeTarget?.removeEventListener?.('pointermove', onPointerMove);
      activeTarget?.removeEventListener?.('pointerup', onPointerUp);
      activeTarget?.removeEventListener?.('pointercancel', onPointerUp);
      activeTarget = null;
      viewer = null;
      pointerId = null;
      lastClientX = null;
      lastClientY = null;
      dragging = false;
      attached = false;
    },
    dispose() {
      this.detach?.();
    },
    getSnapshot,
  };

  return {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSnapshot,
  };

  /** @param {Event} event */
  function onPointerDown(event) {
    if (!enabled) return;
    const pointerEvent = /** @type {{ button?: unknown; pointerId?: unknown; clientX?: unknown; clientY?: unknown; preventDefault?: () => void; currentTarget?: unknown }} */ (event);
    if (Number(pointerEvent.button ?? 0) !== button) return;
    syncAnglesFromOrientation(viewer?.getViewState().orientationIcrs);
    dragging = true;
    pointerId = Number.isFinite(Number(pointerEvent.pointerId)) ? Number(pointerEvent.pointerId) : null;
    lastClientX = Number.isFinite(Number(pointerEvent.clientX)) ? Number(pointerEvent.clientX) : null;
    lastClientY = Number.isFinite(Number(pointerEvent.clientY)) ? Number(pointerEvent.clientY) : null;
    const captureTarget = /** @type {{ setPointerCapture?: (pointerId: number) => void }} */ (pointerEvent.currentTarget ?? activeTarget);
    if (pointerId != null) captureTarget.setPointerCapture?.(pointerId);
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  /** @param {Event} event */
  function onPointerMove(event) {
    if (!enabled || !dragging || !viewer) return;
    const pointerEvent = /** @type {{ pointerId?: unknown; clientX?: unknown; clientY?: unknown; movementX?: unknown; movementY?: unknown; preventDefault?: () => void }} */ (event);
    const eventPointerId = Number(pointerEvent.pointerId);
    if (pointerId != null && Number.isFinite(eventPointerId) && eventPointerId !== pointerId) return;
    const clientX = Number(pointerEvent.clientX);
    const clientY = Number(pointerEvent.clientY);
    let movementX = finiteNumber(pointerEvent.movementX, 0);
    let movementY = finiteNumber(pointerEvent.movementY, 0);
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      movementX = lastClientX == null ? 0 : clientX - lastClientX;
      movementY = lastClientY == null ? 0 : clientY - lastClientY;
      lastClientX = clientX;
      lastClientY = clientY;
    }
    if (movementX === 0 && movementY === 0) return;
    const dragSign = options.dragMode === 'look' ? -1 : 1;
    orientation = rotateOrientationInScreenSpace(
      orientation,
      movementX * sensitivityRadiansPerPixel * dragSign,
      movementY * sensitivityRadiansPerPixel * dragSign,
    );
    syncAnglesFromOrientation(orientation);
    viewer.requestViewState({ orientationIcrs: orientation }, id);
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  /** @param {Event} event */
  function onPointerUp(event) {
    const pointerEvent = /** @type {{ pointerId?: unknown; preventDefault?: () => void; currentTarget?: unknown }} */ (event);
    const eventPointerId = Number(pointerEvent.pointerId);
    if (pointerId != null && Number.isFinite(eventPointerId) && eventPointerId !== pointerId) return;
    const captureTarget = /** @type {{ releasePointerCapture?: (pointerId: number) => void }} */ (pointerEvent.currentTarget ?? activeTarget);
    if (pointerId != null) captureTarget.releasePointerCapture?.(pointerId);
    pointerId = null;
    lastClientX = null;
    lastClientY = null;
    dragging = false;
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  function getSnapshot() {
    return {
      id,
      enabled,
      attached,
      dragging,
      yawRad,
      pitchRad,
      sensitivityRadiansPerPixel,
      pitchLimitDeg: (pitchLimitRad * 180) / Math.PI,
    };
  }

  /** @param {boolean} nextEnabled */
  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      pointerId = null;
      lastClientX = null;
      lastClientY = null;
      dragging = false;
    }
  }

  /** @param {import('./index.d.ts').QuaternionLike | null | undefined} nextOrientation */
  function syncAnglesFromOrientation(nextOrientation) {
    const q = normalizeQuaternion(nextOrientation, IDENTITY_QUATERNION);
    orientation = q;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      new THREE.Quaternion(q.x, q.y, q.z, q.w),
    );
    yawRad = -Math.atan2(forward.x, -forward.z);
    pitchRad = Math.min(
      Math.max(Math.asin(Math.min(Math.max(forward.y, -1), 1)), -pitchLimitRad),
      pitchLimitRad,
    );
  }

  Object.assign(part, { setEnabled });
}

/**
 * @param {SkykitStatusPluginOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitStatusPlugin(options = {}) {
  const id = options.id ?? 'skykit-status';
  const intervalSeconds = Math.max(0, finiteNumber(options.intervalSeconds, 0));
  let elapsedSinceRender = 0;
  let renderCount = 0;
  /** @type {{ viewerId?: string; viewRevision?: number } | null} */
  let lastSummary = null;

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    start(context) {
      renderStatus(context.viewer.getSnapshot(), context.getViewState());
    },
    update(frame) {
      elapsedSinceRender += Math.max(0, finiteNumber(frame.deltaSeconds, 0));
      if (elapsedSinceRender < intervalSeconds) return;
      elapsedSinceRender = 0;
      renderStatus(frame.viewer.getSnapshot(), frame.view);
    },
    getSnapshot,
  };

  return {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSnapshot,
  };

  /**
   * @param {import('./index.d.ts').SkykitViewerSnapshot} viewerSnapshot
   * @param {import('./index.d.ts').SkykitViewState} view
   */
  function renderStatus(viewerSnapshot, view) {
    const payload = { viewer: viewerSnapshot, view };
    lastSummary = {
      viewerId: viewerSnapshot.id,
      viewRevision: view.revision,
    };
    renderCount += 1;
    if (typeof options.render === 'function') {
      options.render(payload);
    } else if (options.target && 'textContent' in options.target) {
      options.target.textContent = JSON.stringify(viewerSnapshot, null, 2);
    }
  }

  function getSnapshot() {
    return {
      id,
      renderCount,
      lastSummary,
    };
  }
}

function getDefaultEventTarget() {
  return typeof globalThis.addEventListener === 'function' ? globalThis : null;
}

/** @param {Event} event */
function getEventKey(event) {
  const keyboardEvent = /** @type {{ code?: unknown; key?: unknown }} */ (event);
  const code = typeof keyboardEvent.code === 'string' ? keyboardEvent.code : '';
  const key = typeof keyboardEvent.key === 'string' ? keyboardEvent.key : '';
  return code || key || null;
}

/**
 * @param {import('./index.d.ts').QuaternionLike | null | undefined} orientation
 * @param {Set<string>} pressed
 * @param {Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>} bindings
 * @param {'view' | 'world'} verticalMode
 * @returns {Vector3Like}
 */
function resolveMovementVector(orientation, pressed, bindings, verticalMode) {
  const q = normalizeQuaternion(orientation, IDENTITY_QUATERNION);
  const quaternion = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = verticalMode === 'world'
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const movement = new THREE.Vector3();
  for (const key of pressed) {
    const action = bindings[key];
    if (action === 'forward') movement.add(forward);
    if (action === 'back') movement.sub(forward);
    if (action === 'right') movement.add(right);
    if (action === 'left') movement.sub(right);
    if (action === 'up') movement.add(up);
    if (action === 'down') movement.sub(up);
  }
  return normalizeVector3(movement, { x: 0, y: 0, z: 0 });
}

/**
 * @param {Set<string>} pressed
 * @param {Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>} bindings
 * @returns {{ pitch: number; yaw: number; roll: number }}
 */
function resolveRotationInput(pressed, bindings) {
  const rotation = { pitch: 0, yaw: 0, roll: 0 };
  for (const key of pressed) {
    const action = bindings[key];
    if (action === 'pitchUp') rotation.pitch += 1;
    if (action === 'pitchDown') rotation.pitch -= 1;
    if (action === 'yawLeft') rotation.yaw += 1;
    if (action === 'yawRight') rotation.yaw -= 1;
    if (action === 'rollClockwise') rotation.roll += 1;
    if (action === 'rollAnticlockwise') rotation.roll -= 1;
  }
  return rotation;
}

/**
 * @param {Set<string>} pressed
 * @param {Set<string>} boostKeys
 */
function isBoostPressed(pressed, boostKeys) {
  for (const key of boostKeys) {
    if (pressed.has(key)) return true;
  }
  return false;
}

/**
 * @param {import('./index.d.ts').QuaternionLike | null | undefined} orientation
 * @param {{ pitchRad: number; yawRad: number; rollRad: number }} input
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function rotateOrientationByKeyboard(orientation, input) {
  let next = rotateOrientationInScreenSpace(
    normalizeQuaternion(orientation, IDENTITY_QUATERNION),
    input.yawRad,
    input.pitchRad,
  );
  if (input.rollRad !== 0) {
    const forward = normalizeVector3(rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, next), { x: 0, y: 0, z: -1 });
    const roll = quaternionFromAxisAngle(forward, input.rollRad);
    next = normalizeQuaternion(multiplyQuaternions(roll, next), IDENTITY_QUATERNION);
  }
  return next;
}

/**
 * @param {import('./index.d.ts').QuaternionLike} orientation
 * @param {number} horizontalRad
 * @param {number} verticalRad
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function rotateOrientationInScreenSpace(orientation, horizontalRad, verticalRad) {
  const current = normalizeQuaternion(orientation, IDENTITY_QUATERNION);
  const localRight = normalizeVector3(rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, current), { x: 1, y: 0, z: 0 });
  const localUp = normalizeVector3(rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, current), { x: 0, y: 1, z: 0 });
  const horizontal = quaternionFromAxisAngle(localUp, horizontalRad);
  const vertical = quaternionFromAxisAngle(localRight, verticalRad);
  return normalizeQuaternion(
    multiplyQuaternions(vertical, multiplyQuaternions(horizontal, current)),
    IDENTITY_QUATERNION,
  );
}

/**
 * @param {Vector3Like} axis
 * @param {number} angleRad
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function quaternionFromAxisAngle(axis, angleRad) {
  const length = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const halfAngle = angleRad / 2;
  const s = Math.sin(halfAngle);
  return {
    x: (axis.x / length) * s,
    y: (axis.y / length) * s,
    z: (axis.z / length) * s,
    w: Math.cos(halfAngle),
  };
}

/**
 * @param {import('./index.d.ts').QuaternionLike} a
 * @param {import('./index.d.ts').QuaternionLike} b
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function multiplyQuaternions(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * @param {Vector3Like} vector
 * @param {import('./index.d.ts').QuaternionLike} q
 * @returns {Vector3Like}
 */
function rotateVectorByQuaternion(vector, q) {
  const qVector = { x: vector.x, y: vector.y, z: vector.z, w: 0 };
  const inverse = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const rotated = multiplyQuaternions(multiplyQuaternions(q, qVector), inverse);
  return { x: rotated.x, y: rotated.y, z: rotated.z };
}
