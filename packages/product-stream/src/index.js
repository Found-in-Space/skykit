/**
 * @template Product
 * @typedef {import('./index.d.ts').ProductDelta<Product>} ProductDelta
 */

/**
 * @template Product
 * @param {import('./index.d.ts').RepresentationStoreOptions<Product>} options
 * @returns {import('./index.d.ts').RepresentationStore<Product>}
 */
export function createRepresentationStore(options) {
  if (!options || typeof options.getProductId !== 'function') {
    throw new TypeError('createRepresentationStore() requires getProductId.');
  }

  const getProductBytes = options.getProductBytes ?? (() => 0);
  /** @type {Map<string, { product: Product; current: boolean; bytes: number }>} */
  const records = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {import('./index.d.ts').RepresentationStoreSnapshot['status']} */
  let status = 'idle';
  /** @type {string | null} */
  let lastError = null;
  /** @type {import('./index.d.ts').RepresentationStoreSnapshot['lastCurrentRevision']} */
  let lastCurrentRevision = null;

  return {
    apply,
    subscribe,
    getProducts,
    getSnapshot,
    clear,
  };

  /**
   * @param {ProductDelta<Product>} delta
   */
  function apply(delta) {
    if (!delta || typeof delta.type !== 'string') {
      throw new TypeError('RepresentationStore.apply() requires a product delta.');
    }

    if (delta.type === 'data/product-upsert') {
      const productId = options.getProductId(delta.product);
      records.set(productId, {
        product: delta.product,
        current: true,
        bytes: normalizeBytes(getProductBytes(delta.product)),
      });
      status = 'streaming';
      notify();
      return;
    }

    if (delta.type === 'data/product-stale') {
      const record = records.get(delta.productId);
      if (record) {
        record.current = false;
      }
      status = status === 'idle' ? 'streaming' : status;
      notify();
      return;
    }

    if (delta.type === 'data/product-remove') {
      records.delete(delta.productId);
      status = status === 'idle' ? 'streaming' : status;
      notify();
      return;
    }

    if (delta.type === 'data/representation-current') {
      status = 'current';
      lastCurrentRevision = {
        ...(delta.viewRevision !== undefined
          ? { viewRevision: delta.viewRevision }
          : {}),
        ...(delta.demandRevision !== undefined
          ? { demandRevision: delta.demandRevision }
          : {}),
      };
      notify();
      return;
    }

    if (delta.type === 'data/product-error') {
      status = 'failed';
      lastError = delta.error?.message ?? 'Product stream failed.';
      notify();
      return;
    }

    throw new TypeError(`Unsupported product delta type: ${delta.type}`);
  }

  /**
   * @param {() => void} listener
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('RepresentationStore.subscribe() requires a listener.');
    }

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getProducts() {
    return Array.from(records.values())
      .filter((record) => record.current)
      .map((record) => record.product);
  }

  function getSnapshot() {
    const currentRecords = Array.from(records.values())
      .filter((record) => record.current);
    return {
      status,
      productCount: currentRecords.length,
      bytes: currentRecords.reduce((sum, record) => sum + record.bytes, 0),
      lastError,
      lastCurrentRevision,
    };
  }

  function clear() {
    records.clear();
    status = 'idle';
    lastError = null;
    lastCurrentRevision = null;
    notify();
  }

  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }
}

/**
 * @template Product
 * @param {AsyncIterable<ProductDelta<Product>>} deltas
 * @param {import('./index.d.ts').RepresentationStore<Product>} store
 * @param {import('./index.d.ts').ConsumeProductDeltasOptions} [options]
 * @returns {Promise<import('./index.d.ts').ConsumeProductDeltasResult>}
 */
export async function consumeProductDeltas(deltas, store, options = {}) {
  const stopOnCurrent = options.stopOnCurrent === true;
  const throwOnError = options.throwOnError !== false;
  let deltaCount = 0;

  for await (const delta of deltas) {
    deltaCount += 1;
    store.apply(delta);

    if (delta.type === 'data/product-error') {
      if (throwOnError) {
        throw new Error(delta.error?.message ?? 'Product stream failed.');
      }
      return { deltaCount, stoppedOn: 'error' };
    }

    if (stopOnCurrent && delta.type === 'data/representation-current') {
      return { deltaCount, stoppedOn: 'current' };
    }
  }

  return { deltaCount, stoppedOn: 'end' };
}

/**
 * @param {number} bytes
 */
function normalizeBytes(bytes) {
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}
