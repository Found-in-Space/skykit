import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createStarCellData, encodeMorton3D } from '@found-in-space/star-trees';
import {
  HR_DIAGRAM_MODE_MAGNITUDE,
  HR_DIAGRAM_MODE_FRUSTUM,
  HR_DIAGRAM_MODE_VOLUME,
  createHrDiagramGeometryFromCells,
  createHrDiagramRenderer,
  createHrDiagramSurfaceSource,
  drawHrDiagramCanvas,
  normalizeHrDiagramMode,
  projectHrDiagramStars,
  projectHrPoint,
} from '../index.js';

test('projects HR points with temperature and absolute magnitude', () => {
  const point = projectHrPoint({
    rect: { x: 0, y: 0, w: 400, h: 300 },
    temperatureK: 5800,
    magAbs: 5,
  });

  assert.ok(point);
  assert.equal(point.color.length, 3);
});

test('canvas projection consumes cells and emits cell-keyed points', () => {
  const cell = createCell({ keyOrdinal: 1 });
  const result = projectHrDiagramStars(
    { x: 0, y: 0, w: 400, h: 300 },
    {
      cells: [cell],
      mode: HR_DIAGRAM_MODE_MAGNITUDE,
      limitingMagnitude: 20,
    },
  );

  assert.equal(result.visibleCount, 1);
  assert.equal(result.points[0].cellKey, cell.cellKey);
});

test('HR modes are string-only at the public boundary', () => {
  assert.equal(normalizeHrDiagramMode(HR_DIAGRAM_MODE_VOLUME), HR_DIAGRAM_MODE_VOLUME);
  assert.equal(normalizeHrDiagramMode(HR_DIAGRAM_MODE_FRUSTUM), HR_DIAGRAM_MODE_FRUSTUM);
  assert.equal(normalizeHrDiagramMode(/** @type {any} */ (1)), HR_DIAGRAM_MODE_MAGNITUDE);
});

test('projection filters render-unit cells with an explicit coordinate scale', () => {
  const near = createCell({ keyOrdinal: 1, x: 10 });
  const far = createCell({ keyOrdinal: 2, x: 30 });
  const result = projectHrDiagramStars(
    { x: 0, y: 0, w: 400, h: 300 },
    {
      cells: [near, far],
      mode: HR_DIAGRAM_MODE_VOLUME,
      observerPosition: { x: 0, y: 0, z: 0 },
      coordinateUnitsPerParsec: 10,
      volumeRadiusPc: 2,
    },
  );

  assert.equal(result.starCount, 2);
  assert.equal(result.visibleCount, 1);
  assert.equal(result.points[0].cellKey, near.cellKey);
});

test('frustum mode applies the same magnitude and clip-space filters on CPU projection', () => {
  const visible = createCell({ keyOrdinal: 1, x: 0 });
  const clipped = createCell({ keyOrdinal: 2, x: 2 });
  const result = projectHrDiagramStars(
    { x: 0, y: 0, w: 400, h: 300 },
    {
      cells: [visible, clipped],
      mode: HR_DIAGRAM_MODE_FRUSTUM,
      limitingMagnitude: 20,
      viewProjection: new THREE.Matrix4().identity(),
    },
  );

  assert.equal(result.starCount, 2);
  assert.equal(result.visibleCount, 1);
  assert.equal(result.points[0].cellKey, visible.cellKey);
});

test('canvas renderer draws axes, highlight regions, visible count, and selected markers', () => {
  const ctx = createRecordingContext();
  const cell = createCell({ keyOrdinal: 1 });
  const result = drawHrDiagramCanvas(
    ctx,
    { x: 0, y: 0, w: 400, h: 300 },
    {
      cells: [cell],
      mode: HR_DIAGRAM_MODE_MAGNITUDE,
      limitingMagnitude: 20,
      highlightRegion: {
        teffMin: 5000,
        teffMax: 7000,
        magAbsMin: 0,
        magAbsMax: 8,
        label: 'main sequence',
      },
      selectedStars: [{ temperatureK: 5800, magAbs: 4.8, label: 'Sol' }],
    },
  );

  assert.equal(result.visibleCount, 1);
  assert.equal(ctx.operations.some((operation) => operation[0] === 'strokeRect'), true);
  assert.equal(ctx.operations.some((operation) => operation[0] === 'arc'), true);
  assert.equal(ctx.operations.some((operation) => operation.includes('1 visible')), true);
  assert.equal(ctx.operations.some((operation) => operation.includes('main sequence')), true);
  assert.equal(ctx.operations.some((operation) => operation.includes('Sol')), true);
});

test('WebGL geometry aggregates cells deterministically', () => {
  const cellB = createCell({ keyOrdinal: 2, x: 20 });
  const cellA = createCell({ keyOrdinal: 1, x: 10 });
  const geometry = createHrDiagramGeometryFromCells([cellB, cellA]);

  assert.deepEqual(
    Array.from(geometry.getAttribute('position').array).slice(0, 6),
    [10, 0, 0, 20, 0, 0],
  );
  assert.equal(geometry.drawRange.count, 2);
});

test('WebGL renderer applies cell lifecycle deltas to one aggregate object', () => {
  const renderer = createHrDiagramRenderer();
  const sceneObject = renderer.scene.children[0];
  const cellA = createCell({ keyOrdinal: 1 });
  const cellB = createCell({ keyOrdinal: 2 });

  renderer.apply({ type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cellA, cellB] });
  assert.equal(renderer.getSnapshot().cellCount, 2);
  assert.equal(renderer.getSnapshot().starCount, 2);
  assert.equal(renderer.scene.children[0], sceneObject);

  renderer.apply({ type: 'stars/cells-remove', providerId: 'provider-a', cellKeys: [cellA.cellKey] });
  assert.equal(renderer.getSnapshot().cellCount, 1);
  assert.equal(renderer.scene.children[0], sceneObject);
});

test('surface source forwards cell APIs', () => {
  const source = createHrDiagramSurfaceSource({ width: 64, height: 64 });
  const cell = createCell({ keyOrdinal: 1 });

  source.setCells([cell]);
  assert.equal(source.getSnapshot().cellCount, 1);
  source.apply({ type: 'stars/cells-remove', providerId: 'provider-a', cellKeys: [cell.cellKey] });
  assert.equal(source.getSnapshot().cellCount, 0);
  source.dispose();
});

function createCell(options = {}) {
  const keyOrdinal = options.keyOrdinal ?? 1;
  const node = {
    level: 2,
    gridX: keyOrdinal,
    gridY: 0,
    gridZ: 0,
    mortonCode: String(encodeMorton3D(keyOrdinal, 0, 0, 2)),
    centerX: options.x ?? keyOrdinal,
    centerY: 0,
    centerZ: 0,
    halfSize: 0.5,
  };
  return createStarCellData({
    node,
    decoded: {
      count: 1,
      positionsPc: new Float32Array([options.x ?? keyOrdinal, 0, 0]),
      teffLog8: new Uint8Array([128]),
      magAbs: new Float32Array([1]),
    },
    attributes: ['position', 'teffLog8', 'magAbs'],
  });
}

function createRecordingContext() {
  const operations = [];
  const context = {
    operations,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    save() { operations.push(['save']); },
    restore() { operations.push(['restore']); },
    fillRect(...args) { operations.push(['fillRect', ...args]); },
    clearRect(...args) { operations.push(['clearRect', ...args]); },
    strokeRect(...args) { operations.push(['strokeRect', ...args]); },
    beginPath() { operations.push(['beginPath']); },
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    stroke() { operations.push(['stroke']); },
    fill() { operations.push(['fill']); },
    arc(...args) { operations.push(['arc', ...args]); },
    fillText(...args) { operations.push(['fillText', ...args]); },
    setLineDash(...args) { operations.push(['setLineDash', ...args]); },
    translate(...args) { operations.push(['translate', ...args]); },
    rotate(...args) { operations.push(['rotate', ...args]); },
  };
  return context;
}

// Keep THREE referenced in the test module for environments that tree-shake imports.
assert.ok(THREE.WebGLRenderTarget);
