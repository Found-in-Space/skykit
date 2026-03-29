import * as THREE from 'three';
import { normalizePoint } from '../fields/octree-selection.js';
import { identityIcrsToSceneTransform, identitySceneToIcrsTransform } from '../layers/scene-orientation.js';
import { SCALE } from '../services/octree/scene-scale.js';
import { moveObserverPcFromSceneDirection } from './free-fly-controller.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_SCENE_SCALE = 1.0;
const DEFAULT_MOVE_SPEED_WORLD_UNITS_PER_SECOND = 4.0;
const DEFAULT_DEADZONE = 0.15;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_FORWARD = new THREE.Vector3(0, 0, -1);

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function normalizePositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

export function readXrLocomotionAxes(inputSources, options = {}) {
  const deadzone = normalizePositiveNumber(options.deadzone, DEFAULT_DEADZONE);
  let bestMagnitude = 0;
  let bestAxes = {
    x: 0,
    y: 0,
    activeHand: null,
  };

  for (const source of Array.from(inputSources ?? [])) {
    const gamepad = source?.gamepad;
    if (!gamepad || gamepad.axes.length < 2) {
      continue;
    }

    const axisXIndex = gamepad.axes.length >= 4 ? 2 : 0;
    const axisYIndex = gamepad.axes.length >= 4 ? 3 : 1;
    const rawX = Math.abs(gamepad.axes[axisXIndex] ?? 0) < deadzone ? 0 : Number(gamepad.axes[axisXIndex] ?? 0);
    const rawY = Math.abs(gamepad.axes[axisYIndex] ?? 0) < deadzone ? 0 : Number(gamepad.axes[axisYIndex] ?? 0);
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

export function createXrLocomotionController(options = {}) {
  const id = options.id ?? 'xr-locomotion-controller';
  const defaultSceneScale = normalizePositiveNumber(options.sceneScale, DEFAULT_SCENE_SCALE);
  const moveSpeedWorldUnitsPerSecond = normalizePositiveNumber(
    options.moveSpeedWorldUnitsPerSecond,
    DEFAULT_MOVE_SPEED_WORLD_UNITS_PER_SECOND,
  );
  const deadzone = normalizePositiveNumber(options.deadzone, DEFAULT_DEADZONE);
  const icrsToSceneTransform = typeof options.icrsToSceneTransform === 'function'
    ? options.icrsToSceneTransform
    : identityIcrsToSceneTransform;
  const sceneToIcrsTransform = typeof options.sceneToIcrsTransform === 'function'
    ? options.sceneToIcrsTransform
    : identitySceneToIcrsTransform;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const cameraWorldQuaternion = new THREE.Quaternion();
  let stats = {
    observerPc: clonePoint(DEFAULT_OBSERVER_PC),
    sceneScale: defaultSceneScale,
    presenting: false,
    activeHand: null,
    locomotionAxes: { x: 0, y: 0 },
  };

  function getObserverPc(state) {
    return normalizePoint(
      state?.observerPc,
      normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC) ?? DEFAULT_OBSERVER_PC,
    ) ?? clonePoint(DEFAULT_OBSERVER_PC);
  }

  function getSceneScale(state) {
    return normalizePositiveNumber(state?.starFieldScale, defaultSceneScale);
  }

  function writeObserverPc(state, observerPc) {
    state.observerPc = clonePoint(observerPc);
    stats = {
      ...stats,
      observerPc: clonePoint(observerPc),
    };
  }

  function ensureState(context) {
    if (!context.state || typeof context.state !== 'object') {
      throw new TypeError('XRLocomotionController requires a mutable runtime state object');
    }

    if (!context.state.observerPc) {
      writeObserverPc(
        context.state,
        normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC) ?? clonePoint(DEFAULT_OBSERVER_PC),
      );
    }

    if (!Number.isFinite(context.state.starFieldScale) || context.state.starFieldScale <= 0) {
      context.state.starFieldScale = defaultSceneScale;
    }
  }

  function applyRigFromState(context) {
    const observerPc = getObserverPc(context.state);
    const sceneScale = getSceneScale(context.state);
    const [sceneX, sceneY, sceneZ] = icrsToSceneTransform(
      observerPc.x * sceneScale,
      observerPc.y * sceneScale,
      observerPc.z * sceneScale,
    );

    context.navigationRoot.position.set(sceneX, sceneY, sceneZ);
    context.contentRoot.scale.setScalar(sceneScale / SCALE);

    stats = {
      ...stats,
      observerPc: clonePoint(observerPc),
      sceneScale,
      presenting: context.xr?.presenting === true,
    };
  }

  return {
    id,
    getStats() {
      return {
        ...stats,
        observerPc: clonePoint(stats.observerPc),
        locomotionAxes: { ...stats.locomotionAxes },
      };
    },
    attach(context) {
      ensureState(context);
      applyRigFromState(context);
    },
    update(context) {
      ensureState(context);
      applyRigFromState(context);

      if (context.xr?.presenting !== true) {
        stats = {
          ...stats,
          activeHand: null,
          locomotionAxes: { x: 0, y: 0 },
        };
        return;
      }

      const axes = readXrLocomotionAxes(context.xr?.session?.inputSources ?? [], { deadzone });
      stats = {
        ...stats,
        activeHand: axes.activeHand,
        locomotionAxes: {
          x: axes.x,
          y: axes.y,
        },
      };

      if (axes.x === 0 && axes.y === 0) {
        return;
      }

      context.camera.updateMatrixWorld();
      context.camera.getWorldQuaternion(cameraWorldQuaternion);
      forward.copy(DEFAULT_FORWARD).applyQuaternion(cameraWorldQuaternion);
      forward.y = 0;
      if (forward.lengthSq() === 0) {
        forward.copy(DEFAULT_FORWARD);
      } else {
        forward.normalize();
      }

      right.crossVectors(forward, WORLD_UP);
      if (right.lengthSq() === 0) {
        right.set(1, 0, 0);
      } else {
        right.normalize();
      }

      movement
        .copy(right)
        .multiplyScalar(axes.x)
        .addScaledVector(forward, -axes.y);

      const movementStrength = movement.length();
      if (!(movementStrength > 0)) {
        return;
      }

      const sceneScale = getSceneScale(context.state);
      const nextObserverPc = moveObserverPcFromSceneDirection(
        getObserverPc(context.state),
        movement.normalize(),
        (moveSpeedWorldUnitsPerSecond * movementStrength * Math.max(0, context.frame?.deltaSeconds ?? 0)) / sceneScale,
        sceneToIcrsTransform,
      );

      writeObserverPc(context.state, nextObserverPc);
      applyRigFromState(context);
    },
  };
}
