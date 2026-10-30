import * as THREE from 'three';
import { createWebXRInteractionInput } from '@found-in-space/touch-os/hosts/three';

/**
 * Connect SkyKit's XR scene root and renderer to TouchOS semantic input. Controller/grip
 * objects are borrowed from Three and restored to their original parents on disposal.
 * @param {import('./interaction.d.ts').SkykitInteractionInputOptions} options
 * @returns {import('./interaction.d.ts').SkykitInteractionInput}
 */
export function createSkykitInteractionInput(options) {
  const slots = [0, 1].map(index => {
    const controller = options.renderer.xr.getController(index), grip = options.renderer.xr.getControllerGrip(index);
    const controllerParent = controller.parent, gripParent = grip.parent;
    options.origin.add(controller, grip);
    const slot = { controller, grip, input: /** @type {XRInputSource | undefined} */ (undefined) };
    /** @param {{ data: XRInputSource }} event */
    const connected = event => { slot.input = event.data; };
    const disconnected = () => { slot.input = undefined; };
    controller.addEventListener('connected', connected); controller.addEventListener('disconnected', disconnected);
    return { ...slot, get inputSource() { return slot.input; }, restore() {
      controller.removeEventListener('connected', connected); controller.removeEventListener('disconnected', disconnected);
      controller.removeFromParent(); grip.removeFromParent(); controllerParent?.add(controller); gripParent?.add(grip);
    } };
  });
  const input = createWebXRInteractionInput({ xr: options.renderer.xr, origin: options.origin,
    ...(options.include ? { include: options.include } : {}), ...(options.now ? { now: options.now } : {}) });
  let disposed = false;
  return {
    sample: input.sample, reset: input.reset,
    dispose() {
      if (disposed) return;
      disposed = true; input.dispose(); for (const slot of slots) slot.restore();
    },
    getGripPose(handedness) {
      if (disposed) return undefined;
      const session = options.renderer.xr.getSession();
      if (!session || session.visibilityState !== 'visible') return undefined;
      const frame = options.renderer.xr.getFrame?.(), referenceSpace = options.renderer.xr.getReferenceSpace();
      if (frame && referenceSpace) {
        const source = Array.from(session.inputSources).find(input => input.handedness === handedness && input.gripSpace);
        const pose = source?.gripSpace ? frame.getPose(source.gripSpace, referenceSpace) : null;
        if (!pose) return undefined;
        options.origin.updateWorldMatrix(true, false);
        const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix).premultiply(options.origin.matrixWorld);
        const position = new THREE.Vector3(), orientation = new THREE.Quaternion();
        matrix.decompose(position, orientation, new THREE.Vector3());
        return { position, orientation };
      }
      const entry = slots.find(slot => slot.inputSource?.handedness === handedness);
      if (!entry?.grip.visible) return undefined;
      entry.grip.updateWorldMatrix(true, false);
      return { position: entry.grip.getWorldPosition(new THREE.Vector3()), orientation: entry.grip.getWorldQuaternion(new THREE.Quaternion()) };
    }
  };
}

/**
 * Schedule one environment after movement and world transforms. The environment is borrowed.
 * @param {import('./interaction.d.ts').SkykitInteractionPluginOptions} options
 * @returns {import('./index.d.ts').SkykitPlugin}
 */
export function createSkykitInteractionPlugin(options) {
  return { id: options.id ?? 'skykit:interaction', setup(context) {
    return context.addPart({ id: options.id ?? 'skykit:interaction', priority: 200, update(frame) {
      options.environment.update({ timestamp: (options.now ?? (() => performance.now()))(),
        scene: frame.scene, camera: frame.camera, ...(options.frame?.(frame) ?? {}) });
    } });
  } };
}
