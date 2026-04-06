import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeMorton3D,
  encodeMorton3D,
  fromStarDataId,
  parseStarDataId,
  serializeStarDataId,
  toStarDataId,
} from '../star-data-id.js';

const DATASET_UUID = 'c56103e6-ad4c-41f9-be06-048b48ec632b';

test('encodeMorton3D/decodeMorton3D round trip for several coordinates', () => {
  const cases = [
    { gridX: 0, gridY: 0, gridZ: 0, level: 0 },
    { gridX: 1, gridY: 2, gridZ: 3, level: 2 },
    { gridX: 8, gridY: 1, gridZ: 15, level: 4 },
    { gridX: 123, gridY: 456, gridZ: 789, level: 10 },
    { gridX: 2 ** 21 - 1, gridY: 0, gridZ: 2 ** 20, level: 21 },
  ];

  for (const value of cases) {
    const morton = encodeMorton3D(value.gridX, value.gridY, value.gridZ, value.level);
    const decoded = decodeMorton3D(morton, value.level);
    assert.deepEqual(decoded, {
      gridX: value.gridX,
      gridY: value.gridY,
      gridZ: value.gridZ,
    });
  }
});

test('encodeMorton3D rejects out-of-range coordinates', () => {
  assert.throws(() => encodeMorton3D(4, 0, 0, 2), /gridX/);
  assert.throws(() => encodeMorton3D(0, -1, 0, 2), /gridY/);
  assert.throws(() => encodeMorton3D(0, 0, 0, 22), /level/);
});

test('toStarDataId converts pick metadata to canonical id', () => {
  const starDataId = toStarDataId(
    {
      level: 4,
      gridX: 3,
      gridY: 9,
      gridZ: 12,
      ordinal: 7,
    },
    { datasetUuid: DATASET_UUID },
  );

  assert.deepEqual(starDataId, {
    version: 1,
    datasetUuid: DATASET_UUID,
    level: 4,
    mortonCode: encodeMorton3D(3, 9, 12, 4).toString(10),
    ordinal: 7,
  });
});

test('fromStarDataId validates strict bounds and uuid format', () => {
  const valid = fromStarDataId({
    datasetUuid: DATASET_UUID,
    level: 3,
    mortonCode: encodeMorton3D(4, 2, 6, 3),
    ordinal: '2',
  });

  assert.deepEqual(valid, {
    version: 1,
    datasetUuid: DATASET_UUID,
    level: 3,
    mortonCode: encodeMorton3D(4, 2, 6, 3).toString(10),
    ordinal: 2,
  });

  assert.throws(() => fromStarDataId({
    datasetUuid: 'derived-render-1234',
    level: 3,
    mortonCode: '1',
    ordinal: 0,
  }), /UUID/);

  assert.throws(() => fromStarDataId({
    datasetUuid: DATASET_UUID,
    level: 2,
    mortonCode: encodeMorton3D(7, 7, 7, 3),
    ordinal: 0,
  }), /maximum value for level 2/);
});

test('serializeStarDataId and parseStarDataId are stable round trips', () => {
  const canonical = {
    version: 1,
    datasetUuid: DATASET_UUID,
    level: 8,
    mortonCode: encodeMorton3D(201, 31, 144, 8).toString(10),
    ordinal: 999,
  };

  const serialized = serializeStarDataId(canonical);
  assert.equal(serialized, 'sdi1.c56103e6-ad4c-41f9-be06-048b48ec632b.8.6exeb.rr');

  const parsed = parseStarDataId(serialized);
  assert.deepEqual(parsed, canonical);
});

test('parseStarDataId rejects malformed strings', () => {
  assert.throws(() => parseStarDataId('not-an-id'), /5 dot-separated/);
  assert.throws(() => parseStarDataId('v1.c56103e6-ad4c-41f9-be06-048b48ec632b.1.1.1'), /version token/);
  assert.throws(() => parseStarDataId('sdi1.c56103e6-ad4c-41f9-be06-048b48ec632b.-.1.1'), /base36 token/);
});
