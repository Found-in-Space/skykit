import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apparentMagnitude,
  consumeStarCellDeltas,
  createStarCellData,
  createStarCellKey,
  createStarCellStore,
  decodeMorton3D,
  decodeTemperatureK,
  encodeMorton3D,
  estimateStarCellBytes,
  parseStarCellKey,
  supportsTransferableBuffers,
  temperatureToRgb,
} from '../index.js';

test('createStarCellData builds typed cell arrays and metadata', () => {
  const node = createNode({ centerX: 10, centerY: 20, centerZ: 30 });
  const cell = createStarCellData({
    node,
    decoded: {
      count: 2,
      positionsPc: new Float32Array([1, 2, 3, 4, 5, 6]),
      teffLog8: new Uint8Array([100, 120]),
      magAbs: new Float32Array([1.5, 2.5]),
    },
    datasetId: 'dataset-a',
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });

  assert.equal(cell.cellKey, createStarCellKey(node));
  assert.deepEqual(cell.cell, { level: node.level, mortonCode: node.mortonCode });
  assert.deepEqual(Array.from(cell.coordinates.components), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Array.from(cell.attributes.teffLog8), [100, 120]);
  assert.deepEqual(Array.from(cell.attributes.magAbs), [1.5, 2.5]);
  assert.equal(cell.bounds.centerPc.x, node.centerX);
  assert.equal(cell.bounds.gridZ, node.gridZ);
  assert.equal(cell.refs?.[1].datasetId, 'dataset-a');
  assert.equal(cell.refs?.[1].ordinal, 1);
  assert.equal(cell.pickMeta?.[1].cellKey, cell.cellKey);
  assert.equal(cell.pickMeta?.[1].gridZ, node.gridZ);
  assert.equal(estimateStarCellBytes(cell), 34);
});

test('createStarCellData omits unrequested attributes', () => {
  const cell = createStarCellData({
    node: createNode(),
    decoded: {
      count: 1,
      positionsPc: new Float32Array([1, 2, 3]),
      teffLog8: new Uint8Array([100]),
      magAbs: new Float32Array([1.5]),
    },
    attributes: ['position'],
  });

  assert.equal(cell.attributes.teffLog8, undefined);
  assert.equal(cell.attributes.magAbs, undefined);
  assert.equal(cell.pickMeta, undefined);
  assert.equal(cell.refs, undefined);
  assert.equal(estimateStarCellBytes(cell), 12);
});

test('createStarCellData applies coordinate transforms during packing', () => {
  const cell = createStarCellData({
    node: createNode(),
    decoded: {
      count: 1,
      positionsPc: new Float32Array([10, 20, 30]),
    },
    attributes: ['position'],
    coordinates: {
      name: 'render-position',
      units: ['render', 'render', 'render'],
      transformPosition({ xPc, yPc, zPc }) {
        return {
          x: xPc * 0.001,
          y: yPc * 0.001 + 1,
          z: -zPc * 0.001,
        };
      },
    },
  });

  assert.equal(cell.coordinates.name, 'render-position');
  assert.deepEqual(cell.coordinates.units, ['render', 'render', 'render']);
  assertFloatArrayClose(cell.coordinates.components, [0.01, 1.02, -0.03]);
});

test('createStarCellData supports transfer ownership when available', () => {
  if (!supportsTransferableBuffers()) {
    return;
  }

  const cell = createStarCellData({
    node: createNode(),
    decoded: {
      count: 1,
      positionsPc: new Float32Array([1, 2, 3]),
      teffLog8: new Uint8Array([120]),
    },
    attributes: ['position', 'teffLog8'],
    memoryOwnership: 'transfer',
  });

  assert.deepEqual(Array.from(cell.coordinates.components), [1, 2, 3]);
  assert.deepEqual(Array.from(cell.attributes.teffLog8), [120]);
});

test('createStarCellStore applies cell deltas and exposes star helpers', async () => {
  const store = createStarCellStore();
  const cell = createStarCellData({
    node: createNode(),
    decoded: {
      count: 2,
      positionsPc: new Float32Array([1, 2, 3, 4, 5, 6]),
      teffLog8: new Uint8Array([100, 120]),
      magAbs: new Float32Array([1.5, 2.5]),
      refs: [
        { datasetId: 'dataset-a', level: 2, mortonCode: '53', ordinal: 0 },
        { datasetId: 'dataset-a', level: 2, mortonCode: '53', ordinal: 1 },
      ],
    },
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });

  const result = await consumeStarCellDeltas(createDeltas([
    { type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cell] },
    {
      type: 'stars/current',
      providerId: 'provider-a',
      demandRevision: 1,
      cellKeys: [cell.cellKey],
      starCount: 2,
    },
  ]), store, { stopOnCurrent: true });

  assert.equal(result.stoppedOn, 'current');
  assert.equal(store.getStarCount(), 2);
  assert.equal(store.getObjectRef(cell.cellKey, 1)?.ordinal, 1);
  assert.equal(store.getPickMeta(cell.cellKey, 1)?.gridZ, 3);
  assert.equal(store.getSnapshot().starCount, 2);
  assert.equal(store.getSnapshot().cellCount, 1);

  const rows = Array.from(store.stars());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].position, { x: 4, y: 5, z: 6 });
  assert.equal(rows[1].teffLog8, 120);
  assert.equal(rows[1].magAbs, 2.5);
  assert.equal(rows[1].cellKey, cell.cellKey);

  store.apply({
    type: 'stars/cells-remove',
    providerId: 'provider-a',
    cellKeys: [cell.cellKey],
  });
  assert.equal(store.getStarCount(), 0);
});

test('cell identity helpers round-trip through Morton cell keys', () => {
  const mortonCode = encodeMorton3D(5, 2, 7, 3);
  const cellKey = createStarCellKey(3, mortonCode);
  const cell = parseStarCellKey(cellKey);

  assert.equal(cellKey, '3:373');
  assert.deepEqual(cell, { level: 3, mortonCode: '373' });
  assert.deepEqual(decodeMorton3D(cell.mortonCode, cell.level), {
    gridX: 5,
    gridY: 2,
    gridZ: 7,
  });

  const objectRef = {
    datasetId: 'dataset-a',
    level: cell.level,
    mortonCode: cell.mortonCode,
    ordinal: 9,
  };
  assert.equal(createStarCellKey(objectRef), cellKey);
});

test('star math helpers compute apparent magnitude, temperatures, and colors', () => {
  assert.equal(apparentMagnitude({ magAbs: 5, distancePc: 10 }), 5);
  assert.equal(decodeTemperatureK(255), 5800);

  const cool = decodeTemperatureK(0);
  const hot = decodeTemperatureK(200);
  assert.ok(cool < hot);

  const rgb = temperatureToRgb(5800, { input: 'kelvin' });
  assert.equal(rgb.length, 3);
  assert.ok(rgb.every((channel) => channel >= 0 && channel <= 255));
});

function createNode(overrides = {}) {
  const node = {
    centerX: 1,
    centerY: 2,
    centerZ: 3,
    halfSize: 0.5,
    level: 2,
    gridX: 1,
    gridY: 2,
    gridZ: 3,
    ...overrides,
  };
  return {
    ...node,
    mortonCode: String(
      overrides.mortonCode ?? encodeMorton3D(
        node.gridX,
        node.gridY,
        node.gridZ,
        node.level,
      ),
    ),
  };
}

function assertFloatArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);

  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(Math.abs(actual[index] - expected[index]) < 1e-6, true);
  }
}

async function* createDeltas(deltas) {
  for (const delta of deltas) {
    yield delta;
  }
}
