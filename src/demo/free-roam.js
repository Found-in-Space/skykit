import * as THREE from 'three';
import { loadDustMapNgVolume } from '../dust/load-dust-map-ng.js';
import { DEFAULT_DUST_MAP_NG_URL } from '../found-in-space-dataset.js';
import {
  buildSimbadBasicSearch,
  createCameraRigController,
  createConstellationCompassController,
  createDefaultStarFieldMaterialProfile,
  createConstellationArtLayer,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createHud,
  createObserverShellField,
  createPickController,
  loadConstellationArtManifest,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  DEFAULT_PICK_TOLERANCE_DEG,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  formatDistancePc,
  getDatasetSession,
  SCALE,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import { createSpeedReadout, createDistanceReadout, createFlyToAction, createLookAtAction } from '../presets/navigation-presets.js';
import { createFullscreenPreset } from '../presets/fullscreen-preset.js';

const DEFAULT_ART_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';
const DUST_VOLUME_RAYMARCH_STEPS = 64;
const DUST_STAR_MAX_STEPS = 16;
const DUST_MODE_ABSORPTIVE = 'absorptive';
const DUST_MODE_EXTINCTION_MAP = 'extinction-map';
const MILKY_WAY_RV = 3.1;
const NH_PER_EBV_CM2 = 5.8e21;
const NH_PER_AV_CM2 = NH_PER_EBV_CM2 / MILKY_WAY_RV;
const PC_TO_CM = 3.085677581e18;
const AV_TO_TAU = Math.LN10 / 2.5;
const DUST_AV_PER_CM3_PC = PC_TO_CM / NH_PER_AV_CM2;
const DEFAULT_DUST_AV_SCALE = 0.01;
const DEFAULT_EXTINCTION_MAP_GAIN = 0.5;

const GALACTIC_TO_ICRS_ROTATION = [
  [-0.0548755604, +0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, +0.7469822445, +0.4559837762],
];

const {
  icrsToScene: ORION_SCENE_TRANSFORM,
  sceneToIcrs: ORION_SCENE_TO_ICRS_TRANSFORM,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

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

function galacticToDustScene(gx, gy, gz) {
  const [ix, iy, iz] = galacticToIcrs(gx, gy, gz);
  return ORION_SCENE_TRANSFORM(ix * SCALE, iy * SCALE, iz * SCALE);
}

function computeVisibleBandAvRatio(lambdaMicron, rv = MILKY_WAY_RV) {
  const x = 1 / lambdaMicron;
  if (!(x >= 1.1 && x <= 3.3)) {
    throw new RangeError(`O'Donnell extinction law expects 0.303-0.909 um, got ${lambdaMicron}`);
  }
  const y = x - 1.82;
  const a = 1
    + 0.104 * y
    - 0.609 * y ** 2
    + 0.701 * y ** 3
    + 1.137 * y ** 4
    - 1.718 * y ** 5
    - 0.827 * y ** 6
    + 1.647 * y ** 7
    - 0.505 * y ** 8;
  const b = 1.952 * y
    + 2.908 * y ** 2
    - 3.989 * y ** 3
    - 7.985 * y ** 4
    + 11.102 * y ** 5
    + 5.491 * y ** 6
    - 10.805 * y ** 7
    + 3.347 * y ** 8;
  return a + b / rv;
}

const VISIBLE_CHANNEL_AV_RATIOS = new THREE.Vector3(
  computeVisibleBandAvRatio(0.64),
  computeVisibleBandAvRatio(0.55),
  computeVisibleBandAvRatio(0.44),
);

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function sceneToIcrsPc(pos) {
  const [ix, iy, iz] = ORION_SCENE_TO_ICRS_TRANSFORM(pos.x, pos.y, pos.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

function fmt(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '—';
}

function scoreLabel(score) {
  if (score < 1) return '<span class="pick-score inside">inside disk</span>';
  if (score < 2) return '<span class="pick-score near">near</span>';
  return '<span class="pick-score edge">edge</span>';
}

function pickConstellationName(constellation) {
  return constellation?.name
    ?? constellation?.commonName
    ?? constellation?.englishName
    ?? constellation?.id
    ?? constellation?.iau
    ?? 'Unknown';
}

function pickConstellationDescription(constellation) {
  return constellation?.description
    ?? constellation?.story
    ?? constellation?.summary
    ?? 'No description provided in this art manifest.';
}

function formatDegrees(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(2)}°`;
}

function summarizeViewer(snapshot) {
  if (!snapshot) {
    return null;
  }

  const starLayerPart = snapshot.parts.find((part) => part.kind === 'layer' && part.stats?.starCount != null);
  const freeRoamPart = snapshot.parts.find((part) => part.id === 'phase-5-camera-rig-controller');
  const refreshPart = snapshot.parts.find((part) => part.id === 'phase-5-selection-refresh-controller');

  return {
    field: snapshot.selection?.strategy ?? null,
    observerPc: clonePoint(snapshot.state?.observerPc),
    targetPc: clonePoint(snapshot.state?.targetPc),
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starLayerPart?.stats?.nodeCount ?? null,
    renderedStars: starLayerPart?.stats?.starCount ?? null,
    freeRoam: freeRoamPart?.stats ?? null,
    selectionRefresh: refreshPart?.stats ?? null,
  };
}

function summarizePickResult(result) {
  if (!result) {
    return null;
  }

  return {
    index: result.index,
    score: Number.isFinite(result.score) ? +result.score.toFixed(3) : null,
    distancePc: Number.isFinite(result.distancePc) ? +result.distancePc.toFixed(2) : null,
    apparentMagnitude: Number.isFinite(result.apparentMagnitude) ? +result.apparentMagnitude.toFixed(2) : null,
    dustAv: Number.isFinite(result.dustAv) ? +result.dustAv.toFixed(3) : null,
    apparentMagnitudeAfterDust: Number.isFinite(result.apparentMagnitudeAfterDust)
      ? +result.apparentMagnitudeAfterDust.toFixed(3)
      : null,
    angularDistanceDeg: Number.isFinite(result.angularDistanceDeg) ? +result.angularDistanceDeg.toFixed(3) : null,
    sidecarFields: result.sidecarFields ?? null,
  };
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

const dustExtinctionShaderChunk = /* glsl */ `
  const float DUST_AV_PER_CM3_PC = ${DUST_AV_PER_CM3_PC.toFixed(12)};
  const float AV_TO_TAU = ${AV_TO_TAU.toFixed(12)};

  float sampleDustAv(float rawDensity, float dustMaxDensity, float avScale, float stepSizePc) {
    float densityCm3 = rawDensity * dustMaxDensity;
    return densityCm3 * DUST_AV_PER_CM3_PC * avScale * stepSizePc;
  }

  vec3 avToTransmission(float av, vec3 avToRgb) {
    return exp(-AV_TO_TAU * av * avToRgb);
  }
`;

const dustVisualizationShaderChunk = /* glsl */ `
  vec3 extinctionMapColor(float av) {
    float n = 1.0 - exp(-av * 0.85);
    vec3 c0 = vec3(0.10, 0.16, 0.30);
    vec3 c1 = vec3(0.24, 0.55, 0.88);
    vec3 c2 = vec3(0.95, 0.80, 0.24);
    vec3 c3 = vec3(0.82, 0.29, 0.16);
    if (n < 0.35) return mix(c0, c1, n / 0.35);
    if (n < 0.7) return mix(c1, c2, (n - 0.35) / 0.35);
    return mix(c2, c3, (n - 0.7) / 0.3);
  }
`;

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
  uniform float uDustMaxDensity;
  uniform float uDustAvScale;
  uniform float uMapGain;
  uniform int uSteps;
  uniform mat4 uInvModelMatrix;
  uniform vec3 uBoxSize;
  uniform float uSceneScale;
  uniform vec3 uDustAvToRgb;

  in vec3 vWorldPos;
  out vec4 fragColor;

  ${dustExtinctionShaderChunk}
  ${dustVisualizationShaderChunk}

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

    float avColumn = 0.0;
    for (int i = 0; i < ${DUST_VOLUME_RAYMARCH_STEPS}; i++) {
      if (i >= uSteps) break;
      float t = tNear + (float(i) + 0.5) * stepSize;
      vec3 pos = localCam + rayDir * t;
      vec3 uvw = pos / uBoxSize + 0.5;
      float raw = texture(uVolume, uvw).r;
      if (raw > 0.0) {
        avColumn += sampleDustAv(raw, uDustMaxDensity, uDustAvScale, stepSizePc);
      }
    }

    if (avColumn <= 1e-5) discard;
    vec3 displayColor = extinctionMapColor(avColumn);
    float alpha = clamp((1.0 - exp(-avColumn * 1.15)) * uMapGain, 0.0, 0.9);
    alpha *= smoothstep(0.01, 0.05, avColumn);
    fragColor = vec4(displayColor, alpha);
  }
`;

function createDustPlacement(voxelInfo) {
  const { nx, ny, nz, minX, maxX, minY, maxY, minZ, maxZ } = voxelInfo;
  const dx = (maxX - minX) / (nx - 1);
  const dy = (maxY - minY) / (ny - 1);
  const dz = (maxZ - minZ) / (nz - 1);
  const extX = (maxX - minX + dx) * SCALE;
  const extY = (maxY - minY + dy) * SCALE;
  const extZ = (maxZ - minZ + dz) * SCALE;
  const cenGalX = (minX + maxX) / 2;
  const cenGalY = (minY + maxY) / 2;
  const cenGalZ = (minZ + maxZ) / 2;
  const basisX = galacticToDustScene(1, 0, 0).map((v) => v / SCALE);
  const basisY = galacticToDustScene(0, 1, 0).map((v) => v / SCALE);
  const basisZ = galacticToDustScene(0, 0, 1).map((v) => v / SCALE);
  const [cx, cy, cz] = galacticToDustScene(cenGalX, cenGalY, cenGalZ);
  const rotBasis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...basisX).normalize(),
    new THREE.Vector3(...basisY).normalize(),
    new THREE.Vector3(...basisZ).normalize(),
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotBasis);
  const position = new THREE.Vector3(cx, cy, cz);
  const boxSize = new THREE.Vector3(extX, extY, extZ);
  const modelMatrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  return { boxSize, position, quaternion, invModelMatrix: modelMatrix.clone().invert() };
}

function createDustExtinctionStarFieldMaterialProfile(options = {}) {
  const fallbackInvDustModelMatrix = options.invDustModelMatrix?.clone?.() ?? new THREE.Matrix4();
  const scratchInvDustMatrix = new THREE.Matrix4();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBaseSize: { value: options.baseSize ?? DEFAULT_STAR_FIELD_STATE.starFieldBaseSize },
      uSizeMax: { value: options.sizeMax ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeMax },
      uSizeFluxScale: { value: options.sizeFluxScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeFluxScale },
      uSizeScale: { value: options.sizeScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeScale },
      uSizePower: { value: options.sizePower ?? DEFAULT_STAR_FIELD_STATE.starFieldSizePower },
      uScale: { value: options.scale ?? SCALE },
      uMagLimit: { value: options.magLimit ?? DEFAULT_STAR_FIELD_STATE.mDesired },
      uMagFadeRange: { value: options.magFadeRange ?? DEFAULT_STAR_FIELD_STATE.starFieldMagFadeRange },
      uExtinctionScale: { value: options.extinctionScale ?? DEFAULT_STAR_FIELD_STATE.starFieldExtinctionScale },
      uExposure: { value: options.exposure ?? DEFAULT_STAR_FIELD_STATE.starFieldExposure },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) },
      uDustVolume: { value: options.texture ?? null },
      uDustMaxDensity: { value: options.maxDensity ?? 1.0 },
      uDustInvModelMatrix: { value: fallbackInvDustModelMatrix },
      uDustBoxSize: { value: options.boxSize ?? new THREE.Vector3(1, 1, 1) },
      uDustAvScale: { value: options.getAvScale?.() ?? 1.0 },
      uDustAvToRgb: { value: options.avToRgb?.clone?.() ?? VISIBLE_CHANNEL_AV_RATIOS.clone() },
    },
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      in float teff_log8;
      in float magAbs;

      out vec3 vColor;
      out float vAlpha;
      out float vWhiteMix;

      uniform float uBaseSize;
      uniform float uSizeMax;
      uniform float uSizeFluxScale;
      uniform float uSizeScale;
      uniform float uSizePower;
      uniform float uScale;
      uniform float uMagLimit;
      uniform float uMagFadeRange;
      uniform float uExtinctionScale;
      uniform float uExposure;
      uniform vec3 uCameraPosition;
      uniform sampler3D uDustVolume;
      uniform float uDustMaxDensity;
      uniform mat4 uDustInvModelMatrix;
      uniform vec3 uDustBoxSize;
      uniform float uDustAvScale;
      uniform vec3 uDustAvToRgb;

      ${dustExtinctionShaderChunk}

      float decodeTemperature(float log8) {
        if (log8 >= 0.996) return 5800.0;
        return 2000.0 * pow(25.0, log8);
      }

      vec3 blackbodyToRGB(float temp) {
        float t = clamp(temp, 1000.0, 40000.0) / 100.0;
        vec3 c;
        if (t <= 66.0) c.r = 255.0;
        else c.r = 329.698727446 * pow(t - 60.0, -0.1332047592);
        if (t <= 66.0) c.g = 99.4708025861 * log(t) - 161.119568166;
        else c.g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
        if (t >= 66.0) c.b = 255.0;
        else if (t <= 19.0) c.b = 0.0;
        else c.b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
        return clamp(c / 255.0, 0.0, 1.0);
      }

      float fluxSignal(float flux, float power) {
        return max(pow(1.0 + max(flux, 0.0), power) - 1.0, 0.0);
      }

      float brightnessSignal(float displayFlux) {
        return max(log(1.0 + max(displayFlux, 0.0)) / log(2.0), 0.0);
      }

      float computeDustAv(vec3 startWorld, vec3 endWorld) {
        vec3 localStart = (uDustInvModelMatrix * vec4(startWorld, 1.0)).xyz;
        vec3 localEnd = (uDustInvModelMatrix * vec4(endWorld, 1.0)).xyz;
        vec3 segment = localEnd - localStart;
        float segmentLength = length(segment);
        if (segmentLength <= 1e-5) return 0.0;
        vec3 rayDir = segment / segmentLength;
        vec3 safeDir = mix(vec3(1e-5), rayDir, step(vec3(1e-5), abs(rayDir)));
        vec3 halfSize = uDustBoxSize * 0.5;
        vec3 tMin = (-halfSize - localStart) / safeDir;
        vec3 tMax = ( halfSize - localStart) / safeDir;
        vec3 t1 = min(tMin, tMax);
        vec3 t2 = max(tMin, tMax);
        float tNear = max(max(t1.x, t1.y), t1.z);
        float tFar = min(min(t2.x, t2.y), t2.z);
        tNear = max(tNear, 0.0);
        tFar = min(tFar, segmentLength);
        if (tNear >= tFar) return 0.0;
        float stepSizePc = (tFar - tNear) / float(${DUST_STAR_MAX_STEPS}) / uScale;
        float av = 0.0;
        for (int i = 0; i < ${DUST_STAR_MAX_STEPS}; i++) {
          float t = tNear + (float(i) + 0.5) * (tFar - tNear) / float(${DUST_STAR_MAX_STEPS});
          vec3 pos = localStart + rayDir * t;
          vec3 uvw = pos / uDustBoxSize + 0.5;
          float raw = texture(uDustVolume, uvw).r;
          if (raw > 0.0) {
            av += sampleDustAv(raw, uDustMaxDensity, uDustAvScale, stepSizePc);
          }
        }
        return av;
      }

      void main() {
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        float d = length(worldPos - uCameraPosition);
        float dPc = max(d / uScale, 0.001);
        float mApp = magAbs + uExtinctionScale * (5.0 * log(dPc) / log(10.0) - 5.0);
        float av = computeDustAv(uCameraPosition, worldPos);
        vec3 transmittance = avToTransmission(av, uDustAvToRgb);
        float brightnessTransmittance = dot(transmittance, vec3(0.2126, 0.7152, 0.0722));
        float apparentFlux = pow(10.0, -0.4 * mApp) * brightnessTransmittance;
        float displayFlux = apparentFlux * uExposure;

        vColor = blackbodyToRGB(decodeTemperature(teff_log8)) * transmittance;
        float sizeSignal = fluxSignal(apparentFlux * max(uSizeFluxScale, 0.0), uSizePower);
        gl_PointSize = clamp(uBaseSize + uSizeScale * sizeSignal, 0.0, uSizeMax);

        float fade = 1.0 - smoothstep(uMagLimit - uMagFadeRange, uMagLimit, mApp);
        float alphaSignal = 1.0 - exp(-0.25 * brightnessSignal(displayFlux));
        vAlpha = fade * mix(0.18, 1.0, alphaSignal);
        vWhiteMix = clamp(0.2 + 0.12 * brightnessSignal(displayFlux), 0.0, 0.95);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      in vec3 vColor;
      in float vAlpha;
      in float vWhiteMix;
      out vec4 fragColor;

      void main() {
        if (vAlpha <= 0.0) discard;
        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;
        float core = exp(-dist * 18.0);
        float halo = exp(-dist * 6.0) * 0.45;
        vec3 finalColor = mix(vColor, vec3(1.0), core * vWhiteMix);
        float starAlpha = min(halo + core, 1.0) * vAlpha;
        if (starAlpha < 0.003) discard;
        fragColor = vec4(finalColor, starAlpha);
      }
    `,
    transparent: true,
    alphaTest: 0.003,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  function syncUniforms(state) {
    material.uniforms.uScale.value = Number.isFinite(state.starFieldScale) ? state.starFieldScale : options.scale ?? SCALE;
    material.uniforms.uExtinctionScale.value = Number.isFinite(state.starFieldExtinctionScale) ? state.starFieldExtinctionScale : options.extinctionScale ?? 1.0;
    material.uniforms.uMagLimit.value = Number.isFinite(state.mDesired) ? state.mDesired : options.magLimit ?? DEFAULT_STAR_FIELD_STATE.mDesired;
    material.uniforms.uMagFadeRange.value = Number.isFinite(state.starFieldMagFadeRange) ? state.starFieldMagFadeRange : options.magFadeRange ?? DEFAULT_STAR_FIELD_STATE.starFieldMagFadeRange;
    material.uniforms.uExposure.value = Number.isFinite(state.starFieldExposure) ? state.starFieldExposure : options.exposure ?? DEFAULT_STAR_FIELD_STATE.starFieldExposure;
    material.uniforms.uBaseSize.value = Number.isFinite(state.starFieldBaseSize) ? state.starFieldBaseSize : options.baseSize ?? DEFAULT_STAR_FIELD_STATE.starFieldBaseSize;
    material.uniforms.uSizeMax.value = Number.isFinite(state.starFieldSizeMax) ? state.starFieldSizeMax : options.sizeMax ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeMax;
    material.uniforms.uSizeFluxScale.value = Number.isFinite(state.starFieldSizeFluxScale) ? state.starFieldSizeFluxScale : options.sizeFluxScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeFluxScale;
    material.uniforms.uSizeScale.value = Number.isFinite(state.starFieldSizeScale) ? state.starFieldSizeScale : options.sizeScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeScale;
    material.uniforms.uSizePower.value = Number.isFinite(state.starFieldSizePower) ? state.starFieldSizePower : options.sizePower ?? DEFAULT_STAR_FIELD_STATE.starFieldSizePower;
  }

  return {
    material,
    updateUniforms(context = {}) {
      const { cameraWorldPosition = null, state = {} } = context;
      if (cameraWorldPosition) {
        material.uniforms.uCameraPosition.value.copy(cameraWorldPosition);
      }
      const liveDustMesh = options.getDustMesh?.();
      if (liveDustMesh?.matrixWorld) {
        scratchInvDustMatrix.copy(liveDustMesh.matrixWorld).invert();
        material.uniforms.uDustInvModelMatrix.value.copy(scratchInvDustMatrix);
      } else {
        material.uniforms.uDustInvModelMatrix.value.copy(fallbackInvDustModelMatrix);
      }
      material.uniforms.uDustAvScale.value = options.getAvScale?.() ?? 1.0;
      syncUniforms(state);
    },
    dispose() {
      material.dispose();
    },
  };
}

function buildVolumeMesh(voxelInfo, dustState) {
  const { texture, maxDensity } = voxelInfo;
  const placement = createDustPlacement(voxelInfo);
  const geo = new THREE.BoxGeometry(placement.boxSize.x, placement.boxSize.y, placement.boxSize.z);
  const invModelMatrix = new THREE.Matrix4();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uVolume: { value: texture },
      uDustMaxDensity: { value: maxDensity },
      uDustAvScale: { value: dustState.avScale },
      uMapGain: { value: dustState.mapGain },
      uSteps: { value: DUST_VOLUME_RAYMARCH_STEPS },
      uInvModelMatrix: { value: invModelMatrix },
      uBoxSize: { value: placement.boxSize },
      uSceneScale: { value: SCALE },
      uDustAvToRgb: { value: VISIBLE_CHANNEL_AV_RATIOS.clone() },
    },
    vertexShader: volumeVertexShader,
    fragmentShader: volumeFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    glslVersion: THREE.GLSL3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(placement.position);
  mesh.quaternion.copy(placement.quaternion);
  invModelMatrix.copy(placement.invModelMatrix);
  mesh.onBeforeRender = () => {
    invModelMatrix.copy(mesh.matrixWorld).invert();
  };
  return mesh;
}

function buildGalacticPlaneGuide(voxelInfo, visible = false) {
  if (voxelInfo.frame !== 'galactic') return null;
  const placement = createDustPlacement(voxelInfo);
  const guide = new THREE.Group();
  guide.position.copy(placement.position);
  guide.quaternion.copy(placement.quaternion);
  guide.visible = visible;
  const planeGeometry = new THREE.PlaneGeometry(placement.boxSize.x, placement.boxSize.y, 1, 1);
  guide.add(new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({
    color: 0x3f7cff,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  })));
  guide.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(planeGeometry),
    new THREE.LineBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.7 }),
  ));
  return guide;
}

function formatDustExtentInfo(voxelInfo) {
  const dx = (voxelInfo.maxX - voxelInfo.minX) / Math.max(1, voxelInfo.nx - 1);
  const dy = (voxelInfo.maxY - voxelInfo.minY) / Math.max(1, voxelInfo.ny - 1);
  const dz = (voxelInfo.maxZ - voxelInfo.minZ) / Math.max(1, voxelInfo.nz - 1);
  return {
    extents: `${(voxelInfo.maxX - voxelInfo.minX + dx).toFixed(0)} x ${(voxelInfo.maxY - voxelInfo.minY + dy).toFixed(0)} x ${(voxelInfo.maxZ - voxelInfo.minZ + dz).toFixed(0)}`,
    cellSize: `${dx.toFixed(0)} x ${dy.toFixed(0)} x ${dz.toFixed(0)}`,
  };
}

const _dustLocalStart = new THREE.Vector3();
const _dustLocalEnd = new THREE.Vector3();
const _dustSegment = new THREE.Vector3();
const _dustRayDir = new THREE.Vector3();
const _dustPos = new THREE.Vector3();
const _dustHalfSize = new THREE.Vector3();
const _dustCameraWorld = new THREE.Vector3();
const _dustObserverWorld = new THREE.Vector3();
const _dustTMin = new THREE.Vector3();
const _dustTMax = new THREE.Vector3();
const _dustT1 = new THREE.Vector3();
const _dustT2 = new THREE.Vector3();
const _dustSafeDir = new THREE.Vector3();

function sampleDustRawTrilinear(voxelInfo, uvw) {
  const x = THREE.MathUtils.clamp(uvw.x, 0, 1) * (voxelInfo.nx - 1);
  const y = THREE.MathUtils.clamp(uvw.y, 0, 1) * (voxelInfo.ny - 1);
  const z = THREE.MathUtils.clamp(uvw.z, 0, 1) * (voxelInfo.nz - 1);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, voxelInfo.nx - 1);
  const y1 = Math.min(y0 + 1, voxelInfo.ny - 1);
  const z1 = Math.min(z0 + 1, voxelInfo.nz - 1);

  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const strideX = 1;
  const strideY = voxelInfo.nx;
  const strideZ = voxelInfo.nx * voxelInfo.ny;
  const data = voxelInfo.u8;

  const sample = (ix, iy, iz) => data[iz * strideZ + iy * strideY + ix * strideX] / 255;

  const c000 = sample(x0, y0, z0);
  const c100 = sample(x1, y0, z0);
  const c010 = sample(x0, y1, z0);
  const c110 = sample(x1, y1, z0);
  const c001 = sample(x0, y0, z1);
  const c101 = sample(x1, y0, z1);
  const c011 = sample(x0, y1, z1);
  const c111 = sample(x1, y1, z1);

  const c00 = c000 + (c100 - c000) * tx;
  const c10 = c010 + (c110 - c010) * tx;
  const c01 = c001 + (c101 - c001) * tx;
  const c11 = c011 + (c111 - c011) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}

function computeDustAvBetweenWorldPoints(startWorld, endWorld, voxelInfo, invDustMatrix, avScale) {
  if (!voxelInfo?.u8 || !invDustMatrix || !(avScale > 0)) return 0;

  _dustLocalStart.copy(startWorld).applyMatrix4(invDustMatrix);
  _dustLocalEnd.copy(endWorld).applyMatrix4(invDustMatrix);
  _dustSegment.subVectors(_dustLocalEnd, _dustLocalStart);
  const segmentLength = _dustSegment.length();
  if (!(segmentLength > 1e-5)) return 0;

  _dustRayDir.copy(_dustSegment).multiplyScalar(1 / segmentLength);
  _dustSafeDir.set(
    Math.abs(_dustRayDir.x) >= 1e-5 ? _dustRayDir.x : 1e-5,
    Math.abs(_dustRayDir.y) >= 1e-5 ? _dustRayDir.y : 1e-5,
    Math.abs(_dustRayDir.z) >= 1e-5 ? _dustRayDir.z : 1e-5,
  );

  const placement = createDustPlacement(voxelInfo);
  _dustHalfSize.copy(placement.boxSize).multiplyScalar(0.5);

  _dustTMin.set(
    (-_dustHalfSize.x - _dustLocalStart.x) / _dustSafeDir.x,
    (-_dustHalfSize.y - _dustLocalStart.y) / _dustSafeDir.y,
    (-_dustHalfSize.z - _dustLocalStart.z) / _dustSafeDir.z,
  );
  _dustTMax.set(
    (_dustHalfSize.x - _dustLocalStart.x) / _dustSafeDir.x,
    (_dustHalfSize.y - _dustLocalStart.y) / _dustSafeDir.y,
    (_dustHalfSize.z - _dustLocalStart.z) / _dustSafeDir.z,
  );
  _dustT1.set(
    Math.min(_dustTMin.x, _dustTMax.x),
    Math.min(_dustTMin.y, _dustTMax.y),
    Math.min(_dustTMin.z, _dustTMax.z),
  );
  _dustT2.set(
    Math.max(_dustTMin.x, _dustTMax.x),
    Math.max(_dustTMin.y, _dustTMax.y),
    Math.max(_dustTMin.z, _dustTMax.z),
  );

  const tNear = Math.max(_dustT1.x, _dustT1.y, _dustT1.z, 0);
  const tFar = Math.min(_dustT2.x, _dustT2.y, _dustT2.z, segmentLength);
  if (!(tNear < tFar)) return 0;

  const stepSizePc = (tFar - tNear) / DUST_STAR_MAX_STEPS / SCALE;
  let av = 0;
  for (let i = 0; i < DUST_STAR_MAX_STEPS; i += 1) {
    const t = tNear + (i + 0.5) * (tFar - tNear) / DUST_STAR_MAX_STEPS;
    _dustPos.copy(_dustLocalStart).addScaledVector(_dustRayDir, t);
    const uvw = {
      x: _dustPos.x / placement.boxSize.x + 0.5,
      y: _dustPos.y / placement.boxSize.y + 0.5,
      z: _dustPos.z / placement.boxSize.z + 0.5,
    };
    const raw = sampleDustRawTrilinear(voxelInfo, uvw);
    if (raw > 0) {
      av += raw * voxelInfo.maxDensity * DUST_AV_PER_CM3_PC * avScale * stepSizePc;
    }
  }
  return av;
}

function observerPcToSceneWorld(observerPc) {
  const [sx, sy, sz] = ORION_SCENE_TRANSFORM(
    observerPc.x * SCALE,
    observerPc.y * SCALE,
    observerPc.z * SCALE,
  );
  return _dustObserverWorld.set(sx, sy, sz);
}

const mount = document.querySelector('[data-skykit-viewer-root]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const fovInput = document.querySelector('[data-fov-deg]');
const hysteresisInput = document.querySelector('[data-hysteresis-secs]');
const artFadeInput = document.querySelector('[data-art-fade-secs]');
const artOpacityInput = document.querySelector('[data-art-opacity]');
const exposureInput = document.querySelector('[data-star-exposure]');
const extinctionInput = document.querySelector('[data-star-extinction-scale]');
const fadeRangeInput = document.querySelector('[data-star-fade-range]');
const baseSizeInput = document.querySelector('[data-star-base-size]');
const sizeScaleInput = document.querySelector('[data-star-size-scale]');
const sizePowerInput = document.querySelector('[data-star-size-power]');
const glowScaleInput = document.querySelector('[data-star-glow-scale]');
const glowPowerInput = document.querySelector('[data-star-glow-power]');
const dustEnabledInput = document.querySelector('[data-dust-enabled]');
const dustModeSelect = document.querySelector('[data-dust-render-mode]');
const dustAvScaleInput = document.querySelector('[data-dust-av-scale]');
const dustMapGainInput = document.querySelector('[data-dust-map-gain]');
const showGalacticPlaneInput = document.querySelector('[data-show-galactic-plane]');
const dustStatusValue = document.querySelector('[data-dust-status]');
const dustGridInfoValue = document.querySelector('[data-dust-grid-info]');
const dustGridExtentsValue = document.querySelector('[data-dust-grid-extents]');
const dustCellSizeValue = document.querySelector('[data-dust-cell-size]');
const dustDensityMaxValue = document.querySelector('[data-dust-density-max]');
const toleranceInput = document.querySelector('[data-pick-tolerance]');
const pickInfoEl = document.querySelector('[data-pick-info]');
const constellationIauValue = document.querySelector('[data-constellation-iau]');
const constellationNameValue = document.querySelector('[data-constellation-name]');
const constellationRaValue = document.querySelector('[data-constellation-ra]');
const constellationDecValue = document.querySelector('[data-constellation-dec]');
const constellationDescValue = document.querySelector('[data-constellation-desc]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'phase-5-free-roam-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'phase-5-free-roam',
  },
}));

let viewer = null;
let starFieldLayer = null;
let pickControllerRef = null;
let constellationArtLayer = null;
let constellationCompassController = null;
let constellationInfoByIau = new Map();
let currentConstellationIau = null;
let currentConstellationName = null;
let artEnabled = true;
let dustEnabled = false;
let dustLoadPromise = null;
let activeVoxelInfo = null;
let volumeMesh = null;
let galacticPlaneGuide = null;
let pickUi = null;
let lastPickResult = null;
let pickGeneration = 0;
let snapshotTimer = null;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 7.5;
let activeFovDeg = Number.isFinite(Number(fovInput?.value)) ? Number(fovInput.value) : 60;
let activeHysteresisSecs = Number.isFinite(Number(hysteresisInput?.value)) ? Number(hysteresisInput.value) : 0.2;
let activeArtFadeSecs = Number.isFinite(Number(artFadeInput?.value)) ? Number(artFadeInput.value) : 0.4;
let activeArtOpacity = Number.isFinite(Number(artOpacityInput?.value)) ? Number(artOpacityInput.value) : 0.3;
let activeStarFieldState = {
  starFieldExposure: Number.isFinite(Number(exposureInput?.value))
    ? Math.exp(Number(exposureInput.value))
    : DEFAULT_STAR_FIELD_STATE.starFieldExposure,
  starFieldExtinctionScale: Number.isFinite(Number(extinctionInput?.value))
    ? Number(extinctionInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldExtinctionScale,
  starFieldMagFadeRange: Number.isFinite(Number(fadeRangeInput?.value))
    ? Number(fadeRangeInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldMagFadeRange,
  starFieldBaseSize: Number.isFinite(Number(baseSizeInput?.value))
    ? Number(baseSizeInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldBaseSize,
  starFieldSizeScale: Number.isFinite(Number(sizeScaleInput?.value))
    ? Number(sizeScaleInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldSizeScale,
  starFieldSizePower: Number.isFinite(Number(sizePowerInput?.value))
    ? Number(sizePowerInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldSizePower,
  starFieldGlowScale: Number.isFinite(Number(glowScaleInput?.value))
    ? Number(glowScaleInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldGlowScale,
  starFieldGlowPower: Number.isFinite(Number(glowPowerInput?.value))
    ? Number(glowPowerInput.value)
    : DEFAULT_STAR_FIELD_STATE.starFieldGlowPower,
  starFieldSizeMax: DEFAULT_STAR_FIELD_STATE.starFieldSizeMax,
};
const dustRenderState = {
  mode: dustModeSelect?.value ?? DUST_MODE_ABSORPTIVE,
  avScale: Number(dustAvScaleInput?.value) || DEFAULT_DUST_AV_SCALE,
  mapGain: Number(dustMapGainInput?.value) || DEFAULT_EXTINCTION_MAP_GAIN,
};
let activeTolerance = DEFAULT_PICK_TOLERANCE_DEG;
let warmState = {
  bootstrap: 'idle',
  rootShard: 'idle',
  meta: 'idle',
};

function formatExposureReadout(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
}

function setReadout(name, value) {
  const el = document.querySelector(`[data-readout="${name}"]`);
  if (el) {
    el.textContent = value;
  }
}

function requestRender() {
  viewer?.runtime?.renderOnce?.();
}

function renderDustStats() {
  if (dustStatusValue) {
    dustStatusValue.textContent = dustEnabled
      ? activeVoxelInfo ? 'enabled' : 'loading'
      : activeVoxelInfo ? 'ready, off' : 'off';
  }
  if (!activeVoxelInfo) {
    if (dustGridInfoValue) dustGridInfoValue.textContent = '—';
    if (dustGridExtentsValue) dustGridExtentsValue.textContent = '—';
    if (dustCellSizeValue) dustCellSizeValue.textContent = '—';
    if (dustDensityMaxValue) dustDensityMaxValue.textContent = '—';
    return;
  }
  const extentInfo = formatDustExtentInfo(activeVoxelInfo);
  if (dustGridInfoValue) dustGridInfoValue.textContent = `${activeVoxelInfo.nx}x${activeVoxelInfo.ny}x${activeVoxelInfo.nz}`;
  if (dustGridExtentsValue) dustGridExtentsValue.textContent = extentInfo.extents;
  if (dustCellSizeValue) dustCellSizeValue.textContent = extentInfo.cellSize;
  if (dustDensityMaxValue) dustDensityMaxValue.textContent = activeVoxelInfo.maxDensity.toFixed(1);
}

function updatePickDustMetrics(result) {
  if (!result) {
    return;
  }

  if (!dustEnabled || !activeVoxelInfo) {
    delete result.dustAv;
    delete result.apparentMagnitudeAfterDust;
    return;
  }

  const observerPc = viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
  observerPcToSceneWorld(observerPc);
  _dustCameraWorld.copy(_dustObserverWorld);

  const invDustMatrix = volumeMesh?.matrixWorld
    ? volumeMesh.matrixWorld.clone().invert()
    : createDustPlacement(activeVoxelInfo).invModelMatrix;

  const dustAv = computeDustAvBetweenWorldPoints(
    _dustCameraWorld,
    new THREE.Vector3(result.position.x, result.position.y, result.position.z),
    activeVoxelInfo,
    invDustMatrix,
    dustRenderState.avScale,
  );

  result.dustAv = dustAv;
  result.apparentMagnitudeAfterDust = result.apparentMagnitude + dustAv;
}

function applyDustMode() {
  if (dustMapGainInput) {
    dustMapGainInput.disabled = dustRenderState.mode !== DUST_MODE_EXTINCTION_MAP;
  }
  if (volumeMesh) {
    volumeMesh.visible = dustEnabled && dustRenderState.mode === DUST_MODE_EXTINCTION_MAP;
    volumeMesh.material.uniforms.uDustAvScale.value = dustRenderState.avScale;
    volumeMesh.material.uniforms.uMapGain.value = dustRenderState.mapGain;
  }
  if (galacticPlaneGuide) {
    galacticPlaneGuide.visible = dustEnabled && Boolean(showGalacticPlaneInput?.checked);
  }
  renderDustStats();
  requestRender();
}

function createActiveDustStarFieldMaterialProfile() {
  if (!activeVoxelInfo) {
    return createDefaultStarFieldMaterialProfile();
  }
  const placement = createDustPlacement(activeVoxelInfo);
  return createDustExtinctionStarFieldMaterialProfile({
    texture: activeVoxelInfo.texture,
    maxDensity: activeVoxelInfo.maxDensity,
    boxSize: placement.boxSize,
    invDustModelMatrix: placement.invModelMatrix,
    getDustMesh: () => volumeMesh,
    getAvScale: () => dustRenderState.avScale,
    avToRgb: VISIBLE_CHANNEL_AV_RATIOS,
  });
}

async function ensureDustReady() {
  if (activeVoxelInfo) {
    return activeVoxelInfo;
  }
  if (!dustLoadPromise) {
    dustLoadPromise = loadDustMapNgVolume(DEFAULT_DUST_MAP_NG_URL)
      .then((voxelInfo) => {
        activeVoxelInfo = voxelInfo;
        if (viewer && !volumeMesh) {
          volumeMesh = buildVolumeMesh(voxelInfo, dustRenderState);
          viewer.contentRoot.add(volumeMesh);
          galacticPlaneGuide = buildGalacticPlaneGuide(voxelInfo, Boolean(showGalacticPlaneInput?.checked));
          if (galacticPlaneGuide) viewer.contentRoot.add(galacticPlaneGuide);
        }
        renderDustStats();
        return voxelInfo;
      })
      .finally(() => {
        dustLoadPromise = null;
      });
  }
  return dustLoadPromise;
}

async function setDustEnabled(nextEnabled) {
  dustEnabled = Boolean(nextEnabled);
  if (dustEnabledInput) {
    dustEnabledInput.checked = dustEnabled;
  }
  renderDustStats();

  if (dustEnabled) {
    await ensureDustReady();
    if (viewer && activeVoxelInfo && !volumeMesh) {
      volumeMesh = buildVolumeMesh(activeVoxelInfo, dustRenderState);
      viewer.contentRoot.add(volumeMesh);
      galacticPlaneGuide = buildGalacticPlaneGuide(activeVoxelInfo, Boolean(showGalacticPlaneInput?.checked));
      if (galacticPlaneGuide) viewer.contentRoot.add(galacticPlaneGuide);
    }
    starFieldLayer?.setMaterialProfile(createActiveDustStarFieldMaterialProfile());
  } else {
    starFieldLayer?.setMaterialProfile(createDefaultStarFieldMaterialProfile());
  }

  applyDustMode();
  updatePickDustMetrics(lastPickResult);
  renderPickInfo(lastPickResult);
  renderSnapshot();
}

function indexManifest(manifest) {
  const nextMap = new Map();
  for (const constellation of manifest?.constellations ?? []) {
    if (!constellation?.iau) {
      continue;
    }
    nextMap.set(constellation.iau, {
      iau: constellation.iau,
      name: pickConstellationName(constellation),
      description: pickConstellationDescription(constellation),
      id: constellation?.id ?? null,
    });
  }
  constellationInfoByIau = nextMap;
}

function setActiveConstellationPanel(data = null) {
  if (!data?.iau) {
    if (constellationIauValue) constellationIauValue.textContent = 'none';
    if (constellationNameValue) constellationNameValue.textContent = 'none';
    if (constellationRaValue) constellationRaValue.textContent = '—';
    if (constellationDecValue) constellationDecValue.textContent = '—';
    if (constellationDescValue) {
      constellationDescValue.textContent = 'No active constellation yet. Move the camera to trigger the compass.';
    }
    return;
  }

  const info = constellationInfoByIau.get(data.iau);
  if (constellationIauValue) constellationIauValue.textContent = data.iau;
  if (constellationNameValue) constellationNameValue.textContent = info?.name ?? data.id ?? data.iau;
  if (constellationRaValue) constellationRaValue.textContent = formatDegrees(data.raDeg);
  if (constellationDecValue) constellationDecValue.textContent = formatDegrees(data.decDeg);
  if (constellationDescValue) {
    constellationDescValue.textContent = info?.description ?? 'No description provided in this art manifest.';
  }
}

function syncConstellationPanelFromController() {
  const stats = constellationCompassController?.getStats?.();
  const activeIau = stats?.activeIau ?? null;
  if (!activeIau) {
    setActiveConstellationPanel(null);
    return;
  }
  setActiveConstellationPanel({
    iau: activeIau,
    id: constellationInfoByIau.get(activeIau)?.id ?? null,
    raDeg: stats?.raDeg ?? null,
    decDeg: stats?.decDeg ?? null,
  });
}

function bindPickUi() {
  if (pickUi || !pickInfoEl) {
    return pickUi;
  }

  pickUi = {
    empty: pickInfoEl.querySelector('[data-pick-empty]'),
    detail: pickInfoEl.querySelector('[data-pick-detail]'),
    timing: pickInfoEl.querySelector('[data-pick-timing]'),
    meta: {
      proper: pickInfoEl.querySelector('[data-pick-meta="proper"]'),
      bayer: pickInfoEl.querySelector('[data-pick-meta="bayer"]'),
      hd: pickInfoEl.querySelector('[data-pick-meta="hd"]'),
      hip: pickInfoEl.querySelector('[data-pick-meta="hip"]'),
      gaia: pickInfoEl.querySelector('[data-pick-meta="gaia"]'),
    },
    obs: {
      icrs: pickInfoEl.querySelector('[data-pick-obs="icrs"]'),
      distance: pickInfoEl.querySelector('[data-pick-obs="distance"]'),
      absMag: pickInfoEl.querySelector('[data-pick-obs="absMag"]'),
      appMag: pickInfoEl.querySelector('[data-pick-obs="appMag"]'),
      temp: pickInfoEl.querySelector('[data-pick-obs="temp"]'),
      visualPx: pickInfoEl.querySelector('[data-pick-obs="visualPx"]'),
      dustAv: pickInfoEl.querySelector('[data-pick-obs="dustAv"]'),
      appMagDust: pickInfoEl.querySelector('[data-pick-obs="appMagDust"]'),
      score: pickInfoEl.querySelector('[data-pick-obs="score"]'),
      offset: pickInfoEl.querySelector('[data-pick-obs="offset"]'),
      bufferIndex: pickInfoEl.querySelector('[data-pick-obs="bufferIndex"]'),
    },
    simbadEmpty: pickInfoEl.querySelector('[data-pick-simbad-empty]'),
    simbadLink: pickInfoEl.querySelector('[data-pick-simbad-link]'),
  };
  return pickUi;
}

function renderPickInfo(result) {
  const ui = bindPickUi();
  if (!ui?.empty || !ui.detail) {
    return;
  }

  if (!result) {
    ui.empty.hidden = false;
    ui.detail.hidden = true;
    if (ui.timing) {
      ui.timing.hidden = true;
      ui.timing.textContent = '';
    }
    return;
  }

  ui.empty.hidden = true;
  ui.detail.hidden = false;

  const fields = result.sidecarFields;
  ui.meta.proper.textContent = fields?.properName || '—';
  ui.meta.bayer.textContent = fields?.bayer || '—';
  ui.meta.hd.textContent = fields?.hd || '—';
  ui.meta.hip.textContent = fields?.hip || '—';
  ui.meta.gaia.textContent = fields?.gaia || '—';

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

  ui.obs.icrs.textContent = `(${fmt(icrsPc.x, 1)}, ${fmt(icrsPc.y, 1)}, ${fmt(icrsPc.z, 1)}) pc`;
  ui.obs.distance.textContent = formatDistancePc(distFromObserver);
  ui.obs.absMag.textContent = fmt(result.absoluteMagnitude);
  ui.obs.appMag.textContent = fmt(result.apparentMagnitude);
  ui.obs.temp.textContent = Number.isFinite(result.temperatureK)
    ? `${Math.round(result.temperatureK).toLocaleString()} K`
    : '—';
  ui.obs.visualPx.textContent = Number.isFinite(result.visualRadiusPx)
    ? `${fmt(result.visualRadiusPx, 1)} px`
    : '—';
  if (ui.obs.dustAv) {
    ui.obs.dustAv.textContent = dustEnabled
      ? fmt(result.dustAv, 3)
      : 'off';
  }
  if (ui.obs.appMagDust) {
    ui.obs.appMagDust.textContent = dustEnabled
      ? fmt(result.apparentMagnitudeAfterDust, 3)
      : 'off';
  }
  ui.obs.score.innerHTML = `${fmt(result.score)} ${scoreLabel(result.score)}`;
  ui.obs.offset.textContent = `${fmt(result.angularDistanceDeg, 3)}°`;
  ui.obs.bufferIndex.textContent = String(result.index);

  if (ui.timing) {
    if (Number.isFinite(result._pickTimeMs)) {
      ui.timing.hidden = false;
      ui.timing.textContent = `Pick took ${fmt(result._pickTimeMs, 1)} ms over ${result._starCount ?? '?'} stars`;
    } else {
      ui.timing.hidden = true;
      ui.timing.textContent = '';
    }
  }
}

function handlePick(result) {
  pickGeneration += 1;
  const generation = pickGeneration;
  lastPickResult = result;
  if (result) {
    updatePickDustMetrics(result);
    delete result.sidecarFields;
  }
  renderPickInfo(result);
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
      if (generation !== pickGeneration || lastPickResult !== result || !fields) {
        return;
      }
      result.sidecarFields = fields;
      renderPickInfo(result);
      renderSnapshot();
    } catch {
      /* sidecar unavailable or incompatible */
    }
  })();
}

function renderSummary(snapshot, datasetDescription) {
  if (!summaryValue) {
    return;
  }

  summaryValue.textContent = JSON.stringify({
    demo: 'phase-5-free-roam',
    mDesired: activeMagLimit,
    fovDeg: activeFovDeg,
    constellation: {
      hysteresisSecs: activeHysteresisSecs,
      fadeDurationSecs: activeArtFadeSecs,
      opacity: activeArtOpacity,
      activeIau: constellationCompassController?.getStats?.()?.activeIau ?? null,
    },
    starField: { ...activeStarFieldState },
    dust: {
      enabled: dustEnabled,
      mode: dustRenderState.mode,
      avScale: dustRenderState.avScale,
      mapGain: dustRenderState.mapGain,
      loaded: Boolean(activeVoxelInfo),
    },
    pickToleranceDeg: activeTolerance,
    sharedDatasetSession: datasetDescription?.id ?? null,
    renderServiceStats: datasetDescription?.services?.render?.stats ?? null,
    picked: summarizePickResult(lastPickResult),
    viewer: summarizeViewer(snapshot),
  }, null, 2);
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  const datasetDescription = datasetSession.describe();

  statusValue.textContent = viewer?.runtime?.running ? 'running' : 'idle';
  syncConstellationPanelFromController();
  renderSummary(snapshot, datasetDescription);

  snapshotValue.textContent = JSON.stringify({
    mDesired: activeMagLimit,
    fovDeg: activeFovDeg,
    constellation: {
      hysteresisSecs: activeHysteresisSecs,
      fadeDurationSecs: activeArtFadeSecs,
      opacity: activeArtOpacity,
      stats: constellationCompassController?.getStats?.() ?? null,
    },
    starField: { ...activeStarFieldState },
    dust: {
      enabled: dustEnabled,
      mode: dustRenderState.mode,
      avScale: dustRenderState.avScale,
      mapGain: dustRenderState.mapGain,
      loaded: Boolean(activeVoxelInfo),
    },
    pickToleranceDeg: activeTolerance,
    picked: summarizePickResult(lastPickResult),
    viewer: snapshot,
    warmState,
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

async function mountViewer() {
  if (viewer) {
    return viewer;
  }

  await warmDatasetSession();

  const cameraController = createCameraRigController({
    id: 'phase-5-camera-rig-controller',
    icrsToSceneTransform: ORION_SCENE_TRANSFORM,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const fullscreen = createFullscreenPreset();
  const manifest = await loadConstellationArtManifest({ manifestUrl: DEFAULT_ART_MANIFEST_URL });
  indexManifest(manifest);

  constellationArtLayer = createConstellationArtLayer({
    id: 'phase-5-free-roam-constellation-art-layer',
    manifest,
    manifestUrl: DEFAULT_ART_MANIFEST_URL,
    transformDirection: ORION_SCENE_TRANSFORM,
    opacity: activeArtOpacity,
    fadeDurationSecs: activeArtFadeSecs,
  });

  constellationCompassController = createConstellationCompassController({
    id: 'phase-5-free-roam-constellation-compass-controller',
    manifest,
    sceneToIcrsTransform: ORION_SCENE_TO_ICRS_TRANSFORM,
    hysteresisSecs: activeHysteresisSecs,
    onConstellationIn(payload) {
      currentConstellationIau = payload.iau;
      currentConstellationName = constellationInfoByIau.get(payload.iau)?.name
        ?? payload.name?.native
        ?? payload.name?.english
        ?? payload.iau;
      if (artEnabled) {
        constellationArtLayer.show(payload.iau);
      }
      setActiveConstellationPanel(payload);
    },
    onConstellationOut(payload) {
      constellationArtLayer.hide(payload.iau);
      if (payload.iau === currentConstellationIau) {
        currentConstellationIau = null;
        currentConstellationName = null;
      }
      setActiveConstellationPanel(null);
    },
  });

  starFieldLayer = createStarFieldLayer({
    id: 'phase-5-free-roam-star-field-layer',
    positionTransform: ORION_SCENE_TRANSFORM,
    includePickMeta: true,
    materialFactory: () => createDefaultStarFieldMaterialProfile(),
  });

  const constellationControls = [
    {
      label: () => (currentConstellationName ? `✦ ${currentConstellationName}` : '✦ —'),
      title: 'View-center constellation (toggle art)',
      toggle: true,
      initialActive: true,
      position: 'top-right',
      onPress(active) {
        artEnabled = active;
        if (!active) {
          constellationArtLayer.hideAll();
        } else if (currentConstellationIau) {
          constellationArtLayer.show(currentConstellationIau);
        }
        requestRender();
      },
    },
  ];

  pickControllerRef = createPickController({
    id: 'phase-5-free-roam-pick-controller',
    getStarData: () => starFieldLayer?.getStarData?.(),
    onPick(result, _event, stats) {
      if (result) {
        result._pickTimeMs = stats?.pickTimeMs ?? null;
        result._starCount = stats?.starCount ?? null;
      }
      handlePick(result);
    },
  });

  viewer = await createViewer(mount, {
    datasetSession,
    camera: (() => {
      const camera = createViewerCamera();
      camera.fov = activeFovDeg;
      camera.updateProjectionMatrix();
      return camera;
    })(),
    interestField: createObserverShellField({
      id: 'phase-5-free-roam-field',
      note: 'Single-view free-roam shell field for the Phase 5 controller sandbox.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'phase-5-selection-refresh-controller',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      pickControllerRef,
      constellationCompassController,
      fullscreen.controller,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
          ...constellationControls,
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
          createSpeedReadout(cameraController, { position: 'top-left' }),
          createDistanceReadout(cameraController, SOLAR_ORIGIN_PC, {
            label: 'Distance to Sun',
            position: 'top-left',
          }),
        ],
      }),
    ],
    layers: [
      constellationArtLayer,
      starFieldLayer,
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      ...activeStarFieldState,
      demo: 'phase-5-free-roam',
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });

  if (dustEnabled) {
    await setDustEnabled(true);
  } else {
    renderDustStats();
    applyDustMode();
  }

  renderSnapshot();
  return viewer;
}

setReadout('mag-limit', activeMagLimit.toFixed(1));
setReadout('fov', `${activeFovDeg.toFixed(0)}°`);
setReadout('hysteresis', `${activeHysteresisSecs.toFixed(2)}s`);
setReadout('art-fade', `${activeArtFadeSecs.toFixed(2)}s`);
setReadout('art-opacity', activeArtOpacity.toFixed(2));
setReadout('exposure', formatExposureReadout(activeStarFieldState.starFieldExposure));
setReadout('extinction', activeStarFieldState.starFieldExtinctionScale.toFixed(2));
setReadout('fade-range', activeStarFieldState.starFieldMagFadeRange.toFixed(1));
setReadout('base-size', activeStarFieldState.starFieldBaseSize.toFixed(2));
setReadout('size-scale', activeStarFieldState.starFieldSizeScale.toFixed(2));
setReadout('size-power', activeStarFieldState.starFieldSizePower.toFixed(2));
setReadout('glow-scale', activeStarFieldState.starFieldGlowScale.toFixed(2));
setReadout('glow-power', activeStarFieldState.starFieldGlowPower.toFixed(2));
setReadout('dust-av-scale', dustRenderState.avScale.toFixed(3));
setReadout('dust-map-gain', dustRenderState.mapGain.toFixed(1));
setReadout('pick-tolerance', `${activeTolerance.toFixed(1)}°`);
applyDustMode();
toleranceInput?.setAttribute('value', String(activeTolerance));
if (toleranceInput) {
  toleranceInput.value = String(activeTolerance);
}
setActiveConstellationPanel(null);
renderPickInfo(null);

magLimitInput?.addEventListener('input', () => {
  const parsed = Number(magLimitInput.value);
  if (!Number.isFinite(parsed)) {
    magLimitInput.value = String(activeMagLimit);
    return;
  }

  activeMagLimit = parsed;
  setReadout('mag-limit', activeMagLimit.toFixed(1));

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
      console.error('[free-roam-demo] mag limit update failed', error);
    });
});

fovInput?.addEventListener('input', () => {
  const parsed = Number(fovInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fovInput.value = String(activeFovDeg);
    return;
  }

  activeFovDeg = parsed;
  setReadout('fov', `${activeFovDeg.toFixed(0)}°`);
  if (viewer?.camera) {
    viewer.camera.fov = activeFovDeg;
    viewer.camera.updateProjectionMatrix();
    requestRender();
  }
  renderSnapshot();
});

hysteresisInput?.addEventListener('input', () => {
  const parsed = Number(hysteresisInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    hysteresisInput.value = String(activeHysteresisSecs);
    return;
  }

  activeHysteresisSecs = parsed;
  setReadout('hysteresis', `${activeHysteresisSecs.toFixed(2)}s`);
  constellationCompassController?.setHysteresisSecs(activeHysteresisSecs);
  requestRender();
  renderSnapshot();
});

artFadeInput?.addEventListener('input', () => {
  const parsed = Number(artFadeInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    artFadeInput.value = String(activeArtFadeSecs);
    return;
  }

  activeArtFadeSecs = parsed;
  setReadout('art-fade', `${activeArtFadeSecs.toFixed(2)}s`);
  constellationArtLayer?.setFadeDurationSecs(activeArtFadeSecs);
  requestRender();
  renderSnapshot();
});

artOpacityInput?.addEventListener('input', () => {
  const parsed = Number(artOpacityInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    artOpacityInput.value = String(activeArtOpacity);
    return;
  }

  activeArtOpacity = parsed;
  setReadout('art-opacity', activeArtOpacity.toFixed(2));
  constellationArtLayer?.setOpacity(activeArtOpacity);
  if (artEnabled && currentConstellationIau) {
    constellationArtLayer?.show(currentConstellationIau);
  }
  requestRender();
  renderSnapshot();
});

function updateStarFieldState(partialState) {
  activeStarFieldState = {
    ...activeStarFieldState,
    ...partialState,
  };
  if (viewer) {
    viewer.setState(partialState);
    requestRender();
  }
  renderSnapshot();
}

exposureInput?.addEventListener('input', () => {
  const sliderValue = Number(exposureInput.value);
  if (!Number.isFinite(sliderValue)) {
    return;
  }
  const exposure = Math.exp(sliderValue);
  setReadout('exposure', formatExposureReadout(exposure));
  updateStarFieldState({ starFieldExposure: exposure });
});

extinctionInput?.addEventListener('input', () => {
  const parsed = Number(extinctionInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('extinction', parsed.toFixed(2));
  updateStarFieldState({ starFieldExtinctionScale: parsed });
});

fadeRangeInput?.addEventListener('input', () => {
  const parsed = Number(fadeRangeInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('fade-range', parsed.toFixed(1));
  updateStarFieldState({ starFieldMagFadeRange: parsed });
});

baseSizeInput?.addEventListener('input', () => {
  const parsed = Number(baseSizeInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('base-size', parsed.toFixed(2));
  updateStarFieldState({ starFieldBaseSize: parsed });
});

sizeScaleInput?.addEventListener('input', () => {
  const parsed = Number(sizeScaleInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('size-scale', parsed.toFixed(2));
  updateStarFieldState({ starFieldSizeScale: parsed });
});

sizePowerInput?.addEventListener('input', () => {
  const parsed = Number(sizePowerInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return;
  }
  setReadout('size-power', parsed.toFixed(2));
  updateStarFieldState({ starFieldSizePower: parsed });
});

glowScaleInput?.addEventListener('input', () => {
  const parsed = Number(glowScaleInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  setReadout('glow-scale', parsed.toFixed(2));
  updateStarFieldState({ starFieldGlowScale: parsed });
});

glowPowerInput?.addEventListener('input', () => {
  const parsed = Number(glowPowerInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return;
  }
  setReadout('glow-power', parsed.toFixed(2));
  updateStarFieldState({ starFieldGlowPower: parsed });
});

dustEnabledInput?.addEventListener('change', () => {
  dustEnabledInput.disabled = true;
  setDustEnabled(dustEnabledInput.checked)
    .catch((error) => {
      dustEnabled = false;
      dustEnabledInput.checked = false;
      if (dustStatusValue) dustStatusValue.textContent = `error: ${error.message}`;
      console.error('[free-roam-demo] dust enable failed', error);
    })
    .finally(() => {
      dustEnabledInput.disabled = false;
    });
});

dustModeSelect?.addEventListener('change', () => {
  dustRenderState.mode = dustModeSelect.value;
  applyDustMode();
  updatePickDustMetrics(lastPickResult);
  renderPickInfo(lastPickResult);
  renderSnapshot();
});

dustAvScaleInput?.addEventListener('input', () => {
  const parsed = Number(dustAvScaleInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  dustRenderState.avScale = parsed;
  setReadout('dust-av-scale', parsed.toFixed(3));
  applyDustMode();
  updatePickDustMetrics(lastPickResult);
  renderPickInfo(lastPickResult);
  renderSnapshot();
});

dustMapGainInput?.addEventListener('input', () => {
  const parsed = Number(dustMapGainInput.value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }
  dustRenderState.mapGain = parsed;
  setReadout('dust-map-gain', parsed.toFixed(1));
  applyDustMode();
  renderPickInfo(lastPickResult);
  renderSnapshot();
});

showGalacticPlaneInput?.addEventListener('change', () => {
  applyDustMode();
  renderPickInfo(lastPickResult);
  renderSnapshot();
});

toleranceInput?.addEventListener('input', () => {
  const parsed = Number(toleranceInput.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    toleranceInput.value = String(activeTolerance);
    return;
  }

  activeTolerance = parsed;
  setReadout('pick-tolerance', `${activeTolerance.toFixed(1)}°`);
  pickControllerRef?.setToleranceDeg(activeTolerance);
  renderSnapshot();
});

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) {
    window.clearInterval(snapshotTimer);
  }

  if (viewer) {
    viewer.dispose().catch((error) => {
      console.error('[free-roam-demo] cleanup failed', error);
    });
  }
});

snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  snapshotValue.textContent = error.stack ?? error.message;
  console.error('[free-roam-demo] initial mount failed', error);
});
