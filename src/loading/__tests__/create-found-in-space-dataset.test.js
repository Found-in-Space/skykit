import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL,
  DEFAULT_FOUND_IN_SPACE_OCTREE_URL,
} from '../../found-in-space-dataset.js';
import { createFoundInSpaceDataset } from '../index.js';

test('createFoundInSpaceDataset uses the standard dataset defaults', () => {
  const dataset = createFoundInSpaceDataset({
    resolveOverrides: false,
  });

  const description = dataset.describe();
  assert.equal(description.octreeUrl, DEFAULT_FOUND_IN_SPACE_OCTREE_URL);
  assert.equal(description.metaUrl, DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL);
});

test('createFoundInSpaceDataset resolves URL overrides from search params', () => {
  const dataset = createFoundInSpaceDataset({
    search: '?octreeUrl=https://example.com/custom.octree&metaUrl=https://example.com/custom.meta.octree',
  });

  const description = dataset.describe();
  assert.equal(description.octreeUrl, 'https://example.com/custom.octree');
  assert.equal(description.metaUrl, 'https://example.com/custom.meta.octree');
});

test('createFoundInSpaceDataset lets explicit options override URL params', () => {
  const dataset = createFoundInSpaceDataset({
    search: '?octreeUrl=https://example.com/ignored.octree&metaUrl=https://example.com/ignored.meta.octree',
    octreeUrl: 'https://example.com/direct.octree',
    metaUrl: 'https://example.com/direct.meta.octree',
  });

  const description = dataset.describe();
  assert.equal(description.octreeUrl, 'https://example.com/direct.octree');
  assert.equal(description.metaUrl, 'https://example.com/direct.meta.octree');
});

test('createFoundInSpaceDataset keeps warmup explicit through the dataset handle', async () => {
  const dataset = createFoundInSpaceDataset({
    resolveOverrides: false,
  });

  let bootstrapCalls = 0;
  let rootShardCalls = 0;
  dataset.session.ensureRenderBootstrap = async () => {
    bootstrapCalls += 1;
    return { datasetUuid: 'test-bootstrap' };
  };
  dataset.session.ensureRenderRootShard = async () => {
    rootShardCalls += 1;
    return { shard: 'root' };
  };

  const bootstrap = await dataset.ensureBootstrap();
  const rootShard = await dataset.ensureRootShard();

  assert.deepEqual(bootstrap, { datasetUuid: 'test-bootstrap' });
  assert.deepEqual(rootShard, { shard: 'root' });
  assert.equal(bootstrapCalls, 1);
  assert.equal(rootShardCalls, 1);
  assert.equal(dataset.getSnapshot().loading.bootstrap, 'ready');
  assert.equal(dataset.getSnapshot().loading.rootShard, 'ready');
});
