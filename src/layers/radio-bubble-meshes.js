import * as THREE from 'three';
import { SCALE } from '../services/octree/scene-scale.js';

const LY_PER_PC = 3.2615637775591093;

/**
 * Create the radio-bubble mesh group: a semi-transparent fill sphere plus a
 * wireframe so the shell edge reads clearly from outside. Uses front faces
 * only so the shell is invisible when the camera is inside the sphere.
 * Centred on the scene origin (solar system origin in parsec space).
 *
 * @param {object} [options]
 * @param {number} [options.epochYear=1895]       Year of the first broadcast.
 * @param {number} [options.currentYear=2026]     Used to compute the shell radius.
 * @param {number} [options.fillColor=0x2299ff]   Fill sphere colour.
 * @param {number} [options.fillOpacity=0.05]     Fill sphere opacity.
 * @param {number} [options.wireColor=0x55ccff]   Wireframe colour.
 * @param {number} [options.wireOpacity=0.22]     Wireframe opacity.
 * @returns {{ group: THREE.Group, radiusPc: number, radiusLy: number }}
 */
export function createRadioBubbleMeshes(options = {}) {
  const epochYear = options.epochYear ?? 1895;
  const currentYear = options.currentYear ?? 2026;
  const fillColor = options.fillColor ?? 0x2299ff;
  const fillOpacity = options.fillOpacity ?? 0.05;
  const wireColor = options.wireColor ?? 0x55ccff;
  const wireOpacity = options.wireOpacity ?? 0.22;

  const radiusLy = currentYear - epochYear;
  const radiusPc = radiusLy / LY_PER_PC;
  const radiusScene = radiusPc * SCALE;

  const group = new THREE.Group();
  group.name = 'radio-bubble';

  const fillGeo = new THREE.SphereGeometry(radiusScene, 64, 32);
  const fillMat = new THREE.MeshBasicMaterial({
    color: fillColor,
    transparent: true,
    opacity: fillOpacity,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  group.add(new THREE.Mesh(fillGeo, fillMat));

  const wireGeo = new THREE.SphereGeometry(radiusScene, 36, 18);
  const wireMat = new THREE.MeshBasicMaterial({
    color: wireColor,
    transparent: true,
    opacity: wireOpacity,
    depthWrite: false,
    wireframe: true,
    side: THREE.FrontSide,
  });
  group.add(new THREE.Mesh(wireGeo, wireMat));

  return { group, radiusPc, radiusLy };
}
