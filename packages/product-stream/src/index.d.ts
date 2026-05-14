export type ProductDelta<Product> =
  | ProductUpsertDelta<Product>
  | ProductStaleDelta
  | ProductRemoveDelta
  | RepresentationCurrentDelta
  | ProductErrorDelta;

export interface ProductUpsertDelta<Product> {
  type: 'data/product-upsert';
  product: Product;
  streamId?: string;
  providerId?: string;
  sessionId?: string;
}

export interface ProductStaleDelta {
  type: 'data/product-stale';
  productId: string;
  providerId?: string;
  sessionId?: string;
  reason?: string;
}

export interface ProductRemoveDelta {
  type: 'data/product-remove';
  productId: string;
  providerId?: string;
  sessionId?: string;
  reason?: string;
}

export interface RepresentationCurrentDelta {
  type: 'data/representation-current';
  providerId?: string;
  sessionId?: string;
  viewRevision?: number;
  demandRevision?: number;
  productIds?: string[];
  completeness?: unknown;
}

export interface ProductErrorDelta {
  type: 'data/product-error';
  streamId?: string;
  providerId?: string;
  sessionId?: string;
  error: {
    message: string;
    code?: string;
  };
}

export interface RepresentationStoreOptions<Product> {
  getProductId: (product: Product) => string;
  getProductBytes?: (product: Product) => number;
}

export interface RepresentationStoreSnapshot {
  status: 'idle' | 'streaming' | 'current' | 'failed';
  productCount: number;
  bytes: number;
  lastError?: string | null;
  lastCurrentRevision?: {
    viewRevision?: number;
    demandRevision?: number;
  } | null;
}

export interface RepresentationStore<Product> {
  apply(delta: ProductDelta<Product>): void;
  subscribe(listener: () => void): () => void;
  getProducts(): Product[];
  getSnapshot(): RepresentationStoreSnapshot;
  clear(): void;
}

export interface ConsumeProductDeltasOptions {
  stopOnCurrent?: boolean;
  throwOnError?: boolean;
}

export interface ConsumeProductDeltasResult {
  deltaCount: number;
  stoppedOn: 'current' | 'error' | 'end';
}

export declare function createRepresentationStore<Product>(
  options: RepresentationStoreOptions<Product>
): RepresentationStore<Product>;

export declare function consumeProductDeltas<Product>(
  deltas: AsyncIterable<ProductDelta<Product>>,
  store: RepresentationStore<Product>,
  options?: ConsumeProductDeltasOptions
): Promise<ConsumeProductDeltasResult>;
