import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createStarCellData, encodeMorton3D } from '@found-in-space/star-trees';
import {
  computeThreeStarFieldVisualRadiusPx,
  createThreeStarField,
  createThreeStarFieldGeometryFromCells,
  pickThreeStarFieldData,
} from '../index.js';

test('field starts with one stable aggregate render object', () => {
  const field = createThreeStarField({ materialProfile: createMaterialProfile() });
  const snapshot = field.getSnapshot();

  assert.equal(snapshot.cellCount, 0);
  assert.equal(snapshot.starCount, 0);
  assert.equal(snapshot.renderObjectCount, 1);
  assert.equal(field.object3d.children.length, 1);
  assert.equal(field.object3d.children[0].visible, false);
});

test('cell upserts replace by cellKey and keep one aggregate Points object', () => {
  const field = createThreeStarField({ materialProfile: createMaterialProfile() });
  const points = field.object3d.children[0];
  const cellA = createCell({ keyOrdinal: 1, count: 2 });
  const cellA2 = createCell({ keyOrdinal: 1, count: 1, x: 9 });
  const cellB = createCell({ keyOrdinal: 2, count: 3 });

  field.apply({ type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cellA, cellB] });
  assert.equal(field.getSnapshot().cellCount, 2);
  assert.equal(field.getSnapshot().starCount, 5);
  assert.equal(field.object3d.children[0], points);
  assert.equal(points.visible, true);

  field.apply({ type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cellA2] });
  assert.equal(field.getSnapshot().cellCount, 2);
  assert.equal(field.getSnapshot().starCount, 4);
  assert.equal(field.object3d.children[0], points);

  field.apply({ type: 'stars/cells-remove', providerId: 'provider-a', cellKeys: [cellB.cellKey] });
  assert.equal(field.getSnapshot().cellCount, 1);
  assert.equal(field.getSnapshot().starCount, 1);
});

test('field hides aggregate render objects while there are no drawable stars', () => {
  const field = createThreeStarField({ materialProfile: createMaterialProfile({ halo: true }) });
  const points = field.object3d.children[0];
  const halo = field.object3d.children[1];
  const cell = createCell({ keyOrdinal: 1, count: 2 });

  assert.equal(points.visible, false);
  assert.equal(halo.visible, false);

  field.apply({ type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cell] });
  assert.equal(points.visible, true);
  assert.equal(halo.visible, true);

  field.setView({ halo: false });
  assert.equal(points.visible, true);
  assert.equal(halo.visible, false);

  field.clear();
  assert.equal(points.visible, false);
  assert.equal(halo.visible, false);
});

test('current and error deltas update status without deleting visible cells', () => {
  const field = createThreeStarField({ materialProfile: createMaterialProfile() });
  const cell = createCell({ keyOrdinal: 1 });

  field.apply({ type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cell] });
  field.apply({
    type: 'stars/current',
    providerId: 'provider-a',
    viewRevision: 2,
    demandRevision: 3,
    cellKeys: [cell.cellKey],
    starCount: cell.count,
  });
  assert.equal(field.getSnapshot().status, 'current');

  field.apply({
    type: 'stars/error',
    providerId: 'provider-a',
    demandRevision: 4,
    error: { message: 'boom' },
  });
  assert.equal(field.getSnapshot().status, 'failed');
  assert.equal(field.getSnapshot().starCount, cell.count);
});

test('aggregate geometry is deterministic by cellKey', () => {
  const cellB = createCell({ keyOrdinal: 2, x: 20 });
  const cellA = createCell({ keyOrdinal: 1, x: 10 });
  const geometry = createThreeStarFieldGeometryFromCells([cellB, cellA]);

  assert.deepEqual(
    Array.from(geometry.getAttribute('position').array).slice(0, 6),
    [10, 0, 0, 20, 0, 0],
  );
  assert.equal(geometry.drawRange.count, 2);
});

test('custom vertex attributes update by cell and survive geometry rebuilds', () => {
  const field = createThreeStarField({
    materialProfile: createMaterialProfile(),
    vertexAttributes: [{ name: 'duplicateRole', type: 'uint8' }],
  });
  const points = field.object3d.children[0];
  const cellA = createCell({ keyOrdinal: 1, count: 2 });
  const cellB = createCell({ keyOrdinal: 2, count: 1 });

  field.setCells([cellB, cellA]);
  assert.deepEqual(
    Array.from(points.geometry.getAttribute('duplicateRole').array),
    [0, 0, 0],
  );
  assert.equal(
    field.setCellVertexAttribute(cellA.cellKey, 'duplicateRole', new Uint8Array([1, 2])),
    true,
  );
  assert.deepEqual(
    Array.from(points.geometry.getAttribute('duplicateRole').array),
    [1, 2, 0],
  );

  field.apply({
    type: 'stars/cells-upsert',
    providerId: 'provider-a',
    cells: [createCell({ keyOrdinal: 2, count: 1, x: 20 })],
  });
  assert.deepEqual(
    Array.from(points.geometry.getAttribute('duplicateRole').array),
    [1, 2, 0],
  );
  assert.equal(field.setCellVertexAttribute('missing', 'duplicateRole', new Uint8Array()), false);
  assert.throws(
    () => field.setCellVertexAttribute(cellA.cellKey, 'duplicateRole', new Uint8Array([1])),
    /requires 2 values/,
  );

  field.dispose();
});

test('field exposes visible bounds in render and parsec units', () => {
  const field = createThreeStarField({
    coordinateUnitsPerParsec: 2,
    materialProfile: createMaterialProfile(),
  });
  field.setCells([
    createCell({ keyOrdinal: 1, count: 2, x: 20 }),
    createCell({ keyOrdinal: 2, count: 1, x: -4 }),
  ]);

  assert.deepEqual(field.getVisibleBounds({ units: 'render' }), {
    units: 'render',
    coordinateUnitsPerParsec: 2,
    starCount: 3,
    min: { x: -4, y: 0, z: 0 },
    max: { x: 21, y: 0, z: 0 },
  });
  assert.deepEqual(field.getVisibleBounds({ units: 'parsec' }), {
    units: 'parsec',
    coordinateUnitsPerParsec: 2,
    starCount: 3,
    min: { x: -2, y: 0, z: 0 },
    max: { x: 10.5, y: 0, z: 0 },
  });

  field.clear();
  assert.equal(field.getVisibleBounds(), null);
});

test('picking returns cell identity and object metadata', () => {
  const cell = createCell({ keyOrdinal: 3, x: 10, refs: true });
  const result = pickThreeStarFieldData(
    new THREE.Ray(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)),
    {
      cells: [cell],
      view: {
        limitingMagnitude: 20,
        coordinateUnitsPerParsec: 1,
      },
    },
  );

  assert.equal(result?.cellKey, cell.cellKey);
  assert.equal(result?.objectRef?.ordinal, 0);
});

test('visual radius helper still computes finite sizes', () => {
  const radius = computeThreeStarFieldVisualRadiusPx({
    apparentMagnitude: 3,
    limitingMagnitude: 6.5,
  });
  assert.ok(radius > 0);
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
  const count = options.count ?? 1;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (options.x ?? keyOrdinal) + index;
  }
  return createStarCellData({
    node,
    decoded: {
      count,
      positionsPc: positions,
      teffLog8: new Uint8Array(count).fill(128),
      magAbs: new Float32Array(count).fill(1),
    },
    datasetId: 'dataset-a',
    attributes: [
      'position',
      'teffLog8',
      'magAbs',
      ...(options.refs ? ['objectRef', 'pickMeta'] : []),
    ],
  });
}

function createMaterialProfile(options = {}) {
  const material = new THREE.PointsMaterial();
  const haloMaterial = options.halo ? new THREE.PointsMaterial() : null;
  return {
    material,
    haloMaterial,
    updateUniforms() {},
    dispose() {
      material.dispose();
      haloMaterial?.dispose();
    },
  };
}
