import { createConstellationArtLayer } from '../layers/constellation-art-layer.js';
import { createConstellationCompassController } from '../controllers/constellation-compass-controller.js';

/**
 * Feature preset: view-center constellation indicator with art toggle.
 *
 * The compass controller resolves the camera's forward direction to RA/Dec
 * (ICRS), which maps to a constellation regardless of the observer's position
 * in space — constellations are projected onto the celestial sphere at
 * infinity and serve as fixed navigation anchors.
 *
 * Returns `{ artLayer, compassController, controls }`.
 * - `controls` contains a single toggle button whose dynamic label shows the
 *    current view-center constellation name. Clicking toggles art visibility.
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
 * @param {string} [options.position]         HUD position for the toggle button.
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
    id: options.artLayerId ?? 'constellation-art',
    manifest,
    manifestUrl,
    transformDirection,
    opacity: options.opacity ?? 0.22,
    fadeDurationSecs: options.fadeDurationSecs ?? 0.8,
  });

  const compassController = createConstellationCompassController({
    id: options.compassId ?? 'constellation-compass',
    manifest,
    sceneToIcrsTransform,
    hysteresisSecs: options.hysteresisSecs ?? 0.5,
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

  const position = options.position ?? 'top-right';

  return {
    artLayer,
    compassController,
    controls: [
      {
        label: () => currentName ? `✦ ${currentName}` : '✦ —',
        title: 'View-center constellation (toggle art)',
        toggle: true,
        initialActive: true,
        position,
        onPress: (active) => {
          artEnabled = active;
          if (!active) {
            artLayer.hideAll();
          } else if (currentIau) {
            artLayer.show(currentIau);
          }
        },
      },
    ],
  };
}
