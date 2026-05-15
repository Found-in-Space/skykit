import { cloneRay, normalizeRay } from './xr-rays.js';

/**
 * @param {import('./index.d.ts').XrPickRouterOptions} [options]
 * @returns {import('./index.d.ts').XrPickRouter}
 */
export function createXrPickRouter(options = {}) {
  const id = options.id ?? 'found-in-space-xr-pick-router';
  let raySource = options.raySource ?? null;
  let blockers = Array.from(options.blockers ?? []);
  let targets = Array.from(options.targets ?? []);
  const onPick = typeof options.onPick === 'function' ? options.onPick : null;
  /** @type {import('./index.d.ts').XrPickRouteResult | null} */
  let lastRoute = null;
  let disposed = false;

  return {
    id,
    route,
    setRaySource,
    setBlockers,
    setTargets,
    getSnapshot,
    dispose,
  };

  /**
   * @param {import('./index.d.ts').XrRayContext} [context]
   */
  function route(context = {}) {
    assertActive();
    const ray = resolveRay(context);
    if (!ray) {
      lastRoute = /** @type {import('./index.d.ts').XrPickRouteResult} */ ({ type: 'miss', ray: null, hit: null, blocker: null, target: null, maxDistance: null });
      onPick?.(lastRoute);
      return cloneRoute(lastRoute);
    }

    let maxDistance = ray.length;
    for (const blocker of blockers) {
      const result = callBlocker(blocker, ray, { ...context, maxDistance });
      if (!result) continue;
      if (result.consumed === true || result.blocked === true) {
        lastRoute = /** @type {import('./index.d.ts').XrPickRouteResult} */ ({
          type: 'blocked',
          ray: cloneRay(ray),
          hit: result.hit ?? null,
          blocker,
          target: null,
          maxDistance,
        });
        onPick?.(lastRoute);
        return cloneRoute(lastRoute);
      }
      const distance = normalizeDistance(result.distance ?? result.maxDistance);
      if (distance != null) {
        maxDistance = maxDistance == null ? distance : Math.min(maxDistance, distance);
      }
    }

    let best = null;
    let bestTarget = null;
    for (const target of targets) {
      const hit = callTarget(target, ray, { ...context, maxDistance });
      if (!hit) continue;
      const distance = normalizeDistance(hit.distance ?? hit.distancePc ?? hit.t);
      if (!best || distance == null || best.distance == null || distance < best.distance) {
        best = { hit, distance };
        bestTarget = target;
      }
    }

    lastRoute = best
      ? /** @type {import('./index.d.ts').XrPickRouteResult} */ ({
          type: 'hit',
          ray: cloneRay(ray),
          hit: best.hit,
          blocker: null,
          target: bestTarget,
          maxDistance,
        })
      : /** @type {import('./index.d.ts').XrPickRouteResult} */ ({
          type: 'miss',
          ray: cloneRay(ray),
          hit: null,
          blocker: null,
          target: null,
          maxDistance,
        });
    onPick?.(lastRoute);
    return cloneRoute(lastRoute);
  }

  /**
   * @param {import('./index.d.ts').XrRaySource | ((context: import('./index.d.ts').XrRayContext) => import('./index.d.ts').XrRay | null) | null} next
   */
  function setRaySource(next) {
    assertActive();
    raySource = next;
  }

  /**
   * @param {Iterable<import('./index.d.ts').XrPickBlocker>} next
   */
  function setBlockers(next) {
    assertActive();
    blockers = Array.from(next ?? []);
  }

  /**
   * @param {Iterable<import('./index.d.ts').XrPickTarget>} next
   */
  function setTargets(next) {
    assertActive();
    targets = Array.from(next ?? []);
  }

  function getSnapshot() {
    return {
      id,
      disposed,
      blockerCount: blockers.length,
      targetCount: targets.length,
      lastRoute: lastRoute ? cloneRoute(lastRoute) : null,
    };
  }

  function dispose() {
    disposed = true;
    blockers = [];
    targets = [];
    raySource = null;
    lastRoute = null;
  }

  /**
   * @param {import('./index.d.ts').XrRayContext} context
   */
  function resolveRay(context) {
    if (!raySource) return null;
    if (typeof raySource === 'function') {
      return normalizeRay(raySource(context), {
        id: `${id}:custom-ray`,
        kind: 'custom',
        handedness: null,
        length: null,
      });
    }
    return raySource.getRay(context);
  }

  function assertActive() {
    if (disposed) {
      throw new Error('XrPickRouter has been disposed.');
    }
  }
}

/**
 * @param {import('./index.d.ts').XrPickBlocker} blocker
 * @param {import('./index.d.ts').XrRay} ray
 * @param {import('./index.d.ts').XrRayContext & { maxDistance?: number | null }} context
 */
function callBlocker(blocker, ray, context) {
  if (typeof blocker === 'function') {
    return blocker(ray, context);
  }
  return blocker.blockRay?.(ray, context) ?? blocker.pick?.(ray, context) ?? null;
}

/**
 * @param {import('./index.d.ts').XrPickTarget} target
 * @param {import('./index.d.ts').XrRay} ray
 * @param {import('./index.d.ts').XrRayContext & { maxDistance?: number | null }} context
 */
function callTarget(target, ray, context) {
  if (typeof target === 'function') {
    return target(ray, context);
  }
  return target.pick?.(ray, context) ?? null;
}

/**
 * @param {unknown} value
 */
function normalizeDistance(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * @param {import('./index.d.ts').XrPickRouteResult} route
 * @returns {import('./index.d.ts').XrPickRouteResult}
 */
function cloneRoute(route) {
  return {
    type: route.type,
    ray: route.ray ? cloneRay(route.ray) : null,
    hit: route.hit,
    blocker: route.blocker,
    target: route.target,
    maxDistance: route.maxDistance,
  };
}
