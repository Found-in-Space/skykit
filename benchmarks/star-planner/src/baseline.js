import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeForBaseline } from './metrics.js';
import { createMarkdownReport } from './report.js';

export const BENCHMARK_ROOT = 'benchmarks/star-planner';
export const RUNS_DIR = `${BENCHMARK_ROOT}/.runs`;
export const BASELINE_PATH = `${BENCHMARK_ROOT}/baselines/current-alpha.json`;
export const REPORT_PATH = `${BENCHMARK_ROOT}/reports/current-alpha.md`;
export const LATEST_RUN_PATH = `${RUNS_DIR}/latest-baseline.json`;

/**
 * @param {{
 *   label?: string;
 *   planner: unknown;
 *   browser: Record<string, unknown>;
 }} options
 */
export async function createAndWriteBaseline(options) {
  const baseline = normalizeForBaseline({
    schemaVersion: 1,
    label: options.label ?? 'current-alpha',
    environment: await createEnvironmentSummary(options.browser),
    planner: compactSuite(options.planner),
    browser: compactSuite(options.browser),
  });

  await mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await mkdir(RUNS_DIR, { recursive: true });
  await writeJson(BASELINE_PATH, baseline);
  await writeJson(LATEST_RUN_PATH, baseline);
  await writeFile(REPORT_PATH, createMarkdownReport(baseline), 'utf8');
  return baseline;
}

/**
 * @param {any} suite
 */
function compactSuite(suite) {
  const { records, ...compact } = suite;
  return compact;
}

/**
 * @param {string} filePath
 */
export async function readBenchmarkJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * @param {Record<string, unknown>} browser
 */
async function createEnvironmentSummary(browser) {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  return {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    gitCommit: getGitCommit(),
    chromiumVersion: browser.chromiumVersion ?? null,
  };
}

function getGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
