import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderOctreeService } from '../render-octree-service.js';

function createSession() {
  const caches = new Map();
  return {
    datasetUuid: 'c56103e6-ad4c-41f9-be06-048b48ec632b',
    datasetIdentitySource: 'explicit',
    assertActive() {},
    getCache(name) {
      if (!caches.has(name)) {
        caches.set(name, new Map());
      }
      return caches.get(name);
    },
    recordDatasetIdentity() {},
  };
}

function createServiceWithMockShards() {
  const service = new RenderOctreeService(createSession(), { url: 'memory://stars.octree' });
  const header = {
    indexOffset: 64,
    worldCenterX: 0,
    worldCenterY: 0,
    worldCenterZ: 0,
    worldHalfSize: 8,
  };

  const rootShard = {
    shardOffset: 64,
    hdr: {
      entryNodes: [0, 0, 0, 1, 0, 0, 0, 0],
      nodeCount: 2,
      parentGlobalDepth: -1,
      parentGridX: 0,
      parentGridY: 0,
      parentGridZ: 0,
    },
    readNode(nodeIndex) {
      if (nodeIndex === 1) {
        return {
          firstChild: 2,
          localPath: 3,
          childMask: 1 << 2,
          localDepth: 1,
          flags: 0,
          payloadOffset: 100,
          payloadLength: 20,
        };
      }

      return {
        firstChild: 0,
        localPath: (3 << 3) | 2,
        childMask: 0,
        localDepth: 2,
        flags: 0,
        payloadOffset: 200,
        payloadLength: 40,
      };
    },
    readFrontierContinuation() {
      return 0n;
    },
  };

  service.ensureBootstrap = async () => ({ header });
  service.file.loadShard = async () => rootShard;
  return service;
}

test('resolveNodeByLevelMorton resolves node by canonical (level, morton) path', async () => {
  const service = createServiceWithMockShards();

  const node = await service.resolveNodeByLevelMorton(1, '26');

  assert.ok(node);
  assert.equal(node.nodeKey, '64:2');
  assert.equal(node.nodeIndex, 2);
  assert.equal(node.level, 1);
  assert.equal(node.payloadOffset, 200);
  assert.equal(node.payloadLength, 40);
});

test('resolveNodeByLevelMorton returns null when target root octant is missing', async () => {
  const service = createServiceWithMockShards();

  const node = await service.resolveNodeByLevelMorton(0, '0');

  assert.equal(node, null);
});
