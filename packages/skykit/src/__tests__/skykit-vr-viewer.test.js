import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  createSkykitLayerHostPlugin,
  createSkykitProductRegistryPlugin,
  createSkykitScaleCoordinatorPlugin,
  createSkykitStarSourcePlugin,
  productRef,
} from '../index.js';
import {
  createSkykitVrViewer,
  createSkykitXrBrowser,
  createSkykitXrRaySource,
  createSkykitXrRig,
} from '../xr.js';

test('createSkykitVrViewer composes the default XR star viewer path', async () => {
  const host = createHost();
  const renderer = createRenderer();
  const provider = createProvider();
  const camera = new THREE.PerspectiveCamera();
  const setupOrder = [];

  const vr = await createSkykitVrViewer({
    id: 'vr-default',
    host,
    renderer,
    camera,
    stars: { provider },
    plugins: [
      {
        id: 'caller',
        setup(context) {
          setupOrder.push('caller');
          const source = vrProducts(context).get('stars:stellar/source');
          assert.ok(source);
        },
      },
    ],
  });

  assert.equal(vr.viewer.id, 'vr-default');
  assert.ok(vr.xr);
  assert.equal(vr.rig, vr.xr.rig);
  assert.equal(vr.session, vr.xr.session);
  assert.equal(vr.body, vr.xr.body);
  assert.equal(vr.navigation, vr.xr.navigation);
  assert.equal(vr.renderer, renderer);
  assert.equal(vr.camera, camera);
  assert.ok(vr.products);
  assert.ok(vr.starSource);
  assert.ok(vr.starField);
  assert.ok(vr.starLayer);
  assert.ok(vr.layerHost);
  assert.ok(vr.starPicking);
  assert.ok(vr.loop);
  assert.deepEqual(Object.keys(vr.rays), ['right', 'left', 'head']);
  assert.equal(vr.viewer.roots.originContentRoot, vr.xr.roots.originContentRoot);
  assert.equal(vr.viewer.observerRig, vr.xr.observerRig);
  assert.equal(vr.xr.cameraRoot.children.includes(camera), true);
  assert.equal(renderer.xr.enabled, true);
  assert.equal(vr.rig.getScaleProfile().worldUnitsPerNavigationUnit, 0.001);
  assert.equal(typeof renderer.animationLoop, 'function');
  assert.equal(vr.layerHost.getSnapshot().layerCount, 1);
  assert.equal(vr.layerHost.getSnapshot().layers[0].id, 'skykit-vr-stars:renderer');
  assert.equal(vr.starLayer.getSnapshot().demandMode, 'live');
  assert.deepEqual(setupOrder, ['caller']);
  assert.equal(provider.sessions.length, 1);
  assert.deepEqual(provider.sessions[0].options.attributes, [
    'position',
    'teffLog8',
    'magAbs',
    'objectRef',
    'pickMeta',
  ]);

  await vr.dispose();
  assert.equal(vr.loop.getSnapshot().disposed, true);
  assert.equal(renderer.animationLoop, null);
  assert.equal(renderer.disposed, false);
  assert.equal(provider.disposed, false);
});

test('createSkykitXrBrowser returns a browser-style handle over the VR viewer', async () => {
  const host = createHost();
  host.style = {};
  const renderer = createRenderer();
  const provider = createProvider();
  const starField = createStarField();

  const browser = await createSkykitXrBrowser({
    host,
    status: false,
    renderer,
    provider,
    stars: { renderer: starField },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.ok(browser.vr);
  assert.ok(browser.xr);
  assert.equal(browser.actions, browser.viewer.actions);
  assert.ok(browser.products.get('stars:stellar/source'));
  assert.ok(browser.products.get('selection:primary'));
  assert.equal(browser.selection.get(), null);
  assert.equal(browser.selection.set({ kind: 'object', id: 'xr-marker' }, { source: 'test' }), true);
  assert.deepEqual(browser.products.get('selection:primary').getPrimary(), { kind: 'object', id: 'xr-marker' });
  assert.ok(browser.inspect.getSnapshot().xr);
  assert.equal(browser.inspect.getStreams().some((stream) => stream.id === 'skykit-vr-stars'), true);
  assert.equal(browser.starSource, browser.vr.starSource);
  assert.equal(browser.starField, starField);

  await browser.dispose();
  assert.equal(provider.disposed, false);
  assert.equal(starField.disposed, false);
});

test('createSkykitVrViewer starts a caller-owned SkyKit star source without disposing it', async () => {
  const provider = createProvider();
  const source = createSkykitStarSourcePlugin({ provider });
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: {
      source,
      renderer: createStarField(),
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(vr.starSource, source);
  assert.equal(provider.sessions.length, 1);
  assert.equal(source.getSnapshot().demandCount, 2);

  await vr.dispose();
  assert.equal(source.getSnapshot().disposed, false);
  assert.equal(provider.sessions[0].disposed, false);

  await source.dispose();
  assert.equal(provider.sessions[0].disposed, true);
});

test('createSkykitVrViewer drives the default star layer through hosted scale state', async () => {
  const source = createSource();
  const scale = createSkykitScaleCoordinatorPlugin({ domain: 'stellar' });
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: {
      source,
      renderer: createStarField(),
      pick: false,
    },
    plugins: [scale],
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  vr.viewer.frame(0);
  assert.ok(vr.layerHost);
  assert.ok(vr.starLayer);
  assert.equal(vr.layerHost.getSnapshot().layers[0].activationMode, 'active');
  assert.equal(vr.starLayer.getSnapshot().demandMode, 'live');
  assert.deepEqual(source.demands.map((demand) => demand.id), [
    'skykit-vr-stars:renderer:starfield',
  ]);

  scale.setDomain('galactic');
  vr.viewer.frame(0);
  assert.equal(vr.layerHost.getSnapshot().layers[0].activationMode, 'active');
  assert.equal(vr.starLayer.getSnapshot().demandMode, 'summary');
  assert.deepEqual(source.demands.map((demand) => demand.id), [
    'skykit-vr-stars:renderer:summary',
  ]);

  scale.setDomain('solar-system');
  vr.viewer.frame(0);
  assert.equal(vr.layerHost.getSnapshot().layers[0].activationMode, 'frozen');
  assert.equal(vr.starLayer.getSnapshot().demandMode, 'paused');
  assert.deepEqual(source.demands, []);

  await vr.dispose();
});

test('createSkykitVrViewer can disable the hosted default star layer', async () => {
  const source = createSource();
  const layerDisabled = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: {
      source,
      renderer: createStarField(),
      layer: false,
      pick: false,
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(layerDisabled.starLayer, null);
  assert.equal(layerDisabled.layerHost, null);
  assert.deepEqual(source.demands, []);
  await layerDisabled.dispose();

  const hostDisabled = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: {
      source,
      renderer: createStarField(),
      pick: false,
    },
    layerHost: false,
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(hostDisabled.starLayer, null);
  assert.equal(hostDisabled.layerHost, null);
  assert.deepEqual(source.demands, []);
  await hostDisabled.dispose();
});

test('createSkykitVrViewer can disable stars while keeping the XR viewer', async () => {
  const renderer = createRenderer();
  const vr = await createSkykitVrViewer({
    renderer,
    stars: false,
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.ok(vr.viewer);
  assert.ok(vr.xr);
  assert.equal(vr.starSource, null);
  assert.equal(vr.starField, null);
  assert.equal(vr.starLayer, null);
  assert.equal(vr.starPicking, null);
  assert.equal(vr.loop, null);
  assert.equal(renderer.animationLoop, null);

  await vr.dispose();
});

test('createSkykitVrViewer creates the default star provider when stars are omitted', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('default provider test blocks network fetches');
  };

  try {
    const vr = await createSkykitVrViewer({
      renderer: createRenderer(),
      loop: false,
      autoResize: false,
      autoDispose: false,
    });

    assert.ok(vr.starSource);
    assert.ok(vr.starField);
    assert.ok(vr.starLayer);
    assert.equal(vr.getSnapshot().owned.provider, true);
    assert.equal(vr.getSnapshot().owned.starField, true);
    assert.deepEqual(
      vr.starSource.getSnapshot().demands.find((demand) => demand.id === 'skykit-vr-stars:base').attributes,
      ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
    );

    await vr.dispose();
  } finally {
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
  }
});

test('createSkykitVrViewer reuses caller-owned source and star field without disposing them', async () => {
  const source = createSource();
  const starField = createStarField();
  const renderer = createRenderer();

  const vr = await createSkykitVrViewer({
    renderer,
    stars: {
      source,
      renderer: starField,
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(vr.starSource, source);
  assert.equal(vr.starField, starField);
  assert.equal(source.demands.some((demand) => demand.id.endsWith(':starfield')), true);
  assert.equal(vr.products.query({ ownerId: source.id }).length, 2);
  assert.equal(vr.products.query({ ownerId: 'skykit-vr-stars' }).length, 0);

  await vr.dispose();
  assert.equal(source.disposed, false);
  assert.equal(starField.disposed, false);
  assert.equal(renderer.disposed, false);
});

test('createSkykitVrViewer publishes default star products and removes them on disposal', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    products,
    stars: { provider: createProvider() },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(products.get('stars:stellar/source'), vr.starSource);
  assert.equal(products.get('stars:stellar/store'), vr.starSource.getStore());
  assert.equal(products.query({ kind: 'stars' }).length, 2);

  await vr.dispose();
  assert.equal(products.query({ kind: 'stars' }).length, 0);
});

test('createSkykitVrViewer respects stars.publish false', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    products,
    stars: {
      provider: createProvider(),
      publish: false,
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(products.query({ kind: 'stars' }).length, 0);
  await vr.dispose();
});

test('createSkykitVrViewer star picking uses the right ray by default and can be disabled', async () => {
  const rightRay = fixedRaySource('right-ray', 'right');
  const leftRay = fixedRaySource('left-ray', 'left');
  const starField = createStarField();
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    xr: {
      session: false,
      body: false,
      navigation: false,
      rays: {
        right: rightRay,
        left: leftRay,
        head: false,
      },
    },
    stars: {
      source: createSource(),
      renderer: starField,
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  vr.viewer.frame(0.016, {
    xr: {
      presenting: true,
      frame: {},
      session: { inputSources: [triggerInput('right')] },
      referenceSpace: {},
    },
  });

  assert.equal(rightRay.calls, 1);
  assert.equal(leftRay.calls, 0);
  assert.equal(starField.pickCalls.length, 1);
  assert.equal(vr.starPicking.getSnapshot().pickCount, 1);

  const disabled = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: {
      source: createSource(),
      renderer: createStarField(),
      pick: false,
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });
  assert.equal(disabled.starPicking, null);

  await disabled.dispose();
  await vr.dispose();
  assert.equal(rightRay.disposed, false);
});

test('createSkykitVrViewer pick bridge true uses the right ray by default', async () => {
  const rightRay = fixedRaySource('right-bridge-ray', 'right');
  const leftRay = fixedRaySource('left-bridge-ray', 'left');
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    xr: {
      session: false,
      body: false,
      navigation: false,
      rays: {
        right: rightRay,
        left: leftRay,
        head: false,
      },
    },
    stars: false,
    pickBridge: true,
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.ok(vr.pickBridge);
  const route = vr.pickBridge.route();
  assert.equal(route.type, 'miss');
  assert.equal(rightRay.calls, 1);
  assert.equal(leftRay.calls, 0);

  await vr.dispose();
  assert.equal(rightRay.disposed, false);
});

test('createSkykitVrViewer accepts direct and named rays for star picking', async () => {
  const directRay = fixedRaySource('direct-ray', 'left');
  const namedHead = fixedRaySource('head-ray', null);
  const direct = await createSkykitVrViewer({
    renderer: createRenderer(),
    xr: {
      session: false,
      body: false,
      navigation: false,
      rays: { right: false, left: false, head: namedHead },
    },
    stars: {
      source: createSource(),
      renderer: createStarField(),
      pick: { ray: directRay },
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });
  direct.viewer.frame(0.016, {
    xr: {
      presenting: true,
      frame: {},
      session: { inputSources: [triggerInput('left')] },
      referenceSpace: {},
    },
  });
  assert.equal(directRay.calls, 1);

  const named = await createSkykitVrViewer({
    renderer: createRenderer(),
    xr: {
      session: false,
      body: false,
      navigation: false,
      rays: { right: false, left: false, head: namedHead },
    },
    stars: {
      source: createSource(),
      renderer: createStarField(),
      pick: { ray: 'head', handedness: 'any' },
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });
  named.viewer.frame(0.016, {
    xr: {
      presenting: true,
      frame: {},
      session: { inputSources: [triggerInput('right')] },
      referenceSpace: {},
    },
  });
  assert.equal(namedHead.calls, 1);

  await named.dispose();
  await direct.dispose();
});

test('createSkykitVrViewer installs generic pick bridge over hosted-layer products', async () => {
  const ray = fixedRaySource('bridge-ray', 'right');
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: false,
    pickBridge: {
      ray,
      targetProducts: [productRef('interaction:vr/target')],
    },
    layers: [
      {
        id: 'target-layer',
        setup(ctx) {
          ctx.provideProduct('interaction:vr/target', {
            pick() {
              return { distance: 2, object: 'target' };
            },
          });
        },
      },
    ],
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.ok(vr.layerHost);
  assert.ok(vr.pickBridge);
  assert.equal(vr.pickRouter, vr.pickBridge.router);
  const route = vr.pickBridge.route();
  assert.equal(route.type, 'hit');
  assert.equal(route.hit.object, 'target');

  await vr.dispose();
});

test('createSkykitVrViewer routes hosted-layer blocker products before targets', async () => {
  const ray = fixedRaySource('bridge-ray', 'right');
  let targetCalls = 0;
  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: false,
    pickBridge: {
      ray,
      blockerProducts: [productRef('interaction:vr/blocker')],
      targetProducts: [productRef('interaction:vr/target')],
    },
    layers: [
      {
        id: 'blocker-layer',
        setup(ctx) {
          ctx.provideProduct('interaction:vr/blocker', {
            blockRay() {
              return {
                consumed: true,
                distance: 1,
                hit: { object: 'blocker' },
              };
            },
          });
          ctx.provideProduct('interaction:vr/target', {
            pick() {
              targetCalls += 1;
              return { distance: 2, object: 'target' };
            },
          });
        },
      },
    ],
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  const route = vr.pickBridge.route();
  assert.equal(route.type, 'blocked');
  assert.equal(route.hit.object, 'blocker');
  assert.equal(targetCalls, 0);
  assert.equal(vr.pickBridge.getSnapshot().productBlockerCount, 1);

  await vr.dispose();
});

test('createSkykitVrViewer publishes source and picking setup before caller plugins', async () => {
  const source = createSource();
  const originalAddDemand = source.addDemand.bind(source);
  const events = [];
  source.addDemand = (demand) => {
    events.push(`demand:${demand.id}`);
    return originalAddDemand(demand);
  };
  source.registerDemand = source.addDemand;

  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    stars: {
      source,
      renderer: createStarField(),
    },
    plugins: [
      {
        id: 'caller',
        setup(context) {
          events.push('caller');
          assert.equal(vrProducts(context).get('stars:stellar/source'), source);
          assert.equal(
            source.demands.some((demand) => demand.id === 'skykit-xr-star-picking:attributes'),
            true,
          );
        },
      },
    ],
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(events.includes('demand:skykit-vr-stars:renderer:starfield'), true);
  assert.equal(events.indexOf('demand:skykit-xr-star-picking:attributes') < events.indexOf('caller'), true);

  await vr.dispose();
});

test('createSkykitVrViewer preserves caller-owned provider, product registry, layer host, rig, and rays', async () => {
  const provider = createProvider();
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const layerHost = createSkykitLayerHostPlugin();
  const rig = createSkykitXrRig();
  const ray = createSkykitXrRaySource({ id: 'caller-ray', kind: 'ship-forward' });

  const vr = await createSkykitVrViewer({
    renderer: createRenderer(),
    products,
    layerHost,
    xr: {
      rig,
      session: false,
      body: false,
      navigation: false,
      rays: {
        right: ray,
        left: false,
        head: false,
      },
    },
    stars: {
      provider,
      renderer: createStarField(),
    },
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  await vr.dispose();

  assert.equal(provider.disposed, false);
  assert.equal(products.getSnapshot().productCount, 0);
  assert.equal(layerHost.getSnapshot().layerCount, 0);
  assert.equal(rig.getSnapshot().disposed, false);
  assert.equal(ray.getSnapshot().disposed, false);

  rig.dispose();
  ray.dispose();
});

test('createSkykitVrViewer enter and exit proxy XR session configuration', async () => {
  const renderer = createRenderer();
  const session = {
    ended: false,
    async end() {
      this.ended = true;
      renderer.xr.activeSession = null;
      renderer.xr.isPresenting = false;
    },
    addEventListener() {},
  };
  const navigator = {
    xr: {
      async isSessionSupported() {
        return true;
      },
      async requestSession(mode, init) {
        this.mode = mode;
        this.init = init;
        return session;
      },
    },
  };
  const vr = await createSkykitVrViewer({
    renderer,
    xr: {
      mode: 'immersive-ar',
      referenceSpaceType: 'bounded-floor',
      session: { navigator },
      locomotion: { moveSpeedPcPerSec: 11 },
    },
    stars: false,
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.equal(vr.session.getSnapshot().mode, 'immersive-ar');
  assert.equal(vr.session.getSnapshot().referenceSpaceType, 'bounded-floor');
  assert.equal(vr.navigation.getSnapshot().moveSpeedPcPerSec, 11);

  const handle = await vr.enter();
  assert.equal(handle.session, session);
  assert.equal(renderer.xr.referenceSpaceType, 'bounded-floor');
  assert.equal(navigator.xr.mode, 'immersive-ar');
  assert.deepEqual(navigator.xr.init.optionalFeatures, ['bounded-floor']);

  await vr.exit();
  assert.equal(session.ended, true);
  await vr.dispose();
});

test('createSkykitVrViewer enter and exit reject clearly without XR sessions', async () => {
  const noXr = await createSkykitVrViewer({
    renderer: createRenderer(),
    xr: false,
    stars: false,
    loop: false,
    autoResize: false,
    autoDispose: false,
  });
  await assert.rejects(noXr.enter(), /XR support is disabled/);
  await assert.rejects(noXr.exit(), /XR support is disabled/);
  await noXr.dispose();

  const noSession = await createSkykitVrViewer({
    renderer: createRenderer(),
    xr: { session: false },
    stars: false,
    loop: false,
    autoResize: false,
    autoDispose: false,
  });
  await assert.rejects(noSession.enter(), /session support is disabled/);
  await assert.rejects(noSession.exit(), /session support is disabled/);
  await noSession.dispose();
});

test('createSkykitVrViewer handles browser resize and page lifecycle cleanup', async () => {
  await withFakeWindow(async (fakeWindow) => {
    const host = createHost();
    const renderer = createRenderer();
    const vr = await createSkykitVrViewer({
      host,
      renderer,
      stars: false,
      maxDevicePixelRatio: 1.25,
      loop: false,
    });

    assert.deepEqual(renderer.size, { width: 640, height: 360, updateStyle: true });
    assert.equal(renderer.pixelRatio, 1.25);
    assert.deepEqual(fakeWindow.addedEvents.map((event) => event.type), [
      'resize',
      'pagehide',
      'beforeunload',
    ]);

    host.clientWidth = 320;
    host.clientHeight = 200;
    fakeWindow.addedEvents.find((event) => event.type === 'resize').listener();
    assert.deepEqual(renderer.size, { width: 320, height: 200, updateStyle: true });

    await vr.dispose();
    assert.deepEqual(fakeWindow.removedEvents.map((event) => event.type), [
      'beforeunload',
      'pagehide',
      'resize',
    ]);
  });
});

test('createSkykitVrViewer dispose is idempotent and snapshot is serializable', async () => {
  const renderer = createRenderer();
  const vr = await createSkykitVrViewer({
    renderer,
    stars: false,
    loop: false,
    autoResize: false,
    autoDispose: false,
  });

  assert.doesNotThrow(() => JSON.stringify(vr.getSnapshot()));
  await vr.dispose();
  await vr.dispose();
  assert.equal(renderer.disposed, false);
  assert.equal(vr.getSnapshot().disposed, true);
});

function createHost() {
  return {
    children: [],
    clientWidth: 640,
    clientHeight: 360,
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
    size: null,
    pixelRatio: null,
    animationLoop: null,
    renderCalls: 0,
    disposed: false,
    xr: {
      enabled: false,
      isPresenting: false,
      activeSession: null,
      referenceSpaceType: null,
      getSession() {
        return this.activeSession;
      },
      getReferenceSpace() {
        return this.referenceSpaceType ? { type: this.referenceSpaceType } : null;
      },
      setReferenceSpaceType(type) {
        this.referenceSpaceType = type;
      },
      async setSession(session) {
        this.activeSession = session;
        this.isPresenting = Boolean(session);
      },
    },
    setSize(width, height, updateStyle) {
      this.size = { width, height, updateStyle };
    },
    setPixelRatio(value) {
      this.pixelRatio = value;
    },
    setAnimationLoop(callback) {
      this.animationLoop = callback;
    },
    render() {
      this.renderCalls += 1;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function createProvider() {
  return {
    id: 'provider',
    sessions: [],
    disposed: false,
    createSession(options) {
      const session = createSession(options);
      this.sessions.push(session);
      return session;
    },
    getSnapshot() {
      return { id: this.id, sessionCount: this.sessions.length, disposed: this.disposed };
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function createSession(options) {
  return {
    id: 'session',
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
        attributes: this.options?.attributes ?? [],
        disposed: this.disposed,
      };
    },
    async dispose() {
      this.disposed = true;
    },
  };
}

function createSource() {
  const store = {
    getSnapshot() {
      return { cellCount: 0 };
    },
  };
  return {
    id: 'caller-source',
    demands: [],
    subscribers: new Set(),
    disposed: false,
    setup(context) {
      context.addPart(this);
    },
    addDemand(demand) {
      this.demands.push(demand);
      return () => {
        const index = this.demands.indexOf(demand);
        if (index >= 0) this.demands.splice(index, 1);
      };
    },
    registerDemand(demand) {
      return this.addDemand(demand);
    },
    removeDemand(id) {
      this.demands = this.demands.filter((demand) => demand.id !== id);
    },
    refreshDemand() {},
    subscribe(listener) {
      this.subscribers.add(listener);
      return () => {
        this.subscribers.delete(listener);
      };
    },
    apply(delta) {
      for (const listener of this.subscribers) {
        listener(delta);
      }
    },
    getStore() {
      return store;
    },
    getSnapshot() {
      return {
        id: this.id,
        demandCount: this.demands.length,
        demands: this.demands,
        disposed: this.disposed,
      };
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function createStarField() {
  return {
    object3d: new THREE.Group(),
    disposed: false,
    view: null,
    pickCalls: [],
    apply() {},
    setCells() {},
    clear() {},
    setView(view) {
      this.view = view;
    },
    pick(ray, options) {
      this.pickCalls.push({ ray, options });
      return {
        cellKey: 'cell-a',
        objectIndex: 0,
      };
    },
    getVisibleBounds() {
      return null;
    },
    getSnapshot() {
      return {
        disposed: this.disposed,
        pickCalls: this.pickCalls.length,
        hasView: Boolean(this.view),
      };
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function fixedRaySource(id, handedness) {
  return {
    id,
    calls: 0,
    disposed: false,
    getRay() {
      this.calls += 1;
      return {
        id,
        kind: 'target-ray',
        handedness,
        origin: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: -1 },
        length: 10,
      };
    },
    getSnapshot() {
      return {
        id,
        kind: 'target-ray',
        handedness,
        disposed: this.disposed,
        lastRay: null,
      };
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function triggerInput(handedness) {
  return {
    handedness,
    gamepad: {
      axes: [],
      buttons: [{ pressed: true, touched: true, value: 1 }],
    },
  };
}

function vrProducts(context) {
  return context.useStore(Symbol.for('found-in-space.skykit.products'), () => {
    throw new Error('product registry missing');
  });
}

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
