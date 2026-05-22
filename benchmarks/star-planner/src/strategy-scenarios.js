import {
  combineStrategies,
  createLookaheadStrategy,
  createObserverShellStrategy,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createTargetFrustumStrategy,
} from '@found-in-space/star-trees';

export const STRATEGY_SCENARIOS = Object.freeze([
  'observer-shell',
  'target-frustum',
  'sphere-volume',
  'path-volume',
  'composite-volume',
  'lookahead-warm',
]);

/**
 * @param {string} name
 * @param {{
 *   observerPc: { x: number; y: number; z: number };
 *   targetPc: { x: number; y: number; z: number };
 *   pathPreviewPc: Array<{ x: number; y: number; z: number }>;
 * }} frame
 */
export function createStrategyForFrame(name, frame) {
  switch (name) {
    case 'observer-shell':
      return createObserverShellStrategy();
    case 'target-frustum':
      return createTargetFrustumStrategy({
        verticalFovDeg: 58,
        overscanDeg: 6,
        nearPc: 0.1,
        farPc: 220,
      });
    case 'sphere-volume':
      return createSphereVolumeStrategy({
        centerPc: frame.observerPc,
        radiusPc: 128,
      });
    case 'path-volume':
      return createPathVolumeStrategy({
        pointsPc: frame.pathPreviewPc,
        radiusPc: 42,
      });
    case 'composite-volume':
      return combineStrategies([
        createSphereVolumeStrategy({
          centerPc: frame.observerPc,
          radiusPc: 96,
        }),
        createPathVolumeStrategy({
          pointsPc: frame.pathPreviewPc,
          radiusPc: 36,
        }),
      ]);
    case 'lookahead-warm':
      return combineStrategies([
        createObserverShellStrategy(),
        createLookaheadStrategy({
          base: createObserverShellStrategy(),
          horizonSecs: 2,
          tickSecs: 2,
        }),
      ]);
    default:
      throw new TypeError(`Unknown star planner strategy scenario: ${name}`);
  }
}

/**
 * @param {{
 *   observerPc: { x: number; y: number; z: number };
 *   targetPc: { x: number; y: number; z: number };
 *   velocityPcPerSec: { x: number; y: number; z: number };
 *   limitingMagnitude: number;
 *   mDesired: number;
 * }} frame
 */
export function createViewForFrame(frame) {
  return {
    revision: frame.index + 1,
    observerPc: frame.observerPc,
    targetPc: frame.targetPc,
    limitingMagnitude: frame.limitingMagnitude,
    mDesired: frame.mDesired,
    aspectRatio: 16 / 9,
    verticalFovDeg: 58,
    nearPc: 0.1,
    farPc: 220,
    motion: {
      velocityPcPerSec: frame.velocityPcPerSec,
      speedPcPerSec: Math.hypot(
        frame.velocityPcPerSec.x,
        frame.velocityPcPerSec.y,
        frame.velocityPcPerSec.z,
      ),
      lookaheadSecs: 2,
    },
  };
}

export function createCustomStrategyProbeValue() {
  return {
    createAnchor(view) {
      return { view };
    },
    createEvaluator(anchor) {
      return {
        evaluateCell(cell) {
          const distancePc = Math.hypot(
            cell.centerX - anchor.view.observerPc.x,
            cell.centerY - anchor.view.observerPc.y,
            cell.centerZ - anchor.view.observerPc.z,
          );
          return {
            include: distancePc <= 128,
            descend: distancePc <= 160,
            emit: distancePc <= 128,
            priority: {
              lane: 'live',
              band: 0,
              score: 1 / Math.max(1, distancePc),
            },
            reasons: ['benchmark-custom-probe'],
          };
        },
      };
    },
    diff() {
      return { kind: 'reset', reason: 'benchmark-probe' };
    },
  };
}
