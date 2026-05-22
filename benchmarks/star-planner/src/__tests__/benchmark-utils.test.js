import assert from 'node:assert/strict';
import test from 'node:test';

import { compareBenchmarkSummaries } from '../compare.js';
import { createSyntheticFixture } from '../fixtures.js';
import {
  computeJourneyRecordMetrics,
  computeJourneyRecordHealth,
  createJourneyMilestoneSamples,
  parseJourneyBenchmarkTargets,
} from '../journey-browser-suite.js';
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

test('journey benchmark target parser accepts labelled URL lists', () => {
  assert.deepEqual(
    parseJourneyBenchmarkTargets('old=http://127.0.0.1:4323,new=http://127.0.0.1:4322'),
    [
      { label: 'old', baseUrl: 'http://127.0.0.1:4323/' },
      { label: 'new', baseUrl: 'http://127.0.0.1:4322/' },
    ],
  );
});

test('journey benchmark metrics capture blank travel and arrival backlog', () => {
  const metrics = computeJourneyRecordMetrics([
    {
      elapsedMs: 0,
      canvas: { litPixelRatio: 0, maxLuma: 10 },
      debug: { starCount: 0, activeWorkItemCount: 4, inFlightCellCount: 3 },
    },
    {
      elapsedMs: 500,
      canvas: { litPixelRatio: 0.002, maxLuma: 80 },
      debug: { starCount: 12, activeWorkItemCount: 2, inFlightCellCount: 1 },
    },
    {
      elapsedMs: 1000,
      canvas: { litPixelRatio: 0.003, maxLuma: 90 },
      debug: {
        starCount: 20,
        activeWorkItemCount: 1,
        inFlightCellCount: 0,
        decodedCacheLeasedPayloads: 8,
        decodedCacheLeasedPayloadBytes: 4096,
        decodedCacheActiveLeases: 1,
        decodedCacheLeasePressureBytes: 512,
      },
    },
  ], {
    travelWindowMs: 1000,
    sampleDurationMs: 1200,
  }, {
    frames: [{ deltaMs: 16 }, { deltaMs: 28 }],
    longTasks: [{ duration: 55 }],
    resources: [{ duration: 10 }, { duration: 15 }],
  });

  assert.equal(metrics.timeToFirstVisibleMs, 500);
  assert.equal(metrics.blankTravelRatio, 0.3333);
  assert.equal(metrics.arrivalVisible, true);
  assert.equal(metrics.arrivalActiveWorkItemCount, 1);
  assert.equal(metrics.arrivalDecodedCacheLeasedPayloads, 8);
  assert.equal(metrics.arrivalDecodedCacheLeasePressureBytes, 512);
  assert.equal(metrics.finalDecodedCacheActiveLeases, 1);
  assert.equal(metrics.frameBudgetMisses, 1);
  assert.equal(metrics.longTaskDurationMs, 55);
  assert.equal(metrics.resourceDurationMs, 25);
});

test('journey milestone samples capture pre-click, travel, arrival, and settle points', () => {
  const milestones = createJourneyMilestoneSamples([
    { elapsedMs: 50, debug: { available: true, starCount: 1 } },
    { elapsedMs: 450, debug: { available: true, starCount: 2 } },
    { elapsedMs: 1_050, debug: { available: true, starCount: 3, currentCellCount: 4, desiredCellCount: 8 } },
    { elapsedMs: 1_400, debug: { available: true, starCount: 4 } },
  ], {
    travelWindowMs: 1_000,
    sampleDurationMs: 1_500,
  }, {
    preMeasureSample: {
      elapsedMs: 0,
      debug: { available: true, starCount: 9 },
    },
  });

  assert.equal(milestones.beforeMeasure.starCount, 9);
  assert.equal(milestones.afterClick.elapsedMs, 50);
  assert.equal(milestones.midTravel.elapsedMs, 450);
  assert.equal(milestones.arrival.elapsedMs, 1050);
  assert.equal(milestones.arrival.currentDesiredRatio, 0.5);
  assert.equal(milestones.finalSettle.starCount, 4);
});

test('journey health accepts debug-rich healthy cluster records', () => {
  const health = computeJourneyRecordHealth({
    scenario: {
      journey: 'star-clusters',
      sampleDurationMs: 1_000,
      sampleIntervalMs: 250,
    },
    setupSample: {
      elapsedMs: 0,
      debug: { available: true, starCount: 12 },
      canvas: { available: true, litPixelRatio: 0, maxLuma: 0 },
    },
    samples: [
      { elapsedMs: 0, debug: { available: true, starCount: 10 }, canvas: { available: true } },
      { elapsedMs: 250, debug: { available: true, starCount: 20 }, canvas: { available: true } },
      { elapsedMs: 500, debug: { available: true, starCount: 30 }, canvas: { available: true } },
      { elapsedMs: 750, debug: { available: true, starCount: 40 }, canvas: { available: true } },
      { elapsedMs: 1_000, debug: { available: true, starCount: 50 }, canvas: { available: true } },
    ],
  });

  assert.equal(health.healthy, true);
  assert.equal(health.debugAvailable, true);
  assert.equal(health.setupVisible, true);
  assert.equal(health.measuredHasVisible, true);
  assert.equal(health.sampleCoverageRatio, 1);
});

test('journey health accepts old visual-only records without debug snapshots', () => {
  const health = computeJourneyRecordHealth({
    scenario: {
      journey: 'hr-diagram',
      sampleDurationMs: 500,
      sampleIntervalMs: 250,
    },
    setupSample: {
      elapsedMs: 0,
      debug: { available: false },
      screenshot: { available: true, litPixelRatio: 0.01, maxLuma: 80 },
    },
    samples: [
      {
        elapsedMs: 0,
        debug: { available: false },
        screenshot: { available: true, litPixelRatio: 0.01, maxLuma: 80 },
      },
      {
        elapsedMs: 250,
        debug: { available: false },
        screenshot: { available: true, litPixelRatio: 0.01, maxLuma: 80 },
      },
      {
        elapsedMs: 500,
        debug: { available: false },
        screenshot: { available: true, litPixelRatio: 0.01, maxLuma: 80 },
      },
    ],
  });

  assert.equal(health.healthy, true);
  assert.equal(health.debugAvailable, false);
  assert.equal(health.canvasAvailable, true);
  assert.equal(health.measuredHasVisible, true);
});

test('journey health marks blank cluster measurements unhealthy', () => {
  const health = computeJourneyRecordHealth({
    scenario: {
      journey: 'star-clusters',
      sampleDurationMs: 500,
      sampleIntervalMs: 250,
    },
    setupSample: {
      elapsedMs: 0,
      debug: { available: true, starCount: 10 },
      canvas: { available: true },
    },
    samples: [
      { elapsedMs: 0, debug: { available: true, starCount: 0 }, canvas: { available: true, litPixelRatio: 0, maxLuma: 0 } },
      { elapsedMs: 250, debug: { available: true, starCount: 0 }, canvas: { available: true, litPixelRatio: 0, maxLuma: 0 } },
      { elapsedMs: 500, debug: { available: true, starCount: 0 }, canvas: { available: true, litPixelRatio: 0, maxLuma: 0 } },
    ],
  });

  assert.equal(health.healthy, false);
  assert.deepEqual(health.reasons, ['cluster-measured-blank']);
});
