import {
  computeEffectiveMagLimit,
  computeNearDistanceBlend,
  DEFAULT_STAR_FIELD_STATE,
  DEFAULT_TUNED_EXPOSURE,
} from '../layers/star-field-materials.js';
import { SCALE } from './octree/scene-scale.js';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
export const DEFAULT_PICK_TOLERANCE_DEG = 3.0;

const TUNED_DEFAULTS = Object.freeze({
  exposure: DEFAULT_TUNED_EXPOSURE,
  magLimit: 6.5,
  magFadeRange: DEFAULT_STAR_FIELD_STATE.starFieldMagFadeRange,
  baseSize: DEFAULT_STAR_FIELD_STATE.starFieldBaseSize,
  sizeFluxScale: DEFAULT_STAR_FIELD_STATE.starFieldSizeFluxScale,
  sizeScale: DEFAULT_STAR_FIELD_STATE.starFieldSizeScale,
  sizePower: DEFAULT_STAR_FIELD_STATE.starFieldSizePower,
  sizeMax: DEFAULT_STAR_FIELD_STATE.starFieldSizeMax,
  nearMagLimitFloor: DEFAULT_STAR_FIELD_STATE.starFieldNearMagLimitFloor,
  nearMagLimitRadiusPc: DEFAULT_STAR_FIELD_STATE.starFieldNearMagLimitRadiusPc,
  nearMagLimitFeatherPc: DEFAULT_STAR_FIELD_STATE.starFieldNearMagLimitFeatherPc,
  nearSizeFloor: DEFAULT_STAR_FIELD_STATE.starFieldNearSizeFloor,
  nearAlphaFloor: DEFAULT_STAR_FIELD_STATE.starFieldNearAlphaFloor,
  extinctionScale: 1.0,
});

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function apparentFluxFromMagnitude(mApp) {
  return Math.pow(10, -0.4 * mApp);
}

function computeMagnitudeFade(mApp, magLimit, magFadeRange) {
  if (!(magFadeRange > 0)) {
    return mApp <= magLimit ? 1 : 0;
  }
  return 1 - smoothstep(magLimit - magFadeRange, magLimit, mApp);
}

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
 * Mirror the default desktop star shader's apparent-magnitude-driven point-size calculation.
 * Returns the rendered point size in CSS pixels for a star of apparent
 * magnitude `mApp` under the given material settings.
 */
export function computeVisualRadiusPx(mApp, options = {}) {
  const magLimit = options.magLimit ?? TUNED_DEFAULTS.magLimit;
  const magFadeRange = options.magFadeRange ?? TUNED_DEFAULTS.magFadeRange;
  const baseSize = options.baseSize ?? options.sizeMin ?? TUNED_DEFAULTS.baseSize;
  const sizeFluxScale = options.sizeFluxScale ?? TUNED_DEFAULTS.sizeFluxScale;
  const sizeScale = options.sizeScale ?? options.linearScale ?? TUNED_DEFAULTS.sizeScale;
  const sizePower = options.sizePower ?? TUNED_DEFAULTS.sizePower;
  const sizeMax = options.sizeMax ?? TUNED_DEFAULTS.sizeMax;
  const nearSizeFloor = options.nearSizeFloor ?? TUNED_DEFAULTS.nearSizeFloor;
  const effectiveMagLimit = computeEffectiveMagLimit(
    magLimit,
    options.distancePc,
    {
      nearMagLimitFloor: options.nearMagLimitFloor ?? TUNED_DEFAULTS.nearMagLimitFloor,
      nearMagLimitRadiusPc: options.nearMagLimitRadiusPc ?? TUNED_DEFAULTS.nearMagLimitRadiusPc,
      nearMagLimitFeatherPc: options.nearMagLimitFeatherPc ?? TUNED_DEFAULTS.nearMagLimitFeatherPc,
    },
  );

  const fade = computeMagnitudeFade(mApp, effectiveMagLimit, magFadeRange);
  if (fade <= 0) {
    return 0;
  }

  const apparentFlux = apparentFluxFromMagnitude(mApp) * Math.max(sizeFluxScale, 0);
  const sizeSignal = Math.max(Math.pow(1 + Math.max(apparentFlux, 0), sizePower) - 1, 0);
  const nearBlend = computeNearDistanceBlend(options.distancePc, {
    nearMagLimitRadiusPc: options.nearMagLimitRadiusPc ?? TUNED_DEFAULTS.nearMagLimitRadiusPc,
    nearMagLimitFeatherPc: options.nearMagLimitFeatherPc ?? TUNED_DEFAULTS.nearMagLimitFeatherPc,
  });
  const radius = Math.max(
    baseSize + sizeScale * sizeSignal,
    nearSizeFloor * nearBlend,
  );

  return Math.min(Math.max(radius, 0), sizeMax);
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
 * @param {number} [options.magFadeRange]    Magnitude fade range near the limit.
 * @param {number} [options.baseSize]        Baseline point size (px).
 * @param {number} [options.sizeFluxScale]   Fixed flux scaling for size response.
 * @param {number} [options.sizeScale]       Brightness-to-size response scale.
 * @param {number} [options.sizePower]       Brightness-to-size response power.
 * @param {number} [options.sizeMin]         Legacy alias for baseSize.
 * @param {number} [options.sizeMax]         Maximum point size (px).
 * @param {number} [options.nearMagLimitFloor] Optional nearby-star mag limit floor.
 * @param {number} [options.nearMagLimitRadiusPc] Distance where the nearby floor is fully active.
 * @param {number} [options.nearMagLimitFeatherPc] Fade width past the nearby floor radius.
 * @param {number} [options.nearSizeFloor]   Optional minimum point size for nearby stars.
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
    magFadeRange = TUNED_DEFAULTS.magFadeRange,
    baseSize = TUNED_DEFAULTS.baseSize,
    sizeFluxScale = TUNED_DEFAULTS.sizeFluxScale,
    sizeScale = TUNED_DEFAULTS.sizeScale,
    sizePower = TUNED_DEFAULTS.sizePower,
    sizeMax = TUNED_DEFAULTS.sizeMax,
    nearMagLimitFloor = TUNED_DEFAULTS.nearMagLimitFloor,
    nearMagLimitRadiusPc = TUNED_DEFAULTS.nearMagLimitRadiusPc,
    nearMagLimitFeatherPc = TUNED_DEFAULTS.nearMagLimitFeatherPc,
    nearSizeFloor = TUNED_DEFAULTS.nearSizeFloor,
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

  const sizeOpts = {
    magLimit,
    magFadeRange,
    exposure,
    baseSize,
    sizeFluxScale,
    sizeScale,
    sizePower,
    sizeMax,
    nearMagLimitFloor,
    nearMagLimitRadiusPc,
    nearMagLimitFeatherPc,
    nearSizeFloor,
  };

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
      const px = computeVisualRadiusPx(mApp, {
        ...sizeOpts,
        distancePc: dPc,
      });
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
    ? computeVisualRadiusPx(mApp, {
      ...sizeOpts,
      distancePc: distPc,
    })
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
