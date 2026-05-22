import type {
  AnchoredImage,
  AnchoredImageAnchorTarget,
  AnchoredImageManifest,
  AnchoredImageMesh,
} from './index.js';
import type * as THREE from 'three';

export declare const ANCHORED_IMAGE_VERTEX_SHADER: string;
export declare const ANCHORED_IMAGE_FRAGMENT_SHADER: string;

export interface CreateAnchoredImageMeshObjectOptions {
  texture: THREE.Texture;
  index?: number;
  radius?: number;
  radiusOffset?: number;
  positionScale?: number;
  opacity?: number;
  cutoff?: number;
  renderOrder?: number;
  namePrefix?: string;
  vertexShader?: string;
  fragmentShader?: string;
  transformDirection?: (
    x: number,
    y: number,
    z: number,
    target: AnchoredImageAnchorTarget
  ) => [number, number, number];
  transformPosition?: (
    x: number,
    y: number,
    z: number,
    target: AnchoredImageAnchorTarget
  ) => [number, number, number] | { x: number; y: number; z: number };
}

export interface CreateAnchoredImageGroupOptions
  extends Omit<CreateAnchoredImageMeshObjectOptions, 'texture' | 'index'> {
  manifest?: unknown;
  manifestUrl?: string | URL;
  baseUrl?: string | URL;
  fetchImpl?: typeof fetch;
  textureLoader?: THREE.TextureLoader;
  id?: string;
  name?: string;
  subdivisions?: number;
  filter?: (image: AnchoredImage) => boolean;
  groupFilter?: string[];
  skipTextureErrors?: boolean;
  onTextureError?: (event: {
    image: AnchoredImage;
    imageUrl: string;
    error: unknown;
  }) => void;
}

export interface AnchoredImageGroup extends THREE.Group {
  userData: THREE.Object3D['userData'] & {
    anchoredImage?: {
      meshCount: number;
      dispose: () => void;
      source: {
        manifestId: string | null;
        manifestUrl: string | null;
        assetBaseUrl: string | null;
      };
    };
  };
}

export declare function createAnchoredImageMeshObject(
  mesh: AnchoredImageMesh,
  options: CreateAnchoredImageMeshObjectOptions
): THREE.Mesh;

export declare function createAnchoredImageGroup(
  options?: CreateAnchoredImageGroupOptions
): Promise<AnchoredImageGroup>;

export declare function disposeAnchoredImageObject(object: THREE.Object3D | null | undefined): void;
