import { createSkykitConstellationLayer } from './constellation-layer.js';
import { createSkykitLayerHostPlugin } from './layer-host.js';

const CONSTELLATIONS_CAPABILITY = 'skykit:browser.constellations';
const WESTERN_SKYCULTURE_VERSION = '0.3.0';
const WESTERN_SKYCULTURE_BASE =
  `https://cdn.jsdelivr.net/npm/@found-in-space/stellarium-skycultures-western@${WESTERN_SKYCULTURE_VERSION}/dist/`;
const WESTERN_SKYCULTURE_MANIFEST = `${WESTERN_SKYCULTURE_BASE}manifest.json`;

/**
 * @param {{
 *   browser: import('./browser.d.ts').SkykitBrowser;
 *   host?: unknown;
 *   options?: import('./browser.d.ts').SkykitBrowserConstellationsOptions;
 * }} context
 * @returns {Promise<import('./browser.d.ts').SkykitBrowserConstellationsFacade>}
 */
export async function installSkykitConstellationsBrowserCapability({ browser, host, options = {} }) {
  const settings = normalizeConstellationOptions(host, options);
  const loaded = await loadSkycultureManifest(settings);
  const artMode = normalizeArtMode(settings.art);
  const layer = createSkykitConstellationLayer({
    id: 'browser-constellations',
    priority: settings.priority,
    manifest: loaded.manifest,
    assetBaseUrl: settings.assetBaseUrl ?? loaded.assetBaseUrl,
    visible: settings.visible,
    boundary: {
      radius: settings.boundaryRadius,
      color: settings.boundaryColor,
      opacity: settings.boundaryOpacity,
      renderOrder: settings.renderOrder,
    },
    art: artMode === 'off'
      ? false
      : {
          loading: artMode,
          opacity: settings.artOpacity,
          maxAngleDeg: settings.artMaxAngleDeg,
          skipTextureErrors: settings.skipTextureErrors,
        },
  });
  const hostPlugin = createSkykitLayerHostPlugin({
    id: 'browser-constellations-host',
    layers: [layer],
  });
  const teardown = await browser.install(hostPlugin);

  browser.capabilities.add(CONSTELLATIONS_CAPABILITY);

  const handle = {
    async load() {
      return handle;
    },
    show() {
      return layer.show();
    },
    hide() {
      return layer.hide();
    },
    toggle(force) {
      return layer.toggle(force);
    },
    setArt(mode) {
      return layer.setArt(mode);
    },
    getSnapshot() {
      return {
        capability: CONSTELLATIONS_CAPABILITY,
        .../** @type {Record<string, unknown>} */ (layer.getSnapshot()),
      };
    },
    dispose() {
      teardown();
    },
  };
  return handle;
}

/**
 * @param {unknown} host
 * @param {import('./browser.d.ts').SkykitBrowserConstellationsOptions} options
 * @returns {import('./browser.d.ts').SkykitBrowserConstellationsOptions}
 */
function normalizeConstellationOptions(host, options) {
  const data = host && typeof host === 'object' && 'dataset' in host
    ? /** @type {{ dataset?: Record<string, string | undefined> }} */ (host).dataset ?? {}
    : {};
  const requested = options.skyculture ?? data.skykitConstellations ?? 'western';
  const manifestUrl = options.manifestUrl
    ?? data.skykitConstellationManifest
    ?? (looksLikeUrl(requested) ? String(requested) : undefined)
    ?? (String(requested || 'western').toLowerCase() === 'western' ? WESTERN_SKYCULTURE_MANIFEST : undefined);
  const assetBaseUrl = options.assetBaseUrl
    ?? data.skykitConstellationAssets
    ?? (manifestUrl ? new URL('./', manifestUrl).href : undefined)
    ?? WESTERN_SKYCULTURE_BASE;
  return {
    ...options,
    skyculture: requested,
    manifestUrl,
    assetBaseUrl,
    art: options.art ?? data.skykitConstellationArt ?? 'off',
  };
}

/**
 * @param {import('./browser.d.ts').SkykitBrowserConstellationsOptions} options
 * @returns {Promise<{ manifest: Record<string, unknown>; assetBaseUrl?: string }>}
 */
async function loadSkycultureManifest(options) {
  if (options.manifest && typeof options.manifest === 'object') {
    return {
      manifest: options.manifest,
      assetBaseUrl: options.assetBaseUrl,
    };
  }
  const manifestUrl = options.manifestUrl ?? WESTERN_SKYCULTURE_MANIFEST;
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Failed to load SkyKit constellation manifest: ${response.status} ${response.statusText}`);
  return {
    manifest: /** @type {Record<string, unknown>} */ (await response.json()),
    assetBaseUrl: options.assetBaseUrl ?? new URL('./', manifestUrl).href,
  };
}

/** @param {unknown} value */
function normalizeArtMode(value) {
  const mode = String(value ?? 'off').trim().toLowerCase();
  if (mode === 'preload') return 'preload';
  if (mode === 'lazy' || mode === 'on' || mode === 'true') return 'lazy';
  return 'off';
}

/** @param {unknown} value */
function looksLikeUrl(value) {
  return typeof value === 'string' && (/^https?:\/\//.test(value) || value.endsWith('.json'));
}
