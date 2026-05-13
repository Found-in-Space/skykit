import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHRDiagramValue,
  createHRDiagramControl,
  decodeTeff,
  magToY,
  tempToX,
} from '../hr-diagram-control.js';

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

test('buildHRDiagramValue normalizes selected stars for the GPU component', () => {
  const geometry = {
    attributes: {
      position: { array: new Float32Array([0, 0, 0]) },
      teff_log8: { array: new Uint8Array([128]) },
      magAbs: { array: new Float32Array([4.8]) },
    },
  };

  const value = buildHRDiagramValue(geometry, {
    selectedStars: [{ teffK: '5772', magAbs: '4.83' }],
  });

  assert.deepEqual(value.selectedStars, [{ teffK: 5772, magAbs: 4.83 }]);
});

test('createHRDiagramControl returns the native Touch OS HR component node', () => {
  const control = createHRDiagramControl('hr-node', {
    height: 230,
    value: null,
    compositionMode: 'composite',
  });

  assert.equal(control.id, 'hr-node');
  assert.equal(control.component.kind, 'skykit-hr-diagram');
  assert.equal(control.props.height, 230);
  assert.equal(control.props.compositionMode, 'composite');
});

test('decodeTeff preserves solar sentinel encoding', () => {
  const sentinelTemp = decodeTeff(255);
  assert.equal(sentinelTemp, null);
});
