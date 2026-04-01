import * as THREE from 'three';
import { aabbDistance, selectOctreeNodes } from '../fields/octree-selection.js';
import { SCALE } from '../services/octree/scene-scale.js';

/**
 * Create a loader that selects all octree nodes whose AABB overlaps a sphere,
 * then filters individual stars by distance — giving a genuinely
 * volume-complete sample with no magnitude pruning.
 *
 * The returned geometry carries the same attributes as the star-field layer:
 * `position` (vec3, scene units), `teff_log8` (uint8 normalised), `magAbs` (float).
 *
 * The node-level AABB check is a coarse pass; the per-star distance check
 * removes stars whose node overlaps the sphere but whose actual position is
 * outside it (e.g. bright supergiants in large root-level nodes).
 *
 * @param {object} options
 * @param {object} options.datasetSession  Shared DatasetSession instance.
 * @returns {{ load, cancel }}
 */
export function createVolumeHRLoader({ datasetSession }) {
  let loadGeneration = 0;

  async function load({ observerPc, maxRadiusPc, maxLevel, onProgress }) {
    const generation = ++loadGeneration;
    const notify = typeof onProgress === 'function' ? onProgress : () => {};

    notify({ phase: 'selecting', starCount: 0, nodeCount: 0 });

    const context = { datasetSession };
    const result = await selectOctreeNodes(context, {
      maxLevel,
      predicate(node) {
        const d = aabbDistance(
          observerPc.x, observerPc.y, observerPc.z,
          node.geom.centerX, node.geom.centerY, node.geom.centerZ,
          node.geom.halfSize,
        );
        return { include: d <= maxRadiusPc };
      },
    });

    if (generation !== loadGeneration) return null;

    const nodes = result.nodes.filter((n) => n && n.payloadLength > 0);
    if (nodes.length === 0) {
      const empty = createEmptyResult();
      notify({ phase: 'done', ...empty });
      return empty;
    }

    notify({ phase: 'fetching', starCount: 0, nodeCount: nodes.length });

    const renderService = datasetSession.getRenderService();

    const decoded = [];
    let totalCount = 0;

    await renderService.fetchNodePayloadBatchProgressive(nodes, {
      onBatch(entries) {
        if (generation !== loadGeneration) return;
        for (const { node, buffer } of entries) {
          const d = renderService.decodePayload(buffer, node);
          decoded.push(d);
          totalCount += d.count;
        }
        notify({ phase: 'fetching', starCount: totalCount, nodeCount: nodes.length });
      },
    });

    if (generation !== loadGeneration) return null;

    // Per-star distance filter.  Decoded positions are in scene units
    // (parsecs × SCALE), so compare in scene-unit space.
    const oxSU = observerPc.x * SCALE;
    const oySU = observerPc.y * SCALE;
    const ozSU = observerPc.z * SCALE;
    const maxDist2 = (maxRadiusPc * SCALE) ** 2;

    // Allocate at the decoded (unfiltered) size; setDrawRange trims later.
    const positions = new Float32Array(totalCount * 3);
    const teffLog8 = new Uint8Array(totalCount);
    const magAbs = new Float32Array(totalCount);

    let accepted = 0;
    for (const d of decoded) {
      for (let i = 0; i < d.count; i++) {
        const px = d.positions[i * 3];
        const py = d.positions[i * 3 + 1];
        const pz = d.positions[i * 3 + 2];
        const dx = px - oxSU;
        const dy = py - oySU;
        const dz = pz - ozSU;
        if (dx * dx + dy * dy + dz * dz <= maxDist2) {
          positions[accepted * 3] = px;
          positions[accepted * 3 + 1] = py;
          positions[accepted * 3 + 2] = pz;
          teffLog8[accepted] = d.teffLog8[i];
          magAbs[accepted] = d.magAbs[i];
          accepted++;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('teff_log8', new THREE.Uint8BufferAttribute(teffLog8, 1, true));
    geometry.setAttribute('magAbs', new THREE.BufferAttribute(magAbs, 1));
    geometry.setDrawRange(0, accepted);

    const out = {
      geometry,
      starCount: accepted,
      nodeCount: nodes.length,
      decodedStarCount: totalCount,
      stats: result.stats,
    };

    notify({ phase: 'done', ...out });
    return out;
  }

  function cancel() {
    loadGeneration += 1;
  }

  return { load, cancel };
}

function createEmptyResult() {
  return {
    geometry: new THREE.BufferGeometry(),
    starCount: 0,
    nodeCount: 0,
    stats: null,
  };
}
