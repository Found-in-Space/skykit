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
  const deferred = createDeferred();
  let fetchCount = 0;
  let renderCount = 0;

  const node = {
    nodeKey: 'node:1',
    payloadOffset: 100,
    payloadLength: 24,
    level: 3,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
  };

  const layer = createStarFieldLayer({
    materialFactory: () => new THREE.PointsMaterial(),
  });

  const context = {
    datasetSession: {
      ensureRenderBootstrap: async () => ({ worldHalfSize: 1 }),
      getRenderService: () => ({
        async fetchNodePayloadBatch(nodes) {
          fetchCount += 1;
          assert.deepEqual(nodes, [node]);
          await deferred.promise;
          return [{ node, buffer: new ArrayBuffer(0) }];
        },
        decodePayload() {
          return {
            positions: new Float32Array([1, 2, 3]),
            teffLog8: new Uint8Array([7]),
            magAbs: new Float32Array([4.5]),
            count: 1,
          };
        },
      }),
    },
    selection: { nodes: [node] },
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
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fetchCount, 1);
  assert.deepEqual(layer.getStats(), {
    nodeCount: 0,
    starCount: 0,
    loadGeneration: 1,
  });

  deferred.resolve();
  await startPromise;
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(layer.getStats(), {
    nodeCount: 1,
    starCount: 1,
    loadGeneration: 1,
  });
  assert.equal(renderCount, 1);
});
