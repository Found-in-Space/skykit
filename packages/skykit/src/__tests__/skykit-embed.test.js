import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installSkykitBrowserGlobal,
  startSkykitBrowserEmbeds,
} from '../embed.js';

test('startSkykitBrowserEmbeds passes frame and grid attributes through to capabilities', async () => {
  const previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  const previousHTMLElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const document = createDocument();
  const host = document.createElement('section');
  const globalTarget = {};
  const globalService = installSkykitBrowserGlobal(globalTarget);
  const createdOptions = [];
  const installedAddons = [];
  const browser = {
    viewer: { id: 'browser-viewer' },
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
    grids: {
      async load(options) {
        this.options = options;
      },
    },
    async install(addon) {
      installedAddons.push(addon.id);
      return typeof addon.install === 'function' ? addon.install({ browser }) : () => {};
    },
  };

  host.dataset.skykitBrowser = '';
  host.dataset.skykitFrames = 'galactic';
  host.dataset.skykitGrids = 'equatorial,galactic';
  document.body.appendChild(host);
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: document.defaultView.CustomEvent,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: FakeElement,
  });

  try {
    startSkykitBrowserEmbeds({
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
    assert.deepEqual(browser.frames.options, { frames: 'galactic' });
    assert.deepEqual(browser.grids.options, { grids: 'equatorial,galactic' });
    assert.equal(await globalTarget.Skykit.whenReady(host), browser);
    assert.equal(host.events.find((event) => event.type === 'skykit-browser-ready').detail.browser, browser);
    assert.deepEqual(installedAddons, ['skykit-browser-global-record']);

    startSkykitBrowserEmbeds({
      document,
      globalService,
      createBrowser() {
        throw new Error('embed should not start twice');
      },
    });
  } finally {
    restoreGlobalProperty('CustomEvent', previousCustomEvent);
    restoreGlobalProperty('HTMLElement', previousHTMLElement);
  }
});

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
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      return document.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return document.body ? document.body.querySelectorAll(selector) : [];
    },
  };
  document.body = new FakeElement('body');
  return document;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
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
