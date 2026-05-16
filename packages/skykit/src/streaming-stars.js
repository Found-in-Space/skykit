import { isProviderSession, toStarOctreeViewPatch } from './utils.js';

/**
 * @typedef {import('./index.d.ts').StreamingStarLayerOptions} StreamingStarLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayer} StreamingStarLayer
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProviderSession} StarOctreeProviderSession
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProductDelta} StarOctreeProductDelta
 */

/**
 * @param {StreamingStarLayerOptions} options
 * @returns {StreamingStarLayer}
 */
export function createStreamingStarLayer(options) {
  if (!options?.provider) {
    throw new TypeError('createStreamingStarLayer() requires provider.');
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
   * @param {StarOctreeProductDelta} delta
   */
  function apply(delta) {
    if (disposed) return;
    deltaCount += 1;
    options.renderer.apply(delta);
    if (delta.type === 'data/representation-current') {
      status = 'current';
    } else if (delta.type === 'data/product-error') {
      status = 'failed';
      lastError = delta.error?.message ?? 'Product stream failed.';
    } else {
      status = 'streaming';
    }
  }

  /** @param {import('./index.d.ts').SkykitThreePluginContext} context */
  function attach(context) {
    context.roots.originContentRoot.add(options.renderer.object3d);
    if (!session) {
      const sessionOptions = /** @type {import('@found-in-space/star-octree-provider').StarOctreeSessionOptions | undefined} */ (
        isProviderSession(options.session) ? undefined : options.session
      );
      const initialView = context.getViewState();
      session = options.provider.createSession({
        ...(sessionOptions ?? {}),
        ...(options.attributes ? { attributes: Array.from(options.attributes) } : {}),
        coordinates: options.coordinates ?? createRenderCoordinateOutput(initialView.coordinateUnitsPerParsec),
      });
    }
  }

  function start() {
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
    session?.updateView(toStarOctreeViewPatch(view), {
      reason: 'skykit.view',
      ...(options.updateOptions ?? {}),
    });
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
      sessionId: session?.id ?? null,
      renderer: options.renderer.getSnapshot(),
      session: session?.getSnapshot?.() ?? null,
      lastError,
    };
  }
}

/**
 * @param {number} coordinateUnitsPerParsec
 * @returns {import('@found-in-space/star-octree-provider').StarOctreeCoordinateOutput}
 */
function createRenderCoordinateOutput(coordinateUnitsPerParsec) {
  const scale = Number.isFinite(coordinateUnitsPerParsec) && coordinateUnitsPerParsec > 0
    ? coordinateUnitsPerParsec
    : 1;
  if (scale === 1) {
    return {
      name: 'icrs-parsec-position',
      frame: 'icrs',
      units: ['pc', 'pc', 'pc'],
    };
  }
  return {
    name: 'skykit-render-position',
    frame: 'icrs',
    units: ['render-unit', 'render-unit', 'render-unit'],
    transformPosition({ xPc, yPc, zPc }) {
      return {
        x: xPc * scale,
        y: yPc * scale,
        z: zPc * scale,
      };
    },
  };
}
