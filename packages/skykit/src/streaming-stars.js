import { createObserverShellStrategy } from '@found-in-space/star-trees';

import { createSkykitRenderCoordinateOutput } from './star-source.js';
import { isProviderSession, toStarOctreeViewPatch } from './utils.js';

/**
 * @typedef {import('./index.d.ts').StreamingStarLayerOptions} StreamingStarLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayer} StreamingStarLayer
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeCellDelta} StarOctreeCellDelta
 */

/**
 * @param {StreamingStarLayerOptions} options
 * @returns {StreamingStarLayer}
 */
export function createStreamingStarLayer(options) {
  const source = options?.source ?? null;
  if (!options?.provider && !source) {
    throw new TypeError('createStreamingStarLayer() requires provider or source.');
  }
  if (!options?.renderer) {
    throw new TypeError('createStreamingStarLayer() requires renderer.');
  }
  const id = options.id ?? 'streaming-stars';
  /** @type {StarOctreeProviderSession | null} */
  let session = isProviderSession(options.session) ? options.session : null;
  const ownsSession = session == null;
  /** @type {(() => void) | null} */
  let unsubscribe = null;
  /** @type {(() => void) | null} */
  let unregisterDemand = null;
  let disposed = false;
  let deltaCount = 0;
  let status = /** @type {'idle' | 'streaming' | 'current' | 'failed' | 'disposed'} */ ('idle');
  /** @type {string | null} */
  let lastError = null;

  /** @type {StreamingStarLayer} */
  const layer = {
    id,
    priority: options.priority,
    object3d: options.renderer.object3d,
    apply,
    attach,
    start,
    setView,
    detach,
    dispose,
    getSnapshot,
  };
  return layer;

  /**
   * @param {StarOctreeCellDelta} delta
   */
  function apply(delta) {
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
  }

  /** @param {import('./index.d.ts').SkykitThreePluginContext} context */
  function attach(context) {
    context.roots.originContentRoot.add(options.renderer.object3d);
    if (source) {
      registerSourceDemand();
      return;
    }
    if (!session) {
      if (!options.provider) {
        throw new TypeError('createStreamingStarLayer() cannot create a session without provider.');
      }
      const sessionOptions = /** @type {import('@found-in-space/star-octree-provider').StarOctreeSessionOptions | undefined} */ (
        isProviderSession(options.session) ? undefined : options.session
      );
      const initialView = context.getViewState();
      const strategy = resolveStreamingStrategy(
        options.strategy ?? sessionOptions?.strategy ?? createObserverShellStrategy(),
        initialView,
      );
      session = options.provider.createSession({
        ...(sessionOptions ?? {}),
        ...(strategy ? { strategy } : {}),
        ...(options.attributes ? { attributes: Array.from(options.attributes) } : {}),
        coordinates: options.coordinates ?? createSkykitRenderCoordinateOutput(initialView.coordinateUnitsPerParsec),
      });
    }
  }

  function start() {
    if (source) {
      unsubscribe = source.subscribe((delta) => {
        apply(delta);
      });
      return;
    }
    if (!session) return;
    unsubscribe = session.subscribe((delta) => {
      apply(delta);
    });
  }

  /** @param {SkykitViewState} view */
  function setView(view) {
    if (disposed) return;
    options.renderer.setView({
      observerPosition: view.renderObserverPosition,
      limitingMagnitude: view.limitingMagnitude,
      coordinateUnitsPerParsec: view.coordinateUnitsPerParsec,
    });
    if (!source) {
      session?.updateView(toStarOctreeViewPatch(view), {
        reason: 'skykit.view',
        ...(options.updateOptions ?? {}),
      });
    }
  }

  function detach() {
    options.renderer.object3d.parent?.remove(options.renderer.object3d);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    status = 'disposed';
    unsubscribe?.();
    unsubscribe = null;
    unregisterDemand?.();
    unregisterDemand = null;
    detach();
    if (ownsSession) {
      await session?.dispose();
    }
    options.renderer.dispose();
  }

  function getSnapshot() {
    return {
      id,
      status,
      deltaCount,
      sessionId: session?.id ?? source?.getSnapshot?.()?.sessionId ?? null,
      renderer: options.renderer.getSnapshot(),
      session: session?.getSnapshot?.() ?? source?.getSnapshot?.()?.session ?? null,
      source: source?.getSnapshot?.() ?? null,
      lastError,
    };
  }

  function registerSourceDemand() {
    if (!source || unregisterDemand || typeof source.addDemand !== 'function') {
      return;
    }
    const sessionOptions = /** @type {import('@found-in-space/star-octree-provider').StarOctreeSessionOptions | undefined} */ (
      isProviderSession(options.session) ? undefined : options.session
    );
    unregisterDemand = source.addDemand({
      id: `${id}:starfield`,
      strategy: options.strategy ?? sessionOptions?.strategy ?? createObserverShellStrategy(),
      attributes: options.attributes ?? sessionOptions?.attributes,
    });
  }
}

/**
 * @param {StreamingStarLayerOptions['strategy']} strategy
 * @param {SkykitViewState} view
 */
function resolveStreamingStrategy(strategy, view) {
  if (!strategy) return null;
  if (typeof strategy === 'function') {
    return strategy(view);
  }
  return strategy;
}
