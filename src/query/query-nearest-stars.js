import {
  decodeSelectedStars,
  emitQueryEvent,
  normalizePoint,
  resolveDatasetSession,
  selectNodesInSphere,
} from './shared.js';

export async function queryNearestStars(dataset, options = {}) {
  const session = resolveDatasetSession(dataset);
  const centerPc = normalizePoint(options.centerPc ?? options.observerPc, { x: 0, y: 0, z: 0 });
  const count = Number.isFinite(options.count) && options.count > 0
    ? Math.floor(options.count)
    : 100;
  const maxRadiusPc = Number.isFinite(options.maxRadiusPc) && options.maxRadiusPc > 0
    ? Number(options.maxRadiusPc)
    : 4096;
  const expansionFactor = Number.isFinite(options.expansionFactor) && options.expansionFactor > 1
    ? Number(options.expansionFactor)
    : 2;
  let radiusPc = Number.isFinite(options.initialRadiusPc) && options.initialRadiusPc > 0
    ? Number(options.initialRadiusPc)
    : 1;
  let iterationCount = 0;
  let selection = null;
  let stars = [];

  emitQueryEvent(dataset, {
    type: 'query/started',
    query: 'nearest-stars',
    centerPc,
    count,
  });

  while (radiusPc <= maxRadiusPc) {
    iterationCount += 1;
    const sphereResult = await selectNodesInSphere(session, {
      centerPc,
      radiusPc,
      maxLevel: options.maxLevel,
    });
    selection = {
      strategy: 'nearest-sphere',
      nodes: sphereResult.nodes,
      meta: {
        ...sphereResult.stats,
        radiusPc,
      },
    };

    const bootstrap = await session.ensureRenderBootstrap();
    const decodedStars = await decodeSelectedStars(session, sphereResult.nodes, {
      observerPc: centerPc,
      bootstrap,
      filterStar(star) {
        return (star.distancePc ?? Number.POSITIVE_INFINITY) <= radiusPc;
      },
      sortBy: 'distance',
    });

    stars = decodedStars;
    if (stars.length >= count || radiusPc >= maxRadiusPc) {
      break;
    }
    radiusPc = Math.min(maxRadiusPc, radiusPc * expansionFactor);
  }

  const limitedStars = stars.slice(0, count);
  if (Array.isArray(options.includeSidecars) && options.includeSidecars.length > 0) {
    await Promise.all(limitedStars.map(async (star) => {
      star.sidecars = {};
      await Promise.all(options.includeSidecars.map(async (name) => {
        star.sidecars[name] = await session.resolveSidecarMetaFields(name, star.pickMeta);
      }));
    }));
  }

  const result = {
    kind: 'nearest-stars',
    centerPc,
    count,
    radiusPc,
    iterationCount,
    selection,
    stars: limitedStars,
  };

  emitQueryEvent(dataset, {
    type: 'query/completed',
    query: 'nearest-stars',
    centerPc,
    count,
    radiusPc,
    starCount: limitedStars.length,
  });

  return result;
}
