import * as THREE from 'three';
import {
  createCameraRigController,
  createFoundInSpaceDatasetOptions,
  createDesktopStarFieldMaterialProfile,
  createObserverShellField,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
} from '../index.js';

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
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
const createButton = document.querySelector('[data-action="create"]');
const disposeButton = document.querySelector('[data-action="dispose"]');
const refreshButton = document.querySelector('[data-action="refresh"]');
const warmButton = document.querySelector('[data-action="warm"]');
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

function syncButtons() {
  const hasViewer = viewer != null;
  createButton.disabled = hasViewer;
  disposeButton.disabled = !hasViewer;
  refreshButton.disabled = !hasViewer;
  warmButton.disabled = false;
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

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'phase-5-free-fly-field',
      maxLevel: 13,
      note: 'Single-view free-fly shell field for the Phase 5 controller sandbox.',
    }),
    controllers: [
      createCameraRigController({
        id: 'phase-5-camera-rig-controller',
        icrsToSceneTransform: ORION_SCENE_TRANSFORM,
        sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
        lookAtPc: ORION_CENTER_PC,
        moveSpeed: 18,
      }),
      createSelectionRefreshController({
        id: 'phase-5-selection-refresh-controller',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
    ],
    layers: [
      createStarFieldLayer({
        id: 'phase-5-free-fly-star-field-layer',
        positionTransform: ORION_SCENE_TRANSFORM,
        materialFactory: () => createDesktopStarFieldMaterialProfile({
          exposure: 80,
        }),
      }),
    ],
    state: {
      demo: 'phase-5-free-fly',
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      starFieldExposure: 80,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  renderSnapshot();
  syncButtons();
  return viewer;
}

async function disposeViewer() {
  if (!viewer) {
    return;
  }

  await viewer.dispose();
  viewer = null;
  renderSnapshot();
  syncButtons();
}

createButton.addEventListener('click', () => {
  mountViewer().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[free-fly-demo] create failed', error);
  });
});

disposeButton.addEventListener('click', () => {
  disposeViewer().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[free-fly-demo] dispose failed', error);
  });
});

refreshButton.addEventListener('click', () => {
  viewer?.refreshSelection?.()
    .then(() => {
      renderSnapshot();
    })
    .catch((error) => {
      statusValue.textContent = 'error';
      snapshotValue.textContent = error.stack ?? error.message;
      console.error('[free-fly-demo] selection refresh failed', error);
    });
});

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

warmButton.addEventListener('click', () => {
  warmDatasetSession().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[free-fly-demo] warm failed', error);
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
syncButtons();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  snapshotValue.textContent = error.stack ?? error.message;
  console.error('[free-fly-demo] initial mount failed', error);
});
