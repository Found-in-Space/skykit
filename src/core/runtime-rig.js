import * as THREE from 'three';

export function createViewerRuntimeRig(camera) {
  const navigationRoot = new THREE.Group();
  navigationRoot.name = 'viewer-runtime-navigation-root';

  const cameraMount = new THREE.Group();
  cameraMount.name = 'viewer-runtime-camera-mount';

  const attachmentRoot = new THREE.Group();
  attachmentRoot.name = 'viewer-runtime-attachment-root';

  const contentRoot = new THREE.Group();
  contentRoot.name = 'viewer-runtime-content-root';

  navigationRoot.add(cameraMount);
  navigationRoot.add(attachmentRoot);
  cameraMount.add(camera);

  return {
    navigationRoot,
    cameraMount,
    attachmentRoot,
    contentRoot,
    mount: contentRoot,
  };
}
