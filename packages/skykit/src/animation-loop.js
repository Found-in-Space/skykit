import { finiteNumber, positiveFinite } from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitViewer} SkykitViewer
 * @typedef {import('./index.d.ts').SkykitAnimationLoop} SkykitAnimationLoop
 * @typedef {import('./index.d.ts').SkykitAnimationLoopOptions} SkykitAnimationLoopOptions
 */

/**
 * @param {SkykitViewer} viewer
 * @param {SkykitAnimationLoopOptions} [options]
 * @returns {SkykitAnimationLoop}
 */
export function createSkykitAnimationLoop(viewer, options = {}) {
  const requestFrame = options.requestAnimationFrame
    ?? globalThis.requestAnimationFrame?.bind(globalThis)
    ?? ((callback) => setTimeout(() => callback(now()), 16));
  const cancelFrame = options.cancelAnimationFrame
    ?? globalThis.cancelAnimationFrame?.bind(globalThis)
    ?? ((handle) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (handle)));
  const now = options.now
    ?? globalThis.performance?.now?.bind(globalThis.performance)
    ?? Date.now;
  const maxDeltaSeconds = positiveFinite(options.maxDeltaSeconds, 0.1);
  const maxFramesPerSecond = positiveFinite(options.maxFramesPerSecond, Number.POSITIVE_INFINITY);
  const minFrameIntervalMs = Number.isFinite(maxFramesPerSecond)
    ? 1000 / maxFramesPerSecond
    : 0;
  let running = false;
  let disposed = false;
  let frameHandle = /** @type {number | ReturnType<typeof setTimeout> | null} */ (null);
  let lastTimeMs = 0;
  let elapsedSeconds = 0;
  let lastDeltaSeconds = 0;
  let frameCount = 0;
  /** @type {string | null} */
  let lastError = null;

  const loop = {
    start,
    stop,
    dispose,
    getSnapshot,
  };

  if (options.autoStart) {
    start();
  }

  return loop;

  function start() {
    assertActive();
    if (running) return;
    running = true;
    lastTimeMs = finiteNumber(now(), 0);
    frameHandle = requestFrame(tick);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (frameHandle != null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
  }

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
  }

  /** @param {number} timeMs */
  function tick(timeMs) {
    if (!running || disposed) return;
    const currentTimeMs = finiteNumber(timeMs, now());
    if (
      frameCount > 0
      && minFrameIntervalMs > 0
      && currentTimeMs - lastTimeMs < minFrameIntervalMs
    ) {
      frameHandle = requestFrame(tick);
      return;
    }
    const rawDeltaSeconds = Math.max(0, (currentTimeMs - lastTimeMs) / 1000);
    lastTimeMs = currentTimeMs;
    lastDeltaSeconds = Math.min(rawDeltaSeconds, maxDeltaSeconds);
    elapsedSeconds += lastDeltaSeconds;
    frameCount += 1;
    try {
      if (options.render === false) {
        viewer.update(lastDeltaSeconds);
      } else {
        viewer.frame(lastDeltaSeconds);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      running = false;
      frameHandle = null;
      return;
    }
    frameHandle = requestFrame(tick);
  }

  function getSnapshot() {
    return {
      running,
      disposed,
      frameCount,
      elapsedSeconds,
      lastDeltaSeconds,
      lastError,
    };
  }

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitAnimationLoop has been disposed.');
    }
  }
}
