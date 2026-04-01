import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import {
  OctreeFileService,
  parseStarHeader,
  planPayloadRangeBatches,
} from '../octree-file-service.js';
import { deriveRenderDatasetUuid } from '../../dataset-identity.js';

const HEADER_SIZE = 64;
const DESCRIPTOR_SIZE = 128;
const STAR_MAGIC = 0x52415453;
const SHARD_MAGIC = 0x5248534f;
const SHARD_HDR_SIZE = 80;
const SHARD_NODE_SIZE = 20;

function createSession() {
  const caches = new Map();
  return {
    assertActive() {},
    getCache(name) {
      if (!caches.has(name)) {
        caches.set(name, new Map());
      }
      return caches.get(name);
    },
  };
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createMockFetch(fileBytes, requests) {
  return async function mockFetch(url, options = {}) {
    const rangeHeader = options.headers?.Range ?? '';
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      throw new Error(`Unexpected range header: ${rangeHeader}`);
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    requests.push({ url, start, end });
    const slice = fileBytes.slice(start, end + 1);

    return {
      ok: true,
      status: 206,
      async arrayBuffer() {
        return toArrayBuffer(slice);
      },
    };
  };
}

function uuidStringToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function createOdscDescriptorBytes({
  datasetUuid,
  parentUuid = '00000000-0000-0000-0000-000000000000',
  sidecarUuid = '00000000-0000-0000-0000-000000000000',
  artifactKind = 'render',
} = {}) {
  const buf = new Uint8Array(DESCRIPTOR_SIZE);
  const view = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode('ODSC'), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, artifactKind === 'sidecar' ? 2 : 1, true);
  buf.set(uuidStringToBytes(datasetUuid), 8);
  buf.set(uuidStringToBytes(parentUuid), 24);
  buf.set(uuidStringToBytes(sidecarUuid), 40);
  return buf;
}

function createStarHeaderBytes({
  indexOffset,
  indexLength,
  worldHalfSize = 100,
  payloadRecordSize = 16,
  maxLevel = 1,
  magLimit = 6.5,
} = {}) {
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, STAR_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setBigUint64(8, BigInt(indexOffset), true);
  view.setBigUint64(16, BigInt(indexLength), true);
  view.setFloat32(24, 0, true);
  view.setFloat32(28, 0, true);
  view.setFloat32(32, 0, true);
  view.setFloat32(36, worldHalfSize, true);
  view.setUint16(40, payloadRecordSize, true);
  view.setUint16(42, maxLevel, true);
  view.setFloat32(44, magLimit, true);
  return new Uint8Array(buffer);
}

function createRootShardBytes() {
  const buffer = new ArrayBuffer(SHARD_HDR_SIZE + SHARD_NODE_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, SHARD_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(18, 1, true);
  view.setInt16(22, -1, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, 0, true);
  view.setUint32(32, 0, true);
  view.setUint16(36, 1, true);
  view.setUint16(52, 0, true);
  view.setBigUint64(54, BigInt(SHARD_HDR_SIZE), true);
  view.setBigUint64(62, BigInt(SHARD_HDR_SIZE + SHARD_NODE_SIZE), true);

  const nodeOffset = SHARD_HDR_SIZE;
  view.setUint16(nodeOffset, 0, true);
  view.setUint16(nodeOffset + 2, 0, true);
  view.setUint8(nodeOffset + 4, 0);
  view.setUint8(nodeOffset + 5, 1);
  view.setUint8(nodeOffset + 6, 0);
  view.setUint8(nodeOffset + 7, 0);
  view.setBigUint64(nodeOffset + 8, 0n, true);
  view.setUint32(nodeOffset + 16, 0, true);

  return new Uint8Array(buffer);
}

test('parseStarHeader reads dataset UUID from ODSC descriptor', () => {
  const datasetUuid = 'c56103e6-ad4c-41f9-be06-048b48ec632b';
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset: HEADER_SIZE + DESCRIPTOR_SIZE,
      indexLength: 100,
    }),
    createOdscDescriptorBytes({ datasetUuid }),
  ]);
  assert.equal(fileBytes.length, HEADER_SIZE + DESCRIPTOR_SIZE);
  const header = parseStarHeader(toArrayBuffer(fileBytes));
  assert.equal(header.datasetUuid, datasetUuid);
  assert.equal(header.artifactKind, 'render');
});

test('deriveRenderDatasetUuid prefers octree descriptor UUID over URL hash', () => {
  const datasetUuid = 'c56103e6-ad4c-41f9-be06-048b48ec632b';
  const header = {
    indexOffset: 192,
    datasetUuid,
  };
  const id = deriveRenderDatasetUuid({
    octreeUrl: 'https://example.com/any/stars.octree',
    header,
  });
  assert.equal(id.datasetUuid, datasetUuid);
  assert.equal(id.datasetIdentitySource, 'octree-descriptor');
});

test('planPayloadRangeBatches merges nearby payload nodes within the configured gap', () => {
  const batches = planPayloadRangeBatches([
    { payloadOffset: 100, payloadLength: 32 },
    { payloadOffset: 180, payloadLength: 16 },
    { payloadOffset: 500, payloadLength: 24 },
  ], {
    maxGapBytes: 64,
    maxBatchBytes: 256,
  });

  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.map((batch) => ({
      start: batch.start,
      end: batch.end,
      nodeCount: batch.nodes.length,
      gapBytes: batch.gapBytes,
    })),
    [
      { start: 100, end: 195, nodeCount: 2, gapBytes: 48 },
      { start: 500, end: 523, nodeCount: 1, gapBytes: 0 },
    ],
  );
});

test('loadBootstrapAndRootShard can warm a contiguous root shard in one request', async () => {
  const rootShardBytes = createRootShardBytes();
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset: HEADER_SIZE,
      indexLength: rootShardBytes.length,
    }),
    rootShardBytes,
  ]);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, requests);

  try {
    const service = new OctreeFileService(createSession(), {
      namespace: 'render',
      url: 'memory://stars.octree',
      shardPrefetchBytes: 256,
    });

    const { bootstrap, rootShard } = await service.loadBootstrapAndRootShard();

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      url: 'memory://stars.octree',
      start: 0,
      end: 255,
    });
    assert.equal(bootstrap.rootShardOffset, HEADER_SIZE);
    assert.equal(rootShard.hdr.nodeCount, 1);
    assert.equal(service.describe().stats.rangeRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchNodePayloadBatch coalesces nearby payload nodes into one range request', async () => {
  const payloadA = new Uint8Array([1, 2, 3, 4]);
  const payloadB = new Uint8Array([8, 13, 21]);
  const compressedA = gzipSync(payloadA);
  const compressedB = gzipSync(payloadB);
  const leadingPad = new Uint8Array(64);
  const gap = new Uint8Array(24);
  const fileBytes = concatBytes([
    leadingPad,
    compressedA,
    gap,
    compressedB,
  ]);
  const payloadOffsetA = leadingPad.length;
  const payloadOffsetB = leadingPad.length + compressedA.length + gap.length;
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, requests);

  try {
    const service = new OctreeFileService(createSession(), {
      namespace: 'render',
      url: 'memory://payloads.octree',
      payloadMaxGapBytes: 64,
      payloadMaxBatchBytes: 1024,
      maxInflightPayloadBatches: 2,
    });

    const entries = await service.fetchNodePayloadBatch([
      {
        payloadOffset: payloadOffsetA,
        payloadLength: compressedA.length,
      },
      {
        payloadOffset: payloadOffsetB,
        payloadLength: compressedB.length,
      },
    ]);

    assert.equal(requests.length, 1);
    assert.deepEqual(Buffer.from(entries[0].buffer), Buffer.from(payloadA));
    assert.deepEqual(Buffer.from(entries[1].buffer), Buffer.from(payloadB));

    const { stats } = service.describe();
    assert.equal(stats.payloadBatchRequests, 1);
    assert.equal(stats.payloadNodesFetched, 2);
    assert.equal(stats.payloadGapBytesRequested, gap.length);
    assert.equal(stats.rangeRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchNodePayloadBatchProgressive reports finished batches before the full request set completes', async () => {
  const payloadA = new Uint8Array([1, 2, 3, 4]);
  const payloadB = new Uint8Array([8, 13, 21]);
  const compressedA = gzipSync(payloadA);
  const compressedB = gzipSync(payloadB);
  const leadingPad = new Uint8Array(64);
  const middlePad = new Uint8Array(256);
  const fileBytes = concatBytes([
    leadingPad,
    compressedA,
    middlePad,
    compressedB,
  ]);
  const payloadOffsetA = leadingPad.length;
  const payloadOffsetB = leadingPad.length + compressedA.length + middlePad.length;
  const requests = [];
  const deferred = createDeferred();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const rangeHeader = options.headers?.Range ?? '';
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    assert.ok(match, `Unexpected range header: ${rangeHeader}`);

    const start = Number(match[1]);
    const end = Number(match[2]);
    requests.push({ url, start, end });

    if (start === payloadOffsetB) {
      await deferred.promise;
    }

    const slice = fileBytes.slice(start, end + 1);
    return {
      ok: true,
      status: 206,
      async arrayBuffer() {
        return toArrayBuffer(slice);
      },
    };
  };

  try {
    const service = new OctreeFileService(createSession(), {
      namespace: 'render',
      url: 'memory://progressive-payloads.octree',
      payloadMaxGapBytes: 64,
      payloadMaxBatchBytes: 32,
      maxInflightPayloadBatches: 2,
    });

    const seenBatches = [];
    const firstBatchSeen = createDeferred();
    let completed = false;
    const fetchPromise = service.fetchNodePayloadBatchProgressive([
      {
        payloadOffset: payloadOffsetA,
        payloadLength: compressedA.length,
      },
      {
        payloadOffset: payloadOffsetB,
        payloadLength: compressedB.length,
      },
    ], {
      onBatch(entries) {
        seenBatches.push(entries.map(({ buffer }) => [...new Uint8Array(buffer)]));
        if (seenBatches.length === 1) {
          firstBatchSeen.resolve();
        }
      },
    }).then(() => {
      completed = true;
    });

    await firstBatchSeen.promise;
    assert.equal(seenBatches.length, 1);
    assert.deepEqual(seenBatches[0], [[1, 2, 3, 4]]);
    assert.equal(completed, false);

    deferred.resolve();
    await fetchPromise;

    assert.equal(seenBatches.length, 2);
    assert.deepEqual(seenBatches[1], [[8, 13, 21]]);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
