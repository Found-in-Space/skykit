import { DEFAULT_TUNED_EXPOSURE } from '../layers/star-field-materials.js';
import { SCALE } from './octree/scene-scale.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
export const DEFAULT_PICK_TOLERANCE_DEG = 3.0;

const TUNED_DEFAULTS = Object.freeze({
  exposure: DEFAULT_TUNED_EXPOSURE,
  linearScale: 12.0,
  magLimit: 6.5,
  sizeMin: 2.0,
  sizeMax: 256.0,
  extinctionScale: 1.0,
});

/**
 * Decode a teffLog8 byte (0–255) to effective temperature in kelvin,
 * mirroring the vertex shader's decodeTemperature().
 */
export function decodeTemperatureK(teffLog8Raw) {
  const log8 = teffLog8Raw / 255;
  if (log8 >= 0.996) return 5800;
  return 2000 * Math.pow(25, log8);
}

/**
 * Mirror the tuned vertex shader's Stellarium-style point-size calculation.
 * Returns the rendered point size in CSS pixels for a star of apparent
 * magnitude `mApp` under the given material settings.
 */
export function computeVisualRadiusPx(mApp, options = {}) {
  const magLimit = options.magLimit ?? TUNED_DEFAULTS.magLimit;
  const exposure = options.exposure ?? TUNED_DEFAULTS.exposure;
  const linearScale = options.linearScale ?? TUNED_DEFAULTS.linearScale;
  const sizeMin = options.sizeMin ?? TUNED_DEFAULTS.sizeMin;
  const sizeMax = options.sizeMax ?? TUNED_DEFAULTS.sizeMax;

  const relativeFlux = Math.pow(10, 0.4 * (magLimit - mApp));
  const energy = relativeFlux * exposure;
  const rawRadius = Math.sqrt(energy) * linearScale;

  let radius;
  if (rawRadius < sizeMin) {
    const luminance = (rawRadius * rawRadius * rawRadius)
      / (sizeMin * sizeMin * sizeMin);
    if (luminance < 0.03) return 0;
    radius = sizeMin;
  } else if (rawRadius > 8.0) {
    radius = 8.0 + Math.sqrt(1.0 + rawRadius - 8.0) - 1.0;
  } else {
    radius = rawRadius;
  }

  return Math.min(Math.max(radius, sizeMin), sizeMax);
}

/**
 * Pick the most likely star along a ray using angular-cone filtering and
 * magnitude-weighted scoring.  Bright stars get proportionally larger click
 * targets that match their on-screen visual size, solving the
 * "invisible faint star in front of bright star" problem.
 *
 * Works identically for 2-D (mouse/touch) and XR (controller/hand) — the
 * caller just provides the appropriate world-space ray.
 *
 * @param {{ origin: {x,y,z}, direction: {x,y,z} }} ray
 *   World-space pick ray (e.g. from THREE.Raycaster or XR targetRaySpace).
 * @param {Object} starData
 *   From StarFieldLayer.getStarData(): { positions, magAbs, teffLog8, starCount }.
 * @param {Object} [options]
 * @param {number} [options.scale]           Scene scale (default SCALE).
 * @param {number} [options.toleranceDeg]    Angular search cone half-angle in degrees.
 * @param {number} [options.minClickRadiusDeg] Minimum angular click radius for any star.
 * @param {number} [options.fovRad]          Camera vertical FOV in radians.
 * @param {number} [options.viewportHeight]  Viewport height in CSS pixels.
 * @param {number} [options.magLimit]        Current magnitude limit uniform.
 * @param {number} [options.exposure]        Current exposure uniform.
 * @param {number} [options.linearScale]     Stellarium linear-scale factor.
 * @param {number} [options.sizeMin]         Minimum point size (px).
 * @param {number} [options.sizeMax]         Maximum point size (px).
 * @param {number} [options.extinctionScale] Extinction multiplier (default 1).
 * @returns {Object|null}
 */
export function pickStar(ray, starData, options = {}) {
  const {
    scale = SCALE,
    toleranceDeg = DEFAULT_PICK_TOLERANCE_DEG,
    minClickRadiusDeg = 0.15,
    fovRad,
    viewportHeight,
    magLimit = TUNED_DEFAULTS.magLimit,
    exposure = TUNED_DEFAULTS.exposure,
    linearScale = TUNED_DEFAULTS.linearScale,
    sizeMin = TUNED_DEFAULTS.sizeMin,
    sizeMax = TUNED_DEFAULTS.sizeMax,
    extinctionScale = TUNED_DEFAULTS.extinctionScale,
  } = options;

  const { positions, magAbs, teffLog8, starCount } = starData;
  if (!positions || !magAbs || !starCount) return null;

  const toleranceRad = toleranceDeg * DEG_TO_RAD;
  const tanTolerance = Math.tan(toleranceRad);
  const minClickRadiusRad = minClickRadiusDeg * DEG_TO_RAD;

  const canComputeAngularSize =
    Number.isFinite(fovRad) && fovRad > 0
    && Number.isFinite(viewportHeight) && viewportHeight > 0;
  const pixelsPerRadian = canComputeAngularSize
    ? viewportHeight / (2 * Math.tan(fovRad / 2))
    : 0;

  const sizeOpts = { magLimit, exposure, linearScale, sizeMin, sizeMax };

  const ox = ray.origin.x;
  const oy = ray.origin.y;
  const oz = ray.origin.z;
  const dx = ray.direction.x;
  const dy = ray.direction.y;
  const dz = ray.direction.z;

  let bestScore = Infinity;
  let bestIndex = -1;
  let bestAngularDist = 0;
  let bestDistSq = 0;

  for (let i = 0; i < starCount; i++) {
    const vx = positions[i * 3] - ox;
    const vy = positions[i * 3 + 1] - oy;
    const vz = positions[i * 3 + 2] - oz;

    const alongRay = vx * dx + vy * dy + vz * dz;
    if (alongRay <= 0) continue;

    const distSq = vx * vx + vy * vy + vz * vz;
    const perpDistSq = distSq - alongRay * alongRay;

    const coneR = alongRay * tanTolerance;
    if (perpDistSq > coneR * coneR) continue;

    const perpDist = Math.sqrt(Math.max(perpDistSq, 0));
    const angularDist = Math.atan2(perpDist, alongRay);

    const dScene = Math.sqrt(distSq);
    const dPc = Math.max(dScene / scale, 0.001);
    const mApp = magAbs[i] + extinctionScale * (5 * Math.log10(dPc) - 5);

    let effectiveAngularRadius = minClickRadiusRad;
    if (canComputeAngularSize) {
      const px = computeVisualRadiusPx(mApp, sizeOpts);
      if (px > 0) {
        effectiveAngularRadius = Math.max(
          px / pixelsPerRadian,
          minClickRadiusRad,
        );
      }
    }

    const score = angularDist / effectiveAngularRadius;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
      bestAngularDist = angularDist;
      bestDistSq = distSq;
    }
  }

  if (bestIndex < 0) return null;

  const distScene = Math.sqrt(bestDistSq);
  const distPc = distScene / scale;
  const mApp = magAbs[bestIndex]
    + extinctionScale * (5 * Math.log10(Math.max(distPc, 0.001)) - 5);
  const visualPx = canComputeAngularSize
    ? computeVisualRadiusPx(mApp, sizeOpts)
    : null;

  const result = {
    index: bestIndex,
    score: bestScore,
    angularDistanceDeg: bestAngularDist * RAD_TO_DEG,
    distancePc: distPc,
    apparentMagnitude: mApp,
    absoluteMagnitude: magAbs[bestIndex],
    visualRadiusPx: visualPx,
    position: {
      x: positions[bestIndex * 3],
      y: positions[bestIndex * 3 + 1],
      z: positions[bestIndex * 3 + 2],
    },
  };

  if (teffLog8) {
    result.temperatureK = decodeTemperatureK(teffLog8[bestIndex]);
  }

  return result;
}
