import * as THREE from 'three';
import {
  loadHaPreviewVolume,
  resolveHaPreviewUrl,
} from '../dust/load-ha-preview-volume.js';
import {
  createCameraRigController,
  createDefaultStarFieldMaterialProfile,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createHud,
  createObserverShellField,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import {
  createDistanceReadout,
  createFlyToAction,
  createLookAtAction,
  createSpeedReadout,
} from '../presets/navigation-presets.js';
import { createFullscreenPreset } from '../presets/fullscreen-preset.js';
import { SCALE } from '../services/octree/scene-scale.js';

const H_ALPHA_RAYMARCH_STEPS = 96;
const DEFAULT_GAIN = 3.0;
const DEFAULT_THRESHOLD = 0.02;
const DEFAULT_OPACITY = 0.85;

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

function galacticToPreviewScene(gx, gy, gz) {
  const [ix, iy, iz] = galacticToIcrs(gx, gy, gz);
  return ICRS_TO_SCENE(ix * SCALE, iy * SCALE, iz * SCALE);
}

const volumeVertexShader = /* glsl */ `
  out vec3 vWorldPos;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const volumeFragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform float uGain;
  uniform float uThreshold;
  uniform float uOpacity;
  uniform int uSteps;
  uniform mat4 uInvModelMatrix;
  uniform vec3 uBoxSize;
  uniform float uSceneScale;
  uniform float uReferenceLengthPc;

  in vec3 vWorldPos;
  out vec4 fragColor;

  void main() {
    vec3 localPos = (uInvModelMatrix * vec4(vWorldPos, 1.0)).xyz;
    vec3 localCam = (uInvModelMatrix * vec4(cameraPosition, 1.0)).xyz;
    vec3 rayDir = normalize(localPos - localCam);
    vec3 safeDir = mix(vec3(1e-5), rayDir, step(vec3(1e-5), abs(rayDir)));

    vec3 halfSize = uBoxSize * 0.5;
    vec3 tMin = (-halfSize - localCam) / safeDir;
    vec3 tMax = ( halfSize - localCam) / safeDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);

    if (tNear > tFar) discard;
    tNear = max(tNear, 0.0);

    float stepSize = (tFar - tNear) / float(uSteps);
    float stepSizePc = stepSize / max(uSceneScale, 1e-9);
    if (stepSize <= 0.0 || stepSizePc <= 0.0) discard;

    float emission = 0.0;
    for (int i = 0; i < ${H_ALPHA_RAYMARCH_STEPS}; i++) {
      if (i >= uSteps) break;

      float t = tNear + (float(i) + 0.5) * stepSize;
      vec3 pos = localCam + rayDir * t;
      vec3 uvw = pos / uBoxSize + 0.5;
      float raw = texture(uVolume, uvw).r;
      emission += max(raw - uThreshold, 0.0) * stepSizePc;
    }

    float signal = 1.0 - exp(-emission * uGain / max(uReferenceLengthPc, 1e-6));
    if (signal <= 0.002) discard;

    vec3 dim = vec3(0.50, 0.03, 0.015);
    vec3 hot = vec3(1.0, 0.42, 0.12);
    vec3 color = mix(dim, hot, smoothstep(0.02, 0.75, signal));
    float alpha = clamp(signal * uOpacity, 0.0, 0.9);
    fragColor = vec4(color * signal * uOpacity, alpha);
  }
`;

function createPreviewPlacement(voxelInfo) {
  const {
    nx,
    ny,
    nz,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
  } = voxelInfo;

  const dx = (maxX - minX) / (nx - 1);
  const dy = (maxY - minY) / (ny - 1);
  const dz = (maxZ - minZ) / (nz - 1);
  const extX = (maxX - minX + dx) * SCALE;
  const extY = (maxY - minY + dy) * SCALE;
  const extZ = (maxZ - minZ + dz) * SCALE;

  const cenGalX = (minX + maxX) / 2;
  const cenGalY = (minY + maxY) / 2;
  const cenGalZ = (minZ + maxZ) / 2;
  const basisX = galacticToPreviewScene(1, 0, 0).map((v) => v / SCALE);
  const basisY = galacticToPreviewScene(0, 1, 0).map((v) => v / SCALE);
  const basisZ = galacticToPreviewScene(0, 0, 1).map((v) => v / SCALE);
  const [cx, cy, cz] = galacticToPreviewScene(cenGalX, cenGalY, cenGalZ);

  const rotBasis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...basisX).normalize(),
    new THREE.Vector3(...basisY).normalize(),
    new THREE.Vector3(...basisZ).normalize(),
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotBasis);
  const position = new THREE.Vector3(cx, cy, cz);
  const boxSize = new THREE.Vector3(extX, extY, extZ);

  return { boxSize, position, quaternion };
}

function buildVolumeMesh(voxelInfo) {
  const placement = createPreviewPlacement(voxelInfo);
  const geometry = new THREE.BoxGeometry(
    placement.boxSize.x,
    placement.boxSize.y,
    placement.boxSize.z,
  );
  const invModelMatrix = new THREE.Matrix4();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uVolume: { value: voxelInfo.texture },
      uGain: { value: previewState.gain },
      uThreshold: { value: previewState.threshold },
      uOpacity: { value: previewState.opacity },
      uSteps: { value: H_ALPHA_RAYMARCH_STEPS },
      uInvModelMatrix: { value: invModelMatrix },
      uBoxSize: { value: placement.boxSize },
      uSceneScale: { value: SCALE },
      uReferenceLengthPc: {
        value: Math.max(
          placement.boxSize.x,
          placement.boxSize.y,
          placement.boxSize.z,
        ) / SCALE,
      },
    },
    vertexShader: volumeVertexShader,
    fragmentShader: volumeFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    glslVersion: THREE.GLSL3,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(placement.position);
  mesh.quaternion.copy(placement.quaternion);
  mesh.onBeforeRender = () => {
    invModelMatrix.copy(mesh.matrixWorld).invert();
  };
  return mesh;
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function formatExtentInfo(voxelInfo) {
  const dx = (voxelInfo.maxX - voxelInfo.minX) / Math.max(1, voxelInfo.nx - 1);
  const dy = (voxelInfo.maxY - voxelInfo.minY) / Math.max(1, voxelInfo.ny - 1);
  const dz = (voxelInfo.maxZ - voxelInfo.minZ) / Math.max(1, voxelInfo.nz - 1);
  return {
    extents: `${(voxelInfo.maxX - voxelInfo.minX + dx).toFixed(0)} x ${(voxelInfo.maxY - voxelInfo.minY + dy).toFixed(0)} x ${(voxelInfo.maxZ - voxelInfo.minZ + dz).toFixed(0)}`,
    cellSize: `${dx.toFixed(1)} x ${dy.toFixed(1)} x ${dz.toFixed(1)}`,
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

const activePreviewUrl = resolveHaPreviewUrl();
const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'h-alpha-preview-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'h-alpha-preview',
  },
}));

let viewer = null;
let volumeMesh = null;
let activeVoxelInfo = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value))
  ? Number(magLimitInput.value)
  : 7.5;
const previewState = {
  gain: Number(gainInput?.value) || DEFAULT_GAIN,
  threshold: Number(thresholdInput?.value) || DEFAULT_THRESHOLD,
  opacity: Number(opacityInput?.value) || DEFAULT_OPACITY,
};

function renderControls() {
  if (gainValue) gainValue.textContent = previewState.gain.toFixed(1);
  if (thresholdValue) thresholdValue.textContent = previewState.threshold.toFixed(3);
  if (opacityValue) opacityValue.textContent = previewState.opacity.toFixed(2);
}

function renderStats() {
  if (urlSpan) urlSpan.textContent = activePreviewUrl;
  if (!activeVoxelInfo) return;
  const extentInfo = formatExtentInfo(activeVoxelInfo);
  if (gridSpan) gridSpan.textContent = `${activeVoxelInfo.nx}x${activeVoxelInfo.ny}x${activeVoxelInfo.nz}`;
  if (extentsSpan) extentsSpan.textContent = extentInfo.extents;
  if (cellSizeSpan) cellSizeSpan.textContent = extentInfo.cellSize;
  if (formatSpan) formatSpan.textContent = `${activeVoxelInfo.format}/${activeVoxelInfo.frame}`;
}

function applyPreviewUniforms() {
  if (!volumeMesh) return;
  volumeMesh.material.uniforms.uGain.value = previewState.gain;
  volumeMesh.material.uniforms.uThreshold.value = previewState.threshold;
  volumeMesh.material.uniforms.uOpacity.value = previewState.opacity;
  viewer?.runtime?.renderOnce?.();
}

async function warmDatasetSession() {
  await datasetSession.ensureRenderRootShard();
  return datasetSession.ensureRenderBootstrap();
}

async function mountViewer() {
  if (viewer) return viewer;

  if (statusValue) statusValue.textContent = 'loading preview volume';
  const [voxelInfo] = await Promise.all([
    loadHaPreviewVolume(activePreviewUrl),
    warmDatasetSession(),
  ]);
  activeVoxelInfo = voxelInfo;
  renderStats();

  const cameraController = createCameraRigController({
    id: 'h-alpha-preview-camera-rig',
    icrsToSceneTransform: ICRS_TO_SCENE,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });
  const fullscreen = createFullscreenPreset();

  viewer = await createViewer(mount, {
    datasetSession,
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'h-alpha-preview-field',
      note: 'H-alpha preview observer shell.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'h-alpha-preview-selection-refresh',
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
        id: 'h-alpha-preview-star-field',
        positionTransform: ICRS_TO_SCENE,
        materialFactory: () => createDefaultStarFieldMaterialProfile(),
      }),
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'h-alpha-preview',
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  volumeMesh = buildVolumeMesh(voxelInfo);
  viewer.contentRoot.add(volumeMesh);
  applyPreviewUniforms();
  if (statusValue) statusValue.textContent = 'running';
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
    console.error('[h-alpha-preview] mag limit update failed', error);
  });
});

gainInput?.addEventListener('input', () => {
  previewState.gain = Number(gainInput.value) || DEFAULT_GAIN;
  renderControls();
  applyPreviewUniforms();
});

thresholdInput?.addEventListener('input', () => {
  previewState.threshold = Number(thresholdInput.value) || 0.0;
  renderControls();
  applyPreviewUniforms();
});

opacityInput?.addEventListener('input', () => {
  previewState.opacity = Number(opacityInput.value) || DEFAULT_OPACITY;
  renderControls();
  applyPreviewUniforms();
});

window.addEventListener('beforeunload', () => {
  viewer?.dispose().catch((error) => {
    console.error('[h-alpha-preview] cleanup failed', error);
  });
});

renderControls();
renderStats();
mountViewer().catch((error) => {
  if (statusValue) statusValue.textContent = 'error';
  console.error(
    `[h-alpha-preview] failed to load ${activePreviewUrl}. Generate it with pipeline-dust build-preview or pass ?haUrl=...`,
    error,
  );
});
