import * as THREE from 'three';
import { normalizePoint } from '../fields/octree-selection.js';
import { identityIcrsToSceneTransform, identitySceneToIcrsTransform } from '../layers/scene-orientation.js';
import { SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_MOVE_SPEED_PC_PER_SECOND = 12;
const DEFAULT_LOOK_SENSITIVITY = 0.0025;
const DEFAULT_PITCH_LIMIT_RAD = Math.PI / 2 - 0.05;

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
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

function createSignedKeyAxis(pressedKeys, positiveCodes, negativeCodes) {
  let value = 0;

  for (const code of positiveCodes) {
    if (pressedKeys.has(code)) {
      value += 1;
    }
  }

  for (const code of negativeCodes) {
    if (pressedKeys.has(code)) {
      value -= 1;
    }
  }

  return value;
}

function normalizePositiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function createLookEulerFromTarget(observerPc, targetPc, icrsToSceneTransform, sceneScale) {
  const observer = normalizePoint(observerPc, DEFAULT_OBSERVER_PC) ?? clonePoint(DEFAULT_OBSERVER_PC);
  const target = normalizePoint(targetPc, null);
  if (!target) {
    return null;
  }

  const directionPc = {
    x: target.x - observer.x,
    y: target.y - observer.y,
    z: target.z - observer.z,
  };

  const [sceneX, sceneY, sceneZ] = icrsToSceneTransform(
    directionPc.x * sceneScale,
    directionPc.y * sceneScale,
    directionPc.z * sceneScale,
  );
  const directionLength = Math.hypot(sceneX, sceneY, sceneZ);
  if (!(directionLength > 0)) {
    return null;
  }

  const aimCamera = new THREE.PerspectiveCamera();
  aimCamera.position.set(0, 0, 0);
  aimCamera.up.set(0, 1, 0);
  aimCamera.lookAt(
    sceneX / directionLength,
    sceneY / directionLength,
    sceneZ / directionLength,
  );

  return new THREE.Euler().setFromQuaternion(aimCamera.quaternion, 'YXZ');
}

export function moveObserverPcFromSceneDirection(
  observerPc,
  sceneDirection,
  distancePc,
  sceneToIcrsTransform = identitySceneToIcrsTransform,
) {
  const observer = normalizePoint(observerPc, DEFAULT_OBSERVER_PC) ?? clonePoint(DEFAULT_OBSERVER_PC);
  if (!(distancePc > 0)) {
    return observer;
  }

  const [icrsX, icrsY, icrsZ] = sceneToIcrsTransform(
    sceneDirection.x,
    sceneDirection.y,
    sceneDirection.z,
  );
  const length = Math.hypot(icrsX, icrsY, icrsZ);
  if (!(length > 0)) {
    return observer;
  }

  return {
    x: observer.x + (icrsX / length) * distancePc,
    y: observer.y + (icrsY / length) * distancePc,
    z: observer.z + (icrsZ / length) * distancePc,
  };
}

export function createFreeFlyController(options = {}) {
  const id = options.id ?? 'free-fly-controller';
  const sceneScale = normalizePositiveNumber(options.sceneScale, SCALE);
  const moveSpeedPcPerSecond = normalizePositiveNumber(
    options.moveSpeedPcPerSecond,
    DEFAULT_MOVE_SPEED_PC_PER_SECOND,
  );
  const lookSensitivity = normalizePositiveNumber(options.lookSensitivity, DEFAULT_LOOK_SENSITIVITY);
  const pitchLimitRad = normalizePositiveNumber(options.pitchLimitRad, DEFAULT_PITCH_LIMIT_RAD);
  const icrsToSceneTransform = typeof options.icrsToSceneTransform === 'function'
    ? options.icrsToSceneTransform
    : identityIcrsToSceneTransform;
  const sceneToIcrsTransform = typeof options.sceneToIcrsTransform === 'function'
    ? options.sceneToIcrsTransform
    : identitySceneToIcrsTransform;

  const pressedKeys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const lookQuaternion = new THREE.Quaternion();
  const localMovement = new THREE.Vector3();
  const worldMovement = new THREE.Vector3();

  let pointerTarget = null;
  let keyboardTarget = null;
  let dragPointerId = null;
  let dragLastX = 0;
  let dragLastY = 0;
  let orientationInitialized = false;
  let lastObserverPc = clonePoint(DEFAULT_OBSERVER_PC);
  let stats = {
    observerPc: clonePoint(DEFAULT_OBSERVER_PC),
    pointerActive: false,
    moving: false,
    yawRad: 0,
    pitchRad: 0,
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

    context.camera.position.set(sceneX, sceneY, sceneZ);
    context.camera.quaternion.setFromEuler(euler);

    stats = {
      ...stats,
      observerPc: clonePoint(observerPc),
      yawRad: euler.y,
      pitchRad: euler.x,
      pointerActive: dragPointerId != null,
    };
  }

  function ensureOrientation(context) {
    if (orientationInitialized) {
      return;
    }

    const observerPc = getObserverPc(context.state);
    const explicitTargetPc = normalizePoint(options.lookAtPc, null);
    const stateTargetPc = normalizePoint(context.state?.targetPc, null);
    const targetPc = explicitTargetPc ?? stateTargetPc;
    const targetEuler = targetPc
      ? createLookEulerFromTarget(observerPc, targetPc, icrsToSceneTransform, sceneScale)
      : null;

    if (targetEuler) {
      euler.copy(targetEuler);
    } else {
      euler.setFromQuaternion(context.camera.quaternion, 'YXZ');
    }

    orientationInitialized = true;
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

    euler.y -= dx * lookSensitivity;
    euler.x -= dy * lookSensitivity;
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
      'KeyQ',
      'KeyE',
      'Space',
      'ShiftLeft',
      'ShiftRight',
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
    getStats() {
      return {
        ...stats,
        observerPc: clonePoint(stats.observerPc),
      };
    },
    attach(context) {
      pointerTarget = options.pointerTarget ?? context.canvas ?? null;
      keyboardTarget = options.keyboardTarget ?? globalThis.window ?? null;

      if (!context.state || typeof context.state !== 'object') {
        throw new TypeError('FreeFlyController requires a mutable runtime state object');
      }

      if (!context.state.observerPc) {
        writeObserverPc(
          context.state,
          normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC) ?? clonePoint(DEFAULT_OBSERVER_PC),
        );
      } else {
        lastObserverPc = getObserverPc(context.state);
      }

      ensureOrientation(context);
      applyCameraPose(context);

      pointerTarget?.addEventListener?.('pointerdown', onPointerDown);
      pointerTarget?.addEventListener?.('pointermove', onPointerMove);
      pointerTarget?.addEventListener?.('pointerup', endPointerDrag);
      pointerTarget?.addEventListener?.('pointercancel', endPointerDrag);
      keyboardTarget?.addEventListener?.('keydown', onKeyDown);
      keyboardTarget?.addEventListener?.('keyup', onKeyUp);
    },
    update(context) {
      ensureOrientation(context);
      lookQuaternion.setFromEuler(euler);

      localMovement.set(
        createSignedKeyAxis(pressedKeys, ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
        createSignedKeyAxis(pressedKeys, ['KeyE', 'Space'], ['KeyQ', 'ShiftLeft', 'ShiftRight']),
        createSignedKeyAxis(pressedKeys, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
      );

      let nextObserverPc = getObserverPc(context.state);
      if (localMovement.lengthSq() > 0) {
        localMovement.normalize();
        worldMovement.copy(localMovement).applyQuaternion(lookQuaternion);
        nextObserverPc = moveObserverPcFromSceneDirection(
          nextObserverPc,
          worldMovement,
          moveSpeedPcPerSecond * Math.max(0, context.frame?.deltaSeconds ?? 0),
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

      stats = {
        ...stats,
        moving: localMovement.lengthSq() > 0,
      };
      applyCameraPose(context);
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
    },
  };
}
