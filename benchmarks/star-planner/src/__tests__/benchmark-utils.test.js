import assert from 'node:assert/strict';
import test from 'node:test';

import { compareBenchmarkSummaries } from '../compare.js';
import { createSyntheticFixture } from '../fixtures.js';
import { normalizeForBaseline, summarizeNumbers } from '../metrics.js';
import { runPlannerBenchmarkSuite } from '../planner-suite.js';

test('synthetic fixtures are deterministic', () => {
  const first = createSyntheticFixture('sparse');
  const second = createSyntheticFixture('sparse');

  assert.equal(first.summary.nodeCount, second.summary.nodeCount);
  assert.deepEqual(
    first.nodes.slice(0, 12).map((node) => node.cellKey),
    second.nodes.slice(0, 12).map((node) => node.cellKey),
  );
  assert.deepEqual(first.summary, second.summary);
});

test('numeric summaries are stable and percentile based', () => {
  assert.deepEqual(summarizeNumbers([5, 1, 3, 2, 4]), {
    min: 1,
    mean: 3,
    p50: 3,
    p95: 4.8,
    max: 5,
  });
});

test('baseline normalization strips volatile fields and sorts keys', () => {
  assert.deepEqual(normalizeForBaseline({
    z: 1,
    generatedAt: 'now',
    rawSamples: [1, 2],
    nested: {
      b: 2,
      a: 1,
      trace: ['omit'],
    },
  }), {
    nested: {
      a: 1,
      b: 2,
    },
    z: 1,
  });
});

test('comparison reports deltas without thresholds', () => {
  const comparison = compareBenchmarkSummaries(
    {
      planner: { totals: { planMs: { mean: 10, p95: 20 }, tailChurn: { mean: 0.1 } } },
      browser: { totals: { liveTimeToCurrentMs: { mean: 100, p95: 200 }, warmPromotionRate: { mean: 0.2 } } },
    },
    {
      planner: { totals: { planMs: { mean: 12, p95: 18 }, tailChurn: { mean: 0.2 } } },
      browser: { totals: { liveTimeToCurrentMs: { mean: 90, p95: 210 }, warmPromotionRate: { mean: 0.3 } } },
    },
  );

  assert.equal(comparison.ok, true);
  assert.match(comparison.markdown, /No thresholds are enforced/);
  assert.equal(comparison.rows.find((row) => row.metric === 'planner mean plan ms').delta, 2);
});

test('planner benchmark smoke suite produces records', async () => {
  const result = await runPlannerBenchmarkSuite({
    fixtures: ['sparse'],
    movements: ['stationary'],
    strategies: ['sphere-volume'],
    frameLimit: 2,
  });

  assert.equal(result.records.length, 2);
  assert.equal(result.totals.scenarioCount, 1);
  assert.equal(result.capabilities.customStrategy.supported, true);
});
