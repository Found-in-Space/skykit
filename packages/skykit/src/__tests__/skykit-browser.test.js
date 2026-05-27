import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  installSkykitBrowserGlobal,
  registerBrowserInstance,
} from '../browser-addons.js';
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

    const marker = new THREE.Object3D();
    const markerHandle = browser.addObject(marker, {
      id: 'hyades-marker',
      positionPc: { x: 17.574, y: 42.316, z: 13.963 },
    });
    await Promise.resolve();
    assert.ok(Math.abs(marker.position.x - 0.017574) < 1e-12);
    assert.ok(Math.abs(marker.position.y - 0.042316) < 1e-12);
    assert.ok(Math.abs(marker.position.z - 0.013963) < 1e-12);
    assert.equal(browser.viewer.roots.originContentRoot.children.includes(marker), true);
    markerHandle.remove();
    await Promise.resolve();
    assert.equal(browser.viewer.roots.originContentRoot.children.includes(marker), false);

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

test('createSkykitBrowser accepts startup lookAt and mouse look mode', async () => {
  await withFakeWindow(async () => {
    const browser = await createSkykitBrowser({
      host: createHost(),
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField: createStarField(),
      autoResize: false,
      autoDispose: false,
      autoStart: false,
      mouseMode: 'strafe',
      lookAt: { targetPc: { x: 10, y: 0, z: 0 } },
    });

    const view = browser.viewer.getViewState();
    assert.deepEqual(view.targetPc, { x: 10, y: 0, z: 0 });
    assert.ok(view.orientationIcrs);
    assert.equal(
      browser.viewer.getSnapshot().parts.some((part) => part.id === 'mouse-look'),
      true,
    );
    assert.equal(
      browser.viewer.getSnapshot().parts.some((part) => part.id === 'sky-grab'),
      false,
    );

    await browser.dispose();
  });
});

test('createSkykitBrowser can disable mouse drag controls', async () => {
  await withFakeWindow(async () => {
    const browser = await createSkykitBrowser({
      host: createHost(),
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField: createStarField(),
      autoResize: false,
      autoDispose: false,
      autoStart: false,
      mouseMode: 'none',
    });

    assert.equal(
      browser.viewer.getSnapshot().parts.some((part) => part.id === 'mouse-look' || part.id === 'sky-grab'),
      false,
    );

    await browser.dispose();
  });
});

test('browser.install adds plugins after startup and cleans returned teardowns', async () => {
  await withFakeWindow(async () => {
    const calls = [];
    const browser = await createSkykitBrowser({
      host: createHost(),
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField: createStarField(),
      autoResize: false,
      autoDispose: false,
      autoStart: false,
    });

    const uninstall = await browser.install((context) => {
      context.addPart({
        id: 'late-part',
        attach() { calls.push('attach'); },
        start() { calls.push('start'); },
      });
      return () => calls.push('teardown');
    });

    await Promise.resolve();
    assert.deepEqual(calls, ['attach', 'start']);
    assert.equal(browser.viewer.getSnapshot().parts.some((part) => part.id === 'late-part'), true);
    uninstall();
    assert.deepEqual(calls, ['attach', 'start', 'teardown']);

    await browser.dispose();
  });
});

test('browser journey capability transitions through navigation actions and loads instances', async () => {
  await withFakeWindow(async () => {
    const browser = await createSkykitBrowser({
      host: createHost(),
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField: createStarField(),
      autoResize: false,
      autoDispose: false,
      autoStart: false,
    });

    await browser.journey.transitionTo({
      lookAt: { targetPc: { x: 10, y: 0, z: 0 } },
      durationSecs: 1,
    });
    browser.viewer.update(1);
    browser.viewer.update(0);
    assert.ok(browser.viewer.getViewState().orientationIcrs);
    assert.equal(browser.capabilities.has('skykit:navigation'), true);

    const journey = await browser.journey.load({
      initial: 'home',
      scenes: {
        home: { view: { observerPc: { x: 0, y: 0, z: 0 } } },
        away: { view: { observerPc: { x: 1, y: 2, z: 3 } } },
      },
    });
    await journey.goTo('away');
    browser.viewer.update(0);
    assert.deepEqual(browser.viewer.getViewState().observerPc, { x: 1, y: 2, z: 3 });
    assert.equal(journey.getSnapshot().disposed, false);
    journey.dispose();
    assert.equal(journey.getSnapshot().disposed, true);

    await browser.dispose();
  });
});

test('browser constellations capability loads manifest boundaries without art', async () => {
  await withFakeWindow(async () => {
    const browser = await createSkykitBrowser({
      host: createHost(),
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField: createStarField(),
      autoResize: false,
      autoDispose: false,
      autoStart: false,
    });

    const constellations = await browser.constellations.load({
      art: 'off',
      manifest: {
        id: 'test-skyculture',
        boundaries: {
          edges: ['001:002 M+ 00:00:00 +00:00:00 01:00:00 +00:00:00 AAA BBB'],
        },
        constellations: [],
      },
    });

    assert.equal(constellations.getSnapshot().lineCount, 1);
    assert.equal(browser.capabilities.has('skykit:browser.constellations'), true);
    assert.equal(browser.viewer.roots.observerContentRoot.children.some((child) => child.name === 'constellation-boundaries'), true);
    assert.equal(constellations.hide(), false);
    assert.equal(constellations.show(), true);

    await browser.dispose();
  });
});

test('Skykit browser global resolves existing and future browsers and installs add-ons once', async () => {
  await withFakeWindow(async () => {
    const service = installSkykitBrowserGlobal(/** @type {typeof globalThis} */ ({}));
    const host = createHost();
    const browser = await createSkykitBrowser({
      host,
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField: createStarField(),
      autoResize: false,
      autoDispose: false,
      autoStart: false,
    });
    let installs = 0;
    service.registerBrowserAddon({
      id: 'test-addon',
      install({ browser: installedBrowser }) {
        installs += 1;
        assert.equal(installedBrowser, browser);
      },
    });

    const unregister = registerBrowserInstance(service, host, browser);
    assert.equal(await service.whenReady(), browser);
    assert.equal(installs, 1);
    service.registerBrowserAddon({
      id: 'test-addon',
      install() {
        installs += 1;
      },
    });
    assert.equal(installs, 1);
    unregister();
    await browser.dispose();
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
