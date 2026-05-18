export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export declare const ANCHORED_IMAGE_MANIFEST_FORMAT: 'found-in-space/anchored-image-manifest@1';
export declare const ANCHORED_IMAGE_MANIFEST_SCHEMA_ID: 'https://schemas.found-in.space/anchored-image-manifest.v1.schema.json';
export type AnchoredImageManifestFormat = typeof ANCHORED_IMAGE_MANIFEST_FORMAT;

export type AnchoredImageAnchorTarget =
  | { kind: 'direction'; frame: 'icrs'; x: number; y: number; z: number }
  | { kind: 'position'; frame: 'icrs-pc'; x: number; y: number; z: number };

export interface AnchoredImageAnchor {
  pixel: Vec2;
  target: AnchoredImageAnchorTarget;
  metadata?: Record<string, unknown>;
}

export interface AnchoredImageSource {
  src: string;
  width: number;
  height: number;
  anchors: AnchoredImageAnchor[];
}

export interface AnchoredImage {
  id: string;
  label?: string;
  groupId?: string;
  image: AnchoredImageSource;
  attribution?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AnchoredImageManifest {
  format: AnchoredImageManifestFormat;
  id?: string;
  label?: string;
  assetBaseUrl?: string | null;
  images: AnchoredImage[];
  attribution?: unknown;
  metadata?: Record<string, unknown>;
}

export interface LoadAnchoredImageManifestOptions {
  manifest?: unknown;
  manifestUrl?: string | URL;
  baseUrl?: string | URL;
  fetchImpl?: typeof fetch;
}

export interface NormalizeAnchoredImageManifestOptions {
  baseUrl?: string | URL;
}

export interface SolvedAnchoredImage {
  image: AnchoredImage;
  targetKind: AnchoredImageAnchorTarget['kind'];
  targetFrame: AnchoredImageAnchorTarget['frame'];
  targetAt(pixel: Vec2): AnchoredImageAnchorTarget | null;
}

export interface AnchoredImageMeshVertex {
  pixel: Vec2;
  uv: { u: number; v: number };
  target: AnchoredImageAnchorTarget;
}

export interface AnchoredImageMesh {
  image: AnchoredImage;
  vertices: AnchoredImageMeshVertex[];
  triangles: Array<[number, number, number]>;
}

export interface SolveAnchoredImageOptions {
  transformTarget?: (
    x: number,
    y: number,
    z: number,
    target: AnchoredImageAnchorTarget
  ) => [number, number, number];
}

export interface SolveAnchoredImageMeshOptions extends SolveAnchoredImageOptions {
  subdivisions?: number;
}

export interface AnchoredImageResolveResult {
  imageId: string;
  groupId: string | null;
  label: string | null;
  iau: unknown;
  id: string;
  name: unknown;
  score: number;
}

export interface AnchoredImageSummary {
  imageId: string;
  groupId: string | null;
  label: string | null;
  iau: unknown;
  id: string;
  name: unknown;
  hasArt: boolean;
  centroidIcrs: [number, number, number] | null;
  centroidRaDec: RaDec | null;
  imageUpIcrs: [number, number, number] | null;
  imageUpRaDec: RaDec | null;
  cornersIcrs: Array<[number, number, number]> | null;
  cornersRaDec: Array<RaDec | null> | null;
  attribution?: unknown;
  metadata: Record<string, unknown>;
}

export interface AnchoredImageDirectionResolver {
  resolve(
    icrsDirection: [number, number, number] | Vec3,
    currentGroupId?: string | null
  ): AnchoredImageResolveResult | null;
  toRaDec(icrsDirection: [number, number, number] | Vec3): RaDec | null;
  listImages(): AnchoredImageSummary[];
  getImage(nameOrId: string): AnchoredImageSummary | null;
  getStats(): {
    imageCount: number;
    listedImageCount: number;
  };
}

export interface RaDec {
  raDeg: number;
  raHours: number;
  decDeg: number;
}

export declare function invert3(
  matrix: [[number, number, number], [number, number, number], [number, number, number]]
): [[number, number, number], [number, number, number], [number, number, number]] | null;

export declare function multiplyMatrixVector(
  matrix: [[number, number, number], [number, number, number], [number, number, number]],
  values: [number, number, number]
): [number, number, number];

export declare function normalizeDirection(
  value: [number, number, number] | Vec3 | unknown
): [number, number, number] | null;

export declare function resolveAnchorDirection(anchor: unknown): [number, number, number] | null;

export declare function normalizeAnchoredImageManifest(
  input: unknown,
  options?: NormalizeAnchoredImageManifestOptions
): AnchoredImageManifest;

export declare function resolveAnchoredImageAssets(
  manifest: unknown,
  options?: LoadAnchoredImageManifestOptions
): AnchoredImageManifest;

export declare function loadAnchoredImageManifest(
  options?: LoadAnchoredImageManifestOptions
): Promise<AnchoredImageManifest>;

export declare function solveAffineMap(
  anchors: AnchoredImageAnchor[],
  transformTarget?: (
    x: number,
    y: number,
    z: number,
    target: AnchoredImageAnchorTarget
  ) => [number, number, number]
): ((u: number, v: number) => [number, number, number]) | null;

export declare function solveAnchoredImage(
  image: unknown,
  options?: SolveAnchoredImageOptions
): SolvedAnchoredImage | null;

export declare function solveAnchoredImageMesh(
  image: unknown,
  options?: SolveAnchoredImageMeshOptions
): AnchoredImageMesh | null;

export declare function buildAnchoredImageDirectionResolver(
  manifestInput: unknown
): AnchoredImageDirectionResolver;

export declare function icrsDirectionToTargetPc(
  icrsDirection: [number, number, number] | Vec3 | unknown,
  distancePc: number,
  observerPc?: Vec3
): Vec3 | null;

export declare function toRaDec(
  icrsDirection: [number, number, number] | Vec3 | unknown
): RaDec | null;
