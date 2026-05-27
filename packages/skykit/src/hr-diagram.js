import * as THREE from 'three';

import {
  HR_DIAGRAM_MODE_VOLUME,
  normalizeHrDiagramMode,
} from '@found-in-space/hr-diagram';
import {
  createHrDiagramEmbeddedSurfaceNode,
  createHrDiagramSurfaceSource,
} from '@found-in-space/hr-diagram/touch-os';
import {
  createSphereVolumeStrategy,
} from '@found-in-space/star-trees';

/**
 * @typedef {import('./index.d.ts').SkykitHrDiagramPlugin} SkykitHrDiagramPlugin
 * @typedef {import('./index.d.ts').SkykitHrDiagramDemandStrategy} SkykitHrDiagramDemandStrategy
 * @typedef {import('./index.d.ts').SkykitHrDiagramPluginOptions} SkykitHrDiagramPluginOptions
 * @typedef {import('./index.d.ts').SkykitThreeFrame} SkykitThreeFrame
 * @typedef {import('./index.d.ts').SkykitViewState} SkykitViewState
 */

const DEFAULT_HR_WIDTH = 512;
const DEFAULT_HR_HEIGHT = 360;
const DEFAULT_HR_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_HR_VOLUME_RADIUS_PC = 25;
const HR_ATTRIBUTES = Object.freeze(['position', 'teffLog8', 'magAbs']);

/**
 * @param {SkykitHrDiagramPluginOptions} options
 * @returns {SkykitHrDiagramPlugin}
 */
export function createSkykitHrDiagramPlugin(options) {
  if (!options?.source) {
    throw new TypeError('createSkykitHrDiagramPlugin() requires source.');
  }

  const id = options.id ?? 'skykit-hr-diagram';
  const state = {
    mode: normalizeHrDiagramMode(options.mode),
    limitingMagnitude: positiveFinite(options.limitingMagnitude, DEFAULT_HR_LIMITING_MAGNITUDE),
    volumeRadiusPc: positiveFinite(options.volumeRadiusPc, DEFAULT_HR_VOLUME_RADIUS_PC),
    highlightRegion: options.highlightRegion ?? null,
    selectedStars: Array.from(options.selectedStars ?? []),
    demandStrategy: normalizeDemandStrategy(options.demandStrategy),
  };
  const width = positiveFinite(options.width ?? options.touchOs?.width, DEFAULT_HR_WIDTH);
  const height = positiveFinite(options.height ?? options.touchOs?.height, DEFAULT_HR_HEIGHT);
  const sourceId = options.touchOs?.sourceId ?? `${id}:surface`;
  const componentId = options.touchOs?.componentId ?? `${id}:node`;
  const surfaceSource = createHrDiagramSurfaceSource({
    sourceId,
    width,
    height,
    rendererOptions: {
      width,
      height,
      mode: state.mode,
      volumeRadiusPc: state.volumeRadiusPc,
      limitingMagnitude: state.limitingMagnitude,
      highlightRegion: state.highlightRegion,
      selectedStars: state.selectedStars,
    },
  });
  const node = /** @type {import('@found-in-space/touch-os').DisplayNode} */ (/** @type {unknown} */ (
    options.touchOs?.root ?? createHrDiagramEmbeddedSurfaceNode({
      componentId,
      sourceId,
      title: 'HR diagram',
      fallbackLabel: 'HR',
    })
  ));
  const viewProjection = new THREE.Matrix4();
  /** @type {(() => void) | null} */
  let unsubscribeSource = null;
  /** @type {(() => void) | null} */
  let unregisterDemand = null;
  let disposed = false;
  let renderedFrames = 0;
  let publishedFrames = 0;
  let surfaceDirty = true;
  /** @type {import('@found-in-space/touch-os').EmbeddedSurfaceService | null} */
  let lastPublishedSurfaces = null;
  /** @type {string | null} */
  let lastFrameSurfaceViewKey = null;
  /** @type {SkykitViewState | null} */
  let lastView = null;
  /** @type {{ x: number; y: number; z: number } | null} */
  let volumeDemandCenterPc = null;

  const part = {
    id,
    priority: options.priority,
    attach() {
      unregisterDemand = options.source.addDemand({
        id: `${id}:demand`,
        strategy: (view) => createHrDemandStrategy(state, view, volumeDemandCenterPc),
        attributes: HR_ATTRIBUTES,
      });
      unsubscribeSource = options.source.subscribe((delta) => {
        surfaceSource.apply(delta);
        surfaceDirty = true;
      });
    },
    /** @param {SkykitViewState} view */
    setView(view) {
      updateSurfaceView(view, null);
      surfaceDirty = true;
    },
    /** @param {SkykitThreeFrame} frame */
    beforeRender(frame) {
      const surfaceViewKey = createSurfaceViewKey(frame.view, state);
      if (surfaceViewKey !== lastFrameSurfaceViewKey) {
        updateSurfaceView(frame.view, frame);
        lastFrameSurfaceViewKey = surfaceViewKey;
        surfaceDirty = true;
      }

      let renderedThisFrame = false;
      if (surfaceDirty && canRenderToTexture(frame.renderer)) {
        surfaceSource.render(frame.renderer, frame.elapsedSeconds);
        renderedFrames += 1;
        surfaceDirty = false;
        renderedThisFrame = true;
      }
      const surfaces = resolveTouchOsSurfaces(options.touchOs?.surfaces);
      if (surfaces !== lastPublishedSurfaces && lastPublishedSurfaces) {
        surfaceSource.unpublish(lastPublishedSurfaces);
        lastPublishedSurfaces = null;
      }
      if (renderedThisFrame && surfaces) {
        surfaceSource.publish(surfaces, frame.elapsedSeconds);
        publishedFrames += 1;
        lastPublishedSurfaces = surfaces;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSource?.();
      unregisterDemand?.();
      const surfaces = lastPublishedSurfaces ?? resolveTouchOsSurfaces(options.touchOs?.surfaces);
      if (surfaces) {
        surfaceSource.unpublish(surfaces);
      }
      surfaceSource.dispose();
    },
    getSnapshot() {
      return {
        id,
        mode: state.mode,
        renderedFrames,
        publishedFrames,
        surfaceDirty,
        source: surfaceSource.getSnapshot(),
        nodeId: node.id,
        demandStrategyActive: typeof state.demandStrategy === 'function',
        disposed,
      };
    },
  };

  return {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSource() {
      return surfaceSource;
    },
    getNode() {
      return node;
    },
    getMode() {
      return state.mode;
    },
    setMode(nextMode) {
      return setOptions({ mode: nextMode });
    },
    setOptions,
    getSnapshot() {
      return part.getSnapshot();
    },
  };

  /**
   * @param {SkykitViewState} view
   * @param {SkykitThreeFrame | null} frame
   */
  function updateSurfaceView(view, frame) {
    lastView = cloneViewState(view);
    surfaceSource.setView({
      mode: state.mode,
      width,
      height,
      observerPc: view.observerPc,
      observerPosition: view.renderObserverPosition,
      coordinateUnitsPerParsec: view.coordinateUnitsPerParsec,
      limitingMagnitude: positiveFinite(state.limitingMagnitude, view.limitingMagnitude),
      volumeRadiusPc: state.volumeRadiusPc,
      highlightRegion: state.highlightRegion,
      selectedStars: state.selectedStars,
      ...(frame ? { viewProjection: resolveViewProjection(frame, viewProjection) } : {}),
    });
    refreshVolumeDemandIfNeeded(view);
  }

  /**
   * @param {import('./index.d.ts').SkykitHrDiagramPluginRuntimeOptions} nextOptions
   */
  async function setOptions(nextOptions = {}) {
    const previousMode = state.mode;
    const previousVolumeRadiusPc = state.volumeRadiusPc;
    const previousDemandStrategy = state.demandStrategy;

    if (nextOptions.mode !== undefined) {
      state.mode = normalizeHrDiagramMode(nextOptions.mode);
    }
    if (nextOptions.limitingMagnitude !== undefined) {
      state.limitingMagnitude = positiveFinite(nextOptions.limitingMagnitude, state.limitingMagnitude);
    }
    if (nextOptions.volumeRadiusPc !== undefined) {
      state.volumeRadiusPc = positiveFinite(nextOptions.volumeRadiusPc, state.volumeRadiusPc);
    }
    if ('highlightRegion' in nextOptions) {
      state.highlightRegion = nextOptions.highlightRegion ?? null;
    }
    if (nextOptions.selectedStars !== undefined) {
      state.selectedStars = Array.from(nextOptions.selectedStars);
    }
    if ('demandStrategy' in nextOptions) {
      state.demandStrategy = normalizeDemandStrategy(nextOptions.demandStrategy);
    }

    const demandChanged = hrModeHasDemand(previousMode) !== hrModeHasDemand(state.mode) ||
      previousDemandStrategy !== state.demandStrategy ||
      (state.mode === HR_DIAGRAM_MODE_VOLUME && (
        previousMode !== HR_DIAGRAM_MODE_VOLUME ||
        state.volumeRadiusPc !== previousVolumeRadiusPc
      ));
    if (state.mode === HR_DIAGRAM_MODE_VOLUME && lastView && !state.demandStrategy) {
      volumeDemandCenterPc = clonePoint(lastView.observerPc);
    } else if (state.mode !== HR_DIAGRAM_MODE_VOLUME) {
      volumeDemandCenterPc = null;
    }
    if (lastView) {
      updateSurfaceView(lastView, null);
    }
    surfaceDirty = true;
    lastFrameSurfaceViewKey = null;
    if (demandChanged) {
      await options.source.refreshDemand?.(`${id}.options`);
    }
  }

  /** @param {SkykitViewState} view */
  function refreshVolumeDemandIfNeeded(view) {
    if (state.mode !== HR_DIAGRAM_MODE_VOLUME) {
      return;
    }
    if (state.demandStrategy) {
      return;
    }
    if (!volumeDemandCenterPc) {
      volumeDemandCenterPc = clonePoint(view.observerPc);
      return;
    }
    const thresholdPc = Math.max(1, state.volumeRadiusPc * 0.25);
    if (pointDistancePc(volumeDemandCenterPc, view.observerPc) >= thresholdPc) {
      volumeDemandCenterPc = clonePoint(view.observerPc);
      void options.source.refreshDemand?.(`${id}.volume-center`);
    }
  }
}

/**
 * @param {SkykitViewState} view
 * @param {{
 *   mode: import('@found-in-space/hr-diagram').HrDiagramMode;
 *   limitingMagnitude: number;
 *   volumeRadiusPc: number;
 *   highlightRegion: unknown;
 *   selectedStars: readonly unknown[];
 * }} state
 */
function createSurfaceViewKey(view, state) {
  return [
    view.revision,
    state.mode,
    state.limitingMagnitude,
    state.volumeRadiusPc,
    view.limitingMagnitude,
    view.coordinateUnitsPerParsec,
    view.verticalFovDeg ?? '',
    view.aspectRatio ?? '',
    pointKey(view.observerPc),
    pointKey(view.renderObserverPosition),
    state.highlightRegion ? JSON.stringify(state.highlightRegion) : '',
    state.selectedStars.length,
  ].join('|');
}

/**
 * @param {{
 *   mode: import('@found-in-space/hr-diagram').HrDiagramMode;
 *   limitingMagnitude: number;
 *   volumeRadiusPc: number;
 *   demandStrategy: SkykitHrDiagramDemandStrategy | null;
 * }} state
 * @param {SkykitViewState} view
 * @param {{ x: number; y: number; z: number } | null} volumeDemandCenterPc
 */
function createHrDemandStrategy(state, view, volumeDemandCenterPc) {
  if (state.demandStrategy) {
    return state.demandStrategy({
      view,
      mode: state.mode,
      limitingMagnitude: state.limitingMagnitude,
      volumeRadiusPc: state.volumeRadiusPc,
      volumeDemandCenterPc: volumeDemandCenterPc ? clonePoint(volumeDemandCenterPc) : null,
      createDefaultStrategy: () => createDefaultHrDemandStrategy(state, view, volumeDemandCenterPc),
    });
  }
  return createDefaultHrDemandStrategy(state, view, volumeDemandCenterPc);
}

/**
 * @param {{ mode: import('@found-in-space/hr-diagram').HrDiagramMode; volumeRadiusPc: number }} state
 * @param {SkykitViewState} view
 * @param {{ x: number; y: number; z: number } | null} volumeDemandCenterPc
 */
function createDefaultHrDemandStrategy(state, view, volumeDemandCenterPc) {
  if (state.mode === HR_DIAGRAM_MODE_VOLUME) {
    return createSphereVolumeStrategy({
      centerPc: volumeDemandCenterPc ?? view.observerPc,
      radiusPc: state.volumeRadiusPc,
    });
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {SkykitHrDiagramDemandStrategy | null}
 */
function normalizeDemandStrategy(value) {
  return typeof value === 'function'
    ? /** @type {SkykitHrDiagramDemandStrategy} */ (value)
    : null;
}

/**
 * @param {import('./index.d.ts').SkykitHrDiagramTouchOsOptions['surfaces']} surfaces
 * @returns {import('@found-in-space/touch-os').EmbeddedSurfaceService | null}
 */
function resolveTouchOsSurfaces(surfaces) {
  const resolved = typeof surfaces === 'function' ? surfaces() : surfaces;
  return resolved ?? null;
}

/** @param {import('@found-in-space/hr-diagram').HrDiagramMode} mode */
function hrModeHasDemand(mode) {
  return mode === HR_DIAGRAM_MODE_VOLUME;
}

/**
 * @param {SkykitThreeFrame} frame
 * @param {THREE.Matrix4} target
 */
function resolveViewProjection(frame, target) {
  frame.camera.updateMatrixWorld?.();
  if ('matrixWorldInverse' in frame.camera && frame.camera.matrixWorldInverse) {
    frame.camera.matrixWorldInverse.copy(frame.camera.matrixWorld).invert();
    target.multiplyMatrices(frame.camera.projectionMatrix, frame.camera.matrixWorldInverse);
    return target;
  }
  target.identity();
  return target;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {SkykitViewState} view */
function cloneViewState(view) {
  return {
    ...view,
    observerPc: clonePoint(view.observerPc),
    renderObserverPosition: clonePoint(view.renderObserverPosition),
    ...(view.lookAt ? { lookAt: { ...view.lookAt } } : {}),
    ...(view.targetPc ? { targetPc: clonePoint(view.targetPc) } : {}),
    ...(view.motion
      ? {
          motion: {
            ...view.motion,
            velocityPcPerSec: clonePoint(view.motion.velocityPcPerSec),
          },
        }
      : {}),
  };
}

/** @param {{ x: number; y: number; z: number }} point */
function clonePoint(point) {
  return { x: point.x, y: point.y, z: point.z };
}

/** @param {{ x: number; y: number; z: number }} point */
function pointKey(point) {
  return `${point.x},${point.y},${point.z}`;
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function pointDistancePc(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * @param {unknown} renderer
 */
function canRenderToTexture(renderer) {
  return Boolean(renderer) &&
    typeof renderer === 'object' &&
    typeof /** @type {{ render?: unknown }} */ (renderer).render === 'function' &&
    typeof /** @type {{ setRenderTarget?: unknown }} */ (renderer).setRenderTarget === 'function' &&
    typeof /** @type {{ setViewport?: unknown }} */ (renderer).setViewport === 'function' &&
    typeof /** @type {{ setScissor?: unknown }} */ (renderer).setScissor === 'function' &&
    typeof /** @type {{ setScissorTest?: unknown }} */ (renderer).setScissorTest === 'function';
}
