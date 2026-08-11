import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  concatBytes,
  createOdscDescriptorBytes,
  createShardBytes,
  createShardNodeRecord,
  createStarHeaderBytes,
  DESCRIPTOR_SIZE,
  HEADER_SIZE,
} from '../../../../packages/star-octree-provider/src/__tests__/octree-byte-fixtures.js';
import {
  createOctreeSamplePoints,
  runOctreeFormatSuite,
} from '../suite.js';

const HAS_PAYLOAD = 0x01;
const IS_TERMINAL = 0x08;

test('format suite compares v1 paths with v2 terminal-packed paths', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'skykit-octree-format-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const v1Path = path.join(directory, 'stars-v1.octree');
  const v2Path = path.join(directory, 'stars-v2.octree');
  const v1Shard = createShardBytes({
    version: 1,
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        firstChild: 2,
        childMask: 0b10000000,
        localDepth: 1,
      }),
      createShardNodeRecord({
        flags: HAS_PAYLOAD,
        localDepth: 2,
        localPath: 7,
        payloadOffset: 1_000,
        payloadLength: 40,
      }),
    ],
  });
  const v2Shard = createShardBytes({
    version: 2,
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        flags: HAS_PAYLOAD | IS_TERMINAL,
        localDepth: 1,
        payloadOffset: 1_000,
        payloadLength: 55,
        starCount: 12,
      }),
    ],
  });
  await writeFile(v1Path, createOctreeBytes(1, v1Shard));
  await writeFile(v2Path, createOctreeBytes(2, v2Shard));

  const suite = await runOctreeFormatSuite(
    [
      { label: 'v1', path: v1Path },
      { label: 'v2', path: v2Path },
    ],
    { points: [{ x: 1, y: 1, z: 1 }] },
  );

  assert.equal(suite.results[0].formatVersion, 1);
  assert.equal(suite.results[0].rootShard.nodeRecordBytes, 20);
  assert.equal(suite.results[0].queries.inspectedNodes.total, 2);
  assert.equal(suite.results[0].queries.terminalQueries, 0);
  assert.equal(suite.results[0].queries.knownStarRecords, null);
  assert.equal(suite.results[1].formatVersion, 2);
  assert.equal(suite.results[1].rootShard.nodeRecordBytes, 24);
  assert.equal(suite.results[1].queries.inspectedNodes.total, 1);
  assert.equal(suite.results[1].queries.terminalQueries, 1);
  assert.equal(suite.results[1].queries.knownStarRecords.total, 12);
  assert.equal(suite.comparisons[0].ratios.inspectedNodes, 0.5);
});

test('generated sample points are deterministic and bounded', () => {
  const header = {
    worldCenterX: 10,
    worldCenterY: 20,
    worldCenterZ: 30,
    worldHalfSize: 100,
  };

  const first = createOctreeSamplePoints(header, {
    sampleCount: 4,
    minRadiusPc: 1,
    maxRadiusPc: 10,
  });
  const second = createOctreeSamplePoints(header, {
    sampleCount: 4,
    minRadiusPc: 1,
    maxRadiusPc: 10,
  });

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.ok(first.every((point) => Math.hypot(
    point.x - header.worldCenterX,
    point.y - header.worldCenterY,
    point.z - header.worldCenterZ,
  ) <= 10));
});

function createOctreeBytes(version, shard) {
  return concatBytes([
    createStarHeaderBytes({
      version,
      indexOffset: HEADER_SIZE + DESCRIPTOR_SIZE,
      indexLength: shard.length,
      maxLevel: 1,
    }),
    createOdscDescriptorBytes(),
    shard,
  ]);
}
