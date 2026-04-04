import * as THREE from 'three';
import { createDefaultStarFieldMaterialProfile } from './star-field-materials.js';
import { identityIcrsToSceneTransform } from './scene-orientation.js';

function transformPositionsInPlace(positions, transformPoint) {
  if (typeof transformPoint !== 'function') {
    return positions;
  }

  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = transformPoint(
      positions[index],
      positions[index + 1],
      positions[index + 2],
    );
    positions[index] = x;
    positions[index + 1] = y;
    positions[index + 2] = z;
  }

  return positions;
}

function normalizeMaterialProfile(profile) {
  if (profile instanceof THREE.Material) {
    return {
      material: profile,
      haloMaterial: null,
      updateUniforms: null,
      dispose() {
        profile.dispose();
      },
    };
  }

  if (!profile?.material || !(profile.material instanceof THREE.Material)) {
    throw new TypeError('StarFieldLayer materialFactory must return a Material or { material } profile');
  }

  const haloMat = profile.haloMaterial instanceof THREE.Material
    ? profile.haloMaterial
    : null;

  return {
    material: profile.material,
    haloMaterial: haloMat,
    updateUniforms: typeof profile.updateUniforms === 'function' ? profile.updateUniforms : null,
    dispose: typeof profile.dispose === 'function'
      ? profile.dispose.bind(profile)
      : () => {
        profile.material.dispose();
        if (haloMat) haloMat.dispose();
      },
  };
}

function createSelectionSignature(selection) {
  const nodes = Array.isArray(selection?.nodes) ? selection.nodes : [];
  return nodes
    .map((node) => node?.nodeKey ?? `${node?.payloadOffset ?? 'none'}:${node?.payloadLength ?? 0}`)
    .join('|');
}

function createNodeRenderKey(node) {
  return node?.nodeKey ?? `${node?.payloadOffset ?? 'none'}:${node?.payloadLength ?? 0}`;
}

function clearGeometry(mesh, haloMesh) {
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }
  const empty = new THREE.BufferGeometry();
  mesh.geometry = empty;
  mesh.userData.pickMeta = [];
  if (haloMesh) {
    haloMesh.geometry = empty;
  }
}

function notifyCommit(options, payload) {
  if (typeof options.onCommit === 'function') {
    options.onCommit(payload);
  }
}

export function createStarFieldLayer(options = {}) {
  const group = new THREE.Group();
  group.name = options.id ?? 'star-field-layer';

  const transformPoint = options.positionTransform ?? identityIcrsToSceneTransform;
  const materialFactory = options.materialFactory ?? ((context) => createDefaultStarFieldMaterialProfile(context));
  const placeholderMaterial = new THREE.PointsMaterial();
  const points = new THREE.Points(new THREE.BufferGeometry(), placeholderMaterial);
  points.name = `${group.name}-points`;
  points.frustumCulled = false;
  group.add(points);

  let haloPoints = null;

  const cameraWorldPosition = new THREE.Vector3();
  let materialProfile = null;
  let bootstrap = null;
  let currentSelectionSignature = null;
  let loadGeneration = 0;
  let activeLoadPromise = null;
  let lastContext = null;
  let stats = {
    nodeCount: 0,
    starCount: 0,
    loadGeneration: 0,
  };

  async function ensureMaterialProfile(context) {
    if (materialProfile) {
      return materialProfile;
    }

    const resolved = await materialFactory({
      bootstrap,
      context,
      layerId: group.name,
      renderer: context.renderer,
      scene: context.scene,
    });
    materialProfile = normalizeMaterialProfile(resolved);
    if (points.material === placeholderMaterial) {
      placeholderMaterial.dispose();
    }
    points.material = materialProfile.material;

    if (materialProfile.haloMaterial && !haloPoints) {
      haloPoints = new THREE.Points(points.geometry, materialProfile.haloMaterial);
      haloPoints.name = `${group.name}-halo`;
      haloPoints.frustumCulled = false;
      group.add(haloPoints);
    }

    return materialProfile;
  }

  function applyMaterialUniforms(context) {
    if (!materialProfile?.updateUniforms) {
      return;
    }

    context.camera.getWorldPosition(cameraWorldPosition);
    materialProfile.updateUniforms({
      bootstrap,
      cameraWorldPosition,
      camera: context.camera,
      frame: context.frame ?? null,
      renderer: context.renderer,
      state: context.state ?? {},
      layer: api,
    });
  }

  function decodeEntries(entries, renderService) {
    const decodedByNodeKey = new Map();

    for (const { node, buffer } of entries) {
      const decoded = renderService.decodePayload(buffer, node);
      transformPositionsInPlace(decoded.positions, transformPoint);
      decodedByNodeKey.set(createNodeRenderKey(node), decoded);
    }

    return decodedByNodeKey;
  }

  function commitDecodedGeometry(context, nodes, decodedByNodeKey, generation) {
    if (generation !== loadGeneration) {
      return null;
    }

    const segments = [];
    let totalCount = 0;

    for (const node of nodes) {
      const decoded = decodedByNodeKey.get(createNodeRenderKey(node));
      if (!decoded) {
        continue;
      }

      segments.push({ node, decoded });
      totalCount += decoded.count;
    }

    if (generation !== loadGeneration) {
      return null;
    }

    const positions = new Float32Array(totalCount * 3);
    const teffLog8 = new Uint8Array(totalCount);
    const magAbs = new Float32Array(totalCount);
    const pickMeta = [];

    let offset = 0;
    for (const { node, decoded } of segments) {
      positions.set(decoded.positions, offset * 3);
      teffLog8.set(decoded.teffLog8, offset);
      magAbs.set(decoded.magAbs, offset);

      if (options.includePickMeta === true) {
        for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
          pickMeta.push({
            nodeKey: createNodeRenderKey(node),
            ordinal,
            level: node.level,
            centerX: node.centerX,
            centerY: node.centerY,
            centerZ: node.centerZ,
          });
        }
      }

      offset += decoded.count;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('teff_log8', new THREE.Uint8BufferAttribute(teffLog8, 1, true));
    geometry.setAttribute('magAbs', new THREE.BufferAttribute(magAbs, 1));
    geometry.computeBoundingSphere();

    if (points.geometry) {
      points.geometry.dispose();
    }
    points.geometry = geometry;
    if (haloPoints) {
      haloPoints.geometry = geometry;
    }
    points.userData.pickMeta = pickMeta;
    stats = {
      nodeCount: segments.length,
      starCount: totalCount,
      loadGeneration: generation,
    };

    notifyCommit(options, {
      geometry,
      positions,
      teffLog8,
      magAbs,
      starCount: totalCount,
      loadGeneration: generation,
    });
    applyMaterialUniforms(context);
    context.runtime.renderOnce();
    return geometry;
  }

  async function rebuildGeometry(context) {
    const { datasetSession, selection } = context;
    const selectionSignature = createSelectionSignature(selection);
    if (selectionSignature === currentSelectionSignature && activeLoadPromise) {
      return activeLoadPromise;
    }

    currentSelectionSignature = selectionSignature;
    const generation = ++loadGeneration;
    stats.loadGeneration = generation;

    if (!datasetSession) {
      stats = { nodeCount: 0, starCount: 0, loadGeneration: generation };
      clearGeometry(points, haloPoints);
      return null;
    }

    const nodes = Array.isArray(selection?.nodes)
      ? selection.nodes.filter((node) => node && node.payloadLength > 0)
      : [];
    if (nodes.length === 0) {
      stats = { nodeCount: 0, starCount: 0, loadGeneration: generation };
      clearGeometry(points, haloPoints);
      return null;
    }

    const loadPromise = (async () => {
      const renderService = datasetSession.getRenderService();
      bootstrap = await datasetSession.ensureRenderBootstrap();
      await ensureMaterialProfile(context);

      const useProgressive = options.progressive === true || stats.starCount === 0;
      if (useProgressive && typeof renderService.fetchNodePayloadBatchProgressive === 'function') {
        const decodedByNodeKey = new Map();
        await renderService.fetchNodePayloadBatchProgressive(nodes, {
          onBatch: (entries) => {
            if (generation !== loadGeneration) {
              return;
            }

            for (const [nodeKey, decoded] of decodeEntries(entries, renderService).entries()) {
              decodedByNodeKey.set(nodeKey, decoded);
            }

            commitDecodedGeometry(context, nodes, decodedByNodeKey, generation);
          },
        });

        if (generation !== loadGeneration) {
          return null;
        }

        return points.geometry;
      }

      const decodedPayloads = await renderService.fetchNodePayloadBatch(nodes);
      if (generation !== loadGeneration) {
        return null;
      }

      return commitDecodedGeometry(
        context,
        nodes,
        decodeEntries(decodedPayloads, renderService),
        generation,
      );
    })().finally(() => {
      if (activeLoadPromise === loadPromise) {
        activeLoadPromise = null;
      }
    });

    activeLoadPromise = loadPromise;
    return loadPromise;
  }

  const api = {
    id: group.name,
    getStats() {
      return { ...stats };
    },
    getStarData() {
      const geometry = points.geometry;
      const positions = geometry?.getAttribute?.('position');
      const teffLog8 = geometry?.getAttribute?.('teff_log8');
      const magAbs = geometry?.getAttribute?.('magAbs');

      if (!positions || !teffLog8 || !magAbs) {
        return null;
      }

      const pickMeta = Array.isArray(points.userData.pickMeta)
        ? points.userData.pickMeta
        : [];

      return {
        positions: positions.array,
        teffLog8: teffLog8.array,
        magAbs: magAbs.array,
        starCount: stats.starCount,
        loadGeneration: stats.loadGeneration,
        pickMeta,
      };
    },
    async attach(context) {
      lastContext = context;
      bootstrap = context.datasetSession ? await context.datasetSession.ensureRenderBootstrap() : null;
      await ensureMaterialProfile(context);
      applyMaterialUniforms(context);
      context.mount.add(group);
    },
    async start(context) {
      lastContext = context;
      applyMaterialUniforms(context);
      void rebuildGeometry(context).catch((error) => {
        console.error('[StarFieldLayer] initial rebuild failed', error);
      });
    },
    update(context) {
      lastContext = context;
      applyMaterialUniforms(context);
      const nextSignature = createSelectionSignature(context.selection);
      if (!activeLoadPromise && nextSignature !== currentSelectionSignature) {
        void rebuildGeometry(context).catch((error) => {
          console.error('[StarFieldLayer] rebuild failed', error);
        });
      }
    },
    setMaterialProfile(profile) {
      const nextProfile = normalizeMaterialProfile(profile);

      if (materialProfile) {
        materialProfile.dispose();
      } else if (points.material === placeholderMaterial) {
        placeholderMaterial.dispose();
      }

      materialProfile = nextProfile;
      points.material = nextProfile.material;

      if (nextProfile.haloMaterial) {
        if (!haloPoints) {
          haloPoints = new THREE.Points(points.geometry, nextProfile.haloMaterial);
          haloPoints.name = `${group.name}-halo`;
          haloPoints.frustumCulled = false;
          group.add(haloPoints);
        } else {
          haloPoints.material = nextProfile.haloMaterial;
        }
      } else if (haloPoints) {
        group.remove(haloPoints);
        haloPoints = null;
      }

      if (lastContext) {
        applyMaterialUniforms(lastContext);
        lastContext.runtime.renderOnce();
      }
    },
    dispose(context) {
      loadGeneration += 1;
      if (points.geometry) {
        points.geometry.dispose();
      }
      context.mount.remove(group);
      if (materialProfile) {
        materialProfile.dispose();
        materialProfile = null;
      } else if (points.material === placeholderMaterial) {
        placeholderMaterial.dispose();
      }
      haloPoints = null;
    },
  };

  return api;
}
