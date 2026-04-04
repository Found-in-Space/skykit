import * as THREE from 'three';
import { normalizePoint } from '../fields/octree-selection.js';
import { SCALE } from '../services/octree/scene-scale.js';
import {
  createCameraRig,
  LOCAL_FORWARD,
  LOCAL_UP,
  LOCAL_RIGHT,
} from './camera-rig.js';

function clonePoint(p) {
  return p ? { x: p.x, y: p.y, z: p.z } : null;
}

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function optionalPositiveFinite(value, fallback = null) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function resolveFlyMaxSpeed(spec, fallback = null) {
  if (!spec || typeof spec !== 'object') {
    return fallback;
  }

  if (Object.hasOwn(spec, 'maxSpeed')) {
    return optionalPositiveFinite(spec.maxSpeed, null);
  }
  if (Object.hasOwn(spec, 'speed')) {
    return optionalPositiveFinite(spec.speed, null);
  }
  return fallback;
}

function cloneQuaternion(q) {
  return q ? { x: q.x, y: q.y, z: q.z, w: q.w } : null;
}

function normalizeQuaternion(value, fallback = null) {
  if (!value || typeof value !== 'object') {
    return cloneQuaternion(fallback);
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  const w = Number(value.w);
  const length = Math.hypot(x, y, z, w);
  if (!(length > 0)) {
    return cloneQuaternion(fallback);
  }
  return {
    x: x / length,
    y: y / length,
    z: z / length,
    w: w / length,
  };
}

function isXrButtonPressed(inputSources, options = {}) {
  const handedness = typeof options.handedness === 'string' ? options.handedness : null;
  const buttonIndex = Number.isInteger(options.buttonIndex) && options.buttonIndex >= 0
    ? options.buttonIndex
    : 0;

  for (const source of Array.from(inputSources ?? [])) {
    if (handedness && source?.handedness !== handedness) continue;
    if (source?.gamepad?.buttons?.[buttonIndex]?.pressed) {
      return true;
    }
  }

  return false;
}

/**
 * Read the thumbstick with the strongest motion from the XR input sources.
 * Returns `{ x, y, activeHand }` with deadzone applied.
 */
export function readXrAxes(inputSources, options = {}) {
  const deadzone = positiveFinite(options.deadzone, 0.15);
  const handedness = typeof options.handedness === 'string' ? options.handedness : null;
  let bestMagnitude = 0;
  let bestAxes = { x: 0, y: 0, activeHand: null };

  for (const source of Array.from(inputSources ?? [])) {
    if (handedness && source?.handedness !== handedness) continue;
    const gamepad = source?.gamepad;
    if (!gamepad || gamepad.axes.length < 2) continue;
    const xi = gamepad.axes.length >= 4 ? 2 : 0;
    const yi = gamepad.axes.length >= 4 ? 3 : 1;
    const rawX = Math.abs(gamepad.axes[xi] ?? 0) < deadzone ? 0 : Number(gamepad.axes[xi] ?? 0);
    const rawY = Math.abs(gamepad.axes[yi] ?? 0) < deadzone ? 0 : Number(gamepad.axes[yi] ?? 0);
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestAxes = {
        x: rawX,
        y: rawY,
        activeHand: typeof source.handedness === 'string' ? source.handedness : null,
      };
    }
  }

  return bestAxes;
}

const _movement = new THREE.Vector3();
const _shipForward = new THREE.Vector3();
const _shipRight = new THREE.Vector3();
const _cameraWorldQ = new THREE.Quaternion();
const _viewerLocalQ = new THREE.Quaternion();

/**
 * XR locomotion controller for the spaceship rig.
 *
 * Reads thumbstick input, steers the spaceship itself, and moves the
 * spaceship (navigationRoot) through the
 * star field.  The universe (contentRoot) stays at the scene origin;
 * the observer perceives motion because the spaceship — and therefore
 * the camera — changes position relative to the stationary stars.
 *
 * The structural offset that places the Sun at eye level is baked into
 * the rig's `deck` group, not applied here.
 */
export function createXrLocomotionController(options = {}) {
  const id = options.id ?? 'xr-locomotion-controller';
  const xrMoveSpeed = positiveFinite(options.moveSpeed, 4);
  const xrDeadzone = positiveFinite(options.deadzone, 0.15);
  const xrMoveHandedness = typeof options.moveHandedness === 'string'
    ? options.moveHandedness
    : 'right';
  const xrAttitudeHandedness = typeof options.attitudeHandedness === 'string'
    ? options.attitudeHandedness
    : 'left';
  const xrRollModifierButtonIndex = Number.isInteger(options.rollModifierButtonIndex)
    ? options.rollModifierButtonIndex
    : 1;
  const xrYawRateRadPerSec = positiveFinite(
    options.yawRateRadPerSec ?? options.yawRate,
    Math.PI * 0.375,
  );
  const xrPitchRateRadPerSec = positiveFinite(
    options.pitchRateRadPerSec ?? options.pitchRate,
    Math.PI * 0.3,
  );
  const xrRollRateRadPerSec = positiveFinite(
    options.rollRateRadPerSec ?? options.rollRate,
    Math.PI * 0.375,
  );
  const xrFlyMaxSpeed = optionalPositiveFinite(options.flyMaxSpeed ?? options.flySpeed, null);
  const xrFlyAcceleration = positiveFinite(
    options.flyAcceleration,
    optionalPositiveFinite(xrFlyMaxSpeed, 25) * 0.6,
  );
  const xrFlyDeceleration = positiveFinite(
    options.flyDeceleration,
    optionalPositiveFinite(xrFlyMaxSpeed, 25) * 0.8,
  );

  const rig = createCameraRig({
    observerPc: options.observerPc,
    lookAtPc: options.lookAtPc,
    sceneScale: positiveFinite(options.sceneScale, 1.0),
    icrsToSceneTransform: options.icrsToSceneTransform,
    sceneToIcrsTransform: options.sceneToIcrsTransform,
  });

  let lastObserverPc = rig.clonePosition();
  let lastObserverOrientation = cloneQuaternion(rig.orientation);
  let movementAutomation = null;

  let stats = {
    observerPc: rig.clonePosition(),
    activeHand: null,
    locomotionAxes: { x: 0, y: 0 },
    attitudeAxes: { x: 0, y: 0 },
    attitudeMode: 'yaw-pitch',
    observerOrientation: cloneQuaternion(rig.orientation),
    sceneScale: rig.sceneScale,
    presenting: false,
    movementAutomation: null,
  };

  function updateFlyToAutomation(dt) {
    if (!movementAutomation || movementAutomation.type !== 'flyTo') {
      return false;
    }

    const dx = movementAutomation.target.x - rig.positionPc.x;
    const dy = movementAutomation.target.y - rig.positionPc.y;
    const dz = movementAutomation.target.z - rig.positionPc.z;
    const remainingDistance = Math.hypot(dx, dy, dz);

    if (remainingDistance <= (movementAutomation.arrivalThreshold ?? 0.01)) {
      rig.setPosition(movementAutomation.target);
      const onArrive = movementAutomation.onArrive;
      movementAutomation = null;
      if (typeof onArrive === 'function') {
        onArrive();
      }
      return true;
    }

    if (!(dt > 0)) {
      return true;
    }

    const direction = {
      x: dx / remainingDistance,
      y: dy / remainingDistance,
      z: dz / remainingDistance,
    };
    const previousSpeed = movementAutomation.currentSpeed;
    const brakingDistance = Math.max(
      0,
      remainingDistance - (movementAutomation.arrivalThreshold ?? 0.01),
    );
    const brakingSpeed = movementAutomation.deceleration > 0
      ? Math.sqrt(2 * movementAutomation.deceleration * brakingDistance)
      : Number.POSITIVE_INFINITY;
    const targetSpeed = movementAutomation.maxSpeed == null
      ? brakingSpeed
      : Math.min(brakingSpeed, movementAutomation.maxSpeed);

    if (movementAutomation.currentSpeed < targetSpeed) {
      movementAutomation.currentSpeed = Math.min(
        targetSpeed,
        movementAutomation.currentSpeed + movementAutomation.acceleration * dt,
      );
    } else {
      movementAutomation.currentSpeed = Math.max(
        targetSpeed,
        movementAutomation.currentSpeed - movementAutomation.deceleration * dt,
      );
    }

    const averageSpeed = (previousSpeed + movementAutomation.currentSpeed) * 0.5;
    const step = Math.min(remainingDistance, averageSpeed * dt);
    if (!(step > 0)) {
      return true;
    }

    rig.positionPc.x += direction.x * step;
    rig.positionPc.y += direction.y * step;
    rig.positionPc.z += direction.z * step;
    return true;
  }

  function syncViewerOrientation(context) {
    const xrFrame = context.xr?.frame;
    const refSpace = context.xr?.referenceSpace;
    if (xrFrame && refSpace) {
      const pose = xrFrame.getViewerPose(refSpace);
      if (pose) {
        const o = pose.transform.orientation;
        _viewerLocalQ.set(o.x, o.y, o.z, o.w);
        _cameraWorldQ.copy(rig.orientation).multiply(_viewerLocalQ).normalize();
        return true;
      }
    }
    context.camera.updateMatrixWorld();
    context.camera.getWorldQuaternion(_cameraWorldQ);
    return false;
  }

  function writeToState(state) {
    state.observerPc = rig.clonePosition();
    state.observerOrientation = cloneQuaternion(rig.orientation);
    lastObserverPc = rig.clonePosition();
    lastObserverOrientation = cloneQuaternion(rig.orientation);
  }

  function readFromState(state) {
    const statePc = normalizePoint(state?.observerPc, null);
    if (
      statePc
      && (
        statePc.x !== lastObserverPc.x
        || statePc.y !== lastObserverPc.y
        || statePc.z !== lastObserverPc.z
      )
    ) {
      rig.setPosition(statePc);
      lastObserverPc = clonePoint(statePc);
    }

    const stateOrientation = normalizeQuaternion(state?.observerOrientation, null);
    if (
      stateOrientation
      && (
        stateOrientation.x !== lastObserverOrientation?.x
        || stateOrientation.y !== lastObserverOrientation?.y
        || stateOrientation.z !== lastObserverOrientation?.z
        || stateOrientation.w !== lastObserverOrientation?.w
      )
    ) {
      rig.orientation.set(
        stateOrientation.x,
        stateOrientation.y,
        stateOrientation.z,
        stateOrientation.w,
      );
      lastObserverOrientation = cloneQuaternion(rig.orientation);
    }
  }

  return {
    id,
    rig,

    getStats() {
      return {
        ...stats,
        observerPc: clonePoint(stats.observerPc),
      };
    },

    flyTo(targetPc, opts = {}) {
      const target = normalizePoint(targetPc, null);
      if (!target) {
        return false;
      }

      const dx = target.x - rig.positionPc.x;
      const dy = target.y - rig.positionPc.y;
      const dz = target.z - rig.positionPc.z;
      const distance = Math.hypot(dx, dy, dz);
      if (!(distance > 0)) {
        rig.setPosition(target);
        return true;
      }

      movementAutomation = {
        type: 'flyTo',
        target: clonePoint(target),
        maxSpeed: resolveFlyMaxSpeed(opts, xrFlyMaxSpeed),
        currentSpeed: 0,
        acceleration: positiveFinite(opts.acceleration, xrFlyAcceleration),
        deceleration: positiveFinite(opts.deceleration, xrFlyDeceleration),
        arrivalThreshold: positiveFinite(opts.arrivalThreshold, 0.02),
        onArrive: typeof opts.onArrive === 'function' ? opts.onArrive : null,
      };
      return true;
    },

    attach(context) {
      if (!context.state || typeof context.state !== 'object') {
        throw new TypeError('XrLocomotionController requires a mutable runtime state object');
      }

      if (!context.state.observerPc) {
        writeToState(context.state);
      } else {
        const statePc = normalizePoint(context.state.observerPc, null);
        if (statePc) {
          rig.setPosition(statePc);
          lastObserverPc = clonePoint(statePc);
        }
        const stateOrientation = normalizeQuaternion(context.state.observerOrientation, null);
        if (stateOrientation) {
          rig.orientation.set(
            stateOrientation.x,
            stateOrientation.y,
            stateOrientation.z,
            stateOrientation.w,
          );
          lastObserverOrientation = cloneQuaternion(rig.orientation);
        }
      }

      if (!Number.isFinite(context.state.starFieldScale) || context.state.starFieldScale <= 0) {
        context.state.starFieldScale = rig.sceneScale;
      }
      if (!context.state.observerOrientation) {
        context.state.observerOrientation = cloneQuaternion(rig.orientation);
      }
    },

    update(context) {
      if (context.xr?.presenting !== true) return;

      readFromState(context.state);
      const dt = Math.max(0, context.frame?.deltaSeconds ?? 0);
      const inputSources = context.xr?.session?.inputSources ?? [];
      const attitudeAxes = readXrAxes(inputSources, {
        deadzone: xrDeadzone,
        handedness: xrAttitudeHandedness,
      });
      const rollModifierPressed = isXrButtonPressed(inputSources, {
        handedness: xrAttitudeHandedness,
        buttonIndex: xrRollModifierButtonIndex,
      });

      if (dt > 0) {
        if (attitudeAxes.y !== 0) {
          rig.rotateLocal(LOCAL_RIGHT, attitudeAxes.y * xrPitchRateRadPerSec * dt);
        }
        if (attitudeAxes.x !== 0 && rollModifierPressed) {
          rig.rotateLocal(LOCAL_FORWARD, attitudeAxes.x * xrRollRateRadPerSec * dt);
        } else if (attitudeAxes.x !== 0) {
          rig.rotateLocal(LOCAL_UP, -attitudeAxes.x * xrYawRateRadPerSec * dt);
        }
      }

      syncViewerOrientation(context);
      _shipForward.set(0, 0, -1).applyQuaternion(rig.orientation);
      _shipRight.set(1, 0, 0).applyQuaternion(rig.orientation);

      const axes = readXrAxes(inputSources, {
        deadzone: xrDeadzone,
        handedness: xrMoveHandedness,
      });

      if (axes.x !== 0 || axes.y !== 0) {
        movementAutomation = null;
        _movement.copy(_shipRight).multiplyScalar(axes.x).addScaledVector(_shipForward, -axes.y);
        const strength = _movement.length();
        if (strength > 0) {
          const sceneScale = positiveFinite(context.state?.starFieldScale, rig.sceneScale);
          rig.moveInSceneDirection(
            _movement.normalize(),
            (xrMoveSpeed * strength * dt) / sceneScale,
          );
        }
      } else {
        updateFlyToAutomation(dt);
      }

      const starFieldScale = positiveFinite(context.state?.starFieldScale, rig.sceneScale);

      const [sx, sy, sz] = rig.icrsToScene(
        rig.positionPc.x * starFieldScale,
        rig.positionPc.y * starFieldScale,
        rig.positionPc.z * starFieldScale,
      );
      context.navigationRoot.position.set(sx, sy, sz);
      context.navigationRoot.quaternion.copy(rig.orientation);
      context.contentRoot.scale.setScalar(starFieldScale / SCALE);

      writeToState(context.state);
      stats = {
        observerPc: rig.clonePosition(),
        observerOrientation: cloneQuaternion(rig.orientation),
        activeHand: axes.activeHand ?? attitudeAxes.activeHand,
        locomotionAxes: { x: axes.x, y: axes.y },
        attitudeAxes: { x: attitudeAxes.x, y: attitudeAxes.y },
        attitudeMode: rollModifierPressed ? 'roll-pitch' : 'yaw-pitch',
        sceneScale: starFieldScale,
        presenting: true,
        movementAutomation: movementAutomation?.type ?? null,
        movementAutomationSpeedPcPerSec: movementAutomation?.currentSpeed ?? 0,
        movementAutomationMaxSpeedPcPerSec: movementAutomation?.maxSpeed ?? null,
      };
    },

    dispose() {
      // No DOM or event listeners to clean up.
    },
  };
}
