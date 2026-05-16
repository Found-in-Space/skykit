import {
  cloneMotion,
  cloneQuaternion,
  cloneVector3,
  finiteNumber,
  IDENTITY_QUATERNION,
  normalizeQuaternion,
  normalizeVector3,
} from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitObserverRig} SkykitObserverRig
 */

/**
 * @param {import('./index.d.ts').DesktopSkykitObserverRigOptions} [options]
 * @returns {SkykitObserverRig}
 */
export function createDesktopSkykitObserverRig(options = {}) {
  let observerPc = normalizeVector3(options.observerPc, { x: 0, y: 0, z: 0 });
  let orientationIcrs = normalizeQuaternion(options.orientationIcrs, IDENTITY_QUATERNION);
  let previousObserverPc = cloneVector3(observerPc);
  let motion = {
    velocityPcPerSec: { x: 0, y: 0, z: 0 },
    speedPcPerSec: 0,
  };
  let disposed = false;
  return {
    type: 'desktop',
    getObserverPc() {
      assertActive();
      return cloneVector3(observerPc);
    },
    getRenderObserverPosition() {
      assertActive();
      return cloneVector3(observerPc);
    },
    getOrientationIcrs() {
      assertActive();
      return cloneQuaternion(orientationIcrs);
    },
    getMotion() {
      assertActive();
      return cloneMotion(motion);
    },
    setObserverPc(nextObserverPc) {
      assertActive();
      observerPc = normalizeVector3(nextObserverPc, observerPc);
    },
    setOrientationIcrs(nextOrientation) {
      assertActive();
      orientationIcrs = normalizeQuaternion(nextOrientation, orientationIcrs);
    },
    update(frameData) {
      assertActive();
      const dt = Math.max(0, finiteNumber(frameData.deltaSeconds, 0));
      if (dt > 0) {
        const velocity = {
          x: (observerPc.x - previousObserverPc.x) / dt,
          y: (observerPc.y - previousObserverPc.y) / dt,
          z: (observerPc.z - previousObserverPc.z) / dt,
        };
        motion = {
          velocityPcPerSec: velocity,
          speedPcPerSec: Math.hypot(velocity.x, velocity.y, velocity.z),
        };
      } else {
        motion = {
          velocityPcPerSec: { x: 0, y: 0, z: 0 },
          speedPcPerSec: 0,
        };
      }
      previousObserverPc = cloneVector3(observerPc);
    },
    dispose() {
      disposed = true;
    },
  };

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitObserverRig has been disposed.');
    }
  }
}
