import type * as THREE from 'three';

export interface Bounds3 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface HaTiledVolumeBrick {
  index: number;
  slotIndex: number;
  levelIndex: number;
  levelId: string;
  sampleSize: number;
  textureSampleSize: number;
  tileHaloCells: number;
  gridX: number;
  gridY: number;
  gridZ: number;
  encodedMax: number;
  flags: number;
  nonzeroCount: number;
  payloadOffset: number;
  payloadLength: number;
  levelUrl?: string;
  level?: HaTiledLevel;
}

export interface HaTiledLevel {
  id: string;
  url: string | null;
  version: number;
  headerBytes: number;
  recordBytes: number;
  brickCount: number;
  levelIndex: number;
  tileGridSize: number;
  dimension: number;
  sampleSize: number;
  scalarMax: number;
  centerBoundsPc: { x: [number, number]; y: [number, number]; z: [number, number] };
  worldBoundsPc: { x: [number, number]; y: [number, number]; z: [number, number] };
  payloadStart: number;
  fileBytes: number;
  compressedPayloadBytes: number;
  uncompressedPayloadBytes: number;
  textureSampleSize: number;
  tileHaloCells: number;
  tableBytes: number;
  bricks: HaTiledVolumeBrick[];
}

export interface HaTiledVolume {
  manifest: Record<string, any>;
  manifestUrl: string;
  levels: HaTiledLevel[];
  levelsById: Map<string, HaTiledLevel>;
  lowLevel: HaTiledLevel;
  highLevel: HaTiledLevel;
  tileGridSize: number;
  slotCount: number;
  worldBoundsPc: { x: [number, number]; y: [number, number]; z: [number, number] };
  format: string;
  frame?: string;
}

export interface HaTiledVolumeServiceOptions {
  fetchImpl?: typeof fetch;
  decompressImpl?: (compressed: ArrayBuffer) => Promise<ArrayBuffer>;
  persistentCache?: 'on' | 'off';
  maxResidentBricks?: number;
  maxInflightRequests?: number;
  lowLevelId?: string;
  highLevelId?: string;
}

export interface HaTiledVolumeDescription {
  url: string;
  cachedBricks: number;
  inflightBricks: number;
  readyByLevel: Record<string, number>;
  totalByLevel: Record<string, number>;
  stats: Record<string, number>;
  rangeCacheStats: Record<string, number>;
}

export class HaTiledVolumeService {
  constructor(volume: HaTiledVolume, options?: HaTiledVolumeServiceOptions);
  readonly volume: HaTiledVolume;
  readonly stats: Record<string, number>;
  readonly availableRequestSlots: number;
  hasDecodedBrick(brick: HaTiledVolumeBrick): boolean;
  isBrickInflight(brick: HaTiledVolumeBrick): boolean;
  getDecodedBrick(brick: HaTiledVolumeBrick): Uint8Array | null;
  deleteDecodedBrick(brick: HaTiledVolumeBrick): boolean;
  requestBrick(brick: HaTiledVolumeBrick): Promise<HaTiledVolumeBrick[]> | null;
  requestBricks(
    bricks: Iterable<HaTiledVolumeBrick>,
    options?: { maxBatchBricks?: number; maxBatchBytes?: number }
  ): Promise<HaTiledVolumeBrick[]>[];
  describe(): HaTiledVolumeDescription;
}

export interface HaTiledVolumeLayerContext {
  contentRoot?: THREE.Object3D;
  scene?: THREE.Object3D;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  requestRender?: (reason?: string) => void;
  renderOnce?: () => void;
  runtime?: { renderOnce?: () => void };
}

export interface HaTiledVolumeLayer {
  id: string;
  group: THREE.Group;
  attach(context: HaTiledVolumeLayerContext): Promise<void>;
  start(context: HaTiledVolumeLayerContext): void;
  update(context: HaTiledVolumeLayerContext): void;
  dispose(context: Partial<HaTiledVolumeLayerContext>): void;
  getStats(): Record<string, any>;
  getService(): HaTiledVolumeService | null;
  getDisplayVolume(): Record<string, any> | null;
  getBounds(): Bounds3 | null;
  setMaterialState(nextState?: { gain?: number; threshold?: number; opacity?: number }): void;
}

export interface HaTiledVolumeLayerOptions extends HaTiledVolumeServiceOptions {
  id?: string;
  manifestUrl?: string;
  initialLevelId?: string | null;
  finalLevelId?: string | null;
  volumeToSceneTransform?: (x: number, y: number, z: number) => [number, number, number];
  sceneToVolumeTransform?: (x: number, y: number, z: number) => [number, number, number];
  raymarchSteps?: number;
  gain?: number;
  threshold?: number;
  opacity?: number;
  onStatus?: (status: string) => void;
  onStats?: (stats: Record<string, any>) => void;
  onError?: (error: unknown) => void;
}

export interface DustMapNg {
  u8: Uint8Array;
  nx: number;
  ny: number;
  nz: number;
  maxDensity: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  cellCount: number;
}

export interface DustMapNgVolume extends DustMapNg {
  texture: THREE.Data3DTexture;
  frame: 'galactic';
  format: 'dust_map_ng';
  sourceUrl: string;
}

export interface DensityFieldMaterialProfile {
  material: THREE.ShaderMaterial;
  updateUniforms(context?: {
    cameraWorldPosition?: THREE.Vector3 | null;
    state?: Record<string, number>;
  }): void;
  dispose(): void;
}

export const HA_TILED_VOLUME_FORMAT: string;
export const DEFAULT_MCCALLUM_HA_TILED_VOLUME_URL: string;
export const HA_TILED_LEVEL_MAGIC: string;
export const HA_TILED_LEVEL_HEADER_BYTES: number;
export const HA_TILED_LEVEL_RECORD_BYTES: number;
export const HA_TILED_PERSISTENT_CACHE_NAME: string;
export const DUST_MAP_NG_HEADER_BYTES: number;
export const EXPERIMENTAL_STRUCTURE_SCENE_SCALE: number;

export function resolveHaTiledVolumeUrl(search?: string | null): string;
export function resolveHaTiledVolumeLevelIds(
  searchOrOptions?: string | {
    search?: string | null;
    initialLevelDefault?: string | number | null;
    finalLevelDefault?: string | number | null;
  } | null,
  maybeOptions?: {
    initialLevelDefault?: string | number | null;
    finalLevelDefault?: string | number | null;
  }
): { initialLevelId: string | null; finalLevelId: string | null };
export function decompressGzipBuffer(compressed: ArrayBuffer): Promise<ArrayBuffer>;
export function parseHaTiledLevelBuffer(buffer: ArrayBuffer, options?: Record<string, any>): HaTiledLevel;
export function getHaTiledVolumeBrickBounds(volume: HaTiledVolume | { manifest: any; worldBoundsPc: any; tileGridSize: number }, brick: HaTiledVolumeBrick): Bounds3;
export function loadHaTiledVolume(manifestUrl?: string, options?: HaTiledVolumeServiceOptions): Promise<HaTiledVolumeService>;
export function createHaTiledVolumeMaterial(options?: Record<string, any>): THREE.ShaderMaterial;
export function createHaTiledVolumeLayer(options?: HaTiledVolumeLayerOptions): HaTiledVolumeLayer;

export function loadDustMapNg(url: string): Promise<DustMapNg>;
export function createDustMapNgData3DTexture(map: DustMapNg): THREE.Data3DTexture;
export function loadDustMapNgVolume(url: string): Promise<DustMapNgVolume>;

export function createDensityFieldMaterialProfile(options?: {
  pointSize?: number;
  alpha?: number;
  color?: THREE.ColorRepresentation;
  scale?: number;
}): DensityFieldMaterialProfile;
