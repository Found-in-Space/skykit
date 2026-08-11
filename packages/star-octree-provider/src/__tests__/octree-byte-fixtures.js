export const HEADER_SIZE = 64;
export const DESCRIPTOR_SIZE = 128;
export const STAR_MAGIC = 0x52415453;
export const SHARD_MAGIC = 0x5248534f;
export const SHARD_HEADER_SIZE = 80;
export const SHARD_NODE_SIZE = 20;
export const SHARD_NODE_SIZE_V2 = 24;
export const FRONTIER_REF_SIZE = 8;

export function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

export function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function createMockFetch(fileBytes, requests) {
  return async function mockFetch(url, options = {}) {
    const rangeHeader = options.headers?.Range ?? '';
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
        return toArrayBuffer(slice);
      },
    };
  };
}

export function uuidStringToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);

  for (let index = 0; index < 16; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return out;
}

export function createOdscDescriptorBytes({
  datasetUuid = '00000000-0000-0000-0000-000000000000',
  parentUuid = '00000000-0000-0000-0000-000000000000',
  sidecarUuid = '00000000-0000-0000-0000-000000000000',
  artifactKind = 'render',
  sidecarKind = '',
} = {}) {
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

export function createStarHeaderBytes({
  version = 1,
  magic = STAR_MAGIC,
  indexOffset = HEADER_SIZE + DESCRIPTOR_SIZE,
  indexLength = 100,
  worldCenterX = 0,
  worldCenterY = 0,
  worldCenterZ = 0,
  worldHalfSize = 100,
  payloadRecordSize = 16,
  maxLevel = 1,
  magLimit = 6.5,
} = {}) {
  const bytes = new Uint8Array(HEADER_SIZE);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, magic, true);
  view.setUint16(4, version, true);
  view.setBigUint64(8, BigInt(indexOffset), true);
  view.setBigUint64(16, BigInt(indexLength), true);
  view.setFloat32(24, worldCenterX, true);
  view.setFloat32(28, worldCenterY, true);
  view.setFloat32(32, worldCenterZ, true);
  view.setFloat32(36, worldHalfSize, true);
  view.setUint16(40, payloadRecordSize, true);
  view.setUint16(42, maxLevel, true);
  view.setFloat32(44, magLimit, true);

  return bytes;
}

export function createShardBytes({
  version = 1,
  parentGlobalDepth = -1,
  parentGridX = 0,
  parentGridY = 0,
  parentGridZ = 0,
  entryNodes = [1, 0, 0, 0, 0, 0, 0, 0],
  nodes = [createShardNodeRecord()],
  firstFrontierIndex = 0,
  frontierOffsets = [],
} = {}) {
  const nodeSize = version === 2 ? SHARD_NODE_SIZE_V2 : SHARD_NODE_SIZE;
  const frontierCount =
    firstFrontierIndex > 0 && nodes.length >= firstFrontierIndex
      ? nodes.length - firstFrontierIndex + 1
      : 0;
  const bytes = new Uint8Array(
    SHARD_HEADER_SIZE +
      nodes.length * nodeSize +
      frontierCount * FRONTIER_REF_SIZE,
  );
  const view = new DataView(bytes.buffer);

  view.setUint32(0, SHARD_MAGIC, true);
  view.setUint16(4, version, true);
  view.setUint16(18, nodes.length, true);
  view.setInt16(22, parentGlobalDepth, true);
  view.setUint32(24, parentGridX, true);
  view.setUint32(28, parentGridY, true);
  view.setUint32(32, parentGridZ, true);

  for (let index = 0; index < 8; index += 1) {
    view.setUint16(36 + index * 2, entryNodes[index] ?? 0, true);
  }

  view.setUint16(52, firstFrontierIndex, true);
  view.setBigUint64(54, BigInt(SHARD_HEADER_SIZE), true);
  view.setBigUint64(
    62,
    BigInt(SHARD_HEADER_SIZE + nodes.length * nodeSize),
    true,
  );

  nodes.forEach((node, index) => {
    writeShardNodeRecord(
      view,
      SHARD_HEADER_SIZE + index * nodeSize,
      node,
      version,
    );
  });

  for (let index = 0; index < frontierCount; index += 1) {
    view.setBigUint64(
      SHARD_HEADER_SIZE + nodes.length * nodeSize + index * FRONTIER_REF_SIZE,
      BigInt(frontierOffsets[index] ?? 0),
      true,
    );
  }

  return bytes;
}

export function createShardNodeRecord(overrides = {}) {
  return {
    firstChild: 0,
    localPath: 0,
    childMask: 0,
    localDepth: 1,
    flags: 0,
    brightestLevel: 0,
    payloadOffset: 0,
    payloadLength: 0,
    starCount: 0,
    ...overrides,
  };
}

function writeShardNodeRecord(view, offset, node, version) {
  view.setUint16(offset, node.firstChild, true);
  view.setUint16(offset + 2, node.localPath, true);
  view.setUint8(offset + 4, node.childMask);
  view.setUint8(offset + 5, node.localDepth);
  view.setUint8(offset + 6, node.flags);
  view.setUint8(offset + 7, node.brightestLevel ?? 0);
  view.setBigUint64(offset + 8, BigInt(node.payloadOffset), true);
  view.setUint32(offset + 16, node.payloadLength, true);
  if (version === 2) {
    view.setUint32(offset + 20, node.starCount ?? 0, true);
  }
}
