import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createSkykitBrowser } from '../browser.js';

test('createSkykitBrowser wires the starter viewer and extra plugins', async () => {
  await withFakeWindow(async (fakeWindow) => {
    const host = createHost();
    const status = { textContent: '' };
    const renderer = createRenderer();
    const provider = createProvider();
    const starField = createStarField();
    const extraPartCalls = [];

    const browser = await createSkykitBrowser({
      host,
      status,
      renderer,
      camera: new THREE.PerspectiveCamera(),
      provider,
      starField,
      autoResize: false,
      autoDispose: false,
      autoStart: false,
      maxDevicePixelRatio: 1.5,
      plugins: [
        (context) => context.addPart({
          id: 'extra-part',
          attach() { extraPartCalls.push('attach'); },
          start() { extraPartCalls.push('start'); },
        }),
      ],
    });

    assert.equal(host.children[0], renderer.domElement);
    assert.equal(host.style.touchAction, 'none');
    assert.equal(renderer.clearColor.color, 0x02040b);
    assert.deepEqual(renderer.size, { width: 640, height: 360, updateStyle: true });
    assert.equal(renderer.pixelRatio, 1.5);
    assert.equal(provider.sessions.length, 1);
    assert.equal(provider.sessions[0].subscribers.size, 1);
    assert.equal(provider.sessions[0].updateViewCalls.length, 2);
    assert.deepEqual(extraPartCalls, ['attach', 'start']);
    assert.match(status.textContent, /"starsLoaded": 0/);

    browser.resize();
    assert.equal(fakeWindow.addedEvents.length, 0);

    await browser.dispose();
    assert.equal(provider.disposed, false, 'caller-owned provider should not be disposed');
    assert.equal(provider.sessions[0].disposed, true);
    assert.equal(starField.disposed, true);
    assert.equal(renderer.disposed, false, 'caller-owned renderer should not be disposed');
    assert.equal(host.children.length, 0);
  });
});

test('createSkykitBrowser registers resize and page-lifecycle cleanup by default', async () => {
  await withFakeWindow(async (fakeWindow) => {
    const host = createHost();
    const renderer = createRenderer();
    const provider = createProvider();
    const starField = createStarField();

    const browser = await createSkykitBrowser({
      host,
      status: false,
      renderer,
      provider,
      starField,
      autoStart: false,
    });

    assert.deepEqual(fakeWindow.addedEvents.map((entry) => entry.type), [
      'resize',
      'pagehide',
      'beforeunload',
    ]);

    await browser.dispose();

    assert.deepEqual(fakeWindow.removedEvents.map((entry) => entry.type), [
      'resize',
      'pagehide',
      'beforeunload',
    ]);
  });
});

async function withFakeWindow(callback) {
  const previousWindow = globalThis.window;
  const fakeWindow = {
    devicePixelRatio: 2,
    addedEvents: [],
    removedEvents: [],
    addEventListener(type, listener, options) {
      this.addedEvents.push({ type, listener, options });
    },
    removeEventListener(type, listener) {
      this.removedEvents.push({ type, listener });
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: fakeWindow,
  });

  try {
    await callback(fakeWindow);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
}

function createHost() {
  return {
    children: [],
    clientWidth: 640,
    clientHeight: 360,
    style: {},
    appendChild(node) {
      this.children.push(node);
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
    },
  };
}

function createRenderer() {
  return {
    domElement: { nodeName: 'CANVAS' },
    clearColor: null,
    size: null,
    pixelRatio: null,
    disposed: false,
    setClearColor(color, alpha) {
      this.clearColor = { color, alpha };
    },
    setSize(width, height, updateStyle) {
      this.size = { width, height, updateStyle };
    },
    setPixelRatio(value) {
      this.pixelRatio = value;
    },
    render() {},
    dispose() {
      this.disposed = true;
    },
  };
}

function createProvider() {
  return {
    sessions: [],
    disposed: false,
    createSession(options) {
      const session = createSession(options);
      this.sessions.push(session);
      return session;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function createSession(options) {
  return {
    id: 'test-session',
    options,
    subscribers: new Set(),
    updateViewCalls: [],
    disposed: false,
    subscribe(callback) {
      this.subscribers.add(callback);
      return () => {
        this.subscribers.delete(callback);
      };
    },
    updateView(view, options) {
      this.updateViewCalls.push({ view, options });
    },
    getSnapshot() {
      return {
        id: this.id,
        updateViewCalls: this.updateViewCalls.length,
      };
    },
    async dispose() {
      this.disposed = true;
    },
  };
}

function createStarField() {
  return {
    object3d: new THREE.Group(),
    disposed: false,
    view: null,
    apply() {},
    setView(view) {
      this.view = view;
    },
    getSnapshot() {
      return {
        starCount: 0,
        hasView: Boolean(this.view),
      };
    },
    dispose() {
      this.disposed = true;
    },
  };
}
