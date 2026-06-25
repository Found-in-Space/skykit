import { SKYKIT_ACTIONS } from './actions.js';
import { getSkykitProductRegistry } from './products.js';

const DEFAULT_PRIMARY_SELECTION_PRODUCT = 'selection:primary';
const DEFAULT_HOVERED_SELECTION_PRODUCT = 'selection:hovered';
const STAR_IDENTITY_UNAVAILABLE_LABEL = 'Star identity unavailable';

/**
 * @template T
 * @param {T | null} [initial]
 * @returns {import('./index.d.ts').SkykitSelectionStore<T>}
 */
export function createSkykitSelectionStore(initial = null) {
  /** @type {T | null} */
  let primary = initial ?? null;
  /** @type {Record<string, unknown>} */
  let metadata = {};
  /** @type {Set<(selection: T | null) => void>} */
  const listeners = new Set();

  return {
    getPrimary() {
      return primary;
    },
    setPrimary(value, nextMetadata = {}) {
      primary = value ?? null;
      metadata = { ...(nextMetadata ?? {}) };
      for (const listener of [...listeners]) listener(primary);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return {
        primary,
        metadata: { ...metadata },
        subscriberCount: listeners.size,
      };
    },
  };
}

/**
 * @param {{
 *   store?: import('./index.d.ts').SkykitSelectionStore | null;
 *   products?: import('./index.d.ts').SkykitProductRegistry | null;
 *   key?: import('./index.d.ts').SkykitProductKey;
 * }} [options]
 * @returns {import('./index.d.ts').SkykitSelectionFacade}
 */
export function createSkykitSelectionFacade(options = {}) {
  const key = options.key ?? DEFAULT_PRIMARY_SELECTION_PRODUCT;
  const explicitStore = options.store ?? null;
  const products = options.products ?? null;

  return {
    get,
    set,
    clear,
    subscribe,
    getSnapshot,
  };

  function get() {
    return resolveStore()?.getPrimary?.() ?? null;
  }

  /**
   * @param {unknown} value
   * @param {Record<string, unknown>} [metadata]
   */
  function set(value, metadata = {}) {
    const store = resolveStore();
    if (!store) return false;
    store.setPrimary(value ?? null, metadata);
    return true;
  }

  /** @param {Record<string, unknown>} [metadata] */
  function clear(metadata = {}) {
    return set(null, metadata);
  }

  /**
   * @param {(selection: import('./index.d.ts').SkykitSelectionValue | null) => void} listener
   * @param {{ replay?: boolean }} [subscribeOptions]
   */
  function subscribe(listener, subscribeOptions = {}) {
    if (typeof listener !== 'function') return () => {};
    if (explicitStore) {
      const unsubscribe = explicitStore.subscribe(listener);
      if (subscribeOptions.replay === true) listener(explicitStore.getPrimary());
      return unsubscribe;
    }
    if (!products) {
      if (subscribeOptions.replay === true) listener(null);
      return () => {};
    }

    /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
    let unsubscribeStore = null;
    const unsubscribeProduct = products.subscribe(key, (store) => {
      unsubscribeStore?.();
      unsubscribeStore = null;
      const selectionStore = isSelectionStore(store)
        ? /** @type {import('./index.d.ts').SkykitSelectionStore<import('./index.d.ts').SkykitSelectionValue>} */ (store)
        : null;
      if (selectionStore) {
        unsubscribeStore = selectionStore.subscribe(listener);
        if (subscribeOptions.replay === true) listener(selectionStore.getPrimary());
      } else if (subscribeOptions.replay === true) {
        listener(null);
      }
    }, { replay: true });
    return () => {
      unsubscribeStore?.();
      unsubscribeStore = null;
      unsubscribeProduct();
    };
  }

  function getSnapshot() {
    const store = resolveStore();
    return {
      key,
      available: Boolean(store),
      current: store?.getPrimary?.() ?? null,
      store: store?.getSnapshot?.() ?? null,
    };
  }

  function resolveStore() {
    return explicitStore ?? /** @type {import('./index.d.ts').SkykitSelectionStore | null} */ (products?.get?.(key) ?? null);
  }
}

/**
 * @param {import('./index.d.ts').SkykitSelectionProductsPluginOptions} [options]
 * @returns {import('./index.d.ts').SkykitPlugin & { readonly primary: import('./index.d.ts').SkykitSelectionStore; readonly hovered: import('./index.d.ts').SkykitSelectionStore | null; getSnapshot(): unknown }}
 */
export function createSkykitSelectionProductsPlugin(options = {}) {
  const id = options.id ?? 'skykit-selection-products';
  const primary = options.primary ?? createSkykitSelectionStore(options.initialPrimary ?? null);
  const hovered = options.hovered === false
    ? null
    : options.hovered ?? createSkykitSelectionStore(options.initialHovered ?? null);
  /** @type {Array<() => void>} */
  const teardowns = [];
  let disposed = false;

  return {
    id,
    primary,
    hovered,
    setup(context) {
      const products = getSkykitProductRegistry(context);
      const primaryKey = options.primaryKey ?? DEFAULT_PRIMARY_SELECTION_PRODUCT;
      if (primaryKey !== false) {
        teardowns.push(products.provide(primaryKey, primary, {
          kind: 'selection',
          ownerId: id,
          role: 'primary',
          ...(options.metadata ?? {}),
        }));
      }
      const hoveredKey = options.hoveredKey ?? DEFAULT_HOVERED_SELECTION_PRODUCT;
      if (hovered && hoveredKey !== false) {
        teardowns.push(products.provide(hoveredKey, hovered, {
          kind: 'selection',
          ownerId: id,
          role: 'hovered',
          ...(options.metadata ?? {}),
        }));
      }
      teardowns.push(context.actions.registerAction(SKYKIT_ACTIONS.selection.clear, () => {
        primary.setPrimary(null, { source: id });
        hovered?.setPrimary(null, { source: id });
      }, { label: 'Clear selection' }));
      return () => {
        disposed = true;
        for (const teardown of teardowns.splice(0).reverse()) teardown();
      };
    },
    getSnapshot() {
      return {
        id,
        disposed,
        primary: primary.getSnapshot(),
        hovered: hovered?.getSnapshot() ?? null,
      };
    },
  };
}

/**
 * @param {unknown} value
 * @returns {value is import('./index.d.ts').SkykitSelectionStore}
 */
export function isSkykitSelectionStore(value) {
  return isSelectionStore(value);
}

/**
 * @param {unknown} value
 * @returns {value is import('./index.d.ts').SkykitSelectionFacade}
 */
export function isSkykitSelectionFacade(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof /** @type {{ get?: unknown }} */ (value).get === 'function' &&
      typeof /** @type {{ set?: unknown }} */ (value).set === 'function' &&
      typeof /** @type {{ clear?: unknown }} */ (value).clear === 'function',
  );
}

/**
 * @param {unknown} pick
 * @param {{
 *   label?: string | null;
 *   metadata?: import('./index.d.ts').SkykitStarPickMetadata;
 *   source?: string;
 *   eventType?: string;
 * }} [options]
 * @returns {import('./index.d.ts').SkykitSelectionValue}
 */
export function createSkykitStarSelectionFromPick(pick, options = {}) {
  const metadata = options.metadata;
  const metadataObject = metadata && typeof metadata === 'object'
    ? /** @type {{ ref?: unknown; facts?: unknown; label?: unknown; primaryLabel?: unknown }} */ (metadata)
    : null;
  const ref = resolvePublicStarRef(
    /** @type {{ objectRef?: unknown }} */ (pick ?? {}).objectRef ??
      metadataObject?.ref,
  );
  const label = cleanLabel(options.label)
    ?? cleanLabel(metadataObject?.label)
    ?? cleanLabel(metadataObject?.primaryLabel)
    ?? cleanLabel(metadataObject?.facts && typeof metadataObject.facts === 'object'
      ? /** @type {{ primaryLabel?: unknown }} */ (metadataObject.facts).primaryLabel
      : null);

  if (ref) {
    return {
      kind: 'star',
      identityAvailable: true,
      ref,
      label,
      facts: metadataObject?.facts ?? null,
      pick: summarizePick(pick),
      source: options.source ?? options.eventType ?? 'star-pick',
    };
  }

  return {
    kind: 'star-pick-unavailable',
    identityAvailable: false,
    reason: 'objectRef-unavailable',
    label: label ?? STAR_IDENTITY_UNAVAILABLE_LABEL,
    diagnostic: summarizePickDiagnostic(pick),
    source: options.source ?? options.eventType ?? 'star-pick',
  };
}

/**
 * @param {unknown} metadata
 * @param {unknown} pick
 */
export function resolveSkykitStarSelectionLabel(metadata, pick) {
  const metadataObject = metadata && typeof metadata === 'object'
    ? /** @type {{ label?: unknown; primaryLabel?: unknown; facts?: { primaryLabel?: unknown } }} */ (metadata)
    : null;
  return cleanLabel(typeof metadata === 'string' ? metadata : null)
    ?? cleanLabel(metadataObject?.label)
    ?? cleanLabel(metadataObject?.primaryLabel)
    ?? cleanLabel(metadataObject?.facts?.primaryLabel)
    ?? (resolvePublicStarRef(/** @type {{ objectRef?: unknown }} */ (pick ?? {}).objectRef)
      ? 'Selected star'
      : STAR_IDENTITY_UNAVAILABLE_LABEL);
}

/** @param {unknown} value */
function isSelectionStore(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof /** @type {{ getPrimary?: unknown }} */ (value).getPrimary === 'function' &&
      typeof /** @type {{ setPrimary?: unknown }} */ (value).setPrimary === 'function' &&
      typeof /** @type {{ subscribe?: unknown }} */ (value).subscribe === 'function',
  );
}

/** @param {unknown} value */
function resolvePublicStarRef(value) {
  if (!value || typeof value !== 'object') return null;
  const candidate = /** @type {{ datasetId?: unknown; level?: unknown; mortonCode?: unknown; ordinal?: unknown; cellKey?: unknown }} */ (value);
  if (
    Number.isInteger(candidate.level) &&
    typeof candidate.mortonCode === 'string' &&
    Number.isInteger(candidate.ordinal) &&
    candidate.cellKey === undefined
  ) {
    return {
      ...(typeof candidate.datasetId === 'string' || candidate.datasetId === null
        ? { datasetId: candidate.datasetId }
        : {}),
      level: candidate.level,
      mortonCode: candidate.mortonCode,
      ordinal: candidate.ordinal,
    };
  }
  return null;
}

/** @param {unknown} value */
function cleanLabel(value) {
  const label = typeof value === 'string' ? value.trim() : '';
  return label || null;
}

/** @param {unknown} pick */
function summarizePick(pick) {
  if (!pick || typeof pick !== 'object') return null;
  const candidate = /** @type {{ position?: unknown; distancePc?: unknown; apparentMagnitude?: unknown; visualRadiusPx?: unknown; teffLog8?: unknown; magAbs?: unknown; score?: unknown; angularDistanceDeg?: unknown }} */ (pick);
  return {
    position: clonePlainObject(candidate.position),
    distancePc: finiteOrNull(candidate.distancePc),
    apparentMagnitude: finiteOrNull(candidate.apparentMagnitude),
    visualRadiusPx: finiteOrNull(candidate.visualRadiusPx),
    teffLog8: finiteOrNull(candidate.teffLog8),
    magAbs: finiteOrNull(candidate.magAbs),
    score: finiteOrNull(candidate.score),
    angularDistanceDeg: finiteOrNull(candidate.angularDistanceDeg),
  };
}

/** @param {unknown} pick */
function summarizePickDiagnostic(pick) {
  if (!pick || typeof pick !== 'object') return null;
  const candidate = /** @type {{ cellKey?: unknown; objectIndex?: unknown; pickMeta?: unknown }} */ (pick);
  return {
    cellKey: typeof candidate.cellKey === 'string' ? candidate.cellKey : null,
    objectIndex: Number.isInteger(candidate.objectIndex) ? candidate.objectIndex : null,
    pickMeta: clonePlainObject(candidate.pickMeta),
  };
}

/** @param {unknown} value */
function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function clonePlainObject(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.map(clonePlainObject);
  const output = /** @type {Record<string, unknown>} */ ({});
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      output[key] = entry;
    }
  }
  return output;
}
