import assert from 'node:assert/strict';
import test from 'node:test';

import { SCALE } from '../../services/octree/scene-scale.js';
import { queryVisibleStars } from '../query-visible-stars.js';

const TEST_DATASET_UUID = '123e4567-e89b-12d3-a456-426614174000';

test('queryVisibleStars decodes headless results and emits query events', async () => {
  const events = [];
  const node = {
    nodeKey: 'node-a',
    level: 1,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    payloadLength: 32,
  };
  const dataset = {
    emit(event) {
      events.push(event);
    },
    async ensureRenderBootstrap() {
      return {
        datasetUuid: TEST_DATASET_UUID,
      };
    },
    getRenderService() {
      return {
        async fetchNodePayloadBatch(nodes) {
          return nodes.map((entry) => ({
            node: entry,
            buffer: entry.nodeKey,
          }));
        },
        decodePayload() {
          return {
            count: 2,
            positions: new Float32Array([
              1 * SCALE, 2 * SCALE, 3 * SCALE,
              4 * SCALE, 0, 0,
            ]),
            teffLog8: new Uint8Array([255, 128]),
            magAbs: new Float32Array([1.5, 4.5]),
          };
        },
      };
    },
    async resolveSidecarMetaFields(name, pickMeta) {
      return {
        name,
        ordinal: pickMeta.ordinal,
      };
    },
  };

  const result = await queryVisibleStars(dataset, {
    observerPc: { x: 0, y: 0, z: 0 },
    includeSidecars: ['meta'],
    limit: 1,
    sortBy: 'distance',
    selectNodes: async () => ({
      nodes: [node],
      meta: {
        selectedNodeCount: 1,
      },
    }),
  });

  assert.equal(result.kind, 'visible-stars');
  assert.equal(result.strategy, 'observer-shell');
  assert.equal(result.stars.length, 1);
  assert.equal(result.stars[0].distancePc?.toFixed(3), '3.742');
  assert.equal(result.stars[0].sidecars.meta.ordinal, 0);
  assert.equal(result.stars[0].id.datasetUuid, TEST_DATASET_UUID);
  assert.deepEqual(events.map((event) => event.type), [
    'query/started',
    'query/completed',
  ]);
});
