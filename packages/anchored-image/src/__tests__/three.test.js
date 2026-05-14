import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  createAnchoredImageGroup,
  createAnchoredImageMeshObject,
  disposeAnchoredImageObject,
} from '../three.js';
import { solveAnchoredImageMesh } from '../index.js';

const IMAGE = {
  id: 'image-a',
  groupId: 'group-a',
  label: 'Plate A',
  image: {
    src: 'plate.png',
    width: 100,
    height: 100,
    anchors: [
      { pixel: { x: 0, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 0 } },
      { pixel: { x: 100, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 0, y: 1, z: 0 } },
      { pixel: { x: 0, y: 100 }, target: { kind: 'direction', frame: 'icrs', x: 0, y: 0, z: 1 } },
    ],
  },
};

test('createAnchoredImageMeshObject builds a textured THREE mesh from generic anchored image mesh data', () => {
  const mesh = solveAnchoredImageMesh(IMAGE);
  const texture = new THREE.Texture();
  const object = createAnchoredImageMeshObject(mesh, {
    texture,
    radius: 8,
    opacity: 0.25,
    cutoff: 0.05,
  });

  assert.equal(object.name, 'anchored-image-group-a');
  assert.equal(object.userData.anchoredImage.id, 'image-a');
  assert.equal(object.userData.iau, 'group-a');
  assert.equal(object.geometry.getAttribute('position').count, 4);
  assert.equal(object.geometry.getAttribute('uv').count, 4);
  assert.deepEqual([...object.geometry.index.array], [0, 1, 2, 0, 2, 3]);
  assert.equal(object.material.uniforms.map.value, texture);
  assert.equal(object.material.uniforms.opacity.value, 0.25);
  assert.equal(object.material.uniforms.cutoff.value, 0.05);

  disposeAnchoredImageObject(object);
});

test('createAnchoredImageGroup loads textures and resolves relative manifest assets', async () => {
  const requests = [];
  const group = await createAnchoredImageGroup({
    manifest: { id: 'plates', images: [IMAGE] },
    manifestUrl: 'https://cdn.example.com/pkg/manifest.json',
    textureLoader: {
      load(url, onLoad) {
        requests.push(url);
        onLoad(new THREE.Texture());
      },
    },
  });

  assert.equal(group.children.length, 1);
  assert.deepEqual(requests, ['https://cdn.example.com/pkg/plate.png']);
  assert.equal(group.userData.anchoredImage.meshCount, 1);
  group.userData.anchoredImage.dispose();
});
