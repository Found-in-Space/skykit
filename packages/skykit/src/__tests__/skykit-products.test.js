import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSkykitHrDiagramPlugin,
  createSkykitProductRegistry,
  createSkykitProductRegistryPlugin,
  createSkykitStarSourcePlugin,
  createSkykitViewer,
  getSkykitProductRegistry,
  isSkykitProductRef,
  productRef,
  resolveSkykitProductInput,
  resolveSkykitProductRef,
} from '../index.js';

test('product registry provides, replaces, tears down, and replays products', () => {
  const products = createSkykitProductRegistry();
  const events = [];

  const unsubscribe = products.subscribe('features:test', (value, record) => {
    events.push({ value, key: record?.key ?? null });
  }, { replay: true });

  assert.deepEqual(events, [{ value: null, key: null }]);

  const first = { id: 'first' };
  const second = { id: 'second' };
  const removeFirst = products.provide('features:test', first, {
    kind: 'features',
    ownerId: 'lesson',
    tags: ['route'],
  });

  assert.equal(products.get('features:test'), first);
  assert.deepEqual(products.query({ prefix: 'features:' }).map((record) => record.key), ['features:test']);
  assert.deepEqual(products.query({ kind: 'features' }).map((record) => record.key), ['features:test']);
  assert.deepEqual(products.query({ tag: 'route' }).map((record) => record.key), ['features:test']);
  assert.deepEqual(products.query({ ownerId: 'lesson' }).map((record) => record.key), ['features:test']);

  const removeSecond = products.provide('features:test', second, { kind: 'features' });
  removeFirst();

  assert.equal(products.get('features:test'), second);

  removeSecond();

  assert.equal(products.get('features:test'), null);
  assert.deepEqual(events.map((event) => event.value), [null, first, second, null]);

  unsubscribe();
});

test('product registry snapshots summarize values without exposing object products', () => {
  const products = createSkykitProductRegistry();
  const heavyValue = { id: 'heavy-source', cells: new Array(1000).fill(0) };

  products.provide('stars:stellar/source', heavyValue, {
    kind: 'stars',
    label: 'Stellar source',
    tags: ['streaming'],
  });

  const snapshot = products.getSnapshot();

  assert.equal(snapshot.productCount, 1);
  assert.equal(snapshot.products[0].key, 'stars:stellar/source');
  assert.equal(snapshot.products[0].metadata.label, 'Stellar source');
  assert.equal(snapshot.products[0].value.type, 'object');
  assert.equal(snapshot.products[0].value.id, 'heavy-source');
  assert.notEqual(snapshot.products[0].value, heavyValue);
  assert.equal('cells' in snapshot.products[0].value, false);
});

test('product refs are immutable typed references and resolve direct inputs', () => {
  const products = createSkykitProductRegistry();
  const route = { nodes: ['sol'] };
  const ref = productRef('graph:test-route');

  products.provide('graph:test-route', route);

  assert.equal(Object.isFrozen(ref), true);
  assert.equal(isSkykitProductRef(ref), true);
  assert.equal(isSkykitProductRef({ type: 'other', key: 'graph:test-route' }), false);
  assert.equal(resolveSkykitProductRef(products, ref), route);
  assert.equal(resolveSkykitProductInput(products, ref), route);
  assert.equal(resolveSkykitProductInput(products, route), route);
  assert.equal(resolveSkykitProductInput(products, null), null);
});

test('product registry plugin exposes the shared viewer registry', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const route = { id: 'route' };

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      products,
      {
        id: 'publisher',
        setup(ctx) {
          return getSkykitProductRegistry(ctx).provide('features:route', route, { kind: 'features' });
        },
      },
    ],
  });

  assert.equal(products.get('features:route'), route);
  assert.deepEqual(products.query({ kind: 'features' }).map((record) => record.key), ['features:route']);

  await viewer.dispose();

  assert.equal(products.get('features:route'), null);
});

test('star source publishes explicit source and store products until viewer disposal', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const source = createSkykitStarSourcePlugin({
    id: 'stellar-source',
    session: createFakeSession(),
    publish: {
      source: 'stars:stellar/source',
      store: 'stars:stellar/store',
      metadata: {
        label: 'Stellar source',
        tags: ['primary'],
      },
    },
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [products, source],
  });

  assert.equal(products.get('stars:stellar/source'), source);
  assert.equal(products.get('stars:stellar/store'), source.getStore());
  assert.deepEqual(products.query({ kind: 'stars' }).map((record) => record.key), [
    'stars:stellar/source',
    'stars:stellar/store',
  ]);
  assert.deepEqual(products.query({ tag: 'primary' }).map((record) => record.key), [
    'stars:stellar/source',
    'stars:stellar/store',
  ]);

  await viewer.dispose();

  assert.equal(products.get('stars:stellar/source'), null);
  assert.equal(products.get('stars:stellar/store'), null);
});

test('star source does not publish products without an explicit publish option', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const implicitSource = createSkykitStarSourcePlugin({
    id: 'implicit-source',
    session: createFakeSession('implicit-session'),
  });
  const disabledSource = createSkykitStarSourcePlugin({
    id: 'disabled-source',
    session: createFakeSession('disabled-session'),
    publish: false,
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [products, implicitSource, disabledSource],
  });

  assert.deepEqual(products.query(), []);

  await viewer.dispose();
});

test('HR diagram resolves an already provided star source product ref', async () => {
  const source = createRecordingStarSource('provided-source');
  const hr = createSkykitHrDiagramPlugin({
    id: 'hr',
    source: productRef('stars:stellar/source'),
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      {
        id: 'publisher',
        setup(ctx) {
          return getSkykitProductRegistry(ctx).provide('stars:stellar/source', source, { kind: 'stars' });
        },
      },
      hr,
    ],
  });

  assert.equal(source.demands.length, 1);
  assert.equal(source.listeners.size, 1);
  assert.equal(hr.getSnapshot().sourceAttached, true);
  assert.equal(hr.getSnapshot().waitingForSource, false);

  await viewer.dispose();
});

test('HR diagram can wait for a source product and detach when it is removed', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const source = createRecordingStarSource('late-source');
  const hr = createSkykitHrDiagramPlugin({
    id: 'hr',
    source: productRef('stars:late/source'),
  });

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [products, hr],
  });

  assert.equal(hr.getSnapshot().sourceAttached, false);
  assert.equal(hr.getSnapshot().waitingForSource, true);

  const remove = products.provide('stars:late/source', source, { kind: 'stars' });

  assert.equal(source.demands.length, 1);
  assert.equal(source.listeners.size, 1);
  assert.equal(hr.getSnapshot().sourceAttached, true);

  remove();

  assert.equal(source.demands.length, 0);
  assert.equal(source.listeners.size, 0);
  assert.equal(hr.getSnapshot().sourceAttached, false);
  assert.equal(hr.getSnapshot().waitingForSource, true);

  await viewer.dispose();
});

test('authored route products use the same registry get, subscribe, query, and removal path', async () => {
  const products = createSkykitProductRegistryPlugin({ id: 'products' });
  const routeFeatures = {
    type: 'FeatureCollection',
    features: [
      { id: 'sol', kind: 'star-waypoint', positionPc: { x: 0, y: 0, z: 0 } },
    ],
  };
  const routeWaypoints = [
    { id: 'sol', positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'tau-ceti', positionPc: { x: -1.7, y: -3.1, z: 2.2 } },
  ];
  const routeGraph = {
    nodes: ['sol', 'tau-ceti'],
    edges: [{ from: 'tau-ceti', to: 'sol', kind: 'route-link' }],
  };
  const consumed = [];

  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    plugins: [
      products,
      createAuthoredRouteProductsPlugin(routeFeatures, routeWaypoints, routeGraph),
      {
        id: 'route-consumer',
        setup(ctx) {
          const registry = getSkykitProductRegistry(ctx);
          consumed.push(registry.get('features:test-route'));
          return registry.subscribe('graph:test-route', (value) => {
            consumed.push(value);
          }, { replay: true });
        },
      },
    ],
  });

  assert.equal(consumed[0], routeFeatures);
  assert.equal(consumed[1], routeGraph);
  assert.deepEqual(products.query({ prefix: 'features:' }).map((record) => record.key), ['features:test-route']);
  assert.deepEqual(products.query({ kind: 'waypoints' }).map((record) => record.key), ['waypoints:test-route']);
  assert.deepEqual(products.query({ tag: 'authored' }).map((record) => record.key), [
    'features:test-route',
    'waypoints:test-route',
    'graph:test-route',
  ]);

  await viewer.dispose();

  assert.deepEqual(products.query(), []);
  assert.equal(products.get('features:test-route'), null);
});

function createRenderer() {
  return {
    domElement: { nodeName: 'CANVAS' },
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  };
}

function createFakeSession(id = 'session') {
  const listeners = new Set();
  return {
    id,
    disposed: false,
    updateCalls: [],
    updateView(patch, options) {
      this.updateCalls.push({ patch, options });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return { id, disposed: this.disposed };
    },
    dispose() {
      this.disposed = true;
      listeners.clear();
    },
  };
}

function createRecordingStarSource(id) {
  const source = {
    id,
    demands: [],
    listeners: new Set(),
    addDemand(demand) {
      source.demands.push(demand);
      return () => {
        const index = source.demands.indexOf(demand);
        if (index >= 0) source.demands.splice(index, 1);
      };
    },
    registerDemand(demand) {
      return source.addDemand(demand);
    },
    removeDemand(demandId) {
      source.demands = source.demands.filter((demand) => demand.id !== demandId);
    },
    refreshDemand() {},
    subscribe(listener) {
      source.listeners.add(listener);
      return () => source.listeners.delete(listener);
    },
    apply(delta) {
      for (const listener of source.listeners) listener(delta);
    },
    getStore() {
      return null;
    },
    getSnapshot() {
      return { id };
    },
  };
  return source;
}

function createAuthoredRouteProductsPlugin(routeFeatures, routeWaypoints, routeGraph) {
  return {
    id: 'authored-route-products',
    setup(ctx) {
      const registry = getSkykitProductRegistry(ctx);
      const teardowns = [
        registry.provide('features:test-route', routeFeatures, {
          kind: 'features',
          ownerId: 'test-route',
          tags: ['authored'],
        }),
        registry.provide('waypoints:test-route', routeWaypoints, {
          kind: 'waypoints',
          ownerId: 'test-route',
          tags: ['authored'],
        }),
        registry.provide('graph:test-route', routeGraph, {
          kind: 'graph',
          ownerId: 'test-route',
          tags: ['authored'],
        }),
      ];
      return () => {
        for (const teardown of teardowns.splice(0)) {
          teardown();
        }
      };
    },
  };
}
