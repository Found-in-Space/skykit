import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  createFoundInSpaceDatasetOptions,
  createFullscreenPreset,
  createHud,
  createObserverShellField,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  createStarFieldLayer,
  createViewer,
  createVolumeHRLoader,
  DEFAULT_STAR_FIELD_STATE,
  getDatasetSession,
  HRDiagramRenderer,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import {
  createDistanceReadout,
  createFlyToAction,
  createLookAtAction,
  createSpeedReadout,
} from '../presets/navigation-presets.js';

const {
  icrsToScene: SCENE_TRANSFORM,
  sceneToIcrs: SCENE_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

// ── DOM refs ────────────────────────────────────────────────────────────────

const mount = document.querySelector('[data-skykit-viewer-root]');
const hrCanvas = document.querySelector('[data-hr-canvas]');
const radiusInput = document.querySelector('[data-radius]');
const radiusValue = document.querySelector('[data-radius-value]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const modeButtons = document.querySelectorAll('[data-mode]');
const statStars = document.querySelector('[data-stat-stars]');
const statDecoded = document.querySelector('[data-stat-decoded]');
const statNodes = document.querySelector('[data-stat-nodes]');
const statObserver = document.querySelector('[data-stat-observer]');
const statPhase = document.querySelector('[data-stat-phase]');
const statusSpan = document.querySelector('[data-status]');
const summaryPre = document.querySelector('[data-summary]');

// ── State ───────────────────────────────────────────────────────────────────

let activeMode = 1;
let activeRadius = Number(radiusInput?.value) || 25;
let activeMagLimit = Number(magLimitInput?.value) || 6.5;
let viewer = null;
let hrDiagram = null;
let volumeLoader = null;
let reloadQueued = false;
let lastObserverPc = { x: 0, y: 0, z: 0 };
/** Latest observer-shell star field geometry (always updated in onCommit). */
let lastStarFieldGeometry = null;
let lastStarFieldCount = 0;
const cameraWorldPos = new THREE.Vector3();
const vpMatrix = new THREE.Matrix4();

// ── Dataset ─────────────────────────────────────────────────────────────────

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'hr-diagram-demo',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'hr-diagram-demo',
  },
}));

// ── UI helpers ──────────────────────────────────────────────────────────────

function updateStats({ phase, starCount, decodedStarCount, nodeCount } = {}) {
  if (statPhase && phase != null) statPhase.textContent = phase;
  if (statStars && starCount != null) statStars.textContent = starCount.toLocaleString();
  if (statDecoded && decodedStarCount != null) statDecoded.textContent = decodedStarCount.toLocaleString();
  if (statNodes && nodeCount != null) statNodes.textContent = nodeCount.toLocaleString();
}

function updateObserverDisplay(pc) {
  if (!statObserver) return;
  statObserver.textContent = `${pc.x.toFixed(1)}, ${pc.y.toFixed(1)}, ${pc.z.toFixed(1)}`;
}

function setActiveMode(mode) {
  activeMode = mode;
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.mode) === mode);
  });
  hrDiagram?.setMode(mode);
}

/** Apply cached star-field geometry to the HR plot (modes 0 & 2). */
function syncHrFromStarField() {
  if (!hrDiagram || !lastStarFieldGeometry) {
    return;
  }
  hrDiagram.setGeometry(lastStarFieldGeometry);
  hrDiagram.setStarCount(lastStarFieldCount);
}

// ── Volume loader ───────────────────────────────────────────────────────────

async function loadVolumeHR() {
  if (!volumeLoader || activeMode !== 1) return;

  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? SOLAR_ORIGIN_PC;
  lastObserverPc = { ...observerPc };
  updateObserverDisplay(observerPc);

  updateStats({ phase: 'selecting…', starCount: 0, nodeCount: 0 });

  const result = await volumeLoader.load({
    observerPc,
    maxRadiusPc: activeRadius,
    onProgress(p) {
      updateStats({ phase: p.phase, starCount: p.starCount, nodeCount: p.nodeCount });
    },
  });

  if (!result) return;

  hrDiagram?.setGeometry(result.geometry);
  hrDiagram?.setStarCount(result.starCount);
  updateStats({
    phase: 'done',
    starCount: result.starCount,
    decodedStarCount: result.decodedStarCount,
    nodeCount: result.nodeCount,
  });
}

function queueVolumeReload() {
  if (reloadQueued) return;
  reloadQueued = true;
  requestAnimationFrame(() => {
    reloadQueued = false;
    loadVolumeHR().catch((err) => console.error('[hr-diagram-demo] volume load failed', err));
  });
}

// ── Mount viewer ────────────────────────────────────────────────────────────

async function mountViewer() {
  statusSpan.textContent = 'warming dataset…';

  await datasetSession.ensureRenderRootShard();
  await datasetSession.ensureRenderBootstrap();

  statusSpan.textContent = 'creating viewer…';

  const cameraController = createCameraRigController({
    id: 'hr-diagram-camera',
    icrsToSceneTransform: SCENE_TRANSFORM,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const fullscreen = createFullscreenPreset();

  const starLayer = createStarFieldLayer({
    id: 'hr-diagram-star-field',
    positionTransform: SCENE_TRANSFORM,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
    onCommit({ geometry, starCount }) {
      lastStarFieldGeometry = geometry;
      lastStarFieldCount = starCount;
      if (activeMode !== 1) {
        hrDiagram?.setGeometry(geometry);
        hrDiagram?.setStarCount(starCount);
      }
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    interestField: createObserverShellField({
      id: 'hr-diagram-field',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'hr-diagram-refresh',
        observerDistancePc: 8,
        minIntervalMs: 250,
        watchSize: false,
      }),
      fullscreen.controller,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
          createSpeedReadout(cameraController, { position: 'top-left' }),
          createDistanceReadout(cameraController, SOLAR_ORIGIN_PC, {
            label: 'Distance to Sun',
            position: 'top-left',
          }),
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
        ],
      }),
    ],
    layers: [starLayer],
    overlays: [
      {
        id: 'hr-diagram-overlay',
        update(context) {
          context.camera.getWorldPosition(cameraWorldPos);

          if (activeMode === 2) {
            vpMatrix.multiplyMatrices(
              context.camera.projectionMatrix,
              context.camera.matrixWorldInverse,
            );
            hrDiagram?.setViewProjection(vpMatrix);
          }

          hrDiagram?.render(cameraWorldPos);

          const obs = context.state?.observerPc;
          if (obs && activeMode === 1) {
            const dx = obs.x - lastObserverPc.x;
            const dy = obs.y - lastObserverPc.y;
            const dz = obs.z - lastObserverPc.z;
            const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (moved > Math.max(2, activeRadius * 0.15)) {
              queueVolumeReload();
            }
            updateObserverDisplay(obs);
          }
        },
      },
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      observerPc: { ...SOLAR_ORIGIN_PC },
      mDesired: activeMagLimit,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  statusSpan.textContent = 'running';

  // Set up HR diagram
  hrDiagram = new HRDiagramRenderer(hrCanvas, {
    mode: activeMode,
    maxMag: 17,
  });

  volumeLoader = createVolumeHRLoader({ datasetSession });

  window.addEventListener('resize', () => hrDiagram?.resize());

  if (activeMode === 1) {
    await loadVolumeHR();
  }
}

// ── Event handlers ──────────────────────────────────────────────────────────

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = Number(btn.dataset.mode);
    setActiveMode(mode);
    if (mode === 1) {
      queueVolumeReload();
    } else {
      syncHrFromStarField();
    }
  });
});

radiusInput?.addEventListener('input', () => {
  activeRadius = Number(radiusInput.value) || 25;
  if (radiusValue) radiusValue.textContent = `${activeRadius} pc`;
});

radiusInput?.addEventListener('change', () => {
  activeRadius = Number(radiusInput.value) || 25;
  if (radiusValue) radiusValue.textContent = `${activeRadius} pc`;
  if (activeMode === 1) queueVolumeReload();
});

magLimitInput?.addEventListener('change', () => {
  activeMagLimit = Number(magLimitInput.value) || 6.5;
  if (viewer) {
    viewer.setState({ mDesired: activeMagLimit });
    viewer.refreshSelection().catch((err) => {
      console.error('[hr-diagram-demo] mag limit refresh failed', err);
    });
  }
});

window.addEventListener('beforeunload', () => {
  volumeLoader?.cancel();
  viewer?.dispose().catch((err) => {
    console.error('[hr-diagram-demo] cleanup failed', err);
  });
});

// ── Boot ────────────────────────────────────────────────────────────────────

mountViewer().catch((err) => {
  statusSpan.textContent = 'error';
  console.error('[hr-diagram-demo] mount failed', err);
  if (summaryPre) summaryPre.textContent = err.stack ?? err.message;
});
