import {
  createEmptySelectionStats,
  evaluateMagnitudeShell,
  normalizePoint,
  resolvePointSpec,
  selectOctreeNodes,
} from './octree-selection.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });

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

      const observerPc = resolvePointSpec(
        options.observerPc,
        context,
        normalizePoint(context.state?.observerPc, DEFAULT_OBSERVER_PC),
      ) ?? normalizePoint(DEFAULT_OBSERVER_PC);
      const requestedMDesired = Number.isFinite(context.state?.mDesired)
        ? Number(context.state.mDesired)
        : null;

      if (requestedMDesired == null) {
        lastStats = {
          strategy: id,
          observerPc: normalizePoint(observerPc),
          mDesired: null,
          mIndex: null,
          ...createEmptySelectionStats(),
        };
        return {
          strategy: id,
          nodes: [],
          meta: {
            note: 'ObserverShellField requires a finite state.mDesired value.',
            observerPc: normalizePoint(observerPc),
            mDesired: null,
          },
        };
      }

      const result = await selectOctreeNodes(context, {
        maxLevel: options.maxLevel,
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
          ...result.stats,
        },
      };
    },
  };
}
