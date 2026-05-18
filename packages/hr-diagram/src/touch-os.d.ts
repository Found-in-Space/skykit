import type { StarCellData, StarCellDelta } from '@found-in-space/star-products';
import type * as THREE from 'three';
import type {
  HrDiagramRenderer,
  HrDiagramRendererOptions,
  HrDiagramRendererSnapshot,
  HrDiagramView,
} from './index.js';

export interface HrDiagramEmbeddedSurfaceNodeOptions {
  componentId: string;
  sourceId: string;
  title?: string;
  fallbackLabel?: string;
  preserveAspectRatio?: boolean;
}

export interface HrDiagramEmbeddedSurfaceNode {
  id: string;
  component: {
    kind: 'embedded-surface';
    mount(ctx: unknown): unknown;
    update(ctx: unknown): void;
    measure(ctx: unknown): { width: number; height: number };
    render(ctx: unknown): readonly unknown[];
    dispose(ctx: unknown): void;
  };
  props: {
    sourceId: string;
    title?: string;
    interactive: false;
    acceptsForwardedInput: false;
    preserveAspectRatio: boolean;
    compositionMode: 'composite';
    fallbackLabel: string;
    desiredSourceType: 'three-texture';
  };
}

export interface HrDiagramSurfaceHandle {
  kind: 'three-texture';
  texture: THREE.Texture;
}

export interface HrDiagramSurfaceSource {
  readonly sourceId: string;
  readonly handle: HrDiagramSurfaceHandle;
  readonly target: THREE.WebGLRenderTarget;
  readonly renderer: HrDiagramRenderer;
  apply(delta: StarCellDelta): void;
  setCells(cells: Iterable<StarCellData>): void;
  setView(view: HrDiagramView): void;
  render(renderer: THREE.WebGLRenderer, timestamp?: number): void;
  publish(surfaces: {
    publish(sourceId: string, update: Record<string, unknown>): void;
  }, timestamp?: number): void;
  unpublish(surfaces: {
    unpublish(sourceId: string): void;
  }): void;
  getSnapshot(): HrDiagramRendererSnapshot & {
    sourceId: string;
    width: number;
    height: number;
  };
  dispose(): void;
}

export declare function createHrDiagramEmbeddedSurfaceNode(
  options: HrDiagramEmbeddedSurfaceNodeOptions
): HrDiagramEmbeddedSurfaceNode;

export declare function createHrDiagramSurfaceSource(options?: {
  sourceId?: string;
  width?: number;
  height?: number;
  rendererOptions?: HrDiagramRendererOptions;
}): HrDiagramSurfaceSource;
