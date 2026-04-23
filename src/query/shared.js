import { DEFAULT_MAG_LIMIT } from '../layers/star-field-materials.js';
import { decodeTemperatureK } from '../services/star-picker.js';
import { SCALE } from '../services/octree/scene-scale.js';
import { toStarDataId } from '../services/star-data-id.js';
import { createObserverShellField } from '../fields/observer-shell-field.js';
import { createTargetFrustumField } from '../fields/target-frustum-field.js';
import { aabbDistance, selectOctreeNodes } from '../fields/octree-selection.js';
import { unwrapDatasetSession } from '../loading/create-dataset.js';

export function normalizePoint(point, fallback = null) {
  if (!point || typeof point !== 'object') {
    return fallback ? { ...fallback } : null;
  }

  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback ? { ...fallback } : null;
  }

  return { x, y, z };
}

export function resolveDatasetSession(dataset) {
  const session = unwrapDatasetSession(dataset);
  if (session) {
    return session;
  }

  if (dataset?.getRenderService && dataset?.ensureRenderBootstrap) {
    return dataset;
  }

  throw new TypeError('query functions require a DatasetSession or createDataset() result');
}

function apparentMagnitude(absoluteMagnitude, distancePc) {
  const safeDistance = Math.max(Number(distancePc) || 0, 0.001);
  return absoluteMagnitude + (5 * Math.log10(safeDistance)) - 5;
}

function sortStars(stars, options = {}) {
  const nextStars = [...stars];
  if (typeof options.sortResults === 'function') {
    nextStars.sort(options.sortResults);
    return nextStars;
  }

  switch (options.sortBy) {
    case 'distance':
      nextStars.sort((left, right) => (left.distancePc ?? Number.POSITIVE_INFINITY) - (right.distancePc ?? Number.POSITIVE_INFINITY));
      break;
    case 'apparentMagnitude':
      nextStars.sort((left, right) => (left.apparentMagnitude ?? Number.POSITIVE_INFINITY) - (right.apparentMagnitude ?? Number.POSITIVE_INFINITY));
      break;
    case 'absoluteMagnitude':
      nextStars.sort((left, right) => (left.absoluteMagnitude ?? Number.POSITIVE_INFINITY) - (right.absoluteMagnitude ?? Number.POSITIVE_INFINITY));
      break;
    default:
      break;
  }

  return nextStars;
}

async function attachSidecars(session, stars, includeSidecars = []) {
  if (!Array.isArray(includeSidecars) || includeSidecars.length === 0 || stars.length === 0) {
    return stars;
  }

  await Promise.all(stars.map(async (star) => {
    const sidecars = {};
    await Promise.all(includeSidecars.map(async (name) => {
      sidecars[name] = await session.resolveSidecarMetaFields(name, star.pickMeta);
    }));
    star.sidecars = sidecars;
  }));

  return stars;
}

export async function decodeSelectedStars(session, nodes, options = {}) {
  const bootstrap = options.bootstrap ?? await session.ensureRenderBootstrap();
  const renderService = session.getRenderService();
  const observerPc = normalizePoint(options.observerPc, null);
  const includeSidecars = Array.isArray(options.includeSidecars) ? options.includeSidecars : [];
  const filterStar = typeof options.filterStar === 'function' ? options.filterStar : null;
  const entries = await renderService.fetchNodePayloadBatch(nodes);
  const stars = [];

  for (const { node, buffer } of entries) {
    const decoded = renderService.decodePayload(buffer, node);

    for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
      const positionScene = [
        decoded.positions[ordinal * 3],
        decoded.positions[ordinal * 3 + 1],
        decoded.positions[ordinal * 3 + 2],
      ];
      const positionPc = {
        x: positionScene[0] / SCALE,
        y: positionScene[1] / SCALE,
        z: positionScene[2] / SCALE,
      };
      const distancePc = observerPc
        ? Math.hypot(
          positionPc.x - observerPc.x,
          positionPc.y - observerPc.y,
          positionPc.z - observerPc.z,
        )
        : null;
      const absoluteMagnitude = decoded.magAbs[ordinal];
      const pickMeta = {
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

      const star = {
        id: bootstrap.datasetUuid
          ? toStarDataId(pickMeta, { datasetUuid: bootstrap.datasetUuid })
          : null,
        pickMeta,
        nodeKey: node.nodeKey,
        positionScene,
        positionPc,
        distancePc,
        absoluteMagnitude,
        apparentMagnitude: distancePc != null
          ? apparentMagnitude(absoluteMagnitude, distancePc)
          : null,
        temperatureK: decoded.teffLog8
          ? decodeTemperatureK(decoded.teffLog8[ordinal])
          : null,
      };

      if (!filterStar || filterStar(star, {
        node,
        ordinal,
      }) !== false) {
        stars.push(star);
      }
    }
  }

  const sortedStars = sortStars(stars, options);
  const limitedStars = Number.isFinite(options.limit) && options.limit >= 0
    ? sortedStars.slice(0, Math.floor(options.limit))
    : sortedStars;

  await attachSidecars(session, limitedStars, includeSidecars);
  return limitedStars;
}

function createFieldContext(session, options = {}) {
  const observerPc = normalizePoint(options.observerPc, { x: 0, y: 0, z: 0 });
  const targetPc = normalizePoint(options.targetPc, null);
  const width = Number.isFinite(options.width) ? Math.max(1, Math.floor(options.width)) : 1280;
  const height = Number.isFinite(options.height) ? Math.max(1, Math.floor(options.height)) : 720;

  return {
    datasetSession: session,
    state: {
      observerPc,
      targetPc,
      mDesired: Number.isFinite(options.mDesired)
        ? Number(options.mDesired)
        : DEFAULT_MAG_LIMIT,
    },
    size: { width, height },
    camera: {
      aspect: width / height,
    },
    phase: 'query',
  };
}

export async function resolveVisibleSelection(session, options = {}) {
  const strategy = typeof options.strategy === 'string' && options.strategy.trim()
    ? options.strategy.trim()
    : (options.targetPc ? 'target-frustum' : 'observer-shell');
  const context = createFieldContext(session, options);

  if (typeof options.selectNodes === 'function') {
    return {
      strategy,
      selection: await options.selectNodes(context),
    };
  }

  if (strategy === 'target-frustum') {
    const field = createTargetFrustumField({
      targetPc: options.targetPc,
      verticalFovDeg: options.verticalFovDeg,
      overscanDeg: options.overscanDeg,
      targetRadiusPc: options.targetRadiusPc,
      preloadDistancePc: options.preloadDistancePc,
      nearPc: options.nearPc,
      farPc: options.farPc,
      aspectRatio: options.aspectRatio,
      maxLevel: options.maxLevel,
    });
    return {
      strategy,
      selection: await field.selectNodes(context),
    };
  }

  const field = createObserverShellField({
    observerPc: options.observerPc,
    maxLevel: options.maxLevel,
    motionAdaptiveMaxLevel: options.motionAdaptiveMaxLevel,
  });
  return {
    strategy: 'observer-shell',
    selection: await field.selectNodes(context),
  };
}

export async function selectNodesInSphere(session, options = {}) {
  const centerPc = normalizePoint(options.centerPc ?? options.observerPc, { x: 0, y: 0, z: 0 });
  const radiusPc = Number.isFinite(options.radiusPc) && options.radiusPc > 0
    ? Number(options.radiusPc)
    : 1;

  return selectOctreeNodes(
    {
      datasetSession: session,
      state: {
        observerPc: centerPc,
      },
      phase: 'query',
    },
    {
      maxLevel: options.maxLevel,
      predicate(node) {
        const distancePc = aabbDistance(
          centerPc.x,
          centerPc.y,
          centerPc.z,
          node.geom.centerX,
          node.geom.centerY,
          node.geom.centerZ,
          node.geom.halfSize,
        );
        return {
          include: distancePc <= radiusPc,
          meta: {
            distancePc,
            radiusPc,
          },
        };
      },
      sortNodes: options.sortNodes,
    },
  );
}

export function emitQueryEvent(dataset, event) {
  if (typeof dataset?.emit === 'function') {
    dataset.emit(event);
  }
}
