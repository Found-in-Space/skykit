import {
  createAppShell,
  createButton,
  createColumn,
  createDPad,
  createDockLayout,
  createHoldButton,
  createNode,
  createRect,
  createRuntime,
  createTabletHomePresentation,
  createTextLabel,
  createTouchAppRegistry,
  createValueReadout,
  defineTouchApp,
  rectContainsPoint,
} from '@found-in-space/touch-os';
import {
  createHudPanelDriver,
  createPoseAnchoredPanelDriver,
  createScenePanelDriver,
} from '@found-in-space/touch-os/hosts/three';
import * as THREE from 'three';

import { SKYKIT_ACTIONS } from './actions.js';

const DEFAULT_HUD_ID = 'skykit-touch-os-hud';
const DEFAULT_ROOT_ID = 'skykit-touch-ship-controls';
const DEFAULT_POINTER_EVENTS = Object.freeze(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']);
const DEFAULT_START_PAYLOAD = Object.freeze({ phase: 'start' });
const DEFAULT_STOP_PAYLOAD = Object.freeze({ phase: 'stop' });
const DEFAULT_DRIVER_OPTIONS = Object.freeze({
  sizing: 'viewport',
  distance: 0.58,
  pointerClaimPolicy: 'block-on-hit',
  transparent: true,
});
const DEFAULT_PANEL_DRIVER_OPTIONS = Object.freeze({
  pointerClaimPolicy: 'block-on-hit',
  transparent: true,
});
const DEFAULT_ACTION_OUTPUT_MODE = 'raw-actions';
const DEFAULT_TABLET_LAUNCHER_LAYOUT = Object.freeze({
  tileWidth: 84,
  tileHeight: 88,
  gap: 10,
  bodyPadding: 10,
  iconMinSize: 38,
  iconMaxSize: 46,
  iconScale: 0.55,
  iconTop: 2,
  labelGap: 5,
});

const SkykitSurfaceAppFrameComponent = {
  kind: 'skykit-surface-app-frame',
  getChildren(ctx) {
    return ctx.props.child ? [ctx.props.child] : [];
  },
  measure(ctx) {
    const padding = positiveFinite(ctx.props.padding, 0);
    const width = Math.max(0, ctx.constraints.maxWidth - padding * 2);
    const height = Math.max(0, ctx.constraints.maxHeight - padding * 2);
    if (ctx.props.child) {
      ctx.measureChild(ctx.props.child.id, {
        minWidth: 0,
        minHeight: 0,
        maxWidth: width,
        maxHeight: height,
      });
    }
    return {
      width: ctx.constraints.maxWidth,
      height: ctx.constraints.maxHeight,
    };
  },
  layout(ctx) {
    const padding = positiveFinite(ctx.props.padding, 0);
    const content = createRect(
      ctx.bounds.x + padding,
      ctx.bounds.y + padding,
      Math.max(0, ctx.bounds.width - padding * 2),
      Math.max(0, ctx.bounds.height - padding * 2),
    );
    if (ctx.props.child) {
      ctx.setChildBounds(ctx.props.child.id, content);
    }
    ctx.setContentBounds(content);
  },
  render(ctx) {
    const theme = ctx.services.theme.getTokens();
    return [{
      type: 'rect',
      componentId: ctx.id,
      role: 'skykit-surface-app-frame',
      rect: ctx.bounds,
      fill: ctx.props.backgroundColor ?? theme.backgroundColor,
      strokeWidth: 0,
      radius: 0,
    }];
  },
  hitTest(ctx) {
    if (ctx.props.pointerOpaque === false || !rectContainsPoint(ctx.bounds, ctx.point)) {
      return null;
    }
    return {
      targetId: `${ctx.id}:background`,
      role: 'surface-app-background',
    };
  },
};

/**
 * Build a SkyKit-flavored touch-os tablet shell from ordinary touch apps.
 *
 * @param {import('./touch-os.d.ts').SkykitTabletRootOptions} [options]
 * @returns {import('@found-in-space/touch-os').DisplayNode}
 */
export function createSkykitTabletRoot(options = {}) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createSkykitTabletRoot requires an options object.');
  }

  const id = options.id ?? 'skykit-tablet';
  const registry = options.registry ?? createTouchAppRegistry(options.apps ?? []);
  const presentation = options.presentation ?? createTabletHomePresentation({
    homeControl: options.homeControl ?? 'button',
    taskSwitcher: options.taskSwitcher ?? 'cards',
    taskCloseControl: options.taskCloseControl ?? 'button',
    launcherLayout: {
      ...DEFAULT_TABLET_LAUNCHER_LAYOUT,
      ...(options.launcherLayout ?? {}),
    },
  });

  return createAppShell(id, {
    registry,
    presentation,
    appHostMode: options.appHostMode ?? 'same-runtime',
    homeKey: options.homeKey ?? true,
    keepAlive: options.keepAlive ?? true,
    ...(options.initialSessions === undefined ? {} : { initialSessions: options.initialSessions }),
    ...(options.appStates === undefined ? {} : { appStates: options.appStates }),
    ...(options.getAppState === undefined ? {} : { getAppState: options.getAppState }),
    ...(options.forwardAppOutputs === undefined ? {} : { forwardAppOutputs: options.forwardAppOutputs }),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.surfaces === undefined ? {} : { surfaces: options.surfaces }),
    ...(options.onAppEvent === undefined ? {} : { onAppEvent: options.onAppEvent }),
    ...(options.onShellChange === undefined ? {} : { onShellChange: options.onShellChange }),
  });
}

/**
 * Wrap a display node as a full-screen tablet app. This is useful for surface
 * consumers such as HR diagrams, camera mirrors, or other panel-hosted views.
 *
 * @template TState
 * @param {import('./touch-os.d.ts').SkykitSurfaceAppOptions<TState>} options
 * @returns {import('@found-in-space/touch-os').TouchAppModule<TState>}
 */
export function createSkykitSurfaceApp(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createSkykitSurfaceApp requires options.');
  }
  const id = requiredString(options.id, 'createSkykitSurfaceApp id');
  const name = requiredString(options.name, 'createSkykitSurfaceApp name');
  const rootId = options.rootId ?? `${id}:root`;

  return defineTouchApp({
    manifest: {
      id,
      name,
      version: options.version ?? '1.0.0',
      icon: options.icon ?? createSymbolIcon(name),
      capabilities: options.capabilities ?? ['surfaces'],
      preferredWindow: {
        width: options.preferredWindow?.width ?? 360,
        height: options.preferredWindow?.height ?? 300,
        minWidth: options.preferredWindow?.minWidth ?? 260,
        minHeight: options.preferredWindow?.minHeight ?? 180,
        resizable: options.preferredWindow?.resizable ?? false,
      },
    },
    createApp(ctx) {
      return {
        render(state) {
          const child = resolveSurfaceAppNode(options.node, {
            context: ctx,
            state,
          });
          if (!child) {
            return createTextLabel(`${rootId}:empty`, {
              text: options.emptyLabel ?? `${name} unavailable`,
              tone: 'muted',
              align: 'center',
            });
          }
          return createSkykitSurfaceAppFrame(rootId, {
            child,
            padding: options.padding ?? 0,
            pointerOpaque: options.pointerOpaque !== false,
            backgroundColor: options.backgroundColor,
          });
        },
        handleOutput(output) {
          options.onOutput?.(output, { context: ctx });
          emitSkykitSurfaceAppOutput(ctx, output);
        },
      };
    },
  });
}

/**
 * @param {string} id
 * @param {{ child: import('@found-in-space/touch-os').DisplayNode; padding?: number; pointerOpaque?: boolean; backgroundColor?: string }} props
 * @returns {import('@found-in-space/touch-os').DisplayNode}
 */
function createSkykitSurfaceAppFrame(id, props) {
  return createNode(id, SkykitSurfaceAppFrameComponent, props);
}

/**
 * Create a SkyKit plugin that mounts a touch-os HUD and routes action outputs
 * into the SkyKit action registry.
 *
 * @param {import('./touch-os.d.ts').TouchOsHudPluginOptions} options
 * @returns {import('./touch-os.d.ts').TouchOsHudPlugin}
 */
export function createTouchOsHudPlugin(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createTouchOsHudPlugin requires options.');
  }
  if (options.driver !== undefined && options.runtime === undefined) {
    throw new TypeError(
      'createTouchOsHudPlugin requires the driver\'s DisplayRuntime when a driver is supplied.',
    );
  }
  if (
    options.driver !== undefined
    && (options.createDriver !== undefined || options.driverOptions !== undefined)
  ) {
    throw new TypeError(
      'createTouchOsHudPlugin cannot apply createDriver or driverOptions to a supplied driver.',
    );
  }
  assertUnmanagedTouchOsDriverOptions(
    options.driverOptions,
    'createTouchOsHudPlugin',
  );

  const id = options.id ?? DEFAULT_HUD_ID;
  const enabled = options.enabled !== false;
  const target = options.target;

  return {
    id,
    setup(context) {
      if (!enabled || !isEventTargetLike(target)) return;

      const initialRootContext = createRootContext(id, context, target, options, null);
      const initialRoot = resolveTouchOsRoot(options.root, initialRootContext);
      if (!initialRoot) return;

      const createRuntimeImpl = options.createRuntime ?? createRuntime;
      const createDriverImpl = options.createDriver ?? createHudPanelDriver;
      const runtimeWasSupplied = options.runtime !== undefined;
      const runtime = options.runtime ?? createRuntimeImpl({
        ...(options.runtimeOptions ?? {}),
        root: initialRoot,
        surface: initialRootContext.surfaceMetrics,
      });
      const driverWasSupplied = options.driver !== undefined;
      const driver = options.driver ?? createDriverImpl({
        ...DEFAULT_DRIVER_OPTIONS,
        ...(options.driverOptions ?? {}),
        runtime,
      });
      const disposeRuntime = options.disposeRuntime ?? !runtimeWasSupplied;
      const disposeDriver = options.disposeDriver ?? !driverWasSupplied;
      const pointerEventTypes = resolvePointerEventTypes(options.pointerEvents);
      const activePointers = new Set();
      /** @type {import('@found-in-space/touch-os/hosts/three').ThreePanelHostInputEvent[]} */
      const pendingEvents = [];
      let latestFrame = null;
      let latestTimestamp = 0;
      let currentRoot = initialRoot;
      let attached = false;
      let disposed = false;
      let driverDisposed = false;

      const part = {
        id,
        attach() {
          if (attached || disposed) return;
          driver.attach();
          for (const eventType of pointerEventTypes) {
            target.addEventListener(eventType, onPointerEvent, true);
          }
          attached = true;
        },
        update(frame) {
          if (disposed || !attached) return;
          latestFrame = frame;
          latestTimestamp = skykitFrameTimestamp(frame);
          const rootContext = createRootContext(id, context, target, options, frame);
          const nextRoot = resolveTouchOsRoot(options.root, rootContext);
          if (nextRoot && nextRoot !== currentRoot) {
            currentRoot = nextRoot;
            runtime.setRoot(nextRoot);
          }
          const events = pendingEvents.splice(0);
          driver.update(createTouchOsHostFrame(frame, target, {
            surfaceMetrics: rootContext.surfaceMetrics,
            parent: options.parent,
            ...(events.length ? { events } : {}),
          }));
          reconcileActivePointers(events);
          drainRuntimeOutputs(frame);
        },
        detach() {
          detach();
        },
        dispose() {
          if (disposed) return;
          detach();
          if (disposeDriver && !driverDisposed) {
            driverDisposed = true;
            driver.dispose?.();
            drainRuntimeOutputs(latestFrame);
          }
          if (disposeRuntime) {
            runtime.dispose();
          }
          disposed = true;
        },
        getSnapshot() {
          return {
            id,
            attached,
            pointerEvents: pointerEventTypes,
            surfaceMetrics: latestFrame
              ? resolveTouchOsSurfaceMetrics(target, resolveSurfaceMetricsInput(target, options.surfaceMetrics))
              : initialRootContext.surfaceMetrics,
          };
        },
      };

      context.addPart(part);

      /**
       * @param {Event} event
       */
      function onPointerEvent(event) {
        if (disposed || !attached || !latestFrame || !isPointerEventLike(event)) return;

        const hostEvent = pointerEventToTouchOs(event, target, latestTimestamp);
        if (!hostEvent) return;

        const pointerId = String(event.pointerId ?? 'default');
        const wasActive = activePointers.has(pointerId);
        if (event.type === 'pointermove' && !wasActive && event.pointerType !== 'mouse') {
          return;
        }
        pendingEvents.push(hostEvent);
        const hit = driver.getHit();
        const claimed = Boolean(hit?.blocked || hit?.componentId);
        if (event.type === 'pointerdown' && claimed) activePointers.add(pointerId);
        if (event.type === 'pointerup' || event.type === 'pointercancel') activePointers.delete(pointerId);

        if (claimed || wasActive) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }

      /**
       * @param {readonly import('@found-in-space/touch-os/hosts/three').ThreePanelHostInputEvent[]} events
       */
      function reconcileActivePointers(events) {
        const hit = driver.getHit?.();
        for (const event of events) {
          const pointerId = String(event.pointerId ?? 'default');
          if (
            event.type === 'pointer-down'
            && hit?.pointerId === pointerId
            && (hit.blocked || hit.componentId)
          ) {
            activePointers.add(pointerId);
          }
          if (event.type === 'pointer-up' || event.type === 'cancel') {
            activePointers.delete(pointerId);
          }
        }
      }

      function detach() {
        if (!attached || disposed) return;
        for (const eventType of pointerEventTypes) {
          target.removeEventListener(eventType, onPointerEvent, true);
        }
        pendingEvents.length = 0;
        activePointers.clear();
        driver.clearPointer?.(undefined, latestTimestamp);
        drainRuntimeOutputs(latestFrame);
        driver.detach();
        drainRuntimeOutputs(latestFrame);
        attached = false;
      }

      /**
       * @param {import('./index.d.ts').SkykitThreeFrame | null} frame
       */
      function drainRuntimeOutputs(frame) {
        const outputList = Array.from(runtime.takeOutputs() ?? []);
        if (typeof options.onOutput === 'function') {
          for (const output of outputList) {
            options.onOutput(output, {
              context,
              viewer: context.viewer,
              actions: context.actions,
              runtime,
              driver,
              frame,
              target,
            });
          }
        }
        dispatchTouchOsActionOutputs(outputList, context.actions, {
          sourcePrefix: options.sourcePrefix,
          actionOutputMode: options.actionOutputMode,
        });
      }
    },
  };
}

/**
 * Create a SkyKit plugin that mounts a touch-os panel through any Three host:
 * HUD, explicit scene placement, or a pose-anchored XR panel.
 *
 * @param {import('./touch-os.d.ts').TouchOsPanelPluginOptions} options
 * @returns {import('./touch-os.d.ts').TouchOsPanelPlugin}
 */
export function createTouchOsPanelPlugin(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createTouchOsPanelPlugin requires options.');
  }
  if (options.driverHandle !== undefined && options.runtime === undefined) {
    throw new TypeError(
      'createTouchOsPanelPlugin requires the driver\'s DisplayRuntime when driverHandle is supplied.',
    );
  }
  if (
    options.driverHandle !== undefined
    && (
      options.driver !== undefined
      || options.createDriver !== undefined
      || options.driverOptions !== undefined
      || (options.pointerSources?.length ?? 0) > 0
      || (options.skykitPointerSources?.length ?? 0) > 0
    )
  ) {
    throw new TypeError(
      'createTouchOsPanelPlugin cannot configure the kind, factory, options, or pointer sources of a supplied driverHandle.',
    );
  }
  assertUnmanagedTouchOsDriverOptions(
    options.driverOptions,
    'createTouchOsPanelPlugin',
  );

  const id = options.id ?? 'skykit-touch-os-panel';
  const enabled = options.enabled !== false;
  const raycaster = new THREE.Raycaster();
  const staticSurfaceMetrics = typeof options.surfaceMetrics === 'function'
    ? null
    : resolveTouchOsPanelSurfaceMetrics(options.surfaceMetrics ?? {});
  /** @type {import('@found-in-space/touch-os').DisplayRuntime | null} */
  let runtime = null;
  /** @type {import('@found-in-space/touch-os/hosts/three').ThreePanelDriver | null} */
  let driver = null;
  /** @type {import('./index.d.ts').SkykitThreePluginContext | null} */
  let pluginContext = null;
  /** @type {import('./index.d.ts').SkykitThreeFrame | null} */
  let latestFrame = null;
  /** @type {ReturnType<typeof createSkykitPointerSourceState>[]} */
  let skykitPointerSourceStates = [];
  let latestTimestamp = 0;
  let attached = false;
  let disposed = false;
  let shouldDisposeRuntime = false;
  let shouldDisposeDriver = false;
  let driverDisposed = false;

  const plugin = {
    id,
    setup(context) {
      if (!enabled) return;
      pluginContext = /** @type {import('./index.d.ts').SkykitThreePluginContext} */ (context);
      const rootContext = createPanelRootContext(id, pluginContext, options, null, staticSurfaceMetrics);
      const initialRoot = resolveTouchOsPanelRoot(options.root, rootContext);
      if (!initialRoot) return;

      const createRuntimeImpl = options.createRuntime ?? createRuntime;
      const runtimeWasSupplied = options.runtime !== undefined;
      runtime = options.runtime ?? createRuntimeImpl({
        ...(options.runtimeOptions ?? {}),
        root: initialRoot,
        surface: rootContext.surfaceMetrics,
      });
      shouldDisposeRuntime = options.disposeRuntime ?? !runtimeWasSupplied;

      const createDriverImpl = options.createDriver ?? resolveTouchOsPanelDriverFactory(options.driver);
      const driverWasSupplied = options.driverHandle !== undefined;
      skykitPointerSourceStates = (options.skykitPointerSources ?? []).map(createSkykitPointerSourceState);
      const pointerSources = [
        ...(options.pointerSources ?? []).map(createCanonicalThreePointerSource),
        ...skykitPointerSourceStates.map((state) => state.hostSource),
      ];
      driver = options.driverHandle ?? createDriverImpl({
        ...DEFAULT_PANEL_DRIVER_OPTIONS,
        ...(options.driverOptions ?? {}),
        runtime,
        surface: rootContext.surfaceMetrics,
        ...(pointerSources.length ? { pointerSources } : {}),
        ...(options.parent !== undefined && typeof options.parent !== 'function'
          ? { parent: options.parent }
          : {}),
      });
      shouldDisposeDriver = options.disposeDriver ?? !driverWasSupplied;

      let currentRoot = initialRoot;

      const part = {
        id,
        priority: options.priority,
        attach() {
          if (attached || disposed) return;
          driver?.attach();
          attached = true;
        },
        update(frame) {
          if (disposed || !attached || !runtime || !driver || !pluginContext) return;
          latestFrame = frame;
          latestTimestamp = skykitFrameTimestamp(frame);
          const nextRootContext = createPanelRootContext(
            id,
            pluginContext,
            options,
            frame,
            staticSurfaceMetrics,
          );
          const nextRoot = resolveTouchOsPanelRoot(options.root, nextRootContext);
          if (nextRoot && nextRoot !== currentRoot) {
            currentRoot = nextRoot;
            runtime.setRoot(nextRoot);
          }
          for (const sourceState of skykitPointerSourceStates) {
            sourceState.sample(frame, latestTimestamp);
          }
          driver.update(createTouchOsPanelHostFrame(frame, options, nextRootContext));
          drainPanelOutputs(frame);
        },
        detach() {
          if (!attached || disposed) return;
          driver?.detach();
          drainPanelOutputs(latestFrame);
          attached = false;
        },
        dispose() {
          if (disposed) return;
          if (attached) {
            driver?.detach();
            drainPanelOutputs(latestFrame);
            attached = false;
          }
          if (shouldDisposeDriver && driver && !driverDisposed) {
            driverDisposed = true;
            driver.dispose?.();
            drainPanelOutputs(latestFrame);
          }
          if (shouldDisposeRuntime) {
            runtime?.dispose();
          }
          disposed = true;
          skykitPointerSourceStates = [];
          runtime = null;
          driver = null;
          pluginContext = null;
        },
        getSnapshot() {
          return {
            id,
            attached,
            driver: options.driver ?? 'scene',
            surfaceMetrics: staticSurfaceMetrics ?? (latestFrame
              ? resolveTouchOsPanelSurfaceMetrics(resolvePanelSurfaceMetricsInput(options.surfaceMetrics, latestFrame))
              : rootContext.surfaceMetrics),
            hit: driver?.getHit?.() ?? null,
          };
        },
      };

      context.addPart(part);
    },
    getRuntime() {
      return runtime;
    },
    getDriver() {
      return driver;
    },
    getHit() {
      return driver?.getHit?.() ?? null;
    },
    clearPointer(pointerId) {
      if (!driver || disposed) return;
      if (pointerId === undefined) {
        clearSuppliedPointerSources(options.pointerSources, skykitPointerSourceStates);
      }
      driver.clearPointer(pointerId, latestTimestamp);
      drainPanelOutputs(latestFrame);
    },
    blockRay(ray, blockContext = {}) {
      const mesh = driver?.host?.mesh;
      if (!attached || !mesh || mesh.visible === false || !ray || typeof ray !== 'object') return null;
      const origin = toThreeVector3(ray.origin);
      const direction = toThreeVector3(ray.direction);
      if (!origin || !direction || direction.lengthSq() === 0) return null;
      direction.normalize();

      const rayLength = nonNegativeFiniteLimit(ray.length);
      const contextLimit = nonNegativeFiniteLimit(blockContext.maxDistance);
      const maxDistance = Math.min(rayLength, contextLimit);
      if (maxDistance < 0) return null;

      mesh.updateWorldMatrix?.(true, false);
      raycaster.near = 0;
      raycaster.far = maxDistance;
      raycaster.set(origin, direction);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit || hit.distance > maxDistance) return null;
      return {
        blocked: true,
        consumed: true,
        distance: hit.distance,
        hit,
      };
    },
  };

  return plugin;

  /**
   * @param {import('./index.d.ts').SkykitThreeFrame | null} frame
   */
  function drainPanelOutputs(frame) {
    if (!runtime || !driver || !pluginContext) return;
    handleTouchOsRuntimeOutputs(runtime.takeOutputs(), options, {
      context: pluginContext,
      viewer: pluginContext.viewer,
      actions: pluginContext.actions,
      runtime,
      driver,
      frame,
    });
  }
}

/**
 * Create a pointer source whose resolver receives the complete SkyKit Three
 * frame. Samples are copied onto SkyKit's canonical millisecond frame clock
 * before the panel driver sees them.
 *
 * @param {import('./touch-os.d.ts').SkykitTouchOsPointerSourceOptions | import('./touch-os.d.ts').SkykitTouchOsPointerResolver} options
 * @returns {import('./touch-os.d.ts').SkykitTouchOsPointerSource}
 */
export function createSkykitTouchOsPointerSource(options) {
  const resolver = typeof options === 'function' ? options : options?.sample;
  if (typeof resolver !== 'function') {
    throw new TypeError('createSkykitTouchOsPointerSource requires a sample resolver.');
  }
  const clear = typeof options === 'object' && options !== null ? options.clear : undefined;

  return {
    sample(frame) {
      return normalizeSkykitPointerSamples(resolver(frame), skykitFrameTimestamp(frame));
    },
    ...(typeof clear === 'function'
      ? {
          clear() {
            clear();
          },
        }
      : {}),
  };
}

/**
 * Route touch-os action outputs into a SkyKit action registry.
 *
 * @param {Iterable<unknown>} outputs
 * @param {import('./index.d.ts').SkykitActionRegistry} actions
 * @param {import('./touch-os.d.ts').DispatchTouchOsActionOutputsOptions} [options]
 * @returns {number}
 */
export function dispatchTouchOsActionOutputs(outputs, actions, options = {}) {
  let dispatched = 0;
  const sourcePrefix = options.sourcePrefix ?? 'touch-os';
  const actionOutputMode = resolveActionOutputMode(options.actionOutputMode);

  if (actionOutputMode === 'none') return 0;

  for (const output of outputs ?? []) {
    if (actionOutputMode === 'raw-actions') {
      if (!isTouchOsActionOutput(output)) continue;
      dispatched += 1;
      dispatchTouchOsAction(output.actionId, output.payload, actions, {
        source: `${sourcePrefix}:${output.componentId ?? output.actionId}`,
      });
      continue;
    }

    const appAction = resolveTouchOsAppAction(output);
    if (!appAction) continue;
    dispatched += 1;
    dispatchTouchOsAction(appAction.name, appAction.payload, actions, {
      source: createTouchOsAppActionSource(sourcePrefix, appAction),
    });
  }

  return dispatched;
}

/**
 * Build the standard SkyKit ship-control HUD root: a movement pad, vertical
 * movement buttons, optional app commands, and optional status feedback.
 *
 * @param {import('./touch-os.d.ts').SkykitShipControlsRootOptions} [options]
 * @returns {import('@found-in-space/touch-os').DisplayNode}
 */
export function createSkykitShipControlsRoot(options = {}) {
  const id = options.id ?? DEFAULT_ROOT_ID;
  const startPayload = options.startPayload ?? DEFAULT_START_PAYLOAD;
  const stopPayload = options.stopPayload ?? DEFAULT_STOP_PAYLOAD;
  const movementActions = {
    forward: SKYKIT_ACTIONS.ship.moveForward,
    back: SKYKIT_ACTIONS.ship.moveBack,
    left: SKYKIT_ACTIONS.ship.moveLeft,
    right: SKYKIT_ACTIONS.ship.moveRight,
    up: SKYKIT_ACTIONS.ship.moveUp,
    down: SKYKIT_ACTIONS.ship.moveDown,
    ...(options.actions ?? {}),
  };
  const movementLabels = {
    forward: 'F',
    back: 'B',
    left: 'L',
    right: 'R',
    up: 'Up',
    down: 'Down',
    ...(options.labels ?? {}),
  };
  const controls = [];

  if (options.verticalControls !== false) {
    controls.push(createHoldButton(`${id}:up`, {
      label: movementLabels.up,
      actionId: movementActions.up,
      startPayload,
      stopPayload,
    }));
    controls.push(createHoldButton(`${id}:down`, {
      label: movementLabels.down,
      actionId: movementActions.down,
      startPayload,
      stopPayload,
    }));
  }

  for (const command of options.commands ?? []) {
    controls.push(createSkykitTouchActionButton(command, { startPayload, stopPayload }));
  }

  const statusNode = createSkykitTouchStatusNode(options.status, {
    id: `${id}:status`,
    align: options.statusAlign,
  });

  return createDockLayout(id, {
    padding: options.padding ?? 24,
    ...(statusNode
      ? {
          topCenter: {
            maxWidth: options.statusMaxWidth ?? 360,
            maxHeight: options.statusMaxHeight ?? 48,
            child: statusNode,
          },
        }
      : {}),
    ...(options.movePad === false
      ? {}
      : {
          bottomLeft: {
            maxWidth: options.movePadMaxWidth ?? 168,
            maxHeight: options.movePadMaxHeight ?? 168,
            child: createDPad(`${id}:move-pad`, {
              up: {
                label: movementLabels.forward,
                actionId: movementActions.forward,
                startPayload,
                stopPayload,
              },
              down: {
                label: movementLabels.back,
                actionId: movementActions.back,
                startPayload,
                stopPayload,
              },
              left: {
                label: movementLabels.left,
                actionId: movementActions.left,
                startPayload,
                stopPayload,
              },
              right: {
                label: movementLabels.right,
                actionId: movementActions.right,
                startPayload,
                stopPayload,
              },
            }),
          },
        }),
    ...(controls.length
      ? {
          bottomRight: {
            maxWidth: options.controlsMaxWidth ?? 132,
            maxHeight: options.controlsMaxHeight ?? Math.max(48, 42 * controls.length + 8 * (controls.length - 1)),
            child: createColumn(`${id}:controls`, {
              gap: options.controlsGap ?? 8,
              padding: 0,
              children: controls,
            }),
          },
        }
      : {}),
  });
}

/**
 * @param {import('./touch-os.d.ts').SkykitTouchCommand} command
 * @param {import('./touch-os.d.ts').SkykitTouchActionButtonOptions} [options]
 * @returns {import('@found-in-space/touch-os').DisplayNode}
 */
export function createSkykitTouchActionButton(command, options = {}) {
  const props = {
    label: command.label,
    actionId: command.actionId,
    ...(command.disabled === undefined ? {} : { disabled: command.disabled }),
  };
  if (command.hold) {
    return createHoldButton(command.id, {
      ...props,
      startPayload: command.startPayload ?? options.startPayload ?? DEFAULT_START_PAYLOAD,
      stopPayload: command.stopPayload ?? options.stopPayload ?? DEFAULT_STOP_PAYLOAD,
    });
  }
  return createButton(command.id, props);
}

/**
 * @param {import('./touch-os.d.ts').SkykitTouchStatus | undefined} status
 * @param {import('./touch-os.d.ts').SkykitTouchStatusNodeOptions} [options]
 * @returns {import('@found-in-space/touch-os').DisplayNode | null}
 */
export function createSkykitTouchStatusNode(status, options = {}) {
  const normalized = normalizeStatus(status);
  if (!normalized) return null;

  const id = normalized.id ?? options.id ?? 'skykit-touch-status';
  if (normalized.label) {
    return createValueReadout(id, {
      label: normalized.label,
      value: normalized.value ?? normalized.text ?? '',
    });
  }

  return createTextLabel(id, {
    text: String(normalized.text ?? normalized.value ?? ''),
    tone: normalized.tone ?? options.tone,
    align: normalized.align ?? options.align,
  });
}

/**
 * @param {import('./index.d.ts').SkykitThreeFrame} frame
 * @param {import('./touch-os.d.ts').TouchOsHudTarget} target
 * @param {import('./touch-os.d.ts').CreateTouchOsHostFrameOptions} [options]
 * @returns {import('@found-in-space/touch-os/hosts/three').ThreePanelHostFrame}
 */
export function createTouchOsHostFrame(frame, target, options = {}) {
  return {
    timestamp: skykitFrameTimestamp(frame),
    scene: frame.scene,
    camera: frame.camera,
    parent: resolveParent(options.parent, frame),
    surfaceMetrics: options.surfaceMetrics ?? resolveTouchOsSurfaceMetrics(target),
    ...(options.events === undefined ? {} : { events: options.events }),
  };
}

/**
 * @param {import('./index.d.ts').SkykitThreeFrame} frame
 * @param {import('./touch-os.d.ts').TouchOsPanelPluginOptions} options
 * @param {import('./touch-os.d.ts').TouchOsPanelRootContext} rootContext
 * @returns {import('@found-in-space/touch-os/hosts/three').ThreePanelHostFrame}
 */
export function createTouchOsPanelHostFrame(frame, options, rootContext) {
  const anchorPose = resolveAnchorPose(options.anchorPose, frame);
  return {
    timestamp: skykitFrameTimestamp(frame),
    scene: frame.scene,
    camera: frame.camera,
    parent: resolveParent(options.parent, frame),
    surfaceMetrics: rootContext.surfaceMetrics,
    ...(anchorPose ? { anchorPose } : {}),
  };
}

/**
 * @param {Event & Partial<PointerEvent>} event
 * @param {import('./touch-os.d.ts').TouchOsHudTarget} target
 * @param {number} [timestamp]
 * @returns {import('@found-in-space/touch-os/hosts/three').ThreePanelHostInputEvent | null}
 */
export function pointerEventToTouchOs(event, target, timestamp = 0) {
  const rect = target.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  const type = toTouchOsPointerEventType(event.type);
  if (!type) return null;

  return {
    type,
    source: 'screen',
    pointerId: String(event.pointerId ?? 'default'),
    pointerType: event.pointerType || 'unknown',
    ndcX: (((event.clientX ?? rect.left) - rect.left) / width) * 2 - 1,
    ndcY: -((((event.clientY ?? rect.top) - rect.top) / height) * 2 - 1),
    timestamp: finiteNumber(timestamp, 0),
    pressure: event.pressure,
  };
}

/**
 * @param {import('./touch-os.d.ts').TouchOsHudTarget} target
 * @param {Partial<import('@found-in-space/touch-os').SurfaceMetrics>} [overrides]
 * @returns {import('@found-in-space/touch-os').SurfaceMetrics}
 */
export function resolveTouchOsSurfaceMetrics(target, overrides = {}) {
  const rect = typeof target.getBoundingClientRect === 'function'
    ? target.getBoundingClientRect()
    : { width: target.clientWidth ?? 1, height: target.clientHeight ?? 1 };
  const width = positiveInteger(overrides.width, Math.max(320, Math.round(target.clientWidth || rect.width || 1)));
  const height = positiveInteger(overrides.height, Math.max(240, Math.round(target.clientHeight || rect.height || 1)));
  const pixelDensity = positiveFinite(
    overrides.pixelDensity,
    Math.min(positiveFinite(globalThis.devicePixelRatio, 1), 2),
  );

  return {
    ...overrides,
    width,
    height,
    pixelDensity,
    orientation: overrides.orientation ?? (width === height ? 'square' : width > height ? 'landscape' : 'portrait'),
    safeArea: overrides.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

/**
 * @param {string} id
 * @param {import('./index.d.ts').SkykitPluginContext} context
 * @param {import('./touch-os.d.ts').TouchOsHudTarget} target
 * @param {import('./touch-os.d.ts').TouchOsHudPluginOptions} options
 * @param {import('./index.d.ts').SkykitThreeFrame | null} frame
 * @returns {import('./touch-os.d.ts').TouchOsHudRootContext}
 */
function createRootContext(id, context, target, options, frame) {
  const surfaceMetrics = resolveTouchOsSurfaceMetrics(target, resolveSurfaceMetricsInput(target, options.surfaceMetrics));
  const rootContext = {
    id,
    context,
    viewer: context.viewer,
    frame,
    view: frame?.view ?? context.getViewState(),
    target,
    surfaceMetrics,
    status: null,
  };
  rootContext.status = resolveStatus(options.status, rootContext);
  return rootContext;
}

/**
 * @param {string} id
 * @param {import('./index.d.ts').SkykitPluginContext} context
 * @param {import('./touch-os.d.ts').TouchOsPanelPluginOptions} options
 * @param {import('./index.d.ts').SkykitThreeFrame | null} frame
 * @param {import('@found-in-space/touch-os').SurfaceMetrics | null} staticSurfaceMetrics
 * @returns {import('./touch-os.d.ts').TouchOsPanelRootContext}
 */
function createPanelRootContext(id, context, options, frame, staticSurfaceMetrics) {
  return {
    id,
    context,
    viewer: context.viewer,
    frame,
    view: frame?.view ?? context.getViewState(),
    surfaceMetrics: staticSurfaceMetrics
      ?? resolveTouchOsPanelSurfaceMetrics(resolvePanelSurfaceMetricsInput(options.surfaceMetrics, frame)),
  };
}

/**
 * @param {import('./touch-os.d.ts').TouchOsPanelPluginOptions['root']} root
 * @param {import('./touch-os.d.ts').TouchOsPanelRootContext} rootContext
 * @returns {import('@found-in-space/touch-os').DisplayNode | null}
 */
function resolveTouchOsPanelRoot(root, rootContext) {
  const resolved = typeof root === 'function' ? root(rootContext) : root;
  if (resolved == null) return null;
  if (!resolved || typeof resolved !== 'object' || typeof resolved.id !== 'string') {
    throw new TypeError('touch-os panel roots must be display nodes.');
  }
  return resolved;
}

/**
 * @param {import('./touch-os.d.ts').TouchOsHudPluginOptions['root']} root
 * @param {import('./touch-os.d.ts').TouchOsHudRootContext} rootContext
 * @returns {import('@found-in-space/touch-os').DisplayNode | null}
 */
function resolveTouchOsRoot(root, rootContext) {
  const resolved = typeof root === 'function' ? root(rootContext) : root;
  if (resolved == null) return null;
  if (!resolved || typeof resolved !== 'object' || typeof resolved.id !== 'string') {
    throw new TypeError('touch-os HUD roots must be display nodes.');
  }
  return resolved;
}

/**
 * @param {import('./touch-os.d.ts').TouchOsHudPluginOptions['status']} status
 * @param {import('./touch-os.d.ts').TouchOsHudRootContext} rootContext
 * @returns {import('./touch-os.d.ts').SkykitTouchStatus | null}
 */
function resolveStatus(status, rootContext) {
  return typeof status === 'function' ? status(rootContext) : status ?? null;
}

/**
 * @param {import('./touch-os.d.ts').TouchOsHudPluginOptions['surfaceMetrics']} input
 * @param {import('./touch-os.d.ts').TouchOsHudTarget} target
 * @returns {Partial<import('@found-in-space/touch-os').SurfaceMetrics>}
 */
function resolveSurfaceMetricsInput(target, input) {
  if (typeof input === 'function') {
    return input(target) ?? {};
  }
  return input ?? {};
}

/**
 * @param {import('./touch-os.d.ts').TouchOsPanelPluginOptions['surfaceMetrics']} input
 * @param {import('./index.d.ts').SkykitThreeFrame | null} frame
 * @returns {Partial<import('@found-in-space/touch-os').SurfaceMetrics>}
 */
function resolvePanelSurfaceMetricsInput(input, frame) {
  if (typeof input === 'function') {
    return input(frame) ?? {};
  }
  return input ?? {};
}

/**
 * @param {Partial<import('@found-in-space/touch-os').SurfaceMetrics>} [overrides]
 * @returns {import('@found-in-space/touch-os').SurfaceMetrics}
 */
function resolveTouchOsPanelSurfaceMetrics(overrides = {}) {
  const width = positiveInteger(overrides.width, 384);
  const height = positiveInteger(overrides.height, 320);
  return {
    ...overrides,
    width,
    height,
    pixelDensity: positiveFinite(overrides.pixelDensity, 1),
    orientation: overrides.orientation ?? (width === height ? 'square' : width > height ? 'landscape' : 'portrait'),
    safeArea: overrides.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

/**
 * @param {import('./touch-os.d.ts').TouchOsPanelDriverKind | undefined} driver
 * @returns {(options: import('@found-in-space/touch-os/hosts/three').ScenePanelDriverOptions | import('@found-in-space/touch-os/hosts/three').PoseAnchoredPanelDriverOptions | import('@found-in-space/touch-os/hosts/three').HudPanelDriverOptions) => import('@found-in-space/touch-os/hosts/three').ThreePanelDriver}
 */
function resolveTouchOsPanelDriverFactory(driver) {
  switch (driver) {
    case 'hud':
      return createHudPanelDriver;
    case 'pose-anchored':
      return createPoseAnchoredPanelDriver;
    case 'scene':
    case undefined:
      return createScenePanelDriver;
    default:
      throw new TypeError(`Unsupported touch-os panel driver: ${String(driver)}`);
  }
}

/**
 * SkyKit resolves these values from its full frame or canonical pointer-source
 * adapters. Accepting duplicates in driverOptions would either ignore them or
 * bypass that boundary.
 *
 * @param {object | undefined} driverOptions
 * @param {string} context
 */
function assertUnmanagedTouchOsDriverOptions(driverOptions, context) {
  if (!driverOptions || typeof driverOptions !== 'object') return;
  const managedKeys = ['runtime', 'surface', 'parent', 'pointerSources'];
  const conflicts = managedKeys.filter((key) => Object.hasOwn(driverOptions, key));
  if (conflicts.length > 0) {
    throw new TypeError(
      `${context} driverOptions cannot set SkyKit-managed ${conflicts.join(', ')}.`,
    );
  }
}

/**
 * @param {import('./touch-os.d.ts').TouchOsPanelPluginOptions['anchorPose']} anchorPose
 * @param {import('./index.d.ts').SkykitThreeFrame} frame
 * @returns {import('@found-in-space/touch-os/hosts/three').ThreeHostPose | undefined}
 */
function resolveAnchorPose(anchorPose, frame) {
  const resolved = typeof anchorPose === 'function' ? anchorPose(frame) : anchorPose;
  return resolved ?? undefined;
}

/**
 * @param {import('./touch-os.d.ts').SkykitTouchOsPointerSource} source
 */
function createSkykitPointerSourceState(source) {
  if (!source || typeof source !== 'object' || typeof source.sample !== 'function') {
    throw new TypeError('SkyKit-aware touch-os pointer sources require sample(frame).');
  }
  /** @type {readonly import('@found-in-space/touch-os/hosts/three').ThreePointerSample[]} */
  let samples = [];

  return {
    source,
    hostSource: {
      sample() {
        return samples;
      },
      clear() {
        samples = [];
        source.clear?.();
      },
    },
    /**
     * @param {import('./index.d.ts').SkykitThreeFrame} frame
     * @param {number} timestamp
     */
    sample(frame, timestamp) {
      samples = normalizeSkykitPointerSamples(source.sample(frame), timestamp);
    },
    clear() {
      samples = [];
      source.clear?.();
    },
  };
}

/**
 * Preserve the touch-os host-frame callback contract while normalizing every
 * returned sample onto that host frame's canonical timestamp.
 *
 * @param {import('@found-in-space/touch-os/hosts/three').ThreePointerSource} source
 * @returns {import('@found-in-space/touch-os/hosts/three').ThreePointerSource}
 */
function createCanonicalThreePointerSource(source) {
  if (!source || typeof source !== 'object' || typeof source.sample !== 'function') {
    throw new TypeError('touch-os pointer sources require sample(frame).');
  }
  return {
    sample(frame) {
      return normalizeSkykitPointerSamples(source.sample(frame), frame.timestamp);
    },
    ...(typeof source.clear === 'function'
      ? {
          clear() {
            source.clear();
          },
        }
      : {}),
  };
}

/**
 * @param {unknown} resolved
 * @param {number} timestamp
 * @returns {readonly import('@found-in-space/touch-os/hosts/three').ThreePointerSample[]}
 */
function normalizeSkykitPointerSamples(resolved, timestamp) {
  const values = resolved == null ? [] : Array.isArray(resolved) ? resolved : [resolved];
  return values
    .filter((sample) => sample && typeof sample === 'object' && typeof sample.pointerId === 'string')
    .map((sample) => ({ ...sample, timestamp }));
}

/**
 * @param {readonly import('@found-in-space/touch-os/hosts/three').ThreePointerSource[] | undefined} rawSources
 * @param {readonly ReturnType<typeof createSkykitPointerSourceState>[]} skykitSourceStates
 */
function clearSuppliedPointerSources(rawSources, skykitSourceStates) {
  for (const source of rawSources ?? []) {
    source.clear?.();
  }
  for (const state of skykitSourceStates) {
    state.clear();
  }
}

/**
 * @param {import('./index.d.ts').SkykitThreeFrame} frame
 * @returns {number}
 */
function skykitFrameTimestamp(frame) {
  return finiteNumber(frame?.elapsedSeconds, 0) * 1000;
}

/**
 * @param {unknown} value
 * @returns {THREE.Vector3 | null}
 */
function toThreeVector3(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return new THREE.Vector3(x, y, z);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function nonNegativeFiniteLimit(value) {
  if (value == null) return Infinity;
  if (typeof value !== 'number' || !Number.isFinite(value)) return Infinity;
  return value >= 0 ? value : -1;
}

/**
 * @param {Iterable<unknown>} outputs
 * @param {import('./touch-os.d.ts').TouchOsPanelPluginOptions | import('./touch-os.d.ts').TouchOsHudPluginOptions} options
 * @param {import('./touch-os.d.ts').TouchOsPanelOutputContext} outputContext
 */
function handleTouchOsRuntimeOutputs(outputs, options, outputContext) {
  const outputList = Array.from(outputs ?? []);
  if (typeof options.onOutput === 'function') {
    for (const output of outputList) {
      options.onOutput(output, outputContext);
    }
  }
  dispatchTouchOsActionOutputs(outputList, outputContext.actions, {
    sourcePrefix: options.sourcePrefix,
    actionOutputMode: options.actionOutputMode,
  });
}

/**
 * @param {import('./touch-os.d.ts').TouchOsActionOutputMode | undefined} mode
 * @returns {import('./touch-os.d.ts').TouchOsActionOutputMode}
 */
function resolveActionOutputMode(mode) {
  const resolved = mode ?? DEFAULT_ACTION_OUTPUT_MODE;
  if (resolved === 'raw-actions' || resolved === 'app-actions' || resolved === 'none') {
    return resolved;
  }
  throw new TypeError(`Unsupported touch-os action output mode: ${String(mode)}`);
}

/**
 * @param {string} actionId
 * @param {unknown} payload
 * @param {import('./index.d.ts').SkykitActionRegistry} actions
 * @param {{ source: string }} metadata
 */
function dispatchTouchOsAction(actionId, payload, actions, metadata) {
  const phase = resolveOutputPhase(payload);
  if (phase === 'start') {
    actions.press(actionId, payload, metadata);
  } else if (phase === 'stop') {
    actions.release(actionId, metadata);
  } else {
    void actions.invoke(actionId, payload, metadata);
  }
}

/**
 * @param {unknown} output
 * @returns {{ type: 'app-action'; appId?: string; windowId?: string; instanceId?: string; name: string; payload?: unknown } | null}
 */
function resolveTouchOsAppAction(output) {
  if (!output || typeof output !== 'object' || output.type !== 'app-event') return null;
  const event = output.event;
  if (!event || typeof event !== 'object' || event.type !== 'app-action' || typeof event.name !== 'string') {
    return null;
  }
  return {
    ...event,
    appId: stableOptionalString(event.appId) ?? stableOptionalString(output.appId),
    windowId: stableOptionalString(event.windowId) ?? stableOptionalString(output.windowId),
    instanceId: stableOptionalString(event.instanceId) ?? stableOptionalString(output.instanceId),
  };
}

/**
 * @param {string} sourcePrefix
 * @param {{ appId?: string; windowId?: string; instanceId?: string; name: string }} event
 * @returns {string}
 */
function createTouchOsAppActionSource(sourcePrefix, event) {
  return [
    stableSourcePart(sourcePrefix, 'touch-os'),
    'app',
    stableSourcePart(event.appId, 'unknown-app'),
    stableSourcePart(event.windowId, 'unknown-window'),
    stableSourcePart(event.instanceId, 'unknown-instance'),
    event.name,
  ].map((part) => encodeURIComponent(part)).join(':');
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stableSourcePart(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function stableOptionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * @param {unknown} output
 * @returns {output is { type: 'action'; actionId: string; componentId?: string; payload?: unknown }}
 */
function isTouchOsActionOutput(output) {
  return Boolean(output)
    && typeof output === 'object'
    && output.type === 'action'
    && typeof output.actionId === 'string';
}

/**
 * @param {unknown} payload
 * @returns {string | null}
 */
function resolveOutputPhase(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const phase = payload.phase;
  return typeof phase === 'string' ? phase : null;
}

/**
 * @param {import('./touch-os.d.ts').SkykitTouchStatus | undefined} status
 * @returns {{ id?: string; label?: string; value?: string | number; text?: string; tone?: 'default' | 'muted'; align?: 'left' | 'center' | 'right' } | null}
 */
function normalizeStatus(status) {
  if (status == null || status === '') return null;
  if (typeof status === 'string' || typeof status === 'number') {
    return { text: String(status) };
  }
  if (typeof status !== 'object') return null;

  const text = typeof status.text === 'string' ? status.text : undefined;
  const value = typeof status.value === 'string' || typeof status.value === 'number' ? status.value : undefined;
  if (!text && value === undefined) return null;
  return {
    ...(typeof status.id === 'string' ? { id: status.id } : {}),
    ...(typeof status.label === 'string' ? { label: status.label } : {}),
    ...(value === undefined ? {} : { value }),
    ...(text === undefined ? {} : { text }),
    ...(status.tone === 'default' || status.tone === 'muted' ? { tone: status.tone } : {}),
    ...(status.align === 'left' || status.align === 'center' || status.align === 'right' ? { align: status.align } : {}),
  };
}

/**
 * @param {import('./touch-os.d.ts').TouchOsHudPluginOptions['pointerEvents']} pointerEvents
 * @returns {string[]}
 */
function resolvePointerEventTypes(pointerEvents) {
  if (pointerEvents === false) return [];
  if (Array.isArray(pointerEvents)) return pointerEvents.filter((type) => typeof type === 'string' && type);
  return [...DEFAULT_POINTER_EVENTS];
}

/**
 * @param {unknown} target
 * @returns {target is import('./touch-os.d.ts').TouchOsHudTarget}
 */
function isEventTargetLike(target) {
  return Boolean(target)
    && typeof target === 'object'
    && typeof target.addEventListener === 'function'
    && typeof target.removeEventListener === 'function'
    && typeof target.getBoundingClientRect === 'function';
}

/**
 * @param {Event} event
 * @returns {event is Event & Partial<PointerEvent>}
 */
function isPointerEventLike(event) {
  return Boolean(event)
    && typeof event.type === 'string'
    && typeof event.clientX === 'number'
    && typeof event.clientY === 'number';
}

/**
 * @param {string} type
 * @returns {'pointer-down' | 'pointer-move' | 'pointer-up' | 'cancel' | null}
 */
function toTouchOsPointerEventType(type) {
  switch (type) {
    case 'pointerdown':
      return 'pointer-down';
    case 'pointermove':
      return 'pointer-move';
    case 'pointerup':
      return 'pointer-up';
    case 'pointercancel':
      return 'cancel';
    default:
      return null;
  }
}

/**
 * @param {import('./touch-os.d.ts').TouchOsHudPluginOptions['parent']} parent
 * @param {import('./index.d.ts').SkykitThreeFrame} frame
 * @returns {import('three').Object3D | undefined}
 */
function resolveParent(parent, frame) {
  if (typeof parent === 'function') return parent(frame);
  return parent ?? frame.scene;
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInteger(value, fallback) {
  return Math.max(1, Math.round(positiveFinite(value, fallback)));
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveFinite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {string} context
 * @returns {string}
 */
function requiredString(value, context) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${context} must be a non-empty string.`);
  }
  return value;
}

/**
 * @param {import('./touch-os.d.ts').SkykitSurfaceAppOptions['node']} node
 * @param {import('./touch-os.d.ts').SkykitSurfaceAppRenderContext} context
 * @returns {import('@found-in-space/touch-os').DisplayNode | null}
 */
function resolveSurfaceAppNode(node, context) {
  const resolved = typeof node === 'function' ? node(context) : node;
  if (resolved == null) return null;
  if (!resolved || typeof resolved !== 'object' || typeof resolved.id !== 'string') {
    throw new TypeError('SkyKit surface app nodes must be display nodes.');
  }
  return resolved;
}

/**
 * @param {import('@found-in-space/touch-os').TouchAppContext} context
 * @param {unknown} output
 */
function emitSkykitSurfaceAppOutput(context, output) {
  if (isTouchOsActionOutput(output)) {
    context.actions.emit({
      type: 'app-action',
      appId: context.appId,
      instanceId: context.instanceId,
      windowId: context.windowId,
      name: output.actionId,
      ...(output.payload === undefined ? {} : { payload: output.payload }),
      componentId: output.componentId,
    });
    return;
  }
  if (isTouchOsChangeOutput(output)) {
    context.actions.emit({
      type: 'app-change',
      appId: context.appId,
      instanceId: context.instanceId,
      windowId: context.windowId,
      name: `${output.field}.change`,
      payload: {
        field: output.field,
        value: output.value,
      },
      componentId: output.componentId,
    });
  }
}

/**
 * @param {unknown} output
 * @returns {output is { type: 'change-request'; componentId: string; field: string; value: unknown }}
 */
function isTouchOsChangeOutput(output) {
  return Boolean(output)
    && typeof output === 'object'
    && output.type === 'change-request'
    && typeof output.componentId === 'string'
    && typeof output.field === 'string';
}

/**
 * @param {string} name
 * @returns {{ kind: 'symbol'; value: string }}
 */
function createSymbolIcon(name) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    kind: 'symbol',
    value: letters || 'SK',
  };
}
