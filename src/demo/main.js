import * as THREE from 'three';
import {
  createCameraRigController,
  createCartoonStarFieldMaterialProfile,
  createConstellationArtLayer,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createObserverShellField,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createTargetFrustumField,
  createViewer,
  getDatasetSession,
} from '../index.js';

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);
const DEFAULT_WESTERN_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';

const mounts = [...document.querySelectorAll('[data-skykit-viewer-root]')];
const fieldSelect = document.querySelector('[data-field-strategy]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'phase-5-demo-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'phase-5-controllers',
  },
}));

let viewers = [];
let snapshotTimer = null;
let activeFieldStrategy = fieldSelect?.value ?? 'observer-shell';
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 7.5;
const activeConstellationManifestUrl = resolveConstellationManifestUrl();
let warmState = {
  bootstrap: 'idle',
  rootShard: 'idle',
  meta: 'idle',
};

function resolveConstellationManifestUrl(search = null) {
  const searchValue = typeof search === 'string'
    ? search
    : globalThis.location?.search ?? '';
  const params = new URLSearchParams(searchValue);
  return params.get('constellationManifestUrl')?.trim()
    || params.get('westernManifestUrl')?.trim()
    || DEFAULT_WESTERN_MANIFEST_URL;
}

function createInterestField(strategy, index) {
  if (strategy === 'target-frustum') {
    return createTargetFrustumField({
      id: `phase-5-target-frustum-field-${index + 1}`,
      targetPc: ORION_CENTER_PC,
      verticalFovDeg: 52,
      overscanDeg: 18,
      targetRadiusPc: 180,
      preloadDistancePc: 0,
      note: 'Phase 5 target-locked field for Orion-style parallax scenes.',
    });
  }

  return createObserverShellField({
    id: `phase-5-observer-shell-field-${index + 1}`,
    note: 'Phase 5 shell field using the shared magnitude-shell visibility prune.',
  });
}

function summarizeViewer(snapshot) {
  const starLayerPart = snapshot.parts.find((part) => part.kind === 'layer' && part.stats?.starCount != null);
  return {
    slot: snapshot.state?.slot ?? null,
    field: snapshot.selection?.strategy ?? null,
    observerPc: snapshot.state?.observerPc ?? null,
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    visitedNodes: snapshot.selection?.meta?.visitedNodeCount ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? null,
    renderedStars: starLayerPart?.stats?.starCount ?? null,
  };
}

function renderSummary(viewerSnapshots, datasetDescription) {
  if (!summaryValue) {
    return;
  }

  summaryValue.textContent = JSON.stringify({
    fieldStrategy: activeFieldStrategy,
    mDesired: activeMagLimit,
    sharedDatasetSession: datasetDescription?.id ?? null,
    renderServiceStats: datasetDescription?.services?.render?.stats ?? null,
    viewers: viewerSnapshots.map(summarizeViewer),
  }, null, 2);
}

function createLayer(index) {
  return createStarFieldLayer({
    id: `phase-5-star-field-layer-${index + 1}`,
    positionTransform: ORION_SCENE_TRANSFORM,
    materialFactory: () => (index % 2 === 0
      ? createDefaultStarFieldMaterialProfile()
      : createCartoonStarFieldMaterialProfile({
        color: 0xd8b15a,
        coreColor: 0xffefbe,
      })),
  });
}

function createLayers(index) {
  const layers = [createLayer(index)];

  if (index === 1) {
    layers.push(createConstellationArtLayer({
      id: 'phase-5-orion-constellation-art-layer',
      manifestUrl: activeConstellationManifestUrl,
      iauFilter: ['Ori'],
      transformDirection: ORION_SCENE_TRANSFORM,
      radius: 8,
      opacity: 0.24,
    }));
  }

  return layers;
}

function createControllers(index) {
  if (index !== 0 || activeFieldStrategy !== 'observer-shell') {
    return [];
  }

  return [
    createCameraRigController({
      id: 'phase-5-camera-rig-controller',
      icrsToSceneTransform: ORION_SCENE_TRANSFORM,
      sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
      lookAtPc: ORION_CENTER_PC,
      moveSpeed: 18,
    }),
    createSelectionRefreshController({
      id: 'phase-5-selection-refresh-controller',
      observerDistancePc: 12,
      minIntervalMs: 250,
      watchSize: false,
    }),
  ];
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function renderSnapshot() {
  const viewerSnapshots = viewers.map((viewer) => viewer.getSnapshotState());
  const datasetDescription = datasetSession.describe();

  statusValue.textContent = viewers.length > 0
    ? `${viewers.filter((viewer) => viewer.runtime.running).length}/${viewers.length} running`
    : 'idle';

  renderSummary(viewerSnapshots, datasetDescription);

  snapshotValue.textContent = JSON.stringify({
    fieldStrategy: activeFieldStrategy,
    mDesired: activeMagLimit,
    viewers: viewerSnapshots,
    warmState,
    constellationManifestUrl: activeConstellationManifestUrl,
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

async function mountViewers() {
  if (viewers.length > 0) {
    return viewers;
  }

  await warmDatasetSession();

  viewers = await Promise.all(
    mounts.map((mount, index) => createViewer(mount, {
      datasetSession,
      camera: createViewerCamera(),
      interestField: createInterestField(activeFieldStrategy, index),
      controllers: createControllers(index),
      layers: createLayers(index),
      state: {
        ...DEFAULT_STAR_FIELD_STATE,
        demo: 'phase-5-controllers',
        slot: index + 1,
        observerPc: { x: 0, y: 0, z: 0 },
        mDesired: activeMagLimit,
        targetPc: ORION_CENTER_PC,
        fieldStrategy: activeFieldStrategy,
      },
      clearColor: 0x02040b,
    })),
  );

  renderSnapshot();
  return viewers;
}

async function disposeViewers() {
  if (viewers.length === 0) {
    return;
  }

  await Promise.all(viewers.map((viewer) => viewer.dispose()));
  viewers = [];
  renderSnapshot();
}

fieldSelect?.addEventListener('change', () => {
  activeFieldStrategy = fieldSelect.value;

  const remount = viewers.length > 0
    ? disposeViewers().then(() => mountViewers())
    : Promise.resolve().then(() => {
      renderSnapshot();
    });

  remount.catch((error) => {
    statusValue.textContent = 'error';
    snapshotValue.textContent = error.stack ?? error.message;
    console.error('[skykit-demo] field switch failed', error);
  });
});

magLimitInput?.addEventListener('change', () => {
  const parsed = Number(magLimitInput.value);
  if (!Number.isFinite(parsed)) {
    magLimitInput.value = String(activeMagLimit);
    return;
  }

  activeMagLimit = parsed;

  if (viewers.length === 0) {
    renderSnapshot();
    return;
  }

  for (const viewer of viewers) {
    viewer.setState({ mDesired: activeMagLimit });
  }

  Promise.all(viewers.map((viewer) => viewer.refreshSelection()))
    .then(() => {
      renderSnapshot();
    })
    .catch((error) => {
      statusValue.textContent = 'error';
      snapshotValue.textContent = error.stack ?? error.message;
      console.error('[skykit-demo] mag limit update failed', error);
    });
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    window.clearInterval(snapshotTimer);
  }
  if (viewers.length > 0) {
    Promise.all(viewers.map((viewer) => viewer.dispose())).catch((error) => {
      console.error('[skykit-demo] cleanup failed', error);
    });
  }
});

snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
mountViewers().catch((error) => {
  statusValue.textContent = 'error';
  snapshotValue.textContent = error.stack ?? error.message;
  console.error('[skykit-demo] initial mount failed', error);
});
