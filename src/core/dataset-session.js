import { MetaSidecarService } from '../services/sidecars/meta-sidecar-service.js';
import { RenderOctreeService } from '../services/octree/render-octree-service.js';
import { decodeTemperatureK } from '../services/star-picker.js';
import { fromStarDataId, parseStarDataId } from '../services/star-data-id.js';
import { SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_CACHE_NAMES = Object.freeze([
  'bootstrapHeaders',
  'shardHeaders',
  'payloads',
  'metadataCells',
  'derivedIndexes',
]);

let datasetSessionCount = 0;

function cloneRecord(value) {
  return value && typeof value === 'object' ? { ...value } : {};
}

function normalizeDescriptor(name, descriptor) {
  if (typeof descriptor === 'string') {
    return {
      name,
      url: descriptor,
    };
  }

  if (!descriptor || typeof descriptor !== 'object') {
    return null;
  }

  const normalizedName = typeof descriptor.name === 'string' && descriptor.name.trim()
    ? descriptor.name.trim()
    : name;

  return {
    name: normalizedName,
    ...descriptor,
  };
}

function normalizeSidecars(options) {
  const descriptors = {};
  const sidecars = options.sidecars && typeof options.sidecars === 'object'
    ? options.sidecars
    : {};

  for (const [name, descriptor] of Object.entries(sidecars)) {
    const normalized = normalizeDescriptor(name, descriptor);
    if (normalized) {
      descriptors[normalized.name] = normalized;
    }
  }

  if (typeof options.metaUrl === 'string' && options.metaUrl.trim() && !descriptors.meta) {
    descriptors.meta = {
      name: 'meta',
      url: options.metaUrl.trim(),
    };
  }

  return descriptors;
}

function createVersionKey(options) {
  if (typeof options.versionKey === 'string' && options.versionKey.trim()) {
    return options.versionKey.trim();
  }

  const parts = [
    options.datasetUuid,
    options.manifestUrl,
    options.octreeUrl,
    options.identifiersOrderUrl,
    options.metaUrl,
    ...Object.values(options.sidecars ?? {}).map((descriptor) => {
      if (typeof descriptor === 'string') {
        return descriptor;
      }
      return descriptor?.url ?? null;
    }),
  ].filter((value) => typeof value === 'string' && value.trim());

  if (parts.length > 0) {
    return parts.join('|');
  }

  return `dataset-session:${datasetSessionCount + 1}`;
}

/**
 * Shared dataset boundary for one dataset version or manifest.
 */
export class DatasetSession {
  constructor(options = {}) {
    this.id = options.id ?? `dataset-session-${++datasetSessionCount}`;
    this.manifestUrl = options.manifestUrl ?? null;
    this.octreeUrl = options.octreeUrl ?? null;
    this.metaUrl = options.metaUrl ?? null;
    this.identifiersOrderUrl = options.identifiersOrderUrl ?? null;
    this.hasExplicitVersionKey = typeof options.versionKey === 'string' && options.versionKey.trim().length > 0;
    this.versionKey = createVersionKey(options);
    this.capabilities = {
      sharedCaches: true,
      bootstrapLoading: 'session-services',
      payloadDecode: 'session-services',
      metadataLookup: 'session-services',
      ...cloneRecord(options.capabilities),
    };
    this.sidecars = normalizeSidecars(options);
    this.persistentCache = options.persistentCache ?? 'on';
    this.disposed = false;
    this.datasetUuid = typeof options.datasetUuid === 'string' && options.datasetUuid.trim()
      ? options.datasetUuid.trim()
      : null;
    this.datasetIdentitySource = this.datasetUuid ? 'explicit' : 'pending';
    this.resolvedSidecars = new Map();
    this.serviceInstances = new Map();

    this.caches = new Map();
    for (const name of DEFAULT_CACHE_NAMES) {
      this.caches.set(name, new Map());
    }
  }

  assertActive() {
    if (this.disposed) {
      throw new Error(`DatasetSession "${this.id}" has already been disposed`);
    }
  }

  getCache(name) {
    this.assertActive();
    if (!this.caches.has(name)) {
      this.caches.set(name, new Map());
    }
    return this.caches.get(name);
  }

  clearCaches() {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  recordDatasetIdentity(identity) {
    if (!identity?.datasetUuid) {
      return;
    }

    this.datasetUuid = identity.datasetUuid;
    this.datasetIdentitySource = identity.datasetIdentitySource ?? this.datasetIdentitySource ?? 'derived';

    if (!this.hasExplicitVersionKey) {
      this.versionKey = this.datasetUuid;
    }
  }

  recordResolvedSidecar(name, descriptor) {
    if (!name || !descriptor) {
      return;
    }
    this.resolvedSidecars.set(name, { ...descriptor });
  }

  getRenderService() {
    this.assertActive();

    if (!this.serviceInstances.has('render')) {
      this.serviceInstances.set('render', new RenderOctreeService(this, {
        url: this.octreeUrl,
      }));
    }

    return this.serviceInstances.get('render');
  }

  async ensureRenderBootstrap() {
    return this.getRenderService().ensureBootstrap();
  }

  async ensureRenderRootShard() {
    return this.getRenderService().ensureRootShard();
  }

  getSidecarDescriptor(name) {
    if (this.resolvedSidecars.has(name)) {
      return cloneRecord(this.resolvedSidecars.get(name));
    }

    return cloneRecord(this.sidecars[name] ?? null);
  }

  getSidecarService(name) {
    this.assertActive();
    const descriptor = this.sidecars[name];
    if (!descriptor) {
      return null;
    }

    const serviceKey = `sidecar:${name}`;
    if (!this.serviceInstances.has(serviceKey)) {
      if (name === 'meta') {
        this.serviceInstances.set(serviceKey, new MetaSidecarService(this, {
          name,
          descriptor,
        }));
      } else {
        throw new Error(`No sidecar service is implemented yet for "${name}"`);
      }
    }

    return this.serviceInstances.get(serviceKey);
  }

  async resolvePrimarySidecarLabel(name, pickMeta) {
    const service = this.getSidecarService(name);
    if (!service || typeof service.resolvePrimaryName !== 'function') {
      return '';
    }

    return service.resolvePrimaryName(pickMeta);
  }

  /**
   * @returns {Promise<{
   *   properName: string,
   *   bayer: string,
   *   hd: string,
   *   hip: string,
   *   gaia: string,
   *   primaryLabel: string
   * } | null>}
   */
  async resolveSidecarMetaFields(name, pickMeta) {
    const service = this.getSidecarService(name);
    if (!service || typeof service.resolveMetaEntryFields !== 'function') {
      return null;
    }

    return service.resolveMetaEntryFields(pickMeta);
  }

  normalizeStarDataId(starDataId) {
    if (typeof starDataId === 'string') {
      return parseStarDataId(starDataId);
    }

    return fromStarDataId(starDataId);
  }

  async resolvePickMetaByStarId(starDataId) {
    const normalizedId = this.normalizeStarDataId(starDataId);
    const renderService = this.getRenderService();
    await renderService.ensureBootstrap();

    if (!this.datasetUuid || normalizedId.datasetUuid !== this.datasetUuid) {
      throw new Error(
        `StarDataId datasetUuid ${normalizedId.datasetUuid} does not match active dataset ${this.datasetUuid ?? 'unknown'}`,
      );
    }

    const node = await renderService.resolveNodeByLevelMorton(normalizedId.level, normalizedId.mortonCode);
    if (!node) {
      return null;
    }

    return {
      id: normalizedId,
      pickMeta: {
        nodeKey: node.nodeKey,
        level: node.level,
        centerX: node.centerX,
        centerY: node.centerY,
        centerZ: node.centerZ,
        gridX: node.gridX,
        gridY: node.gridY,
        gridZ: node.gridZ,
        ordinal: normalizedId.ordinal,
      },
      node,
    };
  }

  async resolveStarById(starDataId, options = {}) {
    const resolved = await this.resolvePickMetaByStarId(starDataId);
    if (!resolved) {
      return null;
    }

    const { id, node, pickMeta } = resolved;
    const renderService = this.getRenderService();
    const payloadBuffer = await renderService.fetchNodePayload(node);
    const decoded = renderService.decodePayload(payloadBuffer, node);

    if (id.ordinal >= decoded.count) {
      throw new RangeError(
        `StarDataId ordinal ${id.ordinal} is out of range for node ${node.nodeKey} (count=${decoded.count})`,
      );
    }

    const positionScene = [
      decoded.positions[id.ordinal * 3],
      decoded.positions[id.ordinal * 3 + 1],
      decoded.positions[id.ordinal * 3 + 2],
    ];
    const temperatureByte = decoded.teffLog8?.[id.ordinal];
    const includeSidecars = Array.isArray(options.includeSidecars) ? options.includeSidecars : [];
    const sidecars = {};

    for (const name of includeSidecars) {
      sidecars[name] = await this.resolveSidecarMetaFields(name, pickMeta);
    }

    return {
      id,
      nodeKey: node.nodeKey,
      pickMeta,
      positionScene,
      positionPc: positionScene.map((value) => value / SCALE),
      absoluteMagnitude: decoded.magAbs[id.ordinal],
      ...(temperatureByte != null ? { temperatureK: decodeTemperatureK(temperatureByte) } : {}),
      ...(includeSidecars.length > 0 ? { sidecars } : {}),
    };
  }

  async resolveSidecarMetaByStarId(name, starDataId) {
    const resolved = await this.resolvePickMetaByStarId(starDataId);
    if (!resolved) {
      return null;
    }

    return this.resolveSidecarMetaFields(name, resolved.pickMeta);
  }

  describe() {
    const sidecars = {};
    for (const [name, descriptor] of Object.entries(this.sidecars)) {
      sidecars[name] = {
        ...cloneRecord(descriptor),
        ...(this.resolvedSidecars.has(name) ? cloneRecord(this.resolvedSidecars.get(name)) : {}),
      };
    }

    return {
      id: this.id,
      manifestUrl: this.manifestUrl,
      octreeUrl: this.octreeUrl,
      metaUrl: this.metaUrl,
      identifiersOrderUrl: this.identifiersOrderUrl,
      versionKey: this.versionKey,
      datasetUuid: this.datasetUuid,
      datasetIdentitySource: this.datasetIdentitySource,
      capabilities: cloneRecord(this.capabilities),
      sidecars,
      persistentCache: this.persistentCache,
      disposed: this.disposed,
      cacheSizes: Object.fromEntries(
        [...this.caches.entries()].map(([name, cache]) => [name, cache.size]),
      ),
      services: {
        render: this.serviceInstances.get('render')?.describe?.() ?? null,
        sidecars: Object.fromEntries(
          [...this.serviceInstances.entries()]
            .filter(([key]) => key.startsWith('sidecar:'))
            .map(([key, service]) => [key.slice('sidecar:'.length), service.describe?.() ?? null]),
        ),
      },
    };
  }

  dispose(options = {}) {
    if (this.disposed) {
      return;
    }

    if (options.clearCaches !== false) {
      this.clearCaches();
    }

    this.serviceInstances.clear();
    this.resolvedSidecars.clear();
    this.disposed = true;
  }
}

export function getDatasetSession(options = {}) {
  return new DatasetSession(options);
}
