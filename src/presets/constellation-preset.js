import { createConstellationArtLayer } from '../layers/constellation-art-layer.js';
import { createConstellationCompassController } from '../controllers/constellation-compass-controller.js';

const DEFAULT_ART_LAYER_ID = 'constellation-art';
const DEFAULT_COMPASS_ID = 'constellation-compass';
const DEFAULT_ART_OPACITY = 0.3;
const DEFAULT_ART_FADE_DURATION_SECS = 0.4;
const DEFAULT_COMPASS_HYSTERESIS_SECS = 0.2;

/**
 * Feature preset: view-center constellation indicator with art toggle.
 *
 * The compass controller resolves the camera's forward direction to RA/Dec
 * (ICRS), which maps to a constellation regardless of the observer's position
 * in space — constellations are projected onto the celestial sphere at
 * infinity and serve as fixed navigation anchors.
 *
 * Returns astronomy-specific state and controllers. Touch OS consumers are
 * expected to build their own UI directly from this state.
 *
 * @param {object} options
 * @param {object} options.manifest           Loaded constellation art manifest.
 * @param {string} options.manifestUrl        URL the manifest was loaded from.
 * @param {Function} options.sceneToIcrsTransform  Scene-to-ICRS direction transform.
 * @param {Function} options.transformDirection    ICRS-to-scene direction transform
 *                                                 (for art layer positioning).
 * @param {number} [options.opacity]          Art layer opacity (default 0.22).
 * @param {number} [options.fadeDurationSecs] Fade speed (default 0.8).
 * @param {number} [options.hysteresisSecs]   Compass hysteresis (default 0.5).
 */
export function createConstellationPreset(options) {
  const {
    manifest,
    manifestUrl,
    sceneToIcrsTransform,
    transformDirection,
  } = options;

  let currentIau = null;
  let currentName = null;
  let artEnabled = true;

  const artLayer = createConstellationArtLayer({
    id: options.artLayerId ?? DEFAULT_ART_LAYER_ID,
    manifest,
    manifestUrl,
    transformDirection,
    opacity: options.opacity ?? DEFAULT_ART_OPACITY,
    fadeDurationSecs: options.fadeDurationSecs ?? DEFAULT_ART_FADE_DURATION_SECS,
  });

  const compassController = createConstellationCompassController({
    id: options.compassId ?? DEFAULT_COMPASS_ID,
    manifest,
    sceneToIcrsTransform,
    hysteresisSecs: options.hysteresisSecs ?? DEFAULT_COMPASS_HYSTERESIS_SECS,
    onConstellationIn(payload) {
      currentIau = payload.iau;
      currentName = payload.name?.native ?? payload.name?.english ?? payload.iau;
      if (artEnabled) artLayer.show(payload.iau);
    },
    onConstellationOut(payload) {
      artLayer.hide(payload.iau);
      if (payload.iau === currentIau) {
        currentIau = null;
        currentName = null;
      }
    },
  });

  return {
    artLayer,
    compassController,
    getCurrentIau() {
      return currentIau;
    },
    getCurrentName() {
      return currentName;
    },
    isArtEnabled() {
      return artEnabled;
    },
    setArtEnabled(active) {
      artEnabled = active === true;
      if (!artEnabled) {
        artLayer.hideAll();
      } else if (currentIau) {
        artLayer.show(currentIau);
      }
    },
  };
}
