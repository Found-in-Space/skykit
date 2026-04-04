import * as THREE from 'three';
import { DEFAULT_METERS_PER_PARSEC, SCALE } from '../services/octree/scene-scale.js';

export const DEFAULT_MAG_LIMIT = 6.5;
const DEFAULT_MAG_LIMIT_NEAR = 25.0;
const DEFAULT_MAG_FADE_RANGE = 3.0;
const DEFAULT_CARTOON_COLOR = 0xe7c26a;
const DEFAULT_CARTOON_CORE_COLOR = 0xfff3c7;
const DEFAULT_CARTOON_OUTLINE_COLOR = 0x6d4f1f;
const DEFAULT_CARTOON_SIZE_MIN = 2.2;
const DEFAULT_CARTOON_SIZE_MAX = 18.0;
const DEFAULT_NEAR_DISTANCE_LO = 4.0;
const DEFAULT_NEAR_DISTANCE_HI = 15.0;
const DEFAULT_SAFE_MIN_SIZE = 4.0;
const DEFAULT_SIZE_MIN = 1.0;
const DEFAULT_VR_EXPOSURE = 1e5;
const DEFAULT_VR_SIZE_MAX = 8.0;
const DEFAULT_VR_HYPERLOCAL_SIZE_MAX = 64.0;
const DEFAULT_VR_NEARFIELD_RADIUS_PC = 5.0;
const DEFAULT_VR_NEARFIELD_MIN_INTENSITY = 0.15;

function createCircleTexture() {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createVrStarFieldMaterialProfile(options = {}) {
  const texture = options.texture ?? createCircleTexture();
  const ownsTexture = options.texture == null;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSizeMin: { value: options.sizeMin ?? DEFAULT_SIZE_MIN },
      uSizeMax: { value: options.sizeMax ?? DEFAULT_VR_SIZE_MAX },
      uScale: { value: options.scale ?? DEFAULT_METERS_PER_PARSEC },
      uMagLimit: { value: options.magLimit ?? DEFAULT_MAG_LIMIT },
      uMagLimitNear: { value: options.magLimitNear ?? DEFAULT_MAG_LIMIT_NEAR },
      uNearDistanceLo: { value: options.nearDistanceLo ?? DEFAULT_NEAR_DISTANCE_LO },
      uNearDistanceHi: { value: options.nearDistanceHi ?? DEFAULT_NEAR_DISTANCE_HI },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) },
      uClipMargin: { value: options.clipMargin ?? 1.0 },
      uExposure: { value: options.exposure ?? DEFAULT_VR_EXPOSURE },
      uSafeMinSize: { value: options.safeMinSize ?? DEFAULT_SAFE_MIN_SIZE },
      uMagFadeRange: { value: options.magFadeRange ?? DEFAULT_MAG_FADE_RANGE },
      uExtinctionScale: { value: options.extinctionScale ?? 1.0 },
      uTime: { value: 0.0 },
      uHyperlocalSizeMax: { value: options.hyperlocalSizeMax ?? DEFAULT_VR_HYPERLOCAL_SIZE_MAX },
      uNearfieldRadiusPc: { value: options.nearfieldRadiusPc ?? DEFAULT_VR_NEARFIELD_RADIUS_PC },
      uNearfieldMinIntensity: { value: options.nearfieldMinIntensity ?? DEFAULT_VR_NEARFIELD_MIN_INTENSITY },
      map: { value: texture },
    },
    vertexShader: `
      attribute float teff_log8;
      attribute float magAbs;

      varying vec3 vColor;
      varying float vIntensity;
      varying float vCoronaStrength;

      uniform float uSizeMin;
      uniform float uSizeMax;
      uniform float uScale;
      uniform float uMagLimit;
      uniform float uMagLimitNear;
      uniform float uNearDistanceLo;
      uniform float uNearDistanceHi;
      uniform vec3 uCameraPosition;
      uniform float uClipMargin;
      uniform float uExposure;
      uniform float uSafeMinSize;
      uniform float uMagFadeRange;
      uniform float uExtinctionScale;
      uniform float uNearfieldRadiusPc;
      uniform float uNearfieldMinIntensity;
      uniform float uHyperlocalSizeMax;

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

      void main() {
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        float d = length(worldPos - uCameraPosition);
        float dPc = max(d / uScale, 0.001);
        float mApp = magAbs + uExtinctionScale * (5.0 * log(dPc) / log(10.0) - 5.0);

        float tempK = decodeTemperature(teff_log8);
        vColor = blackbodyToRGB(tempK);

        float t = smoothstep(uNearDistanceLo, uNearDistanceHi, dPc);
        float effectiveMagLimit = mix(uMagLimitNear, uMagLimit, t);
        float magDiff = effectiveMagLimit - mApp;
        float baseSize = pow(max(magDiff, 0.0), 1.2);

        float flux = pow(10.0, -0.4 * mApp);
        float rawEnergy = flux * uExposure;
        vIntensity = clamp(rawEnergy, 0.05, 1.0);

        float targetSize = baseSize + (flux * 0.5);
        float renderedSize = max(targetSize, uSafeMinSize);
        if (targetSize < uSafeMinSize) {
          float areaRatio = (targetSize * targetSize) / (uSafeMinSize * uSafeMinSize);
          vIntensity *= areaRatio;
        }

        float hyperlocalFade = 1.0 - smoothstep(0.5, 2.0, dPc);
        float inverseDistBoost = min(1.0 / max(dPc, 0.01), 8.0);
        renderedSize *= mix(1.0, inverseDistBoost, hyperlocalFade);
        float effectiveSizeMax = mix(uSizeMax, uHyperlocalSizeMax, hyperlocalFade);

        float closeFade = 1.0 - smoothstep(1.0, 3.0, dPc);
        renderedSize *= 1.0 + closeFade;
        gl_PointSize = min(renderedSize, effectiveSizeMax);
        vCoronaStrength = max(hyperlocalFade, closeFade * max(0.5, smoothstep(1000.0, 50000.0, rawEnergy)));

        float nearfieldFade = 1.0 - smoothstep(0.0, uNearfieldRadiusPc, dPc);
        vIntensity = max(vIntensity, uNearfieldMinIntensity * nearfieldFade);

        float edgeFade = 1.0 - smoothstep(effectiveMagLimit - uMagFadeRange, effectiveMagLimit, mApp);
        vIntensity *= edgeFade;

        vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        clipPos.xy *= uClipMargin;
        gl_Position = clipPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uTime;
      varying vec3 vColor;
      varying float vIntensity;
      varying float vCoronaStrength;

      void main() {
        if (vIntensity <= 0.0) discard;

        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;

        vec4 texColor = texture2D(map, gl_PointCoord);
        float core = exp(-dist * 8.0);
        float halo = texColor.a;

        vec3 finalColor = mix(vColor, vec3(1.0), core);
        float wispyCorona = vCoronaStrength * 0.6 * exp(-2.0 * dist) * (1.0 - smoothstep(0.05, 0.6, dist));
        wispyCorona *= (0.9 + 0.1 * sin(uTime * 2.0 + dist * 8.0));
        finalColor += vColor * wispyCorona;

        float starAlpha = min(halo + core + wispyCorona, 1.0) * vIntensity;
        gl_FragColor = vec4(finalColor, starAlpha);
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
      const {
        cameraWorldPosition = null,
        frame = null,
        state = {},
      } = context;

      if (cameraWorldPosition) {
        material.uniforms.uCameraPosition.value.copy(cameraWorldPosition);
      }

      material.uniforms.uScale.value = Number.isFinite(state.starFieldScale)
        ? state.starFieldScale
        : options.scale ?? DEFAULT_METERS_PER_PARSEC;
      material.uniforms.uExtinctionScale.value = Number.isFinite(state.starFieldExtinctionScale)
        ? state.starFieldExtinctionScale
        : options.extinctionScale ?? 1.0;
      material.uniforms.uMagLimit.value = Number.isFinite(state.mDesired)
        ? state.mDesired
        : options.magLimit ?? DEFAULT_MAG_LIMIT;
      material.uniforms.uExposure.value = Number.isFinite(state.starFieldExposure)
        ? state.starFieldExposure
        : options.exposure ?? DEFAULT_VR_EXPOSURE;
      material.uniforms.uTime.value = frame?.elapsedSeconds ?? 0;
    },
    dispose() {
      material.dispose();
      if (ownsTexture) {
        texture.dispose();
      }
    },
  };
}

const DEFAULT_TUNED_POINT_SIZE_MIN = 2.0;
const DEFAULT_TUNED_POINT_SIZE_MAX = 256.0;
const DEFAULT_TUNED_LINEAR_SCALE = 12.0;
export const DEFAULT_TUNED_EXPOSURE = 1;
const DEFAULT_TUNED_HALO_THRESHOLD = 10.0;
const DEFAULT_TUNED_HALO_SIZE = 80.0;
const DEFAULT_STAR_FIELD_PROFILE_SETTINGS = Object.freeze({
  magLimit: DEFAULT_MAG_LIMIT,
  magFadeRange: DEFAULT_MAG_FADE_RANGE,
  sizeMin: DEFAULT_TUNED_POINT_SIZE_MIN,
  sizeMax: DEFAULT_TUNED_POINT_SIZE_MAX,
  linearScale: DEFAULT_TUNED_LINEAR_SCALE,
  exposure: DEFAULT_TUNED_EXPOSURE,
  haloThreshold: DEFAULT_TUNED_HALO_THRESHOLD,
  haloSize: DEFAULT_TUNED_HALO_SIZE,
  extinctionScale: 1.0,
  scale: SCALE,
});

export const DEFAULT_STAR_FIELD_STATE = Object.freeze({
  starFieldScale: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.scale,
  starFieldExtinctionScale: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.extinctionScale,
  starFieldExposure: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.exposure,
  starFieldMagFadeRange: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.magFadeRange,
  starFieldSizeMin: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.sizeMin,
  starFieldSizeMax: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.sizeMax,
  starFieldLinearScale: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.linearScale,
  starFieldHaloThreshold: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.haloThreshold,
  starFieldHaloSize: DEFAULT_STAR_FIELD_PROFILE_SETTINGS.haloSize,
  mDesired: DEFAULT_MAG_LIMIT,
});

export const DEFAULT_XR_STAR_FIELD_STATE = Object.freeze({
  starFieldScale: DEFAULT_METERS_PER_PARSEC,
  starFieldExtinctionScale: 1.0,
  starFieldExposure: DEFAULT_VR_EXPOSURE,
  mDesired: DEFAULT_MAG_LIMIT,
});

function createBigHaloTexture() {
  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.08, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.06)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.015)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const TUNED_SHARED_VERTEX_HEADER = `
  attribute float teff_log8;
  attribute float magAbs;

  uniform float uScale;
  uniform float uMagLimit;
  uniform float uMagFadeRange;
  uniform float uExtinctionScale;
  uniform float uExposure;
  uniform vec3 uCameraPosition;

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

  void computeStarBase(out float mApp, out float energy, out vec3 color) {
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    float d = length(worldPos - uCameraPosition);
    float dPc = max(d / uScale, 0.001);
    mApp = magAbs + uExtinctionScale * (5.0 * log(dPc) / log(10.0) - 5.0);
    // Flux relative to the detection limit: a star AT the mag limit has
    // relativeFlux = 1.0; brighter stars scale up from there.
    float relativeFlux = pow(10.0, 0.4 * (uMagLimit - mApp));
    energy = relativeFlux * uExposure;
    color = blackbodyToRGB(decodeTemperature(teff_log8));
  }
`;

export function createTunedStarFieldMaterialProfile(options = {}) {
  const pointTexture = options.texture ?? createCircleTexture();
  const haloTexture = options.haloTexture ?? createBigHaloTexture();
  const ownsTextures = options.texture == null;

  const pointMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uSizeMin: { value: options.sizeMin ?? DEFAULT_TUNED_POINT_SIZE_MIN },
      uSizeMax: { value: options.sizeMax ?? DEFAULT_TUNED_POINT_SIZE_MAX },
      uLinearScale: { value: options.linearScale ?? DEFAULT_TUNED_LINEAR_SCALE },
      uScale: { value: options.scale ?? SCALE },
      uMagLimit: { value: options.magLimit ?? DEFAULT_MAG_LIMIT },
      uMagFadeRange: { value: options.magFadeRange ?? DEFAULT_MAG_FADE_RANGE },
      uExtinctionScale: { value: options.extinctionScale ?? 1.0 },
      uExposure: { value: options.exposure ?? DEFAULT_TUNED_EXPOSURE },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) },
      map: { value: pointTexture },
    },
    vertexShader: TUNED_SHARED_VERTEX_HEADER + `
      varying vec3 vColor;
      varying float vLuminance;

      uniform float uSizeMin;
      uniform float uSizeMax;
      uniform float uLinearScale;

      void main() {
        float mApp, energy;
        vec3 starColor;
        computeStarBase(mApp, energy, starColor);
        vColor = starColor;

        // Stellarium-style computeRCMag: energy → radius + luminance
        float rawRadius = sqrt(energy) * uLinearScale;

        float luminance;
        float radius;
        if (rawRadius < uSizeMin) {
          // Faint star: fix at minimum size, dim with cube law
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
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vLuminance;

      void main() {
        if (vLuminance <= 0.0) discard;

        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;

        vec4 texColor = texture2D(map, gl_PointCoord);
        float core = exp(-dist * 14.0);
        float halo = texColor.a;

        vec3 finalColor = mix(vColor, vec3(1.0), core);
        float starAlpha = min(halo + core, 1.0) * vLuminance;
        if (starAlpha < 0.01) discard;

        gl_FragColor = vec4(finalColor, starAlpha);
      }
    `,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: options.scale ?? SCALE },
      uMagLimit: { value: options.magLimit ?? DEFAULT_MAG_LIMIT },
      uMagFadeRange: { value: options.magFadeRange ?? DEFAULT_MAG_FADE_RANGE },
      uExtinctionScale: { value: options.extinctionScale ?? 1.0 },
      uExposure: { value: options.exposure ?? DEFAULT_TUNED_EXPOSURE },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) },
      uLinearScale: { value: options.linearScale ?? DEFAULT_TUNED_LINEAR_SCALE },
      uHaloThreshold: { value: options.haloThreshold ?? DEFAULT_TUNED_HALO_THRESHOLD },
      uHaloSize: { value: options.haloSize ?? DEFAULT_TUNED_HALO_SIZE },
      map: { value: haloTexture },
    },
    vertexShader: TUNED_SHARED_VERTEX_HEADER + `
      varying vec3 vColor;
      varying float vHaloAlpha;

      uniform float uLinearScale;
      uniform float uHaloThreshold;
      uniform float uHaloSize;

      void main() {
        float mApp, energy;
        vec3 starColor;
        computeStarBase(mApp, energy, starColor);
        vColor = starColor;

        float rawRadius = sqrt(energy) * uLinearScale;

        float edgeFade = 1.0 - smoothstep(uMagLimit - uMagFadeRange, uMagLimit, mApp);

        // Only visible for stars whose rawRadius exceeds the threshold
        float excess = rawRadius - uHaloThreshold;
        vHaloAlpha = clamp(excess / 30.0, 0.0, 1.0) * edgeFade;

        gl_PointSize = vHaloAlpha > 0.001 ? uHaloSize : 0.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vHaloAlpha;

      void main() {
        if (vHaloAlpha <= 0.0) discard;

        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;

        vec4 texColor = texture2D(map, gl_PointCoord);
        float alpha = texColor.a * vHaloAlpha;
        if (alpha < 0.003) discard;

        gl_FragColor = vec4(vColor * alpha, alpha);
      }
    `,
    transparent: true,
    alphaTest: 0.003,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  function syncUniforms(mat, state) {
    mat.uniforms.uScale.value = Number.isFinite(state.starFieldScale)
      ? state.starFieldScale
      : options.scale ?? SCALE;
    mat.uniforms.uExtinctionScale.value = Number.isFinite(state.starFieldExtinctionScale)
      ? state.starFieldExtinctionScale
      : options.extinctionScale ?? 1.0;
    mat.uniforms.uMagLimit.value = Number.isFinite(state.mDesired)
      ? state.mDesired
      : options.magLimit ?? DEFAULT_MAG_LIMIT;
    mat.uniforms.uMagFadeRange.value = Number.isFinite(state.starFieldMagFadeRange)
      ? state.starFieldMagFadeRange
      : options.magFadeRange ?? DEFAULT_MAG_FADE_RANGE;
    mat.uniforms.uExposure.value = Number.isFinite(state.starFieldExposure)
      ? state.starFieldExposure
      : options.exposure ?? DEFAULT_TUNED_EXPOSURE;

    if (mat.uniforms.uSizeMin) {
      mat.uniforms.uSizeMin.value = Number.isFinite(state.starFieldSizeMin)
        ? state.starFieldSizeMin
        : options.sizeMin ?? DEFAULT_TUNED_POINT_SIZE_MIN;
    }
    if (mat.uniforms.uSizeMax) {
      mat.uniforms.uSizeMax.value = Number.isFinite(state.starFieldSizeMax)
        ? state.starFieldSizeMax
        : options.sizeMax ?? DEFAULT_TUNED_POINT_SIZE_MAX;
    }
    if (mat.uniforms.uLinearScale) {
      mat.uniforms.uLinearScale.value = Number.isFinite(state.starFieldLinearScale)
        ? state.starFieldLinearScale
        : options.linearScale ?? DEFAULT_TUNED_LINEAR_SCALE;
    }
    if (mat.uniforms.uHaloThreshold) {
      mat.uniforms.uHaloThreshold.value = Number.isFinite(state.starFieldHaloThreshold)
        ? state.starFieldHaloThreshold
        : options.haloThreshold ?? DEFAULT_TUNED_HALO_THRESHOLD;
    }
    if (mat.uniforms.uHaloSize) {
      mat.uniforms.uHaloSize.value = Number.isFinite(state.starFieldHaloSize)
        ? state.starFieldHaloSize
        : options.haloSize ?? DEFAULT_TUNED_HALO_SIZE;
    }
  }

  return {
    material: pointMaterial,
    haloMaterial,
    updateUniforms(context = {}) {
      const { cameraWorldPosition = null, state = {} } = context;
      if (cameraWorldPosition) {
        pointMaterial.uniforms.uCameraPosition.value.copy(cameraWorldPosition);
        haloMaterial.uniforms.uCameraPosition.value.copy(cameraWorldPosition);
      }
      syncUniforms(pointMaterial, state);
      syncUniforms(haloMaterial, state);
    },
    dispose() {
      pointMaterial.dispose();
      haloMaterial.dispose();
      if (ownsTextures) {
        pointTexture.dispose();
        haloTexture.dispose();
      }
    },
  };
}

export function createDefaultStarFieldMaterialProfile(options = {}) {
  return createTunedStarFieldMaterialProfile({
    ...DEFAULT_STAR_FIELD_PROFILE_SETTINGS,
    ...options,
  });
}

export function createCartoonStarFieldMaterialProfile(options = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: options.scale ?? SCALE },
      uMagLimit: { value: options.magLimit ?? DEFAULT_MAG_LIMIT },
      uMagFadeRange: { value: options.magFadeRange ?? DEFAULT_MAG_FADE_RANGE },
      uExtinctionScale: { value: options.extinctionScale ?? 1.0 },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) },
      uSizeMin: { value: options.sizeMin ?? DEFAULT_CARTOON_SIZE_MIN },
      uSizeMax: { value: options.sizeMax ?? DEFAULT_CARTOON_SIZE_MAX },
      uColor: { value: new THREE.Color(options.color ?? DEFAULT_CARTOON_COLOR) },
      uCoreColor: { value: new THREE.Color(options.coreColor ?? DEFAULT_CARTOON_CORE_COLOR) },
      uOutlineColor: { value: new THREE.Color(options.outlineColor ?? DEFAULT_CARTOON_OUTLINE_COLOR) },
    },
    vertexShader: `
      attribute float magAbs;

      varying float vAlpha;
      varying float vTier;

      uniform float uScale;
      uniform float uMagLimit;
      uniform float uMagFadeRange;
      uniform float uExtinctionScale;
      uniform vec3 uCameraPosition;
      uniform float uSizeMin;
      uniform float uSizeMax;

      void main() {
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        float d = length(worldPos - uCameraPosition);
        float dPc = max(d / uScale, 0.001);
        float mApp = magAbs + uExtinctionScale * (5.0 * log(dPc) / log(10.0) - 5.0);

        float visibility = clamp((uMagLimit + 1.2 - mApp) / max(uMagFadeRange + 1.2, 0.001), 0.0, 1.0);
        float live = smoothstep(0.0, 0.06, visibility);
        float sizeWeight = pow(visibility, 1.85);
        float alphaWeight = pow(visibility, 0.72);
        float tier = floor(sizeWeight * 6.0 + 0.999);
        float normalizedTier = clamp(tier / 6.0, 0.0, 1.0);

        gl_PointSize = mix(uSizeMin, uSizeMax, normalizedTier);
        vAlpha = mix(0.48, 1.0, alphaWeight) * live;
        vTier = normalizedTier;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uCoreColor;
      uniform vec3 uOutlineColor;

      varying float vAlpha;
      varying float vTier;

      float sparkleShape(vec2 point, float thickness, float length) {
        float vertical = abs(point.x) / thickness + abs(point.y) / length;
        float horizontal = abs(point.y) / thickness + abs(point.x) / length;
        return min(vertical, horizontal);
      }

      void main() {
        if (vAlpha <= 0.0) discard;

        vec2 centered = (gl_PointCoord - vec2(0.5)) * 2.0;
        float thickness = mix(0.34, 0.11, vTier);
        float length = mix(0.58, 1.2, vTier);
        float shape = sparkleShape(centered, thickness, length);
        float body = 1.0 - smoothstep(0.96, 1.02, shape);
        if (body <= 0.0) discard;

        float outline = 1.0 - smoothstep(0.78, 0.92, shape);
        float core = 1.0 - smoothstep(0.0, 0.34, shape);
        float hollowMix = smoothstep(0.45, 0.85, vTier);
        float innerShape = sparkleShape(centered, thickness * 0.4, length * 0.42);
        float cutout = (1.0 - smoothstep(0.82, 0.96, innerShape)) * hollowMix;

        float alpha = body * vAlpha;
        alpha *= 1.0 - cutout * 0.92;

        if (alpha < 0.01) discard;

        vec3 color = mix(uColor, uOutlineColor, smoothstep(0.25, 0.95, shape));
        color = mix(color, uCoreColor, core * (1.0 - hollowMix * 0.55));
        color += uCoreColor * outline * 0.08;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  return {
    material,
    updateUniforms(context = {}) {
      const {
        cameraWorldPosition = null,
        state = {},
      } = context;

      if (cameraWorldPosition) {
        material.uniforms.uCameraPosition.value.copy(cameraWorldPosition);
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
    },
    dispose() {
      material.dispose();
    },
  };
}
