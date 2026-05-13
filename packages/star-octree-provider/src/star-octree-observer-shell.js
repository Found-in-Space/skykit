import { STAR_HAS_PAYLOAD } from './star-octree-format.js';
import {
  distanceToNodeAabbPc,
  traverseOctree,
} from './star-octree-traversal.js';

/**
 * @typedef {import('./index.d.ts').StarOctreeDemandEntry} StarOctreeDemandEntry
 * @typedef {import('./index.d.ts').StarOctreeDemandPlan} StarOctreeDemandPlan
 * @typedef {import('./index.d.ts').StarOctreeSelectionContext} StarOctreeSelectionContext
 * @typedef {import('./index.d.ts').StarOctreeViewPatch} StarOctreeViewPatch
 * @typedef {ReturnType<typeof import('./star-octree-index-source.js').createStarOctreeIndexSource>} StarOctreeIndexSource
 */

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LIMITING_MAGNITUDE = 6.5;

/**
 * @param {number} halfSize
 * @param {number} limitingMagnitude
 * @param {number} indexMagnitude
 */
export function loadRadiusForMagnitudeShell(
  halfSize,
  limitingMagnitude,
  indexMagnitude,
) {
  return halfSize * 10 ** ((limitingMagnitude - indexMagnitude) / 5);
}

/**
 * @param {{
 *   indexSource: StarOctreeIndexSource;
 *   context: StarOctreeSelectionContext;
 * }} options
 * @returns {Promise<StarOctreeDemandPlan>}
 */
export async function planObserverShellDemand(options) {
  const bootstrap = await options.indexSource.ensureBootstrapLoaded();
  const observerPc = normalizePoint(
    options.context.view.observerPc,
    DEFAULT_OBSERVER_PC,
  );
  const limitingMagnitude = normalizeFiniteNumber(
    options.context.view.limitingMagnitude,
    DEFAULT_LIMITING_MAGNITUDE,
  );
  const indexMagnitude = bootstrap.header.magLimit;
  /** @type {StarOctreeDemandEntry[]} */
  const entries = [];

  const traversal = await traverseOctree({
    indexSource: options.indexSource,
    bootstrap,
    distanceToNode: (node) => distanceToNodeAabbPc(observerPc, node),
    visitor(node) {
      const distancePc = distanceToNodeAabbPc(observerPc, node);
      const loadRadiusPc = loadRadiusForMagnitudeShell(
        node.halfSize,
        limitingMagnitude,
        indexMagnitude,
      );
      const include = distancePc <= loadRadiusPc;

      if (
        include &&
        (node.flags & STAR_HAS_PAYLOAD) &&
        node.payloadLength > 0
      ) {
        entries.push({
          node,
          priority: -distancePc,
          role: 'current',
          reasons: ['observer-shell'],
          metadata: {
            distancePc,
            loadRadiusPc,
            limitingMagnitude,
            indexMagnitude,
          },
        });
      }

      return {
        include,
        descend: include,
        distancePc,
      };
    },
  });

  entries.sort((left, right) => {
    const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    return left.node.nodeKey.localeCompare(right.node.nodeKey);
  });

  return {
    entries,
    signature: entries.map((entry) => entry.node.nodeKey).join('|'),
    reasons: ['observer-shell'],
    metadata: {
      strategy: 'observer-shell',
      observerPc,
      limitingMagnitude,
      indexMagnitude,
      inspectedNodeCount: traversal.stats.inspectedNodeCount,
      selectedNodeCount: traversal.stats.selectedNodeCount,
      payloadNodeCount: traversal.stats.payloadNodeCount,
      prunedNodeCount: traversal.stats.prunedNodeCount,
      frontierShardCount: traversal.stats.frontierShardCount,
      maxLevelInspected: traversal.stats.maxLevelInspected,
    },
  };
}

/**
 * @param {StarOctreeViewPatch | undefined} view
 */
export function normalizeObserverShellView(view = {}) {
  const observerPc = normalizePoint(view.observerPc, DEFAULT_OBSERVER_PC);
  const limitingMagnitude = normalizeFiniteNumber(
    view.limitingMagnitude ?? view.mDesired,
    DEFAULT_LIMITING_MAGNITUDE,
  );

  return {
    ...view,
    observerPc,
    limitingMagnitude,
  };
}

/**
 * @param {unknown} value
 * @param {{ x: number; y: number; z: number }} fallback
 */
function normalizePoint(value, fallback) {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }

  const point = /** @type {Partial<typeof fallback>} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);

  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : { ...fallback };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
