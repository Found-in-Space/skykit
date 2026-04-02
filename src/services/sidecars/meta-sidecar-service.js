import { deriveSidecarUuid } from '../dataset-identity.js';
import {
  IS_FRONTIER,
  OctreeFileService,
  makeNodeKey,
  runtimeNodeGeometry,
} from '../octree/octree-file-service.js';

function popcountBelow(mask, octant) {
  const subset = mask & ((1 << octant) - 1);
  let count = 0;
  for (let bits = subset; bits !== 0; bits &= bits - 1) {
    count += 1;
  }
  return count;
}

function aabbDistance(px, py, pz, cx, cy, cz, halfSize) {
  const dx = Math.max(Math.abs(px - cx) - halfSize, 0);
  const dy = Math.max(Math.abs(py - cy) - halfSize, 0);
  const dz = Math.max(Math.abs(pz - cz) - halfSize, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function readRuntimeNode(header, shard, nodeIndex) {
  const record = shard.readNode(nodeIndex);
  const geometry = runtimeNodeGeometry(header, shard.hdr, record);

  return {
    ...geometry,
    flags: record.flags,
    childMask: record.childMask,
    payloadOffset: record.payloadOffset,
    payloadLength: record.payloadLength,
    firstChild: record.firstChild,
    localDepth: record.localDepth,
    localPath: record.localPath,
    shardOffset: shard.shardOffset,
    nodeIndex,
    nodeKey: makeNodeKey(shard.shardOffset, nodeIndex),
  };
}

function normalizeMetaString(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

function bayerAlreadyEndsWithConstellation(bayer, constellation) {
  const b = normalizeMetaString(bayer);
  const c = normalizeMetaString(constellation);
  if (!b || !c) {
    return false;
  }
  const bl = b.toLowerCase();
  const cl = c.toLowerCase();
  if (!bl.endsWith(cl)) {
    return false;
  }
  if (bl.length === cl.length) {
    return true;
  }
  const sep = b[b.length - c.length - 1];
  return sep === ' ' || sep === '-';
}

/**
 * Bayer letter (or full designation) plus constellation when needed.
 * Skips appending `constellation` if `bayer` already ends with it (e.g. "gamma Ara" + Ara).
 */
export function formatBayerDesignation(entry) {
  if (!entry || typeof entry !== 'object') {
    return '';
  }
  const bayer = normalizeMetaString(entry.bayer);
  if (!bayer) {
    return '';
  }
  const constellation = normalizeMetaString(entry.constellation);
  if (!constellation || bayerAlreadyEndsWithConstellation(bayer, constellation)) {
    return bayer;
  }
  return `${bayer} ${constellation}`;
}

/**
 * Normalized catalog strings for UI (empty string when absent).
 */
export function metaEntryDisplayFields(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      properName: '',
      bayer: '',
      hd: '',
      hip: '',
      gaia: '',
    };
  }

  const source = normalizeMetaString(entry.source).toLowerCase();
  const sourceId = normalizeMetaString(entry.source_id);

  return {
    properName: normalizeMetaString(entry.proper_name),
    bayer: formatBayerDesignation(entry),
    hd: normalizeMetaString(entry.hd),
    hip: normalizeMetaString(entry.hip_id)
      || (source === 'hip' && sourceId ? sourceId : ''),
    gaia: normalizeMetaString(entry.gaia_source_id)
      || (source === 'gaia' && sourceId ? sourceId : ''),
  };
}

function primaryLabelFromDisplayFields(fields, entry) {
  if (fields.properName) {
    return fields.properName;
  }
  if (fields.bayer) {
    return fields.bayer;
  }
  if (fields.hd) {
    return `HD ${fields.hd}`;
  }
  if (fields.hip) {
    return `HIP ${fields.hip}`;
  }
  if (fields.gaia) {
    return `Gaia ${fields.gaia}`;
  }
  if (entry && typeof entry === 'object' && entry.source != null && entry.source_id != null) {
    return `${entry.source} ${entry.source_id}`;
  }
  return '';
}

function formatMetaEntryLabel(entry) {
  return primaryLabelFromDisplayFields(metaEntryDisplayFields(entry), entry);
}

function headersMatchGeometry(renderHeader, sidecarHeader) {
  return (
    renderHeader.maxLevel === sidecarHeader.maxLevel
    && renderHeader.worldCenterX === sidecarHeader.worldCenterX
    && renderHeader.worldCenterY === sidecarHeader.worldCenterY
    && renderHeader.worldCenterZ === sidecarHeader.worldCenterZ
    && renderHeader.worldHalfSize === sidecarHeader.worldHalfSize
  );
}

export class MetaSidecarService {
  constructor(session, options = {}) {
    this.session = session;
    this.name = options.name ?? 'meta';
    this.descriptor = options.descriptor ?? null;
    this.file = new OctreeFileService(session, {
      namespace: `sidecar:${this.name}`,
      url: this.descriptor?.url ?? null,
    });
    this.resolvedDescriptor = null;
    this.compatibilityPromise = null;
  }

  assertUsable() {
    this.session.assertActive();
    if (!this.file.url) {
      throw new Error(`Sidecar "${this.name}" requires a URL`);
    }
  }

  async ensureHeader() {
    this.assertUsable();

    if (!this.compatibilityPromise) {
      this.compatibilityPromise = (async () => {
        const renderBootstrap = await this.session.ensureRenderBootstrap();
        const sidecarHeader = await this.file.loadHeader();

        const declaredParentUuid = typeof this.descriptor?.parentDatasetUuid === 'string'
          ? this.descriptor.parentDatasetUuid.trim()
          : '';
        const parentDatasetUuid = declaredParentUuid || this.session.datasetUuid;

        if (declaredParentUuid && declaredParentUuid !== this.session.datasetUuid) {
          throw new Error(
            `Sidecar "${this.name}" parentDatasetUuid does not match active dataset`,
          );
        }

        if (!headersMatchGeometry(renderBootstrap.header, sidecarHeader)) {
          throw new Error(`Sidecar "${this.name}" geometry does not match render dataset`);
        }

        const { sidecarUuid, sidecarIdentitySource } = deriveSidecarUuid({
          sidecarName: this.name,
          sidecarUuid: this.descriptor?.sidecarUuid,
          url: this.file.url,
          parentDatasetUuid,
          header: sidecarHeader,
        });

        this.resolvedDescriptor = {
          name: this.name,
          url: this.file.url,
          parentDatasetUuid,
          sidecarUuid,
          sidecarIdentitySource,
          header: sidecarHeader,
          status: 'ready',
        };

        this.session.recordResolvedSidecar(this.name, this.resolvedDescriptor);
        void this.file.loadShard(sidecarHeader.indexOffset).catch(() => {});

        return {
          header: sidecarHeader,
          descriptor: this.resolvedDescriptor,
        };
      })();
    }

    return this.compatibilityPromise;
  }

  async getChild(header, node, octant) {
    if ((node.childMask & (1 << octant)) === 0) {
      return null;
    }

    const shard = await this.file.loadShard(node.shardOffset);
    if (node.flags & IS_FRONTIER) {
      const childShardOffset = Number(shard.readFrontierContinuation(node.nodeIndex));
      if (!childShardOffset) {
        return null;
      }
      const childShard = await this.file.loadShard(childShardOffset);
      const childNodeIndex = childShard.hdr.entryNodes[octant];
      return childNodeIndex > 0 ? readRuntimeNode(header, childShard, childNodeIndex) : null;
    }

    if (node.firstChild <= 0) {
      return null;
    }

    const childIndex = node.firstChild + popcountBelow(node.childMask, octant);
    if (childIndex > shard.hdr.nodeCount) {
      return null;
    }

    return readRuntimeNode(header, shard, childIndex);
  }

  async findNodeAt(px, py, pz, targetLevel) {
    const { header } = await this.ensureHeader();
    if (targetLevel < 0) {
      return null;
    }

    const rootShard = await this.file.loadShard(header.indexOffset);
    let node = null;

    for (let octant = 0; octant < 8; octant += 1) {
      const nodeIndex = rootShard.hdr.entryNodes[octant];
      if (nodeIndex <= 0) {
        continue;
      }

      const candidate = readRuntimeNode(header, rootShard, nodeIndex);
      if (aabbDistance(px, py, pz, candidate.centerX, candidate.centerY, candidate.centerZ, candidate.halfSize) === 0) {
        node = candidate;
        break;
      }
    }

    if (!node) {
      return null;
    }

    while (node.level < targetLevel) {
      const octant =
        (px >= node.centerX ? 1 : 0)
        | (py >= node.centerY ? 2 : 0)
        | (pz >= node.centerZ ? 4 : 0);
      const child = await this.getChild(header, node, octant);
      if (!child) {
        return null;
      }
      node = child;
    }

    return node.level === targetLevel ? node : null;
  }

  createCellCacheKey(nodeKey) {
    const descriptor = this.resolvedDescriptor ?? {};
    return [
      descriptor.parentDatasetUuid ?? this.session.datasetUuid ?? 'pending-dataset',
      this.name,
      descriptor.sidecarUuid ?? 'pending-sidecar',
      nodeKey,
    ].join(':');
  }

  async readCellEntries(pickMeta) {
    const { descriptor } = await this.ensureHeader();
    const cache = this.session.getCache('metadataCells');
    const cacheKey = this.createCellCacheKey(pickMeta.nodeKey);

    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, (async () => {
        const node = await this.findNodeAt(
          pickMeta.centerX,
          pickMeta.centerY,
          pickMeta.centerZ,
          pickMeta.level,
        );

        if (!node) {
          console.warn('[MetaSidecar] node not found in meta tree', {
            level: pickMeta.level,
            center: [pickMeta.centerX, pickMeta.centerY, pickMeta.centerZ],
            nodeKey: pickMeta.nodeKey,
          });
          return null;
        }

        if (!node.payloadLength) {
          console.warn('[MetaSidecar] node found but payload empty', {
            level: node.level,
            nodeKey: pickMeta.nodeKey,
          });
          return null;
        }

        const buffer = await this.file.fetchNodePayload(node);
        const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          console.warn('[MetaSidecar] JSON parse failed', {
            nodeKey: pickMeta.nodeKey,
            byteLength: buffer?.byteLength,
            preview: text?.slice(0, 200),
            error: err.message,
          });
          return null;
        }

        if (!Array.isArray(parsed)) {
          console.warn('[MetaSidecar] payload not an array', {
            nodeKey: pickMeta.nodeKey,
            type: typeof parsed,
          });
          return null;
        }

        return parsed;
      })());
    }

    return {
      descriptor,
      entries: await cache.get(cacheKey),
    };
  }

  async resolvePrimaryName(pickMeta) {
    if (
      !pickMeta
      || typeof pickMeta !== 'object'
      || typeof pickMeta.nodeKey !== 'string'
      || !Number.isFinite(pickMeta.level)
      || !Number.isFinite(pickMeta.centerX)
      || !Number.isFinite(pickMeta.centerY)
      || !Number.isFinite(pickMeta.centerZ)
      || !Number.isFinite(pickMeta.ordinal)
    ) {
      return '';
    }

    const { entries } = await this.readCellEntries(pickMeta);
    if (!entries || pickMeta.ordinal < 0 || pickMeta.ordinal >= entries.length) {
      return '';
    }

    return formatMetaEntryLabel(entries[pickMeta.ordinal]);
  }

  async resolveMetaEntryFields(pickMeta) {
    if (
      !pickMeta
      || typeof pickMeta !== 'object'
      || typeof pickMeta.nodeKey !== 'string'
      || !Number.isFinite(pickMeta.level)
      || !Number.isFinite(pickMeta.centerX)
      || !Number.isFinite(pickMeta.centerY)
      || !Number.isFinite(pickMeta.centerZ)
      || !Number.isFinite(pickMeta.ordinal)
    ) {
      return null;
    }

    const { entries } = await this.readCellEntries(pickMeta);
    if (!entries) {
      console.warn('[MetaSidecar] no entries for', pickMeta.nodeKey);
      return null;
    }
    if (pickMeta.ordinal < 0 || pickMeta.ordinal >= entries.length) {
      console.warn('[MetaSidecar] ordinal out of range', {
        ordinal: pickMeta.ordinal,
        entriesLength: entries.length,
        nodeKey: pickMeta.nodeKey,
      });
      return null;
    }

    const entry = entries[pickMeta.ordinal];
    const fields = metaEntryDisplayFields(entry);

    if (!fields.properName && !fields.bayer && !fields.hd && !fields.hip && !fields.gaia) {
      console.warn('[MetaSidecar] entry found but all identifier fields empty', {
        nodeKey: pickMeta.nodeKey,
        ordinal: pickMeta.ordinal,
        rawEntry: entry,
      });
    }

    return {
      ...fields,
      primaryLabel: primaryLabelFromDisplayFields(fields, entry),
    };
  }

  describe() {
    return {
      name: this.name,
      url: this.file.url,
      ready: this.compatibilityPromise != null,
      descriptor: this.resolvedDescriptor,
    };
  }
}

