/**
 * @typedef {import('./index.d.ts').SkykitInspectFacade} SkykitInspectFacade
 * @typedef {import('./index.d.ts').SkykitProductFilter} SkykitProductFilter
 * @typedef {import('./index.d.ts').SkykitProductRegistry} SkykitProductRegistry
 * @typedef {import('./index.d.ts').SkykitSelectionFacade} SkykitSelectionFacade
 * @typedef {import('./index.d.ts').SkykitViewer} SkykitViewer
 */

/**
 * @param {{
 *   viewer: SkykitViewer;
 *   products?: SkykitProductRegistry | null;
 *   selection?: SkykitSelectionFacade | null;
 *   getXrSnapshot?: (() => unknown) | null;
 *   getRuntimeSnapshot?: (() => unknown) | null;
 *   historyLimit?: number;
 * }} options
 * @returns {SkykitInspectFacade}
 */
export function createSkykitInspectFacade(options) {
  if (!options?.viewer) {
    throw new TypeError('createSkykitInspectFacade() requires a viewer.');
  }
  const viewer = options.viewer;
  const products = options.products ?? null;
  const selection = options.selection ?? null;
  const historyLimit = nonNegativeInteger(options.historyLimit, 50);
  /** @type {import('./index.d.ts').SkykitInspectHistoryEntry[]} */
  const history = [];
  /** @type {Array<() => void>} */
  const teardowns = [];
  let historyOrder = 0;
  let disposed = false;

  if (historyLimit > 0) {
    teardowns.push(viewer.actions.subscribe(recordActionHistory));
    if (selection) {
      teardowns.push(selection.subscribe(recordSelectionHistory));
    }
  }

  return {
    getSnapshot,
    getViewState,
    getStreams,
    getProducts,
    getActions,
    getSelection,
    getHistory,
    dispose,
  };

  function getSnapshot() {
    const viewerSnapshot = viewer.getSnapshot();
    return {
      id: viewer.id,
      view: viewer.getViewState(),
      streams: getStreams(),
      products: products?.getSnapshot?.() ?? null,
      actions: viewer.actions.getSnapshot(),
      selection: selection?.getSnapshot?.() ?? null,
      history: getHistory(),
      xr: options.getXrSnapshot?.() ?? null,
      diagnostics: {
        viewer: viewerSnapshot,
        runtime: options.getRuntimeSnapshot?.() ?? null,
      },
    };
  }

  function getViewState() {
    return viewer.getViewState();
  }

  /** @returns {import('./index.d.ts').SkykitInspectStreamSummary[]} */
  function getStreams() {
    return viewer.getSnapshot().parts
      .map((part) => summarizeStreamPart(part))
      .filter(isInspectStreamSummary);
  }

  /** @param {SkykitProductFilter} [filter] */
  function getProducts(filter) {
    if (!products) return [];
    if (!filter || Object.keys(filter).length === 0) {
      return products.getSnapshot().products;
    }
    return products.query(filter).map((record) => ({
      key: record.key,
      metadata: cloneMetadata(record.metadata),
      value: summarizeValue(record.value),
    }));
  }

  function getActions() {
    return viewer.actions.getSnapshot();
  }

  function getSelection() {
    return selection?.getSnapshot?.() ?? null;
  }

  function getHistory() {
    return history.map((entry) => cloneJsonSafe(entry) ?? entry);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const teardown of teardowns.splice(0).reverse()) teardown();
  }

  /** @param {import('./index.d.ts').SkykitActionEvent} event */
  function recordActionHistory(event) {
    appendHistory({
      type: 'action',
      eventType: event.type,
      actionId: event.id,
      source: actionEventSource(event),
      payload: summarizePayload(/** @type {{ payload?: unknown }} */ (event).payload),
      value: summarizePayload(/** @type {{ value?: unknown }} */ (event).value),
      selection: summarizeSelection(selection?.get?.() ?? null),
    });
  }

  /** @param {import('./index.d.ts').SkykitSelectionValue | null} value */
  function recordSelectionHistory(value) {
    appendHistory({
      type: 'selection',
      eventType: 'selection/change',
      source: selectionSource(value),
      value: summarizeSelection(value),
      selection: summarizeSelection(value),
    });
  }

  /** @param {Omit<import('./index.d.ts').SkykitInspectHistoryEntry, 'order' | 'timeMs'>} entry */
  function appendHistory(entry) {
    history.push({
      order: historyOrder += 1,
      timeMs: nowMs(),
      ...entry,
    });
    while (history.length > historyLimit) history.shift();
  }
}

/**
 * @param {import('./index.d.ts').SkykitViewerSnapshot['parts'][number]} part
 * @returns {import('./index.d.ts').SkykitInspectStreamSummary | null}
 */
function summarizeStreamPart(part) {
  const snapshot = part.snapshot;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (snapshot);
  const source = record.source && typeof record.source === 'object'
    ? /** @type {Record<string, unknown>} */ (record.source)
    : null;
  const renderer = record.renderer && typeof record.renderer === 'object'
    ? /** @type {Record<string, unknown>} */ (record.renderer)
    : null;
  const store = record.store && typeof record.store === 'object'
    ? /** @type {Record<string, unknown>} */ (record.store)
    : source?.store && typeof source.store === 'object'
      ? /** @type {Record<string, unknown>} */ (source.store)
      : null;
  const hasStreamShape = 'status' in record ||
    'sessionId' in record ||
    'demandCount' in record ||
    Boolean(source) ||
    Boolean(renderer?.starCount);
  if (!hasStreamShape) return null;
  const status = typeof record.status === 'string'
    ? record.status
    : typeof source?.status === 'string'
      ? source.status
      : null;
  const sessionId = typeof record.sessionId === 'string'
    ? record.sessionId
    : typeof source?.sessionId === 'string'
      ? source.sessionId
      : null;
  const demands = cloneJsonSafe(record.demands ?? source?.demands);
  return {
    id: part.id,
    status,
    sessionId,
    demandCount: finiteOrNull(record.demandCount ?? source?.demandCount),
    demands: Array.isArray(demands) ? demands : [],
    cellCount: finiteOrNull(renderer?.cellCount ?? store?.cellCount),
    starCount: finiteOrNull(renderer?.starCount ?? store?.starCount),
    deltaCount: finiteOrNull(record.deltaCount ?? source?.deltaCount),
    lastError: typeof record.lastError === 'string'
      ? record.lastError
      : typeof source?.lastError === 'string'
        ? source.lastError
        : null,
    diagnostics: snapshot,
  };
}

/** @param {import('./index.d.ts').SkykitInspectStreamSummary | null} value */
function isInspectStreamSummary(value) {
  return value !== null;
}

/** @param {import('./index.d.ts').SkykitProductMetadata} metadata */
function cloneMetadata(metadata) {
  return {
    ...metadata,
    ...(Array.isArray(metadata.tags) ? { tags: [...metadata.tags] } : {}),
  };
}

/** @param {unknown} value */
function summarizeValue(value) {
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  const valueType = typeof value;
  if (valueType !== 'object' && valueType !== 'function') {
    return { type: valueType, value };
  }
  const objectValue = /** @type {{ constructor?: { name?: string }; id?: unknown }} */ (value);
  return {
    type: valueType,
    className: objectValue.constructor?.name,
    ...(typeof objectValue.id === 'string' ? { id: objectValue.id } : {}),
  };
}

/** @param {unknown} value */
function summarizePayload(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  const cloned = cloneJsonSafe(value);
  if (cloned !== null) return cloned;
  return summarizeValue(value);
}

/** @param {import('./index.d.ts').SkykitSelectionValue | null} value */
function summarizeSelection(value) {
  if (!value || typeof value !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const kind = typeof record.kind === 'string' ? record.kind : null;
  if (kind === 'star') {
    return {
      kind,
      identityAvailable: record.identityAvailable === true,
      ref: cloneJsonSafe(record.ref),
      label: typeof record.label === 'string' ? record.label : null,
      facts: summarizePayload(record.facts),
      pick: cloneJsonSafe(record.pick),
      source: typeof record.source === 'string' ? record.source : null,
    };
  }
  if (kind === 'star-pick-unavailable') {
    return {
      kind,
      identityAvailable: false,
      reason: typeof record.reason === 'string' ? record.reason : null,
      label: typeof record.label === 'string' ? record.label : null,
      diagnostic: cloneJsonSafe(record.diagnostic),
      source: typeof record.source === 'string' ? record.source : null,
    };
  }
  return {
    kind,
    id: typeof record.id === 'string' ? record.id : null,
    label: typeof record.label === 'string' ? record.label : null,
    productKey: typeof record.productKey === 'string' ? record.productKey : null,
    source: typeof record.source === 'string' ? record.source : null,
  };
}

/** @param {import('./index.d.ts').SkykitActionEvent} event */
function actionEventSource(event) {
  const direct = /** @type {{ source?: unknown }} */ (event).source;
  if (typeof direct === 'string' && direct) return direct;
  const metadata = /** @type {{ metadata?: { source?: unknown } }} */ (event).metadata;
  return typeof metadata?.source === 'string' && metadata.source ? metadata.source : null;
}

/** @param {import('./index.d.ts').SkykitSelectionValue | null} value */
function selectionSource(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {{ source?: unknown }} */ (value).source;
  return typeof source === 'string' && source ? source : null;
}

/** @param {unknown} value */
function cloneJsonSafe(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value @param {number} fallback */
function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}
