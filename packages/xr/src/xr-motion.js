import {
  addVectors,
  applyQuaternion,
  clonePose,
  finiteNumber,
  isNonZeroVector,
  LOCAL_FORWARD,
  LOCAL_RIGHT,
  LOCAL_UP,
  normalizeDirection,
  normalizePose,
  normalizeScaleProfile,
  positiveFinite,
  rotateLocal,
  scaleVector,
  subtractVectors,
  vectorLength,
} from './xr-math.js';

/**
 * @param {import('./index.d.ts').XrDirectMotionOptions} [options]
 * @returns {import('./index.d.ts').XrMotionModel}
 */
export function createDirectXrMotionModel(options = {}) {
  const config = normalizeMotionConfig(options);
  let lastSnapshot = baseMotionSnapshot('direct');
  return {
    update(input) {
      const next = applyAttitude(normalizePose(input.pose), input.controls, input.deltaSeconds, config);
      const move = resolveMoveVector(next.orientation, input.controls, config);
      const speed = config.moveSpeed * boostMultiplier(input.controls, config);
      const distance = speed * positiveDelta(input.deltaSeconds) * Math.min(1, vectorLength(move));
      if (distance > 0 && isNonZeroVector(move)) {
        next.position = addVectors(next.position, scaleVector(normalizeDirection(move), distance));
      }
      lastSnapshot = {
        type: 'direct',
        velocity: distance > 0 ? scaleVector(normalizeDirection(move), speed) : { x: 0, y: 0, z: 0 },
        speedNavigationUnitsPerSecond: distance > 0 ? speed : 0,
        scale: normalizeScaleProfile(input.scale),
        activeAutomation: null,
      };
      return next;
    },
    getSnapshot() {
      return cloneMotionSnapshot(lastSnapshot);
    },
  };
}

/**
 * @param {import('./index.d.ts').XrInertialMotionOptions} [options]
 * @returns {import('./index.d.ts').XrMotionModel}
 */
export function createInertialXrMotionModel(options = {}) {
  const config = {
    ...normalizeMotionConfig(options),
    acceleration: positiveFinite(options.acceleration, 8),
    damping: positiveFinite(options.damping, 4),
    maxSpeed: positiveFinite(options.maxSpeed, 20),
  };
  let velocity = { x: 0, y: 0, z: 0 };
  let lastSnapshot = baseMotionSnapshot('inertial');
  return {
    update(input) {
      const dt = positiveDelta(input.deltaSeconds);
      const next = applyAttitude(normalizePose(input.pose), input.controls, dt, config);
      const move = resolveMoveVector(next.orientation, input.controls, config);
      if (dt > 0 && isNonZeroVector(move)) {
        velocity = addVectors(velocity, scaleVector(normalizeDirection(move), config.acceleration * dt * boostMultiplier(input.controls, config)));
      } else if (dt > 0) {
        velocity = dampVector(velocity, config.damping * dt);
      }
      velocity = clampVectorLength(velocity, config.maxSpeed);
      next.position = addVectors(next.position, scaleVector(velocity, dt));
      lastSnapshot = {
        type: 'inertial',
        velocity: { ...velocity },
        speedNavigationUnitsPerSecond: vectorLength(velocity),
        scale: normalizeScaleProfile(input.scale),
        activeAutomation: null,
      };
      return next;
    },
    getSnapshot() {
      return cloneMotionSnapshot(lastSnapshot);
    },
  };
}

/**
 * @param {import('./index.d.ts').XrThrustMotionOptions} [options]
 * @returns {import('./index.d.ts').XrMotionModel}
 */
export function createThrustXrMotionModel(options = {}) {
  const config = {
    ...normalizeMotionConfig(options),
    thrust: positiveFinite(options.thrust, 12),
    mass: positiveFinite(options.mass, 1),
    drag: positiveFinite(options.drag, 0.8),
    maxSpeed: positiveFinite(options.maxSpeed, 50),
  };
  let velocity = { x: 0, y: 0, z: 0 };
  let lastSnapshot = baseMotionSnapshot('thrust');
  return {
    update(input) {
      const dt = positiveDelta(input.deltaSeconds);
      const next = applyAttitude(normalizePose(input.pose), input.controls, dt, config);
      const move = resolveMoveVector(next.orientation, input.controls, config);
      if (dt > 0 && isNonZeroVector(move)) {
        const acceleration = (config.thrust / config.mass) * boostMultiplier(input.controls, config);
        velocity = addVectors(velocity, scaleVector(normalizeDirection(move), acceleration * dt));
      }
      velocity = dampVector(velocity, config.drag * dt);
      velocity = clampVectorLength(velocity, config.maxSpeed);
      next.position = addVectors(next.position, scaleVector(velocity, dt));
      lastSnapshot = {
        type: 'thrust',
        velocity: { ...velocity },
        speedNavigationUnitsPerSecond: vectorLength(velocity),
        scale: normalizeScaleProfile(input.scale),
        activeAutomation: null,
      };
      return next;
    },
    getSnapshot() {
      return cloneMotionSnapshot(lastSnapshot);
    },
  };
}

/**
 * @param {import('./index.d.ts').XrFlyToMotionOptions} [options]
 * @returns {import('./index.d.ts').XrFlyToMotionModel}
 */
export function createFlyToMotionModel(options = {}) {
  const config = {
    maxSpeed: options.maxSpeed == null ? null : positiveFinite(options.maxSpeed, 1),
    acceleration: positiveFinite(options.acceleration, 4),
    deceleration: positiveFinite(options.deceleration, 6),
    arrivalThreshold: positiveFinite(options.arrivalThreshold, 0.01),
  };
  /** @type {{ target: { x: number; y: number; z: number }; currentSpeed: number; options: typeof config } | null} */
  let automation = null;
  let lastSnapshot = baseMotionSnapshot('fly-to');
  return {
    flyTo(target, nextOptions = {}) {
      automation = {
        target: { ...target },
        currentSpeed: 0,
        options: {
          ...config,
          ...nextOptions,
          maxSpeed: nextOptions.maxSpeed == null
            ? config.maxSpeed
            : positiveFinite(nextOptions.maxSpeed, config.maxSpeed ?? 1),
          acceleration: positiveFinite(nextOptions.acceleration, config.acceleration),
          deceleration: positiveFinite(nextOptions.deceleration, config.deceleration),
          arrivalThreshold: positiveFinite(nextOptions.arrivalThreshold, config.arrivalThreshold),
        },
      };
    },
    cancel() {
      automation = null;
    },
    update(input) {
      const dt = positiveDelta(input.deltaSeconds);
      const next = normalizePose(input.pose);
      if (!automation || dt <= 0) {
        lastSnapshot = {
          type: 'fly-to',
          velocity: { x: 0, y: 0, z: 0 },
          speedNavigationUnitsPerSecond: 0,
          scale: normalizeScaleProfile(input.scale),
          activeAutomation: automation ? 'flyTo' : null,
        };
        return next;
      }
      const offset = subtractVectors(automation.target, next.position);
      const remaining = vectorLength(offset);
      if (remaining <= automation.options.arrivalThreshold) {
        next.position = { ...automation.target };
        automation = null;
        lastSnapshot = {
          type: 'fly-to',
          velocity: { x: 0, y: 0, z: 0 },
          speedNavigationUnitsPerSecond: 0,
          scale: normalizeScaleProfile(input.scale),
          activeAutomation: null,
        };
        return next;
      }
      const previousSpeed = automation.currentSpeed;
      const brakingDistance = Math.max(0, remaining - automation.options.arrivalThreshold);
      const brakingSpeed = Math.sqrt(2 * automation.options.deceleration * brakingDistance);
      const targetSpeed = automation.options.maxSpeed == null
        ? brakingSpeed
        : Math.min(brakingSpeed, automation.options.maxSpeed);
      if (automation.currentSpeed < targetSpeed) {
        automation.currentSpeed = Math.min(
          targetSpeed,
          automation.currentSpeed + automation.options.acceleration * dt,
        );
      } else {
        automation.currentSpeed = Math.max(
          targetSpeed,
          automation.currentSpeed - automation.options.deceleration * dt,
        );
      }
      const averageSpeed = (previousSpeed + automation.currentSpeed) * 0.5;
      const step = Math.min(remaining, averageSpeed * dt);
      const velocity = scaleVector(normalizeDirection(offset), automation.currentSpeed);
      next.position = addVectors(next.position, scaleVector(normalizeDirection(offset), step));
      lastSnapshot = {
        type: 'fly-to',
        velocity,
        speedNavigationUnitsPerSecond: automation.currentSpeed,
        scale: normalizeScaleProfile(input.scale),
        activeAutomation: 'flyTo',
      };
      return next;
    },
    getSnapshot() {
      return cloneMotionSnapshot(lastSnapshot);
    },
  };
}

/**
 * @param {import('./index.d.ts').XrPose} pose
 * @param {import('./index.d.ts').XrControlReader | undefined} controls
 * @param {number} deltaSeconds
 * @param {ReturnType<typeof normalizeMotionConfig>} config
 */
function applyAttitude(pose, controls, deltaSeconds, config) {
  const dt = positiveDelta(deltaSeconds);
  const attitude = controls?.getAxis?.(config.attitudeAxis) ?? emptyAxis();
  const rollPressed = controls?.isPressed?.(config.rollModifierButton) === true;
  let orientation = pose.orientation;
  if (dt > 0 && attitude.y !== 0) {
    orientation = rotateLocal(orientation, LOCAL_RIGHT, attitude.y * config.pitchRateRadPerSec * dt);
  }
  if (dt > 0 && attitude.x !== 0 && rollPressed) {
    orientation = rotateLocal(orientation, LOCAL_FORWARD, attitude.x * config.rollRateRadPerSec * dt);
  } else if (dt > 0 && attitude.x !== 0) {
    orientation = rotateLocal(orientation, LOCAL_UP, -attitude.x * config.yawRateRadPerSec * dt);
  }
  return { position: { ...pose.position }, orientation };
}

/**
 * @param {{ x: number; y: number; z: number; w: number }} orientation
 * @param {import('./index.d.ts').XrControlReader | undefined} controls
 * @param {ReturnType<typeof normalizeMotionConfig>} config
 */
function resolveMoveVector(orientation, controls, config) {
  const axis = controls?.getAxis?.(config.moveAxis) ?? emptyAxis();
  const right = applyQuaternion(LOCAL_RIGHT, orientation);
  const forward = applyQuaternion(LOCAL_FORWARD, orientation);
  return addVectors(scaleVector(right, axis.x), scaleVector(forward, -axis.y));
}

/**
 * @param {import('./index.d.ts').XrMotionOptions} options
 */
function normalizeMotionConfig(options) {
  return {
    moveAxis: options.moveAxis ?? 'move',
    attitudeAxis: options.attitudeAxis ?? 'attitude',
    rollModifierButton: options.rollModifierButton ?? 'rollModifier',
    boostButton: options.boostButton ?? 'boost',
    moveSpeed: positiveFinite(options.moveSpeed, 4),
    boostMultiplier: positiveFinite(options.boostMultiplier, 2),
    yawRateRadPerSec: positiveFinite(options.yawRateRadPerSec, Math.PI * 0.375),
    pitchRateRadPerSec: positiveFinite(options.pitchRateRadPerSec, Math.PI * 0.3),
    rollRateRadPerSec: positiveFinite(options.rollRateRadPerSec, Math.PI * 0.375),
  };
}

/**
 * @param {import('./index.d.ts').XrControlReader | undefined} controls
 * @param {ReturnType<typeof normalizeMotionConfig>} config
 */
function boostMultiplier(controls, config) {
  return controls?.isPressed?.(config.boostButton) ? config.boostMultiplier : 1;
}

function emptyAxis() {
  return { x: 0, y: 0, active: false, magnitude: 0, activeHand: null };
}

/**
 * @param {number} deltaSeconds
 */
function positiveDelta(deltaSeconds) {
  return Math.max(0, finiteNumber(deltaSeconds, 0));
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 * @param {number} amount
 */
function dampVector(vector, amount) {
  const length = vectorLength(vector);
  if (!(length > 0)) return { x: 0, y: 0, z: 0 };
  const nextLength = Math.max(0, length - amount);
  return scaleVector(vector, nextLength / length);
}

/**
 * @param {{ x: number; y: number; z: number }} vector
 * @param {number} maxLength
 */
function clampVectorLength(vector, maxLength) {
  const length = vectorLength(vector);
  return length > maxLength ? scaleVector(vector, maxLength / length) : vector;
}

/**
 * @param {string} type
 */
function baseMotionSnapshot(type) {
  /** @type {import('./index.d.ts').XrMotionSnapshot} */
  const snapshot = {
    type,
    velocity: { x: 0, y: 0, z: 0 },
    speedNavigationUnitsPerSecond: 0,
    scale: normalizeScaleProfile(),
    activeAutomation: null,
  };
  return snapshot;
}

/**
 * @param {import('./index.d.ts').XrMotionSnapshot} snapshot
 */
function cloneMotionSnapshot(snapshot) {
  return {
    ...snapshot,
    velocity: { ...snapshot.velocity },
    scale: { ...snapshot.scale },
  };
}
