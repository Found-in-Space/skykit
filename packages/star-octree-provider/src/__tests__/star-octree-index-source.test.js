import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarCellKey } from '@found-in-space/star-products';
import { parseStarHeader } from '../star-octree-format.js';
import { createStarOctreeIndexSource } from '../star-octree-index-source.js';
import {
  HEADER_SIZE,
  DESCRIPTOR_SIZE,
  concatBytes,
  createMockFetch,
  createOdscDescriptorBytes,
  createShardBytes,
  createShardNodeRecord,
  createStarHeaderBytes,
  toArrayBuffer,
} from './octree-byte-fixtures.js';

test('parseStarHeader reads valid STAR header and ODSC descriptor', () => {
  const datasetUuid = 'c56103e6-ad4c-41f9-be06-048b48ec632b';
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset: HEADER_SIZE + DESCRIPTOR_SIZE,
      worldHalfSize: 256,
      magLimit: 7.25,
    }),
    createOdscDescriptorBytes({ datasetUuid }),
  ]);

  const header = parseStarHeader(toArrayBuffer(fileBytes));

  assert.equal(header.version, 1);
  assert.equal(header.indexOffset, 192);
  assert.equal(header.worldHalfSize, 256);
  assert.equal(header.magLimit, 7.25);
  assert.equal(header.datasetUuid, datasetUuid);
  assert.equal(header.artifactKind, 'render');
});

test('parseStarHeader rejects bad magic and unsupported versions', () => {
  assert.throws(
    () => parseStarHeader(toArrayBuffer(createStarHeaderBytes({ magic: 0 }))),
    /bad STAR magic/,
  );
  assert.throws(
    () => parseStarHeader(toArrayBuffer(createStarHeaderBytes({ version: 99 }))),
    /unsupported STAR version 99/,
  );
});

test('ensureBootstrapLoaded fetches and caches the bootstrap product', async () => {
  const datasetUuid = 'c56103e6-ad4c-41f9-be06-048b48ec632b';
  const fileBytes = concatBytes([
    createStarHeaderBytes(),
    createOdscDescriptorBytes({ datasetUuid }),
  ]);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, requests);

  try {
    const source = createStarOctreeIndexSource({
      providerId: 'provider-a',
      options: {
        url: 'memory://stars.octree',
      },
    });

    const first = await source.ensureBootstrapLoaded();
    const second = await source.ensureBootstrapLoaded();
    const snapshot = source.getSnapshot();

    assert.equal(first, second);
    assert.equal(first.productType, 'index');
    assert.equal(first.indexKind, 'star-octree-bootstrap');
    assert.equal(first.datasetId, datasetUuid);
    assert.equal(first.datasetIdentitySource, 'octree-descriptor');
    assert.equal(first.header.indexOffset, 192);
    assert.equal(snapshot.bootstrapReady, true);
    assert.equal(snapshot.rootShardReady, false);
    assert.equal(snapshot.cache.bootstrapHeaders, 1);
    assert.equal(snapshot.stats.rangeRequests, 1);
    assert.equal(snapshot.stats.headerCacheHits, 1);
    assert.deepEqual(requests, [
      {
        url: 'memory://stars.octree',
        start: 0,
        end: 191,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ensureRootShardLoaded warms a contiguous root shard in one initial range', async () => {
  const rootShard = createShardBytes({
    nodes: [
      createShardNodeRecord({
        flags: 1,
        payloadOffset: 512,
        payloadLength: 32,
      }),
    ],
  });
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset: HEADER_SIZE,
      indexLength: rootShard.length,
    }),
    rootShard,
  ]);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, requests);

  try {
    const source = createStarOctreeIndexSource({
      providerId: 'provider-a',
      options: {
        url: 'memory://stars.octree',
      },
    });

    const loadedRoot = await source.ensureRootShardLoaded();
    const node = loadedRoot.nodes[0];
    const snapshot = source.getSnapshot();

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      url: 'memory://stars.octree',
      start: 0,
      end: 65_535,
    });
    assert.equal(snapshot.bootstrapReady, true);
    assert.equal(snapshot.rootShardReady, true);
    assert.equal(snapshot.cache.shardHeaders, 1);
    assert.equal(createStarCellKey(node), '0:0');
    assert.equal(node.level, 0);
    assert.equal(node.gridX, 0);
    assert.equal(node.gridY, 0);
    assert.equal(node.gridZ, 0);
    assert.equal(node.centerX, 0);
    assert.equal(node.halfSize, 100);
    assert.equal(node.payloadOffset, 512);
    assert.equal(node.payloadLength, 32);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ensureRootShardLoaded fetches a non-contiguous root shard separately', async () => {
  const rootOffset = 1024;
  const rootShard = createShardBytes();
  const padding = new Uint8Array(rootOffset - HEADER_SIZE);
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset: rootOffset,
      indexLength: rootShard.length,
    }),
    padding,
    rootShard,
  ]);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, requests);

  try {
    const source = createStarOctreeIndexSource({
      providerId: 'provider-a',
      options: {
        url: 'memory://stars.octree',
      },
    });

    const loadedRoot = await source.ensureRootShardLoaded();

    assert.equal(createStarCellKey(loadedRoot.nodes[0]), '0:0');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(({ start }) => start), [0, 1024]);
    assert.equal(source.getSnapshot().stats.rangeRequests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ensureRootShardLoaded rejects malformed or truncated shard bytes', async () => {
  const truncatedShard = createShardBytes().slice(0, 10);
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset: HEADER_SIZE,
      indexLength: truncatedShard.length,
    }),
    truncatedShard,
  ]);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, requests);

  try {
    const source = createStarOctreeIndexSource({
      providerId: 'provider-a',
      options: {
        url: 'memory://stars.octree',
      },
    });

    await assert.rejects(() => source.ensureRootShardLoaded(), /truncated header/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
