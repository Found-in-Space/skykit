/**
 * @param {number[]} values
 */
export function summarizeNumbers(values) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) {
    return { min: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  }
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    min: round(finite[0]),
    mean: round(sum / finite.length),
    p50: round(percentile(finite, 0.5)),
    p95: round(percentile(finite, 0.95)),
    max: round(finite[finite.length - 1]),
  };
}

/**
 * @param {Array<Record<string, unknown>>} records
 * @param {string[]} keys
 */
export function groupRecords(records, keys) {
  const groups = new Map();
  for (const record of records) {
    const key = keys.map((name) => String(record[name])).join('|');
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }
  return Array.from(groups.entries()).map(([key, values]) => ({ key, values }));
}

/**
 * @param {string[]} previous
 * @param {string[]} next
 */
export function retainedPrefixRatio(previous, next) {
  if (previous.length === 0 || next.length === 0) return previous.length === next.length ? 1 : 0;
  const previousSet = new Set(previous);
  const retained = next.filter((cellKey) => previousSet.has(cellKey)).length;
  return round(retained / Math.max(previous.length, next.length), 4);
}

/**
 * @param {string[]} previous
 * @param {string[]} next
 */
export function churnRatio(previous, next) {
  if (previous.length === 0 && next.length === 0) return 0;
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  let changed = 0;
  for (const cellKey of previousSet) {
    if (!nextSet.has(cellKey)) changed += 1;
  }
  for (const cellKey of nextSet) {
    if (!previousSet.has(cellKey)) changed += 1;
  }
  return round(changed / Math.max(1, previousSet.size + nextSet.size), 4);
}

/**
 * @param {string[]} previous
 * @param {string[]} next
 */
export function orderStabilityRatio(previous, next) {
  const limit = Math.min(previous.length, next.length);
  if (limit === 0) return previous.length === next.length ? 1 : 0;
  let stable = 0;
  for (let index = 0; index < limit; index += 1) {
    if (previous[index] === next[index]) stable += 1;
  }
  return round(stable / limit, 4);
}

/**
 * @param {unknown} value
 */
export function normalizeForBaseline(value) {
  return sortObjectKeys(stripVolatile(value));
}

/**
 * @param {Array<{ durationMs?: number; inspectedCells?: number; selectedCells?: number; emittedCells?: number; currentCells?: number; warmCells?: number; signatureChurn?: number; hotPrefixRetention?: number; tailChurn?: number; orderStability?: number }>} records
 */
export function summarizePlannerRecords(records) {
  return {
    planMs: summarizeNumbers(records.map((record) => record.durationMs ?? 0)),
    inspectedCells: summarizeNumbers(records.map((record) => record.inspectedCells ?? 0)),
    selectedCells: summarizeNumbers(records.map((record) => record.selectedCells ?? 0)),
    emittedCells: summarizeNumbers(records.map((record) => record.emittedCells ?? 0)),
    currentCells: summarizeNumbers(records.map((record) => record.currentCells ?? 0)),
    warmCells: summarizeNumbers(records.map((record) => record.warmCells ?? 0)),
    signatureChurn: summarizeNumbers(records.map((record) => record.signatureChurn ?? 0)),
    hotPrefixRetention: summarizeNumbers(records.map((record) => record.hotPrefixRetention ?? 0)),
    tailChurn: summarizeNumbers(records.map((record) => record.tailChurn ?? 0)),
    orderStability: summarizeNumbers(records.map((record) => record.orderStability ?? 0)),
  };
}

/**
 * @param {number[]} sorted
 * @param {number} fraction
 */
function percentile(sorted, fraction) {
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * @param {unknown} value
 */
function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, innerValue] of Object.entries(value)) {
    if (
      key === 'generatedAt' ||
      key === 'startedAt' ||
      key === 'finishedAt' ||
      key === 'rawSamples' ||
      key === 'trace'
    ) {
      continue;
    }
    output[key] = stripVolatile(innerValue);
  }
  return output;
}

/**
 * @param {unknown} value
 */
function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, innerValue]) => [key, sortObjectKeys(innerValue)]),
  );
}

/**
 * @param {number} value
 * @param {number} [precision]
 */
export function round(value, precision = 3) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
