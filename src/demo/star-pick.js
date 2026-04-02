import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  formatDistancePc,
} from '../index.js';
import { createPickController } from '../controllers/pick-controller.js';
import { SCALE } from '../services/octree/scene-scale.js';

const {
  icrsToScene: SCENE_TRANSFORM,
  sceneToIcrs: SCENE_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

const mount = document.querySelector('[data-skykit-viewer-root]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const toleranceInput = document.querySelector('[data-tolerance]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const pickInfoEl = document.querySelector('[data-pick-info]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'demo-star-pick-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: { sharedCaches: true, bootstrapLoading: 'demo-star-pick' },
}));

let starFieldLayer = null;
let viewer = null;
let snapshotTimer = null;
let activeMagLimit = 6.5;
let activeTolerance = 1.0;
let lastPickResult = null;
let pickControllerRef = null;

function sceneToIcrsPc(pos) {
  const [ix, iy, iz] = SCENE_TO_ICRS(pos.x, pos.y, pos.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

function fmt(n, decimals = 2) {
  return Number.isFinite(n) ? n.toFixed(decimals) : '—';
}

function scoreLabel(score) {
  if (score < 1) return '<span class="pick-score inside">inside disk</span>';
  if (score < 2) return '<span class="pick-score near">near</span>';
  return '<span class="pick-score edge">edge</span>';
}

function renderPickInfo(result) {
  if (!result) {
    pickInfoEl.innerHTML = `
      <p class="aside-section-title">Selected Star</p>
      <p class="pick-placeholder">Click a star to inspect it</p>`;
    return;
  }

  const icrsPc = sceneToIcrsPc(result.position);
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  const distFromObserver = Math.hypot(
    icrsPc.x - observerPc.x,
    icrsPc.y - observerPc.y,
    icrsPc.z - observerPc.z,
  );

  const tempStr = Number.isFinite(result.temperatureK)
    ? `${Math.round(result.temperatureK).toLocaleString()} K`
    : '—';
  const visualPxStr = Number.isFinite(result.visualRadiusPx)
    ? `${fmt(result.visualRadiusPx, 1)} px`
    : '—';

  pickInfoEl.innerHTML = `
    <p class="aside-section-title">Selected Star</p>
    <table class="pick-table">
      <tr><th>ICRS position</th><td>(${fmt(icrsPc.x, 1)}, ${fmt(icrsPc.y, 1)}, ${fmt(icrsPc.z, 1)}) pc</td></tr>
      <tr><th>Distance</th><td>${formatDistancePc(distFromObserver)}</td></tr>
      <tr><th>Abs. magnitude</th><td>${fmt(result.absoluteMagnitude)}</td></tr>
      <tr><th>App. magnitude</th><td>${fmt(result.apparentMagnitude)}</td></tr>
      <tr><th>Temperature</th><td>${tempStr}</td></tr>
      <tr><th>Visual radius</th><td>${visualPxStr}</td></tr>
      <tr><th>Pick score</th><td>${fmt(result.score)} ${scoreLabel(result.score)}</td></tr>
      <tr><th>Angular offset</th><td>${fmt(result.angularDistanceDeg, 3)}°</td></tr>
      <tr><th>Buffer index</th><td>${result.index}</td></tr>
    </table>`;

  if (Number.isFinite(result._pickTimeMs)) {
    pickInfoEl.innerHTML += `<p class="pick-timing">Pick took ${fmt(result._pickTimeMs, 1)} ms over ${result._starCount ?? '?'} stars</p>`;
  }
}

function getObserverPc() {
  return viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
}

function renderSummary() {
  if (!summaryValue) return;
  const snapshot = viewer?.getSnapshotState?.();
  const starLayerPart = snapshot?.parts?.find(
    (p) => p.kind === 'layer' && p.stats?.starCount != null,
  );

  summaryValue.textContent = JSON.stringify({
    observerPc: getObserverPc(),
    renderedStars: starLayerPart?.stats?.starCount ?? 0,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? 0,
    mDesired: activeMagLimit,
    tolerance: activeTolerance,
    picked: lastPickResult
      ? {
        index: lastPickResult.index,
        score: +lastPickResult.score.toFixed(3),
        distancePc: +lastPickResult.distancePc.toFixed(2),
        appMag: +lastPickResult.apparentMagnitude.toFixed(2),
      }
      : null,
  }, null, 2);
}

function renderSnapshot() {
  statusValue.textContent = viewer?.runtime?.running ? 'running' : 'idle';
  renderSummary();
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function handlePick(result) {
  lastPickResult = result;
  renderPickInfo(result);
  renderSummary();
}

async function warmDatasetSession() {
  try {
    await datasetSession.ensureRenderRootShard();
    await datasetSession.ensureRenderBootstrap();
  } catch (error) {
    console.error('[star-pick-demo] dataset warm-up failed', error);
    throw error;
  }
}

async function mountViewer() {
  if (viewer) return viewer;
  await warmDatasetSession();

  starFieldLayer = createStarFieldLayer({
    id: 'demo-star-pick-star-field',
    positionTransform: SCENE_TRANSFORM,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
  });

  pickControllerRef = createPickController({
    id: 'demo-star-pick-controller',
    getStarData: () => starFieldLayer.getStarData(),
    toleranceDeg: activeTolerance,
    onPick(result, _event, stats) {
      if (result) {
        result._pickTimeMs = stats?.pickTimeMs ?? null;
        result._starCount = stats?.starCount ?? null;
      }
      handlePick(result);
    },
  });

  const cameraController = createCameraRigController({
    id: 'demo-star-pick-camera-rig',
    icrsToSceneTransform: SCENE_TRANSFORM,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({ id: 'demo-star-pick-field' }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'demo-star-pick-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      pickControllerRef,
    ],
    layers: [starFieldLayer],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'star-pick',
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
  if (!viewer) return;
  viewer.setState({ mDesired: activeMagLimit });
  viewer.refreshSelection().then(renderSnapshot).catch(console.error);
});

toleranceInput?.addEventListener('change', () => {
  const parsed = Number(toleranceInput.value);
  if (Number.isFinite(parsed) && parsed > 0) {
    activeTolerance = parsed;
    pickControllerRef?.setToleranceDeg(parsed);
  }
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) window.clearInterval(snapshotTimer);
  viewer?.dispose?.().catch(console.error);
});

snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  if (summaryValue) summaryValue.textContent = error.stack ?? error.message;
  console.error('[star-pick-demo] mount failed', error);
});
