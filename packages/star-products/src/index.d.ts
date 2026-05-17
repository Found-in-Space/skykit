import type {
  ProductDelta,
  RepresentationStore,
  RepresentationStoreSnapshot,
  consumeProductDeltas as consumeProductDeltasFn,
} from '@found-in-space/product-stream';

export type { ProductDelta } from '@found-in-space/product-stream';
export { consumeProductDeltas } from '@found-in-space/product-stream';

/**
 * Canonical public identity for a star within one dataset.
 *
 * `level + mortonCode` identifies the logical octree cell. `ordinal`
 * identifies the star within that cell's emitted payload order. Do not replace
 * this with provider storage details such as node table indexes or byte
 * offsets.
 */
export interface CanonicalObjectRef {
  datasetId?: string | null;
  level: number;
  mortonCode: string;
  ordinal: number;
}

/**
 * Pick/join metadata for renderer selections.
 *
 * This repeats the public logical cell and ordinal, plus geometry useful for
 * proximity and sidecar lookups. It is not a separate object ID scheme.
 */
export interface StarPickMeta {
  level: number;
  mortonCode: string;
  ordinal: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
}

export interface StarProductSourceNode {
  mortonCode?: string;
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
  level: number;
  gridX: number;
  gridY: number;
  gridZ: number;
}

export interface StarCoordinateOutput<Node = StarProductSourceNode> {
  name?: string;
  frame?: 'icrs' | string;
  units?: [string, string, string];
  transformPosition?: (position: {
    xPc: number;
    yPc: number;
    zPc: number;
    node: Node;
    ordinal: number;
  }) => [number, number, number] | { x: number; y: number; z: number };
}

export interface DecodedStarSegment {
  count: number;
  positionsPc: Float32Array;
  teffLog8?: Uint8Array;
  magAbs?: Float32Array;
  refs?: CanonicalObjectRef[];
}

export interface StarObjectBatchNodeSummary {
  level: number;
  mortonCode: string;
  gridX: number;
  gridY: number;
  gridZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
  count: number;
  offset: number;
}

export interface StarProductCompleteness {
  phase: 'coarse' | 'partial' | 'complete' | 'stale';
  stable: boolean;
  loadedObjects: number;
  loadedNodes: number;
  totalNodes?: number;
}

export interface StarProductMemory {
  ownership: 'borrowed' | 'copy' | 'transfer';
  bytes: number;
}

export interface StarObjectBatchProduct {
  productType: 'object-batch';
  id: string;
  providerId: string;
  layerId: 'stars';
  objectType: 'star';
  streamId: string;
  sessionId?: string;
  viewRevision?: number;
  demandRevision?: number;
  count: number;
  nodes: StarObjectBatchNodeSummary[];
  coordinates: {
    primary: {
      name: string;
      frame: string;
      representation: 'cartesian3';
      units: [string, string, string];
      stride: 3;
      components: Float32Array;
    };
  };
  attributes: {
    teffLog8?: {
      name: 'teffLog8';
      kind: 'number';
      values: Uint8Array;
    };
    magAbs?: {
      name: 'magAbs';
      kind: 'number';
      unit: 'mag';
      values: Float32Array;
    };
  };
  refs?: CanonicalObjectRef[];
  pickMeta?: StarPickMeta[];
  completeness: StarProductCompleteness;
  memory: StarProductMemory;
  metadata?: Record<string, unknown>;
}

export interface CreateStarObjectBatchProductOptions<Node = StarProductSourceNode> {
  providerId: string;
  sessionId?: string;
  streamId: string;
  productIndex: number;
  entries: Array<{
    node: Node & StarProductSourceNode;
    decoded: DecodedStarSegment;
  }>;
  attributes?: string[];
  coordinates?: StarCoordinateOutput<Node & StarProductSourceNode>;
  viewRevision?: number;
  demandRevision?: number;
  memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
  completenessPhase?: 'coarse' | 'partial' | 'complete' | 'stale';
}

export interface StarRow {
  product: StarObjectBatchProduct;
  productId: string;
  objectIndex: number;
  position: { x: number; y: number; z: number };
  teffLog8?: number;
  magAbs?: number;
  objectRef?: CanonicalObjectRef | null;
  pickMeta?: StarPickMeta | null;
}

export interface StarRepresentationSnapshot extends RepresentationStoreSnapshot {
  starCount: number;
  productCount: number;
  bytes: number;
}

export interface StarRepresentationStore {
  apply(delta: ProductDelta<StarObjectBatchProduct>): void;
  subscribe(listener: () => void): () => void;
  getProducts(): StarObjectBatchProduct[];
  getStarCount(): number;
  stars(): Iterable<StarRow>;
  getObjectRef(productId: string, objectIndex: number): CanonicalObjectRef | null;
  getPickMeta(productId: string, objectIndex: number): StarPickMeta | null;
  getSnapshot(): StarRepresentationSnapshot;
  clear(): void;
}

export interface ApparentMagnitudeInput {
  magAbs: number;
  distancePc: number;
}

export declare const ERR_STAR_PRODUCTS_TRANSFER_UNAVAILABLE: 'ERR_STAR_PRODUCTS_TRANSFER_UNAVAILABLE';

export declare function createStarObjectBatchProduct<Node = StarProductSourceNode>(
  options: CreateStarObjectBatchProductOptions<Node>
): StarObjectBatchProduct;

export declare function createStarProductId(
  streamId: string,
  productIndex: number
): string;

export declare function createStarRepresentationStore(): StarRepresentationStore;

export declare function encodeMorton3D(
  gridX: number,
  gridY: number,
  gridZ: number,
  level: number
): bigint;

export declare function decodeMorton3D(
  mortonCode: bigint | number | string,
  level: number
): { gridX: number; gridY: number; gridZ: number };

export declare function createStarCellKey(
  levelOrCell: number | { level: number; mortonCode?: string | number | bigint; gridX?: number; gridY?: number; gridZ?: number },
  mortonCode?: string | number | bigint
): string;

export declare function apparentMagnitude(input: ApparentMagnitudeInput): number;

export declare function decodeTemperatureK(teffLog8: number): number;

export declare function temperatureToRgb(
  teffLog8OrTemperatureK: number,
  options?: { input?: 'teffLog8' | 'kelvin' }
): [number, number, number];

export declare function supportsTransferableBuffers(): boolean;

export declare const consumeStarProductDeltas: typeof consumeProductDeltasFn;
