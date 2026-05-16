import * as THREE from 'three';

import {
  createObject3dPlugin,
  createSkykitAnimationLoop,
  createSkykitStatusPlugin,
  createSkykitViewer,
} from '@found-in-space/skykit';
import { createXrNavigationAutomation, IDENTITY_QUATERNION } from '@found-in-space/xr';

main().catch((error) => {
  document.querySelector('[data-status]').textContent = error.stack ?? String(error);
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
  const navigation = createXrNavigationAutomation({ speed: 12 });
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
      (context) => context.addPart({
        id: 'navigation-automation',
        update(frame) {
          const pose = navigation.update({
            pose: { position: frame.view.observerPc, orientation: frame.view.orientationIcrs ?? IDENTITY_QUATERNION },
            deltaSeconds: frame.deltaSeconds,
            scale: { navigationUnits: 'pc', metersPerNavigationUnit: 3.085677581e16 },
          });
          context.requestViewState({ observerPc: pose.position, orientationIcrs: pose.orientation }, 'navigation');
        },
        getSnapshot: () => navigation.getSnapshot(),
      }),
    ],
  });

  document.querySelector('[data-fly]').addEventListener('click', () => {
    navigation.flyPolyline([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: -10 }, { x: 8, y: 0, z: -18 }], {
      durationSecs: 5,
      arrivalAction: { type: 'orbit', center: { x: 8, y: 0, z: -18 }, radius: 6, angularSpeed: 0.3 },
    });
  });
  document.querySelector('[data-orbit]').addEventListener('click', () => {
    navigation.orbit({ x: 8, y: 0, z: -18 }, { radius: 6, angularSpeed: 0.3 });
  });
  document.querySelector('[data-stop]').addEventListener('click', () => navigation.cancel());

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
