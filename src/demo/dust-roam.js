import * as THREE from 'three';
import { loadDustMapNgVolume } from '../dust/load-dust-map-ng.js';
import { DEFAULT_DUST_MAP_NG_URL } from '../found-in-space-dataset.js';
import { SCALE } from '../services/octree/scene-scale.js';
import {
  createCameraRigController,
  createPickController,
  DEFAULT_MAG_LIMIT,
  DEFAULT_STAR_FIELD_STATE,
  createFoundInSpaceDatasetOptions,
  createHud,
  createObserverShellField,
  loadConstellationArtManifest,
  ORION_CENTER_PC,
  createSceneOrientationTransforms,
  createSelectionRefreshController,
  resolveFoundInSpaceDatasetOverrides,
  createStarFieldLayer,
  createViewer,
  getDatasetSession,
  SOLAR_ORIGIN_PC,
} from '../index.js';
import { createConstellationPreset } from '../presets/constellation-preset.js';
import { createSpeedReadout, createDistanceReadout, createFlyToAction, createLookAtAction } from '../presets/navigation-presets.js';
import { createFullscreenPreset } from '../presets/fullscreen-preset.js';
import { installDemoViewerDebugConsole } from './viewer-debug-console.js';

// ── Constants ───────────────────────────────────────────────────────────────

const DUST_SCALE = SCALE;
/** Ray-march sample cap: GLSL loop bound and default `uSteps` (must match). */
const DUST_VOLUME_RAYMARCH_STEPS = 64;
const DEFAULT_ART_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';
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

// ── Scene orientation ───────────────────────────────────────────────────────

const {
  icrsToScene: ICRS_TO_SCENE,
  sceneToIcrs: SCENE_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

// ── Standard IAU Galactic → ICRS rotation (Murray 1989) ─────────────────────
// Each row is a Galactic basis axis expressed in ICRS Cartesian coordinates.
// dust_map_ng.bin is already Galactic Cartesian in a heliocentric frame, so
// placement only needs this rotation plus the viewer's scene orientation.

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

function galacticToDustScene(gx, gy, gz) {
  const [ix, iy, iz] = galacticToIcrs(gx, gy, gz);
  return ICRS_TO_SCENE(ix * DUST_SCALE, iy * DUST_SCALE, iz * DUST_SCALE);
}

function computeVisibleBandAvRatio(lambdaMicron, rv = MILKY_WAY_RV) {
  const x = 1 / lambdaMicron;
  if (!(x >= 1.1 && x <= 3.3)) {
    throw new RangeError(`O'Donnell extinction law expects 0.303–0.909 μm, got ${lambdaMicron}`);
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

// ── Extinction-study volume shader ──────────────────────────────────────────
// The box lives in local space aligned with Galactic axes. We integrate
// visual extinction A_V along the view ray, then display the equivalent
// reddening a white background source would acquire through that dust column.

const volumeVertexShader = /* glsl */ `
  out vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const volumeFragmentShader = `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform float uDustMaxDensity;
  uniform float uDustAvScale;
  uniform float uMapGain;
  uniform int uSteps;
  uniform mat4 uInvModelMatrix;
  uniform vec3 uBoxSize;      // full box extent in local (model) space
  uniform float uSceneScale;  // world units per parsec (octree SCALE)
  uniform vec3 uDustAvToRgb;  // Broad visible-channel A_λ / A_V ratios for R, G, B

  in vec3 vWorldPos;
  out vec4 fragColor;

  ${dustExtinctionShaderChunk}
  ${dustVisualizationShaderChunk}

  void main() {
    // Transform camera and fragment pos into local (Galactic-aligned) space
    vec3 localPos = (uInvModelMatrix * vec4(vWorldPos, 1.0)).xyz;
    vec3 localCam = (uInvModelMatrix * vec4(cameraPosition, 1.0)).xyz;
    vec3 rayDir   = normalize(localPos - localCam);
    vec3 safeDir  = mix(vec3(1e-5), rayDir, step(vec3(1e-5), abs(rayDir)));

    // Ray-box intersection in local space (box centred at origin)
    vec3 halfSize = uBoxSize * 0.5;
    vec3 tMin = (-halfSize - localCam) / safeDir;
    vec3 tMax = ( halfSize - localCam) / safeDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar  = min(min(t2.x, t2.y), t2.z);

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

      // Local position → UVW  (box goes from -halfSize to +halfSize)
      vec3 uvw = pos / uBoxSize + 0.5;

      float raw = texture(uVolume, uvw).r;
      if (raw > 0.0) {
        avColumn += sampleDustAv(raw, uDustMaxDensity, uDustAvScale, stepSizePc);
      }
    }

    if (avColumn <= 1e-5) discard;

    // Educational overlay: show the actual integrated A_V field directly,
    // using colour only as a readable map of extinction strength.
    vec3 displayColor = extinctionMapColor(avColumn);
    float alpha = clamp((1.0 - exp(-avColumn * 1.15)) * uMapGain, 0.0, 0.9);
    alpha *= smoothstep(0.01, 0.05, avColumn);

    fragColor = vec4(displayColor, alpha);
  }
`;

// ── Dust-aware star field material ──────────────────────────────────────────

const DUST_STAR_MAX_STEPS = 16;

function createDustExtinctionStarFieldMaterialProfile(options = {}) {
  const fallbackInvDustModelMatrix = options.invDustModelMatrix?.clone?.() ?? new THREE.Matrix4();
  const scratchInvDustMatrix = new THREE.Matrix4();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSizeMin: { value: options.sizeMin ?? 0.0 },
      uSizeMax: { value: options.sizeMax ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeMax },
      uBaseSize: { value: options.baseSize ?? DEFAULT_STAR_FIELD_STATE.starFieldBaseSize },
      uSizeFluxScale: { value: options.sizeFluxScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeFluxScale },
      uSizeScale: { value: options.sizeScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeScale },
      uSizePower: { value: options.sizePower ?? DEFAULT_STAR_FIELD_STATE.starFieldSizePower },
      uScale: { value: options.scale ?? SCALE },
      uMagLimit: { value: options.magLimit ?? DEFAULT_MAG_LIMIT },
      uMagFadeRange: { value: options.magFadeRange ?? DEFAULT_STAR_FIELD_STATE.starFieldMagFadeRange },
      uExtinctionScale: { value: options.extinctionScale ?? 1.0 },
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
      out float vLuminance;

      uniform float uSizeMin;
      uniform float uSizeMax;
      uniform float uBaseSize;
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
        vec3 starColor = blackbodyToRGB(decodeTemperature(teff_log8));
        vColor = starColor * transmittance;

        float brightnessTransmittance = dot(transmittance, vec3(0.2126, 0.7152, 0.0722));
        float apparentFlux = pow(10.0, -0.4 * mApp) * brightnessTransmittance;
        float displayFlux = apparentFlux * uExposure;
        float sizeSignal = fluxSignal(apparentFlux * max(uSizeFluxScale, 0.0), uSizePower);
        float radius = uBaseSize + uSizeScale * sizeSignal;
        gl_PointSize = clamp(radius, uSizeMin, uSizeMax);

        float edgeFade = 1.0 - smoothstep(uMagLimit - uMagFadeRange, uMagLimit, mApp);
        vLuminance = edgeFade * mix(0.18, 1.0, 1.0 - exp(-0.25 * brightnessSignal(displayFlux)));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      in vec3 vColor;
      in float vLuminance;

      out vec4 fragColor;

      void main() {
        if (vLuminance <= 0.0) discard;

        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;

        float core = exp(-dist * 14.0);
        float halo = exp(-dist * 6.0) * 0.65;
        vec3 finalColor = mix(vColor, vec3(1.0), core);
        float starAlpha = min(halo + core, 1.0) * vLuminance;

        if (starAlpha < 0.01) discard;
        fragColor = vec4(finalColor, starAlpha);
      }
    `,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

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

      material.uniforms.uScale.value = Number.isFinite(state.starFieldScale)
        ? state.starFieldScale
        : options.scale ?? SCALE;
      material.uniforms.uExtinctionScale.value = Number.isFinite(state.starFieldExtinctionScale)
        ? state.starFieldExtinctionScale
        : options.extinctionScale ?? 1.0;
      material.uniforms.uMagLimit.value = Number.isFinite(state.mDesired)
        ? state.mDesired
        : options.magLimit ?? DEFAULT_MAG_LIMIT;
      material.uniforms.uExposure.value = Number.isFinite(state.starFieldExposure)
        ? state.starFieldExposure
        : options.exposure ?? DEFAULT_STAR_FIELD_STATE.starFieldExposure;
      material.uniforms.uMagFadeRange.value = Number.isFinite(state.starFieldMagFadeRange)
        ? state.starFieldMagFadeRange
        : options.magFadeRange ?? DEFAULT_STAR_FIELD_STATE.starFieldMagFadeRange;
      material.uniforms.uBaseSize.value = Number.isFinite(state.starFieldBaseSize)
        ? state.starFieldBaseSize
        : options.baseSize ?? DEFAULT_STAR_FIELD_STATE.starFieldBaseSize;
      material.uniforms.uSizeMax.value = Number.isFinite(state.starFieldSizeMax)
        ? state.starFieldSizeMax
        : options.sizeMax ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeMax;
      material.uniforms.uSizeFluxScale.value = Number.isFinite(state.starFieldSizeFluxScale)
        ? state.starFieldSizeFluxScale
        : options.sizeFluxScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeFluxScale;
      material.uniforms.uSizeScale.value = Number.isFinite(state.starFieldSizeScale)
        ? state.starFieldSizeScale
        : options.sizeScale ?? DEFAULT_STAR_FIELD_STATE.starFieldSizeScale;
      material.uniforms.uSizePower.value = Number.isFinite(state.starFieldSizePower)
        ? state.starFieldSizePower
        : options.sizePower ?? DEFAULT_STAR_FIELD_STATE.starFieldSizePower;
      material.uniforms.uDustAvScale.value = options.getAvScale?.() ?? 1.0;
    },
    dispose() {
      material.dispose();
    },
  };
}

// ── Build volume mesh ───────────────────────────────────────────────────────

function createDustPlacement(voxelInfo) {
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
  const extX = (maxX - minX + dx) * DUST_SCALE;
  const extY = (maxY - minY + dy) * DUST_SCALE;
  const extZ = (maxZ - minZ + dz) * DUST_SCALE;

  const cenGalX = (minX + maxX) / 2;
  const cenGalY = (minY + maxY) / 2;
  const cenGalZ = (minZ + maxZ) / 2;
  const basisX = galacticToDustScene(1, 0, 0).map((v) => v / DUST_SCALE);
  const basisY = galacticToDustScene(0, 1, 0).map((v) => v / DUST_SCALE);
  const basisZ = galacticToDustScene(0, 0, 1).map((v) => v / DUST_SCALE);
  const [cx, cy, cz] = galacticToDustScene(cenGalX, cenGalY, cenGalZ);

  const rotBasis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...basisX).normalize(),
    new THREE.Vector3(...basisY).normalize(),
    new THREE.Vector3(...basisZ).normalize(),
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotBasis);

  const position = new THREE.Vector3(cx, cy, cz);
  const boxSize = new THREE.Vector3(extX, extY, extZ);
  const modelMatrix = new THREE.Matrix4().compose(
    position,
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );

  return {
    boxSize,
    position,
    quaternion,
    invModelMatrix: modelMatrix.clone().invert(),
  };
}

function buildVolumeMesh(voxelInfo) {
  const { texture, maxDensity } = voxelInfo;
  const placement = createDustPlacement(voxelInfo);
  const geo = new THREE.BoxGeometry(
    placement.boxSize.x,
    placement.boxSize.y,
    placement.boxSize.z,
  );

  const invModelMatrix = new THREE.Matrix4();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uVolume: { value: texture },
      uDustMaxDensity: { value: maxDensity },
      uDustAvScale: { value: dustRenderState.avScale },
      uMapGain: { value: dustRenderState.mapGain },
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

  // We'll compute invModelMatrix after the mesh is added to the scene
  mesh.onBeforeRender = () => {
    invModelMatrix.copy(mesh.matrixWorld).invert();
  };

  return mesh;
}

function buildGalacticPlaneGuide(voxelInfo) {
  if (voxelInfo.frame !== 'galactic') return null;
  const placement = createDustPlacement(voxelInfo);
  const planeWidth = placement.boxSize.x;
  const planeHeight = placement.boxSize.y;

  const guide = new THREE.Group();
  guide.position.copy(placement.position);
  guide.quaternion.copy(placement.quaternion);
  guide.visible = Boolean(showGalacticPlaneInput?.checked);

  const planeGeometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 1, 1);
  const plane = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({
    color: 0x3f7cff,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  guide.add(plane);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(planeGeometry),
    new THREE.LineBasicMaterial({
      color: 0x7fb2ff,
      transparent: true,
      opacity: 0.7,
    }),
  );
  guide.add(edges);

  const normalLength = 2.5;
  const normalGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, normalLength),
  ]);
  const normal = new THREE.Line(
    normalGeometry,
    new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 }),
  );
  guide.add(normal);

  const crossGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.15, 0, normalLength),
    new THREE.Vector3(0.15, 0, normalLength),
    new THREE.Vector3(0, -0.15, normalLength),
    new THREE.Vector3(0, 0.15, normalLength),
  ]);
  const cross = new THREE.LineSegments(
    crossGeometry,
    new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 }),
  );
  guide.add(cross);

  return guide;
}

// ── Helpers (from free-roam) ────────────────────────────────────────────────

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function summarizeViewer(snapshot) {
  if (!snapshot) return null;
  const starPart = snapshot.parts.find((p) => p.kind === 'layer' && p.stats?.starCount != null);
  const rigPart = snapshot.parts.find((p) => p.id === 'dust-roam-camera-rig');
  const refreshPart = snapshot.parts.find((p) => p.id === 'dust-roam-selection-refresh');
  return {
    field: snapshot.selection?.strategy ?? null,
    observerPc: clonePoint(snapshot.state?.observerPc),
    targetPc: clonePoint(snapshot.state?.targetPc),
    mDesired: snapshot.selection?.meta?.mDesired ?? null,
    selectedNodes: snapshot.selection?.meta?.selectedNodeCount ?? snapshot.selection?.nodes?.length ?? null,
    renderedNodes: starPart?.stats?.nodeCount ?? null,
    renderedStars: starPart?.stats?.starCount ?? null,
    freeFly: rigPart?.stats ?? null,
    selectionRefresh: refreshPart?.stats ?? null,
  };
}

function createViewerCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 256);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  return camera;
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const mount = document.querySelector('[data-skykit-viewer-root]');
const magLimitInput = document.querySelector('[data-mag-limit]');
const statusValue = document.querySelector('[data-status]');
const summaryValue = document.querySelector('[data-summary]');
const snapshotValue = document.querySelector('[data-snapshot]');

const modeSelect = document.querySelector('[data-render-mode]');
const avScaleInput = document.querySelector('[data-av-scale]');
const avScaleValueSpan = document.querySelector('[data-av-scale-value]');
const mapGainInput = document.querySelector('[data-map-gain]');
const mapGainValueSpan = document.querySelector('[data-map-gain-value]');
const showGalacticPlaneInput = document.querySelector('[data-show-galactic-plane]');
const gridInfoSpan = document.querySelector('[data-grid-info]');
const gridExtentsSpan = document.querySelector('[data-grid-extents]');
const starCountSpan = document.querySelector('[data-star-count]');
const starIcrsSpanSpan = document.querySelector('[data-star-icrs-span]');
const starIcrsMinSpan = document.querySelector('[data-star-icrs-min]');
const starIcrsMaxSpan = document.querySelector('[data-star-icrs-max]');
const cellSizeSpan = document.querySelector('[data-cell-size]');
const dustScaleSpan = document.querySelector('[data-dust-scale]');
const densityMaxSpan = document.querySelector('[data-density-max]');
const pickInfoEl = document.querySelector('[data-pick-info]');

// ── Dataset ─────────────────────────────────────────────────────────────────

const datasetSession = getDatasetSession(createFoundInSpaceDatasetOptions({
  id: 'dust-roam-dataset',
  ...resolveFoundInSpaceDatasetOverrides(),
  capabilities: {
    sharedCaches: true,
    bootstrapLoading: 'dust-roam',
  },
}));

let viewer = null;
let snapshotTimer = null;
let volumeMesh = null;
let galacticPlaneGuide = null;
let activeVoxelInfo = null;
let starFieldLayer = null;
let pickControllerRef = null;
let lastPickResult = null;
let pickGeneration = 0;
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 6.5;
const dustRenderState = {
  mode: modeSelect?.value ?? DUST_MODE_ABSORPTIVE,
  avScale: Number(avScaleInput?.value) || DEFAULT_DUST_AV_SCALE,
  mapGain: Number(mapGainInput?.value) || DEFAULT_EXTINCTION_MAP_GAIN,
};
if (mapGainInput) mapGainInput.disabled = dustRenderState.mode !== DUST_MODE_EXTINCTION_MAP;
let warmState = { bootstrap: 'idle', rootShard: 'idle', meta: 'idle' };

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

/** Axis-aligned bounds of rendered star positions in ICRS parsecs (from scene geometry). */
let lastStarIcrsBounds = null;

function computeStarIcrsBoundsFromScenePositions(positions, scaleFromOctree) {
  if (!positions?.length) return null;
  const s = Number.isFinite(scaleFromOctree) && scaleFromOctree > 0 ? scaleFromOctree : SCALE;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const [ix, iy, iz] = SCENE_TO_ICRS(positions[i], positions[i + 1], positions[i + 2]);
    const px = ix / s;
    const py = iy / s;
    const pz = iz / s;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    if (pz > maxZ) maxZ = pz;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function formatPcTriplet(v) {
  return `${v[0].toFixed(0)} … ${v[1].toFixed(0)} … ${v[2].toFixed(0)}`;
}

function fmt(n, decimals = 2) {
  return Number.isFinite(n) ? n.toFixed(decimals) : '—';
}

function sceneToIcrsPc(pos) {
  const [ix, iy, iz] = SCENE_TO_ICRS(pos.x, pos.y, pos.z);
  return { x: ix / SCALE, y: iy / SCALE, z: iz / SCALE };
}

function getObserverPc() {
  return viewer?.getSnapshotState?.()?.state?.observerPc ?? { x: 0, y: 0, z: 0 };
}

function observerPcToSceneWorld(observerPc) {
  const [sx, sy, sz] = ICRS_TO_SCENE(
    observerPc.x * SCALE,
    observerPc.y * SCALE,
    observerPc.z * SCALE,
  );
  return _dustObserverWorld.set(sx, sy, sz);
}

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

  let tNear = Math.max(_dustT1.x, _dustT1.y, _dustT1.z, 0);
  let tFar = Math.min(_dustT2.x, _dustT2.y, _dustT2.z, segmentLength);
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

let pickUi = null;
function bindPickUi() {
  if (pickUi || !pickInfoEl) return pickUi;
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
      appMagGeom: pickInfoEl.querySelector('[data-pick-obs="appMagGeom"]'),
      dustAv: pickInfoEl.querySelector('[data-pick-obs="dustAv"]'),
      appMagDust: pickInfoEl.querySelector('[data-pick-obs="appMagDust"]'),
      temp: pickInfoEl.querySelector('[data-pick-obs="temp"]'),
      visualPx: pickInfoEl.querySelector('[data-pick-obs="visualPx"]'),
      score: pickInfoEl.querySelector('[data-pick-obs="score"]'),
    },
  };
  return pickUi;
}

function renderPickInfo(result) {
  const ui = bindPickUi();
  if (!ui?.empty || !ui.detail) return;
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
  const f = result.sidecarFields;
  ui.meta.proper.textContent = f?.properName || '—';
  ui.meta.bayer.textContent = f?.bayer || '—';
  ui.meta.hd.textContent = f?.hd || '—';
  ui.meta.hip.textContent = f?.hip || '—';
  ui.meta.gaia.textContent = f?.gaia || '—';

  const icrsPc = sceneToIcrsPc(result.position);
  const tempStr = Number.isFinite(result.temperatureK)
    ? `${Math.round(result.temperatureK).toLocaleString()} K`
    : '—';
  const visualPxStr = Number.isFinite(result.visualRadiusPx)
    ? `${fmt(result.visualRadiusPx, 1)} px`
    : '—';

  ui.obs.icrs.textContent = `(${fmt(icrsPc.x, 1)}, ${fmt(icrsPc.y, 1)}, ${fmt(icrsPc.z, 1)}) pc`;
  ui.obs.distance.textContent = `${fmt(result.distancePc, 2)} pc`;
  ui.obs.absMag.textContent = fmt(result.absoluteMagnitude, 2);
  ui.obs.appMagGeom.textContent = fmt(result.apparentMagnitude, 3);
  ui.obs.dustAv.textContent = fmt(result.dustAv, 3);
  ui.obs.appMagDust.textContent = fmt(result.apparentMagnitudeAfterDust, 3);
  ui.obs.temp.textContent = tempStr;
  ui.obs.visualPx.textContent = visualPxStr;
  ui.obs.score.textContent = `${fmt(result.score, 2)} @ ${fmt(result.angularDistanceDeg, 3)}°`;
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

function renderStarExtentStats() {
  if (!lastStarIcrsBounds || lastStarIcrsBounds.starCount < 1) {
    if (starCountSpan) starCountSpan.textContent = '—';
    if (starIcrsSpanSpan) starIcrsSpanSpan.textContent = '—';
    if (starIcrsMinSpan) starIcrsMinSpan.textContent = '—';
    if (starIcrsMaxSpan) starIcrsMaxSpan.textContent = '—';
    return;
  }
  const { min, max, starCount } = lastStarIcrsBounds;
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  if (starCountSpan) starCountSpan.textContent = String(starCount);
  if (starIcrsSpanSpan) {
    starIcrsSpanSpan.textContent = `${sx.toFixed(0)} × ${sy.toFixed(0)} × ${sz.toFixed(0)}`;
  }
  if (starIcrsMinSpan) starIcrsMinSpan.textContent = formatPcTriplet(min);
  if (starIcrsMaxSpan) starIcrsMaxSpan.textContent = formatPcTriplet(max);
}

// ── Snapshot rendering ──────────────────────────────────────────────────────

function renderSummary(snapshot, desc) {
  if (!summaryValue) return;
  summaryValue.textContent = JSON.stringify({
    demo: 'dust-roam',
    mDesired: activeMagLimit,
    pick: lastPickResult
      ? {
        index: lastPickResult.index,
        distancePc: +lastPickResult.distancePc.toFixed(2),
        appMagGeom: +lastPickResult.apparentMagnitude.toFixed(3),
        dustAv: +lastPickResult.dustAv.toFixed(3),
        appMagDust: +lastPickResult.apparentMagnitudeAfterDust.toFixed(3),
      }
      : null,
    sharedDatasetSession: desc?.id ?? null,
    renderServiceStats: desc?.services?.render?.stats ?? null,
    viewer: summarizeViewer(snapshot),
  }, null, 2);
}

function formatExtentInfo(voxelInfo) {
  const dx = (voxelInfo.maxX - voxelInfo.minX) / Math.max(1, voxelInfo.nx - 1);
  const dy = (voxelInfo.maxY - voxelInfo.minY) / Math.max(1, voxelInfo.ny - 1);
  const dz = (voxelInfo.maxZ - voxelInfo.minZ) / Math.max(1, voxelInfo.nz - 1);
  const extX = voxelInfo.maxX - voxelInfo.minX + dx;
  const extY = voxelInfo.maxY - voxelInfo.minY + dy;
  const extZ = voxelInfo.maxZ - voxelInfo.minZ + dz;
  return {
    extents: `${extX.toFixed(0)} x ${extY.toFixed(0)} x ${extZ.toFixed(0)}`,
    cellSize: `${dx.toFixed(0)} x ${dy.toFixed(0)} x ${dz.toFixed(0)}`,
  };
}

function renderDustStats() {
  if (!activeVoxelInfo) return;
  if (gridInfoSpan) gridInfoSpan.textContent = `${activeVoxelInfo.nx}×${activeVoxelInfo.ny}×${activeVoxelInfo.nz}`;
  const extentInfo = formatExtentInfo(activeVoxelInfo);
  if (gridExtentsSpan) gridExtentsSpan.textContent = extentInfo.extents;
  if (cellSizeSpan) cellSizeSpan.textContent = extentInfo.cellSize;
  if (dustScaleSpan) {
    dustScaleSpan.textContent = `${activeVoxelInfo.format}/${activeVoxelInfo.frame}, Rv 3.1, Bohlin gas→Av, ${DUST_VOLUME_RAYMARCH_STEPS} steps`;
  }
  if (densityMaxSpan) densityMaxSpan.textContent = activeVoxelInfo.maxDensity.toFixed(1);
}

function renderSnapshot() {
  const snapshot = viewer?.getSnapshotState?.() ?? null;
  const desc = datasetSession.describe();
  statusValue.textContent = viewer?.runtime?.running ? 'running' : 'idle';
  renderSummary(snapshot, desc);
  renderStarExtentStats();
  snapshotValue.textContent = JSON.stringify({
    mDesired: activeMagLimit, viewer: snapshot, warmState, datasetSession: desc,
  }, null, 2);
}

function applyDustMode() {
  if (mapGainInput) {
    mapGainInput.disabled = dustRenderState.mode !== DUST_MODE_EXTINCTION_MAP;
  }
  if (volumeMesh) {
    volumeMesh.visible = dustRenderState.mode === DUST_MODE_EXTINCTION_MAP;
  }
  if (viewer?.runtime?.renderOnce) {
    viewer.runtime.renderOnce();
  }
}

function handlePick(result) {
  pickGeneration += 1;
  const generation = pickGeneration;
  lastPickResult = result;
  if (result) {
    const observerPc = getObserverPc();
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
  renderPickInfo(result);
  renderSnapshot();

  if (!result) return;

  const starData = starFieldLayer?.getStarData?.();
  const pickMeta = starData?.pickMeta?.[result.index];
  if (!pickMeta || !datasetSession.getSidecarService('meta')) return;

  void (async () => {
    try {
      const fields = await datasetSession.resolveSidecarMetaFields('meta', pickMeta);
      if (generation !== pickGeneration || lastPickResult !== result) return;
      if (fields) {
        result.sidecarFields = fields;
        renderPickInfo(result);
        renderSnapshot();
      }
    } catch {
      /* sidecar unavailable or incompatible */
    }
  })();
}

// ── Warm dataset ────────────────────────────────────────────────────────────

async function warmDatasetSession() {
  warmState = { ...warmState, bootstrap: 'loading', rootShard: 'loading',
    meta: datasetSession.getSidecarService('meta') ? 'waiting' : 'not-configured' };
  renderSnapshot();

  try {
    await datasetSession.ensureRenderRootShard();
    const bootstrap = await datasetSession.ensureRenderBootstrap();
    warmState = { ...warmState,
      bootstrap: `ready (${bootstrap.datasetIdentitySource})`, rootShard: 'ready' };

    const metaService = datasetSession.getSidecarService('meta');
    if (metaService) {
      try {
        const metaState = await metaService.ensureHeader();
        warmState = { ...warmState, meta: `ready (${metaState.descriptor.sidecarIdentitySource})` };
      } catch (error) {
        warmState = { ...warmState, meta: `unavailable: ${error.message}` };
      }
    }
    renderSnapshot();
    return bootstrap;
  } catch (error) {
    warmState = { ...warmState, bootstrap: `error: ${error.message}`, rootShard: 'error' };
    renderSnapshot();
    throw error;
  }
}

// ── Mount viewer ────────────────────────────────────────────────────────────

async function mountViewer() {
  if (viewer) return viewer;
  await warmDatasetSession();

  const [voxelInfo, manifest] = await Promise.all([
    loadDustMapNgVolume(DEFAULT_DUST_MAP_NG_URL),
    loadConstellationArtManifest({ manifestUrl: DEFAULT_ART_MANIFEST_URL }),
  ]);

  activeVoxelInfo = voxelInfo;
  renderDustStats();

  const dustStarPlacement = createDustPlacement(voxelInfo);

  const cameraController = createCameraRigController({
    id: 'dust-roam-camera-rig',
    icrsToSceneTransform: ICRS_TO_SCENE,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    lookAtPc: ORION_CENTER_PC,
    moveSpeed: 18,
  });

  const fullscreen = createFullscreenPreset();
  const constellation = createConstellationPreset({
    manifest,
    manifestUrl: DEFAULT_ART_MANIFEST_URL,
    sceneToIcrsTransform: SCENE_TO_ICRS,
    transformDirection: ICRS_TO_SCENE,
    position: 'top-right',
  });

  starFieldLayer = createStarFieldLayer({
    id: 'dust-roam-star-field',
    positionTransform: ICRS_TO_SCENE,
    includePickMeta: true,
    materialFactory: () => createDustExtinctionStarFieldMaterialProfile({
      texture: voxelInfo.texture,
      maxDensity: voxelInfo.maxDensity,
      boxSize: dustStarPlacement.boxSize,
      invDustModelMatrix: dustStarPlacement.invModelMatrix,
      getDustMesh: () => volumeMesh,
      getAvScale: () => dustRenderState.avScale,
      avToRgb: VISIBLE_CHANNEL_AV_RATIOS,
    }),
    onCommit({ positions, starCount }) {
      const bounds = computeStarIcrsBoundsFromScenePositions(positions, SCALE);
      if (bounds && Number.isFinite(starCount) && starCount > 0) {
        lastStarIcrsBounds = { ...bounds, starCount };
      } else {
        lastStarIcrsBounds = null;
      }
      renderStarExtentStats();
    },
  });

  pickControllerRef = createPickController({
    id: 'dust-roam-pick-controller',
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
    camera: createViewerCamera(),
    interestField: createObserverShellField({
      id: 'dust-roam-field',
      note: 'Free-roam shell field with volumetric dust overlay.',
    }),
    controllers: [
      cameraController,
      createSelectionRefreshController({
        id: 'dust-roam-selection-refresh',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
      pickControllerRef,
      constellation.compassController,
      fullscreen.controller,
      createHud({
        cameraController,
        controls: [
          { preset: 'arrows', position: 'bottom-right' },
          { preset: 'wasd-qe', position: 'bottom-left' },
          ...constellation.controls,
          createLookAtAction(cameraController, SOLAR_ORIGIN_PC, {
            label: '⟳ Sun', title: 'Look at Sun', position: 'top-right',
          }),
          createFlyToAction(cameraController, SOLAR_ORIGIN_PC, {
            label: '→ Sun', title: 'Fly to Sun', speed: 120, position: 'top-right',
          }),
          ...fullscreen.controls,
          createSpeedReadout(cameraController, { position: 'top-left' }),
          createDistanceReadout(cameraController, SOLAR_ORIGIN_PC, {
            label: 'Distance to Sun', position: 'top-left',
          }),
        ],
      }),
    ],
    layers: [
      constellation.artLayer,
      starFieldLayer,
    ],
    state: {
      ...DEFAULT_STAR_FIELD_STATE,
      demo: 'dust-roam',
      observerPc: { x: 0, y: 0, z: 0 },
      mDesired: activeMagLimit,
      targetPc: ORION_CENTER_PC,
      fieldStrategy: 'observer-shell',
    },
    clearColor: 0x02040b,
  });
  installDemoViewerDebugConsole(viewer, { id: 'dust-roam' });

  volumeMesh = buildVolumeMesh(voxelInfo);
  viewer.contentRoot.add(volumeMesh);
  galacticPlaneGuide = buildGalacticPlaneGuide(voxelInfo);
  if (galacticPlaneGuide) viewer.contentRoot.add(galacticPlaneGuide);
  renderDustStats();
  applyDustMode();

  renderSnapshot();
  return viewer;
}

// ── Controls ────────────────────────────────────────────────────────────────

magLimitInput?.addEventListener('change', () => {
  const parsed = Number(magLimitInput.value);
  if (!Number.isFinite(parsed)) { magLimitInput.value = String(activeMagLimit); return; }
  activeMagLimit = parsed;
  if (!viewer) { renderSnapshot(); return; }
  viewer.setState({ mDesired: activeMagLimit });
  viewer.refreshSelection()
    .then(() => renderSnapshot())
    .catch((err) => {
      statusValue.textContent = 'error';
      console.error('[dust-roam] mag limit update failed', err);
    });
});

modeSelect?.addEventListener('change', () => {
  dustRenderState.mode = modeSelect.value;
  applyDustMode();
});

avScaleInput?.addEventListener('input', () => {
  const v = Number(avScaleInput.value);
  dustRenderState.avScale = v;
  if (avScaleValueSpan) avScaleValueSpan.textContent = v.toFixed(3);
  if (volumeMesh) volumeMesh.material.uniforms.uDustAvScale.value = v;
  if (viewer?.runtime?.renderOnce) viewer.runtime.renderOnce();
});

mapGainInput?.addEventListener('input', () => {
  const v = Number(mapGainInput.value);
  dustRenderState.mapGain = v;
  if (mapGainValueSpan) mapGainValueSpan.textContent = v.toFixed(1);
  if (volumeMesh) volumeMesh.material.uniforms.uMapGain.value = v;
  if (viewer?.runtime?.renderOnce) viewer.runtime.renderOnce();
});

showGalacticPlaneInput?.addEventListener('change', () => {
  if (galacticPlaneGuide) galacticPlaneGuide.visible = showGalacticPlaneInput.checked;
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', () => {
  if (snapshotTimer != null) window.clearInterval(snapshotTimer);
  if (viewer) viewer.dispose().catch((err) => console.error('[dust-roam] cleanup failed', err));
});

snapshotTimer = window.setInterval(renderSnapshot, 500);
renderSnapshot();
mountViewer().catch((error) => {
  statusValue.textContent = 'error';
  if (snapshotValue) snapshotValue.textContent = error.stack ?? error.message;
  console.error('[dust-roam] initial mount failed', error);
});
