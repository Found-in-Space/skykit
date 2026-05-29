import * as THREE from 'three';
import {
  SKYKIT_ACTIONS,
  productRef,
} from '@found-in-space/skykit';
import { createSkykitVrViewer } from '@found-in-space/skykit/xr';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';

const host = document.querySelector('[data-viewer]');
const status = document.querySelector('[data-status]');
const enterButton = document.querySelector('[data-enter-vr]');
const resetButton = document.querySelector('[data-reset-view]');
const targetProduct = 'interaction:vr-viewer-example/target';

void start();

async function start() {
  const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
  const markerLayer = createMarkerLayer(targetProduct);
  const vr = await createSkykitVrViewer({
    host,
    stars: { provider },
    layers: [markerLayer],
    pickBridge: {
      targetProducts: [productRef(targetProduct)],
      routeOnFrame: true,
      onRoute(route) {
        if (route.type === 'hit') {
          setStatus(`Ray target: ${route.hit.label ?? 'marker'}`);
        }
      },
    },
    plugins: [
      {
        id: 'vr-viewer-example-status',
        setup(ctx) {
          ctx.on('stars/xr-pick', (event) => {
            setStatus(`Star pick: ${event.label}`);
          });
          ctx.on('stars/source/error', (event) => {
            setStatus(`Star source error: ${event.error?.message ?? 'unknown error'}`);
          });
        },
      },
    ],
  });

  window.addEventListener('pagehide', () => {
    void provider.dispose?.();
  }, { once: true });

  enterButton?.addEventListener('click', async () => {
    try {
      await vr.enter();
      setStatus('XR session started.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  resetButton?.addEventListener('click', () => {
    void vr.viewer.actions.invoke(SKYKIT_ACTIONS.viewer.reset);
    setStatus('View reset.');
  });
}

function createMarkerLayer(productKey) {
  return {
    id: 'vr-viewer-example-marker',
    setup(ctx) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 24, 12),
        new THREE.MeshBasicMaterial({ color: 0x7df5ff }),
      );
      marker.position.set(0, 0, -2.5);
      ctx.addObject3D(marker, { anchorMode: 'observer-centric' });
      ctx.provideProduct(productKey, {
        pick(_ray, context) {
          return {
            distance: context.maxDistance ?? 2.5,
            label: 'Observer marker',
          };
        },
      }, {
        kind: 'interaction-target',
        ownerId: 'vr-viewer-example',
      });
    },
  };
}

function setStatus(message) {
  if (status) status.textContent = message;
}
