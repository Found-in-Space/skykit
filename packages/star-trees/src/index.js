export const ERR_STAR_CELLS_TRANSFER_UNAVAILABLE =
  'ERR_STAR_CELLS_TRANSFER_UNAVAILABLE';

export {
  ERR_STAR_TREE_INVALID_VIEW,
  buildTravelVolumeRequests,
  combineStarTreeStrategies,
  createFrustumTester,
  createObserverShellStrategy,
  createPathDistanceEvaluator,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createStarTreeStrategyEvaluator,
  createStrategyForVolumeRequest,
  createTargetFrustumStrategy,
  distancePointToPathPc,
  distanceToCellAabbPc,
  evaluateStarTreeDemandGate,
  loadRadiusForMagnitudeShell,
  normalizeObserverShellView,
  normalizeStarTreeDemandThresholds,
  normalizeStarTreeStrategyView,
  normalizeTargetFrustumView,
  quaternionToCameraBasis,
  resolveMotionLookahead,
  withMotionLookahead,
} from './star-tree-strategies.js';

const DEFAULT_COORDINATE_OUTPUT = {
  name: 'position',
  frame: 'icrs',
  units: /** @type {[string, string, string]} */ (['pc', 'pc', 'pc']),
};
const MAX_MORTON_LEVEL = 21;

/** @type {boolean | null} */
let transferableSupport = null;

/**
 * Build one decoded, render-ready star cell.
 *
 * @template Node
 * @param {import('./index.d.ts').CreateStarCellDataOptions<Node>} options
 * @returns {import('./index.d.ts').StarCellData}
 */
export function createStarCellData(options) {
  const attributes = options.attributes ?? ['position', 'teffLog8', 'magAbs'];
  const coordinates = normalizeCoordinates(options.coordinates);
  const includeTeffLog8 = attributes.includes('teffLog8');
  const includeMagAbs = attributes.includes('magAbs');
  const includePickMeta = attributes.includes('pickMeta');
  const includeRefs = attributes.includes('objectRef');
  const { node, decoded } = options;
  const memoryOwnership = options.memoryOwnership ?? 'borrowed';
  const mortonCode = resolveNodeMortonCode(node);
  const cellKey = createStarCellKey(node.level, mortonCode);
  const canBorrowPositions =
    memoryOwnership === 'borrowed' &&
    !coordinates.transformPosition &&
    decoded.positionsPc.length === decoded.count * 3;
  const positions = canBorrowPositions
    ? decoded.positionsPc
    : new Float32Array(decoded.count * 3);
  const teffLog8 = includeTeffLog8
    ? createCellTeffLog8Array(decoded.teffLog8, decoded.count, memoryOwnership)
    : null;
  const magAbs = includeMagAbs
    ? createCellMagAbsArray(decoded.magAbs, decoded.count, memoryOwnership)
    : null;
  /** @type {import('./index.d.ts').StarObjectRef[] | undefined} */
  let refs;
  /** @type {import('./index.d.ts').StarPickMeta[] | undefined} */
  const pickMeta = includePickMeta ? [] : undefined;

  if (!canBorrowPositions) {
    writePositions({
      output: positions,
      node,
      decoded,
      coordinates,
    });
  }

  if (includeRefs) {
    refs = [];
    if (decoded.refs?.length === decoded.count) {
      refs.push(...decoded.refs.map((ref, ordinal) => normalizeStarObjectRef(ref, {
        datasetId: options.datasetId,
        level: node.level,
        mortonCode,
        ordinal,
      })));
    } else {
      for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
        refs.push({
          datasetId: options.datasetId ?? null,
          level: node.level,
          mortonCode,
          ordinal,
        });
      }
    }
  }

  if (pickMeta) {
    for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
      pickMeta.push({
        cellKey,
        level: node.level,
        mortonCode,
        ordinal,
        gridX: node.gridX,
        gridY: node.gridY,
        gridZ: node.gridZ,
        centerX: node.centerX,
        centerY: node.centerY,
        centerZ: node.centerZ,
      });
    }
  }

  /** @type {import('./index.d.ts').StarCellData} */
  const cell = {
    cellKey,
    cell: {
      level: node.level,
      mortonCode,
    },
    bounds: {
      centerPc: {
        x: node.centerX,
        y: node.centerY,
        z: node.centerZ,
      },
      halfSizePc: node.halfSize,
      gridX: node.gridX,
      gridY: node.gridY,
      gridZ: node.gridZ,
    },
    count: decoded.count,
    coordinates: {
      name: coordinates.name,
      frame: coordinates.frame,
      units: coordinates.units,
      components: positions,
    },
    attributes: {
      ...(teffLog8 ? { teffLog8 } : {}),
      ...(magAbs ? { magAbs } : {}),
    },
    ...(refs ? { refs } : {}),
    ...(pickMeta ? { pickMeta } : {}),
  };

  if (memoryOwnership === 'transfer') {
    const transferBuffers = [
      positions.buffer,
      ...(teffLog8 ? [teffLog8.buffer] : []),
      ...(magAbs ? [magAbs.buffer] : []),
    ];
    return cloneWithTransferredBuffers(cell, transferBuffers);
  }

  return cell;
}

/**
 * @param {import('./index.d.ts').StarCellData} cell
 * @returns {number}
 */
export function estimateStarCellBytes(cell) {
  return (
    (cell.coordinates.components.byteLength ?? 0) +
    (cell.attributes.teffLog8?.byteLength ?? 0) +
    (cell.attributes.magAbs?.byteLength ?? 0)
  );
}

/**
 * @param {number} gridX
 * @param {number} gridY
 * @param {number} gridZ
 * @param {number} level
 * @returns {bigint}
 */
export function encodeMorton3D(gridX, gridY, gridZ, level) {
  const normalizedLevel = assertIntegerInRange(level, 0, MAX_MORTON_LEVEL, 'level');
  const axisLimit = 2 ** normalizedLevel;
  const x = assertIntegerInRange(gridX, 0, axisLimit - 1, 'gridX');
  const y = assertIntegerInRange(gridY, 0, axisLimit - 1, 'gridY');
  const z = assertIntegerInRange(gridZ, 0, axisLimit - 1, 'gridZ');
  let mortonCode = 0n;

  for (let bit = 0; bit < normalizedLevel; bit += 1) {
    const shift = BigInt(bit * 3);
    mortonCode |= BigInt((x >> bit) & 1) << shift;
    mortonCode |= BigInt((y >> bit) & 1) << (shift + 1n);
    mortonCode |= BigInt((z >> bit) & 1) << (shift + 2n);
  }

  return mortonCode;
}

/**
 * @param {bigint | number | string} mortonCode
 * @param {number} level
 */
export function decodeMorton3D(mortonCode, level) {
  const normalizedLevel = assertIntegerInRange(level, 0, MAX_MORTON_LEVEL, 'level');
  const normalizedMorton = parseMortonCode(mortonCode);
  assertMortonBounds(normalizedMorton, normalizedLevel);
  let gridX = 0;
  let gridY = 0;
  let gridZ = 0;

  for (let bit = 0; bit < normalizedLevel; bit += 1) {
    const shift = BigInt(bit * 3);
    gridX |= Number((normalizedMorton >> shift) & 1n) << bit;
    gridY |= Number((normalizedMorton >> (shift + 1n)) & 1n) << bit;
    gridZ |= Number((normalizedMorton >> (shift + 2n)) & 1n) << bit;
  }

  return { gridX, gridY, gridZ };
}

/**
 * @param {number | { level: number; mortonCode?: string | number | bigint; gridX?: number; gridY?: number; gridZ?: number }} levelOrCell
 * @param {string | number | bigint} [mortonCode]
 * @returns {import('./index.d.ts').StarCellKey}
 */
export function createStarCellKey(levelOrCell, mortonCode) {
  if (typeof levelOrCell === 'object' && levelOrCell) {
    return /** @type {import('./index.d.ts').StarCellKey} */ (
      `${levelOrCell.level}:${resolveNodeMortonCode(levelOrCell)}`
    );
  }

  return /** @type {import('./index.d.ts').StarCellKey} */ (
    `${levelOrCell}:${normalizeMortonCode(mortonCode)}`
  );
}

/**
 * @param {string} cellKey
 * @returns {import('./index.d.ts').StarCellRef}
 */
export function parseStarCellKey(cellKey) {
  const match = /^(\d+):(\d+)$/.exec(cellKey);
  if (!match) {
    throw new TypeError('Star cell key must be formatted as "level:mortonCode".');
  }

  return {
    level: Number(match[1]),
    mortonCode: normalizeMortonCode(match[2]),
  };
}

export function createStarCellStore() {
  /** @type {Map<import('./index.d.ts').StarCellKey, import('./index.d.ts').StarCellData>} */
  const cellsByKey = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** @type {import('./index.d.ts').StarCellDelta | null} */
  let lastDelta = null;
  /** @type {import('./index.d.ts').StarCellDelta | null} */
  let lastError = null;

  return {
    apply,
    subscribe,
    getCells,
    getCell,
    getStarCount,
    stars,
    getObjectRef,
    getPickMeta,
    getSnapshot,
    clear,
  };

  /**
   * @param {import('./index.d.ts').StarCellDelta} delta
   */
  function apply(delta) {
    if (!delta || typeof delta.type !== 'string') {
      throw new TypeError('Star cell store requires a StarCellDelta.');
    }

    if (delta.type === 'stars/cells-upsert') {
      for (const cell of delta.cells) {
        cellsByKey.set(cell.cellKey, cell);
      }
      lastDelta = delta;
      notify();
      return;
    }

    if (delta.type === 'stars/cells-remove') {
      for (const cellKey of delta.cellKeys) {
        cellsByKey.delete(cellKey);
      }
      lastDelta = delta;
      notify();
      return;
    }

    if (delta.type === 'stars/current') {
      lastDelta = delta;
      notify();
      return;
    }

    if (delta.type === 'stars/error') {
      lastDelta = delta;
      lastError = delta;
      notify();
      return;
    }

    throw new TypeError(`Unsupported star cell delta type: ${delta.type}`);
  }

  /**
   * @param {() => void} listener
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getCells() {
    return Array.from(cellsByKey.values())
      .sort((left, right) => left.cellKey.localeCompare(right.cellKey));
  }

  /**
   * @param {import('./index.d.ts').StarCellKey} cellKey
   */
  function getCell(cellKey) {
    return cellsByKey.get(cellKey) ?? null;
  }

  function getStarCount() {
    let starCount = 0;
    for (const cell of cellsByKey.values()) {
      starCount += cell.count;
    }
    return starCount;
  }

  function* stars() {
    for (const cell of getCells()) {
      const positions = cell.coordinates.components;
      const teff = cell.attributes.teffLog8;
      const magAbs = cell.attributes.magAbs;

      for (let objectIndex = 0; objectIndex < cell.count; objectIndex += 1) {
        const positionIndex = objectIndex * 3;
        yield {
          cell,
          cellKey: cell.cellKey,
          objectIndex,
          position: {
            x: positions[positionIndex] ?? 0,
            y: positions[positionIndex + 1] ?? 0,
            z: positions[positionIndex + 2] ?? 0,
          },
          ...(teff ? { teffLog8: teff[objectIndex] } : {}),
          ...(magAbs ? { magAbs: magAbs[objectIndex] } : {}),
          objectRef: cell.refs?.[objectIndex] ?? null,
          pickMeta: cell.pickMeta?.[objectIndex] ?? null,
        };
      }
    }
  }

  /**
   * @param {import('./index.d.ts').StarCellKey} cellKey
   * @param {number} objectIndex
   */
  function getObjectRef(cellKey, objectIndex) {
    const cell = cellsByKey.get(cellKey);
    return cell?.refs?.[objectIndex] ?? null;
  }

  /**
   * @param {import('./index.d.ts').StarCellKey} cellKey
   * @param {number} objectIndex
   */
  function getPickMeta(cellKey, objectIndex) {
    const cell = cellsByKey.get(cellKey);
    return cell?.pickMeta?.[objectIndex] ?? null;
  }

  function getSnapshot() {
    let bytes = 0;
    for (const cell of cellsByKey.values()) {
      bytes += estimateStarCellBytes(cell);
    }

    return {
      cellCount: cellsByKey.size,
      starCount: getStarCount(),
      bytes,
      lastDelta,
      lastError,
    };
  }

  function clear() {
    cellsByKey.clear();
    lastDelta = null;
    lastError = null;
    notify();
  }

  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }
}

/**
 * @param {AsyncIterable<import('./index.d.ts').StarCellDelta> | Iterable<import('./index.d.ts').StarCellDelta>} deltas
 * @param {import('./index.d.ts').StarCellStore} store
 * @param {{ stopOnCurrent?: boolean; throwOnError?: boolean }} [options]
 */
export async function consumeStarCellDeltas(deltas, store, options = {}) {
  const throwOnError = options.throwOnError !== false;
  let processed = 0;

  for await (const delta of deltas) {
    store.apply(delta);
    processed += 1;

    if (delta.type === 'stars/error' && throwOnError) {
      const error = new Error(delta.error.message);
      // @ts-expect-error conventional error code for callers that branch.
      error.code = delta.error.code;
      throw error;
    }

    if (delta.type === 'stars/current' && options.stopOnCurrent) {
      return { processed, stoppedOn: 'current' };
    }
  }

  return { processed, stoppedOn: null };
}

/**
 * @param {import('./index.d.ts').ApparentMagnitudeInput} input
 */
export function apparentMagnitude(input) {
  const distancePc = Math.max(Number(input.distancePc), 1e-9);
  return Number(input.magAbs) + 5 * (Math.log10(distancePc) - 1);
}

/**
 * Decode a teffLog8 byte (0-255) to effective temperature in kelvin.
 *
 * @param {number} teffLog8
 */
export function decodeTemperatureK(teffLog8) {
  const log8 = Number(teffLog8) / 255;
  if (log8 >= 0.996) return 5800;
  return 2000 * Math.pow(25, log8);
}

/**
 * @param {number} teffLog8OrTemperatureK
 * @param {{ input?: 'teffLog8' | 'kelvin' }} [options]
 * @returns {[number, number, number]}
 */
export function temperatureToRgb(teffLog8OrTemperatureK, options = {}) {
  const tempK = options.input === 'kelvin'
    ? Number(teffLog8OrTemperatureK)
    : decodeTemperatureK(teffLog8OrTemperatureK);
  const t = clamp(tempK, 1000, 40000) / 100;

  const r = t <= 66
    ? 255
    : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66
    ? 99.4708025861 * Math.log(t) - 161.119568166
    : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66
    ? 255
    : t <= 19
      ? 0
      : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return [
    clamp(Math.round(r), 0, 255),
    clamp(Math.round(g), 0, 255),
    clamp(Math.round(b), 0, 255),
  ];
}

export function supportsTransferableBuffers() {
  if (transferableSupport !== null) {
    return transferableSupport;
  }

  if (typeof structuredClone !== 'function') {
    transferableSupport = false;
    return transferableSupport;
  }

  try {
    const buffer = new ArrayBuffer(1);
    structuredClone(buffer, { transfer: [buffer] });
    transferableSupport = buffer.byteLength === 0;
  } catch {
    transferableSupport = false;
  }

  return transferableSupport;
}

/**
 * @param {import('./index.d.ts').StarCoordinateOutput | undefined} coordinates
 * @returns {{
 *   name: string;
 *   frame: string;
 *   units: [string, string, string];
 *   transformPosition?: import('./index.d.ts').StarCoordinateOutput['transformPosition'];
 * }}
 */
function normalizeCoordinates(coordinates) {
  return {
    name: coordinates?.name ?? DEFAULT_COORDINATE_OUTPUT.name,
    frame: coordinates?.frame ?? DEFAULT_COORDINATE_OUTPUT.frame,
    units: coordinates?.units ?? DEFAULT_COORDINATE_OUTPUT.units,
    ...(coordinates?.transformPosition
      ? { transformPosition: coordinates.transformPosition }
      : {}),
  };
}

/**
 * @param {Uint8Array | undefined} source
 * @param {number} count
 * @param {'borrowed' | 'copy' | 'transfer'} memoryOwnership
 */
function createCellTeffLog8Array(source, count, memoryOwnership) {
  if (memoryOwnership === 'borrowed' && source && source.length === count) {
    return source;
  }

  const output = new Uint8Array(count);
  if (source) {
    output.set(source.subarray(0, count));
  }
  return output;
}

/**
 * @param {Float32Array | undefined} source
 * @param {number} count
 * @param {'borrowed' | 'copy' | 'transfer'} memoryOwnership
 */
function createCellMagAbsArray(source, count, memoryOwnership) {
  if (memoryOwnership === 'borrowed' && source && source.length === count) {
    return source;
  }

  const output = new Float32Array(count);
  if (source) {
    output.set(source.subarray(0, count));
  }
  return output;
}

/**
 * @param {{
 *   output: Float32Array;
 *   node: import('./index.d.ts').StarCellSourceNode;
 *   decoded: import('./index.d.ts').DecodedStarSegment;
 *   coordinates: ReturnType<typeof normalizeCoordinates>;
 * }} options
 */
function writePositions(options) {
  const { output, node, decoded, coordinates } = options;

  for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
    const sourceIndex = ordinal * 3;
    const xPc = decoded.positionsPc[sourceIndex] ?? 0;
    const yPc = decoded.positionsPc[sourceIndex + 1] ?? 0;
    const zPc = decoded.positionsPc[sourceIndex + 2] ?? 0;
    const transformed = coordinates.transformPosition?.({
      xPc,
      yPc,
      zPc,
      node,
      ordinal,
    });

    const outputIndex = ordinal * 3;
    if (Array.isArray(transformed)) {
      output[outputIndex] = transformed[0] ?? 0;
      output[outputIndex + 1] = transformed[1] ?? 0;
      output[outputIndex + 2] = transformed[2] ?? 0;
    } else if (transformed) {
      output[outputIndex] = transformed.x ?? 0;
      output[outputIndex + 1] = transformed.y ?? 0;
      output[outputIndex + 2] = transformed.z ?? 0;
    } else {
      output[outputIndex] = xPc;
      output[outputIndex + 1] = yPc;
      output[outputIndex + 2] = zPc;
    }
  }
}

/**
 * @param {import('./index.d.ts').StarObjectRef | undefined} ref
 * @param {{ datasetId?: string | null; level: number; mortonCode: string; ordinal: number }} fallback
 * @returns {import('./index.d.ts').StarObjectRef}
 */
function normalizeStarObjectRef(ref, fallback) {
  return {
    datasetId: ref?.datasetId ?? fallback.datasetId ?? null,
    level: ref?.level ?? fallback.level,
    mortonCode: normalizeMortonCode(ref?.mortonCode ?? fallback.mortonCode),
    ordinal: ref?.ordinal ?? fallback.ordinal,
  };
}

/**
 * @param {{ mortonCode?: string | number | bigint; level: number; gridX?: number; gridY?: number; gridZ?: number }} node
 */
function resolveNodeMortonCode(node) {
  if (node.mortonCode !== undefined) {
    return normalizeMortonCode(node.mortonCode);
  }

  return encodeMorton3D(
    Number(node.gridX),
    Number(node.gridY),
    Number(node.gridZ),
    Number(node.level),
  ).toString(10);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeMortonCode(value) {
  return parseMortonCode(value).toString(10);
}

/**
 * @param {unknown} value
 * @returns {bigint}
 */
function parseMortonCode(value) {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new RangeError('mortonCode must be >= 0');
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('mortonCode must be a non-negative safe integer');
    }
    return BigInt(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new TypeError('mortonCode must be a bigint, number, or numeric string');
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {string} label
 */
function assertIntegerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
  }

  return value;
}

/**
 * @param {bigint} mortonCode
 * @param {number} level
 */
function assertMortonBounds(mortonCode, level) {
  const bitCount = BigInt(level * 3);
  const maxMortonCode = bitCount === 0n ? 0n : (1n << bitCount) - 1n;
  if (mortonCode > maxMortonCode) {
    throw new RangeError(`mortonCode exceeds the maximum value for level ${level}`);
  }
}

/**
 * @template T
 * @param {T} value
 * @param {ArrayBuffer[]} buffers
 * @returns {T}
 */
function cloneWithTransferredBuffers(value, buffers) {
  if (!supportsTransferableBuffers()) {
    const error = new Error('Transferable star cell buffers are not available in this runtime.');
    // @ts-expect-error attaching a conventional error code is intentional.
    error.code = ERR_STAR_CELLS_TRANSFER_UNAVAILABLE;
    throw error;
  }

  return structuredClone(value, { transfer: buffers });
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
