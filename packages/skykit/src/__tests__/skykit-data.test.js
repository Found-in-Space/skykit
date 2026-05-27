import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatStarLabel,
  loadStarLabels,
  loadStarRows,
  rowsFromStarCells,
  streamStarRows,
} from '../data.js';

test('rowsFromStarCells converts cells to plain app rows', () => {
  const rows = rowsFromStarCells([createCell()], {
    observerPc: { x: 0, y: 0, z: 0 },
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].positionPc, { x: 1, y: 2, z: 2 });
  assert.equal(rows[0].distancePc, 3);
  assert.equal(rows[0].apparentMagnitude, 1 + 5 * (Math.log10(3) - 1));
  assert.equal(rows[0].temperatureK, 5800);
  assert.deepEqual(rows[0].ref, {
    datasetId: 'dataset-a',
    level: 1,
    mortonCode: '2',
    ordinal: 0,
  });
});

test('loadStarRows streams provider cells, filters visible rows, and respects maxStars', async () => {
  const provider = createProvider();
  const rows = await loadStarRows({
    provider,
    limitingMagnitude: 4,
    maxStars: 1,
    sortBy: 'distancePc',
  });

  assert.equal(provider.disposed, false);
  assert.equal(provider.streamOptions.length, 1);
  assert.deepEqual(provider.streamOptions[0].view.observerPc, { x: 0, y: 0, z: 0 });
  assert.deepEqual(provider.streamOptions[0].attributes, ['position', 'magAbs', 'teffLog8', 'objectRef']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ordinal, 0);
});

test('streamStarRows yields row batches without exposing cell deltas', async () => {
  const batches = [];
  for await (const rows of streamStarRows({
    provider: createProvider(),
    limitingMagnitude: 99,
  })) {
    batches.push(rows);
  }

  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
});

test('loadStarLabels formats metadata labels for rows', async () => {
  const [row] = rowsFromStarCells([createCell()]);
  const labels = await loadStarLabels([row], {
    metaProvider: {
      async getMeta(ref) {
        assert.equal(ref.ordinal, 0);
        return { proper_name: 'Sol', hip_id: 0 };
      },
      dispose() {
        throw new Error('caller-owned meta providers are not disposed');
      },
    },
  });

  assert.equal(labels.length, 1);
  assert.equal(labels[0].label, 'Sol');
  assert.equal(formatStarLabel(null, 'Fallback'), 'Fallback');
});

function createCell() {
  return {
    cellKey: '1:2',
    cell: { level: 1, mortonCode: '2' },
    bounds: {
      centerPc: { x: 0, y: 0, z: 0 },
      halfSizePc: 1,
      gridX: 0,
      gridY: 0,
      gridZ: 0,
    },
    count: 2,
    coordinates: {
      name: 'position',
      frame: 'icrs',
      units: ['pc', 'pc', 'pc'],
      components: new Float32Array([
        1, 2, 2,
        20, 0, 0,
      ]),
    },
    attributes: {
      magAbs: new Float32Array([1, 9]),
      teffLog8: new Uint8Array([255, 0]),
    },
    refs: [
      { datasetId: 'dataset-a', level: 1, mortonCode: '2', ordinal: 0 },
      { datasetId: 'dataset-a', level: 1, mortonCode: '2', ordinal: 1 },
    ],
  };
}

function createProvider() {
  return {
    disposed: false,
    streamOptions: [],
    async *streamCells(options) {
      this.streamOptions.push(options);
      yield {
        type: 'stars/cells-upsert',
        cells: [createCell()],
      };
      yield {
        type: 'stars/current',
        cellKeys: ['1:2'],
        starCount: 2,
      };
    },
    dispose() {
      this.disposed = true;
    },
  };
}
