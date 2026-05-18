export type StarCellKey = `${number}:${string}`;

export interface StarCellRef {
  level: number;
  mortonCode: string;
}

/**
 * Canonical public identity for a star within one dataset.
 *
 * `level + mortonCode` identifies the logical octree cell. `ordinal`
 * identifies the star within that cell's emitted payload order.
 */
export interface StarObjectRef extends StarCellRef {
  datasetId?: string | null;
  ordinal: number;
}

/**
 * Pick/join metadata for renderer selections.
 *
 * This repeats the public logical cell and ordinal, plus geometry useful for
 * proximity and sidecar lookups. It is not a separate object ID scheme.
 */
export interface StarPickMeta extends StarCellRef {
  cellKey: StarCellKey;
  ordinal: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
}

export interface StarCellSourceNode extends StarCellRef {
  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;
  gridX: number;
  gridY: number;
  gridZ: number;
}

export interface StarCoordinateOutput<Node = StarCellSourceNode> {
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
  refs?: StarObjectRef[];
}

export interface StarCellData {
  cellKey: StarCellKey;
  cell: StarCellRef;
  bounds: {
    centerPc: { x: number; y: number; z: number };
    halfSizePc: number;
    gridX: number;
    gridY: number;
    gridZ: number;
  };
  count: number;
  coordinates: {
    name: string;
    frame: string;
    units: [string, string, string];
    components: Float32Array;
  };
  attributes: {
    magAbs?: Float32Array;
    teffLog8?: Uint8Array;
  };
  refs?: StarObjectRef[];
  pickMeta?: StarPickMeta[];
}

export interface CreateStarCellDataOptions<Node = StarCellSourceNode> {
  node: Node & StarCellSourceNode;
  decoded: DecodedStarSegment;
  datasetId?: string | null;
  attributes?: string[];
  coordinates?: StarCoordinateOutput<Node & StarCellSourceNode>;
  memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
}

export type StarCellDelta =
  | {
      type: 'stars/cells-upsert';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cells: StarCellData[];
    }
  | {
      type: 'stars/cells-remove';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cellKeys: StarCellKey[];
      reason?: string;
    }
  | {
      type: 'stars/current';
      providerId: string;
      sessionId?: string;
      viewRevision?: number;
      demandRevision?: number;
      cellKeys: StarCellKey[];
      starCount: number;
    }
  | {
      type: 'stars/error';
      providerId: string;
      sessionId?: string;
      demandRevision?: number;
      error: { message: string; code?: string };
    };

export interface StarRow {
  cell: StarCellData;
  cellKey: StarCellKey;
  objectIndex: number;
  position: { x: number; y: number; z: number };
  teffLog8?: number;
  magAbs?: number;
  objectRef?: StarObjectRef | null;
  pickMeta?: StarPickMeta | null;
}

export interface StarCellStoreSnapshot {
  cellCount: number;
  starCount: number;
  bytes: number;
  lastDelta: StarCellDelta | null;
  lastError: Extract<StarCellDelta, { type: 'stars/error' }> | null;
}

export interface StarCellStore {
  apply(delta: StarCellDelta): void;
  subscribe(listener: () => void): () => void;
  getCells(): StarCellData[];
  getCell(cellKey: StarCellKey): StarCellData | null;
  getStarCount(): number;
  stars(): Iterable<StarRow>;
  getObjectRef(cellKey: StarCellKey, objectIndex: number): StarObjectRef | null;
  getPickMeta(cellKey: StarCellKey, objectIndex: number): StarPickMeta | null;
  getSnapshot(): StarCellStoreSnapshot;
  clear(): void;
}

export interface ConsumeStarCellDeltasResult {
  processed: number;
  stoppedOn: 'current' | null;
}

export interface ApparentMagnitudeInput {
  magAbs: number;
  distancePc: number;
}

export declare const ERR_STAR_CELLS_TRANSFER_UNAVAILABLE: 'ERR_STAR_CELLS_TRANSFER_UNAVAILABLE';

export declare function createStarCellData<Node = StarCellSourceNode>(
  options: CreateStarCellDataOptions<Node>
): StarCellData;

export declare function estimateStarCellBytes(cell: StarCellData): number;

export declare function createStarCellStore(): StarCellStore;

export declare function consumeStarCellDeltas(
  deltas: AsyncIterable<StarCellDelta> | Iterable<StarCellDelta>,
  store: StarCellStore,
  options?: { stopOnCurrent?: boolean; throwOnError?: boolean }
): Promise<ConsumeStarCellDeltasResult>;

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
): StarCellKey;

export declare function parseStarCellKey(cellKey: string): StarCellRef;

export declare function apparentMagnitude(input: ApparentMagnitudeInput): number;

export declare function decodeTemperatureK(teffLog8: number): number;

export declare function temperatureToRgb(
  teffLog8OrTemperatureK: number,
  options?: { input?: 'teffLog8' | 'kelvin' }
): [number, number, number];

export declare function supportsTransferableBuffers(): boolean;
