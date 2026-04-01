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

  const renderService = context.datasetSession.getRenderService();
  const { bootstrap, rootShard } = await renderService.ensureBootstrapAndRootShard();
  const octreeMaxLevel = normalizeNonNegativeInteger(bootstrap.header?.maxLevel, Number.POSITIVE_INFINITY);
  const requestedMaxLevel = normalizeNonNegativeInteger(options.maxLevel, Number.POSITIVE_INFINITY);
  const maxLevel = Math.min(requestedMaxLevel, octreeMaxLevel);
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
    const batch = pending.splice(0);

    const uniqueOffsets = new Set(batch.map((item) => item.shardOffset));
    const shardMap = new Map();
    const shardPromises = [];
    for (const offset of uniqueOffsets) {
      if (offset === bootstrap.rootShardOffset) {
        shardMap.set(offset, rootShard);
      } else {
        shardPromises.push(
          renderService.loadShard(offset).then((shard) => shardMap.set(offset, shard)),
        );
      }
    }
    if (shardPromises.length > 0) {
      await Promise.all(shardPromises);
    }

    const frontierShardOffsets = new Set();

    for (const next of batch) {
      const shard = shardMap.get(next.shardOffset);
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

      const decisionValue = options.predicate({
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
        frontierShardOffsets.add(childShardOffset);

        for (let octant = 7; octant >= 0; octant -= 1) {
          if ((record.childMask & (1 << octant)) === 0) {
            continue;
          }
          pending.push({
            shardOffset: childShardOffset,
            entryOctant: octant,
          });
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

    if (frontierShardOffsets.size > 0) {
      const prefetchPromises = [];
      for (const offset of frontierShardOffsets) {
        prefetchPromises.push(
          renderService.loadShard(offset).then((shard) => shardMap.set(offset, shard)),
        );
      }
      await Promise.all(prefetchPromises);

      const resolved = [];
      for (const item of pending) {
        if (item.entryOctant != null) {
          const shard = shardMap.get(item.shardOffset);
          const nodeIndex = shard.hdr.entryNodes[item.entryOctant];
          if (nodeIndex > 0) {
            resolved.push({ shardOffset: item.shardOffset, nodeIndex });
          }
        } else {
          resolved.push(item);
        }
      }
      pending.length = 0;
      pending.push(...resolved);
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
