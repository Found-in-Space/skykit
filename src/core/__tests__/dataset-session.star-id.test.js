import assert from 'node:assert/strict';
import test from 'node:test';
import { DatasetSession } from '../dataset-session.js';
import { SCALE } from '../../services/octree/scene-scale.js';

const DATASET_UUID = 'c56103e6-ad4c-41f9-be06-048b48ec632b';

function createSessionWithRenderService(overrides = {}) {
  const session = new DatasetSession({
    datasetUuid: DATASET_UUID,
    octreeUrl: 'memory://stars.octree',
  });

  const defaultNode = {
    nodeKey: '64:1',
    level: 1,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    gridX: 1,
    gridY: 0,
    gridZ: 1,
    payloadLength: 16,
  };

  const renderService = {
    async ensureBootstrap() {
      session.recordDatasetIdentity({ datasetUuid: DATASET_UUID, datasetIdentitySource: 'explicit' });
      return { datasetUuid: DATASET_UUID, header: {} };
    },
    async resolveNodeByLevelMorton() {
      return defaultNode;
    },
    async fetchNodePayload() {
      return new ArrayBuffer(0);
    },
    decodePayload() {
      return {
        positions: new Float32Array([1.5, -2.0, 3.25]),
        magAbs: new Float32Array([4.2]),
        teffLog8: new Uint8Array([255]),
        count: 1,
      };
    },
    ...overrides,
  };

  session.getRenderService = () => renderService;
  return { session, renderService };
}

test('resolveStarById resolves canonical id and star payload without visible-buffer ordering', async () => {
  const { session, renderService } = createSessionWithRenderService();
  const sidecarCalls = [];

  session.resolveSidecarMetaFields = async (name, pickMeta) => {
    sidecarCalls.push({ name, pickMeta });
    return { primaryLabel: 'Sirius' };
  };

  const result = await session.resolveStarById({
    datasetUuid: DATASET_UUID,
    level: 1,
    mortonCode: '5',
    ordinal: 0,
  }, {
    includeSidecars: ['meta'],
  });

  assert.deepEqual(result.id, {
    version: 1,
    datasetUuid: DATASET_UUID,
    level: 1,
    mortonCode: '5',
    ordinal: 0,
  });
  assert.equal(result.nodeKey, '64:1');
  assert.deepEqual(result.positionScene, [1.5, -2.0, 3.25]);
  assert.deepEqual(result.positionPc, [1.5 / SCALE, -2.0 / SCALE, 3.25 / SCALE]);
  assert.equal(result.absoluteMagnitude, 4.199999809265137);
  assert.equal(result.temperatureK, 5800);
  assert.deepEqual(result.sidecars, {
    meta: { primaryLabel: 'Sirius' },
  });

  assert.equal(sidecarCalls.length, 1);
  assert.equal(sidecarCalls[0].name, 'meta');
  assert.equal(sidecarCalls[0].pickMeta.nodeKey, '64:1');
  assert.equal(sidecarCalls[0].pickMeta.ordinal, 0);
  assert.equal(sidecarCalls[0].pickMeta.level, 1);
  assert.equal(sidecarCalls[0].pickMeta.gridX, 1);
  assert.equal(sidecarCalls[0].pickMeta.gridY, 0);
  assert.equal(sidecarCalls[0].pickMeta.gridZ, 1);

  assert.equal(typeof renderService.resolveNodeByLevelMorton, 'function');
});

test('resolveStarById throws when ordinal is outside decoded node payload range', async () => {
  const { session } = createSessionWithRenderService({
    decodePayload() {
      return {
        positions: new Float32Array([0, 0, 0]),
        magAbs: new Float32Array([0]),
        teffLog8: new Uint8Array([0]),
        count: 1,
      };
    },
  });

  await assert.rejects(
    () => session.resolveStarById({
      datasetUuid: DATASET_UUID,
      level: 0,
      mortonCode: '0',
      ordinal: 9,
    }),
    /ordinal 9 is out of range/,
  );
});

test('resolveStarById returns null when requested node is missing', async () => {
  const { session } = createSessionWithRenderService({
    async resolveNodeByLevelMorton() {
      return null;
    },
  });

  const result = await session.resolveStarById({
    datasetUuid: DATASET_UUID,
    level: 2,
    mortonCode: '42',
    ordinal: 0,
  });

  assert.equal(result, null);
});

test('resolveStarById rejects star ids from a different dataset', async () => {
  const { session } = createSessionWithRenderService();

  await assert.rejects(
    () => session.resolveStarById({
      datasetUuid: '11111111-1111-4111-8111-111111111111',
      level: 0,
      mortonCode: '0',
      ordinal: 0,
    }),
    /does not match active dataset/,
  );
});

test('resolveSidecarMetaByStarId maps StarDataId to pickMeta-compatible fields', async () => {
  const { session } = createSessionWithRenderService();
  const calls = [];

  session.resolveSidecarMetaFields = async (name, pickMeta) => {
    calls.push({ name, pickMeta });
    return { properName: 'Altair' };
  };

  const result = await session.resolveSidecarMetaByStarId('meta', {
    datasetUuid: DATASET_UUID,
    level: 1,
    mortonCode: '5',
    ordinal: 3,
  });

  assert.deepEqual(result, { properName: 'Altair' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'meta');
  assert.equal(calls[0].pickMeta.nodeKey, '64:1');
  assert.equal(calls[0].pickMeta.ordinal, 3);
  assert.equal(calls[0].pickMeta.level, 1);
});
