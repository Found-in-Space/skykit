import { SKYKIT_ACTIONS } from './actions.js';

const SKYKIT_SCALE_STORE_KEY = Symbol.for('found-in-space.skykit.scale');
const storesByViewer = new WeakMap();
const DEFAULT_SCALE_DOMAIN = 'stellar';

/**
 * @typedef {import('./index.d.ts').SkykitPluginContext} SkykitPluginContext
 * @typedef {import('./index.d.ts').SkykitScaleCoordinatorPlugin} SkykitScaleCoordinatorPlugin
 * @typedef {import('./index.d.ts').SkykitScaleCoordinatorPluginOptions} SkykitScaleCoordinatorPluginOptions
 * @typedef {import('./index.d.ts').SkykitScaleDomain} SkykitScaleDomain
 * @typedef {import('./index.d.ts').SkykitScaleState} SkykitScaleState
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 */

/**
 * @param {SkykitScaleCoordinatorPluginOptions} [options]
 * @returns {SkykitScaleCoordinatorPlugin}
 */
export function createSkykitScaleCoordinatorPlugin(options = {}) {
  const id = options.id ?? 'skykit-scale';
  const initialDomain = normalizeDomain(options.domain, DEFAULT_SCALE_DOMAIN);
  /** @type {ReturnType<typeof getSkykitScaleStore> | null} */
  let store = null;
  /** @type {SkykitPluginContext | null} */
  let context = null;
  /** @type {Array<() => void>} */
  const unregisters = [];
  let disposed = false;

  const plugin = {
    id,
    /** @param {SkykitPluginContext} pluginContext */
    setup(pluginContext) {
      context = pluginContext;
      store = getSkykitScaleStore(pluginContext);
      store.setState({
        domain: initialDomain,
        previousDomain: options.previousDomain ?? null,
        transition: options.transition ?? null,
        coordinateUnitsPerParsec: positiveFinite(
          options.coordinateUnitsPerParsec,
          pluginContext.getViewState().coordinateUnitsPerParsec,
        ),
        skyFixed: options.skyFixed === true,
      }, { emit: false });
      unregisters.push(
        pluginContext.actions.registerAction(
          SKYKIT_ACTIONS.scale.setDomain,
          (event) => {
            const { payload, metadata } = event;
            const next = normalizeSetDomainPayload(payload, store?.getState(pluginContext.getViewState()));
            setDomain(next.domain, {
              coordinateUnitsPerParsec: next.coordinateUnitsPerParsec,
              skyFixed: next.skyFixed,
              source: metadata?.source,
            });
          },
          { label: 'Set scale domain' },
        ),
        pluginContext.actions.registerAction(
          SKYKIT_ACTIONS.scale.startTransition,
          (event) => {
            const { payload, metadata } = event;
            const next = normalizeTransitionPayload(payload, store?.getState(pluginContext.getViewState()));
            startTransition(next, { source: metadata?.source });
          },
          { label: 'Start scale transition' },
        ),
        pluginContext.actions.registerAction(
          SKYKIT_ACTIONS.scale.completeTransition,
          (event) => {
            const { payload, metadata } = event;
            completeTransition(normalizeCompletePayload(payload), { source: metadata?.source });
          },
          { label: 'Complete scale transition' },
        ),
      );
      pluginContext.addPart({
        id: `${id}:view-sync`,
        priority: options.priority ?? -750,
        /** @param {import('./index.d.ts').SkykitThreeFrame} frame */
        update(frame) {
          if (disposed || options.syncViewScale === false) return;
          store?.setState({
            coordinateUnitsPerParsec: frame.view.coordinateUnitsPerParsec,
          }, { reason: 'view', emit: false });
        },
      });
      return () => {
        disposed = true;
        for (const unregister of unregisters.splice(0).reverse()) unregister();
        context = null;
        store = null;
      };
    },
    setDomain,
    startTransition,
    completeTransition,
    getState() {
      return requireStore().getState(context?.getViewState());
    },
    getSnapshot() {
      return {
        id,
        disposed,
        state: store?.getState(context?.getViewState()) ?? null,
      };
    },
  };

  return plugin;

  /**
   * @param {SkykitScaleDomain} domain
   * @param {{ coordinateUnitsPerParsec?: number; skyFixed?: boolean; source?: unknown }} [setOptions]
   */
  function setDomain(domain, setOptions = {}) {
    const activeStore = requireStore();
    const current = activeStore.getState(context?.getViewState());
    const nextDomain = normalizeDomain(domain, current.domain);
    activeStore.setState({
      domain: nextDomain,
      previousDomain: current.domain === nextDomain ? current.previousDomain ?? null : current.domain,
      transition: null,
      ...(setOptions.coordinateUnitsPerParsec !== undefined
        ? { coordinateUnitsPerParsec: positiveFinite(setOptions.coordinateUnitsPerParsec, current.coordinateUnitsPerParsec) }
        : {}),
      ...(setOptions.skyFixed !== undefined ? { skyFixed: setOptions.skyFixed === true } : {}),
    }, { reason: 'domain', source: setOptions.source });
  }

  /**
   * @param {{ from?: SkykitScaleDomain; to: SkykitScaleDomain; t?: number; phase?: 'entering' | 'active' | 'leaving'; coordinateUnitsPerParsec?: number; skyFixed?: boolean }} transition
   * @param {{ source?: unknown }} [transitionOptions]
   */
  function startTransition(transition, transitionOptions = {}) {
    const activeStore = requireStore();
    const current = activeStore.getState(context?.getViewState());
    const from = normalizeDomain(transition.from, current.domain);
    const to = normalizeDomain(transition.to, current.domain);
    activeStore.setState({
      domain: to,
      previousDomain: from,
      transition: {
        from,
        to,
        t: clamp01(transition.t),
        phase: normalizePhase(transition.phase),
      },
      ...(transition.coordinateUnitsPerParsec !== undefined
        ? { coordinateUnitsPerParsec: positiveFinite(transition.coordinateUnitsPerParsec, current.coordinateUnitsPerParsec) }
        : {}),
      ...(transition.skyFixed !== undefined ? { skyFixed: transition.skyFixed === true } : {}),
    }, { reason: 'transition', source: transitionOptions.source });
  }

  /**
   * @param {{ domain?: SkykitScaleDomain; coordinateUnitsPerParsec?: number; skyFixed?: boolean } | SkykitScaleDomain | null | undefined} complete
   * @param {{ source?: unknown }} [completeOptions]
   */
  function completeTransition(complete, completeOptions = {}) {
    const activeStore = requireStore();
    const current = activeStore.getState(context?.getViewState());
    const payload = /** @type {{ domain?: SkykitScaleDomain | null; coordinateUnitsPerParsec?: number; skyFixed?: boolean }} */ (
      complete && typeof complete === 'object' ? complete : { domain: complete }
    );
    const domain = normalizeDomain(payload.domain, current.transition?.to ?? current.domain);
    activeStore.setState({
      domain,
      previousDomain: current.domain === domain ? current.previousDomain ?? null : current.domain,
      transition: null,
      ...(payload.coordinateUnitsPerParsec !== undefined
        ? { coordinateUnitsPerParsec: positiveFinite(payload.coordinateUnitsPerParsec, current.coordinateUnitsPerParsec) }
        : {}),
      ...(payload.skyFixed !== undefined ? { skyFixed: payload.skyFixed === true } : {}),
    }, { reason: 'complete', source: completeOptions.source });
  }

  function requireStore() {
    if (!store) {
      throw new Error('SkyKit scale coordinator has not been installed.');
    }
    return store;
  }
}

/**
 * @param {SkykitPluginContext} context
 * @returns {import('./index.d.ts').SkykitScaleStore}
 */
export function getSkykitScaleStore(context) {
  const store = context.useStore(SKYKIT_SCALE_STORE_KEY, createSkykitScaleStore);
  storesByViewer.set(context.viewer, store);
  return store;
}

/**
 * @param {import('./index.d.ts').SkykitViewer} viewer
 * @param {SkykitViewState} [view]
 * @returns {SkykitScaleState | null}
 */
export function getSkykitScaleStateForViewer(viewer, view) {
  return storesByViewer.get(viewer)?.getState(view) ?? null;
}

/**
 * @param {Partial<SkykitScaleState>} [initial]
 * @returns {import('./index.d.ts').SkykitScaleStore}
 */
function createSkykitScaleStore(initial = {}) {
  /** @type {SkykitScaleState} */
  let state = normalizeState(initial, null);
  /** @type {Set<(state: SkykitScaleState) => void>} */
  const listeners = new Set();

  return {
    getState(view) {
      return cloneState({
        ...state,
        coordinateUnitsPerParsec: positiveFinite(
          state.coordinateUnitsPerParsec,
          view?.coordinateUnitsPerParsec ?? 1,
        ),
      });
    },
    setState(patch, options = {}) {
      const previous = state;
      state = normalizeState({ ...state, ...patch }, previous);
      if (options.emit !== false) {
        for (const listener of [...listeners]) listener(cloneState(state));
      }
    },
    subscribe(listener, options = {}) {
      listeners.add(listener);
      if (options.replay === true) listener(cloneState(state));
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return cloneState(state);
    },
  };
}

/**
 * @param {Partial<SkykitScaleState>} input
 * @param {SkykitScaleState | null} previous
 * @returns {SkykitScaleState}
 */
function normalizeState(input, previous) {
  const domain = normalizeDomain(input.domain, previous?.domain ?? DEFAULT_SCALE_DOMAIN);
  const transition = input.transition
    ? {
        from: normalizeDomain(input.transition.from, previous?.domain ?? domain),
        to: normalizeDomain(input.transition.to, domain),
        t: clamp01(input.transition.t),
        phase: /** @type {'entering' | 'active' | 'leaving'} */ (normalizePhase(input.transition.phase)),
      }
    : null;
  return {
    domain,
    previousDomain: input.previousDomain === undefined
      ? previous?.previousDomain ?? null
      : input.previousDomain ?? null,
    transition,
    coordinateUnitsPerParsec: positiveFinite(input.coordinateUnitsPerParsec, previous?.coordinateUnitsPerParsec ?? 1),
    skyFixed: input.skyFixed === true,
  };
}

/** @param {SkykitScaleState} state */
function cloneState(state) {
  return {
    domain: state.domain,
    previousDomain: state.previousDomain ?? null,
    transition: state.transition ? { ...state.transition } : null,
    coordinateUnitsPerParsec: state.coordinateUnitsPerParsec,
    skyFixed: state.skyFixed,
  };
}

/**
 * @param {unknown} value
 * @param {SkykitScaleDomain} fallback
 * @returns {SkykitScaleDomain}
 */
function normalizeDomain(value, fallback) {
  return typeof value === 'string' && value.trim() ? /** @type {SkykitScaleDomain} */ (value) : fallback;
}

/** @param {unknown} value */
function normalizePhase(value) {
  return value === 'active' || value === 'leaving' ? value : 'entering';
}

/** @param {unknown} value */
function clamp01(value) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, number));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveFinite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * @param {unknown} payload
 * @param {SkykitScaleState | null | undefined} current
 * @returns {{ domain: SkykitScaleDomain; coordinateUnitsPerParsec?: number; skyFixed?: boolean }}
 */
function normalizeSetDomainPayload(payload, current) {
  if (typeof payload === 'string') return { domain: /** @type {SkykitScaleDomain} */ (payload) };
  if (payload && typeof payload === 'object') {
    return /** @type {{ domain: SkykitScaleDomain; coordinateUnitsPerParsec?: number; skyFixed?: boolean }} */ (payload);
  }
  return { domain: current?.domain ?? DEFAULT_SCALE_DOMAIN };
}

/**
 * @param {unknown} payload
 * @param {SkykitScaleState | null | undefined} current
 */
function normalizeTransitionPayload(payload, current) {
  if (!payload || typeof payload !== 'object') {
    return { from: current?.domain ?? DEFAULT_SCALE_DOMAIN, to: current?.domain ?? DEFAULT_SCALE_DOMAIN };
  }
  return /** @type {{ from?: SkykitScaleDomain; to: SkykitScaleDomain; t?: number; phase?: 'entering' | 'active' | 'leaving'; coordinateUnitsPerParsec?: number; skyFixed?: boolean }} */ (payload);
}

/** @param {unknown} payload */
function normalizeCompletePayload(payload) {
  return /** @type {{ domain?: SkykitScaleDomain; coordinateUnitsPerParsec?: number; skyFixed?: boolean } | SkykitScaleDomain | null | undefined} */ (payload);
}
