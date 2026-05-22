import { finiteNumber } from '../utils.js';

/**
 * @param {import('../xr.d.ts').SkykitXrDepthRangeApplyTarget} target
 * @param {import('../xr.d.ts').SkykitXrDepthRange | { near?: number; far?: number; depthNear?: number; depthFar?: number }} range
 * @param {import('../xr.d.ts').SkykitXrDepthRangeApplyOptions} [options]
 * @returns {import('../xr.d.ts').SkykitXrDepthRangeApplyResult}
 */
export function applySkykitXrDepthRange(target, range, options = {}) {
  const session = resolveSessionTarget(target);
  const depthNear = finiteNumber(range?.depthNear ?? range?.near, Number.NaN);
  const depthFar = finiteNumber(range?.depthFar ?? range?.far, Number.NaN);
  if (!Number.isFinite(depthNear) || !Number.isFinite(depthFar) || !(depthNear > 0) || !(depthFar > depthNear)) {
    throw new TypeError('applySkykitXrDepthRange() requires a valid depth range.');
  }
  if (!session || typeof session.updateRenderState !== 'function') {
    if (options.throwOnUnavailable) {
      throw new Error('XRSession.updateRenderState() is not available.');
    }
    return {
      applied: false,
      depthNear,
      depthFar,
      reason: 'missing-updateRenderState',
    };
  }
  try {
    session.updateRenderState({ depthNear, depthFar });
    return { applied: true, depthNear, depthFar };
  } catch (error) {
    if (options.throwOnUnavailable) throw error;
    return {
      applied: false,
      depthNear,
      depthFar,
      reason: 'updateRenderState-failed',
      error,
    };
  }
}

/**
 * @param {unknown} target
 */
function resolveSessionTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const maybeHandle = /** @type {{ session?: unknown }} */ (target);
  const session = maybeHandle.session ?? target;
  return session && typeof session === 'object'
    ? /** @type {{ updateRenderState?: (state: { depthNear: number; depthFar: number }) => void }} */ (session)
    : null;
}
