#!/usr/bin/env node
import { runPlannerBenchmarkSuite } from './planner-suite.js';

const result = await runPlannerBenchmarkSuite({
  fixtures: ['sparse'],
  movements: ['stationary'],
  strategies: ['sphere-volume'],
  frameLimit: 2,
});

if (result.records.length === 0) {
  throw new Error('Star planner benchmark smoke run produced no records.');
}

console.log(`Star planner smoke benchmark complete: ${result.records.length} records`);
