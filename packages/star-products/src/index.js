import {
  consumeProductDeltas,
  createRepresentationStore,
} from '@found-in-space/product-stream';

export { consumeProductDeltas } from '@found-in-space/product-stream';

export const consumeStarProductDeltas = consumeProductDeltas;
export const ERR_STAR_PRODUCTS_TRANSFER_UNAVAILABLE =
  'ERR_STAR_PRODUCTS_TRANSFER_UNAVAILABLE';

const DEFAULT_COORDINATE_OUTPUT = {
  name: 'position',
  frame: 'icrs',
  units: /** @type {[string, string, string]} */ (['pc', 'pc', 'pc']),
};

/** @type {boolean | null} */
let transferableSupport = null;

/**
 * @template Node
 * @param {import('./index.d.ts').CreateStarObjectBatchProductOptions<Node>} options
 * @returns {import('./index.d.ts').StarObjectBatchProduct}
 */
export function createStarObjectBatchProduct(options) {
  const attributes = options.attributes ?? ['position', 'teffLog8', 'magAbs'];
  const coordinates = normalizeCoordinates(options.coordinates);
  const includeTeffLog8 = attributes.includes('teffLog8');
  const includeMagAbs = attributes.includes('magAbs');
  const includePickMeta = attributes.includes('pickMeta');
  const includeRefs = attributes.includes('objectRef');
  const totalCount = options.entries.reduce(
    (sum, entry) => sum + entry.decoded.count,
    0,
  );

  const positions = new Float32Array(totalCount * 3);
  const teffLog8 = includeTeffLog8 ? new Uint8Array(totalCount) : null;
  const magAbs = includeMagAbs ? new Float32Array(totalCount) : null;
  /** @type {import('./index.d.ts').CanonicalObjectRef[]} */
  const refs = [];
  /** @type {import('./index.d.ts').StarPickMeta[] | undefined} */
  const pickMeta = includePickMeta ? [] : undefined;
  /** @type {import('./index.d.ts').StarObjectBatchNodeSummary[]} */
  const nodes = [];

  let offset = 0;

  for (const entry of options.entries) {
    const { node, decoded } = entry;

    writePositions({
      output: positions,
      outputOffset: offset,
      node,
      decoded,
      coordinates,
    });

    if (teffLog8) {
      teffLog8.set(decoded.teffLog8 ?? new Uint8Array(decoded.count), offset);
    }

    if (magAbs) {
      magAbs.set(decoded.magAbs ?? new Float32Array(decoded.count), offset);
    }

    if (includeRefs && decoded.refs) {
      refs.push(...decoded.refs);
    }

    nodes.push({
      nodeKey: node.nodeKey,
      level: node.level,
      gridX: node.gridX,
      gridY: node.gridY,
      gridZ: node.gridZ,
      centerX: node.centerX,
      centerY: node.centerY,
      centerZ: node.centerZ,
      halfSize: node.halfSize,
      count: decoded.count,
      offset,
    });

    if (pickMeta) {
      for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
        pickMeta.push({
          nodeKey: node.nodeKey,
          ordinal,
          level: node.level,
          gridX: node.gridX,
          gridY: node.gridY,
          gridZ: node.gridZ,
          centerX: node.centerX,
          centerY: node.centerY,
          centerZ: node.centerZ,
        });
      }
    }

    offset += decoded.count;
  }

  const attributeBytes =
    (teffLog8?.byteLength ?? 0) + (magAbs?.byteLength ?? 0);

  /** @type {import('./index.d.ts').StarObjectBatchProduct} */
  const product = {
    productType: 'object-batch',
    id: createStarProductId(options.streamId, options.productIndex),
    providerId: options.providerId,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    layerId: 'stars',
    objectType: 'star',
    streamId: options.streamId,
    ...(options.viewRevision !== undefined
      ? { viewRevision: options.viewRevision }
      : {}),
    ...(options.demandRevision !== undefined
      ? { demandRevision: options.demandRevision }
      : {}),
    count: totalCount,
    nodes,
    coordinates: {
      primary: {
        name: coordinates.name,
        frame: coordinates.frame,
        representation: 'cartesian3',
        units: coordinates.units,
        stride: 3,
        components: positions,
      },
    },
    attributes: {
      ...(teffLog8
        ? { teffLog8: { name: 'teffLog8', kind: 'number', values: teffLog8 } }
        : {}),
      ...(magAbs
        ? { magAbs: { name: 'magAbs', kind: 'number', unit: 'mag', values: magAbs } }
        : {}),
    },
    ...(includeRefs ? { refs } : {}),
    ...(pickMeta ? { pickMeta } : {}),
    completeness: {
      phase: options.completenessPhase ?? 'partial',
      stable: true,
      loadedObjects: totalCount,
      loadedNodes: options.entries.length,
    },
    memory: {
      ownership: options.memoryOwnership ?? 'borrowed',
      bytes: positions.byteLength + attributeBytes,
    },
  };

  if (options.memoryOwnership === 'transfer') {
    const transferBuffers = [
      positions.buffer,
      ...(teffLog8 ? [teffLog8.buffer] : []),
      ...(magAbs ? [magAbs.buffer] : []),
    ];
    return cloneWithTransferredBuffers(product, transferBuffers);
  }

  return product;
}

/**
 * @param {string} streamId
 * @param {number} productIndex
 * @returns {string}
 */
export function createStarProductId(streamId, productIndex) {
  return `${streamId}:product:${productIndex}`;
}

export function createStarRepresentationStore() {
  const baseStore = createRepresentationStore({
    getProductId: (product) => product.id,
    getProductBytes: (product) => product.memory?.bytes ?? 0,
  });

  return {
    apply: baseStore.apply,
    subscribe: baseStore.subscribe,
    getProducts: baseStore.getProducts,
    getStarCount,
    stars,
    getObjectRef,
    getPickMeta,
    getSnapshot,
    clear: baseStore.clear,
  };

  function getStarCount() {
    return baseStore.getProducts().reduce(
      (sum, product) => sum + product.count,
      0,
    );
  }

  function* stars() {
    for (const product of baseStore.getProducts()) {
      const positions = product.coordinates.primary.components;
      const teff = product.attributes.teffLog8?.values;
      const magAbs = product.attributes.magAbs?.values;

      for (let objectIndex = 0; objectIndex < product.count; objectIndex += 1) {
        const positionIndex = objectIndex * 3;
        yield {
          product,
          productId: product.id,
          objectIndex,
          position: {
            x: positions[positionIndex] ?? 0,
            y: positions[positionIndex + 1] ?? 0,
            z: positions[positionIndex + 2] ?? 0,
          },
          ...(teff ? { teffLog8: teff[objectIndex] } : {}),
          ...(magAbs ? { magAbs: magAbs[objectIndex] } : {}),
          objectRef: product.refs?.[objectIndex] ?? null,
          pickMeta: product.pickMeta?.[objectIndex] ?? null,
        };
      }
    }
  }

  /**
   * @param {string} productId
   * @param {number} objectIndex
   */
  function getObjectRef(productId, objectIndex) {
    const product = findProduct(productId);
    return product?.refs?.[objectIndex] ?? null;
  }

  /**
   * @param {string} productId
   * @param {number} objectIndex
   */
  function getPickMeta(productId, objectIndex) {
    const product = findProduct(productId);
    return product?.pickMeta?.[objectIndex] ?? null;
  }

  function getSnapshot() {
    return {
      ...baseStore.getSnapshot(),
      starCount: getStarCount(),
    };
  }

  /**
   * @param {string} productId
   */
  function findProduct(productId) {
    return baseStore.getProducts()
      .find((product) => product.id === productId) ?? null;
  }
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

/**
 * @param {{ x: number; y: number; z: number } | [number, number, number]} position
 * @param {{ x: number; y: number; z: number } | [number, number, number]} [observerPc]
 */
export function icrsToRaDec(position, observerPc = [0, 0, 0]) {
  const pos = vectorFrom(position);
  const obs = vectorFrom(observerPc);
  if (!pos || !obs) return null;

  const x = pos[0] - obs[0];
  const y = pos[1] - obs[1];
  const z = pos[2] - obs[2];
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) return null;

  const nx = x / length;
  const ny = y / length;
  const nz = z / length;
  const raRawDeg = Math.atan2(ny, nx) * (180 / Math.PI);
  const raDeg = (raRawDeg + 360) % 360;
  const decDeg = Math.asin(clamp(nz, -1, 1)) * (180 / Math.PI);
  return {
    raDeg,
    raHours: raDeg / 15,
    decDeg,
  };
}

/**
 * @param {{ raDeg: number; decDeg: number; width: number; height: number }} options
 */
export function projectEquirectangular(options) {
  return {
    x: ((Number(options.raDeg) % 360 + 360) % 360) / 360 * options.width,
    y: (90 - clamp(Number(options.decDeg), -90, 90)) / 180 * options.height,
  };
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
 * @template T
 * @param {T} value
 * @param {ArrayBuffer[]} buffers
 * @returns {T}
 */
function cloneWithTransferredBuffers(value, buffers) {
  if (!supportsTransferableBuffers()) {
    const error = new Error('Transferable star object buffers are not available in this runtime.');
    // @ts-expect-error attaching a conventional error code is intentional.
    error.code = ERR_STAR_PRODUCTS_TRANSFER_UNAVAILABLE;
    throw error;
  }

  return structuredClone(value, { transfer: buffers });
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
 * @param {{
 *   output: Float32Array;
 *   outputOffset: number;
 *   node: import('./index.d.ts').StarProductSourceNode;
 *   decoded: import('./index.d.ts').DecodedStarSegment;
 *   coordinates: ReturnType<typeof normalizeCoordinates>;
 * }} options
 */
function writePositions(options) {
  const { output, outputOffset, node, decoded, coordinates } = options;

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

    const outputIndex = (outputOffset + ordinal) * 3;
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
 * @param {unknown} value
 * @returns {[number, number, number] | null}
 */
function vectorFrom(value) {
  if (Array.isArray(value)) {
    const [x, y, z] = value.map(Number);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? [x, y, z]
      : null;
  }

  if (value && typeof value === 'object') {
    const candidate = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const z = Number(candidate.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? [x, y, z]
      : null;
  }

  return null;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
