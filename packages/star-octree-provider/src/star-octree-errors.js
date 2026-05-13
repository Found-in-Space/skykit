export const ERR_STAR_OCTREE_INVALID_VIEW = 'ERR_STAR_OCTREE_INVALID_VIEW';
export const ERR_STAR_OCTREE_TRANSFER_UNAVAILABLE =
  'ERR_STAR_OCTREE_TRANSFER_UNAVAILABLE';
export const ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY =
  'ERR_STAR_OCTREE_UNSUPPORTED_STRATEGY';

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {Error & { code: string; details?: Record<string, unknown> }}
 */
export function createStarOctreeError(code, message, details) {
  const error = new Error(message);
  return Object.assign(error, {
    code,
    ...(details ? { details } : {}),
  });
}

/**
 * @param {unknown} error
 */
export function toDeltaError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(error && typeof error === 'object' && 'code' in error
      ? { code: String(/** @type {{ code: unknown }} */ (error).code) }
      : {}),
  };
}
