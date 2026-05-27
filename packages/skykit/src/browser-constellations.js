import * as THREE from 'three';

import { raDecToIcrsDirection } from '@found-in-space/spatial';

import {
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createViewAnchoredImageController,
} from './anchored-images.js';
import { createObject3dLayer } from './layers.js';

const CONSTELLATIONS_CAPABILITY = 'skykit:browser.constellations';
const WESTERN_SKYCULTURE_VERSION = '0.3.0';
const WESTERN_SKYCULTURE_BASE =
  `https://cdn.jsdelivr.net/npm/@found-in-space/stellarium-skycultures-western@${WESTERN_SKYCULTURE_VERSION}/dist/`;
const WESTERN_SKYCULTURE_MANIFEST = `${WESTERN_SKYCULTURE_BASE}manifest.json`;
const DEFAULT_BOUNDARY_RADIUS = 8;

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
  const manifest = loaded.manifest;
  const assetBaseUrl = settings.assetBaseUrl ?? loaded.assetBaseUrl;
  const root = createConstellationBoundaryObject(manifest, settings);
  let visible = settings.visible !== false;
  let artMode = normalizeArtMode(settings.art);
  /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
  let boundaryTeardown = null;
  /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
  let artTeardown = null;
  /** @type {import('./index.d.ts').AnchoredImageSkyPlugin | null} */
  let artPlugin = null;

  root.visible = visible;
  boundaryTeardown = await browser.install({
    id: 'constellation-boundaries',
    setup(context) {
      const layer = createObject3dLayer({
        id: 'constellation-boundaries',
        object3d: root,
        anchorMode: 'observer-centric',
        priority: settings.priority,
      });
      const remove = context.addPart({
        ...layer,
        dispose() {
          layer.dispose?.();
          disposeObject(root);
        },
        getSnapshot() {
          return {
            id: 'constellation-boundaries',
            visible: root.visible,
            lineCount: root.userData.lineCount ?? 0,
          };
        },
      });
      return remove;
    },
  });
  browser.capabilities.add(CONSTELLATIONS_CAPABILITY);

  if (artMode !== 'off') {
    await installArt();
  }

  const handle = {
    async load() {
      return handle;
    },
    show() {
      visible = true;
      syncVisibility(browser, root, visible);
      return visible;
    },
    hide() {
      visible = false;
      syncVisibility(browser, root, visible);
      return visible;
    },
    toggle(force) {
      visible = typeof force === 'boolean' ? force : !visible;
      syncVisibility(browser, root, visible);
      return visible;
    },
    async setArt(mode) {
      artMode = normalizeArtMode(mode);
      if (artMode === 'off') {
        artTeardown?.();
        artTeardown = null;
        artPlugin = null;
        return artMode;
      }
      await installArt();
      return artMode;
    },
    getSnapshot() {
      return {
        capability: CONSTELLATIONS_CAPABILITY,
        visible,
        art: artMode,
        manifestId: manifest.id ?? null,
        lineCount: root.userData.lineCount ?? 0,
        artPlugin: artPlugin?.getSnapshot?.() ?? null,
      };
    },
    dispose() {
      artTeardown?.();
      boundaryTeardown?.();
      artTeardown = null;
      boundaryTeardown = null;
      artPlugin = null;
    },
  };

  return handle;

  async function installArt() {
    if (artPlugin) return;
    const catalog = await createAnchoredImageCatalog({
      manifest: toAnchoredImageManifest(manifest, assetBaseUrl),
    });
    artPlugin = createAnchoredImageSkyPlugin({
      id: 'constellation-art',
      catalog,
      controller: createViewAnchoredImageController({
        strategy: 'nearest',
        maxAngleDeg: finiteNumber(settings.artMaxAngleDeg, 60),
      }),
      loading: artMode === 'preload' ? 'preload' : 'lazy',
      opacity: finiteNumber(settings.artOpacity, 0.22),
      skipTextureErrors: settings.skipTextureErrors !== false,
    });
    artTeardown = await browser.install(artPlugin);
    syncVisibility(browser, root, visible);
  }
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
      manifest: /** @type {Record<string, unknown>} */ (options.manifest),
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

/**
 * @param {Record<string, unknown>} manifest
 * @param {import('./browser.d.ts').SkykitBrowserConstellationsOptions} options
 */
function createConstellationBoundaryObject(manifest, options) {
  const root = new THREE.Group();
  root.name = 'constellation-boundaries';
  const radius = finiteNumber(options.boundaryRadius, DEFAULT_BOUNDARY_RADIUS);
  const positions = boundaryPositions(manifest, radius);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: options.boundaryColor ?? 0x7aa7ff,
    transparent: true,
    opacity: finiteNumber(options.boundaryOpacity, 0.35),
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'constellation-boundary-lines';
  lines.renderOrder = finiteNumber(options.renderOrder, -2);
  root.add(lines);
  root.userData.lineCount = positions.length / 6;
  return root;
}

/** @param {Record<string, unknown>} manifest @param {number} radius */
function boundaryPositions(manifest, radius) {
  const boundaries = /** @type {{ edges?: unknown }} */ (manifest.boundaries ?? {});
  const edges = Array.isArray(boundaries.edges) ? boundaries.edges : [];
  /** @type {number[]} */
  const positions = [];
  for (const edge of edges) {
    if (typeof edge !== 'string') continue;
    const parts = edge.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const start = directionFromRaDecText(parts[2], parts[3]);
    const end = directionFromRaDecText(parts[4], parts[5]);
    if (!start || !end) continue;
    positions.push(
      start.x * radius, start.y * radius, start.z * radius,
      end.x * radius, end.y * radius, end.z * radius,
    );
  }
  return positions;
}

/** @param {string} raText @param {string} decText */
function directionFromRaDecText(raText, decText) {
  const raHours = parseSexagesimal(raText);
  const decDeg = parseSexagesimal(decText);
  if (!Number.isFinite(raHours) || !Number.isFinite(decDeg)) return null;
  return raDecToIcrsDirection({ raHours, decDeg });
}

/** @param {string} value */
function parseSexagesimal(value) {
  const sign = value.trim().startsWith('-') ? -1 : 1;
  const clean = value.trim().replace(/^[+-]/, '');
  const parts = clean.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  return sign * (parts[0] + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600);
}

/** @param {Record<string, unknown>} manifest @param {string | undefined} assetBaseUrl */
function toAnchoredImageManifest(manifest, assetBaseUrl) {
  const constellations = Array.isArray(manifest.constellations) ? manifest.constellations : [];
  return {
    format: 'found-in-space/anchored-image-manifest@1',
    id: String(manifest.id ?? 'constellations'),
    label: String(manifest.id ?? 'Constellations'),
    assetBaseUrl: assetBaseUrl ?? null,
    images: constellations.map((constellation, index) => toAnchoredImage(constellation, assetBaseUrl, index)).filter(Boolean),
    attribution: manifest.license,
    metadata: {
      sourceFormat: manifest.format,
      sourcePackage: manifest.source,
      astrometry: manifest.astrometry,
    },
  };
}

/** @param {unknown} input @param {string | undefined} assetBaseUrl @param {number} index */
function toAnchoredImage(input, assetBaseUrl, index) {
  const constellation = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const image = /** @type {Record<string, unknown>} */ (constellation.image && typeof constellation.image === 'object' ? constellation.image : {});
  const imageFile = typeof image.file === 'string' ? image.file : '';
  const anchors = Array.isArray(image.anchors) ? image.anchors.map(toAnchoredImageAnchor).filter(Boolean) : [];
  if (!imageFile || anchors.length < 2) return null;
  return {
    id: String(constellation.id ?? constellation.iau ?? `constellation-${index}`),
    label: resolveConstellationLabel(constellation),
    groupId: typeof constellation.iau === 'string' ? constellation.iau : undefined,
    image: {
      src: typeof image.url === 'string'
        ? image.url
        : assetBaseUrl
          ? new URL(imageFile, assetBaseUrl).href
          : imageFile,
      width: Array.isArray(image.size) ? Number(image.size[0]) || 512 : 512,
      height: Array.isArray(image.size) ? Number(image.size[1]) || 512 : 512,
      anchors,
    },
    metadata: {
      sourceConstellationId: constellation.id ?? null,
      iau: constellation.iau ?? null,
      common_name: constellation.common_name ?? null,
    },
  };
}

/** @param {unknown} input */
function toAnchoredImageAnchor(input) {
  const anchor = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const icrs = /** @type {Record<string, unknown>} */ (anchor.icrs && typeof anchor.icrs === 'object' ? anchor.icrs : {});
  const pixel = /** @type {Record<string, unknown>} */ (anchor.pixel && typeof anchor.pixel === 'object' ? anchor.pixel : {});
  const target = {
    x: Number(icrs.x),
    y: Number(icrs.y),
    z: Number(icrs.z),
  };
  const point = {
    x: Number(pixel.x),
    y: Number(pixel.y),
  };
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    pixel: point,
    target: {
      kind: 'direction',
      frame: 'icrs',
      ...target,
    },
    metadata: {
      hip: anchor.hip,
      raDeg: anchor.raDeg,
      decDeg: anchor.decDeg,
    },
  };
}

/** @param {Record<string, unknown>} constellation */
function resolveConstellationLabel(constellation) {
  const commonName = constellation.common_name;
  if (commonName && typeof commonName === 'object') {
    const source = /** @type {Record<string, unknown>} */ (commonName);
    if (typeof source.native === 'string' && source.native.trim()) return source.native.trim();
    if (typeof source.english === 'string' && source.english.trim()) return source.english.trim();
  }
  return String(constellation.iau ?? constellation.id ?? 'Constellation');
}

/**
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @param {THREE.Object3D} boundaryRoot
 * @param {boolean} visible
 */
function syncVisibility(browser, boundaryRoot, visible) {
  boundaryRoot.visible = visible;
  const artRoot = browser.viewer.roots.observerContentRoot.children.find((child) => child.name === 'constellation-art');
  if (artRoot) artRoot.visible = visible;
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

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {THREE.Object3D} object */
function disposeObject(object) {
  object.traverse((child) => {
    const mesh = /** @type {THREE.Object3D & { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } | Array<{ dispose?: () => void }> }} */ (child);
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose?.();
    } else {
      mesh.material?.dispose?.();
    }
  });
}
