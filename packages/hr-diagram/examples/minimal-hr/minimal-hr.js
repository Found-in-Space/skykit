import * as THREE from 'three';
import {
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createHrDiagramRenderer } from '@found-in-space/hr-diagram';

const DEFAULT_OCTREE_URL =
  'https://d1kwci8ql2abxm.cloudfront.net/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree';

const canvas = document.querySelector('#hr');
const status = document.querySelector('#status');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
const hr = createHrDiagramRenderer({
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  mode: 'magnitude-limited',
  limitingMagnitude: 6.5,
});
const provider = createStarOctreeProviderService({ url: DEFAULT_OCTREE_URL });

function resize() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  hr.setView({ width, height });
}

window.addEventListener('resize', resize);
resize();

const stream = provider.streamObjectBatches({
  strategy: createObserverShellStrategy(),
  view: {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  },
  attributes: ['position', 'magAbs', 'teffLog8'],
  streaming: { batchMode: 'payload-range' },
});

for await (const delta of stream) {
  if (delta.type === 'data/product-upsert' || delta.type === 'data/product-remove') {
    hr.apply(delta);
    status.textContent = `${hr.getSnapshot().starCount.toLocaleString()} streamed stars`;
  }
  if (delta.type === 'data/representation-current') {
    status.textContent = `${hr.getSnapshot().starCount.toLocaleString()} stars, current`;
    break;
  }
}

function frame() {
  hr.render(renderer);
  requestAnimationFrame(frame);
}

frame();
