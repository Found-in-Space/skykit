import * as THREE from 'three';

/**
 * One aggregate target, using the field's existing angular scoring and complete pick result.
 * This optional adapter has no runtime dependency on TouchOS.
 * @param {import('./interaction.d.ts').ThreeStarFieldInteractionOptions} options
 * @returns {import('@found-in-space/touch-os/interaction').InteractionTarget}
 */
export function createThreeStarFieldTarget(options) {
  const { field } = options;
  /** @type {WeakMap<object, number>} */
  const revisions = new WeakMap();
  let nextRevision = 0;
  return {
    id: options.id,
    priority: options.priority ?? 0,
    enabled() {
      for (let object = /** @type {THREE.Object3D | null} */ (field.object3d); object; object = object.parent) if (!object.visible) return false;
      return !field.getSnapshot().disposed;
    },
    query(source) {
      if (!source.ray) return null;
      field.object3d.updateWorldMatrix(true, false);
      const result = field.pick(source.ray, typeof options.pickOptions === 'function' ? options.pickOptions() : options.pickOptions);
      if (!result) return null;
      const point = new THREE.Vector3(result.position.x, result.position.y, result.position.z).applyMatrix4(field.object3d.matrixWorld);
      const origin = new THREE.Vector3().copy(source.ray.origin);
      let revision = revisions.get(result.cell);
      if (revision === undefined) { revision = nextRevision++; revisions.set(result.cell, revision); }
      const ref = result.objectRef;
      const subtargetId = ref ? JSON.stringify([ref.datasetId ?? null, ref.level, ref.mortonCode, ref.ordinal])
        : `${result.cellKey}:${revision}:${result.objectIndex}`;
      return { targetId: options.id, subtargetId, point, distance: point.distanceTo(origin), local: { x: 0, y: 0 }, metadata: result };
    },
    deliver(event) {
      if (event.type !== 'activate') return;
      options.onSelect(/** @type {import('./index.d.ts').ThreeStarFieldPickResult} */ (event.hit.metadata), event);
    },
  };
}
