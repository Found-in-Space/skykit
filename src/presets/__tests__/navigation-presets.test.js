import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSpeedPcPerSec,
  formatDistancePc,
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
