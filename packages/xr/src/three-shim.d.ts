declare module 'three' {
  export class Group {
    name: string;
    parent: Group | null;
    children: any[];
    position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
    quaternion: { x: number; y: number; z: number; w: number; set(x: number, y: number, z: number, w: number): void; identity(): void };
    scale: { x: number; y: number; z: number; setScalar(value: number): void };
    add(...objects: any[]): this;
    remove(...objects: any[]): this;
    clear(): this;
  }

  export class Camera extends Group {}
  export class PerspectiveCamera extends Camera {}
}
