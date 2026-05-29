import { SKYKIT_ACTIONS } from './actions.js';
import { getSkykitProductRegistry } from './products.js';

const DEFAULT_PRIMARY_SELECTION_PRODUCT = 'selection:primary';
const DEFAULT_HOVERED_SELECTION_PRODUCT = 'selection:hovered';

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
