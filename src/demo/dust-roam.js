import * as THREE from 'three';
import { loadDustMapNgVolume } from '../dust/load-dust-map-ng.js';
import { DEFAULT_DUST_MAP_NG_URL } from '../found-in-space-dataset.js';
import { SCALE } from '../services/octree/scene-scale.js';
import {
  createCameraRigController,
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

// ── Constants ───────────────────────────────────────────────────────────────

const DUST_SCALE = SCALE;
/** Ray-march sample cap: GLSL loop bound and default `uSteps` (must match). */
const DUST_VOLUME_RAYMARCH_STEPS = 64;
/** Column τ above this maps to saturated false-colour (same τ definition as star extinction). */
const TAU_VIZ_MAX = 8.0;
const DEFAULT_ART_MANIFEST_URL = 'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';
const SOLAR_GALACTOCENTRIC_X_PC = 8200.0;

// ── Scene orientation ───────────────────────────────────────────────────────

const {
  icrsToScene: ICRS_TO_SCENE,
  sceneToIcrs: SCENE_TO_ICRS,
} = createSceneOrientationTransforms(ORION_CENTER_PC);

// ── Standard IAU ICRS ↔ Galactic rotation (Murray 1989) ─────────────────────
// A_G maps ICRS → Galactic:  (gx, gy, gz) = A_G · (ix, iy, iz)
// Transpose maps Galactic → ICRS.

const A_G = [
  [-0.0548755604, +0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, +0.7469822445, +0.4559837762],
];

function galacticToIcrs(gx, gy, gz) {
  return [
    A_G[0][0] * gx + A_G[1][0] * gy + A_G[2][0] * gz,
    A_G[0][1] * gx + A_G[1][1] * gy + A_G[2][1] * gz,
    A_G[0][2] * gx + A_G[1][2] * gy + A_G[2][2] * gz,
  ];
}

function galacticToDustScene(gx, gy, gz) {
  const [ix, iy, iz] = galacticToIcrs(gx, gy, gz);
  return ICRS_TO_SCENE(ix * DUST_SCALE, iy * DUST_SCALE, iz * DUST_SCALE);
}

function galactocentricMapToHeliocentric(gx, gy, gz) {
  return [gx + SOLAR_GALACTOCENTRIC_X_PC, gy, gz];
}

// ── Ray-marching volume shader ──────────────────────────────────────────────
// The box lives in local space aligned with Galactic axes.  The inverse model
// matrix converts world (scene) positions back to local space for UVW lookup.

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
  uniform float uMaxDensity;
  uniform float uKappa;
  uniform float uBrightness;
  uniform int uSteps;
  uniform int uMode;          // 0 = emissive, 1 = absorptive, 2 = column τ (same units as star extinction)

  uniform mat4 uInvModelMatrix;
  uniform vec3 uBoxSize;      // full box extent in local (model) space
  uniform float uSceneScale;  // world units per parsec (octree SCALE)
  uniform float uTauVizMax;   // τ mapped to full false-colour (typ. a few ×1)

  in vec3 vWorldPos;
  out vec4 fragColor;

  // False colour for dimensionless τ (low = cool/dark, high = hot)
  vec3 tauToRgb(float n) {
    n = clamp(n, 0.0, 1.0);
    vec3 c0 = vec3(0.04, 0.06, 0.14);
    vec3 c1 = vec3(0.12, 0.35, 0.92);
    vec3 c2 = vec3(0.18, 0.85, 0.42);
    vec3 c3 = vec3(0.98, 0.82, 0.12);
    vec3 c4 = vec3(0.95, 0.22, 0.08);
    if (n < 0.25) return mix(c0, c1, n / 0.25);
    if (n < 0.5) return mix(c1, c2, (n - 0.25) / 0.25);
    if (n < 0.75) return mix(c2, c3, (n - 0.5) / 0.25);
    return mix(c3, c4, (n - 0.75) / 0.25);
  }

  void main() {
    // Transform camera and fragment pos into local (Galactic-aligned) space
    vec3 localPos = (uInvModelMatrix * vec4(vWorldPos, 1.0)).xyz;
    vec3 localCam = (uInvModelMatrix * vec4(cameraPosition, 1.0)).xyz;
    vec3 rayDir   = normalize(localPos - localCam);

    // Ray-box intersection in local space (box centred at origin)
    vec3 halfSize = uBoxSize * 0.5;
    vec3 tMin = (-halfSize - localCam) / rayDir;
    vec3 tMax = ( halfSize - localCam) / rayDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar  = min(min(t2.x, t2.y), t2.z);

    if (tNear > tFar) discard;
    tNear = max(tNear, 0.0);

    float stepSize = (tFar - tNear) / float(uSteps);
    float stepSizePc = stepSize / max(uSceneScale, 1e-9);

    vec3 accColor = vec3(0.0);
    float transmittance = 1.0;
    float tauColumn = 0.0;

    for (int i = 0; i < ${DUST_VOLUME_RAYMARCH_STEPS}; i++) {
      if (i >= uSteps) break;

      float t = tNear + (float(i) + 0.5) * stepSize;
      vec3 pos = localCam + rayDir * t;

      // Local position → UVW  (box goes from -halfSize to +halfSize)
      vec3 uvw = pos / uBoxSize + 0.5;

      float raw = texture(uVolume, uvw).r;
      float density = raw * uMaxDensity;

      if (uMode == 2) {
        // Same differential τ as star-field computeDustTau: raw * kappa * Δs_pc
        if (raw > 0.0) {
          tauColumn += raw * uKappa * stepSizePc;
        }
        continue;
      }

      if (density <= 0.0) continue;

      if (uMode == 0) {
        // Emissive: dust glows — brighter where denser
        float intensity = density * uKappa * stepSize * uBrightness;
        vec3 dustColor = mix(
          vec3(0.35, 0.45, 0.7),
          vec3(0.9, 0.75, 0.5),
          clamp(raw * 4.0, 0.0, 1.0)
        );
        accColor += transmittance * dustColor * intensity;
        transmittance *= exp(-density * uKappa * stepSize * 0.3);
      } else {
        // Absorptive: wavelength-dependent extinction (Rv ≈ 3.1 approximation)
        float tau = density * uKappa * stepSize;
        vec3 scattered = vec3(0.15, 0.08, 0.04) * density * uKappa * stepSize * uBrightness * 0.1;
        accColor += transmittance * scattered;
        transmittance *= exp(-tau);
      }

      if (transmittance < 0.01) break;
    }

    if (uMode == 2) {
      float tauDisp = tauColumn * uBrightness;
      float n = tauDisp / max(uTauVizMax, 1e-6);
      vec3 rgb = tauToRgb(n);
      float alpha = clamp(0.88 * smoothstep(0.0, 0.07, n), 0.0, 0.9);
      fragColor = vec4(rgb, alpha);
    } else {
      fragColor = vec4(accColor, 1.0 - transmittance);
    }
  }
`;

// ── Dust-aware star field material ──────────────────────────────────────────

const DUST_STAR_MAX_STEPS = 16;

function createDustExtinctionStarFieldMaterialProfile(options = {}) {
  const fallbackInvDustModelMatrix = options.invDustModelMatrix?.clone?.() ?? new THREE.Matrix4();
  const scratchInvDustMatrix = new THREE.Matrix4();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSizeMin: { value: options.sizeMin ?? 2.0 },
      uSizeMax: { value: options.sizeMax ?? 256.0 },
      uLinearScale: { value: options.linearScale ?? 12.0 },
      uScale: { value: options.scale ?? SCALE },
      uMagLimit: { value: options.magLimit ?? DEFAULT_MAG_LIMIT },
      uMagFadeRange: { value: options.magFadeRange ?? 3.0 },
      uExtinctionScale: { value: options.extinctionScale ?? 1.0 },
      uExposure: { value: options.exposure ?? 1.0 },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) },
      uDustVolume: { value: options.texture ?? null },
      uDustInvModelMatrix: { value: fallbackInvDustModelMatrix },
      uDustBoxSize: { value: options.boxSize ?? new THREE.Vector3(1, 1, 1) },
      uDustKappa: { value: options.getKappa?.() ?? 0.005 },
      uDustAttenuationMix: { value: options.getAttenuationMix?.() ?? 0.0 },
      uDustRgbScale: { value: options.rgbScale ?? new THREE.Vector3(0.78, 1.0, 1.32) },
    },
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      in float teff_log8;
      in float magAbs;

      out vec3 vColor;
      out float vLuminance;

      uniform float uSizeMin;
      uniform float uSizeMax;
      uniform float uLinearScale;
      uniform float uScale;
      uniform float uMagLimit;
      uniform float uMagFadeRange;
      uniform float uExtinctionScale;
      uniform float uExposure;
      uniform vec3 uCameraPosition;

      uniform sampler3D uDustVolume;
      uniform mat4 uDustInvModelMatrix;
      uniform vec3 uDustBoxSize;
      uniform float uDustKappa;
      uniform float uDustAttenuationMix;
      uniform vec3 uDustRgbScale;

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

      float computeDustTau(vec3 startWorld, vec3 endWorld) {
        if (uDustAttenuationMix <= 0.0) return 0.0;

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
        float tau = 0.0;

        for (int i = 0; i < ${DUST_STAR_MAX_STEPS}; i++) {
          float t = tNear + (float(i) + 0.5) * (tFar - tNear) / float(${DUST_STAR_MAX_STEPS});
          vec3 pos = localStart + rayDir * t;
          vec3 uvw = pos / uDustBoxSize + 0.5;
          float dust = texture(uDustVolume, uvw).r;
          tau += dust * uDustKappa * stepSizePc;
        }

        return tau;
      }

      void main() {
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        float d = length(worldPos - uCameraPosition);
        float dPc = max(d / uScale, 0.001);
        float mApp = magAbs + uExtinctionScale * (5.0 * log(dPc) / log(10.0) - 5.0);

        float tau = computeDustTau(uCameraPosition, worldPos);
        vec3 transmittance = exp(-tau * uDustRgbScale);
        vec3 starColor = blackbodyToRGB(decodeTemperature(teff_log8));
        vColor = mix(starColor, starColor * transmittance, uDustAttenuationMix);

        float brightnessTransmittance = dot(transmittance, vec3(0.2126, 0.7152, 0.0722));
        float relativeFlux = pow(10.0, 0.4 * (uMagLimit - mApp));
        float energy = relativeFlux * uExposure * mix(1.0, brightnessTransmittance, uDustAttenuationMix);

        float rawRadius = sqrt(max(energy, 0.0)) * uLinearScale;

        float luminance;
        float radius;
        if (rawRadius < uSizeMin) {
          luminance = (rawRadius * rawRadius * rawRadius) /
                      (uSizeMin * uSizeMin * uSizeMin);
          radius = uSizeMin;
          if (luminance < 0.03) {
            luminance = 0.0;
            radius = 0.0;
          }
        } else {
          luminance = 1.0;
          float maxLinear = 8.0;
          if (rawRadius > maxLinear) {
            radius = maxLinear + sqrt(1.0 + rawRadius - maxLinear) - 1.0;
          } else {
            radius = rawRadius;
          }
        }

        gl_PointSize = clamp(radius, uSizeMin, uSizeMax);

        float edgeFade = 1.0 - smoothstep(uMagLimit - uMagFadeRange, uMagLimit, mApp);
        vLuminance = luminance * edgeFade;

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
        : options.exposure ?? 1.0;
      material.uniforms.uDustKappa.value = options.getKappa?.() ?? 0.005;
      material.uniforms.uDustAttenuationMix.value = options.getAttenuationMix?.() ?? 0.0;
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
  const [cenHelioX, cenHelioY, cenHelioZ] = galactocentricMapToHeliocentric(
    cenGalX,
    cenGalY,
    cenGalZ,
  );
  const basisX = galacticToDustScene(1, 0, 0).map((v) => v / DUST_SCALE);
  const basisY = galacticToDustScene(0, 1, 0).map((v) => v / DUST_SCALE);
  const basisZ = galacticToDustScene(0, 0, 1).map((v) => v / DUST_SCALE);
  const [cx, cy, cz] = galacticToDustScene(cenHelioX, cenHelioY, cenHelioZ);

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
      uMaxDensity: { value: maxDensity },
      uKappa: { value: dustRenderState.kappa },
      uBrightness: { value: 1.0 },
      uSteps: { value: DUST_VOLUME_RAYMARCH_STEPS },
      uMode: { value: 0 },
      uInvModelMatrix: { value: invModelMatrix },
      uBoxSize: { value: placement.boxSize },
      uSceneScale: { value: SCALE },
      uTauVizMax: { value: TAU_VIZ_MAX },
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

// ── Helpers (from free-fly) ─────────────────────────────────────────────────

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
const kappaInput = document.querySelector('[data-kappa]');
const kappaValueSpan = document.querySelector('[data-kappa-value]');
const brightnessInput = document.querySelector('[data-brightness]');
const brightnessValueSpan = document.querySelector('[data-brightness-value]');
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
let activeMagLimit = Number.isFinite(Number(magLimitInput?.value)) ? Number(magLimitInput.value) : 6.5;
const dustRenderState = {
  mode: modeSelect?.value ?? 'emissive',
  kappa: Number(kappaInput?.value) || 0.005,
};
let warmState = { bootstrap: 'idle', rootShard: 'idle', meta: 'idle' };

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
    dustScaleSpan.textContent = `${activeVoxelInfo.format}/${activeVoxelInfo.frame}, emissive ${DUST_VOLUME_RAYMARCH_STEPS} steps`;
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
  const { mode } = dustRenderState;
  const isAbsorptive = mode === 'absorptive';
  const isTauViz = mode === 'optical-depth';
  if (volumeMesh) {
    volumeMesh.visible = !isAbsorptive;
    if (isAbsorptive) {
      volumeMesh.material.uniforms.uMode.value = 1;
    } else if (isTauViz) {
      volumeMesh.material.uniforms.uMode.value = 2;
    } else {
      volumeMesh.material.uniforms.uMode.value = 0;
    }
  }
  if (viewer?.runtime?.renderOnce) {
    viewer.runtime.renderOnce();
  }
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
      createStarFieldLayer({
        id: 'dust-roam-star-field',
        positionTransform: ICRS_TO_SCENE,
        materialFactory: () => createDustExtinctionStarFieldMaterialProfile({
          texture: voxelInfo.texture,
          boxSize: dustStarPlacement.boxSize,
          invDustModelMatrix: dustStarPlacement.invModelMatrix,
          getDustMesh: () => volumeMesh,
          getKappa: () => dustRenderState.kappa,
          getAttenuationMix: () => (dustRenderState.mode === 'absorptive' ? 1.0 : 0.0),
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
      }),
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

kappaInput?.addEventListener('input', () => {
  const v = Number(kappaInput.value);
  dustRenderState.kappa = v;
  if (kappaValueSpan) kappaValueSpan.textContent = v.toFixed(4);
  if (volumeMesh) volumeMesh.material.uniforms.uKappa.value = v;
  if (viewer?.runtime?.renderOnce) viewer.runtime.renderOnce();
});

brightnessInput?.addEventListener('input', () => {
  const v = Number(brightnessInput.value);
  if (brightnessValueSpan) brightnessValueSpan.textContent = v.toFixed(1);
  if (volumeMesh) volumeMesh.material.uniforms.uBrightness.value = v;
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
