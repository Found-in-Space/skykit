import { getDatasetSession } from '../core/dataset-session.js';
import { createObserverShellField } from '../fields/observer-shell-field.js';
import {
  DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  DEFAULT_PAYLOAD_MAX_GAP_BYTES,
  planPayloadRangeBatches,
} from '../services/octree/octree-file-service.js';
import { SCALE } from '../services/octree/scene-scale.js';

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

  const datasetSession = getDatasetSession({
    id: 'observer-shell-diagnostic-session',
    octreeUrl,
  });

  try {
    const fieldOptions = { observerPc };
    if (maxLevel != null) {
      fieldOptions.maxLevel = maxLevel;
    }

    const field = createObserverShellField(fieldOptions);
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

    const nodeSummary = summarizeSelectedPayloadNodes(selection.nodes, {
      payloadMaxGapBytes,
      payloadMaxBatchBytes,
    });

    let payloadSummary = {
      byLevel: nodeSummary.byLevel.map((row) => ({ ...row })),
      totals: { ...nodeSummary.totals },
    };

    if (decodePayloads && nodeSummary.totals.payloadNodeCount > 0) {
      const renderService = datasetSession.getRenderService();
      const entries = await renderService.fetchNodePayloadBatch(selection.nodes);
      payloadSummary = mergeLevelRows(
        nodeSummary,
        summarizeDecodedPayloadEntries(entries, {
          renderService,
          observerPc,
          mDesired,
        }),
      );
    }

    const datasetDescription = datasetSession.describe();
    return {
      octreeUrl,
      observerPc,
      mDesired,
      maxLevel,
      decodePayloads,
      selectionMeta: selection.meta ?? null,
      payloads: {
        byLevel: payloadSummary.byLevel,
        totals: payloadSummary.totals,
      },
      batches: {
        jsLike: nodeSummary.batches,
      },
      loader: datasetDescription.services.render,
    };
  } finally {
    datasetSession.dispose();
  }
}
