import { createObserverShellStrategy } from '@found-in-space/star-trees';

import {
  getSkykitProductRegistry,
  isSkykitProductRef,
} from './products.js';

const DEFAULT_STELLAR_ATTRIBUTES = Object.freeze(['position', 'teffLog8', 'magAbs']);
const DEFAULT_STELLAR_SCALE_POLICY = /** @type {import('./index.d.ts').SkykitLayerScalePolicy} */ (Object.freeze({
  'solar-system': Object.freeze({ mode: 'frozen', frame: 'observer-sky', demand: 'paused' }),
  stellar: Object.freeze({ mode: 'active', frame: 'icrs-pc', demand: 'live' }),
  galactic: Object.freeze({ mode: 'active', frame: 'galactic-kpc', demand: 'summary' }),
}));

/**
 * @param {import('./index.d.ts').SkykitStellarSkyLayerOptions} options
 * @returns {import('./index.d.ts').SkykitStellarSkyLayer}
 */
export function createSkykitStellarSkyLayer(options) {
  if (!options?.source) {
    throw new TypeError('createSkykitStellarSkyLayer() requires source.');
  }
  if (!options?.renderer) {
    throw new TypeError('createSkykitStellarSkyLayer() requires renderer.');
  }
  const id = options.id ?? 'skykit-stellar-sky';
  const scalePolicy = options.scalePolicy ?? DEFAULT_STELLAR_SCALE_POLICY;
  /** @type {import('./index.d.ts').SkykitLayerContext | null} */
  let context = null;
  /** @type {import('./index.d.ts').SkykitStarCellSource | null} */
  let activeSource = null;
  /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
  let unsubscribeProduct = null;
  /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
  let unsubscribeSource = null;
  /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
  let unregisterDemand = null;
  /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
  let removeSourceProduct = null;
  /** @type {import('./index.d.ts').SkykitPluginTeardown | null} */
  let removeStoreProduct = null;
  /** @type {'live' | 'summary' | 'paused' | string} */
  let activeDemandMode = 'live';
  /** @type {'live' | 'summary' | 'paused' | string | null} */
  let registeredDemandMode = null;
  let disposed = false;
  let deltaCount = 0;
  let status = /** @type {'idle' | 'streaming' | 'current' | 'failed' | 'disposed'} */ ('idle');
  /** @type {string | null} */
  let lastError = null;

  const layer = {
    id,
    priority: options.priority,
    scalePolicy,
    /** @param {import('./index.d.ts').SkykitLayerContext} layerContext */
    setup(layerContext) {
      context = layerContext;
      layerContext.addObject3D(options.renderer.object3d, {
        anchorMode: options.anchorMode,
        scaleBandId: options.scaleBandId,
        disposeObject: false,
      });
      if (isSkykitProductRef(options.source)) {
        unsubscribeProduct = layerContext.products.subscribe(options.source.key, (source) => {
          bindSource(/** @type {import('./index.d.ts').SkykitStarCellSource | null} */ (source));
        }, { replay: true });
      } else {
        bindSource(options.source);
      }
      return () => {
        dispose();
      };
    },
    /** @param {import('./index.d.ts').SkykitViewState} view */
    setView(view) {
      if (disposed) return;
      options.renderer.setView({
        observerPosition: view.renderObserverPosition,
        limitingMagnitude: view.limitingMagnitude,
        coordinateUnitsPerParsec: view.coordinateUnitsPerParsec,
      });
    },
    /** @param {import('./index.d.ts').SkykitLayerState} state */
    setState(state) {
      if (disposed) return;
      activeDemandMode = resolveDemandMode(state.scale?.domain);
      syncDemand();
    },
    getBounds() {
      const bounds = options.renderer.getVisibleBounds?.();
      if (!bounds) return null;
      return {
        kind: 'stellar-sky',
        frame: 'icrs-pc',
        min: bounds.min,
        max: bounds.max,
      };
    },
    dispose,
    getSnapshot() {
      return {
        id,
        disposed,
        status,
        deltaCount,
        demandMode: activeDemandMode,
        sourceAttached: activeSource !== null,
        waitingForSource: isSkykitProductRef(options.source) && activeSource === null && !disposed,
        renderer: options.renderer.getSnapshot?.() ?? null,
        source: activeSource?.getSnapshot?.() ?? null,
        lastError,
      };
    },
  };

  return layer;

  /** @param {import('./index.d.ts').SkykitStarCellSource | null} source */
  function bindSource(source) {
    if (activeSource === source) return;
    detachSource();
    activeSource = source;
    publishSourceProducts();
    syncDemand();
    if (!source) return;
    unsubscribeSource = source.subscribe((delta) => {
      if (disposed) return;
      deltaCount += 1;
      options.renderer.apply(delta);
      if (delta.type === 'stars/current') {
        status = 'current';
      } else if (delta.type === 'stars/error') {
        status = 'failed';
        lastError = delta.error?.message ?? 'Star cell stream failed.';
      } else {
        status = 'streaming';
      }
    });
  }

  function detachSource() {
    unsubscribeSource?.();
    unsubscribeSource = null;
    unregisterDemand?.();
    unregisterDemand = null;
    registeredDemandMode = null;
    activeSource = null;
    removeSourceProduct?.();
    removeSourceProduct = null;
    removeStoreProduct?.();
    removeStoreProduct = null;
  }

  function syncDemand() {
    if (registeredDemandMode === activeDemandMode && unregisterDemand) return;
    unregisterDemand?.();
    unregisterDemand = null;
    registeredDemandMode = null;
    if (!activeSource || activeDemandMode === 'paused') return;
    unregisterDemand = activeSource.addDemand(createDemand(activeDemandMode));
    registeredDemandMode = activeDemandMode;
  }

  /** @param {string} mode */
  function createDemand(mode) {
    if (mode === 'summary' && options.summaryDemand) {
      return {
        id: `${id}:summary`,
        ...options.summaryDemand,
      };
    }
    if (mode === 'summary') {
      return {
        id: `${id}:summary`,
        strategy: options.summaryStrategy ?? null,
        attributes: options.summaryAttributes ?? options.attributes ?? DEFAULT_STELLAR_ATTRIBUTES,
      };
    }
    return {
      id: `${id}:starfield`,
      strategy: options.strategy ?? createObserverShellStrategy(),
      attributes: options.attributes ?? DEFAULT_STELLAR_ATTRIBUTES,
      ...(options.demand ?? {}),
    };
  }

  /** @param {string | undefined} domain */
  function resolveDemandMode(domain) {
    const policy = domain ? /** @type {import('./index.d.ts').SkykitLayerScalePolicy} */ (scalePolicy)?.[domain] : null;
    if (policy?.demand === 'paused' || policy?.mode === 'frozen') return 'paused';
    if (policy?.demand === 'summary') return 'summary';
    return 'live';
  }

  function publishSourceProducts() {
    if (!context || !activeSource || !options.publish) return;
    const products = getSkykitProductRegistry(context);
    const metadata = {
      kind: 'stars',
      ownerId: id,
      ...(options.publish.metadata ?? {}),
    };
    if (options.publish.source) {
      removeSourceProduct = products.provide(options.publish.source, activeSource, metadata);
    }
    if (options.publish.store) {
      removeStoreProduct = products.provide(options.publish.store, activeSource.getStore(), metadata);
    }
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    status = 'disposed';
    unsubscribeProduct?.();
    unsubscribeProduct = null;
    detachSource();
    if (options.disposeRenderer !== false) {
      options.renderer.dispose?.();
    }
    context = null;
  }
}
