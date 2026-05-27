import type {
  StarCellData,
  StarCellDelta,
  StarObjectRef,
  StarPickMeta,
} from '@found-in-space/star-trees';
import type * as THREE from 'three';

export interface ThreeStarFieldVector {
  x: number;
  y: number;
  z: number;
}

export interface ThreeStarFieldView {
  observerPosition: ThreeStarFieldVector;
  limitingMagnitude: number;
  coordinateUnitsPerParsec: number;
  renderScale: number;
  exposure: number;
  magFadeRange: number;
  baseSize: number;
  sizeFluxScale: number;
  sizeScale: number;
  sizePower: number;
  sizeMax: number;
  halo: boolean;
  haloScale: number;
  haloPower: number;
  haloSizeMax: number;
  extinctionScale: number;
  nearMagLimitFloor: number;
  nearMagLimitRadiusPc: number;
  nearMagLimitFeatherPc: number;
  nearSizeFloor: number;
  nearAlphaFloor: number;
}

export interface ThreeStarFieldOptions extends Partial<ThreeStarFieldView> {
  id?: string;
  materialProfile?: THREE.Material | ThreeStarFieldMaterialProfile;
  materialFactory?: (
    context: ThreeStarFieldMaterialFactoryContext
  ) => THREE.Material | ThreeStarFieldMaterialProfile;
  frustumCulled?: boolean;
  disposeMaterialProfile?: boolean;
}

export interface ThreeStarFieldMaterialFactoryContext {
  fieldId: string;
  view: ThreeStarFieldView;
}

export interface ThreeStarFieldMaterialUniformContext {
  view: ThreeStarFieldView;
}

export interface ThreeStarFieldMaterialProfile {
  material: THREE.Material;
  haloMaterial?: THREE.Material | null;
  updateUniforms?: (context: ThreeStarFieldMaterialUniformContext) => void;
  dispose?: () => void;
}

export interface ThreeStarFieldSnapshot {
  status: 'idle' | 'streaming' | 'current' | 'failed' | 'disposed';
  cellCount: number;
  starCount: number;
  renderObjectCount: number;
  bytes: number;
  disposed: boolean;
  view: ThreeStarFieldView;
  lastError?: string | null;
  lastCurrentRevision?: {
    viewRevision?: number;
    demandRevision?: number;
  } | null;
}

export interface ThreeStarFieldBounds {
  units: 'render' | 'parsec';
  coordinateUnitsPerParsec: number;
  starCount: number;
  min: ThreeStarFieldVector;
  max: ThreeStarFieldVector;
}

export interface ThreeStarFieldBoundsOptions {
  units?: 'render' | 'parsec';
}

export interface ThreeStarFieldPickOptions extends Partial<ThreeStarFieldView> {
  toleranceDeg?: number;
  minClickRadiusDeg?: number;
  fovRad?: number;
  viewportHeight?: number;
}

export interface ThreeStarFieldPickResult {
  cellKey: string;
  objectIndex: number;
  cell: StarCellData;
  position: ThreeStarFieldVector;
  distancePc: number;
  apparentMagnitude: number;
  visualRadiusPx: number;
  objectRef: StarObjectRef | null;
  pickMeta: StarPickMeta | null;
  teffLog8?: number;
  magAbs?: number;
  score: number;
  angularDistanceDeg: number;
}

export interface ThreeStarFieldPickData {
  cells: Iterable<StarCellData>;
  object3d?: THREE.Object3D;
  view?: Partial<ThreeStarFieldView>;
}

export interface ThreeStarField {
  readonly object3d: THREE.Group;
  apply(delta: StarCellDelta): void;
  setCells(cells: Iterable<StarCellData>): void;
  clear(): void;
  setView(view: Partial<ThreeStarFieldView>): void;
  pick(
    ray: THREE.Ray | { origin: ThreeStarFieldVector; direction: ThreeStarFieldVector },
    options?: ThreeStarFieldPickOptions
  ): ThreeStarFieldPickResult | null;
  getVisibleBounds(options?: ThreeStarFieldBoundsOptions): ThreeStarFieldBounds | null;
  getSnapshot(): ThreeStarFieldSnapshot;
  dispose(): void;
}

export interface ThreeStarFieldVisualRadiusInput extends Partial<ThreeStarFieldView> {
  apparentMagnitude?: number;
  magAbs?: number;
  distancePc?: number;
}

export declare const DEFAULT_THREE_STAR_FIELD_VIEW: ThreeStarFieldView;

export declare function createThreeStarField(
  options?: ThreeStarFieldOptions
): ThreeStarField;

export declare function createThreeStarFieldGeometryFromCells(
  cells: Iterable<StarCellData>
): THREE.BufferGeometry;

export declare function createDefaultThreeStarFieldMaterialProfile(
  options?: Partial<ThreeStarFieldView>
): ThreeStarFieldMaterialProfile;

export declare function createProceduralThreeStarFieldMaterialProfile(
  options?: Partial<ThreeStarFieldView>
): ThreeStarFieldMaterialProfile;

export declare function createVrThreeStarFieldMaterialProfile(
  options?: Partial<ThreeStarFieldView> & {
    sizeMin?: number;
    magLimitNear?: number;
    nearDistanceLo?: number;
    nearDistanceHi?: number;
    clipMargin?: number;
    safeMinSize?: number;
    hyperlocalSizeMax?: number;
    nearfieldRadiusPc?: number;
    nearfieldMinIntensity?: number;
  }
): ThreeStarFieldMaterialProfile;

export declare function computeThreeStarFieldVisualRadiusPx(
  input: ThreeStarFieldVisualRadiusInput
): number;

export declare function pickThreeStarFieldData(
  ray: THREE.Ray | { origin: ThreeStarFieldVector; direction: ThreeStarFieldVector },
  data: ThreeStarFieldPickData,
  options?: ThreeStarFieldPickOptions
): ThreeStarFieldPickResult | null;
