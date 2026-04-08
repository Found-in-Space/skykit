import * as THREE from 'three';
import {
  createConstellationArtLayer,
  createConstellationCompassController,
  createHaTiledVolumeLayer,
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
  loadConstellationArtManifest,
  ORION_CENTER_PC,
  resolveFoundInSpaceDatasetOverrides,
  resolveHaTiledVolumeLevelIds,
  resolveHaTiledVolumeUrl,
  formatDistancePc,
  buildSimbadBasicSearch,
} from '../index.js';
import { createXrLocomotionController } from '../controllers/xr-locomotion-controller.js';
import { createXrPickController } from '../controllers/xr-pick-controller.js';
import { createXrTabletController } from '../controllers/xr-tablet-controller.js';
import { DEFAULT_METERS_PER_PARSEC, SCALE } from '../services/octree/scene-scale.js';
import { computeXrDepthRange } from '../services/render/xr-depth-range.js';

const PROXIMA_CEN_PC = { x: -0.47, y: -0.36, z: -1.16 };
const SIRIUS_PC = { x: -0.49, y: 2.48, z: -0.76 };
const BETELGEUSE_PC = { x: 4.2, y: 198.3, z: 25.8 };
const XR_DESKTOP_NEAR_MAG_LIMIT_FLOOR = 25.0;
const XR_DESKTOP_NEAR_MAG_LIMIT_RADIUS_PC = 1.0;
const XR_DESKTOP_NEAR_MAG_LIMIT_FEATHER_PC = 0.25;
const XR_DESKTOP_NEAR_SIZE_FLOOR = 8.0;
const XR_DESKTOP_NEAR_ALPHA_FLOOR = 0.35;
const DEFAULT_ART_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';
const EXPOSURE_CONTROL = Object.freeze({
  minLog10: 2.0,
  maxLog10: 5.5,
  step: 0.05,
});
const WORLD_SCALE_CONTROL = Object.freeze({
  minLog10: -2.0,
  maxLog10: 3.0,
  step: 0.05,
});
const GALAXY_MAP_CONTROL_ID = 'galaxy-map';
const GALAXY_MAP_RADIAL_TICKS_PC = Object.freeze([2000, 4000, 8000, 12000]);
const GALAXY_MAP_HEIGHT_PC = 1200;
const H_ALPHA_XR_VOLUME_URL = resolveHaTiledVolumeUrl();
const H_ALPHA_XR_LEVEL_IDS = resolveHaTiledVolumeLevelIds({
  initialLevelDefault: 3,
  finalLevelDefault: 1,
});
const H_ALPHA_XR_RAYMARCH_STEPS = 64;
const H_ALPHA_XR_GAIN = 7.0;
const H_ALPHA_XR_THRESHOLD = 0.02;
const H_ALPHA_XR_OPACITY = 0.75;
const H_ALPHA_XR_BOUND_RADIUS_PC = 2200;

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

function normalizeQuaternion(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  const w = Number(value.w);
  const len = Math.hypot(x, y, z, w);
  if (!(len > 0)) {
    return null;
  }
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

function approachTargetFromShipForward(targetPc, orientation, distancePc) {
  const q = normalizeQuaternion(orientation);
  if (!q || !(distancePc > 0)) {
    return clonePoint(targetPc);
  }
  const forwardScene = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(
    forwardScene.x,
    forwardScene.y,
    forwardScene.z,
  );
  const len = Math.hypot(ix, iy, iz);
  if (!(len > 0)) {
    return clonePoint(targetPc);
  }
  return {
    x: targetPc.x - (ix / len) * distancePc,
    y: targetPc.y - (iy / len) * distancePc,
    z: targetPc.z - (iz / len) * distancePc,
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
const XR_DEPTH_MARGIN_FACTOR = 1.2;
const XR_CONSTELLATION_SPHERE_RADIUS_PC = 8;
const XR_MIN_FAR_PLANE = 100;
const XR_MAX_FAR_PLANE = 2000000;
const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
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

function galacticToXrScene(gx, gy, gz) {
  const [ix, iy, iz] = galacticToIcrs(gx, gy, gz);
  return ORION_SCENE_TRANSFORM(ix * SCALE, iy * SCALE, iz * SCALE);
}

function sceneToGalacticPc(x, y, z) {
  const [ixScene, iyScene, izScene] = ORION_SCENE_TO_ICRS_TRANSFORM(x, y, z);
  return icrsToGalactic(
    ixScene / SCALE,
    iyScene / SCALE,
    izScene / SCALE,
  );
}

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(
    60,
    1,
    XR_NEAR_PLANE,
    computeXrDepthTelemetry(null, {
      starFieldScale: DEFAULT_METERS_PER_PARSEC,
      includeConstellationSphere: true,
    }).far,
  );
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function createShipDeckSlab() {
  const slab = new THREE.Group();
  slab.name = 'shipDeckSlab';

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.025, 1.55),
    new THREE.MeshBasicMaterial({
      color: 0x1d8f89,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  base.position.set(0, -0.0125, -0.08);
  base.renderOrder = 20;
  slab.add(base);

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.03, 0.38),
    new THREE.MeshBasicMaterial({
      color: 0x9cf0e3,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  nose.position.set(0, -0.01, -0.72);
  nose.renderOrder = 21;
  slab.add(nose);

  return slab;
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
    xrDepthRange: xrDepthRangeTelemetry,
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

function countFractionDigits(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const text = String(value);
  const dot = text.indexOf('.');
  return dot >= 0 ? text.length - dot - 1 : 0;
}

function readNumberControlConfig(input, fallback) {
  const min = Number(input?.min);
  const max = Number(input?.max);
  const step = Number(input?.step);
  return {
    min: Number.isFinite(min) ? min : fallback.min,
    max: Number.isFinite(max) ? max : fallback.max,
    step: Number.isFinite(step) && step > 0 ? step : fallback.step,
  };
}

const MAG_LIMIT_CONTROL = readNumberControlConfig(magLimitInput, {
  min: 0,
  max: 25,
  step: 0.1,
});
const MAG_LIMIT_DECIMALS = countFractionDigits(MAG_LIMIT_CONTROL.step);
const EXPOSURE_DECIMALS = countFractionDigits(EXPOSURE_CONTROL.step);
const WORLD_SCALE_LOG_DECIMALS = countFractionDigits(WORLD_SCALE_CONTROL.step);

function normalizeMagLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const clamped = Math.min(
    Math.max(numeric, MAG_LIMIT_CONTROL.min),
    MAG_LIMIT_CONTROL.max,
  );
  const stepped = MAG_LIMIT_CONTROL.min
    + Math.round((clamped - MAG_LIMIT_CONTROL.min) / MAG_LIMIT_CONTROL.step) * MAG_LIMIT_CONTROL.step;
  return Number(stepped.toFixed(MAG_LIMIT_DECIMALS));
}

function formatMagLimitValue(value) {
  return Number.isFinite(value) ? value.toFixed(MAG_LIMIT_DECIMALS) : '-';
}

function normalizeWorldScaleLogValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const clamped = Math.min(
    Math.max(numeric, WORLD_SCALE_CONTROL.minLog10),
    WORLD_SCALE_CONTROL.maxLog10,
  );
  const stepped = WORLD_SCALE_CONTROL.minLog10
    + Math.round((clamped - WORLD_SCALE_CONTROL.minLog10) / WORLD_SCALE_CONTROL.step)
      * WORLD_SCALE_CONTROL.step;
  return Number(stepped.toFixed(WORLD_SCALE_LOG_DECIMALS));
}

function worldScaleToSliderValue(scale) {
  const numeric = Number(scale);
  if (!(Number.isFinite(numeric) && numeric > 0)) {
    return null;
  }
  return normalizeWorldScaleLogValue(Math.log10(numeric));
}

function sliderValueToWorldScale(value) {
  const logValue = normalizeWorldScaleLogValue(value);
  if (logValue == null) {
    return null;
  }
  return Number((10 ** logValue).toPrecision(4));
}

function normalizeWorldScale(value) {
  const sliderValue = worldScaleToSliderValue(value);
  return sliderValue == null ? null : sliderValueToWorldScale(sliderValue);
}

function formatWorldScaleValue(value) {
  if (!(Number.isFinite(value) && value > 0)) {
    return '-';
  }
  return `${value.toLocaleString('en-US', { maximumSignificantDigits: 4 })} m/pc`;
}

function formatWorldScaleSliderValue(value) {
  return formatWorldScaleValue(sliderValueToWorldScale(value));
}

function computeXrDepthTelemetry(snapshot = null, options = {}) {
  const metersPerParsec = Number.isFinite(options.starFieldScale) && options.starFieldScale > 0
    ? Number(options.starFieldScale)
    : DEFAULT_METERS_PER_PARSEC;

  return computeXrDepthRange({
    near: XR_NEAR_PLANE,
    metersPerParsec,
    selection: snapshot?.selection ?? null,
    observerPc: snapshot?.state?.observerPc ?? null,
    includeConstellationSphere: true,
    constellationSphereRadiusPc: Math.max(
      options.includeConstellationSphere === true
        ? options.constellationSphereRadiusPc ?? XR_CONSTELLATION_SPHERE_RADIUS_PC
        : 0,
      H_ALPHA_XR_BOUND_RADIUS_PC,
    ),
    marginFactor: XR_DEPTH_MARGIN_FACTOR,
    minFar: XR_MIN_FAR_PLANE,
    maxFar: XR_MAX_FAR_PLANE,
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeExposureLogValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const clamped = clamp(
    numeric,
    EXPOSURE_CONTROL.minLog10,
    EXPOSURE_CONTROL.maxLog10,
  );
  const stepped = EXPOSURE_CONTROL.minLog10
    + Math.round((clamped - EXPOSURE_CONTROL.minLog10) / EXPOSURE_CONTROL.step) * EXPOSURE_CONTROL.step;
  return Number(stepped.toFixed(EXPOSURE_DECIMALS));
}

function exposureToSliderValue(exposure) {
  if (!(Number.isFinite(exposure) && exposure > 0)) {
    return null;
  }
  return normalizeExposureLogValue(Math.log10(exposure));
}

function sliderValueToExposure(value) {
  const logValue = normalizeExposureLogValue(value);
  if (logValue == null) {
    return null;
  }
  return Number((10 ** logValue).toPrecision(4));
}

function formatExposure(exposure) {
  if (!(Number.isFinite(exposure) && exposure > 0)) {
    return '-';
  }
  return exposure >= 1000
    ? Math.round(exposure).toLocaleString('en-US')
    : exposure.toFixed(1);
}

function formatExposureSliderValue(value) {
  return formatExposure(sliderValueToExposure(value));
}

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'phase-5b-xr-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'phase-5b-xr-free-roam',
  },
}));

let starFieldLayer = null;
let constellationArtLayer = null;
let constellationCompassControllerRef = null;
let viewer = null;
let tabletRef = null;
let pickControllerRef = null;
let xrLocomotionControllerRef = null;
let snapshotTimer = null;
let xrSupported = null;
let desktopShaderEnabled = true;
let artEnabled = true;
let activeMagLimit = normalizeMagLimit(magLimitInput?.value) ?? 7.5;
let activeStarFieldScale = normalizeWorldScale(DEFAULT_METERS_PER_PARSEC) ?? DEFAULT_METERS_PER_PARSEC;
let activeVrExposure = DEFAULT_XR_STAR_FIELD_STATE.starFieldExposure;
let activeDesktopExposure = DEFAULT_TUNED_EXPOSURE;
let nearDistanceFloorEnabled = true;
let pickGeneration = 0;
let lastPickedResult = null;
let pendingSelectionRefreshTimer = null;
let currentConstellationIau = null;
let currentTabletPage = 'home';
let xrDepthRangeTelemetry = null;
let hAlphaLayer = null;
let hAlphaStatus = 'idle';

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

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function buildGalaxyMapValue() {
  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  const selectedPc = lastPickedResult?.position ? sceneToIcrsPc(lastPickedResult.position) : null;
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

function createGalaxyMapControl() {
  return {
    getHeight() {
      return 190;
    },

    render(ctx, rect, item, _state, env) {
      const { theme } = env;
      const data = item.value ?? {};
      const observer = data.observer ?? { x: 0, y: 0, z: 0 };
      const selected = data.selected ?? null;
      const radialSpanPc = Number.isFinite(data.radialSpanPc) && data.radialSpanPc > 0 ? data.radialSpanPc : 1;
      const radialTicksPc = Array.isArray(data.radialTicksPc) ? data.radialTicksPc : [];
      const verticalHalfSpanPc = Number.isFinite(data.verticalHalfSpanPc) && data.verticalHalfSpanPc > 0
        ? data.verticalHalfSpanPc
        : 1;

      const topX = rect.x + 22;
      const topY = rect.y + 18;
      const topW = rect.w - 44;
      const topH = 100;
      const sideX = rect.x + 22;
      const sideY = rect.y + 128;
      const sideW = rect.w - 44;
      const sideH = 38;

      ctx.fillStyle = theme.itemBg;
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 2;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      ctx.fillStyle = theme.accent;
      ctx.font = 'bold 12px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('GALACTIC MAP (TOP + HEIGHT)', rect.x + 16, rect.y + 8);

      const centerX = topX + topW / 2;
      const baseY = topY + topH;
      const radius = Math.min(topW * 0.46, topH - 6);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1.2;

      for (const tick of radialTicksPc) {
        if (!(tick > 0)) continue;
        const t = clamp01(tick / radialSpanPc);
        const r = radius * t;
        ctx.beginPath();
        ctx.arc(centerX, baseY, r, Math.PI, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = theme.textDim;
      ctx.beginPath();
      ctx.moveTo(topX, baseY);
      ctx.lineTo(topX + topW, baseY);
      ctx.stroke();

      function drawTopMarker(point, color, fill = true) {
        if (!point) return;
        const radial = Math.hypot(point.x, point.z);
        const angle = Math.atan2(point.x, -point.z);
        const span = Math.PI * 0.98;
        const clampedAngle = clamp01((angle + span / 2) / span) * span - span / 2;
        const t = clamp01(radial / radialSpanPc);
        const px = centerX + Math.sin(clampedAngle) * radius * t;
        const py = baseY - Math.cos(clampedAngle) * radius * t;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        if (fill) {
          ctx.fillStyle = color;
          ctx.fill();
        } else {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      drawTopMarker(observer, '#44ff66');
      drawTopMarker(selected, '#ffcc66');

      ctx.strokeStyle = theme.border;
      ctx.strokeRect(sideX, sideY, sideW, sideH);

      function drawHeightMarker(point, color) {
        if (!point) return;
        const t = clamp01((point.y + verticalHalfSpanPc) / (verticalHalfSpanPc * 2));
        const px = sideX + t * sideW;
        const py = sideY + sideH / 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      drawHeightMarker(observer, '#44ff66');
      drawHeightMarker(selected, '#ffcc66');

      ctx.fillStyle = theme.textDim;
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`0..${Math.round(radialSpanPc).toLocaleString()} pc from galactic centre`, topX, topY + 12);
      ctx.fillText(`height ±${Math.round(verticalHalfSpanPc).toLocaleString()} pc`, sideX, sideY + sideH + 13);
    },
  };
}

function getNearDistanceFloorState() {
  return nearDistanceFloorEnabled
    ? {
      starFieldNearMagLimitFloor: XR_DESKTOP_NEAR_MAG_LIMIT_FLOOR,
      starFieldNearMagLimitRadiusPc: XR_DESKTOP_NEAR_MAG_LIMIT_RADIUS_PC,
      starFieldNearMagLimitFeatherPc: XR_DESKTOP_NEAR_MAG_LIMIT_FEATHER_PC,
      starFieldNearSizeFloor: XR_DESKTOP_NEAR_SIZE_FLOOR,
      starFieldNearAlphaFloor: XR_DESKTOP_NEAR_ALPHA_FLOOR,
    }
    : {
      starFieldNearMagLimitFloor: XR_DESKTOP_NEAR_MAG_LIMIT_FLOOR,
      starFieldNearMagLimitRadiusPc: 0,
      starFieldNearMagLimitFeatherPc: XR_DESKTOP_NEAR_MAG_LIMIT_FEATHER_PC,
      starFieldNearSizeFloor: 0,
      starFieldNearAlphaFloor: 0,
    };
}

function getActiveExposure() {
  return desktopShaderEnabled ? activeDesktopExposure : activeVrExposure;
}

function syncVisibilityControls() {
  if (magLimitInput) {
    magLimitInput.value = formatMagLimitValue(activeMagLimit);
  }
  tabletRef?.setItemValue('tuned-shader', desktopShaderEnabled);
  tabletRef?.setItemValue('world-scale', worldScaleToSliderValue(activeStarFieldScale));
  tabletRef?.setItemValue('mag-limit', activeMagLimit);
  tabletRef?.setItemValue('exposure', exposureToSliderValue(getActiveExposure()));
  tabletRef?.setItemValue('near-distance-floor', nearDistanceFloorEnabled);
  tabletRef?.setItemValue('constellation-art', artEnabled);
}

function syncWorldClipPlanes(snapshot = null) {
  const range = computeXrDepthTelemetry(snapshot, {
    starFieldScale: activeStarFieldScale,
    includeConstellationSphere: artEnabled,
  });
  xrDepthRangeTelemetry = range.telemetry;

  const camera = viewer?.camera ?? null;
  if (!camera) {
    return range.far;
  }

  camera.near = range.near;
  camera.far = range.far;
  camera.updateProjectionMatrix();

  const session = viewer?.runtime?.renderer?.xr?.getSession?.() ?? null;
  if (typeof session?.updateRenderState === 'function') {
    session.updateRenderState({
      depthNear: range.near,
      depthFar: range.far,
    });
  }

  return range.far;
}

function scheduleSelectionRefresh() {
  if (!viewer) {
    renderSnapshot();
    return;
  }

  if (pendingSelectionRefreshTimer != null) {
    window.clearTimeout(pendingSelectionRefreshTimer);
  }

  pendingSelectionRefreshTimer = window.setTimeout(() => {
    pendingSelectionRefreshTimer = null;
    viewer?.refreshSelection()
      .then(() => {
        renderSnapshot();
      })
      .catch((error) => {
        statusValue.textContent = 'error';
        snapshotValue.textContent = error.stack ?? error.message;
        console.error('[xr-free-roam-demo] mag limit update failed', error);
      });
  }, 120);
}

function applyVisibilityState(options = {}) {
  syncVisibilityControls();

  if (!viewer) {
    renderSnapshot();
    return;
  }

  viewer.setState({
    starFieldScale: activeStarFieldScale,
    mDesired: activeMagLimit,
    starFieldExposure: getActiveExposure(),
    ...getNearDistanceFloorState(),
  });
  syncWorldClipPlanes();
  renderSnapshot();

  if (options.refreshSelection) {
    scheduleSelectionRefresh();
  }
}

function syncConstellationArtVisibility() {
  if (!constellationArtLayer) {
    return;
  }
  if (!artEnabled) {
    constellationArtLayer.hideAll();
  } else if (currentConstellationIau) {
    constellationArtLayer.show(currentConstellationIau);
  }
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
    ...(Number.isFinite(options.maxSpeed) && options.maxSpeed > 0
      ? { maxSpeed: options.maxSpeed }
      : Number.isFinite(options.speed) && options.speed > 0
        ? { speed: options.speed }
        : {}),
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
  const snapshotState = viewer?.getSnapshotState?.()?.state;
  const observerPc = snapshotState?.observerPc;
  if (!observerPc || !targetPc) {
    return;
  }
  const starFieldScale = Number.isFinite(snapshotState?.starFieldScale) && snapshotState.starFieldScale > 0
    ? snapshotState.starFieldScale
    : DEFAULT_METERS_PER_PARSEC;
  const arrivalDistancePc = 0.25 / starFieldScale;
  const approachTarget = snapshotState?.observerOrientation
    ? approachTargetFromShipForward(targetPc, snapshotState.observerOrientation, arrivalDistancePc)
    : approachTargetFromObserver(targetPc, observerPc, arrivalDistancePc);
  flyToObserver(approachTarget, {
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

function updateTabletGalaxyMap() {
  if (!tabletRef || currentTabletPage !== 'home') {
    return;
  }
  tabletRef.setItemValue(GALAXY_MAP_CONTROL_ID, buildGalaxyMapValue());
}

function buildHomeMenuItems() {
  const items = [
    { id: 'page-rendering', label: 'Rendering', type: 'button' },
    { id: 'page-waypoints', label: 'Waypoints', type: 'button' },
    {
      id: GALAXY_MAP_CONTROL_ID,
      type: 'galaxy-map',
      value: buildGalaxyMapValue(),
    },
  ];
  if (lastPickedResult) {
    items.push({
      id: 'star-info',
      label: 'Selected Target',
      type: 'display',
      lines: [],
      dismissible: true,
      actionId: 'go-selected',
      actionLabel: 'Go to Selected',
    });
  }
  return items;
}

function buildRenderingMenuItems() {
  return [
    { id: 'back-home', label: '< Back', type: 'button' },
    { id: 'tuned-shader', label: 'Desktop Shader', type: 'toggle', value: desktopShaderEnabled },
    {
      id: 'world-scale',
      label: 'World Scale',
      type: 'range',
      value: worldScaleToSliderValue(activeStarFieldScale),
      min: WORLD_SCALE_CONTROL.minLog10,
      max: WORLD_SCALE_CONTROL.maxLog10,
      step: WORLD_SCALE_CONTROL.step,
      formatValue: formatWorldScaleSliderValue,
    },
    {
      id: 'mag-limit',
      label: 'Mag Limit',
      type: 'range',
      value: activeMagLimit,
      min: MAG_LIMIT_CONTROL.min,
      max: MAG_LIMIT_CONTROL.max,
      step: MAG_LIMIT_CONTROL.step,
      formatValue: formatMagLimitValue,
    },
    {
      id: 'exposure',
      label: 'Exposure',
      type: 'range',
      value: exposureToSliderValue(getActiveExposure()),
      min: EXPOSURE_CONTROL.minLog10,
      max: EXPOSURE_CONTROL.maxLog10,
      step: EXPOSURE_CONTROL.step,
      formatValue: formatExposureSliderValue,
    },
    { id: 'near-distance-floor', label: 'Near 1pc floor', type: 'toggle', value: nearDistanceFloorEnabled },
    { id: 'constellation-art', label: 'Constellation Art', type: 'toggle', value: artEnabled },
  ];
}

function buildWaypointMenuItems() {
  return [
    { id: 'back-home', label: '< Back', type: 'button' },
    ...WAYPOINTS.map((waypoint, index) => ({
      id: `wp-${index}`,
      label: waypoint.label,
      type: 'button',
    })),
  ];
}

function setTabletPage(pageId) {
  currentTabletPage = pageId;
  if (!tabletRef) {
    return;
  }

  if (pageId === 'rendering') {
    tabletRef.setItems(buildRenderingMenuItems());
    syncVisibilityControls();
    return;
  }
  if (pageId === 'waypoints') {
    tabletRef.setItems(buildWaypointMenuItems());
    return;
  }

  tabletRef.setItems(buildHomeMenuItems());
  updateTabletStarInfo(lastPickedResult);
  updateTabletGalaxyMap();
}

function handlePick(result) {
  pickGeneration += 1;
  const generation = pickGeneration;
  lastPickedResult = result ?? null;

  if (result) {
    delete result.sidecarFields;
  }
  renderPickInfo(result);
  if (currentTabletPage === 'home') {
    tabletRef?.setItems(buildHomeMenuItems());
  }
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
        if (currentTabletPage === 'home') {
          tabletRef?.setItems(buildHomeMenuItems());
        }
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
    desktopShaderEnabled,
    starFieldScale: activeStarFieldScale,
    xrDepthRange: xrDepthRangeTelemetry,
    mDesired: activeMagLimit,
    starFieldExposure: getActiveExposure(),
    artEnabled,
    hAlpha: hAlphaStatus,
    activeConstellationIau: currentConstellationIau,
    nearDistanceFloorEnabled,
    sharedDatasetSession: datasetDescription?.id ?? null,
    renderServiceStats: datasetDescription?.services?.render?.stats ?? null,
    viewer: summarizeViewer(snapshot),
  }, null, 2);
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  if (viewer) {
    syncWorldClipPlanes(snapshot);
  }
  const datasetDescription = datasetSession.describe();
  const presenting = snapshot?.xr?.presenting === true;

  statusValue.textContent = presenting
    ? 'xr-presenting'
    : viewer?.runtime?.running
      ? 'running'
      : 'idle';
  renderSummary(snapshot, datasetDescription);
  if (lastPickedResult) {
    renderPickInfo(lastPickedResult);
    updateTabletStarInfo(lastPickedResult);
  }
  updateTabletGalaxyMap();

  snapshotValue.textContent = JSON.stringify({
    xrSupported,
    desktopShaderEnabled,
    starFieldScale: activeStarFieldScale,
    xrDepthRange: xrDepthRangeTelemetry,
    mDesired: activeMagLimit,
    starFieldExposure: getActiveExposure(),
    artEnabled,
    hAlpha: hAlphaStatus,
    activeConstellationIau: currentConstellationIau,
    nearDistanceFloorEnabled,
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
  hAlphaStatus = `loading ${H_ALPHA_XR_VOLUME_URL}`;
  renderSnapshot();

  const camera = createViewerCamera();
  const xrRig = createXrRig(camera, {
    starFieldScale: activeStarFieldScale,
  });
  xrRig.deck.add(createShipDeckSlab());
  const vrProfile = createVrStarFieldMaterialProfile();
  const tunedProfile = createTunedStarFieldMaterialProfile({
    scale: DEFAULT_METERS_PER_PARSEC,
  });
  const manifest = await loadConstellationArtManifest({ manifestUrl: DEFAULT_ART_MANIFEST_URL });

  starFieldLayer = createStarFieldLayer({
    id: 'phase-5b-vr-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    materialFactory: () => createTunedStarFieldMaterialProfile({
      scale: DEFAULT_METERS_PER_PARSEC,
    }),
    includePickMeta: true,
  });
  constellationArtLayer = createConstellationArtLayer({
    id: 'phase-5b-xr-constellation-art-layer',
    manifest,
    manifestUrl: DEFAULT_ART_MANIFEST_URL,
    transformDirection: ORION_SCENE_TRANSFORM,
  });
  hAlphaLayer = createHaTiledVolumeLayer({
    id: 'phase-5b-h-alpha-volume-layer',
    manifestUrl: H_ALPHA_XR_VOLUME_URL,
    initialLevelId: H_ALPHA_XR_LEVEL_IDS.initialLevelId,
    finalLevelId: H_ALPHA_XR_LEVEL_IDS.finalLevelId,
    volumeToSceneTransform: galacticToXrScene,
    sceneToVolumeTransform: sceneToGalacticPc,
    raymarchSteps: H_ALPHA_XR_RAYMARCH_STEPS,
    gain: H_ALPHA_XR_GAIN,
    threshold: H_ALPHA_XR_THRESHOLD,
    opacity: H_ALPHA_XR_OPACITY,
    onStatus: (status) => {
      hAlphaStatus = status;
      renderSnapshot();
    },
    onError: (error) => {
      hAlphaStatus = `unavailable: ${error?.message ?? 'unknown error'}`;
      console.warn('[xr-free-roam-demo] H-alpha tiled volume failed', error);
      renderSnapshot();
    },
  });

  const constellationCompassController = createConstellationCompassController({
    id: 'phase-5b-xr-constellation-compass-controller',
    manifest,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    onConstellationIn(payload) {
      currentConstellationIau = payload.iau ?? null;
      if (artEnabled && currentConstellationIau) {
        constellationArtLayer?.show(currentConstellationIau);
      }
      renderSnapshot();
    },
    onConstellationOut(payload) {
      constellationArtLayer?.hide(payload.iau);
      if (payload.iau === currentConstellationIau) {
        currentConstellationIau = null;
      }
      renderSnapshot();
    },
  });
  constellationCompassControllerRef = constellationCompassController;

  const xrLocomotionController = createXrLocomotionController({
    id: 'phase-5b-xr-locomotion-controller',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    sceneScale: 1.0,
    moveSpeed: 4.0,
    flyAcceleration: 6,
    flyDeceleration: 8,
  });
  xrLocomotionControllerRef = xrLocomotionController;

  const xrTabletController = createXrTabletController({
    id: 'phase-5b-xr-tablet-controller',
    items: buildHomeMenuItems(),
    displayOptions: {
      controls: {
        'galaxy-map': createGalaxyMapControl(),
      },
    },
    onChange(id, value) {
      if (id === 'star-info') {
        pickControllerRef?.clearSelection();
        handlePick(null);
      }
      if (id === 'go-selected') {
        goToPickedStar(lastPickedResult);
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
      if (id === 'tuned-shader') {
        desktopShaderEnabled = value === true;
        if (desktopShaderEnabled) {
          starFieldLayer.setMaterialProfile(nonDisposable(tunedProfile));
        } else {
          starFieldLayer.setMaterialProfile(nonDisposable(vrProfile));
        }
        applyVisibilityState();
      }
      if (id === 'mag-limit') {
        const nextValue = normalizeMagLimit(value);
        if (nextValue != null) {
          activeMagLimit = nextValue;
          applyVisibilityState({ refreshSelection: true });
        }
      }
      if (id === 'world-scale') {
        const nextValue = sliderValueToWorldScale(value);
        if (nextValue != null) {
          activeStarFieldScale = nextValue;
          applyVisibilityState();
        }
      }
      if (id === 'exposure') {
        const nextExposure = sliderValueToExposure(value);
        if (nextExposure != null) {
          if (desktopShaderEnabled) {
            activeDesktopExposure = nextExposure;
          } else {
            activeVrExposure = nextExposure;
          }
          applyVisibilityState();
        }
      }
      if (id === 'near-distance-floor') {
        nearDistanceFloorEnabled = value === true;
        applyVisibilityState();
      }
      if (id === 'constellation-art') {
        artEnabled = value === true;
        syncConstellationArtVisibility();
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
  tabletRef = xrTabletController;
  syncVisibilityControls();

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
      constellationCompassController,
      xrTabletController,
      xrPickController,
    ],
    layers: [starFieldLayer, constellationArtLayer, hAlphaLayer],
    state: {
      ...DEFAULT_XR_STAR_FIELD_STATE,
      demo: 'phase-5b-xr-free-roam',
      observerPc: { x: 0, y: 0, z: 0 },
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
      starFieldScale: activeStarFieldScale,
      mDesired: activeMagLimit,
      ...getNearDistanceFloorState(),
    },
    clearColor: 0x02040b,
  });

  syncWorldClipPlanes();
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
    far: computeXrDepthTelemetry(null, {
      starFieldScale: activeStarFieldScale,
      includeConstellationSphere: artEnabled,
    }).far,
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
  const parsed = normalizeMagLimit(magLimitInput.value);
  if (parsed == null) {
    magLimitInput.value = formatMagLimitValue(activeMagLimit);
    return;
  }

  activeMagLimit = parsed;
  applyVisibilityState({ refreshSelection: true });
});

window.addEventListener('beforeunload', () => {
  if (pendingSelectionRefreshTimer != null) {
    window.clearTimeout(pendingSelectionRefreshTimer);
  }
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
