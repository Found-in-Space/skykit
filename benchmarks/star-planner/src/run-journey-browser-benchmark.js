#!/usr/bin/env node
import { writeJson, RUNS_DIR } from './baseline.js';
import {
  parseJourneyBenchmarkTargets,
  runWebsiteJourneyBenchmarkSuite,
} from './journey-browser-suite.js';

const options = parseArgs(process.argv.slice(2));
const result = await runWebsiteJourneyBenchmarkSuite(options);
await writeJson(`${RUNS_DIR}/latest-journey-browser.json`, result);

console.log(`Website journey benchmark complete: ${result.records.length} runs`);
for (const row of result.summaries) {
  console.log([
    `${row.target}/${row.scenario}`,
    `blank travel mean=${row.blankTravelRatio.mean}`,
    `first visible p50=${row.timeToFirstVisibleMs.p50} ms`,
    `arrival visible=${row.arrivalVisible.mean}`,
  ].join(' | '));
}

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  const targets = [];
  let runs = 1;
  let headless = true;
  let timeoutMs = undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--target') {
      targets.push(...parseJourneyBenchmarkTargets(args[++index]));
      continue;
    }
    if (arg.startsWith('--target=')) {
      targets.push(...parseJourneyBenchmarkTargets(arg.slice('--target='.length)));
      continue;
    }
    if (arg === '--runs') {
      runs = Number(args[++index]);
      continue;
    }
    if (arg.startsWith('--runs=')) {
      runs = Number(arg.slice('--runs='.length));
      continue;
    }
    if (arg === '--headed') {
      headless = false;
      continue;
    }
    if (arg === '--timeout-ms') {
      timeoutMs = Number(args[++index]);
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      timeoutMs = Number(arg.slice('--timeout-ms='.length));
    }
  }

  if (targets.length === 0) {
    targets.push(...parseJourneyBenchmarkTargets(process.env.SKYKIT_JOURNEY_BENCH_TARGETS));
  }

  return {
    ...(targets.length > 0 ? { targets } : {}),
    runs,
    headless,
    ...(Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  };
}
