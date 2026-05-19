import {
  evaluateStarTreeDemandGate,
  normalizeStarTreeDemandThresholds,
} from '@found-in-space/star-trees';

/**
 * @param {{
 *   strategy: import('@found-in-space/star-trees').StarTreeStrategy;
 *   thresholds?: import('@found-in-space/star-trees').StarTreeDemandThresholds;
 *   previousDemandView: import('@found-in-space/star-trees').StarTreeViewState | null;
 *   nextView: import('@found-in-space/star-trees').StarTreeViewState;
 *   reason?: string;
 * }} options
 */
export function evaluateDemandGate(options) {
  return evaluateStarTreeDemandGate(options);
}

/**
 * @param {import('@found-in-space/star-trees').StarTreeDemandThresholds | undefined} thresholds
 */
export function normalizeDemandThresholds(thresholds) {
  return normalizeStarTreeDemandThresholds(thresholds);
}
