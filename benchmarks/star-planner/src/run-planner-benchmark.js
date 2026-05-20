#!/usr/bin/env node
import { writeJson, RUNS_DIR } from './baseline.js';
import { runPlannerBenchmarkSuite } from './planner-suite.js';

const result = await runPlannerBenchmarkSuite();
await writeJson(`${RUNS_DIR}/latest-planner.json`, result);

console.log(`Planner benchmark complete: ${result.totals.scenarioCount} scenarios, ${result.totals.frameCount} frames`);
console.log(`Mean plan time: ${result.totals.planMs.mean} ms, p95: ${result.totals.planMs.p95} ms`);
