import * as THREE from 'three';
import { createHrDiagramRenderer } from './index.js';

const DEFAULT_SOURCE_ID = 'hr-diagram.surface';
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 640;

/**
 * Create a structural touch-os embedded-surface node without taking a hard
 * package dependency on touch-os at runtime.
 *
 * @param {import('./touch-os.d.ts').HrDiagramEmbeddedSurfaceNodeOptions} options
 * @returns {import('./touch-os.d.ts').HrDiagramEmbeddedSurfaceNode}
 */
export function createHrDiagramEmbeddedSurfaceNode(options) {
  const componentId = options.componentId;
  const props = {
    sourceId: options.sourceId,
    ...(options.title ? { title: options.title } : {}),
    interactive: false,
    acceptsForwardedInput: false,
    preserveAspectRatio: options.preserveAspectRatio !== false,
    compositionMode: /** @type {const} */ ('composite'),
    fallbackLabel: options.fallbackLabel ?? 'HR diagram offline',
    desiredSourceType: /** @type {const} */ ('three-texture'),
  };

  return {
    id: componentId,
    component: EmbeddedHrSurfaceComponent,
    props,
  };
}

/**
 * @param {{
 *   sourceId?: string;
 *   width?: number;
 *   height?: number;
 *   rendererOptions?: import('./index.d.ts').HrDiagramRendererOptions;
 * }} [options]
 * @returns {import('./touch-os.d.ts').HrDiagramSurfaceSource}
 */
export function createHrDiagramSurfaceSource(options = {}) {
  const sourceId = options.sourceId ?? DEFAULT_SOURCE_ID;
  const width = Math.max(1, Math.floor(options.width ?? DEFAULT_WIDTH));
  const height = Math.max(1, Math.floor(options.height ?? DEFAULT_HEIGHT));
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const renderer = createHrDiagramRenderer({
    width,
    height,
    ...(options.rendererOptions ?? {}),
  });
  const handle = {
    kind: /** @type {const} */ ('three-texture'),
    texture: target.texture,
  };
  let disposed = false;
  let lastFrameTimestamp = 0;

  return {
    sourceId,
    handle,
    target,
    renderer,
    apply(delta) {
      assertActive();
      renderer.apply(delta);
    },
    setProducts(products) {
      assertActive();
      renderer.setProducts(products);
    },
    setView(view) {
      assertActive();
      renderer.setView(view);
    },
    render(threeRenderer, timestamp = 0) {
      assertActive();
      lastFrameTimestamp = timestamp;
      renderIntoTarget(threeRenderer, target, width, height, () => {
        renderer.render(threeRenderer);
      });
    },
    publish(surfaces, timestamp = lastFrameTimestamp) {
      assertActive();
      surfaces.publish(sourceId, {
        available: true,
        handle,
        sourceWidth: width,
        sourceHeight: height,
        lastFrameTimestamp: timestamp,
        refreshState: 'updating',
        sourceType: 'three-texture',
      });
    },
    unpublish(surfaces) {
      surfaces.unpublish(sourceId);
    },
    getSnapshot() {
      return {
        ...renderer.getSnapshot(),
        sourceId,
        width,
        height,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.dispose();
      target.dispose();
    },
  };

  function assertActive() {
    if (disposed) {
      throw new Error('HR diagram surface source is disposed.');
    }
  }
}

const EmbeddedHrSurfaceComponent = {
  kind: 'embedded-surface',
  mount(ctx) {
    ctx.services.surfaces.attach(ctx.id, createEmbeddedSurfaceConfig(ctx.props));
    return {};
  },
  update(ctx) {
    ctx.services.surfaces.configure(ctx.id, createEmbeddedSurfaceConfig(ctx.props));
  },
  measure(ctx) {
    return {
      width: ctx.constraints?.maxWidth ?? 320,
      height: 220,
    };
  },
  render(ctx) {
    const theme = ctx.services.theme.getTokens();
    const attachment = ctx.services.surfaces.getAttachment(ctx.id);
    const rect = ctx.bounds;
    const commands = [
      {
        type: 'rect',
        componentId: ctx.id,
        role: 'hr-diagram-embedded-frame',
        rect,
        fill: theme.surfaceColor,
        stroke: theme.borderColor,
        strokeWidth: 1,
        radius: theme.radius,
      },
    ];
    const viewportRect = {
      x: rect.x + theme.padding,
      y: rect.y + theme.padding,
      width: Math.max(0, rect.width - theme.padding * 2),
      height: Math.max(0, rect.height - theme.padding * 2),
    };

    if (attachment?.available) {
      commands.push({
        type: 'surface',
        componentId: ctx.id,
        role: 'hr-diagram-embedded-viewport',
        rect: viewportRect,
        handle: attachment.handle,
        sourceId: attachment.sourceId,
        surfaceRevision: attachment.surfaceRevision,
        compositionMode: attachment.compositionMode,
        mirrorX: attachment.mirrorX,
      });
    } else {
      commands.push({
        type: 'text',
        componentId: ctx.id,
        role: 'hr-diagram-embedded-placeholder',
        text: ctx.props.fallbackLabel ?? 'HR diagram offline',
        rect: viewportRect,
        color: theme.mutedTextColor,
        align: 'center',
        verticalAlign: 'middle',
        fontSize: theme.typography.fontSize,
        fontWeight: theme.typography.fontWeight,
      });
    }

    return commands;
  },
  dispose(ctx) {
    ctx.services.surfaces.release(ctx.id);
  },
};

/**
 * @param {object} props
 */
function createEmbeddedSurfaceConfig(props) {
  return {
    sourceId: props.sourceId,
    interactive: false,
    preserveAspectRatio: props.preserveAspectRatio !== false,
    acceptsForwardedInput: false,
    desiredSourceType: 'three-texture',
    compositionMode: 'composite',
    fallbackLabel: props.fallbackLabel ?? 'HR diagram offline',
  };
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.WebGLRenderTarget} target
 * @param {number} width
 * @param {number} height
 * @param {() => void} callback
 */
function renderIntoTarget(renderer, target, width, height, callback) {
  const previousTarget = renderer.getRenderTarget?.() ?? null;
  const previousViewport = renderer.getViewport?.(new THREE.Vector4());
  const previousScissor = renderer.getScissor?.(new THREE.Vector4());
  const previousScissorTest = renderer.getScissorTest?.() ?? false;
  const previousXrEnabled = renderer.xr?.enabled;

  if (renderer.xr) {
    renderer.xr.enabled = false;
  }
  renderer.setRenderTarget(target);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissor(0, 0, width, height);
  renderer.setScissorTest(false);
  try {
    callback();
  } finally {
    renderer.setRenderTarget(previousTarget);
    if (previousViewport) renderer.setViewport(previousViewport);
    if (previousScissor) renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    if (renderer.xr && previousXrEnabled !== undefined) {
      renderer.xr.enabled = previousXrEnabled;
    }
  }
}
