// @ts-check

/** @typedef {import('../types/public.js').ViewerCreateOptions<Record<string, unknown>>} ViewerCreateOptions */
/** @typedef {import('../types/public.js').ViewerEvent<Record<string, unknown>>} ViewerEvent */
/** @typedef {import('../types/public.js').ViewerNodeSelection} ViewerNodeSelection */
/** @typedef {import('../types/public.js').ViewerSnapshot<Record<string, unknown>>} ViewerSnapshot */

import * as THREE from 'three';
import { RUNTIME_LIFECYCLE_METHODS } from './contracts.js';
import { createDesktopRig } from './runtime-rig.js';

const DEFAULT_SIZE = Object.freeze({ width: 1, height: 1 });
const DEFAULT_SELECTION = Object.freeze({
  strategy: null,
  nodes: [],
  meta: {},
});

let runtimeCount = 0;
const PART_KIND_PRIORITY = Object.freeze({
  interestField: 0,
  controller: 1,
  layer: 2,
  overlay: 3,
});
const VIEWER_COMMAND_HANDLERS = Object.freeze({
  'state/merge': 'handleStateMergeCommand',
  'selection/refresh': 'handleSelectionRefreshCommand',
  'viewer/start': 'handleStartCommand',
  'viewer/stop': 'handleStopCommand',
  'viewer/render-once': 'handleRenderOnceCommand',
  'viewer/resize': 'handleResizeCommand',
  'xr/enter': 'handleEnterXrCommand',
  'xr/exit': 'handleExitXrCommand',
});

function normalizeParts(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function clampSize(value, fallback = 1) {
  const nextValue = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(1, nextValue);
}

function normalizeResizeInput(widthOrSize, height) {
  if (widthOrSize && typeof widthOrSize === 'object') {
    return {
      width: widthOrSize.width,
      height: widthOrSize.height,
    };
  }

  return {
    width: widthOrSize,
    height,
  };
}

function mergeStringLists(...lists) {
  const values = [];
  const seen = new Set();

  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }

    for (const value of list) {
      if (typeof value !== 'string' || !value.trim() || seen.has(value)) {
        continue;
      }
      seen.add(value);
      values.push(value);
    }
  }

  return values;
}

function isCanvasElement(value) {
  return typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement;
}

function ensureHostElement(host) {
  if (!host || typeof host !== 'object') {
    throw new TypeError('createViewer() requires an HTMLElement or HTMLCanvasElement host');
  }

  if (typeof HTMLElement !== 'undefined' && host instanceof HTMLElement) {
    return host;
  }

  throw new TypeError('createViewer() host must be an HTMLElement or HTMLCanvasElement');
}

function resolveSurface(host, renderer) {
  const rendererCanvas = renderer?.domElement && isCanvasElement(renderer.domElement)
    ? renderer.domElement
    : null;

  if (isCanvasElement(host)) {
    return {
      hostElement: host,
      canvas: rendererCanvas ?? host,
      ownsCanvas: false,
    };
  }

  const hostElement = ensureHostElement(host);

  if (rendererCanvas) {
    if (rendererCanvas.parentElement !== hostElement) {
      hostElement.appendChild(rendererCanvas);
    }

    return {
      hostElement,
      canvas: rendererCanvas,
      ownsCanvas: false,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  hostElement.appendChild(canvas);

  return {
    hostElement,
    canvas,
    ownsCanvas: true,
  };
}

function resolveSize(hostElement, canvas, override = {}) {
  const width = override.width
    ?? hostElement.clientWidth
    ?? canvas.clientWidth
    ?? canvas.width
    ?? DEFAULT_SIZE.width;
  const height = override.height
    ?? hostElement.clientHeight
    ?? canvas.clientHeight
    ?? canvas.height
    ?? DEFAULT_SIZE.height;

  return {
    width: clampSize(width, DEFAULT_SIZE.width),
    height: clampSize(height, DEFAULT_SIZE.height),
  };
}

function applyRuntimeSize(runtime, size) {
  runtime.size = size;

  if (runtime.camera.isPerspectiveCamera) {
    runtime.camera.aspect = size.width / size.height;
    runtime.camera.updateProjectionMatrix();
  }

  runtime.renderer.setSize(size.width, size.height, false);
}

/**
 * @param {any} selection
 * @param {string | null} [fallbackStrategy]
 */
function normalizeSelection(selection, fallbackStrategy = null) {
  if (!selection || typeof selection !== 'object') {
    return {
      strategy: fallbackStrategy,
      nodes: [],
      meta: {},
    };
  }

  return {
    strategy: selection.strategy ?? fallbackStrategy,
    nodes: Array.isArray(selection.nodes) ? selection.nodes : [],
    meta: selection.meta && typeof selection.meta === 'object' ? { ...selection.meta } : {},
  };
}

function normalizeViewerEvent(event, snapshot) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('viewer event must be an object');
  }

  if (typeof event.type !== 'string' || !event.type.trim()) {
    throw new TypeError('viewer event.type must be a non-empty string');
  }

  return {
    ...event,
    type: event.type.trim(),
    timeMs: Number.isFinite(event.timeMs) ? Number(event.timeMs) : Date.now(),
    snapshot,
  };
}

function validatePart(entry) {
  const { part, label } = entry;
  if (!part || typeof part !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }

  for (const methodName of RUNTIME_LIFECYCLE_METHODS) {
    if (part[methodName] != null && typeof part[methodName] !== 'function') {
      throw new TypeError(`${label}.${methodName} must be a function when provided`);
    }
  }

  if (part.selectNodes != null && typeof part.selectNodes !== 'function') {
    throw new TypeError(`${label}.selectNodes must be a function when provided`);
  }
}

function createPerspectiveCamera(size) {
  // The local-star datasets are scaled to 0.001 world units per parsec, so the
  // default camera needs a very small near plane to avoid clipping nearby stars.
  const camera = new THREE.PerspectiveCamera(60, size.width / size.height, 0.0001, 256);
  camera.position.set(0, 0.4, 4);
  return camera;
}

export class ViewerRuntime {
  /**
   * @param {ViewerCreateOptions} [options]
   */
  constructor(options = {}) {
    this.id = options.id ?? `viewer-runtime-${++runtimeCount}`;
    this.datasetSession = options.datasetSession ?? options.dataset ?? null;
    this.interestField = options.interestField ?? null;
    this.layers = normalizeParts(options.layers ?? options.layer);
    this.controllers = normalizeParts(options.controllers ?? options.controller);
    this.overlays = normalizeParts(options.overlays ?? options.overlay);
    this.autoStart = options.autoStart !== false;
    this.observeResize = options.observeResize !== false;
    this.state = options.state && typeof options.state === 'object' ? { ...options.state } : {};
    this.selection = { ...DEFAULT_SELECTION };
    this.frameNumber = 0;
    this.disposed = false;
    this.initialized = false;
    this.running = false;
    this.started = false;
    this.animationFrameId = null;
    this.usesRendererAnimationLoop = false;
    this.resizeObserver = null;
    this.windowResizeHandler = null;
    this.previousFrameTimeMs = null;
    this.startedAtTimeMs = null;
    this.xrSupportCache = new Map();
    this.xrSessionMode = null;
    this.xrReferenceSpaceType = null;
    this.xrPreviousClipPlanes = null;
    this.boundHandleXrSessionEnd = this.handleXrSessionEnd.bind(this);

    const resolvedSurface = resolveSurface(options.host, options.renderer ?? null);
    this.hostElement = resolvedSurface.hostElement;
    this.canvas = resolvedSurface.canvas;
    this.ownsCanvas = resolvedSurface.ownsCanvas;

    this.renderer = options.renderer ?? new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: options.antialias !== false,
      alpha: options.alpha === true,
      // @ts-expect-error three accepts xrCompatible at runtime even though its type omits the option.
      xrCompatible: options.xrCompatible === true,
    });
    this.ownsRenderer = !options.renderer;
    this.usesRendererAnimationLoop = typeof this.renderer.setAnimationLoop === 'function';

    this.renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(options.clearColor ?? 0x02040b, 1);

    this.size = resolveSize(this.hostElement, this.canvas);
    this.scene = options.scene ?? new THREE.Scene();
    this.camera = options.camera ?? createPerspectiveCamera(this.size);
    const rig = /** @type {any} */ (options.rig ?? createDesktopRig(this.camera));
    this.rigType = rig.type ?? 'desktop';
    this.navigationRoot = rig.navigationRoot;
    this.cameraMount = rig.cameraMount;
    this.attachmentRoot = rig.attachmentRoot ?? null;
    this.deck = rig.deck ?? null;
    this.contentRoot = rig.contentRoot;
    this.mount = rig.mount;

    if (!this.navigationRoot.parent) {
      this.scene.add(this.navigationRoot);
    }
    if (!this.contentRoot.parent) {
      this.scene.add(this.contentRoot);
    }

    this.partEntries = this.createPartEntries();
    this.updateEntries = this.createUpdateEntries();
    this.boundFrame = this.frame.bind(this);
    this.eventListeners = new Set();
  }

  createPartEntries() {
    const entries = [];

    if (this.interestField) {
      entries.push({
        kind: 'interestField',
        label: 'interestField',
        part: this.interestField,
        index: 0,
      });
    }

    for (const [index, part] of this.controllers.entries()) {
      entries.push({
        kind: 'controller',
        label: `controllers[${index}]`,
        part,
        index,
      });
    }

    for (const [index, part] of this.layers.entries()) {
      entries.push({
        kind: 'layer',
        label: `layers[${index}]`,
        part,
        index,
      });
    }

    for (const [index, part] of this.overlays.entries()) {
      entries.push({
        kind: 'overlay',
        label: `overlays[${index}]`,
        part,
        index,
      });
    }

    for (const entry of entries) {
      validatePart(entry);
    }

    return entries;
  }

  createUpdateEntries() {
    return [...this.partEntries].sort((left, right) => {
      const leftPriority = PART_KIND_PRIORITY[left.kind] ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = PART_KIND_PRIORITY[right.kind] ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.index - right.index;
    });
  }

  assertActive() {
    if (this.disposed) {
      throw new Error(`ViewerRuntime "${this.id}" has already been disposed`);
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  emitEvent(event) {
    const normalized = normalizeViewerEvent(event, this.getSnapshotState());
    for (const listener of this.eventListeners) {
      try {
        listener(normalized);
      } catch (error) {
        console.error('[ViewerRuntime] event listener failed', error);
      }
    }
    return normalized;
  }

  getSnapshot() {
    return this.getSnapshotState();
  }

  select(selector) {
    const snapshot = this.getSnapshotState();
    if (typeof selector === 'function') {
      return selector(snapshot);
    }

    if (typeof selector === 'string' && selector.trim()) {
      return snapshot?.[selector];
    }

    return snapshot;
  }

  async dispatch(command) {
    this.assertActive();
    if (!command || typeof command !== 'object') {
      throw new TypeError('command must be an object');
    }
    if (typeof command.type !== 'string' || !command.type.trim()) {
      throw new TypeError('command.type must be a non-empty string');
    }

    const normalizedCommand = {
      ...command,
      type: command.type.trim(),
    };
    this.emitEvent({
      type: 'command/dispatched',
      command: normalizedCommand,
    });

    const handlerName = VIEWER_COMMAND_HANDLERS[normalizedCommand.type];
    if (!handlerName || typeof this[handlerName] !== 'function') {
      this.emitEvent({
        type: 'diagnostic/warn',
        code: 'unknown-command',
        command: normalizedCommand,
      });
      return {
        handled: false,
        result: null,
        snapshot: this.getSnapshotState(),
      };
    }

    try {
      const result = await this[handlerName](normalizedCommand);
      this.emitEvent({
        type: 'command/completed',
        command: normalizedCommand,
        result,
      });
      return {
        handled: true,
        result,
        snapshot: this.getSnapshotState(),
      };
    } catch (error) {
      this.emitEvent({
        type: 'command/failed',
        command: normalizedCommand,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  handleStateMergeCommand(command) {
    return this.setState(command.state ?? command.patch ?? {});
  }

  async handleSelectionRefreshCommand() {
    return this.refreshSelection();
  }

  async handleStartCommand() {
    await this.start();
    return {
      running: this.running,
    };
  }

  handleStopCommand() {
    this.stop();
    return {
      running: this.running,
    };
  }

  handleRenderOnceCommand() {
    this.renderOnce();
    return null;
  }

  async handleResizeCommand(command) {
    return this.resize(command.size ?? {
      width: command.width,
      height: command.height,
    });
  }

  async handleEnterXrCommand(command) {
    const session = await this.enterXR(command.options ?? command);
    return {
      sessionMode: this.xrSessionMode,
      presenting: this.getXrState().presenting,
      session,
    };
  }

  async handleExitXrCommand() {
    const exited = await this.exitXR();
    return {
      exited,
      presenting: this.getXrState().presenting,
    };
  }

  getXrState() {
    const session = this.renderer.xr?.getSession?.() ?? null;
    return {
      enabled: this.renderer.xr?.enabled === true,
      presenting: this.renderer.xr?.isPresenting === true,
      session,
      sessionMode: this.xrSessionMode,
      referenceSpace: this.renderer.xr?.getReferenceSpace?.() ?? null,
      referenceSpaceType: this.xrReferenceSpaceType,
    };
  }

  createContext(phase, extra = {}) {
    const xrState = this.getXrState();
    return {
      runtime: this,
      datasetSession: this.datasetSession,
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      mount: this.mount,
      contentRoot: this.contentRoot,
      navigationRoot: this.navigationRoot,
      cameraMount: this.cameraMount,
      attachmentRoot: this.attachmentRoot,
      deck: this.deck,
      rigType: this.rigType,
      host: this.hostElement,
      canvas: this.canvas,
      size: { ...this.size },
      state: this.state,
      selection: this.selection,
      xr: {
        ...xrState,
        frame: extra.xrFrame ?? null,
      },
      phase,
      ...extra,
    };
  }

  async callPartMethod(entry, methodName, context) {
    const method = entry.part?.[methodName];
    if (typeof method === 'function') {
      await method.call(entry.part, context);
    }
  }

  async initialize() {
    this.assertActive();
    if (this.initialized) {
      return this;
    }

    applyRuntimeSize(this, this.size);

    for (const entry of this.partEntries) {
      await this.callPartMethod(entry, 'attach', this.createContext('attach', {
        part: entry.part,
        partKind: entry.kind,
        partIndex: entry.index,
      }));
    }

    await this.refreshSelection();
    await this.resize(this.size);

    if (this.observeResize) {
      this.startResizeHandling();
    }

    this.initialized = true;

    if (this.autoStart) {
      await this.start();
    } else {
      this.renderOnce();
    }

    this.emitEvent({
      type: 'viewer/initialized',
    });

    return this;
  }

  async start() {
    this.assertActive();
    if (!this.initialized) {
      await this.initialize();
      return this;
    }

    if (!this.started) {
      for (const entry of this.partEntries) {
        await this.callPartMethod(entry, 'start', this.createContext('start', {
          part: entry.part,
          partKind: entry.kind,
          partIndex: entry.index,
        }));
      }
      this.started = true;
    }

    if (this.running) {
      return this;
    }

    this.running = true;
    this.previousFrameTimeMs = null;
    this.startedAtTimeMs = null;
    if (this.usesRendererAnimationLoop) {
      this.renderer.setAnimationLoop(this.boundFrame);
    } else {
      this.animationFrameId = window.requestAnimationFrame(this.boundFrame);
    }
    this.emitEvent({
      type: 'viewer/started',
    });
    return this;
  }

  stop() {
    if (this.usesRendererAnimationLoop) {
      this.renderer.setAnimationLoop(null);
    }
    if (this.animationFrameId != null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.running = false;
    this.previousFrameTimeMs = null;
    this.startedAtTimeMs = null;
    this.emitEvent({
      type: 'viewer/stopped',
    });
    return this;
  }

  frame(timeMs, xrFrame) {
    if (!this.running || this.disposed) {
      return;
    }

    const previousTimeMs = this.previousFrameTimeMs ?? timeMs;
    if (this.startedAtTimeMs == null) {
      this.startedAtTimeMs = timeMs;
    }
    const deltaSeconds = Math.max(0, (timeMs - previousTimeMs) / 1000);
    this.previousFrameTimeMs = timeMs;
    this.frameNumber += 1;

    const frameContext = this.createContext('update', {
      frame: {
        deltaSeconds,
        elapsedSeconds: (timeMs - this.startedAtTimeMs) / 1000,
        frameNumber: this.frameNumber,
        timeMs,
      },
      xrFrame,
    });

    for (const entry of this.updateEntries) {
      const result = this.callPartMethod(entry, 'update', frameContext);
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error(`[ViewerRuntime] ${entry.label}.update failed`, error);
        });
      }
    }

    this.renderOnce();
    if (!this.usesRendererAnimationLoop) {
      this.animationFrameId = window.requestAnimationFrame(this.boundFrame);
    }
  }

  renderOnce() {
    this.renderer.render(this.scene, this.camera);
  }

  async refreshSelection() {
    this.assertActive();
    if (!this.interestField || typeof this.interestField.selectNodes !== 'function') {
      this.selection = { ...DEFAULT_SELECTION };
      return this.selection;
    }

    const selection = await this.interestField.selectNodes(this.createContext('select'));
    this.selection = normalizeSelection(selection, this.interestField.id ?? 'interestField');
    this.emitEvent({
      type: 'selection/changed',
      selection: normalizeSelection(this.selection),
    });
    this.renderOnce();
    return this.selection;
  }

  async resize(widthOrSize, height) {
    this.assertActive();

    const previousSize = this.initialized ? { ...this.size } : null;
    const override = normalizeResizeInput(widthOrSize, height);
    const nextSize = resolveSize(this.hostElement, this.canvas, override);
    applyRuntimeSize(this, nextSize);

    const resizeContext = this.createContext('resize', { previousSize });
    for (const entry of this.partEntries) {
      await this.callPartMethod(entry, 'resize', resizeContext);
    }

    this.renderOnce();
    this.emitEvent({
      type: 'viewer/resized',
      size: { ...this.size },
    });
    return { ...this.size };
  }

  setState(nextState) {
    this.assertActive();
    if (!nextState || typeof nextState !== 'object') {
      return this.state;
    }

    this.state = {
      ...this.state,
      ...nextState,
    };

    this.emitEvent({
      type: 'state/changed',
      state: { ...this.state },
    });
    this.renderOnce();
    return this.state;
  }

  async isXrModeSupported(mode = 'immersive-vr') {
    const normalizedMode = typeof mode === 'string' && mode.trim() ? mode : 'immersive-vr';
    if (this.xrSupportCache.has(normalizedMode)) {
      return this.xrSupportCache.get(normalizedMode);
    }

    const navigatorXr = globalThis.navigator?.xr;
    if (!navigatorXr?.isSessionSupported) {
      this.xrSupportCache.set(normalizedMode, false);
      return false;
    }

    const supported = await navigatorXr.isSessionSupported(/** @type {any} */ (normalizedMode));
    this.xrSupportCache.set(normalizedMode, supported);
    return supported;
  }

  async enterXR(options = {}) {
    this.assertActive();
    if (!this.initialized) {
      await this.initialize();
    }

    const mode = typeof options.mode === 'string' && options.mode.trim()
      ? options.mode
      : 'immersive-vr';
    const navigatorXr = globalThis.navigator?.xr;
    if (!navigatorXr?.requestSession) {
      throw new Error('WebXR is not available in this environment');
    }

    const existingSession = this.renderer.xr?.getSession?.() ?? null;
    if (existingSession) {
      return existingSession;
    }

    if (!(await this.isXrModeSupported(mode))) {
      throw new Error(`WebXR mode "${mode}" is not supported`);
    }

    const renderContext = this.renderer.getContext?.();
    if (typeof renderContext?.makeXRCompatible === 'function') {
      await renderContext.makeXRCompatible();
    }

    const referenceSpaceType = typeof options.referenceSpaceType === 'string' && options.referenceSpaceType.trim()
      ? options.referenceSpaceType
      : 'local-floor';
    const requiredFeatures = mergeStringLists(options.sessionInit?.requiredFeatures);
    const optionalFeatures = mergeStringLists(
      options.sessionInit?.optionalFeatures,
      requiredFeatures.includes(referenceSpaceType) ? [] : [referenceSpaceType],
    );
    const sessionInit = {
      ...options.sessionInit,
      ...(requiredFeatures.length > 0 ? { requiredFeatures } : {}),
      ...(optionalFeatures.length > 0 ? { optionalFeatures } : {}),
    };

    this.renderer.xr.enabled = true;
    if (typeof this.renderer.xr?.setReferenceSpaceType === 'function') {
      this.renderer.xr.setReferenceSpaceType(referenceSpaceType);
    }

    let session = null;
    try {
      session = await navigatorXr.requestSession(mode, sessionInit);
      session.addEventListener('end', this.boundHandleXrSessionEnd);

      this.xrSessionMode = mode;
      this.xrReferenceSpaceType = referenceSpaceType;
    } catch (error) {
      this.renderer.xr.enabled = false;
      throw error;
    }

    const near = Number.isFinite(options.near) ? Number(options.near) : null;
    const far = Number.isFinite(options.far) ? Number(options.far) : null;
    if (near != null || far != null) {
      this.xrPreviousClipPlanes = {
        near: this.camera.near,
        far: this.camera.far,
      };
      if (near != null) {
        this.camera.near = near;
      }
      if (far != null) {
        this.camera.far = far;
      }
      this.camera.updateProjectionMatrix();

      if (typeof session.updateRenderState === 'function') {
        const renderState = {};
        if (near != null) {
          renderState.depthNear = near;
        }
        if (far != null) {
          renderState.depthFar = far;
        }
        session.updateRenderState(renderState);
      }
    }

    if (!this.running) {
      await this.start();
    }

    await this.renderer.xr.setSession(session);
    this.renderOnce();
    return session;
  }

  async exitXR() {
    const session = this.renderer.xr?.getSession?.() ?? null;
    if (!session) {
      return false;
    }

    await session.end();
    return true;
  }

  handleXrSessionEnd(event) {
    event?.currentTarget?.removeEventListener?.('end', this.boundHandleXrSessionEnd);

    if (this.xrPreviousClipPlanes) {
      this.camera.near = this.xrPreviousClipPlanes.near;
      this.camera.far = this.xrPreviousClipPlanes.far;
      this.camera.updateProjectionMatrix();
      this.xrPreviousClipPlanes = null;
    }

    this.xrSessionMode = null;
    this.xrReferenceSpaceType = null;
    this.renderer.xr.enabled = false;

    if (!this.disposed) {
      this.emitEvent({
        type: 'xr/session-ended',
      });
      this.renderOnce();
    }
  }

  getSnapshotState() {
    const xrState = this.getXrState();
    return {
      id: this.id,
      initialized: this.initialized,
      running: this.running,
      disposed: this.disposed,
      size: { ...this.size },
      state: { ...this.state },
      selection: normalizeSelection(this.selection),
      frameNumber: this.frameNumber,
      datasetSession: /** @type {any} */ (this.datasetSession)?.describe?.() ?? null,
      xr: {
        enabled: xrState.enabled,
        presenting: xrState.presenting,
        sessionMode: xrState.sessionMode,
        referenceSpaceType: xrState.referenceSpaceType,
      },
      rigType: this.rigType,
      rig: {
        navigationRoot: {
          position: this.navigationRoot.position.toArray(),
        },
        cameraMount: {
          position: this.cameraMount.position.toArray(),
        },
        ...(this.deck ? { deck: { position: this.deck.position.toArray() } } : {}),
        ...(this.attachmentRoot ? { attachmentRoot: { position: this.attachmentRoot.position.toArray() } } : {}),
      },
      parts: this.partEntries.map((entry) => ({
        kind: entry.kind,
        id: entry.part.id ?? null,
        stats: typeof entry.part?.getStats === 'function' ? entry.part.getStats() : null,
      })),
    };
  }

  startResizeHandling() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize().catch((error) => {
          console.error('[ViewerRuntime] resize observer failed', error);
        });
      });
      this.resizeObserver.observe(this.hostElement);
      return;
    }

    this.windowResizeHandler = () => {
      this.resize().catch((error) => {
        console.error('[ViewerRuntime] window resize failed', error);
      });
    };
    window.addEventListener('resize', this.windowResizeHandler);
  }

  stopResizeHandling() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler);
      this.windowResizeHandler = null;
    }
  }

  async dispose() {
    if (this.disposed) {
      return;
    }

    try {
      await this.exitXR();
    } catch (error) {
      console.error('[ViewerRuntime] exitXR during dispose failed', error);
    }

    this.stop();
    this.stopResizeHandling();

    for (const entry of [...this.partEntries].reverse()) {
      await this.callPartMethod(entry, 'dispose', this.createContext('dispose', {
        part: entry.part,
        partKind: entry.kind,
        partIndex: entry.index,
      }));
    }

    if (this.contentRoot.parent) {
      this.contentRoot.parent.remove(this.contentRoot);
    }

    if (this.navigationRoot.parent) {
      this.navigationRoot.parent.remove(this.navigationRoot);
    }

    if (this.ownsRenderer) {
      this.renderer.dispose();
    }

    if (this.ownsCanvas && this.canvas.parentElement === this.hostElement) {
      this.hostElement.removeChild(this.canvas);
    }

    this.disposed = true;
    this.initialized = false;
    this.started = false;
    this.emitEvent({
      type: 'viewer/disposed',
    });
  }
}
