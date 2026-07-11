import * as THREE from 'three';

import {
  createKeyboardNavigationPlugin,
  createSkyGrabPlugin,
  createSkykitAnimationLoop,
  createSkykitDebugBridge,
  createSkykitHrDiagramPlugin,
  createSkykitStarPickingPlugin,
  createSkykitStarSourcePlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
  installSkykitDebugGlobal,
} from '@found-in-space/skykit';
import { createHrDiagramEmbeddedSurfaceNode } from '@found-in-space/hr-diagram/touch-os';
import { createTouchOsHudPlugin } from '@found-in-space/skykit/touch-os';
import {
  createChoiceGroup,
  createColumn,
  createDockLayout,
  createEmbeddedSurfaceService,
} from '@found-in-space/touch-os';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createThreeStarField } from '@found-in-space/three-star-field';

const HR_MODES = Object.freeze([
  { value: 'frustum', label: 'Frustum' },
  { value: 'magnitude-limited', label: 'Magnitude' },
  { value: 'volume-complete', label: 'Volume' },
]);
const debug = createSkykitDebugBridge();

installSkykitDebugGlobal(debug);

main().catch((error) => {
  debug.recordDiagnostic({
    level: 'error',
    type: 'hr-diagram-free-roam/startup-error',
    message: 'HR diagram free-roam demo failed to start.',
    error,
  });
});

async function main() {
  const host = document.querySelector('[data-viewer]');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.001, 10000);
  const provider = createStarOctreeProviderService({ url: OCTREE_DEFAULT });
  const surfaces = createEmbeddedSurfaceService();
  const source = createSkykitStarSourcePlugin({ provider });
  const starField = createThreeStarField({ limitingMagnitude: 6.5, exposure: 2400 });
  const selectedStarTarget = createSelectedStarTarget();
  starField.object3d.add(selectedStarTarget.object3d);
  const hrSurfaceId = 'hr-diagram:surface';
  const hrNode = createHrDiagramEmbeddedSurfaceNode({
    componentId: 'hr-diagram:node',
    sourceId: hrSurfaceId,
    title: 'HR diagram',
    fallbackLabel: 'HR diagram offline',
    preserveAspectRatio: true,
  });
  let hrMode = 'frustum';
  let cachedHudRoot = null;
  let cachedHudMode = null;

  const hr = createSkykitHrDiagramPlugin({
    id: 'hr-diagram',
    source,
    mode: hrMode,
    volumeRadiusPc: 25,
    touchOs: {
      surfaces,
      sourceId: hrSurfaceId,
      root: hrNode,
      width: 512,
      height: 360,
    },
  });

  const viewer = await createSkykitViewer({
    host,
    renderer,
    camera,
    view: { limitingMagnitude: 6.5, coordinateUnitsPerParsec: 0.001 },
    plugins: [
      createStreamingStarsPlugin({ id: 'stars', source, renderer: starField }),
      hr,
      source,
      createKeyboardNavigationPlugin({ speedPcPerSec: 2 }),
      createSkyGrabPlugin({ target: host, sensitivityRadiansPerPixel: 0.00075 }),
      createTouchOsHudPlugin({
        target: host,
        root: () => createHudRoot(hrMode),
        runtimeOptions: { services: { surfaces } },
        onOutput(output) {
          if (output.type !== 'change-request' || output.field !== 'hrMode') return;
          if (!HR_MODES.some((mode) => mode.value === output.value)) return;
          hrMode = output.value;
          void hr.setMode(hrMode);
        },
      }),
      createSkykitStarPickingPlugin({
        target: host,
        renderer: starField,
        source,
        onPick(event) {
          const selected = createHrSelectedStar(event);
          if (selected) {
            selectedStarTarget.setPosition(event.pick.position);
            void hr.setOptions({ selectedStars: [selected] });
          }
        },
      }),
    ],
  });
  const loop = createSkykitAnimationLoop(viewer);
  debug.registerViewer(viewer, {
    id: 'hr-diagram-free-roam',
    label: 'HR Diagram Free Roam',
  });

  function createHudRoot(mode) {
    if (cachedHudRoot && cachedHudMode === mode) return cachedHudRoot;
    cachedHudMode = mode;
    cachedHudRoot = createDockLayout('hr-diagram-hud', {
      padding: 20,
      bottomRight: {
        maxWidth: 430,
        maxHeight: 330,
        child: createColumn('hr-diagram-panel', {
          gap: 8,
          padding: 8,
          backgroundColor: 'rgba(8, 15, 30, 0.74)',
          children: [
            createChoiceGroup('hr-mode-selector', {
              field: 'hrMode',
              selectionMode: 'single',
              value: mode,
              orientation: 'horizontal',
              options: HR_MODES,
            }),
            hrNode,
          ],
        }),
      },
    });
    return cachedHudRoot;
  }

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
    selectedStarTarget.dispose();
    void viewer.dispose();
    void provider.dispose?.();
  });

  resize();
  loop.start();
}

function createHrSelectedStar(event) {
  const magAbs = Number(event.pick.magAbs);
  if (!Number.isFinite(magAbs)) return null;
  return {
    ...(Number.isFinite(Number(event.pick.teffLog8)) ? { teffLog8: Number(event.pick.teffLog8) } : {}),
    magAbs,
    color: [255, 210, 122],
  };
}

function createSelectedStarTarget() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const center = canvas.width / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(255, 216, 132, 0.96)';
  context.lineWidth = 5;
  context.beginPath();
  context.arc(center, center, 34, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(center - 52, center);
  context.lineTo(center - 22, center);
  context.moveTo(center + 22, center);
  context.lineTo(center + 52, center);
  context.moveTo(center, center - 52);
  context.lineTo(center, center - 22);
  context.moveTo(center, center + 22);
  context.lineTo(center, center + 52);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const object3d = new THREE.Sprite(material);
  object3d.name = 'hr-diagram-selected-star-target';
  object3d.visible = false;
  object3d.renderOrder = 10_000;
  object3d.scale.set(0.09, 0.09, 1);

  return {
    object3d,
    setPosition(position) {
      object3d.position.set(position.x, position.y, position.z);
      object3d.visible = true;
    },
    dispose() {
      object3d.parent?.remove(object3d);
      material.dispose();
      texture.dispose();
    },
  };
}
