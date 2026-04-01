import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createHud, _resetStyles } from '../hud.js';
import { FakeElement, install, uninstall } from './fake-dom.js';

beforeEach(() => install());
afterEach(() => { _resetStyles(); uninstall(); });

function fakeCanvas() {
  const canvas = new FakeElement('canvas');
  const mount = new FakeElement('div');
  mount.appendChild(canvas);
  return { canvas, mount };
}

function fakeCameraController() {
  const presses = new Set();
  return {
    presses,
    simulateKeyDown(code) { presses.add(code); },
    simulateKeyUp(code) { presses.delete(code); },
    getStats() { return {}; },
  };
}

function pointerEvent(type, pointerId = 1) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  e.preventDefault = () => {};
  e.stopPropagation = () => {};
  return e;
}

// --- Lifecycle ---

test('createHud returns a controller-shaped object', () => {
  const hud = createHud({ controls: [] });
  assert.equal(typeof hud.attach, 'function');
  assert.equal(typeof hud.update, 'function');
  assert.equal(typeof hud.dispose, 'function');
  assert.equal(typeof hud.id, 'string');
});

test('attach creates the root HUD element inside the canvas parent', () => {
  const { canvas, mount } = fakeCanvas();
  const hud = createHud({ controls: [] });

  hud.attach({ canvas });
  assert.ok(mount.children.length >= 2); // canvas + hud root
  hud.dispose();
});

test('dispose removes the root element', () => {
  const { canvas, mount } = fakeCanvas();
  const hud = createHud({ controls: [] });

  hud.attach({ canvas });
  const countBefore = mount.children.length;
  hud.dispose();
  assert.equal(mount.children.length, countBefore - 1);
});

// --- Key presets ---

test('preset controls create key elements for each key in the preset', () => {
  const { canvas, mount } = fakeCanvas();
  const cam = fakeCameraController();
  const hud = createHud({
    cameraController: cam,
    controls: [{ preset: 'arrows', position: 'bottom-left' }],
  });

  hud.attach({ canvas });

  const keys = mount.querySelectorAll('.skykit-hud-key');
  assert.equal(keys.length, 4);
  hud.dispose();
});

test('pressing a virtual key calls simulateKeyDown on the camera controller', () => {
  const { canvas } = fakeCanvas();
  const cam = fakeCameraController();
  const hud = createHud({
    cameraController: cam,
    controls: [{ preset: 'arrows', position: 'bottom-left' }],
  });

  hud.attach({ canvas });

  const keys = canvas.parentElement.querySelectorAll('.skykit-hud-key');
  const upKey = keys.find((k) => k.textContent === '↑');
  assert.ok(upKey, 'should find the up-arrow key element');

  upKey.dispatchEvent(pointerEvent('pointerdown'));
  assert.ok(cam.presses.has('ArrowUp'), 'ArrowUp should be pressed');

  upKey.dispatchEvent(pointerEvent('pointerup'));
  assert.ok(!cam.presses.has('ArrowUp'), 'ArrowUp should be released');

  hud.dispose();
});

test('dispose releases any held keys', () => {
  const { canvas } = fakeCanvas();
  const cam = fakeCameraController();
  const hud = createHud({
    cameraController: cam,
    controls: [{ preset: 'arrows', position: 'bottom-left' }],
  });

  hud.attach({ canvas });

  const keys = canvas.parentElement.querySelectorAll('.skykit-hud-key');
  const upKey = keys.find((k) => k.textContent === '↑');
  upKey.dispatchEvent(pointerEvent('pointerdown'));
  assert.ok(cam.presses.has('ArrowUp'));

  hud.dispose();
  assert.ok(!cam.presses.has('ArrowUp'), 'key should be released on dispose');
});

// --- Action buttons ---

test('action button fires onPress callback', () => {
  const { canvas } = fakeCanvas();
  let pressed = false;
  const hud = createHud({
    controls: [{
      label: 'Go',
      position: 'top-right',
      onPress: () => { pressed = true; },
    }],
  });

  hud.attach({ canvas });

  const btns = canvas.parentElement.querySelectorAll('.skykit-hud-action');
  assert.equal(btns.length, 1);

  const click = new Event('click', { bubbles: true });
  click.stopPropagation = () => {};
  btns[0].dispatchEvent(click);
  assert.ok(pressed);

  hud.dispose();
});

test('toggle action button alternates active state', () => {
  const { canvas } = fakeCanvas();
  const states = [];
  const hud = createHud({
    controls: [{
      label: 'T',
      toggle: true,
      position: 'top-right',
      onPress: (active) => states.push(active),
    }],
  });

  hud.attach({ canvas });

  const btn = canvas.parentElement.querySelectorAll('.skykit-hud-action')[0];
  const click = () => {
    const ev = new Event('click', { bubbles: true });
    ev.stopPropagation = () => {};
    btn.dispatchEvent(ev);
  };

  click();
  assert.deepEqual(states, [true]);
  assert.ok(btn.classList.contains('skykit-hud-action--active'));

  click();
  assert.deepEqual(states, [true, false]);
  assert.ok(!btn.classList.contains('skykit-hud-action--active'));

  hud.dispose();
});

test('toggle action button supports initialActive', () => {
  const { canvas } = fakeCanvas();
  const hud = createHud({
    controls: [{
      label: 'On',
      toggle: true,
      initialActive: true,
      position: 'top-right',
      onPress: () => {},
    }],
  });

  hud.attach({ canvas });

  const btn = canvas.parentElement.querySelectorAll('.skykit-hud-action')[0];
  assert.ok(btn.classList.contains('skykit-hud-action--active'), 'should start active');

  hud.dispose();
});

test('toggle action button syncs with isActive function on update', () => {
  const { canvas } = fakeCanvas();
  let external = false;
  const hud = createHud({
    controls: [{
      label: 'Sync',
      toggle: true,
      position: 'top-right',
      onPress: () => {},
      isActive: () => external,
    }],
  });

  hud.attach({ canvas });
  const btn = canvas.parentElement.querySelectorAll('.skykit-hud-action')[0];

  assert.ok(!btn.classList.contains('skykit-hud-action--active'));

  external = true;
  hud.update();
  assert.ok(btn.classList.contains('skykit-hud-action--active'), 'should sync to true');

  external = false;
  hud.update();
  assert.ok(!btn.classList.contains('skykit-hud-action--active'), 'should sync to false');

  hud.dispose();
});

test('action button supports dynamic label function', () => {
  const { canvas } = fakeCanvas();
  let text = 'Alpha';
  const hud = createHud({
    controls: [{
      label: () => text,
      position: 'top-right',
      onPress: () => {},
    }],
  });

  hud.attach({ canvas });
  hud.update();

  const btn = canvas.parentElement.querySelectorAll('.skykit-hud-action')[0];
  const span = btn.children[0];
  assert.equal(span.textContent, 'Alpha');

  text = 'Beta';
  hud.update();
  assert.equal(span.textContent, 'Beta');

  hud.dispose();
});

// --- Readouts ---

test('readout shows initial dash and updates from value function', () => {
  const { canvas } = fakeCanvas();
  let speed = 0;
  const hud = createHud({
    controls: [{
      readout: true,
      label: 'Speed',
      position: 'top-left',
      value: () => `${speed} pc/s`,
    }],
  });

  hud.attach({ canvas });

  const readouts = canvas.parentElement.querySelectorAll('.skykit-hud-readout');
  assert.equal(readouts.length, 1);

  const valueEl = readouts[0].children.find(
    (c) => c.className === 'skykit-hud-readout__value',
  );
  assert.ok(valueEl);

  hud.update();
  assert.equal(valueEl.textContent, '0 pc/s');

  speed = 42;
  hud.update();
  assert.equal(valueEl.textContent, '42 pc/s');

  hud.dispose();
});

test('readout skips DOM update when value has not changed', () => {
  const { canvas } = fakeCanvas();
  let calls = 0;
  const hud = createHud({
    controls: [{
      readout: true,
      label: 'X',
      position: 'top-left',
      value: () => { calls++; return 'same'; },
    }],
  });

  hud.attach({ canvas });

  hud.update();
  const readouts = canvas.parentElement.querySelectorAll('.skykit-hud-readout');
  const valueEl = readouts[0].children.find(
    (c) => c.className === 'skykit-hud-readout__value',
  );
  const first = valueEl.textContent;

  hud.update();
  assert.equal(valueEl.textContent, first);
  assert.equal(calls, 2); // value() called both times, but textContent set only once

  hud.dispose();
});

// --- Mixed controls ---

test('controls can be placed in different regions', () => {
  const { canvas } = fakeCanvas();
  const cam = fakeCameraController();
  const hud = createHud({
    cameraController: cam,
    controls: [
      { preset: 'arrows', position: 'bottom-left' },
      { label: 'Go', position: 'top-right', onPress: () => {} },
      { readout: true, label: 'V', position: 'top-left', value: () => '1' },
    ],
  });

  hud.attach({ canvas });

  const regions = canvas.parentElement.querySelectorAll('.skykit-hud-region');
  assert.equal(regions.length, 3); // bottom-left, top-right, top-left

  hud.dispose();
});
