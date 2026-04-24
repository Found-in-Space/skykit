/**
 * Viewer runtime part that owns one or more Touch OS panels inside a SkyKit
 * demo. Demos provide Touch OS runtimes, drivers, and frame resolvers
 * explicitly rather than routing through a second UI abstraction.
 */

function blockEvent(event) {
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

function createSurfaceMetrics(context) {
  const width = context?.size?.width ?? context?.canvas?.width ?? 320;
  const height = context?.size?.height ?? context?.canvas?.height ?? 240;
  const pixelDensity = globalThis.window?.devicePixelRatio ?? 1;
  return {
    width,
    height,
    pixelDensity,
  };
}

function normalizePointerType(pointerType) {
  switch (pointerType) {
    case 'touch':
    case 'pen':
    case 'mouse':
      return pointerType;
    default:
      return 'mouse';
  }
}

function toScreenSample(event, phase, target) {
  const rect = target.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) {
    return null;
  }

  return {
    pointerId: `screen-${event.pointerId ?? 0}`,
    pointerType: normalizePointerType(event.pointerType),
    transport: 'screen',
    phase,
    timestamp: event.timeStamp,
    ndcX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    ndcY: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
  };
}

function flushPanelOutputs(panel, context, onOutput) {
  if (typeof onOutput !== 'function') {
    panel.runtime.takeOutputs();
    return;
  }

  for (const output of panel.runtime.takeOutputs()) {
    onOutput(output, panel, context);
  }
}

function buildPanelState(descriptor) {
  return {
    ...descriptor,
    enabled: false,
    latestFrame: null,
  };
}

export function createTouchOsRuntimePart(options = {}) {
  const panelStates = (options.panels ?? []).map(buildPanelState);
  const getXrSamples = typeof options.getXrSamples === 'function'
    ? options.getXrSamples
    : null;

  let latestContext = null;
  let pointerTarget = null;
  let unbindPointerEvents = null;
  let suppressClick = false;

  function resolvePanelFrame(panel, context) {
    if (typeof panel.getFrame === 'function') {
      return panel.getFrame(context);
    }

    return {
      scene: context.scene,
      camera: context.camera,
      surfaceMetrics: createSurfaceMetrics(context),
    };
  }

  function routeSample(kind, sample, context) {
    let ownerKey;
    let blocked = false;
    const panels = kind === 'xr'
      ? panelStates.filter((panel) => panel.xr !== false)
      : panelStates.filter((panel) => panel.desktop !== false);

    for (const [index, panel] of panels.entries()) {
      if (!panel.enabled) {
        panel.driver.clearPointer(sample.pointerId);
        continue;
      }

      if (ownerKey) {
        panel.driver.clearPointer(sample.pointerId);
        continue;
      }

      const frame = panel.latestFrame ?? resolvePanelFrame(panel, context);
      const result = panel.driver.interactor.process(sample, frame);
      flushPanelOutputs(panel, context, options.onOutput);
      if (!result.claimed && !result.blocked) {
        continue;
      }

      ownerKey = panel.key;
      blocked = result.blocked;
      for (const lowerPanel of panels.slice(index + 1)) {
        lowerPanel.driver.clearPointer(sample.pointerId);
      }
      break;
    }

    return {
      ownerKey,
      blocked,
    };
  }

  function onPointerEvent(event, phase) {
    if (!latestContext || latestContext.xr?.presenting === true || !pointerTarget) {
      return;
    }

    const sample = toScreenSample(event, phase, pointerTarget);
    if (!sample) {
      return;
    }

    const routing = routeSample('desktop', sample, latestContext);
    if (routing.ownerKey || routing.blocked) {
      suppressClick = true;
      blockEvent(event);
    }
  }

  function bindDesktopPointerEvents(target) {
    if (!target?.addEventListener) {
      return;
    }

    const handlers = {
      pointerdown: (event) => onPointerEvent(event, 'down'),
      pointermove: (event) => onPointerEvent(event, 'move'),
      pointerup: (event) => onPointerEvent(event, 'up'),
      pointercancel: (event) => onPointerEvent(event, 'cancel'),
      pointerleave: (event) => onPointerEvent(event, 'cancel'),
      click(event) {
        if (!suppressClick) {
          return;
        }
        suppressClick = false;
        blockEvent(event);
      },
    };

    target.addEventListener('pointerdown', handlers.pointerdown, true);
    target.addEventListener('pointermove', handlers.pointermove, true);
    target.addEventListener('pointerup', handlers.pointerup, true);
    target.addEventListener('pointercancel', handlers.pointercancel, true);
    target.addEventListener('pointerleave', handlers.pointerleave, true);
    target.addEventListener('click', handlers.click, true);

    unbindPointerEvents = () => {
      target.removeEventListener('pointerdown', handlers.pointerdown, true);
      target.removeEventListener('pointermove', handlers.pointermove, true);
      target.removeEventListener('pointerup', handlers.pointerup, true);
      target.removeEventListener('pointercancel', handlers.pointercancel, true);
      target.removeEventListener('pointerleave', handlers.pointerleave, true);
      target.removeEventListener('click', handlers.click, true);
      unbindPointerEvents = null;
    };
  }

  function hidePanel(panel) {
    panel.driver.clearPointer();
    panel.driver.host.mesh.visible = false;
    panel.enabled = false;
    panel.latestFrame = null;
  }

  return {
    id: options.id ?? 'touch-os-runtime-part',

    getPanel(key) {
      return panelStates.find((panel) => panel.key === key) ?? null;
    },

    getPanelHit(key) {
      return this.getPanel(key)?.driver?.getHit?.() ?? null;
    },

    attach(context) {
      latestContext = context;
      pointerTarget = typeof options.getPointerTarget === 'function'
        ? options.getPointerTarget(context)
        : context.canvas;

      for (const panel of panelStates) {
        panel.driver.attach();
      }

      bindDesktopPointerEvents(pointerTarget);
    },

    update(context) {
      latestContext = context;

      for (const panel of panelStates) {
        if (typeof panel.sync === 'function') {
          panel.sync(context, panel);
        }

        const enabled = typeof panel.isEnabled === 'function'
          ? Boolean(panel.isEnabled(context))
          : true;

        if (!enabled) {
          hidePanel(panel);
          continue;
        }

        panel.enabled = true;
        panel.latestFrame = resolvePanelFrame(panel, context);
        panel.driver.host.update(panel.latestFrame);
      }

      if (context.xr?.presenting === true && getXrSamples) {
        const samples = getXrSamples(context) ?? [];
        for (const sample of samples) {
          routeSample('xr', sample, context);
        }
      }

      const timestamp = context.frame?.timeMs ?? performance.now();
      for (const panel of panelStates) {
        if (!panel.enabled) {
          continue;
        }

        panel.runtime.tick(timestamp);
        flushPanelOutputs(panel, context, options.onOutput);
        panel.driver.render();
        flushPanelOutputs(panel, context, options.onOutput);
      }
    },

    dispose() {
      unbindPointerEvents?.();
      pointerTarget = null;
      latestContext = null;
      suppressClick = false;

      for (const panel of panelStates) {
        try {
          panel.driver.detach();
        } finally {
          panel.runtime.dispose();
          panel.enabled = false;
          panel.latestFrame = null;
        }
      }
    },
  };
}
