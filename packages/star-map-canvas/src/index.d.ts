import type {
  StarRepresentationStore,
  StarRow,
} from '@found-in-space/star-products';

export interface StarMapPoint {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: string;
  distancePc: number;
  apparentMagnitude: number;
  productId: string;
  objectIndex: number;
  objectRef: StarRow['objectRef'];
  pickMeta: StarRow['pickMeta'];
  star: StarRow;
  depth?: number;
  wrapKey?: string;
}

export interface CanvasStarMapRenderResult {
  width: number;
  height: number;
  dpr: number;
  starCount: number;
  visibleCount: number;
  drawnCount: number;
  filteredCount: number;
  points: StarMapPoint[];
}

export interface CanvasStarMapPickOptions {
  tolerancePx?: number;
}

export interface CanvasStarMapPickResult extends StarMapPoint {
  distancePx: number;
  score: number;
}

export interface StarMapStyle {
  background?: string | null;
  magFadeRange?: number;
  minRadiusPx?: number;
  maxRadiusPx?: number;
  radiusScale?: number;
  radiusPower?: number;
  haloScale?: number;
  haloAlpha?: number;
  alpha?: number;
  fallbackColor?: string;
}

export interface StarMapProjectionContext {
  observerPc: { x: number; y: number; z: number };
  limitingMagnitude: number;
  width: number;
  height: number;
  rect: { x: number; y: number; w: number; h: number };
}

export interface StarMapProjectionResult {
  x: number;
  y: number;
  visible?: boolean;
  depth?: number;
  wrapKey?: string;
}

export interface StarMapProjection {
  id: string;
  project(
    star: StarRow,
    context: StarMapProjectionContext
  ): StarMapProjectionResult | null;
}

export interface CanvasStarMapOptions {
  store?: StarRepresentationStore;
  projection?: StarMapProjection;
  style?: StarMapStyle;
  autoResize?: boolean;
}

export interface CanvasStarMapRenderOptions {
  store?: StarRepresentationStore;
  stars?: Iterable<StarRow>;
  observerPc?: { x: number; y: number; z: number };
  limitingMagnitude?: number;
  clear?: boolean;
  projection?: StarMapProjection;
  style?: StarMapStyle;
}

export interface DrawStarMapOptions extends CanvasStarMapRenderOptions {
  store?: StarRepresentationStore;
  stars?: Iterable<StarRow>;
}

export interface CanvasStarMap {
  render(options?: CanvasStarMapRenderOptions): CanvasStarMapRenderResult;
  resize(options?: { width?: number; height?: number; dpr?: number }): void;
  getLastRender(): CanvasStarMapRenderResult | null;
  pick(
    point: { x: number; y: number },
    options?: CanvasStarMapPickOptions
  ): CanvasStarMapPickResult | null;
  dispose(): void;
}

export declare const DEFAULT_LIMITING_MAGNITUDE: 6.5;

export declare function createCanvasStarMap(
  canvas: HTMLCanvasElement,
  options?: CanvasStarMapOptions
): CanvasStarMap;

export declare function drawStarMap(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  options?: DrawStarMapOptions
): CanvasStarMapRenderResult;

export declare function createRaDecEquirectangularProjection(
  options?: { id?: string }
): StarMapProjection;

export declare function createStarMapProjection(
  project: StarMapProjection['project'],
  options?: { id?: string }
): StarMapProjection;
