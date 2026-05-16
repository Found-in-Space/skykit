import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  createStarOctreeFileProviderService,
  createStarOctreeProviderService,
} from '../index.js';
import {
  createStarOctreeProviderServiceForTest,
} from '../star-octree-provider-service.js';
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
    assert.equal(
      provider.getSnapshot().stats.payloadCompressedBytesRequested,
      fixture.runtimeNodes[0].payloadLength + fixture.runtimeNodes[1].payloadLength,
    );
    assert.equal(
      provider.getSnapshot().stats.payloadSpanBytesRequested,
      fixture.runtimeNodes[1].payloadOffset +
        fixture.runtimeNodes[1].payloadLength -
        fixture.runtimeNodes[0].payloadOffset,
    );
    assert.equal(provider.getSnapshot().stats.payloadGapBytesRequested, 24);
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

test('inspectDemand returns public strategy diagnostics without fetching payloads', async () => {
  const fixture = createObjectStreamFixture();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, requests);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });

    const inspection = await provider.inspectDemand({
      id: 'diagnostic',
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
    });

    assert.equal(inspection.providerId, 'provider-a');
    assert.equal(inspection.strategy.kind, 'observer-shell');
    assert.equal(inspection.counts.nodeCount, 2);
    assert.equal(inspection.counts.currentNodeCount, 2);
    assert.equal(inspection.counts.prefetchNodeCount, 0);
    assert.equal(inspection.counts.payloadNodeCount, 2);
    assert.equal(typeof inspection.counts.maxLevel, 'number');
    assert.deepEqual(
      inspection.nodes.map((node) => node.nodeKey),
      fixture.payloadNodeKeys,
    );
    assert.equal(provider.getSnapshot().stats.payloadNodesFetched, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('decoded cache avoids repeat decode and reports LRU eviction', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
      limits: {
        memoryBudgetBytes: 1,
      },
    });

    for await (const _delta of provider.streamObjectBatches({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
    })) {
      // consume stream
    }

    const snapshot = provider.getSnapshot();
    assert.equal(snapshot.cache.decodedPayloads, 0);
    assert.equal(snapshot.stats.decodedCacheEvictions > 0, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('persistent decoded cache can be reused by a new provider instance', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);
  globalThis.caches = createMemoryCaches();

  try {
    const first = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
      persistentCache: 'on',
    });
    for await (const _delta of first.streamObjectBatches({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
    })) {
      // warm persistent cache
    }

    const second = createStarOctreeProviderService({
      id: 'provider-b',
      url: 'memory://stars.octree',
      persistentCache: 'on',
    });
    const secondDeltas = [];
    for await (const delta of second.streamObjectBatches({
      view: { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
      attributes: ['position', 'objectRef'],
    })) {
      secondDeltas.push(delta);
    }
    const secondRefs = secondDeltas
      .filter((delta) => delta.type === 'data/product-upsert')
      .flatMap((delta) => delta.product.refs);

    assert.equal(second.getSnapshot().stats.decodedPersistentCacheHits >= 2, true);
    assert.equal(secondRefs.length, 3);
    assert.deepEqual(
      [...new Set(secondRefs.map((ref) => ref.datasetId))],
      ['c56103e6-ad4c-41f9-be06-048b48ec632b'],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) {
      delete globalThis.caches;
    } else {
      globalThis.caches = originalCaches;
    }
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

test('streamObjectBatches honors emitCachedFirst false without dropping cached payloads', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });

    for await (const _delta of provider.streamObjectBatches({
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
      },
    })) {
      // warm payload and decoded caches
    }
    const firstSnapshot = provider.getSnapshot();

    const deltas = [];
    for await (const delta of provider.streamObjectBatches({
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
      },
      streaming: {
        emitCachedFirst: false,
      },
    })) {
      deltas.push(delta);
    }

    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].product.count, 3);
    assert.equal(provider.getSnapshot().stats.payloadBatchRequests, firstSnapshot.stats.payloadBatchRequests);
    assert.equal(provider.getSnapshot().stats.payloadCacheHits, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamObjectBatches supports exact target-frustum demand', async () => {
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
      strategy: { kind: 'target-frustum' },
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        limitingMagnitude: 6.5,
        orientationIcrs: { x: 0, y: 0, z: 0, w: 1 },
        verticalFovDeg: 120,
        aspectRatio: 1,
        nearPc: 0,
        farPc: 500,
      },
    })) {
      deltas.push(delta);
    }

    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');
    assert.equal(upserts.length, 1);
    assert.deepEqual(
      upserts[0].product.nodes.map((node) => node.nodeKey),
      fixture.payloadNodeKeys,
    );
    assert.equal(deltas.at(-1).type, 'data/representation-current');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamObjectBatches supports target-derived target-frustum demand', async () => {
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
      strategy: { kind: 'target-frustum' },
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
        targetPc: { x: 0, y: 0, z: -50 },
        limitingMagnitude: 6.5,
        verticalFovDeg: 120,
      },
    })) {
      deltas.push(delta);
    }

    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');
    assert.equal(upserts.length, 1);
    assert.deepEqual(
      upserts[0].product.nodes.map((node) => node.nodeKey),
      fixture.payloadNodeKeys,
    );
    assert.equal(deltas.at(-1).type, 'data/representation-current');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom strategies select real nodes through provider traversal context', async () => {
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
      strategy: {
        kind: 'custom',
        async selectDemand(context) {
          const selection = await context.traversal.select({
            visit(node) {
              return {
                include: true,
                descend: true,
                priority: -node.level,
                reasons: ['custom-test'],
              };
            },
          });

          return {
            entries: selection.entries,
            signature: selection.entries
              .map((entry) => entry.node.nodeKey)
              .join('|'),
            reasons: ['custom-test'],
            metadata: {
              inspectedNodeCount: selection.stats.inspectedNodeCount,
            },
          };
        },
      },
      view: {
        observerPc: { x: 0, y: 0, z: 0 },
      },
    })) {
      deltas.push(delta);
    }

    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');
    assert.equal(upserts.length, 1);
    assert.deepEqual(
      upserts[0].product.nodes.map((node) => node.nodeKey),
      fixture.payloadNodeKeys,
    );
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
    assert.equal(upserts.length, 1);
    assert.deepEqual(
      upserts[0].product.nodes.map((node) => node.nodeKey),
      fixture.payloadNodeKeys,
    );
    assert.equal(deltas.at(-1).type, 'data/representation-current');
    assert.equal(session.getSnapshot().demand.status, 'current');
    assert.equal(session.getSnapshot().demand.currentProductCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('live sessions prefetch role warms caches without emitting products', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);

  try {
    const provider = createStarOctreeProviderServiceForTest(
      { id: 'provider-a', url: 'memory://stars.octree' },
      {
        useRealPipeline: true,
        planDemand: () => ({
          entries: [
            { node: fixture.runtimeNodes[0], role: 'current', priority: 10 },
            { node: fixture.runtimeNodes[1], role: 'prefetch', priority: 1 },
          ],
          signature: 'current-and-prefetch',
        }),
      },
    );
    const session = provider.createSession({ id: 'session-a' });
    const iterator = session.deltas()[Symbol.asyncIterator]();

    session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
    const deltas = await readUntilCurrent(iterator);
    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');

    assert.equal(upserts.length, 1);
    assert.deepEqual(
      upserts[0].product.nodes.map((node) => node.nodeKey),
      [fixture.payloadNodeKeys[0]],
    );

    await waitFor(() => provider.getSnapshot().cache.decodedPayloads >= 2);
    assert.equal(provider.getSnapshot().stats.payloadNodesFetched, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('live sessions report current while prefetch work remains active', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  const prefetchGate = deferred();
  const prefetchStarted = deferred();
  let currentEmitted = false;
  let prefetchStartedAfterCurrent = false;
  globalThis.fetch = createControlledMockFetch(fixture.fileBytes, [], {
    delayRange: {
      offset: fixture.runtimeNodes[1].payloadOffset,
      started() {
        prefetchStartedAfterCurrent = currentEmitted;
        prefetchStarted.resolve();
      },
      release: prefetchGate.promise,
    },
  });

  try {
    const provider = createStarOctreeProviderServiceForTest(
      { id: 'provider-a', url: 'memory://stars.octree' },
      {
        useRealPipeline: true,
        planDemand: () => ({
          entries: [
            { node: fixture.runtimeNodes[0], role: 'current', priority: 10 },
            { node: fixture.runtimeNodes[1], role: 'prefetch', priority: 1 },
          ],
          signature: 'current-and-prefetch',
        }),
      },
    );
    const session = provider.createSession({ id: 'session-a' });
    const iterator = session.deltas()[Symbol.asyncIterator]();
    const unsubscribe = session.subscribe((delta) => {
      if (delta.type === 'data/representation-current') {
        currentEmitted = true;
      }
    });

    session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
    const deltas = await readUntilCurrent(iterator);
    await prefetchStarted.promise;
    const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');
    const sessionSnapshot = session.getSnapshot();
    const providerSession = provider.getSnapshot().sessions.find(
      (entry) => entry.id === 'session-a',
    );

    assert.equal(deltas.at(-1).type, 'data/representation-current');
    assert.equal(prefetchStartedAfterCurrent, true);
    assert.equal(upserts.length, 1);
    assert.deepEqual(
      upserts[0].product.nodes.map((node) => node.nodeKey),
      [fixture.payloadNodeKeys[0]],
    );
    assert.equal(sessionSnapshot.demand.status, 'current');
    assert.equal(sessionSnapshot.demand.activeWorkItemCount, 1);
    assert.equal(providerSession.activeWorkItemCount, 1);
    assert.equal(
      provider.getSnapshot().workItems.some(
        (item) =>
          item.sessionId === 'session-a' &&
          item.status !== 'finished' &&
          item.status !== 'failed',
      ),
      true,
    );

    prefetchGate.resolve();
    await waitFor(() => session.getSnapshot().demand.activeWorkItemCount === 0);
    await waitFor(() => provider.getSnapshot().cache.decodedPayloads >= 2);
    unsubscribe();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('live sessions keep current representation when prefetch fails', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createControlledMockFetch(fixture.fileBytes, [], {
    failRange: {
      offset: fixture.runtimeNodes[1].payloadOffset,
    },
  });

  try {
    const provider = createStarOctreeProviderServiceForTest(
      { id: 'provider-a', url: 'memory://stars.octree' },
      {
        useRealPipeline: true,
        planDemand: () => ({
          entries: [
            { node: fixture.runtimeNodes[0], role: 'current', priority: 10 },
            { node: fixture.runtimeNodes[1], role: 'prefetch', priority: 1 },
          ],
          signature: 'current-and-prefetch',
        }),
      },
    );
    const session = provider.createSession({ id: 'session-a' });
    const iterator = session.deltas()[Symbol.asyncIterator]();

    session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
    const deltas = await readUntilCurrent(iterator);

    await waitFor(() =>
      provider.getSnapshot().workItems.some(
        (item) => item.sessionId === 'session-a' && item.status === 'failed',
      ),
    );
    assert.equal(deltas.at(-1).type, 'data/representation-current');
    assert.equal(
      deltas.some((delta) => delta.type === 'data/product-error'),
      false,
    );
    assert.equal(session.getSnapshot().demand.status, 'current');
    assert.equal(session.getSnapshot().demand.activeWorkItemCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stale live session demand does not start superseded prefetch', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  let stalePrefetchStarted = false;
  const resolvers = [];
  globalThis.fetch = createControlledMockFetch(fixture.fileBytes, [], {
    delayRange: {
      offset: fixture.runtimeNodes[1].payloadOffset,
      started() {
        stalePrefetchStarted = true;
      },
      release: Promise.resolve(),
    },
  });

  try {
    const provider = createStarOctreeProviderServiceForTest(
      { id: 'provider-a', url: 'memory://stars.octree' },
      {
        useRealPipeline: true,
        planDemand(context) {
          return new Promise((resolve) => {
            resolvers.push({ context, resolve });
          });
        },
      },
    );
    const session = provider.createSession({ id: 'session-a' });
    const iterator = session.deltas()[Symbol.asyncIterator]();

    session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
    session.updateView({ observerPc: { x: 1, y: 0, z: 0 } });
    await waitFor(() => resolvers.length === 2);

    resolvers[0].resolve({
      entries: [
        { node: fixture.runtimeNodes[0], role: 'current', priority: 10 },
        { node: fixture.runtimeNodes[1], role: 'prefetch', priority: 1 },
      ],
      signature: 'stale-current-only',
    });
    await tick();
    assert.equal(stalePrefetchStarted, false);

    resolvers[1].resolve({
      entries: [
        { node: fixture.runtimeNodes[0], role: 'current', priority: 10 },
      ],
      signature: 'fresh-current-only',
    });
    const deltas = await readUntilCurrent(iterator);

    assert.equal(stalePrefetchStarted, false);
    assert.deepEqual(
      deltas
        .filter((delta) => delta.type === 'data/product-upsert')
        .flatMap((delta) => delta.product.nodes.map((node) => node.nodeKey)),
      [fixture.payloadNodeKeys[0]],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('grouped live products are replaced when partially retained', async () => {
  const fixture = createObjectStreamFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fixture.fileBytes, []);
  let demandedNodes = fixture.runtimeNodes;

  try {
    const provider = createStarOctreeProviderServiceForTest(
      { id: 'provider-a', url: 'memory://stars.octree' },
      {
        useRealPipeline: true,
        planDemand: () => ({
          entries: demandedNodes.map((node, index) => ({
            node,
            role: 'current',
            priority: 10 - index,
          })),
          signature: demandedNodes.map((node) => node.nodeKey).join('|'),
        }),
      },
    );
    const session = provider.createSession({ id: 'session-a' });
    const iterator = session.deltas()[Symbol.asyncIterator]();

    session.updateView({ observerPc: { x: 0, y: 0, z: 0 } });
    const initial = await readUntilCurrent(iterator);
    const initialProduct = initial.find((delta) => delta.type === 'data/product-upsert').product;
    assert.equal(initialProduct.nodes.length, 2);

    demandedNodes = [fixture.runtimeNodes[1]];
    session.updateView({ observerPc: { x: 1, y: 0, z: 0 } });
    const changed = await readUntilCurrent(iterator);
    const stale = changed.filter((delta) => delta.type === 'data/product-stale');
    const remove = changed.filter((delta) => delta.type === 'data/product-remove');
    const upserts = changed.filter((delta) => delta.type === 'data/product-upsert');

    assert.deepEqual(stale.map((delta) => delta.productId), [initialProduct.id]);
    assert.deepEqual(remove.map((delta) => delta.productId), [initialProduct.id]);
    assert.equal(upserts.length, 1);
    assert.deepEqual(
      upserts[0].product.nodes.map((node) => node.nodeKey),
      [fixture.payloadNodeKeys[1]],
    );
    assert.equal(provider.getSnapshot().stats.payloadCacheHits >= 1, true);
    assert.equal(provider.getSnapshot().stats.decodedCacheHits >= 1, true);
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

test('file provider streams the same object batches without URL cache economics', async () => {
  const fixture = createObjectStreamFixture();
  const provider = createStarOctreeFileProviderService({
    id: 'file-provider',
    file: new Blob([fixture.fileBytes], { type: 'application/octet-stream' }),
  });
  const deltas = [];

  for await (const delta of provider.streamObjectBatches({
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      limitingMagnitude: 6.5,
    },
  })) {
    deltas.push(delta);
  }

  const upserts = deltas.filter((delta) => delta.type === 'data/product-upsert');
  const snapshot = provider.getSnapshot();

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].product.count, 3);
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

  return {
    fileBytes,
    payloadA,
    payloadB,
    runtimeNodes: [
      createRuntimeNode({
        nodeKey: `${indexOffset}:2`,
        centerX: -50,
        centerY: -50,
        centerZ: -50,
        halfSize: 25,
        payloadOffset: payloadOffsetA,
        payloadLength: compressedA.length,
      }),
      createRuntimeNode({
        nodeKey: `${indexOffset}:3`,
        centerX: 50,
        centerY: -50,
        centerZ: -50,
        halfSize: 25,
        payloadOffset: payloadOffsetB,
        payloadLength: compressedB.length,
        nodeIndex: 3,
      }),
    ],
    payloadNodeKeys: [
      `${indexOffset}:2`,
      `${indexOffset}:3`,
    ],
  };
}

function createRuntimeNode(overrides) {
  return {
    nodeKey: 'node',
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 1,
    level: 2,
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

async function waitFor(predicate) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 500) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function createMemoryCaches() {
  const stores = new Map();

  return {
    async open(name) {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      const store = stores.get(name);
      return {
        async match(request) {
          const url = typeof request === 'string' ? request : request.url;
          const buffer = store.get(url);
          return buffer ? new Response(buffer.slice(0)) : undefined;
        },
        async put(request, response) {
          const url = typeof request === 'string' ? request : request.url;
          store.set(url, await response.arrayBuffer());
        },
      };
    },
  };
}

function createControlledMockFetch(fileBytes, requests, options = {}) {
  return async function mockFetch(url, fetchOptions = {}) {
    const rangeHeader = fetchOptions.headers?.Range ?? '';
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      throw new Error(`Unexpected range header: ${rangeHeader}`);
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    requests.push({ url, start, end });

    if (rangeContainsOffset(start, end, options.failRange?.offset)) {
      return {
        ok: false,
        status: 500,
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    }

    if (rangeContainsOffset(start, end, options.delayRange?.offset)) {
      options.delayRange.started();
      await options.delayRange.release;
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
}

function rangeContainsOffset(start, end, offset) {
  return offset !== undefined && start <= offset && end >= offset;
}

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
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
