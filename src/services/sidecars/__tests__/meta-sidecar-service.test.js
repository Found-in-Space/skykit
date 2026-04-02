import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatBayerDesignation,
  metaEntryDisplayFields,
} from '../meta-sidecar-service.js';

test('formatBayerDesignation does not duplicate constellation already on bayer', () => {
  assert.equal(
    formatBayerDesignation({ bayer: 'gamma Ara', constellation: 'Ara' }),
    'gamma Ara',
  );
  assert.equal(
    formatBayerDesignation({ bayer: 'γ Ara', constellation: 'Ara' }),
    'γ Ara',
  );
});

test('formatBayerDesignation appends constellation when bayer is letter-only', () => {
  assert.equal(
    formatBayerDesignation({ bayer: 'gamma', constellation: 'Ara' }),
    'gamma Ara',
  );
});

test('metaEntryDisplayFields fills separate id fields', () => {
  assert.deepEqual(
    metaEntryDisplayFields({
      proper_name: 'Betelgeuse',
      bayer: 'α',
      constellation: 'Ori',
      hd: '39801',
      hip_id: 27989,
      gaia_source_id: '1234567890',
    }),
    {
      properName: 'Betelgeuse',
      bayer: 'α Ori',
      hd: '39801',
      hip: '27989',
      gaia: '1234567890',
    },
  );
});

test('resolvePrimaryName and resolveMetaEntryFields use deduped bayer', async () => {
  const { DatasetSession } = await import('../../../core/dataset-session.js');
  const session = new DatasetSession({
    id: 'meta-label-test',
    octreeUrl: 'https://example.com/x.octree',
    metaUrl: 'https://example.com/x.meta.octree',
    datasetUuid: '00000000-0000-0000-0000-000000000001',
    sidecars: {
      meta: {
        name: 'meta',
        url: 'https://example.com/x.meta.octree',
        parentDatasetUuid: '00000000-0000-0000-0000-000000000001',
      },
    },
  });
  const service = session.getSidecarService('meta');
  service.readCellEntries = async () => ({
    descriptor: {},
    entries: [{ bayer: 'gamma Ara', constellation: 'Ara' }],
  });
  const label = await service.resolvePrimaryName({
    nodeKey: 'k',
    level: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    ordinal: 0,
  });
  assert.equal(label, 'gamma Ara');

  const fields = await service.resolveMetaEntryFields({
    nodeKey: 'k',
    level: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    ordinal: 0,
  });
  assert.equal(fields.bayer, 'gamma Ara');
  assert.equal(fields.primaryLabel, 'gamma Ara');
});

test('metaEntryDisplayFields infers gaia from source/source_id fallback', () => {
  assert.deepEqual(
    metaEntryDisplayFields({
      source: 'gaia',
      source_id: '3131481481815810432',
    }),
    {
      properName: '',
      bayer: '',
      hd: '',
      hip: '',
      gaia: '3131481481815810432',
    },
  );
});

test('metaEntryDisplayFields infers hip from source/source_id fallback', () => {
  assert.deepEqual(
    metaEntryDisplayFields({
      source: 'hip',
      source_id: '27989',
    }),
    {
      properName: '',
      bayer: '',
      hd: '',
      hip: '27989',
      gaia: '',
    },
  );
});

test('metaEntryDisplayFields prefers explicit field over source fallback', () => {
  const fields = metaEntryDisplayFields({
    source: 'gaia',
    source_id: '999',
    gaia_source_id: '1234567890',
    hip_id: 27989,
  });
  assert.equal(fields.gaia, '1234567890');
  assert.equal(fields.hip, '27989');
});
