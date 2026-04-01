import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSpeedPcPerSec,
  formatDistancePc,
  createSpeedReadout,
  createDistanceReadout,
  createFlyToAction,
  createLookAtAction,
} from '../navigation-presets.js';

// --- formatSpeedPcPerSec ---

test('formatSpeedPcPerSec returns "stationary" for zero or near-zero', () => {
  assert.equal(formatSpeedPcPerSec(0), 'stationary');
  assert.equal(formatSpeedPcPerSec(1e-8), 'stationary');
  assert.equal(formatSpeedPcPerSec(NaN), 'stationary');
});

test('formatSpeedPcPerSec shows pc/s and c multiples', () => {
  const result = formatSpeedPcPerSec(0.5);
  assert.ok(result.includes('pc/s'), `expected pc/s in "${result}"`);
  assert.ok(result.includes('c'), `expected c in "${result}"`);
});

test('formatSpeedPcPerSec scales to kc for very high speeds', () => {
  const C_IN_PC_PER_SEC = 1 / (3.26156 * 365.25 * 24 * 3600);
  const result = formatSpeedPcPerSec(C_IN_PC_PER_SEC * 5000);
  assert.ok(result.includes('kc'), `expected kc in "${result}"`);
});

// --- formatDistancePc ---

test('formatDistancePc returns em-dash for non-finite', () => {
  assert.equal(formatDistancePc(NaN), '—');
  assert.equal(formatDistancePc(Infinity), '—');
});

test('formatDistancePc shows mpc for very small distances', () => {
  const result = formatDistancePc(0.005);
  assert.ok(result.includes('mpc'), `expected mpc in "${result}"`);
});

test('formatDistancePc shows pc and ly for normal distances', () => {
  const result = formatDistancePc(1.0);
  assert.ok(result.includes('pc'), `expected pc in "${result}"`);
  assert.ok(result.includes('ly'), `expected ly in "${result}"`);
});

// --- createSpeedReadout ---

test('createSpeedReadout returns a readout control descriptor', () => {
  const fakeController = { getStats: () => ({ motion: { speedPcPerSec: 10 } }) };
  const readout = createSpeedReadout(fakeController);
  assert.equal(readout.readout, true);
  assert.equal(readout.label, 'Speed');
  assert.equal(typeof readout.value, 'function');
  assert.ok(readout.value().includes('pc/s'));
});

// --- createDistanceReadout ---

test('createDistanceReadout returns distance to target', () => {
  const fakeController = {
    getStats: () => ({ motion: { observerPc: { x: 3, y: 4, z: 0 } } }),
  };
  const readout = createDistanceReadout(fakeController, { x: 0, y: 0, z: 0 });
  assert.equal(readout.readout, true);
  assert.ok(readout.value().includes('pc'));
});

// --- createFlyToAction / createLookAtAction ---

test('createFlyToAction calls flyTo on the controller', () => {
  let called = null;
  const fakeController = { flyTo: (target, opts) => { called = { target, opts }; } };
  const action = createFlyToAction(fakeController, { x: 1, y: 2, z: 3 }, { speed: 100 });
  assert.equal(typeof action.onPress, 'function');
  action.onPress();
  assert.deepEqual(called.target, { x: 1, y: 2, z: 3 });
  assert.equal(called.opts.speed, 100);
});

test('createLookAtAction calls lookAt on the controller', () => {
  let called = null;
  const fakeController = { lookAt: (target, opts) => { called = { target, opts }; } };
  const action = createLookAtAction(fakeController, { x: 5, y: 5, z: 5 });
  action.onPress();
  assert.deepEqual(called.target, { x: 5, y: 5, z: 5 });
});
