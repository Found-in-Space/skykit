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
    matrixWorld: Matrix4;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    clear(): this;
    traverse(callback: (object: Object3D) => void): void;
    updateMatrixWorld(force?: boolean): void;
  }

  export class Group extends Object3D {}
  export class Scene extends Object3D {}
  export class Camera extends Object3D {
    projectionMatrix: Matrix4;
    matrixWorldInverse: Matrix4;
  }
  export class PerspectiveCamera extends Camera {
    fov: number;
    aspect: number;
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    updateProjectionMatrix(): void;
  }

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    add(vector: Vector3): this;
    addScaledVector(vector: Vector3, scale: number): this;
    sub(vector: Vector3): this;
    lengthSq(): number;
    normalize(): this;
    applyQuaternion(quaternion: Quaternion): this;
  }

  export class Vector2 {
    x: number;
    y: number;
    constructor(x?: number, y?: number);
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x?: number, y?: number, z?: number, w?: number);
    setFromAxisAngle(axis: Vector3, angle: number): this;
    multiply(quaternion: Quaternion): this;
    premultiply(quaternion: Quaternion): this;
    normalize(): this;
  }

  export class Matrix4 {
    elements: number[];
    constructor();
    copy(matrix: Matrix4): this;
    invert(): this;
    identity(): this;
    multiplyMatrices(a: Matrix4, b: Matrix4): this;
  }

  export class Ray {
    origin: Vector3;
    direction: Vector3;
    constructor(origin?: Vector3, direction?: Vector3);
    clone(): Ray;
  }

  export class Raycaster {
    ray: Ray;
    constructor(origin?: Vector3, direction?: Vector3, near?: number, far?: number);
    setFromCamera(coords: Vector2, camera: Camera): void;
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
    xr?: {
    enabled?: boolean;
    isPresenting?: boolean;
    getSession?(): unknown;
    getReferenceSpace?(): unknown;
    setSession?(session: unknown): Promise<void> | void;
    updateCamera?(camera: Camera): void;
  };
    setSize?(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio?(ratio: number): void;
    setAnimationLoop?(callback: ((timeMs: number, xrFrame?: unknown) => void) | null): void;
    render?(scene: Scene, camera: Camera): void;
    dispose?(): void;
  }
}
