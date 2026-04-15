import { getDatasetSession } from '../core/dataset-session.js';
import { createObserverShellField } from '../fields/observer-shell-field.js';
import { aabbDistance, selectOctreeNodes } from '../fields/octree-selection.js';
import {
  DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  DEFAULT_PAYLOAD_MAX_GAP_BYTES,
  planPayloadRangeBatches,
} from '../services/octree/octree-file-service.js';
import { SCALE } from '../services/octree/scene-scale.js';
import {
  serializeStarDataId,
  toStarDataId,
} from '../services/star-data-id.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });

function normalizePoint(value, fallback = DEFAULT_OBSERVER_PC) {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }

  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { ...fallback };
  }

  return { x, y, z };
}

function createLevelRow(level) {
  return {
    level,
    payloadNodeCount: 0,
    payloadBytes: 0,
    starsLoaded: 0,
    starsRendered: 0,
  };
}

function getLevelRow(levelMap, level) {
  if (!levelMap.has(level)) {
    levelMap.set(level, createLevelRow(level));
  }
  return levelMap.get(level);
}

function finalizeLevelRows(levelMap) {
  return [...levelMap.values()].sort((left, right) => left.level - right.level);
}

function summarizeLevelRows(levelRows) {
  return levelRows.reduce((totals, row) => ({
    payloadNodeCount: totals.payloadNodeCount + row.payloadNodeCount,
    payloadBytes: totals.payloadBytes + row.payloadBytes,
    starsLoaded: totals.starsLoaded + row.starsLoaded,
    starsRendered: totals.starsRendered + row.starsRendered,
  }), {
    payloadNodeCount: 0,
    payloadBytes: 0,
    starsLoaded: 0,
    starsRendered: 0,
  });
}

export function computeApparentMagnitude(observerPc, positionPc, absoluteMagnitude) {
  const dx = positionPc.x - observerPc.x;
  const dy = positionPc.y - observerPc.y;
  const dz = positionPc.z - observerPc.z;
  const distancePc = Math.max(Math.hypot(dx, dy, dz), 1e-6);
  return absoluteMagnitude + 5 * (Math.log10(distancePc) - 1);
}

export function summarizeSelectedPayloadNodes(
  nodes,
  {
    payloadMaxGapBytes = DEFAULT_PAYLOAD_MAX_GAP_BYTES,
    payloadMaxBatchBytes = DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  } = {},
) {
  const levelMap = new Map();
  const payloadNodes = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => node && node.payloadLength > 0);

  for (const node of payloadNodes) {
    const row = getLevelRow(levelMap, node.level);
    row.payloadNodeCount += 1;
    row.payloadBytes += node.payloadLength;
  }

  const byLevel = finalizeLevelRows(levelMap);
  const totals = summarizeLevelRows(byLevel);
  const batches = planPayloadRangeBatches(payloadNodes, {
    maxGapBytes: payloadMaxGapBytes,
    maxBatchBytes: payloadMaxBatchBytes,
  });

  return {
    byLevel,
    totals,
    batches: {
      inputRanges: payloadNodes.length,
      outputBatches: batches.length,
      rawPayloadBytes: batches.reduce((sum, batch) => sum + batch.payloadBytes, 0),
      totalSpanBytes: batches.reduce((sum, batch) => sum + batch.spanBytes, 0),
      largestBatchBytes: batches.reduce((largest, batch) => Math.max(largest, batch.spanBytes), 0),
    },
  };
}

export function summarizeDecodedPayloadEntries(
  entries,
  {
    renderService,
    observerPc = DEFAULT_OBSERVER_PC,
    mDesired,
  } = {},
) {
  const levelMap = new Map();
  if (!renderService || typeof renderService.decodePayload !== 'function') {
    throw new TypeError('summarizeDecodedPayloadEntries() requires a renderService.decodePayload() function');
  }
  if (!Number.isFinite(mDesired)) {
    throw new TypeError('summarizeDecodedPayloadEntries() requires a finite mDesired');
  }

  for (const entry of Array.isArray(entries) ? entries : []) {
    const node = entry?.node;
    if (!node) {
      continue;
    }

    const decoded = renderService.decodePayload(entry.buffer, node);
    const row = getLevelRow(levelMap, node.level);
    row.starsLoaded += decoded.count;

    for (let index = 0; index < decoded.count; index += 1) {
      const positionPc = {
        x: decoded.positions[index * 3] / SCALE,
        y: decoded.positions[index * 3 + 1] / SCALE,
        z: decoded.positions[index * 3 + 2] / SCALE,
      };
      const apparentMagnitude = computeApparentMagnitude(
        observerPc,
        positionPc,
        decoded.magAbs[index],
      );
      if (apparentMagnitude <= mDesired) {
        row.starsRendered += 1;
      }
    }
  }

  const byLevel = finalizeLevelRows(levelMap);
  return {
    byLevel,
    totals: summarizeLevelRows(byLevel),
  };
}

function mergeLevelRows(nodeSummary, decodedSummary) {
  const levelMap = new Map();

  for (const row of nodeSummary.byLevel) {
    levelMap.set(row.level, { ...row });
  }

  for (const row of decodedSummary.byLevel) {
    const merged = getLevelRow(levelMap, row.level);
    merged.starsLoaded = row.starsLoaded;
    merged.starsRendered = row.starsRendered;
  }

  const byLevel = finalizeLevelRows(levelMap);
  return {
    byLevel,
    totals: summarizeLevelRows(byLevel),
  };
}

function normalizeNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function createPickMeta(node, ordinal) {
  return {
    nodeKey: node.nodeKey,
    level: node.level,
    centerX: node.centerX,
    centerY: node.centerY,
    centerZ: node.centerZ,
    gridX: node.gridX,
    gridY: node.gridY,
    gridZ: node.gridZ,
    ordinal,
  };
}

function serializeBookmarkableStarId(pickMeta, datasetSession) {
  const id = toStarDataId(pickMeta, {
    datasetUuid: datasetSession.datasetUuid,
  });

  return {
    id,
    serialized: serializeStarDataId(id),
  };
}

async function maybeResolveSidecarFields(datasetSession, pickMeta, includeSidecarMeta) {
  if (!includeSidecarMeta || !datasetSession.getSidecarService('meta')) {
    return null;
  }

  try {
    return await datasetSession.resolveSidecarMetaFields('meta', pickMeta);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function collectNearestStars(datasetSession, options = {}) {
  const point = normalizePoint(options.point, DEFAULT_OBSERVER_PC);
  const radiusPc = normalizeNonNegativeNumber(options.radiusPc, 10);
  const nearestN = normalizeNonNegativeInteger(options.nearestN, 10);
  const includeSidecarMeta = options.includeSidecarMeta !== false;

  if (nearestN <= 0) {
    return {
      point,
      radiusPc,
      nearestN,
      stars: [],
      stats: {
        candidatePayloadNodeCount: 0,
        decodedStarCount: 0,
        inRadiusStarCount: 0,
      },
    };
  }

  const selection = await selectOctreeNodes({
    datasetSession,
  }, {
    predicate({ geom }) {
      return aabbDistance(
        point.x,
        point.y,
        point.z,
        geom.centerX,
        geom.centerY,
        geom.centerZ,
        geom.halfSize,
      ) <= radiusPc;
    },
  });

  const renderService = datasetSession.getRenderService();
  const payloadNodes = selection.nodes.filter((node) => node.payloadLength > 0);
  const entries = payloadNodes.length > 0
    ? await renderService.fetchNodePayloadBatch(payloadNodes)
    : [];
  const candidates = [];
  let decodedStarCount = 0;

  for (const entry of entries) {
    const node = entry.node;
    const decoded = renderService.decodePayload(entry.buffer, node);
    decodedStarCount += decoded.count;

    for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
      const positionPc = {
        x: decoded.positions[ordinal * 3] / SCALE,
        y: decoded.positions[ordinal * 3 + 1] / SCALE,
        z: decoded.positions[ordinal * 3 + 2] / SCALE,
      };
      const dx = positionPc.x - point.x;
      const dy = positionPc.y - point.y;
      const dz = positionPc.z - point.z;
      const distancePc = Math.hypot(dx, dy, dz);
      if (distancePc > radiusPc) {
        continue;
      }

      const pickMeta = createPickMeta(node, ordinal);
      const bookmark = serializeBookmarkableStarId(pickMeta, datasetSession);
      const temperatureByte = decoded.teffLog8?.[ordinal];

      candidates.push({
        distancePc,
        apparentMagnitude: computeApparentMagnitude(point, positionPc, decoded.magAbs[ordinal]),
        absoluteMagnitude: decoded.magAbs[ordinal],
        ...(temperatureByte != null ? { temperatureByte } : {}),
        positionPc,
        nodeKey: node.nodeKey,
        pickMeta,
        starDataId: bookmark.id,
        bookmarkId: bookmark.serialized,
      });
    }
  }

  candidates.sort((left, right) => left.distancePc - right.distancePc);
  const nearest = candidates.slice(0, nearestN);

  for (const star of nearest) {
    const sidecarMeta = await maybeResolveSidecarFields(
      datasetSession,
      star.pickMeta,
      includeSidecarMeta,
    );
    if (sidecarMeta) {
      star.sidecarMeta = sidecarMeta;
    }
  }

  return {
    point,
    radiusPc,
    nearestN,
    includeSidecarMeta,
    stars: nearest,
    stats: {
      candidatePayloadNodeCount: payloadNodes.length,
      decodedStarCount,
      inRadiusStarCount: candidates.length,
      visitedNodeCount: selection.stats.visitedNodeCount,
      prunedNodeCount: selection.stats.prunedNodeCount,
    },
  };
}

export async function diagnoseObserverShellSelection(options = {}) {
  const octreeUrl = typeof options.octreeUrl === 'string' && options.octreeUrl.trim()
    ? options.octreeUrl.trim()
    : null;
  if (!octreeUrl) {
    throw new TypeError('diagnoseObserverShellSelection() requires an octreeUrl');
  }

  const observerPc = normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC);
  const mDesired = Number(options.mDesired);
  if (!Number.isFinite(mDesired)) {
    throw new TypeError('diagnoseObserverShellSelection() requires a finite mDesired');
  }

  const payloadMaxGapBytes = Number.isFinite(options.payloadMaxGapBytes)
    ? Math.floor(options.payloadMaxGapBytes)
    : DEFAULT_PAYLOAD_MAX_GAP_BYTES;
  const payloadMaxBatchBytes = Number.isFinite(options.payloadMaxBatchBytes)
    ? Math.floor(options.payloadMaxBatchBytes)
    : DEFAULT_PAYLOAD_MAX_BATCH_BYTES;
  const maxLevel = Number.isFinite(options.maxLevel) && options.maxLevel >= 0
    ? Math.floor(options.maxLevel)
    : null;
  const decodePayloads = options.decodePayloads !== false;
  const nearestN = normalizeNonNegativeInteger(options.nearestN, 10);
  const radiusPc = normalizeNonNegativeNumber(options.radiusPc, 10);
  const includeSidecarMeta = options.includeSidecarMeta !== false;

  const datasetSession = getDatasetSession({
    id: 'observer-shell-diagnostic-session',
    octreeUrl,
    ...(typeof options.metaUrl === 'string' && options.metaUrl.trim()
      ? { metaUrl: options.metaUrl.trim() }
      : {}),
  });

  try {
    const fieldOptions = { observerPc };
    if (maxLevel != null) {
      fieldOptions.maxLevel = maxLevel;
    }

    const field = createObserverShellField(fieldOptions);

    const t0 = performance.now();
    const selection = await field.selectNodes({
      datasetSession,
      state: {
        observerPc,
        mDesired,
      },
      size: { width: 1, height: 1 },
      camera: { aspect: 1 },
      phase: 'diagnostic',
    });
    const selectionMs = performance.now() - t0;

    const nodeSummary = summarizeSelectedPayloadNodes(selection.nodes, {
      payloadMaxGapBytes,
      payloadMaxBatchBytes,
    });

    let payloadSummary = {
      byLevel: nodeSummary.byLevel.map((row) => ({ ...row })),
      totals: { ...nodeSummary.totals },
    };

    let payloadFetchMs = 0;
    if (decodePayloads && nodeSummary.totals.payloadNodeCount > 0) {
      const renderService = datasetSession.getRenderService();
      const t1 = performance.now();
      const entries = await renderService.fetchNodePayloadBatch(selection.nodes);
      payloadFetchMs = performance.now() - t1;
      payloadSummary = mergeLevelRows(
        nodeSummary,
        summarizeDecodedPayloadEntries(entries, {
          renderService,
          observerPc,
          mDesired,
        }),
      );
    }

    const t2 = performance.now();
    const nearest = await collectNearestStars(datasetSession, {
      point: observerPc,
      radiusPc,
      nearestN,
      includeSidecarMeta,
    });
    const nearestMs = performance.now() - t2;

    const totalMs = selectionMs + payloadFetchMs + nearestMs;
    const datasetDescription = datasetSession.describe();
    return {
      octreeUrl,
      observerPc,
      mDesired,
      maxLevel,
      decodePayloads,
      timing: {
        selectionMs: Math.round(selectionMs),
        payloadFetchMs: Math.round(payloadFetchMs),
        nearestMs: Math.round(nearestMs),
        totalMs: Math.round(totalMs),
      },
      selectionMeta: selection.meta ?? null,
      payloads: {
        byLevel: payloadSummary.byLevel,
        totals: payloadSummary.totals,
      },
      batches: {
        jsLike: nodeSummary.batches,
      },
      nearest,
      loader: datasetDescription.services.render,
      sidecars: datasetDescription.sidecars,
    };
  } finally {
    datasetSession.dispose();
  }
}
