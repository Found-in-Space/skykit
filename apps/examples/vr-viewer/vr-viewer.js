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
import { createThreeStarField } from '@found-in-space/three-star-field';

const host = document.querySelector('[data-viewer]');
const status = document.querySelector('[data-status]');
const snapshot = document.querySelector('[data-snapshot]');
const enterButton = document.querySelector('[data-enter-vr]');
const resetButton = document.querySelector('[data-reset-view]');
const targetProduct = 'interaction:app-vr-viewer/target';

void start();

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, xrCompatible: true });
  renderer.setClearColor(0x02040b, 1);

  const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
  const starField = createThreeStarField({ limitingMagnitude: 7.5, exposure: 2500 });
  const waypointLayer = createWaypointLayer(targetProduct);

  const vr = await createSkykitVrViewer({
    host,
    renderer,
    stars: {
      provider,
      renderer: starField,
    },
    layers: [waypointLayer],
    pickBridge: {
      targetProducts: [productRef(targetProduct)],
      routeOnFrame: true,
      onRoute(route) {
        if (route.type === 'hit') {
          setStatus(`Target route: ${route.hit.label ?? 'waypoint'}`);
        }
      },
    },
    plugins: [
      {
        id: 'app-vr-viewer-events',
        setup(ctx) {
          ctx.on('stars/xr-pick', (event) => {
            setStatus(`Star: ${event.label}`);
          });
          ctx.on('viewer/resize', () => {
            writeSnapshot();
          });
        },
      },
    ],
  });

  writeSnapshot();
  window.addEventListener('pagehide', () => {
    void cleanup();
  }, { once: true });

  enterButton?.addEventListener('click', async () => {
    try {
      await vr.enter();
      setStatus('XR session started.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      writeSnapshot();
    }
  });

  resetButton?.addEventListener('click', () => {
    void vr.viewer.actions.invoke(SKYKIT_ACTIONS.viewer.reset);
    setStatus('View reset.');
    writeSnapshot();
  });

  let cleanedUp = false;

  function writeSnapshot() {
    if (!snapshot) return;
    const state = vr.getSnapshot();
    snapshot.textContent = JSON.stringify({
      id: state.id,
      rays: Object.keys(vr.rays),
      stars: Boolean(vr.starSource),
      pickBridge: Boolean(vr.pickBridge),
      loop: state.loop,
    }, null, 2);
  }

  async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    await vr.dispose();
    await provider.dispose?.();
    starField.dispose();
    renderer.dispose();
  }
}

function createWaypointLayer(productKey) {
  return {
    id: 'app-vr-viewer-waypoint',
    setup(ctx) {
      const group = new THREE.Group();
      group.position.set(0, 0, -3);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.012, 8, 36),
        new THREE.MeshBasicMaterial({ color: 0x9fe9ff }),
      );
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 16, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      group.add(ring, center);
      ctx.addObject3D(group, { anchorMode: 'observer-centric' });
      ctx.provideProduct(productKey, {
        pick(_ray, context) {
          return {
            distance: context.maxDistance ?? 3,
            label: 'App waypoint',
          };
        },
      }, {
        kind: 'interaction-target',
        ownerId: 'app-vr-viewer',
      });
    },
  };
}

function setStatus(message) {
  if (status) status.textContent = message;
}
