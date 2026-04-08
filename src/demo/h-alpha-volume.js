import * as THREE from 'three';
import {
  createHaVolumeBrickTexture,
  getHaVolumeNodeBounds,
  loadHaVolume,
  resolveHaVolumeUrl,
  selectHaVolumeNodes,
} from '../dust/load-ha-volume.js';
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

const H_ALPHA_BRICK_RAYMARCH_STEPS = 48;
const DEFAULT_GAIN = 3.2;
const DEFAULT_THRESHOLD = 0.02;
const DEFAULT_OPACITY = 0.85;
const TARGET_CELL_PIXELS = 4.0;
const VIEW_CONE_MARGIN_RADIANS = THREE.MathUtils.degToRad(8);
const MAX_TRAVERSAL_NODES = 8192;
// V1 rule: cache is a hard budget, not an eviction pool. Keep this below the
// point where progressive refinement can churn its own parent fallbacks.
const MAX_RENDER_BRICKS = 192;
const MAX_REQUEST_BRICKS_PER_UPDATE = 12;
const MAX_RESIDENT_BRICKS = 512;
const SELECTION_INTERVAL_MS = 180;

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
    for (int i = 0; i < ${H_ALPHA_BRICK_RAYMARCH_STEPS}; i++) {
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

function createBrickPlacement(bounds) {
  const extX = (bounds.maxX - bounds.minX) * SCALE;
  const extY = (bounds.maxY - bounds.minY) * SCALE;
  const extZ = (bounds.maxZ - bounds.minZ) * SCALE;
  const cenGalX = (bounds.minX + bounds.maxX) / 2;
  const cenGalY = (bounds.minY + bounds.maxY) / 2;
  const cenGalZ = (bounds.minZ + bounds.maxZ) / 2;
  const basisX = galacticToVolumeScene(1, 0, 0).map((v) => v / SCALE);
  const basisY = galacticToVolumeScene(0, 1, 0).map((v) => v / SCALE);
  const basisZ = galacticToVolumeScene(0, 0, 1).map((v) => v / SCALE);
  const [cx, cy, cz] = galacticToVolumeScene(cenGalX, cenGalY, cenGalZ);

  const rotBasis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...basisX).normalize(),
    new THREE.Vector3(...basisY).normalize(),
    new THREE.Vector3(...basisZ).normalize(),
  );
  return {
    boxSize: new THREE.Vector3(extX, extY, extZ),
    position: new THREE.Vector3(cx, cy, cz),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(rotBasis),
  };
}

function buildBrickMesh(service, node, brickData) {
  const bounds = getHaVolumeNodeBounds(service.volume, node);
  const placement = createBrickPlacement(bounds);
  const texture = createHaVolumeBrickTexture(brickData, service.volume.brickSize);
  const referenceLengthPc = Math.max(
    service.volume.manifest.world_extent_pc.x,
    service.volume.manifest.world_extent_pc.y,
    service.volume.manifest.world_extent_pc.z,
  );
  const geometry = new THREE.BoxGeometry(
    placement.boxSize.x,
    placement.boxSize.y,
    placement.boxSize.z,
  );
  const invModelMatrix = new THREE.Matrix4();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uVolume: { value: texture },
      uGain: { value: volumeState.gain },
      uThreshold: { value: volumeState.threshold },
      uOpacity: { value: volumeState.opacity },
      uSteps: { value: H_ALPHA_BRICK_RAYMARCH_STEPS },
      uInvModelMatrix: { value: invModelMatrix },
      uBoxSize: { value: placement.boxSize },
      uSceneScale: { value: SCALE },
      uReferenceLengthPc: { value: referenceLengthPc },
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
  mesh.userData.haNodeIndex = node.index;
  mesh.userData.haTexture = texture;
  mesh.onBeforeRender = () => {
    invModelMatrix.copy(mesh.matrixWorld).invert();
  };
  return mesh;
}

function disposeBrickMesh(mesh) {
  mesh.geometry?.dispose?.();
  mesh.material?.uniforms?.uVolume?.value?.dispose?.();
  mesh.material?.dispose?.();
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

function formatExtentInfo(manifest) {
  const extent = manifest.world_extent_pc;
  const leafDim = manifest.lod?.pooled_leaf_dimension ?? 1;
  return {
    extents: `${extent.x.toFixed(0)} x ${extent.y.toFixed(0)} x ${extent.z.toFixed(0)}`,
    cellSize: `${(extent.x / leafDim).toFixed(2)} x ${(extent.y / leafDim).toFixed(2)} x ${(extent.z / leafDim).toFixed(2)}`,
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

const activeVolumeUrl = resolveHaVolumeUrl();
const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'h-alpha-volume-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'h-alpha-volume',
  },
}));

let viewer = null;
let camera = null;
let volumeService = null;
let volumeGroup = null;
let selectionTimer = null;
let updateQueued = false;
let lastSelection = { renderNodes: [], requestNodes: [], visited: 0 };
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value))
  ? Number(magLimitInput.value)
  : 7.5;
const brickMeshes = new Map();
const scratchCameraPosition = new THREE.Vector3();
const scratchCameraGalacticPc = { x: 0, y: 0, z: 0 };
const scratchCameraForwardScene = new THREE.Vector3();
const scratchCameraForwardGalactic = { x: 0, y: 0, z: -1 };
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
  if (!volumeService) return;
  const { manifest, index } = volumeService.volume;
  const extentInfo = formatExtentInfo(manifest);
  const description = volumeService.describe();
  if (gridSpan) gridSpan.textContent = `${manifest.lod?.pooled_leaf_dimension ?? '?'}^3 pooled · ${index.nodeCount} nodes`;
  if (extentsSpan) extentsSpan.textContent = extentInfo.extents;
  if (cellSizeSpan) cellSizeSpan.textContent = extentInfo.cellSize;
  if (formatSpan) formatSpan.textContent = `${manifest.format}/${manifest.runtime_frame}`;
  if (selectedSpan) selectedSpan.textContent = String(lastSelection.renderNodes.length);
  if (renderedSpan) renderedSpan.textContent = String(brickMeshes.size);
  if (cachedSpan) cachedSpan.textContent = String(description.cachedBricks);
  if (inflightSpan) inflightSpan.textContent = String(description.inflightBricks);
  if (requestedSpan) {
    requestedSpan.textContent = `${description.stats.bricksRequested} (${volumeService.availableRequestSlots} slots)`;
  }
}

function applyVolumeUniforms() {
  for (const mesh of brickMeshes.values()) {
    mesh.material.uniforms.uGain.value = volumeState.gain;
    mesh.material.uniforms.uThreshold.value = volumeState.threshold;
    mesh.material.uniforms.uOpacity.value = volumeState.opacity;
  }
  viewer?.runtime?.renderOnce?.();
}

function updateCameraGalacticPose() {
  camera.getWorldPosition(scratchCameraPosition);
  const [ixScene, iyScene, izScene] = SCENE_TO_ICRS(
    scratchCameraPosition.x,
    scratchCameraPosition.y,
    scratchCameraPosition.z,
  );
  const [gx, gy, gz] = icrsToGalactic(
    ixScene / SCALE,
    iyScene / SCALE,
    izScene / SCALE,
  );
  scratchCameraGalacticPc.x = gx;
  scratchCameraGalacticPc.y = gy;
  scratchCameraGalacticPc.z = gz;

  camera.getWorldDirection(scratchCameraForwardScene);
  const [fix, fiy, fiz] = SCENE_TO_ICRS(
    scratchCameraForwardScene.x,
    scratchCameraForwardScene.y,
    scratchCameraForwardScene.z,
  );
  const [fgx, fgy, fgz] = icrsToGalactic(fix, fiy, fiz);
  const fLen = Math.hypot(fgx, fgy, fgz) || 1;
  scratchCameraForwardGalactic.x = fgx / fLen;
  scratchCameraForwardGalactic.y = fgy / fLen;
  scratchCameraForwardGalactic.z = fgz / fLen;
}

function distancePcToNodeBounds(node) {
  const bounds = getHaVolumeNodeBounds(volumeService.volume, node);
  const dx = scratchCameraGalacticPc.x < bounds.minX
    ? bounds.minX - scratchCameraGalacticPc.x
    : Math.max(0, scratchCameraGalacticPc.x - bounds.maxX);
  const dy = scratchCameraGalacticPc.y < bounds.minY
    ? bounds.minY - scratchCameraGalacticPc.y
    : Math.max(0, scratchCameraGalacticPc.y - bounds.maxY);
  const dz = scratchCameraGalacticPc.z < bounds.minZ
    ? bounds.minZ - scratchCameraGalacticPc.z
    : Math.max(0, scratchCameraGalacticPc.z - bounds.maxZ);
  return Math.hypot(dx, dy, dz);
}

function nodeCenterAndRadiusPc(node) {
  const bounds = getHaVolumeNodeBounds(volumeService.volume, node);
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;
  const cz = (bounds.minZ + bounds.maxZ) * 0.5;
  const sx = bounds.maxX - bounds.minX;
  const sy = bounds.maxY - bounds.minY;
  const sz = bounds.maxZ - bounds.minZ;
  return {
    x: cx,
    y: cy,
    z: cz,
    radius: 0.5 * Math.hypot(sx, sy, sz),
  };
}

function angularDistanceToNode(node) {
  const center = nodeCenterAndRadiusPc(node);
  const vx = center.x - scratchCameraGalacticPc.x;
  const vy = center.y - scratchCameraGalacticPc.y;
  const vz = center.z - scratchCameraGalacticPc.z;
  const distanceToCenter = Math.hypot(vx, vy, vz);
  if (distanceToCenter <= center.radius) return 0;

  const dot = (
    (vx * scratchCameraForwardGalactic.x)
    + (vy * scratchCameraForwardGalactic.y)
    + (vz * scratchCameraForwardGalactic.z)
  ) / distanceToCenter;
  const centerAngle = Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
  const angularRadius = Math.asin(
    THREE.MathUtils.clamp(center.radius / distanceToCenter, 0, 1),
  );
  return Math.max(0, centerAngle - angularRadius);
}

function viewConeHalfAngle() {
  const verticalHalf = THREE.MathUtils.degToRad(camera.fov) * 0.5;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * (camera.aspect || 1));
  return Math.hypot(verticalHalf, horizontalHalf) + VIEW_CONE_MARGIN_RADIANS;
}

function isNodeInViewCone(node) {
  if (node.index === 0) return true;
  return angularDistanceToNode(node) <= viewConeHalfAngle();
}

function nodeDistancePriority(node) {
  return -(angularDistanceToNode(node) * 10000 + distancePcToNodeBounds(node));
}

function targetLevelForNode(node) {
  if (!volumeService) return 0;
  const distancePc = distancePcToNodeBounds(node);
  if (distancePc <= 0) {
    return volumeService.volume.maxDepth;
  }

  const manifest = volumeService.volume.manifest;
  const worldExtentPc = Math.max(
    manifest.world_extent_pc.x,
    manifest.world_extent_pc.y,
    manifest.world_extent_pc.z,
  );
  const viewportHeight = mount?.clientHeight || window.innerHeight || 800;
  const fovRadians = THREE.MathUtils.degToRad(camera.fov);
  const focalDenom = 2 * Math.tan(fovRadians / 2) * distancePc;

  for (let level = volumeService.volume.maxDepth; level >= 0; level -= 1) {
    const cellPc = worldExtentPc / ((2 ** level) * volumeService.volume.brickSize);
    const projectedCellPixels = (cellPc / focalDenom) * viewportHeight;
    if (projectedCellPixels >= TARGET_CELL_PIXELS) {
      return level;
    }
  }

  return 0;
}

function scheduleVolumeUpdate() {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => {
    updateQueued = false;
    updateVisibleBricks();
  });
}

function updateVisibleBricks() {
  if (!viewer || !volumeGroup || !volumeService) return;
  const requestBudget = Math.min(
    MAX_REQUEST_BRICKS_PER_UPDATE,
    volumeService.availableRequestSlots,
  );
  camera.updateMatrixWorld();
  updateCameraGalacticPose();
  lastSelection = selectHaVolumeNodes(volumeService.volume, {
    isBrickReady: (node) => volumeService.hasDecodedBrick(node)
      || brickMeshes.has(node.index),
    canRequestNode: (node) => volumeService.canRequestBrick(node),
    isNodeVisible: isNodeInViewCone,
    nodePriority: nodeDistancePriority,
    targetLevelForNode,
    maxRenderBricks: MAX_RENDER_BRICKS,
    maxRequestBricks: requestBudget,
    maxTraversalNodes: MAX_TRAVERSAL_NODES,
  });

  const pending = volumeService.requestBricks(lastSelection.requestNodes);
  for (const promise of pending) {
    promise.then(scheduleVolumeUpdate).catch((error) => {
      console.error('[h-alpha-volume] brick request failed', error);
    });
  }

  const visible = new Set();
  for (const node of lastSelection.renderNodes) {
    const brickData = volumeService.getDecodedBrick(node);
    if (!brickData) continue;
    visible.add(node.index);
    if (!brickMeshes.has(node.index)) {
      const mesh = buildBrickMesh(volumeService, node, brickData);
      brickMeshes.set(node.index, mesh);
      volumeGroup.add(mesh);
    }
  }

  for (const [nodeIndex, mesh] of brickMeshes.entries()) {
    if (!visible.has(nodeIndex)) {
      volumeGroup.remove(mesh);
      disposeBrickMesh(mesh);
      brickMeshes.delete(nodeIndex);
    }
  }

  renderStats();
  if (statusValue) {
    statusValue.textContent = brickMeshes.size > 0 ? 'running' : 'streaming root brick';
  }
  viewer.runtime?.renderOnce?.();
}

async function warmDatasetSession() {
  await datasetSession.ensureRenderRootShard();
  return datasetSession.ensureRenderBootstrap();
}

async function mountViewer() {
  if (viewer) return viewer;

  if (statusValue) statusValue.textContent = 'loading sparse volume';
  const [service] = await Promise.all([
    loadHaVolume(activeVolumeUrl, { maxResidentBricks: MAX_RESIDENT_BRICKS }),
    warmDatasetSession(),
  ]);
  volumeService = service;
  renderStats();

  const cameraController = createCameraRigController({
    id: 'h-alpha-volume-camera-rig',
    icrsToSceneTransform: ICRS_TO_SCENE,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });
  const fullscreen = createFullscreenPreset();
  camera = createViewerCamera();

  viewer = await createViewer(mount, {
    datasetSession,
    camera,
    interestField: createObserverShellField({
      id: 'h-alpha-volume-field',
      note: 'H-alpha sparse volume observer shell.',
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

  volumeGroup = new THREE.Group();
  viewer.contentRoot.add(volumeGroup);
  selectionTimer = window.setInterval(scheduleVolumeUpdate, SELECTION_INTERVAL_MS);
  scheduleVolumeUpdate();
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
  if (selectionTimer) {
    window.clearInterval(selectionTimer);
  }
  for (const mesh of brickMeshes.values()) {
    disposeBrickMesh(mesh);
  }
  viewer?.dispose().catch((error) => {
    console.error('[h-alpha-volume] cleanup failed', error);
  });
});

renderControls();
renderStats();
mountViewer().catch((error) => {
  if (statusValue) statusValue.textContent = 'error';
  console.error(
    `[h-alpha-volume] failed to load ${activeVolumeUrl}. Generate it with pipeline-dust build-volume or pass ?haVolumeUrl=...`,
    error,
  );
});
