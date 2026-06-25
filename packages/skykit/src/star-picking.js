import * as THREE from 'three';

import { getSkykitProductRegistry } from './products.js';
import {
  createSkykitStarSelectionFromPick,
  isSkykitSelectionFacade,
  isSkykitSelectionStore,
  resolveSkykitStarSelectionLabel,
} from './selection.js';

const DEFAULT_CLICK_MAX_MOVEMENT_PX = 5;
const DEFAULT_PICK_ATTRIBUTES = Object.freeze(['position', 'teffLog8', 'magAbs']);
const DEFAULT_METADATA_ATTRIBUTES = Object.freeze(['objectRef', 'pickMeta']);
const DEFAULT_SELECTION_PRODUCT = 'selection:primary';

/**
 * @typedef {import('./index.d.ts').SkykitStarPickEvent} SkykitStarPickEvent
 * @typedef {import('./index.d.ts').SkykitStarPickMissEvent} SkykitStarPickMissEvent
 * @typedef {import('./index.d.ts').SkykitStarPickMetadataResolver} SkykitStarPickMetadataResolver
 * @typedef {import('./index.d.ts').SkykitStarPickMetadataResolverOptions} SkykitStarPickMetadataResolverOptions
 * @typedef {import('./index.d.ts').SkykitStarPickingPluginOptions} SkykitStarPickingPluginOptions
 * @typedef {import('./index.d.ts').SkykitThreePluginContext} SkykitThreePluginContext
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 * @typedef {import('@found-in-space/three-star-field').ThreeStarFieldPickResult} ThreeStarFieldPickResult
 */

/**
 * Event-driven star picker for SkyKit starfield renderers.
 *
 * @param {SkykitStarPickingPluginOptions} options
 * @returns {import('./index.d.ts').SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitStarPickingPlugin(options) {
  if (!options?.renderer || typeof options.renderer.pick !== 'function') {
    throw new TypeError('createSkykitStarPickingPlugin() requires a renderer with pick().');
  }

  const id = options.id ?? 'skykit-star-picking';
  const button = Number.isInteger(options.button) ? Number(options.button) : 0;
  const clickMaxMovementPx = positiveFinite(options.clickMaxMovementPx, DEFAULT_CLICK_MAX_MOVEMENT_PX);
  const demandAttributes = resolveDemandAttributes(options);
  const metadataResolver = normalizeMetadataResolver(options.metadata);
  const selectionInput = options.selection;
  /** @type {Map<string, PointerTrack>} */
  const pointers = new Map();
  /** @type {SkykitThreePluginContext | null} */
  let context = null;
  /** @type {EventTarget | null} */
  let activeTarget = null;
  /** @type {(() => void) | null} */
  let unregisterDemand = null;
  let enabled = options.enabled !== false;
  let attached = false;
  let pickCount = 0;
  let missCount = 0;
  let ignoredDragCount = 0;
  /** @type {ThreeStarFieldPickResult | null} */
  let lastPick = null;

  return {
    id,
    setup(pluginContext) {
      context = /** @type {SkykitThreePluginContext} */ (pluginContext);
      activeTarget = options.target ?? getDefaultEventTarget();

      if (options.source && demandAttributes.length > 0) {
        unregisterDemand = options.source.addDemand({
          id: `${id}:attributes`,
          attributes: demandAttributes,
        });
      }

      const target = activeTarget;
      if (isEventTargetLike(target)) {
        target.addEventListener('pointerdown', onPointerDown);
        target.addEventListener('pointermove', onPointerMove);
        target.addEventListener('pointerup', onPointerUp);
        target.addEventListener('pointercancel', onPointerCancel);
        attached = true;
      }

      return dispose;
    },
    getSnapshot() {
      return {
        id,
        attached,
        enabled,
        pickCount,
        missCount,
        ignoredDragCount,
        activePointerCount: pointers.size,
        attributes: demandAttributes,
        lastPick: lastPick
          ? {
              cellKey: lastPick.cellKey,
              objectIndex: lastPick.objectIndex,
              label: fallbackPickLabel(lastPick),
            }
          : null,
      };
    },
  };

  /** @param {Event} event */
  function onPointerDown(event) {
    if (!enabled) return;
    const pointer = pointerLike(event);
    if (!pointer || Number(pointer.button ?? 0) !== button) return;
    const point = pointerPoint(pointer);
    if (!point) return;

    pointers.set(pointerId(pointer), {
      pointerId: pointerId(pointer),
      pointerType: typeof pointer.pointerType === 'string' ? pointer.pointerType : 'unknown',
      button,
      startX: point.x,
      startY: point.y,
      latestX: point.x,
      latestY: point.y,
      maxMovementPx: 0,
      cancelled: false,
    });
  }

  /** @param {Event} event */
  function onPointerMove(event) {
    const pointer = pointerLike(event);
    if (!pointer) return;
    const track = pointers.get(pointerId(pointer));
    if (!track) return;
    updatePointerTrack(track, pointer);
  }

  /** @param {Event} event */
  function onPointerUp(event) {
    const pointer = pointerLike(event);
    if (!pointer) return;
    const idForPointer = pointerId(pointer);
    const track = pointers.get(idForPointer);
    if (!track) return;
    pointers.delete(idForPointer);
    updatePointerTrack(track, pointer);
    if (track.cancelled || track.maxMovementPx > clickMaxMovementPx) {
      ignoredDragCount += 1;
      return;
    }
    void performPick(track).catch((error) => {
      context?.emit({
        type: 'stars/pick-error',
        id,
        error,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /** @param {Event} event */
  function onPointerCancel(event) {
    const pointer = pointerLike(event);
    if (!pointer) return;
    const track = pointers.get(pointerId(pointer));
    if (track) track.cancelled = true;
    pointers.delete(pointerId(pointer));
  }

  /** @param {PointerTrack} track */
  async function performPick(track) {
    if (!context || !activeTarget) return;
    const rect = resolveTargetRect(activeTarget);
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const ndcX = ((track.latestX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((track.latestY - rect.top) / rect.height) * 2 - 1);
    const camera = context.camera;
    camera.updateMatrixWorld?.();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const ray = raycaster.ray.clone();
    const view = context.getViewState();
    const pickStartMs = nowMs();
    const pick = options.renderer.pick(ray, {
      observerPosition: view.renderObserverPosition,
      coordinateUnitsPerParsec: view.coordinateUnitsPerParsec,
      limitingMagnitude: view.limitingMagnitude,
      ...(view.verticalFovDeg !== undefined ? { fovRad: (view.verticalFovDeg * Math.PI) / 180 } : {}),
      viewportHeight: rect.height,
      ...(options.pickOptions ?? {}),
    });
    const pickTimeMs = nowMs() - pickStartMs;
    const pointer = {
      pointerId: track.pointerId,
      pointerType: track.pointerType,
      button: track.button,
      clientX: track.latestX,
      clientY: track.latestY,
      ndcX,
      ndcY,
    };

    if (!pick) {
      missCount += 1;
      /** @type {SkykitStarPickMissEvent} */
      const event = {
        type: 'stars/pick-miss',
        id,
        pointer,
        ray,
        view,
      };
      context.emit(event);
      await options.onMiss?.(event);
      return;
    }

    const metadata = await resolveMetadata(metadataResolver, pick, context, view);
    const label = metadataLabel(metadata) ?? fallbackPickLabel(pick);
    lastPick = pick;
    pickCount += 1;
    /** @type {SkykitStarPickEvent} */
    const event = {
      type: 'stars/pick',
      id,
      pick,
      label,
      metadata,
      pickTimeMs,
      pointer,
      ray,
      view,
    };
    writePickSelection(selectionInput, context, pick, {
      label: resolveSkykitStarSelectionLabel(metadata, pick),
      metadata,
      source: id,
      eventType: event.type,
    });
    context.emit(event);
    await options.onPick?.(event);
  }

  function dispose() {
    if (attached && activeTarget) {
      activeTarget.removeEventListener('pointerdown', onPointerDown);
      activeTarget.removeEventListener('pointermove', onPointerMove);
      activeTarget.removeEventListener('pointerup', onPointerUp);
      activeTarget.removeEventListener('pointercancel', onPointerCancel);
    }
    unregisterDemand?.();
    unregisterDemand = null;
    pointers.clear();
    activeTarget = null;
    context = null;
    attached = false;
    enabled = false;
  }
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * Create a structural metadata resolver for star picks. The provider shape is
 * intentionally small so applications can pass the sidecar provider or their
 * own service without adding a SkyKit dependency.
 *
 * @param {SkykitStarPickMetadataResolverOptions} [options]
 * @returns {SkykitStarPickMetadataResolver}
 */
export function createSkykitStarPickMetadataResolver(options = {}) {
  const provider = options.provider ?? null;
  const fallbackLabel = options.fallbackLabel;

  return async function resolveSkykitStarPickMetadata(pick) {
    const ref = pick.objectRef ?? pick.pickMeta ?? null;
    let label = '';
    /** @type {any} */
    let facts = null;

    if (provider && ref) {
      if (typeof provider.resolvePrimaryLabel === 'function') {
        label = String((await provider.resolvePrimaryLabel(ref)) ?? '').trim();
      }
      if (!label && typeof provider.resolveFacts === 'function') {
        facts = await provider.resolveFacts(ref);
        label = String(facts?.facts?.primaryLabel ?? '').trim();
      }
    }

    if (!label) {
      label = resolveFallbackLabel(fallbackLabel, pick);
    }

    return {
      label,
      ref,
      facts,
    };
  };
}

/**
 * @param {SkykitStarPickingPluginOptions} options
 * @returns {string[]}
 */
function resolveDemandAttributes(options) {
  const attributes = new Set(options.attributes ?? DEFAULT_PICK_ATTRIBUTES);
  if (options.metadata) {
    for (const attribute of options.metadataAttributes ?? DEFAULT_METADATA_ATTRIBUTES) {
      attributes.add(attribute);
    }
  }
  return Array.from(attributes);
}

/**
 * @param {SkykitStarPickingPluginOptions['metadata']} metadata
 * @returns {SkykitStarPickMetadataResolver | null}
 */
function normalizeMetadataResolver(metadata) {
  if (!metadata) return null;
  if (typeof metadata === 'function') {
    return metadata;
  }
  if (typeof metadata === 'object') {
    return createSkykitStarPickMetadataResolver({ provider: metadata });
  }
  return null;
}

/**
 * @param {SkykitStarPickMetadataResolver | null} resolver
 * @param {ThreeStarFieldPickResult} pick
 * @param {SkykitThreePluginContext} context
 * @param {SkykitViewState} view
 */
async function resolveMetadata(resolver, pick, context, view) {
  if (!resolver) return null;
  return resolver(pick, {
    context,
    viewer: context.viewer,
    view,
  });
}

/** @param {unknown} metadata */
function metadataLabel(metadata) {
  if (typeof metadata === 'string') {
    const label = metadata.trim();
    return label || null;
  }
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const record = /** @type {{ label?: unknown; primaryLabel?: unknown; facts?: { primaryLabel?: unknown } }} */ (metadata);
  const label = String(record.label ?? record.primaryLabel ?? record.facts?.primaryLabel ?? '').trim();
  return label || null;
}

/**
 * @param {SkykitStarPickMetadataResolverOptions['fallbackLabel']} fallbackLabel
 * @param {ThreeStarFieldPickResult} pick
 */
function resolveFallbackLabel(fallbackLabel, pick) {
  if (typeof fallbackLabel === 'function') {
    const label = String(fallbackLabel(pick) ?? '').trim();
    return label || fallbackPickLabel(pick);
  }
  if (typeof fallbackLabel === 'string' && fallbackLabel.trim()) {
    return fallbackLabel.trim();
  }
  return fallbackPickLabel(pick);
}

/** @param {ThreeStarFieldPickResult} pick */
function fallbackPickLabel(pick) {
  return `${pick.cellKey}:${pick.objectIndex}`;
}

/**
 * @param {import('./index.d.ts').SkykitStarPickingPluginOptions['selection']} selectionInput
 * @param {SkykitThreePluginContext} context
 * @param {ThreeStarFieldPickResult} pick
 * @param {{ label?: string | null; metadata?: import('./index.d.ts').SkykitStarPickMetadata; source: string; eventType: string }} details
 */
function writePickSelection(selectionInput, context, pick, details) {
  if (selectionInput === false) return;
  const selection = resolveSelectionTarget(selectionInput, context);
  if (!selection) return;
  const value = createSkykitStarSelectionFromPick(pick, details);
  if (isSkykitSelectionFacade(selection)) {
    selection.set(value, { source: details.source, eventType: details.eventType });
  } else {
    selection.setPrimary(value, { source: details.source, eventType: details.eventType });
  }
}

/**
 * @param {import('./index.d.ts').SkykitStarPickingPluginOptions['selection']} selectionInput
 * @param {SkykitThreePluginContext} context
 */
function resolveSelectionTarget(selectionInput, context) {
  if (isSkykitSelectionFacade(selectionInput) || isSkykitSelectionStore(selectionInput)) {
    return selectionInput;
  }
  const products = getSkykitProductRegistry(context);
  const key = typeof selectionInput === 'string' && selectionInput
    ? selectionInput
    : DEFAULT_SELECTION_PRODUCT;
  const product = products.get(key);
  return isSkykitSelectionFacade(product) || isSkykitSelectionStore(product)
    ? product
    : null;
}

/** @param {PointerTrack} track @param {PointerEventLike} pointer */
function updatePointerTrack(track, pointer) {
  const point = pointerPoint(pointer);
  if (!point) return;
  track.latestX = point.x;
  track.latestY = point.y;
  track.maxMovementPx = Math.max(
    track.maxMovementPx,
    Math.hypot(point.x - track.startX, point.y - track.startY),
  );
}

/** @param {PointerEventLike} pointer */
function pointerPoint(pointer) {
  const x = Number(pointer.clientX);
  const y = Number(pointer.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** @param {PointerEventLike} pointer */
function pointerId(pointer) {
  return String(pointer.pointerId ?? 'default');
}

/** @param {Event} event */
function pointerLike(event) {
  return /** @type {PointerEventLike | null} */ (event && typeof event === 'object' ? event : null);
}

/**
 * @param {EventTarget | null} target
 * @returns {target is EventTarget}
 */
function isEventTargetLike(target) {
  return Boolean(
    target &&
      typeof /** @type {EventTarget} */ (target).addEventListener === 'function' &&
      typeof /** @type {EventTarget} */ (target).removeEventListener === 'function',
  );
}

function getDefaultEventTarget() {
  return /** @type {EventTarget | null} */ (globalThis.window ?? null);
}

/** @param {EventTarget} target */
function resolveTargetRect(target) {
  const targetLike = /** @type {{ getBoundingClientRect?: () => { left?: number; top?: number; width?: number; height?: number }; clientWidth?: unknown; clientHeight?: unknown; innerWidth?: unknown; innerHeight?: unknown }} */ (/** @type {unknown} */ (target));
  const rect = typeof targetLike.getBoundingClientRect === 'function'
    ? targetLike.getBoundingClientRect()
    : null;
  const width = positiveFinite(rect?.width, Number(targetLike.clientWidth ?? targetLike.innerWidth ?? globalThis.innerWidth));
  const height = positiveFinite(rect?.height, Number(targetLike.clientHeight ?? targetLike.innerHeight ?? globalThis.innerHeight));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    left: Number.isFinite(Number(rect?.left)) ? Number(rect?.left) : 0,
    top: Number.isFinite(Number(rect?.top)) ? Number(rect?.top) : 0,
    width,
    height,
  };
}

/** @param {unknown} value @param {number} fallback */
function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * @typedef {{
 *   pointerId?: unknown;
 *   pointerType?: unknown;
 *   button?: unknown;
 *   clientX?: unknown;
 *   clientY?: unknown;
 * }} PointerEventLike
 */

/**
 * @typedef {{
 *   pointerId: string;
 *   pointerType: string;
 *   button: number;
 *   startX: number;
 *   startY: number;
 *   latestX: number;
 *   latestY: number;
 *   maxMovementPx: number;
 *   cancelled: boolean;
 * }} PointerTrack
 */
