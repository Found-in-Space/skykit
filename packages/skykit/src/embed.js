import {
  parseSpatialLookAtText,
  resolveSpatialTarget,
} from '@found-in-space/spatial';

import {
  installSkykitBrowserGlobal,
  registerBrowserAddon,
  registerBrowserInstance,
} from './browser-addons.js';
import { createSkykitBrowser } from './browser.js';

const DEFAULT_SELECTOR = '[data-skykit-browser]';
const started = new WeakSet();
const skykitGlobal = typeof globalThis !== 'undefined'
  ? installSkykitBrowserGlobal(globalThis)
  : null;

if (typeof document !== 'undefined') {
  ready(() => {
    startSkykitBrowserEmbeds();
  });
}

/**
 * @param {{
 *   document?: Document;
 *   selector?: string;
 *   createBrowser?: typeof createSkykitBrowser;
 *   globalService?: import('./browser.d.ts').SkykitBrowserGlobal | null;
 * }} [options]
 */
export function startSkykitBrowserEmbeds(options = {}) {
  const activeDocument = options.document ?? globalThis.document;
  if (!activeDocument?.querySelectorAll) return;
  const selector = options.selector ?? DEFAULT_SELECTOR;
  const createBrowser = options.createBrowser ?? createSkykitBrowser;
  const globalService = options.globalService === undefined ? skykitGlobal : options.globalService;
  for (const host of activeDocument.querySelectorAll(selector)) {
    if (started.has(host)) continue;
    started.add(host);
    void createBrowser(readOptions(host))
      .then(async (browser) => {
        await installRequestedCapabilities(host, browser);
        if (globalService) {
          const unregister = registerBrowserInstance(globalService, host, browser);
          await browser.install({
            id: 'skykit-browser-global-record',
            install: () => unregister,
          });
        }
        return browser;
      })
      .then((browser) => {
        reportReady(host, browser);
      })
      .catch((error) => {
        reportError(host, error);
      });
  }
}

/**
 * @param {Element} host
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 */
async function installRequestedCapabilities(host, browser) {
  const data = isHtmlElement(host) ? host.dataset : {};
  if (data.skykitConstellations != null || data.skykitConstellationManifest != null) {
    await browser.constellations.load({
      skyculture: data.skykitConstellations,
      manifestUrl: data.skykitConstellationManifest,
      assetBaseUrl: data.skykitConstellationAssets,
      art: data.skykitConstellationArt,
    });
  }
  if (data.skykitFrames != null) {
    await browser.frames.load({
      frames: data.skykitFrames,
    });
  }
  if (data.skykitGrids != null) {
    await browser.grids.load({
      grids: data.skykitGrids,
    });
  }
}

/** @param {Element} host */
function readOptions(host) {
  const data = isHtmlElement(host) ? host.dataset : {};
  const observerPc = data.skykitObserver ? parseSpatialTargetText(data.skykitObserver) : null;
  const lookAt = data.skykitLookAt ? parseSpatialLookAtText(data.skykitLookAt) : null;
  const view = observerPc || lookAt
    ? {
      ...(observerPc ? { observerPc } : {}),
      ...(lookAt ? { lookAt } : {}),
    }
    : null;
  return {
    host,
    ...(data.skykitStatus ? { status: data.skykitStatus } : {}),
    ...(data.skykitMagnitude ? { limitingMagnitude: Number(data.skykitMagnitude) } : {}),
    ...(data.skykitSpeed ? { speedPcPerSec: Number(data.skykitSpeed) } : {}),
    ...(data.skykitExposure ? { exposure: Number(data.skykitExposure) } : {}),
    ...(data.skykitMouseMode ? { mouseMode: data.skykitMouseMode } : {}),
    ...(data.skykitPersistentCache ? { persistentCache: data.skykitPersistentCache } : {}),
    ...(view ? { view } : {}),
  };
}

/** @param {string} text */
function parseSpatialTargetText(text) {
  const targetSpec = parseSpatialLookAtText(text);
  const target = resolveSpatialTarget(targetSpec);
  return target && typeof /** @type {Promise<unknown>} */ (target).then !== 'function'
    ? target
    : null;
}

/**
 * @param {Element} host
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 */
function reportReady(host, browser) {
  host.dispatchEvent(new CustomEvent('skykit-browser-ready', {
    detail: { browser, viewer: browser.viewer },
    bubbles: true,
  }));
}

/**
 * @param {Element} host
 * @param {unknown} error
 */
function reportError(host, error) {
  host.dispatchEvent(new CustomEvent('skykit-browser-error', {
    detail: { error },
    bubbles: true,
  }));
  const data = isHtmlElement(host) ? host.dataset : {};
  if (!data.skykitStatus) return;
  const status = document.querySelector(data.skykitStatus);
  if (status) status.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
}

/** @param {Element} host */
function isHtmlElement(host) {
  return typeof HTMLElement !== 'undefined' && host instanceof HTMLElement;
}

/** @param {() => void} callback */
function ready(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
    return;
  }
  callback();
}

export { createSkykitBrowser } from './browser.js';
export {
  installSkykitBrowserGlobal,
  registerBrowserAddon,
  registerBrowserInstance,
} from './browser-addons.js';
