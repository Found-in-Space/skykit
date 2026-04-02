import * as THREE from 'three';
import {
  SCALE,
  XR_SUN_EYE_LEVEL_M,
  XR_SUN_FORWARD_OFFSET_M,
  DEFAULT_METERS_PER_PARSEC,
} from '../services/octree/scene-scale.js';

export function createDesktopRig(camera) {
  const navigationRoot = new THREE.Group();
  navigationRoot.name = 'navigationRoot';

  const cameraMount = new THREE.Group();
  cameraMount.name = 'cameraMount';

  const attachmentRoot = new THREE.Group();
  attachmentRoot.name = 'attachmentRoot';

  const contentRoot = new THREE.Group();
  contentRoot.name = 'contentRoot';

  navigationRoot.add(cameraMount);
  navigationRoot.add(attachmentRoot);
  cameraMount.add(camera);

  return {
    type: 'desktop',
    navigationRoot,
    cameraMount,
    attachmentRoot,
    contentRoot,
    mount: contentRoot,
  };
}

/**
 * XR spaceship rig. Scene graph:
 *
 *   scene
 *     ├── universe (contentRoot)           ← stars, scaled by starFieldScale / SCALE
 *     └── spaceship (navigationRoot)       ← MOVES through the universe
 *           └── deck                       ← shifts observer DOWN and BACK
 *                 ├── xrOrigin (cameraMount) → camera
 *                 └── attachmentRoot
 *
 * The universe and spaceship are siblings under the scene — the universe
 * stays at the scene origin while the spaceship moves to represent the
 * observer's position.  This is the same sibling topology as the desktop
 * rig; the differences are the universe scale factor and the deck group.
 *
 * The deck offset shifts the observer DOWN by `eyeLevel` and BACK by
 * `forwardOffset`.  Because the universe origin (the Sun) stays at
 * (0, 0, 0), this makes the Sun appear at face height and slightly in
 * front of the observer — the observer is looking UP at it rather than
 * the universe being pushed down to meet them.
 */
export function createXrRig(camera, options = {}) {
  const starFieldScale = options.starFieldScale ?? DEFAULT_METERS_PER_PARSEC;
  const eyeLevel = options.eyeLevel ?? XR_SUN_EYE_LEVEL_M;
  const forwardOffset = options.forwardOffset ?? XR_SUN_FORWARD_OFFSET_M;

  const universe = new THREE.Group();
  universe.name = 'universe';
  universe.scale.setScalar(starFieldScale / SCALE);

  const spaceship = new THREE.Group();
  spaceship.name = 'spaceship';

  const deck = new THREE.Group();
  deck.name = 'deck';
  deck.position.set(0, -eyeLevel, forwardOffset);

  const xrOrigin = new THREE.Group();
  xrOrigin.name = 'xrOrigin';

  const attachmentRoot = new THREE.Group();
  attachmentRoot.name = 'attachmentRoot';

  spaceship.add(deck);
  deck.add(xrOrigin);
  deck.add(attachmentRoot);
  xrOrigin.add(camera);

  return {
    type: 'xr',
    navigationRoot: spaceship,
    deck,
    cameraMount: xrOrigin,
    attachmentRoot,
    contentRoot: universe,
    mount: universe,
    sunEyeLevel: eyeLevel,
    sunForwardOffset: forwardOffset,

    setStarFieldScale(scale) {
      universe.scale.setScalar(scale / SCALE);
    },
  };
}
