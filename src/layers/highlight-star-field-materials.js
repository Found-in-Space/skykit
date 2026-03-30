import * as THREE from 'three';
import { SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_MAG_LIMIT = 6.5;
const DEFAULT_MAG_FADE_RANGE = 3.0;
const DEFAULT_SIZE_MIN = 1.0;
const DEFAULT_SIZE_MAX = 20.0;
const DEFAULT_EXPOSURE = 80.0;

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

export function createHighlightStarFieldMaterialProfile(options = {}) {
  const texture = options.texture ?? createCircleTexture();
  const ownsTexture = options.texture == null;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSizeMin: { value: options.sizeMin ?? DEFAULT_SIZE_MIN },
      uSizeMax: { value: options.sizeMax ?? DEFAULT_SIZE_MAX },
      uScale: { value: options.scale ?? SCALE },
      uMagLimit: { value: options.magLimit ?? DEFAULT_MAG_LIMIT },
      uMagFadeRange: { value: options.magFadeRange ?? DEFAULT_MAG_FADE_RANGE },
      uExtinctionScale: { value: options.extinctionScale ?? 1.0 },
      uExposure: { value: options.exposure ?? DEFAULT_EXPOSURE },
      uCameraPosition: { value: new THREE.Vector3(0, 0, 0) },
      uHighlightEnabled: { value: options.highlightEnabled ? 1.0 : 0.0 },
      uHighlightTeffMin: { value: options.highlightTeffMin ?? 3000 },
      uHighlightTeffMax: { value: options.highlightTeffMax ?? 9000 },
      uHighlightMagAbsMin: { value: options.highlightMagAbsMin ?? -2.0 },
      uHighlightMagAbsMax: { value: options.highlightMagAbsMax ?? 15.0 },
      uHighlightColor: { value: new THREE.Color(options.highlightColor ?? 0x8cffb8) },
      map: { value: texture },
    },
    vertexShader: `
      attribute float teff_log8;
      attribute float magAbs;

      varying vec3 vColor;
      varying float vIntensity;
      varying float vHighlight;

      uniform float uSizeMin;
      uniform float uSizeMax;
      uniform float uScale;
      uniform float uMagLimit;
      uniform float uMagFadeRange;
      uniform float uExtinctionScale;
      uniform float uExposure;
      uniform vec3 uCameraPosition;
      uniform float uHighlightEnabled;
      uniform float uHighlightTeffMin;
      uniform float uHighlightTeffMax;
      uniform float uHighlightMagAbsMin;
      uniform float uHighlightMagAbsMax;

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

        float flux = pow(10.0, -0.4 * mApp);
        vIntensity = clamp(flux * uExposure, 0.02, 1.0);

        float magDiff = uMagLimit - mApp;
        float sizeFromMag = uSizeMin + pow(max(magDiff, 0.0), 1.15) * 1.4;
        gl_PointSize = clamp(sizeFromMag, uSizeMin, uSizeMax);

        float edgeFade = 1.0 - smoothstep(uMagLimit - uMagFadeRange, uMagLimit, mApp);
        vIntensity *= edgeFade;

        float inTeff = step(uHighlightTeffMin, tempK) * step(tempK, uHighlightTeffMax);
        float inMag = step(uHighlightMagAbsMin, magAbs) * step(magAbs, uHighlightMagAbsMax);
        vHighlight = (uHighlightEnabled > 0.5) ? inTeff * inMag : 0.0;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 uHighlightColor;
      varying vec3 vColor;
      varying float vIntensity;
      varying float vHighlight;

      void main() {
        if (vIntensity <= 0.0) discard;

        float dist = distance(gl_PointCoord, vec2(0.5));
        if (dist > 0.5) discard;

        vec4 texColor = texture2D(map, gl_PointCoord);
        float core = exp(-dist * 14.0);
        float halo = texColor.a;

        vec3 finalColor = mix(vColor, vec3(1.0), core);
        float ring = smoothstep(0.45, 0.2, dist) * smoothstep(0.2, 0.45, dist);
        finalColor += uHighlightColor * ring * vHighlight * 0.85;

        float starAlpha = min(halo + core, 1.0) * vIntensity;
        if (starAlpha < 0.01) discard;

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
      material.uniforms.uExposure.value = Number.isFinite(state.starFieldExposure)
        ? state.starFieldExposure
        : options.exposure ?? DEFAULT_EXPOSURE;

      material.uniforms.uHighlightEnabled.value = state.highlightEnabled ? 1.0 : (options.highlightEnabled ? 1.0 : 0.0);
      material.uniforms.uHighlightTeffMin.value = Number.isFinite(state.highlightTeffMin)
        ? state.highlightTeffMin
        : options.highlightTeffMin ?? 3000;
      material.uniforms.uHighlightTeffMax.value = Number.isFinite(state.highlightTeffMax)
        ? state.highlightTeffMax
        : options.highlightTeffMax ?? 9000;
      material.uniforms.uHighlightMagAbsMin.value = Number.isFinite(state.highlightMagAbsMin)
        ? state.highlightMagAbsMin
        : options.highlightMagAbsMin ?? -2.0;
      material.uniforms.uHighlightMagAbsMax.value = Number.isFinite(state.highlightMagAbsMax)
        ? state.highlightMagAbsMax
        : options.highlightMagAbsMax ?? 15.0;
      if (state.highlightColor) {
        material.uniforms.uHighlightColor.value.set(state.highlightColor);
      } else if (options.highlightColor != null) {
        material.uniforms.uHighlightColor.value.set(options.highlightColor);
      }
    },
    dispose() {
      material.dispose();
      if (ownsTexture) {
        texture.dispose();
      }
    },
  };
}
