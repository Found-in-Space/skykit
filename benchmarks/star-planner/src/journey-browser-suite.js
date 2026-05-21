import { inflateSync } from 'node:zlib';

import { groupRecords, round, summarizeNumbers } from './metrics.js';

const DEFAULT_TARGETS = Object.freeze([
  { label: 'local-alpha', baseUrl: 'http://127.0.0.1:4322' },
]);

export const DEFAULT_JOURNEY_SCENARIOS = Object.freeze([
  {
    name: 'clusters-hyades-to-omega-cen',
    journey: 'star-clusters',
    path: '/learn/topic/star-clusters/',
    readySelector: '[data-cluster-tour]',
    canvasSelector: '[data-cluster-tour-shell] canvas',
    setup: [
      { click: '[data-cluster-fly="hyades"]', settleMs: 7_000 },
    ],
    setupVisibilityTimeoutMs: 10_000,
    measureClick: '[data-cluster-fly="omega-cen"]',
    travelWindowMs: 9_000,
    sampleDurationMs: 12_000,
    sampleIntervalMs: 250,
  },
  {
    name: 'hr-ngc752-to-omega-cen',
    journey: 'hr-diagram',
    path: '/learn/topic/hr-diagram/',
    readySelector: '[data-hr-tour]',
    canvasSelector: '[data-hr-diagram-viewer-shell] canvas',
    setup: [
      { click: '[data-step-fly="ngc-752"]', settleMs: 8_000 },
    ],
    setupVisibilityTimeoutMs: 12_000,
    measureClick: '[data-step-fly="omega-cen"]',
    travelWindowMs: 15_000,
    sampleDurationMs: 20_000,
    sampleIntervalMs: 250,
  },
]);

const DEFAULT_VISIBILITY_THRESHOLDS = Object.freeze({
  minStarCount: 1,
  minLitPixelRatio: 0.0008,
  minMaxLuma: 32,
});

/**
 * @param {{
 *   targets?: Array<{ label: string; baseUrl: string }>;
 *   scenarios?: typeof DEFAULT_JOURNEY_SCENARIOS;
 *   runs?: number;
 *   headless?: boolean;
 *   timeoutMs?: number;
 *   viewport?: { width: number; height: number };
 *   visibility?: Partial<typeof DEFAULT_VISIBILITY_THRESHOLDS>;
 * }} [options]
 */
export async function runWebsiteJourneyBenchmarkSuite(options = {}) {
  const { chromium } = await import('playwright');
  const targets = normalizeTargets(options.targets ?? DEFAULT_TARGETS);
  const scenarios = options.scenarios ?? DEFAULT_JOURNEY_SCENARIOS;
  const runs = Math.max(1, Math.floor(Number(options.runs ?? 1)));
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? 60_000));
  const visibility = {
    ...DEFAULT_VISIBILITY_THRESHOLDS,
    ...(options.visibility ?? {}),
  };
  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const browser = await chromium.launch({
    headless: options.headless !== false,
  });
  const records = [];

  try {
    for (const target of targets) {
      for (const scenario of scenarios) {
        for (let runIndex = 0; runIndex < runs; runIndex += 1) {
          records.push(await runScenario({
            browser,
            target,
            scenario,
            runIndex,
            timeoutMs,
            viewport,
            visibility,
          }));
        }
      }
    }

    return {
      kind: 'website-journey-browser',
      chromiumVersion: browser.version(),
      generatedAt: new Date().toISOString(),
      targets,
      scenarios: scenarios.map(compactScenario),
      records,
      summaries: summarizeJourneyRecords(records),
      totals: summarizeJourneyTotals(records),
    };
  } finally {
    await browser.close();
  }
}

/**
 * @param {string | undefined} value
 * @returns {Array<{ label: string; baseUrl: string }>}
 */
export function parseJourneyBenchmarkTargets(value) {
  if (!value || !value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    return normalizeTargets(parsed);
  }
  return normalizeTargets(
    trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, index) => {
        const equalsIndex = part.indexOf('=');
        if (equalsIndex < 0) {
          return { label: `target-${index + 1}`, baseUrl: part };
        }
        return {
          label: part.slice(0, equalsIndex).trim(),
          baseUrl: part.slice(equalsIndex + 1).trim(),
        };
      }),
  );
}

/**
 * @param {Array<Record<string, unknown>>} records
 */
export function summarizeJourneyRecords(records) {
  return groupRecords(records, ['target', 'journey', 'scenario'])
    .map((group) => {
      const first = group.values[0] ?? {};
      return {
        target: String(first.target ?? ''),
        journey: String(first.journey ?? ''),
        scenario: String(first.scenario ?? ''),
        healthyRunRatio: summarizeNumbers(group.values.map((record) => Number(record.health?.healthy === true ? 1 : 0))),
        setupVisibleRatio: summarizeNumbers(group.values.map((record) => Number(record.health?.setupVisible === true ? 1 : 0))),
        measuredVisibleRatio: summarizeNumbers(group.values.map((record) => Number(record.health?.measuredHasVisible === true ? 1 : 0))),
        debugAvailableRatio: summarizeNumbers(group.values.map((record) => Number(record.health?.debugAvailable === true ? 1 : 0))),
        canvasAvailableRatio: summarizeNumbers(group.values.map((record) => Number(record.health?.canvasAvailable === true ? 1 : 0))),
        sampleCoverageRatio: summarizeNumbers(group.values.map((record) => Number(record.health?.sampleCoverageRatio ?? 0))),
        sampleCount: summarizeNumbers(group.values.map((record) => Number(record.sampleCount ?? 0))),
        timeToFirstVisibleMs: summarizeNumbers(group.values.map((record) => Number(record.timeToFirstVisibleMs ?? 0))),
        blankTravelRatio: summarizeNumbers(group.values.map((record) => Number(record.blankTravelRatio ?? 0))),
        visibleTravelRatio: summarizeNumbers(group.values.map((record) => Number(record.visibleTravelRatio ?? 0))),
        arrivalVisible: summarizeNumbers(group.values.map((record) => Number(record.arrivalVisible === true ? 1 : 0))),
        arrivalStarCount: summarizeNumbers(group.values.map((record) => Number(record.arrivalStarCount ?? 0))),
        arrivalCellCount: summarizeNumbers(group.values.map((record) => Number(record.arrivalCellCount ?? 0))),
        arrivalDesiredCells: summarizeNumbers(group.values.map((record) => Number(record.arrivalDesiredCellCount ?? 0))),
        arrivalCurrentCells: summarizeNumbers(group.values.map((record) => Number(record.arrivalCurrentCellCount ?? 0))),
        arrivalActiveWorkItems: summarizeNumbers(group.values.map((record) => Number(record.arrivalActiveWorkItemCount ?? 0))),
        arrivalInFlightCells: summarizeNumbers(group.values.map((record) => Number(record.arrivalInFlightCellCount ?? 0))),
        arrivalCurrentDesiredRatio: summarizeNumbers(group.values.map((record) => Number(record.arrivalCurrentDesiredRatio ?? 0))),
        arrivalInFlightDesiredRatio: summarizeNumbers(group.values.map((record) => Number(record.arrivalInFlightDesiredRatio ?? 0))),
        arrivalCachedCurrentCellHits: summarizeNumbers(group.values.map((record) => Number(record.arrivalCachedCurrentCellHitCount ?? 0))),
        arrivalColdCurrentCellLoads: summarizeNumbers(group.values.map((record) => Number(record.arrivalColdCurrentCellLoadCount ?? 0))),
        arrivalStaleCurrentLoadAborts: summarizeNumbers(group.values.map((record) => Number(record.arrivalStaleCurrentLoadAbortCount ?? 0))),
        arrivalStaleCurrentCellDrops: summarizeNumbers(group.values.map((record) => Number(record.arrivalStaleCurrentCellDropCount ?? 0))),
        finalStarCount: summarizeNumbers(group.values.map((record) => Number(record.finalStarCount ?? 0))),
        finalCellCount: summarizeNumbers(group.values.map((record) => Number(record.finalCellCount ?? 0))),
        finalDesiredCells: summarizeNumbers(group.values.map((record) => Number(record.finalDesiredCellCount ?? 0))),
        finalCurrentCells: summarizeNumbers(group.values.map((record) => Number(record.finalCurrentCellCount ?? 0))),
        finalInFlightCells: summarizeNumbers(group.values.map((record) => Number(record.finalInFlightCellCount ?? 0))),
        finalActiveWorkItems: summarizeNumbers(group.values.map((record) => Number(record.finalActiveWorkItemCount ?? 0))),
        finalCurrentDesiredRatio: summarizeNumbers(group.values.map((record) => Number(record.finalCurrentDesiredRatio ?? 0))),
        finalInFlightDesiredRatio: summarizeNumbers(group.values.map((record) => Number(record.finalInFlightDesiredRatio ?? 0))),
        finalCachedCurrentCellHits: summarizeNumbers(group.values.map((record) => Number(record.finalCachedCurrentCellHitCount ?? 0))),
        finalColdCurrentCellLoads: summarizeNumbers(group.values.map((record) => Number(record.finalColdCurrentCellLoadCount ?? 0))),
        finalStaleCurrentLoadAborts: summarizeNumbers(group.values.map((record) => Number(record.finalStaleCurrentLoadAbortCount ?? 0))),
        finalStaleCurrentCellDrops: summarizeNumbers(group.values.map((record) => Number(record.finalStaleCurrentCellDropCount ?? 0))),
        resourceCount: summarizeNumbers(group.values.map((record) => Number(record.resourceCount ?? 0))),
        resourceDurationMs: summarizeNumbers(group.values.map((record) => Number(record.resourceDurationMs ?? 0))),
        frameBudgetMisses: summarizeNumbers(group.values.map((record) => Number(record.frameBudgetMisses ?? 0))),
        longTaskCount: summarizeNumbers(group.values.map((record) => Number(record.longTaskCount ?? 0))),
      };
    });
}

/**
 * @param {Array<JourneySample>} samples
 * @param {{
 *   travelWindowMs: number;
 *   sampleDurationMs: number;
 * }} scenario
 * @param {{
 *   resources?: Array<{ duration?: number }>;
 *   frames?: Array<{ deltaMs?: number }>;
 *   longTasks?: Array<{ duration?: number }>;
 *   visibility?: typeof DEFAULT_VISIBILITY_THRESHOLDS;
 *   preMeasureSample?: JourneySample | null;
 * }} [options]
 */
export function computeJourneyRecordMetrics(samples, scenario, options = {}) {
  const visibility = {
    ...DEFAULT_VISIBILITY_THRESHOLDS,
    ...(options.visibility ?? {}),
  };
  const visibleSamples = annotateVisibleSamples(samples, visibility);
  const travelSamples = visibleSamples.filter((sample) => sample.elapsedMs <= scenario.travelWindowMs);
  const firstVisible = visibleSamples.find((sample) => sample.visible);
  const arrivalSample = findClosestSample(visibleSamples, scenario.travelWindowMs);
  const finalSample = visibleSamples.at(-1) ?? null;
  const resources = options.resources ?? [];
  const frames = options.frames ?? [];
  const longTasks = options.longTasks ?? [];
  const blankTravelCount = travelSamples.filter((sample) => !sample.visible).length;
  const visibleTravelCount = travelSamples.filter((sample) => sample.visible).length;
  const travelCount = Math.max(1, travelSamples.length);

  return {
    sampleCount: visibleSamples.length,
    timeToFirstVisibleMs: firstVisible ? round(firstVisible.elapsedMs) : scenario.sampleDurationMs,
    blankTravelRatio: round(blankTravelCount / travelCount, 4),
    visibleTravelRatio: round(visibleTravelCount / travelCount, 4),
    blankTravelSampleCount: blankTravelCount,
    milestones: createJourneyMilestoneSamples(samples, scenario, {
      preMeasureSample: options.preMeasureSample ?? null,
      visibility,
    }),
    arrivalVisible: arrivalSample?.visible ?? false,
    arrivalStarCount: arrivalSample?.debug?.starCount ?? null,
    arrivalCellCount: arrivalSample?.debug?.cellCount ?? null,
    arrivalLitPixelRatio: arrivalSample?.canvas?.litPixelRatio ?? null,
    arrivalActiveWorkItemCount: arrivalSample?.debug?.activeWorkItemCount ?? null,
    arrivalInFlightCellCount: arrivalSample?.debug?.inFlightCellCount ?? null,
    arrivalDesiredCellCount: arrivalSample?.debug?.desiredCellCount ?? null,
    arrivalCurrentCellCount: arrivalSample?.debug?.currentCellCount ?? null,
    arrivalCurrentDesiredRatio: ratioNullable(
      arrivalSample?.debug?.currentCellCount,
      arrivalSample?.debug?.desiredCellCount,
    ),
    arrivalInFlightDesiredRatio: ratioNullable(
      arrivalSample?.debug?.inFlightCellCount,
      arrivalSample?.debug?.desiredCellCount,
    ),
    arrivalCachedCurrentCellHitCount: arrivalSample?.debug?.cachedCurrentCellHitCount ?? null,
    arrivalColdCurrentCellLoadCount: arrivalSample?.debug?.coldCurrentCellLoadCount ?? null,
    arrivalStaleCurrentLoadAbortCount: arrivalSample?.debug?.staleCurrentLoadAbortCount ?? null,
    arrivalStaleCurrentCellDropCount: arrivalSample?.debug?.staleCurrentCellDropCount ?? null,
    arrivalDecodedCacheLeasedPayloads: arrivalSample?.debug?.decodedCacheLeasedPayloads ?? null,
    arrivalDecodedCacheLeasedPayloadBytes: arrivalSample?.debug?.decodedCacheLeasedPayloadBytes ?? null,
    arrivalDecodedCacheActiveLeases: arrivalSample?.debug?.decodedCacheActiveLeases ?? null,
    arrivalDecodedCacheLeasePressureBytes: arrivalSample?.debug?.decodedCacheLeasePressureBytes ?? null,
    finalVisible: finalSample?.visible ?? false,
    finalStarCount: finalSample?.debug?.starCount ?? null,
    finalCellCount: finalSample?.debug?.cellCount ?? null,
    finalActiveWorkItemCount: finalSample?.debug?.activeWorkItemCount ?? null,
    finalInFlightCellCount: finalSample?.debug?.inFlightCellCount ?? null,
    finalDesiredCellCount: finalSample?.debug?.desiredCellCount ?? null,
    finalCurrentCellCount: finalSample?.debug?.currentCellCount ?? null,
    finalCurrentDesiredRatio: ratioNullable(
      finalSample?.debug?.currentCellCount,
      finalSample?.debug?.desiredCellCount,
    ),
    finalInFlightDesiredRatio: ratioNullable(
      finalSample?.debug?.inFlightCellCount,
      finalSample?.debug?.desiredCellCount,
    ),
    finalCachedCurrentCellHitCount: finalSample?.debug?.cachedCurrentCellHitCount ?? null,
    finalColdCurrentCellLoadCount: finalSample?.debug?.coldCurrentCellLoadCount ?? null,
    finalStaleCurrentLoadAbortCount: finalSample?.debug?.staleCurrentLoadAbortCount ?? null,
    finalStaleCurrentCellDropCount: finalSample?.debug?.staleCurrentCellDropCount ?? null,
    finalDecodedCacheLeasedPayloads: finalSample?.debug?.decodedCacheLeasedPayloads ?? null,
    finalDecodedCacheLeasedPayloadBytes: finalSample?.debug?.decodedCacheLeasedPayloadBytes ?? null,
    finalDecodedCacheActiveLeases: finalSample?.debug?.decodedCacheActiveLeases ?? null,
    finalDecodedCacheLeasePressureBytes: finalSample?.debug?.decodedCacheLeasePressureBytes ?? null,
    resourceCount: resources.length,
    resourceDurationMs: round(resources.reduce((sum, resource) => sum + Number(resource.duration ?? 0), 0)),
    frameBudgetMisses: frames.filter((frame) => Number(frame.deltaMs ?? 0) > 24).length,
    longTaskCount: longTasks.length,
    longTaskDurationMs: round(longTasks.reduce((sum, task) => sum + Number(task.duration ?? 0), 0)),
  };
}

/**
 * @param {Array<JourneySample>} samples
 * @param {{
 *   travelWindowMs: number;
 *   sampleDurationMs: number;
 * }} scenario
 * @param {{
 *   preMeasureSample?: JourneySample | null;
 *   visibility?: typeof DEFAULT_VISIBILITY_THRESHOLDS;
 * }} [options]
 */
export function createJourneyMilestoneSamples(samples, scenario, options = {}) {
  const visibility = {
    ...DEFAULT_VISIBILITY_THRESHOLDS,
    ...(options.visibility ?? {}),
  };
  const visibleSamples = annotateVisibleSamples(samples, visibility);
  return {
    beforeMeasure: summarizeJourneySample(
      options.preMeasureSample
        ? {
            ...options.preMeasureSample,
            visible: isSampleVisible(options.preMeasureSample, visibility),
          }
        : null,
    ),
    afterClick: summarizeJourneySample(visibleSamples[0] ?? null),
    midTravel: summarizeJourneySample(findClosestSample(visibleSamples, scenario.travelWindowMs / 2)),
    arrival: summarizeJourneySample(findClosestSample(visibleSamples, scenario.travelWindowMs)),
    finalSettle: summarizeJourneySample(visibleSamples.at(-1) ?? null),
  };
}

/**
 * @param {{
 *   browserErrors?: string[];
 *   setupSample?: JourneySample | null;
 *   samples?: JourneySample[];
 *   scenario?: Partial<(typeof DEFAULT_JOURNEY_SCENARIOS)[number]>;
 *   visibility?: typeof DEFAULT_VISIBILITY_THRESHOLDS;
 * }} [options]
 */
export function computeJourneyRecordHealth(options = {}) {
  const visibility = {
    ...DEFAULT_VISIBILITY_THRESHOLDS,
    ...(options.visibility ?? {}),
  };
  const samples = options.samples ?? [];
  const allSamples = [
    ...(options.setupSample ? [options.setupSample] : []),
    ...samples,
  ];
  const visibleSamples = annotateVisibleSamples(samples, visibility);
  const setupVisible = options.setupSample
    ? isSampleVisible(options.setupSample, visibility)
    : false;
  const measuredHasVisible = visibleSamples.some((sample) => sample.visible);
  const canvasAvailable = allSamples.some((sample) =>
    sample?.canvas?.available === true || sample?.screenshot?.available === true
  );
  const debugAvailable = allSamples.some((sample) => sample?.debug?.available === true);
  const browserErrors = options.browserErrors ?? [];
  const expectedSampleCount = computeExpectedSampleCount(options.scenario);
  const sampleCoverageRatio = expectedSampleCount > 0
    ? round(samples.length / expectedSampleCount, 4)
    : null;
  const reasons = [];
  const warnings = [];

  if (browserErrors.length > 0) reasons.push('page-errors');
  if (!canvasAvailable) reasons.push('missing-canvas-samples');
  if (samples.length === 0) reasons.push('missing-measurement-samples');
  if (expectedSampleCount > 0 && samples.length < Math.max(1, Math.floor(expectedSampleCount * 0.75))) {
    warnings.push('low-sample-coverage');
  }
  if (!setupVisible) reasons.push('setup-not-visible');
  if (options.scenario?.journey === 'star-clusters' && !measuredHasVisible) {
    reasons.push('cluster-measured-blank');
  }

  return {
    healthy: reasons.length === 0,
    reasons,
    warnings,
    browserErrorCount: browserErrors.length,
    canvasAvailable,
    debugAvailable,
    setupVisible,
    measuredHasVisible,
    sampleCount: samples.length,
    expectedSampleCount,
    sampleCoverageRatio,
  };
}

/**
 * @typedef {{
 *   elapsedMs: number;
 *   canvas?: {
 *     litPixelRatio?: number | null;
 *     maxLuma?: number | null;
 *   } | null;
 *   screenshot?: {
 *     available?: boolean;
 *     litPixelRatio?: number | null;
 *     maxLuma?: number | null;
 *   } | null;
 *   debug?: {
 *     available?: boolean;
 *     starCount?: number | null;
 *     cellCount?: number | null;
 *     activeWorkItemCount?: number | null;
 *     inFlightCellCount?: number | null;
 *     desiredCellCount?: number | null;
 *     currentCellCount?: number | null;
 *     cachedCurrentCellHitCount?: number | null;
 *     coldCurrentCellLoadCount?: number | null;
 *     staleCurrentLoadAbortCount?: number | null;
 *     staleCurrentCellDropCount?: number | null;
 *     decodedCacheLeasedPayloads?: number | null;
 *     decodedCacheLeasedPayloadBytes?: number | null;
 *     decodedCacheActiveLeases?: number | null;
 *     decodedCacheLeasePressureBytes?: number | null;
 *   } | null;
 * }} JourneySample
 */

/**
 * @param {{
 *   browser: import('playwright').Browser;
 *   target: { label: string; baseUrl: string };
 *   scenario: (typeof DEFAULT_JOURNEY_SCENARIOS)[number];
 *   runIndex: number;
 *   timeoutMs: number;
 *   viewport: { width: number; height: number };
 *   visibility: typeof DEFAULT_VISIBILITY_THRESHOLDS;
 * }} options
 */
async function runScenario(options) {
  const page = await options.browser.newPage({ viewport: options.viewport });
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(installBrowserProbe);

  try {
    const url = new URL(options.scenario.path, ensureTrailingSlash(options.target.baseUrl)).href;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    await page.waitForSelector(options.scenario.readySelector, { timeout: options.timeoutMs });
    await page.waitForFunction((selector) => {
      return Boolean(document.querySelector(selector) ?? document.querySelector('canvas'));
    }, options.scenario.canvasSelector, { timeout: options.timeoutMs });

    for (const setup of options.scenario.setup ?? []) {
      await page.click(setup.click, { timeout: options.timeoutMs });
      await page.waitForTimeout(Math.max(0, Number(setup.settleMs ?? 0)));
    }

    const preMeasureStartedAt = await page.evaluate(() => performance.now());
    const preMeasureSample = await waitForVisibleBenchmarkSample({
      page,
      canvasSelector: options.scenario.canvasSelector,
      startedAt: preMeasureStartedAt,
      visibility: options.visibility,
      timeoutMs: options.scenario.setupVisibilityTimeoutMs,
    });

    await page.evaluate(() => {
      performance.clearResourceTimings?.();
      globalThis.__SKYKIT_JOURNEY_BENCHMARK?.reset?.();
    });

    const startedAt = await page.evaluate(() => performance.now());
    await page.click(options.scenario.measureClick, { timeout: options.timeoutMs });
    const samples = [];
    const deadline = Date.now() + options.scenario.sampleDurationMs;
    while (Date.now() <= deadline) {
      samples.push(await collectBenchmarkSample(page, options.scenario.canvasSelector, startedAt));
      await page.waitForTimeout(options.scenario.sampleIntervalMs);
    }

    const browserSummary = await page.evaluate(() => globalThis.__SKYKIT_JOURNEY_BENCHMARK.collectSummary());
    const resources = await page.evaluate(() =>
      performance.getEntriesByType('resource')
        .filter((entry) => /octree|star|gaia|payload|index/i.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        })),
    );
    const metrics = computeJourneyRecordMetrics(samples, options.scenario, {
      resources,
      frames: browserSummary.frames,
      longTasks: browserSummary.longTasks,
      visibility: options.visibility,
      preMeasureSample,
    });
    const health = computeJourneyRecordHealth({
      browserErrors: errors,
      setupSample: preMeasureSample,
      samples,
      scenario: options.scenario,
      visibility: options.visibility,
    });

    return {
      target: options.target.label,
      baseUrl: options.target.baseUrl,
      journey: options.scenario.journey,
      scenario: options.scenario.name,
      runIndex: options.runIndex,
      path: options.scenario.path,
      travelWindowMs: options.scenario.travelWindowMs,
      sampleDurationMs: options.scenario.sampleDurationMs,
      browserErrors: errors,
      health,
      ...metrics,
      preMeasureSample,
      rawSamples: samples,
      resources,
      frames: browserSummary.frames,
      longTasks: browserSummary.longTasks,
    };
  } finally {
    await page.close();
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} canvasSelector
 * @param {number} startedAt
 */
async function collectBenchmarkSample(page, canvasSelector, startedAt) {
  const sample = await page.evaluate(
    ({ canvasSelector: selector, startedAt: browserStartedAt }) =>
      globalThis.__SKYKIT_JOURNEY_BENCHMARK.collectSample(selector, browserStartedAt),
    {
      canvasSelector,
      startedAt,
    },
  );
  if (needsScreenshotVisualSample(sample)) {
    sample.screenshot = await sampleElementScreenshot(page, canvasSelector);
  }
  return sample;
}

/**
 * @param {{
 *   page: import('playwright').Page;
 *   canvasSelector: string;
 *   startedAt: number;
 *   visibility: typeof DEFAULT_VISIBILITY_THRESHOLDS;
 *   timeoutMs?: number;
 * }} options
 */
async function waitForVisibleBenchmarkSample(options) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 0));
  const deadline = Date.now() + timeoutMs;
  let latest = await collectBenchmarkSample(options.page, options.canvasSelector, options.startedAt);
  while (!isSampleVisible(latest, options.visibility) && Date.now() < deadline) {
    await options.page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
    latest = await collectBenchmarkSample(options.page, options.canvasSelector, options.startedAt);
  }
  return latest;
}

function installBrowserProbe() {
  const probe = {
    frames: [],
    longTasks: [],
    lastFrameAt: null,
    reset() {
      this.frames = [];
      this.longTasks = [];
      this.lastFrameAt = null;
    },
    collectSample(canvasSelector, startedAt) {
      return {
        elapsedMs: Math.max(0, performance.now() - startedAt),
        canvas: sampleCanvas(canvasSelector),
        debug: summarizeSkykitDebug(),
      };
    },
    collectSummary() {
      return {
        frames: this.frames.slice(),
        longTasks: this.longTasks.slice(),
      };
    },
  };

  function frame(now) {
    if (probe.lastFrameAt != null) {
      probe.frames.push({ deltaMs: now - probe.lastFrameAt });
      if (probe.frames.length > 10_000) probe.frames.splice(0, probe.frames.length - 10_000);
    }
    probe.lastFrameAt = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Long task observation is optional and browser-dependent.
  }

  globalThis.__SKYKIT_JOURNEY_BENCHMARK = probe;

  function sampleCanvas(selector) {
    const selected = Array.from(document.querySelectorAll(selector));
    const candidates = selected.length > 0 ? selected : Array.from(document.querySelectorAll('canvas'));
    const canvas = candidates
      .filter((candidate) => candidate instanceof HTMLCanvasElement)
      .sort((left, right) => ((right.width || right.clientWidth) * (right.height || right.clientHeight)) -
        ((left.width || left.clientWidth) * (left.height || left.clientHeight)))[0];
    if (!(canvas instanceof HTMLCanvasElement)) {
      return { available: false, error: 'missing-canvas' };
    }

    const width = Math.max(1, Math.min(96, canvas.width || canvas.clientWidth || 1));
    const height = Math.max(1, Math.min(96, canvas.height || canvas.clientHeight || 1));
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) return { available: false, error: 'missing-2d-context' };

    try {
      context.drawImage(canvas, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      let litPixels = 0;
      let totalLuma = 0;
      let maxLuma = 0;
      for (let index = 0; index < data.length; index += 4) {
        const luma = (data[index] + data[index + 1] + data[index + 2]) / 3;
        totalLuma += luma;
        maxLuma = Math.max(maxLuma, luma);
        if (Math.max(data[index], data[index + 1], data[index + 2]) >= 28) {
          litPixels += 1;
        }
      }
      const pixelCount = width * height;
      return {
        available: true,
        width: canvas.width,
        height: canvas.height,
        sampleWidth: width,
        sampleHeight: height,
        litPixelRatio: litPixels / pixelCount,
        meanLuma: totalLuma / pixelCount,
        maxLuma,
      };
    } catch (error) {
      return {
        available: false,
        width: canvas.width,
        height: canvas.height,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function summarizeSkykitDebug() {
    const debug = globalThis.skykitDebug;
    if (!debug || typeof debug.snapshot !== 'function') {
      return { available: false };
    }
    try {
      return summarizeSnapshot(debug.snapshot());
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function summarizeSnapshot(snapshot) {
    const summary = {
      available: true,
      starCount: null,
      cellCount: null,
      desiredCellCount: null,
      currentCellCount: null,
      inFlightCellCount: null,
      activeWorkItemCount: null,
      cachedCurrentCellHitCount: null,
      coldCurrentCellLoadCount: null,
      staleCurrentLoadAbortCount: null,
      staleCurrentCellDropCount: null,
      decodedCacheLeasedPayloads: null,
      decodedCacheLeasedPayloadBytes: null,
      decodedCacheActiveLeases: null,
      decodedCacheLeasePressureBytes: null,
      demandStatuses: [],
    };
    const seen = new Set();
    walk(snapshot, 0);
    return summary;

    function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) return;
      seen.add(value);

      if ('renderer' in value && value.renderer && typeof value.renderer === 'object') {
        const renderer = value.renderer;
        summary.starCount = maxNullable(summary.starCount, renderer.starCount);
        summary.cellCount = maxNullable(summary.cellCount, renderer.cellCount);
      }

      if ('demand' in value && value.demand && typeof value.demand === 'object') {
        const demand = value.demand;
        summary.desiredCellCount = maxNullable(summary.desiredCellCount, demand.desiredCellCount);
        summary.currentCellCount = maxNullable(summary.currentCellCount, demand.currentCellCount);
        summary.inFlightCellCount = maxNullable(summary.inFlightCellCount, demand.inFlightCellCount);
        summary.activeWorkItemCount = maxNullable(summary.activeWorkItemCount, demand.activeWorkItemCount);
        summary.cachedCurrentCellHitCount = maxNullable(summary.cachedCurrentCellHitCount, demand.cachedCurrentCellHitCount);
        summary.coldCurrentCellLoadCount = maxNullable(summary.coldCurrentCellLoadCount, demand.coldCurrentCellLoadCount);
        summary.staleCurrentLoadAbortCount = maxNullable(summary.staleCurrentLoadAbortCount, demand.staleCurrentLoadAbortCount);
        summary.staleCurrentCellDropCount = maxNullable(summary.staleCurrentCellDropCount, demand.staleCurrentCellDropCount);
        if (typeof demand.status === 'string') summary.demandStatuses.push(demand.status);
      }

      if ('cache' in value && value.cache && typeof value.cache === 'object') {
        const cache = value.cache;
        summary.decodedCacheLeasedPayloads = maxNullable(
          summary.decodedCacheLeasedPayloads,
          cache.decodedLeasedPayloads,
        );
      }

      if ('memory' in value && value.memory && typeof value.memory === 'object') {
        const memory = value.memory;
        summary.decodedCacheLeasedPayloadBytes = maxNullable(
          summary.decodedCacheLeasedPayloadBytes,
          memory.retainedDecodedPayloadBytes,
        );
        summary.decodedCacheLeasePressureBytes = maxNullable(
          summary.decodedCacheLeasePressureBytes,
          memory.decodedLeasePressureBytes,
        );
      }

      if ('stats' in value && value.stats && typeof value.stats === 'object') {
        const stats = value.stats;
        summary.decodedCacheLeasedPayloads = maxNullable(
          summary.decodedCacheLeasedPayloads,
          stats.decodedCacheLeasedPayloads,
        );
        summary.decodedCacheLeasedPayloadBytes = maxNullable(
          summary.decodedCacheLeasedPayloadBytes,
          stats.decodedCacheLeasedPayloadBytes,
        );
        summary.decodedCacheActiveLeases = maxNullable(
          summary.decodedCacheActiveLeases,
          stats.decodedCacheActiveLeases,
        );
        summary.decodedCacheLeasePressureBytes = maxNullable(
          summary.decodedCacheLeasePressureBytes,
          stats.decodedCacheLeasePressureBytes,
        );
      }

      if ('session' in value && value.session && typeof value.session === 'object') {
        walk(value.session, depth + 1);
      }
      if ('provider' in value && value.provider && typeof value.provider === 'object') {
        walk(value.provider, depth + 1);
      }
      if ('source' in value && value.source && typeof value.source === 'object') {
        walk(value.source, depth + 1);
      }
      if (Array.isArray(value.parts)) {
        for (const part of value.parts) walk(part, depth + 1);
      }
      if ('snapshot' in value && value.snapshot && typeof value.snapshot === 'object') {
        walk(value.snapshot, depth + 1);
      }
    }
  }

  function maxNullable(left, right) {
    const rightNumber = Number(right);
    if (!Number.isFinite(rightNumber)) return left;
    return left == null ? rightNumber : Math.max(left, rightNumber);
  }
}

/**
 * @param {JourneySample[]} samples
 * @param {typeof DEFAULT_VISIBILITY_THRESHOLDS} visibility
 */
function annotateVisibleSamples(samples, visibility) {
  return samples.map((sample) => ({
    ...sample,
    visible: isSampleVisible(sample, visibility),
  }));
}

/**
 * @param {JourneySample} sample
 * @param {typeof DEFAULT_VISIBILITY_THRESHOLDS} visibility
 */
function isSampleVisible(sample, visibility) {
  const starCount = Number(sample.debug?.starCount);
  if (Number.isFinite(starCount) && starCount >= visibility.minStarCount) {
    return true;
  }
  const visual = sample.screenshot?.available ? sample.screenshot : sample.canvas;
  const litPixelRatio = Number(visual?.litPixelRatio);
  const maxLuma = Number(visual?.maxLuma);
  return Number.isFinite(litPixelRatio) &&
    Number.isFinite(maxLuma) &&
    litPixelRatio >= visibility.minLitPixelRatio &&
    maxLuma >= visibility.minMaxLuma;
}

/**
 * @param {(JourneySample & { visible?: boolean }) | null} sample
 */
function summarizeJourneySample(sample) {
  if (!sample) return null;
  const visual = sample.screenshot?.available ? sample.screenshot : sample.canvas;
  return {
    elapsedMs: round(Number(sample.elapsedMs ?? 0)),
    visible: sample.visible === true,
    canvasAvailable: sample.canvas?.available === true,
    screenshotAvailable: sample.screenshot?.available === true,
    debugAvailable: sample.debug?.available === true,
    starCount: numberOrNull(sample.debug?.starCount),
    cellCount: numberOrNull(sample.debug?.cellCount),
    desiredCellCount: numberOrNull(sample.debug?.desiredCellCount),
    currentCellCount: numberOrNull(sample.debug?.currentCellCount),
    inFlightCellCount: numberOrNull(sample.debug?.inFlightCellCount),
    activeWorkItemCount: numberOrNull(sample.debug?.activeWorkItemCount),
    cachedCurrentCellHitCount: numberOrNull(sample.debug?.cachedCurrentCellHitCount),
    coldCurrentCellLoadCount: numberOrNull(sample.debug?.coldCurrentCellLoadCount),
    staleCurrentLoadAbortCount: numberOrNull(sample.debug?.staleCurrentLoadAbortCount),
    staleCurrentCellDropCount: numberOrNull(sample.debug?.staleCurrentCellDropCount),
    decodedCacheLeasedPayloads: numberOrNull(sample.debug?.decodedCacheLeasedPayloads),
    decodedCacheLeasedPayloadBytes: numberOrNull(sample.debug?.decodedCacheLeasedPayloadBytes),
    decodedCacheActiveLeases: numberOrNull(sample.debug?.decodedCacheActiveLeases),
    decodedCacheLeasePressureBytes: numberOrNull(sample.debug?.decodedCacheLeasePressureBytes),
    currentDesiredRatio: ratioNullable(
      sample.debug?.currentCellCount,
      sample.debug?.desiredCellCount,
    ),
    inFlightDesiredRatio: ratioNullable(
      sample.debug?.inFlightCellCount,
      sample.debug?.desiredCellCount,
    ),
    litPixelRatio: numberOrNull(visual?.litPixelRatio),
    maxLuma: numberOrNull(visual?.maxLuma),
    demandStatuses: Array.isArray(sample.debug?.demandStatuses)
      ? sample.debug.demandStatuses.slice()
      : [],
  };
}

/**
 * @param {Partial<(typeof DEFAULT_JOURNEY_SCENARIOS)[number]> | undefined} scenario
 */
function computeExpectedSampleCount(scenario) {
  const duration = Number(scenario?.sampleDurationMs);
  const interval = Number(scenario?.sampleIntervalMs);
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(interval) || interval <= 0) {
    return 0;
  }
  return Math.floor(duration / interval) + 1;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratioNullable(numerator, denominator) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0
    ? round(top / bottom, 4)
    : null;
}

/**
 * @param {JourneySample} sample
 */
function needsScreenshotVisualSample(sample) {
  return !Number.isFinite(Number(sample.debug?.starCount));
}

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
async function sampleElementScreenshot(page, selector) {
  try {
    const locator = page.locator(selector).first();
    if (await locator.count() === 0) {
      return { available: false, source: 'screenshot', error: 'missing-element' };
    }
    const png = await locator.screenshot({ timeout: 1_500 });
    return {
      source: 'screenshot',
      ...analyzePngPixels(png),
    };
  } catch (error) {
    return {
      available: false,
      source: 'screenshot',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {Buffer} png
 */
function analyzePngPixels(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < signature.length || !png.subarray(0, signature.length).equals(signature)) {
    return { available: false, error: 'invalid-png-signature' };
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];
  let offset = signature.length;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) {
      return { available: false, error: 'truncated-png-chunk' };
    }
    if (type === 'IHDR') {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9];
      interlace = png[dataStart + 12];
    } else if (type === 'IDAT') {
      idatChunks.push(png.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!(width > 0) || !(height > 0) || bitDepth !== 8 || channels === 0 || interlace !== 0) {
    return {
      available: false,
      width,
      height,
      error: `unsupported-png:${bitDepth}:${colorType}:${interlace}`,
    };
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rowStride = width * channels;
  let inputOffset = 0;
  let previous = Buffer.alloc(rowStride);
  let litPixels = 0;
  let totalLuma = 0;
  let maxLuma = 0;
  let sampledPixels = 0;
  const sampleEvery = Math.max(1, Math.floor((width * height) / 12_000));

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.alloc(rowStride);
    for (let index = 0; index < rowStride; index += 1) {
      const raw = inflated[inputOffset + index];
      const left = index >= channels ? row[index - channels] : 0;
      const up = previous[index] ?? 0;
      const upLeft = index >= channels ? previous[index - channels] ?? 0 : 0;
      row[index] = (raw + pngFilterValue(filter, left, up, upLeft)) & 0xff;
    }
    inputOffset += rowStride;

    for (let x = 0; x < width; x += sampleEvery) {
      const index = x * channels;
      const r = row[index];
      const g = channels === 1 ? r : row[index + 1];
      const b = channels === 1 ? r : row[index + 2];
      const luma = (r + g + b) / 3;
      totalLuma += luma;
      maxLuma = Math.max(maxLuma, luma);
      if (Math.max(r, g, b) >= 28) {
        litPixels += 1;
      }
      sampledPixels += 1;
    }
    previous = row;
  }

  return {
    available: true,
    width,
    height,
    sampleCount: sampledPixels,
    litPixelRatio: sampledPixels === 0 ? 0 : litPixels / sampledPixels,
    meanLuma: sampledPixels === 0 ? 0 : totalLuma / sampledPixels,
    maxLuma,
  };
}

function pngFilterValue(filter, left, up, upLeft) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paethPredictor(left, up, upLeft);
    default:
      return 0;
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

/**
 * @param {Array<JourneySample & { visible?: boolean }>} samples
 * @param {number} elapsedMs
 */
function findClosestSample(samples, elapsedMs) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const distance = Math.abs(Number(sample.elapsedMs ?? 0) - elapsedMs);
    if (distance < closestDistance) {
      closest = sample;
      closestDistance = distance;
    }
  }
  return closest;
}

/**
 * @param {Array<{ label: string; baseUrl: string }>} targets
 */
function normalizeTargets(targets) {
  return targets.map((target, index) => {
    const label = typeof target.label === 'string' && target.label.trim()
      ? target.label.trim()
      : `target-${index + 1}`;
    const baseUrl = typeof target.baseUrl === 'string' && target.baseUrl.trim()
      ? target.baseUrl.trim()
      : null;
    if (!baseUrl) {
      throw new TypeError(`Journey benchmark target ${label} is missing baseUrl.`);
    }
    return { label, baseUrl: ensureTrailingSlash(baseUrl) };
  });
}

function compactScenario(scenario) {
  return {
    name: scenario.name,
    journey: scenario.journey,
    path: scenario.path,
    travelWindowMs: scenario.travelWindowMs,
    sampleDurationMs: scenario.sampleDurationMs,
    setupVisibilityTimeoutMs: scenario.setupVisibilityTimeoutMs,
  };
}

/**
 * @param {Array<Record<string, unknown>>} records
 */
function summarizeJourneyTotals(records) {
  return {
    scenarioCount: records.length,
    healthyRunRatio: summarizeNumbers(records.map((record) => Number(record.health?.healthy === true ? 1 : 0))),
    setupVisibleRatio: summarizeNumbers(records.map((record) => Number(record.health?.setupVisible === true ? 1 : 0))),
    measuredVisibleRatio: summarizeNumbers(records.map((record) => Number(record.health?.measuredHasVisible === true ? 1 : 0))),
    debugAvailableRatio: summarizeNumbers(records.map((record) => Number(record.health?.debugAvailable === true ? 1 : 0))),
    sampleCoverageRatio: summarizeNumbers(records.map((record) => Number(record.health?.sampleCoverageRatio ?? 0))),
    timeToFirstVisibleMs: summarizeNumbers(records.map((record) => Number(record.timeToFirstVisibleMs ?? 0))),
    blankTravelRatio: summarizeNumbers(records.map((record) => Number(record.blankTravelRatio ?? 0))),
    visibleTravelRatio: summarizeNumbers(records.map((record) => Number(record.visibleTravelRatio ?? 0))),
    arrivalCurrentDesiredRatio: summarizeNumbers(records.map((record) => Number(record.arrivalCurrentDesiredRatio ?? 0))),
    finalCurrentDesiredRatio: summarizeNumbers(records.map((record) => Number(record.finalCurrentDesiredRatio ?? 0))),
    finalInFlightCells: summarizeNumbers(records.map((record) => Number(record.finalInFlightCellCount ?? 0))),
    frameBudgetMisses: summarizeNumbers(records.map((record) => Number(record.frameBudgetMisses ?? 0))),
    longTaskCount: summarizeNumbers(records.map((record) => Number(record.longTaskCount ?? 0))),
  };
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
