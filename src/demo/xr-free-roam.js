import * as THREE from 'three';
import {
  createCameraRigController,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  createVrStarFieldMaterialProfile,
  getDatasetSession,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
} from '../index.js';

const XR_REFERENCE_SPACE_TYPE = 'local-floor';
const XR_NEAR_PLANE = 0.25;
const XR_FAR_PLANE = 10000;
const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, XR_NEAR_PLANE, XR_FAR_PLANE);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function summarizeViewer(snapshot) {
  if (!snapshot) {
    return null;
  }

  const starLayerPart = snapshot.parts.find((part) => part.kind === 'layer' && part.stats?.starCount != null);
  const xrPart = snapshot.parts.find((part) => part.id === 'phase-5b-xr-camera-rig-controller');
  const refreshPart = snapshot.parts.find((part) => part.id === 'phase-5b-selection-refresh-controller');

  return {
    observerPc: clonePoint(snapshot.state?.observerPc),
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    xr: snapshot.xr ?? null,
    rig: snapshot.rig ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? null,
    renderedStars: starLayerPart?.stats?.starCount ?? null,
    xrLocomotion: xrPart?.stats ?? null,
    selectionRefresh: refreshPart?.stats ?? null,
  };
}

const mount = document.querySelector('[data-skykit-viewer-root]');
const createButton = document.querySelector('[data-action="create"]');
const disposeButton = document.querySelector('[data-action="dispose"]');
const refreshButton = document.querySelector('[data-action="refresh"]');
const warmButton = document.querySelector('[data-action="warm"]');
const enterXrButton = document.querySelector('[data-action="enter-xr"]');
const exitXrButton = document.querySelector('[data-action="exit-xr"]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'phase-5b-xr-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'phase-5b-xr-free-roam',
  },
}));

let viewer = null;
let snapshotTimer = null;
let xrSupported = null;
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
    demo: 'phase-5b-xr-free-roam',
    xrSupported,
    mDesired: activeMagLimit,
    sharedDatasetSession: datasetDescription?.id ?? null,
    renderServiceStats: datasetDescription?.services?.render?.stats ?? null,
    viewer: summarizeViewer(snapshot),
  }, null, 2);
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  const datasetDescription = datasetSession.describe();
  const presenting = snapshot?.xr?.presenting === true;

  statusValue.textContent = presenting
    ? 'xr-presenting'
    : viewer?.runtime?.running
      ? 'running'
      : 'idle';
  renderSummary(snapshot, datasetDescription);

  snapshotValue.textContent = JSON.stringify({
    xrSupported,
    mDesired: activeMagLimit,
    viewer: snapshot,
    warmState,
    datasetSession: datasetDescription,
  }, null, 2);
}

function syncButtons() {
  const hasViewer = viewer != null;
  const presenting = viewer?.getSnapshotState?.()?.xr?.presenting === true;

  createButton.disabled = hasViewer;
  disposeButton.disabled = !hasViewer;
  refreshButton.disabled = !hasViewer;
  warmButton.disabled = false;
  enterXrButton.disabled = !hasViewer || xrSupported !== true || presenting;
  exitXrButton.disabled = !hasViewer || !presenting;
}

async function refreshXrSupport() {
  try {
    if (viewer?.isXrModeSupported) {
      xrSupported = await viewer.isXrModeSupported('immersive-vr');
    } else {
      xrSupported = await (globalThis.navigator?.xr?.isSessionSupported?.('immersive-vr') ?? false);
    }
  } catch (error) {
    xrSupported = false;
    console.error('[xr-free-roam-demo] XR support check failed', error);
  }

  syncButtons();
  renderSnapshot();
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
    xrCompatible: true,
    interestField: createObserverShellField({
      id: 'phase-5b-xr-observer-shell-field',
      maxLevel: 13,
      note: 'Minimal XR observer shell field for 5B headset validation.',
    }),
    controllers: [
      createCameraRigController({
        id: 'phase-5b-xr-camera-rig-controller',
        xr: true,
        icrsToSceneTransform: ORION_SCENE_TRANSFORM,
        sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
        sceneScale: 1.0,
        moveSpeed: 4.0,
      }),
      createSelectionRefreshController({
        id: 'phase-5b-selection-refresh-controller',
        observerDistancePc: 8,
        minIntervalMs: 300,
        watchSize: false,
      }),
    ],
    layers: [
      createStarFieldLayer({
        id: 'phase-5b-vr-star-field-layer',
        positionTransform: ORION_SCENE_TRANSFORM,
        materialFactory: () => createVrStarFieldMaterialProfile({
          exposure: 1e5,
        }),
      }),
    ],
    state: {
      demo: 'phase-5b-xr-free-roam',
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
      mDesired: activeMagLimit,
      starFieldScale: 1.0,
      starFieldExtinctionScale: 1.0,
      starFieldExposure: 1e5,
    },
    clearColor: 0x02040b,
  });

  await refreshXrSupport();
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
    console.error('[xr-free-roam-demo] create failed', error);
  });
});

disposeButton.addEventListener('click', () => {
  disposeViewer().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[xr-free-roam-demo] dispose failed', error);
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
      console.error('[xr-free-roam-demo] selection refresh failed', error);
    });
});

enterXrButton.addEventListener('click', () => {
  viewer?.enterXR?.({
    mode: 'immersive-vr',
    referenceSpaceType: XR_REFERENCE_SPACE_TYPE,
    sessionInit: {
      optionalFeatures: [XR_REFERENCE_SPACE_TYPE],
    },
    near: XR_NEAR_PLANE,
    far: XR_FAR_PLANE,
  })
    .then(() => {
      renderSnapshot();
      syncButtons();
    })
    .catch((error) => {
      statusValue.textContent = 'error';
      snapshotValue.textContent = error.stack ?? error.message;
      console.error('[xr-free-roam-demo] enterXR failed', error);
    });
});

exitXrButton.addEventListener('click', () => {
  viewer?.exitXR?.()
    .then(() => {
      renderSnapshot();
      syncButtons();
    })
    .catch((error) => {
      statusValue.textContent = 'error';
      snapshotValue.textContent = error.stack ?? error.message;
      console.error('[xr-free-roam-demo] exitXR failed', error);
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
      console.error('[xr-free-roam-demo] mag limit update failed', error);
    });
});

warmButton.addEventListener('click', () => {
  warmDatasetSession().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[xr-free-roam-demo] warm failed', error);
  });
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    window.clearInterval(snapshotTimer);
  }

  if (viewer) {
    viewer.dispose().catch((error) => {
      console.error('[xr-free-roam-demo] cleanup failed', error);
    });
  }
});

snapshotTimer = window.setInterval(() => {
  renderSnapshot();
  syncButtons();
}, 500);

renderSnapshot();
syncButtons();
refreshXrSupport().catch((error) => {
  console.error('[xr-free-roam-demo] initial XR support check failed', error);
});
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  snapshotValue.textContent = error.stack ?? error.message;
  console.error('[xr-free-roam-demo] initial mount failed', error);
});
