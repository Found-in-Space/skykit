import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pickStar,
  computeVisualRadiusPx,
  decodeTemperatureK,
} from '../star-picker.js';

function makeRay(ox, oy, oz, dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz);
  return {
    origin: { x: ox, y: oy, z: oz },
    direction: { x: dx / len, y: dy / len, z: dz / len },
  };
}

function makeStarData(stars) {
  const positions = new Float32Array(stars.length * 3);
  const magAbs = new Float32Array(stars.length);
  const teffLog8 = new Uint8Array(stars.length);
  for (let i = 0; i < stars.length; i++) {
    positions[i * 3] = stars[i].x;
    positions[i * 3 + 1] = stars[i].y;
    positions[i * 3 + 2] = stars[i].z;
    magAbs[i] = stars[i].mag ?? 5.0;
    teffLog8[i] = stars[i].teff ?? 200;
  }
  return { positions, magAbs, teffLog8, starCount: stars.length };
}

test('decodeTemperatureK decodes sun-like temperature at log8 ≥ 0.996', () => {
  assert.equal(decodeTemperatureK(255), 5800);
  assert.equal(decodeTemperatureK(254), 5800);
});

test('decodeTemperatureK decodes cool stars at low byte values', () => {
  const t = decodeTemperatureK(0);
  assert.equal(t, 2000);
});

test('decodeTemperatureK produces hotter values at higher bytes', () => {
  const cool = decodeTemperatureK(50);
  const hot = decodeTemperatureK(200);
  assert.ok(hot > cool, `hot (${hot}) should exceed cool (${cool})`);
});

test('computeVisualRadiusPx returns zero for very faint stars', () => {
  const px = computeVisualRadiusPx(12, { magLimit: 6.5 });
  assert.equal(px, 0, 'faint stars below luminance threshold should get radius 0');
});

test('computeVisualRadiusPx returns larger radius for brighter stars', () => {
  const bright = computeVisualRadiusPx(0, { magLimit: 6.5 });
  const dim = computeVisualRadiusPx(5, { magLimit: 6.5 });
  assert.ok(bright > dim, `bright (${bright}) should be larger than dim (${dim})`);
});

test('computeVisualRadiusPx never exceeds sizeMax', () => {
  const px = computeVisualRadiusPx(-5, { magLimit: 6.5, sizeMax: 100 });
  assert.ok(px <= 100, `radius ${px} should not exceed sizeMax 100`);
});

test('pickStar returns null for empty star data', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const result = pickStar(ray, { positions: null, magAbs: null, starCount: 0 });
  assert.equal(result, null);
});

test('pickStar returns null when no stars are in the cone', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const data = makeStarData([{ x: 1, y: 0, z: 0 }]);
  const result = pickStar(ray, data, { scale: 1, toleranceDeg: 0.5 });
  assert.equal(result, null);
});

test('pickStar finds a star directly along the ray', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const data = makeStarData([{ x: 0, y: 0, z: -10, mag: 1.0 }]);
  const result = pickStar(ray, data, { scale: 1, toleranceDeg: 1.0 });
  assert.notEqual(result, null);
  assert.equal(result.index, 0);
  assert.ok(result.angularDistanceDeg < 0.001);
  assert.ok(result.score < 0.01);
});

test('pickStar ignores stars behind the ray origin', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const data = makeStarData([{ x: 0, y: 0, z: 10, mag: -1.0 }]);
  const result = pickStar(ray, data, { scale: 1, toleranceDeg: 5.0 });
  assert.equal(result, null);
});

test('pickStar prefers bright star over faint star at same angular distance', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const offset = 0.01;
  const data = makeStarData([
    { x: offset, y: 0, z: -5, mag: 6.0 },
    { x: -offset, y: 0, z: -5, mag: -1.0 },
  ]);
  const result = pickStar(ray, data, {
    scale: 1,
    toleranceDeg: 2.0,
    fovRad: Math.PI / 3,
    viewportHeight: 800,
  });
  assert.notEqual(result, null);
  assert.equal(result.index, 1, 'should pick the brighter star (mag -1) over the faint star (mag 6)');
});

test('pickStar prefers bright star when faint star is only slightly closer to ray', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const data = makeStarData([
    { x: 0.005, y: 0, z: -5, mag: 6.0 },
    { x: 0.01, y: 0, z: -5, mag: -1.4 },
  ]);
  const result = pickStar(ray, data, {
    scale: 1,
    toleranceDeg: 2.0,
    fovRad: Math.PI / 3,
    viewportHeight: 800,
  });
  assert.notEqual(result, null);
  assert.equal(result.index, 1,
    'bright star (mag -1.4) at 2x angular distance should beat faint star (mag 6) '
    + 'because its visual radius is ~5x larger');
});

test('pickStar includes temperature when teffLog8 is available', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const data = makeStarData([{ x: 0, y: 0, z: -10, mag: 3.0, teff: 200 }]);
  const result = pickStar(ray, data, { scale: 1, toleranceDeg: 1.0 });
  assert.notEqual(result, null);
  assert.ok(Number.isFinite(result.temperatureK));
  assert.ok(result.temperatureK > 1000);
});

test('pickStar result contains expected fields', () => {
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const data = makeStarData([{ x: 0, y: 0, z: -10, mag: 2.0 }]);
  const result = pickStar(ray, data, {
    scale: 1,
    toleranceDeg: 1.0,
    fovRad: Math.PI / 3,
    viewportHeight: 800,
  });
  assert.notEqual(result, null);
  assert.equal(typeof result.index, 'number');
  assert.equal(typeof result.score, 'number');
  assert.equal(typeof result.angularDistanceDeg, 'number');
  assert.equal(typeof result.distancePc, 'number');
  assert.equal(typeof result.apparentMagnitude, 'number');
  assert.equal(typeof result.absoluteMagnitude, 'number');
  assert.equal(typeof result.visualRadiusPx, 'number');
  assert.ok(result.position);
  assert.equal(typeof result.position.x, 'number');
});

test('pickStar works with scene scale', () => {
  const scale = 0.001;
  const ray = makeRay(0, 0, 0, 0, 0, -1);
  const data = makeStarData([{ x: 0, y: 0, z: -0.01, mag: 3.0 }]);
  const result = pickStar(ray, data, { scale, toleranceDeg: 1.0 });
  assert.notEqual(result, null);
  assert.ok(Math.abs(result.distancePc - 10) < 0.1,
    `distancePc should be ~10, got ${result.distancePc}`);
});
