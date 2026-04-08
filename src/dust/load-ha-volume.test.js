import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import {
  HA_VOLUME_FLAG_HAS_PAYLOAD,
  HA_VOLUME_INDEX_HEADER_BYTES,
  HA_VOLUME_INDEX_NODE_BYTES,
  HA_VOLUME_NO_INDEX,
  HaVolumeBrickCache,
  HaVolumeService,
  getHaVolumeNodeBounds,
  loadHaVolume,
  parseHaVolumeIndexBuffer,
  resolveHaVolumeUrl,
  selectHaVolumeNodes,
} from './load-ha-volume.js';

const textEncoder = new TextEncoder();

function makeIndexBuffer(nodes) {
  const buf = new ArrayBuffer(HA_VOLUME_INDEX_HEADER_BYTES + nodes.length * HA_VOLUME_INDEX_NODE_BYTES);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  u8.set(textEncoder.encode('FHAIDX1'), 0);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, HA_VOLUME_INDEX_HEADER_BYTES, true);
  dv.setUint32(12, HA_VOLUME_INDEX_NODE_BYTES, true);
  dv.setUint32(16, nodes.length, true);
  dv.setUint16(20, 8, true);
  dv.setUint16(22, 1, true);

  nodes.forEach((node, index) => {
    const off = HA_VOLUME_INDEX_HEADER_BYTES + index * HA_VOLUME_INDEX_NODE_BYTES;
    dv.setUint8(off, node.level ?? 0);
    dv.setUint8(off + 1, node.childMask ?? 0);
    dv.setUint16(off + 2, node.flags ?? HA_VOLUME_FLAG_HAS_PAYLOAD, true);
    dv.setUint32(off + 4, node.parentIndex ?? HA_VOLUME_NO_INDEX, true);
    dv.setUint32(off + 8, node.firstChildIndex ?? HA_VOLUME_NO_INDEX, true);
    dv.setUint16(off + 12, node.gridX ?? 0, true);
    dv.setUint16(off + 14, node.gridY ?? 0, true);
    dv.setUint16(off + 16, node.gridZ ?? 0, true);
    dv.setUint8(off + 18, node.encodedMax ?? 0);
    dv.setFloat32(off + 20, node.maxValue ?? 0, true);
    dv.setFloat32(off + 24, node.meanValue ?? 0, true);
    dv.setFloat64(off + 28, node.sumValue ?? 0, true);
    dv.setUint32(off + 36, node.nonzeroCount ?? 0, true);
    dv.setBigUint64(off + 40, BigInt(node.payloadOffset ?? 0), true);
    dv.setUint32(off + 48, node.payloadLength ?? 0, true);
  });

  return buf;
}

function makeVolume(nodes) {
  return {
    manifest: {
      world_bounds_pc: {
        x: [-8, 8],
        y: [-8, 8],
        z: [-8, 8],
      },
    },
    nodes,
    brickSize: 8,
    maxDepth: 1,
    payloadUrl: '/volumes/test/ha_volume.bin',
  };
}

test('parseHaVolumeIndexBuffer reads header, records, and child links', () => {
  const parsed = parseHaVolumeIndexBuffer(makeIndexBuffer([
    {
      level: 0,
      childMask: 0b1000_0001,
      firstChildIndex: 1,
      encodedMax: 64,
      maxValue: 4,
      meanValue: 0.5,
      sumValue: 256,
      nonzeroCount: 64,
      payloadOffset: 10,
      payloadLength: 20,
    },
    {
      level: 1,
      parentIndex: 0,
      gridX: 0,
      gridY: 0,
      gridZ: 0,
      encodedMax: 255,
      payloadOffset: 30,
      payloadLength: 40,
    },
    {
      level: 1,
      parentIndex: 0,
      gridX: 1,
      gridY: 1,
      gridZ: 1,
      encodedMax: 128,
      payloadOffset: 70,
      payloadLength: 50,
    },
  ]));

  assert.equal(parsed.nodeCount, 3);
  assert.equal(parsed.brickSize, 8);
  assert.equal(parsed.maxDepth, 1);
  assert.deepEqual(parsed.nodes[0].children, [1, 2]);
  assert.equal(parsed.nodes[0].sumValue, 256);
  assert.equal(parsed.nodes[2].gridZ, 1);
});

test('parseHaVolumeIndexBuffer rejects HTML and bad sizes', () => {
  assert.throws(
    () => parseHaVolumeIndexBuffer(new TextEncoder().encode('<html></html>').buffer),
    /looks like HTML/,
  );
  assert.throws(
    () => parseHaVolumeIndexBuffer(new ArrayBuffer(12)),
    /File too small/,
  );
  const truncated = makeIndexBuffer([{ level: 0 }]).slice(0, -1);
  assert.throws(
    () => parseHaVolumeIndexBuffer(truncated),
    /Unexpected H-alpha volume index size/,
  );
});

test('selectHaVolumeNodes refines only when child bricks are ready', () => {
  const parsed = parseHaVolumeIndexBuffer(makeIndexBuffer([
    { level: 0, childMask: 0b0000_0011, firstChildIndex: 1 },
    { level: 1, parentIndex: 0, gridX: 0, gridY: 0, gridZ: 0 },
    { level: 1, parentIndex: 0, gridX: 1, gridY: 0, gridZ: 0 },
  ]));
  const volume = makeVolume(parsed.nodes);

  let selected = selectHaVolumeNodes(volume, {
    isBrickReady: () => false,
    projectedSizeForNode: () => 200,
  });
  assert.deepEqual(selected.renderNodes.map((node) => node.index), [0]);
  assert.deepEqual(selected.requestNodes.map((node) => node.index), [0]);

  selected = selectHaVolumeNodes(volume, {
    isBrickReady: (node) => node.index === 0,
    projectedSizeForNode: () => 200,
  });
  assert.deepEqual(selected.renderNodes.map((node) => node.index), [0]);
  assert.deepEqual(selected.requestNodes.map((node) => node.index), [1, 2]);

  selected = selectHaVolumeNodes(volume, {
    isBrickReady: () => true,
    projectedSizeForNode: () => 200,
    maxRenderBricks: 1,
  });
  assert.deepEqual(selected.renderNodes.map((node) => node.index), [1]);
  assert.deepEqual(selected.requestNodes, []);
});

test('selectHaVolumeNodes applies visibility, priority, and request caps', () => {
  const parsed = parseHaVolumeIndexBuffer(makeIndexBuffer([
    { level: 0, childMask: 0b0000_0111, firstChildIndex: 1 },
    { level: 1, parentIndex: 0, gridX: 0, gridY: 0, gridZ: 0 },
    { level: 1, parentIndex: 0, gridX: 1, gridY: 0, gridZ: 0 },
    { level: 1, parentIndex: 0, gridX: 0, gridY: 1, gridZ: 0 },
  ]));
  const volume = makeVolume(parsed.nodes);

  const selected = selectHaVolumeNodes(volume, {
    isBrickReady: (node) => node.index === 0,
    isNodeVisible: (node) => node.index !== 2,
    canRequestNode: (node) => node.index !== 1,
    nodePriority: (node) => node.index,
    projectedSizeForNode: () => 200,
    maxRequestBricks: 1,
  });

  assert.deepEqual(selected.renderNodes.map((node) => node.index), [0]);
  assert.deepEqual(selected.requestNodes.map((node) => node.index), [3]);
});

test('selectHaVolumeNodes can use deterministic target levels without parent fallback', () => {
  const parsed = parseHaVolumeIndexBuffer(makeIndexBuffer([
    { level: 0, childMask: 0b0000_0011, firstChildIndex: 1 },
    { level: 1, parentIndex: 0, gridX: 0, gridY: 0, gridZ: 0 },
    { level: 1, parentIndex: 0, gridX: 1, gridY: 0, gridZ: 0 },
  ]));
  const volume = makeVolume(parsed.nodes);

  let selected = selectHaVolumeNodes(volume, {
    isBrickReady: (node) => node.index === 0,
    targetLevelForNode: () => 1,
    projectedSizeForNode: () => 200,
  });
  assert.deepEqual(selected.renderNodes, []);
  assert.deepEqual(selected.requestNodes.map((node) => node.index), [1, 2]);

  selected = selectHaVolumeNodes(volume, {
    isBrickReady: (node) => node.index === 1,
    targetLevelForNode: () => 1,
    projectedSizeForNode: () => 200,
  });
  assert.deepEqual(selected.renderNodes.map((node) => node.index), [1]);
  assert.deepEqual(selected.requestNodes.map((node) => node.index), [2]);

  selected = selectHaVolumeNodes(volume, {
    isBrickReady: (node) => node.index === 0,
    targetLevelForNode: () => 0,
    projectedSizeForNode: () => 200,
  });
  assert.deepEqual(selected.renderNodes.map((node) => node.index), [0]);
  assert.deepEqual(selected.requestNodes, []);
});

test('getHaVolumeNodeBounds maps node grid coordinates into Galactic pc bounds', () => {
  const parsed = parseHaVolumeIndexBuffer(makeIndexBuffer([
    { level: 0, childMask: 1, firstChildIndex: 1 },
    { level: 1, parentIndex: 0, gridX: 1, gridY: 0, gridZ: 1 },
  ]));
  const volume = makeVolume(parsed.nodes);

  assert.deepEqual(getHaVolumeNodeBounds(volume, parsed.nodes[1]), {
    minX: 0,
    maxX: 8,
    minY: -8,
    maxY: 0,
    minZ: 0,
    maxZ: 8,
  });
});

test('HaVolumeBrickCache evicts least recently used entries', () => {
  const cache = new HaVolumeBrickCache(2);
  cache.set(1, new Uint8Array([1]));
  cache.set(2, new Uint8Array([2]));
  assert.deepEqual([...cache.get(1)], [1]);
  cache.set(3, new Uint8Array([3]));

  assert.equal(cache.has(1), true);
  assert.equal(cache.has(2), false);
  assert.equal(cache.has(3), true);
});

test('HaVolumeService range-fetches and decodes gzip brick payloads', async () => {
  const decoded = new Uint8Array(8 * 8 * 8);
  decoded.fill(7);
  const compressed = gzipSync(decoded);
  const prefix = new Uint8Array([1, 2, 3, 4, 5]);
  const payload = new Uint8Array(prefix.length + compressed.byteLength + 3);
  payload.set(prefix, 0);
  payload.set(compressed, prefix.length);

  const nodes = [{
    index: 0,
    flags: HA_VOLUME_FLAG_HAS_PAYLOAD,
    payloadOffset: prefix.length,
    payloadLength: compressed.byteLength,
  }];
  const service = new HaVolumeService(makeVolume(nodes), {
    fetchImpl: async (url, options) => {
      assert.equal(url, '/volumes/test/ha_volume.bin');
      assert.equal(options.headers.Range, `bytes=${prefix.length}-${prefix.length + compressed.byteLength - 1}`);
      return new Response(
        payload.slice(prefix.length, prefix.length + compressed.byteLength),
        { status: 206 },
      );
    },
  });

  const brick = await service.requestBrick(nodes[0]);
  assert.equal(brick.byteLength, 512);
  assert.equal(brick[0], 7);
  assert.equal(service.hasDecodedBrick(0), true);
  assert.equal(service.describe().stats.rangeRequests, 1);
});

test('HaVolumeService default fetch preserves the global receiver', async () => {
  const originalFetch = globalThis.fetch;
  const decoded = new Uint8Array(8 * 8 * 8);
  decoded.fill(9);
  const compressed = gzipSync(decoded);
  const receiver = { tag: 'window-like' };
  const nodes = [{
    index: 0,
    flags: HA_VOLUME_FLAG_HAS_PAYLOAD,
    payloadOffset: 0,
    payloadLength: compressed.byteLength,
  }];

  try {
    globalThis.fetch = function fetchWithRequiredReceiver(url, options) {
      assert.equal(this, globalThis);
      assert.equal(url, '/volumes/test/ha_volume.bin');
      assert.equal(options.headers.Range, `bytes=0-${compressed.byteLength - 1}`);
      return Promise.resolve(new Response(compressed, { status: 206 }));
    };
    globalThis.tag = receiver.tag;

    const service = new HaVolumeService(makeVolume(nodes));
    const brick = await service.requestBrick(nodes[0]);
    assert.equal(brick[0], 9);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.tag;
  }
});

test('loadHaVolume default fetch preserves the global receiver', async () => {
  const originalFetch = globalThis.fetch;
  const indexBuffer = makeIndexBuffer([{ level: 0 }]);
  const manifest = {
    format: 'mccallum_ha_volume_v1',
    index: { path: 'ha_volume.idx' },
    payload: { path: 'ha_volume.bin' },
    runtime_frame: 'galactic_cartesian_sun_centered',
  };

  try {
    globalThis.fetch = function fetchWithRequiredReceiver(url) {
      assert.equal(this, globalThis);
      if (url === '/volume/manifest.json') {
        return Promise.resolve(Response.json(manifest));
      }
      if (url === '/volume/ha_volume.idx') {
        return Promise.resolve(new Response(indexBuffer));
      }
      throw new Error(`unexpected url ${url}`);
    };

    const service = await loadHaVolume('/volume/manifest.json');
    assert.equal(service.volume.indexUrl, '/volume/ha_volume.idx');
    assert.equal(service.volume.payloadUrl, '/volume/ha_volume.bin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HaVolumeService respects the in-flight request cap', () => {
  const nodes = [
    { index: 0, flags: HA_VOLUME_FLAG_HAS_PAYLOAD, payloadOffset: 0, payloadLength: 1 },
    { index: 1, flags: HA_VOLUME_FLAG_HAS_PAYLOAD, payloadOffset: 1, payloadLength: 1 },
  ];
  const service = new HaVolumeService(makeVolume(nodes), {
    maxInflightRequests: 1,
    fetchImpl: () => new Promise(() => {}),
  });

  assert.ok(service.requestBrick(nodes[0]));
  assert.equal(service.requestBrick(nodes[1]), null);
  assert.equal(service.describe().inflightBricks, 1);
});

test('HaVolumeService treats the resident cache size as a hard request budget', async () => {
  const decoded = new Uint8Array(8 * 8 * 8);
  decoded.fill(5);
  const compressed = gzipSync(decoded);
  const nodes = [
    {
      index: 0,
      flags: HA_VOLUME_FLAG_HAS_PAYLOAD,
      payloadOffset: 0,
      payloadLength: compressed.byteLength,
    },
    {
      index: 1,
      flags: HA_VOLUME_FLAG_HAS_PAYLOAD,
      payloadOffset: compressed.byteLength,
      payloadLength: compressed.byteLength,
    },
  ];
  let fetchCount = 0;
  const service = new HaVolumeService(makeVolume(nodes), {
    maxResidentBricks: 1,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(compressed, { status: 206 });
    },
  });

  assert.equal(service.canRequestBrick(nodes[0]), true);
  await service.requestBrick(nodes[0]);
  assert.equal(service.describe().cachedBricks, 1);
  assert.equal(service.canRequestBrick(nodes[1]), false);
  assert.equal(service.requestBrick(nodes[1]), null);
  assert.equal(fetchCount, 1);
  assert.equal(service.describe().stats.capacitySkipped, 1);
});

test('HaVolumeService does not offer cached or in-flight bricks as new requests', () => {
  const nodes = [
    { index: 0, flags: HA_VOLUME_FLAG_HAS_PAYLOAD, payloadOffset: 0, payloadLength: 1 },
    { index: 1, flags: HA_VOLUME_FLAG_HAS_PAYLOAD, payloadOffset: 1, payloadLength: 1 },
  ];
  const service = new HaVolumeService(makeVolume(nodes), {
    fetchImpl: () => new Promise(() => {}),
  });

  service.cache.set(0, new Uint8Array([1]));
  assert.equal(service.canRequestBrick(nodes[0]), false);
  assert.ok(service.requestBrick(nodes[1]));
  assert.equal(service.canRequestBrick(nodes[1]), false);
});

test('resolveHaVolumeUrl supports haVolumeUrl query override', () => {
  assert.equal(
    resolveHaVolumeUrl('?haVolumeUrl=/custom/manifest.json'),
    '/custom/manifest.json',
  );
});
