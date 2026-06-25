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

  return {
    getSnapshot,
    getViewState,
    getStreams,
    getProducts,
    getActions,
    getSelection,
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
function cloneJsonSafe(value) {
  if (value == null) return null;
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
