import * as THREE from 'three';
import {
  createFoundInSpaceDatasetOptions,
  createStarFieldLayer,
  createViewer,
  DEFAULT_STAR_FIELD_STATE,
  getDatasetSession,
  selectOctreeNodes,
  resolveFoundInSpaceDatasetOverrides,
} from '../index.js';
import { createDensityFieldMaterialProfile } from '../layers/density-field-materials.js';

// ── ICRS → Galactic rotation (galactic north = +Y) ──────────────────────────

const GAL_R = [
  [-0.0548756,  0.4941094, -0.8676661],
  [-0.4838350,  0.7469822,  0.4559838],
  [ 0.8734371,  0.4448296,  0.1980764],
];

function icrsToGalactic(x, y, z) {
  return [
    GAL_R[0][0] * x + GAL_R[0][1] * y + GAL_R[0][2] * z,
    GAL_R[1][0] * x + GAL_R[1][1] * y + GAL_R[1][2] * z,
    GAL_R[2][0] * x + GAL_R[2][1] * y + GAL_R[2][2] * z,
  ];
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const mount = document.querySelector('[data-skykit-viewer-root]');
const maxLevelInput = document.querySelector('[data-max-level]');
const maxLevelValue = document.querySelector('[data-max-level-value]');
const pointSizeInput = document.querySelector('[data-point-size]');
const pointSizeValue = document.querySelector('[data-point-size-value]');
const alphaInput = document.querySelector('[data-alpha]');
const alphaValue = document.querySelector('[data-alpha-value]');
const statusSpan = document.querySelector('[data-status]');
const starCountSpan = document.querySelector('[data-star-count]');

// ── State ────────────────────────────────────────────────────────────────────

let viewer = null;
let starFieldLayer = null;
let activeMaxLevel = Number(maxLevelInput?.value) || 8;
let activePointSize = Number(pointSizeInput?.value) || 2.5;
let activeAlpha = Number(alphaInput?.value) || 0.5;

// ── Dataset ──────────────────────────────────────────────────────────────────

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'data-shape-demo',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'data-shape-demo',
  },
}));

// ── Simple "load all nodes up to level N" field ──────────────────────────────

function createMaxLevelField() {
  const id = 'data-shape-field';
  return {
    id,
    async selectNodes(context) {
      const maxLevel = context.state?.dataShapeMaxLevel ?? activeMaxLevel;
      const result = await selectOctreeNodes(context, {
        maxLevel,
        predicate() {
          return { include: true };
        },
      });
      return {
        strategy: id,
        nodes: result.nodes,
        meta: { maxLevel, ...result.stats },
      };
    },
  };
}

// ── Orbit camera controller ──────────────────────────────────────────────────

function createOrbitController() {
  let azimuth = -2.8324;
  let elevation = -0.2999;
  let radius = 51.18;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const target = new THREE.Vector3(0, 0, 0);

  function updateCamera(camera) {
    const x = target.x + radius * Math.cos(elevation) * Math.sin(azimuth);
    const y = target.y + radius * Math.sin(elevation);
    const z = target.z + radius * Math.cos(elevation) * Math.cos(azimuth);
    camera.position.set(x, y, z);
    camera.lookAt(target);
  }

  function onPointerDown(event) {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function onPointerMove(event) {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    azimuth -= dx * 0.005;
    elevation = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, elevation + dy * 0.005));
  }

  function onPointerUp() {
    if (dragging) {
      console.log(`orbit: azimuth=${azimuth.toFixed(4)}, elevation=${elevation.toFixed(4)}, radius=${radius.toFixed(2)}`);
    }
    dragging = false;
  }

  function onWheel(event) {
    event.preventDefault();
    radius = Math.max(0.01, Math.min(1000, radius * (1 + event.deltaY * 0.001)));
    console.log(`orbit: azimuth=${azimuth.toFixed(4)}, elevation=${elevation.toFixed(4)}, radius=${radius.toFixed(2)}`);
  }

  return {
    id: 'orbit-controller',
    attach(context) {
      const el = context.renderer.domElement;
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointerleave', onPointerUp);
      el.addEventListener('wheel', onWheel, { passive: false });
      updateCamera(context.camera);
    },
    update(context) {
      updateCamera(context.camera);
    },
    dispose(context) {
      const el = context.renderer.domElement;
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointerleave', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    },
  };
}

// ── Mount viewer ─────────────────────────────────────────────────────────────

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 2000);
  return camera;
}

function updateStarCount() {
  if (!starCountSpan || !starFieldLayer) return;
  const stats = starFieldLayer.getStats();
  if (stats.starCount > 0) {
    starCountSpan.textContent = stats.starCount.toLocaleString();
  }
}

async function mountViewer() {
  if (viewer) return viewer;

  if (statusSpan) statusSpan.textContent = 'warming dataset…';
  await datasetSession.ensureRenderRootShard();
  await datasetSession.ensureRenderBootstrap();

  starFieldLayer = createStarFieldLayer({
    id: 'density-field',
    progressive: true,
    positionTransform: icrsToGalactic,
    materialFactory: () => createDensityFieldMaterialProfile({
      pointSize: activePointSize,
      alpha: activeAlpha,
    }),
    onCommit() {
      updateStarCount();
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createMaxLevelField(),
    controllers: [createOrbitController()],
    layers: [starFieldLayer],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'data-shape',
      dataShapeMaxLevel: activeMaxLevel,
      densityPointSize: activePointSize,
      densityAlpha: activeAlpha,
    },
    clearColor: 0x02040b,
  });

  if (statusSpan) statusSpan.textContent = 'ready';
  return viewer;
}

// ── Events ───────────────────────────────────────────────────────────────────

function syncMaxLevelLabel() {
  if (maxLevelValue) maxLevelValue.textContent = activeMaxLevel;
}

function syncPointSizeLabel() {
  if (pointSizeValue) pointSizeValue.textContent = activePointSize.toFixed(1);
}

function syncAlphaLabel() {
  if (alphaValue) alphaValue.textContent = activeAlpha.toFixed(3);
}

maxLevelInput?.addEventListener('input', () => {
  activeMaxLevel = Number(maxLevelInput.value);
  syncMaxLevelLabel();
  if (!viewer) return;
  viewer.setState({ dataShapeMaxLevel: activeMaxLevel });
  viewer.refreshSelection().then(updateStarCount).catch((err) => {
    console.error('[data-shape] level refresh failed', err);
  });
});

pointSizeInput?.addEventListener('input', () => {
  activePointSize = Number(pointSizeInput.value);
  syncPointSizeLabel();
  if (!viewer) return;
  viewer.setState({ densityPointSize: activePointSize });
});

alphaInput?.addEventListener('input', () => {
  activeAlpha = Number(alphaInput.value);
  syncAlphaLabel();
  if (!viewer) return;
  viewer.setState({ densityAlpha: activeAlpha });
});

window.addEventListener('beforeunload', () => {
  viewer?.dispose().catch((err) => {
    console.error('[data-shape] cleanup failed', err);
  });
});

// ── Boot ─────────────────────────────────────────────────────────────────────

syncMaxLevelLabel();
syncPointSizeLabel();
syncAlphaLabel();

mountViewer().catch((err) => {
  if (statusSpan) statusSpan.textContent = 'error';
  console.error('[data-shape] mount failed', err);
});
