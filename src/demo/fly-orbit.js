import * as THREE from 'three';
import {
  ALCYONE_PC,
  createCameraRigController,
  createFoundInSpaceDatasetOptions,
  createDesktopStarFieldMaterialProfile,
  createObserverShellField,
  ORION_CENTER_PC,
  ORION_NEBULA_PC,
  SOLAR_ORIGIN_PC,
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
  const cameraPart = snapshot.parts.find((part) => part.id === 'demo-fly-orbit-camera-rig');
  const refreshPart = snapshot.parts.find((part) => part.id === 'demo-fly-orbit-selection-refresh');

  return {
    field: snapshot.selection?.strategy ?? null,
    observerPc: clonePoint(snapshot.state?.observerPc),
    targetPc: clonePoint(snapshot.state?.targetPc),
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? null,
    renderedStars: starLayerPart?.stats?.starCount ?? null,
    cameraRig: cameraPart?.stats ?? null,
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
const cancelAutoButton = document.querySelector('[data-action="cancel-auto"]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');

const FLY_BUTTONS = [
  { el: document.querySelector('[data-action="fly-sun"]'), target: SOLAR_ORIGIN_PC, speed: 120 },
  { el: document.querySelector('[data-action="fly-alcyone"]'), target: ALCYONE_PC, speed: 140 },
  { el: document.querySelector('[data-action="fly-orion-nebula"]'), target: ORION_NEBULA_PC, speed: 160 },
];

const LOOK_BUTTONS = [
  { el: document.querySelector('[data-action="look-sun"]'), target: SOLAR_ORIGIN_PC },
  { el: document.querySelector('[data-action="look-alcyone"]'), target: ALCYONE_PC },
  { el: document.querySelector('[data-action="look-orion-nebula"]'), target: ORION_NEBULA_PC },
];

const ORBIT_BUTTONS = [
  { el: document.querySelector('[data-action="orbit-pleiades"]'), center: ALCYONE_PC, radius: 30, angularSpeed: 0.18 },
  { el: document.querySelector('[data-action="orbit-orion-nebula"]'), center: ORION_NEBULA_PC, radius: 100, angularSpeed: 0.10 },
];

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'demo-fly-orbit-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'demo-fly-orbit',
  },
}));

let cameraController = null;
let viewer = null;
let snapshotTimer = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 6.5;
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
    demo: 'fly-orbit',
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
  const autoDisabled = !hasViewer || !cameraController;
  for (const b of FLY_BUTTONS) if (b.el) b.el.disabled = autoDisabled;
  for (const b of LOOK_BUTTONS) if (b.el) b.el.disabled = autoDisabled;
  for (const b of ORBIT_BUTTONS) if (b.el) b.el.disabled = autoDisabled;
  if (cancelAutoButton) cancelAutoButton.disabled = autoDisabled;
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

  cameraController = createCameraRigController({
    id: 'demo-fly-orbit-camera-rig',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    lookAtPc: ALCYONE_PC,
    moveSpeed: 18,
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'demo-fly-orbit-field',
      maxLevel: 13,
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'demo-fly-orbit-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
    ],
    layers: [
      createStarFieldLayer({
        id: 'demo-fly-orbit-star-field-layer',
        positionTransform: ORION_SCENE_TRANSFORM,
        materialFactory: () => createDesktopStarFieldMaterialProfile({
          exposure: 80,
        }),
      }),
    ],
    state: {
      demo: 'fly-orbit',
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

  cameraController?.cancelAutomation();
  await viewer.dispose();
  viewer = null;
  cameraController = null;
  renderSnapshot();
  syncButtons();
}

createButton.addEventListener('click', () => {
  mountViewer().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[fly-orbit-demo] create failed', error);
  });
});

disposeButton.addEventListener('click', () => {
  disposeViewer().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[fly-orbit-demo] dispose failed', error);
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
      console.error('[fly-orbit-demo] selection refresh failed', error);
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
      console.error('[fly-orbit-demo] mag limit update failed', error);
    });
});

warmButton.addEventListener('click', () => {
  warmDatasetSession().catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[fly-orbit-demo] warm failed', error);
  });
});

for (const { el, target, speed } of FLY_BUTTONS) {
  el?.addEventListener('click', () => {
    if (!cameraController) return;
    cameraController.cancelAutomation();
    cameraController.flyTo(target, {
      speed,
      deceleration: 2.2,
      onArrive: () => renderSnapshot(),
    });
    renderSnapshot();
  });
}

for (const { el, target } of LOOK_BUTTONS) {
  el?.addEventListener('click', () => {
    if (!cameraController) return;
    cameraController.cancelAutomation();
    cameraController.lookAt(target, { blend: 0.06 });
    renderSnapshot();
  });
}

function orbitEntryPoint(center, radius) {
  const scale = cameraController.rig.sceneScale;
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(radius * scale, 0, 0);
  return {
    x: center.x + ix / scale,
    y: center.y + iy / scale,
    z: center.z + iz / scale,
  };
}

for (const { el, center, radius, angularSpeed } of ORBIT_BUTTONS) {
  el?.addEventListener('click', () => {
    if (!cameraController) return;
    cameraController.cancelAutomation();

    const entryPc = orbitEntryPoint(center, radius);
    cameraController.flyTo(entryPc, {
      speed: 140,
      deceleration: 2.5,
      orientToward: center,
      turnBlend: 0.04,
      onArrive: () => {
        cameraController.orbit(center, { radius, angularSpeed, initialAngle: 0 });
      },
    });

    renderSnapshot();
  });
}

cancelAutoButton?.addEventListener('click', () => {
  cameraController?.cancelAutomation();
  renderSnapshot();
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    window.clearInterval(snapshotTimer);
  }

  if (viewer) {
    viewer.dispose().catch((error) => {
      console.error('[fly-orbit-demo] cleanup failed', error);
    });
  }
});

snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
syncButtons();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  snapshotValue.textContent = error.stack ?? error.message;
  console.error('[fly-orbit-demo] initial mount failed', error);
});
