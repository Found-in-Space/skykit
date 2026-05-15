import type {
  CanonicalObjectRef,
  ProductDelta,
  StarObjectBatchProduct,
  StarPickMeta,
} from '@found-in-space/star-products';
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
  sizeScale: number;
  sizePower: number;
  sizeMax: number;
  halo: boolean;
  haloScale: number;
  haloPower: number;
  haloSizeMax: number;
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
  productCount: number;
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

export interface ThreeStarFieldPickOptions extends Partial<ThreeStarFieldView> {
  toleranceDeg?: number;
  minClickRadiusDeg?: number;
  fovRad?: number;
  viewportHeight?: number;
}

export interface ThreeStarFieldPickResult {
  productId: string;
  objectIndex: number;
  product: StarObjectBatchProduct;
  position: ThreeStarFieldVector;
  distancePc: number;
  apparentMagnitude: number;
  visualRadiusPx: number;
  objectRef: CanonicalObjectRef | null;
  pickMeta: StarPickMeta | null;
  teffLog8?: number;
  magAbs?: number;
  score: number;
  angularDistanceDeg: number;
}

export interface ThreeStarFieldPickData {
  products: Iterable<StarObjectBatchProduct>;
  object3d?: THREE.Object3D;
  view?: Partial<ThreeStarFieldView>;
}

export interface ThreeStarField {
  readonly object3d: THREE.Group;
  apply(delta: ProductDelta<StarObjectBatchProduct>): void;
  setProducts(products: Iterable<StarObjectBatchProduct>): void;
  clear(): void;
  setView(view: Partial<ThreeStarFieldView>): void;
  pick(
    ray: THREE.Ray | { origin: ThreeStarFieldVector; direction: ThreeStarFieldVector },
    options?: ThreeStarFieldPickOptions
  ): ThreeStarFieldPickResult | null;
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

export declare function createThreeStarFieldGeometryFromProduct(
  product: StarObjectBatchProduct
): THREE.BufferGeometry;

export declare function createDefaultThreeStarFieldMaterialProfile(
  options?: Partial<ThreeStarFieldView>
): ThreeStarFieldMaterialProfile;

export declare function computeThreeStarFieldVisualRadiusPx(
  input: ThreeStarFieldVisualRadiusInput
): number;

export declare function pickThreeStarFieldData(
  ray: THREE.Ray | { origin: ThreeStarFieldVector; direction: ThreeStarFieldVector },
  data: ThreeStarFieldPickData,
  options?: ThreeStarFieldPickOptions
): ThreeStarFieldPickResult | null;
