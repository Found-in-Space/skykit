import { deriveRenderDatasetUuid } from '../dataset-identity.js';
import {
  IS_FRONTIER,
  makeNodeKey,
  OctreeFileService,
  runtimeNodeGeometry,
} from './octree-file-service.js';

function popcountBelow(mask, octant) {
  const subset = mask & ((1 << octant) - 1);
  let count = 0;
  for (let bits = subset; bits !== 0; bits &= bits - 1) {
    count += 1;
  }
  return count;
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

function readMortonOctant(mortonCode, depthFromRoot) {
  const shift = BigInt(depthFromRoot * 3);
  const base = BigInt(mortonCode);
  const x = Number((base >> shift) & 1n);
  const y = Number((base >> (shift + 1n)) & 1n);
  const z = Number((base >> (shift + 2n)) & 1n);
  return x | (y << 1) | (z << 2);
}

export class RenderOctreeService {
  constructor(session, options = {}) {
    this.session = session;
    this.file = new OctreeFileService(session, {
      namespace: 'render',
      url: options.url ?? null,
    });
  }

  assertUsable() {
    this.session.assertActive();
    if (!this.file.url) {
      throw new Error('Render octree service requires an octreeUrl');
    }
  }

  async ensureBootstrap() {
    this.assertUsable();
    const bootstrap = await this.file.loadBootstrap();
    return this.decorateBootstrap(bootstrap);
  }

  decorateBootstrap(bootstrap) {
    const derivedIdentity = deriveRenderDatasetUuid({
      datasetUuid: this.session.datasetUuid,
      manifestUrl: this.session.manifestUrl,
      octreeUrl: this.file.url,
      identifiersOrderUrl: this.session.identifiersOrderUrl,
      header: bootstrap.header,
    });

    this.session.recordDatasetIdentity(derivedIdentity);

    return {
      ...bootstrap,
      datasetUuid: this.session.datasetUuid,
      datasetIdentitySource: this.session.datasetIdentitySource,
    };
  }

  async ensureBootstrapAndRootShard() {
    this.assertUsable();
    const { bootstrap, rootShard } = await this.file.loadBootstrapAndRootShard();
    return {
      bootstrap: this.decorateBootstrap(bootstrap),
      rootShard,
    };
  }

  async ensureRootShard() {
    const { rootShard } = await this.ensureBootstrapAndRootShard();
    return rootShard;
  }

  async loadShard(shardOffset) {
    this.assertUsable();
    return this.file.loadShard(shardOffset);
  }

  async fetchNodePayload(node) {
    this.assertUsable();
    return this.file.fetchNodePayload(node);
  }

  async fetchNodePayloadBatch(nodes) {
    this.assertUsable();
    return this.file.fetchNodePayloadBatch(nodes);
  }

  async fetchNodePayloadBatchProgressive(nodes, options = {}) {
    this.assertUsable();
    return this.file.fetchNodePayloadBatchProgressive(nodes, options);
  }

  async getChildNode(header, node, octant) {
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

  async resolveNodeByLevelMorton(level, mortonCode) {
    this.assertUsable();
    if (!Number.isInteger(level) || level < 0) {
      throw new RangeError('level must be a non-negative integer');
    }

    const normalizedMorton = BigInt(mortonCode);
    const { header } = await this.ensureBootstrap();
    const rootShard = await this.file.loadShard(header.indexOffset);

    const rootOctant = readMortonOctant(normalizedMorton, level);
    const rootNodeIndex = rootShard.hdr.entryNodes[rootOctant];
    if (rootNodeIndex <= 0) {
      return null;
    }

    let node = readRuntimeNode(header, rootShard, rootNodeIndex);
    for (let depth = level - 1; depth >= 0; depth -= 1) {
      const octant = readMortonOctant(normalizedMorton, depth);
      const child = await this.getChildNode(header, node, octant);
      if (!child) {
        return null;
      }
      node = child;
    }

    return node;
  }

  decodePayload(buffer, geom) {
    return this.file.decodePayload(buffer, geom);
  }

  describe() {
    return {
      ...this.file.describe(),
      datasetUuid: this.session.datasetUuid,
      datasetIdentitySource: this.session.datasetIdentitySource,
    };
  }
}
