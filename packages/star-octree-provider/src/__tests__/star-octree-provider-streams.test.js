import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { createStarCellKey } from '@found-in-space/star-trees';
import {
  createStarOctreeFileProviderService,
  createStarOctreeProviderService,
} from '../index.js';
import { STAR_HAS_PAYLOAD } from '../star-octree-format.js';
import {
  concatBytes,
  createMockFetch,
  createOdscDescriptorBytes,
  createShardBytes,
  createShardNodeRecord,
  createStarHeaderBytes,
  DESCRIPTOR_SIZE,
  HEADER_SIZE,
  SHARD_HEADER_SIZE,
  SHARD_NODE_SIZE,
  toArrayBuffer,
} from './octree-byte-fixtures.js';

test('streamPayloads emits provider-selected decompressed payload batches', async () => {
  const fixture = createObjectStreamFixture();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, requests);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
      limits: {
        payloadMaxGapBytes: 64,
        payloadMaxBatchBytes: 1024,
      },
    });
    const events = [];

    for await (const event of provider.streamPayloads({
      id: 'payload-stream',
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
      },
    })) {
      events.push(event);
    }

    const batch = events.find((event) => event.type === 'payload/batch');
    const progress = events.find((event) => event.type === 'payload/progress');
    const complete = events.at(-1);

    assert.equal(batch.entries.length, 2);
    assert.deepEqual(
      [...new Uint8Array(batch.entries[0].buffer)],
      [...new Uint8Array(fixture.payloadA)],
    );
    assert.deepEqual(
      [...new Uint8Array(batch.entries[1].buffer)],
      [...new Uint8Array(fixture.payloadB)],
    );
    assert.equal(progress.loadedNodes, 2);
    assert.equal(complete.type, 'payload/complete');
    assert.equal(provider.getSnapshot().stats.payloadBatchRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCells emits independent cell deltas and a complete current set', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const deltas = [];

    for await (const delta of provider.streamCells({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
      attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
    })) {
      deltas.push(delta);
    }

    const upserts = deltas.filter((delta) => delta.type === 'stars/cells-upsert');
    const current = deltas.at(-1);
    const cells = upserts.flatMap((delta) => delta.cells);

    assert.equal(upserts.length, 1);
    assert.deepEqual(cells.map((cell) => cell.cellKey), fixture.payloadNodeKeys);
    assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), 3);
    assert.deepEqual(
      cells.flatMap((cell) => Array.from(cell.attributes.teffLog8)),
      [128, 222, 64],
    );
    assert.equal(cells.flatMap((cell) => cell.refs).length, 3);
    assert.equal(current.type, 'stars/current');
    assert.deepEqual(current.cellKeys, fixture.payloadNodeKeys);
    assert.equal(current.starCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCells with position-only attributes avoids optional decoded columns', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const deltas = [];

    for await (const delta of provider.streamCells({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
      attributes: ['position'],
    })) {
      deltas.push(delta);
    }

    const cells = deltas
      .filter((delta) => delta.type === 'stars/cells-upsert')
      .flatMap((delta) => delta.cells);
    const snapshot = provider.getSnapshot();

    assert.equal(cells.length, 2);
    assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), 3);
    assert.equal(cells.every((cell) => cell.attributes.teffLog8 === undefined), true);
    assert.equal(cells.every((cell) => cell.attributes.magAbs === undefined), true);
    assert.equal(cells.every((cell) => cell.refs === undefined), true);
    assert.equal(cells.every((cell) => cell.pickMeta === undefined), true);
    assert.equal(snapshot.stats.decodedCacheWritesByMask.p, 2);
    assert.equal(snapshot.stats.cellGeneratedRefs, 0);
    assert.equal(snapshot.stats.cellGeneratedPickMeta, 0);
    assert.equal(snapshot.stats.cellCopiedBytes, 0);
    assert.equal(snapshot.stats.cellBorrowedBytes, 36);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchCells returns decoded cell records', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const cells = await provider.fetchCells({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
    });

    assert.deepEqual(cells.map((cell) => cell.cellKey), fixture.payloadNodeKeys);
    assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), 3);
    assert.deepEqual(
      cells.flatMap((cell) => Array.from(cell.attributes.teffLog8)),
      [128, 222, 64],
    );
    assertFloatArrayClose(
      new Float32Array(cells.flatMap((cell) => Array.from(cell.attributes.magAbs))),
      [4.25, -1.46, 6.1],
    );
    assert.equal(provider.getSnapshot().stats.decodedCacheWritesByMask['p+t+m'], 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamCells applies coordinate transforms per cell', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const deltas = [];

    for await (const delta of provider.streamCells({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
      coordinates: {
        name: 'render-position',
        units: ['render', 'render', 'render'],
        transformPosition({ xPc, yPc, zPc }) {
          return [xPc * 0.001, yPc * 0.001, zPc * 0.001];
        },
      },
    })) {
      deltas.push(delta);
    }

    const cell = deltas.find((delta) => delta.type === 'stars/cells-upsert').cells[0];
    assert.equal(cell.coordinates.name, 'render-position');
    assert.equal(cell.coordinates.units[0], 'render');
    assert.ok(Math.abs(cell.coordinates.components[0] - -0.05) < 1e-6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('file provider streams cell batches without URL cache economics', async () => {
  const fixture = createObjectStreamFixture();
  const provider = createStarOctreeFileProviderService({
    id: 'file-provider',
    file: new Blob([fixture.fileBytes], { type: 'application/octet-stream' }),
  });
  const deltas = [];

  for await (const delta of provider.streamCells({
    view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
  })) {
    deltas.push(delta);
  }

  const cells = deltas
    .filter((delta) => delta.type === 'stars/cells-upsert')
    .flatMap((delta) => delta.cells);
  const snapshot = provider.getSnapshot();

  assert.equal(cells.length, 2);
  assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), 3);
  assert.equal(snapshot.dataset.url, null);
  assert.equal(snapshot.stats.rangeRequests > 0, true);
  assert.equal(provider.describe().capabilities.persistentCache, false);
});

function createObjectStreamFixture() {
  const payloadA = createPayloadBytes([
    { local: [0, 0, 0], magAbs: 4.25, teffLog8: 128 },
    { local: [1, 0, 0], magAbs: -1.46, teffLog8: 222 },
  ]);
  const payloadB = createPayloadBytes([
    { local: [0, 0, 0], magAbs: 6.1, teffLog8: 64 },
  ]);
  const compressedA = gzipSync(payloadA);
  const compressedB = gzipSync(payloadB);
  const gap = new Uint8Array(24);
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const shardLength = SHARD_HEADER_SIZE + 3 * SHARD_NODE_SIZE;
  const payloadOffsetA = indexOffset + shardLength;
  const payloadOffsetB = payloadOffsetA + compressedA.length + gap.length;
  const rootShard = createShardBytes({
    entryNodes: [1, 0, 0, 0, 0, 0, 0, 0],
    nodes: [
      createShardNodeRecord({
        firstChild: 2,
        childMask: 0b00000011,
        localDepth: 1,
        localPath: 0,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 2,
        localPath: 0,
        payloadOffset: payloadOffsetA,
        payloadLength: compressedA.length,
      }),
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD,
        localDepth: 2,
        localPath: 1,
        payloadOffset: payloadOffsetB,
        payloadLength: compressedB.length,
      }),
    ],
  });
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset,
      indexLength: rootShard.length,
      worldHalfSize: 100,
      magLimit: 6.5,
    }),
    createOdscDescriptorBytes({
      datasetUuid: 'c56103e6-ad4c-41f9-be06-048b48ec632b',
    }),
    rootShard,
    compressedA,
    gap,
    compressedB,
  ]);
  const runtimeNodes = [
    createRuntimeNode({
      centerX: -50,
      centerY: -50,
      centerZ: -50,
      halfSize: 25,
      level: 1,
      gridX: 0,
      mortonCode: '0',
      payloadOffset: payloadOffsetA,
      payloadLength: compressedA.length,
    }),
    createRuntimeNode({
      centerX: 50,
      centerY: -50,
      centerZ: -50,
      halfSize: 25,
      level: 1,
      gridX: 1,
      mortonCode: '1',
      payloadOffset: payloadOffsetB,
      payloadLength: compressedB.length,
      nodeIndex: 3,
    }),
  ];

  return {
    fileBytes,
    payloadA,
    payloadB,
    runtimeNodes,
    payloadNodeKeys: runtimeNodes.map(createStarCellKey),
  };
}

function createRuntimeNode(overrides) {
  return {
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 1,
    level: 2,
    mortonCode: '0',
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    flags: STAR_HAS_PAYLOAD,
    childMask: 0,
    payloadOffset: 0,
    payloadLength: 0,
    firstChild: 0,
    localDepth: 2,
    localPath: 0,
    shardOffset: 192,
    nodeIndex: 2,
    ...overrides,
  };
}

function createPayloadBytes(records) {
  const bytes = new Uint8Array(records.length * 16);
  const view = new DataView(bytes.buffer);

  records.forEach((record, index) => {
    const offset = index * 16;
    view.setFloat32(offset, record.local[0], true);
    view.setFloat32(offset + 4, record.local[1], true);
    view.setFloat32(offset + 8, record.local[2], true);
    view.setInt16(offset + 12, Math.round(record.magAbs * 100), true);
    view.setUint8(offset + 14, record.teffLog8);
  });

  return toArrayBuffer(bytes);
}

function assertFloatArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);

  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(Math.abs(actual[index] - expected[index]) < 1e-6, true);
  }
}
