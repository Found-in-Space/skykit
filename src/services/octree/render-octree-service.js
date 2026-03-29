import { deriveRenderDatasetUuid } from '../dataset-identity.js';
import { OctreeFileService } from './octree-file-service.js';

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
