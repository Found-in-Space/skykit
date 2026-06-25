import { createSkykitCoordinateFrameMarkerLayer } from './coordinate-frame-markers.js';
import { createSkykitLayerHostPlugin } from './layer-host.js';

const COORDINATE_FRAMES_CAPABILITY = 'skykit:browser.coordinate-frames';
const DEFAULT_FRAMES = Object.freeze(['galactic']);

/**
 * @param {{
 *   browser: import('./browser.d.ts').SkykitBrowser;
 *   host?: unknown;
 *   options?: import('./browser.d.ts').SkykitBrowserCoordinateFramesOptions;
 * }} context
 * @returns {Promise<import('./browser.d.ts').SkykitBrowserCoordinateFramesFacade>}
 */
export async function installSkykitCoordinateFramesBrowserCapability({ browser, host, options = {} }) {
  const settings = normalizeCoordinateFrameOptions(host, options);
  const publishMetadata = settings.publish && typeof settings.publish === 'object'
    ? settings.publish.metadata
    : undefined;
  const records = settings.frames.map((frame, index) => {
    const products = settings.publish === false
      ? []
      : [
          `features:frames/${frame}`,
          `waypoints:frames/${frame}`,
        ];
    return {
      products,
      layer: createSkykitCoordinateFrameMarkerLayer({
        id: `browser-coordinate-frame:${frame}`,
        frame,
        visible: settings.visible,
        radiusPc: settings.radiusPc,
        priority: settings.priority == null ? undefined : settings.priority + index,
        publish: settings.publish === false
          ? false
          : {
              features: products[0],
              waypoints: products[1],
              metadata: {
                label: `${frame} coordinate frame`,
                tags: ['browser', 'coordinate-frame', frame],
                ...(publishMetadata ?? {}),
              },
            },
      }),
    };
  });
  const layers = records.map((record) => record.layer);
  const hostPlugin = createSkykitLayerHostPlugin({
    id: 'browser-coordinate-frames-host',
    layers,
  });
  const teardown = layers.length > 0
    ? await browser.install(hostPlugin)
    : () => {};

  if (layers.length > 0) browser.capabilities.add(COORDINATE_FRAMES_CAPABILITY);

  /** @type {import('./browser.d.ts').SkykitBrowserCoordinateFramesFacade} */
  const handle = {
    async load() {
      return handle;
    },
    show() {
      return setVisible(layers, true);
    },
    hide() {
      return setVisible(layers, false);
    },
    toggle(force) {
      const nextVisible = typeof force === 'boolean'
        ? force
        : !layers.every((layer) => layer.getSnapshot().visible);
      return setVisible(layers, nextVisible);
    },
    getSnapshot() {
      return {
        capability: COORDINATE_FRAMES_CAPABILITY,
        frameCount: layers.length,
        frames: layers.map((layer) => layer.getSnapshot()),
        products: records.flatMap((record) => record.products),
      };
    },
    dispose() {
      teardown();
    },
  };
  return handle;
}

/**
 * @param {unknown} host
 * @param {import('./browser.d.ts').SkykitBrowserCoordinateFramesOptions} options
 * @returns {{
 *   frames: string[];
 *   visible?: boolean;
 *   priority?: number;
 *   radiusPc?: number;
 *   publish?: false | { metadata?: import('./index.d.ts').SkykitProductMetadata };
 * }}
 */
function normalizeCoordinateFrameOptions(host, options) {
  const data = host && typeof host === 'object' && 'dataset' in host
    ? /** @type {{ dataset?: Record<string, string | undefined> }} */ (host).dataset ?? {}
    : {};
  return {
    ...options,
    frames: normalizeFrameList(options.frames ?? data.skykitFrames ?? DEFAULT_FRAMES),
  };
}

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function normalizeFrameList(input) {
  const values = typeof input === 'string'
    ? input.split(',')
    : isIterable(input)
      ? Array.from(input)
      : [input];
  const explicitDisabled = values.some(isDisabledFrameRequest);
  /** @type {string[]} */
  const frames = [];
  for (const value of values) {
    const frame = cleanFrameId(value);
    if (!frame || frames.includes(frame)) continue;
    frames.push(frame);
  }
  if (frames.length > 0) return frames;
  return explicitDisabled ? [] : [...DEFAULT_FRAMES];
}

/** @param {unknown} value */
function cleanFrameId(value) {
  const frame = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!frame || frame === 'off' || frame === 'false' || frame === 'none' || frame === '0') return null;
  return frame.replace(/[^a-z0-9_.:-]+/g, '-');
}

/** @param {unknown} value */
function isDisabledFrameRequest(value) {
  const frame = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return frame === 'off' || frame === 'false' || frame === 'none' || frame === '0';
}

/**
 * @param {unknown} value
 * @returns {value is Iterable<unknown>}
 */
function isIterable(value) {
  return Boolean(value) && typeof /** @type {{ [Symbol.iterator]?: unknown }} */ (value)[Symbol.iterator] === 'function';
}

/**
 * @param {import('./index.d.ts').SkykitCoordinateFrameMarkerLayer[]} layers
 * @param {boolean} visible
 */
function setVisible(layers, visible) {
  for (const layer of layers) {
    visible ? layer.show() : layer.hide();
  }
  return visible;
}
