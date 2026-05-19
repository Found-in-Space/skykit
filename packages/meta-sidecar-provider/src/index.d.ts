import type { StarObjectRef } from '@found-in-space/star-trees';

export type { StarObjectRef } from '@found-in-space/star-trees';

export interface PickMetaRef extends StarObjectRef {
  gridX?: number;
  gridY?: number;
  gridZ?: number;
  centerX?: number;
  centerY?: number;
  centerZ?: number;
}

export interface MetaSidecarEntry {
  proper_name?: string | number | null;
  bayer?: string | number | null;
  constellation?: string | number | null;
  hd?: string | number | null;
  hip_id?: string | number | null;
  gaia_source_id?: string | number | null;
  source?: string | number | null;
  source_id?: string | number | null;
  [key: string]: unknown;
}

export interface MetaSidecarProviderServiceOptions {
  id?: string;
  parentDatasetId: string;
  sidecarId?: string | null;
  sidecarKind?: string;
  entries?: Record<string, MetaSidecarEntry[]>;
}

export interface MetaSidecarFactProduct {
  productType: 'fact-batch';
  providerId: string;
  parentDatasetId: string;
  sidecarId?: string | null;
  objectRef: StarObjectRef;
  facts: {
    properName: string;
    bayer: string;
    hd: string;
    hip: string;
    gaia: string;
    primaryLabel: string;
  };
  raw?: MetaSidecarEntry;
}

export interface MetaSidecarProviderDescriptor {
  id: string;
  providerType: 'meta-sidecar';
  parentDatasetId: string;
  sidecarId?: string | null;
  sidecarKind: string;
  produces: ['fact-batch'];
}

export interface MetaSidecarProviderSnapshot {
  id: string;
  providerType: 'meta-sidecar';
  parentDatasetId: string;
  sidecarId?: string | null;
  cache: {
    cells: number;
  };
  stats: {
    resolvedFacts: number;
    missingFacts: number;
    parentMismatches: number;
  };
}

export interface MetaSidecarProviderService {
  readonly id: string;
  describe(): MetaSidecarProviderDescriptor;
  getSnapshot(): MetaSidecarProviderSnapshot;
  resolveFacts(ref: StarObjectRef | PickMetaRef): Promise<MetaSidecarFactProduct | null>;
  resolvePrimaryLabel(ref: StarObjectRef | PickMetaRef): Promise<string>;
  dispose(): void;
}

export declare function createMetaSidecarProviderService(
  options: MetaSidecarProviderServiceOptions
): MetaSidecarProviderService;
