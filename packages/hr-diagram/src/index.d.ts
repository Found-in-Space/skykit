import type { StarCellData, StarCellDelta, StarCellStore, StarRow } from '@found-in-space/star-products';
import type * as THREE from 'three';

export type HrDiagramMode = 'magnitude-limited' | 'volume-complete' | 'frustum';

export interface HrDiagramRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HrDiagramBounds {
  coolK?: number;
  hotK?: number;
  minMag?: number;
  maxMag?: number;
  marginPx?: number;
}

export interface HrDiagramHighlightRegion {
  teffMin: number;
  teffMax: number;
  magAbsMin: number;
  magAbsMax: number;
  color?: string | [number, number, number];
  label?: string;
}

export interface HrDiagramView extends HrDiagramBounds {
  mode?: HrDiagramMode | 0 | 1 | 2;
  observerPc?: { x: number; y: number; z: number };
  limitingMagnitude?: number;
  volumeRadiusPc?: number;
  viewProjection?: THREE.Matrix4 | Float32Array | number[];
  highlightRegion?: HrDiagramHighlightRegion | null;
  width?: number;
  height?: number;
}

export interface HrDiagramPoint {
  x: number;
  y: number;
  teffK: number;
  magAbs: number;
  cellKey?: string;
  objectIndex?: number;
  color: [number, number, number];
}

export interface ProjectHrDiagramOptions extends HrDiagramBounds {
  stars?: Iterable<StarRow>;
  cells?: Iterable<StarCellData>;
  store?: StarCellStore;
  observerPc?: { x: number; y: number; z: number };
  limitingMagnitude?: number;
  mode?: HrDiagramMode | 0 | 1 | 2;
  volumeRadiusPc?: number;
}

export interface ProjectHrDiagramResult {
  points: HrDiagramPoint[];
  starCount: number;
  visibleCount: number;
  filteredCount: number;
  rect: HrDiagramRect;
}

export interface DrawHrDiagramCanvasOptions extends ProjectHrDiagramOptions {
  background?: string | null;
  alpha?: number;
}

export interface HrDiagramRendererOptions extends HrDiagramView {
  scene?: THREE.Scene;
  camera?: THREE.Camera;
}

export interface HrDiagramRendererSnapshot {
  cellCount: number;
  starCount: number;
  disposed: boolean;
  view: HrDiagramView;
}

export interface HrDiagramRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly material: THREE.ShaderMaterial;
  apply(delta: StarCellDelta): void;
  setCells(cells: Iterable<StarCellData>): void;
  clear(): void;
  setView(view: HrDiagramView): void;
  render(renderer: THREE.WebGLRenderer, target?: THREE.WebGLRenderTarget | null): void;
  getSnapshot(): HrDiagramRendererSnapshot;
  dispose(): void;
}

export declare const HR_DIAGRAM_MODE_MAGNITUDE: 'magnitude-limited';
export declare const HR_DIAGRAM_MODE_VOLUME: 'volume-complete';
export declare const HR_DIAGRAM_MODE_FRUSTUM: 'frustum';

export declare function normalizeHrDiagramMode(
  mode?: HrDiagramMode | 0 | 1 | 2
): HrDiagramMode;

export declare function temperatureToHrX(
  teffK: number,
  width: number,
  options?: HrDiagramBounds
): number;

export declare function absoluteMagnitudeToHrY(
  magAbs: number,
  height: number,
  options?: HrDiagramBounds
): number;

export declare function projectHrPoint(options: {
  teffLog8?: number;
  temperatureK?: number;
  magAbs: number;
  rect: HrDiagramRect;
} & HrDiagramBounds): HrDiagramPoint | null;

export declare function projectHrDiagramStars(
  rect: HrDiagramRect,
  options?: ProjectHrDiagramOptions
): ProjectHrDiagramResult;

export declare function drawHrDiagramCanvas(
  ctx: CanvasRenderingContext2D,
  rect: HrDiagramRect,
  options?: DrawHrDiagramCanvasOptions
): ProjectHrDiagramResult;

export declare function createHrDiagramRenderer(
  options?: HrDiagramRendererOptions
): HrDiagramRenderer;

export declare function createHrDiagramGeometryFromCells(
  cells: Iterable<StarCellData>
): THREE.BufferGeometry;
