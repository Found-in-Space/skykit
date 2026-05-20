import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { groupRecords, round, summarizeNumbers } from './metrics.js';

const DEFAULT_PROFILES = Object.freeze([
  { name: 'fast', latencyMs: 8, bandwidthBytesPerMs: 48_000, jitterMs: 2, decodeMsPerKb: 0.002, drainMs: 120 },
  { name: 'medium', latencyMs: 45, bandwidthBytesPerMs: 12_000, jitterMs: 12, decodeMsPerKb: 0.006, drainMs: 220 },
  { name: 'slow', latencyMs: 120, bandwidthBytesPerMs: 3_000, jitterMs: 25, decodeMsPerKb: 0.012, drainMs: 320 },
]);

const DEFAULT_WORKLOADS = Object.freeze([
  { name: 'steady-cruise', ticks: 6, tickMs: 24, livePerTick: 8, warmPerTick: 12, cellStride: 9, cancelAtTick: null },
  { name: 'fast-transit', ticks: 6, tickMs: 18, livePerTick: 12, warmPerTick: 18, cellStride: 17, cancelAtTick: null },
  { name: 'sudden-turn', ticks: 6, tickMs: 22, livePerTick: 10, warmPerTick: 20, cellStride: 23, cancelAtTick: 3 },
  { name: 'lookahead-heavy', ticks: 6, tickMs: 26, livePerTick: 6, warmPerTick: 24, cellStride: 13, cancelAtTick: null },
]);

/**
 * @param {{
 *   profiles?: typeof DEFAULT_PROFILES;
 *   workloads?: typeof DEFAULT_WORKLOADS;
 *   runsDir?: string;
 * }} [options]
 */
export async function runBrowserSchedulerBenchmarkSuite(options = {}) {
  const { chromium } = await import('playwright');
  const runsDir = options.runsDir ?? path.resolve('benchmarks/star-planner/.runs');
  await mkdir(runsDir, { recursive: true });
  const schedulerUrl = pathToFileURL(
    path.resolve('packages/star-octree-provider/src/star-octree-scheduler.js'),
  ).href;
  const runnerPath = path.join(runsDir, 'browser-scheduler-runner.html');
  const config = {
    profiles: options.profiles ?? DEFAULT_PROFILES,
    workloads: options.workloads ?? DEFAULT_WORKLOADS,
  };
  await writeFile(runnerPath, createBrowserRunnerHtml(schedulerUrl, config), 'utf8');

  const browser = await chromium.launch({
    headless: true,
    args: ['--allow-file-access-from-files'],
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(message.text());
      }
    });
    await page.goto(pathToFileURL(runnerPath).href);
    try {
      await page.waitForFunction(() => globalThis.__STAR_PLANNER_BENCHMARK_RESULT !== undefined, null, {
        timeout: 90_000,
      });
    } catch (error) {
      if (pageErrors.length > 0) {
        throw new Error(`Browser scheduler benchmark page failed: ${pageErrors.join('; ')}`);
      }
      throw error;
    }
    const pageResult = await page.evaluate(() => globalThis.__STAR_PLANNER_BENCHMARK_RESULT);
    const records = pageResult.records.map((record) => ({
      ...record,
      liveTimeToCurrentMs: round(record.liveTimeToCurrentMs),
      warmInterferenceMs: round(record.warmInterferenceMs),
      maxQueueDepth: Math.round(record.maxQueueDepth),
      frameBudgetMisses: Math.round(record.frameBudgetMisses),
      cancelledTasks: Math.round(record.cancelledTasks),
      warmPromotionRate: round(record.warmPromotionRate, 4),
      warmReuseRate: round(record.warmReuseRate, 4),
    }));
    return {
      kind: 'browser-scheduler',
      chromiumVersion: browser.version(),
      records,
      summaries: summarizeBrowserGroups(records),
      totals: summarizeBrowserTotals(records),
    };
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} schedulerUrl
 * @param {unknown} config
 */
function createBrowserRunnerHtml(schedulerUrl, config) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Star Planner Scheduler Benchmark</title></head>
<body>
<script>window.__STAR_PLANNER_BENCHMARK_CONFIG = ${JSON.stringify(config)};</script>
<script type="module">
import { createStarOctreeScheduler } from ${JSON.stringify(schedulerUrl)};

const config = window.__STAR_PLANNER_BENCHMARK_CONFIG;
const records = [];

for (const profile of config.profiles) {
  for (const workload of config.workloads) {
    records.push(await runWorkload(profile, workload));
  }
}

window.__STAR_PLANNER_BENCHMARK_RESULT = { records };

async function runWorkload(profile, workload) {
  const scheduler = createStarOctreeScheduler({
    limits: {
      maxInflightPayloadBatches: 4,
      maxInflightPrefetchPayloadBatches: 2,
      maxInflightDecodeTasks: 2,
      maxInflightPrefetchDecodeTasks: 1,
    },
  });
  const promises = [];
  const livePromises = [];
  const warmTasks = new Map();
  const completedWarmCells = new Set();
  const queueDepths = [];
  let frameBudgetMisses = 0;
  let lastFrameAt = performance.now();
  let liveStartedAfterWarm = 0;
  let warmPromotions = 0;
  let warmReuses = 0;
  let warmScheduled = 0;
  let cancelledTasks = 0;
  let running = true;

  requestAnimationFrame(function frame(now) {
    if (now - lastFrameAt > 24) frameBudgetMisses += 1;
    lastFrameAt = now;
    if (running) requestAnimationFrame(frame);
  });

  const startedAt = performance.now();
  for (let tick = 0; tick < workload.ticks; tick += 1) {
    if (workload.cancelAtTick === tick) {
      for (const task of warmTasks.values()) {
        task.cancel('benchmark-turn');
        cancelledTasks += 1;
      }
      warmTasks.clear();
    }

    for (let index = 0; index < workload.livePerTick; index += 1) {
      const cellKey = createCellKey(workload, tick, index, 0);
      if (completedWarmCells.has(cellKey)) {
        warmReuses += 1;
        continue;
      }
      const existingWarm = warmTasks.get(cellKey);
      if (existingWarm) {
        existingWarm.work.lane = 'current';
        existingWarm.task.promote('current', 0);
        warmTasks.delete(cellKey);
        warmPromotions += 1;
        livePromises.push(existingWarm.promise);
        continue;
      }
      const work = createWork(profile, workload, tick, index, 'current');
      const task = scheduler.schedule({
        kind: 'payload',
        lane: 'current',
        priority: tick * 100 + index,
      }, () => runWork(work));
      const promise = task.promise.catch(() => null);
      promises.push(promise);
      livePromises.push(promise);
    }

    for (let index = 0; index < workload.warmPerTick; index += 1) {
      const cellKey = createCellKey(workload, tick + 2, index, 1);
      if (completedWarmCells.has(cellKey) || warmTasks.has(cellKey)) continue;
      const work = createWork(profile, workload, tick, index, 'prefetch', cellKey);
      const task = scheduler.schedule({
        kind: index % 3 === 0 ? 'decode' : 'payload',
        lane: 'prefetch',
        priority: tick * 100 + index,
      }, async () => {
        const result = await runWork(work);
        if (work.lane === 'prefetch') completedWarmCells.add(cellKey);
        return result;
      });
      const promise = task.promise.catch(() => null);
      promises.push(promise);
      warmTasks.set(cellKey, { task, promise, work, cancel: task.cancel });
      warmScheduled += 1;
    }

    const snapshot = scheduler.getSnapshot();
    queueDepths.push(snapshot.queued + snapshot.active);
    await sleep(workload.tickMs);
  }

  const liveStartedAt = performance.now();
  await Promise.allSettled(livePromises);
  const liveFinishedAt = performance.now();
  await sleep(profile.drainMs);

  for (const task of warmTasks.values()) {
    task.cancel('benchmark-drain-complete');
  }
  await sleep(0);
  running = false;
  const snapshot = scheduler.getSnapshot();

  return {
    profile: profile.name,
    workload: workload.name,
    liveTimeToCurrentMs: liveFinishedAt - startedAt,
    warmInterferenceMs: liveStartedAfterWarm + Math.max(0, liveFinishedAt - liveStartedAt - profile.latencyMs),
    maxQueueDepth: Math.max(0, ...queueDepths),
    frameBudgetMisses,
    cancelledTasks: snapshot.stats.cancelled + cancelledTasks,
    warmPromotionRate: warmScheduled === 0 ? 0 : warmPromotions / warmScheduled,
    warmReuseRate: warmScheduled === 0 ? 0 : warmReuses / warmScheduled,
    queuedTasks: snapshot.stats.queued,
    completedTasks: snapshot.stats.completed,
    failedTasks: snapshot.stats.failed,
  };

  function createWork(profileInput, workloadInput, tick, index, lane, cellKey = null) {
    return {
      profile: profileInput,
      workload: workloadInput,
      tick,
      index,
      lane,
      cellKey,
      bytes: 12_000 + ((tick * 17 + index * 29 + workloadInput.cellStride) % 90) * 1024,
    };
  }

  async function runWork(work) {
    if (work.lane === 'current' && scheduler.getSnapshot().activeByLane.prefetch > 0) {
      liveStartedAfterWarm += 1;
    }
    const fetchMs =
      work.profile.latencyMs +
      work.bytes / work.profile.bandwidthBytesPerMs +
      deterministicJitter(work.profile.jitterMs, work.tick, work.index);
    await sleep(fetchMs);
    busyWait((work.bytes / 1024) * work.profile.decodeMsPerKb);
    return work.cellKey ?? createCellKey(work.workload, work.tick, work.index, work.lane === 'prefetch' ? 1 : 0);
  }
}

function createCellKey(workload, tick, index, offset) {
  const ordinal = (tick * workload.cellStride + index * 7 + offset * 19) % 240;
  return 'cell:' + ordinal;
}

function deterministicJitter(jitterMs, tick, index) {
  if (!(jitterMs > 0)) return 0;
  return ((tick * 13 + index * 17) % 11) / 10 * jitterMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function busyWait(ms) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < ms) {}
}
</script>
</body>
</html>
`;
}

/**
 * @param {Array<Record<string, number | string>>} records
 */
function summarizeBrowserGroups(records) {
  return groupRecords(records, ['profile', 'workload'])
    .map((group) => {
      const first = group.values[0] ?? {};
      return {
        profile: String(first.profile),
        workload: String(first.workload),
        liveTimeToCurrentMs: summarizeNumbers(group.values.map((record) => Number(record.liveTimeToCurrentMs ?? 0))),
        warmInterferenceMs: summarizeNumbers(group.values.map((record) => Number(record.warmInterferenceMs ?? 0))),
        maxQueueDepth: summarizeNumbers(group.values.map((record) => Number(record.maxQueueDepth ?? 0))),
        frameBudgetMisses: summarizeNumbers(group.values.map((record) => Number(record.frameBudgetMisses ?? 0))),
        cancelledTasks: summarizeNumbers(group.values.map((record) => Number(record.cancelledTasks ?? 0))),
        warmPromotionRate: summarizeNumbers(group.values.map((record) => Number(record.warmPromotionRate ?? 0))),
        warmReuseRate: summarizeNumbers(group.values.map((record) => Number(record.warmReuseRate ?? 0))),
      };
    });
}

/**
 * @param {Array<Record<string, number | string>>} records
 */
function summarizeBrowserTotals(records) {
  return {
    scenarioCount: records.length,
    liveTimeToCurrentMs: summarizeNumbers(records.map((record) => Number(record.liveTimeToCurrentMs ?? 0))),
    warmInterferenceMs: summarizeNumbers(records.map((record) => Number(record.warmInterferenceMs ?? 0))),
    maxQueueDepth: summarizeNumbers(records.map((record) => Number(record.maxQueueDepth ?? 0))),
    frameBudgetMisses: summarizeNumbers(records.map((record) => Number(record.frameBudgetMisses ?? 0))),
    cancelledTasks: summarizeNumbers(records.map((record) => Number(record.cancelledTasks ?? 0))),
    warmPromotionRate: summarizeNumbers(records.map((record) => Number(record.warmPromotionRate ?? 0))),
    warmReuseRate: summarizeNumbers(records.map((record) => Number(record.warmReuseRate ?? 0))),
  };
}
