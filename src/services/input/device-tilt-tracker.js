import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

const HALF_PI_QUATERNION = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const SCREEN_RIGHT_AXIS = new Vector3(1, 0, 0);
const SCREEN_UP_AXIS = new Vector3(0, 1, 0);
const SCREEN_NORMAL_AXIS = new Vector3(0, 0, 1);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, precision = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(precision));
}

function applyDeadzone(value, size) {
  const magnitude = Math.abs(value);
  if (!(magnitude > size)) {
    return 0;
  }

  return Math.sign(value) * ((magnitude - size) / (1 - size));
}

function snapshotVector(vector) {
  return {
    x: round(vector.x),
    y: round(vector.y),
    z: round(vector.z),
  };
}

function normalizeScreenOrientation(screenSource, windowSource) {
  const screenAngle = screenSource?.screen?.orientation?.angle;
  const windowAngle = windowSource?.orientation;
  const orientationType = screenSource?.screen?.orientation?.type ?? null;
  const rawAngle = Number.isFinite(screenAngle)
    ? Number(screenAngle)
    : Number.isFinite(windowAngle)
      ? Number(windowAngle)
      : 0;
  const normalizedDegrees = ((rawAngle % 360) + 360) % 360;
  const isQuarterTurn = normalizedDegrees === 90 || normalizedDegrees === 270;
  const isHalfTurn = normalizedDegrees === 0 || normalizedDegrees === 180;
  const isLandscapeNative = typeof orientationType === 'string'
    ? orientationType.startsWith('landscape')
      ? isHalfTurn
      : orientationType.startsWith('portrait')
        ? isQuarterTurn
        : false
    : false;
  const compensationDegrees = isLandscapeNative ? 90 : 0;
  const compensatedDegrees = ((normalizedDegrees + compensationDegrees) % 360 + 360) % 360;

  return {
    angleDeg: normalizedDegrees,
    angleRad: MathUtils.degToRad(normalizedDegrees),
    compensatedAngleDeg: compensatedDegrees,
    compensatedAngleRad: MathUtils.degToRad(compensatedDegrees),
    landscapeNative: isLandscapeNative,
    type: orientationType,
  };
}

export function createDeviceTiltTracker(options = {}) {
  const xResponse = Number.isFinite(options.xResponse) ? Number(options.xResponse) : 3;
  const yResponse = Number.isFinite(options.yResponse) ? Number(options.yResponse) : 2.6;
  const deadzone = Number.isFinite(options.deadzone) ? Number(options.deadzone) : 0.025;
  const swapAxes = options.swapAxes === true;
  const invertX = options.invertX === true;
  const invertY = options.invertY === true;
  const orientationChangeToleranceRad = Number.isFinite(options.orientationChangeToleranceRad)
    ? Number(options.orientationChangeToleranceRad)
    : 0.01;
  const eventTarget = options.eventTarget ?? globalThis.window ?? null;
  const screenSource = options.screenSource ?? globalThis;
  const windowSource = options.windowSource ?? globalThis.window ?? null;
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};

  let motionEnabled = false;
  let baselineScreenAngleRad = null;
  const baselineRight = new Vector3();
  const baselineUp = new Vector3();
  const currentNormal = new Vector3();

  function resolveDeviceOrientationApi() {
    return options.deviceOrientationEvent ?? globalThis.DeviceOrientationEvent ?? null;
  }

  function isSupported() {
    return Boolean(
      resolveDeviceOrientationApi()
      && eventTarget
      && typeof eventTarget.addEventListener === 'function'
      && typeof eventTarget.removeEventListener === 'function',
    );
  }

  function createDeviceTiltQuaternion(betaDeg, gammaDeg, screenAngleRad) {
    const quaternion = new Quaternion();
    const deviceEuler = new Euler(
      MathUtils.degToRad(betaDeg),
      0,
      -MathUtils.degToRad(gammaDeg),
      'YXZ',
    );
    const screenRotationQuaternion = new Quaternion().setFromAxisAngle(
      SCREEN_NORMAL_AXIS,
      -screenAngleRad,
    );

    quaternion.setFromEuler(deviceEuler);
    quaternion.multiply(HALF_PI_QUATERNION);
    quaternion.multiply(screenRotationQuaternion);
    return quaternion;
  }

  function emit(state) {
    onUpdate(state);
    return state;
  }

  function calibrate(event, screenOrientation) {
    const quaternion = createDeviceTiltQuaternion(
      Number(event.beta),
      Number(event.gamma),
      screenOrientation.compensatedAngleRad,
    );
    baselineScreenAngleRad = screenOrientation.compensatedAngleRad;
    baselineRight.copy(SCREEN_RIGHT_AXIS).applyQuaternion(quaternion);
    baselineUp.copy(SCREEN_UP_AXIS).applyQuaternion(quaternion);

    return emit({
      phase: 'calibrated',
      raw: {
        alpha: round(event.alpha),
        beta: round(event.beta),
        gamma: round(event.gamma),
      },
      screen: {
        angleDeg: round(screenOrientation.angleDeg, 1),
        angleRad: round(screenOrientation.angleRad),
        compensatedAngleDeg: round(screenOrientation.compensatedAngleDeg, 1),
        compensatedAngleRad: round(screenOrientation.compensatedAngleRad),
        landscapeNative: screenOrientation.landscapeNative,
        type: screenOrientation.type,
      },
      projected: {
        x: 0,
        y: 0,
      },
      clamped: {
        x: 0,
        y: 0,
      },
      normalized: {
        x: 0,
        y: 0,
      },
      saturated: {
        x: false,
        y: false,
      },
      baseline: {
        right: snapshotVector(baselineRight),
        up: snapshotVector(baselineUp),
      },
      current: {
        normal: snapshotVector(SCREEN_NORMAL_AXIS),
      },
    });
  }

  function handleDeviceOrientation(event) {
    if (!motionEnabled) {
      return;
    }

    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) {
      return;
    }

    const screenOrientation = normalizeScreenOrientation(screenSource, windowSource);
    if (
      baselineScreenAngleRad == null
      || Math.abs(screenOrientation.compensatedAngleRad - baselineScreenAngleRad) > orientationChangeToleranceRad
    ) {
      calibrate(event, screenOrientation);
      return;
    }

    const quaternion = createDeviceTiltQuaternion(
      Number(event.beta),
      Number(event.gamma),
      screenOrientation.compensatedAngleRad,
    );
    currentNormal.copy(SCREEN_NORMAL_AXIS).applyQuaternion(quaternion);

    const projectedX = currentNormal.dot(baselineRight) * xResponse;
    const projectedY = -currentNormal.dot(baselineUp) * yResponse;
    const clampedX = clamp(projectedX, -1, 1);
    const clampedY = clamp(projectedY, -1, 1);
    const mappedX = swapAxes ? clampedY : clampedX;
    const mappedY = swapAxes ? clampedX : clampedY;
    const outputX = invertX ? -mappedX : mappedX;
    const outputY = invertY ? -mappedY : mappedY;

    emit({
      phase: 'update',
      raw: {
        alpha: round(event.alpha),
        beta: round(event.beta),
        gamma: round(event.gamma),
      },
      screen: {
        angleDeg: round(screenOrientation.angleDeg, 1),
        angleRad: round(screenOrientation.angleRad),
        compensatedAngleDeg: round(screenOrientation.compensatedAngleDeg, 1),
        compensatedAngleRad: round(screenOrientation.compensatedAngleRad),
        landscapeNative: screenOrientation.landscapeNative,
        type: screenOrientation.type,
      },
      projected: {
        x: round(projectedX),
        y: round(projectedY),
      },
      clamped: {
        x: round(clampedX),
        y: round(clampedY),
      },
      normalized: {
        x: round(applyDeadzone(outputX, deadzone)),
        y: round(applyDeadzone(outputY, deadzone)),
      },
      saturated: {
        x: Math.abs(projectedX) >= 1,
        y: Math.abs(projectedY) >= 1,
      },
      baseline: {
        right: snapshotVector(baselineRight),
        up: snapshotVector(baselineUp),
      },
      current: {
        normal: snapshotVector(currentNormal),
      },
    });
  }

  async function enable() {
    const deviceOrientationApi = resolveDeviceOrientationApi();
    if (!isSupported()) {
      return {
        ok: false,
        reason: 'unsupported',
      };
    }

    const requestPermission = options.requestPermission ?? deviceOrientationApi.requestPermission;
    if (!motionEnabled) {
      if (typeof requestPermission === 'function') {
        const result = await requestPermission();
        if (result !== 'granted') {
          return {
            ok: false,
            reason: 'denied',
          };
        }
      }

      eventTarget.addEventListener('deviceorientation', handleDeviceOrientation);
      motionEnabled = true;
      baselineScreenAngleRad = null;
      return {
        ok: true,
        recentered: false,
      };
    }

    baselineScreenAngleRad = null;
    return {
      ok: true,
      recentered: true,
    };
  }

  function recenter() {
    baselineScreenAngleRad = null;
  }

  function dispose() {
    if (eventTarget && typeof eventTarget.removeEventListener === 'function') {
      eventTarget.removeEventListener('deviceorientation', handleDeviceOrientation);
    }
    motionEnabled = false;
    baselineScreenAngleRad = null;
  }

  return {
    enable,
    recenter,
    dispose,
    isSupported,
  };
}
