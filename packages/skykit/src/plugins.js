import * as THREE from 'three';

import { createObject3dLayer } from './layers.js';
import { createStreamingStarLayer } from './streaming-stars.js';
import { cloneVector3, finiteNumber, normalizeQuaternion, normalizeVector3, positiveFinite, IDENTITY_QUATERNION } from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 * @typedef {import('./index.d.ts').SkykitObject3dPlugin} SkykitObject3dPlugin
 * @typedef {import('./index.d.ts').SkykitStreamingStarsPlugin} SkykitStreamingStarsPlugin
 * @typedef {import('./index.d.ts').Object3dLayerOptions} Object3dLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayerOptions} StreamingStarLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayer} StreamingStarLayer
 * @typedef {import('./index.d.ts').SkykitKeyboardNavigationOptions} SkykitKeyboardNavigationOptions
 * @typedef {import('./index.d.ts').SkykitStatusPluginOptions} SkykitStatusPluginOptions
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

const DEFAULT_KEY_BINDINGS = Object.freeze({
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
  const boostMultiplier = positiveFinite(options.boostMultiplier, 10);
  const bindings = /** @type {Record<string, string>} */ ({ ...DEFAULT_KEY_BINDINGS, ...(options.bindings ?? {}) });
  const boostKeys = new Set(options.boostKeys ?? DEFAULT_BOOST_KEYS);
  const pressed = new Set();
  let enabled = options.enabled !== false;
  let attached = false;
  /** @type {EventTarget | null} */
  let activeTarget = null;
  /** @type {Vector3Like} */
  let lastVelocityPcPerSec = { x: 0, y: 0, z: 0 };

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    attach() {
      activeTarget = options.target ?? getDefaultEventTarget();
      activeTarget?.addEventListener?.('keydown', onKeyDown);
      activeTarget?.addEventListener?.('keyup', onKeyUp);
      attached = Boolean(activeTarget);
    },
    update(frame) {
      if (!enabled) return;
      const movement = resolveMovementVector(frame.view.orientationIcrs, pressed, bindings);
      const length = Math.hypot(movement.x, movement.y, movement.z);
      if (length <= 0) {
        lastVelocityPcPerSec = { x: 0, y: 0, z: 0 };
        return;
      }
      const boosted = isBoostPressed(pressed, boostKeys);
      const speed = speedPcPerSec * (boosted ? boostMultiplier : 1);
      const distance = speed * Math.max(0, finiteNumber(frame.deltaSeconds, 0));
      const unit = {
        x: movement.x / length,
        y: movement.y / length,
        z: movement.z / length,
      };
      const observerPc = {
        x: frame.view.observerPc.x + unit.x * distance,
        y: frame.view.observerPc.y + unit.y * distance,
        z: frame.view.observerPc.z + unit.z * distance,
      };
      lastVelocityPcPerSec = {
        x: unit.x * speed,
        y: unit.y * speed,
        z: unit.z * speed,
      };
      frame.viewer.requestViewState({ observerPc }, 'keyboard-navigation');
    },
    detach() {
      activeTarget?.removeEventListener?.('keydown', onKeyDown);
      activeTarget?.removeEventListener?.('keyup', onKeyUp);
      activeTarget = null;
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
    if (bindings[key] || boostKeys.has(key)) {
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

  function getSnapshot() {
    return {
      id,
      enabled,
      attached,
      pressed: Array.from(pressed),
      speedPcPerSec,
      boostMultiplier,
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
 * @param {Record<string, string>} bindings
 * @returns {Vector3Like}
 */
function resolveMovementVector(orientation, pressed, bindings) {
  const q = normalizeQuaternion(orientation, IDENTITY_QUATERNION);
  const quaternion = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0);
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
 * @param {Set<string>} boostKeys
 */
function isBoostPressed(pressed, boostKeys) {
  for (const key of boostKeys) {
    if (pressed.has(key)) return true;
  }
  return false;
}
