/**
 * @param {any} baseline
 * @param {any} candidate
 */
export function compareBenchmarkSummaries(baseline, candidate) {
  const rows = [
    compareMetric('planner mean plan ms', baseline.planner?.totals?.planMs?.mean, candidate.planner?.totals?.planMs?.mean),
    compareMetric('planner p95 plan ms', baseline.planner?.totals?.planMs?.p95, candidate.planner?.totals?.planMs?.p95),
    compareMetric('planner mean tail churn', baseline.planner?.totals?.tailChurn?.mean, candidate.planner?.totals?.tailChurn?.mean),
    compareMetric('browser mean live current ms', baseline.browser?.totals?.liveTimeToCurrentMs?.mean, candidate.browser?.totals?.liveTimeToCurrentMs?.mean),
    compareMetric('browser p95 live current ms', baseline.browser?.totals?.liveTimeToCurrentMs?.p95, candidate.browser?.totals?.liveTimeToCurrentMs?.p95),
    compareMetric('browser warm promotion rate', baseline.browser?.totals?.warmPromotionRate?.mean, candidate.browser?.totals?.warmPromotionRate?.mean),
  ];

  return {
    ok: true,
    rows,
    markdown: [
      '# Star Planner Benchmark Comparison',
      '',
      '| Metric | Baseline | Candidate | Delta | Delta % |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...rows.map((row) =>
        `| ${row.metric} | ${format(row.baseline)} | ${format(row.candidate)} | ${format(row.delta)} | ${format(row.deltaPercent)}% |`,
      ),
      '',
      'No thresholds are enforced by this comparison command.',
    ].join('\n'),
  };
}

/**
 * @param {string} metric
 * @param {unknown} baseline
 * @param {unknown} candidate
 */
function compareMetric(metric, baseline, candidate) {
  const baselineNumber = Number(baseline ?? 0);
  const candidateNumber = Number(candidate ?? 0);
  const delta = candidateNumber - baselineNumber;
  const deltaPercent = baselineNumber === 0 ? 0 : (delta / baselineNumber) * 100;
  return {
    metric,
    baseline: round(baselineNumber),
    candidate: round(candidateNumber),
    delta: round(delta),
    deltaPercent: round(deltaPercent),
  };
}

/**
 * @param {number} value
 */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {number} value
 */
function format(value) {
  return Number.isFinite(value) ? String(value) : '0';
}
