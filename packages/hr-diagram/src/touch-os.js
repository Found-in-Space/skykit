import { createEmbeddedSurface } from '@found-in-space/touch-os';

export { createHrDiagramSurfaceSource } from './index.js';

/**
 * Create the optional touch-os node that presents an HR texture source. Layout,
 * title rendering, fallback rendering, clipping, and contain geometry are owned
 * by touch-os's released embedded-surface component.
 *
 * @param {import('./touch-os.d.ts').HrDiagramEmbeddedSurfaceNodeOptions} options
 * @returns {import('./touch-os.d.ts').HrDiagramEmbeddedSurfaceNode}
 */
export function createHrDiagramEmbeddedSurfaceNode(options) {
  return createEmbeddedSurface(options.componentId, {
    sourceId: options.sourceId,
    ...(options.title === undefined ? {} : { title: options.title }),
    fallbackLabel: options.fallbackLabel ?? 'HR diagram offline',
    preserveAspectRatio: options.preserveAspectRatio !== false,
    interactive: false,
    acceptsForwardedInput: false,
    desiredSourceType: 'three-texture',
    compositionMode: 'composite',
  });
}
