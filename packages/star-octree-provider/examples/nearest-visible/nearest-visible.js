import {
  OCTREE_DEFAULT,
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '../../src/index.js';
import {
  apparentMagnitude as computeApparentMagnitude,
  decodeTemperatureK,
} from '@found-in-space/star-products';

const RESULT_LIMIT = 100;

const elements = {
  form: document.querySelector('[data-query-form]'),
  url: document.querySelector('[data-url]'),
  x: document.querySelector('[data-x]'),
  y: document.querySelector('[data-y]'),
  z: document.querySelector('[data-z]'),
  magnitude: document.querySelector('[data-magnitude]'),
  reset: document.querySelector('[data-reset]'),
  status: document.querySelector('[data-status]'),
  metrics: document.querySelector('[data-metrics]'),
  streamStats: document.querySelector('[data-stream-stats]'),
  workItems: document.querySelector('[data-work-items]'),
  currentState: document.querySelector('[data-current-state]'),
  resultCount: document.querySelector('[data-result-count]'),
  results: document.querySelector('[data-results]'),
};

/** @type {{
 *   provider: ReturnType<typeof createStarOctreeProviderService> | null;
 *   session: import('../../src/index.d.ts').StarOctreeProviderSession | null;
 *   url: string;
 *   token: number;
 *   query: { observerPc: { x: number; y: number; z: number }; limitingMagnitude: number };
 *   products: Map<string, import('@found-in-space/star-products').StarObjectBatchProduct>;
 *   rowsByProductId: Map<string, Array<NearestStarRow>>;
 *   nearest: Array<NearestStarRow>;
 *   deltas: { upsert: number; stale: number; remove: number; current: number; error: number };
 *   lastCurrent: import('../../src/index.d.ts').StarOctreeProductDelta | null;
 *   lastError: string | null;
 *   startedAtMs: number;
 * }} */
const state = {
  provider: null,
  session: null,
  url: '',
  token: 0,
  query: {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  },
  products: new Map(),
  rowsByProductId: new Map(),
  nearest: [],
  deltas: { upsert: 0, stale: 0, remove: 0, current: 0, error: 0 },
  lastCurrent: null,
  lastError: null,
  startedAtMs: 0,
};

/**
 * @typedef {{
 *   id: string;
 *   productId: string;
 *   nodeKey: string;
 *   ordinal: number;
 *   positionPc: { x: number; y: number; z: number };
 *   distancePc: number;
 *   absoluteMagnitude: number;
 *   apparentMagnitude: number;
 *   temperatureK: number | null;
 * }} NearestStarRow
 */

elements.url.value = OCTREE_DEFAULT;
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  applyQuery();
});
elements.reset.addEventListener('click', () => {
  elements.x.value = '0';
  elements.y.value = '0';
  elements.z.value = '0';
  elements.magnitude.value = '6.5';
  applyQuery();
});

render();
applyQuery();
setInterval(render, 250);

function applyQuery() {
  const url = elements.url.value.trim() || OCTREE_DEFAULT;
  const observerPc = {
    x: parseFiniteNumber(elements.x.value, 0),
    y: parseFiniteNumber(elements.y.value, 0),
    z: parseFiniteNumber(elements.z.value, 0),
  };
  const limitingMagnitude = parseFiniteNumber(elements.magnitude.value, 6.5);

  state.query = { observerPc, limitingMagnitude };
  if (!state.provider || state.url !== url) {
    resetProvider(url);
  }

  if (!state.session) {
    return;
  }

  state.lastError = null;
  state.startedAtMs = performance.now();
  recomputeRowsForCurrentQuery();
  state.session.updateView({
    observerPc,
    limitingMagnitude,
  });
  setStatus('streaming');
  render();
}

function resetProvider(url) {
  state.token += 1;
  state.session?.dispose();
  state.provider?.dispose();

  state.url = url;
  state.provider = createStarOctreeProviderService({
    id: 'nearest-visible-example',
    url,
  });
  state.session = state.provider.createSession({
    id: 'nearest-visible-session',
    strategy: createObserverShellStrategy(),
    attributes: ['position', 'magAbs', 'teffLog8', 'objectRef'],
    streaming: {
      emitCachedFirst: true,
      coarseFirst: true,
    },
  });
  state.products.clear();
  state.rowsByProductId.clear();
  state.nearest = [];
  state.deltas = { upsert: 0, stale: 0, remove: 0, current: 0, error: 0 };
  state.lastCurrent = null;
  state.lastError = null;

  const token = state.token;
  void consumeDeltas(state.session, token);
}

/**
 * @param {import('../../src/index.d.ts').StarOctreeProviderSession} session
 * @param {number} token
 */
async function consumeDeltas(session, token) {
  try {
    for await (const delta of session.deltas()) {
      if (token !== state.token) {
        break;
      }
      handleDelta(delta);
      render();
    }
  } catch (error) {
    if (token !== state.token) return;
    state.lastError = error instanceof Error ? error.message : String(error);
    setStatus('failed');
    render();
  }
}

/**
 * @param {import('../../src/index.d.ts').StarOctreeProductDelta} delta
 */
function handleDelta(delta) {
  if (delta.type === 'data/product-upsert') {
    state.deltas.upsert += 1;
    state.products.set(delta.product.id, delta.product);
    state.rowsByProductId.set(
      delta.product.id,
      rowsFromProduct(delta.product, state.query),
    );
    recomputeNearest();
    setStatus('streaming');
    return;
  }

  if (delta.type === 'data/product-stale') {
    state.deltas.stale += 1;
    state.products.delete(delta.productId);
    state.rowsByProductId.delete(delta.productId);
    recomputeNearest();
    return;
  }

  if (delta.type === 'data/product-remove') {
    state.deltas.remove += 1;
    state.products.delete(delta.productId);
    state.rowsByProductId.delete(delta.productId);
    recomputeNearest();
    return;
  }

  if (delta.type === 'data/representation-current') {
    state.deltas.current += 1;
    state.lastCurrent = delta;
    setStatus('current');
    return;
  }

  if (delta.type === 'data/product-error') {
    state.deltas.error += 1;
    state.lastError = delta.error?.message ?? 'Product stream failed.';
    setStatus('failed');
  }
}

function recomputeRowsForCurrentQuery() {
  state.rowsByProductId.clear();
  for (const product of state.products.values()) {
    state.rowsByProductId.set(product.id, rowsFromProduct(product, state.query));
  }
  recomputeNearest();
}

function recomputeNearest() {
  const rows = [];
  for (const productRows of state.rowsByProductId.values()) {
    rows.push(...productRows);
  }
  rows.sort((left, right) =>
    left.distancePc - right.distancePc ||
    left.apparentMagnitude - right.apparentMagnitude ||
    left.id.localeCompare(right.id),
  );
  state.nearest = rows.slice(0, RESULT_LIMIT);
}

/**
 * @param {import('@found-in-space/star-products').StarObjectBatchProduct} product
 * @param {{ observerPc: { x: number; y: number; z: number }; limitingMagnitude: number }} query
 * @returns {Array<NearestStarRow>}
 */
function rowsFromProduct(product, query) {
  const positions = product.coordinates.primary.components;
  const magAbs = product.attributes.magAbs?.values;
  const teffLog8 = product.attributes.teffLog8?.values;
  if (!magAbs) {
    return [];
  }

  /** @type {Array<NearestStarRow>} */
  const rows = [];
  for (let index = 0; index < product.count; index += 1) {
    const positionPc = {
      x: positions[index * 3],
      y: positions[index * 3 + 1],
      z: positions[index * 3 + 2],
    };
    const distancePc = distanceBetween(query.observerPc, positionPc);
    const apparentMagnitude = computeApparentMagnitude({
      magAbs: magAbs[index],
      distancePc,
    });
    if (apparentMagnitude > query.limitingMagnitude) {
      continue;
    }

    const ref = product.refs?.[index];
    const node = ref ? null : nodeForProductIndex(product, index);
    const nodeKey = ref?.nodeKey ?? node?.nodeKey ?? 'unknown';
    const ordinal = ref?.ordinal ?? (node ? index - node.offset : index);

    rows.push({
      id: `${product.id}:${index}`,
      productId: product.id,
      nodeKey,
      ordinal,
      positionPc,
      distancePc,
      absoluteMagnitude: magAbs[index],
      apparentMagnitude,
      temperatureK: teffLog8 ? decodeTemperatureK(teffLog8[index]) : null,
    });
  }

  return rows;
}

/**
 * @param {import('@found-in-space/star-products').StarObjectBatchProduct} product
 * @param {number} index
 */
function nodeForProductIndex(product, index) {
  return product.nodes.find(
    (node) => index >= node.offset && index < node.offset + node.count,
  );
}

function render() {
  const providerSnapshot = state.provider?.getSnapshot();
  const sessionSnapshot = state.session?.getSnapshot();
  const loadedObjects = Array.from(state.products.values()).reduce(
    (sum, product) => sum + product.count,
    0,
  );
  const visibleObjects = Array.from(state.rowsByProductId.values()).reduce(
    (sum, rows) => sum + rows.length,
    0,
  );

  elements.metrics.innerHTML = [
    metric('Nearest', formatInteger(state.nearest.length)),
    metric('Visible', formatInteger(visibleObjects)),
    metric('Objects', formatInteger(loadedObjects)),
    metric('Products', formatInteger(state.products.size)),
  ].join('');

  elements.streamStats.innerHTML = [
    stat('Demand status', sessionSnapshot?.demand.status ?? 'idle'),
    stat('View revision', formatInteger(sessionSnapshot?.view.revision ?? 0)),
    stat('Demand revision', formatInteger(sessionSnapshot?.demand.revision ?? 0)),
    stat('Active work', formatInteger(sessionSnapshot?.demand.activeWorkItemCount ?? 0)),
    stat('Range requests', formatInteger(providerSnapshot?.stats.rangeRequests ?? 0)),
    stat('Bytes requested', formatBytes(providerSnapshot?.stats.bytesRequested ?? 0)),
    stat('Payload batches', formatInteger(providerSnapshot?.stats.payloadBatchRequests ?? 0)),
    stat('Payload nodes', formatInteger(providerSnapshot?.stats.payloadNodesFetched ?? 0)),
    stat('Payload cache hits', formatInteger(providerSnapshot?.stats.payloadCacheHits ?? 0)),
    stat('Decoded cache hits', formatInteger(providerSnapshot?.stats.decodedCacheHits ?? 0)),
    stat('Upserts', formatInteger(state.deltas.upsert)),
    stat('Current events', formatInteger(state.deltas.current)),
  ].join('');

  const activeWork = providerSnapshot?.workItems
    .filter((item) => item.status !== 'finished')
    .slice(-4) ?? [];
  elements.workItems.innerHTML = activeWork.length
    ? activeWork.map(renderWorkItem).join('')
    : '<div class="work-item"><span class="work-meta">No active provider work</span><span class="work-status">idle</span></div>';

  elements.currentState.textContent = state.lastError
    ? state.lastError
    : (state.lastCurrent ? `current rev ${state.lastCurrent.demandRevision}` : 'streaming');
  elements.resultCount.textContent = `${state.nearest.length} stars`;
  elements.results.innerHTML = state.nearest.length
    ? state.nearest.map(renderRow).join('')
    : '<tr><td colspan="8" class="empty-row">Waiting for visible star products.</td></tr>';
}

/**
 * @param {NearestStarRow} row
 * @param {number} index
 */
function renderRow(row, index) {
  return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(row.nodeKey)}</td>
      <td>${row.ordinal}</td>
      <td>${formatVector(row.positionPc)}</td>
      <td>${formatNumber(row.distancePc, 3)}</td>
      <td>${formatNumber(row.absoluteMagnitude, 2)}</td>
      <td>${formatNumber(row.apparentMagnitude, 2)}</td>
      <td>${formatTemperature(row.temperatureK)}</td>
    </tr>
  `;
}

/**
 * @param {import('../../src/index.d.ts').StarOctreeProviderSnapshot['workItems'][number]} item
 */
function renderWorkItem(item) {
  const loaded = item.bytesLoaded ? `, ${formatBytes(item.bytesLoaded)}` : '';
  const nodes = item.nodeCount ? `${formatInteger(item.nodeCount)} nodes` : 'work item';
  return `
    <div class="work-item">
      <span class="work-meta">${escapeHtml(nodes)}${loaded}</span>
      <span class="work-status">${escapeHtml(item.status)}</span>
    </div>
  `;
}

function metric(label, value) {
  return `
    <div class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function stat(label, value) {
  return `
    <div class="stat">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(String(value))}</div>
    </div>
  `;
}

function setStatus(status) {
  elements.status.textContent = status;
}

function parseFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function distanceBetween(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function formatVector(vector) {
  return `${formatNumber(vector.x, 2)}, ${formatNumber(vector.y, 2)}, ${formatNumber(vector.z, 2)}`;
}

function formatNumber(value, fractionDigits) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: Math.min(fractionDigits, 2),
      })
    : '';
}

function formatInteger(value) {
  return Math.round(value).toLocaleString();
}

function formatBytes(value) {
  if (value < 1024) return `${formatInteger(value)} B`;
  if (value < 1024 * 1024) return `${formatNumber(value / 1024, 1)} KiB`;
  return `${formatNumber(value / (1024 * 1024), 1)} MiB`;
}

function formatTemperature(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString()} K` : '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
