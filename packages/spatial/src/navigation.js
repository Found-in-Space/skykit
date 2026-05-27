import {
  addVectors,
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
/** @typedef {{ center: SpatialVector3; radius: number; angularSpeedRadPerSec: number; normal: SpatialVector3 | null; normalSpecified: boolean }} NormalizedOrbitTransferOrbit */
/** @typedef {NormalizedOrbitTransferOrbit & { normal: SpatialVector3 }} ResolvedOrbitTransferOrbit */
/** @typedef {{ radial: SpatialVector3; orbit: ResolvedOrbitTransferOrbit }} OrbitInsertionCandidate */
/** @typedef {{ x: number[]; y: number[]; z: number[]; durationSecs: number }} QuinticVectorCoefficients */

const EPSILON = 1e-9;
const ICRS_NORTH = Object.freeze({ x: 0, y: 0, z: 1 });
const DEFAULT_ROUTE_SETTLE_SECS = 0.5;
const ORBIT_INSERT_CANDIDATE_COUNT = 48;
const ORBIT_INSERT_COST_SAMPLES = 32;

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
  const center = normalizeOptionalVector3(options.center);
  if (!center) return null;
  const currentDistance = pointDistance(startPosition, center);
  const radius = positiveFinite(options.radius, currentDistance || 1);
  const angularSpeedRadPerSec = finiteNumber(options.angularSpeed, 0.1);
  const sampleStepSeconds = positiveFinite(options.sampleStepSecs, 1 / 60);
  const durationSecs = positiveFinite(options.durationSecs, 5);
  const defaultMaxPoints = Math.ceil((durationSecs + DEFAULT_ROUTE_SETTLE_SECS) / sampleStepSeconds) + 1;
  const maxPoints = Math.max(2, Math.floor(positiveFinite(options.maxPoints, defaultMaxPoints)));
  const destinationOrbit = normalizeOrbitTransferOrbit({
    center,
    radius,
    angularSpeedRadPerSec,
    ...(options.orbitNormal != null ? { normal: options.orbitNormal } : {}),
  });
  if (!destinationOrbit) return null;
  const approachVelocity = normalizeOptionalVector3(options.approachVelocity)
    ?? resolveOrbitApproachVelocity(startPosition, null, destinationOrbit, durationSecs);
  const transferOrbit = resolveTransferDestinationOrbit({
    start: startPosition,
    sourceOrbit: null,
    destinationOrbit,
    approachVelocity,
  });
  const route = createPhysicsLiteOrbitInsertRoute({
    start: startPosition,
    sourceOrbit: null,
    destinationOrbit: transferOrbit,
    durationSecs,
    sampleStepSecs: sampleStepSeconds,
    maxPoints,
    approachVelocity,
  });
  return route
    ? {
        points: route.points,
        arrivalAction: route.arrivalAction,
      }
    : null;
}

/**
 * @param {import('./index.d.ts').SpatialOrbitTransferOptions} [options]
 * @returns {import('./index.d.ts').SpatialOrbitTransferRoute | null}
 */
export function createOrbitTransferRoute(options = {}) {
  const start = normalizeOptionalVector3(options.start);
  const destinationOrbit = normalizeOrbitTransferOrbit(options.destinationOrbit);
  if (!start || !destinationOrbit) return null;

  const sourceOrbit = normalizeOrbitTransferOrbit(options.sourceOrbit, true);
  const durationSecs = positiveFinite(options.durationSecs, 5);
  const sampleStepSecs = positiveFinite(options.sampleStepSecs, 1 / 60);
  const maxPoints = Math.max(
    2,
    Math.floor(positiveFinite(
      options.maxPoints,
      Math.ceil((durationSecs + DEFAULT_ROUTE_SETTLE_SECS) / sampleStepSecs) + 1,
    )),
  );
  const currentDistance = pointDistance(start, destinationOrbit.center);
  const sameCenter = sourceOrbit
    ? pointDistance(sourceOrbit.center, destinationOrbit.center) < 1e-6
    : currentDistance <= destinationOrbit.radius * 1.01;
  const approachVelocity = normalizeOptionalVector3(options.approachVelocity)
    ?? resolveOrbitApproachVelocity(start, sourceOrbit, destinationOrbit, durationSecs);

  const transferOrbit = resolveTransferDestinationOrbit({
    start,
    sourceOrbit,
    destinationOrbit,
    approachVelocity,
  });

  if (sameCenter && shouldUseSameCenterOrbitTransfer(sourceOrbit, transferOrbit)) {
    return {
      points: createSameCenterOrbitTransferPoints({
        start,
        sourceOrbit,
        destinationOrbit: transferOrbit,
        durationSecs,
        sampleStepSecs,
        maxPoints,
      }),
      arrivalAction: createOrbitArrivalAction(transferOrbit),
      departureSpeed: sourceOrbit ? orbitSpeed(sourceOrbit) : 0,
      arrivalSpeed: orbitSpeed(transferOrbit),
    };
  }

  const route = createPhysicsLiteOrbitInsertRoute({
    start,
    sourceOrbit,
    destinationOrbit: transferOrbit,
    durationSecs,
    sampleStepSecs,
    maxPoints,
    approachVelocity: approachVelocity ?? undefined,
  });
  if (!route) return null;
  return route;
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
  return orientationTowardDirection(
    forward,
    input?.up ?? skyPositionAngleUp(forward, input?.positionAngleDeg),
  );
}

/**
 * @param {{ direction: SpatialVector3; positionAngleDeg?: number; up?: SpatialVector3 }} input
 * @returns {SpatialQuaternion | null}
 */
export function computeSpatialLookDirectionOrientation(input) {
  const direction = normalizeVector3(input?.direction, nullVector());
  if (!isFiniteVector(direction) || !(vectorLength(direction) > EPSILON)) return null;
  return orientationTowardDirection(
    direction,
    input?.up ?? skyPositionAngleUp(direction, input?.positionAngleDeg),
  );
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
      currentSpeed: Math.max(0, finiteNumber(
        nextOptions.currentSpeed,
        resolveDuration(nextOptions) == null ? lastSnapshot.speedNavigationUnitsPerSecond ?? 0 : 0,
      )),
      arrivalSpeed: Math.max(0, finiteNumber(nextOptions.arrivalSpeed, 0)),
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
   * @param {import('./index.d.ts').SpatialOrbitTransferOrbit | null} [pendingSourceOrbit]
   */
  function beginOrbitalInsert(center, nextOptions, pose = null, pendingSourceOrbit = null) {
    const normalizedCenter = normalizeOptionalVector3(center);
    const currentPose = pose ?? null;
    const activeOrbit = movementAutomation?.type === 'orbit' ? movementAutomation : null;
    const sourceOrbit = pendingSourceOrbit ?? (activeOrbit
      ? {
          center: activeOrbit.center,
          radius: activeOrbit.radius,
          angularSpeedRadPerSec: activeOrbit.angularSpeed,
          normal: activeOrbit.orbitNormal,
        }
      : null);
    if (!normalizedCenter || !currentPose) {
      movementAutomation = {
        type: 'pendingOrbitalInsert',
        center: normalizedCenter ?? { x: 0, y: 0, z: 0 },
        options: { ...nextOptions },
        sourceOrbit,
      };
      return Boolean(normalizedCenter);
    }
    const distance = pointDistance(currentPose.position, normalizedCenter);
    const radius = positiveFinite(nextOptions.radius, distance || 1);
    const angularSpeed = finiteNumber(nextOptions.angularSpeed, defaults.angularSpeed);
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
    const approachVelocity = nextOptions.approachVelocity ?? lastSnapshot.velocity;
    const durationSecs = resolveDuration(nextOptions)
      ?? Math.max(
        0.5,
        distance / Math.max(
          positiveFinite(nextOptions.approachSpeed ?? nextOptions.speed, defaults.speed),
          EPSILON,
        ),
      );
    const route = createOrbitTransferRoute({
      start: currentPose.position,
      sourceOrbit,
      destinationOrbit: {
        center: normalizedCenter,
        radius,
        angularSpeedRadPerSec: angularSpeed,
        ...(nextOptions.orbitNormal != null ? { normal: nextOptions.orbitNormal } : {}),
      },
      durationSecs,
      sampleStepSecs: nextOptions.sampleStepSecs,
      maxPoints: nextOptions.maxPoints,
      approachVelocity,
    });
    if (!route || !beginFlyPolyline(route.points, {
      ...nextOptions,
      durationSecs,
      currentSpeed: route.departureSpeed,
      arrivalSpeed: route.arrivalSpeed,
      arrivalThreshold: nextOptions.arrivalThreshold,
      arrivalAction: route.arrivalAction,
      onArrive: onInserted ?? undefined,
    })) {
      return false;
    }
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
      return beginOrbitalInsert(movementAutomation.center, movementAutomation.options, pose, movementAutomation.sourceOrbit)
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
    if (automation.durationSecs == null && remaining <= automation.arrivalThreshold) {
      return finishMovementWithArrivalAction(
        finalPoint ? { position: finalPoint, orientation: cloneQuaternion(pose.orientation) } : pose,
        automation.arrivalAction,
        automation.onArrive,
      );
    }
    let completedDuration = false;
    let durationOverflowSecs = 0;
    if (automation.durationSecs != null) {
      const nextElapsedSecs = automation.elapsedSecs + dt;
      completedDuration = nextElapsedSecs >= automation.durationSecs;
      durationOverflowSecs = completedDuration ? Math.max(0, nextElapsedSecs - automation.durationSecs) : 0;
      automation.elapsedSecs = Math.min(automation.durationSecs, nextElapsedSecs);
      const linear = clamp(automation.elapsedSecs / automation.durationSecs, 0, 1);
      automation.distance = completedDuration
        ? automation.route.totalLength
        : automation.route.totalLength * routeDurationFraction({
            linear,
            durationSecs: automation.durationSecs,
            totalLength: automation.route.totalLength,
            departureSpeed: automation.currentSpeed,
            arrivalSpeed: automation.arrivalSpeed,
          });
    } else {
      const { step } = resolveAutomationStep(automation, remaining, dt);
      automation.distance = Math.min(automation.route.totalLength, automation.distance + step);
    }
    const position = sampleSpatialPolylineRoutePosition(automation.route, automation.distance) ?? pose.position;
    const shouldFinish = automation.durationSecs != null
      ? completedDuration
      : (automation.route.totalLength - automation.distance) <= automation.arrivalThreshold;
    if (shouldFinish) {
      return finishMovementWithArrivalAction(
        finalPoint ? { position: finalPoint, orientation: cloneQuaternion(pose.orientation) } : { position, orientation: cloneQuaternion(pose.orientation) },
        automation.arrivalAction,
        automation.onArrive,
        durationOverflowSecs,
      );
    }
    return { position, orientation: cloneQuaternion(pose.orientation) };
  }

  /**
   * @param {SpatialPose} pose
   * @param {unknown} action
   * @param {(() => void) | null} callback
   * @param {number} [advanceSeconds]
   * @returns {SpatialPose}
   */
  function finishMovementWithArrivalAction(pose, action, callback, advanceSeconds = 0) {
    if (!action || typeof action !== 'object') {
      movementAutomation = null;
      callback?.();
      return clonePose(pose);
    }
    const arrival = /** @type {import('./index.d.ts').SpatialArrivalAction} */ (action);
    if (arrival.type === 'orbit') {
      const started = beginOrbit(arrival.center, {
        radius: arrival.radius,
        angularSpeed: finiteNumber(arrival.angularSpeedRadPerSec, defaults.angularSpeed),
        orbitNormal: arrival.normal,
      }, pose);
      if (!started) movementAutomation = null;
      callback?.();
      return started && advanceSeconds > EPSILON
        ? updateMovement(pose, advanceSeconds)
        : clonePose(pose);
    }
    if (arrival.type === 'orbitalInsert') {
      const started = beginOrbitalInsert(arrival.center, {
        ...arrival,
        angularSpeed: arrival.angularSpeedRadPerSec,
        orbitNormal: arrival.normal,
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
 * @param {{
 *   start: SpatialVector3;
 *   sourceOrbit: NormalizedOrbitTransferOrbit | null;
 *   destinationOrbit: NormalizedOrbitTransferOrbit;
 *   approachVelocity: SpatialVector3 | null;
 * }} options
 * @returns {ResolvedOrbitTransferOrbit}
 */
function resolveTransferDestinationOrbit(options) {
  const { start, sourceOrbit, destinationOrbit, approachVelocity } = options;
  if (destinationOrbit.normalSpecified && destinationOrbit.normal) {
    return {
      ...destinationOrbit,
      normal: cloneVector3(destinationOrbit.normal),
      normalSpecified: true,
    };
  }

  const fallbackNormal = sourceOrbit?.normal ?? LOCAL_UP;
  const approach = normalizeDirectionOrNull(approachVelocity);
  const radial = normalizeDirectionOrNull(subtractVectors(start, destinationOrbit.center))
    ?? normalizeDirectionOrFallback(projectOnPlane(LOCAL_RIGHT, fallbackNormal), LOCAL_RIGHT);
  let normal = fallbackNormal;
  if (approach) {
    const candidate = normalizeDirectionOrNull(cross(radial, approach));
    if (candidate) {
      normal = candidate;
      if (dot(orbitTangentDirection(radial, normal, 1), approach) < 0) {
        normal = scaleVector(normal, -1);
      }
    }
  }

  return {
    ...destinationOrbit,
    angularSpeedRadPerSec: Math.abs(destinationOrbit.angularSpeedRadPerSec),
    normal: normalizeDirectionOrFallback(normal, LOCAL_UP),
    normalSpecified: false,
  };
}

/**
 * @param {NormalizedOrbitTransferOrbit | null} sourceOrbit
 * @param {NormalizedOrbitTransferOrbit} destinationOrbit
 */
function shouldUseSameCenterOrbitTransfer(sourceOrbit, destinationOrbit) {
  if (!destinationOrbit.normal) return false;
  if (!sourceOrbit?.normal) return true;
  return Math.abs(dot(sourceOrbit.normal, destinationOrbit.normal)) > 0.999;
}

/**
 * @param {{
 *   start: SpatialVector3;
 *   sourceOrbit: NormalizedOrbitTransferOrbit | null;
 *   destinationOrbit: ResolvedOrbitTransferOrbit;
 *   durationSecs: number;
 *   sampleStepSecs: number;
 *   maxPoints: number;
 *   approachVelocity?: SpatialVector3;
 * }} options
 * @returns {import('./index.d.ts').SpatialOrbitTransferRoute | null}
 */
function createPhysicsLiteOrbitInsertRoute(options) {
  const startVelocity = resolveOrbitApproachVelocity(
    options.start,
    options.sourceOrbit,
    options.destinationOrbit,
    options.durationSecs,
    options.approachVelocity,
  );
  const startAcceleration = options.sourceOrbit
    ? orbitCentripetalAcceleration(options.start, options.sourceOrbit)
    : nullVector3();
  const candidates = createOrbitInsertionCandidates({
    start: options.start,
    sourceOrbit: options.sourceOrbit,
    destinationOrbit: options.destinationOrbit,
    approachVelocity: startVelocity,
  });
  if (candidates.length === 0) return null;

  let best = null;
  for (const candidate of candidates) {
    const next = createQuinticOrbitRouteCandidate({
      start: options.start,
      startVelocity,
      startAcceleration,
      destinationOrbit: candidate.orbit,
      radial: candidate.radial,
      durationSecs: options.durationSecs,
      sampleStepSecs: options.sampleStepSecs,
      maxPoints: options.maxPoints,
    });
    if (!next) continue;
    const cost = scoreOrbitRouteCandidate(next, candidate.orbit);
    if (!best || cost < best.cost) {
      best = { ...next, cost, orbit: candidate.orbit };
    }
  }
  if (!best) return null;

  return {
    points: best.points.map(cloneVector3),
    arrivalAction: createOrbitArrivalAction(best.orbit),
    departureSpeed: vectorLength(startVelocity),
    arrivalSpeed: orbitSpeed(best.orbit),
  };
}

/**
 * @param {{
 *   start: SpatialVector3;
 *   sourceOrbit: NormalizedOrbitTransferOrbit | null;
 *   destinationOrbit: ResolvedOrbitTransferOrbit;
 *   approachVelocity: SpatialVector3;
 * }} options
 */
function createOrbitInsertionCandidates(options) {
  const orbit = options.destinationOrbit;
  if (orbit.normalSpecified) {
    return createSpecifiedPlaneInsertionCandidates(options);
  }
  return createApproachPlaneInsertionCandidates(options);
}

/**
 * @param {{
 *   start: SpatialVector3;
 *   destinationOrbit: ResolvedOrbitTransferOrbit;
 *   approachVelocity: SpatialVector3;
 * }} options
 */
function createSpecifiedPlaneInsertionCandidates(options) {
  const orbit = options.destinationOrbit;
  const normal = normalizeDirectionOrFallback(orbit.normal, LOCAL_UP);
  const basis = createOrbitBasis({ orbitNormal: normal });
  /** @type {OrbitInsertionCandidate[]} */
  const candidates = [];
  const seen = new Set();
  /** @param {SpatialVector3} radial */
  const addRadial = (radial) => {
    const projected = normalizeDirectionOrNull(projectOnPlane(radial, normal));
    if (!projected) return;
    const key = `${projected.x.toFixed(5)},${projected.y.toFixed(5)},${projected.z.toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      radial: projected,
      orbit: {
        ...orbit,
        normal,
        normalSpecified: true,
      },
    });
  };

  addRadial(subtractVectors(options.start, orbit.center));
  const approach = normalizeDirectionOrNull(projectOnPlane(options.approachVelocity, normal));
  if (approach) {
    addRadial(scaleVector(cross(normal, approach), Math.sign(orbit.angularSpeedRadPerSec || 1)));
  }
  for (let index = 0; index < ORBIT_INSERT_CANDIDATE_COUNT; index += 1) {
    const angle = (Math.PI * 2 * index) / ORBIT_INSERT_CANDIDATE_COUNT;
    addRadial({
      x: basis.xAxis.x * Math.cos(angle) + basis.zAxis.x * Math.sin(angle),
      y: basis.xAxis.y * Math.cos(angle) + basis.zAxis.y * Math.sin(angle),
      z: basis.xAxis.z * Math.cos(angle) + basis.zAxis.z * Math.sin(angle),
    });
  }
  return candidates;
}

/**
 * @param {{
 *   start: SpatialVector3;
 *   sourceOrbit: NormalizedOrbitTransferOrbit | null;
 *   destinationOrbit: ResolvedOrbitTransferOrbit;
 *   approachVelocity: SpatialVector3;
 * }} options
 */
function createApproachPlaneInsertionCandidates(options) {
  const orbit = options.destinationOrbit;
  const approach = normalizeDirectionOrNull(options.approachVelocity)
    ?? normalizeDirectionOrFallback(subtractVectors(orbit.center, options.start), LOCAL_FORWARD);
  const offset = subtractVectors(options.start, orbit.center);
  let axis = normalizeDirectionOrNull(projectOnPlane(offset, approach));
  if (!axis) {
    axis = normalizeDirectionOrNull(projectOnPlane(options.sourceOrbit?.normal ?? LOCAL_RIGHT, approach));
  }
  if (!axis) {
    axis = Math.abs(dot(approach, LOCAL_RIGHT)) < 0.95
      ? normalizeDirectionOrFallback(projectOnPlane(LOCAL_RIGHT, approach), LOCAL_RIGHT)
      : normalizeDirectionOrFallback(projectOnPlane(LOCAL_UP, approach), LOCAL_UP);
  }
  const side = normalizeDirectionOrFallback(cross(approach, axis), LOCAL_RIGHT);
  /** @type {OrbitInsertionCandidate[]} */
  const candidates = [];
  const seen = new Set();
  /** @param {SpatialVector3} radial */
  const addRadial = (radial) => {
    const normalized = normalizeDirectionOrNull(radial);
    if (!normalized) return;
    let normal = normalizeDirectionOrNull(cross(normalized, approach))
      ?? options.sourceOrbit?.normal
      ?? orbit.normal
      ?? LOCAL_UP;
    normal = normalizeDirectionOrFallback(normal, LOCAL_UP);
    if (dot(orbitTangentDirection(normalized, normal, 1), approach) < 0) {
      normal = scaleVector(normal, -1);
    }
    const key = `${normalized.x.toFixed(5)},${normalized.y.toFixed(5)},${normalized.z.toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      radial: normalized,
      orbit: {
        ...orbit,
        angularSpeedRadPerSec: Math.abs(orbit.angularSpeedRadPerSec),
        normal,
        normalSpecified: false,
      },
    });
  };

  for (let index = 0; index < ORBIT_INSERT_CANDIDATE_COUNT; index += 1) {
    const angle = (Math.PI * 2 * index) / ORBIT_INSERT_CANDIDATE_COUNT;
    addRadial({
      x: axis.x * Math.cos(angle) + side.x * Math.sin(angle),
      y: axis.y * Math.cos(angle) + side.y * Math.sin(angle),
      z: axis.z * Math.cos(angle) + side.z * Math.sin(angle),
    });
  }
  return candidates;
}

/**
 * @param {{
 *   start: SpatialVector3;
 *   startVelocity: SpatialVector3;
 *   startAcceleration: SpatialVector3;
 *   destinationOrbit: ResolvedOrbitTransferOrbit;
 *   radial: SpatialVector3;
 *   durationSecs: number;
 *   sampleStepSecs: number;
 *   maxPoints: number;
 * }} options
 */
function createQuinticOrbitRouteCandidate(options) {
  const pointCount = Math.max(
    2,
    Math.min(options.maxPoints, Math.ceil(options.durationSecs / options.sampleStepSecs) + 1),
  );
  const endPosition = addVectors(
    options.destinationOrbit.center,
    scaleVector(options.radial, options.destinationOrbit.radius),
  );
  const endVelocity = orbitTangentVelocityFromRadial(
    options.radial,
    options.destinationOrbit,
  );
  const endAcceleration = scaleVector(
    options.radial,
    -(options.destinationOrbit.angularSpeedRadPerSec ** 2) * options.destinationOrbit.radius,
  );
  const coefficients = createQuinticVectorCoefficients({
    p0: options.start,
    v0: options.startVelocity,
    a0: options.startAcceleration,
    p1: endPosition,
    v1: endVelocity,
    a1: endAcceleration,
    durationSecs: options.durationSecs,
  });
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    const u = pointCount === 1 ? 1 : index / (pointCount - 1);
    points.push(evaluateQuinticPosition(coefficients, u));
  }
  return {
    points,
    coefficients,
    endVelocity,
  };
}

/**
 * @param {{
 *   p0: SpatialVector3;
 *   v0: SpatialVector3;
 *   a0: SpatialVector3;
 *   p1: SpatialVector3;
 *   v1: SpatialVector3;
 *   a1: SpatialVector3;
 *   durationSecs: number;
 * }} options
 */
function createQuinticVectorCoefficients(options) {
  const T = options.durationSecs;
  const T2 = T * T;
  return {
    x: createQuinticScalarCoefficients(options.p0.x, options.v0.x, options.a0.x, options.p1.x, options.v1.x, options.a1.x, T, T2),
    y: createQuinticScalarCoefficients(options.p0.y, options.v0.y, options.a0.y, options.p1.y, options.v1.y, options.a1.y, T, T2),
    z: createQuinticScalarCoefficients(options.p0.z, options.v0.z, options.a0.z, options.p1.z, options.v1.z, options.a1.z, T, T2),
    durationSecs: T,
  };
}

/**
 * @param {number} p0
 * @param {number} v0
 * @param {number} a0
 * @param {number} p1
 * @param {number} v1
 * @param {number} a1
 * @param {number} T
 * @param {number} T2
 * @returns {number[]}
 */
function createQuinticScalarCoefficients(p0, v0, a0, p1, v1, a1, T, T2) {
  const c0 = p0;
  const c1 = v0 * T;
  const c2 = 0.5 * a0 * T2;
  const D = p1 - c0 - c1 - c2;
  const V = v1 * T - c1 - 2 * c2;
  const A = a1 * T2 - 2 * c2;
  return [
    c0,
    c1,
    c2,
    10 * D - 4 * V + 0.5 * A,
    -15 * D + 7 * V - A,
    6 * D - 3 * V + 0.5 * A,
  ];
}

/** @param {QuinticVectorCoefficients} coefficients @param {number} u */
function evaluateQuinticPosition(coefficients, u) {
  return {
    x: evaluateQuinticScalar(coefficients.x, u),
    y: evaluateQuinticScalar(coefficients.y, u),
    z: evaluateQuinticScalar(coefficients.z, u),
  };
}

/** @param {QuinticVectorCoefficients} coefficients @param {number} u */
function evaluateQuinticVelocity(coefficients, u) {
  const scale = 1 / coefficients.durationSecs;
  return {
    x: evaluateQuinticScalarDerivative(coefficients.x, u) * scale,
    y: evaluateQuinticScalarDerivative(coefficients.y, u) * scale,
    z: evaluateQuinticScalarDerivative(coefficients.z, u) * scale,
  };
}

/** @param {QuinticVectorCoefficients} coefficients @param {number} u */
function evaluateQuinticAcceleration(coefficients, u) {
  const scale = 1 / (coefficients.durationSecs * coefficients.durationSecs);
  return {
    x: evaluateQuinticScalarSecondDerivative(coefficients.x, u) * scale,
    y: evaluateQuinticScalarSecondDerivative(coefficients.y, u) * scale,
    z: evaluateQuinticScalarSecondDerivative(coefficients.z, u) * scale,
  };
}

/** @param {QuinticVectorCoefficients} coefficients @param {number} u */
function evaluateQuinticJerk(coefficients, u) {
  const scale = 1 / (coefficients.durationSecs ** 3);
  return {
    x: evaluateQuinticScalarThirdDerivative(coefficients.x, u) * scale,
    y: evaluateQuinticScalarThirdDerivative(coefficients.y, u) * scale,
    z: evaluateQuinticScalarThirdDerivative(coefficients.z, u) * scale,
  };
}

/** @param {number[]} coefficients @param {number} u */
function evaluateQuinticScalar(coefficients, u) {
  return coefficients[0]
    + coefficients[1] * u
    + coefficients[2] * u ** 2
    + coefficients[3] * u ** 3
    + coefficients[4] * u ** 4
    + coefficients[5] * u ** 5;
}

/** @param {number[]} coefficients @param {number} u */
function evaluateQuinticScalarDerivative(coefficients, u) {
  return coefficients[1]
    + 2 * coefficients[2] * u
    + 3 * coefficients[3] * u ** 2
    + 4 * coefficients[4] * u ** 3
    + 5 * coefficients[5] * u ** 4;
}

/** @param {number[]} coefficients @param {number} u */
function evaluateQuinticScalarSecondDerivative(coefficients, u) {
  return 2 * coefficients[2]
    + 6 * coefficients[3] * u
    + 12 * coefficients[4] * u ** 2
    + 20 * coefficients[5] * u ** 3;
}

/** @param {number[]} coefficients @param {number} u */
function evaluateQuinticScalarThirdDerivative(coefficients, u) {
  return 6 * coefficients[3]
    + 24 * coefficients[4] * u
    + 60 * coefficients[5] * u ** 2;
}

/**
 * @param {{
 *   points: SpatialVector3[];
 *   coefficients: {
 *     x: number[];
 *     y: number[];
 *     z: number[];
 *     durationSecs: number;
 *   };
 *   endVelocity: SpatialVector3;
 * }} candidate
 * @param {import('./index.d.ts').SpatialOrbitTransferOrbit & {
 *   angularSpeedRadPerSec: number;
 *   normal: SpatialVector3;
 * }} orbit
 */
function scoreOrbitRouteCandidate(candidate, orbit) {
  let length = 0;
  let centerPenalty = 0;
  let smoothnessCost = 0;
  let curvaturePenalty = 0;
  const clearanceRadius = Math.max(orbit.radius * 0.7, orbit.radius - Math.max(orbit.radius * 0.25, 1));
  for (let index = 1; index < candidate.points.length; index += 1) {
    const previous = candidate.points[index - 1];
    const point = candidate.points[index];
    length += pointDistance(previous, point);
    const centerDistance = pointDistance(point, orbit.center);
    if (centerDistance < clearanceRadius) {
      centerPenalty += ((clearanceRadius - centerDistance) / Math.max(orbit.radius, 1)) ** 2 * 5000;
    }
    if (index > 1) {
      const a = subtractVectors(previous, candidate.points[index - 2]);
      const b = subtractVectors(point, previous);
      if (vectorLength(a) > EPSILON && vectorLength(b) > EPSILON) {
        const angle = Math.acos(clamp(dot(a, b) / (vectorLength(a) * vectorLength(b)), -1, 1));
        curvaturePenalty += angle * angle * 200;
      }
    }
  }
  for (let index = 0; index <= ORBIT_INSERT_COST_SAMPLES; index += 1) {
    const u = index / ORBIT_INSERT_COST_SAMPLES;
    const acceleration = evaluateQuinticAcceleration(candidate.coefficients, u);
    const jerk = evaluateQuinticJerk(candidate.coefficients, u);
    smoothnessCost += dot(acceleration, acceleration) + dot(jerk, jerk) * 0.02;
  }
  const finalDirection = normalizeDirectionOrNull(subtractVectors(
    candidate.points[candidate.points.length - 1],
    candidate.points[candidate.points.length - 2],
  ));
  const targetDirection = normalizeDirectionOrNull(candidate.endVelocity);
  const arrivalPenalty = finalDirection && targetDirection
    ? (1 - clamp(dot(finalDirection, targetDirection), -1, 1)) * 2000
    : 0;
  return smoothnessCost + curvaturePenalty + centerPenalty + length * 0.05 + arrivalPenalty;
}

/**
 * @param {unknown} value
 * @param {boolean} [optional]
 * @returns {NormalizedOrbitTransferOrbit | null}
 */
function normalizeOrbitTransferOrbit(value, optional = false) {
  if (!value || typeof value !== 'object') return optional ? null : null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const center = normalizeOptionalVector3(source.center);
  if (!center) return null;
  const radius = positiveFinite(source.radius, Number.NaN);
  if (!(radius > 0)) return null;
  const normal = normalizeDirectionOrNull(source.normal);
  return {
    center,
    radius,
    angularSpeedRadPerSec: finiteNumber(source.angularSpeedRadPerSec, 0.1),
    normal,
    normalSpecified: Boolean(normal),
  };
}

/**
 * @param {{
 *   start: SpatialVector3;
 *   sourceOrbit: NormalizedOrbitTransferOrbit | null;
 *   destinationOrbit: ResolvedOrbitTransferOrbit;
 *   durationSecs: number;
 *   sampleStepSecs: number;
 *   maxPoints: number;
 * }} options
 * @returns {SpatialVector3[]}
 */
function createSameCenterOrbitTransferPoints(options) {
  const { start, sourceOrbit, destinationOrbit, durationSecs, sampleStepSecs, maxPoints } = options;
  const pointCount = Math.max(2, Math.min(maxPoints, Math.ceil(durationSecs / sampleStepSecs) + 1));
  const center = destinationOrbit.center;
  const normal = destinationOrbit.normal;
  const currentDistance = pointDistance(start, center);
  const startRadius = currentDistance > EPSILON
    ? currentDistance
    : sourceOrbit?.radius ?? destinationOrbit.radius;
  const startAngle = currentDistance > EPSILON
    ? deriveSpatialOrbitAngle({ center, position: start, orbitNormal: normal })
    : 0;
  const sourceAngularSpeed = sourceOrbit?.angularSpeedRadPerSec ?? destinationOrbit.angularSpeedRadPerSec;
  const points = [cloneVector3(start)];

  for (let index = 1; index < pointCount; index += 1) {
    const linear = index / (pointCount - 1);
    const radiusBlend = smoothstep(0, 1, linear);
    const speedIntegralBlend = sourceAngularSpeed * (linear - (linear * linear) / 2)
      + destinationOrbit.angularSpeedRadPerSec * ((linear * linear) / 2);
    const radius = startRadius + (destinationOrbit.radius - startRadius) * radiusBlend;
    const angle = startAngle + speedIntegralBlend * durationSecs;
    points.push(orbitPosition(center, radius, angle, normal));
  }

  return points;
}

/**
 * @param {{
 *   linear: number;
 *   durationSecs: number;
 *   totalLength: number;
 *   departureSpeed: number;
 *   arrivalSpeed: number;
 * }} options
 */
function routeDurationFraction(options) {
  const linear = clamp(options.linear, 0, 1);
  if (linear <= 0) return 0;
  if (linear >= 1) return 1;
  if (!(options.totalLength > EPSILON) || !(options.durationSecs > EPSILON)) {
    return smoothstep(0, 1, linear);
  }
  let departureSlope = clamp((Math.max(0, options.departureSpeed) * options.durationSecs) / options.totalLength, 0, 2.5);
  let arrivalSlope = clamp((Math.max(0, options.arrivalSpeed) * options.durationSecs) / options.totalLength, 0, 2.5);
  const slopeMagnitude = Math.hypot(departureSlope, arrivalSlope);
  if (slopeMagnitude > 2.5) {
    const scale = 2.5 / slopeMagnitude;
    departureSlope *= scale;
    arrivalSlope *= scale;
  }
  return clamp(quinticHermiteUnit(linear, departureSlope, arrivalSlope), 0, 1);
}

/**
 * @param {number} linear
 * @param {number} departureSlope
 * @param {number} arrivalSlope
 */
function quinticHermiteUnit(linear, departureSlope, arrivalSlope) {
  const u2 = linear * linear;
  const u3 = u2 * linear;
  const u4 = u3 * linear;
  const u5 = u4 * linear;
  return departureSlope * linear
    + (10 - 6 * departureSlope - 4 * arrivalSlope) * u3
    + (-15 + 8 * departureSlope + 7 * arrivalSlope) * u4
    + (6 - 3 * departureSlope - 3 * arrivalSlope) * u5;
}

/**
 * @param {ResolvedOrbitTransferOrbit} orbit
 * @returns {import('./index.d.ts').SpatialOrbitTransferRoute['arrivalAction']}
 */
function createOrbitArrivalAction(orbit) {
  return {
    type: 'orbit',
    center: cloneVector3(orbit.center),
    radius: orbit.radius,
    angularSpeedRadPerSec: orbit.angularSpeedRadPerSec,
    normal: cloneVector3(orbit.normal),
  };
}

/**
 * @param {SpatialVector3} start
 * @param {NormalizedOrbitTransferOrbit | null} sourceOrbit
 * @param {NormalizedOrbitTransferOrbit} destinationOrbit
 * @param {number} durationSecs
 * @param {SpatialVector3} [explicitVelocity]
 */
function resolveOrbitApproachVelocity(start, sourceOrbit, destinationOrbit, durationSecs, explicitVelocity) {
  const explicit = normalizeOptionalVector3(explicitVelocity);
  if (explicit && vectorLength(explicit) > EPSILON) return explicit;
  if (sourceOrbit?.normal) {
    const tangent = orbitTangentVelocity(start, /** @type {import('./index.d.ts').SpatialOrbitTransferOrbit & {
      angularSpeedRadPerSec: number;
      normal: SpatialVector3;
    }} */ (sourceOrbit));
    if (vectorLength(tangent) > EPSILON) return tangent;
  }
  const toCenter = subtractVectors(destinationOrbit.center, start);
  const direction = normalizeDirectionOrNull(toCenter) ?? LOCAL_FORWARD;
  const destinationSpeed = orbitSpeed(destinationOrbit);
  const cruiseSpeed = positiveFinite(
    pointDistance(start, destinationOrbit.center) / Math.max(durationSecs, EPSILON),
    destinationSpeed,
  );
  return scaleVector(direction, Math.max(cruiseSpeed * 0.65, destinationSpeed));
}

/**
 * @param {SpatialVector3} position
 * @param {{ center: SpatialVector3; radius: number; angularSpeedRadPerSec: number }} orbit
 */
function orbitCentripetalAcceleration(position, orbit) {
  const radial = normalizeDirectionOrNull(subtractVectors(position, orbit.center));
  if (!radial) return nullVector3();
  return scaleVector(radial, -(orbit.angularSpeedRadPerSec ** 2) * orbit.radius);
}

/**
 * @param {{ radius: number; angularSpeedRadPerSec: number }} orbit
 */
function orbitSpeed(orbit) {
  return Math.abs(orbit.angularSpeedRadPerSec) * orbit.radius;
}

/**
 * @param {SpatialVector3} radial
 * @param {import('./index.d.ts').SpatialOrbitTransferOrbit & {
 *   angularSpeedRadPerSec: number;
 *   normal: SpatialVector3;
 * }} orbit
 */
function orbitTangentVelocityFromRadial(radial, orbit) {
  return scaleVector(
    orbitTangentDirection(radial, orbit.normal, orbit.angularSpeedRadPerSec),
    orbitSpeed(orbit),
  );
}

/**
 * @param {SpatialVector3} radial
 * @param {SpatialVector3} normal
 * @param {number} angularSpeed
 */
function orbitTangentDirection(radial, normal, angularSpeed) {
  const tangent = normalizeDirectionOrFallback(cross(radial, normal), LOCAL_FORWARD);
  return angularSpeed < 0 ? scaleVector(tangent, -1) : tangent;
}

/**
 * @param {SpatialVector3} position
 * @param {import('./index.d.ts').SpatialOrbitTransferOrbit & {
 *   angularSpeedRadPerSec: number;
 *   normal: SpatialVector3;
 * }} orbit
 * @returns {SpatialVector3}
 */
function orbitTangentVelocity(position, orbit) {
  const basis = createOrbitBasis({ orbitNormal: orbit.normal });
  const angle = deriveSpatialOrbitAngle({
    center: orbit.center,
    position,
    orbitNormal: orbit.normal,
  });
  const tangent = {
    x: -basis.xAxis.x * Math.sin(angle) + basis.zAxis.x * Math.cos(angle),
    y: -basis.xAxis.y * Math.sin(angle) + basis.zAxis.y * Math.cos(angle),
    z: -basis.xAxis.z * Math.sin(angle) + basis.zAxis.z * Math.cos(angle),
  };
  return scaleVector(
    normalizeDirectionOrFallback(tangent, LOCAL_FORWARD),
    orbit.angularSpeedRadPerSec * orbit.radius,
  );
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
 * @param {SpatialVector3} direction
 * @param {unknown} positionAngleDeg
 * @returns {SpatialVector3 | null}
 */
function skyPositionAngleUp(direction, positionAngleDeg) {
  const angleDeg = Number(positionAngleDeg);
  if (!Number.isFinite(angleDeg)) return null;
  const forward = normalizeDirectionOrFallback(direction, LOCAL_FORWARD);
  let east = cross(ICRS_NORTH, forward);
  if (!(vectorLength(east) > EPSILON)) {
    east = cross(LOCAL_RIGHT, forward);
  }
  east = normalizeDirectionOrFallback(east, LOCAL_RIGHT);
  const north = normalizeDirectionOrFallback(cross(forward, east), ICRS_NORTH);
  const angleRad = angleDeg * Math.PI / 180;
  return normalizeDirectionOrFallback(
    addVectors(scaleVector(north, Math.cos(angleRad)), scaleVector(east, Math.sin(angleRad))),
    north,
  );
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

function nullVector3() {
  return { x: 0, y: 0, z: 0 };
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
      normal: cloneVector3(automation.orbitNormal),
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
 *   arrivalSpeed: number;
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
 *   type: 'pendingOrbitalInsert';
 *   center: SpatialVector3;
 *   options: import('./index.d.ts').SpatialOrbitalInsertOptions;
 *   sourceOrbit: import('./index.d.ts').SpatialOrbitTransferOrbit | null;
 * }} PendingOrbitalInsertAutomation
 * @typedef {FlyToAutomation | FlyPolylineAutomation | OrbitAutomation | PendingOrbitAutomation | PendingOrbitalInsertAutomation} MovementAutomation
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
