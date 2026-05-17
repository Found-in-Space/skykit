import {
  addVectors,
  applyQuaternion,
  cloneVector3,
  computeSpatialLookAtOrientation,
  IDENTITY_QUATERNION,
  LOCAL_FORWARD,
  LOCAL_RIGHT,
  LOCAL_UP,
  normalizeDirection,
  normalizeQuaternion,
  normalizeVector3,
  scaleVector,
  subtractVectors,
  vectorLength,
} from '@found-in-space/spatial';

import { SKYKIT_ACTIONS, SKYKIT_CONTROLS } from './actions.js';
import { finiteNumber, positiveFinite } from './utils.js';

/** @typedef {import('./index.d.ts').SkykitThreePluginContext} SkykitThreePluginContext */
/** @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart */
/** @typedef {import('./index.d.ts').Vector3Like} Vector3Like */
/** @typedef {import('./index.d.ts').QuaternionLike} QuaternionLike */
/** @typedef {import('./parallax.d.ts').ParallaxOffsetControlValue} ParallaxOffsetControlValue */
/** @typedef {import('./parallax.d.ts').ParallaxOffsetInputPluginOptions} ParallaxOffsetInputPluginOptions */
/** @typedef {import('./parallax.d.ts').ParallaxObserverPluginOptions} ParallaxObserverPluginOptions */
/** @typedef {import('./parallax.d.ts').DeviceTiltTrackerOptions} DeviceTiltTrackerOptions */
/** @typedef {import('./parallax.d.ts').DeviceTiltTracker} DeviceTiltTracker */

const DEFAULT_PARALLAX_CONTROL = SKYKIT_CONTROLS.observer.parallaxOffset;
const DEFAULT_TILT_RESPONSE_DEG = 18;
const DEFAULT_TILT_DEADZONE = 0.025;
const EPSILON = 1e-9;

/**
 * Turns browser input into a semantic SkyKit parallax control.
 *
 * @param {ParallaxOffsetInputPluginOptions} [options]
 */
export function createParallaxOffsetInputPlugin(options = {}) {
  const id = options.id ?? 'parallax-offset-input';
  const controlId = options.controlId ?? DEFAULT_PARALLAX_CONTROL;
  const pointer = normalizePointerOptions(options.pointer, options.target);
  const tilt = normalizeTiltOptions(options.tilt);
  /** @type {ParallaxOffsetControlValue} */
  let value = { x: 0, y: 0, source: null, active: false };
  /** @type {DeviceTiltTracker | null} */
  let tiltTracker = null;
  let pointerActive = false;
  let pointerId = null;
  let attached = false;
  let disposed = false;
  let writes = 0;

  return {
    id,
    setup(context) {
      attached = true;
      /** @type {Array<() => void>} */
      const teardowns = [];
      const inputTarget = pointer.target ?? options.target ?? resolveGlobalEventTarget();

      if (pointer.enabled && inputTarget && typeof inputTarget.addEventListener === 'function') {
        teardowns.push(...attachPointerListeners(inputTarget, pointer, {
          onPointerDown(event) {
            if (pointer.mode === 'hover') return;
            pointerActive = true;
            pointerId = pointerEventId(event);
            writeControl(context, pointerPointToValue(event, inputTarget, pointer), 'pointer-drag', true);
          },
          onPointerMove(event) {
            if (pointer.mode === 'drag' && !pointerActive) return;
            if (pointerActive && pointerId != null && pointerEventId(event) != null && pointerEventId(event) !== pointerId) return;
            writeControl(context, pointerPointToValue(event, inputTarget, pointer), pointerActive ? 'pointer-drag' : 'pointer-hover', true);
          },
          onPointerEnd() {
            pointerActive = false;
            pointerId = null;
            if (pointer.resetOnRelease) writeControl(context, { x: 0, y: 0 }, 'pointer-release', false);
          },
          onPointerLeave() {
            if (pointer.mode === 'drag' && pointerActive) return;
            if (pointer.resetOnLeave) writeControl(context, { x: 0, y: 0 }, 'pointer-leave', false);
          },
        }));
      }

      const unregisterRecenter = context.actions.registerAction(SKYKIT_ACTIONS.observer.recenterParallax, () => {
        tiltTracker?.recenter();
        writeControl(context, { x: 0, y: 0 }, 'recenter', false);
        return getSnapshot();
      }, {
        label: 'Recenter parallax input',
      });
      teardowns.push(unregisterRecenter);

      if (tilt.enabled) {
        const ensureTiltTracker = () => {
          if (!tiltTracker) {
            tiltTracker = createDeviceTiltTracker({
              ...tilt.trackerOptions,
              onUpdate(update) {
                if (!update.enabled) {
                  writeControl(context, { x: 0, y: 0 }, 'tilt', false);
                  return;
                }
                writeControl(context, { x: update.x, y: update.y }, 'tilt', update.active);
                tilt.trackerOptions.onUpdate?.(update);
              },
            });
          }
          return tiltTracker;
        };

        const unregisterEnableTilt = context.actions.registerAction(SKYKIT_ACTIONS.observer.enableParallaxTilt, async () => {
          const result = await ensureTiltTracker().enable();
          if (!result.ok) writeControl(context, { x: 0, y: 0 }, 'tilt', false);
          return result;
        }, {
          label: 'Enable parallax tilt',
        });
        teardowns.push(unregisterEnableTilt);

        if (tilt.autoEnable) {
          void ensureTiltTracker().enable();
        }
      }

      function teardown() {
        if (disposed) return;
        disposed = true;
        for (const teardownListener of teardowns.splice(0).reverse()) teardownListener();
        tiltTracker?.dispose();
        tiltTracker = null;
        writeControl(context, { x: 0, y: 0 }, 'dispose', false);
        attached = false;
      }

      return teardown;
    },
    getSnapshot,
  };

  /**
   * @param {SkykitThreePluginContext} context
   * @param {{ x: number; y: number }} offset
   * @param {string} source
   * @param {boolean} active
   */
  function writeControl(context, offset, source, active) {
    const next = {
      x: clampFinite(offset.x, -1, 1),
      y: clampFinite(offset.y, -1, 1),
      source,
      active,
    };
    if (
      value.x === next.x
      && value.y === next.y
      && value.source === next.source
      && value.active === next.active
    ) {
      return;
    }
    value = next;
    writes += 1;
    context.actions.setControlValue(controlId, { ...value }, { source: id, input: 'parallax', mode: source });
  }

  function getSnapshot() {
    return {
      id,
      attached,
      disposed,
      controlId,
      writes,
      reads: [],
      pointer: {
        enabled: pointer.enabled,
        mode: pointer.mode,
        active: pointerActive,
      },
      tilt: {
        enabled: tilt.enabled,
        active: tiltTracker?.getSnapshot().enabled ?? false,
        supported: tiltTracker?.getSnapshot().supported ?? null,
      },
      value: { ...value },
    };
  }
}

/**
 * Reads a semantic parallax control and applies a target-locked observer offset.
 *
 * @param {ParallaxObserverPluginOptions} [options]
 */
export function createParallaxObserverPlugin(options = {}) {
  const id = options.id ?? 'parallax-observer';
  const controlId = options.controlId ?? DEFAULT_PARALLAX_CONTROL;
  const offsetPc = positiveFinite(options.offsetPc, 1);
  const smoothing = clampFinite(options.smoothing ?? 0.18, 0, 1);
  const lockTarget = options.lockTarget !== false;
  const upReference = normalizeDirectionOrFallback(options.upIcrs, LOCAL_UP);
  let enabled = options.enabled !== false;
  let disposed = false;
  let attached = false;
  let reads = 0;
  let writes = 0;
  /** @type {Vector3Like | null} */
  let anchorObserverPc = null;
  /** @type {Vector3Like | null} */
  let currentTargetPc = null;
  /** @type {{ x: number; y: number }} */
  let currentOffset = { x: 0, y: 0 };
  /** @type {Vector3Like | null} */
  let lastObserverPc = null;
  /** @type {QuaternionLike | null} */
  let lastOrientationIcrs = null;
  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    attach(context) {
      attached = true;
      const view = context.getViewState();
      anchorObserverPc = normalizeVector3(options.anchorObserverPc ?? view.observerPc, view.observerPc);
      currentTargetPc = resolveTargetPc(options, view, anchorObserverPc);
    },
    update(frame) {
      if (disposed || !enabled || !anchorObserverPc) return;
      const view = frame.view;
      currentTargetPc = resolveTargetPc(options, view, anchorObserverPc);
      const control = normalizeParallaxControl(frame.viewer.actions.getControlValue(controlId));
      reads += 1;
      const desiredOffset = control.active ? { x: control.x, y: control.y } : { x: 0, y: 0 };
      const blend = resolveFrameBlend(smoothing, frame.deltaSeconds);
      currentOffset = {
        x: lerp(currentOffset.x, desiredOffset.x, blend),
        y: lerp(currentOffset.y, desiredOffset.y, blend),
      };
      if (Math.abs(currentOffset.x) < 1e-6) currentOffset.x = 0;
      if (Math.abs(currentOffset.y) < 1e-6) currentOffset.y = 0;

      const basis = createTargetPlaneBasis(anchorObserverPc, currentTargetPc, upReference);
      const observerPc = addVectors(
        anchorObserverPc,
        addVectors(
          scaleVector(basis.right, currentOffset.x * offsetPc),
          scaleVector(basis.up, currentOffset.y * offsetPc),
        ),
      );
      /** @type {Partial<import('./index.d.ts').SkykitViewState>} */
      const patch = {};
      if (!sameVector(view.observerPc, observerPc) && !sameVector(lastObserverPc, observerPc)) {
        patch.observerPc = observerPc;
      }
      if (currentTargetPc && !sameVector(view.targetPc, currentTargetPc)) {
        patch.targetPc = currentTargetPc;
      }
      if (lockTarget && currentTargetPc) {
        const orientation = computeSpatialLookAtOrientation({
          position: observerPc,
          target: currentTargetPc,
          up: basis.up,
        });
        if (orientation && !sameQuaternion(view.orientationIcrs, orientation) && !sameQuaternion(lastOrientationIcrs, orientation)) {
          patch.orientationIcrs = orientation;
          lastOrientationIcrs = orientation;
        }
      }
      if (Object.keys(patch).length > 0) {
        lastObserverPc = observerPc;
        writes += 1;
        frame.viewer.requestViewState(patch, id);
      }
    },
    detach() {
      attached = false;
    },
    dispose() {
      disposed = true;
      attached = false;
    },
    getSnapshot,
  };

  return {
    id,
    setup(context) {
      const unregisterRecenter = context.actions.registerAction(SKYKIT_ACTIONS.observer.recenterParallax, () => {
        currentOffset = { x: 0, y: 0 };
        lastObserverPc = null;
        lastOrientationIcrs = null;
        return getSnapshot();
      }, {
        label: 'Recenter parallax observer',
        priority: -10,
      });
      context.addPart(part);
      return () => {
        unregisterRecenter();
      };
    },
    getSnapshot,
  };

  function getSnapshot() {
    return {
      id,
      attached,
      disposed,
      enabled,
      reads,
      writes,
      controlId,
      readsFrom: [controlId],
      writesTo: lockTarget ? ['observerPc', 'targetPc', 'orientationIcrs'] : ['observerPc', 'targetPc'],
      offsetPc,
      smoothing,
      lockTarget,
      currentOffset: { ...currentOffset },
      anchorObserverPc: anchorObserverPc ? cloneVector3(anchorObserverPc) : null,
      targetPc: currentTargetPc ? cloneVector3(currentTargetPc) : null,
    };
  }
}

/**
 * Small browser/device tilt seam used by the parallax input plugin and tests.
 *
 * @param {DeviceTiltTrackerOptions} [options]
 * @returns {DeviceTiltTracker}
 */
export function createDeviceTiltTracker(options = {}) {
  const id = options.id ?? 'device-tilt-tracker';
  const eventTarget = options.eventTarget ?? resolveGlobalEventTarget();
  const responseXDeg = positiveFinite(options.xResponseDeg ?? options.responseDeg, DEFAULT_TILT_RESPONSE_DEG);
  const responseYDeg = positiveFinite(options.yResponseDeg ?? options.responseDeg, DEFAULT_TILT_RESPONSE_DEG);
  const deadzone = Math.max(0, finiteNumber(options.deadzone, DEFAULT_TILT_DEADZONE));
  const invertX = options.invertX === true;
  const invertY = options.invertY === true;
  const supported = Boolean(eventTarget && typeof eventTarget.addEventListener === 'function');
  let enabled = options.enabled === true;
  let disposed = false;
  let calibrated = false;
  /** @type {{ beta: number; gamma: number; screenAngleDeg: number } | null} */
  let baseline = null;
  /** @type {ParallaxOffsetControlValue} */
  let value = { x: 0, y: 0, source: 'tilt', active: false };
  let eventCount = 0;
  let updateCount = 0;
  /** @type {Array<() => void>} */
  const teardowns = [];

  if (enabled) attach();

  return {
    id,
    async enable() {
      if (disposed) return { ok: false, reason: 'disposed' };
      if (!supported) return { ok: false, reason: 'unsupported' };
      const permission = await requestTiltPermission(options);
      if (!permission.ok) return permission;
      enabled = true;
      attach();
      return { ok: true, reason: permission.reason };
    },
    disable() {
      enabled = false;
      for (const teardown of teardowns.splice(0).reverse()) teardown();
      updateValue(0, 0, false);
    },
    recenter() {
      baseline = null;
      calibrated = false;
      updateValue(0, 0, false);
    },
    handleDeviceOrientation(event) {
      handleDeviceOrientation(event);
    },
    getSnapshot() {
      return {
        id,
        supported,
        enabled,
        disposed,
        calibrated,
        eventCount,
        updateCount,
        value: { ...value },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      for (const teardown of teardowns.splice(0).reverse()) teardown();
    },
  };

  function attach() {
    if (!eventTarget || teardowns.length > 0 || !enabled) return;
    const listener = (/** @type {Event} */ event) => handleDeviceOrientation(event);
    eventTarget.addEventListener?.('deviceorientation', listener);
    teardowns.push(() => eventTarget.removeEventListener?.('deviceorientation', listener));
  }

  /** @param {unknown} event */
  function handleDeviceOrientation(event) {
    if (!enabled || disposed) return;
    const orientationEvent = /** @type {{ beta?: unknown; gamma?: unknown }} */ (event);
    const beta = Number(orientationEvent.beta);
    const gamma = Number(orientationEvent.gamma);
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    eventCount += 1;
    const screenAngleDeg = normalizeScreenAngle(options.screenSource);
    if (!baseline || Math.abs(screenAngleDeg - baseline.screenAngleDeg) > 0.1) {
      baseline = { beta, gamma, screenAngleDeg };
      calibrated = true;
      updateValue(0, 0, false);
      return;
    }

    const deltaBeta = beta - baseline.beta;
    const deltaGamma = gamma - baseline.gamma;
    const screenRad = screenAngleDeg * Math.PI / 180;
    const cos = Math.cos(screenRad);
    const sin = Math.sin(screenRad);
    let x = (deltaGamma * cos + deltaBeta * sin) / responseXDeg;
    let y = (deltaBeta * cos - deltaGamma * sin) / responseYDeg;
    if (invertX) x *= -1;
    if (invertY) y *= -1;
    updateValue(applyDeadzone(clampFinite(x, -1, 1), deadzone), applyDeadzone(clampFinite(y, -1, 1), deadzone), true);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} active
   */
  function updateValue(x, y, active) {
    value = { x, y, source: 'tilt', active: active && (Math.abs(x) > 0 || Math.abs(y) > 0) };
    updateCount += 1;
    options.onUpdate?.({
      ...value,
      enabled,
      calibrated,
      eventCount,
      updateCount,
    });
  }
}

/**
 * @param {unknown} pointerOption
 * @param {unknown} target
 */
function normalizePointerOptions(pointerOption, target) {
  if (pointerOption === false) {
    return {
      enabled: false,
      mode: /** @type {'hover'} */ ('hover'),
      target: null,
      resetOnLeave: true,
      resetOnRelease: true,
      invertX: false,
      invertY: false,
      preventDefault: false,
    };
  }
  const input = pointerOption && typeof pointerOption === 'object'
    ? /** @type {import('./parallax.d.ts').ParallaxPointerInputOptions} */ (pointerOption)
    : {};
  const mode = input.mode === 'drag' || input.mode === 'both' || input.mode === 'hover' ? input.mode : 'hover';
  return {
    enabled: input.enabled !== false,
    mode,
    target: input.target ?? target ?? null,
    resetOnLeave: input.resetOnLeave !== false,
    resetOnRelease: input.resetOnRelease !== false,
    invertX: input.invertX === true,
    invertY: input.invertY === true,
    preventDefault: input.preventDefault === true,
  };
}

/** @param {unknown} tiltOption */
function normalizeTiltOptions(tiltOption) {
  if (!tiltOption) {
    return { enabled: false, autoEnable: false, trackerOptions: /** @type {DeviceTiltTrackerOptions} */ ({}) };
  }
  const input = tiltOption === true ? {} : /** @type {DeviceTiltTrackerOptions & { enabled?: boolean; autoEnable?: boolean }} */ (tiltOption);
  const { enabled: _enabled, autoEnable, ...trackerOptions } = input;
  return {
    enabled: input.enabled !== false,
    autoEnable: autoEnable === true,
    trackerOptions,
  };
}

/**
 * @param {EventTarget & { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number }; clientWidth?: number; clientHeight?: number }} target
 * @param {ReturnType<typeof normalizePointerOptions>} options
 * @param {{ onPointerDown(event: unknown): void; onPointerMove(event: unknown): void; onPointerEnd(event: unknown): void; onPointerLeave(event: unknown): void }} handlers
 */
function attachPointerListeners(target, options, handlers) {
  /** @type {Array<() => void>} */
  const teardowns = [];
  const add = (/** @type {string} */ type, /** @type {(event: Event) => void} */ listener) => {
    target.addEventListener(type, listener, { passive: !options.preventDefault });
    teardowns.push(() => target.removeEventListener?.(type, listener));
  };
  add('pointerdown', (event) => {
    maybePreventDefault(event, options);
    handlers.onPointerDown(event);
  });
  add('pointermove', (event) => {
    maybePreventDefault(event, options);
    handlers.onPointerMove(event);
  });
  add('pointerup', () => handlers.onPointerEnd({}));
  add('pointercancel', () => handlers.onPointerEnd({}));
  add('pointerleave', () => handlers.onPointerLeave({}));
  add('touchstart', (event) => {
    maybePreventDefault(event, options);
    handlers.onPointerDown(firstTouch(event));
  });
  add('touchmove', (event) => {
    maybePreventDefault(event, options);
    handlers.onPointerMove(firstTouch(event));
  });
  add('touchend', () => handlers.onPointerEnd({}));
  add('touchcancel', () => handlers.onPointerEnd({}));
  return teardowns;
}

/**
 * @param {unknown} event
 * @param {EventTarget & { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number }; clientWidth?: number; clientHeight?: number }} target
 * @param {ReturnType<typeof normalizePointerOptions>} options
 */
function pointerPointToValue(event, target, options) {
  const point = /** @type {{ clientX?: unknown; clientY?: unknown }} */ (event);
  const rect = typeof target.getBoundingClientRect === 'function'
    ? target.getBoundingClientRect()
    : { left: 0, top: 0, width: Number(target.clientWidth) || 1, height: Number(target.clientHeight) || 1 };
  const width = positiveFinite(rect.width, 1);
  const height = positiveFinite(rect.height, 1);
  let x = ((Number(point.clientX) - rect.left) / width) * 2 - 1;
  let y = 1 - ((Number(point.clientY) - rect.top) / height) * 2;
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  if (options.invertX) x *= -1;
  if (options.invertY) y *= -1;
  return { x: clampFinite(x, -1, 1), y: clampFinite(y, -1, 1) };
}

/** @param {unknown} event */
function pointerEventId(event) {
  const id = Number(/** @type {{ pointerId?: unknown; identifier?: unknown }} */ (event).pointerId ?? /** @type {{ pointerId?: unknown; identifier?: unknown }} */ (event).identifier);
  return Number.isFinite(id) ? id : null;
}

/** @param {unknown} event */
function firstTouch(event) {
  const touchEvent = /** @type {{ touches?: ArrayLike<unknown>; changedTouches?: ArrayLike<unknown> }} */ (event);
  return touchEvent.touches?.[0] ?? touchEvent.changedTouches?.[0] ?? event;
}

/**
 * @param {unknown} event
 * @param {{ preventDefault: boolean }} options
 */
function maybePreventDefault(event, options) {
  if (options.preventDefault && event && typeof /** @type {{ preventDefault?: unknown }} */ (event).preventDefault === 'function') {
    /** @type {{ preventDefault: () => void }} */ (event).preventDefault();
  }
}

/**
 * @param {ParallaxObserverPluginOptions} options
 * @param {import('./index.d.ts').SkykitViewState} view
 * @param {Vector3Like} anchor
 * @returns {Vector3Like}
 */
function resolveTargetPc(options, view, anchor) {
  const explicit = normalizeOptionalVector3(options.targetPc);
  if (explicit) return explicit;
  const viewTarget = normalizeOptionalVector3(view.targetPc);
  if (viewTarget) return viewTarget;
  const orientation = normalizeQuaternion(view.orientationIcrs, IDENTITY_QUATERNION);
  const targetDistancePc = positiveFinite(options.targetDistancePc, 1);
  return addVectors(anchor, scaleVector(applyQuaternion(LOCAL_FORWARD, orientation), targetDistancePc));
}

/**
 * @param {Vector3Like} observerPc
 * @param {Vector3Like} targetPc
 * @param {Vector3Like} upReference
 */
function createTargetPlaneBasis(observerPc, targetPc, upReference) {
  const forward = normalizeDirectionOrFallback(subtractVectors(targetPc, observerPc), LOCAL_FORWARD);
  let right = normalizeDirectionOrFallback(cross(forward, upReference), LOCAL_RIGHT);
  if (vectorLength(right) <= EPSILON) right = cloneVector3(LOCAL_RIGHT);
  const up = normalizeDirectionOrFallback(cross(right, forward), LOCAL_UP);
  return { forward, right, up };
}

/** @param {unknown} value */
function normalizeParallaxControl(value) {
  if (!value || typeof value !== 'object') {
    return /** @type {ParallaxOffsetControlValue} */ ({ x: 0, y: 0, source: null, active: false });
  }
  const control = /** @type {{ x?: unknown; y?: unknown; source?: unknown; active?: unknown }} */ (value);
  return {
    x: clampFinite(control.x, -1, 1),
    y: clampFinite(control.y, -1, 1),
    source: typeof control.source === 'string' ? control.source : null,
    active: control.active === true,
  };
}

/** @param {unknown} value */
function normalizeOptionalVector3(value) {
  if (!value || typeof value !== 'object') return null;
  const vector = normalizeVector3(value, { x: Number.NaN, y: Number.NaN, z: Number.NaN });
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
    ? vector
    : null;
}

/**
 * @param {unknown} value
 * @param {Vector3Like} fallback
 * @returns {Vector3Like}
 */
function normalizeDirectionOrFallback(value, fallback) {
  const vector = normalizeOptionalVector3(value);
  return vector && vectorLength(vector) > EPSILON ? normalizeDirection(vector) : cloneVector3(fallback);
}

/**
 * @param {Vector3Like | null | undefined} a
 * @param {Vector3Like | null | undefined} b
 */
function sameVector(a, b) {
  if (!a || !b) return a == null && b == null;
  return Math.abs(a.x - b.x) < 1e-8
    && Math.abs(a.y - b.y) < 1e-8
    && Math.abs(a.z - b.z) < 1e-8;
}

/**
 * @param {QuaternionLike | null | undefined} a
 * @param {QuaternionLike | null | undefined} b
 */
function sameQuaternion(a, b) {
  if (!a || !b) return a == null && b == null;
  return Math.abs(a.x - b.x) < 1e-8
    && Math.abs(a.y - b.y) < 1e-8
    && Math.abs(a.z - b.z) < 1e-8
    && Math.abs(a.w - b.w) < 1e-8;
}

/**
 * @param {number} smoothing
 * @param {number} deltaSeconds
 */
function resolveFrameBlend(smoothing, deltaSeconds) {
  if (smoothing <= 0 || smoothing >= 1) return 1;
  const dt = Math.max(0, finiteNumber(deltaSeconds, 0) || 1 / 60);
  return clampFinite(1 - (1 - smoothing) ** (dt * 60), 0, 1);
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} amount
 */
function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

/**
 * @param {Vector3Like} a
 * @param {Vector3Like} b
 * @returns {Vector3Like}
 */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 */
function clampFinite(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : 0;
}

/**
 * @param {number} value
 * @param {number} deadzone
 */
function applyDeadzone(value, deadzone) {
  return Math.abs(value) < deadzone ? 0 : value;
}

/** @param {unknown} screenSource */
function normalizeScreenAngle(screenSource) {
  const source = screenSource ?? globalThis.screen;
  const candidate = /** @type {{ orientation?: { angle?: unknown } | number }} */ (source)?.orientation;
  const angle = Number(
    typeof candidate === 'object' && candidate
      ? candidate.angle
      : candidate ?? /** @type {{ orientation?: unknown }} */ (globalThis).orientation,
  );
  return Number.isFinite(angle) ? angle : 0;
}

/** @param {DeviceTiltTrackerOptions} options */
async function requestTiltPermission(options) {
  const requestPermission = options.requestPermission ?? resolveDeviceOrientationPermissionRequest(options.deviceOrientationEvent);
  if (typeof requestPermission !== 'function') return { ok: true, reason: 'permission-unavailable' };
  try {
    const result = await requestPermission();
    return result === 'granted' || result === true || result == null
      ? { ok: true, reason: 'permission-granted' }
      : { ok: false, reason: 'permission-denied' };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** @param {unknown} deviceOrientationEvent */
function resolveDeviceOrientationPermissionRequest(deviceOrientationEvent) {
  const ctor = deviceOrientationEvent ?? /** @type {unknown} */ (globalThis.DeviceOrientationEvent);
  const requestPermission = /** @type {{ requestPermission?: unknown }} */ (ctor)?.requestPermission;
  return typeof requestPermission === 'function'
    ? () => /** @type {() => Promise<unknown> | unknown} */ (requestPermission).call(ctor)
    : null;
}

function resolveGlobalEventTarget() {
  return typeof globalThis.window !== 'undefined' ? globalThis.window : null;
}
