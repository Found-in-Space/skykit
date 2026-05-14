/**
 * @typedef {{ x: number; y: number; z: number }} Point3
 */

/**
 * @param {import('./index.d.ts').StarOctreeViewPatch['motion']} motion
 * @param {Point3} observerPc
 */
export function resolveMotionLookahead(motion, observerPc) {
  const lookaheadSecs = normalizeFiniteNumber(motion?.lookaheadSecs, 0);
  const velocityPcPerSec = normalizeVelocity(motion?.velocityPcPerSec);

  if (!velocityPcPerSec || !(lookaheadSecs > 0)) {
    return {
      enabled: false,
      lookaheadSecs,
      lookaheadDistancePc: 0,
      velocityPcPerSec,
      futureObserverPc: null,
    };
  }

  const speedPcPerSec = Math.hypot(
    velocityPcPerSec.x,
    velocityPcPerSec.y,
    velocityPcPerSec.z,
  );
  const lookaheadDistancePc = speedPcPerSec * lookaheadSecs;

  return {
    enabled: lookaheadDistancePc > 0,
    lookaheadSecs,
    lookaheadDistancePc,
    velocityPcPerSec,
    futureObserverPc: {
      x: observerPc.x + velocityPcPerSec.x * lookaheadSecs,
      y: observerPc.y + velocityPcPerSec.y * lookaheadSecs,
      z: observerPc.z + velocityPcPerSec.z * lookaheadSecs,
    },
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {unknown} value
 * @returns {Point3 | null}
 */
function normalizeVelocity(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const velocity = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(velocity.x);
  const y = Number(velocity.y);
  const z = Number(velocity.z);
  const speed = Math.hypot(x, y, z);

  return Number.isFinite(speed) && speed > 0
    ? { x, y, z }
    : null;
}
