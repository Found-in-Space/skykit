import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approachTargetFromObserver,
  buildSimbadBasicSearch,
  createSelectionResultFromCell,
  findSelectionResultInCells,
  icrsTargetFromRaDecDistance,
  parseIcrsCoordinatesFromSearchParams,
  parseStarRefBookmark,
  readSelectionMarkerFromUrl,
  serializeStarRefBookmark,
  writeSelectionMarkerToUrl,
} from '../free-roam-console-helpers.js';

test('star ref bookmarks serialize and parse URL-safe logical refs', () => {
  const ref = { datasetId: 'gaia:dr3', level: 4, mortonCode: 12345n, ordinal: 9 };
  const bookmark = serializeStarRefBookmark(ref);

  assert.equal(bookmark, 'gaia%3Adr3:4:12345:9');
  assert.deepEqual(parseStarRefBookmark(bookmark), {
    datasetId: 'gaia:dr3',
    level: 4,
    mortonCode: '12345',
    ordinal: 9,
  });
  assert.deepEqual(readSelectionMarkerFromUrl(`https://example.test/?star=${bookmark}`), {
    kind: 'bookmark',
    bookmarkId: bookmark,
    ref: {
      datasetId: 'gaia:dr3',
      level: 4,
      mortonCode: '12345',
      ordinal: 9,
    },
  });
  assert.equal(parseStarRefBookmark('bad'), null);
  assert.equal(serializeStarRefBookmark({ datasetId: 'x', level: 1, mortonCode: '-1', ordinal: 0 }), null);
});

test('ICRS deep links parse, prefer packed coordinates, and write compact URL state', () => {
  const params = new URLSearchParams('x=9&y=8&z=7&icrs=1.25,-2,3.5');
  assert.deepEqual(parseIcrsCoordinatesFromSearchParams(params), { x: 1.25, y: -2, z: 3.5 });
  assert.deepEqual(readSelectionMarkerFromUrl('https://example.test/?x=9&y=8&z=7'), {
    kind: 'icrs',
    icrsPc: { x: 9, y: 8, z: 7 },
  });
  assert.equal(parseIcrsCoordinatesFromSearchParams(new URLSearchParams('icrs=,,,')), null);

  const next = writeSelectionMarkerToUrl(
    { kind: 'icrs', icrsPc: { x: 1.23456789, y: -2, z: 3 } },
    'https://example.test/view?star=old&x=9',
  );
  assert.equal(next, 'https://example.test/view?icrs=1.234568%2C-2%2C3');
});

test('RA, Dec, and distance input resolves sexagesimal and decimal coordinates', () => {
  const result = icrsTargetFromRaDecDistance('05h 35m 17.3s', '-05 23 28', '642');
  assert.ok(Math.abs(result.raDeg - 83.82208333333334) < 1e-9);
  assert.ok(Math.abs(result.decDeg + 5.391111111111112) < 1e-9);
  assert.ok(Math.abs(Math.hypot(result.targetPc.x, result.targetPc.y, result.targetPc.z) - 642) < 1e-9);

  const decimal = icrsTargetFromRaDecDistance('83.82208333333334deg', '-5.391111111111112', '10');
  assert.ok(Math.abs(Math.hypot(decimal.targetPc.x, decimal.targetPc.y, decimal.targetPc.z) - 10) < 1e-9);
  assert.throws(() => icrsTargetFromRaDecDistance('bad', '0', '1'), /RA must/);
  assert.throws(() => icrsTargetFromRaDecDistance('0', 'bad', '1'), /Dec must/);
  assert.throws(() => icrsTargetFromRaDecDistance('0', '0', '-1'), /Distance must/);
});

test('SIMBAD helper keeps old HIP-before-Gaia link selection', () => {
  const hip = buildSimbadBasicSearch({ hip: '26221', gaia: '3017367152277675776' });
  assert.equal(hip.label, 'HIP 26221');
  assert.equal(new URL(hip.url).searchParams.get('Ident'), 'HIP 26221');

  const gaia = buildSimbadBasicSearch({ gaia: '3017367152277675776' });
  assert.equal(gaia.label, 'Gaia DR3 3017367152277675776');
  assert.equal(buildSimbadBasicSearch({ hd: '39801' }), null);
});

test('selection restore helpers find stars in loaded cells and compute approach targets', () => {
  const ref = { datasetId: 'dataset-a', level: 2, mortonCode: '53', ordinal: 1 };
  const cell = {
    cellKey: '2:53',
    count: 2,
    coordinates: { components: new Float32Array([1, 2, 3, 4, 5, 6]) },
    attributes: {
      magAbs: new Float32Array([5, 1]),
      teffLog8: new Uint8Array([100, 120]),
    },
    refs: [
      { datasetId: 'dataset-a', level: 2, mortonCode: '53', ordinal: 0 },
      ref,
    ],
    pickMeta: [
      { cellKey: '2:53', level: 2, mortonCode: '53', ordinal: 0 },
      { cellKey: '2:53', level: 2, mortonCode: '53', ordinal: 1 },
    ],
  };
  const view = { coordinateUnitsPerParsec: 0.5, observerPc: { x: 0, y: 0, z: 0 } };
  const result = findSelectionResultInCells([cell], ref, view);

  assert.deepEqual(result.targetPc, { x: 8, y: 10, z: 12 });
  assert.equal(result.objectRef, ref);
  assert.equal(createSelectionResultFromCell(cell, 3, view), null);
  assert.deepEqual(approachTargetFromObserver({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2), {
    x: 8,
    y: 0,
    z: 0,
  });
  assert.deepEqual(approachTargetFromObserver({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 2), {
    x: 0,
    y: 0,
    z: 0,
  });
});
