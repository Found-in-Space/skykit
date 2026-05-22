#!/usr/bin/env node
import { access } from 'node:fs/promises';

import { BASELINE_PATH, LATEST_RUN_PATH, readBenchmarkJson } from './baseline.js';
import { compareBenchmarkSummaries } from './compare.js';

const baselinePath = process.argv[2] ?? BASELINE_PATH;
const candidatePath = process.argv[3] ?? LATEST_RUN_PATH;

try {
  await access(candidatePath);
} catch {
  console.log(`No candidate benchmark found at ${candidatePath}. Run npm run bench:baseline first, or pass a candidate JSON path.`);
  process.exit(0);
}

const baseline = await readBenchmarkJson(baselinePath);
const candidate = await readBenchmarkJson(candidatePath);
const comparison = compareBenchmarkSummaries(baseline, candidate);

console.log(comparison.markdown);
