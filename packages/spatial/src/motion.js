import {
  SPATIAL_IDENTITY_QUATERNION,
  SPATIAL_LOCAL_FORWARD,
  SPATIAL_LOCAL_RIGHT,
  SPATIAL_LOCAL_UP,
  SPATIAL_ZERO_VECTOR,
  addSpatialVectors,
  applySpatialQuaternion,
  cloneSpatialVector3,
  getSpatialVectorLength,
  normalizeSpatialDirection,
  normalizeSpatialScaleProfile,
  rotateSpatialLocalAxis,
  scaleSpatialVector,
} from './math.js';
import {
  EPSILON,
  finiteNumber,
  nonNegativeFiniteNumber,
  positiveFiniteNumber,
  timingTimeNearlyEqual,
} from './numerics.js';
import {
  deriveSpatialOrbitHandoff,
  evaluateSpatialOrbit,
  normalizeSpatialOrbitSpec,
} from './orbits.js';
import {
  cloneFrameState,
  cloneSpatialPose,
  evaluateSpatialAim,
  normalizeSpatialAimSpec,
  normalizeSpatialFrameState,
  normalizeSpatialPose,
} from './pose-aim.js';
import {
  evaluateSpatialRoute,
} from './routes.js';
import {
  assertSpatialCoordinateSpace,
  normalizeSpatialCoordinateSpace,
  spatialSpaceFor,
} from './spaces.js';

export function normalizeSpatialUpdateDelta(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected update delta input.');
  }
  if (!('deltaSecs' in input)) {
    throw new TypeError('deltaSecs is required.');
  }
  return nonNegativeFiniteNumber(input.deltaSecs, 'deltaSecs');
}

export function createDirectSpatialMotionModel(options = {}) {
  return createManualMotionModel(options, 'direct');
}

export function createInertialSpatialMotionModel(options = {}) {
  return createManualMotionModel(options, 'inertial');
}

export function createThrustSpatialMotionModel(options = {}) {
  return createManualMotionModel(options, 'thrust');
}

export function createSpatialNavigationAutomation(coordinateSpace) {
  const space = normalizeSpatialCoordinateSpace(coordinateSpace);
  let activeRoute = null;
  let activeOrbit = null;
  let activeAim = null;
  let targetLock = null;
  let elapsedSecs = 0;
  let frameState = normalizeSpatialFrameState({
    pose: { space, position: SPATIAL_ZERO_VECTOR, orientation: SPATIAL_IDENTITY_QUATERNION },
    aim: null,
  }, space);
  let currentSpeedUnitsPerSec = 0;
  let lastManualLookActive = false;
  let orientationSuppressed = false;
  /** @type {{ action: Extract<import('./index.d.ts').SpatialArrivalAction, { kind: 'orbit' }>; position: import('./index.d.ts').SpatialVector3; elapsedSecs: number; durationSecs: number } | null} */
  let pendingSettle = null;
  /** @type {{ elapsedSecs: number; durationSecs: number } | null} */
  let activeDwell = null;
  let disposed = false;

  return {
    flyRoute(route) {
      assertNavigationActive();
      assertSpatialCoordinateSpace(route.space, space);
      activeRoute = route;
      activeOrbit = null;
      pendingSettle = null;
      elapsedSecs = 0;
    },
    orbit(orbit) {
      assertNavigationActive();
      activeOrbit = normalizeSpatialOrbitSpec(orbit, space);
      activeRoute = null;
      pendingSettle = null;
      elapsedSecs = 0;
      orientationSuppressed = false;
    },
    lookAt(aim) {
      assertNavigationActive();
      activeAim = normalizeSpatialAimSpec(aim, space);
      targetLock = null;
      activeDwell = null;
      orientationSuppressed = false;
    },
    lockAt(aim) {
      assertNavigationActive();
      const normalized = normalizeSpatialAimSpec(aim, space);
      if (normalized.kind !== 'target') throw new TypeError('lockAt() requires target aim.');
      activeAim = normalized;
      targetLock = { target: cloneSpatialVector3(normalized.target), aim: null };
      activeDwell = null;
      orientationSuppressed = false;
    },
    unlockAt() {
      assertNavigationActive();
      if (targetLock) {
        targetLock = null;
        activeAim = null;
        activeDwell = null;
      }
    },
    cancelMovement() {
      assertNavigationActive();
      cancelMovementState();
    },
    cancelOrientation() {
      assertNavigationActive();
      cancelOrientationState();
    },
    cancel() {
      assertNavigationActive();
      cancelMovementState();
      cancelOrientationState();
    },
    update(input) {
      assertNavigationActive();
      const dt = normalizeSpatialUpdateDelta(input);
      assertSpatialCoordinateSpace(input.pose.space, space);
      if (input.manualLookActive !== undefined && typeof input.manualLookActive !== 'boolean') {
        throw new TypeError('manualLookActive must be a boolean.');
      }
      const dwellAtStart = activeDwell;
      lastManualLookActive = input.manualLookActive === true;
      elapsedSecs += dt;
      let pose = normalizeSpatialPose(input.pose, space);
      let routeSample = null;
      let orbitSample = null;
      if (pendingSettle) {
        pendingSettle.elapsedSecs += dt;
        pose = { ...pose, position: cloneSpatialVector3(pendingSettle.position) };
        currentSpeedUnitsPerSec = 0;
        if ((pendingSettle.elapsedSecs >= pendingSettle.durationSecs || timingTimeNearlyEqual(pendingSettle.elapsedSecs, pendingSettle.durationSecs))) {
          const action = pendingSettle.action;
          const arrivalPosition = pendingSettle.position;
          const settleOverflowSecs = Math.max(0, pendingSettle.elapsedSecs - pendingSettle.durationSecs);
          activateArrivalAction(action, settleOverflowSecs, arrivalPosition);
        }
      }
      if (activeRoute) {
        const sample = evaluateSpatialRoute(activeRoute, elapsedSecs);
        routeSample = sample;
        pose = { ...pose, position: sample.position };
        currentSpeedUnitsPerSec = sample.speedUnitsPerSec;
        if (sample.complete) {
          const routeDurationSecs = Math.max(0, finiteNumber(
            activeRoute.timing?.durationSecs,
            activeRoute.diagnostics?.durationSecs ?? 0,
          ));
          const overshootSecs = Math.max(0, elapsedSecs - routeDurationSecs);
          applyArrivalAction(activeRoute.arrivalAction, overshootSecs);
          if (!activeOrbit) activeRoute = null;
        }
      }
      if (activeOrbit) {
        orbitSample = evaluateSpatialOrbit(activeOrbit, elapsedSecs);
        pose = { ...pose, position: orbitSample.position };
        currentSpeedUnitsPerSec = orbitSample.speedUnitsPerSec;
      }
      if (dwellAtStart && activeDwell === dwellAtStart) {
        activeDwell.elapsedSecs += dt;
        if ((activeDwell.elapsedSecs >= activeDwell.durationSecs || timingTimeNearlyEqual(activeDwell.elapsedSecs, activeDwell.durationSecs))) {
          activeDwell = null;
          activeAim = null;
          targetLock = null;
        }
      }
      let aim = orbitSample && !orientationSuppressed ? orbitSample.aim : null;
      if (activeAim) {
        aim = evaluateSpatialAim({ space, position: pose.position, aim: activeAim });
      }
      if (aim && !lastManualLookActive) {
        pose = { ...pose, orientation: aim.orientation };
      }
      if (targetLock && aim?.kind === 'target') {
        targetLock = { target: cloneSpatialVector3(aim.target), aim };
      }
      frameState = {
        pose: cloneSpatialPose(pose),
        aim,
        targetLock,
        orbit: activeOrbit && orbitSample ? {
          orbit: activeOrbit,
          angleRad: orbitSample.angleRad,
          basis: orbitSample.basis,
          speedUnitsPerSec: orbitSample.speedUnitsPerSec,
        } : null,
        pathFollow: activeRoute && routeSample ? {
          routeId: activeRoute.id,
          routeKind: activeRoute.kind,
          distance: routeSample.distance,
          velocityUnitsPerSec: routeSample.velocityUnitsPerSec,
          speedUnitsPerSec: routeSample.speedUnitsPerSec,
          segmentIndex: routeSample.segmentIndex,
        } : null,
      };
      return cloneSpatialPose(pose);
    },
    getFrameState() {
      return cloneFrameState(frameState);
    },
    getDiagnostics() {
      return {
        space,
        activeMovement: activeRoute
          ? { kind: activeRoute.kind, route: activeRoute, distance: frameState.pathFollow?.distance ?? 0, totalLength: activeRoute.totalLength, speedUnitsPerSec: currentSpeedUnitsPerSec }
          : activeOrbit
            ? { kind: 'orbit', orbit: frameState.orbit, speedUnitsPerSec: currentSpeedUnitsPerSec }
            : { kind: 'idle', speedUnitsPerSec: 0 },
        activeAim: { aim: frameState.aim, targetLock, manualLookActive: lastManualLookActive },
        elapsedSecs,
        durationSecs: activeRoute?.timing?.durationSecs,
        frameState: cloneFrameState(frameState),
        activeRoute,
        activeTiming: activeRoute?.timing ?? null,
        currentSpeedUnitsPerSec,
        arrivalAction: activeRoute?.arrivalAction ?? pendingSettle?.action ?? null,
        pendingSettle: pendingSettle ? {
          behavior: 'continueOrbit',
          elapsedSecs: pendingSettle.elapsedSecs,
          durationSecs: pendingSettle.durationSecs,
          targetOrbit: pendingSettle.action.orbit,
        } : null,
        warnings: [],
      };
    },
    dispose() {
      disposed = true;
      activeRoute = null;
      activeOrbit = null;
      activeAim = null;
      targetLock = null;
      pendingSettle = null;
      activeDwell = null;
      currentSpeedUnitsPerSec = 0;
      lastManualLookActive = false;
    },
  };

  function assertNavigationActive() {
    if (disposed) throw new Error('Spatial navigation automation is disposed.');
  }

  function cancelMovementState() {
    activeRoute = null;
    activeOrbit = null;
    pendingSettle = null;
    elapsedSecs = 0;
    currentSpeedUnitsPerSec = 0;
    frameState = { ...frameState, orbit: null, pathFollow: null };
  }

  function cancelOrientationState() {
    activeAim = null;
    targetLock = null;
    activeDwell = null;
    orientationSuppressed = true;
    frameState = { ...frameState, aim: null, targetLock: null };
  }

  function applyArrivalAction(action, overshootSecs = 0) {
    if (!action || action.kind === 'none') return;
    const arrivalPosition = cloneSpatialVector3(activeRoute.arrival.position);
    if (action.kind === 'orbit' && (action.settleSecs ?? 0) > overshootSecs && !timingTimeNearlyEqual(action.settleSecs ?? 0, overshootSecs)) {
      pendingSettle = {
        action,
        position: arrivalPosition,
        elapsedSecs: overshootSecs,
        durationSecs: action.settleSecs ?? 0,
      };
      activeRoute = null;
      activeOrbit = null;
      currentSpeedUnitsPerSec = 0;
      return;
    }
    const settleOverflowSecs = action.kind === 'orbit'
      ? Math.max(0, overshootSecs - (action.settleSecs ?? 0))
      : overshootSecs;
    activateArrivalAction(action, settleOverflowSecs, arrivalPosition);
  }

  /**
   * @param {Exclude<import('./index.d.ts').SpatialArrivalAction, { kind: 'none' }>} action
   * @param {number} overshootSecs
   * @param {import('./index.d.ts').SpatialVector3} arrivalPosition
   */
  function activateArrivalAction(action, overshootSecs, arrivalPosition) {
    pendingSettle = null;
    if (action.kind === 'orbit' || action.kind === 'orbitalInsert') {
      const handoff = deriveSpatialOrbitHandoff({ space,
        position: arrivalPosition,
        orbit: action.orbit,
      });
      activeOrbit = handoff.orbit;
      if (action.kind === 'orbit' && action.preserveAim === true) {
        // Preserve the independently authored orientation lane.
      } else {
        activeAim = (action.kind === 'orbit' ? action.aim : undefined) ?? action.orbit.aim ?? null;
        targetLock = null;
        activeDwell = null;
      }
      activeRoute = null;
      elapsedSecs = overshootSecs;
      orientationSuppressed = false;
      return;
    }
    if (action.kind === 'lookAt' || action.kind === 'lockAt') {
      activeAim = action.aim;
      targetLock = null;
      orientationSuppressed = false;
      if (action.kind === 'lockAt') {
        targetLock = { target: cloneSpatialVector3(action.aim.target), aim: null };
      }
      activeRoute = null;
      const dwellSecs = action.dwellSecs;
      if (dwellSecs !== undefined) {
        if ((overshootSecs >= dwellSecs || timingTimeNearlyEqual(overshootSecs, dwellSecs))) {
          activeAim = null;
          targetLock = null;
          activeDwell = null;
        } else {
          activeDwell = { elapsedSecs: overshootSecs, durationSecs: dwellSecs };
        }
      } else {
        activeDwell = null;
      }
    }
  }
}

export function createManualMotionModel(options, kind) {
  const space = spatialSpaceFor(options);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Spatial motion options must be an object.');
  }
  const moveSpeedUnitsPerSec = optionalPositiveMotionNumber(options, 'moveSpeedUnitsPerSec', 1);
  const boostMultiplier = optionalPositiveMotionNumber(options, 'boostMultiplier', 1);
  const moveAxisName = optionalMotionString(options, 'moveAxis', 'move');
  const attitudeAxisName = optionalMotionString(options, 'attitudeAxis', 'attitude');
  const rollModifierButton = optionalMotionString(options, 'rollModifierButton', 'rollModifier');
  const boostButton = optionalMotionString(options, 'boostButton', 'boost');
  const pitchRateRadPerSec = optionalPositiveMotionNumber(options, 'pitchRateRadPerSec', Math.PI / 3);
  const yawRateRadPerSec = optionalPositiveMotionNumber(options, 'yawRateRadPerSec', Math.PI / 3);
  const rollRateRadPerSec = optionalPositiveMotionNumber(options, 'rollRateRadPerSec', Math.PI / 3);
  const accelerationUnitsPerSec2 = kind === 'inertial'
    ? optionalPositiveMotionNumber(options, 'accelerationUnitsPerSec2', moveSpeedUnitsPerSec)
    : moveSpeedUnitsPerSec;
  const damping = kind === 'inertial'
    ? optionalNonNegativeMotionNumber(options, 'damping', 1)
    : 0;
  const thrustUnitsPerSec2 = kind === 'thrust'
    ? optionalPositiveMotionNumber(options, 'thrustUnitsPerSec2', moveSpeedUnitsPerSec)
    : moveSpeedUnitsPerSec;
  const mass = kind === 'thrust'
    ? optionalPositiveMotionNumber(options, 'mass', 1)
    : 1;
  const drag = kind === 'thrust'
    ? optionalNonNegativeMotionNumber(options, 'drag', 0)
    : 0;
  const maxSpeedUnitsPerSec = kind === 'direct'
    ? moveSpeedUnitsPerSec
    : optionalPositiveMotionNumber(options, 'maxSpeedUnitsPerSec', moveSpeedUnitsPerSec);
  let velocityUnitsPerSec = cloneSpatialVector3(SPATIAL_ZERO_VECTOR);
  let scale = normalizeSpatialScaleProfile();
  return {
    update(input) {
      const dt = normalizeSpatialUpdateDelta(input);
      scale = normalizeSpatialScaleProfile(input.scale);
      assertSpatialCoordinateSpace(input.pose.space, space);
      const controls = input.controls ?? {};
      const pose = normalizeSpatialPose(input.pose, space);
      const moveAxis = controls.getAxis?.(moveAxisName) ?? { x: 0, y: 0, magnitude: 0, active: false };
      const attitudeAxis = controls.getAxis?.(attitudeAxisName) ?? { x: 0, y: 0, magnitude: 0, active: false };
      const boosted = isSpatialControlPressed(controls, boostButton);
      const rollModifierActive = isSpatialControlPressed(controls, rollModifierButton);
      let orientation = pose.orientation;
      if (attitudeAxis.active) {
        orientation = rotateSpatialLocalAxis(orientation, SPATIAL_LOCAL_RIGHT, attitudeAxis.y * pitchRateRadPerSec * dt);
        orientation = rotateSpatialLocalAxis(
          orientation,
          rollModifierActive ? SPATIAL_LOCAL_FORWARD : SPATIAL_LOCAL_UP,
          attitudeAxis.x * (rollModifierActive ? rollRateRadPerSec : -yawRateRadPerSec) * dt,
        );
      }
      const roll = controls.getAxis?.('roll') ?? { x: 0, y: 0, magnitude: 0, active: false };
      if (roll.active) {
        orientation = rotateSpatialLocalAxis(orientation, SPATIAL_LOCAL_FORWARD, roll.x * rollRateRadPerSec * dt);
      }
      const move = addSpatialVectors(
        addSpatialVectors(
          scaleSpatialVector(applySpatialQuaternion(SPATIAL_LOCAL_RIGHT, orientation), finiteNumber(moveAxis.x, 0)),
          scaleSpatialVector(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, orientation), -finiteNumber(moveAxis.y, 0)),
        ),
        SPATIAL_ZERO_VECTOR,
      );
      const inputMagnitude = Math.min(1, getSpatialVectorLength(move));
      const boost = boosted ? boostMultiplier : 1;
      if (kind === 'direct') {
        velocityUnitsPerSec = inputMagnitude > EPSILON
          ? scaleSpatialVector(normalizeSpatialDirection(move), moveSpeedUnitsPerSec * boost * inputMagnitude)
          : cloneSpatialVector3(SPATIAL_ZERO_VECTOR);
      } else {
        if (inputMagnitude > EPSILON && dt > 0) {
          const acceleration = kind === 'thrust'
            ? thrustUnitsPerSec2 / mass
            : accelerationUnitsPerSec2;
          velocityUnitsPerSec = addSpatialVectors(
            velocityUnitsPerSec,
            scaleSpatialVector(
              normalizeSpatialDirection(move),
              acceleration * boost * inputMagnitude * dt,
            ),
          );
        }
        const resistance = kind === 'thrust' ? drag : inputMagnitude <= EPSILON ? damping : 0;
        if (resistance > 0 && dt > 0) {
          velocityUnitsPerSec = scaleSpatialVector(velocityUnitsPerSec, Math.exp(-resistance * dt));
        }
        velocityUnitsPerSec = clampSpatialVectorLength(
          velocityUnitsPerSec,
          maxSpeedUnitsPerSec,
        );
      }
      return { space,
        position: addSpatialVectors(pose.position, scaleSpatialVector(velocityUnitsPerSec, dt)),
        orientation,
      };
    },
    getSnapshot() {
      return {
        kind,
        space,
        velocityUnitsPerSec: cloneSpatialVector3(velocityUnitsPerSec),
        speedUnitsPerSec: getSpatialVectorLength(velocityUnitsPerSec),
        scale: { ...scale },
        activeAutomation: null,
      };
    },
    dispose() {},
  };
}

export function optionalPositiveMotionNumber(options, field, fallback) {
  return options[field] === undefined
    ? fallback
    : positiveFiniteNumber(options[field], `Spatial motion ${field}`);
}

export function optionalNonNegativeMotionNumber(options, field, fallback) {
  return options[field] === undefined
    ? fallback
    : nonNegativeFiniteNumber(options[field], `Spatial motion ${field}`);
}

export function optionalMotionString(options, field, fallback) {
  if (options[field] === undefined) return fallback;
  if (typeof options[field] !== 'string' || options[field].length === 0) {
    throw new TypeError(`Spatial motion ${field} must be a non-empty string.`);
  }
  return options[field];
}

export function isSpatialControlPressed(controls, name) {
  return controls.isPressed?.(name) === true || controls.getButton?.(name)?.pressed === true;
}

export function clampSpatialVectorLength(vector, maxLength) {
  const length = getSpatialVectorLength(vector);
  return length > maxLength && length > 0
    ? scaleSpatialVector(vector, maxLength / length)
    : cloneSpatialVector3(vector);
}
