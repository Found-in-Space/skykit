import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConstellationDirectionResolver,
  toRaDec,
} from '../constellation-direction-resolver.js';

const SIMPLE_MANIFEST = {
  id: 'simple',
  constellations: [
    {
      id: 'ori-id',
      iau: 'Ori',
      image: {
        size: [100, 100],
        anchors: [
          { pos: [0, 0], direction: [1, 0, 0] },
          { pos: [100, 0], direction: [1, 1, 0] },
          { pos: [0, 100], direction: [1, 0, 1] },
        ],
      },
    },
    {
      id: 'tau-id',
      iau: 'Tau',
      image: {
        size: [100, 100],
        anchors: [
          { pos: [0, 0], direction: [-1, 0, 0] },
          { pos: [100, 0], direction: [-1, -1, 0] },
          { pos: [0, 100], direction: [-1, 0, 1] },
        ],
      },
    },
  ],
};

test('resolve returns the inside constellation when a direction falls inside its art quad', () => {
  const resolver = buildConstellationDirectionResolver(SIMPLE_MANIFEST);
  const result = resolver.resolve([1, 0.2, 0.2]);
  assert.equal(result?.iau, 'Ori');
  assert.equal(result?.id, 'ori-id');
});

test('resolve prefers currentIau when multiple quads contain the direction', () => {
  const overlappingManifest = {
    id: 'overlap',
    constellations: [
      {
        id: 'a',
        iau: 'Aaa',
        image: {
          size: [100, 100],
          anchors: [
            { pos: [0, 0], direction: [1, 0, 0] },
            { pos: [100, 0], direction: [1, 1, 0] },
            { pos: [0, 100], direction: [1, 0, 1] },
          ],
        },
      },
      {
        id: 'b',
        iau: 'Bbb',
        image: {
          size: [100, 100],
          anchors: [
            { pos: [0, 0], direction: [1, 0, 0] },
            { pos: [100, 0], direction: [1, 1, 0] },
            { pos: [0, 100], direction: [1, 0, 1] },
          ],
        },
      },
    ],
  };

  const resolver = buildConstellationDirectionResolver(overlappingManifest);
  const result = resolver.resolve([1, 0.2, 0.1], 'Bbb');
  assert.equal(result?.iau, 'Bbb');
});

test('resolve falls back to centroid scoring when no quad contains the direction', () => {
  const resolver = buildConstellationDirectionResolver(SIMPLE_MANIFEST);
  const result = resolver.resolve([0.9, -0.1, 0.0]);
  assert.equal(result?.iau, 'Ori');
});

test('toRaDec converts unit vectors into expected RA/Dec values', () => {
  const ra0 = toRaDec([1, 0, 0]);
  assert.ok(ra0);
  assert.ok(Math.abs(ra0.raDeg - 0) < 1e-9);
  assert.ok(Math.abs(ra0.decDeg - 0) < 1e-9);

  const ra90 = toRaDec([0, 1, 0]);
  assert.ok(Math.abs(ra90.raDeg - 90) < 1e-9);
  assert.ok(Math.abs(ra90.raHours - 6) < 1e-9);

  const dec90 = toRaDec([0, 0, 1]);
  assert.ok(Math.abs(dec90.decDeg - 90) < 1e-9);
});
