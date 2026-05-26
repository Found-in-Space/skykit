import {
  createStarCellKey,
  decodeMorton3D,
  encodeMorton3D,
} from '@found-in-space/star-trees';

/**
 * @typedef {import('@found-in-space/star-trees').StarObjectRef} StarObjectRef
 * @typedef {import('./index.d.ts').MetaSidecarCellRef} MetaSidecarCellRef
 * @typedef {import('./index.d.ts').MetaSidecarEntry} MetaSidecarEntry
 * @typedef {import('./index.d.ts').MetaSidecarProviderDescriptor} MetaSidecarProviderDescriptor
 * @typedef {import('./index.d.ts').MetaSidecarProviderService} MetaSidecarProviderService
 * @typedef {import('./index.d.ts').MetaSidecarProviderServiceOptions} MetaSidecarProviderServiceOptions
 * @typedef {import('./index.d.ts').MetaSidecarProviderSnapshot} MetaSidecarProviderSnapshot
 */

export const META_SIDECAR_c56103 =
  'https://data.foundin.space/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.meta.octree';
export const META_SIDECAR_DEFAULT = META_SIDECAR_c56103;

export const ERR_META_SIDECAR_PARENT_MISMATCH =
  'ERR_META_SIDECAR_PARENT_MISMATCH';
export const ERR_META_SIDECAR_INVALID_ARTIFACT =
  'ERR_META_SIDECAR_INVALID_ARTIFACT';
export const ERR_META_SIDECAR_INVALID_KIND =
  'ERR_META_SIDECAR_INVALID_KIND';

/**
 * @typedef {{
 *   properName: string;
 *   bayer: string;
 *   hd: string;
 *   hip: string;
 *   gaia: string;
 *   primaryLabel: string;
 * }} MetaSidecarDisplayFields
 */

const HEADER_SIZE = 64;
const DESCRIPTOR_SIZE = 128;
const HEADER_BLOCK_BYTES = HEADER_SIZE + DESCRIPTOR_SIZE;
const DESCRIPTOR_MAGIC = 0x4353444f;
const DESCRIPTOR_VERSION = 1;
const RENDER_DESCRIPTOR_KIND = 1;
const SIDECAR_DESCRIPTOR_KIND = 2;
const STAR_MAGIC = 0x52415453;
const SHARD_MAGIC = 0x5248534f;
const SHARD_HEADER_SIZE = 80;
const SHARD_NODE_SIZE = 20;
const FRONTIER_REF_SIZE = 8;
const STAR_HAS_PAYLOAD = 0x01;
const STAR_IS_FRONTIER = 0x04;
const DEFAULT_SHARD_PREFETCH_BYTES = 65_536;
const PERSISTENT_CACHE_NAME = 'skykit-meta-sidecar-provider-alpha-v1';

/**
 * @typedef {{
 *   version: number;
 *   indexOffset: number;
 *   indexLength: number;
 *   worldCenterX: number;
 *   worldCenterY: number;
 *   worldCenterZ: number;
 *   worldHalfSize: number;
 *   payloadRecordSize: number;
 *   maxLevel: number;
 *   magLimit: number;
 *   artifactKind?: 'render' | 'sidecar' | null;
 *   datasetUuid?: string | null;
 *   parentDatasetUuid?: string | null;
 *   sidecarUuid?: string | null;
 *   sidecarKind?: string | null;
 * }} ParsedStarHeader
 */

/**
 * @typedef {{
 *   offset: number;
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
 *   reserved: number;
 *   payloadOffset: number;
 *   payloadLength: number;
 * }} ShardNodeRecord
 */

/**
 * @typedef {{
 *   mortonCode: string;
 *   centerX: number;
 *   centerY: number;
 *   centerZ: number;
 *   halfSize: number;
 *   level: number;
 *   gridX: number;
 *   gridY: number;
 *   gridZ: number;
 *   flags: number;
 *   childMask: number;
 *   payloadOffset: number;
 *   payloadLength: number;
 *   firstChild: number;
 *   localDepth: number;
 *   localPath: number;
 *   shardOffset: number;
 *   nodeIndex: number;
 * }} SidecarRuntimeNode
 */

/**
 * @typedef {{
 *   level: number;
 *   mortonCode: string;
 *   gridX: number;
 *   gridY: number;
 *   gridZ: number;
 * }} TargetCell
 */

/**
 * @typedef {{
 *   headerFetches: number;
 *   headerCacheHits: number;
 *   shardFetches: number;
 *   shardCacheHits: number;
 *   payloadFetches: number;
 *   payloadCacheHits: number;
 *   cellCacheHits: number;
 *   resolvedEntries: number;
 *   missingEntries: number;
 *   resolvedCells: number;
 *   missingCells: number;
 *   parentMismatches: number;
 *   rangeRequests: number;
 *   bytesRequested: number;
 *   persistentCacheHits: number;
 *   fetchTimeMs: number;
 * }} MetaSidecarStats
 */

let nextProviderId = 1;

/**
 * @param {string | null | undefined} renderUrl
 */
export function deriveMetaSidecarUrlFromRenderUrl(renderUrl) {
  const normalizedUrl = normalizeNonEmptyString(renderUrl);
  if (!normalizedUrl || normalizedUrl === renderOctreeDefaultUrl()) {
    return META_SIDECAR_DEFAULT;
  }

  const queryIndex = normalizedUrl.indexOf('?');
  const base = queryIndex >= 0 ? normalizedUrl.slice(0, queryIndex) : normalizedUrl;
  const query = queryIndex >= 0 ? normalizedUrl.slice(queryIndex) : '';
  const slashIndex = base.lastIndexOf('/');
  const directory = slashIndex >= 0 ? base.slice(0, slashIndex + 1) : '';
  const fileName = slashIndex >= 0 ? base.slice(slashIndex + 1) : base;
  const dotIndex = fileName.lastIndexOf('.');

  if (dotIndex < 0) {
    return `${directory}${fileName}.meta.octree${query}`;
  }

  return `${directory}${fileName.slice(0, dotIndex)}.meta${fileName.slice(dotIndex)}${query}`;
}

/**
 * @param {MetaSidecarProviderServiceOptions} options
 * @returns {MetaSidecarProviderService}
 */
export function createMetaSidecarProviderService(options) {
  validateOptions(options);

  const providerId = options.id ?? `meta-sidecar-provider-${nextProviderId}`;
  nextProviderId += 1;
  const parentDatasetId = options.parentDatasetId.trim();
  const url = options.url.trim();
  const sidecarKind = 'meta';
  const stats = createInitialStats();
  const rangeSource = createUrlRangeSource({
    persistentCache: options.persistentCache,
    stats,
    url,
  });
  /** @type {Promise<ParsedStarHeader> | null} */
  let headerPromise = null;
  /** @type {ParsedStarHeader | null} */
  let resolvedHeader = null;
  /** @type {Map<number, Promise<ResolvedSidecarShard>>} */
  const shardCache = new Map();
  /** @type {Map<string, Promise<ArrayBuffer>>} */
  const payloadCache = new Map();
  /** @type {Map<string, Promise<MetaSidecarEntry[] | null>>} */
  const cellCache = new Map();
  let disposed = false;

  return {
    get id() {
      return providerId;
    },

    describe() {
      assertActive();
      return {
        id: providerId,
        providerType: 'meta-sidecar',
        parentDatasetId,
        sidecarId: resolvedHeader?.sidecarUuid ?? null,
        sidecarKind,
        url,
        produces: ['meta-entry', 'meta-cell'],
        capabilities: {
          rangeRequestable: true,
          persistentCache: rangeSource.persistentCacheAvailable,
        },
      };
    },

    getSnapshot() {
      return {
        id: providerId,
        providerType: 'meta-sidecar',
        parentDatasetId,
        sidecarId: resolvedHeader?.sidecarUuid ?? null,
        sidecarKind,
        url,
        ready: Boolean(resolvedHeader),
        cache: {
          cells: cellCache.size,
          payloads: payloadCache.size,
          shards: shardCache.size,
        },
        stats: {
          ...stats,
        },
      };
    },

    async getMeta(ref) {
      assertActive();
      const normalized = normalizeRef(ref);
      assertRefParent(normalized, parentDatasetId, stats);

      const entries = await readCellEntries(normalized);
      const entry = entries?.[normalized.ordinal];
      if (!entry) {
        stats.missingEntries += 1;
        return null;
      }

      stats.resolvedEntries += 1;
      return entry;
    },

    async getMetaCell(ref) {
      assertActive();
      const normalized = normalizeCellRef(ref);
      assertRefParent(normalized, parentDatasetId, stats);

      const entries = await readCellEntries(normalized);
      if (!entries) {
        stats.missingCells += 1;
        return null;
      }

      stats.resolvedCells += 1;
      return entries;
    },

    dispose() {
      disposed = true;
      shardCache.clear();
      payloadCache.clear();
      cellCache.clear();
    },
  };

  async function ensureHeader() {
    assertActive();
    if (headerPromise) {
      stats.headerCacheHits += 1;
      return headerPromise;
    }

    headerPromise = (async () => {
      stats.headerFetches += 1;
      const header = parseStarHeader(
        await rangeSource.fetchRange(0, HEADER_BLOCK_BYTES - 1),
      );
      validateSidecarHeader(header, parentDatasetId, stats);
      resolvedHeader = header;
      void loadShard(header.indexOffset).catch(() => {});
      return header;
    })();

    return headerPromise;
  }

  /**
   * @param {MetaSidecarCellRef} ref
   */
  async function readCellEntries(ref) {
    const header = await ensureHeader();
    const cellKey = createStarCellKey(ref);
    const cacheKey = createCellCacheKey(parentDatasetId, header.sidecarUuid, cellKey);
    const cached = cellCache.get(cacheKey);
    if (cached) {
      stats.cellCacheHits += 1;
      return cached;
    }

    const promise = (async () => {
      const node = await findNodeForRef(header, ref);
      if (!node || !(node.flags & STAR_HAS_PAYLOAD) || node.payloadLength <= 0) {
        return null;
      }

      const payload = await fetchNodePayload(node);
      const text = new TextDecoder('utf-8').decode(new Uint8Array(payload));
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error(`Meta sidecar payload for ${cellKey} is not an array.`);
      }
      return /** @type {MetaSidecarEntry[]} */ (parsed);
    })();

    promise.catch(() => {
      if (cellCache.get(cacheKey) === promise) {
        cellCache.delete(cacheKey);
      }
    });
    cellCache.set(cacheKey, promise);
    return promise;
  }

  /**
   * @param {SidecarRuntimeNode} node
   */
  function fetchNodePayload(node) {
    const cacheKey = `${node.payloadOffset}:${node.payloadLength}`;
    const cached = payloadCache.get(cacheKey);
    if (cached) {
      stats.payloadCacheHits += 1;
      return cached;
    }

    stats.payloadFetches += 1;
    const promise = rangeSource
      .fetchRange(node.payloadOffset, node.payloadOffset + node.payloadLength - 1)
      .then((compressed) => decompressGzip(compressed));
    promise.catch(() => {
      if (payloadCache.get(cacheKey) === promise) {
        payloadCache.delete(cacheKey);
      }
    });
    payloadCache.set(cacheKey, promise);
    return promise;
  }

  /**
   * @param {ParsedStarHeader} header
   * @param {MetaSidecarCellRef} ref
   */
  async function findNodeForRef(header, ref) {
    const target = createTargetCell(ref);
    const rootShard = await loadShard(header.indexOffset);

    for (const nodeIndex of rootShard.header.entryNodes) {
      if (nodeIndex <= 0) continue;
      let node = rootShard.readRuntimeNode(header, nodeIndex);
      if (!nodeContainsTarget(node, target)) {
        continue;
      }

      while (node.level < target.level) {
        const octant = targetOctantBelowNode(target, node);
        if ((node.childMask & (1 << octant)) === 0) {
          return null;
        }

        const child = await readChildNode(header, node, octant);
        if (!child || !nodeContainsTarget(child, target)) {
          return null;
        }
        node = child;
      }

      return node.level === target.level && node.mortonCode === target.mortonCode
        ? node
        : null;
    }

    return null;
  }

  /**
   * @param {ParsedStarHeader} header
   * @param {SidecarRuntimeNode} node
   * @param {number} octant
   */
  async function readChildNode(header, node, octant) {
    const shard = await loadShard(node.shardOffset);

    if (node.flags & STAR_IS_FRONTIER) {
      const childShardOffset = Number(shard.readFrontierContinuation(node.nodeIndex));
      if (!childShardOffset) {
        return null;
      }

      const childShard = await loadShard(childShardOffset);
      const childNodeIndex = childShard.header.entryNodes[octant];
      return childNodeIndex > 0
        ? childShard.readRuntimeNode(header, childNodeIndex)
        : null;
    }

    if (node.firstChild <= 0) {
      return null;
    }

    const childNodeIndex = node.firstChild + popcountBelow(node.childMask, octant);
    if (childNodeIndex <= 0 || childNodeIndex > shard.header.nodeCount) {
      return null;
    }

    return shard.readRuntimeNode(header, childNodeIndex);
  }

  /**
   * @param {number} shardOffset
   * @returns {Promise<ResolvedSidecarShard>}
   */
  function loadShard(shardOffset) {
    const cached = shardCache.get(shardOffset);
    if (cached) {
      stats.shardCacheHits += 1;
      return cached;
    }

    const promise = loadShardUncached(shardOffset);
    promise.catch(() => {
      if (shardCache.get(shardOffset) === promise) {
        shardCache.delete(shardOffset);
      }
    });
    shardCache.set(shardOffset, promise);
    return promise;
  }

  /**
   * @param {number} shardOffset
   */
  async function loadShardUncached(shardOffset) {
    stats.shardFetches += 1;
    const prefetchBytes = normalizePositiveInteger(
      options.limits?.shardPrefetchBytes,
      DEFAULT_SHARD_PREFETCH_BYTES,
    );
    const initialBuffer = await rangeSource.fetchRange(
      shardOffset,
      shardOffset + Math.max(prefetchBytes, SHARD_HEADER_SIZE) - 1,
    );
    const warmed = cacheContiguousShards(initialBuffer, shardOffset);
    if (warmed) {
      return warmed;
    }

    const shardHeader = parseShardHeader(
      initialBuffer.slice(0, SHARD_HEADER_SIZE),
      shardOffset,
    );
    const totalSize = shardBlockSize(shardHeader.nodeCount, shardHeader.firstFrontierIndex);

    if (totalSize <= initialBuffer.byteLength) {
      const parsed = parseShardFromBlock(initialBuffer.slice(0, totalSize), shardOffset);
      if (parsed) {
        return parsed;
      }
    }

    stats.shardFetches += 1;
    const fullBuffer = await rangeSource.fetchRange(shardOffset, shardOffset + totalSize - 1);
    const parsed = cacheContiguousShards(fullBuffer, shardOffset);
    if (!parsed) {
      throw new Error(`Failed to parse meta sidecar shard at offset ${shardOffset}.`);
    }
    return parsed;
  }

  /**
   * @param {ArrayBuffer} buffer
   * @param {number} fileOffset
   */
  function cacheContiguousShards(buffer, fileOffset) {
    if (buffer.byteLength < SHARD_HEADER_SIZE) {
      return null;
    }

    let cursor = 0;
    /** @type {ResolvedSidecarShard | null} */
    let primaryShard = null;

    while (cursor + SHARD_HEADER_SIZE <= buffer.byteLength) {
      const probe = new DataView(buffer, cursor, 4);
      if (probe.getUint32(0, true) !== SHARD_MAGIC) {
        break;
      }

      const shardOffset = fileOffset + cursor;
      const parsed = parseShardFromBlock(buffer.slice(cursor), shardOffset);
      if (!parsed) {
        break;
      }

      if (!primaryShard) {
        primaryShard = parsed;
      }
      if (!shardCache.has(shardOffset)) {
        shardCache.set(shardOffset, Promise.resolve(parsed));
      }

      cursor += shardBlockSize(parsed.header.nodeCount, parsed.header.firstFrontierIndex);
    }

    return primaryShard;
  }

  function assertActive() {
    if (disposed) {
      throw new Error(`Meta sidecar provider "${providerId}" is disposed.`);
    }
  }
}

/**
 * Normalized catalog strings for UI (empty string when absent).
 *
 * @param {MetaSidecarEntry | null | undefined} entry
 * @returns {MetaSidecarDisplayFields}
 */
export function metaSidecarEntryDisplayFields(entry) {
  const fields = {
    properName: '',
    bayer: '',
    hd: '',
    hip: '',
    gaia: '',
    primaryLabel: '',
  };
  if (!entry || typeof entry !== 'object') {
    return fields;
  }

  const source = normalizeMetaString(entry.source).toLowerCase();
  const sourceId = normalizeMetaString(entry.source_id);
  fields.properName = normalizeMetaString(entry.proper_name);
  fields.bayer = formatBayerDesignation(entry);
  fields.hd = normalizeMetaString(entry.hd);
  fields.hip = normalizeMetaString(entry.hip_id)
    || (source === 'hip' && sourceId ? sourceId : '');
  fields.gaia = normalizeMetaString(entry.gaia_source_id)
    || (source === 'gaia' && sourceId ? sourceId : '');
  fields.primaryLabel = primaryLabelFromDisplayFields(fields, entry);
  return fields;
}

/** @param {unknown} value */
function normalizeMetaString(value) {
  if (value == null) return '';
  return String(value).trim();
}

/** @param {MetaSidecarEntry} entry */
function formatBayerDesignation(entry) {
  const bayer = normalizeMetaString(entry.bayer);
  if (!bayer) return '';
  const constellation = normalizeMetaString(entry.constellation);
  if (!constellation || bayerAlreadyEndsWithConstellation(bayer, constellation)) {
    return bayer;
  }
  return `${bayer} ${constellation}`;
}

/**
 * @param {string} bayer
 * @param {string} constellation
 */
function bayerAlreadyEndsWithConstellation(bayer, constellation) {
  const normalizedBayer = bayer.toLowerCase();
  const normalizedConstellation = constellation.toLowerCase();
  return normalizedBayer === normalizedConstellation
    || normalizedBayer.endsWith(` ${normalizedConstellation}`);
}

/**
 * @param {Omit<MetaSidecarDisplayFields, 'primaryLabel'>} fields
 * @param {MetaSidecarEntry} entry
 */
function primaryLabelFromDisplayFields(fields, entry) {
  if (fields.properName) return fields.properName;
  if (fields.bayer) return fields.bayer;
  if (fields.hd) return `HD ${fields.hd}`;
  if (fields.hip) return `HIP ${fields.hip}`;
  if (fields.gaia) return `Gaia ${fields.gaia}`;
  const source = normalizeMetaString(entry.source);
  const sourceId = normalizeMetaString(entry.source_id);
  return source && sourceId ? `${source} ${sourceId}` : '';
}

/**
 * @param {MetaSidecarProviderServiceOptions} options
 */
function validateOptions(options) {
  if (!options || typeof options.url !== 'string' || !options.url.trim()) {
    throw new TypeError('createMetaSidecarProviderService() requires a URL.');
  }
  if (typeof options.parentDatasetId !== 'string' || !options.parentDatasetId.trim()) {
    throw new TypeError('createMetaSidecarProviderService() requires parentDatasetId.');
  }
}

/**
 * @returns {MetaSidecarStats}
 */
function createInitialStats() {
  return {
    headerFetches: 0,
    headerCacheHits: 0,
    shardFetches: 0,
    shardCacheHits: 0,
    payloadFetches: 0,
    payloadCacheHits: 0,
    cellCacheHits: 0,
    resolvedEntries: 0,
    missingEntries: 0,
    resolvedCells: 0,
    missingCells: 0,
    parentMismatches: 0,
    rangeRequests: 0,
    bytesRequested: 0,
    persistentCacheHits: 0,
    fetchTimeMs: 0,
  };
}

/**
 * @param {MetaSidecarCellRef} ref
 */
function createTargetCell(ref) {
  const grid = decodeMorton3D(ref.mortonCode, ref.level);
  return {
    level: ref.level,
    mortonCode: ref.mortonCode,
    gridX: grid.gridX,
    gridY: grid.gridY,
    gridZ: grid.gridZ,
  };
}

/**
 * @param {SidecarRuntimeNode} node
 * @param {TargetCell} target
 */
function nodeContainsTarget(node, target) {
  if (node.level > target.level) {
    return false;
  }

  const shift = target.level - node.level;
  const divisor = 2 ** shift;
  return (
    Math.floor(target.gridX / divisor) === node.gridX &&
    Math.floor(target.gridY / divisor) === node.gridY &&
    Math.floor(target.gridZ / divisor) === node.gridZ
  );
}

/**
 * @param {TargetCell} target
 * @param {SidecarRuntimeNode} node
 */
function targetOctantBelowNode(target, node) {
  const shift = target.level - node.level - 1;
  return (
    ((target.gridX >> shift) & 1) |
    (((target.gridY >> shift) & 1) << 1) |
    (((target.gridZ >> shift) & 1) << 2)
  );
}

/**
 * @param {MetaSidecarCellRef} ref
 * @param {string} parentDatasetId
 * @param {MetaSidecarStats} stats
 */
function assertRefParent(ref, parentDatasetId, stats) {
  if (!ref.datasetId || ref.datasetId === parentDatasetId) {
    return;
  }

  stats.parentMismatches += 1;
  throw createCodedError(
    'Meta sidecar parent dataset does not match object reference.',
    ERR_META_SIDECAR_PARENT_MISMATCH,
  );
}

/**
 * @param {ParsedStarHeader} header
 * @param {string} parentDatasetId
 * @param {MetaSidecarStats} stats
 */
function validateSidecarHeader(header, parentDatasetId, stats) {
  if (header.artifactKind !== 'sidecar') {
    throw createCodedError(
      'Meta sidecar provider requires a sidecar octree artifact.',
      ERR_META_SIDECAR_INVALID_ARTIFACT,
    );
  }
  if (header.sidecarKind !== 'meta') {
    throw createCodedError(
      `Meta sidecar provider cannot read sidecar kind "${header.sidecarKind ?? 'unknown'}".`,
      ERR_META_SIDECAR_INVALID_KIND,
    );
  }
  if (header.parentDatasetUuid !== parentDatasetId) {
    stats.parentMismatches += 1;
    throw createCodedError(
      'Meta sidecar parent dataset does not match active render dataset.',
      ERR_META_SIDECAR_PARENT_MISMATCH,
    );
  }
}

/**
 * @param {unknown} ref
 * @returns {StarObjectRef}
 */
function normalizeRef(ref) {
  if (!ref || typeof ref !== 'object') {
    throw new TypeError('Meta sidecar metadata lookup requires an object reference.');
  }

  const candidate = /** @type {Partial<StarObjectRef>} */ (ref);
  const ordinal = Number(candidate.ordinal);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new TypeError('Meta sidecar object reference requires level, mortonCode, and non-negative ordinal.');
  }

  return {
    ...normalizeCellRef(ref),
    ordinal,
  };
}

/**
 * @param {unknown} ref
 * @returns {MetaSidecarCellRef}
 */
function normalizeCellRef(ref) {
  if (!ref || typeof ref !== 'object') {
    throw new TypeError('Meta sidecar cell lookup requires a cell reference.');
  }

  const candidate = /** @type {Partial<MetaSidecarCellRef>} */ (ref);
  const level = Number(candidate.level);
  if (!Number.isSafeInteger(level) || level < 0 || candidate.mortonCode == null) {
    throw new TypeError('Meta sidecar cell reference requires level and mortonCode.');
  }

  const cellKey = createStarCellKey(level, candidate.mortonCode);
  const mortonCode = cellKey.slice(cellKey.indexOf(':') + 1);
  return {
    datasetId: normalizeNonEmptyString(candidate.datasetId),
    level,
    mortonCode,
  };
}

/**
 * @param {string} parentDatasetId
 * @param {string | null | undefined} sidecarId
 * @param {string} cellKey
 */
function createCellCacheKey(parentDatasetId, sidecarId, cellKey) {
  return [parentDatasetId, sidecarId ?? 'pending-sidecar', cellKey].join(':');
}

/**
 * @param {number} mask
 * @param {number} octant
 */
function popcountBelow(mask, octant) {
  const subset = mask & ((1 << octant) - 1);
  let count = 0;

  for (let value = subset; value !== 0; value &= value - 1) {
    count += 1;
  }

  return count;
}

/**
 * @param {number} nodeCount
 * @param {number} firstFrontierIndex
 */
function shardBlockSize(nodeCount, firstFrontierIndex) {
  const frontierCount =
    firstFrontierIndex > 0 && nodeCount >= firstFrontierIndex
      ? nodeCount - firstFrontierIndex + 1
      : 0;

  return SHARD_HEADER_SIZE + nodeCount * SHARD_NODE_SIZE + frontierCount * FRONTIER_REF_SIZE;
}

class ResolvedSidecarShard {
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
    return readShardNodeRecord(this.nodeTable, nodeIndex);
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

    const offset = slot * FRONTIER_REF_SIZE;
    if (offset + FRONTIER_REF_SIZE > this.frontier.byteLength) {
      return 0n;
    }

    return this.frontier.getBigUint64(offset, true);
  }

  /**
   * @param {ParsedStarHeader} starHeader
   * @param {number} nodeIndex
   * @returns {SidecarRuntimeNode}
   */
  readRuntimeNode(starHeader, nodeIndex) {
    const record = this.readNode(nodeIndex);
    const geometry = runtimeNodeGeometry(starHeader, this.header, record);

    return {
      ...geometry,
      flags: record.flags,
      childMask: record.childMask,
      payloadOffset: record.payloadOffset,
      payloadLength: record.payloadLength,
      firstChild: record.firstChild,
      localDepth: record.localDepth,
      localPath: record.localPath,
      shardOffset: this.shardOffset,
      nodeIndex,
    };
  }
}

/**
 * @param {ArrayBuffer | DataView} input
 * @returns {ParsedStarHeader}
 */
function parseStarHeader(input) {
  const view = toDataView(input);
  if (view.byteLength < HEADER_SIZE) {
    throw new Error('meta sidecar: truncated STAR header.');
  }

  const magic = view.getUint32(0, true);
  if (magic !== STAR_MAGIC) {
    throw new Error(`meta sidecar: bad STAR magic 0x${magic.toString(16)}.`);
  }

  const version = view.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`meta sidecar: unsupported STAR version ${version}.`);
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
 * @returns {ParsedShardHeader}
 */
function parseShardHeader(input, shardOffset) {
  const view = toDataView(input);
  if (view.byteLength < SHARD_HEADER_SIZE) {
    throw new Error('meta sidecar shard: truncated OSHR header.');
  }

  const magic = view.getUint32(0, true);
  if (magic !== SHARD_MAGIC) {
    throw new Error(`meta sidecar shard: bad OSHR magic 0x${magic.toString(16)} at ${shardOffset}.`);
  }

  const version = view.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`meta sidecar shard: unsupported OSHR version ${version}.`);
  }

  const entryNodes = [];
  for (let index = 0; index < 8; index += 1) {
    entryNodes.push(view.getUint16(36 + index * 2, true));
  }

  return {
    offset: shardOffset,
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
 * @returns {ShardNodeRecord}
 */
function readShardNodeRecord(tableView, nodeIndex) {
  const offset = (nodeIndex - 1) * SHARD_NODE_SIZE;

  if (nodeIndex <= 0 || offset + SHARD_NODE_SIZE > tableView.byteLength) {
    throw new RangeError(`meta sidecar shard node index ${nodeIndex} is outside the node table.`);
  }

  return {
    firstChild: tableView.getUint16(offset, true),
    localPath: tableView.getUint16(offset + 2, true),
    childMask: tableView.getUint8(offset + 4),
    localDepth: tableView.getUint8(offset + 5),
    flags: tableView.getUint8(offset + 6),
    reserved: tableView.getUint8(offset + 7),
    payloadOffset: Number(tableView.getBigUint64(offset + 8, true)),
    payloadLength: tableView.getUint32(offset + 16, true),
  };
}

/**
 * @param {ArrayBuffer} buffer
 * @param {number} shardOffset
 * @returns {ResolvedSidecarShard | null}
 */
function parseShardFromBlock(buffer, shardOffset) {
  if (buffer.byteLength < SHARD_HEADER_SIZE) {
    return null;
  }

  const shardHeader = parseShardHeader(buffer.slice(0, SHARD_HEADER_SIZE), shardOffset);
  const nodeTableStart = SHARD_HEADER_SIZE;
  const nodeTableLength = shardHeader.nodeCount * SHARD_NODE_SIZE;
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
    const frontierEnd = frontierStart + frontierCount * FRONTIER_REF_SIZE;

    if (buffer.byteLength < frontierEnd) {
      return null;
    }

    frontierBuffer = buffer.slice(frontierStart, frontierEnd);
  }

  return new ResolvedSidecarShard(
    shardOffset,
    shardHeader,
    buffer.slice(nodeTableStart, nodeTableEnd),
    frontierBuffer,
  );
}

/**
 * @param {number} parentGridX
 * @param {number} parentGridY
 * @param {number} parentGridZ
 * @param {number} localDepth
 * @param {number} localPath
 */
function decodeLocalGrid(parentGridX, parentGridY, parentGridZ, localDepth, localPath) {
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
 * @param {ParsedStarHeader} header
 * @param {number} gridX
 * @param {number} gridY
 * @param {number} gridZ
 * @param {number} level
 */
function nodeCenterAndHalfSize(header, gridX, gridY, gridZ, level) {
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
 * @param {ParsedStarHeader} header
 * @param {ParsedShardHeader} shardHeader
 * @param {ShardNodeRecord} record
 */
function runtimeNodeGeometry(header, shardHeader, record) {
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
 * @param {ArrayBuffer} compressed
 * @returns {Promise<ArrayBuffer>}
 */
async function decompressGzip(compressed) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('gzip decompression requires DecompressionStream');
  }

  const stream = new DecompressionStream('gzip');
  const reader = stream.readable.getReader();
  const readPromise = readAllChunks(reader);
  const writer = stream.writable.getWriter();

  try {
    await writer.write(new Uint8Array(compressed));
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }

  return readPromise;
}

/**
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {Promise<ArrayBuffer>}
 */
async function readAllChunks(reader) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output.buffer;
}

/**
 * @param {{
 *   persistentCache?: 'on' | 'off';
 *   stats: MetaSidecarStats;
 *   url: string;
 * }} options
 */
function createUrlRangeSource(options) {
  /** @type {Promise<Cache | null> | null} */
  let persistentCachePromise = null;

  return {
    persistentCacheAvailable:
      options.persistentCache === 'on' && typeof caches !== 'undefined',

    /**
     * @param {number} start
     * @param {number} end
     */
    async fetchRange(start, end) {
      assertValidRange(start, end);

      const cache = await openPersistentCache();
      if (cache) {
        const cacheUrl = createRangeCacheUrl(options.url, start, end);

        try {
          const cached = await cache.match(cacheUrl);
          if (cached) {
            options.stats.persistentCacheHits += 1;
            return cached.arrayBuffer();
          }
        } catch {
          // Cache failures should not prevent the authoritative range fetch.
        }
      }

      options.stats.rangeRequests += 1;
      options.stats.bytesRequested += end - start + 1;
      const startedAt = nowMs();
      const response = await fetch(options.url, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
      });
      options.stats.fetchTimeMs += nowMs() - startedAt;

      assertRangeResponse(response, options.url, start, end);
      const buffer = await response.arrayBuffer();

      if (cache) {
        const cacheUrl = createRangeCacheUrl(options.url, start, end);
        cache
          .put(new Request(cacheUrl), new Response(buffer.slice(0)))
          .catch(() => {});
      }

      return buffer;
    },
  };

  async function openPersistentCache() {
    if (options.persistentCache !== 'on' || typeof caches === 'undefined') {
      return null;
    }

    if (!persistentCachePromise) {
      persistentCachePromise = caches.open(PERSISTENT_CACHE_NAME).catch(() => null);
    }

    return persistentCachePromise;
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
  if (view.byteLength < HEADER_BLOCK_BYTES) {
    return null;
  }

  const base = HEADER_SIZE;
  if (view.getUint32(base, true) !== DESCRIPTOR_MAGIC) {
    return null;
  }

  const version = view.getUint16(base + 4, true);
  if (version !== DESCRIPTOR_VERSION) {
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
  if (code === RENDER_DESCRIPTOR_KIND) return 'render';
  if (code === SIDECAR_DESCRIPTOR_KIND) return 'sidecar';
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

/**
 * @param {unknown} value
 */
function normalizeNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/**
 * @param {number} start
 * @param {number} end
 */
function assertValidRange(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new RangeError(`Invalid byte range ${start}-${end}.`);
  }
}

/**
 * @param {Response} response
 * @param {string} url
 * @param {number} start
 * @param {number} end
 */
function assertRangeResponse(response, url, start, end) {
  if (response.status === 206) {
    return;
  }

  throw new Error(`Range fetch failed: ${response.status} ${url} bytes=${start}-${end}.`);
}

/**
 * @param {string} url
 * @param {number} start
 * @param {number} end
 */
function createRangeCacheUrl(url, start, end) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_r=${start}-${end}`;
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function renderOctreeDefaultUrl() {
  return META_SIDECAR_DEFAULT.replace('/stars.meta.octree', '/stars.octree');
}

/**
 * @param {string} message
 * @param {string} code
 */
function createCodedError(message, code) {
  const error = new Error(message);
  return Object.assign(error, { code });
}
