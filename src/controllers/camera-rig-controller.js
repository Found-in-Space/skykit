import * as THREE from 'three';
import { normalizePoint } from '../fields/octree-selection.js';
import { createCameraRig, LOCAL_RIGHT, LOCAL_UP, LOCAL_FORWARD } from './camera-rig.js';
import {
  advanceOrbitalInsertAutomation,
  buildPolylineRoute,
  createOrbitalInsertAutomation,
  deriveOrbitAngle,
  samplePolylineRoutePosition,
} from './camera-routes.js';

function clonePoint(p) {
  return p ? { x: p.x, y: p.y, z: p.z } : null;
}

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDirectionInput(direction) {
  if (!Array.isArray(direction) || direction.length !== 3) {
    return null;
  }
  const [x, y, z] = direction;
  if (![x, y, z].every(Number.isFinite)) {
    return null;
  }
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) {
    return null;
  }
  return [x / length, y / length, z / length];
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable === true) return true;
  const tag = (typeof target.tagName === 'string' ? target.tagName : '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function keyAxis(pressed, positive, negative) {
  let value = 0;
  for (const code of positive) if (pressed.has(code)) value += 1;
  for (const code of negative) if (pressed.has(code)) value -= 1;
  return value;
}

const MOVE_KEYS = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'KeyC', 'KeyX',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
];
const LOOK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];

export function createCameraRigController(options = {}) {
  const id = options.id ?? 'camera-rig-controller';
  const integration = options.integration === 'inertial' ? 'inertial' : 'direct';

  const moveSpeed = positiveFinite(options.moveSpeed, 12);
  const lookSensitivity = positiveFinite(options.lookSensitivity, 0.0025);
  const keyboardTurnSpeed = positiveFinite(options.keyboardTurnSpeed, 1.0);
  const rollSpeed = positiveFinite(options.rollSpeed, 1.0);
  const getForwardSpeed = typeof options.getForwardSpeed === 'function'
    ? options.getForwardSpeed
    : () => 0;

  const thrustAcceleration = positiveFinite(options.thrustAcceleration, 10);
  const maxSpeed = positiveFinite(options.maxSpeed, 45);
  const brakeFactor = positiveFinite(options.brakeFactor, 2);
  const dragCoefficient = Number.isFinite(options.dragCoefficient)
    ? Math.max(0, Number(options.dragCoefficient))
    : 0;

  const rig = createCameraRig({
    observerPc: options.observerPc,
    lookAtPc: options.lookAtPc,
    sceneScale: options.sceneScale,
    icrsToSceneTransform: options.icrsToSceneTransform,
    sceneToIcrsTransform: options.sceneToIcrsTransform,
  });

  const pressedKeys = new Set();
  let pointerTarget = null;
  let keyboardTarget = null;
  let dragPointerId = null;
  let dragLastX = 0;
  let dragLastY = 0;
  let lastObserverPc = rig.clonePosition();

  let movementAutomation = null;
  let orientationAutomation = null;
  let secondsSinceManualLookInput = Number.POSITIVE_INFINITY;

  const _movement = new THREE.Vector3();
  const _worldMovement = new THREE.Vector3();
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();

  // --- Universal motion tracking ---
  const _motionPrevOrientation = new THREE.Quaternion();
  let _motionPrevPos = rig.clonePosition();
  let _motionPrevSpeed = 0;
  let _motionStats = null;

  function updateMotionStats(dt) {
    const pos = rig.clonePosition();
    let vx = 0;
    let vy = 0;
    let vz = 0;
    let speed = 0;
    let accel = 0;
    let angVel = 0;

    if (dt > 0 && _motionPrevPos) {
      vx = (pos.x - _motionPrevPos.x) / dt;
      vy = (pos.y - _motionPrevPos.y) / dt;
      vz = (pos.z - _motionPrevPos.z) / dt;
      speed = Math.hypot(vx, vy, vz);
      accel = (speed - _motionPrevSpeed) / dt;
      angVel = rig.orientation.angleTo(_motionPrevOrientation) / dt;
    }

    const fwd = rig.getForward();
    const fwdX = fwd.x;
    const fwdY = fwd.y;
    const fwdZ = fwd.z;
    const [fx, fy, fz] = rig.sceneToIcrs(fwdX, fwdY, fwdZ);
    const fLen = Math.hypot(fx, fy, fz);

    _motionPrevPos = pos;
    _motionPrevSpeed = speed;
    _motionPrevOrientation.copy(rig.orientation);

    _motionStats = {
      observerPc: pos,
      orientationQ: {
        x: rig.orientation.x,
        y: rig.orientation.y,
        z: rig.orientation.z,
        w: rig.orientation.w,
      },
      forwardIcrs: fLen > 0
        ? { x: fx / fLen, y: fy / fLen, z: fz / fLen }
        : { x: 0, y: 0, z: -1 },
      velocityPcPerSec: { x: vx, y: vy, z: vz },
      speedPcPerSec: speed,
      angularVelocityRadPerSec: angVel,
      accelerationPcPerSec2: accel,
    };
  }

  let stats = {
    observerPc: rig.clonePosition(),
    pointerActive: false,
    moving: false,
    automation: null,
    movementAutomation: null,
    orientationAutomation: null,
  };

  function deriveAutomationStat() {
    return movementAutomation?.type ?? orientationAutomation?.type ?? null;
  }

  function noteManualLookInput() {
    secondsSinceManualLookInput = 0;
  }

  function resolveCurrentLookTarget(distancePc = 1) {
    const forwardScene = rig.getForward();
    const [ix, iy, iz] = rig.sceneToIcrs(forwardScene.x, forwardScene.y, forwardScene.z);
    const length = Math.hypot(ix, iy, iz);
    if (!(length > 0)) {
      return null;
    }
    const distance = positiveFinite(distancePc, 1);
    return {
      x: rig.positionPc.x + (ix / length) * distance,
      y: rig.positionPc.y + (iy / length) * distance,
      z: rig.positionPc.z + (iz / length) * distance,
    };
  }

  // --- Pointer handlers ---

  function onPointerDown(event) {
    if (event.button !== 0) return;
    dragPointerId = event.pointerId;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    if (pointerTarget?.style) pointerTarget.style.cursor = 'grabbing';
    if (typeof pointerTarget?.setPointerCapture === 'function') {
      try { pointerTarget.setPointerCapture(event.pointerId); } catch (_) { /* non-DOM */ }
    }
  }

  function onPointerMove(event) {
    if (dragPointerId == null || event.pointerId !== dragPointerId) return;
    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    dragLastX = event.clientX;
    dragLastY = event.clientY;

    noteManualLookInput();
    rig.rotateLocal(LOCAL_UP, -dx * lookSensitivity);
    rig.rotateLocal(LOCAL_RIGHT, -dy * lookSensitivity);
  }

  function onPointerEnd(event) {
    if (dragPointerId == null || event.pointerId !== dragPointerId) return;
    if (typeof pointerTarget?.releasePointerCapture === 'function') {
      try { pointerTarget.releasePointerCapture(event.pointerId); } catch (_) { /* non-DOM */ }
    }
    dragPointerId = null;
    if (pointerTarget?.style) pointerTarget.style.cursor = '';
  }

  // --- Keyboard handlers ---

  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    if (!MOVE_KEYS.includes(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    pressedKeys.add(event.code);
    if (LOOK_KEYS.includes(event.code)) {
      noteManualLookInput();
    }
  }

  function onKeyUp(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!pressedKeys.has(event.code)) return;
    pressedKeys.delete(event.code);
    event.preventDefault();
  }

  // --- Update modes ---

  function updateFreeFly(context) {
    const dt = Math.max(0, context.frame?.deltaSeconds ?? 0);

    const lookStep = keyboardTurnSpeed * dt;
    if (lookStep > 0) {
      const yaw = keyAxis(pressedKeys, ['KeyD'], ['KeyA']);
      const pitch = keyAxis(pressedKeys, ['KeyS'], ['KeyW']);
      if (yaw !== 0) rig.rotateLocal(LOCAL_UP, -yaw * lookStep);
      if (pitch !== 0) rig.rotateLocal(LOCAL_RIGHT, pitch * lookStep);
    }

    const roll = keyAxis(pressedKeys, ['KeyE'], ['KeyQ']);
    if (roll !== 0) rig.rotateLocal(LOCAL_FORWARD, -roll * rollSpeed * dt);

    _movement.set(
      keyAxis(pressedKeys, ['ArrowRight'], ['ArrowLeft']),
      0,
      keyAxis(pressedKeys, ['ArrowDown', 'KeyX'], ['ArrowUp', 'KeyC']),
    );

    if (_movement.lengthSq() > 0) {
      _movement.normalize();
      _worldMovement.copy(_movement).applyQuaternion(rig.orientation);
      rig.moveInSceneDirection(_worldMovement, moveSpeed * dt);
    }

    const forwardSpeedPcPerSec = Math.max(0, getForwardSpeed());
    if (forwardSpeedPcPerSec > 0) {
      _forward.set(0, 0, -1).applyQuaternion(rig.orientation);
      rig.moveInSceneDirection(_forward, forwardSpeedPcPerSec * dt);
    }

    stats = {
      ...stats,
      observerPc: rig.clonePosition(),
      pointerActive: dragPointerId != null,
      moving: _movement.lengthSq() > 0 || forwardSpeedPcPerSec > 0,
    };
  }

  function updateInertial(context) {
    const dt = Math.max(0, context.frame?.deltaSeconds ?? 0);
    if (!(dt > 0)) {
      return;
    }

    const yaw = keyAxis(pressedKeys, ['KeyD'], ['KeyA']);
    if (yaw !== 0) rig.rotateLocal(LOCAL_UP, -yaw * keyboardTurnSpeed * dt);

    const pitch = keyAxis(pressedKeys, ['KeyS'], ['KeyW']);
    if (pitch !== 0) rig.rotateLocal(LOCAL_RIGHT, pitch * keyboardTurnSpeed * dt);

    const roll = keyAxis(pressedKeys, ['KeyE'], ['KeyQ']);
    if (roll !== 0) rig.rotateLocal(LOCAL_FORWARD, -roll * rollSpeed * dt);

    const forwardThrustInput = keyAxis(pressedKeys, ['ArrowUp', 'KeyC'], ['ArrowDown', 'KeyX']);
    if (forwardThrustInput !== 0) {
      _forward.set(0, 0, -1).applyQuaternion(rig.orientation).normalize();
      const accel = forwardThrustInput > 0 ? thrustAcceleration : thrustAcceleration * brakeFactor;
      rig.velocity.addScaledVector(_forward, accel * forwardThrustInput * dt);
    }

    const strafeThrustInput = keyAxis(pressedKeys, ['ArrowRight'], ['ArrowLeft']);
    if (strafeThrustInput !== 0) {
      _right.set(1, 0, 0).applyQuaternion(rig.orientation).normalize();
      rig.velocity.addScaledVector(_right, thrustAcceleration * strafeThrustInput * dt);
    }

    if (dragCoefficient > 0 && rig.velocity.lengthSq() > 0) {
      rig.velocity.multiplyScalar(Math.max(0, 1 - dragCoefficient * dt));
    }

    const speed = rig.velocity.length();
    if (speed > maxSpeed) {
      rig.velocity.multiplyScalar(maxSpeed / speed);
    } else if (speed < 1e-6) {
      rig.velocity.set(0, 0, 0);
    }

    const currentSpeed = rig.velocity.length();
    if (currentSpeed > 0) {
      _worldMovement.copy(rig.velocity).normalize();
      rig.moveInSceneDirection(_worldMovement, currentSpeed * dt);
    }

    stats = {
      ...stats,
      observerPc: rig.clonePosition(),
      pointerActive: dragPointerId != null,
      moving: currentSpeed > 0.001,
      speedPcPerSecond: currentSpeed,
    };
  }

  function beginFlyTo(targetPc, opts = {}) {
    const target = normalizePoint(targetPc, null);
    if (!target) return false;
    const durationSecs = Number.isFinite(opts.durationSecs) && opts.durationSecs > 0
      ? opts.durationSecs
      : null;
    movementAutomation = {
      type: 'flyTo',
      target,
      speed: durationSecs == null ? positiveFinite(opts.speed, moveSpeed) : null,
      durationSecs,
      elapsedSecs: 0,
      deceleration: positiveFinite(opts.deceleration, 2),
      arrivalThreshold: positiveFinite(opts.arrivalThreshold, 0.01),
      onArrive: typeof opts.onArrive === 'function' ? opts.onArrive : null,
    };
    return true;
  }

  function beginOrbit(centerPc, opts = {}) {
    const center = normalizePoint(centerPc, null);
    if (!center) return false;
    const dx = rig.positionPc.x - center.x;
    const dy = rig.positionPc.y - center.y;
    const dz = rig.positionPc.z - center.z;
    const currentRadius = Math.hypot(dx, dy, dz);
    const initialAngle = Number.isFinite(opts.initialAngle)
      ? Number(opts.initialAngle)
      : deriveOrbitAngle(center, rig.positionPc, {
        icrsToSceneTransform: rig.icrsToScene,
      });
    movementAutomation = {
      type: 'orbit',
      center,
      radius: positiveFinite(opts.radius, currentRadius || 1),
      angularSpeed: opts.angularSpeed ?? 0.1,
      angle: initialAngle,
    };
    return true;
  }

  function beginOrbitalInsert(centerPc, opts = {}) {
    const center = normalizePoint(centerPc, null);
    if (!center) return false;

    const dx = rig.positionPc.x - center.x;
    const dy = rig.positionPc.y - center.y;
    const dz = rig.positionPc.z - center.z;
    const currentDistance = Math.hypot(dx, dy, dz);
    const orbitRadius = positiveFinite(opts.orbitRadius, currentDistance || 1);
    const angularSpeed = opts.angularSpeed ?? 0.1;
    const approachSpeed = positiveFinite(opts.approachSpeed ?? opts.speed, moveSpeed);
    const deceleration = positiveFinite(opts.deceleration, 2);
    const onInserted = typeof opts.onInserted === 'function' ? opts.onInserted : null;

    if (currentDistance <= orbitRadius * 1.01) {
      const angle = deriveOrbitAngle(center, rig.positionPc, {
        icrsToSceneTransform: rig.icrsToScene,
      });
      const radiusDelta = Math.abs(currentDistance - orbitRadius);

      if (radiusDelta < orbitRadius * 0.03) {
        movementAutomation = {
          type: 'orbit',
          center,
          radius: orbitRadius,
          angularSpeed,
          angle,
        };
      } else {
        movementAutomation = {
          type: 'orbit',
          center,
          radius: currentDistance,
          angularSpeed,
          angle,
          targetRadius: orbitRadius,
          radiusSpeed: approachSpeed,
          radiusDecel: deceleration,
        };
      }

      onInserted?.();
      return true;
    }

    const automation = createOrbitalInsertAutomation(rig.positionPc, {
      ...opts,
      centerPc: center,
      sceneScale: rig.sceneScale,
      sceneToIcrsTransform: rig.sceneToIcrs,
      icrsToSceneTransform: rig.icrsToScene,
    });
    if (!automation) {
      return false;
    }

    automation.onInserted = onInserted;
    movementAutomation = automation;
    return true;
  }

  function beginFlyPolyline(points, opts = {}) {
    const path = buildPolylineRoute(points);
    if (!Array.isArray(path.segments) || path.segments.length === 0 || !(path.totalLengthPc > 0)) {
      return false;
    }

    const durationSecs = Number.isFinite(opts.durationSecs) && opts.durationSecs > 0
      ? opts.durationSecs
      : null;
    const startPoint = path.points[0];
    if (startPoint && clonePoint(rig.positionPc) && Math.hypot(
      rig.positionPc.x - startPoint.x,
      rig.positionPc.y - startPoint.y,
      rig.positionPc.z - startPoint.z,
    ) < 1e-3) {
      rig.setPosition(startPoint);
    }

    movementAutomation = {
      type: 'flyPolyline',
      path,
      distancePc: 0,
      speed: durationSecs == null ? positiveFinite(opts.speed, moveSpeed) : null,
      durationSecs,
      elapsedSecs: 0,
      deceleration: positiveFinite(opts.deceleration, 2),
      arrivalThreshold: positiveFinite(opts.arrivalThreshold, 0.01),
      arrivalAction: opts.arrivalAction ?? null,
      onArrive: typeof opts.onArrive === 'function' ? opts.onArrive : null,
    };
    return true;
  }

  function finishMovementWithArrivalAction(action, callback) {
    if (!action || typeof action !== 'object') {
      movementAutomation = null;
      callback?.();
      return false;
    }

    if (action.type === 'orbit') {
      const started = beginOrbit(action.centerPc ?? action.center, {
        radius: action.radius,
        angularSpeed: action.angularSpeed,
        initialAngle: action.initialAngle,
      });
      if (!started) {
        movementAutomation = null;
      }
      callback?.();
      return started;
    }

    if (action.type === 'orbitalInsert') {
      const started = beginOrbitalInsert(action.centerPc ?? action.center, {
        ...action,
        onInserted: callback,
      });
      if (!started) {
        movementAutomation = null;
        callback?.();
      }
      return started;
    }

    movementAutomation = null;
    callback?.();
    return false;
  }

  // --- Automation ---

  function updateMovementAutomation(context) {
    if (!movementAutomation) return false;
    const dt = Math.max(0, context.frame?.deltaSeconds ?? 0);
    if (!(dt > 0)) return true;

    if (movementAutomation.type === 'flyTo') {
      const auto = movementAutomation;
      const t = auto.target;
      const dx = t.x - rig.positionPc.x;
      const dy = t.y - rig.positionPc.y;
      const dz = t.z - rig.positionPc.z;
      const distance = Math.hypot(dx, dy, dz);

      if (distance < (auto.arrivalThreshold ?? 0.01)) {
        rig.setPosition(t);
        const cb = auto.onArrive;
        movementAutomation = null;
        cb?.();
        return false;
      }

      let speed;
      if (auto.durationSecs != null) {
        auto.elapsedSecs += dt;
        const remainingSecs = Math.max(auto.durationSecs - auto.elapsedSecs, 0.05);
        // Remaining-time tracking: speed = distance/remaining gives linear approach
        // (D(t) = D0*(1-t/T)) with no decel cap needed — step is clamped to distance below.
        speed = distance / remainingSecs;
      } else {
        speed = Math.min(auto.speed, distance * auto.deceleration);
      }

      const step = Math.min(speed * dt, distance);
      rig.positionPc.x += (dx / distance) * step;
      rig.positionPc.y += (dy / distance) * step;
      rig.positionPc.z += (dz / distance) * step;
      return true;
    }

    if (movementAutomation.type === 'flyPolyline') {
      const auto = movementAutomation;
      const finalPoint = auto.path.points[auto.path.points.length - 1];
      const remainingDistance = Math.max(auto.path.totalLengthPc - auto.distancePc, 0);

      if (remainingDistance <= (auto.arrivalThreshold ?? 0.01)) {
        if (finalPoint) {
          rig.setPosition(finalPoint);
        }
        return finishMovementWithArrivalAction(auto.arrivalAction, auto.onArrive);
      }

      let speed;
      if (auto.durationSecs != null) {
        auto.elapsedSecs += dt;
        const remainingSecs = Math.max(auto.durationSecs - auto.elapsedSecs, 0.05);
        speed = remainingDistance / remainingSecs;
      } else {
        speed = Math.min(auto.speed, remainingDistance * auto.deceleration);
      }

      const step = Math.min(speed * dt, remainingDistance);
      auto.distancePc = Math.min(auto.distancePc + step, auto.path.totalLengthPc);
      const nextPosition = samplePolylineRoutePosition(auto.path, auto.distancePc);
      if (nextPosition) {
        rig.setPosition(nextPosition);
      }

      if ((auto.path.totalLengthPc - auto.distancePc) <= (auto.arrivalThreshold ?? 0.01)) {
        if (finalPoint) {
          rig.setPosition(finalPoint);
        }
        return finishMovementWithArrivalAction(auto.arrivalAction, auto.onArrive);
      }
      return true;
    }

    if (movementAutomation.type === 'orbit') {
      const auto = movementAutomation;

      if (auto.targetRadius != null) {
        const diff = auto.targetRadius - auto.radius;
        const absDiff = Math.abs(diff);
        const speed = Math.min(
          auto.radiusSpeed ?? 60,
          absDiff * (auto.radiusDecel ?? 2.5),
        );
        const step = speed * dt;
        if (absDiff <= step || absDiff < 0.01) {
          auto.radius = auto.targetRadius;
          auto.targetRadius = undefined;
          auto.radiusSpeed = undefined;
          auto.radiusDecel = undefined;
        } else {
          auto.radius += Math.sign(diff) * step;
        }
      }

      auto.angle += (auto.angularSpeed ?? 0.1) * dt;
      const { center, radius } = auto;
      const cosA = Math.cos(auto.angle);
      const sinA = Math.sin(auto.angle);
      const [ix, iy, iz] = rig.sceneToIcrs(
        cosA * radius * rig.sceneScale,
        0,
        sinA * radius * rig.sceneScale,
      );
      rig.positionPc.x = center.x + ix / rig.sceneScale;
      rig.positionPc.y = center.y + iy / rig.sceneScale;
      rig.positionPc.z = center.z + iz / rig.sceneScale;
      return true;
    }

    if (movementAutomation.type === 'orbitalInsert') {
      const auto = movementAutomation;
      const result = advanceOrbitalInsertAutomation(rig.positionPc, auto, dt);
      if (result.enteredOrbit) {
        const cb = auto.onInserted;
        movementAutomation = {
          type: 'orbit',
          center: auto.center,
          radius: auto.orbitRadius,
          angularSpeed: auto.angularSpeed,
          angle: result.angle,
        };
        cb?.();
        return true;
      }
      if (!result.active) {
        movementAutomation = null;
        return false;
      }
      return true;
    }

    return false;
  }

  function updateOrientationAutomation(context) {
    if (!orientationAutomation) return false;
    const dt = Math.max(0, context.frame?.deltaSeconds ?? 0);
    if (Number.isFinite(dt) && dt > 0 && Number.isFinite(secondsSinceManualLookInput)) {
      secondsSinceManualLookInput += dt;
    }

    if (orientationAutomation.type === 'lookAt') {
      const targetQ = rig.computeOrientationToward(
        orientationAutomation.target,
        orientationAutomation.upIcrs,
      );
      if (!targetQ) {
        orientationAutomation = null;
        return false;
      }
      const alpha = 1 - (1 - (orientationAutomation.blend ?? 0.05)) ** (Math.max(0, dt) * 60);
      rig.slerpToward(targetQ, alpha);

      const threshold = positiveFinite(orientationAutomation.arrivalThresholdRad, 0.01);
      if (rig.orientation.angleTo(targetQ) <= threshold) {
        rig.orientation.copy(targetQ);
        const cb = orientationAutomation.onArrive;
        orientationAutomation = null;
        cb?.();
        return false;
      }
      return true;
    }

    if (orientationAutomation.type === 'lockAt') {
      const dwellSecs = Math.max(0, Number(orientationAutomation.dwellSecs ?? 0));
      if (secondsSinceManualLookInput < dwellSecs) {
        return true;
      }
      const targetQ = rig.computeOrientationToward(
        orientationAutomation.target,
        orientationAutomation.upIcrs,
      );
      if (!targetQ) {
        return true;
      }
      const alpha = 1 - (1 - (orientationAutomation.recenterSpeed ?? 0.05)) ** (Math.max(0, dt) * 60);
      rig.slerpToward(targetQ, alpha);
      return true;
    }

    return false;
  }

  // --- State sync ---

  function writeToState(state) {
    state.observerPc = rig.clonePosition();
    state.observerSpeedPcPerSec = Number(_motionStats?.speedPcPerSec ?? 0);
    lastObserverPc = rig.clonePosition();
  }

  function readFromState(state) {
    const statePc = normalizePoint(state?.observerPc, null);
    if (!statePc) return;
    if (
      statePc.x !== lastObserverPc.x
      || statePc.y !== lastObserverPc.y
      || statePc.z !== lastObserverPc.z
    ) {
      rig.setPosition(statePc);
      lastObserverPc = clonePoint(statePc);
    }
  }

  // --- Event binding helpers ---

  function bindEvents() {
    pointerTarget?.addEventListener?.('pointerdown', onPointerDown);
    pointerTarget?.addEventListener?.('pointermove', onPointerMove);
    pointerTarget?.addEventListener?.('pointerup', onPointerEnd);
    pointerTarget?.addEventListener?.('pointercancel', onPointerEnd);
    keyboardTarget?.addEventListener?.('keydown', onKeyDown);
    keyboardTarget?.addEventListener?.('keyup', onKeyUp);
  }

  function unbindEvents() {
    pointerTarget?.removeEventListener?.('pointerdown', onPointerDown);
    pointerTarget?.removeEventListener?.('pointermove', onPointerMove);
    pointerTarget?.removeEventListener?.('pointerup', onPointerEnd);
    pointerTarget?.removeEventListener?.('pointercancel', onPointerEnd);
    keyboardTarget?.removeEventListener?.('keydown', onKeyDown);
    keyboardTarget?.removeEventListener?.('keyup', onKeyUp);
  }

  // --- Controller API ---

  return {
    id,
    rig,

    flyTo(targetPc, opts = {}) {
      beginFlyTo(targetPc, opts);
    },

    orbit(centerPc, opts = {}) {
      beginOrbit(centerPc, opts);
    },

    orbitalInsert(centerPc, opts = {}) {
      beginOrbitalInsert(centerPc, opts);
    },

    flyPolyline(points, opts = {}) {
      beginFlyPolyline(points, opts);
    },

    lookAt(targetPc, opts = {}) {
      const target = normalizePoint(targetPc, null);
      if (!target) return;
      orientationAutomation = {
        type: 'lookAt',
        target,
        upIcrs: normalizeDirectionInput(opts.upIcrs),
        blend: opts.blend ?? 0.05,
        arrivalThresholdRad: opts.arrivalThresholdRad ?? 0.01,
        onArrive: typeof opts.onArrive === 'function' ? opts.onArrive : null,
      };
      secondsSinceManualLookInput = Number.POSITIVE_INFINITY;
    },

    lockAt(targetPcOrOptions, opts = {}) {
      const hasTargetCandidate = normalizePoint(targetPcOrOptions, null) != null;
      const resolvedOptions = hasTargetCandidate ? opts : targetPcOrOptions ?? {};
      const target = normalizePoint(targetPcOrOptions, null)
        ?? resolveCurrentLookTarget(resolvedOptions.lockDistancePc);
      if (!target) return;
      orientationAutomation = {
        type: 'lockAt',
        target,
        upIcrs: normalizeDirectionInput(resolvedOptions.upIcrs),
        dwellSecs: Math.max(0, Number(resolvedOptions.dwellMs ?? 0)) / 1000,
        recenterSpeed: resolvedOptions.recenterSpeed ?? 0.05,
      };
      secondsSinceManualLookInput = Number.POSITIVE_INFINITY;
    },

    unlockAt() {
      if (orientationAutomation?.type === 'lockAt') {
        orientationAutomation = null;
      }
    },

    cancelMovement() {
      movementAutomation = null;
    },

    cancelOrientation() {
      orientationAutomation = null;
    },

    simulateKeyDown(code) {
      if (MOVE_KEYS.includes(code)) {
        pressedKeys.add(code);
        if (LOOK_KEYS.includes(code)) noteManualLookInput();
      }
    },

    simulateKeyUp(code) {
      pressedKeys.delete(code);
    },

    cancelAutomation() {
      movementAutomation = null;
      orientationAutomation = null;
    },

    getStats() {
      return {
        ...stats,
        motion: _motionStats ? { ..._motionStats } : null,
        observerPc: clonePoint(stats.observerPc),
        automation: deriveAutomationStat(),
        movementAutomation: movementAutomation?.type ?? null,
        orientationAutomation: orientationAutomation?.type ?? null,
      };
    },

    attach(context) {
      pointerTarget = options.pointerTarget ?? context.canvas ?? null;
      keyboardTarget = options.keyboardTarget ?? globalThis.window ?? null;

      if (!context.state || typeof context.state !== 'object') {
        throw new TypeError('CameraRigController requires a mutable runtime state object');
      }

      if (!context.state.observerPc) {
        writeToState(context.state);
      } else {
        const statePc = normalizePoint(context.state.observerPc, null);
        if (statePc) {
          rig.setPosition(statePc);
          lastObserverPc = clonePoint(statePc);
        }
      }

      const stateTarget = normalizePoint(context.state?.targetPc, null);
      const lookTarget = normalizePoint(options.lookAtPc, null) ?? stateTarget;
      if (lookTarget) rig.orientToward(lookTarget);

      rig.applyToCamera(context.camera);

      bindEvents();
    },

    start(context) {
      rig.applyToCamera(context.camera);
    },

    update(context) {
      readFromState(context.state);
      const dt = Math.max(0, context.frame?.deltaSeconds ?? 0);

      const isMovementAutomated = updateMovementAutomation(context);
      if (!isMovementAutomated) {
        if (integration === 'inertial') {
          updateInertial(context);
        } else {
          updateFreeFly(context);
        }
      }

      updateOrientationAutomation(context);
      rig.applyToCamera(context.camera);

      updateMotionStats(dt);
      writeToState(context.state);
      stats = {
        ...stats,
        motion: _motionStats,
        observerPc: rig.clonePosition(),
        automation: deriveAutomationStat(),
        movementAutomation: movementAutomation?.type ?? null,
        orientationAutomation: orientationAutomation?.type ?? null,
      };
    },

    dispose() {
      pressedKeys.clear();
      unbindEvents();
      dragPointerId = null;
      if (pointerTarget?.style) pointerTarget.style.cursor = '';
      pointerTarget = null;
      keyboardTarget = null;
      movementAutomation = null;
      orientationAutomation = null;
      rig.velocity.set(0, 0, 0);
    },
  };
}
