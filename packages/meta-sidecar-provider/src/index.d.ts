import type { CanonicalObjectRef } from '@found-in-space/star-products';

export type { CanonicalObjectRef } from '@found-in-space/star-products';

export interface PickMetaRef extends CanonicalObjectRef {
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
  objectRef: CanonicalObjectRef;
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
  resolveFacts(ref: CanonicalObjectRef | PickMetaRef): Promise<MetaSidecarFactProduct | null>;
  resolvePrimaryLabel(ref: CanonicalObjectRef | PickMetaRef): Promise<string>;
  dispose(): void;
}

export declare function createMetaSidecarProviderService(
  options: MetaSidecarProviderServiceOptions
): MetaSidecarProviderService;
