import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createHud,
  createObserverShellField,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import {
  createDistanceReadout,
  createFlyToAction,
  createLookAtAction,
  createSpeedReadout,
} from '../presets/navigation-presets.js';
import { createFullscreenPreset } from '../presets/fullscreen-preset.js';
import { createRadioBubbleMeshes } from '../layers/radio-bubble-meshes.js';
import { installDemoViewerDebugConsole } from './viewer-debug-console.js';

const {
  icrsToScene: ICRS_TO_SCENE_Y_UP,
  sceneToIcrs: SCENE_Y_UP_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}


const mount = document.querySelector('[data-skykit-viewer-root]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'radio-bubble-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'radio-bubble',
  },
}));

let viewer = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value))
  ? Number(magLimitInput.value)
  : 6.5;

async function warmDatasetSession() {
  try {
    await datasetSession.ensureRenderRootShard();
    return await datasetSession.ensureRenderBootstrap();
  } catch (error) {
    throw error;
  }
}

async function mountViewer() {
  if (viewer) {
    return viewer;
  }

  await warmDatasetSession();

  const cameraController = createCameraRigController({
    id: 'radio-bubble-camera-rig',
    icrsToSceneTransform: ICRS_TO_SCENE_Y_UP,
    sceneToIcrsTransform: SCENE_Y_UP_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const fullscreen = createFullscreenPreset();

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'radio-bubble-field',
      note: 'Radio bubble demo observer shell.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'radio-bubble-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      fullscreen.controller,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
          createLookAtAction(cameraController, SOLAR_ORIGIN_PC, {
            label: '⟳ Sun',
            title: 'Look at Sun',
            position: 'top-right',
          }),
          createFlyToAction(cameraController, SOLAR_ORIGIN_PC, {
            label: '→ Sun',
            title: 'Fly to Sun',
            speed: 120,
            position: 'top-right',
          }),
          ...fullscreen.controls,
          createSpeedReadout(cameraController, { position: 'top-left' }),
          createDistanceReadout(cameraController, SOLAR_ORIGIN_PC, {
            label: 'Distance to Sun',
            position: 'top-left',
          }),
        ],
      }),
    ],
    layers: [
      createStarFieldLayer({
        id: 'radio-bubble-star-field',
        positionTransform: ICRS_TO_SCENE_Y_UP,
        materialFactory: () => createDefaultStarFieldMaterialProfile(),
      }),
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });
  installDemoViewerDebugConsole(viewer, { id: 'radio-bubble' });

  const { group: bubbleGroup } = createRadioBubbleMeshes();
  viewer.contentRoot.add(bubbleGroup);

  if (statusValue) {
    statusValue.textContent = 'running';
  }

  return viewer;
}

magLimitInput?.addEventListener('change', () => {
  const parsed = Number(magLimitInput.value);
  if (!Number.isFinite(parsed)) {
    magLimitInput.value = String(activeMagLimit);
    return;
  }
  activeMagLimit = parsed;
  if (!viewer) {
    return;
  }
  viewer.setState({ mDesired: activeMagLimit });
  viewer.refreshSelection().catch((error) => {
    console.error('[radio-bubble] mag limit update failed', error);
  });
});

window.addEventListener('beforeunload', () => {
  viewer?.dispose().catch((error) => {
    console.error('[radio-bubble] cleanup failed', error);
  });
});

mountViewer().catch((error) => {
  if (statusValue) {
    statusValue.textContent = 'error';
  }
  console.error('[radio-bubble] initial mount failed', error);
});
