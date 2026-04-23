import assert from 'node:assert/strict';
import test from 'node:test';

import { createEightOctantFixture } from '../../fields/__tests__/helpers/fake-octree.js';
import { SCALE } from '../../services/octree/scene-scale.js';
import { queryNearestStars } from '../query-nearest-stars.js';

test('queryNearestStars expands search radius until enough stars are found', async () => {
  const fixture = createEightOctantFixture();
  const events = [];
  const dataset = fixture.datasetSession;
  const renderService = fixture.renderService;
  const distanceByNodeIndex = new Map([
    [2, 2],
    [3, 5],
    [4, 15],
    [5, 32],
    [6, 64],
    [7, 96],
    [8, 128],
    [9, 160],
  ]);

  dataset.emit = (event) => {
    events.push(event);
  };
  renderService.fetchNodePayloadBatch = async (nodes) =>
    nodes.map((node) => ({
      node,
      buffer: node.nodeIndex,
    }));
  renderService.decodePayload = (_buffer, node) => {
    const distancePc = distanceByNodeIndex.get(node.nodeIndex) ?? 256;
    return {
      count: 1,
      positions: new Float32Array([distancePc * SCALE, 0, 0]),
      teffLog8: new Uint8Array([255]),
      magAbs: new Float32Array([distancePc]),
    };
  };

  const result = await queryNearestStars(dataset, {
    centerPc: { x: 0, y: 0, z: 0 },
    count: 2,
    initialRadiusPc: 1,
    expansionFactor: 2,
    maxRadiusPc: 16,
  });

  assert.equal(result.kind, 'nearest-stars');
  assert.equal(result.stars.length, 2);
  assert.equal(result.radiusPc, 8);
  assert.equal(result.iterationCount, 4);
  assert.deepEqual(result.stars.map((star) => Math.round(star.distancePc)), [2, 5]);
  assert.deepEqual(events.map((event) => event.type), [
    'query/started',
    'query/completed',
  ]);
});
