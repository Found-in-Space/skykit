import type { StarCellRef, StarObjectRef } from '@found-in-space/star-trees';

export type { StarCellRef, StarObjectRef } from '@found-in-space/star-trees';

export declare const META_SIDECAR_c56103: string;
export declare const META_SIDECAR_DEFAULT: string;
export declare const ERR_META_SIDECAR_PARENT_MISMATCH: string;
export declare const ERR_META_SIDECAR_INVALID_ARTIFACT: string;
export declare const ERR_META_SIDECAR_INVALID_KIND: string;

export interface MetaSidecarCellRef extends StarCellRef {
  datasetId?: string | null;
}

export type MetaSidecarEntry = Record<string, unknown>;

export interface MetaSidecarDisplayFields {
  properName: string;
  bayer: string;
  hd: string;
  hip: string;
  gaia: string;
  primaryLabel: string;
}

export interface MetaSidecarProviderServiceOptions {
  id?: string;
  url: string;
  parentDatasetId: string;
  persistentCache?: 'on' | 'off';
  limits?: {
    shardPrefetchBytes?: number;
  };
}

export interface MetaSidecarProviderDescriptor {
  id: string;
  providerType: 'meta-sidecar';
  parentDatasetId: string;
  sidecarId?: string | null;
  sidecarKind: 'meta';
  url: string;
  produces: ['meta-entry', 'meta-cell'];
  capabilities: {
    rangeRequestable: boolean;
    persistentCache: boolean;
  };
}

export interface MetaSidecarProviderSnapshot {
  id: string;
  providerType: 'meta-sidecar';
  parentDatasetId: string;
  sidecarId?: string | null;
  sidecarKind: 'meta';
  url: string;
  ready: boolean;
  cache: {
    cells: number;
    payloads: number;
    shards: number;
  };
  stats: {
    headerFetches: number;
    headerCacheHits: number;
    shardFetches: number;
    shardCacheHits: number;
    payloadFetches: number;
    payloadCacheHits: number;
    cellCacheHits: number;
    resolvedEntries: number;
    missingEntries: number;
    resolvedCells: number;
    missingCells: number;
    parentMismatches: number;
    rangeRequests: number;
    bytesRequested: number;
    persistentCacheHits: number;
    fetchTimeMs: number;
  };
}

export interface MetaSidecarProviderService {
  readonly id: string;
  describe(): MetaSidecarProviderDescriptor;
  getSnapshot(): MetaSidecarProviderSnapshot;
  getMeta(ref: StarObjectRef): Promise<MetaSidecarEntry | null>;
  getMetaCell(ref: MetaSidecarCellRef): Promise<MetaSidecarEntry[] | null>;
  dispose(): void;
}

export declare function deriveMetaSidecarUrlFromRenderUrl(
  renderUrl?: string | null
): string;

export declare function metaSidecarEntryDisplayFields(
  entry?: MetaSidecarEntry | null
): MetaSidecarDisplayFields;

export declare function createMetaSidecarProviderService(
  options: MetaSidecarProviderServiceOptions
): MetaSidecarProviderService;
