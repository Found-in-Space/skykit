function normalizePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function normalizePoint(point) {
  if (!point || typeof point !== 'object') {
    return null;
  }
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return { x, y, z };
}

function lengthPc(point) {
  return point ? Math.hypot(point.x, point.y, point.z) : 0;
}

function nodeMaxDistancePc(node, observerPc) {
  if (!node || typeof node !== 'object' || !observerPc) {
    return null;
  }

  const bounds = node.bounds;
  if (bounds && typeof bounds === 'object') {
    const xs = [bounds.minX, bounds.maxX];
    const ys = [bounds.minY, bounds.maxY];
    const zs = [bounds.minZ, bounds.maxZ];
    if (xs.every(Number.isFinite) && ys.every(Number.isFinite) && zs.every(Number.isFinite)) {
      let maxDistance = 0;
      for (const x of xs) {
        for (const y of ys) {
          for (const z of zs) {
            const distance = Math.hypot(x - observerPc.x, y - observerPc.y, z - observerPc.z);
            if (distance > maxDistance) {
              maxDistance = distance;
            }
          }
        }
      }
      return maxDistance;
    }
  }

  const centerX = Number(node.centerX);
  const centerY = Number(node.centerY);
  const centerZ = Number(node.centerZ);
  if (Number.isFinite(centerX) && Number.isFinite(centerY) && Number.isFinite(centerZ)) {
    const centerDistance = Math.hypot(
      centerX - observerPc.x,
      centerY - observerPc.y,
      centerZ - observerPc.z,
    );
    const halfSize = Number(node.halfSize);
    if (Number.isFinite(halfSize) && halfSize > 0) {
      return centerDistance + Math.sqrt(3) * halfSize;
    }
    return centerDistance;
  }

  const hintedDistance = Number(node.maxDistancePc ?? node.distancePc);
  if (Number.isFinite(hintedDistance) && hintedDistance >= 0) {
    return hintedDistance;
  }

  return null;
}

function selectionFarthestDistancePc(selection, observerPc) {
  const nodes = Array.isArray(selection?.nodes) ? selection.nodes : [];
  let farthestNodeDistancePc = 0;

  for (const node of nodes) {
    const nodeDistance = nodeMaxDistancePc(node, observerPc);
    if (Number.isFinite(nodeDistance) && nodeDistance > farthestNodeDistancePc) {
      farthestNodeDistancePc = nodeDistance;
    }
  }

  const meta = selection?.meta && typeof selection.meta === 'object' ? selection.meta : null;
  const metaCandidates = [
    meta?.farthestVisibleDistancePc,
    meta?.maxVisibleDistancePc,
    meta?.maxDistancePc,
  ].filter((value) => Number.isFinite(value) && value >= 0);

  if (metaCandidates.length > 0) {
    farthestNodeDistancePc = Math.max(farthestNodeDistancePc, ...metaCandidates);
  }

  return farthestNodeDistancePc;
}

export function computeXrDepthRange(options = {}) {
  const near = normalizePositive(options.near, 0.25);
  const metersPerParsec = normalizePositive(options.metersPerParsec, 1.0);
  const margin = normalizePositive(options.marginFactor, 1.2);
  const minFar = normalizePositive(options.minFar, 100);
  const maxFar = normalizePositive(options.maxFar, 2_000_000);
  const observerPc = normalizePoint(options.observerPc) ?? { x: 0, y: 0, z: 0 };

  const farthestSelectionPc = selectionFarthestDistancePc(options.selection, observerPc);
  const constellationRadiusPc = options.includeConstellationSphere
    ? normalizePositive(options.constellationSphereRadiusPc, 0)
    : 0;
  const farthestConstellationPc = constellationRadiusPc > 0
    ? lengthPc(observerPc) + constellationRadiusPc
    : 0;

  const requiredDistancePc = Math.max(farthestSelectionPc, farthestConstellationPc, near / metersPerParsec);
  const unclampedFar = requiredDistancePc * metersPerParsec * margin;
  const far = Math.min(maxFar, Math.max(minFar, unclampedFar));

  return {
    near,
    far,
    depthNear: near,
    depthFar: far,
    telemetry: {
      near,
      far,
      requiredDistancePc,
      metersPerParsec,
      marginFactor: margin,
      unclampedFar,
      minFar,
      maxFar,
      capApplied: far === maxFar && unclampedFar > maxFar,
      minClampApplied: far === minFar && unclampedFar < minFar,
      observerPc,
      farthestSelectionPc,
      farthestConstellationPc,
      constellationSphereRadiusPc: constellationRadiusPc,
      includeConstellationSphere: options.includeConstellationSphere === true,
      selectedNodeCount: Array.isArray(options.selection?.nodes) ? options.selection.nodes.length : 0,
    },
  };
}
