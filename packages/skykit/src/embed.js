import { createSkykitBrowser } from './browser.js';

const DEFAULT_SELECTOR = '[data-skykit-browser]';

if (typeof document !== 'undefined') {
  ready(() => {
    for (const host of document.querySelectorAll(DEFAULT_SELECTOR)) {
      if (host.__skykitBrowser) continue;
      host.__skykitBrowser = createSkykitBrowser(readOptions(host)).catch((error) => {
        host.dispatchEvent(new CustomEvent('skykit-browser-error', {
          detail: { error },
          bubbles: true,
        }));
        if (host.dataset.skykitStatus) {
          const status = document.querySelector(host.dataset.skykitStatus);
          if (status) status.textContent = error?.stack || error?.message || String(error);
        }
        throw error;
      });
    }
  });
}

function readOptions(host) {
  const data = host.dataset ?? {};
  return {
    host,
    ...(data.skykitStatus ? { status: data.skykitStatus } : {}),
    ...(data.skykitMagnitude ? { limitingMagnitude: Number(data.skykitMagnitude) } : {}),
    ...(data.skykitSpeed ? { speedPcPerSec: Number(data.skykitSpeed) } : {}),
    ...(data.skykitExposure ? { exposure: Number(data.skykitExposure) } : {}),
  };
}

function ready(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
    return;
  }
  callback();
}

export { createSkykitBrowser } from './browser.js';
