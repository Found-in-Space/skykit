import {
  clonePose,
  cloneQuaternion,
  cloneVector3,
  finiteNumber,
  IDENTITY_QUATERNION,
  LOCAL_FORWARD,
  LOCAL_RIGHT,
  LOCAL_UP,
  normalizePose,
  normalizeQuaternion,
  normalizeScaleProfile,
  normalizeVector3,
  positiveFinite,
  scaleVector,
  subtractVectors,
  vectorLength,
} from './math.js';

/** @typedef {import('./index.d.ts').SpatialVector3} SpatialVector3 */
/** @typedef {import('./index.d.ts').SpatialQuaternion} SpatialQuaternion */
/** @typedef {import('./index.d.ts').SpatialPose} SpatialPose */
/** @typedef {import('./index.d.ts').SpatialMotionUpdateInput} SpatialMotionUpdateInput */

const EPSILON = 1e-9;

/**
 * @param {Iterable<unknown>} [points]
 * @returns {import('./index.d.ts').SpatialPolylineRoute}
 */
export function buildSpatialPolylineRoute(points = []) {
  /** @type {SpatialVector3[]} */
  const normalizedPoints = [];
  for (const point of points) {
    const normalized = normalizeOptionalVector3(point);
    if (!normalized) continue;
    const previous = normalizedPoints[normalizedPoints.length - 1];
    if (previous && pointDistance(previous, normalized) < EPSILON) {
      continue;
    }
    normalizedPoints.push(normalized);
  }

  /** @type {import('./index.d.ts').SpatialPolylineSegment[]} */
  const segments = [];
  let totalLength = 0;
  for (let index = 1; index < normalizedPoints.length; index += 1) {
    const start = normalizedPoints[index - 1];
    const end = normalizedPoints[index];
    const length = pointDistance(start, end);
    if (!(length > 0)) continue;
    segments.push({
      start: cloneVector3(start),
      end: cloneVector3(end),
      length,
      cumulativeStart: totalLength,
      cumulativeEnd: totalLength + length,
    });
    totalLength += length;
  }

  return {
    points: normalizedPoints.map(cloneVector3),
    segments,
    totalLength,
  };
}

/**
 * @param {import('./index.d.ts').SpatialPolylineRoute | null | undefined} route
 * @param {number} distance
 * @returns {SpatialVector3 | null}
 */
export function sampleSpatialPolylineRoutePosition(route, distance) {
  if (!route || !Array.isArray(route.points) || route.points.length === 0) {
    return null;
  }
  if (!Array.isArray(route.segments) || route.segments.length === 0 || !(route.totalLength > 0)) {
    return cloneVector3(route.points[0]);
  }
  const clampedDistance = clamp(finiteNumber(distance, 0), 0, route.totalLength);
  for (const segment of route.segments) {
    if (clampedDistance > segment.cumulativeEnd && segment !== route.segments[route.segments.length - 1]) {
      continue;
    }
    const distanceIntoSegment = clamp(
      clampedDistance - segment.cumulativeStart,
      0,
      segment.length,
    );
    const blend = segment.length > 0 ? distanceIntoSegment / segment.length : 0;
    return lerpVector(segment.start, segment.end, blend);
  }
  return cloneVector3(route.points[route.points.length - 1]);
}

/**
 * @param {import('./index.d.ts').SpatialOrbitAngleInput} input
 * @returns {number}
 */
export function deriveSpatialOrbitAngle(input) {
  const center = normalizeVector3(input?.center, nullVector());
  const position = normalizeVector3(input?.position, nullVector());
  if (!isFiniteVector(center) || !isFiniteVector(position)) return 0;
  const basis = createOrbitBasis({
    orbitNormal: input?.orbitNormal,
    referenceAxis: input?.referenceAxis,
  });
  const offset = subtractVectors(position, center);
  const x = dot(offset, basis.xAxis);
  const z = dot(offset, basis.zAxis);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  return Math.atan2(z, x);
}

/**
 * @param {unknown} start
 * @param {import('./index.d.ts').SpatialOrbitalInsertOptions} [options]
 * @returns {import('./index.d.ts').SpatialOrbitalInsertRoute | null}
 */
export function buildSpatialOrbitalInsertRoute(start, options = {}) {
  const startPosition = normalizeOptionalVector3(start);
  if (!startPosition) return null;
  const automation = createOrbitalInsertState(startPosition, options);
  if (!automation) return null;

  const sampleStepSeconds = positiveFinite(options.sampleStepSeconds, 1 / 30);
  const maxPoints = Math.max(2, Math.floor(positiveFinite(options.maxPoints, 512)));
  const points = [cloneVector3(startPosition)];
  let position = cloneVector3(startPosition);

  while (points.length < maxPoints) {
    const result = advanceOrbitalInsert(position, automation, sampleStepSeconds);
    position = result.position;
    const previous = points[points.length - 1];
    if (pointDistance(previous, position) > 1e-6) {
      points.push(cloneVector3(position));
    }
    if (!result.active) break;
  }

  return {
    points,
    arrivalAction: {
      type: 'orbit',
      center: cloneVector3(automation.center),
      radius: automation.radius,
      angularSpeed: automation.angularSpeed,
      orbitNormal: cloneVector3(automation.orbitNormal),
    },
  };
}

/**
 * @param {import('./index.d.ts').SpatialLookAtInput} input
 * @returns {SpatialQuaternion | null}
 */
export function computeSpatialLookAtOrientation(input) {
  const position = normalizeVector3(input?.position, nullVector());
  const target = normalizeVector3(input?.target, nullVector());
  if (!isFiniteVector(position) || !isFiniteVector(target)) return null;
  const forward = subtractVectors(target, position);
  if (!(vectorLength(forward) > EPSILON)) return null;
  return orientationTowardDirection(forward, input?.up);
}

/**
 * @param {import('./index.d.ts').SpatialRouteFollowMotionOptions} [options]
 * @returns {import('./index.d.ts').SpatialRouteFollowMotionModel}
 */
export function createRouteFollowSpatialMotionModel(options = {}) {
  const automation = createSpatialNavigationAutomation();
  if (options.points) {
    automation.flyPolyline(options.points, options);
  }
  return {
    flyPolyline(points, nextOptions = {}) {
      automation.flyPolyline(points, nextOptions);
    },
    cancel() {
      automation.cancelMovement();
    },
    update(input) {
      return automation.update(input);
    },
    getSnapshot() {
      return automation.getSnapshot();
    },
  };
}

/**
 * @param {import('./index.d.ts').SpatialOrbitMotionOptions} [options]
 * @returns {import('./index.d.ts').SpatialOrbitMotionModel}
 */
export function createOrbitSpatialMotionModel(options = {}) {
  const automation = createSpatialNavigationAutomation();
  if (options.center) {
    automation.orbit(options.center, options);
  }
  return {
    orbit(center, nextOptions = {}) {
      automation.orbit(center, nextOptions);
    },
    cancel() {
      automation.cancelMovement();
    },
    update(input) {
      return automation.update(input);
    },
    getSnapshot() {
      return automation.getSnapshot();
    },
  };
}

/**
 * @param {import('./index.d.ts').SpatialOrbitalInsertMotionOptions} [options]
 * @returns {import('./index.d.ts').SpatialOrbitalInsertMotionModel}
 */
export function createOrbitalInsertSpatialMotionModel(options = {}) {
  const automation = createSpatialNavigationAutomation();
  if (options.center) {
    automation.orbitalInsert(options.center, options);
  }
  return {
    orbitalInsert(center, nextOptions = {}) {
      automation.orbitalInsert(center, nextOptions);
    },
    cancel() {
      automation.cancelMovement();
    },
    update(input) {
      return automation.update(input);
    },
    getSnapshot() {
      return automation.getSnapshot();
    },
  };
}

/**
 * @param {import('./index.d.ts').SpatialLookAtMotionOptions} [options]
 * @returns {import('./index.d.ts').SpatialLookAtMotionModel}
 */
export function createLookAtSpatialMotionModel(options = {}) {
  const automation = createSpatialNavigationAutomation();
  if (options.target) {
    if (options.locked) {
      automation.lockAt(options.target, options);
    } else {
      automation.lookAt(options.target, options);
    }
  }
  return {
    lookAt(target, nextOptions = {}) {
      automation.lookAt(target, nextOptions);
    },
    lockAt(target, nextOptions = {}) {
      automation.lockAt(target, nextOptions);
    },
    unlockAt() {
      automation.unlockAt();
    },
    noteManualLookInput() {
      automation.noteManualLookInput();
    },
    cancel() {
      automation.cancelOrientation();
    },
    update(input) {
      return automation.update(input);
    },
    getSnapshot() {
      return automation.getSnapshot();
    },
  };
}

/**
 * @param {import('./index.d.ts').SpatialNavigationAutomationOptions} [options]
 * @returns {import('./index.d.ts').SpatialNavigationAutomation}
 */
export function createSpatialNavigationAutomation(options = {}) {
  /** @type {MovementAutomation | null} */
  let movementAutomation = null;
  /** @type {OrientationAutomation | null} */
  let orientationAutomation = null;
  let secondsSinceManualLookInput = Number.POSITIVE_INFINITY;
  let disposed = false;
  let lastSnapshot = createNavigationSnapshot('navigation-automation');

  const defaults = {
    speed: positiveFinite(options.speed, 4),
    acceleration: positiveFinite(options.acceleration, 4),
    deceleration: positiveFinite(options.deceleration, 2),
    arrivalThreshold: positiveFinite(options.arrivalThreshold, 0.01),
    angularSpeed: finiteNumber(options.angularSpeed, 0.1),
  };

  return {
    flyTo(target, nextOptions = {}) {
      assertActive();
      beginFlyTo(target, nextOptions);
    },
    flyPolyline(points, nextOptions = {}) {
      assertActive();
      beginFlyPolyline(points, nextOptions);
    },
    orbit(center, nextOptions = {}) {
      assertActive();
      beginOrbit(center, nextOptions);
    },
    orbitalInsert(center, nextOptions = {}) {
      assertActive();
      beginOrbitalInsert(center, nextOptions);
    },
    lookAt(target, nextOptions = {}) {
      assertActive();
      beginLookAt(target, nextOptions);
    },
    lockAt(target, nextOptions = {}) {
      assertActive();
      beginLockAt(target, nextOptions);
    },
    unlockAt() {
      assertActive();
      if (orientationAutomation?.type === 'lockAt') {
        orientationAutomation = null;
      }
    },
    noteManualLookInput() {
      assertActive();
      secondsSinceManualLookInput = 0;
    },
    cancelMovement() {
      assertActive();
      movementAutomation = null;
    },
    cancelOrientation() {
      assertActive();
      orientationAutomation = null;
    },
    cancel() {
      assertActive();
      movementAutomation = null;
      orientationAutomation = null;
    },
    update(input) {
      assertActive();
      const dt = positiveDelta(input.deltaSeconds);
      let next = normalizePose(input.pose);
      const previousPosition = cloneVector3(next.position);
      if (input.manualLookActive) {
        secondsSinceManualLookInput = 0;
      }
      if (Number.isFinite(secondsSinceManualLookInput)) {
        secondsSinceManualLookInput += dt;
      }
      next = updateMovement(next, dt);
      next = updateOrientation(next, dt);
      const velocity = dt > 0
        ? scaleVector(subtractVectors(next.position, previousPosition), 1 / dt)
        : { x: 0, y: 0, z: 0 };
      lastSnapshot = {
        type: 'navigation-automation',
        velocity,
        speedNavigationUnitsPerSecond: vectorLength(velocity),
        scale: normalizeScaleProfile(input.scale),
        activeAutomation: movementAutomation?.type ?? orientationAutomation?.type ?? null,
        movementAutomation: serializeMovement(movementAutomation),
        orientationAutomation: serializeOrientation(orientationAutomation),
        secondsSinceManualLookInput,
        disposed,
      };
      return next;
    },
    getSnapshot() {
      return cloneNavigationSnapshot(lastSnapshot);
    },
    dispose() {
      if (disposed) return;
      movementAutomation = null;
      orientationAutomation = null;
      disposed = true;
      lastSnapshot = {
        ...lastSnapshot,
        activeAutomation: null,
        movementAutomation: null,
        orientationAutomation: null,
        disposed,
      };
    },
  };

  /**
   * @param {unknown} target
   * @param {import('./index.d.ts').SpatialFlyToNavigationOptions} nextOptions
   */
  function beginFlyTo(target, nextOptions) {
    const normalizedTarget = normalizeOptionalVector3(target);
    if (!normalizedTarget) return false;
    movementAutomation = {
      type: 'flyTo',
      target: normalizedTarget,
      speed: resolveDuration(nextOptions) == null
        ? positiveFinite(nextOptions.speed, defaults.speed)
        : null,
      acceleration: positiveFinite(nextOptions.acceleration, defaults.acceleration),
      durationSecs: resolveDuration(nextOptions),
      elapsedSecs: 0,
      currentSpeed: Math.max(0, finiteNumber(nextOptions.currentSpeed, lastSnapshot.speedNavigationUnitsPerSecond ?? 0)),
      startPosition: null,
      deceleration: positiveFinite(nextOptions.deceleration, defaults.deceleration),
      arrivalThreshold: positiveFinite(nextOptions.arrivalThreshold, defaults.arrivalThreshold),
      onArrive: typeof nextOptions.onArrive === 'function' ? nextOptions.onArrive : null,
    };
    return true;
  }

  /**
   * @param {Iterable<unknown>} points
   * @param {import('./index.d.ts').SpatialRouteFollowOptions} nextOptions
   */
  function beginFlyPolyline(points, nextOptions) {
    const route = buildSpatialPolylineRoute(points);
    if (!Array.isArray(route.segments) || route.segments.length === 0 || !(route.totalLength > 0)) {
      return false;
    }
    movementAutomation = {
      type: 'flyPolyline',
      route,
      distance: 0,
      speed: resolveDuration(nextOptions) == null
        ? positiveFinite(nextOptions.speed, defaults.speed)
        : null,
      acceleration: positiveFinite(nextOptions.acceleration, defaults.acceleration),
      durationSecs: resolveDuration(nextOptions),
      elapsedSecs: 0,
      currentSpeed: Math.max(0, finiteNumber(nextOptions.currentSpeed, lastSnapshot.speedNavigationUnitsPerSecond ?? 0)),
      deceleration: positiveFinite(nextOptions.deceleration, defaults.deceleration),
      arrivalThreshold: positiveFinite(nextOptions.arrivalThreshold, defaults.arrivalThreshold),
      arrivalAction: nextOptions.arrivalAction ?? null,
      onArrive: typeof nextOptions.onArrive === 'function' ? nextOptions.onArrive : null,
    };
    return true;
  }

  /**
   * @param {unknown} center
   * @param {import('./index.d.ts').SpatialOrbitOptions} nextOptions
   * @param {SpatialPose | null} [pose]
   */
  function beginOrbit(center, nextOptions, pose = null) {
    const normalizedCenter = normalizeOptionalVector3(center);
    if (!normalizedCenter) return false;
    if (!pose && !Number.isFinite(nextOptions.initialAngle)) {
      movementAutomation = {
        type: 'pendingOrbit',
        center: normalizedCenter,
        options: { ...nextOptions },
      };
      return true;
    }
    const currentPosition = pose?.position ?? null;
    const currentRadius = currentPosition ? pointDistance(currentPosition, normalizedCenter) : 0;
    const radius = positiveFinite(nextOptions.radius, currentRadius || 1);
    const orbitNormal = normalizeDirectionOrFallback(nextOptions.orbitNormal, LOCAL_UP);
    const angle = Number.isFinite(nextOptions.initialAngle)
      ? Number(nextOptions.initialAngle)
      : currentPosition
        ? deriveSpatialOrbitAngle({ center: normalizedCenter, position: currentPosition, orbitNormal })
        : 0;
    movementAutomation = {
      type: 'orbit',
      center: normalizedCenter,
      radius,
      angularSpeed: finiteNumber(nextOptions.angularSpeed, defaults.angularSpeed),
      angle,
      orbitNormal,
    };
    return true;
  }

  /**
   * @param {unknown} center
   * @param {import('./index.d.ts').SpatialOrbitalInsertOptions} nextOptions
   * @param {SpatialPose | null} [pose]
   */
  function beginOrbitalInsert(center, nextOptions, pose = null) {
    const normalizedCenter = normalizeOptionalVector3(center);
    const currentPose = pose ?? null;
    if (!normalizedCenter || !currentPose) {
      movementAutomation = {
        type: 'pendingOrbitalInsert',
        center: normalizedCenter ?? { x: 0, y: 0, z: 0 },
        options: { ...nextOptions },
      };
      return Boolean(normalizedCenter);
    }
    const distance = pointDistance(currentPose.position, normalizedCenter);
    const radius = positiveFinite(nextOptions.radius, distance || 1);
    const onInserted = typeof nextOptions.onInserted === 'function' ? nextOptions.onInserted : null;
    if (distance <= radius * 1.01) {
      beginOrbit(normalizedCenter, {
        ...nextOptions,
        radius,
        initialAngle: deriveSpatialOrbitAngle({
          center: normalizedCenter,
          position: currentPose.position,
          orbitNormal: nextOptions.orbitNormal,
        }),
      }, currentPose);
      onInserted?.();
      return true;
    }
    const automation = createOrbitalInsertState(currentPose.position, {
      ...nextOptions,
      center: normalizedCenter,
      radius,
      approachVelocity: nextOptions.approachVelocity ?? lastSnapshot.velocity,
    });
    if (!automation) return false;
    movementAutomation = {
      ...automation,
      onInserted,
    };
    return true;
  }

  /**
   * @param {unknown} target
   * @param {import('./index.d.ts').SpatialLookAtOptions} nextOptions
   */
  function beginLookAt(target, nextOptions) {
    const normalizedTarget = normalizeOptionalVector3(target);
    if (!normalizedTarget) return false;
    orientationAutomation = {
      type: 'lookAt',
      target: normalizedTarget,
      up: normalizeDirectionOrNull(nextOptions.up),
      blend: clamp(finiteNumber(nextOptions.blend, 0.05), 0.0001, 1),
      arrivalThresholdRad: positiveFinite(nextOptions.arrivalThresholdRad, 0.01),
      onArrive: typeof nextOptions.onArrive === 'function' ? nextOptions.onArrive : null,
    };
    secondsSinceManualLookInput = Number.POSITIVE_INFINITY;
    return true;
  }

  /**
   * @param {unknown} target
   * @param {import('./index.d.ts').SpatialLockAtOptions} nextOptions
   */
  function beginLockAt(target, nextOptions) {
    const normalizedTarget = normalizeOptionalVector3(target);
    if (!normalizedTarget) return false;
    orientationAutomation = {
      type: 'lockAt',
      target: normalizedTarget,
      up: normalizeDirectionOrNull(nextOptions.up),
      dwellSecs: Math.max(0, finiteNumber(nextOptions.dwellSecs, 0)),
      recenterSpeed: clamp(finiteNumber(nextOptions.recenterSpeed, 0.05), 0.0001, 1),
    };
    secondsSinceManualLookInput = Number.POSITIVE_INFINITY;
    return true;
  }

  /**
   * @param {SpatialPose} pose
   * @param {number} dt
   * @returns {SpatialPose}
   */
  function updateMovement(pose, dt) {
    if (!movementAutomation || dt <= 0) return clonePose(pose);
    if (movementAutomation.type === 'pendingOrbit') {
      return beginOrbit(movementAutomation.center, movementAutomation.options, pose)
        ? updateMovement(pose, dt)
        : clonePose(pose);
    }
    if (movementAutomation.type === 'pendingOrbitalInsert') {
      return beginOrbitalInsert(movementAutomation.center, movementAutomation.options, pose)
        ? updateMovement(pose, dt)
        : clonePose(pose);
    }
    if (movementAutomation.type === 'flyTo') {
      return updateFlyTo(pose, dt, movementAutomation);
    }
    if (movementAutomation.type === 'flyPolyline') {
      return updateFlyPolyline(pose, dt, movementAutomation);
    }
    if (movementAutomation.type === 'orbit') {
      movementAutomation.angle += movementAutomation.angularSpeed * dt;
      return {
        position: orbitPosition(
          movementAutomation.center,
          movementAutomation.radius,
          movementAutomation.angle,
          movementAutomation.orbitNormal,
        ),
        orientation: cloneQuaternion(pose.orientation),
      };
    }
    if (movementAutomation.type === 'orbitalInsert') {
      const result = advanceOrbitalInsert(pose.position, movementAutomation, dt);
      if (result.enteredOrbit) {
        const callback = movementAutomation.onInserted;
        movementAutomation = {
          type: 'orbit',
          center: cloneVector3(movementAutomation.center),
          radius: movementAutomation.radius,
          angularSpeed: movementAutomation.angularSpeed,
          angle: result.angle ?? 0,
          orbitNormal: cloneVector3(movementAutomation.orbitNormal),
        };
        callback?.();
      } else if (!result.active) {
        movementAutomation = null;
      }
      return {
        position: result.position,
        orientation: cloneQuaternion(pose.orientation),
      };
    }
    return clonePose(pose);
  }

  /**
   * @param {SpatialPose} pose
   * @param {number} dt
   * @param {Extract<MovementAutomation, { type: 'flyTo' }>} automation
   * @returns {SpatialPose}
   */
  function updateFlyTo(pose, dt, automation) {
    if (automation.durationSecs != null) {
      automation.startPosition ??= cloneVector3(pose.position);
      automation.elapsedSecs = Math.min(automation.durationSecs, automation.elapsedSecs + dt);
      const linear = clamp(automation.elapsedSecs / automation.durationSecs, 0, 1);
      const position = lerpVector(automation.startPosition, automation.target, smoothstep(0, 1, linear));
      if (linear >= 1) {
        const callback = automation.onArrive;
        movementAutomation = null;
        callback?.();
        return { position: cloneVector3(automation.target), orientation: cloneQuaternion(pose.orientation) };
      }
      return { position, orientation: cloneQuaternion(pose.orientation) };
    }
    const offset = subtractVectors(automation.target, pose.position);
    const distance = vectorLength(offset);
    if (distance <= automation.arrivalThreshold) {
      const callback = automation.onArrive;
      movementAutomation = null;
      callback?.();
      return { position: cloneVector3(automation.target), orientation: cloneQuaternion(pose.orientation) };
    }
    const { speed, step } = resolveAutomationStep(automation, distance, dt);
    const position = translateToward(pose.position, automation.target, step);
    return { position, orientation: cloneQuaternion(pose.orientation) };
  }

  /**
   * @param {SpatialPose} pose
   * @param {number} dt
   * @param {Extract<MovementAutomation, { type: 'flyPolyline' }>} automation
   * @returns {SpatialPose}
   */
  function updateFlyPolyline(pose, dt, automation) {
    const remaining = Math.max(automation.route.totalLength - automation.distance, 0);
    const finalPoint = automation.route.points[automation.route.points.length - 1];
    if (remaining <= automation.arrivalThreshold) {
      return finishMovementWithArrivalAction(
        finalPoint ? { position: finalPoint, orientation: cloneQuaternion(pose.orientation) } : pose,
        automation.arrivalAction,
        automation.onArrive,
      );
    }
    if (automation.durationSecs != null) {
      automation.elapsedSecs = Math.min(automation.durationSecs, automation.elapsedSecs + dt);
      const linear = clamp(automation.elapsedSecs / automation.durationSecs, 0, 1);
      automation.distance = automation.route.totalLength * smoothstep(0, 1, linear);
    } else {
      const { step } = resolveAutomationStep(automation, remaining, dt);
      automation.distance = Math.min(automation.route.totalLength, automation.distance + step);
    }
    const position = sampleSpatialPolylineRoutePosition(automation.route, automation.distance) ?? pose.position;
    if ((automation.route.totalLength - automation.distance) <= automation.arrivalThreshold) {
      return finishMovementWithArrivalAction(
        finalPoint ? { position: finalPoint, orientation: cloneQuaternion(pose.orientation) } : { position, orientation: cloneQuaternion(pose.orientation) },
        automation.arrivalAction,
        automation.onArrive,
      );
    }
    return { position, orientation: cloneQuaternion(pose.orientation) };
  }

  /**
   * @param {SpatialPose} pose
   * @param {unknown} action
   * @param {(() => void) | null} callback
   * @returns {SpatialPose}
   */
  function finishMovementWithArrivalAction(pose, action, callback) {
    if (!action || typeof action !== 'object') {
      movementAutomation = null;
      callback?.();
      return clonePose(pose);
    }
    const arrival = /** @type {import('./index.d.ts').SpatialArrivalAction} */ (action);
    if (arrival.type === 'orbit') {
      const started = beginOrbit(arrival.center, arrival, pose);
      if (!started) movementAutomation = null;
      callback?.();
      return clonePose(pose);
    }
    if (arrival.type === 'orbitalInsert') {
      const started = beginOrbitalInsert(arrival.center, {
        ...arrival,
        onInserted: callback ?? undefined,
      }, pose);
      if (!started) {
        movementAutomation = null;
        callback?.();
      }
      return clonePose(pose);
    }
    movementAutomation = null;
    callback?.();
    return clonePose(pose);
  }

  /**
   * @param {SpatialPose} pose
   * @param {number} dt
   * @returns {SpatialPose}
   */
  function updateOrientation(pose, dt) {
    if (!orientationAutomation || dt <= 0) return clonePose(pose);
    if (orientationAutomation.type === 'lookAt') {
      const target = computeSpatialLookAtOrientation({
        position: pose.position,
        target: orientationAutomation.target,
        up: orientationAutomation.up ?? undefined,
      });
      if (!target) {
        orientationAutomation = null;
        return clonePose(pose);
      }
      const alpha = frameBlend(orientationAutomation.blend, dt);
      const orientation = slerpQuaternions(pose.orientation, target, alpha);
      if (quaternionAngle(orientation, target) <= orientationAutomation.arrivalThresholdRad) {
        const callback = orientationAutomation.onArrive;
        orientationAutomation = null;
        callback?.();
        return { position: cloneVector3(pose.position), orientation: target };
      }
      return { position: cloneVector3(pose.position), orientation };
    }
    if (orientationAutomation.type === 'lockAt') {
      if (secondsSinceManualLookInput < orientationAutomation.dwellSecs) {
        return clonePose(pose);
      }
      const target = computeSpatialLookAtOrientation({
        position: pose.position,
        target: orientationAutomation.target,
        up: orientationAutomation.up ?? undefined,
      });
      if (!target) return clonePose(pose);
      return {
        position: cloneVector3(pose.position),
        orientation: slerpQuaternions(
          pose.orientation,
          target,
          frameBlend(orientationAutomation.recenterSpeed, dt),
        ),
      };
    }
    return clonePose(pose);
  }

  function assertActive() {
    if (disposed) {
      throw new Error('SpatialNavigationAutomation has been disposed.');
    }
  }
}

/**
 * @param {Extract<MovementAutomation, { type: 'flyTo' | 'flyPolyline' }>} automation
 * @param {number} remaining
 * @param {number} dt
 */
function resolveAutomationStep(automation, remaining, dt) {
  const maxSpeed = automation.speed ?? 1;
  const brakingSpeed = Math.sqrt(Math.max(0, 2 * automation.deceleration * Math.max(0, remaining - automation.arrivalThreshold)));
  const targetSpeed = Math.min(maxSpeed, brakingSpeed);
  const previousSpeed = automation.currentSpeed;
  if (automation.currentSpeed < targetSpeed) {
    automation.currentSpeed = Math.min(targetSpeed, automation.currentSpeed + automation.acceleration * dt);
  } else {
    automation.currentSpeed = Math.max(targetSpeed, automation.currentSpeed - automation.deceleration * dt);
  }
  const speed = automation.currentSpeed;
  const step = Math.min(remaining, ((previousSpeed + speed) * 0.5) * dt);
  return { speed, step };
}

/**
 * @param {SpatialVector3} from
 * @param {SpatialVector3} to
 * @param {number} step
 * @returns {SpatialVector3}
 */
function translateToward(from, to, step) {
  const offset = subtractVectors(to, from);
  const distance = vectorLength(offset);
  if (!(distance > EPSILON)) return cloneVector3(to);
  const amount = Math.min(step, distance) / distance;
  return {
    x: from.x + offset.x * amount,
    y: from.y + offset.y * amount,
    z: from.z + offset.z * amount,
  };
}

/**
 * @param {SpatialVector3} start
 * @param {import('./index.d.ts').SpatialOrbitalInsertOptions} options
 * @returns {OrbitalInsertAutomation | null}
 */
function createOrbitalInsertState(start, options) {
  const center = normalizeOptionalVector3(options.center);
  if (!center) return null;
  const currentDistance = pointDistance(start, center);
  const radius = positiveFinite(options.radius, currentDistance || 1);
  const angularSpeed = finiteNumber(options.angularSpeed, 0.1);
  const deceleration = positiveFinite(options.deceleration, 2);
  const durationSecs = resolveDuration(options);
  const approachSpeed = durationSecs == null ? positiveFinite(options.approachSpeed ?? options.speed, 12) : null;
  const orbitalSpeed = Math.abs(angularSpeed) * radius;
  const insertionRadius = positiveFinite(
    options.insertionRadius,
    durationSecs == null
      ? Math.max(radius * 3, radius + Math.max(0, ((approachSpeed ?? 12) - orbitalSpeed) / deceleration) * 1.2)
      : Math.max(currentDistance * 1.02, radius * 3),
  );
  const orbitNormal = resolveInsertionOrbitNormal(start, center, options);
  return {
    type: 'orbitalInsert',
    center,
    radius,
    angularSpeed,
    approachSpeed,
    durationSecs,
    elapsedSecs: 0,
    deceleration,
    insertionRadius,
    orbitNormal,
    onInserted: typeof options.onInserted === 'function' ? options.onInserted : null,
  };
}

/**
 * @param {SpatialVector3} start
 * @param {SpatialVector3} center
 * @param {import('./index.d.ts').SpatialOrbitalInsertOptions} options
 */
function resolveInsertionOrbitNormal(start, center, options) {
  if (options.mode === 'specified-orbit') {
    return normalizeDirectionOrFallback(options.orbitNormal, LOCAL_UP);
  }
  const radial = normalizeDirectionOrFallback(subtractVectors(start, center), LOCAL_RIGHT);
  const velocity = normalizeOptionalVector3(options.approachVelocity);
  if (velocity && vectorLength(velocity) > EPSILON) {
    let normal = cross(radial, velocity);
    if (vectorLength(normal) > EPSILON) {
      if (options.orbitNormal && options.matchApproachDirection !== false) {
        const requested = normalizeDirectionOrFallback(options.orbitNormal, normal);
        if (dot(normal, requested) < 0) normal = scaleVector(normal, -1);
      }
      return normalizeDirectionOrFallback(normal, LOCAL_UP);
    }
  }
  return normalizeDirectionOrFallback(options.orbitNormal, LOCAL_UP);
}

/**
 * @param {SpatialVector3} currentPosition
 * @param {OrbitalInsertAutomation} automation
 * @param {number} dt
 * @returns {{ active: boolean; enteredOrbit: boolean; position: SpatialVector3; angle?: number }}
 */
function advanceOrbitalInsert(currentPosition, automation, dt) {
  if (!(dt > 0)) {
    return { active: true, enteredOrbit: false, position: cloneVector3(currentPosition) };
  }
  const offset = subtractVectors(currentPosition, automation.center);
  const distance = vectorLength(offset);
  if (!(distance > EPSILON)) {
    return { active: false, enteredOrbit: false, position: cloneVector3(currentPosition) };
  }
  const radial = scaleVector(offset, 1 / distance);
  let tangent = cross(radial, automation.orbitNormal);
  if (!(vectorLength(tangent) > EPSILON)) {
    return { active: false, enteredOrbit: false, position: cloneVector3(currentPosition) };
  }
  tangent = normalizeDirectionOrFallback(tangent, LOCAL_FORWARD);
  if (automation.angularSpeed < 0) {
    tangent = scaleVector(tangent, -1);
  }

  const tangentialBlend = 1 - smoothstep(automation.radius, automation.insertionRadius, distance);
  const excessDistance = Math.max(0, distance - automation.radius);
  let radialSpeed;
  if (automation.durationSecs != null) {
    automation.elapsedSecs += dt;
    const remainingSecs = Math.max(automation.durationSecs - automation.elapsedSecs, 0.05);
    radialSpeed = excessDistance / remainingSecs;
  } else {
    radialSpeed = Math.min(automation.approachSpeed ?? 12, excessDistance * automation.deceleration);
  }
  const tangentialSpeed = Math.abs(automation.angularSpeed) * automation.radius * tangentialBlend;
  let position = {
    x: currentPosition.x + (-radial.x * radialSpeed + tangent.x * tangentialSpeed) * dt,
    y: currentPosition.y + (-radial.y * radialSpeed + tangent.y * tangentialSpeed) * dt,
    z: currentPosition.z + (-radial.z * radialSpeed + tangent.z * tangentialSpeed) * dt,
  };

  if (tangentialBlend > 0) {
    const planeOffset = subtractVectors(position, automation.center);
    const normalDot = dot(planeOffset, automation.orbitNormal);
    const planeAlpha = clamp(tangentialBlend * 4 * dt, 0, 1);
    position = {
      x: position.x - normalDot * automation.orbitNormal.x * planeAlpha,
      y: position.y - normalDot * automation.orbitNormal.y * planeAlpha,
      z: position.z - normalDot * automation.orbitNormal.z * planeAlpha,
    };
  }

  const nextOffset = subtractVectors(position, automation.center);
  const nextDistance = vectorLength(nextOffset);
  if (nextDistance <= automation.radius * 1.002 && nextDistance > EPSILON) {
    const angle = deriveSpatialOrbitAngle({
      center: automation.center,
      position,
      orbitNormal: automation.orbitNormal,
    });
    return {
      active: false,
      enteredOrbit: true,
      angle,
      position: orbitPosition(automation.center, automation.radius, angle, automation.orbitNormal),
    };
  }
  if (nextDistance < automation.radius && nextDistance > EPSILON) {
    position = {
      x: automation.center.x + nextOffset.x * (automation.radius / nextDistance),
      y: automation.center.y + nextOffset.y * (automation.radius / nextDistance),
      z: automation.center.z + nextOffset.z * (automation.radius / nextDistance),
    };
  }
  return { active: true, enteredOrbit: false, position };
}

/**
 * @param {{ orbitNormal?: unknown; referenceAxis?: unknown }} options
 */
function createOrbitBasis(options = {}) {
  const normal = normalizeDirectionOrFallback(options.orbitNormal, LOCAL_UP);
  let xAxis = projectOnPlane(
    normalizeDirectionOrFallback(options.referenceAxis, LOCAL_RIGHT),
    normal,
  );
  if (!(vectorLength(xAxis) > EPSILON)) {
    xAxis = projectOnPlane(LOCAL_FORWARD, normal);
  }
  if (!(vectorLength(xAxis) > EPSILON)) {
    xAxis = { x: 1, y: 0, z: 0 };
  }
  xAxis = normalizeDirectionOrFallback(xAxis, LOCAL_RIGHT);
  const zAxis = normalizeDirectionOrFallback(cross(xAxis, normal), LOCAL_FORWARD);
  return { normal, xAxis, zAxis };
}

/**
 * @param {SpatialVector3} center
 * @param {number} radius
 * @param {number} angle
 * @param {unknown} orbitNormal
 * @returns {SpatialVector3}
 */
function orbitPosition(center, radius, angle, orbitNormal) {
  const basis = createOrbitBasis({ orbitNormal });
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  return {
    x: center.x + (basis.xAxis.x * cosAngle + basis.zAxis.x * sinAngle) * radius,
    y: center.y + (basis.xAxis.y * cosAngle + basis.zAxis.y * sinAngle) * radius,
    z: center.z + (basis.xAxis.z * cosAngle + basis.zAxis.z * sinAngle) * radius,
  };
}

/**
 * @param {SpatialVector3} direction
 * @param {unknown} upInput
 * @returns {SpatialQuaternion}
 */
function orientationTowardDirection(direction, upInput) {
  const forward = normalizeDirectionOrFallback(direction, LOCAL_FORWARD);
  const zAxis = scaleVector(forward, -1);
  let up = normalizeDirectionOrFallback(upInput, LOCAL_UP);
  if (Math.abs(dot(up, zAxis)) > 0.999) {
    up = Math.abs(dot(LOCAL_RIGHT, zAxis)) > 0.999 ? LOCAL_FORWARD : LOCAL_RIGHT;
  }
  const xAxis = normalizeDirectionOrFallback(cross(up, zAxis), LOCAL_RIGHT);
  const yAxis = normalizeDirectionOrFallback(cross(zAxis, xAxis), LOCAL_UP);
  return quaternionFromBasis(xAxis, yAxis, zAxis);
}

/**
 * @param {SpatialVector3} xAxis
 * @param {SpatialVector3} yAxis
 * @param {SpatialVector3} zAxis
 * @returns {SpatialQuaternion}
 */
function quaternionFromBasis(xAxis, yAxis, zAxis) {
  const m11 = xAxis.x;
  const m12 = yAxis.x;
  const m13 = zAxis.x;
  const m21 = xAxis.y;
  const m22 = yAxis.y;
  const m23 = zAxis.y;
  const m31 = xAxis.z;
  const m32 = yAxis.z;
  const m33 = zAxis.z;
  const trace = m11 + m22 + m33;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m32 - m23) * s;
    y = (m13 - m31) * s;
    z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }
  return normalizeQuaternion({ x, y, z, w }, IDENTITY_QUATERNION);
}

/**
 * @param {SpatialQuaternion} a
 * @param {SpatialQuaternion} b
 * @param {number} amount
 * @returns {SpatialQuaternion}
 */
function slerpQuaternions(a, b, amount) {
  const t = clamp(amount, 0, 1);
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalfTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalfTheta = -cosHalfTheta;
  }
  if (cosHalfTheta >= 1) return cloneQuaternion(a);
  const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
  if (sqrSinHalfTheta <= Number.EPSILON) {
    return normalizeQuaternion({
      x: a.x * (1 - t) + bx * t,
      y: a.y * (1 - t) + by * t,
      z: a.z * (1 - t) + bz * t,
      w: a.w * (1 - t) + bw * t,
    });
  }
  const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
  const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  return normalizeQuaternion({
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  });
}

/**
 * @param {SpatialQuaternion} a
 * @param {SpatialQuaternion} b
 */
function quaternionAngle(a, b) {
  const dotValue = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, dotValue));
}

/**
 * @param {number} blend
 * @param {number} dt
 */
function frameBlend(blend, dt) {
  return clamp(1 - (1 - blend) ** (Math.max(0, dt) * 60), 0, 1);
}

/**
 * @param {unknown} options
 * @returns {number | null}
 */
function resolveDuration(options) {
  const durationSecs = Number(/** @type {{ durationSecs?: unknown }} */ (options)?.durationSecs);
  return Number.isFinite(durationSecs) && durationSecs > 0 ? durationSecs : null;
}

/**
 * @param {unknown} value
 * @returns {SpatialVector3 | null}
 */
function normalizeOptionalVector3(value) {
  const vector = normalizeVector3(value, nullVector());
  return isFiniteVector(vector) ? vector : null;
}

/**
 * @param {unknown} value
 * @returns {SpatialVector3 | null}
 */
function normalizeDirectionOrNull(value) {
  const vector = normalizeOptionalVector3(value);
  return vector && vectorLength(vector) > EPSILON
    ? scaleVector(vector, 1 / vectorLength(vector))
    : null;
}

/**
 * @param {unknown} value
 * @param {SpatialVector3} fallback
 * @returns {SpatialVector3}
 */
function normalizeDirectionOrFallback(value, fallback) {
  return normalizeDirectionOrNull(value) ?? cloneVector3(fallback);
}

/**
 * @param {SpatialVector3} vector
 */
function isFiniteVector(vector) {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function nullVector() {
  return { x: Number.NaN, y: Number.NaN, z: Number.NaN };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 */
function smoothstep(edge0, edge1, x) {
  if (Math.abs(edge1 - edge0) < EPSILON) {
    return x >= edge1 ? 1 : 0;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * @param {SpatialVector3} a
 * @param {SpatialVector3} b
 */
function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * @param {SpatialVector3} a
 * @param {SpatialVector3} b
 */
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * @param {SpatialVector3} a
 * @param {SpatialVector3} b
 * @returns {SpatialVector3}
 */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * @param {SpatialVector3} vector
 * @param {SpatialVector3} normal
 * @returns {SpatialVector3}
 */
function projectOnPlane(vector, normal) {
  const amount = dot(vector, normal);
  return {
    x: vector.x - normal.x * amount,
    y: vector.y - normal.y * amount,
    z: vector.z - normal.z * amount,
  };
}

/**
 * @param {SpatialVector3} start
 * @param {SpatialVector3} end
 * @param {number} amount
 * @returns {SpatialVector3}
 */
function lerpVector(start, end, amount) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    z: start.z + (end.z - start.z) * amount,
  };
}

/**
 * @param {number} deltaSeconds
 */
function positiveDelta(deltaSeconds) {
  return Math.max(0, finiteNumber(deltaSeconds, 0));
}

/**
 * @param {string} type
 * @returns {import('./index.d.ts').SpatialNavigationAutomationSnapshot}
 */
function createNavigationSnapshot(type) {
  return {
    type,
    velocity: { x: 0, y: 0, z: 0 },
    speedNavigationUnitsPerSecond: 0,
    scale: normalizeScaleProfile(),
    activeAutomation: null,
    movementAutomation: null,
    orientationAutomation: null,
    secondsSinceManualLookInput: Number.POSITIVE_INFINITY,
    disposed: false,
  };
}

/**
 * @param {import('./index.d.ts').SpatialNavigationAutomationSnapshot} snapshot
 */
function cloneNavigationSnapshot(snapshot) {
  return {
    ...snapshot,
    velocity: cloneVector3(snapshot.velocity),
    scale: { ...snapshot.scale },
    movementAutomation: snapshot.movementAutomation ? { ...snapshot.movementAutomation } : null,
    orientationAutomation: snapshot.orientationAutomation ? { ...snapshot.orientationAutomation } : null,
  };
}

/**
 * @param {MovementAutomation | null} automation
 * @returns {import('./index.d.ts').SpatialAutomationSummary | null}
 */
function serializeMovement(automation) {
  if (!automation) return null;
  if (automation.type === 'flyPolyline') {
    return {
      type: automation.type,
      distance: automation.distance,
      totalLength: automation.route.totalLength,
    };
  }
  if (automation.type === 'flyTo') {
    return { type: automation.type, target: cloneVector3(automation.target) };
  }
  if (automation.type === 'orbit') {
    return {
      type: automation.type,
      center: cloneVector3(automation.center),
      radius: automation.radius,
      angularSpeed: automation.angularSpeed,
      angle: automation.angle,
    };
  }
  if (automation.type === 'orbitalInsert') {
    return {
      type: automation.type,
      center: cloneVector3(automation.center),
      radius: automation.radius,
      angularSpeed: automation.angularSpeed,
      insertionRadius: automation.insertionRadius,
    };
  }
  if (automation.type === 'pendingOrbit') {
    return { type: automation.type, center: cloneVector3(automation.center) };
  }
  return { type: automation.type };
}

/**
 * @param {OrientationAutomation | null} automation
 * @returns {import('./index.d.ts').SpatialAutomationSummary | null}
 */
function serializeOrientation(automation) {
  if (!automation) return null;
  return {
    type: automation.type,
    target: cloneVector3(automation.target),
  };
}

/**
 * @typedef {{
 *   type: 'flyTo';
 *   target: SpatialVector3;
 *   speed: number | null;
 *   acceleration: number;
 *   durationSecs: number | null;
 *   elapsedSecs: number;
 *   currentSpeed: number;
 *   startPosition: SpatialVector3 | null;
 *   deceleration: number;
 *   arrivalThreshold: number;
 *   onArrive: (() => void) | null;
 * }} FlyToAutomation
 * @typedef {{
 *   type: 'flyPolyline';
 *   route: import('./index.d.ts').SpatialPolylineRoute;
 *   distance: number;
 *   speed: number | null;
 *   acceleration: number;
 *   durationSecs: number | null;
 *   elapsedSecs: number;
 *   currentSpeed: number;
 *   deceleration: number;
 *   arrivalThreshold: number;
 *   arrivalAction: unknown;
 *   onArrive: (() => void) | null;
 * }} FlyPolylineAutomation
 * @typedef {{
 *   type: 'orbit';
 *   center: SpatialVector3;
 *   radius: number;
 *   angularSpeed: number;
 *   angle: number;
 *   orbitNormal: SpatialVector3;
 * }} OrbitAutomation
 * @typedef {{
 *   type: 'pendingOrbit';
 *   center: SpatialVector3;
 *   options: import('./index.d.ts').SpatialOrbitOptions;
 * }} PendingOrbitAutomation
 * @typedef {{
 *   type: 'orbitalInsert';
 *   center: SpatialVector3;
 *   radius: number;
 *   angularSpeed: number;
 *   approachSpeed: number | null;
 *   durationSecs: number | null;
 *   elapsedSecs: number;
 *   deceleration: number;
 *   insertionRadius: number;
 *   orbitNormal: SpatialVector3;
 *   onInserted: (() => void) | null;
 * }} OrbitalInsertAutomation
 * @typedef {{
 *   type: 'pendingOrbitalInsert';
 *   center: SpatialVector3;
 *   options: import('./index.d.ts').SpatialOrbitalInsertOptions;
 * }} PendingOrbitalInsertAutomation
 * @typedef {FlyToAutomation | FlyPolylineAutomation | OrbitAutomation | PendingOrbitAutomation | OrbitalInsertAutomation | PendingOrbitalInsertAutomation} MovementAutomation
 * @typedef {{
 *   type: 'lookAt';
 *   target: SpatialVector3;
 *   up: SpatialVector3 | null;
 *   blend: number;
 *   arrivalThresholdRad: number;
 *   onArrive: (() => void) | null;
 * }} LookAtAutomation
 * @typedef {{
 *   type: 'lockAt';
 *   target: SpatialVector3;
 *   up: SpatialVector3 | null;
 *   dwellSecs: number;
 *   recenterSpeed: number;
 * }} LockAtAutomation
 * @typedef {LookAtAutomation | LockAtAutomation} OrientationAutomation
 */
