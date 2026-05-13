import assert from 'node:assert/strict';
import test from 'node:test';

import { createStarOctreeProviderService } from '../index.js';
import {
  createStarOctreeProviderServiceForTest,
  ERR_STAR_OCTREE_NOT_IMPLEMENTED,
} from '../star-octree-provider-service.js';

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
  assert.equal(descriptor.capabilities.persistentCache, true);
  assert.equal(descriptor.limits.maxInflightPayloadBatches, 4);
  assert.deepEqual(descriptor.produces, ['index', 'object-batch']);
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

test('byte-backed provider methods expose typed not-implemented stubs', async () => {
  const provider = createStarOctreeProviderService({
    id: 'provider-a',
    url: '/data/stars.octree',
  });

  await assert.rejects(() => provider.ensureBootstrap(), {
    code: ERR_STAR_OCTREE_NOT_IMPLEMENTED,
  });
  await assert.rejects(() => provider.ensureRootShard(), {
    code: ERR_STAR_OCTREE_NOT_IMPLEMENTED,
  });
  await assert.rejects(() => provider.fetchObjectBatch({}), {
    code: ERR_STAR_OCTREE_NOT_IMPLEMENTED,
  });

  await assert.rejects(
    provider.streamPayloads({})[Symbol.asyncIterator]().next(),
    { code: ERR_STAR_OCTREE_NOT_IMPLEMENTED },
  );
  await assert.rejects(
    provider.streamObjectBatches({})[Symbol.asyncIterator]().next(),
    { code: ERR_STAR_OCTREE_NOT_IMPLEMENTED },
  );
});

test('factory requires URL source configuration', () => {
  assert.throws(
    () => createStarOctreeProviderService({ url: '' }),
    /requires a URL/,
  );
});
