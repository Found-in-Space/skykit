import { createSkykitHrDiagramPlugin } from './hr-diagram.js';
import {
  getSkykitProductRegistry,
  isSkykitProductRef,
  productRef,
} from './products.js';

const DEFAULT_HR_SURFACE_PRODUCT = 'surfaces:hr-diagram';

/**
 * @param {import('./index.d.ts').SkykitStarInstrumentPluginOptions} options
 * @returns {import('./index.d.ts').SkykitStarInstrumentPlugin}
 */
export function createSkykitStarInstrumentPlugin(options) {
  const sourceInputs = Array.from(options?.sources ?? []);
  if (sourceInputs.length === 0) {
    throw new TypeError('createSkykitStarInstrumentPlugin() requires at least one source.');
  }
  const id = options.id ?? 'skykit-star-instrument';
  const mode = options.mode ?? 'hr';
  const internalPrimarySourceKey = `${id}:primary-source`;
  /** @type {Array<{ input: unknown; source: import('./index.d.ts').SkykitStarCellSource | null; teardown: (() => void) | null }>} */
  const sourceBindings = sourceInputs.map((input) => ({ input, source: null, teardown: null }));
  /** @type {Array<{ input: unknown; value: unknown; teardown: (() => void) | null }>} */
  const overlayBindings = Array.from(options.overlays ?? []).map((input) => ({ input, value: null, teardown: null }));
  /** @type {Array<() => void | Promise<void>>} */
  const teardowns = [];
  /** @type {import('./index.d.ts').SkykitHrDiagramPlugin | null} */
  let hr = null;
  /** @type {import('./index.d.ts').SkykitStarCellSource | null} */
  let primarySource = null;
  /** @type {(() => void) | null} */
  let removePrimaryProduct = null;
  /** @type {(() => void) | null} */
  let removeSurfaceProduct = null;
  let disposed = false;

  return {
    id,
    setup(context) {
      const products = getSkykitProductRegistry(context);
      for (const binding of sourceBindings) {
        if (isSkykitProductRef(binding.input)) {
          binding.teardown = products.subscribe(binding.input.key, (source) => {
            binding.source = isStarSource(source)
              ? /** @type {import('./index.d.ts').SkykitStarCellSource} */ (source)
              : null;
            updatePrimarySource(products);
          }, { replay: true });
          teardowns.push(binding.teardown);
        } else {
          binding.source = isStarSource(binding.input)
            ? /** @type {import('./index.d.ts').SkykitStarCellSource} */ (binding.input)
            : null;
        }
      }
      for (const binding of overlayBindings) {
        if (isSkykitProductRef(binding.input)) {
          binding.teardown = products.subscribe(binding.input.key, (value) => {
            binding.value = value;
          }, { replay: true });
          teardowns.push(binding.teardown);
        } else {
          binding.value = binding.input;
        }
      }
      updatePrimarySource(products);
      if (mode === 'hr') {
        hr = createSkykitHrDiagramPlugin({
          id: `${id}:hr`,
          priority: options.priority,
          source: productRef(internalPrimarySourceKey),
          touchOs: options.touchOs,
        });
        const teardown = hr.setup(context);
        if (typeof teardown === 'function') teardowns.push(teardown);
        const surfaceKey = options.surfaceKey ?? DEFAULT_HR_SURFACE_PRODUCT;
        if (surfaceKey !== false) {
          removeSurfaceProduct = products.provide(surfaceKey, hr.getSource(), {
            kind: 'surface',
            ownerId: id,
            mode: 'hr',
            ...(options.surfaceMetadata ?? {}),
          });
          teardowns.push(removeSurfaceProduct);
        }
      }
      return async () => {
        disposed = true;
        removePrimaryProduct?.();
        removePrimaryProduct = null;
        for (const teardown of teardowns.splice(0).reverse()) {
          await teardown();
        }
      };
    },
    getSource() {
      return hr?.getSource() ?? null;
    },
    getNode() {
      return hr?.getNode() ?? null;
    },
    getSnapshot() {
      return {
        id,
        mode,
        disposed,
        primarySourceId: primarySource?.id ?? null,
        sourceBindings: sourceBindings.map((binding, index) => ({
          index,
          productKey: isSkykitProductRef(binding.input) ? binding.input.key : null,
          sourceId: binding.source?.id ?? null,
          waiting: isSkykitProductRef(binding.input) && !binding.source,
        })),
        overlays: overlayBindings.map((binding, index) => ({
          index,
          productKey: isSkykitProductRef(binding.input) ? binding.input.key : null,
          available: binding.value != null,
        })),
        hr: hr?.getSnapshot?.() ?? null,
      };
    },
  };

  /**
   * @param {ReturnType<typeof getSkykitProductRegistry>} products
   */
  function updatePrimarySource(products) {
    const nextPrimary = sourceBindings.find((binding) => binding.source)?.source ?? null;
    if (nextPrimary === primarySource) return;
    primarySource = nextPrimary;
    removePrimaryProduct?.();
    removePrimaryProduct = null;
    if (primarySource) {
      removePrimaryProduct = products.provide(internalPrimarySourceKey, primarySource, {
        kind: 'stars',
        ownerId: id,
        role: 'instrument-primary-source',
      });
    }
  }
}

/**
 * @param {unknown} value
 * @returns {value is import('./index.d.ts').SkykitStarCellSource}
 */
function isStarSource(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof /** @type {{ addDemand?: unknown; subscribe?: unknown; getStore?: unknown }} */ (value).addDemand === 'function'
    && typeof /** @type {{ addDemand?: unknown; subscribe?: unknown; getStore?: unknown }} */ (value).subscribe === 'function'
    && typeof /** @type {{ addDemand?: unknown; subscribe?: unknown; getStore?: unknown }} */ (value).getStore === 'function';
}
