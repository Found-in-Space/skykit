import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  installSkykitBrowserGlobal,
  registerBrowserInstance,
} from '../browser-addons.js';
import { SKYKIT_ACTIONS } from '../actions.js';
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
    assert.equal(browser.actions, browser.viewer.actions);
    assert.ok(browser.products.get('stars:stellar/source'));
    assert.ok(browser.products.get('stars:stellar/store'));
    assert.equal(browser.selection.get(), null);
    assert.equal(browser.selection.set({ kind: 'object', id: 'lesson-marker' }, { source: 'test' }), true);
    assert.deepEqual(browser.selection.get(), { kind: 'object', id: 'lesson-marker' });
    assert.deepEqual(browser.products.get('selection:primary').getPrimary(), { kind: 'object', id: 'lesson-marker' });
    assert.equal(browser.inspect.getSnapshot().id, browser.viewer.id);
    assert.deepEqual(
      browser.inspect.getProducts({ kind: 'stars' }).map((product) => product.key),
      ['stars:stellar/source', 'stars:stellar/store'],
    );
    assert.equal(browser.inspect.getStreams().some((stream) => stream.id === 'stars'), true);
    assert.equal(browser.inspect.getSelection().current.kind, 'object');

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

test('createSkykitBrowser selects public layer hits through the default semantic action', async () => {
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

    await browser.actions.invoke(SKYKIT_ACTIONS.selection.select, {
      waypoint: {
        id: 'lesson:arrival',
        label: 'Arrival point',
        target: { targetPc: { x: 1, y: 2, z: 3 } },
        layerId: 'lesson-route',
      },
      productKey: 'waypoints:lesson-route',
    }, { source: 'lesson-plugin' });

    assert.deepEqual(browser.selection.get(), {
      kind: 'waypoint',
      id: 'lesson:arrival',
      label: 'Arrival point',
      target: { targetPc: { x: 1, y: 2, z: 3 } },
      source: 'lesson-plugin',
      productKey: 'waypoints:lesson-route',
      layerId: 'lesson-route',
    });
    assert.equal(
      browser.inspect.getHistory().some((entry) => (
        entry.type === 'action' &&
        entry.eventType === 'action/invoke' &&
        entry.actionId === SKYKIT_ACTIONS.selection.select
      )),
      true,
    );
    assert.equal(
      browser.inspect.getHistory().some((entry) => (
        entry.type === 'selection' &&
        entry.selection?.id === 'lesson:arrival' &&
        entry.selection?.layerId === 'lesson-route'
      )),
      true,
    );

    await browser.dispose();
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

test('createSkykitBrowser accepts orbit mouse mode', async () => {
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
      mouseMode: 'orbit',
      lookAt: { targetPc: { x: 10, y: 0, z: 0 } },
    });

    assert.deepEqual(browser.viewer.getViewState().targetPc, { x: 10, y: 0, z: 0 });
    assert.equal(
      browser.viewer.getSnapshot().parts.some((part) => part.id === 'sky-orbit'),
      true,
    );
    assert.equal(
      browser.viewer.getSnapshot().parts.find((part) => part.id === 'sky-orbit')?.snapshot?.sensitivityRadiansPerPixel,
      0.00115,
    );
    assert.equal(
      browser.viewer.getSnapshot().parts.some((part) => part.id === 'sky-grab' || part.id === 'mouse-look'),
      false,
    );

    await browser.dispose();
  });
});

test('createSkykitBrowser treats orbit mouse mode aliases as orbit mode', async () => {
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
      mouseMode: 'inspect',
      lookAt: { targetPc: { x: 10, y: 0, z: 0 } },
    });

    assert.equal(
      browser.viewer.getSnapshot().parts.some((part) => part.id === 'sky-orbit'),
      true,
    );

    await browser.dispose();
  });
});

test('createSkykitBrowser starts from observer and solar RA/Dec distance lookAt', async () => {
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
      lookAt: { raDeg: 90, decDeg: 0, distancePc: 10 },
      view: {
        observerPc: { x: 1, y: 0, z: 0 },
      },
    });

    const view = browser.viewer.getViewState();
    assert.deepEqual(view.observerPc, { x: 1, y: 0, z: 0 });
    assertVectorApprox(view.targetPc, { x: 0, y: 10, z: 0 });
    assertVectorApprox(
      localVectorFromView(view, { x: 0, y: 0, z: -1 }),
      normalizeVector({ x: -1, y: 10, z: 0 }),
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

test('createSkykitBrowser enables persistent provider cache by default and can opt out', async () => {
  await withFakeWindow(async () => {
    await withFakeCaches(async () => {
      const cached = await createSkykitBrowser({
        host: createHost(),
        status: false,
        renderer: createRenderer(),
        starField: createStarField(),
        autoResize: false,
        autoDispose: false,
        autoStart: false,
      });
      assert.equal(cached.provider.describe().capabilities.persistentCache, true);
      await cached.dispose();

      const uncached = await createSkykitBrowser({
        host: createHost(),
        status: false,
        renderer: createRenderer(),
        starField: createStarField(),
        persistentCache: 'off',
        autoResize: false,
        autoDispose: false,
        autoStart: false,
      });
      assert.equal(uncached.provider.describe().capabilities.persistentCache, false);
      await uncached.dispose();
    });
  });
});

test('createSkykitBrowser treats forbidden Cache API access as disabled', async () => {
  await withFakeWindow(async () => {
    await withForbiddenCaches(async () => {
      const browser = await createSkykitBrowser({
        host: createHost(),
        status: false,
        renderer: createRenderer(),
        starField: createStarField(),
        autoResize: false,
        autoDispose: false,
        autoStart: false,
      });

      assert.equal(browser.provider.describe().capabilities.persistentCache, false);
      await browser.dispose();
    });
  });
});

test('createSkykitBrowser installs default star picking when the star field supports pick', async () => {
  await withFakeWindow(async () => {
    const host = createPointerHost();
    const objectRef = {
      datasetId: 'gaia-dr3',
      level: 4,
      mortonCode: '00af',
      ordinal: 7,
    };
    const pickResult = {
      cellKey: 'cell-a',
      objectIndex: 0,
      objectRef,
      pickMeta: null,
      position: { x: 1, y: 2, z: 3 },
      distancePc: 10,
      apparentMagnitude: 2,
      visualRadiusPx: 4,
      teffLog8: 128,
      magAbs: 1,
      score: 0.5,
      angularDistanceDeg: 0.1,
    };
    const starField = createStarField({ pickResult });
    const browser = await createSkykitBrowser({
      host,
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField,
      mouseMode: 'none',
      autoResize: false,
      autoDispose: false,
      autoStart: false,
    });

    assert.ok(browser.starPicking);
    assert.equal(host.listenerCount('pointerdown'), 1);
    assert.deepEqual(browser.provider.sessions[0].options.attributes, [
      'position',
      'teffLog8',
      'magAbs',
      'objectRef',
      'pickMeta',
    ]);

    host.dispatch('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 320, clientY: 180 });
    host.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 320, clientY: 180 });
    await flushMicrotasks();

    assert.equal(starField.pickCalls.length, 1);
    assert.equal(browser.selection.get().kind, 'star');
    assert.deepEqual(browser.selection.get().ref, objectRef);
    assert.equal(browser.inspect.getHistory().some((entry) => entry.type === 'selection'), true);

    browser.actions.press('skykit:test.pick-history', { ok: true }, { source: 'test' });
    const actionEntry = browser.inspect.getHistory().find((entry) => entry.eventType === 'action/press');
    assert.equal(actionEntry?.actionId, 'skykit:test.pick-history');
    assert.deepEqual(actionEntry?.payload, { ok: true });

    await browser.dispose();
    assert.equal(host.listenerCount('pointerdown'), 0);
  });
});

test('createSkykitBrowser can opt out of default star picking', async () => {
  await withFakeWindow(async () => {
    const host = createPointerHost();
    const browser = await createSkykitBrowser({
      host,
      status: false,
      renderer: createRenderer(),
      provider: createProvider(),
      starField: createStarField({ pickResult: { cellKey: 'cell-a', objectIndex: 0 } }),
      pick: false,
      mouseMode: 'none',
      autoResize: false,
      autoDispose: false,
      autoStart: false,
    });

    assert.equal(browser.starPicking, null);
    assert.equal(host.listenerCount('pointerdown'), 0);

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

test('browser coordinate frame capability publishes features, waypoints, and inspectable selections', async () => {
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

    const frames = await browser.frames.load({ frames: ['galactic', 'solar'] });
    const snapshot = frames.getSnapshot();

    assert.equal(snapshot.frameCount, 2);
    assert.equal(browser.capabilities.has('skykit:browser.coordinate-frames'), true);
    assert.equal(browser.products.get('features:frames/galactic').type, 'FeatureCollection');
    assert.equal(browser.products.get('features:frames/solar').type, 'FeatureCollection');

    const waypoints = browser.products.get('waypoints:frames/galactic');
    const waypoint = waypoints.find((entry) => entry.id === 'galactic:north-pole') ?? waypoints[0];
    const selection = {
      kind: 'object',
      id: waypoint.id,
      label: waypoint.label,
      productKey: 'waypoints:frames/galactic',
      source: 'test',
    };
    assert.equal(browser.selection.set(selection, { source: 'test' }), true);
    assert.deepEqual(
      browser.inspect.getHistory().find((entry) => entry.type === 'selection')?.selection,
      selection,
    );
    assert.equal(frames.hide(), false);
    assert.equal(frames.show(), true);

    await browser.dispose();
  });
});

test('browser coordinate grid capability publishes features and mirrors frame facade controls', async () => {
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

    const grids = await browser.grids.load({ grids: 'equatorial,galactic' });
    const snapshot = grids.getSnapshot();

    assert.equal(snapshot.gridCount, 2);
    assert.equal(browser.capabilities.has('skykit:browser.coordinate-grids'), true);
    assert.equal(browser.products.get('features:grids/equatorial').type, 'FeatureCollection');
    assert.equal(browser.products.get('features:grids/galactic').features.some((feature) => feature.id === 'galactic:plane'), true);
    assert.equal(browser.products.get('waypoints:grids/equatorial').some((waypoint) => waypoint.id === 'equatorial:ra-06h'), true);
    assert.deepEqual(snapshot.products, [
      'features:grids/equatorial',
      'waypoints:grids/equatorial',
      'features:grids/galactic',
      'waypoints:grids/galactic',
    ]);
    assert.equal(grids.hide(), false);
    assert.equal(grids.toggle(), true);
    assert.equal(grids.show(), true);

    await browser.dispose();
  });
});

test('browser coordinate grid capability defaults to equatorial and galactic grids', async () => {
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

    const grids = await browser.grids.load();

    assert.deepEqual(grids.getSnapshot().products, [
      'features:grids/equatorial',
      'waypoints:grids/equatorial',
      'features:grids/galactic',
      'waypoints:grids/galactic',
    ]);

    await browser.dispose();
  });
});

test('browser coordinate grid capability treats off-like requests as disabled', async () => {
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

    const grids = await browser.grids.load({ grids: 'off' });

    assert.equal(grids.getSnapshot().gridCount, 0);
    assert.equal(browser.capabilities.has('skykit:browser.coordinate-grids'), false);
    assert.equal(browser.products.get('features:grids/equatorial'), null);

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

async function withFakeCaches(callback) {
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousFetch = globalThis.fetch;
  const cache = {
    async match() {
      return null;
    },
    async put() {},
  };

  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      async open() {
        return cache;
      },
    },
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value(_url, options = {}) {
      return new Promise((_resolve, reject) => {
        if (options.signal?.aborted) {
          const error = new Error('Range fetch aborted.');
          error.name = 'AbortError';
          reject(error);
          return;
        }
        options.signal?.addEventListener?.('abort', () => {
          const error = new Error('Range fetch aborted.');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  });

  try {
    await callback();
  } finally {
    restoreGlobalProperty('caches', previousCaches);
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: previousFetch,
      });
    }
  }
}

async function withForbiddenCaches(callback) {
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousWarn = console.warn;

  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    get() {
      const error = new Error('Cache API storage is blocked.');
      error.name = 'SecurityError';
      throw error;
    },
  });
  console.warn = () => {};

  try {
    await callback();
  } finally {
    console.warn = previousWarn;
    restoreGlobalProperty('caches', previousCaches);
  }
}

function restoreGlobalProperty(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
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

function createPointerHost() {
  const host = createHost();
  const listeners = new Map();
  return {
    ...host,
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: this.clientWidth,
        height: this.clientHeight,
      };
    },
    addEventListener(type, listener) {
      let typeListeners = listeners.get(type);
      if (!typeListeners) {
        typeListeners = new Set();
        listeners.set(type, typeListeners);
      }
      typeListeners.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ type, ...event });
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function createStarField(options = {}) {
  return {
    object3d: new THREE.Group(),
    disposed: false,
    view: null,
    pickCalls: [],
    apply() {},
    setView(view) {
      this.view = view;
    },
    pick: options.pickResult === undefined
      ? undefined
      : function pick(ray, pickOptions) {
          this.pickCalls.push({ ray, options: pickOptions });
          return options.pickResult;
        },
    getSnapshot() {
      return {
        starCount: 0,
        hasView: Boolean(this.view),
        pickCalls: this.pickCalls.length,
      };
    },
    dispose() {
      this.disposed = true;
    },
  };
}

async function flushMicrotasks(count = 10) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function localVectorFromView(view, vector) {
  const q = view.orientationIcrs ?? { x: 0, y: 0, z: 0, w: 1 };
  const result = new THREE.Vector3(vector.x, vector.y, vector.z).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w),
  );
  return { x: result.x, y: result.y, z: result.z };
}

function assertVectorApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual.x - expected.x) < epsilon, `x ${actual.x} !== ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < epsilon, `y ${actual.y} !== ${expected.y}`);
  assert.ok(Math.abs(actual.z - expected.z) < epsilon, `z ${actual.z} !== ${expected.z}`);
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}
