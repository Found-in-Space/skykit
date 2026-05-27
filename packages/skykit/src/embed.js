import { createSkykitBrowser } from './browser.js';

const DEFAULT_SELECTOR = '[data-skykit-browser]';
const started = new WeakSet();

if (typeof document !== 'undefined') {
  ready(() => {
    for (const host of document.querySelectorAll(DEFAULT_SELECTOR)) {
      if (started.has(host)) continue;
      started.add(host);
      void createSkykitBrowser(readOptions(host))
        .then((browser) => {
          reportReady(host, browser);
        })
        .catch((error) => {
          reportError(host, error);
        });
    }
  });
}

/** @param {Element} host */
function readOptions(host) {
  const data = host instanceof HTMLElement ? host.dataset : {};
  return {
    host,
    ...(data.skykitStatus ? { status: data.skykitStatus } : {}),
    ...(data.skykitMagnitude ? { limitingMagnitude: Number(data.skykitMagnitude) } : {}),
    ...(data.skykitSpeed ? { speedPcPerSec: Number(data.skykitSpeed) } : {}),
    ...(data.skykitExposure ? { exposure: Number(data.skykitExposure) } : {}),
  };
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
  const data = host instanceof HTMLElement ? host.dataset : {};
  if (!data.skykitStatus) return;
  const status = document.querySelector(data.skykitStatus);
  if (status) status.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
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
