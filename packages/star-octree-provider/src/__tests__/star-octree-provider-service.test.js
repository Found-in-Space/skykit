import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OCTREE_DEFAULT,
  OCTREE_c56103,
  createStarOctreeProviderService,
} from '../index.js';
import {
  createStarOctreeProviderServiceForTest,
} from '../star-octree-provider-service.js';
import {
  concatBytes,
  createMockFetch,
  createOdscDescriptorBytes,
  createStarHeaderBytes,
} from './octree-byte-fixtures.js';

test('default public octree URL constants are exported', () => {
  assert.equal(
    OCTREE_c56103,
    'https://d1kwci8ql2abxm.cloudfront.net/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree',
  );
  assert.equal(OCTREE_DEFAULT, OCTREE_c56103);
});

test('factory creates a provider descriptor and empty snapshot', () => {
  const provider = createStarOctreeProviderService({
    id: 'provider-a',
    url: '/data/stars.octree',
    datasetId: 'dataset-a',
    persistentCache: 'on',
    limits: {
      maxInflightPayloadBatches: 4,
      payloadMaxGapBytes: 1024,
      payloadMaxBatchBytes: 2048,
    },
  });

  const descriptor = provider.describe();
  assert.equal(provider.id, 'provider-a');
  assert.equal(descriptor.providerType, 'star-octree');
  assert.equal(descriptor.datasetId, 'dataset-a');
  assert.equal(descriptor.url, '/data/stars.octree');
  assert.equal(descriptor.capabilities.sessions, true);
  assert.equal(descriptor.capabilities.rangeRequestable, true);
  assert.equal(descriptor.capabilities.payloadBatching, true);
  assert.equal(descriptor.capabilities.persistentCache, false);
  assert.equal(descriptor.limits.maxInflightPayloadBatches, 4);
  assert.deepEqual(descriptor.produces, ['index', 'star-cells']);
  assert.deepEqual(descriptor.objectTypes, ['star']);

  const snapshot = provider.getSnapshot();
  assert.equal(snapshot.dataset.bootstrapReady, false);
  assert.equal(snapshot.dataset.rootShardReady, false);
  assert.deepEqual(snapshot.sessions, []);
  assert.equal(snapshot.stats.rangeRequests, 0);
});

test('provider snapshots include independent live sessions', () => {
  const provider = createStarOctreeProviderServiceForTest({
    id: 'provider-a',
    url: '/data/stars.octree',
  });
  const first = provider.createSession({ id: 'session-a' });
  const second = provider.createSession({ id: 'session-b' });

  assert.deepEqual(
    provider.getSnapshot().sessions.map((session) => session.id),
    ['session-a', 'session-b'],
  );

  first.dispose();
  assert.deepEqual(
    provider.getSnapshot().sessions.map((session) => session.id),
    ['session-b'],
  );

  provider.dispose();
  assert.deepEqual(provider.getSnapshot().sessions, []);
  assert.throws(() => provider.createSession(), /disposed/);
  second.dispose();
});

test('target-frustum streams validate required view state clearly', async () => {
  const provider = createStarOctreeProviderService({
    id: 'provider-a',
    url: '/data/stars.octree',
  });

  const result = await provider.streamCells({
    strategy: { kind: 'target-frustum' },
  })[Symbol.asyncIterator]().next();

  assert.equal(result.done, false);
  assert.equal(result.value.type, 'stars/error');
  assert.equal(
    result.value.error.code,
    'ERR_STAR_OCTREE_INVALID_VIEW',
  );
});

test('ensureBootstrap reads real octree header bytes and updates snapshots', async () => {
  const datasetUuid = 'c56103e6-ad4c-41f9-be06-048b48ec632b';
  const fileBytes = concatBytes([
    createStarHeaderBytes({
      indexOffset: 192,
      worldHalfSize: 512,
      magLimit: 7,
    }),
    createOdscDescriptorBytes({ datasetUuid }),
  ]);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createMockFetch(fileBytes, requests);

  try {
    const provider = createStarOctreeProviderService({
      id: 'provider-a',
      url: 'memory://stars.octree',
    });

    assert.equal('ensureRootShard' in provider, false);

    const bootstrap = await provider.ensureBootstrap();
    const cachedBootstrap = await provider.ensureBootstrap();
    const descriptor = provider.describe();
    const snapshot = provider.getSnapshot();

    assert.equal(bootstrap, cachedBootstrap);
    assert.equal(bootstrap.providerId, 'provider-a');
    assert.equal(bootstrap.datasetId, datasetUuid);
    assert.equal(bootstrap.datasetIdentitySource, 'octree-descriptor');
    assert.equal(bootstrap.header.worldHalfSize, 512);
    assert.equal(bootstrap.header.magLimit, 7);
    assert.equal(snapshot.dataset.bootstrapReady, true);
    assert.equal(snapshot.dataset.rootShardReady, false);
    assert.equal(snapshot.dataset.datasetId, datasetUuid);
    assert.equal(snapshot.dataset.identitySource, 'octree-descriptor');
    assert.equal(descriptor.datasetId, datasetUuid);
    assert.equal(descriptor.datasetIdentitySource, 'octree-descriptor');
    assert.equal(snapshot.cache.bootstrapHeaders, 1);
    assert.equal(snapshot.stats.rangeRequests, 1);
    assert.equal(snapshot.stats.headerCacheHits, 1);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('factory requires URL source configuration', () => {
  assert.throws(
    () => createStarOctreeProviderService({ url: '' }),
    /requires a URL/,
  );
});
