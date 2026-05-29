import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  SKYKIT_ACTIONS,
  SKYKIT_CONTROLS,
  createSkykitLayerHostPlugin,
  createSkykitProductRegistryPlugin,
  createSkykitScaleCoordinatorPlugin,
  createSkykitSelectionProductsPlugin,
  createSkykitSelectionStore,
  createSkykitStarInstrumentPlugin,
  createSkykitStellarSkyLayer,
  createSkykitViewer,
  productRef,
} from '../index.js';
import {
  createSkykitXrActionBindingsPlugin,
  createSkykitXrPointerPlugin,
} from '../xr.js';
import {
  createSkykitShipControlsRoot,
  createSkykitXrPanelHostPlugin,
} from '../touch-os.js';

test('scale coordinator drives hosted-layer policy, local blockers, and demand helpers', async () => {
  const object3d = new THREE.Group();
  const source = createDemandSource('spatial-source');
  const target = () => ({ distance: 1, object: 'target' });
  const blocker = () => ({ blocked: true, consumed: true, distance: 0.5 });
  const layer = {
    id: 'policy-layer',
    scalePolicy: {
      stellar: { mode: 'active', demand: 'live' },
      'solar-system': { mode: 'hidden', demand: 'paused' },
    },
    setup(ctx) {
      ctx.addObject3D(object3d);
      ctx.addDemand(source, { id: 'layer-demand', frame: 'galactic-kpc' });
      ctx.addPickTarget(target);
      ctx.addPickBlocker(blocker);
    },
    getBounds() {
      return { kind: 'test-bounds', frame: 'galactic-kpc', radius: 3 };
    },
  };
  const host = createSkykitLayerHostPlugin({ layers: [layer] });
  const viewer = await createSkykitViewer({
    plugins: [
      createSkykitScaleCoordinatorPlugin({ domain: 'stellar' }),
      host,
    ],
  });

  viewer.frame(0);
  assert.equal(source.demands.length, 1);
  assert.equal(host.getPickTargets()[0], target);
  assert.equal(host.getPickBlockers()[0], blocker);
  assert.equal(host.getBounds()[0].kind, 'test-bounds');

  await viewer.actions.invoke(SKYKIT_ACTIONS.scale.setDomain, 'solar-system');
  viewer.frame(0);
  assert.equal(object3d.visible, false);
  assert.equal(source.demands.length, 0);
  assert.deepEqual(host.getPickTargets(), []);

  await viewer.actions.invoke(SKYKIT_ACTIONS.scale.setDomain, 'stellar');
  viewer.frame(0);
  assert.equal(object3d.visible, true);
  assert.equal(source.demands.length, 1);
  assert.equal(host.getPickTargets()[0], target);

  await viewer.dispose();
});

test('layer addDemand supports late generic spatial source product refs', async () => {
  const products = createSkykitProductRegistryPlugin();
  const source = createDemandSource('galactic-waypoints');
  const layer = {
    setup(ctx) {
      ctx.addDemand(productRef('sources:galactic-waypoints'), {
        id: 'waypoint-demand',
        frame: 'galactic-kpc',
        attributes: ['label'],
      });
    },
  };
  const viewer = await createSkykitViewer({
    plugins: [
      products,
      createSkykitLayerHostPlugin({ layers: [layer] }),
    ],
  });

  assert.equal(source.demands.length, 0);
  const remove = products.provide('sources:galactic-waypoints', source, { kind: 'spatial-source' });
  assert.equal(source.demands.length, 1);
  assert.equal(source.demands[0].frame, 'galactic-kpc');
  remove();
  assert.equal(source.demands.length, 0);

  await viewer.dispose();
});

test('XR action bindings publish controls and button edge actions', async () => {
  const events = [];
  const viewer = await createSkykitViewer({
    plugins: [
      createSkykitXrActionBindingsPlugin({
        bindings: {
          axes: {
            move: { hand: 'right', controlId: SKYKIT_CONTROLS.ship.move },
          },
          buttons: {
            reset: { hand: 'right', button: 'trigger', pressActionId: SKYKIT_ACTIONS.viewer.reset },
          },
        },
      }),
    ],
  });
  viewer.actions.subscribe((event) => {
    if (event.id === SKYKIT_ACTIONS.viewer.reset || event.id === SKYKIT_CONTROLS.ship.move) {
      events.push(event.type);
    }
  });

  viewer.frame(0, {
    xr: {
      presenting: true,
      session: { inputSources: [controllerInput('right', [0.25, -0.5], true)] },
    },
  });

  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.ship.move), {
    x: 0.25,
    y: -0.5,
    magnitude: Math.hypot(0.25, -0.5),
    active: true,
    activeHand: 'right',
  });
  assert.deepEqual(events, ['action/control', 'action/press', 'action/release']);

  await viewer.dispose();
});

test('XR pointer routes through layer-local targets and invokes a semantic action', async () => {
  const raySource = fixedRaySource();
  const routes = [];
  const invoked = [];
  const target = () => ({ distance: 2, object: 'panel-or-star' });
  const host = createSkykitLayerHostPlugin({
    layers: [{
      setup(ctx) {
        ctx.addPickTarget(target);
      },
    }],
  });
  const pointer = createSkykitXrPointerPlugin({
    raySource,
    onRoute(result) {
      routes.push(result.type);
    },
  });
  const viewer = await createSkykitViewer({ plugins: [host, pointer] });
  viewer.actions.registerAction(SKYKIT_ACTIONS.xr.pointerSelect, ({ payload }) => {
    invoked.push(payload.type);
  });

  viewer.frame(0, {
    xr: {
      presenting: true,
      session: { inputSources: [controllerInput('right', [], true)] },
    },
  });

  assert.deepEqual(routes, ['hit']);
  assert.deepEqual(invoked, ['hit']);
  assert.equal(pointer.getSnapshot().selectCount, 1);

  await viewer.dispose();
});

test('selection products and star instruments handle late source and overlay products', async () => {
  const products = createSkykitProductRegistryPlugin();
  const primary = createSkykitSelectionStore();
  const source = createStarSource('instrument-source');
  const instrument = createSkykitStarInstrumentPlugin({
    id: 'instrument',
    sources: [productRef('stars:primary'), productRef('stars:secondary')],
    overlays: [productRef('features:galactic')],
    surfaceKey: false,
  });
  const selection = createSkykitSelectionProductsPlugin({ primary });
  const viewer = await createSkykitViewer({ plugins: [products, selection, instrument] });

  assert.equal(products.get('selection:primary'), primary);
  primary.setPrimary({ id: 'vega' }, { source: 'test' });
  assert.deepEqual(primary.getPrimary(), { id: 'vega' });

  const removeSource = products.provide('stars:secondary', source);
  const removeOverlay = products.provide('features:galactic', {
    type: 'FeatureCollection',
    features: [],
    metadata: { datasetId: 'g', label: 'Galactic', layerKind: 'test' },
  });
  assert.equal(instrument.getSnapshot().primarySourceId, 'instrument-source');
  assert.equal(instrument.getSnapshot().overlays[0].available, true);
  removeSource();
  assert.equal(instrument.getSnapshot().primarySourceId, null);
  removeOverlay();
  assert.equal(instrument.getSnapshot().overlays[0].available, false);

  await viewer.dispose();
});

test('stellar sky hosted layer switches scale demand modes without replacing the source', async () => {
  const source = createStarSource('stellar-source');
  const renderer = createStarField();
  const layer = createSkykitStellarSkyLayer({
    source,
    renderer,
    summaryDemand: { id: 'summary-stars', attributes: ['position'] },
  });
  const viewer = await createSkykitViewer({
    plugins: [
      createSkykitScaleCoordinatorPlugin({ domain: 'stellar' }),
      createSkykitLayerHostPlugin({ layers: [layer] }),
    ],
  });

  viewer.frame(0);
  assert.deepEqual(source.demands.map((demand) => demand.id), ['skykit-stellar-sky:starfield']);
  await viewer.actions.invoke(SKYKIT_ACTIONS.scale.setDomain, 'galactic');
  viewer.frame(0);
  assert.deepEqual(source.demands.map((demand) => demand.id), ['summary-stars']);
  await viewer.actions.invoke(SKYKIT_ACTIONS.scale.setDomain, 'solar-system');
  viewer.frame(0);
  assert.deepEqual(source.demands, []);

  await viewer.dispose();
  assert.equal(renderer.disposed, true);
});

test('touch-os XR panel host publishes a pick blocker product', async () => {
  const products = createSkykitProductRegistryPlugin();
  const driver = createPanelDriver({ blocked: true, length: 2 });
  const panel = createSkykitXrPanelHostPlugin({
    id: 'panel',
    root: createSkykitShipControlsRoot({ id: 'panel-root' }),
    driverHandle: driver,
    runtime: createRuntimeStub(),
    blockerProductKey: 'interaction:panel/blocker',
  });
  const viewer = await createSkykitViewer({ plugins: [products, panel] });
  viewer.frame(0, {
    xr: {
      presenting: true,
      rays: { right: fixedRaySource() },
      session: { inputSources: [controllerInput('right', [], true)] },
      rig: { attachmentRoot: new THREE.Group() },
    },
  });

  const blocker = products.get('interaction:panel/blocker');
  assert.equal(blocker, panel);
  assert.equal(blocker.blockRay({}, { maxDistance: 10 }).blocked, true);

  await viewer.dispose();
});

function createDemandSource(id) {
  return {
    id,
    demands: [],
    addDemand(demand) {
      this.demands.push(demand);
      return () => {
        const index = this.demands.indexOf(demand);
        if (index >= 0) this.demands.splice(index, 1);
      };
    },
    subscribe() {
      return () => {};
    },
    getStore() {
      return {};
    },
    getSnapshot() {
      return { id, demandCount: this.demands.length };
    },
  };
}

function createStarSource(id) {
  return {
    ...createDemandSource(id),
    subscribers: new Set(),
    registerDemand(demand) {
      return this.addDemand(demand);
    },
    removeDemand(demandId) {
      this.demands = this.demands.filter((demand) => demand.id !== demandId);
    },
    refreshDemand() {},
    subscribe(listener) {
      this.subscribers.add(listener);
      return () => {
        this.subscribers.delete(listener);
      };
    },
    apply(delta) {
      for (const listener of this.subscribers) listener(delta);
    },
    setup(context) {
      context.addPart(this);
    },
  };
}

function createStarField() {
  return {
    object3d: new THREE.Group(),
    disposed: false,
    deltas: [],
    views: [],
    apply(delta) {
      this.deltas.push(delta);
    },
    setView(view) {
      this.views.push(view);
    },
    getVisibleBounds() {
      return { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    },
    getSnapshot() {
      return { disposed: this.disposed, deltaCount: this.deltas.length };
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function fixedRaySource() {
  return {
    id: 'ray',
    getRay() {
      return {
        id: 'ray',
        kind: 'target-ray',
        handedness: 'right',
        origin: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: -1 },
        length: 10,
      };
    },
    getSnapshot() {
      return { id: 'ray' };
    },
    dispose() {},
  };
}

function controllerInput(handedness, axes, pressed) {
  return {
    handedness,
    gamepad: {
      axes,
      buttons: [{ pressed, touched: pressed, value: pressed ? 1 : 0 }],
    },
  };
}

function createPanelDriver(hit) {
  return {
    attached: false,
    frames: [],
    attach() {
      this.attached = true;
    },
    update(frame) {
      this.frames.push(frame);
    },
    detach() {
      this.attached = false;
    },
    getHit() {
      return { blocked: hit.blocked, length: hit.length };
    },
  };
}

function createRuntimeStub() {
  return {
    setRoot() {},
    takeOutputs() {
      return [];
    },
    dispose() {},
  };
}
