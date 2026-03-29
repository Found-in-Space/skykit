import * as THREE from 'three';

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createStarPositions(count, radius, seed) {
  const random = createSeededRandom(seed);
  const positions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const r = radius * (0.35 + random() * 0.65);
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    const offset = index * 3;

    positions[offset] = r * Math.sin(phi) * Math.cos(theta);
    positions[offset + 1] = r * Math.cos(phi) * 0.45;
    positions[offset + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  return positions;
}

export function createMinimalSceneLayer(options = {}) {
  const group = new THREE.Group();
  group.name = options.id ?? 'minimal-scene-layer';
  let previousFog = null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(
    createStarPositions(options.count ?? 128, options.radius ?? 8, options.seed ?? 42),
    3,
  ));

  const pointsMaterial = new THREE.PointsMaterial({
    color: options.starColor ?? 0xf8fbff,
    size: options.pointSize ?? 0.07,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, pointsMaterial);
  group.add(points);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(options.shellRadius ?? 0.8, 1),
    new THREE.MeshBasicMaterial({
      color: options.shellColor ?? 0x4dc6ff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    }),
  );
  group.add(shell);

  const axes = new THREE.AxesHelper(options.axesSize ?? 1.4);
  const axesMaterials = Array.isArray(axes.material) ? axes.material : [axes.material];
  for (const material of axesMaterials) {
    material.transparent = true;
    material.opacity = 0.45;
  }
  group.add(axes);

  return {
    id: group.name,
    attach({ mount, scene }) {
      mount.add(group);
      previousFog = scene.fog ?? null;
      scene.fog = new THREE.FogExp2(options.fogColor ?? 0x02040b, options.fogDensity ?? 0.04);
    },
    update({ frame }) {
      const speed = options.rotationSpeed ?? 0.12;
      group.rotation.y += frame.deltaSeconds * speed;
      shell.rotation.x += frame.deltaSeconds * speed * 0.5;
      shell.rotation.z += frame.deltaSeconds * speed * 0.35;
    },
    dispose({ mount, scene }) {
      mount.remove(group);
      scene.fog = previousFog;
      previousFog = null;

      geometry.dispose();
      pointsMaterial.dispose();
      shell.geometry.dispose();
      shell.material.dispose();
      for (const material of axesMaterials) {
        material.dispose();
      }
    },
  };
}
