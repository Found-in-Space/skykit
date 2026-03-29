import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createViewerRuntimeRig } from '../runtime-rig.js';

test('createViewerRuntimeRig creates stable roots for content, camera, and attachments', () => {
  const camera = new THREE.PerspectiveCamera();
  const rig = createViewerRuntimeRig(camera);

  assert.equal(rig.navigationRoot.name, 'viewer-runtime-navigation-root');
  assert.equal(rig.cameraMount.name, 'viewer-runtime-camera-mount');
  assert.equal(rig.attachmentRoot.name, 'viewer-runtime-attachment-root');
  assert.equal(rig.contentRoot.name, 'viewer-runtime-content-root');
  assert.equal(rig.mount, rig.contentRoot);
  assert.equal(camera.parent, rig.cameraMount);
  assert.ok(rig.navigationRoot.children.includes(rig.cameraMount));
  assert.ok(rig.navigationRoot.children.includes(rig.attachmentRoot));
});
