import * as THREE from 'three';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createHaTiledVolumeLayer,
  createHud,
  createObserverShellField,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  resolveHaTiledVolumeLevelIds,
  resolveHaTiledVolumeUrl,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  SOLAR_ORIGIN_PC,
  SCALE,
} from '../index.js';
import {
  createDistanceReadout,
  createFlyToAction,
  createLookAtAction,
  createSpeedReadout,
} from '../presets/navigation-presets.js';
import { createFullscreenPreset } from '../presets/fullscreen-preset.js';

const DEFAULT_GAIN = 7.0;
const DEFAULT_THRESHOLD = 0.02;
const DEFAULT_OPACITY = 0.85;
const MAX_RESIDENT_BRICKS = 128;
const MAX_INFLIGHT_REQUESTS = 8;

const {
  icrsToScene: ICRS_TO_SCENE,
  sceneToIcrs: SCENE_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

const GALACTIC_TO_ICRS_ROTATION = [
  [-0.0548755604, +0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, +0.7469822445, +0.4559837762],
];

function galacticToIcrs(gx, gy, gz) {
  return [
    GALACTIC_TO_ICRS_ROTATION[0][0] * gx
      + GALACTIC_TO_ICRS_ROTATION[0][1] * gy
      + GALACTIC_TO_ICRS_ROTATION[0][2] * gz,
    GALACTIC_TO_ICRS_ROTATION[1][0] * gx
      + GALACTIC_TO_ICRS_ROTATION[1][1] * gy
      + GALACTIC_TO_ICRS_ROTATION[1][2] * gz,
    GALACTIC_TO_ICRS_ROTATION[2][0] * gx
      + GALACTIC_TO_ICRS_ROTATION[2][1] * gy
      + GALACTIC_TO_ICRS_ROTATION[2][2] * gz,
  ];
}

function icrsToGalactic(ix, iy, iz) {
  return [
    GALACTIC_TO_ICRS_ROTATION[0][0] * ix
      + GALACTIC_TO_ICRS_ROTATION[1][0] * iy
      + GALACTIC_TO_ICRS_ROTATION[2][0] * iz,
    GALACTIC_TO_ICRS_ROTATION[0][1] * ix
      + GALACTIC_TO_ICRS_ROTATION[1][1] * iy
      + GALACTIC_TO_ICRS_ROTATION[2][1] * iz,
    GALACTIC_TO_ICRS_ROTATION[0][2] * ix
      + GALACTIC_TO_ICRS_ROTATION[1][2] * iy
      + GALACTIC_TO_ICRS_ROTATION[2][2] * iz,
  ];
}

function galacticToVolumeScene(gx, gy, gz) {
  const [ix, iy, iz] = galacticToIcrs(gx, gy, gz);
  return ICRS_TO_SCENE(ix * SCALE, iy * SCALE, iz * SCALE);
}

function sceneToGalacticPc(x, y, z) {
  const [ixScene, iyScene, izScene] = SCENE_TO_ICRS(x, y, z);
  return icrsToGalactic(
    ixScene / SCALE,
    iyScene / SCALE,
    izScene / SCALE,
  );
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function formatExtentInfo(manifest, displayDimension) {
  const extent = manifest.world_extent_pc;
  const dimension = displayDimension ?? manifest.lod?.levels?.[0]?.dimension ?? 1;
  return {
    extents: `${extent.x.toFixed(0)} x ${extent.y.toFixed(0)} x ${extent.z.toFixed(0)}`,
    cellSize: `${(extent.x / dimension).toFixed(2)} x ${(extent.y / dimension).toFixed(2)} x ${(extent.z / dimension).toFixed(2)}`,
  };
}

const mount = document.querySelector('[data-skykit-viewer-root]');
const statusValue = document.querySelector('[data-status]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const gainInput = document.querySelector('[data-ha-gain]');
const thresholdInput = document.querySelector('[data-ha-threshold]');
const opacityInput = document.querySelector('[data-ha-opacity]');
const gainValue = document.querySelector('[data-ha-gain-value]');
const thresholdValue = document.querySelector('[data-ha-threshold-value]');
const opacityValue = document.querySelector('[data-ha-opacity-value]');
const urlSpan = document.querySelector('[data-ha-url]');
const gridSpan = document.querySelector('[data-ha-grid]');
const extentsSpan = document.querySelector('[data-ha-extents]');
const cellSizeSpan = document.querySelector('[data-ha-cell-size]');
const formatSpan = document.querySelector('[data-ha-format]');
const selectedSpan = document.querySelector('[data-ha-selected]');
const renderedSpan = document.querySelector('[data-ha-rendered]');
const cachedSpan = document.querySelector('[data-ha-cached]');
const inflightSpan = document.querySelector('[data-ha-inflight]');
const requestedSpan = document.querySelector('[data-ha-requested]');

const activeVolumeUrl = resolveHaTiledVolumeUrl();
const activeLevelIds = resolveHaTiledVolumeLevelIds();
const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'h-alpha-volume-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'h-alpha-volume',
  },
}));

let viewer = null;
let volumeLayer = null;
let volumeStats = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value))
  ? Number(magLimitInput.value)
  : 7.5;
const volumeState = {
  gain: Number(gainInput?.value) || DEFAULT_GAIN,
  threshold: Number(thresholdInput?.value) || DEFAULT_THRESHOLD,
  opacity: Number(opacityInput?.value) || DEFAULT_OPACITY,
};

function renderControls() {
  if (gainValue) gainValue.textContent = volumeState.gain.toFixed(1);
  if (thresholdValue) thresholdValue.textContent = volumeState.threshold.toFixed(3);
  if (opacityValue) opacityValue.textContent = volumeState.opacity.toFixed(2);
}

function renderStats() {
  if (urlSpan) urlSpan.textContent = activeVolumeUrl;
  if (!volumeStats?.manifest || !volumeStats.initialLevel || !volumeStats.finalLevel) return;

  const {
    manifest,
    initialLevel,
    finalLevel,
    slotCount,
    requestStats = {},
    rangeCacheStats = {},
  } = volumeStats;
  const extentInfo = formatExtentInfo(manifest, volumeStats.displayDimension);
  if (gridSpan) {
    gridSpan.textContent = `${initialLevel.id} ${initialLevel.dimension}^3 -> ${finalLevel.id} ${finalLevel.dimension}^3 · ${volumeStats.displayDimension}^3 display · halo ${initialLevel.tileHaloCells ?? 0}`;
  }
  if (extentsSpan) extentsSpan.textContent = extentInfo.extents;
  if (cellSizeSpan) cellSizeSpan.textContent = extentInfo.cellSize;
  if (formatSpan) formatSpan.textContent = `${manifest.format}/${manifest.runtime_frame}`;
  if (selectedSpan) selectedSpan.textContent = `${volumeStats.finalReady}/${slotCount} ${finalLevel.id}`;
  if (renderedSpan) renderedSpan.textContent = `${volumeStats.renderedVolumes} volume`;
  if (cachedSpan) {
    cachedSpan.textContent = `${volumeStats.cachedBricks} (${volumeStats.initialReady}/${slotCount} initial uploaded)`;
  }
  if (inflightSpan) inflightSpan.textContent = String(volumeStats.inflightBricks);
  if (requestedSpan) {
    const cacheHits = rangeCacheStats.persistentCacheHits ?? requestStats.persistentCacheHits ?? 0;
    requestedSpan.textContent = `${requestStats.bricksRequested ?? 0} · ${((requestStats.bytesRequested ?? 0) / (1024 * 1024)).toFixed(1)} MiB · ${cacheHits} cache hits · ${volumeStats.uploadCount ?? 0} uploads`;
  }
}

function applyVolumeUniforms() {
  volumeLayer?.setMaterialState(volumeState);
  viewer?.runtime?.renderOnce?.();
}

async function warmDatasetSession() {
  await datasetSession.ensureRenderRootShard();
  return datasetSession.ensureRenderBootstrap();
}

async function mountViewer() {
  if (viewer) return viewer;

  if (statusValue) statusValue.textContent = 'loading';
  await warmDatasetSession();

  const cameraController = createCameraRigController({
    id: 'h-alpha-volume-camera-rig',
    icrsToSceneTransform: ICRS_TO_SCENE,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });
  const fullscreen = createFullscreenPreset();
  const camera = createViewerCamera();
  volumeLayer = createHaTiledVolumeLayer({
    id: 'h-alpha-volume-layer',
    manifestUrl: activeVolumeUrl,
    initialLevelId: activeLevelIds.initialLevelId,
    finalLevelId: activeLevelIds.finalLevelId,
    volumeToSceneTransform: galacticToVolumeScene,
    sceneToVolumeTransform: sceneToGalacticPc,
    gain: volumeState.gain,
    threshold: volumeState.threshold,
    opacity: volumeState.opacity,
    maxResidentBricks: MAX_RESIDENT_BRICKS,
    maxInflightRequests: MAX_INFLIGHT_REQUESTS,
    onStats: (stats) => {
      volumeStats = stats;
      renderStats();
    },
    onStatus: (status) => {
      if (statusValue) statusValue.textContent = status;
    },
    onError: (error) => {
      console.error('[h-alpha-volume] tiled volume failed', error);
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera,
    interestField: createObserverShellField({
      id: 'h-alpha-volume-field',
      note: 'H-alpha fixed-grid tiled volume.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'h-alpha-volume-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      fullscreen.controller,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
          createLookAtAction(cameraController, SOLAR_ORIGIN_PC, {
            label: 'Sun',
            title: 'Look at Sun',
            position: 'top-right',
          }),
          createFlyToAction(cameraController, SOLAR_ORIGIN_PC, {
            label: 'Fly Sun',
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
      createStarFieldLayer({
        id: 'h-alpha-volume-star-field',
        positionTransform: ICRS_TO_SCENE,
        materialFactory: () => createDefaultStarFieldMaterialProfile(),
      }),
      volumeLayer,
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'h-alpha-volume',
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

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
  viewer.refreshSelection().catch((error) => {
    console.error('[h-alpha-volume] mag limit update failed', error);
  });
});

gainInput?.addEventListener('input', () => {
  volumeState.gain = Number(gainInput.value) || DEFAULT_GAIN;
  renderControls();
  applyVolumeUniforms();
});

thresholdInput?.addEventListener('input', () => {
  volumeState.threshold = Number(thresholdInput.value) || 0.0;
  renderControls();
  applyVolumeUniforms();
});

opacityInput?.addEventListener('input', () => {
  volumeState.opacity = Number(opacityInput.value) || DEFAULT_OPACITY;
  renderControls();
  applyVolumeUniforms();
});

window.addEventListener('beforeunload', () => {
  viewer?.dispose().catch((error) => {
    console.error('[h-alpha-volume] cleanup failed', error);
  });
});

renderControls();
renderStats();
mountViewer().catch((error) => {
  if (statusValue) statusValue.textContent = 'error';
  console.error(
    `[h-alpha-volume] failed to load ${activeVolumeUrl}. Generate it with pipeline-dust build-tiled-volume or pass ?haTiledUrl=...`,
    error,
  );
});
