import type { createEmbeddedSurface } from '@found-in-space/touch-os';

export type {
  HrDiagramSurfaceHandle,
  HrDiagramSurfacePublication,
  HrDiagramSurfacePublisher,
  HrDiagramSurfaceSource,
  HrDiagramSurfaceSourceOptions,
  HrDiagramSurfaceUnpublisher,
} from './index.js';
export { createHrDiagramSurfaceSource } from './index.js';

export interface HrDiagramEmbeddedSurfaceNodeOptions {
  componentId: string;
  sourceId: string;
  /** Renders a touch-os title header above the fitted source viewport. */
  title?: string;
  fallbackLabel?: string;
  /** Defaults to true and centers the source with contain-style fitting. */
  preserveAspectRatio?: boolean;
}

export type HrDiagramEmbeddedSurfaceNode = ReturnType<typeof createEmbeddedSurface>;

export declare function createHrDiagramEmbeddedSurfaceNode(
  options: HrDiagramEmbeddedSurfaceNodeOptions
): HrDiagramEmbeddedSurfaceNode;
