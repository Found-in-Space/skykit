import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * Project a world-space position onto the camera's HUD plane at a fixed
 * focal distance.
 *
 * Returns a camera-local position that, when assigned to a child of the
 * camera, makes the child appear at `distance` meters from the viewer
 * in the exact direction of `worldPosition`.  Each eye sees the HUD
 * element at a genuinely different angle, giving proper stereo
 * convergence at the chosen depth.
 *
 * This is the standard pattern for XR HUD indicators that need to
 * visually align with universe-space objects while remaining at a
 * comfortable focal depth.  Use it for selection rings, labels,
 * distance readouts, or any indicator that should appear "pinned" to
 * a star or other scene object.
 *
 * @param {THREE.Vector3} worldPosition  Position of the target in world space.
 * @param {THREE.Camera}  camera         The XR camera (must have up-to-date matrixWorld).
 * @param {number}        distance       HUD focal distance in meters (e.g. 2.5).
 * @param {THREE.Vector3} [target]       Optional vector to write the result into.
 * @returns {THREE.Vector3} Camera-local position at `distance` along the
 *   direction to `worldPosition`.
 */
export function projectToHud(worldPosition, camera, distance, target) {
  if (!target) target = new THREE.Vector3();
  _v.copy(worldPosition);
  camera.worldToLocal(_v);
  const len = _v.length();
  if (len > 0) {
    target.copy(_v).multiplyScalar(distance / len);
  } else {
    target.set(0, 0, -distance);
  }
  return target;
}
