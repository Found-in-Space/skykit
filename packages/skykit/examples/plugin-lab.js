import * as THREE from 'three';

import { createObject3dPlugin } from '@found-in-space/skykit';

/**
 * A deliberately tiny plugin example: learners can change the count, speed,
 * material, or update function without touching SkyKit internals.
 *
 * @param {{
 *   count?: number;
 *   bounds?: number;
 *   speed?: number;
 *   color?: THREE.ColorRepresentation;
 * }} [options]
 */
export function createFallingMarkersPlugin(options = {}) {
  const count = Math.max(1, Math.floor(options.count ?? 64));
  const bounds = Math.max(1, options.bounds ?? 8);
  const speed = Math.max(0, options.speed ?? 1.5);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * bounds;
    positions[i * 3 + 1] = Math.random() * bounds;
    positions[i * 3 + 2] = (Math.random() - 0.5) * bounds;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: options.color ?? 0x88ccff,
    size: 0.06,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'falling-markers';

  const plugin = createObject3dPlugin({
    id: 'falling-markers',
    object3d: points,
    disposeObject: true,
  });

  const baseSetup = plugin.setup.bind(plugin);
  plugin.setup = (context) => {
    baseSetup(context);
    context.addPart({
      id: 'falling-markers-animation',
      update(frame) {
        for (let i = 0; i < count; i += 1) {
          const yIndex = i * 3 + 1;
          positions[yIndex] -= speed * frame.deltaSeconds;
          if (positions[yIndex] < -bounds * 0.5) {
            positions[yIndex] = bounds * 0.5;
          }
        }
        geometry.attributes.position.needsUpdate = true;
      },
      getSnapshot() {
        return { count, bounds, speed };
      },
    });
  };

  return plugin;
}
