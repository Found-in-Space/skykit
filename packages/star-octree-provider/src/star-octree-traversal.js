import {
  STAR_HAS_PAYLOAD,
  STAR_IS_FRONTIER,
} from './star-octree-format.js';
import { createStarCellKey } from '@found-in-space/star-trees';

/**
 * @typedef {import('./index.d.ts').StarOctreeBootstrapIndex} StarOctreeBootstrapIndex
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

/**
 * @typedef {{
 *   inspectedNodeCount: number;
 *   selectedNodeCount: number;
 *   prunedNodeCount: number;
 *   payloadNodeCount: number;
 *   frontierShardCount: number;
 *   maxLevelInspected: number | null;
 * }} TraversalStats
 */

/**
 * @typedef {{
 *   node: StarOctreeRuntimeNode;
 *   distancePc: number;
 *   cellKey?: string;
 * }} TraversalQueueItem
 */

/**
 * @param {{ x: number; y: number; z: number }} point
 * @param {StarOctreeRuntimeNode} node
 */
export function distanceToNodeAabbPc(point, node) {
  const dx = Math.max(Math.abs(point.x - node.centerX) - node.halfSize, 0);
  const dy = Math.max(Math.abs(point.y - node.centerY) - node.halfSize, 0);
  const dz = Math.max(Math.abs(point.z - node.centerZ) - node.halfSize, 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * @param {number} mask
 * @param {number} octant
 */
export function popcountBelow(mask, octant) {
  const subset = mask & ((1 << octant) - 1);
  let count = 0;

  for (let value = subset; value !== 0; value &= value - 1) {
    count += 1;
  }

  return count;
}

/**
 * @returns {TraversalStats}
 */
export function createTraversalStats() {
  return {
    inspectedNodeCount: 0,
    selectedNodeCount: 0,
    prunedNodeCount: 0,
    payloadNodeCount: 0,
    frontierShardCount: 0,
    maxLevelInspected: null,
  };
}

/**
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   bootstrap: StarOctreeBootstrapIndex;
 *   distanceToNode?: (node: StarOctreeRuntimeNode) => number;
 *   visitor: (
 *     node: StarOctreeRuntimeNode,
 *     helpers: { queuedDistancePc: number }
 *   ) => Promise<{
 *     include: boolean;
 *     emit?: boolean;
 *     descend: boolean;
 *     distancePc?: number;
 *   }> | {
 *     include: boolean;
 *     emit?: boolean;
 *     descend: boolean;
 *     distancePc?: number;
 *   };
  *   signal?: AbortSignal;
 * }} options
 */
export async function traverseOctree(options) {
  throwIfAborted(options.signal);
  const root = await options.indexSource.ensureRootShardLoaded();
  throwIfAborted(options.signal);
  const queue = new TraversalPriorityQueue();
  /** @type {StarOctreeRuntimeNode[]} */
  const selected = [];
  const stats = createTraversalStats();

  for (const nodeIndex of root.shard.header.entryNodes) {
    if (nodeIndex <= 0) continue;
    const node = root.shard.readRuntimeNode(options.bootstrap.header, nodeIndex);
    queue.push({
      node,
      distancePc: options.distanceToNode?.(node) ?? 0,
    });
  }

  while (queue.length > 0) {
    throwIfAborted(options.signal);
    const item = queue.pop();
    if (!item) break;

    stats.inspectedNodeCount += 1;
    stats.maxLevelInspected =
      stats.maxLevelInspected == null
        ? item.node.level
        : Math.max(stats.maxLevelInspected, item.node.level);

    const decision = await options.visitor(item.node, {
      queuedDistancePc: item.distancePc,
    });
    throwIfAborted(options.signal);

    if (!decision.include) {
      stats.prunedNodeCount += 1;
      continue;
    }

    stats.selectedNodeCount += 1;
    if (
      decision.emit !== false &&
      (item.node.flags & STAR_HAS_PAYLOAD) &&
      item.node.payloadLength > 0
    ) {
      stats.payloadNodeCount += 1;
      selected.push(item.node);
    }

    if (!decision.descend || item.node.childMask === 0) {
      continue;
    }

    const children = await readChildNodes(
      options.indexSource,
      options.bootstrap,
      item.node,
      stats,
    );
    throwIfAborted(options.signal);
    for (const child of children) {
      queue.push({
        node: child,
        distancePc: options.distanceToNode?.(child) ?? 0,
      });
    }
  }

  return {
    nodes: selected,
    stats,
  };
}

/**
 * @param {StarOctreeIndexSource} indexSource
 * @param {StarOctreeBootstrapIndex} bootstrap
 * @param {StarOctreeRuntimeNode} node
 * @param {TraversalStats} stats
 * @returns {Promise<StarOctreeRuntimeNode[]>}
 */
export async function readChildNodes(indexSource, bootstrap, node, stats = createTraversalStats()) {
  if (node.childMask === 0) {
    return [];
  }

  const shard = await indexSource.loadShard(node.shardOffset);
  /** @type {StarOctreeRuntimeNode[]} */
  const children = [];

  if (node.flags & STAR_IS_FRONTIER) {
    const childShardOffset = Number(shard.readFrontierContinuation(node.nodeIndex));
    if (!childShardOffset) {
      return children;
    }

    stats.frontierShardCount += 1;
    const childShard = await indexSource.loadShard(childShardOffset);
    for (let octant = 0; octant < 8; octant += 1) {
      if ((node.childMask & (1 << octant)) === 0) continue;
      const childNodeIndex = childShard.header.entryNodes[octant];
      if (childNodeIndex > 0) {
        children.push(childShard.readRuntimeNode(bootstrap.header, childNodeIndex));
      }
    }
    return children;
  }

  if (node.firstChild <= 0) {
    return children;
  }

  for (let octant = 0; octant < 8; octant += 1) {
    if ((node.childMask & (1 << octant)) === 0) continue;

    const childNodeIndex = node.firstChild + popcountBelow(node.childMask, octant);
    if (childNodeIndex > 0 && childNodeIndex <= shard.header.nodeCount) {
      children.push(shard.readRuntimeNode(bootstrap.header, childNodeIndex));
    }
  }

  return children;
}

class TraversalPriorityQueue {
  constructor() {
    /** @type {TraversalQueueItem[]} */
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  /**
   * @param {TraversalQueueItem} item
   */
  push(item) {
    item.cellKey ??= createStarCellKey(item.node);
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) {
      return null;
    }

    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return first;
  }

  /**
   * @param {number} index
   */
  siftUp(index) {
    let childIndex = index;
    while (childIndex > 0) {
      const parentIndex = Math.floor((childIndex - 1) / 2);
      if (compareQueueItems(this.items[parentIndex], this.items[childIndex]) <= 0) {
        break;
      }
      this.swap(parentIndex, childIndex);
      childIndex = parentIndex;
    }
  }

  /**
   * @param {number} index
   */
  siftDown(index) {
    let parentIndex = index;

    for (;;) {
      const leftIndex = parentIndex * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = parentIndex;

      if (
        leftIndex < this.items.length &&
        compareQueueItems(this.items[leftIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = leftIndex;
      }

      if (
        rightIndex < this.items.length &&
        compareQueueItems(this.items[rightIndex], this.items[smallestIndex]) < 0
      ) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === parentIndex) {
        break;
      }

      this.swap(parentIndex, smallestIndex);
      parentIndex = smallestIndex;
    }
  }

  /**
   * @param {number} left
   * @param {number} right
   */
  swap(left, right) {
    const item = this.items[left];
    this.items[left] = this.items[right];
    this.items[right] = item;
  }
}

/**
 * @param {TraversalQueueItem} left
 * @param {TraversalQueueItem} right
 */
function compareQueueItems(left, right) {
  const distanceDelta = left.distancePc - right.distancePc;
  if (distanceDelta !== 0) return distanceDelta;

  const levelDelta = left.node.level - right.node.level;
  if (levelDelta !== 0) return levelDelta;

  const leftCellKey = left.cellKey ?? createStarCellKey(left.node);
  const rightCellKey = right.cellKey ?? createStarCellKey(right.node);
  return leftCellKey.localeCompare(rightCellKey);
}

/**
 * @param {AbortSignal | undefined} signal
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  const error = new Error('Star octree traversal aborted.');
  error.name = 'AbortError';
  throw error;
}
