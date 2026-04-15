#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { getDatasetSession } from '../src/core/dataset-session.js';
import {
  DEFAULT_FOUND_IN_SPACE_OCTREE_URL,
  deriveMetaOctreeUrlFromRenderUrl,
} from '../src/found-in-space-dataset.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'octree-url': {
      type: 'string',
    },
    'meta-octree': {
      type: 'string',
    },
    'skip-sidecar-meta': {
      type: 'boolean',
      default: false,
    },
  },
});

const bookmarkId = positionals[0];
if (!bookmarkId) {
  throw new TypeError(
    'Usage: node scripts/bookmark-star-lookup.js <bookmark-id> [--octree-url URL] [--meta-octree URL] [--skip-sidecar-meta]',
  );
}

const octreeUrl = values['octree-url'] ?? DEFAULT_FOUND_IN_SPACE_OCTREE_URL;
const metaUrl = values['meta-octree'] ?? deriveMetaOctreeUrlFromRenderUrl(octreeUrl);

const datasetSession = getDatasetSession({
  id: 'bookmark-star-lookup-session',
  octreeUrl,
  ...(!values['skip-sidecar-meta'] ? { metaUrl } : {}),
});

try {
  const resolved = await datasetSession.resolveStarById(bookmarkId, {
    includeSidecars: values['skip-sidecar-meta'] ? [] : ['meta'],
  });

  const report = {
    bookmarkId,
    octreeUrl,
    ...(!values['skip-sidecar-meta'] ? { metaUrl } : {}),
    star: resolved,
    dataset: datasetSession.describe(),
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  datasetSession.dispose();
}
