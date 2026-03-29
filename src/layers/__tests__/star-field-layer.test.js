import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createStarFieldLayer } from '../star-field-layer.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

test('StarFieldLayer start does not wait for the initial payload batch', async () => {
  const firstBatch = createDeferred();
  const secondBatch = createDeferred();
  let fetchProgressiveCount = 0;
  let renderCount = 0;

  const nodeA = {
    nodeKey: 'node:1',
    payloadOffset: 100,
    payloadLength: 24,
    level: 3,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
  };
  const nodeB = {
    nodeKey: 'node:2',
    payloadOffset: 200,
    payloadLength: 24,
    level: 4,
    centerX: 1,
    centerY: 1,
    centerZ: 1,
  };

  const layer = createStarFieldLayer({
    materialFactory: () => new THREE.PointsMaterial(),
  });

  const context = {
    datasetSession: {
      ensureRenderBootstrap: async () => ({ worldHalfSize: 1 }),
      getRenderService: () => ({
        async fetchNodePayloadBatchProgressive(nodes, options = {}) {
          fetchProgressiveCount += 1;
          assert.deepEqual(nodes, [nodeA, nodeB]);
          firstBatch.resolve();
          await options.onBatch?.([{ node: nodeA, buffer: new ArrayBuffer(0) }]);
          await secondBatch.promise;
          await options.onBatch?.([{ node: nodeB, buffer: new ArrayBuffer(0) }]);
          return [
            { node: nodeA, buffer: new ArrayBuffer(0) },
            { node: nodeB, buffer: new ArrayBuffer(0) },
          ];
        },
        async fetchNodePayloadBatch(nodes) {
          assert.deepEqual(nodes, [nodeA, nodeB]);
          return [
            { node: nodeA, buffer: new ArrayBuffer(0) },
            { node: nodeB, buffer: new ArrayBuffer(0) },
          ];
        },
        decodePayload(buffer, node) {
          if (node === nodeA) {
            return {
              positions: new Float32Array([1, 2, 3]),
              teffLog8: new Uint8Array([7]),
              magAbs: new Float32Array([4.5]),
              count: 1,
            };
          }

          return {
            positions: new Float32Array([4, 5, 6]),
            teffLog8: new Uint8Array([8]),
            magAbs: new Float32Array([5.5]),
            count: 1,
          };
        },
      }),
    },
    selection: { nodes: [nodeA, nodeB] },
    mount: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: {},
    scene: new THREE.Scene(),
    state: {},
    runtime: {
      renderOnce() {
        renderCount += 1;
      },
    },
  };

  await layer.attach(context);

  let startSettled = false;
  const startPromise = layer.start(context).then(() => {
    startSettled = true;
  });

  await Promise.resolve();
  assert.equal(startSettled, true);
  await firstBatch.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetchProgressiveCount, 1);
  assert.deepEqual(layer.getStats(), {
    nodeCount: 1,
    starCount: 1,
    loadGeneration: 1,
  });
  assert.equal(renderCount, 1);

  secondBatch.resolve();
  await startPromise;
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(layer.getStats(), {
    nodeCount: 2,
    starCount: 2,
    loadGeneration: 1,
  });
  assert.equal(renderCount, 2);
});
