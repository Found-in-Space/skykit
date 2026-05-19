/**
 * @typedef {import('@found-in-space/star-trees').StarObjectRef} StarObjectRef
 * @typedef {import('@found-in-space/star-trees').DecodedStarSegment} DecodedStarSegment
 * @typedef {import('./index.d.ts').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 */

export const PAYLOAD_RECORD_SIZE = 16;
export const DEFAULT_PAYLOAD_MAX_GAP_BYTES = 131_072;
export const DEFAULT_PAYLOAD_MAX_BATCH_BYTES = 512_000;
export const DEFAULT_MAX_INFLIGHT_PAYLOAD_BATCHES = 8;

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
        nodes: [node],
      };
      batches.push(currentBatch);
      continue;
    }

    const gapBytes = start - currentBatch.end - 1;
    const spanBytes = end - currentBatch.start + 1;

    if (gapBytes <= maxGapBytes && spanBytes <= maxBatchBytes) {
      currentBatch.end = end;
      currentBatch.nodes.push(node);
      continue;
    }

    currentBatch = {
      start,
      end,
      nodes: [node],
    };
    batches.push(currentBatch);
  }

  return batches.map((batch) => {
    const payloadBytes = batch.nodes.reduce(
      (sum, node) => sum + node.payloadLength,
      0,
    );
    const spanBytes = batch.end - batch.start + 1;

    return {
      ...batch,
      payloadBytes,
      spanBytes,
      gapBytes: Math.max(0, spanBytes - payloadBytes),
    };
  });
}

/**
 * Decode one decompressed star payload into provider-native parsec positions.
 *
 * @param {ArrayBuffer} buffer
 * @param {StarOctreeRuntimeNode} node
 * @param {{ datasetId?: string | null }} options
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
  const positionsPc = new Float32Array(count * 3);
  const teffLog8 = new Uint8Array(count);
  const magAbs = new Float32Array(count);
  /** @type {StarObjectRef[]} */
  const refs = [];

  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const offset = ordinal * PAYLOAD_RECORD_SIZE;
    const localX = view.getFloat32(offset, true);
    const localY = view.getFloat32(offset + 4, true);
    const localZ = view.getFloat32(offset + 8, true);
    const magnitude = view.getInt16(offset + 12, true);

    positionsPc[ordinal * 3] = node.centerX + localX * node.halfSize;
    positionsPc[ordinal * 3 + 1] = node.centerY + localY * node.halfSize;
    positionsPc[ordinal * 3 + 2] = node.centerZ + localZ * node.halfSize;
    magAbs[ordinal] = magnitude / 100;
    teffLog8[ordinal] = view.getUint8(offset + 14);
    refs.push({
      datasetId: options.datasetId ?? null,
      level: node.level,
      mortonCode: node.mortonCode,
      ordinal,
    });
  }

  return {
    count,
    positionsPc,
    teffLog8,
    magAbs,
    refs,
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
