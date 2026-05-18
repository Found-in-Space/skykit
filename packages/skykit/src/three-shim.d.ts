declare module 'three' {
  export class Object3D {
    readonly isObject3D: boolean;
    name: string;
    parent: Object3D | null;
    children: Object3D[];
    userData: Record<string, any>;
    visible: boolean;
    position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
    quaternion: { x: number; y: number; z: number; w: number; set(x: number, y: number, z: number, w: number): void; identity(): void };
    scale: { x: number; y: number; z: number; setScalar(value: number): void };
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    clear(): this;
    traverse(callback: (object: Object3D) => void): void;
  }

  export class Group extends Object3D {}
  export class Scene extends Object3D {}
  export class Camera extends Object3D {}
  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
  }

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    add(vector: Vector3): this;
    sub(vector: Vector3): this;
    applyQuaternion(quaternion: Quaternion): this;
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
  }

  export class Texture {
    dispose(): void;
  }

  export class TextureLoader {
    load(
      url: string,
      onLoad?: (texture: Texture) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void
    ): Texture;
  }

  export class Material {
    opacity: number;
    transparent: boolean;
    uniforms?: Record<string, { value: unknown }>;
    dispose(): void;
  }

  export class ShaderMaterial extends Material {}

  export class BufferGeometry {
    dispose(): void;
  }

  export class Mesh extends Object3D {
    readonly isMesh: boolean;
    geometry: BufferGeometry;
    material: Material | Material[];
  }

  export interface WebGLRenderer {
    domElement?: unknown;
    setSize?(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio?(ratio: number): void;
    render?(scene: Scene, camera: Camera): void;
    dispose?(): void;
  }
}
