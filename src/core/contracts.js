/**
 * Phase 1 runtime lifecycle hooks shared by layers, controllers, overlays, and
 * interest fields. Each hook is optional and receives the live runtime context.
 *
 * @typedef {Object} ViewerRuntimePart
 * @property {string} [id]
 * @property {(context: ViewerRuntimeContext) => (void | Promise<void>)} [attach]
 * @property {(context: ViewerRuntimeContext) => (void | Promise<void>)} [start]
 * @property {(context: ViewerRuntimeFrameContext) => (void | Promise<void>)} [update]
 * @property {(context: ViewerRuntimeResizeContext) => (void | Promise<void>)} [resize]
 * @property {(context: ViewerRuntimeContext) => (void | Promise<void>)} [dispose]
 */

/**
 * @typedef {Object} ViewerNodeSelection
 * @property {string | null} [strategy]
 * @property {unknown[]} [nodes]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {Object} ViewerRuntimeContext
 * @property {import('./viewer-runtime.js').ViewerRuntime} runtime
 * @property {import('./dataset-session.js').DatasetSession | null} datasetSession
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').Camera} camera
 * @property {import('three').Group} mount
 * @property {HTMLElement} host
 * @property {HTMLCanvasElement} canvas
 * @property {{ width: number, height: number }} size
 * @property {Record<string, unknown>} state
 * @property {ViewerNodeSelection} selection
 * @property {string} phase
 */

/**
 * @typedef {ViewerRuntimeContext & {
 *   frame: { deltaSeconds: number, elapsedSeconds: number, frameNumber: number, timeMs: number }
 * }} ViewerRuntimeFrameContext
 */

/**
 * @typedef {ViewerRuntimeContext & {
 *   previousSize: { width: number, height: number } | null
 * }} ViewerRuntimeResizeContext
 */

export const RUNTIME_LIFECYCLE_METHODS = Object.freeze([
  'attach',
  'start',
  'update',
  'resize',
  'dispose',
]);

