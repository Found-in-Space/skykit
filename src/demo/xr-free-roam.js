import * as THREE from 'three';
import {
  createTunedStarFieldMaterialProfile,
  createVrStarFieldMaterialProfile,
  DEFAULT_XR_STAR_FIELD_STATE,
  DEFAULT_TUNED_EXPOSURE,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  createXrRig,
  getDatasetSession,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  formatDistancePc,
  buildSimbadBasicSearch,
} from '../index.js';
import { createXrLocomotionController } from '../controllers/xr-locomotion-controller.js';
import { createXrPickController } from '../controllers/xr-pick-controller.js';
import { createXrTabletController } from '../controllers/xr-tablet-controller.js';
import { DEFAULT_METERS_PER_PARSEC, SCALE } from '../services/octree/scene-scale.js';

const PROXIMA_CEN_PC = { x: -0.47, y: -0.36, z: -1.16 };
const SIRIUS_PC = { x: -0.49, y: 2.48, z: -0.76 };
const BETELGEUSE_PC = { x: 4.2, y: 198.3, z: 25.8 };

function approachTargetFromObserver(targetPc, observerPc, distancePc) {
  const dx = targetPc.x - observerPc.x;
  const dy = targetPc.y - observerPc.y;
  const dz = targetPc.z - observerPc.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > distancePc)) {
    return clonePoint(observerPc);
  }
  const factor = distancePc / len;
  return {
    x: targetPc.x - dx * factor,
    y: targetPc.y - dy * factor,
    z: targetPc.z - dz * factor,
  };
}

const WAYPOINTS = [
  { label: 'Sol', targetPc: { x: 0, y: 0, z: 0 } },
  { label: 'Proxima Centauri', targetPc: PROXIMA_CEN_PC },
  { label: 'Sirius', targetPc: SIRIUS_PC },
  { label: 'Betelgeuse', targetPc: BETELGEUSE_PC },
];

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
  const xrPart = snapshot.parts.find((part) => part.id === 'phase-5b-xr-locomotion-controller');
  const refreshPart = snapshot.parts.find((part) => part.id === 'phase-5b-selection-refresh-controller');

  return {
    observerPc: clonePoint(snapshot.state?.observerPc),
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    xr: snapshot.xr ?? null,
    rig: snapshot.rig ?? null,
    rigType: snapshot.rigType ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? null,
    renderedStars: starLayerPart?.stats?.starCount ?? null,
    xrLocomotion: xrPart?.stats ?? null,
    selectionRefresh: refreshPart?.stats ?? null,
  };
}

const mount = document.querySelector('[data-skykit-viewer-root]');
const enterXrButton = document.querySelector('[data-action="enter-xr"]');
const exitXrButton = document.querySelector('[data-action="exit-xr"]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');
const pickInfoEl = document.querySelector('[data-pick-info]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'phase-5b-xr-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'phase-5b-xr-free-roam',
  },
}));

let starFieldLayer = null;
let viewer = null;
let tabletRef = null;
let pickControllerRef = null;
let xrLocomotionControllerRef = null;
let snapshotTimer = null;
let xrSupported = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 7.5;
let pickGeneration = 0;
let lastPickedResult = null;
let warmState = {
  bootstrap: 'idle',
  rootShard: 'idle',
  meta: 'idle',
};

function sceneToIcrsPc(pos) {
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(pos.x, pos.y, pos.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

function fmt(n, decimals = 2) {
  return Number.isFinite(n) ? n.toFixed(decimals) : '-';
}

function nonDisposable(profile) {
  return {
    ...profile,
    dispose() {},
  };
}

function flyToObserver(observerPc, options = {}) {
  if (!observerPc || !xrLocomotionControllerRef) {
    return false;
  }
  return xrLocomotionControllerRef.flyTo(observerPc, {
    speed: options.speed ?? 12,
    acceleration: options.acceleration ?? 6,
    deceleration: options.deceleration ?? 8,
    arrivalThreshold: options.arrivalThreshold ?? 0.01,
    onArrive: () => {
      viewer?.refreshSelection().catch((error) => {
        console.error('[xr-free-roam-demo] observer refresh after flyTo failed', error);
      });
      options.onArrive?.();
    },
  });
}

function goToPickedStar(result) {
  if (!result?.position) {
    return;
  }
  goToStarTarget(sceneToIcrsPc(result.position));
}

function goToStarTarget(targetPc) {
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc;
  if (!observerPc || !targetPc) {
    return;
  }
  flyToObserver(approachTargetFromObserver(targetPc, observerPc, 0.25), {
    speed: 10,
    acceleration: 5,
    deceleration: 7,
  });
}

let xrPickUi = null;
function bindXrPickUi() {
  if (xrPickUi || !pickInfoEl) {
    return xrPickUi;
  }

  xrPickUi = {
    empty: pickInfoEl.querySelector('[data-pick-empty]'),
    detail: pickInfoEl.querySelector('[data-pick-detail]'),
    catalog: pickInfoEl.querySelector('[data-pick-catalog]'),
    obs: pickInfoEl.querySelector('[data-pick-obs]'),
    simbadLink: pickInfoEl.querySelector('[data-pick-simbad]'),
    simbadEmpty: pickInfoEl.querySelector('[data-pick-simbad-empty]'),
  };
  return xrPickUi;
}

function renderPickInfo(result) {
  const ui = bindXrPickUi();
  if (!ui?.empty || !ui.detail || !ui.catalog || !ui.obs) {
    return;
  }

  if (!result) {
    ui.empty.hidden = false;
    ui.detail.hidden = true;
    return;
  }

  ui.empty.hidden = true;
  ui.detail.hidden = false;

  const fields = result.sidecarFields;
  ui.catalog.textContent = [
    `Proper name: ${fields?.properName || '-'}`,
    `Bayer: ${fields?.bayer || '-'}`,
    `HD: ${fields?.hd || '-'}`,
    `HIP: ${fields?.hip || '-'}`,
    `Gaia: ${fields?.gaia || '-'}`,
  ].join('\n');

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

  const tempStr = Number.isFinite(result.temperatureK)
    ? `${Math.round(result.temperatureK).toLocaleString()} K`
    : '-';

  const lines = [
    `Position: (${fmt(icrsPc.x, 1)}, ${fmt(icrsPc.y, 1)}, ${fmt(icrsPc.z, 1)}) pc`,
    `Distance: ${formatDistancePc(distFromObserver)}`,
    `Abs mag: ${fmt(result.absoluteMagnitude)}  App mag: ${fmt(result.apparentMagnitude)}`,
    `Temperature: ${tempStr}`,
    `Score: ${fmt(result.score, 3)}  Offset: ${fmt(result.angularDistanceDeg, 3)}deg`,
  ];

  if (Number.isFinite(result._pickTimeMs)) {
    lines.push(`Pick: ${fmt(result._pickTimeMs, 1)} ms / ${result._starCount ?? '?'} stars`);
  }

  ui.obs.textContent = lines.join('\n');
}

function updateTabletStarInfo(result) {
  if (!tabletRef) {
    return;
  }

  if (!result) {
    tabletRef.setDisplay('star-info', []);
    return;
  }

  const fields = result.sidecarFields;
  const icrsPc = sceneToIcrsPc(result.position);
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  const dist = Math.hypot(
    icrsPc.x - observerPc.x,
    icrsPc.y - observerPc.y,
    icrsPc.z - observerPc.z,
  );

  const lines = [];
  if (fields?.primaryLabel) {
    lines.push(fields.primaryLabel);
  }
  if (fields?.properName && fields.bayer) {
    lines.push(fields.bayer);
  }
  lines.push(`Distance: ${formatDistancePc(dist)}`);
  lines.push(`Mag: ${fmt(result.apparentMagnitude)} app / ${fmt(result.absoluteMagnitude)} abs`);
  if (Number.isFinite(result.temperatureK)) {
    lines.push(`Temp: ${Math.round(result.temperatureK).toLocaleString()} K`);
  }
  tabletRef.setDisplay('star-info', lines);
}

function handlePick(result) {
  pickGeneration += 1;
  const generation = pickGeneration;
  lastPickedResult = result ?? null;

  if (result) {
    delete result.sidecarFields;
  }
  renderPickInfo(result);
  updateTabletStarInfo(result);

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
      if (generation !== pickGeneration) {
        return;
      }
      if (fields) {
        result.sidecarFields = fields;
        renderPickInfo(result);
        updateTabletStarInfo(result);
      }
    } catch {
      // Sidecar is optional in this demo.
    }
  })();
}

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

  if (enterXrButton) {
    enterXrButton.disabled = !hasViewer || xrSupported !== true || presenting;
  }
  if (exitXrButton) {
    exitXrButton.disabled = !hasViewer || !presenting;
  }
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

  const camera = createViewerCamera();
  const xrRig = createXrRig(camera, {
    starFieldScale: DEFAULT_METERS_PER_PARSEC,
  });
  const vrProfile = createVrStarFieldMaterialProfile();
  const tunedProfile = createTunedStarFieldMaterialProfile({
    scale: DEFAULT_METERS_PER_PARSEC,
  });

  starFieldLayer = createStarFieldLayer({
    id: 'phase-5b-vr-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    materialFactory: () => createVrStarFieldMaterialProfile(),
    includePickMeta: true,
  });

  const mainMenuItems = [
    {
      id: 'star-info',
      label: 'Selected Star',
      type: 'display',
      lines: [],
      dismissible: true,
      actionId: 'go-selected',
      actionLabel: 'Go to Selected',
    },
    { id: 'tuned-shader', label: 'Desktop Shader', type: 'toggle', value: false },
    { id: 'show-waypoints', label: '> Waypoints', type: 'button' },
  ];

  const waypointMenuItems = [
    { id: 'wp-back', label: '< Back', type: 'button' },
    ...WAYPOINTS.map((waypoint, index) => ({
      id: `wp-${index}`,
      label: waypoint.label,
      type: 'button',
    })),
  ];

  const xrLocomotionController = createXrLocomotionController({
    id: 'phase-5b-xr-locomotion-controller',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    sceneScale: 1.0,
    moveSpeed: 4.0,
    flySpeed: 12,
    flyAcceleration: 6,
    flyDeceleration: 8,
  });
  xrLocomotionControllerRef = xrLocomotionController;

  const xrTabletController = createXrTabletController({
    id: 'phase-5b-xr-tablet-controller',
    items: mainMenuItems,
    onChange(id, value) {
      if (id === 'star-info') {
        pickControllerRef?.clearSelection();
        handlePick(null);
      }
      if (id === 'go-selected') {
        goToPickedStar(lastPickedResult);
      }
      if (id === 'tuned-shader') {
        if (value) {
          starFieldLayer.setMaterialProfile(nonDisposable(tunedProfile));
          viewer?.setState({ starFieldExposure: DEFAULT_TUNED_EXPOSURE });
        } else {
          starFieldLayer.setMaterialProfile(nonDisposable(vrProfile));
          viewer?.setState({ starFieldExposure: DEFAULT_XR_STAR_FIELD_STATE.starFieldExposure });
        }
      }
      if (id === 'show-waypoints') {
        xrTabletController.setItems(waypointMenuItems);
      }
      if (id === 'wp-back') {
        xrTabletController.setItems(mainMenuItems);
      }
      const waypointMatch = id.match(/^wp-(\d+)$/);
      if (waypointMatch) {
        const waypoint = WAYPOINTS[Number.parseInt(waypointMatch[1], 10)];
        if (waypoint) {
          goToStarTarget(waypoint.targetPc);
        }
        xrTabletController.setItems(mainMenuItems);
      }
    },
  });
  tabletRef = xrTabletController;

  const xrPickController = createXrPickController({
    id: 'phase-5b-xr-pick-controller',
    getStarData: () => starFieldLayer.getStarData(),
    toleranceDeg: 1.5,
    getLaserOverride: () => xrTabletController.getHit(),
    onPick(result, _event, stats) {
      if (result) {
        result._pickTimeMs = stats?.pickTimeMs ?? null;
        result._starCount = stats?.starCount ?? null;
      }
      handlePick(result);
    },
  });
  pickControllerRef = xrPickController;

  viewer = await createViewer(mount, {
    datasetSession,
    camera,
    rig: xrRig,
    xrCompatible: true,
    interestField: createObserverShellField({
      id: 'phase-5b-xr-observer-shell-field',
      note: 'Minimal XR observer shell field for 5B headset validation.',
    }),
    controllers: [
      xrLocomotionController,
      createSelectionRefreshController({
        id: 'phase-5b-selection-refresh-controller',
        observerDistancePc: 8,
        minIntervalMs: 300,
        watchSize: false,
      }),
      xrTabletController,
      xrPickController,
    ],
    layers: [starFieldLayer],
    state: {
      ...DEFAULT_XR_STAR_FIELD_STATE,
      demo: 'phase-5b-xr-free-roam',
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
      mDesired: activeMagLimit,
    },
    clearColor: 0x02040b,
  });

  await refreshXrSupport();
  renderSnapshot();
  syncButtons();
  return viewer;
}

enterXrButton?.addEventListener('click', () => {
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

exitXrButton?.addEventListener('click', () => {
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
