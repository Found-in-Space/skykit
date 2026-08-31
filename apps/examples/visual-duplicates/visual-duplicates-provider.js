import { createStarCellKey, decodeMorton3D } from '@found-in-space/star-trees';

import {
  SHARD_HEADER_SIZE,
  STAR_HAS_PAYLOAD,
  STAR_IS_FRONTIER,
  parseShardFromBlock,
  parseShardHeader,
  parseStarHeader,
  shardBlockSize,
} from '../../../packages/star-octree-provider/src/star-octree-format.js';

const HEADER_BLOCK_BYTES = 192;
const SHARD_PREFETCH_BYTES = 65_536;

export function createVisualDuplicatesProvider({ url, parentDatasetId }) {
  const shards = new Map();
  const payloads = new Map();
  const cells = new Map();
  const stats = {
    annotatedCells: 0,
    artifactFetches: 0,
    cellCacheHits: 0,
    missingEntries: 0,
    payloadFetches: 0,
    rangeRequests: 0,
    resolvedEntries: 0,
    shardFetches: 0,
  };
  let headerPromise;
  let artifactPromise;
  let annotatedCellsPromise;
  let indexPromise;

  return {
    ensureHeader,
    preloadArtifact,

    async listAnnotatedCells() {
      if (!annotatedCellsPromise) {
        annotatedCellsPromise = readAnnotatedCells();
        annotatedCellsPromise.catch(() => {
          annotatedCellsPromise = undefined;
        });
      }
      return annotatedCellsPromise;
    },

    async getDuplicatesCell(ref) {
      const normalized = normalizeCellRef(ref);
      if (normalized.datasetId && normalized.datasetId !== parentDatasetId) {
        throw new Error('Visual-duplicates cell lookup belongs to another dataset.');
      }
      return readCell(normalized);
    },

    async getDuplicate(ref) {
      const normalized = normalizeObjectRef(ref);
      if (normalized.datasetId && normalized.datasetId !== parentDatasetId) {
        throw new Error('Visual-duplicates lookup ref belongs to another dataset.');
      }
      const records = await readCell(normalized);
      const record = records?.find((candidate) => candidate.ordinal === normalized.ordinal) ?? null;
      if (record) stats.resolvedEntries += 1;
      else stats.missingEntries += 1;
      return record;
    },

    getSnapshot() {
      return {
        parentDatasetId,
        ready: Boolean(headerPromise),
        url,
        cache: { cells: cells.size, payloads: payloads.size, shards: shards.size },
        stats: { ...stats },
      };
    },

    dispose() {
      shards.clear();
      payloads.clear();
      cells.clear();
      headerPromise = undefined;
      artifactPromise = undefined;
      annotatedCellsPromise = undefined;
      indexPromise = undefined;
    },
  };

  async function ensureHeader() {
    if (!headerPromise) {
      headerPromise = preloadArtifact().then((artifact) => {
        const buffer = artifact.slice(0, HEADER_BLOCK_BYTES);
        const header = parseStarHeader(buffer);
        if (header.artifactKind !== 'sidecar') {
          throw new Error('Visual-duplicates provider requires a sidecar artifact.');
        }
        if (header.sidecarKind !== 'visual-duplicates') {
          throw new Error(`Unexpected sidecar kind: ${header.sidecarKind ?? 'unknown'}.`);
        }
        if (header.parentDatasetUuid !== parentDatasetId) {
          throw new Error(
            `Sidecar parent ${header.parentDatasetUuid ?? 'unknown'} does not match ${parentDatasetId}.`,
          );
        }
        return header;
      });
      headerPromise.catch(() => {
        headerPromise = undefined;
      });
    }
    return headerPromise;
  }

  function preloadArtifact() {
    if (!artifactPromise) {
      stats.artifactFetches += 1;
      artifactPromise = fetch(url).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Visual-duplicates sidecar request failed: ${response.status}.`);
        }
        return response.arrayBuffer();
      });
      artifactPromise.catch(() => {
        artifactPromise = undefined;
      });
    }
    return artifactPromise;
  }

  async function readCell(ref) {
    const header = await ensureHeader();
    const cellKey = createStarCellKey(ref);
    if (cells.has(cellKey)) {
      stats.cellCacheHits += 1;
      return cells.get(cellKey);
    }
    const promise = (async () => {
      const node = await findNode(header, ref);
      if (!node || !(node.flags & STAR_HAS_PAYLOAD) || node.payloadLength <= 0) {
        return null;
      }
      const buffer = await fetchPayload(node);
      const records = JSON.parse(new TextDecoder().decode(buffer));
      if (!Array.isArray(records)) {
        throw new Error(`Visual-duplicates payload ${cellKey} is not an array.`);
      }
      return records;
    })();
    promise.catch(() => cells.delete(cellKey));
    cells.set(cellKey, promise);
    return promise;
  }

  async function readAnnotatedCells() {
    const header = await ensureHeader();
    await preloadIndex(header);
    const root = await loadShard(header.indexOffset, header.version);
    const stack = root.header.entryNodes
      .filter((nodeIndex) => nodeIndex > 0)
      .map((nodeIndex) => root.readRuntimeNode(header, nodeIndex));
    const result = new Set();
    while (stack.length > 0) {
      const node = stack.pop();
      if ((node.flags & STAR_HAS_PAYLOAD) && node.payloadLength > 0) {
        result.add(createStarCellKey(node));
      }
      for (let octant = 0; octant < 8; octant += 1) {
        if ((node.childMask & (1 << octant)) === 0) continue;
        const child = await readChild(header, node, octant);
        if (child) stack.push(child);
      }
    }
    stats.annotatedCells = result.size;
    return result;
  }

  async function preloadIndex(header) {
    if (!indexPromise) {
      indexPromise = (async () => {
        const buffer = await fetchRange(
          header.indexOffset,
          header.indexOffset + header.indexLength - 1,
        );
        let cursor = 0;
        while (cursor + SHARD_HEADER_SIZE <= buffer.byteLength) {
          const offset = header.indexOffset + cursor;
          const shard = parseShardFromBlock(buffer.slice(cursor), offset, header.version);
          if (!shard) {
            throw new Error(`Could not parse sidecar index shard at ${offset}.`);
          }
          shards.set(offset, Promise.resolve(shard));
          cursor += shardBlockSize(
            shard.header.nodeCount,
            shard.header.firstFrontierIndex,
            header.version,
          );
        }
        if (cursor !== buffer.byteLength) {
          throw new Error(`Sidecar index has ${buffer.byteLength - cursor} trailing bytes.`);
        }
      })();
      indexPromise.catch(() => {
        indexPromise = undefined;
      });
    }
    return indexPromise;
  }

  async function findNode(header, ref) {
    const grid = decodeMorton3D(ref.mortonCode, ref.level);
    const target = { ...grid, level: ref.level, mortonCode: ref.mortonCode };
    const root = await loadShard(header.indexOffset, header.version);
    for (const entryIndex of root.header.entryNodes) {
      if (entryIndex <= 0) continue;
      let node = root.readRuntimeNode(header, entryIndex);
      if (!contains(node, target)) continue;
      while (node.level < target.level) {
        const octant = targetOctant(node, target);
        if ((node.childMask & (1 << octant)) === 0) return null;
        node = await readChild(header, node, octant);
        if (!node || !contains(node, target)) return null;
      }
      return node.level === target.level && node.mortonCode === target.mortonCode
        ? node
        : null;
    }
    return null;
  }

  async function readChild(header, node, octant) {
    const shard = await loadShard(node.shardOffset, header.version);
    if (node.flags & STAR_IS_FRONTIER) {
      const continuation = Number(shard.readFrontierContinuation(node.nodeIndex));
      if (!continuation) return null;
      const childShard = await loadShard(continuation, header.version);
      const childIndex = childShard.header.entryNodes[octant];
      return childIndex > 0 ? childShard.readRuntimeNode(header, childIndex) : null;
    }
    if (node.firstChild <= 0) return null;
    const childIndex = node.firstChild + popcount(node.childMask & ((1 << octant) - 1));
    return childIndex <= shard.header.nodeCount
      ? shard.readRuntimeNode(header, childIndex)
      : null;
  }

  function loadShard(offset, version) {
    if (shards.has(offset)) return shards.get(offset);
    stats.shardFetches += 1;
    const promise = (async () => {
      const initial = await fetchRange(offset, offset + SHARD_PREFETCH_BYTES - 1);
      const shardHeader = parseShardHeader(initial.slice(0, SHARD_HEADER_SIZE), offset, version);
      const total = shardBlockSize(
        shardHeader.nodeCount,
        shardHeader.firstFrontierIndex,
        version,
      );
      const buffer = initial.byteLength >= total
        ? initial.slice(0, total)
        : await fetchRange(offset, offset + total - 1);
      const shard = parseShardFromBlock(buffer, offset, version);
      if (!shard) throw new Error(`Could not parse sidecar shard at ${offset}.`);
      return shard;
    })();
    promise.catch(() => shards.delete(offset));
    shards.set(offset, promise);
    return promise;
  }

  function fetchPayload(node) {
    const key = `${node.payloadOffset}:${node.payloadLength}`;
    if (payloads.has(key)) return payloads.get(key);
    stats.payloadFetches += 1;
    const promise = fetchRange(
      node.payloadOffset,
      node.payloadOffset + node.payloadLength - 1,
    ).then(decompressGzip);
    promise.catch(() => payloads.delete(key));
    payloads.set(key, promise);
    return promise;
  }

  async function fetchRange(start, end) {
    stats.rangeRequests += 1;
    const artifact = await preloadArtifact();
    if (start < 0 || end < start || end >= artifact.byteLength) {
      throw new RangeError(
        `Sidecar byte range ${start}-${end} is outside the ${artifact.byteLength}-byte artifact.`,
      );
    }
    return artifact.slice(start, end + 1);
  }
}

function contains(node, target) {
  if (node.level > target.level) return false;
  const divisor = 2 ** (target.level - node.level);
  return (
    Math.floor(target.gridX / divisor) === node.gridX &&
    Math.floor(target.gridY / divisor) === node.gridY &&
    Math.floor(target.gridZ / divisor) === node.gridZ
  );
}

function targetOctant(node, target) {
  const shift = target.level - node.level - 1;
  return (
    ((target.gridX >> shift) & 1) |
    (((target.gridY >> shift) & 1) << 1) |
    (((target.gridZ >> shift) & 1) << 2)
  );
}

function popcount(value) {
  let count = 0;
  for (let bits = value; bits; bits &= bits - 1) count += 1;
  return count;
}

function normalizeObjectRef(ref) {
  if (!ref || typeof ref !== 'object') throw new TypeError('A star object ref is required.');
  const level = Number(ref.level);
  const ordinal = Number(ref.ordinal);
  const mortonCode = String(BigInt(ref.mortonCode));
  if (!Number.isInteger(level) || level < 0 || !Number.isInteger(ordinal) || ordinal < 0) {
    throw new TypeError('Star object ref requires a valid level, mortonCode, and ordinal.');
  }
  return { datasetId: ref.datasetId ?? null, level, mortonCode, ordinal };
}

function normalizeCellRef(ref) {
  if (!ref || typeof ref !== 'object') throw new TypeError('A star cell ref is required.');
  const level = Number(ref.level);
  const mortonCode = String(BigInt(ref.mortonCode));
  if (!Number.isInteger(level) || level < 0) {
    throw new TypeError('Star cell ref requires a valid level and mortonCode.');
  }
  return { datasetId: ref.datasetId ?? null, level, mortonCode };
}

async function decompressGzip(buffer) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip DecompressionStream.');
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
