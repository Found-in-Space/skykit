import { performance } from 'node:perf_hooks';

import { createStarCellKey } from '@found-in-space/star-trees';

import { planStarOctreeStrategyDemand } from '../../../packages/star-octree-provider/src/star-octree-strategies.js';
import { createSyntheticFixture, FIXTURE_NAMES } from './fixtures.js';
import { createMovementScenario, MOVEMENT_SCENARIOS } from './movement.js';
import {
  createCustomStrategyProbeValue,
  createStrategyForFrame,
  createViewForFrame,
  STRATEGY_SCENARIOS,
} from './strategy-scenarios.js';
import {
  churnRatio,
  groupRecords,
  orderStabilityRatio,
  retainedPrefixRatio,
  round,
  summarizePlannerRecords,
} from './metrics.js';

const HOT_PREFIX_COUNT = 64;
const TAIL_FRACTION = 0.4;

/**
 * @param {{
 *   fixtures?: string[];
 *   movements?: string[];
 *   strategies?: string[];
 *   frameLimit?: number;
 * }} [options]
 */
export async function runPlannerBenchmarkSuite(options = {}) {
  const fixtures = options.fixtures ?? FIXTURE_NAMES;
  const movements = options.movements ?? MOVEMENT_SCENARIOS;
  const strategies = options.strategies ?? STRATEGY_SCENARIOS;
  const frameLimit = options.frameLimit ?? Infinity;
  const records = [];
  const fixtureSummaries = [];
  const capabilities = {};

  for (const fixtureName of fixtures) {
    const fixture = createSyntheticFixture(fixtureName);
    fixtureSummaries.push(fixture.summary);
    for (const movementName of movements) {
      const movement = createMovementScenario(movementName);
      const frames = movement.frames.slice(0, frameLimit);
      for (const strategyName of strategies) {
        records.push(...await runPlannerScenario({
          fixture,
          movementName,
          strategyName,
          frames,
        }));
      }
    }
  }

  capabilities.customStrategy = await probeCustomStrategySupport();

  return {
    kind: 'planner',
    fixtureSummaries,
    capabilities,
    records,
    summaries: summarizePlannerGroups(records),
    totals: {
      scenarioCount: new Set(records.map((record) =>
        `${record.fixture}|${record.movement}|${record.strategy}`,
      )).size,
      frameCount: records.length,
      ...summarizePlannerRecords(records),
    },
  };
}

/**
 * @param {{
 *   fixture: ReturnType<typeof createSyntheticFixture>;
 *   movementName: string;
 *   strategyName: string;
 *   frames: ReturnType<typeof createMovementScenario>['frames'];
 * }} options
 */
async function runPlannerScenario(options) {
  const records = [];
  let previousCurrentKeys = [];
  let previousHotPrefix = [];
  let previousTail = [];
  let previousOrder = [];

  for (const frame of options.frames) {
    const strategy = createStrategyForFrame(options.strategyName, frame);
    const view = createViewForFrame(frame);
    const traversalStats = {};
    const context = createSyntheticSelectionContext({
      fixture: options.fixture,
      strategy,
      view,
      traversalStats,
    });
    const startedAt = performance.now();
    const plan = await planStarOctreeStrategyDemand({
      indexSource: {},
      context,
    });
    const durationMs = performance.now() - startedAt;
    const entries = plan.entries ?? [];
    const currentKeys = entries
      .filter((entry) => (entry.role ?? 'current') === 'current')
      .map((entry) => createStarCellKey(entry.node));
    const warmKeys = entries
      .filter((entry) => entry.role === 'prefetch')
      .map((entry) => createStarCellKey(entry.node));
    const hotPrefix = currentKeys.slice(0, HOT_PREFIX_COUNT);
    const tailStart = Math.floor(currentKeys.length * (1 - TAIL_FRACTION));
    const tail = currentKeys.slice(tailStart);
    const outputOrder = currentKeys.slice(0, HOT_PREFIX_COUNT);

    records.push({
      fixture: options.fixture.name,
      movement: options.movementName,
      strategy: options.strategyName,
      frame: frame.index,
      durationMs: round(durationMs),
      inspectedCells: traversalStats.inspectedNodeCount ?? plan.metadata?.inspectedNodeCount ?? 0,
      selectedCells: traversalStats.selectedNodeCount ?? plan.metadata?.selectedNodeCount ?? entries.length,
      emittedCells: entries.length,
      currentCells: currentKeys.length,
      warmCells: warmKeys.length,
      signatureChurn: churnRatio(previousCurrentKeys, currentKeys),
      hotPrefixRetention: retainedPrefixRatio(previousHotPrefix, hotPrefix),
      tailChurn: churnRatio(previousTail, tail),
      orderStability: orderStabilityRatio(previousOrder, outputOrder),
      signatureLength: String(plan.signature ?? '').length,
    });

    previousCurrentKeys = currentKeys;
    previousHotPrefix = hotPrefix;
    previousTail = tail;
    previousOrder = outputOrder;
  }

  return records;
}

/**
 * @param {{
 *   fixture: ReturnType<typeof createSyntheticFixture>;
 *   strategy: unknown;
 *   view: Record<string, unknown>;
 *   traversalStats: Record<string, number | null>;
 * }}
 */
function createSyntheticSelectionContext(options) {
  const context = {
    providerId: 'benchmark-provider',
    strategy: options.strategy,
    view: options.view,
    viewRevision: Number(options.view.revision ?? 1),
    demandRevision: 0,
    attributes: ['position'],
    coordinates: { units: ['pc', 'pc', 'pc'] },
    streaming: {
      coarseFirst: true,
    },
    traversal: {
      async select(selectionOptions) {
        const entries = [];
        let inspectedNodeCount = 0;
        let selectedNodeCount = 0;
        let prunedNodeCount = 0;
        let maxLevelInspected = null;

        for (const node of options.fixture.nodes) {
          inspectedNodeCount += 1;
          maxLevelInspected = Math.max(maxLevelInspected ?? node.level, node.level);
          const queuedDistancePc = selectionOptions.distanceToNode?.(node) ?? 0;
          const decision = await selectionOptions.visit(node, {
            context,
            bootstrap: {
              header: {
                magLimit: 8.5,
              },
            },
            queuedDistancePc,
          });
          if (decision.include) {
            selectedNodeCount += 1;
            if (decision.emit !== false) {
              entries.push({
                node,
                priority: typeof decision.priority === 'number' ? decision.priority : 0,
                relevance: decision.relevance,
                role: decision.role,
                reasons: decision.reasons,
                metadata: decision.metadata,
              });
            }
          } else {
            prunedNodeCount += 1;
          }
        }

        Object.assign(options.traversalStats, {
          inspectedNodeCount,
          selectedNodeCount,
          prunedNodeCount,
          payloadNodeCount: entries.length,
          frontierShardCount: 0,
          maxLevelInspected,
        });

        return {
          entries,
          stats: {
            inspectedNodeCount,
            selectedNodeCount,
            prunedNodeCount,
            payloadNodeCount: entries.length,
            frontierShardCount: 0,
            maxLevelInspected,
          },
        };
      },
    },
  };
  return context;
}

async function probeCustomStrategySupport() {
  const fixture = createSyntheticFixture('sparse');
  const movement = createMovementScenario('stationary');
  const frame = movement.frames[0];
  const strategy = createCustomStrategyProbeValue();
  try {
    await planStarOctreeStrategyDemand({
      indexSource: {},
      context: createSyntheticSelectionContext({
        fixture,
        strategy,
        view: createViewForFrame(frame),
        traversalStats: {},
      }),
    });
    return {
      supported: true,
      failureReason: null,
    };
  } catch (error) {
    return {
      supported: false,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {Array<Record<string, unknown>>} records
 */
function summarizePlannerGroups(records) {
  return groupRecords(records, ['fixture', 'movement', 'strategy'])
    .map((group) => {
      const first = group.values[0] ?? {};
      return {
        fixture: String(first.fixture),
        movement: String(first.movement),
        strategy: String(first.strategy),
        ...summarizePlannerRecords(/** @type {Parameters<typeof summarizePlannerRecords>[0]} */ (group.values)),
      };
    });
}
