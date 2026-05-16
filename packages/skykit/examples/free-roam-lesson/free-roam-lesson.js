import * as THREE from 'three';

import {
  createKeyboardNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitStatusPlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
  installSkykitDebugGlobal,
} from '@found-in-space/skykit';
import {
  OCTREE_DEFAULT,
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createThreeStarField } from '@found-in-space/three-star-field';

main().catch((error) => {
  document.querySelector('[data-status]').textContent = error.stack ?? String(error);
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  const statusTarget = document.querySelector('[data-status]');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.001, 10000);
  const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
  const starField = createThreeStarField({
    limitingMagnitude: 6.5,
    exposure: 2400,
  });

  const viewer = await createSkykitViewer({
    host,
    renderer,
    camera,
    view: { limitingMagnitude: 6.5, coordinateUnitsPerParsec: 0.001 },
    plugins: [
      createStreamingStarsPlugin({
        provider,
        renderer: starField,
        session: { strategy: createObserverShellStrategy() },
      }),
      createKeyboardNavigationPlugin({ speedPcPerSec: 2 }),
      createSkyGrabPlugin({
        target: host,
        sensitivityRadiansPerPixel: 0.00075,
      }),
      createSkykitStatusPlugin({
        target: statusTarget,
        render({ viewer: snapshot }) {
          const stars = snapshot.parts.find((part) => part.id === 'streaming-stars')?.snapshot;
          statusTarget.textContent = JSON.stringify({
            observerPc: snapshot.view.observerPc,
            parts: snapshot.partCount,
            stars,
          }, null, 2);
        },
      }),
    ],
  });

  const debug = createSkykitDebugBridge();
  debug.registerViewer(viewer);
  installSkykitDebugGlobal(debug);
  const loop = createSkykitAnimationLoop(viewer);

  function resize() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewer.resize({ width, height, devicePixelRatio: window.devicePixelRatio || 1 });
  }

  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => {
    loop.dispose();
    void viewer.dispose();
    void provider.dispose?.();
  });

  resize();
  loop.start();
}
