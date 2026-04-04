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

test('computeVisualRadiusPx returns zero for stars beyond the magnitude fade', () => {
  const px = computeVisualRadiusPx(15, { magLimit: 6.5 });
  assert.equal(px, 0, 'stars beyond the magnitude limit should get radius 0');
});

test('computeVisualRadiusPx can keep nearby stars visible past the base mag limit', () => {
  const withoutFloor = computeVisualRadiusPx(7.55, { magLimit: 7.5 });
  const withFloor = computeVisualRadiusPx(7.55, {
    magLimit: 7.5,
    distancePc: 0.25,
    nearMagLimitFloor: 25,
    nearMagLimitRadiusPc: 1.0,
    nearMagLimitFeatherPc: 0.25,
  });
  assert.equal(withoutFloor, 0, 'base desktop profile should fade the star out');
  assert.ok(withFloor > 0, 'nearby floor should keep the star renderable');
});

test('computeVisualRadiusPx can apply a nearby size floor for XR readability', () => {
  const withoutSizeFloor = computeVisualRadiusPx(10.49, {
    magLimit: 15,
    distancePc: 1.0,
    nearMagLimitFloor: 25,
    nearMagLimitRadiusPc: 1.0,
    nearMagLimitFeatherPc: 0.25,
  });
  const withSizeFloor = computeVisualRadiusPx(10.49, {
    magLimit: 15,
    distancePc: 1.0,
    nearMagLimitFloor: 25,
    nearMagLimitRadiusPc: 1.0,
    nearMagLimitFeatherPc: 0.25,
    nearSizeFloor: 4,
  });
  assert.ok(withoutSizeFloor < 4, 'baseline tuned shader should stay below the nearby size floor');
  assert.equal(withSizeFloor, 4, 'nearby size floor should clamp the rendered radius upward');
});

test('computeVisualRadiusPx size does not change with exposure', () => {
  const faintLowExposure = computeVisualRadiusPx(2.0, {
    magLimit: 6.5,
    exposure: 10,
  });
  const faintHighExposure = computeVisualRadiusPx(2.0, {
    magLimit: 6.5,
    exposure: 1e6,
  });
  assert.equal(faintHighExposure, faintLowExposure,
    'tuned star size should not depend on exposure');
});

test('computeVisualRadiusPx can still be driven by a fixed size flux scale', () => {
  const small = computeVisualRadiusPx(2.0, {
    magLimit: 6.5,
    sizeFluxScale: 10,
  });
  const large = computeVisualRadiusPx(2.0, {
    magLimit: 6.5,
    sizeFluxScale: 2500,
  });
  assert.ok(large > small, 'fixed size flux scale should control the tuned size curve');
});

test('computeVisualRadiusPx returns larger radius for brighter stars', () => {
  const bright = computeVisualRadiusPx(0, { magLimit: 6.5 });
  const dim = computeVisualRadiusPx(5, { magLimit: 6.5 });
  assert.ok(bright > dim, `bright (${bright}) should be larger than dim (${dim})`);
});

test('computeVisualRadiusPx keeps separating very bright stars', () => {
  const bright = computeVisualRadiusPx(0, { magLimit: 6.5 });
  const extreme = computeVisualRadiusPx(-5, { magLimit: 6.5 });
  assert.ok(extreme > bright, `extreme (${extreme}) should be larger than bright (${bright})`);
});

test('computeVisualRadiusPx never exceeds sizeMax', () => {
  const px = computeVisualRadiusPx(-5, { magLimit: 6.5, sizeMax: 40 });
  assert.ok(px <= 40, `radius ${px} should not exceed sizeMax 40`);
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
