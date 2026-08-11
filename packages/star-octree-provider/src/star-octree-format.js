import { encodeMorton3D } from '@found-in-space/star-trees';

/**
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {import('./index.d.ts').StarOctreeBootstrapIndex['header']} StarOctreeBootstrapHeader
 */

export const STAR_HEADER_SIZE = 64;
export const STAR_DESCRIPTOR_SIZE = 128;
export const STAR_HEADER_BLOCK_BYTES = STAR_HEADER_SIZE + STAR_DESCRIPTOR_SIZE;
export const STAR_MAGIC = 0x52415453;
export const STAR_DESCRIPTOR_MAGIC = 0x4353444f;
export const STAR_DESCRIPTOR_VERSION = 1;
export const STAR_RENDER_DESCRIPTOR_KIND = 1;
export const STAR_SIDECAR_DESCRIPTOR_KIND = 2;

export const SHARD_MAGIC = 0x5248534f;
export const SHARD_HEADER_SIZE = 80;
export const SHARD_NODE_RECORD_SIZE_V1 = 20;
export const SHARD_NODE_RECORD_SIZE_V2 = 24;
// Kept for callers that explicitly describe the STAR v1 layout.
export const SHARD_NODE_RECORD_SIZE = SHARD_NODE_RECORD_SIZE_V1;
export const SHARD_FRONTIER_REF_SIZE = 8;

export const STAR_HAS_PAYLOAD = 0x01;
export const STAR_HAS_CHILDREN = 0x02;
export const STAR_IS_FRONTIER = 0x04;
export const STAR_IS_TERMINAL = 0x08;
export const STAR_MAX_MORTON_LEVEL = 21;

export const SUPPORTED_STAR_FORMAT_VERSIONS = [1, 2];

/**
 * @typedef {StarOctreeBootstrapHeader & {
 *   datasetUuid?: string | null;
 *   artifactKind?: 'render' | 'sidecar' | null;
 *   parentDatasetUuid?: string | null;
 *   sidecarUuid?: string | null;
 *   sidecarKind?: string | null;
 * }} ParsedStarHeader
 */

/**
 * @typedef {{
 *   offset: number;
 *   version: number;
 *   nodeRecordSize: number;
 *   nodeCount: number;
 *   parentGlobalDepth: number;
 *   parentGridX: number;
 *   parentGridY: number;
 *   parentGridZ: number;
 *   entryNodes: number[];
 *   firstFrontierIndex: number;
 *   nodeTableOffset: number;
 *   frontierTableOffset: number;
 * }} ParsedShardHeader
 */

/**
 * @typedef {{
 *   firstChild: number;
 *   localPath: number;
 *   childMask: number;
 *   localDepth: number;
 *   flags: number;
 *   brightestLevel: number;
 *   payloadOffset: number;
 *   payloadLength: number;
 *   starCount: number | null;
 * }} ShardNodeRecord
 */

/**
 * @param {ArrayBuffer | DataView} input
 * @returns {ParsedStarHeader}
 */
export function parseStarHeader(input) {
  const view = toDataView(input);
  if (view.byteLength < STAR_HEADER_SIZE) {
    throw new Error('stars.octree: truncated STAR header');
  }

  const magic = view.getUint32(0, true);
  if (magic !== STAR_MAGIC) {
    const hint =
      magic === 0x4f44213c
        ? ' - received HTML instead of octree bytes'
        : '';
    throw new Error(`stars.octree: bad STAR magic 0x${magic.toString(16)}${hint}`);
  }

  const version = view.getUint16(4, true);
  if (!SUPPORTED_STAR_FORMAT_VERSIONS.includes(version)) {
    throw new Error(`stars.octree: unsupported STAR version ${version}`);
  }

  const header = {
    version,
    indexOffset: Number(view.getBigUint64(8, true)),
    indexLength: Number(view.getBigUint64(16, true)),
    worldCenterX: view.getFloat32(24, true),
    worldCenterY: view.getFloat32(28, true),
    worldCenterZ: view.getFloat32(32, true),
    worldHalfSize: view.getFloat32(36, true),
    payloadRecordSize: view.getUint16(40, true),
    maxLevel: view.getUint16(42, true),
    magLimit: view.getFloat32(44, true),
  };
  const descriptor = tryParseStarDescriptor(view);

  return descriptor
    ? {
        ...header,
        ...descriptor,
      }
    : header;
}

/**
 * @param {ArrayBuffer | DataView} input
 * @param {number} shardOffset
 * @param {number} [expectedVersion]
 * @returns {ParsedShardHeader}
 */
export function parseShardHeader(input, shardOffset, expectedVersion) {
  const view = toDataView(input);
  if (view.byteLength < SHARD_HEADER_SIZE) {
    throw new Error('OSHR: truncated header');
  }

  const magic = view.getUint32(0, true);
  if (magic !== SHARD_MAGIC) {
    throw new Error(`OSHR: bad magic 0x${magic.toString(16)} at ${shardOffset}`);
  }

  const version = view.getUint16(4, true);
  if (!SUPPORTED_STAR_FORMAT_VERSIONS.includes(version)) {
    throw new Error(`OSHR: unsupported version ${version}`);
  }
  if (expectedVersion != null && version !== expectedVersion) {
    throw new Error(
      `STAR/OSHR version mismatch at ${shardOffset}: STAR=${expectedVersion}, OSHR=${version}`,
    );
  }

  const entryNodes = [];
  for (let index = 0; index < 8; index += 1) {
    entryNodes.push(view.getUint16(36 + index * 2, true));
  }

  return {
    offset: shardOffset,
    version,
    nodeRecordSize: shardNodeRecordSize(version),
    nodeCount: view.getUint16(18, true),
    parentGlobalDepth: view.getInt16(22, true),
    parentGridX: view.getUint32(24, true),
    parentGridY: view.getUint32(28, true),
    parentGridZ: view.getUint32(32, true),
    entryNodes,
    firstFrontierIndex: view.getUint16(52, true),
    nodeTableOffset: Number(view.getBigUint64(54, true)),
    frontierTableOffset: Number(view.getBigUint64(62, true)),
  };
}

/**
 * @param {DataView} tableView
 * @param {number} nodeIndex
 * @param {number} [version]
 * @returns {ShardNodeRecord}
 */
export function readShardNodeRecord(tableView, nodeIndex, version = 1) {
  const recordSize = shardNodeRecordSize(version);
  const offset = (nodeIndex - 1) * recordSize;

  if (nodeIndex <= 0 || offset + recordSize > tableView.byteLength) {
    throw new RangeError(`OSHR: node index ${nodeIndex} is outside the node table`);
  }

  return {
    firstChild: tableView.getUint16(offset, true),
    localPath: tableView.getUint16(offset + 2, true),
    childMask: tableView.getUint8(offset + 4),
    localDepth: tableView.getUint8(offset + 5),
    flags: tableView.getUint8(offset + 6),
    brightestLevel: tableView.getUint8(offset + 7),
    payloadOffset: Number(tableView.getBigUint64(offset + 8, true)),
    payloadLength: tableView.getUint32(offset + 16, true),
    starCount: version === 2 ? tableView.getUint32(offset + 20, true) : null,
  };
}

/**
 * @param {number} version
 */
export function shardNodeRecordSize(version) {
  if (version === 1) return SHARD_NODE_RECORD_SIZE_V1;
  if (version === 2) return SHARD_NODE_RECORD_SIZE_V2;
  throw new Error(`OSHR: unsupported version ${version}`);
}

/**
 * @param {number} parentGridX
 * @param {number} parentGridY
 * @param {number} parentGridZ
 * @param {number} localDepth
 * @param {number} localPath
 * @returns {{ gridX: number; gridY: number; gridZ: number }}
 */
export function decodeLocalGrid(
  parentGridX,
  parentGridY,
  parentGridZ,
  localDepth,
  localPath,
) {
  let gridX = parentGridX;
  let gridY = parentGridY;
  let gridZ = parentGridZ;

  for (let index = 0; index < localDepth; index += 1) {
    const shift = 3 * (localDepth - 1 - index);
    const octant = Math.floor(localPath / 2 ** shift) & 7;
    gridX = gridX * 2 + (octant & 1);
    gridY = gridY * 2 + ((octant >> 1) & 1);
    gridZ = gridZ * 2 + ((octant >> 2) & 1);
  }

  return { gridX, gridY, gridZ };
}

/**
 * @param {ParsedStarHeader | StarOctreeBootstrapHeader} header
 * @param {number} gridX
 * @param {number} gridY
 * @param {number} gridZ
 * @param {number} level
 * @returns {{
 *   mortonCode: string;
 *   centerX: number;
 *   centerY: number;
 *   centerZ: number;
 *   halfSize: number;
 *   level: number;
 *   gridX: number;
 *   gridY: number;
 *   gridZ: number;
 * }}
 */
export function nodeCenterAndHalfSize(header, gridX, gridY, gridZ, level) {
  const cellsPerAxis = 2 ** level;
  const halfSize = header.worldHalfSize / cellsPerAxis;
  const mortonCode = encodeMorton3D(gridX, gridY, gridZ, level).toString(10);

  return {
    mortonCode,
    centerX: header.worldCenterX + (2 * (gridX + 0.5) - cellsPerAxis) * halfSize,
    centerY: header.worldCenterY + (2 * (gridY + 0.5) - cellsPerAxis) * halfSize,
    centerZ: header.worldCenterZ + (2 * (gridZ + 0.5) - cellsPerAxis) * halfSize,
    halfSize,
    level,
    gridX,
    gridY,
    gridZ,
  };
}

/**
 * @param {ParsedStarHeader | StarOctreeBootstrapHeader} header
 * @param {ParsedShardHeader} shardHeader
 * @param {ShardNodeRecord} record
 */
export function runtimeNodeGeometry(header, shardHeader, record) {
  const level = shardHeader.parentGlobalDepth + record.localDepth;
  const { gridX, gridY, gridZ } = decodeLocalGrid(
    shardHeader.parentGridX,
    shardHeader.parentGridY,
    shardHeader.parentGridZ,
    record.localDepth,
    record.localPath,
  );

  return nodeCenterAndHalfSize(header, gridX, gridY, gridZ, level);
}

/**
 * @param {number} shardOffset
 * @param {number} nodeIndex
 */
export function makeNodeKey(shardOffset, nodeIndex) {
  return `${shardOffset}:${nodeIndex}`;
}

/**
 * @param {number} nodeCount
 * @param {number} firstFrontierIndex
 * @param {number} [version]
 */
export function shardBlockSize(nodeCount, firstFrontierIndex, version = 1) {
  const frontierCount =
    firstFrontierIndex > 0 && nodeCount >= firstFrontierIndex
      ? nodeCount - firstFrontierIndex + 1
      : 0;

  return (
    SHARD_HEADER_SIZE +
    nodeCount * shardNodeRecordSize(version) +
    frontierCount * SHARD_FRONTIER_REF_SIZE
  );
}

/**
 * @param {ArrayBuffer} buffer
 * @param {number} shardOffset
 * @param {number} [expectedVersion]
 * @returns {ResolvedStarOctreeShard | null}
 */
export function parseShardFromBlock(buffer, shardOffset, expectedVersion) {
  if (buffer.byteLength < SHARD_HEADER_SIZE) {
    return null;
  }

  const shardHeader = parseShardHeader(
    buffer.slice(0, SHARD_HEADER_SIZE),
    shardOffset,
    expectedVersion,
  );
  const nodeTableStart = SHARD_HEADER_SIZE;
  const nodeTableLength = shardHeader.nodeCount * shardHeader.nodeRecordSize;
  const nodeTableEnd = nodeTableStart + nodeTableLength;

  if (buffer.byteLength < nodeTableEnd) {
    return null;
  }

  let frontierBuffer = null;

  if (
    shardHeader.firstFrontierIndex > 0 &&
    shardHeader.nodeCount >= shardHeader.firstFrontierIndex
  ) {
    const frontierCount = shardHeader.nodeCount - shardHeader.firstFrontierIndex + 1;
    const frontierStart = nodeTableEnd;
    const frontierEnd = frontierStart + frontierCount * SHARD_FRONTIER_REF_SIZE;

    if (buffer.byteLength < frontierEnd) {
      return null;
    }

    frontierBuffer = buffer.slice(frontierStart, frontierEnd);
  }

  return new ResolvedStarOctreeShard(
    shardOffset,
    shardHeader,
    buffer.slice(nodeTableStart, nodeTableEnd),
    frontierBuffer,
  );
}

export class ResolvedStarOctreeShard {
  /**
   * @param {number} shardOffset
   * @param {ParsedShardHeader} header
   * @param {ArrayBuffer} nodeTableBuffer
   * @param {ArrayBuffer | null} frontierBuffer
   */
  constructor(shardOffset, header, nodeTableBuffer, frontierBuffer) {
    this.shardOffset = shardOffset;
    this.header = header;
    this.nodeTable = new DataView(nodeTableBuffer);
    this.frontier =
      frontierBuffer && frontierBuffer.byteLength > 0
        ? new DataView(frontierBuffer)
        : null;
  }

  /**
   * @param {number} nodeIndex
   */
  readNode(nodeIndex) {
    return readShardNodeRecord(this.nodeTable, nodeIndex, this.header.version);
  }

  /**
   * @param {number} nodeIndex
   */
  readFrontierContinuation(nodeIndex) {
    const { firstFrontierIndex } = this.header;
    if (!this.frontier || firstFrontierIndex <= 0) {
      return 0n;
    }

    const slot = nodeIndex - firstFrontierIndex;
    if (slot < 0) {
      return 0n;
    }

    const offset = slot * SHARD_FRONTIER_REF_SIZE;
    if (offset + SHARD_FRONTIER_REF_SIZE > this.frontier.byteLength) {
      return 0n;
    }

    return this.frontier.getBigUint64(offset, true);
  }

  /**
   * @param {ParsedStarHeader | StarOctreeBootstrapHeader} starHeader
   * @param {number} nodeIndex
   * @returns {StarOctreeRuntimeNode}
   */
  readRuntimeNode(starHeader, nodeIndex) {
    const record = this.readNode(nodeIndex);
    const geometry = runtimeNodeGeometry(starHeader, this.header, record);
    const brightestLevel = starHeader.version === 2
      ? record.brightestLevel
      : null;

    if (
      brightestLevel != null &&
      (brightestLevel < geometry.level || brightestLevel > STAR_MAX_MORTON_LEVEL)
    ) {
      throw new Error(
        'OSHR: node brightest level is outside its representable subtree: ' +
        `nodeLevel=${geometry.level}, brightestLevel=${brightestLevel}`,
      );
    }

    return {
      ...geometry,
      flags: record.flags,
      childMask: record.childMask,
      payloadOffset: record.payloadOffset,
      payloadLength: record.payloadLength,
      starCount: record.starCount,
      isTerminal: Boolean(record.flags & STAR_IS_TERMINAL),
      brightestLevel,
      firstChild: record.firstChild,
      localDepth: record.localDepth,
      localPath: record.localPath,
      shardOffset: this.shardOffset,
      nodeIndex,
    };
  }

  /**
   * @param {ParsedStarHeader | StarOctreeBootstrapHeader} starHeader
   * @returns {StarOctreeRuntimeNode[]}
   */
  readRuntimeNodes(starHeader) {
    const nodes = [];

    for (let nodeIndex = 1; nodeIndex <= this.header.nodeCount; nodeIndex += 1) {
      nodes.push(this.readRuntimeNode(starHeader, nodeIndex));
    }

    return nodes;
  }
}

/**
 * @param {ArrayBuffer | DataView} input
 */
function toDataView(input) {
  return input instanceof DataView ? input : new DataView(input);
}

/**
 * @param {DataView} view
 */
function tryParseStarDescriptor(view) {
  if (view.byteLength < STAR_HEADER_BLOCK_BYTES) {
    return null;
  }

  const base = STAR_HEADER_SIZE;
  if (view.getUint32(base, true) !== STAR_DESCRIPTOR_MAGIC) {
    return null;
  }

  const version = view.getUint16(base + 4, true);
  if (version !== STAR_DESCRIPTOR_VERSION) {
    return null;
  }

  const artifactKind = descriptorKindName(view.getUint16(base + 6, true));
  if (!artifactKind) {
    return null;
  }

  return {
    artifactKind,
    datasetUuid: uuidBytesToString(view, base + 8),
    parentDatasetUuid: uuidBytesToString(view, base + 24),
    sidecarUuid: uuidBytesToString(view, base + 40),
    sidecarKind: readFixedUtf8(view, base + 56, 32),
  };
}

/**
 * @param {number} code
 * @returns {'render' | 'sidecar' | null}
 */
function descriptorKindName(code) {
  if (code === STAR_RENDER_DESCRIPTOR_KIND) return 'render';
  if (code === STAR_SIDECAR_DESCRIPTOR_KIND) return 'sidecar';
  return null;
}

/**
 * @param {DataView} view
 * @param {number} byteOffset
 */
function uuidBytesToString(view, byteOffset) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + byteOffset, 16);
  if (bytes.every((byte) => byte === 0)) {
    return null;
  }

  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * @param {DataView} view
 * @param {number} byteOffset
 * @param {number} byteLength
 */
function readFixedUtf8(view, byteOffset, byteLength) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + byteOffset, byteLength);
  const value = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes)
    .replace(/\0+$/, '');
  return value || null;
}
