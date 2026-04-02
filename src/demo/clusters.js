import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  DEFAULT_STAR_FIELD_STATE,
  getDatasetSession,
  HYADES_CENTER_PC,
  OMEGA_CEN_CENTER_PC,
  ORION_CENTER_PC,
  ORION_NEBULA_PC,
  PLEIADES_CENTER_PC,
  SOLAR_ORIGIN_PC,
  UPPER_SCO_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
} from '../index.js';

const {
  icrsToScene: SCENE_TRANSFORM,
  sceneToIcrs: SCENE_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

// ── Cluster presets ──────────────────────────────────────────────────────────

const CLUSTER_PRESETS = [
  {
    id: 'orion-nebula',
    label: 'Orion Nebula',
    center: ORION_NEBULA_PC,
    orbitRadius: 100,
    angularSpeed: 0.12,
    flySpeed: 160,
  },
  {
    id: 'upper-sco',
    label: 'Upper Scorpius',
    center: UPPER_SCO_CENTER_PC,
    orbitRadius: 50,
    angularSpeed: 0.15,
    flySpeed: 160,
  },
  {
    id: 'pleiades',
    label: 'Pleiades (M45)',
    center: PLEIADES_CENTER_PC,
    orbitRadius: 25,
    angularSpeed: 0.18,
    flySpeed: 150,
  },
  {
    id: 'hyades',
    label: 'Hyades',
    center: HYADES_CENTER_PC,
    orbitRadius: 15,
    angularSpeed: 0.22,
    flySpeed: 100,
  },
  {
    id: 'omega-cen',
    label: 'Omega Centauri',
    center: OMEGA_CEN_CENTER_PC,
    orbitRadius: 200,
    angularSpeed: 0.08,
    flySpeed: 600,
  },
];

// ── DOM refs ─────────────────────────────────────────────────────────────────

const mount = document.querySelector('[data-skykit-viewer-root]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusSpan = document.querySelector('[data-status]');
const cancelButton = document.querySelector('[data-action="cancel"]');
const homeButton = document.querySelector('[data-action="home"]');
const clusterCards = document.querySelectorAll('[data-cluster-id]');

// ── State ─────────────────────────────────────────────────────────────────────

let cameraController = null;
let viewer = null;
let snapshotTimer = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value))
  ? Number(magLimitInput.value)
  : 8.5;
let activeClusterId = null;

// ── Dataset ──────────────────────────────────────────────────────────────────

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'clusters-demo',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'clusters-demo',
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function setActiveCluster(id) {
  activeClusterId = id;
  for (const card of clusterCards) {
    card.classList.toggle('active', card.dataset.clusterId === id);
  }
}

function syncButtons() {
  const ready = viewer != null && cameraController != null;
  for (const card of clusterCards) {
    card.disabled = !ready;
  }
  if (cancelButton) cancelButton.disabled = !ready;
  if (homeButton) homeButton.disabled = !ready;
}

function updateStatus() {
  if (!statusSpan) return;
  const automation = cameraController?.getStats?.()?.automation;
  if (automation) {
    const name = CLUSTER_PRESETS.find((p) => p.id === activeClusterId)?.label ?? '…';
    statusSpan.textContent = automation === 'orbit'
      ? `orbiting ${name}`
      : `flying to ${name}`;
  } else {
    const name = CLUSTER_PRESETS.find((p) => p.id === activeClusterId)?.label;
    statusSpan.textContent = name ? `at ${name}` : 'idle';
  }
}

// ── Mount viewer ──────────────────────────────────────────────────────────────

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

async function mountViewer() {
  if (viewer) return viewer;

  if (statusSpan) statusSpan.textContent = 'warming dataset…';
  await datasetSession.ensureRenderRootShard();
  await datasetSession.ensureRenderBootstrap();

  cameraController = createCameraRigController({
    id: 'clusters-camera',
    icrsToSceneTransform: SCENE_TRANSFORM,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    lookAtPc: ORION_NEBULA_PC,
    moveSpeed: 18,
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({ id: 'clusters-field' }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'clusters-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
    ],
    layers: [
      createStarFieldLayer({
        id: 'clusters-star-field',
        positionTransform: SCENE_TRANSFORM,
        materialFactory: () => createDefaultStarFieldMaterialProfile(),
      }),
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'clusters',
      observerPc: { ...SOLAR_ORIGIN_PC },
      mDesired: activeMagLimit,
      targetPc: ORION_NEBULA_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  if (statusSpan) statusSpan.textContent = 'idle';
  syncButtons();
  return viewer;
}

// ── Cluster navigation ────────────────────────────────────────────────────────

function flyToCluster(preset) {
  if (!cameraController) return;

  setActiveCluster(preset.id);
  cameraController.cancelAutomation();
  cameraController.lockAt(preset.center, { dwellMs: 5_000, recenterSpeed: 0.06 });
  cameraController.orbitalInsert(preset.center, {
    orbitRadius: preset.orbitRadius,
    angularSpeed: preset.angularSpeed,
    approachSpeed: preset.flySpeed,
    deceleration: 2.5,
  });
}

// ── Events ────────────────────────────────────────────────────────────────────

magLimitInput?.addEventListener('change', () => {
  const parsed = Number(magLimitInput.value);
  if (!Number.isFinite(parsed)) {
    magLimitInput.value = String(activeMagLimit);
    return;
  }
  activeMagLimit = parsed;
  if (!viewer) return;
  viewer.setState({ mDesired: activeMagLimit });
  viewer.refreshSelection().catch((err) => {
    console.error('[clusters-demo] mag limit refresh failed', err);
  });
});

for (const card of clusterCards) {
  card.addEventListener('click', () => {
    const preset = CLUSTER_PRESETS.find((p) => p.id === card.dataset.clusterId);
    if (preset) flyToCluster(preset);
  });
}

cancelButton?.addEventListener('click', () => {
  cameraController?.cancelAutomation();
  setActiveCluster(null);
});

homeButton?.addEventListener('click', () => {
  if (!cameraController) return;
  setActiveCluster(null);
  cameraController.cancelAutomation();
  cameraController.lockAt(SOLAR_ORIGIN_PC, { dwellMs: 4_000, recenterSpeed: 0.07 });
  cameraController.flyTo(SOLAR_ORIGIN_PC, { speed: 200, deceleration: 2.2 });
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) window.clearInterval(snapshotTimer);
  viewer?.dispose().catch((err) => {
    console.error('[clusters-demo] cleanup failed', err);
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

snapshotTimer = window.setInterval(updateStatus, 500);
syncButtons();
mountViewer().catch((err) => {
  if (statusSpan) statusSpan.textContent = 'error';
  console.error('[clusters-demo] mount failed', err);
});
