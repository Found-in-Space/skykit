import * as THREE from 'three';
import {
  createConstellationArtGroup,
  disposeConstellationArtGroup,
} from '../constellations/stellarium-constellation-art.js';
import { identityIcrsToSceneTransform } from './scene-orientation.js';

export function createConstellationArtLayer(options = {}) {
  const group = new THREE.Group();
  group.name = options.id ?? 'constellation-art-layer';
  const transformDirection = options.transformDirection ?? identityIcrsToSceneTransform;
  let artGroup = null;
  let meshes = [];

  async function buildGroup() {
    artGroup = await createConstellationArtGroup({
      ...options,
      transformDirection,
      id: `${group.name}-group`,
    });
    meshes = [...artGroup.children];
    for (const mesh of meshes) {
      group.add(mesh);
    }
  }

  return {
    id: group.name,
    getStats() {
      return {
        meshCount: meshes.length,
      };
    },
    async attach({ mount }) {
      mount.add(group);
      await buildGroup();
    },
    dispose({ mount }) {
      mount.remove(group);
      disposeConstellationArtGroup(artGroup);
      artGroup = null;
      meshes = [];
    },
  };
}
