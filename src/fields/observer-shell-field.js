import { DEFAULT_MAG_LIMIT } from '../layers/star-field-materials.js';
import {
  createEmptySelectionStats,
  evaluateMagnitudeShell,
  normalizePoint,
  resolvePointSpec,
  selectOctreeNodes,
} from './octree-selection.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });

function normalizeNonNegativeInteger(value, fallback = null) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function normalizePositiveFinite(value, fallback = null) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function resolveMaxLevelSpec(spec, context) {
  if (typeof spec === 'function') {
    return normalizeNonNegativeInteger(spec(context), null);
  }

  return normalizeNonNegativeInteger(spec, null);
}

function resolveAdaptiveLevelCapSpec(spec, context) {
  if (!spec || typeof spec !== 'object') {
    return null;
  }

  const speedPcPerSec = typeof spec.speedPcPerSec === 'function'
    ? spec.speedPcPerSec(context)
    : spec.speedPcPerSec;
  const fallbackSpeed = Number(context.state?.observerSpeedPcPerSec);

  return {
    lookaheadSecs: normalizePositiveFinite(spec.lookaheadSecs, null),
    minLevel: normalizeNonNegativeInteger(spec.minLevel, 0),
    speedPcPerSec: normalizePositiveFinite(
      speedPcPerSec,
      normalizePositiveFinite(fallbackSpeed, 0),
    ) ?? 0,
  };
}

export function resolveObserverShellTraversalState(context, options = {}, bootstrapHeader = null) {
  const observerPc = resolvePointSpec(
    options.observerPc,
    context,
    normalizePoint(context.state?.observerPc, DEFAULT_OBSERVER_PC),
  ) ?? normalizePoint(DEFAULT_OBSERVER_PC);
  const requestedMDesired = Number.isFinite(context.state?.mDesired)
    ? Number(context.state.mDesired)
    : DEFAULT_MAG_LIMIT;
  const requestedMaxLevel = resolveMaxLevelSpec(options.maxLevel, context);
  const adaptiveLevelCap = resolveAdaptiveLevelCapSpec(options.motionAdaptiveMaxLevel, context);

  let adaptiveMaxLevel = null;
  let speedCapDistancePc = 0;
  let observerSpeedPcPerSec = adaptiveLevelCap?.speedPcPerSec ?? 0;

  if (
    bootstrapHeader
    && adaptiveLevelCap
    && adaptiveLevelCap.lookaheadSecs
    && adaptiveLevelCap.speedPcPerSec > 0
    && Number.isFinite(bootstrapHeader.worldHalfSize)
    && bootstrapHeader.worldHalfSize > 0
    && Number.isFinite(bootstrapHeader.magLimit)
  ) {
    speedCapDistancePc = adaptiveLevelCap.speedPcPerSec * adaptiveLevelCap.lookaheadSecs;
    const visibilityScale = 10 ** ((requestedMDesired - bootstrapHeader.magLimit) / 5);
    const levelRatio = (bootstrapHeader.worldHalfSize * visibilityScale) / speedCapDistancePc;
    const unclampedMaxLevel = Number.isFinite(levelRatio) && levelRatio > 0
      ? Math.floor(Math.log2(levelRatio))
      : adaptiveLevelCap.minLevel;
    adaptiveMaxLevel = Math.max(adaptiveLevelCap.minLevel, unclampedMaxLevel);
  }

  const effectiveMaxLevel = adaptiveMaxLevel == null
    ? requestedMaxLevel
    : Math.min(
      requestedMaxLevel ?? Number.POSITIVE_INFINITY,
      adaptiveMaxLevel,
    );

  return {
    observerPc,
    requestedMDesired,
    requestedMaxLevel,
    effectiveMaxLevel: Number.isFinite(effectiveMaxLevel) ? effectiveMaxLevel : null,
    observerSpeedPcPerSec,
    speedCapDistancePc,
    adaptiveLevelCap: adaptiveLevelCap
      ? {
        ...adaptiveLevelCap,
        maxLevel: adaptiveMaxLevel,
      }
      : null,
  };
}

function compareShellNodes(left, right) {
  if (left.level !== right.level) {
    return left.level - right.level;
  }
  if ((left.distancePc ?? 0) !== (right.distancePc ?? 0)) {
    return (left.distancePc ?? 0) - (right.distancePc ?? 0);
  }
  return (left.nodeKey ?? '').localeCompare(right.nodeKey ?? '');
}

export function createObserverShellField(options = {}) {
  const id = options.id ?? 'observer-shell-field';
  let lastStats = {
    strategy: id,
    observerPc: normalizePoint(DEFAULT_OBSERVER_PC),
    mDesired: null,
    mIndex: null,
    ...createEmptySelectionStats(),
  };

  return {
    id,
    getStats() {
      return {
        ...lastStats,
        observerPc: normalizePoint(lastStats.observerPc),
      };
    },
    async selectNodes(context) {
      if (!context.datasetSession) {
        lastStats = {
          strategy: id,
          observerPc: normalizePoint(DEFAULT_OBSERVER_PC),
          mDesired: null,
          mIndex: null,
          ...createEmptySelectionStats(),
        };
        return {
          strategy: id,
          nodes: [],
          meta: {
            note: 'No dataset session is attached to the runtime.',
          },
        };
      }

      const bootstrap = await context.datasetSession.ensureRenderBootstrap();
      const traversalState = resolveObserverShellTraversalState(
        context,
        options,
        bootstrap?.header ?? null,
      );
      const {
        observerPc,
        requestedMDesired,
        requestedMaxLevel,
        effectiveMaxLevel,
        observerSpeedPcPerSec,
        speedCapDistancePc,
        adaptiveLevelCap,
      } = traversalState;

      const result = await selectOctreeNodes(context, {
        maxLevel: effectiveMaxLevel,
        predicate(node, helper) {
          const shell = evaluateMagnitudeShell(
            observerPc,
            node.geom,
            requestedMDesired,
            helper.bootstrap.header.magLimit,
          );

          return {
            include: shell.inMagnitudeShell,
            meta: {
              ...shell,
            },
          };
        },
        sortNodes: compareShellNodes,
      });

      const mIndex = result.bootstrap?.header?.magLimit ?? null;
      lastStats = {
        strategy: id,
        observerPc: normalizePoint(observerPc),
        mDesired: requestedMDesired,
        mIndex,
        requestedMaxLevel,
        effectiveMaxLevel,
        observerSpeedPcPerSec,
        speedCapDistancePc,
        adaptiveMaxLevel: adaptiveLevelCap?.maxLevel ?? null,
        adaptiveLookaheadSecs: adaptiveLevelCap?.lookaheadSecs ?? null,
        ...result.stats,
      };

      return {
        strategy: id,
        nodes: result.nodes,
        meta: {
          note: options.note ?? 'Observer-shell selection using the shared magnitude-shell visibility prune.',
          observerPc: normalizePoint(observerPc),
          mDesired: requestedMDesired,
          mIndex,
          requestedMaxLevel,
          effectiveMaxLevel,
          observerSpeedPcPerSec,
          speedCapDistancePc,
          adaptiveMaxLevel: adaptiveLevelCap?.maxLevel ?? null,
          adaptiveLookaheadSecs: adaptiveLevelCap?.lookaheadSecs ?? null,
          ...result.stats,
        },
      };
    },
    async captureRefreshSnapshot(context) {
      if (!context.datasetSession || !options.motionAdaptiveMaxLevel) {
        return null;
      }

      const bootstrap = await context.datasetSession.ensureRenderBootstrap();
      const traversalState = resolveObserverShellTraversalState(
        context,
        options,
        bootstrap?.header ?? null,
      );

      return {
        effectiveMaxLevel: traversalState.effectiveMaxLevel,
      };
    },
  };
}
