import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFoundInSpaceDatasetOptions,
  DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL,
  DEFAULT_FOUND_IN_SPACE_OCTREE_URL,
  deriveMetaOctreeUrlFromRenderUrl,
  resolveFoundInSpaceDatasetOverrides,
} from '../found-in-space-dataset.js';

test('createFoundInSpaceDatasetOptions uses the hosted defaults when no URLs are provided', () => {
  const options = createFoundInSpaceDatasetOptions({
    id: 'demo-dataset',
  });

  assert.equal(options.id, 'demo-dataset');
  assert.equal(options.octreeUrl, DEFAULT_FOUND_IN_SPACE_OCTREE_URL);
  assert.equal(options.sidecars.meta.url, DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL);
});

test('deriveMetaOctreeUrlFromRenderUrl preserves query strings for custom render URLs', () => {
  assert.equal(
    deriveMetaOctreeUrlFromRenderUrl('https://example.com/data/stars.octree?cache=1'),
    'https://example.com/data/stars.meta.octree?cache=1',
  );
});

test('resolveFoundInSpaceDatasetOverrides reads explicit octree and meta query parameters', () => {
  const overrides = resolveFoundInSpaceDatasetOverrides(
    '?octreeUrl=https://example.com/a.octree&metaUrl=https://example.com/a.meta.octree',
  );

  assert.deepEqual(overrides, {
    octreeUrl: 'https://example.com/a.octree',
    metaUrl: 'https://example.com/a.meta.octree',
  });
});
