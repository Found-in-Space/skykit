import { normalizePoint, resolvePointSpec } from '../fields/octree-selection.js';
import {
  identityIcrsToSceneTransform,
  identitySceneToIcrsTransform,
} from '../layers/scene-orientation.js';
import { SCALE } from '../services/octree/scene-scale.js';
import { createDeviceTiltTracker } from '../services/input/device-tilt-tracker.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_OFFSET_PC = 0.12;
const DEFAULT_EASING = 0.08;

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function normalizeUnitInterval(value, fallback) {
  return Number.isFinite(value) && value > 0 && value <= 1 ? Number(value) : fallback;
}

function resolveOffsetPc(getOffsetPc, context) {
  const value = typeof getOffsetPc === 'function' ? getOffsetPc(context) : getOffsetPc;
  return Number.isFinite(value) ? Number(value) : DEFAULT_OFFSET_PC;
}

export function createFixedTargetParallaxController(options = {}) {
  const id = options.id ?? 'fixed-target-parallax-controller';
  const sceneScale = normalizePositiveNumber(options.sceneScale, SCALE);
  const easing = normalizeUnitInterval(options.easing, DEFAULT_EASING);
  const icrsToSceneTransform = typeof options.icrsToSceneTransform === 'function'
    ? options.icrsToSceneTransform
    : identityIcrsToSceneTransform;
  const sceneToIcrsTransform = typeof options.sceneToIcrsTransform === 'function'
    ? options.sceneToIcrsTransform
    : identitySceneToIcrsTransform;
  const getOffsetPc = typeof options.getOffsetPc === 'function'
    ? options.getOffsetPc
    : () => normalizePositiveNumber(options.offsetPc, DEFAULT_OFFSET_PC);
  const onModeChange = typeof options.onModeChange === 'function' ? options.onModeChange : () => {};
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const pointerOptions = options.pointer && typeof options.pointer === 'object' ? options.pointer : {};
  const motionOptions = options.motion && typeof options.motion === 'object' ? options.motion : {};
  const pointerInvertX = pointerOptions.invertX === true;
  const pointerInvertY = pointerOptions.invertY === true;

  let pointerTarget = null;
  let motionEnabled = false;
  let targetOffset = { x: 0, y: 0 };
  let currentOffset = { x: 0, y: 0 };
  let stats = {
    inputMode: 'pointer',
    motionEnabled: false,
    targetOffset: { x: 0, y: 0 },
    currentOffset: { x: 0, y: 0 },
  };

  const deviceTiltTracker = createDeviceTiltTracker({
    ...motionOptions,
    onUpdate(state) {
      if (state.phase === 'calibrated') {
        targetOffset = { x: 0, y: 0 };
        currentOffset = { x: 0, y: 0 };
        stats = {
          ...stats,
          targetOffset: { x: 0, y: 0 },
          currentOffset: { x: 0, y: 0 },
        };
        onStatus('Motion recalibrated for the current screen orientation.');
        return;
      }

      if (state.phase !== 'update') {
        return;
      }

      setTargetOffset(state.normalized.x, state.normalized.y, 'device motion');
    },
  });

  function resolveTargetPc(context) {
    const stateTargetPc = normalizePoint(context?.state?.targetPc, null);
    const resolvedTargetPc = resolvePointSpec(options.targetPc, context, stateTargetPc);
    if (!resolvedTargetPc) {
      throw new TypeError('FixedTargetParallaxController requires a finite targetPc');
    }
    return resolvedTargetPc;
  }

  function setTargetOffset(x, y, mode) {
    targetOffset = {
      x: clamp(x, -1, 1),
      y: clamp(y, -1, 1),
    };
    stats = {
      ...stats,
      inputMode: mode,
      targetOffset: { ...targetOffset },
    };
    onModeChange(mode);
  }

  function updateFromPointer(event) {
    if (!pointerTarget || motionEnabled) {
      return;
    }

    const bounds = typeof pointerTarget.getBoundingClientRect === 'function'
      ? pointerTarget.getBoundingClientRect()
      : null;
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) {
      return;
    }

    const normalizedX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const normalizedY = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    setTargetOffset(
      pointerInvertX ? -normalizedX : normalizedX,
      pointerInvertY ? -normalizedY : normalizedY,
      'pointer',
    );
  }

  function resetPointerMode() {
    if (motionEnabled) {
      return;
    }

    setTargetOffset(0, 0, 'pointer');
  }

  function applyCameraPose(context) {
    const targetPc = resolveTargetPc(context);
    currentOffset.x += (targetOffset.x - currentOffset.x) * easing;
    currentOffset.y += (targetOffset.y - currentOffset.y) * easing;

    const offsetPc = resolveOffsetPc(getOffsetPc, context);
    const observerSceneX = currentOffset.x * offsetPc * sceneScale;
    const observerSceneY = currentOffset.y * offsetPc * sceneScale;
    const [observerIcrsScaledX, observerIcrsScaledY, observerIcrsScaledZ] = sceneToIcrsTransform(
      observerSceneX,
      observerSceneY,
      0,
    );
    const observerPc = {
      x: observerIcrsScaledX / sceneScale,
      y: observerIcrsScaledY / sceneScale,
      z: observerIcrsScaledZ / sceneScale,
    };

    context.state.observerPc = observerPc;
    context.state.targetPc = clonePoint(targetPc);

    const [cameraX, cameraY, cameraZ] = icrsToSceneTransform(
      observerPc.x * sceneScale,
      observerPc.y * sceneScale,
      observerPc.z * sceneScale,
    );
    const [targetX, targetY, targetZ] = icrsToSceneTransform(
      targetPc.x * sceneScale,
      targetPc.y * sceneScale,
      targetPc.z * sceneScale,
    );

    context.camera.position.set(cameraX, cameraY, cameraZ);
    context.camera.lookAt(targetX, targetY, targetZ);

    stats = {
      ...stats,
      motionEnabled,
      currentOffset: { x: currentOffset.x, y: currentOffset.y },
      observerPc: clonePoint(observerPc),
      targetPc: clonePoint(targetPc),
    };
  }

  async function requestMotionEnable() {
    if (!deviceTiltTracker.isSupported()) {
      onStatus('Device motion is not available here, so this controller stays in pointer mode.');
      return false;
    }

    if (!motionEnabled) {
      const result = await deviceTiltTracker.enable();
      if (!result.ok) {
        onStatus('Motion access was not granted. You can still use pointer mode.');
        return false;
      }

      motionEnabled = true;
      stats = {
        ...stats,
        motionEnabled: true,
      };
      onModeChange('device motion');
      onStatus('Tilt the device to shift the observer while keeping the target fixed.');
      return true;
    }

    deviceTiltTracker.recenter();
    onStatus('Motion was recentered. Hold the device in a comfortable neutral position.');
    return true;
  }

  function requestMotionRecenter() {
    deviceTiltTracker.recenter();
    onStatus('Motion was recentered. Hold the device in a comfortable neutral position.');
  }

  return {
    id,
    getStats() {
      return {
        ...stats,
        targetOffset: { ...stats.targetOffset },
        currentOffset: { ...stats.currentOffset },
        observerPc: clonePoint(stats.observerPc ?? null),
        targetPc: clonePoint(stats.targetPc ?? null),
      };
    },
    isMotionSupported() {
      return deviceTiltTracker.isSupported();
    },
    async enableMotion() {
      return requestMotionEnable();
    },
    recenterMotion() {
      requestMotionRecenter();
    },
    attach(context) {
      pointerTarget = options.pointerTarget ?? context.canvas ?? null;
      context.state.observerPc = normalizePoint(context.state.observerPc, DEFAULT_OBSERVER_PC) ?? clonePoint(DEFAULT_OBSERVER_PC);
      context.state.targetPc = clonePoint(resolveTargetPc(context));
      pointerTarget?.addEventListener?.('pointermove', updateFromPointer);
      pointerTarget?.addEventListener?.('pointerdown', updateFromPointer);
      pointerTarget?.addEventListener?.('pointerleave', resetPointerMode);
      pointerTarget?.addEventListener?.('pointerup', resetPointerMode);
      pointerTarget?.addEventListener?.('pointercancel', resetPointerMode);
      applyCameraPose(context);
    },
    start(context) {
      applyCameraPose(context);
    },
    update(context) {
      applyCameraPose(context);
    },
    dispose() {
      pointerTarget?.removeEventListener?.('pointermove', updateFromPointer);
      pointerTarget?.removeEventListener?.('pointerdown', updateFromPointer);
      pointerTarget?.removeEventListener?.('pointerleave', resetPointerMode);
      pointerTarget?.removeEventListener?.('pointerup', resetPointerMode);
      pointerTarget?.removeEventListener?.('pointercancel', resetPointerMode);
      deviceTiltTracker.dispose();
      pointerTarget = null;
      motionEnabled = false;
      stats = {
        ...stats,
        motionEnabled: false,
      };
      onStatus('Use the pointer or device motion to shift the viewpoint.');
    },
  };
}
