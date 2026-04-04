import * as THREE from 'three';
import {
  createConstellationArtGroup,
  disposeConstellationArtGroup,
} from '../constellations/constellation-art.js';
import { identityIcrsToSceneTransform } from './scene-orientation.js';

export function createConstellationArtLayer(options = {}) {
  const group = new THREE.Group();
  group.name = options.id ?? 'constellation-art-layer';
  const transformDirection = options.transformDirection ?? identityIcrsToSceneTransform;
  let fadeDurationSecs = Number.isFinite(options.fadeDurationSecs) && options.fadeDurationSecs >= 0
    ? Number(options.fadeDurationSecs)
    : 0.8;
  let baseOpacity = Number.isFinite(options.opacity) && options.opacity >= 0
    ? Number(options.opacity)
    : 0.22;
  let artGroup = null;
  let meshes = [];
  const meshesByIau = new Map();
  const targetOpacityByIau = new Map();

  function readMeshOpacity(mesh) {
    return Number(mesh?.material?.uniforms?.opacity?.value ?? 0);
  }

  function writeMeshOpacity(mesh, opacity) {
    if (mesh?.material?.uniforms?.opacity) {
      mesh.material.uniforms.opacity.value = opacity;
    }
  }

  function setTargetOpacity(iau, opacity) {
    if (!iau || !meshesByIau.has(iau)) {
      return;
    }
    targetOpacityByIau.set(iau, Math.max(0, Number(opacity) || 0));
  }

  async function buildGroup() {
    artGroup = await createConstellationArtGroup({
      ...options,
      transformDirection,
      id: `${group.name}-group`,
    });
    meshes = [...artGroup.children];
    for (const mesh of meshes) {
      const iau = mesh?.userData?.iau;
      if (iau) {
        meshesByIau.set(iau, mesh);
        targetOpacityByIau.set(iau, 0);
      }
      writeMeshOpacity(mesh, 0);
      group.add(mesh);
    }
  }

  return {
    id: group.name,
    show(iau) {
      setTargetOpacity(iau, baseOpacity);
    },
    hide(iau) {
      setTargetOpacity(iau, 0);
    },
    hideAll() {
      for (const iau of meshesByIau.keys()) {
        targetOpacityByIau.set(iau, 0);
      }
    },
    setOpacity(opacity) {
      if (!Number.isFinite(opacity) || opacity < 0) {
        return;
      }

      baseOpacity = Number(opacity);
      for (const [iau, targetOpacity] of targetOpacityByIau.entries()) {
        if (targetOpacity > 0) {
          targetOpacityByIau.set(iau, baseOpacity);
        }
      }
    },
    setFadeDurationSecs(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) {
        return;
      }
      fadeDurationSecs = Number(seconds);
    },
    getStats() {
      const visibleIaus = [];
      const fadingIaus = [];
      for (const [iau, mesh] of meshesByIau.entries()) {
        const current = readMeshOpacity(mesh);
        const target = Number(targetOpacityByIau.get(iau) ?? 0);
        if (current > 0.001) {
          visibleIaus.push(iau);
        }
        if (Math.abs(target - current) > 0.001) {
          fadingIaus.push(iau);
        }
      }
      return {
        meshCount: meshes.length,
        visibleIaus,
        fadingIaus,
      };
    },
    getConfig() {
      return {
        opacity: baseOpacity,
        fadeDurationSecs,
      };
    },
    async attach({ mount }) {
      mount.add(group);
      await buildGroup();
    },
    update(context) {
      const deltaSeconds = Number.isFinite(context?.frame?.deltaSeconds)
        ? Math.max(0, Number(context.frame.deltaSeconds))
        : 0;
      const blend = fadeDurationSecs > 0 ? Math.min(1, deltaSeconds / fadeDurationSecs) : 1;

      for (const [iau, mesh] of meshesByIau.entries()) {
        const current = readMeshOpacity(mesh);
        const target = Number(targetOpacityByIau.get(iau) ?? 0);
        if (Math.abs(target - current) < 1e-4) {
          writeMeshOpacity(mesh, target);
          continue;
        }
        writeMeshOpacity(mesh, current + (target - current) * blend);
      }
    },
    dispose({ mount }) {
      mount.remove(group);
      disposeConstellationArtGroup(artGroup);
      artGroup = null;
      meshes = [];
      meshesByIau.clear();
      targetOpacityByIau.clear();
    },
  };
}
