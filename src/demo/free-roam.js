import * as THREE from 'three';
import {
  buildSimbadBasicSearch,
  createCameraRigController,
  createConstellationCompassController,
  createDefaultStarFieldMaterialProfile,
  createConstellationArtLayer,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createHud,
  createObserverShellField,
  createPickController,
  loadConstellationArtManifest,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  DEFAULT_PICK_TOLERANCE_DEG,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  formatDistancePc,
  getDatasetSession,
  SCALE,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import { createSpeedReadout, createDistanceReadout, createFlyToAction, createLookAtAction } from '../presets/navigation-presets.js';
import { createFullscreenPreset } from '../presets/fullscreen-preset.js';

const DEFAULT_ART_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function sceneToIcrsPc(pos) {
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(pos.x, pos.y, pos.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

function fmt(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '—';
}

function scoreLabel(score) {
  if (score < 1) return '<span class="pick-score inside">inside disk</span>';
  if (score < 2) return '<span class="pick-score near">near</span>';
  return '<span class="pick-score edge">edge</span>';
}

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

function formatDegrees(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(2)}°`;
}

function summarizeViewer(snapshot) {
  if (!snapshot) {
    return null;
  }

  const starLayerPart = snapshot.parts.find((part) => part.kind === 'layer' && part.stats?.starCount != null);
  const freeRoamPart = snapshot.parts.find((part) => part.id === 'phase-5-camera-rig-controller');
  const refreshPart = snapshot.parts.find((part) => part.id === 'phase-5-selection-refresh-controller');

  return {
    field: snapshot.selection?.strategy ?? null,
    observerPc: clonePoint(snapshot.state?.observerPc),
    targetPc: clonePoint(snapshot.state?.targetPc),
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? null,
    renderedStars: starLayerPart?.stats?.starCount ?? null,
    freeRoam: freeRoamPart?.stats ?? null,
    selectionRefresh: refreshPart?.stats ?? null,
  };
}

function summarizePickResult(result) {
  if (!result) {
    return null;
  }

  return {
    index: result.index,
    score: Number.isFinite(result.score) ? +result.score.toFixed(3) : null,
    distancePc: Number.isFinite(result.distancePc) ? +result.distancePc.toFixed(2) : null,
    apparentMagnitude: Number.isFinite(result.apparentMagnitude) ? +result.apparentMagnitude.toFixed(2) : null,
    angularDistanceDeg: Number.isFinite(result.angularDistanceDeg) ? +result.angularDistanceDeg.toFixed(3) : null,
    sidecarFields: result.sidecarFields ?? null,
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
const fovInput = document.querySelector('[data-fov-deg]');
const hysteresisInput = document.querySelector('[data-hysteresis-secs]');
const artFadeInput = document.querySelector('[data-art-fade-secs]');
const artOpacityInput = document.querySelector('[data-art-opacity]');
const exposureInput = document.querySelector('[data-star-exposure]');
const extinctionInput = document.querySelector('[data-star-extinction-scale]');
const fadeRangeInput = document.querySelector('[data-star-fade-range]');
const baseSizeInput = document.querySelector('[data-star-base-size]');
const sizeScaleInput = document.querySelector('[data-star-size-scale]');
const sizePowerInput = document.querySelector('[data-star-size-power]');
const glowScaleInput = document.querySelector('[data-star-glow-scale]');
const glowPowerInput = document.querySelector('[data-star-glow-power]');
const toleranceInput = document.querySelector('[data-pick-tolerance]');
const pickInfoEl = document.querySelector('[data-pick-info]');
const constellationIauValue = document.querySelector('[data-constellation-iau]');
const constellationNameValue = document.querySelector('[data-constellation-name]');
const constellationRaValue = document.querySelector('[data-constellation-ra]');
const constellationDecValue = document.querySelector('[data-constellation-dec]');
const constellationDescValue = document.querySelector('[data-constellation-desc]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'phase-5-free-roam-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'phase-5-free-roam',
  },
}));

let viewer = null;
let starFieldLayer = null;
let pickControllerRef = null;
let constellationArtLayer = null;
let constellationCompassController = null;
let constellationInfoByIau = new Map();
let currentConstellationIau = null;
let currentConstellationName = null;
let artEnabled = true;
let pickUi = null;
let lastPickResult = null;
let pickGeneration = 0;
let snapshotTimer = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 7.5;
let activeFovDeg = Number.isFinite(Number(fovInput?.value)) ? Number(fovInput.value) : 60;
let activeHysteresisSecs = Number.isFinite(Number(hysteresisInput?.value)) ? Number(hysteresisInput.value) : 0.2;
let activeArtFadeSecs = Number.isFinite(Number(artFadeInput?.value)) ? Number(artFadeInput.value) : 0.4;
let activeArtOpacity = Number.isFinite(Number(artOpacityInput?.value)) ? Number(artOpacityInput.value) : 0.3;
let activeStarFieldState = {
  starFieldExposure: Number.isFinite(Number(exposureInput?.value))
    ? Math.exp(Number(exposureInput.value))
    : DEFAULT_STAR_FIELD_STATE.starFieldExposure,
  starFieldExtinctionScale: Number.isFinite(Number(extinctionInput?.value))
    ? Number(extinctionInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldExtinctionScale,
  starFieldMagFadeRange: Number.isFinite(Number(fadeRangeInput?.value))
    ? Number(fadeRangeInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldMagFadeRange,
  starFieldBaseSize: Number.isFinite(Number(baseSizeInput?.value))
    ? Number(baseSizeInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldBaseSize,
  starFieldSizeScale: Number.isFinite(Number(sizeScaleInput?.value))
    ? Number(sizeScaleInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldSizeScale,
  starFieldSizePower: Number.isFinite(Number(sizePowerInput?.value))
    ? Number(sizePowerInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldSizePower,
  starFieldGlowScale: Number.isFinite(Number(glowScaleInput?.value))
    ? Number(glowScaleInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldGlowScale,
  starFieldGlowPower: Number.isFinite(Number(glowPowerInput?.value))
    ? Number(glowPowerInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldGlowPower,
  starFieldSizeMax: DEFAULT_STAR_FIELD_STATE.starFieldSizeMax,
};
let activeTolerance = DEFAULT_PICK_TOLERANCE_DEG;
let warmState = {
  bootstrap: 'idle',
  rootShard: 'idle',
  meta: 'idle',
};

function formatExposureReadout(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

function setReadout(name, value) {
  const el = document.querySelector(`[data-readout="${name}"]`);
  if (el) {
    el.textContent = value;
  }
}

function requestRender() {
  viewer?.runtime?.renderOnce?.();
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

function setActiveConstellationPanel(data = null) {
  if (!data?.iau) {
    if (constellationIauValue) constellationIauValue.textContent = 'none';
    if (constellationNameValue) constellationNameValue.textContent = 'none';
    if (constellationRaValue) constellationRaValue.textContent = '—';
    if (constellationDecValue) constellationDecValue.textContent = '—';
    if (constellationDescValue) {
      constellationDescValue.textContent = 'No active constellation yet. Move the camera to trigger the compass.';
    }
    return;
  }

  const info = constellationInfoByIau.get(data.iau);
  if (constellationIauValue) constellationIauValue.textContent = data.iau;
  if (constellationNameValue) constellationNameValue.textContent = info?.name ?? data.id ?? data.iau;
  if (constellationRaValue) constellationRaValue.textContent = formatDegrees(data.raDeg);
  if (constellationDecValue) constellationDecValue.textContent = formatDegrees(data.decDeg);
  if (constellationDescValue) {
    constellationDescValue.textContent = info?.description ?? 'No description provided in this art manifest.';
  }
}

function syncConstellationPanelFromController() {
  const stats = constellationCompassController?.getStats?.();
  const activeIau = stats?.activeIau ?? null;
  if (!activeIau) {
    setActiveConstellationPanel(null);
    return;
  }
  setActiveConstellationPanel({
    iau: activeIau,
    id: constellationInfoByIau.get(activeIau)?.id ?? null,
    raDeg: stats?.raDeg ?? null,
    decDeg: stats?.decDeg ?? null,
  });
}

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
  if (!ui?.empty || !ui.detail) {
    return;
  }

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

  const fields = result.sidecarFields;
  ui.meta.proper.textContent = fields?.properName || '—';
  ui.meta.bayer.textContent = fields?.bayer || '—';
  ui.meta.hd.textContent = fields?.hd || '—';
  ui.meta.hip.textContent = fields?.hip || '—';
  ui.meta.gaia.textContent = fields?.gaia || '—';

  const simbad = buildSimbadBasicSearch(fields);
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

  ui.obs.icrs.textContent = `(${fmt(icrsPc.x, 1)}, ${fmt(icrsPc.y, 1)}, ${fmt(icrsPc.z, 1)}) pc`;
  ui.obs.distance.textContent = formatDistancePc(distFromObserver);
  ui.obs.absMag.textContent = fmt(result.absoluteMagnitude);
  ui.obs.appMag.textContent = fmt(result.apparentMagnitude);
  ui.obs.temp.textContent = Number.isFinite(result.temperatureK)
    ? `${Math.round(result.temperatureK).toLocaleString()} K`
    : '—';
  ui.obs.visualPx.textContent = Number.isFinite(result.visualRadiusPx)
    ? `${fmt(result.visualRadiusPx, 1)} px`
    : '—';
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

function handlePick(result) {
  pickGeneration += 1;
  const generation = pickGeneration;
  lastPickResult = result;
  if (result) {
    delete result.sidecarFields;
  }
  renderPickInfo(result);
  renderSnapshot();

  if (!result) {
    return;
  }

  const starData = starFieldLayer?.getStarData?.();
  const pickMeta = starData?.pickMeta?.[result.index];
  if (!pickMeta || !datasetSession.getSidecarService('meta')) {
    return;
  }

  void (async () => {
    try {
      const fields = await datasetSession.resolveSidecarMetaFields('meta', pickMeta);
      if (generation !== pickGeneration || lastPickResult !== result || !fields) {
        return;
      }
      result.sidecarFields = fields;
      renderPickInfo(result);
      renderSnapshot();
    } catch {
      /* sidecar unavailable or incompatible */
    }
  })();
}

function renderSummary(snapshot, datasetDescription) {
  if (!summaryValue) {
    return;
  }

  summaryValue.textContent = JSON.stringify({
    demo: 'phase-5-free-roam',
    mDesired: activeMagLimit,
    fovDeg: activeFovDeg,
    constellation: {
      hysteresisSecs: activeHysteresisSecs,
      fadeDurationSecs: activeArtFadeSecs,
      opacity: activeArtOpacity,
      activeIau: constellationCompassController?.getStats?.()?.activeIau ?? null,
    },
    starField: { ...activeStarFieldState },
    pickToleranceDeg: activeTolerance,
    sharedDatasetSession: datasetDescription?.id ?? null,
    renderServiceStats: datasetDescription?.services?.render?.stats ?? null,
    picked: summarizePickResult(lastPickResult),
    viewer: summarizeViewer(snapshot),
  }, null, 2);
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  const datasetDescription = datasetSession.describe();

  statusValue.textContent = viewer?.runtime?.running ? 'running' : 'idle';
  syncConstellationPanelFromController();
  renderSummary(snapshot, datasetDescription);

  snapshotValue.textContent = JSON.stringify({
    mDesired: activeMagLimit,
    fovDeg: activeFovDeg,
    constellation: {
      hysteresisSecs: activeHysteresisSecs,
      fadeDurationSecs: activeArtFadeSecs,
      opacity: activeArtOpacity,
      stats: constellationCompassController?.getStats?.() ?? null,
    },
    starField: { ...activeStarFieldState },
    pickToleranceDeg: activeTolerance,
    picked: summarizePickResult(lastPickResult),
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
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const fullscreen = createFullscreenPreset();
  const manifest = await loadConstellationArtManifest({ manifestUrl: DEFAULT_ART_MANIFEST_URL });
  indexManifest(manifest);

  constellationArtLayer = createConstellationArtLayer({
    id: 'phase-5-free-roam-constellation-art-layer',
    manifest,
    manifestUrl: DEFAULT_ART_MANIFEST_URL,
    transformDirection: ORION_SCENE_TRANSFORM,
    opacity: activeArtOpacity,
    fadeDurationSecs: activeArtFadeSecs,
  });

  constellationCompassController = createConstellationCompassController({
    id: 'phase-5-free-roam-constellation-compass-controller',
    manifest,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    hysteresisSecs: activeHysteresisSecs,
    onConstellationIn(payload) {
      currentConstellationIau = payload.iau;
      currentConstellationName = constellationInfoByIau.get(payload.iau)?.name
        ?? payload.name?.native
        ?? payload.name?.english
        ?? payload.iau;
      if (artEnabled) {
        constellationArtLayer.show(payload.iau);
      }
      setActiveConstellationPanel(payload);
    },
    onConstellationOut(payload) {
      constellationArtLayer.hide(payload.iau);
      if (payload.iau === currentConstellationIau) {
        currentConstellationIau = null;
        currentConstellationName = null;
      }
      setActiveConstellationPanel(null);
    },
  });

  starFieldLayer = createStarFieldLayer({
    id: 'phase-5-free-roam-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    includePickMeta: true,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
  });

  const constellationControls = [
    {
      label: () => (currentConstellationName ? `✦ ${currentConstellationName}` : '✦ —'),
      title: 'View-center constellation (toggle art)',
      toggle: true,
      initialActive: true,
      position: 'top-right',
      onPress(active) {
        artEnabled = active;
        if (!active) {
          constellationArtLayer.hideAll();
        } else if (currentConstellationIau) {
          constellationArtLayer.show(currentConstellationIau);
        }
        requestRender();
      },
    },
  ];

  pickControllerRef = createPickController({
    id: 'phase-5-free-roam-pick-controller',
    getStarData: () => starFieldLayer?.getStarData?.(),
    onPick(result, _event, stats) {
      if (result) {
        result._pickTimeMs = stats?.pickTimeMs ?? null;
        result._starCount = stats?.starCount ?? null;
      }
      handlePick(result);
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: (() => {
      const camera = createViewerCamera();
      camera.fov = activeFovDeg;
      camera.updateProjectionMatrix();
      return camera;
    })(),
    interestField: createObserverShellField({
      id: 'phase-5-free-roam-field',
      note: 'Single-view free-roam shell field for the Phase 5 controller sandbox.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'phase-5-selection-refresh-controller',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      pickControllerRef,
      constellationCompassController,
      fullscreen.controller,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
          ...constellationControls,
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
      constellationArtLayer,
      starFieldLayer,
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      ...activeStarFieldState,
      demo: 'phase-5-free-roam',
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

setReadout('mag-limit', activeMagLimit.toFixed(1));
setReadout('fov', `${activeFovDeg.toFixed(0)}°`);
setReadout('hysteresis', `${activeHysteresisSecs.toFixed(2)}s`);
setReadout('art-fade', `${activeArtFadeSecs.toFixed(2)}s`);
setReadout('art-opacity', activeArtOpacity.toFixed(2));
setReadout('exposure', formatExposureReadout(activeStarFieldState.starFieldExposure));
setReadout('extinction', activeStarFieldState.starFieldExtinctionScale.toFixed(2));
setReadout('fade-range', activeStarFieldState.starFieldMagFadeRange.toFixed(1));
setReadout('base-size', activeStarFieldState.starFieldBaseSize.toFixed(2));
setReadout('size-scale', activeStarFieldState.starFieldSizeScale.toFixed(2));
setReadout('size-power', activeStarFieldState.starFieldSizePower.toFixed(2));
setReadout('glow-scale', activeStarFieldState.starFieldGlowScale.toFixed(2));
setReadout('glow-power', activeStarFieldState.starFieldGlowPower.toFixed(2));
setReadout('pick-tolerance', `${activeTolerance.toFixed(1)}°`);
toleranceInput?.setAttribute('value', String(activeTolerance));
if (toleranceInput) {
  toleranceInput.value = String(activeTolerance);
}
setActiveConstellationPanel(null);
renderPickInfo(null);

magLimitInput?.addEventListener('input', () => {
  const parsed = Number(magLimitInput.value);
  if (!Number.isFinite(parsed)) {
    magLimitInput.value = String(activeMagLimit);
    return;
  }

  activeMagLimit = parsed;
  setReadout('mag-limit', activeMagLimit.toFixed(1));

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
      console.error('[free-roam-demo] mag limit update failed', error);
    });
});

fovInput?.addEventListener('input', () => {
  const parsed = Number(fovInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fovInput.value = String(activeFovDeg);
    return;
  }

  activeFovDeg = parsed;
  setReadout('fov', `${activeFovDeg.toFixed(0)}°`);
  if (viewer?.camera) {
    viewer.camera.fov = activeFovDeg;
    viewer.camera.updateProjectionMatrix();
    requestRender();
  }
  renderSnapshot();
});

hysteresisInput?.addEventListener('input', () => {
  const parsed = Number(hysteresisInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    hysteresisInput.value = String(activeHysteresisSecs);
    return;
  }

  activeHysteresisSecs = parsed;
  setReadout('hysteresis', `${activeHysteresisSecs.toFixed(2)}s`);
  constellationCompassController?.setHysteresisSecs(activeHysteresisSecs);
  requestRender();
  renderSnapshot();
});

artFadeInput?.addEventListener('input', () => {
  const parsed = Number(artFadeInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    artFadeInput.value = String(activeArtFadeSecs);
    return;
  }

  activeArtFadeSecs = parsed;
  setReadout('art-fade', `${activeArtFadeSecs.toFixed(2)}s`);
  constellationArtLayer?.setFadeDurationSecs(activeArtFadeSecs);
  requestRender();
  renderSnapshot();
});

artOpacityInput?.addEventListener('input', () => {
  const parsed = Number(artOpacityInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    artOpacityInput.value = String(activeArtOpacity);
    return;
  }

  activeArtOpacity = parsed;
  setReadout('art-opacity', activeArtOpacity.toFixed(2));
  constellationArtLayer?.setOpacity(activeArtOpacity);
  if (artEnabled && currentConstellationIau) {
    constellationArtLayer?.show(currentConstellationIau);
  }
  requestRender();
  renderSnapshot();
});

function updateStarFieldState(partialState) {
  activeStarFieldState = {
    ...activeStarFieldState,
    ...partialState,
  };
  if (viewer) {
    viewer.setState(partialState);
    requestRender();
  }
  renderSnapshot();
}

exposureInput?.addEventListener('input', () => {
  const sliderValue = Number(exposureInput.value);
  if (!Number.isFinite(sliderValue)) {
    return;
  }
  const exposure = Math.exp(sliderValue);
  setReadout('exposure', formatExposureReadout(exposure));
  updateStarFieldState({ starFieldExposure: exposure });
});

extinctionInput?.addEventListener('input', () => {
  const parsed = Number(extinctionInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('extinction', parsed.toFixed(2));
  updateStarFieldState({ starFieldExtinctionScale: parsed });
});

fadeRangeInput?.addEventListener('input', () => {
  const parsed = Number(fadeRangeInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('fade-range', parsed.toFixed(1));
  updateStarFieldState({ starFieldMagFadeRange: parsed });
});

baseSizeInput?.addEventListener('input', () => {
  const parsed = Number(baseSizeInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('base-size', parsed.toFixed(2));
  updateStarFieldState({ starFieldBaseSize: parsed });
});

sizeScaleInput?.addEventListener('input', () => {
  const parsed = Number(sizeScaleInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('size-scale', parsed.toFixed(2));
  updateStarFieldState({ starFieldSizeScale: parsed });
});

sizePowerInput?.addEventListener('input', () => {
  const parsed = Number(sizePowerInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return;
  }
  setReadout('size-power', parsed.toFixed(2));
  updateStarFieldState({ starFieldSizePower: parsed });
});

glowScaleInput?.addEventListener('input', () => {
  const parsed = Number(glowScaleInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('glow-scale', parsed.toFixed(2));
  updateStarFieldState({ starFieldGlowScale: parsed });
});

glowPowerInput?.addEventListener('input', () => {
  const parsed = Number(glowPowerInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return;
  }
  setReadout('glow-power', parsed.toFixed(2));
  updateStarFieldState({ starFieldGlowPower: parsed });
});

toleranceInput?.addEventListener('input', () => {
  const parsed = Number(toleranceInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    toleranceInput.value = String(activeTolerance);
    return;
  }

  activeTolerance = parsed;
  setReadout('pick-tolerance', `${activeTolerance.toFixed(1)}°`);
  pickControllerRef?.setToleranceDeg(activeTolerance);
  renderSnapshot();
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    window.clearInterval(snapshotTimer);
  }

  if (viewer) {
    viewer.dispose().catch((error) => {
      console.error('[free-roam-demo] cleanup failed', error);
    });
  }
});

snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  snapshotValue.textContent = error.stack ?? error.message;
  console.error('[free-roam-demo] initial mount failed', error);
});
