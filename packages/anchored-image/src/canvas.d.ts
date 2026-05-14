import type {
  AnchoredImage,
  AnchoredImageAnchorTarget,
  AnchoredImageManifest,
  AnchoredImageMesh,
  AnchoredImageMeshVertex,
} from './index.js';

export interface AnchoredImageProjectionResult {
  x: number;
  y: number;
  visible?: boolean;
  depth?: number;
  wrapKey?: string;
}

export type AnchoredImageProjectTarget<Context = unknown> = (
  target: AnchoredImageAnchorTarget,
  context: Context,
  vertex: AnchoredImageMeshVertex,
  mesh: AnchoredImageMesh
) => AnchoredImageProjectionResult | null;

export interface DrawAnchoredImageCanvasOptions<Context = unknown> {
  projectTarget: AnchoredImageProjectTarget<Context>;
  context?: Context;
  sourceImage?: CanvasImageSource;
  imageElement?: CanvasImageSource;
  image?: CanvasImageSource;
  opacity?: number;
  wrapWidth?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  subdivisions?: number;
}

export interface DrawAnchoredImageResult {
  imageId: string | null;
  drawnCount: number;
  skippedCount: number;
  triangleCount: number;
  skippedImages: Array<string | null>;
}

export interface AnchoredImageCanvasLayerRenderContext<Context = unknown> {
  ctx: CanvasRenderingContext2D;
  projectTarget?: AnchoredImageProjectTarget<Context>;
  [key: string]: unknown;
}

export interface AnchoredImageCanvasLayerResult {
  drawnCount: number;
  skippedCount: number;
  imageCount: number;
  loadedImageCount: number;
  pending: boolean;
  error: unknown;
}

export interface AnchoredImageCanvasLayer {
  load(options?: {
    manifest?: unknown;
    manifestUrl?: string | URL;
    baseUrl?: string | URL;
    fetchImpl?: typeof fetch;
  }): Promise<AnchoredImageManifest>;
  render(context: AnchoredImageCanvasLayerRenderContext): AnchoredImageCanvasLayerResult;
  getStats(): AnchoredImageCanvasLayerResult;
  dispose(): void;
}

export interface CreateAnchoredImageCanvasLayerOptions<Context = unknown> {
  manifest?: unknown;
  manifestUrl?: string | URL;
  baseUrl?: string | URL;
  fetchImpl?: typeof fetch;
  projectTarget?: AnchoredImageProjectTarget<Context>;
  imageLoader?: (src: string) => Promise<CanvasImageSource> | CanvasImageSource;
  filter?: (image: AnchoredImage) => boolean;
  groupFilter?: string[];
  skipImageErrors?: boolean;
  onImageError?: (event: {
    image: AnchoredImage;
    imageUrl: string;
    error: unknown;
  }) => void;
  opacity?: number;
  subdivisions?: number;
  wrapWidth?: number;
}

export declare function drawAnchoredImageCanvas<Context = unknown>(
  ctx: CanvasRenderingContext2D,
  image: AnchoredImage,
  options: DrawAnchoredImageCanvasOptions<Context>
): DrawAnchoredImageResult;

export declare function drawAnchoredImageMeshCanvas<Context = unknown>(
  ctx: CanvasRenderingContext2D,
  mesh: AnchoredImageMesh,
  options: DrawAnchoredImageCanvasOptions<Context>
): DrawAnchoredImageResult;

export declare function createAnchoredImageCanvasLayer<Context = unknown>(
  options?: CreateAnchoredImageCanvasLayerOptions<Context>
): AnchoredImageCanvasLayer;
