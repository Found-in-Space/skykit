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
} from './xr-math.js';

/** @typedef {import('./index.d.ts').XrVector3} XrVector3 */
/** @typedef {import('./index.d.ts').XrQuaternion} XrQuaternion */
/** @typedef {import('./index.d.ts').XrPose} XrPose */
/** @typedef {import('./index.d.ts').XrMotionUpdateInput} XrMotionUpdateInput */

const EPSILON = 1e-9;

/**
 * @param {Iterable<unknown>} [points]
 * @returns {import('./index.d.ts').XrPolylineRoute}
 */
export function buildXrPolylineRoute(points = []) {
  /** @type {XrVector3[]} */
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

  /** @type {import('./index.d.ts').XrPolylineSegment[]} */
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
 * @param {import('./index.d.ts').XrPolylineRoute | null | undefined} route
 * @param {number} distance
 * @returns {XrVector3 | null}
 */
export function sampleXrPolylineRoutePosition(route, distance) {
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
 * @param {import('./index.d.ts').XrOrbitAngleInput} input
 * @returns {number}
 */
export function deriveXrOrbitAngle(input) {
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
 * @param {import('./index.d.ts').XrOrbitalInsertOptions} [options]
 * @returns {import('./index.d.ts').XrOrbitalInsertRoute | null}
 */
export function buildXrOrbitalInsertRoute(start, options = {}) {
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
 * @param {import('./index.d.ts').XrLookAtInput} input
 * @returns {XrQuaternion | null}
 */
export function computeXrLookAtOrientation(input) {
  const position = normalizeVector3(input?.position, nullVector());
  const target = normalizeVector3(input?.target, nullVector());
  if (!isFiniteVector(position) || !isFiniteVector(target)) return null;
  const forward = subtractVectors(target, position);
  if (!(vectorLength(forward) > EPSILON)) return null;
  return orientationTowardDirection(forward, input?.up);
}

/**
 * @param {import('./index.d.ts').XrRouteFollowMotionOptions} [options]
 * @returns {import('./index.d.ts').XrRouteFollowMotionModel}
 */
export function createRouteFollowXrMotionModel(options = {}) {
  const automation = createXrNavigationAutomation();
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
 * @param {import('./index.d.ts').XrOrbitMotionOptions} [options]
 * @returns {import('./index.d.ts').XrOrbitMotionModel}
 */
export function createOrbitXrMotionModel(options = {}) {
  const automation = createXrNavigationAutomation();
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
 * @param {import('./index.d.ts').XrOrbitalInsertMotionOptions} [options]
 * @returns {import('./index.d.ts').XrOrbitalInsertMotionModel}
 */
export function createOrbitalInsertXrMotionModel(options = {}) {
  const automation = createXrNavigationAutomation();
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
 * @param {import('./index.d.ts').XrLookAtMotionOptions} [options]
 * @returns {import('./index.d.ts').XrLookAtMotionModel}
 */
export function createLookAtXrMotionModel(options = {}) {
  const automation = createXrNavigationAutomation();
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
 * @param {import('./index.d.ts').XrNavigationAutomationOptions} [options]
 * @returns {import('./index.d.ts').XrNavigationAutomation}
 */
export function createXrNavigationAutomation(options = {}) {
  /** @type {MovementAutomation | null} */
  let movementAutomation = null;
  /** @type {OrientationAutomation | null} */
  let orientationAutomation = null;
  let secondsSinceManualLookInput = Number.POSITIVE_INFINITY;
  let disposed = false;
  let lastSnapshot = createNavigationSnapshot('navigation-automation');

  const defaults = {
    speed: positiveFinite(options.speed, 4),
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
   * @param {import('./index.d.ts').XrFlyToNavigationOptions} nextOptions
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
      durationSecs: resolveDuration(nextOptions),
      elapsedSecs: 0,
      deceleration: positiveFinite(nextOptions.deceleration, defaults.deceleration),
      arrivalThreshold: positiveFinite(nextOptions.arrivalThreshold, defaults.arrivalThreshold),
      onArrive: typeof nextOptions.onArrive === 'function' ? nextOptions.onArrive : null,
    };
    return true;
  }

  /**
   * @param {Iterable<unknown>} points
   * @param {import('./index.d.ts').XrRouteFollowOptions} nextOptions
   */
  function beginFlyPolyline(points, nextOptions) {
    const route = buildXrPolylineRoute(points);
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
      durationSecs: resolveDuration(nextOptions),
      elapsedSecs: 0,
      deceleration: positiveFinite(nextOptions.deceleration, defaults.deceleration),
      arrivalThreshold: positiveFinite(nextOptions.arrivalThreshold, defaults.arrivalThreshold),
      arrivalAction: nextOptions.arrivalAction ?? null,
      onArrive: typeof nextOptions.onArrive === 'function' ? nextOptions.onArrive : null,
    };
    return true;
  }

  /**
   * @param {unknown} center
   * @param {import('./index.d.ts').XrOrbitOptions} nextOptions
   * @param {XrPose | null} [pose]
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
        ? deriveXrOrbitAngle({ center: normalizedCenter, position: currentPosition, orbitNormal })
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
   * @param {import('./index.d.ts').XrOrbitalInsertOptions} nextOptions
   * @param {XrPose | null} [pose]
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
        initialAngle: deriveXrOrbitAngle({
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
   * @param {import('./index.d.ts').XrLookAtOptions} nextOptions
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
   * @param {import('./index.d.ts').XrLockAtOptions} nextOptions
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
   * @param {XrPose} pose
   * @param {number} dt
   * @returns {XrPose}
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
   * @param {XrPose} pose
   * @param {number} dt
   * @param {Extract<MovementAutomation, { type: 'flyTo' }>} automation
   * @returns {XrPose}
   */
  function updateFlyTo(pose, dt, automation) {
    const offset = subtractVectors(automation.target, pose.position);
    const distance = vectorLength(offset);
    if (distance <= automation.arrivalThreshold) {
      const callback = automation.onArrive;
      movementAutomation = null;
      callback?.();
      return { position: cloneVector3(automation.target), orientation: cloneQuaternion(pose.orientation) };
    }
    const speed = resolveAutomationSpeed(automation, distance, dt);
    const step = Math.min(speed * dt, distance);
    const position = translateToward(pose.position, automation.target, step);
    return { position, orientation: cloneQuaternion(pose.orientation) };
  }

  /**
   * @param {XrPose} pose
   * @param {number} dt
   * @param {Extract<MovementAutomation, { type: 'flyPolyline' }>} automation
   * @returns {XrPose}
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
    const speed = resolveAutomationSpeed(automation, remaining, dt);
    automation.distance = Math.min(automation.route.totalLength, automation.distance + speed * dt);
    const position = sampleXrPolylineRoutePosition(automation.route, automation.distance) ?? pose.position;
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
   * @param {XrPose} pose
   * @param {unknown} action
   * @param {(() => void) | null} callback
   * @returns {XrPose}
   */
  function finishMovementWithArrivalAction(pose, action, callback) {
    if (!action || typeof action !== 'object') {
      movementAutomation = null;
      callback?.();
      return clonePose(pose);
    }
    const arrival = /** @type {import('./index.d.ts').XrArrivalAction} */ (action);
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
   * @param {XrPose} pose
   * @param {number} dt
   * @returns {XrPose}
   */
  function updateOrientation(pose, dt) {
    if (!orientationAutomation || dt <= 0) return clonePose(pose);
    if (orientationAutomation.type === 'lookAt') {
      const target = computeXrLookAtOrientation({
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
      const target = computeXrLookAtOrientation({
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
      throw new Error('XrNavigationAutomation has been disposed.');
    }
  }
}

/**
 * @param {import('./index.d.ts').XrDepthRangeApplyTarget} target
 * @param {import('./index.d.ts').XrDepthRange | { near?: number; far?: number; depthNear?: number; depthFar?: number }} range
 * @param {import('./index.d.ts').XrDepthRangeApplyOptions} [options]
 * @returns {import('./index.d.ts').XrDepthRangeApplyResult}
 */
export function applyXrDepthRange(target, range, options = {}) {
  const session = resolveSessionTarget(target);
  const depthNear = finiteNumber(range?.depthNear ?? range?.near, Number.NaN);
  const depthFar = finiteNumber(range?.depthFar ?? range?.far, Number.NaN);
  if (!Number.isFinite(depthNear) || !Number.isFinite(depthFar) || !(depthNear > 0) || !(depthFar > depthNear)) {
    throw new TypeError('applyXrDepthRange() requires a valid depth range.');
  }
  if (!session || typeof session.updateRenderState !== 'function') {
    if (options.throwOnUnavailable) {
      throw new Error('XRSession.updateRenderState() is not available.');
    }
    return {
      applied: false,
      depthNear,
      depthFar,
      reason: 'missing-updateRenderState',
    };
  }
  try {
    session.updateRenderState({ depthNear, depthFar });
    return { applied: true, depthNear, depthFar };
  } catch (error) {
    if (options.throwOnUnavailable) {
      throw error;
    }
    return {
      applied: false,
      depthNear,
      depthFar,
      reason: 'updateRenderState-failed',
      error,
    };
  }
}

/**
 * @param {unknown} target
 * @returns {{ updateRenderState?: (state: { depthNear: number; depthFar: number }) => void } | null}
 */
function resolveSessionTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const maybeHandle = /** @type {{ session?: unknown }} */ (target);
  const session = maybeHandle.session ?? target;
  return session && typeof session === 'object'
    ? /** @type {{ updateRenderState?: (state: { depthNear: number; depthFar: number }) => void }} */ (session)
    : null;
}

/**
 * @param {Extract<MovementAutomation, { type: 'flyTo' | 'flyPolyline' }>} automation
 * @param {number} remaining
 * @param {number} dt
 */
function resolveAutomationSpeed(automation, remaining, dt) {
  if (automation.durationSecs != null) {
    automation.elapsedSecs += dt;
    const remainingSecs = Math.max(automation.durationSecs - automation.elapsedSecs, 0.05);
    return remaining / remainingSecs;
  }
  return Math.min(automation.speed ?? 1, remaining * automation.deceleration);
}

/**
 * @param {XrVector3} from
 * @param {XrVector3} to
 * @param {number} step
 * @returns {XrVector3}
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
 * @param {XrVector3} start
 * @param {import('./index.d.ts').XrOrbitalInsertOptions} options
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
    orbitNormal: normalizeDirectionOrFallback(options.orbitNormal, LOCAL_UP),
    onInserted: typeof options.onInserted === 'function' ? options.onInserted : null,
  };
}

/**
 * @param {XrVector3} currentPosition
 * @param {OrbitalInsertAutomation} automation
 * @param {number} dt
 * @returns {{ active: boolean; enteredOrbit: boolean; position: XrVector3; angle?: number }}
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
    const angle = deriveXrOrbitAngle({
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
 * @param {XrVector3} center
 * @param {number} radius
 * @param {number} angle
 * @param {unknown} orbitNormal
 * @returns {XrVector3}
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
 * @param {XrVector3} direction
 * @param {unknown} upInput
 * @returns {XrQuaternion}
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
 * @param {XrVector3} xAxis
 * @param {XrVector3} yAxis
 * @param {XrVector3} zAxis
 * @returns {XrQuaternion}
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
 * @param {XrQuaternion} a
 * @param {XrQuaternion} b
 * @param {number} amount
 * @returns {XrQuaternion}
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
 * @param {XrQuaternion} a
 * @param {XrQuaternion} b
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
 * @returns {XrVector3 | null}
 */
function normalizeOptionalVector3(value) {
  const vector = normalizeVector3(value, nullVector());
  return isFiniteVector(vector) ? vector : null;
}

/**
 * @param {unknown} value
 * @returns {XrVector3 | null}
 */
function normalizeDirectionOrNull(value) {
  const vector = normalizeOptionalVector3(value);
  return vector && vectorLength(vector) > EPSILON
    ? scaleVector(vector, 1 / vectorLength(vector))
    : null;
}

/**
 * @param {unknown} value
 * @param {XrVector3} fallback
 * @returns {XrVector3}
 */
function normalizeDirectionOrFallback(value, fallback) {
  return normalizeDirectionOrNull(value) ?? cloneVector3(fallback);
}

/**
 * @param {XrVector3} vector
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
 * @param {XrVector3} a
 * @param {XrVector3} b
 */
function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * @param {XrVector3} a
 * @param {XrVector3} b
 */
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * @param {XrVector3} a
 * @param {XrVector3} b
 * @returns {XrVector3}
 */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * @param {XrVector3} vector
 * @param {XrVector3} normal
 * @returns {XrVector3}
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
 * @param {XrVector3} start
 * @param {XrVector3} end
 * @param {number} amount
 * @returns {XrVector3}
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
 * @returns {import('./index.d.ts').XrNavigationAutomationSnapshot}
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
 * @param {import('./index.d.ts').XrNavigationAutomationSnapshot} snapshot
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
 * @returns {import('./index.d.ts').XrAutomationSummary | null}
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
 * @returns {import('./index.d.ts').XrAutomationSummary | null}
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
 *   target: XrVector3;
 *   speed: number | null;
 *   durationSecs: number | null;
 *   elapsedSecs: number;
 *   deceleration: number;
 *   arrivalThreshold: number;
 *   onArrive: (() => void) | null;
 * }} FlyToAutomation
 * @typedef {{
 *   type: 'flyPolyline';
 *   route: import('./index.d.ts').XrPolylineRoute;
 *   distance: number;
 *   speed: number | null;
 *   durationSecs: number | null;
 *   elapsedSecs: number;
 *   deceleration: number;
 *   arrivalThreshold: number;
 *   arrivalAction: unknown;
 *   onArrive: (() => void) | null;
 * }} FlyPolylineAutomation
 * @typedef {{
 *   type: 'orbit';
 *   center: XrVector3;
 *   radius: number;
 *   angularSpeed: number;
 *   angle: number;
 *   orbitNormal: XrVector3;
 * }} OrbitAutomation
 * @typedef {{
 *   type: 'pendingOrbit';
 *   center: XrVector3;
 *   options: import('./index.d.ts').XrOrbitOptions;
 * }} PendingOrbitAutomation
 * @typedef {{
 *   type: 'orbitalInsert';
 *   center: XrVector3;
 *   radius: number;
 *   angularSpeed: number;
 *   approachSpeed: number | null;
 *   durationSecs: number | null;
 *   elapsedSecs: number;
 *   deceleration: number;
 *   insertionRadius: number;
 *   orbitNormal: XrVector3;
 *   onInserted: (() => void) | null;
 * }} OrbitalInsertAutomation
 * @typedef {{
 *   type: 'pendingOrbitalInsert';
 *   center: XrVector3;
 *   options: import('./index.d.ts').XrOrbitalInsertOptions;
 * }} PendingOrbitalInsertAutomation
 * @typedef {FlyToAutomation | FlyPolylineAutomation | OrbitAutomation | PendingOrbitAutomation | OrbitalInsertAutomation | PendingOrbitalInsertAutomation} MovementAutomation
 * @typedef {{
 *   type: 'lookAt';
 *   target: XrVector3;
 *   up: XrVector3 | null;
 *   blend: number;
 *   arrivalThresholdRad: number;
 *   onArrive: (() => void) | null;
 * }} LookAtAutomation
 * @typedef {{
 *   type: 'lockAt';
 *   target: XrVector3;
 *   up: XrVector3 | null;
 *   dwellSecs: number;
 *   recenterSpeed: number;
 * }} LockAtAutomation
 * @typedef {LookAtAutomation | LockAtAutomation} OrientationAutomation
 */
