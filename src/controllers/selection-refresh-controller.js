import { normalizePoint } from '../fields/octree-selection.js';

const DEFAULT_OBSERVER_DISTANCE_PC = 12;
const DEFAULT_TARGET_DISTANCE_PC = 1;
const DEFAULT_MIN_INTERVAL_MS = 250;
const DEFAULT_MAG_EPSILON = 0.001;

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function pointDistance(left, right) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }

  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const dz = right.z - left.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalizeFiniteNumber(value, fallback = null) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function captureSelectionRefreshSnapshot(context) {
  return {
    observerPc: normalizePoint(context.state?.observerPc, null),
    targetPc: normalizePoint(context.state?.targetPc, null),
    mDesired: normalizeFiniteNumber(context.state?.mDesired, null),
    width: normalizeFiniteNumber(context.size?.width, null),
    height: normalizeFiniteNumber(context.size?.height, null),
  };
}

export function getSelectionRefreshReasons(previousSnapshot, nextSnapshot, options = {}) {
  const reasons = [];
  const observerDistancePc = Number.isFinite(options.observerDistancePc)
    ? Number(options.observerDistancePc)
    : DEFAULT_OBSERVER_DISTANCE_PC;
  const targetDistancePc = Number.isFinite(options.targetDistancePc)
    ? Number(options.targetDistancePc)
    : DEFAULT_TARGET_DISTANCE_PC;
  const magEpsilon = Number.isFinite(options.magEpsilon)
    ? Number(options.magEpsilon)
    : DEFAULT_MAG_EPSILON;

  const previousObserverPc = normalizePoint(previousSnapshot?.observerPc, null);
  const nextObserverPc = normalizePoint(nextSnapshot?.observerPc, null);
  if (previousObserverPc || nextObserverPc) {
    if (!previousObserverPc || !nextObserverPc || pointDistance(previousObserverPc, nextObserverPc) >= observerDistancePc) {
      reasons.push('observerPc');
    }
  }

  const previousTargetPc = normalizePoint(previousSnapshot?.targetPc, null);
  const nextTargetPc = normalizePoint(nextSnapshot?.targetPc, null);
  if (previousTargetPc || nextTargetPc) {
    if (!previousTargetPc || !nextTargetPc || pointDistance(previousTargetPc, nextTargetPc) >= targetDistancePc) {
      reasons.push('targetPc');
    }
  }

  const previousMDesired = normalizeFiniteNumber(previousSnapshot?.mDesired, null);
  const nextMDesired = normalizeFiniteNumber(nextSnapshot?.mDesired, null);
  if (previousMDesired !== nextMDesired) {
    if (
      previousMDesired == null
      || nextMDesired == null
      || Math.abs(nextMDesired - previousMDesired) >= magEpsilon
    ) {
      reasons.push('mDesired');
    }
  }

  if (options.watchSize !== false) {
    const previousWidth = normalizeFiniteNumber(previousSnapshot?.width, null);
    const previousHeight = normalizeFiniteNumber(previousSnapshot?.height, null);
    const nextWidth = normalizeFiniteNumber(nextSnapshot?.width, null);
    const nextHeight = normalizeFiniteNumber(nextSnapshot?.height, null);

    if (previousWidth !== nextWidth || previousHeight !== nextHeight) {
      reasons.push('size');
    }
  }

  return reasons;
}

export function createSelectionRefreshController(options = {}) {
  const id = options.id ?? 'selection-refresh-controller';
  const minIntervalMs = Number.isFinite(options.minIntervalMs)
    ? Number(options.minIntervalMs)
    : DEFAULT_MIN_INTERVAL_MS;

  let lastSnapshot = null;
  let lastRequestTimeMs = Number.NEGATIVE_INFINITY;
  let refreshPromise = null;
  let stats = {
    pending: false,
    refreshCount: 0,
    lastReasons: [],
    lastError: null,
  };

  return {
    id,
    getStats() {
      return {
        ...stats,
        lastSnapshot: lastSnapshot
          ? {
            ...lastSnapshot,
            observerPc: clonePoint(lastSnapshot.observerPc),
            targetPc: clonePoint(lastSnapshot.targetPc),
          }
          : null,
      };
    },
    start(context) {
      lastSnapshot = captureSelectionRefreshSnapshot(context);
    },
    update(context) {
      if (refreshPromise) {
        return;
      }

      const nextSnapshot = captureSelectionRefreshSnapshot(context);
      const reasons = getSelectionRefreshReasons(lastSnapshot, nextSnapshot, options);
      if (reasons.length === 0) {
        return;
      }

      const frameTimeMs = Number.isFinite(context.frame?.timeMs)
        ? Number(context.frame.timeMs)
        : Date.now();
      if (frameTimeMs - lastRequestTimeMs < minIntervalMs) {
        return;
      }

      const requestedSnapshot = nextSnapshot;
      lastRequestTimeMs = frameTimeMs;
      stats = {
        ...stats,
        pending: true,
        lastReasons: [...reasons],
        lastError: null,
      };

      refreshPromise = context.runtime.refreshSelection()
        .then(() => {
          lastSnapshot = requestedSnapshot;
          stats = {
            ...stats,
            refreshCount: stats.refreshCount + 1,
          };
        })
        .catch((error) => {
          stats = {
            ...stats,
            lastError: error instanceof Error ? error.message : String(error),
          };
          console.error('[SelectionRefreshController] refreshSelection failed', error);
        })
        .finally(() => {
          refreshPromise = null;
          stats = {
            ...stats,
            pending: false,
          };
        });
    },
  };
}
