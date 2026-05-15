/**
 * @typedef {import('./index.d.ts').BuildTravelVolumeRequestsOptions} BuildTravelVolumeRequestsOptions
 * @typedef {import('./index.d.ts').PathVolumeRequest} PathVolumeRequest
 * @typedef {import('./index.d.ts').PointPc} PointPc
 * @typedef {import('./index.d.ts').SphereVolumeRequest} SphereVolumeRequest
 * @typedef {import('./index.d.ts').StarVolumeRequest} StarVolumeRequest
 * @typedef {import('./index.d.ts').TravelRadiusProfilePoint} TravelRadiusProfilePoint
 * @typedef {import('./index.d.ts').WarmVolumeResult} WarmVolumeResult
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeFetchStrategy} StarOctreeFetchStrategy
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeObjectBatchStreamOptions} StarOctreeObjectBatchStreamOptions
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProductDelta} StarOctreeProductDelta
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeProviderService} StarOctreeProviderService
 * @typedef {import('@found-in-space/star-octree-provider').StarOctreeRuntimeNode} StarOctreeRuntimeNode
 */

const SQRT_3 = Math.sqrt(3);
const EPSILON = 1e-9;

/**
 * @param {Omit<SphereVolumeRequest, 'type'>} options
 * @returns {StarOctreeFetchStrategy}
 */
export function createSphereVolumeStrategy(options) {
  const centerPc = normalizePoint(options.centerPc, 'centerPc');
  const radiusPc = normalizePositiveNumber(options.radiusPc, 'radiusPc');

  return {
    kind: 'custom',
    async selectDemand(context) {
      const result = await context.traversal.select({
        distanceToNode: (node) => distanceToNodeAabbPc(centerPc, node),
        visit(node) {
          const distancePc = distanceToNodeAabbPc(centerPc, node);
          const include = distancePc <= radiusPc;
          return {
            include,
            descend: include,
            distancePc,
            priority: -distancePc,
            reasons: ['sphere-volume'],
            metadata: {
              strategy: 'sphere-volume',
              centerPc,
              radiusPc,
              distancePc,
            },
          };
        },
      });

      return {
        entries: sortEntries(result.entries),
        signature: createEntrySignature(result.entries),
        reasons: ['sphere-volume'],
        metadata: {
          strategy: 'sphere-volume',
          centerPc,
          radiusPc,
          ...result.stats,
        },
      };
    },
  };
}

/**
 * @param {Omit<PathVolumeRequest, 'type'>} options
 * @returns {StarOctreeFetchStrategy}
 */
export function createPathVolumeStrategy(options) {
  const pointsPc = normalizePathPoints(options.pointsPc);
  const radiusPc = normalizePositiveNumber(options.radiusPc, 'radiusPc');

  return {
    kind: 'custom',
    async selectDemand(context) {
      const result = await context.traversal.select({
        distanceToNode: (node) =>
          Math.max(0, distancePointToPathPc(nodeCenter(node), pointsPc) - node.halfSize * SQRT_3),
        visit(node) {
          const centerDistancePc = distancePointToPathPc(nodeCenter(node), pointsPc);
          const capsuleRadiusPc = radiusPc + node.halfSize * SQRT_3;
          const include = centerDistancePc <= capsuleRadiusPc;
          return {
            include,
            descend: include,
            distancePc: centerDistancePc,
            priority: -centerDistancePc,
            reasons: ['path-volume'],
            metadata: {
              strategy: 'path-volume',
              radiusPc,
              centerDistancePc,
              capsuleRadiusPc,
              pointCount: pointsPc.length,
            },
          };
        },
      });

      return {
        entries: sortEntries(result.entries),
        signature: createEntrySignature(result.entries),
        reasons: ['path-volume'],
        metadata: {
          strategy: 'path-volume',
          radiusPc,
          pointCount: pointsPc.length,
          ...result.stats,
        },
      };
    },
  };
}

/**
 * @param {BuildTravelVolumeRequestsOptions} options
 * @returns {PathVolumeRequest[]}
 */
export function buildTravelVolumeRequests(options) {
  const route = createRoute(normalizePathPoints(options.routePointsPc));
  const paddingPc = normalizeNonNegativeNumber(options.paddingPc, 0.5);
  const quantizeStepPc = normalizeNonNegativeNumber(options.quantizeStepPc, 1);
  const defaultRadiusPc = normalizeOptionalPositiveNumber(options.defaultRadiusPc);
  const profile = normalizeRadiusProfile(options.radiusProfile, defaultRadiusPc);

  if (route.points.length < 2) {
    return [];
  }

  if (profile.length === 0) {
    if (!defaultRadiusPc) {
      return [];
    }
    return [{
      type: 'path',
      pointsPc: route.points,
      radiusPc: quantizeRadius(defaultRadiusPc + paddingPc, quantizeStepPc),
    }];
  }

  /** @type {PathVolumeRequest[]} */
  const requests = [];

  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const next = profile[index];
    const slicePoints = extractRouteSlicePoints(route, previous.progress, next.progress);
    if (slicePoints.length < 2) {
      continue;
    }

    const radiusPc = quantizeRadius(
      Math.max(previous.radiusPc, next.radiusPc) + paddingPc,
      quantizeStepPc,
    );
    if (!(radiusPc > 0)) {
      continue;
    }

    const last = requests[requests.length - 1];
    if (
      last &&
      Math.abs(last.radiusPc - radiusPc) < EPSILON &&
      pointDistance(last.pointsPc[last.pointsPc.length - 1], slicePoints[0]) < EPSILON
    ) {
      last.pointsPc.push(...slicePoints.slice(1));
      continue;
    }

    requests.push({
      type: 'path',
      pointsPc: slicePoints,
      radiusPc,
    });
  }

  return requests;
}

/**
 * @param {StarOctreeProviderService} provider
 * @param {StarVolumeRequest} request
 * @param {Omit<StarOctreeObjectBatchStreamOptions, 'strategy'>} [options]
 * @returns {AsyncIterable<StarOctreeProductDelta>}
 */
export function streamVolumeProducts(provider, request, options = {}) {
  return provider.streamObjectBatches({
    ...options,
    strategy: createStrategyForRequest(request),
  });
}

/**
 * @param {StarOctreeProviderService} provider
 * @param {StarVolumeRequest[]} requests
 * @param {Omit<StarOctreeObjectBatchStreamOptions, 'strategy'> & {
 *   onProgress?: (progress: import('./index.d.ts').WarmVolumeProgress) => void;
 * }} [options]
 * @returns {Promise<WarmVolumeResult>}
 */
export async function warmVolumeRequests(provider, requests, options = {}) {
  let productCount = 0;
  let starCount = 0;
  let currentCount = 0;

  for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
    const request = requests[requestIndex];
    for await (const delta of streamVolumeProducts(provider, request, {
      ...options,
      id: options.id
        ? `${options.id}:${requestIndex}`
        : undefined,
      streaming: {
        batchMode: 'payload-range',
        ...options.streaming,
      },
    })) {
      options.onProgress?.({ request, requestIndex, delta });

      if (delta.type === 'data/product-upsert') {
        productCount += 1;
        starCount += delta.product.count;
      } else if (delta.type === 'data/representation-current') {
        currentCount += 1;
      } else if (delta.type === 'data/product-error') {
        throw new Error(delta.error?.message ?? 'Volume warm failed.');
      }
    }
  }

  return {
    requestCount: requests.length,
    productCount,
    starCount,
    currentCount,
  };
}

/**
 * @param {PointPc} point
 * @param {PointPc[]} pointsPc
 * @returns {number}
 */
export function distancePointToPathPc(point, pointsPc) {
  const points = normalizePathPoints(pointsPc);
  let minimum = Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index += 1) {
    minimum = Math.min(
      minimum,
      distancePointToSegment(point, points[index - 1], points[index]),
    );
  }

  return minimum;
}

/**
 * @param {StarVolumeRequest} request
 * @returns {StarOctreeFetchStrategy}
 */
function createStrategyForRequest(request) {
  if (request.type === 'sphere') {
    return createSphereVolumeStrategy({
      centerPc: request.centerPc,
      radiusPc: request.radiusPc,
    });
  }

  if (request.type === 'path') {
    return createPathVolumeStrategy({
      pointsPc: request.pointsPc,
      radiusPc: request.radiusPc,
    });
  }

  throw new TypeError('Unknown star volume request type.');
}

/**
 * @param {import('@found-in-space/star-octree-provider').StarOctreeDemandEntry[]} entries
 */
function sortEntries(entries) {
  return [...entries].sort((left, right) =>
    left.node.level - right.node.level ||
    (right.priority ?? 0) - (left.priority ?? 0) ||
    left.node.nodeKey.localeCompare(right.node.nodeKey),
  );
}

/**
 * @param {import('@found-in-space/star-octree-provider').StarOctreeDemandEntry[]} entries
 */
function createEntrySignature(entries) {
  return sortEntries(entries)
    .map((entry) => entry.node.nodeKey)
    .join('|');
}

/**
 * @param {PointPc} point
 * @param {StarOctreeRuntimeNode} node
 */
function distanceToNodeAabbPc(point, node) {
  const dx = Math.max(Math.abs(point.x - node.centerX) - node.halfSize, 0);
  const dy = Math.max(Math.abs(point.y - node.centerY) - node.halfSize, 0);
  const dz = Math.max(Math.abs(point.z - node.centerZ) - node.halfSize, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * @param {StarOctreeRuntimeNode} node
 * @returns {PointPc}
 */
function nodeCenter(node) {
  return {
    x: node.centerX,
    y: node.centerY,
    z: node.centerZ,
  };
}

/**
 * @param {PointPc} point
 * @param {PointPc} start
 * @param {PointPc} end
 */
function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (!(lengthSquared > 0)) {
    return pointDistance(point, start);
  }

  const t = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx +
    (point.y - start.y) * dy +
    (point.z - start.z) * dz
  ) / lengthSquared));
  return pointDistance(point, {
    x: start.x + dx * t,
    y: start.y + dy * t,
    z: start.z + dz * t,
  });
}

/**
 * @param {PointPc} left
 * @param {PointPc} right
 */
function pointDistance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * @param {PointPc[]} points
 */
function createRoute(points) {
  const segments = [];
  let totalLengthPc = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const lengthPc = pointDistance(start, end);
    if (!(lengthPc > 0)) {
      continue;
    }

    totalLengthPc += lengthPc;
    segments.push({
      start,
      end,
      lengthPc,
      cumulativeEndPc: totalLengthPc,
    });
  }

  return {
    points,
    segments,
    totalLengthPc,
  };
}

/**
 * @param {ReturnType<typeof createRoute>} route
 * @param {number} progress
 * @returns {PointPc | null}
 */
function sampleRoutePosition(route, progress) {
  if (!(route.totalLengthPc > 0)) {
    return null;
  }

  const distancePc = route.totalLengthPc * Math.min(1, Math.max(0, progress));
  let previousEndPc = 0;

  for (const segment of route.segments) {
    if (distancePc <= segment.cumulativeEndPc + EPSILON) {
      const localDistancePc = distancePc - previousEndPc;
      const t = segment.lengthPc > 0
        ? Math.min(1, Math.max(0, localDistancePc / segment.lengthPc))
        : 0;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
        z: segment.start.z + (segment.end.z - segment.start.z) * t,
      };
    }
    previousEndPc = segment.cumulativeEndPc;
  }

  return route.points[route.points.length - 1] ?? null;
}

/**
 * @param {ReturnType<typeof createRoute>} route
 * @param {number} startProgress
 * @param {number} endProgress
 * @returns {PointPc[]}
 */
function extractRouteSlicePoints(route, startProgress, endProgress) {
  const start = Math.min(1, Math.max(0, startProgress));
  const end = Math.min(1, Math.max(start, endProgress));
  const startPoint = sampleRoutePosition(route, start);
  const endPoint = sampleRoutePosition(route, end);
  if (!startPoint || !endPoint) {
    return [];
  }

  const points = [startPoint];
  const startDistancePc = route.totalLengthPc * start;
  const endDistancePc = route.totalLengthPc * end;

  for (const segment of route.segments) {
    if (
      segment.cumulativeEndPc > startDistancePc + EPSILON &&
      segment.cumulativeEndPc < endDistancePc - EPSILON
    ) {
      points.push(segment.end);
    }
  }

  if (pointDistance(points[points.length - 1], endPoint) > EPSILON) {
    points.push(endPoint);
  }

  return points;
}

/**
 * @param {TravelRadiusProfilePoint[] | undefined} profile
 * @param {number | null} defaultRadiusPc
 * @returns {TravelRadiusProfilePoint[]}
 */
function normalizeRadiusProfile(profile, defaultRadiusPc) {
  if (!Array.isArray(profile) || profile.length === 0) {
    return [];
  }

  const points = profile
    .map((point) => ({
      progress: Math.min(1, Math.max(0, Number(point.progress))),
      radiusPc: Number(point.radiusPc),
    }))
    .filter((point) =>
      Number.isFinite(point.progress) &&
      Number.isFinite(point.radiusPc) &&
      point.radiusPc > 0,
    )
    .sort((left, right) => left.progress - right.progress);

  if (points.length === 0) {
    return [];
  }

  const startRadius = points[0].radiusPc ?? defaultRadiusPc;
  const endRadius = points[points.length - 1].radiusPc ?? defaultRadiusPc ?? startRadius;
  if (points[0].progress !== 0) {
    points.unshift({ progress: 0, radiusPc: startRadius });
  }
  if (points[points.length - 1].progress !== 1) {
    points.push({ progress: 1, radiusPc: endRadius });
  }

  return points;
}

/**
 * @param {number} radiusPc
 * @param {number} stepPc
 */
function quantizeRadius(radiusPc, stepPc) {
  if (!(stepPc > 0)) {
    return radiusPc;
  }
  return Math.ceil(radiusPc / stepPc) * stepPc;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {PointPc}
 */
function normalizePoint(value, name) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} must be an { x, y, z } point.`);
  }
  const point = /** @type {Partial<PointPc>} */ (value);
  const normalized = {
    x: Number(point.x),
    y: Number(point.y),
    z: Number(point.z),
  };
  if (
    !Number.isFinite(normalized.x) ||
    !Number.isFinite(normalized.y) ||
    !Number.isFinite(normalized.z)
  ) {
    throw new TypeError(`${name} must contain finite x, y, and z values.`);
  }
  return normalized;
}

/**
 * @param {unknown} points
 * @returns {PointPc[]}
 */
function normalizePathPoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError('pointsPc must contain at least two points.');
  }
  return points.map((point, index) => normalizePoint(point, `pointsPc[${index}]`));
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function normalizePositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || !(number > 0)) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
  return number;
}

/**
 * @param {unknown} value
 */
function normalizeOptionalPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
