/**
 * @typedef {import('@found-in-space/star-trees').DecodedStarSegment} DecodedStarSegment
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 */

export const PAYLOAD_RECORD_SIZE = 16;
export const DEFAULT_PAYLOAD_MAX_GAP_BYTES = 131_072;
export const DEFAULT_PAYLOAD_MAX_BATCH_BYTES = 512_000;
export const DEFAULT_PREFETCH_PAYLOAD_MAX_GAP_BYTES = 16_384;
export const DEFAULT_PREFETCH_PAYLOAD_MAX_BATCH_BYTES = 262_144;
export const DEFAULT_PREFETCH_PAYLOAD_MIN_USEFUL_RATIO = 0.5;
export const DEFAULT_MAX_INFLIGHT_PAYLOAD_BATCHES = 8;
export const DEFAULT_DECODE_ATTRIBUTES = Object.freeze(['position', 'teffLog8', 'magAbs']);

/**
 * @param {ArrayBuffer} compressed
 * @returns {Promise<ArrayBuffer>}
 */
export async function decompressGzip(compressed) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('gzip decompression requires DecompressionStream');
  }

  const stream = new DecompressionStream('gzip');
  const reader = stream.readable.getReader();
  const readPromise = readAllChunks(reader);
  const writer = stream.writable.getWriter();

  try {
    await writer.write(new Uint8Array(compressed));
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }

  return readPromise;
}

/**
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {Promise<ArrayBuffer>}
 */
async function readAllChunks(reader) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output.buffer;
}

/**
 * @param {Array<StarOctreeRuntimeNode>} nodes
 * @param {{
 *   maxGapBytes?: number;
 *   maxBatchBytes?: number;
 *   minUsefulRatio?: number;
 * }} options
 */
export function planPayloadRangeBatches(nodes, options = {}) {
  const maxGapBytes = normalizePositiveInteger(
    options.maxGapBytes,
    DEFAULT_PAYLOAD_MAX_GAP_BYTES,
  );
  const maxBatchBytes = normalizePositiveInteger(
    options.maxBatchBytes,
    DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  );
  const minUsefulRatio = normalizeRatio(options.minUsefulRatio, 0);
  const payloadNodes = nodes
    .filter((node) => node && node.payloadLength > 0)
    .sort((left, right) => left.payloadOffset - right.payloadOffset);
  const batches = [];
  let currentBatch = null;

  for (const node of payloadNodes) {
    const start = node.payloadOffset;
    const end = start + node.payloadLength - 1;

    if (!currentBatch) {
      currentBatch = {
        start,
        end,
        payloadBytes: node.payloadLength,
        nodes: [node],
      };
      batches.push(currentBatch);
      continue;
    }

    const gapBytes = start - currentBatch.end - 1;
    const spanBytes = end - currentBatch.start + 1;
    const payloadBytes = currentBatch.payloadBytes + node.payloadLength;
    const usefulRatio = spanBytes > 0 ? payloadBytes / spanBytes : 1;

    if (
      gapBytes <= maxGapBytes &&
      spanBytes <= maxBatchBytes &&
      usefulRatio >= minUsefulRatio
    ) {
      currentBatch.end = end;
      currentBatch.payloadBytes = payloadBytes;
      currentBatch.nodes.push(node);
      continue;
    }

    currentBatch = {
      start,
      end,
      payloadBytes: node.payloadLength,
      nodes: [node],
    };
    batches.push(currentBatch);
  }

  return batches.map((batch) => {
    const spanBytes = batch.end - batch.start + 1;

    return {
      ...batch,
      payloadBytes: batch.payloadBytes,
      spanBytes,
      gapBytes: Math.max(0, spanBytes - batch.payloadBytes),
    };
  });
}

/**
 * @param {readonly string[] | { teffLog8?: boolean; magAbs?: boolean } | undefined} attributes
 */
export function normalizePayloadDecodeAttributes(attributes = DEFAULT_DECODE_ATTRIBUTES) {
  if (attributes && !Array.isArray(attributes) && typeof attributes === 'object') {
    const attributeOptions =
      /** @type {{ teffLog8?: boolean; magAbs?: boolean }} */ (attributes);
    return {
      teffLog8: attributeOptions.teffLog8 === true,
      magAbs: attributeOptions.magAbs === true,
    };
  }

  const requested = new Set(Array.isArray(attributes) ? attributes : DEFAULT_DECODE_ATTRIBUTES);
  return {
    teffLog8: requested.has('teffLog8'),
    magAbs: requested.has('magAbs'),
  };
}

/**
 * @param {readonly string[] | { teffLog8?: boolean; magAbs?: boolean } | undefined} attributes
 */
export function payloadDecodeAttributeMask(attributes = DEFAULT_DECODE_ATTRIBUTES) {
  const normalized = normalizePayloadDecodeAttributes(attributes);
  return [
    'p',
    ...(normalized.teffLog8 ? ['t'] : []),
    ...(normalized.magAbs ? ['m'] : []),
  ].join('+');
}

/**
 * Decode one decompressed star payload into provider-native parsec positions.
 *
 * @param {ArrayBuffer} buffer
 * @param {StarOctreeRuntimeNode} node
 * @param {{ attributes?: readonly string[] | { teffLog8?: boolean; magAbs?: boolean } }} options
 * @returns {DecodedStarSegment}
 */
export function decodeStarPayload(buffer, node, options = {}) {
  if (buffer.byteLength % PAYLOAD_RECORD_SIZE !== 0) {
    throw new Error(
      `Star payload length ${buffer.byteLength} is not a multiple of ${PAYLOAD_RECORD_SIZE}.`,
    );
  }

  const count = Math.floor(buffer.byteLength / PAYLOAD_RECORD_SIZE);
  const view = new DataView(buffer);
  const decodeAttributes = normalizePayloadDecodeAttributes(options.attributes);
  const positionsPc = new Float32Array(count * 3);
  const teffLog8 = decodeAttributes.teffLog8 ? new Uint8Array(count) : null;
  const magAbs = decodeAttributes.magAbs ? new Float32Array(count) : null;

  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const offset = ordinal * PAYLOAD_RECORD_SIZE;
    const localX = view.getFloat32(offset, true);
    const localY = view.getFloat32(offset + 4, true);
    const localZ = view.getFloat32(offset + 8, true);

    positionsPc[ordinal * 3] = node.centerX + localX * node.halfSize;
    positionsPc[ordinal * 3 + 1] = node.centerY + localY * node.halfSize;
    positionsPc[ordinal * 3 + 2] = node.centerZ + localZ * node.halfSize;

    if (magAbs) {
      magAbs[ordinal] = view.getInt16(offset + 12, true) / 100;
    }

    if (teffLog8) {
      teffLog8[ordinal] = view.getUint8(offset + 14);
    }
  }

  return {
    count,
    positionsPc,
    ...(teffLog8 ? { teffLog8 } : {}),
    ...(magAbs ? { magAbs } : {}),
  };
}

/**
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @returns {Promise<T>[]}
 */
export function runWithConcurrency(tasks, concurrency) {
  const maxInflight = normalizePositiveInteger(
    concurrency,
    DEFAULT_MAX_INFLIGHT_PAYLOAD_BATCHES,
  );
  let nextTaskIndex = 0;
  let activeCount = 0;
  /** @type {Array<{
   *   resolve: (value: T) => void;
   *   reject: (error: unknown) => void;
   * }>} */
  const settlers = [];
  const promises = tasks.map((_, index) => new Promise((resolve, reject) => {
    settlers[index] = { resolve, reject };
  }));

  function pump() {
    while (activeCount < maxInflight && nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      activeCount += 1;

      Promise.resolve()
        .then(tasks[taskIndex])
        .then(settlers[taskIndex].resolve, settlers[taskIndex].reject)
        .finally(() => {
          activeCount -= 1;
          pump();
        });
    }
  }

  pump();
  return promises;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeRatio(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, number));
}
