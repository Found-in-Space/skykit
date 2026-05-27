import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  createObserverShellStrategy,
  createSphereVolumeStrategy,
  createStarCellKey,
  decodeTemperatureK,
  temperatureToRgb,
} from '@found-in-space/star-trees';
import {
  createMetaSidecarProviderService,
  deriveMetaSidecarUrlFromRenderUrl,
  metaSidecarEntryDisplayFields,
} from '@found-in-space/meta-sidecar-provider';

const DEFAULT_CENTER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_STAR_ATTRIBUTES = Object.freeze(['position', 'magAbs', 'teffLog8', 'objectRef']);

export {
  OCTREE_DEFAULT,
  createMetaSidecarProviderService,
  createObserverShellStrategy,
  createSphereVolumeStrategy,
  createStarCellKey,
  createStarOctreeProviderService,
  decodeTemperatureK,
  deriveMetaSidecarUrlFromRenderUrl,
  metaSidecarEntryDisplayFields,
  temperatureToRgb,
};

/**
 * Alias for the row-batch stream used by beginner examples.
 *
 * @param {import('./data.d.ts').SkykitStarDataOptions} [options]
 * @returns {AsyncIterable<import('./data.d.ts').SkykitStarRow[]>}
 */
export function createStarStream(options = {}) {
  return streamStarRows(options);
}

/**
 * Load star rows for a list, map, game, or custom renderer.
 *
 * @param {import('./data.d.ts').SkykitStarDataOptions} [options]
 * @returns {Promise<import('./data.d.ts').SkykitStarRow[]>}
 */
export async function loadStarRows(options = {}) {
  /** @type {import('./data.d.ts').SkykitStarRow[]} */
  const rows = [];
  for await (const batch of streamStarRows({
    ...options,
    maxStars: undefined,
    sortBy: null,
  })) {
    rows.push(...batch);
  }
  return selectRows(rows, options);
}

/**
 * Stream star rows as plain JavaScript batches. The stream completes when the
 * provider reports that the requested current cell set is loaded.
 *
 * @param {import('./data.d.ts').SkykitStarDataOptions} [options]
 * @returns {AsyncIterable<import('./data.d.ts').SkykitStarRow[]>}
 */
export async function* streamStarRows(options = {}) {
  const { provider, disposeProvider } = createProvider(options);
  const observerPc = resolveObserverPc(options);
  const filterVisible = options.filterVisible !== false;

  try {
    for await (const delta of provider.streamCells(createCellStreamOptions(options, observerPc))) {
      if (delta.type === 'stars/cells-upsert') {
        const rows = rowsFromStarCells(delta.cells, {
          observerPc,
          limitingMagnitude: options.limitingMagnitude,
          filterVisible,
        });
        if (rows.length > 0) yield rows;
      }
      if (delta.type === 'stars/error') {
        throw new Error(delta.error?.message ?? 'SkyKit star stream failed.');
      }
      if (delta.type === 'stars/current') {
        break;
      }
    }
  } finally {
    if (disposeProvider) await provider.dispose?.();
  }
}

/**
 * Convert provider star cells into plain rows without owning any renderer.
 *
 * @param {Iterable<import('@found-in-space/star-trees').StarCellData>} cells
 * @param {import('./data.d.ts').SkykitRowsFromCellsOptions} [options]
 * @returns {import('./data.d.ts').SkykitStarRow[]}
 */
export function rowsFromStarCells(cells, options = {}) {
  /** @type {import('./data.d.ts').SkykitStarRow[]} */
  const rows = [];
  const observerPc = normalizePoint(options.observerPc, DEFAULT_CENTER_PC);
  const limitingMagnitude = finiteNumber(options.limitingMagnitude, Number.POSITIVE_INFINITY);
  const filterVisible = options.filterVisible === true;

  for (const cell of cells) {
    rows.push(...rowsFromStarCell(cell, { observerPc, limitingMagnitude, filterVisible }));
  }
  return rows;
}

/**
 * Load display labels for rows or refs from the metadata sidecar.
 *
 * @param {Iterable<import('./data.d.ts').SkykitStarLabelInput> | import('./data.d.ts').SkykitStarDataOptions} input
 * @param {import('./data.d.ts').SkykitStarLabelOptions} [options]
 * @returns {Promise<import('./data.d.ts').SkykitStarLabel[]>}
 */
export async function loadStarLabels(input, options = {}) {
  const stars = isIterable(input)
    ? Array.from(input)
    : await loadStarRows(/** @type {import('./data.d.ts').SkykitStarDataOptions} */ (input ?? {}));
  const refs = stars.map(resolveStarRef);
  const { metaProvider, disposeMetaProvider } = await createLabelProvider(refs, {
    ...options,
    provider: options.provider ?? (!isIterable(input) ? input?.provider : undefined),
    octreeUrl: options.octreeUrl ?? (!isIterable(input) ? input?.octreeUrl : undefined),
  });

  try {
    return await Promise.all(stars.map(async (star, index) => {
      const ref = refs[index] ?? null;
      const entry = ref ? await metaProvider.getMeta(ref) : null;
      const fallback = ref ? formatStarRef(ref) : 'Unnamed star';
      const fields = metaSidecarEntryDisplayFields(entry);
      return {
        star,
        ref,
        entry,
        fields,
        label: fields.primaryLabel || formatStarLabel(entry, fallback),
      };
    }));
  } finally {
    if (disposeMetaProvider) metaProvider.dispose?.();
  }
}

/**
 * @param {import('@found-in-space/meta-sidecar-provider').MetaSidecarEntry | null | undefined} entry
 * @param {string} [fallback]
 * @returns {string}
 */
export function formatStarLabel(entry, fallback = 'Unnamed star') {
  const fields = metaSidecarEntryDisplayFields(entry);
  return fields.primaryLabel || fields.properName || fields.bayer || fields.hd || fields.hip || fields.gaia || fallback;
}

/**
 * @param {import('@found-in-space/star-trees').StarCellData} cell
 * @param {{
 *   observerPc: { x: number; y: number; z: number };
 *   limitingMagnitude: number;
 *   filterVisible: boolean;
 * }} options
 * @returns {import('./data.d.ts').SkykitStarRow[]}
 */
function rowsFromStarCell(cell, options) {
  const positions = cell.coordinates?.components;
  if (!positions) return [];
  const magAbs = cell.attributes?.magAbs ?? null;
  const teffLog8 = cell.attributes?.teffLog8 ?? null;
  const refs = cell.refs ?? [];
  /** @type {import('./data.d.ts').SkykitStarRow[]} */
  const rows = [];

  for (let index = 0; index < cell.count; index += 1) {
    const positionPc = {
      x: positions[index * 3],
      y: positions[index * 3 + 1],
      z: positions[index * 3 + 2],
    };
    const distancePc = distanceBetween(positionPc, options.observerPc);
    const absoluteMagnitude = magAbs?.[index] ?? null;
    const apparentMagnitude = absoluteMagnitude == null
      ? null
      : apparentMagnitudeFromAbsolute(absoluteMagnitude, distancePc);
    if (
      options.filterVisible &&
      apparentMagnitude != null &&
      apparentMagnitude > options.limitingMagnitude
    ) {
      continue;
    }
    const temperatureByte = teffLog8?.[index] ?? null;
    const ref = refs[index] ?? null;
    rows.push({
      ref,
      cellKey: cell.cellKey ?? createStarCellKey(cell.cell),
      level: cell.cell?.level ?? ref?.level ?? 0,
      mortonCode: cell.cell?.mortonCode ?? ref?.mortonCode ?? '',
      ordinal: ref?.ordinal ?? index,
      positionPc,
      xPc: positionPc.x,
      yPc: positionPc.y,
      zPc: positionPc.z,
      distancePc,
      magAbs: absoluteMagnitude,
      absoluteMagnitude,
      apparentMagnitude,
      teffLog8: temperatureByte,
      temperatureK: temperatureByte == null ? null : decodeTemperatureK(temperatureByte),
    });
  }

  return rows;
}

/**
 * @param {import('./data.d.ts').SkykitStarDataOptions} options
 * @param {{ x: number; y: number; z: number }} observerPc
 * @returns {import('@found-in-space/star-octree-provider').StarOctreeCellStreamOptions}
 */
function createCellStreamOptions(options, observerPc) {
  const centerPc = normalizePoint(options.centerPc, observerPc);
  const limitingMagnitude = finiteNumber(options.limitingMagnitude, DEFAULT_LIMITING_MAGNITUDE);
  const strategy = options.strategy ?? (
    positiveNumber(options.radiusPc, 0) > 0
      ? createSphereVolumeStrategy({
        centerPc,
        radiusPc: Number(options.radiusPc),
      })
      : createObserverShellStrategy()
  );
  return {
    id: options.id,
    sessionId: options.sessionId,
    strategy,
    view: {
      observerPc,
      limitingMagnitude,
      ...(options.view ?? {}),
    },
    viewRevision: options.viewRevision,
    demandRevision: options.demandRevision,
    attributes: Array.from(options.attributes ?? DEFAULT_STAR_ATTRIBUTES),
    coordinates: options.coordinates,
    streaming: options.streaming,
    memory: options.memory,
    cache: options.cache,
    signal: options.signal,
  };
}

/**
 * @param {import('./data.d.ts').SkykitStarDataOptions} options
 */
function createProvider(options) {
  if (options.provider) {
    return { provider: options.provider, disposeProvider: false };
  }
  return {
    provider: createStarOctreeProviderService({
      id: options.providerId,
      url: options.octreeUrl ?? OCTREE_DEFAULT,
      persistentCache: options.persistentCache,
      limits: options.limits,
    }),
    disposeProvider: true,
  };
}

/**
 * @param {Array<import('@found-in-space/star-trees').StarObjectRef | null | undefined>} refs
 * @param {import('./data.d.ts').SkykitStarLabelOptions & {
 *   provider?: import('@found-in-space/star-octree-provider').StarOctreeProviderService;
 *   octreeUrl?: string;
 * }} options
 */
async function createLabelProvider(refs, options) {
  if (options.metaProvider) {
    return { metaProvider: options.metaProvider, disposeMetaProvider: false };
  }
  const parentDatasetId = options.parentDatasetId
    ?? options.datasetId
    ?? refs.find((ref) => ref?.datasetId)?.datasetId
    ?? await resolveDatasetId(options);
  if (!parentDatasetId) {
    throw new Error('loadStarLabels() needs a dataset id. Pass rows from loadStarRows(), parentDatasetId, or a provider.');
  }
  return {
    metaProvider: createMetaSidecarProviderService({
      id: options.metaProviderId,
      parentDatasetId,
      url: options.metaUrl ?? deriveMetaSidecarUrlFromRenderUrl(options.octreeUrl ?? OCTREE_DEFAULT),
      persistentCache: options.persistentCache,
      limits: options.metaLimits,
    }),
    disposeMetaProvider: true,
  };
}

/**
 * @param {{ provider?: import('@found-in-space/star-octree-provider').StarOctreeProviderService; octreeUrl?: string }} options
 */
async function resolveDatasetId(options) {
  if (options.provider) {
    const bootstrap = await options.provider.ensureBootstrap?.();
    return bootstrap?.datasetId ?? options.provider.describe?.().datasetId ?? null;
  }
  const provider = createStarOctreeProviderService({
    url: options.octreeUrl ?? OCTREE_DEFAULT,
  });
  try {
    const bootstrap = await provider.ensureBootstrap();
    return bootstrap.datasetId ?? provider.describe().datasetId ?? null;
  } finally {
    await provider.dispose?.();
  }
}

/**
 * @param {import('./data.d.ts').SkykitStarRow[]} rows
 * @param {import('./data.d.ts').SkykitStarDataOptions} options
 */
function selectRows(rows, options) {
  const selected = rows.slice();
  const sortBy = options.sortBy === undefined ? 'apparentMagnitude' : options.sortBy;
  if (typeof sortBy === 'function') {
    selected.sort(sortBy);
  } else if (sortBy === 'apparentMagnitude') {
    selected.sort(nullableNumberSort('apparentMagnitude'));
  } else if (sortBy === 'distancePc') {
    selected.sort(nullableNumberSort('distancePc'));
  } else if (sortBy === 'magAbs' || sortBy === 'absoluteMagnitude') {
    selected.sort(nullableNumberSort('absoluteMagnitude'));
  }

  const maxStars = positiveInteger(options.maxStars, 0);
  return maxStars > 0 ? selected.slice(0, maxStars) : selected;
}

/**
 * @param {'apparentMagnitude' | 'distancePc' | 'absoluteMagnitude'} key
 */
function nullableNumberSort(key) {
  /**
   * @param {import('./data.d.ts').SkykitStarRow} left
   * @param {import('./data.d.ts').SkykitStarRow} right
   */
  return (left, right) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    return leftValue - rightValue;
  };
}

/**
 * @param {unknown} value
 * @returns {import('@found-in-space/star-trees').StarObjectRef | null}
 */
function resolveStarRef(value) {
  if (!value || typeof value !== 'object') return null;
  const candidate = /** @type {{ ref?: unknown; level?: unknown; mortonCode?: unknown; ordinal?: unknown; datasetId?: unknown }} */ (value);
  if (candidate.ref) return resolveStarRef(candidate.ref);
  if (
    Number.isInteger(candidate.level) &&
    typeof candidate.mortonCode === 'string' &&
    Number.isInteger(candidate.ordinal)
  ) {
    return {
      datasetId: typeof candidate.datasetId === 'string' ? candidate.datasetId : null,
      level: candidate.level,
      mortonCode: candidate.mortonCode,
      ordinal: candidate.ordinal,
    };
  }
  return null;
}

/**
 * @param {import('@found-in-space/star-trees').StarObjectRef} ref
 */
function formatStarRef(ref) {
  return `${ref.datasetId ?? 'dataset'}:${ref.level}:${ref.mortonCode}:${ref.ordinal}`;
}

/**
 * @param {import('./data.d.ts').SkykitStarDataOptions} options
 */
function resolveObserverPc(options) {
  return normalizePoint(options.observerPc ?? options.centerPc, DEFAULT_CENTER_PC);
}

/**
 * @param {unknown} point
 * @param {{ x: number; y: number; z: number }} fallback
 */
function normalizePoint(point, fallback) {
  if (!point || typeof point !== 'object') return { ...fallback };
  const candidate = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (point);
  return {
    x: finiteNumber(candidate.x, fallback.x),
    y: finiteNumber(candidate.y, fallback.y),
    z: finiteNumber(candidate.z, fallback.z),
  };
}

function apparentMagnitudeFromAbsolute(magAbs, distancePc) {
  return magAbs + 5 * (Math.log10(Math.max(distancePc, 1e-6)) - 1);
}

function distanceBetween(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * @param {unknown} value
 * @returns {value is Iterable<unknown>}
 */
function isIterable(value) {
  return Boolean(value && typeof value === 'object' && Symbol.iterator in value);
}
