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

// 1 parsec = 0.001 Three.js world units (see src/services/octree/scene-scale.js)
const SCENE_SCALE = 0.001;

// Radio epoch and derived shell geometry
const EPOCH_YEAR = 1895;
const CURRENT_YEAR = 2026;
const LY_PER_PC = 3.2615637775591093;
const RADIO_RADIUS_LY = CURRENT_YEAR - EPOCH_YEAR; // 131 ly
const RADIO_RADIUS_PC = RADIO_RADIUS_LY / LY_PER_PC; // ~40.2 pc
const RADIO_RADIUS_SCENE = RADIO_RADIUS_PC * SCENE_SCALE; // ~0.0402 world units

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

/**
 * Builds the radio-bubble mesh group: a semi-transparent fill sphere plus a
 * sparser wireframe on top so the shell edge reads clearly from any distance.
 * Both meshes are centred on the solar system origin (0,0,0 in parsec space).
 */
function createRadioBubbleMeshes() {
  const group = new THREE.Group();
  group.name = 'radio-bubble';

  const fillGeo = new THREE.SphereGeometry(RADIO_RADIUS_SCENE, 64, 32);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x2299ff,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(fillGeo, fillMat));

  const wireGeo = new THREE.SphereGeometry(RADIO_RADIUS_SCENE, 36, 18);
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x55ccff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    wireframe: true,
  });
  group.add(new THREE.Mesh(wireGeo, wireMat));

  return group;
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
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
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
        positionTransform: ORION_SCENE_TRANSFORM,
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

  viewer.contentRoot.add(createRadioBubbleMeshes());

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
