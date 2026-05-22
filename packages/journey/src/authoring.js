import {
  deleteJourneyEaseLocationGroupHelpers,
  easeJourneyLocationRangeStartEnd,
  equalizeJourneyLocationRangeSpeeds,
  normalizeTimedJourney,
  rebuildJourneyEaseLocationGroup,
} from './index.js';

/**
 * @param {unknown} journeyInput
 * @param {{ anchorId?: string; focusId?: string; timeStepSecs?: number; samplesPerSegment?: number }} [options]
 * @returns {import('./authoring.d.ts').TimedJourneyRetimingResult}
 */
export function equalizeTimedJourneyLocationRangeSpeed(journeyInput, options = {}) {
  const journey = normalizeTimedJourney(journeyInput);
  const result = equalizeJourneyLocationRangeSpeeds(
    journey.locationWaypoints,
    String(options.anchorId ?? ''),
    String(options.focusId ?? ''),
    options,
  );
  return withRetimedJourney(journey, result);
}

/**
 * @param {unknown} journeyInput
 * @param {{ anchorId?: string; focusId?: string; easeSecs?: number; rampSampleSecs?: number; timeStepSecs?: number; samplesPerSegment?: number; groupId?: string; startGroupId?: string; endGroupId?: string; phase?: string; phases?: Iterable<string> }} [options]
 * @returns {import('./authoring.d.ts').TimedJourneyRetimingResult}
 */
export function easeTimedJourneyLocationRange(journeyInput, options = {}) {
  const journey = normalizeTimedJourney(journeyInput);
  const result = easeJourneyLocationRangeStartEnd(
    journey.locationWaypoints,
    String(options.anchorId ?? ''),
    String(options.focusId ?? ''),
    options,
  );
  return withRetimedJourney(journey, result);
}

/**
 * @param {unknown} journeyInput
 * @param {string} groupId
 * @param {{ phase?: string }} [options]
 * @returns {import('./authoring.d.ts').DeleteTimedJourneyEaseLocationGroupResult}
 */
export function deleteTimedJourneyEaseGroup(journeyInput, groupId, options = {}) {
  const journey = normalizeTimedJourney(journeyInput);
  const result = deleteJourneyEaseLocationGroupHelpers(journey.locationWaypoints, groupId, options);
  return withRetimedJourney(journey, result);
}

/**
 * @param {unknown} journeyInput
 * @param {string} groupId
 * @param {{ easeSecs?: number; rampSampleSecs?: number; timeStepSecs?: number; samplesPerSegment?: number; phase?: string }} [options]
 * @returns {import('./authoring.d.ts').TimedJourneyRetimingResult}
 */
export function rebuildTimedJourneyEaseGroup(journeyInput, groupId, options = {}) {
  const journey = normalizeTimedJourney(journeyInput);
  const result = rebuildJourneyEaseLocationGroup(journey.locationWaypoints, groupId, options);
  return withRetimedJourney(journey, result);
}

export {
  deleteTimedJourneyEaseGroup as deleteTimedJourneyEaseLocationGroupHelpers,
  rebuildTimedJourneyEaseGroup as rebuildTimedJourneyEaseLocationGroup,
};

/** @param {import('./index.d.ts').TimedJourney} journey @param {{ locationWaypoints: import('./index.d.ts').TimedJourneyLocationWaypoint[] }} result */
function withRetimedJourney(journey, result) {
  const nextJourney = normalizeTimedJourney({
    ...journey,
    locationWaypoints: result.locationWaypoints,
  });
  return {
    ...result,
    journey: nextJourney,
    locationWaypoints: nextJourney.locationWaypoints,
  };
}
