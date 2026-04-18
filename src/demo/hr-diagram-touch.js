import * as THREE from 'three';
import {
  buildHRDiagramValue,
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  createFlyToAction,
  createFoundInSpaceDatasetOptions,
  createHRDiagramControl,
  createHud,
  createLookAtAction,
  createObserverShellField,
  createPickController,
  createSceneOrientationTransforms,
  createSceneTouchDisplayController,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  createVolumeHRLoader,
  DEFAULT_PICK_TOLERANCE_DEG,
  DEFAULT_STAR_FIELD_STATE,
  getDatasetSession,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  SCALE,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import { installDemoViewerDebugConsole } from './viewer-debug-console.js';

const PROXIMA_CEN_PC = { x: -0.47, y: -0.36, z: -1.16 };
const SIRIUS_PC = { x: -0.49, y: 2.48, z: -0.76 };
const BETELGEUSE_PC = { x: 4.2, y: 198.3, z: 25.8 };

const WAYPOINTS = [
  { id: 'fly-sol', label: 'Fly: Sol', targetPc: SOLAR_ORIGIN_PC },
  { id: 'fly-proxima', label: 'Fly: Proxima', targetPc: PROXIMA_CEN_PC },
  { id: 'fly-sirius', label: 'Fly: Sirius', targetPc: SIRIUS_PC },
  { id: 'fly-betelgeuse', label: 'Fly: Betelgeuse', targetPc: BETELGEUSE_PC },
];

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

const mount = document.querySelector('[data-skykit-viewer-root]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'desktop-hr-diagram-touch-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'desktop-hr-diagram-touch',
  },
}));

let viewer = null;
let cameraController = null;
let tabletDisplay = null;
let pickControllerRef = null;
let volumeLoader = null;
let activePage = 'home';
let activeMode = 0;
let activeMagLimit = 7.5;
let activeRadius = 25;
let activeFlySpeed = 180;
let latestGeometry = null;
let latestStarCount = 0;
let volumeGeometry = null;
let volumeStarCount = 0;
let lastVolumeObserverPc = { ...SOLAR_ORIGIN_PC };
let volumeReloadQueued = false;
let nextHrUpdateAtMs = 0;
let lastPickedResult = null;

const viewProjection = new THREE.Matrix4();

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function buildHomeItems() {
  return [
    { id: 'hr', type: 'hr-diagram', value: null },
    ...(lastPickedResult ? [{ id: 'page-selection', type: 'button', label: 'Selection' }] : []),
    { id: 'page-rendering', type: 'button', label: 'Rendering Controls' },
    { id: 'page-waypoints', type: 'button', label: 'Waypoints' },
  ];
}

function sceneToIcrsPc(scenePosition) {
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(scenePosition.x, scenePosition.y, scenePosition.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

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

function buildSelectionItems() {
  return [
    { id: 'back-home', type: 'button', label: '< Back' },
    {
      id: 'selected-star',
      type: 'display',
      label: 'Selected Star',
      lines: [],
      dismissible: true,
      actionId: 'go-selected',
      actionLabel: 'Go to Selected',
    },
    { id: 'look-selected', type: 'button', label: 'Look at Selected' },
    { id: 'clear-selection', type: 'button', label: 'Clear Selection' },
  ];
}

function buildRenderingItems() {
  return [
    { id: 'back-home', type: 'button', label: '< Back' },
    {
      id: 'hr-mode',
      type: 'range',
      label: 'Mode',
      min: 0,
      max: 2,
      step: 1,
      value: activeMode,
      formatValue(value) {
        return ['Mag', 'Volume', 'Frustum'][Number(value)] ?? String(value);
      },
    },
    {
      id: 'mag-limit',
      type: 'range',
      label: 'Mag Limit',
      value: activeMagLimit,
      min: 0,
      max: 25,
      step: 0.1,
      formatValue(value) {
        return Number(value).toFixed(1);
      },
    },
    {
      id: 'volume-radius',
      type: 'range',
      label: 'Volume Radius',
      value: activeRadius,
      min: 5,
      max: 150,
      step: 5,
      formatValue(value) {
        return `${Math.round(Number(value))} pc`;
      },
    },
    {
      id: 'fly-speed',
      type: 'range',
      label: 'Fly Speed',
      value: activeFlySpeed,
      min: 5,
      max: 2000,
      step: 5,
      formatValue(value) {
        return `${Math.round(Number(value)).toLocaleString()} pc/s`;
      },
    },
    { id: 'cancel-auto', type: 'button', label: 'Cancel Automation' },
  ];
}

function buildWaypointItems() {
  return [
    { id: 'back-home', type: 'button', label: '< Back' },
    ...WAYPOINTS.map((waypoint) => ({
      id: waypoint.id,
      label: waypoint.label,
      type: 'button',
    })),
  ];
}

function setTabletPage(page) {
  activePage = page;
  if (!tabletDisplay) {
    return;
  }

  if (page === 'rendering') {
    tabletDisplay.setItems(buildRenderingItems());
    return;
  }
  if (page === 'waypoints') {
    tabletDisplay.setItems(buildWaypointItems());
    return;
  }
  if (page === 'selection') {
    tabletDisplay.setItems(buildSelectionItems());
    return;
  }
  tabletDisplay.setItems(buildHomeItems());
}

function updateTabletSelectionInfo() {
  if (!tabletDisplay || activePage !== 'selection') {
    return;
  }
  if (!lastPickedResult) {
    tabletDisplay.setDisplay('selected-star', []);
    return;
  }

  const lines = [];
  const temp = Number(lastPickedResult.temperatureK);
  const absMag = Number(lastPickedResult.absoluteMagnitude);
  const appMag = Number(lastPickedResult.apparentMagnitude);
  const distPc = Number(lastPickedResult.distancePc);
  if (Number.isFinite(temp)) {
    lines.push(`Temp: ${Math.round(temp).toLocaleString()} K`);
  }
  if (Number.isFinite(appMag) || Number.isFinite(absMag)) {
    lines.push(`Mag: ${Number.isFinite(appMag) ? appMag.toFixed(2) : '-'} app / ${Number.isFinite(absMag) ? absMag.toFixed(2) : '-'} abs`);
  }
  if (Number.isFinite(distPc)) {
    lines.push(`Distance: ${distPc.toFixed(2)} pc`);
  }
  tabletDisplay.setDisplay('selected-star', lines);
}

function goToStarTarget(targetPc) {
  if (!cameraController || !targetPc) {
    return;
  }
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc;
  if (!observerPc) {
    return;
  }
  const arrivalTarget = approachTargetFromObserver(targetPc, observerPc, 0.25);
  cameraController.cancelAutomation();
  cameraController.lockAt(targetPc, {
    dwellMs: 5000,
    recenterSpeed: 0.06,
  });
  cameraController.flyTo(arrivalTarget, {
    speed: activeFlySpeed,
    deceleration: 2.4,
    onArrive: () => {
      cameraController?.cancelOrientation?.();
      viewer?.refreshSelection().catch((error) => {
        console.error('[hr-diagram-touch-demo] refresh after flyTo failed', error);
      });
    },
  });
}

function goToPickedStar() {
  if (!lastPickedResult?.position) {
    return;
  }
  goToStarTarget(sceneToIcrsPc(lastPickedResult.position));
}

function handlePick(result) {
  lastPickedResult = result ?? null;
  if (!result) {
    pickControllerRef?.clearSelection?.();
  }
  if (lastPickedResult) {
    setTabletPage('selection');
    updateTabletSelectionInfo();
  } else if (activePage === 'selection') {
    setTabletPage('home');
  } else {
    setTabletPage(activePage);
  }
  nextHrUpdateAtMs = 0;
}

async function loadVolumeHR() {
  if (!volumeLoader || activeMode !== 1) {
    return;
  }

  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? SOLAR_ORIGIN_PC;
  const result = await volumeLoader.load({
    observerPc,
    maxRadiusPc: activeRadius,
  });

  if (!result) {
    return;
  }

  volumeGeometry = result.geometry;
  volumeStarCount = result.starCount;
  lastVolumeObserverPc = clonePoint(observerPc);
  nextHrUpdateAtMs = 0;
}

function queueVolumeReload() {
  if (volumeReloadQueued) {
    return;
  }
  volumeReloadQueued = true;
  requestAnimationFrame(() => {
    volumeReloadQueued = false;
    loadVolumeHR().catch((error) => {
      console.error('[hr-diagram-touch-demo] volume load failed', error);
    });
  });
}

function updateHrDisplay(context) {
  const observerPc = context.state?.observerPc ?? SOLAR_ORIGIN_PC;
  if (activeMode === 1) {
    const dx = observerPc.x - lastVolumeObserverPc.x;
    const dy = observerPc.y - lastVolumeObserverPc.y;
    const dz = observerPc.z - lastVolumeObserverPc.z;
    const movedPc = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (movedPc > Math.max(2, activeRadius * 0.15)) {
      queueVolumeReload();
    }
  }

  const geometry = activeMode === 1 ? volumeGeometry : latestGeometry;
  const starCount = activeMode === 1 ? volumeStarCount : latestStarCount;
  if (!tabletDisplay || !geometry || !(starCount > 0) || activePage !== 'home') {
    return;
  }

  const now = performance.now();
  const updateIntervalMs = activeMode === 2 ? 90 : 140;
  if (now < nextHrUpdateAtMs) {
    return;
  }
  nextHrUpdateAtMs = now + updateIntervalMs;

  const value = buildHRDiagramValue(geometry, {
    starCount,
    observerPc,
    mode: activeMode,
    appMagLimit: activeMagLimit,
    viewProjection: activeMode === 2
      ? viewProjection.multiplyMatrices(
        context.camera.projectionMatrix,
        context.camera.matrixWorldInverse,
      ).elements
      : undefined,
    selectedStars: lastPickedResult
      ? [{
        teffK: lastPickedResult.temperatureK,
        magAbs: lastPickedResult.absoluteMagnitude,
      }]
      : null,
  });

  tabletDisplay.setItemValue('hr', value);
}

function onTabletChange(id, value, detail) {
  if (id === 'page-rendering') {
    setTabletPage('rendering');
    return;
  }
  if (id === 'page-waypoints') {
    setTabletPage('waypoints');
    return;
  }
  if (id === 'page-selection') {
    setTabletPage('selection');
    updateTabletSelectionInfo();
    return;
  }
  if (id === 'back-home') {
    setTabletPage('home');
    nextHrUpdateAtMs = 0;
    return;
  }

  if (id === 'mag-limit') {
    activeMagLimit = Number(value);
    viewer?.setState({ mDesired: activeMagLimit });
    viewer?.refreshSelection().catch((error) => {
      console.error('[hr-diagram-touch-demo] refresh after mag change failed', error);
    });
    nextHrUpdateAtMs = 0;
    return;
  }

  if (id === 'hr-mode') {
    activeMode = Number(value);
    nextHrUpdateAtMs = 0;
    if (activeMode === 1) {
      queueVolumeReload();
    }
    return;
  }

  if (id === 'volume-radius') {
    activeRadius = Number(value);
    if (activeMode === 1) {
      queueVolumeReload();
    }
    return;
  }

  if (id === 'fly-speed') {
    activeFlySpeed = Number(value);
    return;
  }

  if (id === 'cancel-auto') {
    cameraController?.cancelAutomation();
    return;
  }
  if (id === 'go-selected') {
    goToPickedStar();
    return;
  }
  if (id === 'look-selected') {
    if (lastPickedResult?.position) {
      cameraController?.lookAt(sceneToIcrsPc(lastPickedResult.position), { blend: 0.06 });
    }
    return;
  }
  if (id === 'clear-selection') {
    handlePick(null);
    return;
  }
  if (id === 'selected-star' && detail?.target?.targetType === 'dismiss') {
    handlePick(null);
    return;
  }

  const waypoint = WAYPOINTS.find((entry) => entry.id === id);
  if (!waypoint) {
    return;
  }

  cameraController?.lookAt(waypoint.targetPc);
  goToStarTarget(waypoint.targetPc);
}

function initSceneTablet() {
  if (tabletDisplay) {
    return;
  }

  tabletDisplay = createSceneTouchDisplayController({
    id: 'desktop-hr-diagram-touch-tablet',
    title: 'SkyKit HR',
    items: buildHomeItems(),
    displayOptions: {
      controls: {
        'hr-diagram': createHRDiagramControl({ height: 220 }),
      },
    },
    mouseControls: true,
    parent(context) {
      return context.camera ?? null;
    },
    panelWidth: 0.24,
    panelHeight: 0.336,
    depthTest: false,
    updatePlacement(panelMesh, context) {
      const distance = 0.52;
      const tabletWidth = 0.24;
      const tabletHeight = 0.336;
      const aspect = context.camera?.aspect ?? 16 / 9;
      const fovDeg = context.camera?.isPerspectiveCamera ? context.camera.fov : 60;
      const halfHeight = Math.tan((fovDeg * Math.PI / 180) * 0.5) * distance;
      const halfWidth = halfHeight * aspect;
      const hudPaddingPx = 12;
      const viewportWidth = Math.max(1, context.size?.width ?? 1);
      const viewportHeight = Math.max(1, context.size?.height ?? 1);
      const marginX = (halfWidth * 2) * (hudPaddingPx / viewportWidth);
      const marginY = (halfHeight * 2) * (hudPaddingPx / viewportHeight);
      const x = -halfWidth + tabletWidth * 0.5 + marginX;
      const y = halfHeight - tabletHeight * 0.5 - marginY;

      panelMesh.position.set(x, y, -distance);
      panelMesh.rotation.set(0, 0, 0);
      return true;
    },
    onChange(id, value, detail) {
      onTabletChange(id, value, detail);
    },
  });
}

async function mountViewer() {
  await datasetSession.ensureRenderRootShard();
  await datasetSession.ensureRenderBootstrap();

  volumeLoader = createVolumeHRLoader({ datasetSession });

  cameraController = createCameraRigController({
    id: 'desktop-hr-diagram-touch-camera-rig',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const starFieldLayer = createStarFieldLayer({
    id: 'desktop-hr-diagram-touch-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    includePickMeta: true,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
    onCommit({ geometry, starCount }) {
      latestGeometry = geometry;
      latestStarCount = starCount;
      nextHrUpdateAtMs = 0;
    },
  });

  initSceneTablet();
  pickControllerRef = createPickController({
    id: 'desktop-hr-diagram-touch-pick-controller',
    getStarData: () => starFieldLayer?.getStarData?.(),
    toleranceDeg: DEFAULT_PICK_TOLERANCE_DEG,
    onPick(result) {
      handlePick(result);
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    interestField: createObserverShellField({
      id: 'desktop-hr-diagram-touch-field',
      note: 'Desktop touch HR diagram sandbox.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'desktop-hr-diagram-touch-selection-refresh',
        observerDistancePc: 4,
        minIntervalMs: 140,
      }),
      tabletDisplay,
      pickControllerRef,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
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
        ],
      }),
    ],
    layers: [starFieldLayer],
    overlays: [
      {
        id: 'desktop-hr-diagram-touch-overlay',
        update(context) {
          updateHrDisplay(context);
        },
      },
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      observerPc: { ...SOLAR_ORIGIN_PC },
      mDesired: activeMagLimit,
      pickToleranceDeg: DEFAULT_PICK_TOLERANCE_DEG,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  queueVolumeReload();
  installDemoViewerDebugConsole(viewer, { id: 'hr-diagram-touch' });
}

window.addEventListener('beforeunload', () => {
  volumeLoader?.cancel();
  viewer?.dispose().catch((error) => {
    console.error('[hr-diagram-touch-demo] cleanup failed', error);
  });
});

mountViewer().catch((error) => {
  console.error('[hr-diagram-touch-demo] mount failed', error);
});
