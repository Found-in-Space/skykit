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
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';

main().catch((error) => {
  document.querySelector('[data-status]').textContent = error.stack ?? String(error);
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  const statusTarget = document.querySelector('[data-status]');
  const statusCopyGuard = createStatusCopyGuard(statusTarget);
  let lastStatusText = '';
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
        intervalSeconds: 0.5,
        render({ viewer: snapshot }) {
          if (statusCopyGuard.isHeld()) {
            return;
          }
          const stars = snapshot.parts.find((part) => part.id === 'streaming-stars')?.snapshot;
          const statusText = JSON.stringify({
            observerPc: snapshot.view.observerPc,
            parts: snapshot.partCount,
            stars,
          }, null, 2);
          if (statusText !== lastStatusText) {
            lastStatusText = statusText;
            statusTarget.textContent = statusText;
          }
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
    viewer.resize({ width, height, devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
  }

  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => {
    loop.dispose();
    statusCopyGuard.dispose();
    void viewer.dispose();
    void provider.dispose?.();
  });

  resize();
  loop.start();
}

function createStatusCopyGuard(target) {
  let pointerDown = false;
  let held = false;

  const hasSelection = () => selectionIntersectsNode(target);
  const releaseIfIdle = () => {
    if (!pointerDown && !hasSelection()) {
      held = false;
    }
  };
  const onPointerDown = () => {
    pointerDown = true;
    held = true;
  };
  const onPointerUp = () => {
    pointerDown = false;
    window.setTimeout(releaseIfIdle, 0);
  };
  const onSelectionChange = () => {
    held = pointerDown || hasSelection();
  };

  target.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('selectionchange', onSelectionChange);

  return {
    isHeld: () => held,
    dispose() {
      target.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    },
  };
}

function selectionIntersectsNode(node) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.intersectsNode(node)) {
      return true;
    }
  }
  return false;
}
