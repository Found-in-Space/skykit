import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  ERR_META_SIDECAR_INVALID_ARTIFACT,
  ERR_META_SIDECAR_INVALID_KIND,
  ERR_META_SIDECAR_PARENT_MISMATCH,
  META_SIDECAR_DEFAULT,
  createMetaSidecarProviderService,
  deriveMetaSidecarUrlFromRenderUrl,
  metaSidecarEntryDisplayFields,
} from '../index.js';

const HEADER_SIZE = 64;
const DESCRIPTOR_SIZE = 128;
const STAR_MAGIC = 0x52415453;
const SHARD_MAGIC = 0x5248534f;
const SHARD_HEADER_SIZE = 80;
const SHARD_NODE_SIZE = 20;
const PARENT_UUID = 'c56103e6-ad4c-41f9-be06-048b48ec632b';
const OTHER_UUID = '11111111-1111-4111-8111-111111111111';
const SIDECAR_UUID = 'feea8a27-f1ac-451e-9ce1-44c8313ed837';

test('deriveMetaSidecarUrlFromRenderUrl mirrors render octree names', () => {
  assert.equal(deriveMetaSidecarUrlFromRenderUrl(null), META_SIDECAR_DEFAULT);
  assert.equal(
    deriveMetaSidecarUrlFromRenderUrl('https://example.test/data/stars.octree?cache=1'),
    'https://example.test/data/stars.meta.octree?cache=1',
  );
  assert.equal(
    deriveMetaSidecarUrlFromRenderUrl('https://example.test/data/stars'),
    'https://example.test/data/stars.meta.octree',
  );
});

test('meta sidecar display fields normalize catalog identifiers and labels', () => {
  assert.deepEqual(metaSidecarEntryDisplayFields({
    proper_name: ' Sirius ',
    bayer: 'alpha',
    constellation: 'CMa',
    hd: 48915,
    hip_id: 32349,
    gaia_source_id: '2947050466531873024',
  }), {
    properName: 'Sirius',
    bayer: 'alpha CMa',
    hd: '48915',
    hip: '32349',
    gaia: '2947050466531873024',
    primaryLabel: 'Sirius',
  });

  assert.equal(metaSidecarEntryDisplayFields({ bayer: 'beta Ori' }).primaryLabel, 'beta Ori');
  assert.equal(metaSidecarEntryDisplayFields({ hd: 39801 }).primaryLabel, 'HD 39801');
  assert.equal(metaSidecarEntryDisplayFields({ hip_id: 27989 }).primaryLabel, 'HIP 27989');
  assert.equal(metaSidecarEntryDisplayFields({ gaia_source_id: '3131481481815810432' }).primaryLabel, 'Gaia 3131481481815810432');
  assert.deepEqual(metaSidecarEntryDisplayFields({ source: 'hip', source_id: 123 }), {
    properName: '',
    bayer: '',
    hd: '',
    hip: '123',
    gaia: '',
    primaryLabel: 'HIP 123',
  });
  assert.equal(metaSidecarEntryDisplayFields({ source: 'wise', source_id: 'J1' }).primaryLabel, 'wise J1');
});

test('meta sidecar provider resolves raw metadata from URL-backed sidecar cells', async (t) => {
  const fixture = createMetaSidecarFixture();
  const requests = [];
  installMockFetch(t, fixture.bytes, requests);
  const provider = createMetaSidecarProviderService({
    id: 'meta-a',
    parentDatasetId: PARENT_UUID,
    persistentCache: 'off',
    url: 'https://example.test/stars.meta.octree',
  });

  const entry = await provider.getMeta({
    datasetId: PARENT_UUID,
    level: 1,
    mortonCode: '5',
    ordinal: 0,
  });

  assert.equal(provider.describe().providerType, 'meta-sidecar');
  assert.equal(provider.describe().sidecarId, SIDECAR_UUID);
  assert.deepEqual(provider.describe().produces, ['meta-entry', 'meta-cell']);
  assert.equal(provider.getSnapshot().ready, true);
  assert.deepEqual(entry, {
    proper_name: 'Sirius',
    bayer: 'alpha',
    constellation: 'CMa',
    hd: 48915,
    hip_id: 32349,
    gaia_source_id: '2947050466531873024',
    custom_payload: { source: 'fixture' },
  });

  assert.deepEqual(await provider.getMeta({
    datasetId: PARENT_UUID,
    level: 1,
    mortonCode: '5',
    ordinal: 1,
  }), {
    source: 'hip',
    source_id: 123,
  });
  assert.deepEqual(await provider.getMetaCell({
    datasetId: PARENT_UUID,
    level: 1,
    mortonCode: '5',
  }), [
    {
      proper_name: 'Sirius',
      bayer: 'alpha',
      constellation: 'CMa',
      hd: 48915,
      hip_id: 32349,
      gaia_source_id: '2947050466531873024',
      custom_payload: { source: 'fixture' },
    },
    {
      source: 'hip',
      source_id: 123,
    },
  ]);
  assert.equal(provider.getSnapshot().stats.cellCacheHits, 2);
  assert.equal(provider.getSnapshot().stats.payloadFetches, 1);
  assert.equal(requests.some((request) => request.start === fixture.payloadOffset), true);
});

test('meta sidecar provider returns null for missing cells and ordinals', async (t) => {
  installMockFetch(t, createMetaSidecarFixture().bytes, []);
  const provider = createMetaSidecarProviderService({
    parentDatasetId: PARENT_UUID,
    persistentCache: 'off',
    url: 'https://example.test/stars.meta.octree',
  });

  assert.equal(await provider.getMeta({
    datasetId: PARENT_UUID,
    level: 1,
    mortonCode: '0',
    ordinal: 0,
  }), null);
  assert.equal(await provider.getMeta({
    datasetId: PARENT_UUID,
    level: 1,
    mortonCode: '5',
    ordinal: 20,
  }), null);
  assert.equal(await provider.getMetaCell({
    datasetId: PARENT_UUID,
    level: 1,
    mortonCode: '0',
  }), null);
  assert.equal(provider.getSnapshot().stats.missingEntries, 2);
  assert.equal(provider.getSnapshot().stats.missingCells, 1);
});

test('meta sidecar provider rejects mismatched object refs and parents', async (t) => {
  installMockFetch(t, createMetaSidecarFixture().bytes, []);
  const provider = createMetaSidecarProviderService({
    parentDatasetId: PARENT_UUID,
    persistentCache: 'off',
    url: 'https://example.test/stars.meta.octree',
  });

  await assert.rejects(
    () => provider.getMeta({
      datasetId: OTHER_UUID,
      level: 1,
      mortonCode: '5',
      ordinal: 0,
    }),
    (error) => error?.code === ERR_META_SIDECAR_PARENT_MISMATCH,
  );
  assert.equal(provider.getSnapshot().stats.parentMismatches, 1);

  const parentMismatch = createMetaSidecarProviderService({
    parentDatasetId: OTHER_UUID,
    persistentCache: 'off',
    url: 'https://example.test/stars.meta.octree',
  });
  await assert.rejects(
    () => parentMismatch.getMetaCell({
      datasetId: OTHER_UUID,
      level: 1,
      mortonCode: '5',
    }),
    (error) => error?.code === ERR_META_SIDECAR_PARENT_MISMATCH,
  );
});

test('meta sidecar provider rejects non-sidecar artifacts', async (t) => {
  installMockFetch(t, createMetaSidecarFixture({ artifactKind: 'render' }).bytes, []);
  const renderArtifact = createMetaSidecarProviderService({
    parentDatasetId: PARENT_UUID,
    persistentCache: 'off',
    url: 'https://example.test/stars.octree',
  });
  await assert.rejects(
    () => renderArtifact.getMeta({
      datasetId: PARENT_UUID,
      level: 1,
      mortonCode: '5',
      ordinal: 0,
    }),
    (error) => error?.code === ERR_META_SIDECAR_INVALID_ARTIFACT,
  );
});

test('meta sidecar provider rejects non-meta sidecars', async (t) => {
  installMockFetch(t, createMetaSidecarFixture({ sidecarKind: 'other' }).bytes, []);
  const otherSidecar = createMetaSidecarProviderService({
    parentDatasetId: PARENT_UUID,
    persistentCache: 'off',
    url: 'https://example.test/stars.other.octree',
  });
  await assert.rejects(
    () => otherSidecar.getMeta({
      datasetId: PARENT_UUID,
      level: 1,
      mortonCode: '5',
      ordinal: 0,
    }),
    (error) => error?.code === ERR_META_SIDECAR_INVALID_KIND,
  );
});

function createMetaSidecarFixture({
  artifactKind = 'sidecar',
  sidecarKind = 'meta',
  parentUuid = PARENT_UUID,
} = {}) {
  const entries = [
    {
      proper_name: 'Sirius',
      bayer: 'alpha',
      constellation: 'CMa',
      hd: 48915,
      hip_id: 32349,
      gaia_source_id: '2947050466531873024',
      custom_payload: { source: 'fixture' },
    },
    {
      source: 'hip',
      source_id: 123,
    },
  ];
  const payload = gzipSync(new TextEncoder().encode(JSON.stringify(entries)));
  const indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE;
  const rootShardLength = SHARD_HEADER_SIZE + SHARD_NODE_SIZE * 2;
  const payloadOffset = indexOffset + rootShardLength;
  const rootShard = createShardBytes({
    nodes: [
      createShardNodeRecord({
        childMask: 1 << 5,
        firstChild: 2,
        flags: 0,
        localDepth: 1,
        localPath: 0,
      }),
      createShardNodeRecord({
        flags: 1,
        localDepth: 2,
        localPath: 5,
        payloadLength: payload.length,
        payloadOffset,
      }),
    ],
  });
  const header = createStarHeaderBytes({
    indexLength: rootShard.length,
    indexOffset,
    maxLevel: 1,
  });
  const descriptor = createOdscDescriptorBytes({
    artifactKind,
    datasetUuid: artifactKind === 'render' ? parentUuid : zeroUuid(),
    parentUuid,
    sidecarKind,
    sidecarUuid: SIDECAR_UUID,
  });

  return {
    bytes: concatBytes([header, descriptor, rootShard, payload]),
    payloadOffset,
  };
}

function createStarHeaderBytes({
  indexOffset,
  indexLength,
  maxLevel,
}) {
  const bytes = new Uint8Array(HEADER_SIZE);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, STAR_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setBigUint64(8, BigInt(indexOffset), true);
  view.setBigUint64(16, BigInt(indexLength), true);
  view.setFloat32(24, 0, true);
  view.setFloat32(28, 0, true);
  view.setFloat32(32, 0, true);
  view.setFloat32(36, 100, true);
  view.setUint16(40, 16, true);
  view.setUint16(42, maxLevel, true);
  view.setFloat32(44, 6.5, true);

  return bytes;
}

function createOdscDescriptorBytes({
  artifactKind,
  datasetUuid,
  parentUuid,
  sidecarKind,
  sidecarUuid,
}) {
  const bytes = new Uint8Array(DESCRIPTOR_SIZE);
  const view = new DataView(bytes.buffer);

  bytes.set(new TextEncoder().encode('ODSC'), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, artifactKind === 'sidecar' ? 2 : 1, true);
  bytes.set(uuidStringToBytes(datasetUuid), 8);
  bytes.set(uuidStringToBytes(parentUuid), 24);
  bytes.set(uuidStringToBytes(sidecarUuid), 40);
  bytes.set(new TextEncoder().encode(sidecarKind).slice(0, 32), 56);

  return bytes;
}

function createShardBytes({
  nodes,
  parentGlobalDepth = -1,
  parentGridX = 0,
  parentGridY = 0,
  parentGridZ = 0,
}) {
  const bytes = new Uint8Array(SHARD_HEADER_SIZE + nodes.length * SHARD_NODE_SIZE);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, SHARD_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(18, nodes.length, true);
  view.setInt16(22, parentGlobalDepth, true);
  view.setUint32(24, parentGridX, true);
  view.setUint32(28, parentGridY, true);
  view.setUint32(32, parentGridZ, true);
  view.setUint16(36, 1, true);
  view.setBigUint64(54, BigInt(SHARD_HEADER_SIZE), true);
  view.setBigUint64(62, BigInt(SHARD_HEADER_SIZE + nodes.length * SHARD_NODE_SIZE), true);

  nodes.forEach((node, index) => {
    writeShardNodeRecord(view, SHARD_HEADER_SIZE + index * SHARD_NODE_SIZE, node);
  });

  return bytes;
}

function createShardNodeRecord(overrides = {}) {
  return {
    childMask: 0,
    firstChild: 0,
    flags: 0,
    localDepth: 1,
    localPath: 0,
    payloadLength: 0,
    payloadOffset: 0,
    reserved: 0,
    ...overrides,
  };
}

function writeShardNodeRecord(view, offset, node) {
  view.setUint16(offset, node.firstChild, true);
  view.setUint16(offset + 2, node.localPath, true);
  view.setUint8(offset + 4, node.childMask);
  view.setUint8(offset + 5, node.localDepth);
  view.setUint8(offset + 6, node.flags);
  view.setUint8(offset + 7, node.reserved ?? 0);
  view.setBigUint64(offset + 8, BigInt(node.payloadOffset), true);
  view.setUint32(offset + 16, node.payloadLength, true);
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function installMockFetch(t, fileBytes, requests) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function mockFetch(url, options = {}) {
    const headers = options.headers;
    const rangeHeader =
      headers instanceof Headers
        ? headers.get('Range') ?? ''
        : headers?.Range ?? '';
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      throw new Error(`Unexpected range header: ${rangeHeader}`);
    }

    const start = Number(match[1]);
    const end = Number(match[2]);
    requests.push({ url, start, end });
    const slice = fileBytes.slice(start, end + 1);

    return {
      ok: true,
      status: 206,
      async arrayBuffer() {
        return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
      },
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function uuidStringToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);

  for (let index = 0; index < 16; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return out;
}

function zeroUuid() {
  return '00000000-0000-0000-0000-000000000000';
}
