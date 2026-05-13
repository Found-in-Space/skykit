import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { createStarOctreeProviderService } from '../index.js';
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
    assert.equal(provider.getSnapshot().stats.payloadNodesFetched, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamPayloads reuses cached decompressed payloads', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });

    for await (const _event of provider.streamPayloads({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
    })) {
      // consume first stream
    }
    const firstSnapshot = provider.getSnapshot();

    for await (const _event of provider.streamPayloads({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
    })) {
      // consume second stream
    }
    const secondSnapshot = provider.getSnapshot();

    assert.equal(secondSnapshot.stats.payloadBatchRequests, firstSnapshot.stats.payloadBatchRequests);
    assert.equal(secondSnapshot.stats.payloadCacheHits, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamObjectBatches emits real non-cumulative object products', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const deltas = [];

    for await (const delta of provider.streamObjectBatches({
      id: 'object-stream',
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
      },
      attributes: ['position', 'magAbs', 'teffLog8', 'objectRef'],
    })) {
      deltas.push(delta);
    }

    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');
    const current = deltas.at(-1);
    const product = upserts[0].product;

    assert.equal(upserts.length, 1);
    assert.equal(product.count, 3);
    assert.equal(product.nodes.length, 2);
    assert.equal(product.coordinates.primary.units[0], 'pc');
    assert.deepEqual(
      Array.from(product.attributes.magAbs.values).map((value) => Math.round(value * 100)),
      [425, -146, 610],
    );
    assert.deepEqual(Array.from(product.attributes.teffLog8.values), [128, 222, 64]);
    assert.equal(product.refs.length, 3);
    assert.equal(current.type, 'data/representation-current');
    assert.equal(current.completeness.loadedObjects, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchObjectBatch returns one complete merged product', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const product = await provider.fetchObjectBatch({
      id: 'fetch-stream',
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
      },
    });

    assert.equal(product.count, 3);
    assert.equal(product.nodes.length, 2);
    assert.equal(product.completeness.phase, 'complete');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('live sessions stream real observer-shell products through deltas', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const session = provider.createSession({ id: 'session-a' });
    const iterator = session.deltas()[Symbol.asyncIterator]();

    const receipt = session.updateView({
      observerPc: { x: 0, y: 0, z: 0 },
      limitingMagnitude: 6.5,
    });
    const deltas = await readUntilCurrent(iterator);
    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');

    assert.equal(receipt.demand, 'queued');
    assert.equal(upserts.length, 2);
    assert.deepEqual(
      upserts.map((delta) => delta.product.nodes[0].nodeKey),
      fixture.payloadNodeKeys,
    );
    assert.equal(deltas.at(-1).type, 'data/representation-current');
    assert.equal(session.getSnapshot().demand.status, 'current');
    assert.equal(session.getSnapshot().demand.currentProductCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamObjectBatches applies coordinate transforms while packing', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });
    const deltas = [];

    for await (const delta of provider.streamObjectBatches({
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
      },
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

    const product = deltas.find((delta) => delta.type === 'data/product-upsert').product;
    const positions = product.coordinates.primary.components;

    assert.equal(product.coordinates.primary.name, 'render-position');
    assert.equal(product.coordinates.primary.units[0], 'render');
    assert.ok(Math.abs(positions[0] - -0.05) < 1e-6);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  return {
    fileBytes,
    payloadA,
    payloadB,
    payloadNodeKeys: [
      `${indexOffset}:2`,
      `${indexOffset}:3`,
    ],
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

async function readUntilCurrent(iterator) {
  const deltas = [];

  for (;;) {
    const result = await Promise.race([
      iterator.next(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for delta.')), 500);
      }),
    ]);
    assert.equal(result.done, false);
    deltas.push(result.value);

    if (result.value.type === 'data/representation-current') {
      return deltas;
    }
  }
}
