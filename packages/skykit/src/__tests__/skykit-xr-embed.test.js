import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installSkykitBrowserGlobal,
  startSkykitXrEmbeds,
} from '../xr-embed.js';

test('startSkykitXrEmbeds starts XR browsers with status, Enter VR, and global readiness', async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const document = createDocument();
  const host = document.createElement('section');
  const status = document.createElement('pre');
  const sessionStatus = document.createElement('span');
  const skykitCheck = createChecklistItem(document, 'skykit');
  const starsCheck = createChecklistItem(document, 'stars');
  const xrCheck = createChecklistItem(document, 'xr');
  const globalTarget = {};
  const globalService = installSkykitBrowserGlobal(globalTarget);
  const createdOptions = [];
  const installedAddons = [];
  let entered = false;
  const browser = {
    viewer: { id: 'xr-browser-viewer' },
    vr: { id: 'vr-handle' },
    xr: { id: 'xr-handle' },
    starSource: {
      getSnapshot() {
        return { status: 'current' };
      },
    },
    session: {
      getSnapshot() {
        return {
          mode: 'immersive-vr',
          supported: true,
          presenting: entered,
          enterStage: 'idle',
        };
      },
    },
    constellations: {
      async load(options) {
        this.options = options;
      },
    },
    frames: {
      async load(options) {
        this.options = options;
      },
    },
    async enter() {
      entered = true;
    },
    async install(addon) {
      installedAddons.push(addon.id);
      return typeof addon.install === 'function' ? addon.install({ browser }) : () => {};
    },
  };

  host.dataset.skykitXr = '';
  host.dataset.skykitStatus = '#status';
  host.dataset.skykitMagnitude = '7.25';
  host.dataset.skykitPersistentCache = 'off';
  host.dataset.skykitXrMode = 'immersive-vr';
  host.dataset.skykitReferenceSpace = 'bounded-floor';
  host.dataset.skykitFrames = 'galactic,solar';
  status.id = 'status';
  sessionStatus.dataset.sessionStatus = '';
  document.body.appendChild(host);
  document.body.appendChild(status);
  document.body.appendChild(sessionStatus);
  document.body.appendChild(skykitCheck);
  document.body.appendChild(starsCheck);
  document.body.appendChild(xrCheck);

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      xr: {
        async isSessionSupported(mode) {
          assert.equal(mode, 'immersive-vr');
          return true;
        },
      },
    },
  });

  try {
    startSkykitXrEmbeds({
      document,
      globalService,
      createBrowser(options) {
        createdOptions.push(options);
        return Promise.resolve(browser);
      },
    });
    await flush();

    assert.equal(createdOptions.length, 1);
    assert.equal(createdOptions[0].host, host);
    assert.equal(createdOptions[0].status, '#status');
    assert.equal(createdOptions[0].persistentCache, 'off');
    assert.deepEqual(browser.frames.options, { frames: 'galactic,solar' });
    assert.deepEqual(createdOptions[0].xr, {
      mode: 'immersive-vr',
      referenceSpaceType: 'bounded-floor',
    });
    assert.equal(createdOptions[0].view.limitingMagnitude, 7.25);
    assert.equal(await globalTarget.Skykit.whenReady(host), browser);
    assert.equal(host.events.find((event) => event.type === 'skykit-browser-ready').detail.browser, browser);
    assert.equal(skykitCheck.attributes['data-state'], 'ready');
    assert.equal(starsCheck.attributes['data-state'], 'ready');
    assert.equal(xrCheck.attributes['data-state'], 'ready');
    assert.match(status.textContent, /"stars": "current"/);
    assert.deepEqual(installedAddons, [
      'skykit-xr-embed-enter-control',
      'skykit-xr-browser-global-record',
    ]);

    const enterButton = host.children.find((child) => child.dataset.skykitInjectedEnterVr === 'true');
    assert.ok(enterButton);
    await enterButton.dispatchEvent({ type: 'click' });
    assert.equal(entered, true);
    assert.equal(sessionStatus.textContent, 'XR session active');

    startSkykitXrEmbeds({
      document,
      globalService,
      createBrowser() {
        throw new Error('embed should not start twice');
      },
    });
  } finally {
    restoreGlobalProperty('navigator', previousNavigator);
  }
});

function createChecklistItem(document, id) {
  const item = document.createElement('div');
  const status = document.createElement('span');
  item.dataset.preflightCheck = id;
  status.dataset.preflightCheckStatus = '';
  item.appendChild(status);
  return item;
}

function createDocument() {
  const document = {
    body: null,
    defaultView: {
      CustomEvent: class FakeCustomEvent {
        constructor(type, init = {}) {
          this.type = type;
          this.detail = init.detail;
          this.bubbles = init.bubbles;
        }
      },
    },
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    querySelector(selector) {
      return document.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return document.body ? document.body.querySelectorAll(selector) : [];
    },
  };
  document.body = new FakeElement('body', document);
  return document;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.events = [];
    this.textContent = '';
    this.id = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  async dispatchEvent(event) {
    this.events.push(event);
    const listeners = Array.from(this.listeners.get(event.type) ?? []);
    await Promise.all(listeners.map((listener) => listener.call(this, event)));
    return true;
  }

  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const dataMatch = selector.match(/^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/);
    if (dataMatch) {
      const key = toDatasetKey(dataMatch[1]);
      if (!(key in this.dataset)) return false;
      return dataMatch[2] === undefined || this.dataset[key] === dataMatch[2];
    }
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

function toDatasetKey(attributeName) {
  return attributeName.replace(/-([a-z0-9])/g, (_match, letter) => letter.toUpperCase());
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function restoreGlobalProperty(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}
