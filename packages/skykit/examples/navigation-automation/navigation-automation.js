import * as THREE from 'three';

import {
  SKYKIT_ACTIONS,
  createObject3dPlugin,
  createSkykitAnimationLoop,
  createSkykitNavigationPlugin,
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
  const target = new THREE.Mesh(
    new THREE.SphereGeometry(0.25),
    new THREE.MeshBasicMaterial({ color: 0xff66aa }),
  );
  target.position.set(8, 0, -18);

  const viewer = await createSkykitViewer({
    host,
    renderer,
    camera,
    view: { coordinateUnitsPerParsec: 0.05 },
    plugins: [
      createObject3dPlugin({ id: 'target-marker', object3d: target }),
      createSkykitStatusPlugin({ target: document.querySelector('[data-status]') }),
      createSkykitNavigationPlugin({
        speed: 12,
        acceleration: 16,
        deceleration: 12,
      }),
    ],
  });

  document.querySelector('[data-fly]').addEventListener('click', () => {
    viewer.actions.invoke(SKYKIT_ACTIONS.navigation.flyPolyline, {
      points: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: -10 }, { x: 8, y: 0, z: -18 }],
      durationSecs: 5,
      arrivalAction: { type: 'orbit', center: { x: 8, y: 0, z: -18 }, radius: 6, angularSpeed: 0.3 },
    });
  });
  document.querySelector('[data-orbit]').addEventListener('click', () => {
    viewer.actions.invoke(SKYKIT_ACTIONS.navigation.orbit, {
      center: { x: 8, y: 0, z: -18 },
      radius: 6,
      angularSpeed: 0.3,
    });
  });
  document.querySelector('[data-stop]').addEventListener('click', () => {
    viewer.actions.invoke(SKYKIT_ACTIONS.navigation.cancel);
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
