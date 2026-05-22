#!/usr/bin/env node
import { createAndWriteBaseline } from './baseline.js';
import { runBrowserSchedulerBenchmarkSuite } from './browser-suite.js';
import { runPlannerBenchmarkSuite } from './planner-suite.js';

const planner = await runPlannerBenchmarkSuite();
const browser = await runBrowserSchedulerBenchmarkSuite();
const baseline = await createAndWriteBaseline({
  label: 'current-alpha',
  planner,
  browser,
});

console.log(`Wrote ${baseline.label} benchmark baseline`);
console.log(`Planner mean plan time: ${baseline.planner.totals.planMs.mean} ms`);
console.log(`Browser mean live time-to-current: ${baseline.browser.totals.liveTimeToCurrentMs.mean} ms`);
