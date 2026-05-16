import * as THREE from 'three';

import {
  createObject3dPlugin,
  createSkykitAnimationLoop,
  createSkykitStatusPlugin,
  createSkykitViewer,
} from '@found-in-space/skykit';

main().catch((error) => {
  document.querySelector('[data-status]').textContent = error.stack ?? String(error);
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.z = 6;

  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.MeshBasicMaterial({ color: 0x73d5ff, wireframe: true, transparent: true, opacity: 0.5 }),
  );
  bubble.name = 'app-owned-radio-bubble';

  const viewer = await createSkykitViewer({
    host,
    renderer,
    camera,
    plugins: [
      createObject3dPlugin({ id: 'radio-bubble', object3d: bubble, anchorMode: 'world-space' }),
      createSkykitStatusPlugin({ target: document.querySelector('[data-status]') }),
      (context) => context.addPart({
        id: 'bubble-animation',
        update(frame) {
          bubble.scale.setScalar(1 + frame.elapsedSeconds * 0.25);
          bubble.rotation.y += frame.deltaSeconds * 0.35;
        },
        getSnapshot() {
          return { radius: bubble.scale.x };
        },
      }),
    ],
  });

  const loop = createSkykitAnimationLoop(viewer);
  window.addEventListener('resize', resize);
  resize();
  loop.start();

  function resize() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewer.resize({ width, height, devicePixelRatio: window.devicePixelRatio || 1 });
  }
}
