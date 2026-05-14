import type {
  StarRepresentationStore,
  StarRow,
} from '@found-in-space/star-products';

export interface RaDec {
  raDeg: number;
  raHours: number;
  decDeg: number;
}

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

export interface ProjectedStarMap {
  width: number;
  height: number;
  dpr: number;
  starCount: number;
  visibleCount: number;
  filteredCount: number;
  points: StarMapPoint[];
  observerPc: { x: number; y: number; z: number };
  limitingMagnitude: number;
  projectionId: string;
  rect: { x: number; y: number; w: number; h: number };
  timeMs: number;
  deltaMs: number;
}

export interface CanvasStarMapRenderResult extends ProjectedStarMap {
  drawnCount: number;
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
  timeMs?: number;
  deltaMs?: number;
  clip?: boolean;
}

export interface StarMapProjectionResult {
  x: number;
  y: number;
  visible?: boolean;
  depth?: number;
  wrapKey?: string;
}

export type StarMapRaDecProjector = (
  raDec: RaDec,
  context: StarMapProjectionContext,
  star?: StarRow
) => StarMapProjectionResult | null;

export interface StarMapProjection {
  id: string;
  project(
    star: StarRow,
    context: StarMapProjectionContext
  ): StarMapProjectionResult | null;
  projectRaDec?: StarMapRaDecProjector;
}

export interface StarMapPointContext extends StarMapProjectionContext {
  projection: StarMapProjection;
  projectionResult: StarMapProjectionResult;
  style: Required<StarMapStyle>;
  star: StarRow;
}

export interface DrawStarPointContext extends StarMapProjectionContext {
  projection: StarMapProjection | null;
  style: Required<StarMapStyle>;
  projected: ProjectedStarMap;
}

export interface CanvasStarMapLayerContext extends StarMapProjectionContext {
  ctx: CanvasRenderingContext2D;
  rect: { x: number; y: number; w: number; h: number };
  dpr: number;
  projection: StarMapProjection | null;
  projectionContext: StarMapProjectionContext;
  style: Required<StarMapStyle>;
  projected: ProjectedStarMap;
  result: CanvasStarMapRenderResult | null;
  icrsDirectionToRaDec: typeof icrsDirectionToRaDec;
  icrsPositionToRaDec: typeof icrsPositionToRaDec;
  projectRaDec: ((raDec: RaDec) => StarMapProjectionResult | null) | null;
  projectRaDecUnclipped: ((raDec: RaDec) => StarMapProjectionResult | null) | null;
  projectRaDecEquirectangular: typeof projectRaDecEquirectangular;
}

export interface CanvasStarMapLayer {
  id?: string;
  phase?: 'background' | 'foreground';
  render(context: CanvasStarMapLayerContext): void;
}

export interface CanvasStarMapOptions {
  store?: StarRepresentationStore;
  projection?: StarMapProjection;
  style?: StarMapStyle;
  autoResize?: boolean;
  layers?: CanvasStarMapLayer[];
  mapPoint?: (point: StarMapPoint, context: StarMapPointContext) => StarMapPoint | null;
  drawPoint?: (
    ctx: CanvasRenderingContext2D,
    point: StarMapPoint,
    context: DrawStarPointContext
  ) => void;
}

export interface ProjectStarMapOptions {
  store?: StarRepresentationStore;
  stars?: Iterable<StarRow>;
  observerPc?: { x: number; y: number; z: number };
  limitingMagnitude?: number;
  projection?: StarMapProjection;
  style?: StarMapStyle;
  mapPoint?: (point: StarMapPoint, context: StarMapPointContext) => StarMapPoint | null;
  timeMs?: number;
  deltaMs?: number;
  dpr?: number;
}

export interface DrawProjectedStarMapOptions {
  clear?: boolean;
  projection?: StarMapProjection;
  style?: StarMapStyle;
  layers?: CanvasStarMapLayer[];
  drawPoint?: (
    ctx: CanvasRenderingContext2D,
    point: StarMapPoint,
    context: DrawStarPointContext
  ) => void;
}

export interface CanvasStarMapRenderOptions
  extends ProjectStarMapOptions,
    DrawProjectedStarMapOptions {}

export interface DrawStarMapOptions extends CanvasStarMapRenderOptions {
  store?: StarRepresentationStore;
  stars?: Iterable<StarRow>;
}

export interface GnomonicProjectionOptions {
  centerRaDeg: number;
  centerDecDeg: number;
  fovDeg: number;
  rollDeg?: number;
  clip?: boolean;
  id?: string;
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

export declare function projectStarMap(
  rect: { x: number; y: number; w: number; h: number },
  options?: ProjectStarMapOptions
): ProjectedStarMap;

export declare function drawProjectedStarMap(
  ctx: CanvasRenderingContext2D,
  projected: ProjectedStarMap,
  options?: DrawProjectedStarMapOptions
): CanvasStarMapRenderResult;

export declare function pickStarMapPoint(
  projected: ProjectedStarMap | CanvasStarMapRenderResult | null,
  point: { x: number; y: number },
  options?: CanvasStarMapPickOptions
): CanvasStarMapPickResult | null;

export declare function drawStarMap(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  options?: DrawStarMapOptions
): CanvasStarMapRenderResult;

export declare function createRaDecEquirectangularProjection(
  options?: { id?: string }
): StarMapProjection;

export declare function createRaDecProjection(
  projectRaDec: StarMapRaDecProjector,
  options?: { id?: string }
): StarMapProjection;

export declare function createGnomonicProjection(
  options: GnomonicProjectionOptions
): StarMapProjection;

export declare function projectRaDecEquirectangular(
  raDec: RaDec,
  context: StarMapProjectionContext
): StarMapProjectionResult | null;

export declare function icrsDirectionToRaDec(
  direction: [number, number, number] | { x: number; y: number; z: number }
): RaDec | null;

export declare function icrsPositionToRaDec(
  positionPc: { x: number; y: number; z: number },
  observerPc?: { x: number; y: number; z: number }
): RaDec | null;

export declare function createStarMapProjection(
  project: StarMapProjection['project'],
  options?: { id?: string }
): StarMapProjection;
