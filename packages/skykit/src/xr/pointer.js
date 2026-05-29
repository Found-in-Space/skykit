import { SKYKIT_ACTIONS } from '../actions.js';
import { createSkykitXrControlBindings } from './controls.js';
import { createSkykitXrPickBridgePlugin } from './composition.js';
import { createSkykitXrRayVisualPlugin } from './plugins.js';

/**
 * @param {import('../xr.d.ts').SkykitXrPointerPluginOptions} options
 * @returns {import('../xr.d.ts').SkykitXrPointerPlugin}
 */
export function createSkykitXrPointerPlugin(options) {
  if (!options?.raySource || typeof options.raySource.getRay !== 'function') {
    throw new TypeError('createSkykitXrPointerPlugin() requires a raySource.');
  }
  const id = options.id ?? 'skykit-xr-pointer';
  const controls = options.controls ?? createSkykitXrControlBindings({
    id: `${id}:controls`,
    buttons: {
      select: options.selectButton ?? { hand: 'right', button: 'trigger' },
    },
  });
  const bridge = createSkykitXrPickBridgePlugin({
    id: `${id}:bridge`,
    raySource: options.raySource,
    router: options.router,
    blockers: options.blockers,
    targets: options.targets,
    blockerProducts: options.blockerProducts,
    targetProducts: options.targetProducts,
    layerHosts: options.layerHosts,
    onRoute: (result) => {
      lastRoute = result;
      options.onRoute?.(result);
    },
  });
  const visual = options.visual === false
    ? null
    : createSkykitXrRayVisualPlugin({
        ...(options.visual && typeof options.visual === 'object' ? options.visual : {}),
        id: options.visual && typeof options.visual === 'object' && options.visual.id ? options.visual.id : `${id}:visual`,
        raySource: createNonOwningRaySource(options.raySource),
        blockers: options.visual && typeof options.visual === 'object' && options.visual.blockers
          ? options.visual.blockers
          : options.blockers,
      });
  const actionId = options.actionId ?? SKYKIT_ACTIONS.xr.pointerSelect;
  /** @type {import('../xr.d.ts').SkykitXrPickRouteResult | null} */
  let lastRoute = null;
  let disposed = false;
  let selectCount = 0;
  let routeCount = 0;
  /** @type {import('../index.d.ts').SkykitThreePluginContext | null} */
  let context = null;
  /** @type {Array<() => void | Promise<void>>} */
  const teardowns = [];

  const part = {
    id,
    priority: options.priority ?? 55,
    /** @param {import('../index.d.ts').SkykitThreeFrame} frame */
    update(frame) {
      if (disposed || frame.xr?.presenting !== true) return;
      controls.update(createInputSourceContext(frame));
      if (options.routeOnFrame === true) {
        routeFromFrame(frame);
      }
      const select = controls.getButton('select');
      if (!select.pressedEdge) return;
      const result = routeFromFrame(frame);
      selectCount += 1;
      void frame.viewer.actions.invoke(actionId, result, {
        source: id,
        activeHand: select.activeHand,
        value: select.value,
      });
    },
    dispose() {
      disposed = true;
      if (!options.controls) controls.dispose?.();
    },
    getSnapshot,
  };

  return {
    id,
    router: bridge.router,
    setup(pluginContext) {
      context = /** @type {import('../index.d.ts').SkykitThreePluginContext} */ (pluginContext);
      const bridgeTeardown = bridge.setup(context);
      if (typeof bridgeTeardown === 'function') teardowns.push(bridgeTeardown);
      if (visual) {
        const visualTeardown = visual.setup(context);
        if (typeof visualTeardown === 'function') teardowns.push(visualTeardown);
      }
      context.addPart(part);
      return async () => {
        disposed = true;
        for (const teardown of teardowns.splice(0).reverse()) {
          await teardown();
        }
        part.dispose();
        context = null;
      };
    },
    route(routeContext = {}) {
      lastRoute = bridge.route(routeContext);
      routeCount += 1;
      return lastRoute;
    },
    getSnapshot,
  };

  /** @param {import('../index.d.ts').SkykitThreeFrame} frame */
  function routeFromFrame(frame) {
    const result = bridge.route(createRayContextFromFrame(frame));
    routeCount += 1;
    context?.emit({
      type: 'xr/pointer-route',
      id,
      result,
    });
    return result;
  }

  function getSnapshot() {
    return {
      id,
      disposed,
      selectCount,
      routeCount,
      lastRoute,
      bridge: bridge.getSnapshot?.() ?? null,
      visual: visual?.getSnapshot?.() ?? null,
      controls: controls.getSnapshot?.() ?? null,
    };
  }
}

/** @param {import('../xr.d.ts').SkykitXrRaySource} raySource */
function createNonOwningRaySource(raySource) {
  return {
    id: raySource.id,
    /** @param {import('../xr.d.ts').SkykitXrRayContext} [context] */
    getRay(context) {
      return raySource.getRay(context);
    },
    getSnapshot() {
      return raySource.getSnapshot?.() ?? { id: raySource.id };
    },
    dispose() {},
  };
}

/** @param {import('../index.d.ts').SkykitThreeFrame} frame */
function createInputSourceContext(frame) {
  const session = frame.xr?.session && typeof frame.xr.session === 'object'
    ? /** @type {{ inputSources?: Iterable<unknown> }} */ (frame.xr.session)
    : null;
  return { inputSources: session?.inputSources ?? [] };
}

/**
 * @param {import('../index.d.ts').SkykitThreeFrame} frame
 * @returns {import('../xr.d.ts').SkykitXrRayContext}
 */
function createRayContextFromFrame(frame) {
  const session = frame.xr?.session && typeof frame.xr.session === 'object'
    ? /** @type {{ inputSources?: Iterable<unknown> }} */ (frame.xr.session)
    : null;
  return {
    frame: frame.xr?.frame,
    referenceSpace: frame.xr?.referenceSpace,
    session: /** @type {any} */ (frame.xr?.session),
    inputSources: session?.inputSources ?? [],
    rig: /** @type {any} */ (frame.xr?.rig),
    body: /** @type {any} */ (frame.xr?.body),
    rays: /** @type {any} */ (frame.xr?.rays),
    viewer: frame.viewer,
  };
}
