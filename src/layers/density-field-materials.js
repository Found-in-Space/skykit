import * as THREE from 'three';
import { SCALE } from '../services/octree/scene-scale.js';

export function createDensityFieldMaterialProfile(options = {}) {
  const pointSize = options.pointSize ?? 2.0;
  const alpha = options.alpha ?? 0.08;
  const color = new THREE.Color(options.color ?? 0xaaccff);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPointSize: { value: pointSize },
      uAlpha: { value: alpha },
      uColor: { value: color },
      uScale: { value: options.scale ?? SCALE },
      uCameraPosition: { value: new THREE.Vector3() },
    },
    vertexShader: `
      uniform float uPointSize;
      uniform float uScale;
      uniform vec3 uCameraPosition;

      varying float vDistPc;

      void main() {
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vDistPc = length(worldPos - uCameraPosition) / uScale;

        gl_PointSize = uPointSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uAlpha;
      uniform vec3 uColor;

      varying float vDistPc;

      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;

        float soft = smoothstep(0.5, 0.15, dist);
        gl_FragColor = vec4(uColor, uAlpha * soft);
      }
    `,
    transparent: true,
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
      if (Number.isFinite(state.densityPointSize)) {
        material.uniforms.uPointSize.value = state.densityPointSize;
      }
      if (Number.isFinite(state.densityAlpha)) {
        material.uniforms.uAlpha.value = state.densityAlpha;
      }
      material.uniforms.uScale.value = Number.isFinite(state.starFieldScale)
        ? state.starFieldScale
        : options.scale ?? SCALE;
    },
    dispose() {
      material.dispose();
    },
  };
}
