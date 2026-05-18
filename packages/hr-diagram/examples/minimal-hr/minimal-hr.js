import * as THREE from 'three';
import {
  OCTREE_DEFAULT,
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createHrDiagramRenderer } from '@found-in-space/hr-diagram';

const canvas = document.querySelector('#hr');
const status = document.querySelector('#status');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
const hr = createHrDiagramRenderer({
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  mode: 'magnitude-limited',
  limitingMagnitude: 6.5,
});
const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });

function resize() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  hr.setView({ width, height });
}

window.addEventListener('resize', resize);
resize();

main().catch((error) => {
  status.textContent = error.stack ?? String(error);
});

async function main() {
  const stream = provider.streamCells({
    strategy: createObserverShellStrategy(),
    view: {
      observerPc: { x: 0, y: 0, z: 0 },
      limitingMagnitude: 6.5,
    },
    attributes: ['position', 'magAbs', 'teffLog8'],
    streaming: { batchMode: 'payload-range' },
  });

  for await (const delta of stream) {
    if (delta.type === 'stars/cells-upsert' || delta.type === 'stars/cells-remove') {
      hr.apply(delta);
      status.textContent = `${hr.getSnapshot().starCount.toLocaleString()} streamed stars`;
    }
    if (delta.type === 'stars/current') {
      status.textContent = `${hr.getSnapshot().starCount.toLocaleString()} stars, current`;
      break;
    }
  }
}

function frame() {
  hr.render(renderer);
  requestAnimationFrame(frame);
}

frame();
