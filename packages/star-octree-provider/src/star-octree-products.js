/**
 * @typedef {import('./index.d.ts').CanonicalObjectRef} CanonicalObjectRef
 * @typedef {import('./index.d.ts').StarObjectBatchProduct} StarObjectBatchProduct
 * @typedef {import('./index.d.ts').StarOctreeCoordinateOutput} StarOctreeCoordinateOutput
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 */

const DEFAULT_COORDINATE_OUTPUT = {
  name: 'position',
  frame: 'icrs',
  units: /** @type {[string, string, string]} */ (['pc', 'pc', 'pc']),
};

/**
 * @typedef {{
 *   count: number;
 *   positionsPc: Float32Array;
 *   teffLog8?: Uint8Array;
 *   magAbs?: Float32Array;
 *   refs?: CanonicalObjectRef[];
 * }} DecodedStarSegment
 */

/**
 * @typedef {{
 *   node: StarOctreeRuntimeNode;
 *   decoded: DecodedStarSegment;
 * }} ProductEntry
 */

/**
 * Build one non-cumulative star object-batch product from decoded entries.
 *
 * @param {{
 *   providerId: string;
 *   sessionId?: string;
 *   streamId: string;
 *   productIndex: number;
 *   entries: ProductEntry[];
 *   attributes?: string[];
 *   coordinates?: StarOctreeCoordinateOutput;
 *   viewRevision?: number;
 *   demandRevision?: number;
 *   memoryOwnership?: 'borrowed' | 'copy' | 'transfer';
 * }} options
 * @returns {StarObjectBatchProduct}
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
  /** @type {CanonicalObjectRef[]} */
  const refs = [];
  /** @type {StarObjectBatchProduct['pickMeta']} */
  const pickMeta = includePickMeta ? [] : undefined;
  /** @type {StarObjectBatchProduct['nodes']} */
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

  return {
    productType: 'object-batch',
    id: createProductId(options.streamId, options.productIndex),
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
      phase: 'partial',
      stable: true,
      loadedObjects: totalCount,
      loadedNodes: options.entries.length,
    },
    memory: {
      ownership: options.memoryOwnership ?? 'borrowed',
      bytes: positions.byteLength + attributeBytes,
    },
  };
}

/**
 * Create deterministic fake decoded data for a runtime node.
 *
 * @param {StarOctreeRuntimeNode} node
 * @returns {DecodedStarSegment}
 */
export function createDefaultDecodedStarSegment(node) {
  return {
    count: 1,
    positionsPc: new Float32Array([node.centerX, node.centerY, node.centerZ]),
    teffLog8: new Uint8Array([128]),
    magAbs: new Float32Array([0]),
  };
}

/**
 * @param {string} streamId
 * @param {number} productIndex
 * @returns {string}
 */
export function createProductId(streamId, productIndex) {
  return `${streamId}:product:${productIndex}`;
}

/**
 * @param {StarOctreeCoordinateOutput | undefined} coordinates
 * @returns {{
 *   name: string;
 *   frame: string;
 *   units: [string, string, string];
 *   transformPosition?: StarOctreeCoordinateOutput['transformPosition'];
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
 *   node: StarOctreeRuntimeNode;
 *   decoded: DecodedStarSegment;
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
    const targetIndex = (outputOffset + ordinal) * 3;

    if (Array.isArray(transformed)) {
      output[targetIndex] = transformed[0] ?? 0;
      output[targetIndex + 1] = transformed[1] ?? 0;
      output[targetIndex + 2] = transformed[2] ?? 0;
      continue;
    }

    if (transformed) {
      output[targetIndex] = transformed.x;
      output[targetIndex + 1] = transformed.y;
      output[targetIndex + 2] = transformed.z;
      continue;
    }

    output[targetIndex] = xPc;
    output[targetIndex + 1] = yPc;
    output[targetIndex + 2] = zPc;
  }
}
