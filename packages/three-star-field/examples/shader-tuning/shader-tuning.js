import * as THREE from 'three';

import { createStarObjectBatchProduct } from '@found-in-space/star-products';
import { createThreeStarField } from '@found-in-space/three-star-field';

const host = document.querySelector('[data-viewer]');
const snapshot = document.querySelector('[data-snapshot]');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
const field = createThreeStarField({ renderScale: 1, coordinateUnitsPerParsec: 1 });

camera.position.z = 18;
scene.add(field.object3d);
host.appendChild(renderer.domElement);
field.apply({ type: 'data/product-upsert', providerId: 'fixture', streamId: 'fixture', product: createFixtureProduct() });

for (const input of document.querySelectorAll('input')) {
  input.addEventListener('input', updateView);
}
window.addEventListener('resize', resize);
resize();
updateView();
renderer.setAnimationLoop(() => renderer.render(scene, camera));

function updateView() {
  field.setView({
    limitingMagnitude: Number(document.querySelector('[data-mag]').value),
    exposure: Number(document.querySelector('[data-exposure]').value),
    baseSize: Number(document.querySelector('[data-size]').value),
    observerPosition: { x: 0, y: 0, z: 18 },
  });
  snapshot.textContent = JSON.stringify(field.getSnapshot().view, null, 2);
}

function resize() {
  const width = host.clientWidth || 1;
  const height = host.clientHeight || 1;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(width, height, true);
}

function createFixtureProduct() {
  return createStarObjectBatchProduct({
    providerId: 'shader-lesson',
    streamId: 'fixture',
    productIndex: 1,
    entries: [{ node: createNode(), decoded: createStars() }],
    attributes: ['position', 'magAbs', 'teffLog8', 'pickMeta'],
  });
}

function createNode() {
  return {
    mortonCode: '0',
    level: 0,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 16,
  };
}

function createStars() {
  return {
    count: 7,
    positionsPc: new Float32Array([-8, 0, 0, -5, 2, -2, -2, -1, 1, 1, 2, -1, 4, -2, 2, 7, 1, -1, 9, -1, 1]),
    magAbs: new Float32Array([-1.4, 0.5, 2.1, 4.8, 6.5, 8, 10]),
    teffLog8: new Uint8Array([220, 190, 150, 128, 96, 70, 42]),
  };
}
