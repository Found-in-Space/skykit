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
  buildSimbadBasicSearch,
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
let pickGeneration = 0;

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

let pickUi = null;
function bindPickUi() {
  if (pickUi || !pickInfoEl) {
    return pickUi;
  }
  pickUi = {
    empty: pickInfoEl.querySelector('[data-pick-empty]'),
    detail: pickInfoEl.querySelector('[data-pick-detail]'),
    timing: pickInfoEl.querySelector('[data-pick-timing]'),
    meta: {
      proper: pickInfoEl.querySelector('[data-pick-meta="proper"]'),
      bayer: pickInfoEl.querySelector('[data-pick-meta="bayer"]'),
      hd: pickInfoEl.querySelector('[data-pick-meta="hd"]'),
      hip: pickInfoEl.querySelector('[data-pick-meta="hip"]'),
      gaia: pickInfoEl.querySelector('[data-pick-meta="gaia"]'),
    },
    obs: {
      icrs: pickInfoEl.querySelector('[data-pick-obs="icrs"]'),
      distance: pickInfoEl.querySelector('[data-pick-obs="distance"]'),
      absMag: pickInfoEl.querySelector('[data-pick-obs="absMag"]'),
      appMag: pickInfoEl.querySelector('[data-pick-obs="appMag"]'),
      temp: pickInfoEl.querySelector('[data-pick-obs="temp"]'),
      visualPx: pickInfoEl.querySelector('[data-pick-obs="visualPx"]'),
      score: pickInfoEl.querySelector('[data-pick-obs="score"]'),
      offset: pickInfoEl.querySelector('[data-pick-obs="offset"]'),
      bufferIndex: pickInfoEl.querySelector('[data-pick-obs="bufferIndex"]'),
    },
    simbadEmpty: pickInfoEl.querySelector('[data-pick-simbad-empty]'),
    simbadLink: pickInfoEl.querySelector('[data-pick-simbad-link]'),
  };
  return pickUi;
}

function renderPickInfo(result) {
  const ui = bindPickUi();
  if (!ui?.empty || !ui.detail) return;

  if (!result) {
    ui.empty.hidden = false;
    ui.detail.hidden = true;
    if (ui.timing) {
      ui.timing.hidden = true;
      ui.timing.textContent = '';
    }
    return;
  }

  ui.empty.hidden = true;
  ui.detail.hidden = false;

  const f = result.sidecarFields;
  ui.meta.proper.textContent = f?.properName || '—';
  ui.meta.bayer.textContent = f?.bayer || '—';
  ui.meta.hd.textContent = f?.hd || '—';
  ui.meta.hip.textContent = f?.hip || '—';
  ui.meta.gaia.textContent = f?.gaia || '—';

  const simbad = buildSimbadBasicSearch(f);
  if (ui.simbadLink && ui.simbadEmpty) {
    if (simbad) {
      ui.simbadLink.href = simbad.url;
      ui.simbadLink.textContent = `SIMBAD (${simbad.label})`;
      ui.simbadLink.hidden = false;
      ui.simbadEmpty.hidden = true;
    } else {
      ui.simbadLink.removeAttribute('href');
      ui.simbadLink.hidden = true;
      ui.simbadEmpty.hidden = false;
    }
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

  ui.obs.icrs.textContent = `(${fmt(icrsPc.x, 1)}, ${fmt(icrsPc.y, 1)}, ${fmt(icrsPc.z, 1)}) pc`;
  ui.obs.distance.textContent = formatDistancePc(distFromObserver);
  ui.obs.absMag.textContent = fmt(result.absoluteMagnitude);
  ui.obs.appMag.textContent = fmt(result.apparentMagnitude);
  ui.obs.temp.textContent = tempStr;
  ui.obs.visualPx.textContent = visualPxStr;
  ui.obs.score.innerHTML = `${fmt(result.score)} ${scoreLabel(result.score)}`;
  ui.obs.offset.textContent = `${fmt(result.angularDistanceDeg, 3)}°`;
  ui.obs.bufferIndex.textContent = String(result.index);

  if (ui.timing) {
    if (Number.isFinite(result._pickTimeMs)) {
      ui.timing.hidden = false;
      ui.timing.textContent = `Pick took ${fmt(result._pickTimeMs, 1)} ms over ${result._starCount ?? '?'} stars`;
    } else {
      ui.timing.hidden = true;
      ui.timing.textContent = '';
    }
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
        ...(lastPickResult.sidecarFields
          ? { sidecar: lastPickResult.sidecarFields }
          : {}),
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
  pickGeneration += 1;
  const gen = pickGeneration;
  lastPickResult = result;
  if (result) {
    delete result.sidecarFields;
  }
  renderPickInfo(result);
  renderSummary();

  if (!result) return;

  const starData = starFieldLayer.getStarData();
  const pickMetaArray = starData?.pickMeta;
  const pickMeta = pickMetaArray?.[result.index];
  if (!pickMeta || !datasetSession.getSidecarService('meta')) return;

  void (async () => {
    try {
      const fields = await datasetSession.resolveSidecarMetaFields('meta', pickMeta);
      if (gen !== pickGeneration || lastPickResult !== result) return;
      if (fields) {
        result.sidecarFields = fields;
        renderPickInfo(result);
        renderSummary();
      }
    } catch {
      /* sidecar unavailable or incompatible */
    }
  })();
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
    includePickMeta: true,
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
