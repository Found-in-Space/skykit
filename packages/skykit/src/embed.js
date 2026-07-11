import {
  parseSpatialLookAtText,
  resolveSkykitTargetSync,
} from './spatial-adapter.js';

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
    for (const host of document.querySelectorAll(DEFAULT_SELECTOR)) {
      if (started.has(host)) continue;
      started.add(host);
      void createSkykitBrowser(readOptions(host))
        .then(async (browser) => {
          await installRequestedCapabilities(host, browser);
          if (skykitGlobal) {
            const unregister = registerBrowserInstance(skykitGlobal, host, browser);
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
  });
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
  return targetSpec ? resolveSkykitTargetSync(targetSpec) : null;
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
