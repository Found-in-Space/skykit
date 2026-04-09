import assert from 'node:assert/strict';
import test from 'node:test';
import { GALACTIC_CENTER_PC } from '../../scene-targets.js';
import {
  buildGalaxyMapValue,
  deriveGalaxyMapScaleHint,
  drawGalaxyMapGraphic,
} from '../galaxy-map-control.js';

test('galaxy map centers the galactic centre in galactocentric coordinates', () => {
  const value = buildGalaxyMapValue(GALACTIC_CENTER_PC, null);

  assert.ok(Math.abs(value.observer.x) < 1e-6);
  assert.ok(Math.abs(value.observer.y) < 1e-6);
  assert.ok(Math.abs(value.observer.z) < 1e-6);
});

test('galaxy map places the Sun away from the galactic centre', () => {
  const value = buildGalaxyMapValue({ x: 0, y: 0, z: 0 }, null);
  const radialDistancePc = Math.hypot(value.observer.x, value.observer.y);

  assert.ok(
    radialDistancePc > 8000 && radialDistancePc < 8300,
    `expected solar galactocentric radius near 8.2 kpc, got ${radialDistancePc}`,
  );
  assert.ok(Math.abs(value.observer.z) < 20);
});

test('galaxy map scale hint caps huge dataset cubes to practical travel spans', () => {
  const scaleHint = deriveGalaxyMapScaleHint({
    header: {
      worldCenterX: 0,
      worldCenterY: 0,
      worldCenterZ: 0,
      worldHalfSize: 500000,
    },
  });

  assert.equal(scaleHint.baseRadialSpanPc, 10000);
  assert.equal(scaleHint.maxRadialSpanPc, 16000);
  assert.equal(scaleHint.baseVerticalHalfSpanPc, 2500);
});

test('galaxy map can expand beyond focused span for distant targets', () => {
  const value = buildGalaxyMapValue(
    { x: 0, y: 0, z: 0 },
    GALACTIC_CENTER_PC,
    {
      baseRadialSpanPc: 10000,
      maxRadialSpanPc: 16000,
      baseVerticalHalfSpanPc: 1200,
      maxVerticalHalfSpanPc: 2500,
    },
  );

  assert.equal(value.radialSpanPc, 10000);

  const farValue = buildGalaxyMapValue(
    { x: 0, y: 0, z: 0 },
    { x: -20000, y: 0, z: 0 },
    {
      baseRadialSpanPc: 10000,
      maxRadialSpanPc: 16000,
      baseVerticalHalfSpanPc: 1200,
      maxVerticalHalfSpanPc: 2500,
    },
  );

  assert.ok(farValue.radialSpanPc > 10000);
  assert.ok(farValue.radialSpanPc <= 16000);
});

test('galaxy map radar renders semicircular distance guides', () => {
  const arcCalls = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    fillRect() {},
    strokeRect() {},
    fill() {},
    stroke() {},
    fillText() {},
    arc(x, y, radius, start, end) {
      arcCalls.push({ x, y, radius, start, end });
    },
  };

  drawGalaxyMapGraphic(ctx, { x: 0, y: 0, w: 220, h: 190 }, {
    observer: { x: -8178, y: 0, z: 0 },
    selected: null,
    radialSpanPc: 10000,
    radialTicksPc: [2500, 5000, 7500],
    verticalHalfSpanPc: 1200,
  });

  const guideArcs = arcCalls.slice(0, 4);
  assert.equal(guideArcs.length, 4);
  for (const arc of guideArcs) {
    assert.equal(arc.start, Math.PI);
    assert.equal(arc.end, Math.PI * 2);
  }
});
