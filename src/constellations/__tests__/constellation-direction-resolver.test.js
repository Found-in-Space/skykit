import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConstellationDirectionResolver,
  icrsDirectionToTargetPc,
  toRaDec,
} from '../constellation-direction-resolver.js';

const SIMPLE_MANIFEST = {
  id: 'simple',
  constellations: [
    {
      id: 'ori-id',
      iau: 'Ori',
      common_name: { english: 'Hunter', native: 'Orion' },
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
      common_name: { english: 'Bull', native: 'Taurus' },
      image: {
        size: [100, 100],
        anchors: [
          { pos: [0, 0], direction: [-1, 0, 0] },
          { pos: [100, 0], direction: [-1, -1, 0] },
          { pos: [0, 100], direction: [-1, 0, 1] },
        ],
      },
    },
    {
      id: 'vel-id',
      iau: 'Vel',
      common_name: { english: 'Sails', native: 'Vela' },
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

test('listConstellations includes all manifest entries and art availability', () => {
  const resolver = buildConstellationDirectionResolver(SIMPLE_MANIFEST);
  const list = resolver.listConstellations();

  assert.equal(list.length, 3);
  assert.equal(list[0].iau, 'Ori');
  assert.equal(list[0].hasArt, true);
  assert.ok(list[0].centroidRaDec);
  assert.ok(Array.isArray(list[0].imageUpIcrs));
  assert.ok(list[0].imageUpRaDec);
  assert.ok(Array.isArray(list[0].cornersRaDec));

  assert.equal(list[2].iau, 'Vel');
  assert.equal(list[2].hasArt, false);
  assert.equal(list[2].centroidRaDec, null);
  assert.equal(list[2].imageUpIcrs, null);
  assert.equal(list[2].imageUpRaDec, null);
  assert.equal(list[2].cornersRaDec, null);
});

test('icrsDirectionToTargetPc scales a unit direction from the solar origin', () => {
  const result = icrsDirectionToTargetPc([1, 0, 0], 100);
  assert.ok(result);
  assert.ok(Math.abs(result.x - 100) < 1e-9);
  assert.ok(Math.abs(result.y) < 1e-9);
  assert.ok(Math.abs(result.z) < 1e-9);
});

test('icrsDirectionToTargetPc normalises a non-unit direction', () => {
  const result = icrsDirectionToTargetPc([2, 0, 0], 50);
  assert.ok(result);
  assert.ok(Math.abs(result.x - 50) < 1e-9);
});

test('icrsDirectionToTargetPc offsets from a custom observer position', () => {
  const observer = { x: 10, y: 20, z: 30 };
  const result = icrsDirectionToTargetPc([0, 1, 0], 100, observer);
  assert.ok(result);
  assert.ok(Math.abs(result.x - 10) < 1e-9);
  assert.ok(Math.abs(result.y - 120) < 1e-9);
  assert.ok(Math.abs(result.z - 30) < 1e-9);
});

test('icrsDirectionToTargetPc returns null for invalid inputs', () => {
  assert.equal(icrsDirectionToTargetPc(null, 100), null);
  assert.equal(icrsDirectionToTargetPc([1, 0, 0], -1), null);
  assert.equal(icrsDirectionToTargetPc([1, 0, 0], 0), null);
  assert.equal(icrsDirectionToTargetPc([1, 0, 0], NaN), null);
});

test('getConstellation resolves by iau, id, english name, and native name', () => {
  const resolver = buildConstellationDirectionResolver(SIMPLE_MANIFEST);

  assert.equal(resolver.getConstellation('Ori')?.id, 'ori-id');
  assert.equal(resolver.getConstellation('ori')?.id, 'ori-id');
  assert.equal(resolver.getConstellation('ori-id')?.iau, 'Ori');
  assert.equal(resolver.getConstellation('Hunter')?.iau, 'Ori');
  assert.equal(resolver.getConstellation('Orion')?.iau, 'Ori');
  assert.equal(resolver.getConstellation('unknown'), null);
});
