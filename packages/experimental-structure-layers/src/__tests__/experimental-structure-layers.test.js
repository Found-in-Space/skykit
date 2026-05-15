import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  createDensityFieldMaterialProfile,
  createDustMapNgData3DTexture,
  createHaTiledVolumeLayer,
  createHaTiledVolumeMaterial,
  DUST_MAP_NG_HEADER_BYTES,
  EXPERIMENTAL_STRUCTURE_SCENE_SCALE,
  getHaTiledVolumeBrickBounds,
  HA_TILED_LEVEL_HEADER_BYTES,
  HA_TILED_LEVEL_MAGIC,
  HA_TILED_LEVEL_RECORD_BYTES,
  parseHaTiledLevelBuffer,
  resolveHaTiledVolumeLevelIds,
  resolveHaTiledVolumeUrl,
  loadDustMapNg,
} from '../index.js';

test('parses a synthetic H-alpha tiled level buffer', () => {
  const buffer = createHaLevelBuffer();
  const level = parseHaTiledLevelBuffer(buffer, {
    levelId: 'l7',
    sourceUrl: 'https://example.test/l7.bin',
  });

  assert.equal(level.id, 'l7');
  assert.equal(level.url, 'https://example.test/l7.bin');
  assert.equal(level.headerBytes, HA_TILED_LEVEL_HEADER_BYTES);
  assert.equal(level.recordBytes, HA_TILED_LEVEL_RECORD_BYTES);
  assert.equal(level.brickCount, 1);
  assert.equal(level.tileGridSize, 1);
  assert.equal(level.dimension, 4);
  assert.equal(level.textureSampleSize, 4);
  assert.equal(level.tileHaloCells, 0);
  assert.equal(level.bricks[0].slotIndex, 0);
  assert.equal(level.bricks[0].encodedMax, 42);
  assert.equal(level.bricks[0].payloadOffset, 160);
  assert.equal(level.bricks[0].payloadLength, 12);
});

test('rejects malformed H-alpha tiled buffers clearly', () => {
  assert.throws(
    () => parseHaTiledLevelBuffer(new ArrayBuffer(8)),
    /File too small for H-alpha tiled level header/,
  );

  const buffer = createHaLevelBuffer();
  new Uint8Array(buffer, 0, 1)[0] = 0x58;
  assert.throws(
    () => parseHaTiledLevelBuffer(buffer),
    /Bad H-alpha tiled level magic/,
  );
});

test('resolves H-alpha URL and level ids from query parameters', () => {
  assert.equal(
    resolveHaTiledVolumeUrl('?haVolumeUrl=https%3A%2F%2Fexample.test%2Fmanifest.json'),
    'https://example.test/manifest.json',
  );
  assert.deepEqual(
    resolveHaTiledVolumeLevelIds('?haInitialLevel=3&haDisplayLevel=0'),
    { initialLevelId: 'l3', finalLevelId: 'l0' },
  );
  assert.deepEqual(
    resolveHaTiledVolumeLevelIds({ initialLevelDefault: 2, finalLevelDefault: 'l1' }),
    { initialLevelId: 'l2', finalLevelId: 'l1' },
  );
});

test('computes H-alpha brick bounds from volume metadata', () => {
  const level = parseHaTiledLevelBuffer(createHaLevelBuffer());
  const bounds = getHaTiledVolumeBrickBounds({
    manifest: {},
    worldBoundsPc: level.worldBoundsPc,
    tileGridSize: level.tileGridSize,
  }, level.bricks[0]);

  assert.deepEqual(bounds, {
    minX: -2,
    maxX: 2,
    minY: -3,
    maxY: 3,
    minZ: -4,
    maxZ: 4,
  });
});

test('parses Dust Map NG through fetch and creates a Three Data3DTexture', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => createDustBuffer(),
  });
  try {
    const map = await loadDustMapNg('https://example.test/dust.bin');
    assert.equal(map.nx, 2);
    assert.equal(map.ny, 2);
    assert.equal(map.nz, 1);
    assert.equal(map.cellCount, 4);
    assert.deepEqual(Array.from(map.u8), [1, 2, 3, 4]);

    const texture = createDustMapNgData3DTexture(map);
    assert.ok(texture instanceof THREE.Data3DTexture);
    assert.equal(texture.image.width, 2);
    assert.equal(texture.image.height, 2);
    assert.equal(texture.image.depth, 1);
    texture.dispose();
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('rejects malformed Dust Map NG buffers clearly', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(DUST_MAP_NG_HEADER_BYTES - 1),
  });
  try {
    await assert.rejects(
      () => loadDustMapNg('https://example.test/bad-dust.bin'),
      /File too small for dust_map_ng.bin header/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('creates Three material and layer factories without a renderer', () => {
  const material = createHaTiledVolumeMaterial();
  assert.ok(material instanceof THREE.ShaderMaterial);
  assert.equal(material.uniforms.uSceneScale.value, EXPERIMENTAL_STRUCTURE_SCENE_SCALE);
  material.dispose();

  const density = createDensityFieldMaterialProfile();
  assert.ok(density.material instanceof THREE.ShaderMaterial);
  density.updateUniforms({
    cameraWorldPosition: new THREE.Vector3(1, 2, 3),
    state: { densityPointSize: 4, densityAlpha: 0.2, starFieldScale: 0.5 },
  });
  assert.equal(density.material.uniforms.uPointSize.value, 4);
  assert.equal(density.material.uniforms.uAlpha.value, 0.2);
  assert.equal(density.material.uniforms.uScale.value, 0.5);
  density.dispose();

  const layer = createHaTiledVolumeLayer({ id: 'test-ha-layer' });
  assert.equal(layer.id, 'test-ha-layer');
  assert.ok(layer.group instanceof THREE.Group);
  assert.equal(layer.getStats().status, 'idle');
  layer.dispose({});
});

function createHaLevelBuffer() {
  const buffer = new ArrayBuffer(HA_TILED_LEVEL_HEADER_BYTES + HA_TILED_LEVEL_RECORD_BYTES);
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  for (let i = 0; i < HA_TILED_LEVEL_MAGIC.length; i += 1) {
    bytes[i] = HA_TILED_LEVEL_MAGIC.charCodeAt(i);
  }
  dv.setUint16(8, 1, true);
  dv.setUint16(10, HA_TILED_LEVEL_HEADER_BYTES, true);
  dv.setUint32(12, HA_TILED_LEVEL_RECORD_BYTES, true);
  dv.setUint32(16, 1, true);
  dv.setUint16(20, 7, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 4, true);
  dv.setUint32(28, 4, true);
  dv.setUint32(32, 0, true);
  dv.setFloat32(36, 255, true);
  dv.setFloat32(40, -2, true);
  dv.setFloat32(44, 2, true);
  dv.setFloat32(48, -3, true);
  dv.setFloat32(52, 3, true);
  dv.setFloat32(56, -4, true);
  dv.setFloat32(60, 4, true);
  dv.setFloat32(64, -2, true);
  dv.setFloat32(68, 2, true);
  dv.setFloat32(72, -3, true);
  dv.setFloat32(76, 3, true);
  dv.setFloat32(80, -4, true);
  dv.setFloat32(84, 4, true);
  dv.setBigUint64(88, 160n, true);
  dv.setBigUint64(96, 172n, true);
  dv.setBigUint64(104, 12n, true);
  dv.setBigUint64(112, 64n, true);

  const off = HA_TILED_LEVEL_HEADER_BYTES;
  dv.setUint32(off, 0, true);
  dv.setUint16(off + 4, 0, true);
  dv.setUint16(off + 6, 0, true);
  dv.setUint16(off + 8, 0, true);
  dv.setUint8(off + 12, 42);
  dv.setUint8(off + 13, 1);
  dv.setUint32(off + 16, 7, true);
  dv.setBigUint64(off + 20, 160n, true);
  dv.setUint32(off + 28, 12, true);
  return buffer;
}

function createDustBuffer() {
  const voxelCount = 4;
  const buffer = new ArrayBuffer(DUST_MAP_NG_HEADER_BYTES + voxelCount);
  const dv = new DataView(buffer);
  dv.setUint32(0, 2, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, 1, true);
  dv.setFloat32(12, 9, true);
  dv.setFloat32(16, -1, true);
  dv.setFloat32(20, 1, true);
  dv.setFloat32(24, -2, true);
  dv.setFloat32(28, 2, true);
  dv.setFloat32(32, -3, true);
  dv.setFloat32(36, 3, true);
  new Uint8Array(buffer, DUST_MAP_NG_HEADER_BYTES).set([1, 2, 3, 4]);
  return buffer;
}
