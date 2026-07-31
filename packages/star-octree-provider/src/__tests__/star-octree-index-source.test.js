import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { createStarCellKey } from '@found-in-space/star-trees';
import {
  parseShardFromBlock,
  parseStarHeader,
  STAR_HAS_PAYLOAD,
  STAR_IS_FRONTIER,
  STAR_IS_TERMINAL,
} from '../star-octree-format.js';
import { createStarOctreeIndexSource } from '../star-octree-index-source.js';
import { createStarOctreeScheduler } from '../star-octree-scheduler.js';
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

test('parseStarHeader accepts STAR v2', () => {
  const header = parseStarHeader(
    toArrayBuffer(createStarHeaderBytes({ version: 2 })),
  );

  assert.equal(header.version, 2);
});

test('parseShardFromBlock reads v2 frontier refs after 24-byte node records', () => {
  const shard = parseShardFromBlock(
    toArrayBuffer(
      createShardBytes({
        version: 2,
        nodes: [
          createShardNodeRecord({
            flags: STAR_IS_FRONTIER,
            childMask: 1,
          }),
        ],
        firstFrontierIndex: 1,
        frontierOffsets: [4096],
      }),
    ),
    192,
    2,
  );

  assert.ok(shard);
  assert.equal(shard.readFrontierContinuation(1), 4096n);
});

test('ensureBootstrapLoaded fetches and caches the bootstrap index', async () => {
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
    assert.equal(first.kind, 'star-octree-bootstrap');
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
    assert.equal(node.starCount, null);
    assert.equal(node.isTerminal, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ensureRootShardLoaded reads STAR v2 terminal nodes and star counts', async () => {
  const rootShard = createShardBytes({
    version: 2,
    nodes: [
      createShardNodeRecord({
        flags: STAR_HAS_PAYLOAD | STAR_IS_TERMINAL,
        payloadOffset: 512,
        payloadLength: 96,
        starCount: 6,
      }),
    ],
  });
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      version: 2,
      indexOffset: HEADER_SIZE,
      indexLength: rootShard.length,
    }),
    rootShard,
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, []);

  try {
    const source = createStarOctreeIndexSource({
      providerId: 'provider-a',
      options: {
        url: 'memory://stars-v2.octree',
      },
    });

    const loadedRoot = await source.ensureRootShardLoaded();
    const node = loadedRoot.nodes[0];

    assert.equal(loadedRoot.shard.header.version, 2);
    assert.equal(node.starCount, 6);
    assert.equal(node.isTerminal, true);
    assert.equal(node.payloadOffset, 512);
    assert.equal(node.payloadLength, 96);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ensureRootShardLoaded rejects mixed STAR and OSHR versions', async () => {
  const rootShard = createShardBytes({ version: 1 });
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      version: 2,
      indexOffset: HEADER_SIZE,
      indexLength: rootShard.length,
    }),
    rootShard,
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, []);

  try {
    const source = createStarOctreeIndexSource({
      providerId: 'provider-a',
      options: {
        url: 'memory://mixed-version.octree',
      },
    });

    await assert.rejects(
      source.ensureRootShardLoaded(),
      /OSHR: version 1 at 64 does not match STAR version 2/,
    );
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

test('speculative prefetch shard fetch aborts and does not poison the shard cache', async () => {
  const shardOffset = 1024;
  const shardBytes = createShardBytes();
  let requestCount = 0;
  /** @type {AbortSignal | undefined} */
  let speculativeSignal;
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: { url: 'memory://stars.octree' },
    scheduler: createStarOctreeScheduler(),
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange(_start, _end, options = {}) {
        requestCount += 1;
        if (requestCount === 1) {
          speculativeSignal = options.signal;
          return new Promise((resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(options.signal?.reason);
            }, { once: true });
          });
        }

        return Promise.resolve(toArrayBuffer(shardBytes));
      },
    },
  });
  const prefetchController = new AbortController();

  const prefetch = source.loadShard(shardOffset, {
    lane: 'prefetch',
    signal: prefetchController.signal,
  });
  await tick();
  prefetchController.abort();

  await assert.rejects(prefetch, { name: 'AbortError' });
  await tick();

  assert.equal(speculativeSignal?.aborted, true);
  const shard = await source.loadShard(shardOffset, { lane: 'current' });

  assert.equal(shard.header.nodeCount, 1);
  assert.equal(requestCount, 2);
});

test('foreground shard consumer protects an existing speculative fetch', async () => {
  const shardOffset = 2048;
  const shardBytes = createShardBytes();
  const fetchGate = createDeferred();
  let requestCount = 0;
  /** @type {AbortSignal | undefined} */
  let fetchSignal;
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: { url: 'memory://stars.octree' },
    scheduler: createStarOctreeScheduler(),
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange(_start, _end, options = {}) {
        requestCount += 1;
        fetchSignal = options.signal;
        options.signal?.addEventListener('abort', () => {
          fetchGate.reject(options.signal?.reason);
        }, { once: true });
        return fetchGate.promise;
      },
    },
  });
  const prefetchController = new AbortController();

  const prefetch = source.loadShard(shardOffset, {
    lane: 'prefetch',
    signal: prefetchController.signal,
  });
  prefetch.catch(() => {});
  await tick();
  const current = source.loadShard(shardOffset, { lane: 'current' });
  prefetchController.abort();
  await assert.rejects(prefetch, { name: 'AbortError' });

  assert.equal(fetchSignal?.aborted, false);
  fetchGate.resolve(toArrayBuffer(shardBytes));

  const shard = await current;
  assert.equal(shard.header.nodeCount, 1);
  assert.equal(fetchSignal?.aborted, false);
  assert.equal(requestCount, 1);
});

test('foreground shard demand preempts unrelated speculative shard fetch', async () => {
  const prefetchShardOffset = 4096;
  const currentShardOffset = 8192;
  const shardBytes = createShardBytes();
  let requestCount = 0;
  /** @type {AbortSignal | undefined} */
  let speculativeSignal;
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: { url: 'memory://stars.octree' },
    scheduler: createStarOctreeScheduler({
      limits: {
        maxInflightShardFetches: 1,
        maxInflightPrefetchShardFetches: 1,
      },
    }),
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange(start, _end, options = {}) {
        requestCount += 1;
        if (start === prefetchShardOffset) {
          speculativeSignal = options.signal;
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(options.signal?.reason);
            }, { once: true });
          });
        }

        return Promise.resolve(toArrayBuffer(shardBytes));
      },
    },
  });

  const prefetch = source.loadShard(prefetchShardOffset, { lane: 'prefetch' });
  prefetch.catch(() => {});
  await tick();

  const current = source.loadShard(currentShardOffset, { lane: 'current' });
  await assert.rejects(prefetch, { name: 'AbortError' });
  const shard = await current;

  assert.equal(speculativeSignal?.aborted, true);
  assert.equal(shard.header.nodeCount, 1);
  assert.equal(requestCount, 2);
});

test('aborted foreground shard consumer releases its in-flight range request', async () => {
  const shardOffset = 3072;
  const fetchGate = createDeferred();
  /** @type {AbortSignal | undefined} */
  let fetchSignal;
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: { url: 'memory://stars.octree' },
    scheduler: createStarOctreeScheduler(),
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange(_start, _end, options = {}) {
        fetchSignal = options.signal;
        options.signal?.addEventListener('abort', () => {
          fetchGate.reject(options.signal?.reason);
        }, { once: true });
        return fetchGate.promise;
      },
    },
  });
  const controller = new AbortController();

  const current = source.loadShard(shardOffset, {
    lane: 'current',
    signal: controller.signal,
  });
  current.catch(() => {});
  await tick();
  controller.abort();

  await assert.rejects(current, { name: 'AbortError' });
  await tick();

  assert.equal(fetchSignal?.aborted, true);
});

test('aborted prefetch payload fetch does not poison later foreground demand', async () => {
  const payloadBytes = gzipSync(new Uint8Array([1, 2, 3, 4]));
  const node = createPayloadNode({
    payloadOffset: 100,
    payloadLength: payloadBytes.length,
  });
  let requestCount = 0;
  /** @type {AbortSignal | undefined} */
  let speculativeSignal;
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: { url: 'memory://payloads.octree' },
    scheduler: createStarOctreeScheduler(),
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange(_start, _end, options = {}) {
        requestCount += 1;
        if (requestCount === 1) {
          speculativeSignal = options.signal;
          return new Promise((resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(options.signal?.reason);
            }, { once: true });
          });
        }

        return Promise.resolve(toArrayBuffer(payloadBytes));
      },
    },
  });
  const prefetchController = new AbortController();

  const prefetch = source.fetchNodePayloadBatchProgressive([node], {
    lane: 'prefetch',
    signal: prefetchController.signal,
  });
  prefetch.catch(() => {});
  await tick();
  prefetchController.abort();
  await assert.rejects(prefetch, { name: 'AbortError' });
  await tick();

  const entries = await source.fetchNodePayloadBatchProgressive([node], {
    lane: 'current',
  });

  assert.equal(speculativeSignal?.aborted, true);
  assert.equal(requestCount, 2);
  assert.deepEqual([...new Uint8Array(entries[0].buffer)], [1, 2, 3, 4]);
});

test('foreground payload demand promotes an existing speculative range request', async () => {
  const payloadBytes = gzipSync(new Uint8Array([5, 6, 7, 8]));
  const node = createPayloadNode({
    payloadOffset: 200,
    payloadLength: payloadBytes.length,
  });
  const fetchGate = createDeferred();
  let requestCount = 0;
  /** @type {AbortSignal | undefined} */
  let fetchSignal;
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: { url: 'memory://payloads.octree' },
    scheduler: createStarOctreeScheduler(),
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange(_start, _end, options = {}) {
        requestCount += 1;
        fetchSignal = options.signal;
        options.signal?.addEventListener('abort', () => {
          fetchGate.reject(options.signal?.reason);
        }, { once: true });
        return fetchGate.promise;
      },
    },
  });
  const prefetchController = new AbortController();

  const prefetch = source.fetchNodePayloadBatchProgressive([node], {
    lane: 'prefetch',
    signal: prefetchController.signal,
  });
  prefetch.catch(() => {});
  await tick();
  const current = source.fetchNodePayloadBatchProgressive([node], {
    lane: 'current',
  });
  prefetchController.abort();
  await assert.rejects(prefetch, { name: 'AbortError' });

  assert.equal(fetchSignal?.aborted, false);
  fetchGate.resolve(toArrayBuffer(payloadBytes));
  const entries = await current;

  assert.equal(fetchSignal?.aborted, false);
  assert.equal(requestCount, 1);
  assert.deepEqual([...new Uint8Array(entries[0].buffer)], [5, 6, 7, 8]);
});

test('foreground payload demand preempts unrelated speculative payload fetch', async () => {
  const prefetchPayload = gzipSync(new Uint8Array([9, 10, 11, 12]));
  const currentPayload = gzipSync(new Uint8Array([13, 14, 15, 16]));
  const prefetchNode = createPayloadNode({
    payloadOffset: 300,
    payloadLength: prefetchPayload.length,
  });
  const currentNode = createPayloadNode({
    payloadOffset: 900,
    payloadLength: currentPayload.length,
  });
  let requestCount = 0;
  /** @type {AbortSignal | undefined} */
  let speculativeSignal;
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: { url: 'memory://payloads.octree' },
    scheduler: createStarOctreeScheduler({
      limits: {
        maxInflightPayloadBatches: 1,
        maxInflightPrefetchPayloadBatches: 1,
      },
    }),
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange(start, _end, options = {}) {
        requestCount += 1;
        if (start === prefetchNode.payloadOffset) {
          speculativeSignal = options.signal;
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(options.signal?.reason);
            }, { once: true });
          });
        }

        return Promise.resolve(toArrayBuffer(currentPayload));
      },
    },
  });

  const prefetch = source.fetchNodePayloadBatchProgressive([prefetchNode], {
    lane: 'prefetch',
  });
  prefetch.catch(() => {});
  await tick();

  const current = source.fetchNodePayloadBatchProgressive([currentNode], {
    lane: 'current',
  });
  await assert.rejects(prefetch, { name: 'AbortError' });
  const entries = await current;

  assert.equal(speculativeSignal?.aborted, true);
  assert.equal(requestCount, 2);
  assert.deepEqual([...new Uint8Array(entries[0].buffer)], [13, 14, 15, 16]);
});

test('payload batch scheduling uses the highest requested node priority', async () => {
  const payloadA = gzipSync(new Uint8Array([1]));
  const payloadB = gzipSync(new Uint8Array([2]));
  const nodeA = createPayloadNode({
    payloadOffset: 500,
    payloadLength: payloadA.length,
  });
  const nodeB = createPayloadNode({
    payloadOffset: 500 + payloadA.length,
    payloadLength: payloadB.length,
  });
  const priorityByNode = new WeakMap([
    [nodeA, 2],
    [nodeB, 9],
  ]);
  const scheduledRequests = [];
  const scheduler = {
    schedule(request, run) {
      scheduledRequests.push(request);
      return {
        promise: Promise.resolve().then(run),
        cancel() {},
        promote() {},
      };
    },
  };
  const source = createStarOctreeIndexSource({
    providerId: 'provider-a',
    options: {
      url: 'memory://payloads.octree',
      limits: {
        payloadMaxGapBytes: 64,
        payloadMaxBatchBytes: 1024,
      },
    },
    scheduler,
    rangeSource: {
      persistentCacheAvailable: false,
      fetchRange() {
        return Promise.resolve(toArrayBuffer(concatBytes([payloadA, payloadB])));
      },
    },
  });

  await source.fetchNodePayloadBatchProgressive([nodeA, nodeB], {
    lane: 'current',
    priorityByNode,
  });

  const payloadRequest = scheduledRequests.find((request) => request.kind === 'payload');
  assert.equal(payloadRequest?.priority, 9);
});

function createDeferred() {
  /** @type {(value: ArrayBuffer) => void} */
  let resolve = () => {};
  /** @type {(error: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createPayloadNode(overrides = {}) {
  return {
    mortonCode: '0',
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 1,
    level: 0,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    flags: 1,
    childMask: 0,
    payloadOffset: 0,
    payloadLength: 0,
    firstChild: 0,
    localDepth: 0,
    localPath: 0,
    shardOffset: 0,
    nodeIndex: 1,
    ...overrides,
  };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
