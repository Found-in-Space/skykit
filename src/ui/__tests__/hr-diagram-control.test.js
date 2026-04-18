import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHRDiagramValue,
  createHRDiagramControl,
  decodeTeff,
  drawHRDiagramGraphic,
  magToY,
  tempToX,
} from '../hr-diagram-control.js';

function createFakeContext() {
  const calls = {
    fillRect: 0,
    strokeRect: 0,
    putImageData: 0,
  };

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    fillRect() {
      calls.fillRect += 1;
    },
    strokeRect() {
      calls.strokeRect += 1;
    },
    beginPath() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    createImageData(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
    },
    putImageData() {
      calls.putImageData += 1;
    },
  };

  return { ctx, calls };
}

test('temperature and magnitude mappings keep HR axes orientation', () => {
  const width = 200;
  const height = 120;
  const margin = 20;

  const hotX = tempToX(40000, width, margin, 2500, 40000);
  const coolX = tempToX(2500, width, margin, 2500, 40000);
  assert.ok(hotX < coolX, 'hot stars should map left of cool stars');

  const brightY = magToY(-6, height, margin, -6, 17);
  const faintY = magToY(17, height, margin, -6, 17);
  assert.ok(brightY < faintY, 'bright stars should map above faint stars');
});

test('buildHRDiagramValue reuses geometry arrays and converts observer to scene units', () => {
  const geometry = {
    attributes: {
      position: { array: new Float32Array([0, 0, 0, 1, 2, 3]) },
      teff_log8: { array: new Uint8Array([100, 120]) },
      magAbs: { array: new Float32Array([5, 2]) },
    },
  };

  const value = buildHRDiagramValue(geometry, {
    observerPc: { x: 10, y: -20, z: 30 },
    mode: 2,
    appMagLimit: 7.1,
    starCount: 2,
    viewProjection: new Float32Array(16),
  });

  assert.equal(value.positions, geometry.attributes.position.array);
  assert.equal(value.teffLog8, geometry.attributes.teff_log8.array);
  assert.equal(value.magAbs, geometry.attributes.magAbs.array);
  assert.equal(value.starCount, 2);
  assert.equal(value.mode, 2);
  assert.equal(value.appMagLimit, 7.1);
  assert.equal(value.observerX, 0.01);
  assert.equal(value.observerY, -0.02);
  assert.equal(value.observerZ, 0.03);
});

test('drawHRDiagramGraphic renders low-count stars and axes into 2D canvas', () => {
  const { ctx, calls } = createFakeContext();
  const value = {
    positions: new Float32Array([0, 0, -0.01]),
    teffLog8: new Uint8Array([128]),
    magAbs: new Float32Array([5]),
    starCount: 1,
    observerX: 0,
    observerY: 0,
    observerZ: 0,
    mode: 1,
    appMagLimit: 6.5,
  };

  const visible = drawHRDiagramGraphic(ctx, { x: 0, y: 0, w: 240, h: 180 }, value);

  assert.equal(visible, 1);
  assert.ok(calls.fillRect > 0);
  assert.ok(calls.strokeRect > 0);
  assert.equal(calls.putImageData, 0, 'low-count branch should use direct fillRect rendering');
});

test('createHRDiagramControl exposes expected touch-display control contract', () => {
  const { ctx } = createFakeContext();
  const control = createHRDiagramControl({ height: 230 });
  assert.equal(control.getHeight(), 230);

  control.render(
    ctx,
    { x: 0, y: 0, w: 260, h: 220 },
    { id: 'hr', type: 'hr-diagram', value: null },
    {},
    { theme: {} },
  );
});

test('decodeTeff preserves solar sentinel encoding', () => {
  const sentinelTemp = decodeTeff(255);
  assert.equal(sentinelTemp, null);
});

test('drawHRDiagramGraphic suppresses stars with sentinel teff_log8=255', () => {
  const { ctx } = createFakeContext();
  const value = {
    positions: new Float32Array([0, 0, -0.01]),
    teffLog8: new Uint8Array([255]),
    magAbs: new Float32Array([5]),
    starCount: 1,
    observerX: 0,
    observerY: 0,
    observerZ: 0,
    mode: 1,
    appMagLimit: 6.5,
  };

  const visible = drawHRDiagramGraphic(ctx, { x: 0, y: 0, w: 240, h: 180 }, value);
  assert.equal(visible, 0);
});
