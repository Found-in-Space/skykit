import * as THREE from 'three';
import {
  clonePose,
  cloneVector3,
  normalizePose,
  normalizeScaleProfile,
  normalizeVector3,
} from '@found-in-space/spatial';

const DEFAULT_DECK_OFFSET = Object.freeze({ x: 0, y: -1.6, z: 0.5 });

/**
 * @param {import('../xr.d.ts').CreateSkykitXrRigOptions} [options]
 * @returns {import('../xr.d.ts').SkykitXrRig}
 */
export function createSkykitXrRig(options = {}) {
  const id = options.id ?? 'found-in-space-xr-rig';
  const scaleProfile = normalizeScaleProfile(options.scaleProfile);
  const deckOffset = normalizeVector3(options.deckOffset, DEFAULT_DECK_OFFSET);
  const originContentRoot = namedGroup(`${id}:origin-content-root`);
  const observerContentRoot = namedGroup(`${id}:observer-content-root`);
  const navigationRoot = namedGroup(`${id}:navigation-root`);
  const deckRoot = namedGroup(`${id}:deck-root`);
  const xrOrigin = namedGroup(`${id}:xr-origin`);
  const headRoot = namedGroup(`${id}:head-root`);
  const leftHandRoot = namedGroup(`${id}:left-hand-root`);
  const rightHandRoot = namedGroup(`${id}:right-hand-root`);
  const attachmentRoot = namedGroup(`${id}:attachment-root`);
  const shipMountRoot = namedGroup(`${id}:ship-mount-root`);
  /** @type {Record<string, THREE.Group>} */
  const scaleBandedContentRoots = {};
  /** @type {import('../xr.d.ts').SkykitXrPose} */
  let navigationPose = normalizePose(options.navigationPose ?? {});
  let disposed = false;

  navigationRoot.add(shipMountRoot);
  navigationRoot.add(deckRoot);
  deckRoot.position.set(deckOffset.x, deckOffset.y, deckOffset.z);
  deckRoot.add(xrOrigin);
  deckRoot.add(attachmentRoot);
  xrOrigin.add(headRoot);
  xrOrigin.add(leftHandRoot);
  xrOrigin.add(rightHandRoot);

  if (options.camera) {
    headRoot.add(options.camera);
  }

  for (const rootId of options.scaleBandIds ?? []) {
    getScaleBandedContentRoot(rootId);
  }

  setNavigationPose(navigationPose);

  return {
    id,
    originContentRoot,
    observerContentRoot,
    scaleBandedContentRoots,
    navigationRoot,
    spaceshipRoot: navigationRoot,
    deckRoot,
    xrOrigin,
    headRoot,
    cameraMount: headRoot,
    leftHandRoot,
    rightHandRoot,
    attachmentRoot,
    shipMountRoot,
    contentRoot: originContentRoot,
    getScaleBandedContentRoot,
    setNavigationPose,
    getNavigationPose,
    setScaleProfile,
    getScaleProfile,
    syncObserverContentRoot,
    attachCamera,
    getSnapshot,
    dispose,
  };

  /**
   * @param {string} rootId
   */
  function getScaleBandedContentRoot(rootId) {
    assertActive();
    const key = String(rootId || '').trim();
    if (!key) {
      throw new TypeError('getScaleBandedContentRoot() requires a root id.');
    }
    if (!scaleBandedContentRoots[key]) {
      scaleBandedContentRoots[key] = namedGroup(`${id}:scale-banded:${key}`);
    }
    return scaleBandedContentRoots[key];
  }

  /**
   * @param {Partial<import('../xr.d.ts').SkykitXrPose>} pose
   */
  function setNavigationPose(pose) {
    assertActive();
    navigationPose = normalizePose({
      position: pose.position ?? navigationPose.position,
      orientation: pose.orientation ?? navigationPose.orientation,
    });
    const worldScale = scaleProfile.worldUnitsPerNavigationUnit;
    navigationRoot.position.set(
      navigationPose.position.x * worldScale,
      navigationPose.position.y * worldScale,
      navigationPose.position.z * worldScale,
    );
    navigationRoot.quaternion.set(
      navigationPose.orientation.x,
      navigationPose.orientation.y,
      navigationPose.orientation.z,
      navigationPose.orientation.w,
    );
    syncObserverContentRoot();
  }

  function getNavigationPose() {
    return clonePose(navigationPose);
  }

  /**
   * @param {import('../xr.d.ts').SkykitXrScaleProfile} nextProfile
   */
  function setScaleProfile(nextProfile) {
    assertActive();
    const normalized = normalizeScaleProfile(nextProfile);
    scaleProfile.navigationUnits = normalized.navigationUnits;
    scaleProfile.metersPerNavigationUnit = normalized.metersPerNavigationUnit;
    scaleProfile.worldUnitsPerNavigationUnit = normalized.worldUnitsPerNavigationUnit;
    setNavigationPose(navigationPose);
  }

  function getScaleProfile() {
    return { ...scaleProfile };
  }

  function syncObserverContentRoot() {
    const worldScale = scaleProfile.worldUnitsPerNavigationUnit;
    observerContentRoot.position.set(
      navigationPose.position.x * worldScale,
      navigationPose.position.y * worldScale,
      navigationPose.position.z * worldScale,
    );
    observerContentRoot.quaternion.identity();
    observerContentRoot.scale.setScalar(1);
  }

  /**
   * @param {THREE.Camera} camera
   */
  function attachCamera(camera) {
    assertActive();
    headRoot.add(camera);
  }

  function getSnapshot() {
    return {
      id,
      disposed,
      navigationPose: clonePose(navigationPose),
      scaleProfile: { ...scaleProfile },
      deckOffset: cloneVector3(deckOffset),
      rootNames: {
        originContentRoot: originContentRoot.name,
        observerContentRoot: observerContentRoot.name,
        navigationRoot: navigationRoot.name,
        deckRoot: deckRoot.name,
        xrOrigin: xrOrigin.name,
        headRoot: headRoot.name,
        leftHandRoot: leftHandRoot.name,
        rightHandRoot: rightHandRoot.name,
        attachmentRoot: attachmentRoot.name,
        shipMountRoot: shipMountRoot.name,
        scaleBandedContentRoots: Object.keys(scaleBandedContentRoots),
      },
    };
  }

  function dispose() {
    if (disposed) return;
    for (const root of [
      originContentRoot,
      observerContentRoot,
      navigationRoot,
      deckRoot,
      xrOrigin,
      headRoot,
      leftHandRoot,
      rightHandRoot,
      attachmentRoot,
      shipMountRoot,
      ...Object.values(scaleBandedContentRoots),
    ]) {
      root.parent?.remove(root);
      while (root.children.length > 0) {
        root.remove(root.children[0]);
      }
    }
    disposed = true;
  }

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitXrRig has been disposed.');
    }
  }
}

/**
 * @param {string} name
 */
function namedGroup(name) {
  const group = new THREE.Group();
  group.name = name;
  return group;
}
