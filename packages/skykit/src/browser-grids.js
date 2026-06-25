import { createSkykitCoordinateGridLayer } from './coordinate-grid-layer.js';
import { createSkykitLayerHostPlugin } from './layer-host.js';

const COORDINATE_GRIDS_CAPABILITY = 'skykit:browser.coordinate-grids';
const DEFAULT_GRIDS = Object.freeze(['equatorial', 'galactic']);

/**
 * @param {{
 *   browser: import('./browser.d.ts').SkykitBrowser;
 *   host?: unknown;
 *   options?: import('./browser.d.ts').SkykitBrowserCoordinateGridsOptions;
 * }} context
 * @returns {Promise<import('./browser.d.ts').SkykitBrowserCoordinateGridsFacade>}
 */
export async function installSkykitCoordinateGridsBrowserCapability({ browser, host, options = {} }) {
  const settings = normalizeCoordinateGridOptions(host, options);
  const publishMetadata = settings.publish && typeof settings.publish === 'object'
    ? settings.publish.metadata
    : undefined;
  const records = settings.grids.map((grid, index) => {
    const products = settings.publish === false
      ? []
      : [
          `features:grids/${grid}`,
          `waypoints:grids/${grid}`,
        ];
    return {
      products,
      layer: createSkykitCoordinateGridLayer({
        id: `browser-coordinate-grid:${grid}`,
        system: grid,
        visible: settings.visible,
        radiusPc: settings.radiusPc,
        priority: settings.priority == null ? undefined : settings.priority + index,
        publish: settings.publish === false
          ? false
          : {
              features: products[0],
              waypoints: products[1],
              metadata: {
                label: `${grid} coordinate grid`,
                tags: ['browser', 'coordinate-grid', grid],
                ...(publishMetadata ?? {}),
              },
            },
      }),
    };
  });
  const layers = records.map((record) => record.layer);
  const hostPlugin = createSkykitLayerHostPlugin({
    id: 'browser-coordinate-grids-host',
    layers,
  });
  const teardown = layers.length > 0
    ? await browser.install(hostPlugin)
    : () => {};

  if (layers.length > 0) browser.capabilities.add(COORDINATE_GRIDS_CAPABILITY);

  /** @type {import('./browser.d.ts').SkykitBrowserCoordinateGridsFacade} */
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
        capability: COORDINATE_GRIDS_CAPABILITY,
        gridCount: layers.length,
        grids: layers.map((layer) => layer.getSnapshot()),
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
 * @param {import('./browser.d.ts').SkykitBrowserCoordinateGridsOptions} options
 * @returns {{
 *   grids: string[];
 *   visible?: boolean;
 *   priority?: number;
 *   radiusPc?: number;
 *   publish?: false | { metadata?: import('./index.d.ts').SkykitProductMetadata };
 * }}
 */
function normalizeCoordinateGridOptions(host, options) {
  const data = host && typeof host === 'object' && 'dataset' in host
    ? /** @type {{ dataset?: Record<string, string | undefined> }} */ (host).dataset ?? {}
    : {};
  return {
    ...options,
    grids: normalizeGridList(options.grids ?? data.skykitGrids ?? DEFAULT_GRIDS),
  };
}

/**
 * @param {unknown} input
 * @returns {string[]}
 */
function normalizeGridList(input) {
  const values = typeof input === 'string'
    ? input.split(',')
    : isIterable(input)
      ? Array.from(input)
      : [input];
  const explicitDisabled = values.some(isDisabledGridRequest);
  /** @type {string[]} */
  const grids = [];
  for (const value of values) {
    const grid = cleanGridId(value);
    if (!grid || grids.includes(grid)) continue;
    grids.push(grid);
  }
  if (grids.length > 0) return grids;
  return explicitDisabled ? [] : [...DEFAULT_GRIDS];
}

/** @param {unknown} value */
function cleanGridId(value) {
  const grid = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!grid || grid === 'off' || grid === 'false' || grid === 'none' || grid === '0') return null;
  return grid.replace(/[^a-z0-9_.:-]+/g, '-');
}

/** @param {unknown} value */
function isDisabledGridRequest(value) {
  const grid = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return grid === 'off' || grid === 'false' || grid === 'none' || grid === '0';
}

/**
 * @param {unknown} value
 * @returns {value is Iterable<unknown>}
 */
function isIterable(value) {
  return Boolean(value) && typeof /** @type {{ [Symbol.iterator]?: unknown }} */ (value)[Symbol.iterator] === 'function';
}

/**
 * @param {import('./index.d.ts').SkykitCoordinateGridLayer[]} layers
 * @param {boolean} visible
 */
function setVisible(layers, visible) {
  for (const layer of layers) {
    visible ? layer.show() : layer.hide();
  }
  return visible;
}
