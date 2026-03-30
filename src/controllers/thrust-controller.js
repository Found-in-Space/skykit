import * as THREE from 'three';
import { normalizePoint } from '../fields/octree-selection.js';
import { identityIcrsToSceneTransform, identitySceneToIcrsTransform } from '../layers/scene-orientation.js';
import { moveObserverPcFromSceneDirection } from './free-fly-controller.js';
import { SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_THROTTLE_ACCELERATION_PC_PER_SECOND2 = 10;
const DEFAULT_MAX_SPEED_PC_PER_SECOND = 45;
const DEFAULT_BRAKE_FACTOR = 2;
const DEFAULT_DRAG_COEFFICIENT = 0;
const DEFAULT_ROTATION_SENSITIVITY = 0.0025;
const DEFAULT_PITCH_LIMIT_RAD = Math.PI / 2 - 0.05;
const DEFAULT_KEYBOARD_TURN_SPEED_RAD_PER_SECOND = 1.6;

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function normalizePositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') {
    return false;
  }

  if (target.isContentEditable === true) {
    return true;
  }

  const tagName = typeof target.tagName === 'string'
    ? target.tagName.toUpperCase()
    : '';
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function createThrustController(options = {}) {
  const id = options.id ?? 'thrust-controller';
  const sceneScale = normalizePositiveNumber(options.sceneScale, SCALE);
  const thrustAcceleration = normalizePositiveNumber(
    options.thrustAcceleration,
    DEFAULT_THROTTLE_ACCELERATION_PC_PER_SECOND2,
  );
  const maxSpeed = normalizePositiveNumber(options.maxSpeed, DEFAULT_MAX_SPEED_PC_PER_SECOND);
  const brakeFactor = normalizePositiveNumber(options.brakeFactor, DEFAULT_BRAKE_FACTOR);
  const dragCoefficient = Number.isFinite(options.dragCoefficient)
    ? Math.max(0, Number(options.dragCoefficient))
    : DEFAULT_DRAG_COEFFICIENT;
  const rotationSpeed = normalizePositiveNumber(options.rotationSpeed, DEFAULT_ROTATION_SENSITIVITY);
  const pitchLimitRad = normalizePositiveNumber(options.pitchLimitRad, DEFAULT_PITCH_LIMIT_RAD);
  const keyboardTurnSpeed = normalizePositiveNumber(
    options.keyboardTurnSpeed,
    DEFAULT_KEYBOARD_TURN_SPEED_RAD_PER_SECOND,
  );
  const icrsToSceneTransform = typeof options.icrsToSceneTransform === 'function'
    ? options.icrsToSceneTransform
    : identityIcrsToSceneTransform;
  const sceneToIcrsTransform = typeof options.sceneToIcrsTransform === 'function'
    ? options.sceneToIcrsTransform
    : identitySceneToIcrsTransform;

  const pressedKeys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const velocityScene = new THREE.Vector3();
  const velocityScratch = new THREE.Vector3();
  const positionScene = new THREE.Vector3();

  let pointerTarget = null;
  let keyboardTarget = null;
  let dragPointerId = null;
  let dragLastX = 0;
  let dragLastY = 0;
  let orientationInitialized = false;
  let lastObserverPc = clonePoint(DEFAULT_OBSERVER_PC);
  let speedPcPerSecond = 0;
  let stats = {
    observerPc: clonePoint(DEFAULT_OBSERVER_PC),
    pointerActive: false,
    moving: false,
    yawRad: 0,
    pitchRad: 0,
    speedPcPerSecond: 0,
  };

  function getObserverPc(state) {
    return normalizePoint(
      state?.observerPc,
      normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC) ?? DEFAULT_OBSERVER_PC,
    ) ?? clonePoint(DEFAULT_OBSERVER_PC);
  }

  function writeObserverPc(state, observerPc) {
    state.observerPc = clonePoint(observerPc);
    lastObserverPc = clonePoint(observerPc);
    stats = {
      ...stats,
      observerPc: clonePoint(observerPc),
    };
  }

  function applyCameraPose(context) {
    const observerPc = getObserverPc(context.state);
    const [sceneX, sceneY, sceneZ] = icrsToSceneTransform(
      observerPc.x * sceneScale,
      observerPc.y * sceneScale,
      observerPc.z * sceneScale,
    );

    positionScene.set(sceneX, sceneY, sceneZ);
    context.camera.position.copy(positionScene);
    context.camera.quaternion.setFromEuler(euler);
  }

  function onPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    dragPointerId = event.pointerId;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    if (pointerTarget?.style) {
      pointerTarget.style.cursor = 'grabbing';
    }
    if (typeof pointerTarget?.setPointerCapture === 'function') {
      try {
        pointerTarget.setPointerCapture(event.pointerId);
      } catch (_) {
        // Ignore capture failures on non-DOM test doubles.
      }
    }
  }

  function onPointerMove(event) {
    if (dragPointerId == null || event.pointerId !== dragPointerId) {
      return;
    }

    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    dragLastX = event.clientX;
    dragLastY = event.clientY;

    euler.y -= dx * rotationSpeed;
    euler.x -= dy * rotationSpeed;
    euler.x = Math.max(-pitchLimitRad, Math.min(pitchLimitRad, euler.x));
  }

  function endPointerDrag(event) {
    if (dragPointerId == null || event.pointerId !== dragPointerId) {
      return;
    }

    if (typeof pointerTarget?.releasePointerCapture === 'function') {
      try {
        pointerTarget.releasePointerCapture(event.pointerId);
      } catch (_) {
        // Ignore release failures on non-DOM test doubles.
      }
    }
    dragPointerId = null;
    if (pointerTarget?.style) {
      pointerTarget.style.cursor = '';
    }
  }

  function onKeyDown(event) {
    if (event.repeat || isEditableTarget(event.target)) {
      return;
    }

    const supported = [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ];
    if (!supported.includes(event.code)) {
      return;
    }

    pressedKeys.add(event.code);
    event.preventDefault();
  }

  function onKeyUp(event) {
    if (!pressedKeys.has(event.code)) {
      return;
    }
    pressedKeys.delete(event.code);
    event.preventDefault();
  }

  return {
    id,
    get speed() {
      return speedPcPerSecond;
    },
    get velocity() {
      return velocityScene.clone();
    },
    get position() {
      return positionScene.clone();
    },
    getStats() {
      return {
        ...stats,
        observerPc: clonePoint(stats.observerPc),
        speedPcPerSecond,
        velocityScene: {
          x: velocityScene.x,
          y: velocityScene.y,
          z: velocityScene.z,
        },
      };
    },
    attach(context) {
      pointerTarget = options.pointerTarget ?? context.canvas ?? null;
      keyboardTarget = options.keyboardTarget ?? globalThis.window ?? null;

      if (!context.state || typeof context.state !== 'object') {
        throw new TypeError('ThrustController requires a mutable runtime state object');
      }

      if (!context.state.observerPc) {
        writeObserverPc(
          context.state,
          normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC) ?? clonePoint(DEFAULT_OBSERVER_PC),
        );
      } else {
        lastObserverPc = getObserverPc(context.state);
      }

      if (!orientationInitialized) {
        euler.setFromQuaternion(context.camera.quaternion, 'YXZ');
        orientationInitialized = true;
      }
      applyCameraPose(context);

      pointerTarget?.addEventListener?.('pointerdown', onPointerDown);
      pointerTarget?.addEventListener?.('pointermove', onPointerMove);
      pointerTarget?.addEventListener?.('pointerup', endPointerDrag);
      pointerTarget?.addEventListener?.('pointercancel', endPointerDrag);
      keyboardTarget?.addEventListener?.('keydown', onKeyDown);
      keyboardTarget?.addEventListener?.('keyup', onKeyUp);
    },
    update(context) {
      const deltaSeconds = Math.max(0, context.frame?.deltaSeconds ?? 0);
      if (!(deltaSeconds > 0)) {
        applyCameraPose(context);
        return;
      }

      const yawAxis = (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight') ? 1 : 0)
        - (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft') ? 1 : 0);
      if (yawAxis !== 0) {
        euler.y -= yawAxis * keyboardTurnSpeed * deltaSeconds;
      }

      const thrustAxis = (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp') ? 1 : 0)
        - (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown') ? 1 : 0);
      if (thrustAxis !== 0) {
        forward.set(0, 0, -1).applyEuler(euler).normalize();
        const accel = thrustAxis > 0 ? thrustAcceleration : thrustAcceleration * brakeFactor;
        velocityScene.addScaledVector(forward, accel * thrustAxis * deltaSeconds);
      }

      if (dragCoefficient > 0 && velocityScene.lengthSq() > 0) {
        const dragScale = Math.max(0, 1 - dragCoefficient * deltaSeconds);
        velocityScene.multiplyScalar(dragScale);
      }

      const speed = velocityScene.length();
      if (speed > maxSpeed) {
        velocityScene.multiplyScalar(maxSpeed / speed);
      } else if (speed < 1e-6) {
        velocityScene.set(0, 0, 0);
      }

      speedPcPerSecond = velocityScene.length();
      let nextObserverPc = getObserverPc(context.state);
      if (speedPcPerSecond > 0) {
        velocityScratch.copy(velocityScene).normalize();
        nextObserverPc = moveObserverPcFromSceneDirection(
          nextObserverPc,
          velocityScratch,
          speedPcPerSecond * deltaSeconds,
          sceneToIcrsTransform,
        );
        writeObserverPc(context.state, nextObserverPc);
      } else if (
        nextObserverPc.x !== lastObserverPc.x
        || nextObserverPc.y !== lastObserverPc.y
        || nextObserverPc.z !== lastObserverPc.z
      ) {
        lastObserverPc = clonePoint(nextObserverPc);
      }

      applyCameraPose(context);
      stats = {
        ...stats,
        moving: speedPcPerSecond > 0.001,
        pointerActive: dragPointerId != null,
        yawRad: euler.y,
        pitchRad: euler.x,
        speedPcPerSecond,
      };
    },
    dispose() {
      pressedKeys.clear();
      pointerTarget?.removeEventListener?.('pointerdown', onPointerDown);
      pointerTarget?.removeEventListener?.('pointermove', onPointerMove);
      pointerTarget?.removeEventListener?.('pointerup', endPointerDrag);
      pointerTarget?.removeEventListener?.('pointercancel', endPointerDrag);
      keyboardTarget?.removeEventListener?.('keydown', onKeyDown);
      keyboardTarget?.removeEventListener?.('keyup', onKeyUp);
      dragPointerId = null;
      if (pointerTarget?.style) {
        pointerTarget.style.cursor = '';
      }
      pointerTarget = null;
      keyboardTarget = null;
      velocityScene.set(0, 0, 0);
      speedPcPerSecond = 0;
    },
  };
}
