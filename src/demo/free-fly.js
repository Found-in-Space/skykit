import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createHud,
  createObserverShellField,
  loadConstellationArtManifest,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import { createConstellationPreset } from '../presets/constellation-preset.js';
import { createSpeedReadout, createDistanceReadout, createFlyToAction, createLookAtAction } from '../presets/navigation-presets.js';
import { createFullscreenPreset } from '../presets/fullscreen-preset.js';

const DEFAULT_ART_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';

const {
  icrsToScene: ICRS_TO_SCENE_Y_UP,
  sceneToIcrs: SCENE_Y_UP_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function summarizeViewer(snapshot) {
  if (!snapshot) {
    return null;
  }

  const starLayerPart = snapshot.parts.find((part) => part.kind === 'layer' && part.stats?.starCount != null);
  const freeFlyPart = snapshot.parts.find((part) => part.id === 'phase-5-camera-rig-controller');
  const refreshPart = snapshot.parts.find((part) => part.id === 'phase-5-selection-refresh-controller');

  return {
    field: snapshot.selection?.strategy ?? null,
    observerPc: clonePoint(snapshot.state?.observerPc),
    targetPc: clonePoint(snapshot.state?.targetPc),
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? null,
    renderedStars: starLayerPart?.stats?.starCount ?? null,
    freeFly: freeFlyPart?.stats ?? null,
    selectionRefresh: refreshPart?.stats ?? null,
  };
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

const mount = document.querySelector('[data-skykit-viewer-root]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'phase-5-free-fly-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'phase-5-free-fly',
  },
}));

let viewer = null;
let snapshotTimer = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 7.5;
let warmState = {
  bootstrap: 'idle',
  rootShard: 'idle',
  meta: 'idle',
};

function renderSummary(snapshot, datasetDescription) {
  if (!summaryValue) {
    return;
  }

  summaryValue.textContent = JSON.stringify({
    demo: 'phase-5-free-fly',
    mDesired: activeMagLimit,
    sharedDatasetSession: datasetDescription?.id ?? null,
    renderServiceStats: datasetDescription?.services?.render?.stats ?? null,
    viewer: summarizeViewer(snapshot),
  }, null, 2);
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  const datasetDescription = datasetSession.describe();

  statusValue.textContent = viewer?.runtime?.running ? 'running' : 'idle';
  renderSummary(snapshot, datasetDescription);

  snapshotValue.textContent = JSON.stringify({
    mDesired: activeMagLimit,
    viewer: snapshot,
    warmState,
    datasetSession: datasetDescription,
  }, null, 2);
}

async function warmDatasetSession() {
  warmState = {
    ...warmState,
    bootstrap: 'loading',
    rootShard: 'loading',
    meta: datasetSession.getSidecarService('meta') ? 'waiting' : 'not-configured',
  };
  renderSnapshot();

  try {
    await datasetSession.ensureRenderRootShard();
    const bootstrap = await datasetSession.ensureRenderBootstrap();
    warmState = {
      ...warmState,
      bootstrap: `ready (${bootstrap.datasetIdentitySource})`,
      rootShard: 'ready',
    };

    const metaService = datasetSession.getSidecarService('meta');
    if (metaService) {
      try {
        const metaState = await metaService.ensureHeader();
        warmState = {
          ...warmState,
          meta: `ready (${metaState.descriptor.sidecarIdentitySource})`,
        };
      } catch (error) {
        warmState = {
          ...warmState,
          meta: `unavailable: ${error.message}`,
        };
      }
    }

    renderSnapshot();
    return bootstrap;
  } catch (error) {
    warmState = {
      ...warmState,
      bootstrap: `error: ${error.message}`,
      rootShard: 'error',
    };
    renderSnapshot();
    throw error;
  }
}

async function mountViewer() {
  if (viewer) {
    return viewer;
  }

  await warmDatasetSession();

  const cameraController = createCameraRigController({
    id: 'phase-5-camera-rig-controller',
    icrsToSceneTransform: ICRS_TO_SCENE_Y_UP,
    sceneToIcrsTransform: SCENE_Y_UP_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const fullscreen = createFullscreenPreset();
  const manifest = await loadConstellationArtManifest({ manifestUrl: DEFAULT_ART_MANIFEST_URL });
  const constellation = createConstellationPreset({
    manifest,
    manifestUrl: DEFAULT_ART_MANIFEST_URL,
    sceneToIcrsTransform: SCENE_Y_UP_TO_ICRS,
    transformDirection: ICRS_TO_SCENE_Y_UP,
    position: 'top-right',
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'phase-5-free-fly-field',
      note: 'Single-view free-fly shell field for the Phase 5 controller sandbox.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'phase-5-selection-refresh-controller',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      constellation.compassController,
      fullscreen.controller,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
          ...constellation.controls,
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
      constellation.artLayer,
      createStarFieldLayer({
        id: 'phase-5-free-fly-star-field-layer',
        positionTransform: ICRS_TO_SCENE_Y_UP,
        materialFactory: () => createDefaultStarFieldMaterialProfile(),
      }),
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'phase-5-free-fly',
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  renderSnapshot();
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
    renderSnapshot();
    return;
  }

  viewer.setState({ mDesired: activeMagLimit });
  viewer.refreshSelection()
    .then(() => {
      renderSnapshot();
    })
    .catch((error) => {
      statusValue.textContent = 'error';
      snapshotValue.textContent = error.stack ?? error.message;
      console.error('[free-fly-demo] mag limit update failed', error);
    });
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    window.clearInterval(snapshotTimer);
  }

  if (viewer) {
    viewer.dispose().catch((error) => {
      console.error('[free-fly-demo] cleanup failed', error);
    });
  }
});

snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  snapshotValue.textContent = error.stack ?? error.message;
  console.error('[free-fly-demo] initial mount failed', error);
});
