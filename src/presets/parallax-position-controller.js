import { createDeviceTiltTracker } from '../services/input/device-tilt-tracker.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

/**
 * A viewer controller that jiggles the observer position in the plane perpendicular
 * to the look direction based on pointer position or device tilt, while a separate
 * lockAt keeps the camera oriented toward the fixed target.
 *
 * Use enable() / disable() to toggle the effect. While disabled the observer position
 * is held at the origin so that lookAt / lookAt animations run cleanly from a known
 * starting position.
 *
 * @param {object} options
 * @param {object}   options.cameraController    CameraRigController whose rig this controller adjusts.
 * @param {number}   [options.offsetPc=0.12]     Maximum observer offset in parsecs.
 * @param {number}   [options.easing=0.08]       Per-frame lerp factor toward targetOffset (0–1].
 * @param {object}   [options.pointer]           Pointer options: { invertX, invertY }.
 * @param {object}   [options.motion]            DeviceTiltTracker options forwarded verbatim.
 * @param {Function} [options.onModeChange]      Called with the active input mode string.
 * @param {Function} [options.onStatus]          Called with human-readable status messages.
 * @param {string}   [options.id]
 */
export function createParallaxPositionController(options = {}) {
  const id = options.id ?? 'parallax-position-controller';
  const cameraController = options.cameraController ?? null;

  const resolveOffsetPc = (() => {
    const spec = options.offsetPc;
    if (typeof spec === 'function') return spec;
    const fixed = positiveFinite(spec, 0.12);
    return () => fixed;
  })();

  const easing = (() => {
    const v = options.easing;
    return Number.isFinite(v) && v > 0 && v <= 1 ? Number(v) : 0.08;
  })();

  const pointerOpts = options.pointer && typeof options.pointer === 'object' ? options.pointer : {};
  const pointerInvertX = pointerOpts.invertX === true;
  const pointerInvertY = pointerOpts.invertY === true;
  const motionOpts = options.motion && typeof options.motion === 'object' ? options.motion : {};
  const onModeChange = typeof options.onModeChange === 'function' ? options.onModeChange : () => {};
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  let enabled = false;
  let canvasTarget = null;
  let motionEnabled = false;
  let targetOffset = { x: 0, y: 0 };
  let currentOffset = { x: 0, y: 0 };
  let deviceTiltTracker = null;

  function setTargetOffset(x, y, mode) {
    targetOffset = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    onModeChange(mode);
  }

  function createDeviceTiltTrackerIfNeeded() {
    if (deviceTiltTracker) return;
    deviceTiltTracker = createDeviceTiltTracker({
      ...motionOpts,
      onUpdate(state) {
        if (state.phase === 'calibrated') {
          targetOffset = { x: 0, y: 0 };
          currentOffset = { x: 0, y: 0 };
          onStatus('Motion recalibrated for the current screen orientation.');
          return;
        }
        if (state.phase !== 'update') return;
        setTargetOffset(state.normalized.x, state.normalized.y, 'device motion');
      },
    });
  }

  function updatePointerOffset(event) {
    if (!canvasTarget || motionEnabled) return;
    const bounds = typeof canvasTarget.getBoundingClientRect === 'function'
      ? canvasTarget.getBoundingClientRect()
      : null;
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return;
    const nx = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const ny = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    setTargetOffset(
      pointerInvertX ? -nx : nx,
      pointerInvertY ? -ny : ny,
      'pointer',
    );
  }

  function onPointerMove(event) {
    if (!enabled || motionEnabled) return;
    updatePointerOffset(event);
  }

  function onPointerDown(event) {
    if (!enabled) return;
    updatePointerOffset(event);
  }

  function onPointerEnd() {
    if (!enabled || motionEnabled) return;
    setTargetOffset(0, 0, 'pointer');
  }

  function bindPointerEvents() {
    canvasTarget?.addEventListener?.('pointermove', onPointerMove);
    canvasTarget?.addEventListener?.('pointerdown', onPointerDown);
    canvasTarget?.addEventListener?.('pointerleave', onPointerEnd);
    canvasTarget?.addEventListener?.('pointerup', onPointerEnd);
    canvasTarget?.addEventListener?.('pointercancel', onPointerEnd);
  }

  function unbindPointerEvents() {
    canvasTarget?.removeEventListener?.('pointermove', onPointerMove);
    canvasTarget?.removeEventListener?.('pointerdown', onPointerDown);
    canvasTarget?.removeEventListener?.('pointerleave', onPointerEnd);
    canvasTarget?.removeEventListener?.('pointerup', onPointerEnd);
    canvasTarget?.removeEventListener?.('pointercancel', onPointerEnd);
  }

  return {
    id,

    enable() {
      enabled = true;
    },

    disable() {
      enabled = false;
      targetOffset = { x: 0, y: 0 };
      currentOffset = { x: 0, y: 0 };
      const rig = cameraController?.rig;
      if (rig) {
        rig.positionPc.x = 0;
        rig.positionPc.y = 0;
        rig.positionPc.z = 0;
      }
    },

    isMotionSupported() {
      createDeviceTiltTrackerIfNeeded();
      return deviceTiltTracker?.isSupported() ?? false;
    },

    async enableMotion() {
      createDeviceTiltTrackerIfNeeded();
      if (!deviceTiltTracker?.isSupported()) {
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
        onModeChange('device motion');
        onStatus('Tilt the device to shift the observer while keeping the target fixed.');
        return true;
      }
      deviceTiltTracker.recenter();
      onStatus('Motion was recentered. Hold the device in a comfortable neutral position.');
      return true;
    },

    recenterMotion() {
      deviceTiltTracker?.recenter();
      onStatus('Motion was recentered. Hold the device in a comfortable neutral position.');
    },

    attach(context) {
      canvasTarget = options.canvasTarget ?? context.canvas ?? null;
      bindPointerEvents();
    },

    update(context) {
      if (!enabled) return;

      const rig = cameraController?.rig;
      if (!rig) return;

      currentOffset.x += (targetOffset.x - currentOffset.x) * easing;
      currentOffset.y += (targetOffset.y - currentOffset.y) * easing;

      const offsetPc = resolveOffsetPc(context);
      const scale = offsetPc * rig.sceneScale;

      const right = rig.getRight();
      const rx = right.x, ry = right.y, rz = right.z;
      const up = rig.getUp();

      const sceneX = (currentOffset.x * rx + currentOffset.y * up.x) * scale;
      const sceneY = (currentOffset.x * ry + currentOffset.y * up.y) * scale;
      const sceneZ = (currentOffset.x * rz + currentOffset.y * up.z) * scale;

      const [ix, iy, iz] = rig.sceneToIcrs(sceneX, sceneY, sceneZ);
      rig.positionPc.x = ix / rig.sceneScale;
      rig.positionPc.y = iy / rig.sceneScale;
      rig.positionPc.z = iz / rig.sceneScale;

      rig.applyToCamera(context.camera);
    },

    dispose() {
      unbindPointerEvents();
      deviceTiltTracker?.dispose();
      deviceTiltTracker = null;
      canvasTarget = null;
      enabled = false;
      motionEnabled = false;
      targetOffset = { x: 0, y: 0 };
      currentOffset = { x: 0, y: 0 };
    },
  };
}
