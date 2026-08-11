import { open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { createStarOctreeIndexSource } from '../../../packages/star-octree-provider/src/star-octree-index-source.js';
import { traverseOctree } from '../../../packages/star-octree-provider/src/star-octree-traversal.js';

export const DEFAULT_SAMPLE_COUNT = 32;
export const DEFAULT_MIN_RADIUS_PC = 1;
export const DEFAULT_MAX_RADIUS_PC = 20_000;

/**
 * Run bounded point-path probes against one local STAR octree.
 *
 * The benchmark reads headers and index shards only. Payload byte ranges are
 * summarized from node records but are never fetched or decompressed.
 *
 * @param {{
 *   label: string;
 *   path: string;
 *   sampleCount?: number;
 *   minRadiusPc?: number;
 *   maxRadiusPc?: number;
 *   points?: Array<{ x: number; y: number; z: number }>;
 * }} options
 */
export async function runOctreeFormatBenchmark(options) {
  const file = await open(options.path, 'r');
  const fileStats = await file.stat();
  const io = {
    rangeRequests: 0,
    requestedBytes: 0,
    bytesRead: 0,
    readTimeMs: 0,
  };
  const rangeSource = createFileRangeSource(file, fileStats.size, io);
  const indexSource = createStarOctreeIndexSource({
    providerId: `octree-format-benchmark:${options.label}`,
    options: { url: options.path },
    rangeSource,
    sourceIdentity: options.path,
  });

  try {
    const totalStartedAt = performance.now();
    const bootstrapStartedAt = performance.now();
    const bootstrap = await indexSource.ensureBootstrapLoaded();
    const bootstrapMs = performance.now() - bootstrapStartedAt;
    const rootStartedAt = performance.now();
    const root = await indexSource.ensureRootShardLoaded();
    const rootShardMs = performance.now() - rootStartedAt;
    const points = options.points?.length
      ? options.points.map(normalizePoint)
      : createOctreeSamplePoints(bootstrap.header, {
          sampleCount: options.sampleCount,
          minRadiusPc: options.minRadiusPc,
          maxRadiusPc: options.maxRadiusPc,
        });
    const queryRecords = [];
    const queriesStartedAt = performance.now();

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const startedAt = performance.now();
      const traversal = await traverseOctree({
        indexSource,
        bootstrap,
        visitor(node) {
          const include = pointInsideNode(point, node);
          return { include, emit: include, descend: include };
        },
      });
      const payloadNodes = traversal.nodes;
      const terminalNodes = payloadNodes.filter((node) => node.isTerminal);
      const knownStarCounts = payloadNodes
        .map((node) => node.starCount)
        .filter((value) => value != null);

      queryRecords.push({
        index,
        point,
        durationMs: round(performance.now() - startedAt),
        inspectedNodeCount: traversal.stats.inspectedNodeCount,
        selectedNodeCount: traversal.stats.selectedNodeCount,
        payloadNodeCount: payloadNodes.length,
        terminalNodeCount: terminalNodes.length,
        terminalLevel: terminalNodes[0]?.level ?? null,
        deepestLevel: traversal.stats.maxLevelInspected,
        compressedPayloadBytes: sum(payloadNodes.map((node) => node.payloadLength)),
        knownStarRecords:
          knownStarCounts.length === payloadNodes.length
            ? sum(knownStarCounts)
            : null,
      });
    }

    const queryDurationMs = performance.now() - queriesStartedAt;
    const sourceSnapshot = indexSource.getSnapshot();
    const querySummary = summarizeQueryRecords(queryRecords, queryDurationMs);

    return {
      label: options.label,
      path: options.path,
      formatVersion: bootstrap.header.version,
      datasetId: bootstrap.datasetId ?? null,
      file: {
        bytes: fileStats.size,
        indexOffset: bootstrap.header.indexOffset,
        indexBytes: bootstrap.header.indexLength,
        nonIndexBytes: Math.max(0, fileStats.size - bootstrap.header.indexLength),
        indexFraction: round(bootstrap.header.indexLength / fileStats.size),
      },
      geometry: {
        worldCenterPc: {
          x: bootstrap.header.worldCenterX,
          y: bootstrap.header.worldCenterY,
          z: bootstrap.header.worldCenterZ,
        },
        worldHalfSizePc: bootstrap.header.worldHalfSize,
        maxLevel: bootstrap.header.maxLevel,
        magnitudeLimit: bootstrap.header.magLimit,
        payloadRecordBytes: bootstrap.header.payloadRecordSize,
      },
      rootShard: {
        version: root.shard.header.version,
        nodeRecordBytes: root.shard.header.nodeRecordSize,
        nodeCount: root.shard.header.nodeCount,
        entryNodeCount: root.shard.header.entryNodes.filter((value) => value > 0).length,
      },
      timings: {
        bootstrapMs: round(bootstrapMs),
        rootShardMs: round(rootShardMs),
        queryMs: round(queryDurationMs),
        totalMs: round(performance.now() - totalStartedAt),
      },
      queries: querySummary,
      io: {
        rangeRequests: io.rangeRequests,
        requestedBytes: io.requestedBytes,
        bytesRead: io.bytesRead,
        readTimeMs: round(io.readTimeMs),
      },
      cache: {
        shardCount: sourceSnapshot.cache.shardHeaders,
        shardCacheHits: sourceSnapshot.stats.shardCacheHits,
      },
      queryRecords,
    };
  } finally {
    await file.close();
  }
}

/**
 * @param {Array<{
 *   label: string;
 *   path: string;
 * }>} octrees
 * @param {{
 *   sampleCount?: number;
 *   minRadiusPc?: number;
 *   maxRadiusPc?: number;
 *   points?: Array<{ x: number; y: number; z: number }>;
 * }} [options]
 */
export async function runOctreeFormatSuite(octrees, options = {}) {
  if (!Array.isArray(octrees) || octrees.length === 0) {
    throw new TypeError('At least one labelled octree path is required');
  }

  const results = [];
  for (const octree of octrees) {
    results.push(await runOctreeFormatBenchmark({ ...octree, ...options }));
  }

  return {
    schemaVersion: 1,
    kind: 'star-octree-format',
    createdAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    probe: {
      kind: 'point-path',
      sampleCount: results[0]?.queries.count ?? 0,
      payloadsRead: false,
      note: 'Sequential runs share the operating-system file cache; use repeated runs for timing claims.',
    },
    results,
    comparisons: compareOctreeBenchmarks(results),
  };
}

/**
 * Deterministic log-radius/Fibonacci-sphere points centered on the octree.
 *
 * @param {{
 *   worldCenterX: number;
 *   worldCenterY: number;
 *   worldCenterZ: number;
 *   worldHalfSize: number;
 * }} header
 * @param {{
 *   sampleCount?: number;
 *   minRadiusPc?: number;
 *   maxRadiusPc?: number;
 * }} [options]
 */
export function createOctreeSamplePoints(header, options = {}) {
  const sampleCount = normalizePositiveInteger(
    options.sampleCount,
    DEFAULT_SAMPLE_COUNT,
  );
  const worldLimit = Math.max(Number.EPSILON, header.worldHalfSize * 0.95);
  const maxRadiusPc = Math.min(
    normalizePositiveNumber(options.maxRadiusPc, DEFAULT_MAX_RADIUS_PC),
    worldLimit,
  );
  const minRadiusPc = Math.min(
    normalizePositiveNumber(options.minRadiusPc, DEFAULT_MIN_RADIUS_PC),
    maxRadiusPc,
  );
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const minLog = Math.log(minRadiusPc);
  const maxLog = Math.log(maxRadiusPc);
  const points = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const fraction = (index + 0.5) / sampleCount;
    const radius = Math.exp(minLog + (maxLog - minLog) * fraction);
    const z = 1 - 2 * fraction;
    const planar = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = index * goldenAngle;

    points.push({
      x: header.worldCenterX + radius * Math.cos(angle) * planar,
      y: header.worldCenterY + radius * Math.sin(angle) * planar,
      z: header.worldCenterZ + radius * z,
    });
  }

  return points;
}

/**
 * @param {Array<Awaited<ReturnType<typeof runOctreeFormatBenchmark>>>} results
 */
export function compareOctreeBenchmarks(results) {
  const baseline = results[0];
  if (!baseline) return [];

  return results.slice(1).map((candidate) => ({
    baseline: baseline.label,
    candidate: candidate.label,
    ratios: {
      fileBytes: ratio(candidate.file.bytes, baseline.file.bytes),
      indexBytes: ratio(candidate.file.indexBytes, baseline.file.indexBytes),
      queryMs: ratio(candidate.timings.queryMs, baseline.timings.queryMs),
      bytesRead: ratio(candidate.io.bytesRead, baseline.io.bytesRead),
      inspectedNodes: ratio(
        candidate.queries.inspectedNodes.total,
        baseline.queries.inspectedNodes.total,
      ),
      deepestLevelMean: ratio(
        candidate.queries.deepestLevel.mean,
        baseline.queries.deepestLevel.mean,
      ),
    },
  }));
}

/**
 * @param {import('node:fs/promises').FileHandle} file
 * @param {number} fileSize
 * @param {{
 *   rangeRequests: number;
 *   requestedBytes: number;
 *   bytesRead: number;
 *   readTimeMs: number;
 * }} io
 */
function createFileRangeSource(file, fileSize, io) {
  return {
    persistentCacheAvailable: false,

    async fetchRange(start, end, options = {}) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? createAbortError();
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        throw new RangeError(`Invalid byte range ${start}-${end}`);
      }
      if (start >= fileSize) {
        throw new RangeError(`Byte range ${start}-${end} starts beyond EOF ${fileSize}`);
      }

      const length = Math.min(end, fileSize - 1) - start + 1;
      const buffer = Buffer.allocUnsafe(length);
      const startedAt = performance.now();
      const { bytesRead } = await file.read(buffer, 0, length, start);
      io.readTimeMs += performance.now() - startedAt;
      io.rangeRequests += 1;
      io.requestedBytes += end - start + 1;
      io.bytesRead += bytesRead;

      if (bytesRead !== length) {
        throw new Error(
          `Short read for ${start}-${end}: expected ${length} bytes, received ${bytesRead}`,
        );
      }

      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    },
  };
}

/**
 * @param {{ x: number; y: number; z: number }} point
 * @param {{ centerX: number; centerY: number; centerZ: number; halfSize: number }} node
 */
function pointInsideNode(point, node) {
  return (
    point.x >= node.centerX - node.halfSize &&
    point.x < node.centerX + node.halfSize &&
    point.y >= node.centerY - node.halfSize &&
    point.y < node.centerY + node.halfSize &&
    point.z >= node.centerZ - node.halfSize &&
    point.z < node.centerZ + node.halfSize
  );
}

/**
 * @param {Array<{
 *   durationMs: number;
 *   inspectedNodeCount: number;
 *   selectedNodeCount: number;
 *   payloadNodeCount: number;
 *   terminalNodeCount: number;
 *   deepestLevel: number | null;
 *   compressedPayloadBytes: number;
 *   knownStarRecords: number | null;
 * }>} records
 * @param {number} durationMs
 */
function summarizeQueryRecords(records, durationMs) {
  const inspectedNodes = records.map((record) => record.inspectedNodeCount);
  const selectedNodes = records.map((record) => record.selectedNodeCount);
  const payloadNodes = records.map((record) => record.payloadNodeCount);
  const deepestLevels = records
    .map((record) => record.deepestLevel)
    .filter((value) => value != null);
  const knownStarRecords = records.map((record) => record.knownStarRecords);

  return {
    count: records.length,
    durationMs: round(durationMs),
    queriesPerSecond: round(records.length / (durationMs / 1_000)),
    duration: summarizeNumbers(records.map((record) => record.durationMs)),
    inspectedNodes: summarizeNumbers(inspectedNodes),
    selectedNodes: summarizeNumbers(selectedNodes),
    payloadNodes: summarizeNumbers(payloadNodes),
    terminalQueries: records.filter((record) => record.terminalNodeCount > 0).length,
    terminalQueryFraction: round(
      records.filter((record) => record.terminalNodeCount > 0).length /
        Math.max(1, records.length),
    ),
    terminalNodes: sum(records.map((record) => record.terminalNodeCount)),
    deepestLevel: summarizeNumbers(deepestLevels),
    compressedPayloadBytes: {
      total: sum(records.map((record) => record.compressedPayloadBytes)),
      mean: round(mean(records.map((record) => record.compressedPayloadBytes))),
    },
    knownStarRecords:
      knownStarRecords.every((value) => value != null)
        ? {
            total: sum(knownStarRecords),
            mean: round(mean(knownStarRecords)),
          }
        : null,
  };
}

/** @param {number[]} values */
function summarizeNumbers(values) {
  return {
    total: sum(values),
    mean: round(mean(values)),
    min: values.length ? Math.min(...values) : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

/** @param {number[]} values */
function sum(values) {
  return values.reduce((total, value) => total + Number(value ?? 0), 0);
}

/** @param {number[]} values */
function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

/** @param {number[]} values @param {number} fraction */
function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((sorted.length - 1) * fraction)];
}

/** @param {number} numerator @param {number} denominator */
function ratio(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator);
}

/** @param {unknown} value */
function normalizePoint(value) {
  const point = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const normalized = {
    x: Number(point.x),
    y: Number(point.y),
    z: Number(point.z),
  };
  if (!Object.values(normalized).every(Number.isFinite)) {
    throw new TypeError(`Invalid point ${JSON.stringify(value)}`);
  }
  return normalized;
}

/** @param {unknown} value @param {number} fallback */
function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {number} value */
function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

function createAbortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
