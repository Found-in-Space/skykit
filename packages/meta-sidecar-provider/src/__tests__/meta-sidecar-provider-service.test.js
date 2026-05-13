import assert from 'node:assert/strict';
import test from 'node:test';

import { createMetaSidecarProviderService } from '../index.js';

test('meta sidecar provider resolves facts from canonical object refs', async () => {
  const provider = createMetaSidecarProviderService({
    id: 'meta-a',
    parentDatasetId: 'dataset-a',
    sidecarId: 'sidecar-a',
    entries: {
      'node-a': [
        {
          proper_name: 'Sirius',
          hd: 48915,
          hip_id: 32349,
        },
      ],
    },
  });

  const facts = await provider.resolveFacts({
    datasetId: 'dataset-a',
    nodeKey: 'node-a',
    ordinal: 0,
  });

  assert.equal(provider.describe().providerType, 'meta-sidecar');
  assert.equal(facts.productType, 'fact-batch');
  assert.equal(facts.facts.primaryLabel, 'Sirius');
  assert.equal(facts.facts.hd, '48915');
  assert.equal(await provider.resolvePrimaryLabel({
    datasetId: 'dataset-a',
    nodeKey: 'node-a',
    ordinal: 0,
  }), 'Sirius');
  assert.equal(provider.getSnapshot().stats.resolvedFacts, 2);
});

test('meta sidecar provider accepts pickMeta-shaped refs and formats fallback labels', async () => {
  const provider = createMetaSidecarProviderService({
    parentDatasetId: 'dataset-a',
    entries: {
      'node-a': [
        {
          bayer: 'alpha',
          constellation: 'CMa',
        },
        {
          source: 'hip',
          source_id: 123,
        },
      ],
    },
  });

  assert.equal(await provider.resolvePrimaryLabel({
    nodeKey: 'node-a',
    ordinal: 0,
    level: 1,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
  }), 'alpha CMa');
  assert.equal(await provider.resolvePrimaryLabel({
    nodeKey: 'node-a',
    ordinal: 1,
  }), 'HIP 123');
});

test('meta sidecar provider validates parent dataset identity', async () => {
  const provider = createMetaSidecarProviderService({
    parentDatasetId: 'dataset-a',
    entries: {
      'node-a': [{}],
    },
  });

  await assert.rejects(
    () => provider.resolveFacts({
      datasetId: 'dataset-b',
      nodeKey: 'node-a',
      ordinal: 0,
    }),
    (error) => error.code === 'ERR_META_SIDECAR_PARENT_MISMATCH',
  );
  assert.equal(provider.getSnapshot().stats.parentMismatches, 1);
});

test('meta sidecar provider reports missing facts without throwing', async () => {
  const provider = createMetaSidecarProviderService({
    parentDatasetId: 'dataset-a',
    entries: {},
  });

  assert.equal(await provider.resolveFacts({ nodeKey: 'missing', ordinal: 0 }), null);
  assert.equal(provider.getSnapshot().stats.missingFacts, 1);
});
