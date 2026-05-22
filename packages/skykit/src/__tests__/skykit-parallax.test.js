import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SKYKIT_ACTIONS,
  SKYKIT_CONTROLS,
  createSkykitViewer,
} from '../index.js';
import {
  createDeviceTiltTracker,
  createParallaxObserverPlugin,
  createParallaxOffsetInputPlugin,
} from '../parallax.js';

class FakeEventTarget {
  constructor(rect = { left: 0, top: 0, width: 100, height: 100 }) {
    this.rect = rect;
    this.listeners = new Map();
    this.clientWidth = rect.width;
    this.clientHeight = rect.height;
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

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

test('parallax offset input maps pointer hover to the semantic observer control', async () => {
  const target = new FakeEventTarget();
  const viewer = await createSkykitViewer({
    plugins: [
      createParallaxOffsetInputPlugin({
        target,
        pointer: { mode: 'hover' },
      }),
    ],
  });

  target.dispatch('pointermove', { clientX: 75, clientY: 25, pointerId: 1 });
  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), {
    x: 0.5,
    y: 0.5,
    source: 'pointer-hover',
    active: true,
  });

  target.dispatch('pointerleave');
  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), {
    x: 0,
    y: 0,
    source: 'pointer-leave',
    active: false,
  });

  await viewer.dispose();
});

test('parallax offset input supports drag/touch-style active updates and cleanup', async () => {
  const target = new FakeEventTarget();
  const viewer = await createSkykitViewer({
    plugins: [
      createParallaxOffsetInputPlugin({
        target,
        pointer: { mode: 'drag' },
      }),
    ],
  });

  target.dispatch('pointermove', { clientX: 100, clientY: 0, pointerId: 1 });
  assert.equal(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), undefined);

  target.dispatch('pointerdown', { clientX: 100, clientY: 0, pointerId: 7 });
  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), {
    x: 1,
    y: 1,
    source: 'pointer-drag',
    active: true,
  });

  target.dispatch('pointermove', { clientX: 0, clientY: 100, pointerId: 7 });
  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), {
    x: -1,
    y: -1,
    source: 'pointer-drag',
    active: true,
  });

  target.dispatch('pointerup');
  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), {
    x: 0,
    y: 0,
    source: 'pointer-release',
    active: false,
  });

  await viewer.dispose();
});

test('device tilt tracker calibrates, recenters, and emits normalized offsets', async () => {
  const target = new FakeEventTarget();
  const updates = [];
  const tracker = createDeviceTiltTracker({
    eventTarget: target,
    responseDeg: 10,
    requestPermission: () => 'granted',
    onUpdate(update) {
      updates.push(update);
    },
  });

  assert.equal((await tracker.enable()).ok, true);
  target.dispatch('deviceorientation', { beta: 0, gamma: 0 });
  target.dispatch('deviceorientation', { beta: 5, gamma: 10 });

  assert.equal(updates.at(-1).x, 1);
  assert.equal(updates.at(-1).y, 0.5);
  assert.equal(updates.at(-1).active, true);

  tracker.recenter();
  assert.equal(updates.at(-1).active, false);
  tracker.dispose();
  const count = updates.length;
  target.dispatch('deviceorientation', { beta: 10, gamma: 10 });
  assert.equal(updates.length, count);
});

test('parallax offset input registers tilt actions and writes tilt controls', async () => {
  const target = new FakeEventTarget();
  const viewer = await createSkykitViewer({
    plugins: [
      createParallaxOffsetInputPlugin({
        pointer: false,
        tilt: {
          eventTarget: target,
          requestPermission: () => 'granted',
          responseDeg: 10,
        },
      }),
    ],
  });

  assert.equal(viewer.actions.listActions().some((entry) => entry.id === SKYKIT_ACTIONS.observer.enableParallaxTilt), true);
  await viewer.actions.invoke(SKYKIT_ACTIONS.observer.enableParallaxTilt);
  target.dispatch('deviceorientation', { beta: 0, gamma: 0 });
  target.dispatch('deviceorientation', { beta: 5, gamma: 10 });

  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), {
    x: 1,
    y: 0.5,
    source: 'tilt',
    active: true,
  });

  await viewer.actions.invoke(SKYKIT_ACTIONS.observer.recenterParallax);
  assert.deepEqual(viewer.actions.getControlValue(SKYKIT_CONTROLS.observer.parallaxOffset), {
    x: 0,
    y: 0,
    source: 'recenter',
    active: false,
  });

  await viewer.dispose();
});

test('parallax observer moves in the target-relative plane without accumulating drift', async () => {
  const viewer = await createSkykitViewer({
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: 0, z: -10 },
    },
    plugins: [
      createParallaxObserverPlugin({
        offsetPc: 2,
        smoothing: 1,
      }),
    ],
  });

  viewer.actions.setControlValue(SKYKIT_CONTROLS.observer.parallaxOffset, {
    x: 1,
    y: 0.5,
    source: 'test',
    active: true,
  });
  viewer.frame(1 / 60);
  viewer.frame(1 / 60);

  assert.deepEqual(viewer.getViewState().observerPc, { x: 2, y: 1, z: 0 });
  assert.deepEqual(viewer.getViewState().targetPc, { x: 0, y: 0, z: -10 });

  const once = viewer.getViewState().observerPc;
  viewer.frame(1 / 60);
  viewer.frame(1 / 60);
  assert.deepEqual(viewer.getViewState().observerPc, once);

  const partSnapshot = viewer.getSnapshot().parts.find((part) => part.id === 'parallax-observer')?.snapshot;
  assert.deepEqual(partSnapshot.readsFrom, [SKYKIT_CONTROLS.observer.parallaxOffset]);
  assert.deepEqual(partSnapshot.writesTo, ['observerPc', 'targetPc', 'orientationIcrs']);

  await viewer.dispose();
});

test('parallax observer smoothing approaches the requested offset', async () => {
  const viewer = await createSkykitViewer({
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: 0, z: -10 },
    },
    plugins: [
      createParallaxObserverPlugin({
        offsetPc: 10,
        smoothing: 0.5,
      }),
    ],
  });

  viewer.actions.setControlValue(SKYKIT_CONTROLS.observer.parallaxOffset, {
    x: 1,
    y: 0,
    source: 'test',
    active: true,
  });
  viewer.frame(1 / 60);
  viewer.frame(1 / 60);

  assert.equal(viewer.getViewState().observerPc.x, 5);
  assert.equal(viewer.getViewState().observerPc.y, 0);
  assert.equal(viewer.getViewState().observerPc.z, 0);

  await viewer.dispose();
});

test('parallax observer static upIcrs controls the target-relative up plane', async () => {
  const viewer = await createSkykitViewer({
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: -10, z: 0 },
    },
    plugins: [
      createParallaxObserverPlugin({
        offsetPc: 1,
        smoothing: 1,
        upIcrs: { x: 0, y: 0, z: 1 },
      }),
    ],
  });

  viewer.actions.setControlValue(SKYKIT_CONTROLS.observer.parallaxOffset, {
    x: 0,
    y: 1,
    source: 'test',
    active: true,
  });
  viewer.frame(1 / 60);
  viewer.frame(1 / 60);

  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: 1 });
  const partSnapshot = viewer.getSnapshot().parts.find((part) => part.id === 'parallax-observer')?.snapshot;
  assert.deepEqual(partSnapshot.resolvedUpIcrs, { x: 0, y: 0, z: 1 });

  await viewer.dispose();
});

test('parallax observer resolveUpIcrs overrides static up and can change at runtime', async () => {
  let resolvedUp = { x: 1, y: 0, z: 0 };
  const viewer = await createSkykitViewer({
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: { x: 0, y: -10, z: 0 },
    },
    plugins: [
      createParallaxObserverPlugin({
        offsetPc: 1,
        smoothing: 1,
        upIcrs: { x: 0, y: 0, z: 1 },
        resolveUpIcrs({ targetPc, anchorObserverPc }) {
          assert.deepEqual(targetPc, { x: 0, y: -10, z: 0 });
          assert.deepEqual(anchorObserverPc, { x: 0, y: 0, z: 0 });
          return resolvedUp;
        },
      }),
    ],
  });

  viewer.actions.setControlValue(SKYKIT_CONTROLS.observer.parallaxOffset, {
    x: 0,
    y: 1,
    source: 'test',
    active: true,
  });
  viewer.frame(1 / 60);
  viewer.frame(1 / 60);

  assert.deepEqual(viewer.getViewState().observerPc, { x: 1, y: 0, z: 0 });
  let partSnapshot = viewer.getSnapshot().parts.find((part) => part.id === 'parallax-observer')?.snapshot;
  assert.deepEqual(partSnapshot.resolvedUpIcrs, { x: 1, y: 0, z: 0 });

  resolvedUp = { x: 0, y: 0, z: 1 };
  viewer.frame(1 / 60);
  viewer.frame(1 / 60);

  assert.deepEqual(viewer.getViewState().observerPc, { x: 0, y: 0, z: 1 });
  partSnapshot = viewer.getSnapshot().parts.find((part) => part.id === 'parallax-observer')?.snapshot;
  assert.deepEqual(partSnapshot.resolvedUpIcrs, { x: 0, y: 0, z: 1 });

  await viewer.dispose();
});
