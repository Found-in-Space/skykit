import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createConstellationArtLayer } from '../constellation-art-layer.js';

const TEST_MANIFEST = {
  id: 'test-manifest',
  constellations: [
    {
      id: 'test-ori',
      iau: 'Ori',
      image: {
        url: 'data:image/webp;base64,AAA=',
        size: [128, 128],
        anchors: [
          { pos: [10, 10], direction: [1, 0, 0] },
          { pos: [118, 10], direction: [0, 1, 0] },
          { pos: [64, 118], direction: [0, 0, 1] },
        ],
      },
    },
  ],
};

function createFakeTextureLoader() {
  return {
    load(_url, onLoad) {
      onLoad({ dispose() {} });
    },
  };
}

function createSceneRoots() {
  const scene = new THREE.Scene();
  const mount = new THREE.Group();
  const contentRoot = new THREE.Group();
  const navigationRoot = new THREE.Group();
  scene.add(contentRoot);
  scene.add(navigationRoot);
  contentRoot.add(mount);
  return { scene, mount, contentRoot, navigationRoot };
}

test('ConstellationArtLayer tracks observer position by default', async () => {
  const { scene, mount, contentRoot, navigationRoot } = createSceneRoots();
  contentRoot.scale.setScalar(0.25);
  navigationRoot.position.set(3, -2, 5);
  scene.updateMatrixWorld(true);

  const layer = createConstellationArtLayer({
    manifest: TEST_MANIFEST,
    textureLoader: createFakeTextureLoader(),
  });
  await layer.attach({ mount });
  layer.update({
    contentRoot,
    navigationRoot,
    frame: { deltaSeconds: 0.016 },
  });
  scene.updateMatrixWorld(true);

  const layerWorldPosition = new THREE.Vector3();
  const observerWorldPosition = new THREE.Vector3();
  mount.children[0].getWorldPosition(layerWorldPosition);
  navigationRoot.getWorldPosition(observerWorldPosition);
  assert.ok(layerWorldPosition.distanceTo(observerWorldPosition) < 1e-8);
  assert.equal(layer.getConfig().anchorMode, undefined);

  layer.dispose({ mount });
});

test('ConstellationArtLayer tracks observer position without changing orientation', async () => {
  const { scene, mount, contentRoot, navigationRoot } = createSceneRoots();
  contentRoot.scale.setScalar(0.25);
  scene.updateMatrixWorld(true);

  const layer = createConstellationArtLayer({
    manifest: TEST_MANIFEST,
    textureLoader: createFakeTextureLoader(),
  });
  await layer.attach({ mount });

  const layerGroup = mount.children[0];
  const initialQuaternion = layerGroup.quaternion.clone();

  navigationRoot.position.set(8, -4, 20);
  navigationRoot.rotation.set(0.7, -0.3, 0.2);
  scene.updateMatrixWorld(true);
  layer.update({
    contentRoot,
    navigationRoot,
    frame: { deltaSeconds: 0.016 },
  });
  scene.updateMatrixWorld(true);

  const layerWorldPosition = new THREE.Vector3();
  const observerWorldPosition = new THREE.Vector3();
  layerGroup.getWorldPosition(layerWorldPosition);
  navigationRoot.getWorldPosition(observerWorldPosition);

  assert.ok(layerWorldPosition.distanceTo(observerWorldPosition) < 1e-8);
  assert.deepEqual(layerGroup.quaternion.toArray(), initialQuaternion.toArray());

  navigationRoot.position.set(-3, 2, 7);
  navigationRoot.rotation.set(-0.4, 0.5, -0.1);
  scene.updateMatrixWorld(true);
  layer.update({
    contentRoot,
    navigationRoot,
    frame: { deltaSeconds: 0.016 },
  });
  scene.updateMatrixWorld(true);

  layerGroup.getWorldPosition(layerWorldPosition);
  navigationRoot.getWorldPosition(observerWorldPosition);
  assert.ok(layerWorldPosition.distanceTo(observerWorldPosition) < 1e-8);
  assert.deepEqual(layerGroup.quaternion.toArray(), initialQuaternion.toArray());

  layer.dispose({ mount });
});
