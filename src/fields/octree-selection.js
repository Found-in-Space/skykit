import {
  HAS_PAYLOAD,
  IS_FRONTIER,
  makeNodeKey,
  runtimeNodeGeometry,
} from '../services/octree/octree-file-service.js';

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function normalizeNonNegativeInteger(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function popcountBelow(mask, octant) {
  const subset = mask & ((1 << octant) - 1);
  let count = 0;
  for (let value = subset; value !== 0; value &= value - 1) {
    count += 1;
  }
  return count;
}

export function aabbDistance(x, y, z, centerX, centerY, centerZ, halfSize) {
  const dx = Math.max(Math.abs(x - centerX) - halfSize, 0);
  const dy = Math.max(Math.abs(y - centerY) - halfSize, 0);
  const dz = Math.max(Math.abs(z - centerZ) - halfSize, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function loadRadiusForMagnitudeShell(halfSize, mDesired, mIndex) {
  return halfSize * 10 ** ((mDesired - mIndex) / 5);
}

export function evaluateMagnitudeShell(observerPc, nodeGeom, mDesired, mIndex) {
  const distancePc = aabbDistance(
    observerPc.x,
    observerPc.y,
    observerPc.z,
    nodeGeom.centerX,
    nodeGeom.centerY,
    nodeGeom.centerZ,
    nodeGeom.halfSize,
  );
  const loadRadiusPc = loadRadiusForMagnitudeShell(
    nodeGeom.halfSize,
    mDesired,
    mIndex,
  );

  return {
    distancePc,
    loadRadiusPc,
    inMagnitudeShell: distancePc <= loadRadiusPc,
  };
}

export function normalizePoint(value, fallback = null) {
  if (!value || typeof value !== 'object') {
    return clonePoint(fallback);
  }

  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);

  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return { x, y, z };
  }

  return clonePoint(fallback);
}

export function resolvePointSpec(spec, context, fallback = null) {
  if (typeof spec === 'function') {
    return normalizePoint(spec(context), fallback);
  }
  return normalizePoint(spec, fallback);
}

export function resolveNumberSpec(spec, context, fallback = null) {
  if (typeof spec === 'function') {
    const value = spec(context);
    return Number.isFinite(value) ? value : fallback;
  }
  return Number.isFinite(spec) ? spec : fallback;
}

export function createEmptySelectionStats() {
  return {
    rootEntryCount: 0,
    visitedNodeCount: 0,
    prunedNodeCount: 0,
    acceptedNodeCount: 0,
    selectedNodeCount: 0,
    frontierExpansionCount: 0,
    maxLevelVisited: null,
    maxLevelSelected: null,
  };
}

export async function selectOctreeNodes(context, options = {}) {
  const stats = createEmptySelectionStats();
  if (!context.datasetSession) {
    return {
      bootstrap: null,
      nodes: [],
      stats,
    };
  }

  if (typeof options.predicate !== 'function') {
    throw new TypeError('selectOctreeNodes() requires a predicate function');
  }

  const maxLevel = normalizeNonNegativeInteger(options.maxLevel, Number.POSITIVE_INFINITY);
  const renderService = context.datasetSession.getRenderService();
  const { bootstrap, rootShard } = await renderService.ensureBootstrapAndRootShard();
  const pending = [];
  const selectedNodes = [];

  for (let octant = 7; octant >= 0; octant -= 1) {
    const nodeIndex = rootShard.hdr.entryNodes[octant];
    if (nodeIndex > 0) {
      pending.push({
        shardOffset: bootstrap.rootShardOffset,
        nodeIndex,
      });
      stats.rootEntryCount += 1;
    }
  }

  while (pending.length > 0) {
    const next = pending.pop();
    const shard = next.shardOffset === bootstrap.rootShardOffset
      ? rootShard
      : await renderService.loadShard(next.shardOffset);
    const record = shard.readNode(next.nodeIndex);
    const geom = runtimeNodeGeometry(bootstrap.header, shard.hdr, record);
    const nodeKey = makeNodeKey(next.shardOffset, next.nodeIndex);
    const bounds = {
      minX: geom.centerX - geom.halfSize,
      minY: geom.centerY - geom.halfSize,
      minZ: geom.centerZ - geom.halfSize,
      maxX: geom.centerX + geom.halfSize,
      maxY: geom.centerY + geom.halfSize,
      maxZ: geom.centerZ + geom.halfSize,
    };

    stats.visitedNodeCount += 1;
    stats.maxLevelVisited = stats.maxLevelVisited == null
      ? geom.level
      : Math.max(stats.maxLevelVisited, geom.level);

    const decisionValue = await options.predicate({
      shard,
      shardOffset: next.shardOffset,
      nodeIndex: next.nodeIndex,
      nodeKey,
      record,
      geom,
      bounds,
    }, {
      bootstrap,
      renderService,
      context,
      stats,
    });

    const decision = typeof decisionValue === 'boolean'
      ? { include: decisionValue, meta: null }
      : decisionValue ?? { include: false, meta: null };

    if (!decision.include) {
      stats.prunedNodeCount += 1;
      continue;
    }

    stats.acceptedNodeCount += 1;

    if ((record.flags & HAS_PAYLOAD) && record.payloadLength > 0) {
      selectedNodes.push({
        ...(decision.meta && typeof decision.meta === 'object' ? decision.meta : {}),
        nodeKey,
        shardOffset: next.shardOffset,
        nodeIndex: next.nodeIndex,
        payloadOffset: record.payloadOffset,
        payloadLength: record.payloadLength,
        centerX: geom.centerX,
        centerY: geom.centerY,
        centerZ: geom.centerZ,
        halfSize: geom.halfSize,
        level: geom.level,
      });
      stats.maxLevelSelected = stats.maxLevelSelected == null
        ? geom.level
        : Math.max(stats.maxLevelSelected, geom.level);
    }

    if (geom.level >= maxLevel || record.childMask === 0) {
      continue;
    }

    if (record.flags & IS_FRONTIER) {
      const continuation = shard.readFrontierContinuation(next.nodeIndex);
      if (continuation === 0n) {
        continue;
      }

      stats.frontierExpansionCount += 1;
      const childShardOffset = Number(continuation);
      const childShard = await renderService.loadShard(childShardOffset);
      for (let octant = 7; octant >= 0; octant -= 1) {
        if ((record.childMask & (1 << octant)) === 0) {
          continue;
        }
        const childNodeIndex = childShard.hdr.entryNodes[octant];
        if (childNodeIndex > 0) {
          pending.push({
            shardOffset: childShardOffset,
            nodeIndex: childNodeIndex,
          });
        }
      }
      continue;
    }

    if (record.firstChild <= 0) {
      continue;
    }

    for (let octant = 7; octant >= 0; octant -= 1) {
      if ((record.childMask & (1 << octant)) === 0) {
        continue;
      }
      const childIndex = record.firstChild + popcountBelow(record.childMask, octant);
      if (childIndex > 0 && childIndex <= shard.hdr.nodeCount) {
        pending.push({
          shardOffset: next.shardOffset,
          nodeIndex: childIndex,
        });
      }
    }
  }

  if (typeof options.sortNodes === 'function') {
    selectedNodes.sort(options.sortNodes);
  }

  stats.selectedNodeCount = selectedNodes.length;

  return {
    bootstrap,
    nodes: selectedNodes,
    stats,
  };
}
