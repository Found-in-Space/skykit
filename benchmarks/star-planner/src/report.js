/**
 * @param {any} baseline
 */
export function createMarkdownReport(baseline) {
  const plannerTotals = baseline.planner?.totals ?? {};
  const browserTotals = baseline.browser?.totals ?? {};
  const customStrategy = baseline.planner?.capabilities?.customStrategy;
  const slowestPlanner = [...(baseline.planner?.summaries ?? [])]
    .sort((left, right) => Number(right.planMs?.p95 ?? 0) - Number(left.planMs?.p95 ?? 0))
    .slice(0, 8);
  const churnPlanner = [...(baseline.planner?.summaries ?? [])]
    .sort((left, right) => Number(right.tailChurn?.mean ?? 0) - Number(left.tailChurn?.mean ?? 0))
    .slice(0, 8);
  const browserRows = baseline.browser?.summaries ?? [];

  return `# Star Planner Benchmark Baseline: ${baseline.label}

## Environment

- Package: ${baseline.environment.packageName}@${baseline.environment.packageVersion}
- Git commit: ${baseline.environment.gitCommit ?? 'unknown'}
- Node: ${baseline.environment.nodeVersion}
- Chromium: ${baseline.environment.chromiumVersion ?? 'unknown'}
- Platform: ${baseline.environment.platform}/${baseline.environment.arch}

## Headline Totals

| Area | Scenarios | Key metric |
| --- | ---: | --- |
| Planner | ${plannerTotals.scenarioCount ?? 0} | mean plan ${formatMetric(plannerTotals.planMs?.mean)} ms, p95 ${formatMetric(plannerTotals.planMs?.p95)} ms |
| Browser scheduler | ${browserTotals.scenarioCount ?? 0} | mean live current ${formatMetric(browserTotals.liveTimeToCurrentMs?.mean)} ms, p95 ${formatMetric(browserTotals.liveTimeToCurrentMs?.p95)} ms |

## Slowest Planner Scenarios

| Fixture | Movement | Strategy | p95 plan ms | mean inspected | mean emitted |
| --- | --- | --- | ---: | ---: | ---: |
${slowestPlanner.map((row) => `| ${row.fixture} | ${row.movement} | ${row.strategy} | ${formatMetric(row.planMs?.p95)} | ${formatMetric(row.inspectedCells?.mean)} | ${formatMetric(row.emittedCells?.mean)} |`).join('\n')}

## Highest Tail Churn

| Fixture | Movement | Strategy | mean tail churn | hot-prefix retention |
| --- | --- | --- | ---: | ---: |
${churnPlanner.map((row) => `| ${row.fixture} | ${row.movement} | ${row.strategy} | ${formatMetric(row.tailChurn?.mean)} | ${formatMetric(row.hotPrefixRetention?.mean)} |`).join('\n')}

## Browser Scheduler Profiles

| Profile | Workload | mean live current ms | max queue depth | frame misses | warm promotions | warm reuse |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${browserRows.map((row) => `| ${row.profile} | ${row.workload} | ${formatMetric(row.liveTimeToCurrentMs?.mean)} | ${formatMetric(row.maxQueueDepth?.max)} | ${formatMetric(row.frameBudgetMisses?.mean)} | ${formatMetric(row.warmPromotionRate?.mean)} | ${formatMetric(row.warmReuseRate?.mean)} |`).join('\n')}

## Current Contract Gaps

- Custom strategy supported: ${customStrategy?.supported === true ? 'yes' : 'no'}
- Custom strategy probe failure: ${customStrategy?.failureReason ?? 'none'}
- This baseline intentionally records the current closed-strategy alpha behavior before the Strategy/Planner API is separated.
`;
}

/**
 * @param {unknown} value
 */
function formatMetric(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return value.toFixed(value >= 100 ? 1 : 3).replace(/\.?0+$/, '');
}
