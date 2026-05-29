/**
 * @typedef {import('./index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('./index.d.ts').SkykitPluginContext} SkykitPluginContext
 * @typedef {import('./index.d.ts').SkykitProductFilter} SkykitProductFilter
 * @typedef {import('./index.d.ts').SkykitProductKey} SkykitProductKey
 * @typedef {import('./index.d.ts').SkykitProductMetadata} SkykitProductMetadata
 * @typedef {import('./index.d.ts').SkykitProductRecord} SkykitProductRecord
 * @typedef {import('./index.d.ts').SkykitProductRegistry} SkykitProductRegistry
 * @typedef {import('./index.d.ts').SkykitProductRegistryPlugin} SkykitProductRegistryPlugin
 * @typedef {import('./index.d.ts').SkykitProductRegistrySnapshot} SkykitProductRegistrySnapshot
 * @typedef {import('./index.d.ts').SkykitProductValueSummary} SkykitProductValueSummary
 */

const SKYKIT_PRODUCTS_STORE_KEY = Symbol.for('found-in-space.skykit.products');
const SKYKIT_PRODUCT_REF_TYPE = 'skykit:product-ref';

/**
 * @returns {SkykitProductRegistry}
 */
export function createSkykitProductRegistry() {
  /** @type {Map<SkykitProductKey, SkykitProductRecord>} */
  const records = new Map();
  /** @type {Map<SkykitProductKey, Set<(value: unknown, record: SkykitProductRecord | null) => void>>} */
  const subscribers = new Map();

  return {
    provide,
    get,
    subscribe,
    query,
    getSnapshot,
  };

  /**
   * @template T
   * @param {SkykitProductKey} key
   * @param {T} value
   * @param {SkykitProductMetadata} [metadata]
   */
  function provide(key, value, metadata = {}) {
    const productKey = normalizeProductKey(key);
    const record = Object.freeze({
      key: productKey,
      value,
      metadata: Object.freeze({
        ...metadata,
        ...(Array.isArray(metadata.tags) ? { tags: Object.freeze([...metadata.tags]) } : {}),
      }),
    });
    records.set(productKey, record);
    notify(productKey, record);
    return () => {
      if (records.get(productKey) !== record) return;
      records.delete(productKey);
      notify(productKey, null);
    };
  }

  /**
   * @template T
   * @param {SkykitProductKey} key
   * @returns {T | null}
   */
  function get(key) {
    return /** @type {T | null} */ (records.get(normalizeProductKey(key))?.value ?? null);
  }

  /**
   * @template T
   * @param {SkykitProductKey} key
   * @param {(value: T | null, record: import('./index.d.ts').SkykitProductRecord<T> | null) => void} listener
   * @param {{ replay?: boolean }} [options]
   */
  function subscribe(key, listener, options = {}) {
    const productKey = normalizeProductKey(key);
    let listeners = subscribers.get(productKey);
    if (!listeners) {
      listeners = new Set();
      subscribers.set(productKey, listeners);
    }
    const wrapped = /** @type {(value: unknown, record: SkykitProductRecord | null) => void} */ (listener);
    listeners.add(wrapped);
    if (options.replay === true) {
      const record = records.get(productKey) ?? null;
      listener(
        /** @type {T | null} */ (record?.value ?? null),
        /** @type {import('./index.d.ts').SkykitProductRecord<T> | null} */ (record),
      );
    }
    return () => {
      const current = subscribers.get(productKey);
      if (!current) return;
      current.delete(wrapped);
      if (current.size === 0) subscribers.delete(productKey);
    };
  }

  /** @param {SkykitProductFilter} [filter] */
  function query(filter = {}) {
    return Array.from(records.values()).filter((record) => matchesFilter(record, filter));
  }

  /** @returns {SkykitProductRegistrySnapshot} */
  function getSnapshot() {
    return {
      productCount: records.size,
      products: Array.from(records.values()).map((record) => ({
        key: record.key,
        metadata: cloneMetadata(record.metadata),
        value: summarizeProductValue(record.value),
      })),
    };
  }

  /**
   * @param {SkykitProductKey} key
   * @param {SkykitProductRecord | null} record
   */
  function notify(key, record) {
    const listeners = subscribers.get(key);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
      listener(record?.value ?? null, record);
    }
  }
}

/**
 * @param {SkykitPluginContext} ctx
 * @returns {SkykitProductRegistry}
 */
export function getSkykitProductRegistry(ctx) {
  return ctx.useStore(SKYKIT_PRODUCTS_STORE_KEY, createSkykitProductRegistry);
}

/**
 * @param {{ id?: string }} [options]
 * @returns {SkykitProductRegistryPlugin}
 */
export function createSkykitProductRegistryPlugin(options = {}) {
  const id = options.id ?? 'skykit-products';
  /** @type {SkykitProductRegistry | null} */
  let registry = null;
  return {
    id,
    setup(ctx) {
      registry = getSkykitProductRegistry(ctx);
    },
    provide(key, value, metadata) {
      return requireRegistry().provide(key, value, metadata);
    },
    get(key) {
      return requireRegistry().get(key);
    },
    subscribe(key, listener, subscribeOptions) {
      return requireRegistry().subscribe(key, listener, subscribeOptions);
    },
    query(filter) {
      return requireRegistry().query(filter);
    },
    getSnapshot() {
      return requireRegistry().getSnapshot();
    },
  };

  function requireRegistry() {
    if (!registry) {
      throw new Error('SkyKit product registry plugin has not been installed.');
    }
    return registry;
  }
}

/**
 * @template T
 * @param {SkykitProductKey} key
 * @returns {import('./index.d.ts').SkykitProductRef<T>}
 */
export function productRef(key) {
  return Object.freeze({
    type: SKYKIT_PRODUCT_REF_TYPE,
    key: normalizeProductKey(key),
  });
}

/**
 * @param {unknown} value
 * @returns {value is import('./index.d.ts').SkykitProductRef}
 */
export function isSkykitProductRef(value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    /** @type {{ type?: unknown; key?: unknown }} */ (value).type === SKYKIT_PRODUCT_REF_TYPE &&
    typeof /** @type {{ type?: unknown; key?: unknown }} */ (value).key === 'string';
}

/**
 * @template T
 * @param {SkykitProductRegistry} products
 * @param {import('./index.d.ts').SkykitProductRef<T>} ref
 * @returns {T | null}
 */
export function resolveSkykitProductRef(products, ref) {
  return products.get(ref.key);
}

/**
 * @template T
 * @param {SkykitProductRegistry} products
 * @param {T | import('./index.d.ts').SkykitProductRef<T> | null | undefined} valueOrRef
 * @returns {T | null}
 */
export function resolveSkykitProductInput(products, valueOrRef) {
  if (valueOrRef == null) return null;
  if (isSkykitProductRef(valueOrRef)) {
    return resolveSkykitProductRef(products, valueOrRef);
  }
  return /** @type {T} */ (valueOrRef);
}

/**
 * @param {SkykitProductRecord} record
 * @param {SkykitProductFilter} filter
 */
function matchesFilter(record, filter) {
  if (filter.prefix !== undefined && !record.key.startsWith(filter.prefix)) return false;
  if (filter.kind !== undefined && record.metadata.kind !== filter.kind) return false;
  if (filter.ownerId !== undefined && record.metadata.ownerId !== filter.ownerId) return false;
  if (filter.tag !== undefined) {
    const tags = Array.isArray(record.metadata.tags) ? record.metadata.tags : [];
    if (!tags.includes(filter.tag)) return false;
  }
  return true;
}

/** @param {SkykitProductMetadata} metadata */
function cloneMetadata(metadata) {
  return {
    ...metadata,
    ...(Array.isArray(metadata.tags) ? { tags: [...metadata.tags] } : {}),
  };
}

/**
 * @param {unknown} value
 * @returns {SkykitProductValueSummary}
 */
function summarizeProductValue(value) {
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

/** @param {SkykitProductKey} key */
function normalizeProductKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('SkyKit product keys must be non-empty strings.');
  }
  return key;
}
