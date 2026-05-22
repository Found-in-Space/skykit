import { disposeObjectTree, resolveAnchorRoot } from './utils.js';

/**
 * @typedef {import('./index.d.ts').Object3dLayerOptions} Object3dLayerOptions
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 */

/**
 * @param {Object3dLayerOptions} options
 * @returns {SkykitThreePart}
 */
export function createObject3dLayer(options) {
  if (!options?.object3d) {
    throw new TypeError('createObject3dLayer() requires object3d.');
  }
  const id = options.id ?? options.object3d.name ?? 'object3d-layer';
  const anchorMode = options.anchorMode ?? 'world-space';
  /** @type {import('three').Object3D | null} */
  let parent = null;
  return {
    id,
    priority: options.priority,
    object3d: options.object3d,
    attach(context) {
      parent = resolveAnchorRoot(context.roots, anchorMode, options.scaleBandId);
      parent.add(options.object3d);
    },
    detach() {
      parent?.remove(options.object3d);
      parent = null;
    },
    dispose() {
      parent?.remove(options.object3d);
      parent = null;
      if (options.disposeObject) {
        disposeObjectTree(options.object3d);
      }
    },
    getSnapshot() {
      return {
        id,
        anchorMode,
        scaleBandId: options.scaleBandId ?? null,
        mounted: parent != null,
      };
    },
  };
}
