import { parseSpatialLookAtText } from '@found-in-space/spatial';

import {
  installSkykitBrowserGlobal,
  registerBrowserInstance,
} from './browser-addons.js';
import {
  createSkykitXrBrowser,
  parseSkykitXrSpatialTargetText,
} from './xr-browser.js';
import { isSkykitXrModeSupported } from './xr/session.js';

const DEFAULT_SELECTOR = '[data-skykit-xr]';
const started = new WeakSet();
const skykitGlobal = typeof globalThis !== 'undefined'
  ? installSkykitBrowserGlobal(globalThis)
  : null;

if (typeof document !== 'undefined') {
  ready(() => {
    startSkykitXrEmbeds();
  });
}

/**
 * @param {{
 *   document?: Document;
 *   selector?: string;
 *   createBrowser?: typeof createSkykitXrBrowser;
 *   globalService?: import('./browser.d.ts').SkykitBrowserGlobal | null;
 * }} [options]
 */
export function startSkykitXrEmbeds(options = {}) {
  const activeDocument = options.document ?? globalThis.document;
  if (!activeDocument?.querySelectorAll) return;
  const selector = options.selector ?? DEFAULT_SELECTOR;
  const createBrowser = options.createBrowser ?? createSkykitXrBrowser;
  const globalService = options.globalService === undefined ? skykitGlobal : options.globalService;
  for (const host of activeDocument.querySelectorAll(selector)) {
    if (started.has(host)) continue;
    started.add(host);
    const status = createXrEmbedStatus(host, activeDocument);
    status.setCheck('skykit', 'pending', 'Starting');
    status.setCheck('stars', 'pending', 'Waiting for cells');
    status.setCheck('xr', 'pending', 'Checking');
    void createBrowser(readOptions(host))
      .then(async (browser) => {
        status.setBrowser(browser);
        status.setCheck('skykit', 'ready', 'SkyKit available');
        status.sync();
        await status.refreshXrSupport();
        await installRequestedCapabilities(host, browser);
        const unregisterButton = installEnterVrControl(host, browser, status, activeDocument);
        await browser.install({
          id: 'skykit-xr-embed-enter-control',
          install: () => unregisterButton,
        });
        if (globalService) {
          const unregister = registerBrowserInstance(globalService, host, browser);
          await browser.install({
            id: 'skykit-xr-browser-global-record',
            install: () => unregister,
          });
        }
        return browser;
      })
      .then((browser) => {
        status.sync();
        reportReady(host, browser, activeDocument);
      })
      .catch((error) => {
        status.setCheck('skykit', 'failed', 'Unavailable');
        status.setSessionStatus(error instanceof Error ? error.message : String(error));
        reportError(host, error, activeDocument);
      });
  }
}

/**
 * @param {Element} host
 * @param {import('./xr-browser.d.ts').SkykitXrBrowser} browser
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
  const observerPc = data.skykitObserver ? parseSkykitXrSpatialTargetText(data.skykitObserver) : null;
  const lookAt = data.skykitLookAt ? parseSpatialLookAtText(data.skykitLookAt) : null;
  const view = observerPc || lookAt
    ? {
        ...(observerPc ? { observerPc } : {}),
        ...(lookAt ? { lookAt } : {}),
      }
    : null;
  const xr = data.skykitXrMode || data.skykitReferenceSpace
    ? {
        ...(data.skykitXrMode ? { mode: data.skykitXrMode } : {}),
        ...(data.skykitReferenceSpace ? { referenceSpaceType: data.skykitReferenceSpace } : {}),
      }
    : null;
  return {
    host,
    ...(data.skykitStatus ? { status: data.skykitStatus } : {}),
    ...(data.skykitMagnitude ? { view: { ...(view ?? {}), limitingMagnitude: Number(data.skykitMagnitude) } } : view ? { view } : {}),
    ...(data.skykitPersistentCache ? { persistentCache: data.skykitPersistentCache } : {}),
    ...(xr ? { xr } : {}),
  };
}

/**
 * @param {Element} host
 * @param {import('./xr-browser.d.ts').SkykitXrBrowser} browser
 * @param {ReturnType<typeof createXrEmbedStatus>} status
 * @param {Document} activeDocument
 */
function installEnterVrControl(host, browser, status, activeDocument) {
  const data = isHtmlElement(host) ? host.dataset : {};
  const suppliedButton = data.skykitEnterVr
    ? activeDocument.querySelector(data.skykitEnterVr)
    : null;
  const button = suppliedButton ?? createDefaultEnterButton(host, activeDocument);
  if (!button || typeof button.addEventListener !== 'function') return () => {};
  const onClick = async () => {
    try {
      status.setSessionStatus('Requesting XR session');
      await browser.enter();
      status.setSessionStatus('XR session active');
      status.sync();
    } catch (error) {
      status.setSessionStatus(error instanceof Error ? error.message : String(error));
      status.setCheck('xr', 'failed', 'XR session failed');
    }
  };
  button.addEventListener('click', onClick);
  button.removeAttribute?.('disabled');
  if ('textContent' in button && !button.textContent?.trim()) {
    button.textContent = 'Enter VR';
  }
  return () => {
    button.removeEventListener('click', onClick);
    if (!suppliedButton) button.parentNode?.removeChild?.(button);
  };
}

/**
 * @param {Element} host
 * @param {Document} activeDocument
 */
function createDefaultEnterButton(host, activeDocument) {
  if (typeof activeDocument.createElement !== 'function' || typeof host.appendChild !== 'function') {
    return null;
  }
  const button = activeDocument.createElement('button');
  button.type = 'button';
  if (button.dataset) {
    button.dataset.skykitInjectedEnterVr = 'true';
  } else {
    button.setAttribute?.('data-skykit-injected-enter-vr', 'true');
  }
  button.textContent = 'Enter VR';
  button.setAttribute('aria-label', 'Enter VR');
  if (button.style) {
    button.style.position = 'absolute';
    button.style.inset = '12px auto auto 12px';
    button.style.zIndex = '2';
  }
  if (isHtmlElement(host)) {
    const position = typeof getComputedStyle === 'function'
      ? getComputedStyle(host).position
      : host.style?.position;
    if ((!position || position === 'static') && host.style) host.style.position = 'relative';
  }
  host.appendChild(button);
  return button;
}

/**
 * @param {Element} host
 * @param {Document} activeDocument
 */
function createXrEmbedStatus(host, activeDocument) {
  const data = isHtmlElement(host) ? host.dataset : {};
  const statusTarget = data.skykitStatus ? activeDocument.querySelector(data.skykitStatus) : null;
  /** @type {import('./xr-browser.d.ts').SkykitXrBrowser | null} */
  let browser = null;
  /** @type {Record<string, { state: string; text: string }>} */
  const checks = {};
  let sessionStatus = '';

  return {
    setBrowser(nextBrowser) {
      browser = nextBrowser;
    },
    setCheck,
    setSessionStatus(text) {
      sessionStatus = text;
      sync();
    },
    sync,
    async refreshXrSupport() {
      const mode = browser?.session?.getSnapshot?.()?.mode ?? data.skykitXrMode ?? 'immersive-vr';
      try {
        const supported = await isSkykitXrModeSupported(mode);
        setCheck('xr', supported ? 'ready' : 'failed', supported ? 'XR environment available' : 'XR unavailable');
      } catch (error) {
        setCheck('xr', 'failed', error instanceof Error ? error.message : String(error));
      }
      sync();
    },
  };

  /** @param {string} id @param {string} state @param {string} text */
  function setCheck(id, state, text) {
    checks[id] = { state, text };
    const item = activeDocument.querySelector?.(`[data-preflight-check="${id}"]`);
    item?.setAttribute?.('data-state', state);
    const itemStatus = item?.querySelector?.('[data-preflight-check-status]');
    if (itemStatus) itemStatus.textContent = text;
    sync();
  }

  function sync() {
    const starSnapshot = browser?.starSource?.getSnapshot?.();
    if (starSnapshot?.status === 'current') {
      setCheckIfChanged('stars', 'ready', 'Stars loaded');
    } else if (starSnapshot?.status === 'failed') {
      setCheckIfChanged('stars', 'failed', starSnapshot.lastError ?? 'Star stream failed');
    } else if (starSnapshot?.status === 'streaming') {
      setCheckIfChanged('stars', 'pending', 'Stars loading');
    }
    const session = browser?.session?.getSnapshot?.();
    if (session?.presenting) {
      sessionStatus = 'XR session active';
    }
    const sessionTarget = activeDocument.querySelector?.('[data-session-status]');
    if (sessionTarget) sessionTarget.textContent = sessionStatus;
    if (statusTarget) {
      statusTarget.textContent = JSON.stringify({
        checks,
        session: sessionStatus,
        stars: starSnapshot?.status ?? 'starting',
        xr: session
          ? {
              supported: session.supported ?? null,
              presenting: session.presenting ?? false,
              stage: session.enterStage ?? 'idle',
            }
          : null,
      }, null, 2);
    }
  }

  /** @param {string} id @param {string} state @param {string} text */
  function setCheckIfChanged(id, state, text) {
    const current = checks[id];
    if (current?.state === state && current?.text === text) return;
    checks[id] = { state, text };
    const item = activeDocument.querySelector?.(`[data-preflight-check="${id}"]`);
    item?.setAttribute?.('data-state', state);
    const itemStatus = item?.querySelector?.('[data-preflight-check-status]');
    if (itemStatus) itemStatus.textContent = text;
  }
}

/**
 * @param {Element} host
 * @param {import('./xr-browser.d.ts').SkykitXrBrowser} browser
 */
function reportReady(host, browser, activeDocument) {
  host.dispatchEvent(createSkykitCustomEvent(activeDocument, 'skykit-browser-ready', {
    detail: { browser, viewer: browser.viewer, vr: browser.vr, xr: browser.xr },
    bubbles: true,
  }));
}

/**
 * @param {Element} host
 * @param {unknown} error
 */
function reportError(host, error, activeDocument) {
  host.dispatchEvent(createSkykitCustomEvent(activeDocument, 'skykit-browser-error', {
    detail: { error },
    bubbles: true,
  }));
  const data = isHtmlElement(host) ? host.dataset : {};
  if (!data.skykitStatus) return;
  const status = activeDocument.querySelector(data.skykitStatus);
  if (status) status.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
}

/**
 * @param {Document} activeDocument
 * @param {string} type
 * @param {CustomEventInit} init
 */
function createSkykitCustomEvent(activeDocument, type, init) {
  const EventConstructor = activeDocument.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  if (typeof EventConstructor === 'function') return new EventConstructor(type, init);
  return { type, ...init };
}

/** @param {Element} host */
function isHtmlElement(host) {
  return Boolean(
    host &&
      typeof host === 'object' &&
      ('dataset' in host || (typeof HTMLElement !== 'undefined' && host instanceof HTMLElement)),
  );
}

/** @param {() => void} callback */
function ready(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
    return;
  }
  callback();
}

export { createSkykitXrBrowser } from './xr-browser.js';
export {
  installSkykitBrowserGlobal,
  registerBrowserAddon,
  registerBrowserInstance,
} from './browser-addons.js';
