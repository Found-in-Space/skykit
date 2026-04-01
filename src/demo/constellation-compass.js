import * as THREE from 'three';
import {
  createCameraRigController,
  createConstellationArtLayer,
  createConstellationCompassController,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  createSceneOrientationTransforms,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  loadConstellationArtManifest,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
} from '../index.js';

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

const DEFAULT_ART_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';

const mount = document.querySelector('[data-skykit-viewer-root]');
const statusValue = document.querySelector('[data-status]');
const snapshotValue = document.querySelector('[data-snapshot]');
const hysteresisInput = document.querySelector('[data-hysteresis-secs]');
const fadeInput = document.querySelector('[data-fade-secs]');
const iauValue = document.querySelector('[data-constellation-iau]');
const nameValue = document.querySelector('[data-constellation-name]');
const raValue = document.querySelector('[data-constellation-ra]');
const decValue = document.querySelector('[data-constellation-dec]');
const descValue = document.querySelector('[data-constellation-desc]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'constellation-compass-demo-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'constellation-compass-demo',
  },
}));

let viewer = null;
let snapshotTimer = null;
let loadedManifest = null;
let constellationInfoByIau = new Map();

function pickConstellationName(constellation) {
  return constellation?.name
    ?? constellation?.commonName
    ?? constellation?.englishName
    ?? constellation?.id
    ?? constellation?.iau
    ?? 'Unknown';
}

function pickConstellationDescription(constellation) {
  return constellation?.description
    ?? constellation?.story
    ?? constellation?.summary
    ?? 'No description provided in this art manifest.';
}

function indexManifest(manifest) {
  const nextMap = new Map();
  for (const constellation of manifest?.constellations ?? []) {
    if (!constellation?.iau) {
      continue;
    }
    nextMap.set(constellation.iau, {
      iau: constellation.iau,
      name: pickConstellationName(constellation),
      description: pickConstellationDescription(constellation),
      id: constellation?.id ?? null,
    });
  }
  constellationInfoByIau = nextMap;
}

function parseSeconds(input, fallback) {
  const value = Number(input?.value);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function formatDegrees(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(2)}°`;
}

function setActiveConstellationPanel(data = null) {
  if (!data?.iau) {
    iauValue.textContent = 'none';
    nameValue.textContent = 'none';
    raValue.textContent = '—';
    decValue.textContent = '—';
    descValue.textContent = 'No active constellation yet. Move the camera to trigger the compass.';
    return;
  }

  const manifestInfo = constellationInfoByIau.get(data.iau);
  iauValue.textContent = data.iau;
  nameValue.textContent = manifestInfo?.name ?? data.id ?? data.iau;
  raValue.textContent = formatDegrees(data.raDeg);
  decValue.textContent = formatDegrees(data.decDeg);
  descValue.textContent = manifestInfo?.description ?? 'No description provided in this art manifest.';
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  statusValue.textContent = viewer?.runtime?.running ? 'running' : 'idle';
  snapshotValue.textContent = JSON.stringify({
    viewer: snapshot,
    datasetSession: datasetSession.describe(),
  }, null, 2);
}

async function ensureManifest() {
  if (loadedManifest) {
    return loadedManifest;
  }
  loadedManifest = await loadConstellationArtManifest({
    manifestUrl: DEFAULT_ART_MANIFEST_URL,
  });
  indexManifest(loadedManifest);
  return loadedManifest;
}

async function mountViewer() {
  if (viewer) {
    return viewer;
  }

  const manifest = await ensureManifest();
  const fadeDurationSecs = parseSeconds(fadeInput, 0.8);
  const hysteresisSecs = parseSeconds(hysteresisInput, 0.5);
  const artLayer = createConstellationArtLayer({
    id: 'constellation-compass-art-layer',
    manifest,
    manifestUrl: DEFAULT_ART_MANIFEST_URL,
    transformDirection: ORION_SCENE_TRANSFORM,
    radius: 8,
    opacity: 0.24,
    fadeDurationSecs,
  });

  const compassController = createConstellationCompassController({
    id: 'constellation-compass-controller',
    manifest,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    hysteresisSecs,
    onConstellationIn(payload) {
      artLayer.show(payload.iau);
      setActiveConstellationPanel(payload);
    },
    onConstellationOut(payload) {
      artLayer.hide(payload.iau);
      setActiveConstellationPanel(null);
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'constellation-compass-field',
      maxLevel: 13,
      note: 'Observer shell field for constellation compass demo.',
    }),
    controllers: [
      createCameraRigController({
        id: 'constellation-compass-camera-controller',
        icrsToSceneTransform: ORION_SCENE_TRANSFORM,
        sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
        lookAtPc: ORION_CENTER_PC,
        moveSpeed: 18,
      }),
      compassController,
    ],
    layers: [
      createStarFieldLayer({
        id: 'constellation-compass-star-layer',
        positionTransform: ORION_SCENE_TRANSFORM,
        materialFactory: () => createDefaultStarFieldMaterialProfile(),
      }),
      artLayer,
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'constellation-compass',
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: ORION_CENTER_PC,
      mDesired: 6.5,
    },
    clearColor: 0x02040b,
  });

  renderSnapshot();
  return viewer;
}

async function disposeViewer() {
  if (!viewer) {
    return;
  }
  await viewer.dispose();
  viewer = null;
  setActiveConstellationPanel(null);
  renderSnapshot();
}

hysteresisInput?.addEventListener('change', () => {
  if (!viewer) {
    return;
  }
  disposeViewer().then(() => mountViewer()).catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
  });
});

fadeInput?.addEventListener('change', () => {
  if (!viewer) {
    return;
  }
  disposeViewer().then(() => mountViewer()).catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
  });
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    window.clearInterval(snapshotTimer);
  }
  if (viewer) {
    viewer.dispose().catch(() => {});
  }
});

setActiveConstellationPanel(null);
snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  const message = error?.message ?? String(error);
  snapshotValue.textContent = error?.stack ?? message;
  console.error(`[constellation-compass-demo] initial mount failed: ${message}`, error);
});
