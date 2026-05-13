import {
  ERR_STAR_OCTREE_TRANSFER_UNAVAILABLE,
  createStarOctreeError,
} from './star-octree-errors.js';

/** @type {boolean | null} */
let transferableSupport = null;

export function supportsTransferableBuffers() {
  if (transferableSupport !== null) {
    return transferableSupport;
  }

  if (typeof structuredClone !== 'function') {
    transferableSupport = false;
    return transferableSupport;
  }

  try {
    const buffer = new ArrayBuffer(1);
    structuredClone(buffer, { transfer: [buffer] });
    transferableSupport = buffer.byteLength === 0;
  } catch {
    transferableSupport = false;
  }

  return transferableSupport;
}

/**
 * @template T
 * @param {T} value
 * @param {ArrayBuffer[]} buffers
 * @returns {T}
 */
export function cloneWithTransferredBuffers(value, buffers) {
  if (!supportsTransferableBuffers()) {
    throw createStarOctreeError(
      ERR_STAR_OCTREE_TRANSFER_UNAVAILABLE,
      'Transferable star object buffers are not available in this runtime.',
    );
  }

  return structuredClone(value, { transfer: buffers });
}
