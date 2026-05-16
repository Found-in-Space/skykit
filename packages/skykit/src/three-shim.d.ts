declare module 'three' {
  export class Object3D {
    name: string;
    parent: Object3D | null;
    children: Object3D[];
    position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
    quaternion: { x: number; y: number; z: number; w: number; set(x: number, y: number, z: number, w: number): void; identity(): void };
    scale: { x: number; y: number; z: number; setScalar(value: number): void };
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
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

  export interface WebGLRenderer {
    domElement?: unknown;
    setSize?(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio?(ratio: number): void;
    render?(scene: Scene, camera: Camera): void;
    dispose?(): void;
  }
}
