import {
  evaluateStarCellStrategyChange,
  normalizeStarTreeDemandThresholds,
} from '@found-in-space/star-trees';

/**
 * @param {{
 *   strategy: import('@found-in-space/star-trees').StarCellStrategy;
 *   thresholds?: import('@found-in-space/star-trees').StarTreeDemandThresholds;
 *   previousAnchor: import('@found-in-space/star-trees').StarStrategyAnchor | null;
 *   nextAnchor: import('@found-in-space/star-trees').StarStrategyAnchor;
 *   reason?: string;
 * }} options
 */
export function evaluateDemandGate(options) {
  return evaluateStarCellStrategyChange(options);
}

/**
 * @param {import('@found-in-space/star-trees').StarTreeDemandThresholds | undefined} thresholds
 */
export function normalizeDemandThresholds(thresholds) {
  return normalizeStarTreeDemandThresholds(thresholds);
}
