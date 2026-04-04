import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeEffectiveMagLimit,
  computeMagnitudeFade,
} from '../star-field-materials.js';

test('computeEffectiveMagLimit leaves the base limit unchanged when the floor is disabled', () => {
  const limit = computeEffectiveMagLimit(7.5, 0.25, {
    nearMagLimitFloor: 25,
    nearMagLimitRadiusPc: 0,
    nearMagLimitFeatherPc: 0.25,
  });
  assert.equal(limit, 7.5);
});

test('computeEffectiveMagLimit raises the limit inside the nearby floor radius', () => {
  const limit = computeEffectiveMagLimit(7.5, 0.25, {
    nearMagLimitFloor: 25,
    nearMagLimitRadiusPc: 1.0,
    nearMagLimitFeatherPc: 0.25,
  });
  assert.equal(limit, 25);
});

test('computeMagnitudeFade reaches zero once a star passes the active limit', () => {
  assert.equal(computeMagnitudeFade(7.6, 7.5, 0), 0);
});

