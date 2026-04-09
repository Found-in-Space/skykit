import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  createFoundInSpaceDatasetOptions,
  createHud,
  createObserverShellField,
  createPickController,
  createSceneTouchDisplayController,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  DEFAULT_STAR_FIELD_STATE,
  DEFAULT_PICK_TOLERANCE_DEG,
  formatDistancePc,
  getDatasetSession,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  createSceneOrientationTransforms,
  SCALE,
  SOLAR_ORIGIN_PC,
  createFlyToAction,
  createLookAtAction,
} from '../index.js';

const PROXIMA_CEN_PC = { x: -0.47, y: -0.36, z: -1.16 };
const SIRIUS_PC = { x: -0.49, y: 2.48, z: -0.76 };
const BETELGEUSE_PC = { x: 4.2, y: 198.3, z: 25.8 };
const GALAXY_MAP_RADIAL_TICKS_PC = Object.freeze([2000, 4000, 8000, 12000]);
const GALAXY_MAP_HEIGHT_PC = 1200;
const GALAXY_MAP_CONTROL_ID = 'galaxy-map';

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

const WAYPOINTS = [
  { action: 'fly-sol', label: 'Sol', targetPc: SOLAR_ORIGIN_PC },
  { action: 'fly-proxima', label: 'Proxima Centauri', targetPc: PROXIMA_CEN_PC },
  { action: 'fly-sirius', label: 'Sirius', targetPc: SIRIUS_PC },
  { action: 'fly-betelgeuse', label: 'Betelgeuse', targetPc: BETELGEUSE_PC },
];

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function fmt(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '-';
}

function sceneToIcrsPc(pos) {
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(pos.x, pos.y, pos.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

function buildGalaxyMapValue(observerPc, selectedPc) {
  const radialObserverPc = Math.hypot(observerPc.x, observerPc.z);
  const radialSelectedPc = selectedPc ? Math.hypot(selectedPc.x, selectedPc.z) : null;
  const spanCandidate = Math.max(
    GALAXY_MAP_RADIAL_TICKS_PC[GALAXY_MAP_RADIAL_TICKS_PC.length - 1],
    radialObserverPc,
    Number.isFinite(radialSelectedPc) ? radialSelectedPc : 0,
  );
  const radialSpanPc = Math.max(100, Math.ceil(spanCandidate / 100) * 100);
  return {
    observer: observerPc,
    selected: selectedPc,
    radialSpanPc,
    radialTicksPc: GALAXY_MAP_RADIAL_TICKS_PC,
    verticalHalfSpanPc: GALAXY_MAP_HEIGHT_PC,
  };
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function drawGalaxyMapGraphic(ctx, bounds, value, options = {}) {
  if (!ctx || !bounds || !value) {
    return;
  }

  const observer = value.observer ?? { x: 0, y: 0, z: 0 };
  const selected = value.selected ?? null;
  const radialSpanPc = Number.isFinite(value.radialSpanPc) && value.radialSpanPc > 0 ? value.radialSpanPc : 1;
  const radialTicksPc = Array.isArray(value.radialTicksPc) ? value.radialTicksPc : [];
  const verticalHalfSpanPc = Number.isFinite(value.verticalHalfSpanPc) && value.verticalHalfSpanPc > 0
    ? value.verticalHalfSpanPc
    : 1;

  const theme = {
    bg: options.bg ?? '#08121f',
    border: options.border ?? 'rgba(159, 233, 255, 0.18)',
    axis: options.axis ?? 'rgba(159, 233, 255, 0.28)',
    text: options.text ?? '#9fb3c8',
    title: options.title ?? null,
  };

  const x = bounds.x ?? 0;
  const y = bounds.y ?? 0;
  const width = bounds.w;
  const height = bounds.h;
  const topX = x + 22;
  const topY = y + 18;
  const topW = width - 44;
  const topH = 118;
  const sideX = x + 22;
  const sideY = y + 154;
  const sideW = width - 44;
  const sideH = 30;
  const centerX = topX + topW / 2;
  const baseY = topY + topH;
  const radius = Math.min(topW * 0.46, topH - 6);

  ctx.fillStyle = theme.bg;
  ctx.fillRect(x, y, width, height);

  if (theme.title) {
    ctx.fillStyle = theme.text;
    ctx.font = 'bold 12px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(theme.title, x + 16, y + 8);
  }

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1.2;
  for (const tick of radialTicksPc) {
    if (!(tick > 0)) continue;
    const r = radius * clamp01(tick / radialSpanPc);
    ctx.beginPath();
    ctx.arc(centerX, baseY, r, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.moveTo(topX, baseY);
  ctx.lineTo(topX + topW, baseY);
  ctx.stroke();
  ctx.strokeRect(sideX, sideY, sideW, sideH);

  function drawTopMarker(point, color, outline = false) {
    if (!point) return;
    const radial = Math.hypot(point.x, point.z);
    const angle = Math.atan2(point.x, -point.z);
    const span = Math.PI * 0.98;
    const clampedAngle = clamp01((angle + span / 2) / span) * span - span / 2;
    const t = clamp01(radial / radialSpanPc);
    const px = centerX + Math.sin(clampedAngle) * radius * t;
    const py = baseY - Math.cos(clampedAngle) * radius * t;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    if (outline) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  function drawHeightMarker(point, color) {
    if (!point) return;
    const t = clamp01((point.y + verticalHalfSpanPc) / (verticalHalfSpanPc * 2));
    const px = sideX + t * sideW;
    const py = sideY + sideH / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTopMarker(observer, '#44ff66');
  drawTopMarker(selected, '#ffcc66', true);
  drawHeightMarker(observer, '#44ff66');
  drawHeightMarker(selected, '#ffcc66');

  ctx.fillStyle = theme.text;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`Top: 0..${Math.round(radialSpanPc).toLocaleString()} pc from galactic centre`, topX, y + 14);
  ctx.fillText(`Height: ±${Math.round(verticalHalfSpanPc).toLocaleString()} pc`, sideX, sideY + sideH + 14);
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

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

const mount = document.querySelector('[data-skykit-viewer-root]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'desktop-galaxy-map-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'desktop-galaxy-map',
  },
}));

let viewer = null;
let cameraController = null;
let starFieldLayer = null;
let pickControllerRef = null;
let tabletDisplay = null;
let snapshotTimer = null;
let lastPickedResult = null;
let pickGeneration = 0;
let currentTabletPage = 'home';
let activeMagLimit = 7.5;
let activeTolerance = DEFAULT_PICK_TOLERANCE_DEG;
let activeFlySpeed = 180;
let activeExposure = DEFAULT_STAR_FIELD_STATE.starFieldExposure;

function buildTabletHomeItems(observerPc = { x: 0, y: 0, z: 0 }, selectedPc = null) {
  const items = [
    { id: 'page-rendering', label: 'Rendering', type: 'button' },
    { id: 'page-waypoints', label: 'Waypoints', type: 'button' },
    ...(lastPickedResult ? [{ id: 'page-selection', label: 'Selection', type: 'button' }] : []),
    {
      id: GALAXY_MAP_CONTROL_ID,
      type: 'galaxy-map',
      value: buildGalaxyMapValue(observerPc, selectedPc),
    },
  ];
  return items;
}

function buildTabletSelectionItems() {
  return [
    { id: 'back-home', label: '< Back', type: 'button' },
    {
      id: 'star-info',
      label: 'Selected Target',
      type: 'display',
      lines: [],
      dismissible: true,
      actionId: 'go-selected',
      actionLabel: 'Go to Selected',
    },
    { id: 'look-selected', label: 'Look at Selected', type: 'button' },
    { id: 'clear-selection', label: 'Clear Selection', type: 'button' },
  ];
}

function buildTabletRenderingItems() {
  return [
    { id: 'back-home', label: '< Back', type: 'button' },
    {
      id: 'mag-limit',
      label: 'Mag Limit',
      type: 'range',
      value: activeMagLimit,
      min: 0,
      max: 25,
      step: 0.1,
      formatValue(value) {
        return Number(value).toFixed(1);
      },
    },
    {
      id: 'exposure',
      label: 'Exposure',
      type: 'range',
      value: Math.log10(Math.max(activeExposure, 1)),
      min: 0,
      max: 5,
      step: 0.05,
      formatValue(value) {
        return Math.round(10 ** Number(value)).toLocaleString();
      },
    },
    {
      id: 'pick-tolerance',
      label: 'Pick Tol. deg',
      type: 'range',
      value: activeTolerance,
      min: 0.1,
      max: 10,
      step: 0.1,
      formatValue(value) {
        return Number(value).toFixed(1);
      },
    },
    {
      id: 'fly-speed',
      label: 'Fly Speed',
      type: 'range',
      value: activeFlySpeed,
      min: 1,
      max: 2000,
      step: 1,
      formatValue(value) {
        return `${Math.round(Number(value)).toLocaleString()} pc/s`;
      },
    },
    { id: 'cancel-auto', label: 'Cancel Automation', type: 'button' },
  ];
}

function buildTabletWaypointItems() {
  return [
    { id: 'back-home', label: '< Back', type: 'button' },
    ...WAYPOINTS.map((waypoint, index) => ({
      id: `wp-${index}`,
      label: waypoint.label,
      type: 'button',
    })),
  ];
}

function renderTabletDisplay() {
  if (!tabletDisplay) {
    return;
  }
  tabletDisplay.draw();
}

function updateTabletStarInfo(result) {
  if (!tabletDisplay) {
    return;
  }
  if (!result) {
    tabletDisplay.setDisplay('star-info', []);
    renderTabletDisplay();
    return;
  }

  const fields = result.sidecarFields ?? {};
  const icrsPc = sceneToIcrsPc(result.position);
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  const dist = Math.hypot(
    icrsPc.x - observerPc.x,
    icrsPc.y - observerPc.y,
    icrsPc.z - observerPc.z,
  );

  const lines = [];
  if (fields?.properName) {
    lines.push(fields.properName);
  }
  if (fields?.bayer) {
    lines.push(fields.bayer);
  }
  if (fields?.hip) {
    lines.push(`HIP ${fields.hip}`);
  } else if (fields?.gaia) {
    lines.push(`Gaia ${fields.gaia}`);
  }
  lines.push(`Distance: ${formatDistancePc(dist)}`);
  lines.push(`Mag: ${fmt(result.apparentMagnitude)} app / ${fmt(result.absoluteMagnitude)} abs`);
  if (Number.isFinite(result.temperatureK)) {
    lines.push(`Temp: ${Math.round(result.temperatureK).toLocaleString()} K`);
  }
  tabletDisplay.setDisplay('star-info', lines);
  renderTabletDisplay();
}

function updateTabletGalaxyMap() {
  if (!tabletDisplay || currentTabletPage !== 'home') {
    return;
  }
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  const selectedPc = lastPickedResult?.position ? sceneToIcrsPc(lastPickedResult.position) : null;
  tabletDisplay.setItemValue(GALAXY_MAP_CONTROL_ID, buildGalaxyMapValue(observerPc, selectedPc));
  renderTabletDisplay();
}

function setTabletPage(pageId) {
  currentTabletPage = pageId;
  if (!tabletDisplay) {
    return;
  }

  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  const selectedPc = lastPickedResult?.position ? sceneToIcrsPc(lastPickedResult.position) : null;

  if (pageId === 'rendering') {
    tabletDisplay.setItems(buildTabletRenderingItems());
    renderTabletDisplay();
    return;
  }
  if (pageId === 'selection') {
    tabletDisplay.setItems(buildTabletSelectionItems());
    updateTabletStarInfo(lastPickedResult);
    renderTabletDisplay();
    return;
  }
  if (pageId === 'waypoints') {
    tabletDisplay.setItems(buildTabletWaypointItems());
    renderTabletDisplay();
    return;
  }

  tabletDisplay.setItems(buildTabletHomeItems(observerPc, selectedPc));
  updateTabletStarInfo(lastPickedResult);
  updateTabletGalaxyMap();
}

function createTabletGalaxyMapControl() {
  return {
    getHeight() {
      return 190;
    },

    render(ctx, rect, item, _state, env) {
      const { theme } = env;
      const data = item.value ?? {};
      ctx.fillStyle = theme.itemBg;
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 2;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      drawGalaxyMapGraphic(ctx, rect, data, {
        bg: theme.itemBg,
        border: theme.border,
        axis: theme.textDim,
        text: theme.textDim,
        title: 'GALACTIC MAP (TOP + HEIGHT)',
      });
    },
  };
}

function initSceneTablet() {
  if (tabletDisplay) {
    return;
  }

  tabletDisplay = createSceneTouchDisplayController({
    id: 'desktop-galaxy-map-tablet',
    title: 'SkyKit',
    items: buildTabletHomeItems(),
    displayOptions: {
      controls: {
        'galaxy-map': createTabletGalaxyMapControl(),
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
      if (id === 'star-info' && detail?.target?.targetType === 'dismiss') {
        handlePick(null);
      }
      if (id === 'go-selected') {
        goToPickedStar();
      }
      if (id === 'look-selected') {
        if (lastPickedResult?.position) {
          cameraController?.lookAt(sceneToIcrsPc(lastPickedResult.position), { blend: 0.06 });
          renderSnapshot();
        }
      }
      if (id === 'clear-selection') {
        handlePick(null);
      }
      if (id === 'page-selection') {
        setTabletPage('selection');
      }
      if (id === 'page-rendering') {
        setTabletPage('rendering');
      }
      if (id === 'page-waypoints') {
        setTabletPage('waypoints');
      }
      if (id === 'back-home') {
        setTabletPage('home');
      }
      if (id === 'mag-limit') {
        const nextValue = Number(value);
        if (Number.isFinite(nextValue)) {
          activeMagLimit = nextValue;
          applyViewerState({ refreshSelection: true });
        }
      }
      if (id === 'exposure') {
        const nextValue = Number(value);
        if (Number.isFinite(nextValue)) {
          activeExposure = 10 ** nextValue;
          applyViewerState();
        }
      }
      if (id === 'pick-tolerance') {
        const nextValue = Number(value);
        if (Number.isFinite(nextValue) && nextValue > 0) {
          activeTolerance = nextValue;
          pickControllerRef?.setToleranceDeg(activeTolerance);
          renderSnapshot();
        }
      }
      if (id === 'fly-speed') {
        const nextValue = Number(value);
        if (Number.isFinite(nextValue) && nextValue > 0) {
          activeFlySpeed = nextValue;
          renderSnapshot();
        }
      }
      if (id === 'cancel-auto') {
        cameraController?.cancelAutomation();
        renderSnapshot();
      }
      const waypointMatch = id.match(/^wp-(\d+)$/);
      if (waypointMatch) {
        const waypoint = WAYPOINTS[Number.parseInt(waypointMatch[1], 10)];
        if (waypoint) {
          goToStarTarget(waypoint.targetPc);
        }
        setTabletPage('home');
      }
    },
  });

  renderTabletDisplay();
}

function handlePick(result) {
  pickGeneration += 1;
  const generation = pickGeneration;
  lastPickedResult = result ?? null;

  if (result) {
    delete result.sidecarFields;
  } else {
    pickControllerRef?.clearSelection?.();
  }
  if (result) {
    setTabletPage('selection');
  } else if (currentTabletPage === 'selection') {
    setTabletPage('home');
  } else if (currentTabletPage === 'home') {
    setTabletPage('home');
  } else {
    updateTabletStarInfo(null);
  }
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
      if (generation !== pickGeneration || lastPickedResult !== result || !fields) {
        return;
      }
      result.sidecarFields = fields;
      updateTabletStarInfo(result);
      renderSnapshot();
    } catch {
      // Sidecar is optional for this demo.
    }
  })();
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
      viewer?.refreshSelection().catch((error) => {
        console.error('[galaxy-map-demo] refresh after flyTo failed', error);
      });
      renderSnapshot();
    },
  });
  renderSnapshot();
}

function goToPickedStar() {
  if (!lastPickedResult?.position) {
    return;
  }
  goToStarTarget(sceneToIcrsPc(lastPickedResult.position));
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  const observerPc = snapshot?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  updateTabletGalaxyMap();
  if (!tabletDisplay || currentTabletPage !== 'home') {
    return;
  }
  const selectedPc = lastPickedResult?.position ? sceneToIcrsPc(lastPickedResult.position) : null;
  tabletDisplay.setItemValue(GALAXY_MAP_CONTROL_ID, buildGalaxyMapValue(observerPc, selectedPc));
}

async function warmDatasetSession() {
  try {
    await datasetSession.ensureRenderRootShard();
    const bootstrap = await datasetSession.ensureRenderBootstrap();

    const metaService = datasetSession.getSidecarService('meta');
    if (metaService) {
      try {
        await metaService.ensureHeader();
      } catch (error) {
        console.warn('[galaxy-map-demo] meta sidecar unavailable', error);
      }
    }

    return bootstrap;
  } catch (error) {
    throw error;
  }
}

async function mountViewer() {
  if (viewer) {
    return viewer;
  }

  await warmDatasetSession();

  cameraController = createCameraRigController({
    id: 'desktop-galaxy-map-camera-rig',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  starFieldLayer = createStarFieldLayer({
    id: 'desktop-galaxy-map-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    includePickMeta: true,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
  });

  pickControllerRef = createPickController({
    id: 'desktop-galaxy-map-pick-controller',
    getStarData: () => starFieldLayer?.getStarData?.(),
    toleranceDeg: activeTolerance,
    onPick(result) {
      handlePick(result);
    },
  });

  initSceneTablet();

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'desktop-galaxy-map-field',
      note: 'Desktop galaxy-map validation sandbox.',
    }),
    controllers: [
      tabletDisplay,
      cameraController,
      createSelectionRefreshController({
        id: 'desktop-galaxy-map-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
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
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'desktop-galaxy-map',
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: ORION_CENTER_PC,
      mDesired: activeMagLimit,
      starFieldExposure: activeExposure,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  renderSnapshot();
  return viewer;
}

function applyViewerState(options = {}) {
  if (!viewer) {
    renderSnapshot();
    return;
  }

  viewer.setState({
    mDesired: activeMagLimit,
    starFieldExposure: activeExposure,
  });

  if (options.refreshSelection) {
    viewer.refreshSelection()
      .then(() => renderSnapshot())
      .catch((error) => {
        console.error('[galaxy-map-demo] state refresh failed', error);
      });
    return;
  }

  renderSnapshot();
}

globalThis.window?.addEventListener('resize', () => {
  renderSnapshot();
});

globalThis.window?.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    globalThis.window.clearInterval(snapshotTimer);
  }

  if (viewer) {
    viewer.dispose().catch((error) => {
      console.error('[galaxy-map-demo] cleanup failed', error);
    });
  }
});

initSceneTablet();
snapshotTimer = globalThis.window?.setInterval(renderSnapshot, 500) ?? null;
renderSnapshot();
mountViewer().catch((error) => {
  console.error('[galaxy-map-demo] initial mount failed', error);
});
