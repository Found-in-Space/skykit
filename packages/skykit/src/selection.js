import { SKYKIT_ACTIONS } from './actions.js';
import { getSkykitProductRegistry } from './products.js';

const DEFAULT_PRIMARY_SELECTION_PRODUCT = 'selection:primary';
const DEFAULT_HOVERED_SELECTION_PRODUCT = 'selection:hovered';
const STAR_IDENTITY_UNAVAILABLE_LABEL = 'Star identity unavailable';
const DEFAULT_LAYER_SELECTION_SOURCE = 'layer-pick';
const OMIT_COMPACT_SELECTION_KEYS = new Set([
  'route',
  'ray',
  'blocker',
  'object',
  'object3d',
  'threeObject',
  'targetObject',
  'event',
  'nativeEvent',
]);

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
 * @param {unknown} hitOrRoute
 * @param {import('./index.d.ts').SkykitLayerSelectionOptions} [options]
 * @returns {import('./index.d.ts').SkykitSelectionValue | null}
 */
export function createSkykitLayerSelectionFromPick(hitOrRoute, options = {}) {
  const hit = resolveLayerPickHit(hitOrRoute);
  if (!hit) return null;

  const hitRecord = /** @type {Record<string, unknown>} */ (hit);
  const defaults = createLayerSelectionDefaults(hitRecord, options);

  if (hitRecord.selection != null) {
    const explicit = compactSelectionValue(hitRecord.selection);
    return explicit ? applyLayerSelectionDefaults(explicit, defaults, hitRecord) : null;
  }

  const waypoint = objectRecord(hitRecord.waypoint);
  if (waypoint) {
    return createLayerSelectionFromIdentity(waypoint, hitRecord, defaults, {
      kind: 'waypoint',
      useObjectKind: false,
    });
  }

  const feature = objectRecord(hitRecord.feature);
  if (feature) {
    return createLayerSelectionFromIdentity(feature, hitRecord, defaults, {
      kind: 'layer',
      useObjectKind: true,
    });
  }

  const kind = cleanLabel(hitRecord.kind);
  const id = cleanIdentifier(hitRecord.id);
  if (!kind || !id) return null;

  return applyLayerSelectionDefaults({
    kind,
    id,
    ...(cleanLabel(hitRecord.label) ? { label: cleanLabel(hitRecord.label) } : {}),
    ...(cloneCompactValue(hitRecord.target) !== undefined ? { target: cloneCompactValue(hitRecord.target) } : {}),
  }, defaults, hitRecord);
}

/**
 * @param {import('./index.d.ts').SkykitLayerSelectionPluginOptions} [options]
 * @returns {import('./index.d.ts').SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitLayerSelectionPlugin(options = {}) {
  const id = options.id ?? 'skykit-layer-selection';
  const actionId = options.actionId ?? SKYKIT_ACTIONS.selection.select;
  const pointerActionId = options.pointerActionId === false
    ? null
    : options.pointerActionId ?? SKYKIT_ACTIONS.xr.pointerSelect;
  /** @type {Array<() => void>} */
  const teardowns = [];
  let disposed = false;
  let conversionCount = 0;
  let writeCount = 0;
  let ignoredCount = 0;
  /** @type {import('./index.d.ts').SkykitSelectionValue | null} */
  let lastSelection = null;

  return {
    id,
    setup(context) {
      /** @param {import('./index.d.ts').SkykitActionHandlerContext} event */
      const handler = (event) => {
        const source = actionMetadataSource(event.metadata) ?? options.source ?? id;
        const value = createSkykitLayerSelectionFromPick(event.payload, {
          source,
          productKey: options.productKey,
          layerId: options.layerId,
        });
        if (!value) {
          ignoredCount += 1;
          return null;
        }
        conversionCount += 1;
        lastSelection = value;
        if (writeLayerSelection(options.selection, context, value, {
          source,
          eventType: event.id === pointerActionId ? 'xr/pointer-select' : 'selection/select',
          actionId: event.id,
        })) {
          writeCount += 1;
        }
        return value;
      };
      teardowns.push(context.actions.registerAction(actionId, handler, { label: 'Select layer target' }));
      if (pointerActionId && pointerActionId !== actionId) {
        teardowns.push(context.actions.registerAction(pointerActionId, handler, { label: 'Select XR pointer target' }));
      }
      return () => {
        disposed = true;
        for (const teardown of teardowns.splice(0).reverse()) teardown();
      };
    },
    getSnapshot() {
      return {
        id,
        disposed,
        actionId,
        pointerActionId,
        conversionCount,
        writeCount,
        ignoredCount,
        lastSelection,
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

/**
 * @param {unknown} hitOrRoute
 * @returns {Record<string, unknown> | null}
 */
function resolveLayerPickHit(hitOrRoute) {
  const record = objectRecord(hitOrRoute);
  if (!record) return null;
  const routeType = cleanLabel(record.type);
  if (routeType === 'hit' || routeType === 'miss' || routeType === 'blocked') {
    if (routeType !== 'hit') return null;
    return objectRecord(record.hit);
  }
  return record;
}

/**
 * @param {Record<string, unknown>} hit
 * @param {import('./index.d.ts').SkykitLayerSelectionOptions} options
 */
function createLayerSelectionDefaults(hit, options) {
  return {
    source: cleanLabel(hit.source) ?? cleanLabel(options.source) ?? DEFAULT_LAYER_SELECTION_SOURCE,
    productKey: cleanLabel(hit.productKey) ?? cleanLabel(options.productKey),
    layerId: cleanLabel(hit.layerId) ?? cleanLabel(options.layerId),
  };
}

/**
 * @param {Record<string, unknown>} object
 * @param {Record<string, unknown>} hit
 * @param {{ source: string; productKey: string | null; layerId: string | null }} defaults
 * @param {{ kind: string; useObjectKind: boolean }} options
 * @returns {import('./index.d.ts').SkykitLayerSelectionValue | null}
 */
function createLayerSelectionFromIdentity(object, hit, defaults, options) {
  const properties = objectRecord(object.properties);
  const id = cleanIdentifier(object.id) ?? cleanIdentifier(properties?.id);
  if (!id) return null;
  const kind = options.useObjectKind
    ? cleanLabel(object.kind) ?? cleanLabel(properties?.kind) ?? options.kind
    : options.kind;
  const label = cleanLabel(object.label) ?? cleanLabel(properties?.label) ?? cleanLabel(hit.label);
  const target = firstCompactValue(object.target, properties?.target, hit.target);
  const value = /** @type {import('./index.d.ts').SkykitLayerSelectionValue} */ ({
    kind,
    id,
    ...(label ? { label } : {}),
    ...(target !== undefined ? { target } : {}),
  });
  const layerId = cleanLabel(object.layerId) ?? cleanLabel(properties?.layerId);
  const productKey = cleanLabel(object.productKey) ?? cleanLabel(properties?.productKey);
  const source = cleanLabel(object.source) ?? cleanLabel(properties?.source);
  return /** @type {import('./index.d.ts').SkykitLayerSelectionValue} */ (applyLayerSelectionDefaults(value, {
    source: source ?? defaults.source,
    productKey: productKey ?? defaults.productKey,
    layerId: layerId ?? defaults.layerId,
  }, hit));
}

/**
 * @param {import('./index.d.ts').SkykitSelectionValue} value
 * @param {{ source: string; productKey: string | null; layerId: string | null }} defaults
 * @param {Record<string, unknown>} hit
 * @returns {import('./index.d.ts').SkykitSelectionValue}
 */
function applyLayerSelectionDefaults(value, defaults, hit) {
  const output = /** @type {Record<string, unknown> & import('./index.d.ts').SkykitSelectionValue} */ ({ ...value });
  if (!cleanLabel(output.source)) output.source = defaults.source;
  if (!cleanLabel(output.productKey) && defaults.productKey) output.productKey = defaults.productKey;
  if (!cleanLabel(output.layerId) && defaults.layerId) output.layerId = defaults.layerId;
  if (output.pick === undefined) {
    const pick = summarizeLayerPick(hit);
    if (pick) output.pick = pick;
  }
  return output;
}

/**
 * @param {unknown} value
 * @returns {import('./index.d.ts').SkykitSelectionValue | null}
 */
function compactSelectionValue(value) {
  const record = objectRecord(value);
  if (!record) return null;
  /** @type {Record<string, unknown>} */
  const output = {};
  for (const [key, entry] of Object.entries(record)) {
    if (OMIT_COMPACT_SELECTION_KEYS.has(key)) continue;
    const compact = cloneCompactValue(entry);
    if (compact !== undefined) output[key] = compact;
  }
  return Object.keys(output).length > 0
    ? /** @type {import('./index.d.ts').SkykitSelectionValue} */ (output)
    : null;
}

/** @param {Record<string, unknown>} hit */
function summarizeLayerPick(hit) {
  const explicitPick = cloneCompactValue(hit.pick);
  if (explicitPick !== undefined) return explicitPick;
  /** @type {Record<string, unknown>} */
  const pick = {};
  for (const key of ['position', 'point', 'worldPosition', 'localPosition']) {
    const value = cloneCompactValue(hit[key]);
    if (value !== undefined) pick[key] = value;
  }
  for (const key of ['distance', 'distancePc', 't', 'score']) {
    const value = finiteOrNull(hit[key]);
    if (value !== null) pick[key] = value;
  }
  return Object.keys(pick).length > 0 ? pick : null;
}

/**
 * @param {import('./index.d.ts').SkykitLayerSelectionPluginOptions['selection']} selectionInput
 * @param {import('./index.d.ts').SkykitPluginContext} context
 * @param {import('./index.d.ts').SkykitSelectionValue} value
 * @param {Record<string, unknown>} metadata
 */
function writeLayerSelection(selectionInput, context, value, metadata) {
  if (selectionInput === false) return false;
  const selection = resolveLayerSelectionTarget(selectionInput, context);
  if (!selection) return false;
  if (isSkykitSelectionFacade(selection)) {
    return selection.set(value, metadata);
  }
  selection.setPrimary(value, metadata);
  return true;
}

/**
 * @param {import('./index.d.ts').SkykitLayerSelectionPluginOptions['selection']} selectionInput
 * @param {import('./index.d.ts').SkykitPluginContext} context
 */
function resolveLayerSelectionTarget(selectionInput, context) {
  if (isSkykitSelectionFacade(selectionInput) || isSkykitSelectionStore(selectionInput)) {
    return selectionInput;
  }
  const key = typeof selectionInput === 'string' && selectionInput
    ? selectionInput
    : DEFAULT_PRIMARY_SELECTION_PRODUCT;
  const product = getSkykitProductRegistry(context).get(key);
  return isSkykitSelectionFacade(product) || isSkykitSelectionStore(product)
    ? product
    : null;
}

/** @param {unknown} value */
function objectRecord(value) {
  return value && typeof value === 'object'
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value */
function cleanIdentifier(value) {
  return cleanLabel(value);
}

/**
 * @param  {...unknown} values
 * @returns {unknown}
 */
function firstCompactValue(...values) {
  for (const value of values) {
    const compact = cloneCompactValue(value);
    if (compact !== undefined) return compact;
  }
  return undefined;
}

/** @param {unknown} value */
function cloneCompactValue(value) {
  return cloneCompactValueWithSeen(value, 0, new WeakSet());
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @param {WeakSet<object>} seen
 * @returns {unknown}
 */
function cloneCompactValueWithSeen(value, depth, seen) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  if (depth >= 6) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => cloneCompactValueWithSeen(entry, depth + 1, seen))
      .filter((entry) => entry !== undefined);
    seen.delete(value);
    return entries;
  }
  /** @type {Record<string, unknown>} */
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (OMIT_COMPACT_SELECTION_KEYS.has(key)) continue;
    const compact = cloneCompactValueWithSeen(entry, depth + 1, seen);
    if (compact !== undefined) output[key] = compact;
  }
  seen.delete(value);
  return Object.keys(output).length > 0 ? output : undefined;
}

/** @param {Record<string, unknown> | undefined} metadata */
function actionMetadataSource(metadata) {
  return cleanLabel(metadata?.source);
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
