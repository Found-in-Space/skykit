#!/usr/bin/env node
import { writeJson, RUNS_DIR } from './baseline.js';
import { runBrowserSchedulerBenchmarkSuite } from './browser-suite.js';

const result = await runBrowserSchedulerBenchmarkSuite();
await writeJson(`${RUNS_DIR}/latest-browser.json`, result);

console.log(`Browser scheduler benchmark complete: ${result.totals.scenarioCount} scenarios`);
console.log(`Mean live time-to-current: ${result.totals.liveTimeToCurrentMs.mean} ms, p95: ${result.totals.liveTimeToCurrentMs.p95} ms`);
