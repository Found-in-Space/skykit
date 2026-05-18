import {
  createButton,
  createColumn,
  createDPad,
  createDockLayout,
  createHoldButton,
  createRuntime,
  createTextLabel,
  createValueReadout,
} from '@found-in-space/touch-os';
import { createHudPanelDriver } from '@found-in-space/touch-os/hosts/three';

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
      const runtime = options.runtime ?? createRuntimeImpl({
        ...(options.runtimeOptions ?? {}),
        root: initialRoot,
        surface: initialRootContext.surfaceMetrics,
      });
      const driver = options.driver ?? createDriverImpl({
        ...DEFAULT_DRIVER_OPTIONS,
        ...(options.driverOptions ?? {}),
        runtime,
      });
      const pointerEventTypes = resolvePointerEventTypes(options.pointerEvents);
      const activePointers = new Set();
      let latestFrame = null;
      let currentRoot = initialRoot;
      let attached = false;
      let disposed = false;

      const part = {
        id,
        attach() {
          if (attached || disposed) return;
          attached = true;
          driver.attach();
          for (const eventType of pointerEventTypes) {
            target.addEventListener(eventType, onPointerEvent, true);
          }
        },
        update(frame) {
          if (disposed) return;
          latestFrame = frame;
          const rootContext = createRootContext(id, context, target, options, frame);
          const nextRoot = resolveTouchOsRoot(options.root, rootContext);
          if (nextRoot && nextRoot !== currentRoot) {
            currentRoot = nextRoot;
            runtime.setRoot(nextRoot);
          }
          driver.update(createTouchOsHostFrame(frame, target, {
            surfaceMetrics: rootContext.surfaceMetrics,
            parent: options.parent,
          }));
          dispatchTouchOsActionOutputs(runtime.takeOutputs(), context.actions, {
            sourcePrefix: options.sourcePrefix,
          });
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const eventType of pointerEventTypes) {
            target.removeEventListener(eventType, onPointerEvent, true);
          }
          activePointers.clear();
          driver.detach();
          if (options.disposeRuntime !== false) {
            runtime.dispose();
          }
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
        if (disposed || !latestFrame || !isPointerEventLike(event)) return;

        const hostEvent = pointerEventToTouchOs(event, target);
        if (!hostEvent) return;

        const pointerId = String(event.pointerId ?? 'default');
        const wasActive = activePointers.has(pointerId);
        const rootContext = createRootContext(id, context, target, options, latestFrame);
        driver.update({
          ...createTouchOsHostFrame(latestFrame, target, {
            surfaceMetrics: rootContext.surfaceMetrics,
            parent: options.parent,
          }),
          events: [hostEvent],
        });

        const hit = driver.getHit();
        const claimed = Boolean(hit?.blocked || hit?.componentId);
        if (event.type === 'pointerdown' && claimed) activePointers.add(pointerId);
        if (event.type === 'pointerup' || event.type === 'pointercancel') activePointers.delete(pointerId);

        dispatchTouchOsActionOutputs(runtime.takeOutputs(), context.actions, {
          sourcePrefix: options.sourcePrefix,
        });

        if (claimed || wasActive) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    },
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

  for (const output of outputs ?? []) {
    if (!isTouchOsActionOutput(output)) continue;

    dispatched += 1;
    const source = `${sourcePrefix}:${output.componentId ?? output.actionId}`;
    const metadata = { source };
    const phase = resolveOutputPhase(output.payload);
    if (phase === 'start') {
      actions.press(output.actionId, output.payload, metadata);
    } else if (phase === 'stop') {
      actions.release(output.actionId, metadata);
    } else {
      void actions.invoke(output.actionId, output.payload, metadata);
    }
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
    scene: frame.scene,
    camera: frame.camera,
    parent: resolveParent(options.parent, frame),
    surfaceMetrics: options.surfaceMetrics ?? resolveTouchOsSurfaceMetrics(target),
    ...(options.events === undefined ? {} : { events: options.events }),
  };
}

/**
 * @param {Event & Partial<PointerEvent>} event
 * @param {import('./touch-os.d.ts').TouchOsHudTarget} target
 * @returns {import('@found-in-space/touch-os/hosts/three').ThreePanelHostInputEvent | null}
 */
export function pointerEventToTouchOs(event, target) {
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
    timestamp: finiteNumber(event.timeStamp, now()),
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

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
