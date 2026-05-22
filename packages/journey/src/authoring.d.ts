import type {
  DeleteJourneyEaseLocationGroupResult,
  JourneyRetimingResult,
  TimedJourney,
} from './index.js';

export interface TimedJourneyRangeOptions {
  anchorId: string;
  focusId: string;
  timeStepSecs?: number;
  samplesPerSegment?: number;
}

export interface TimedJourneyEaseRangeOptions extends TimedJourneyRangeOptions {
  easeSecs?: number;
  rampSampleSecs?: number;
  groupId?: string;
  startGroupId?: string;
  endGroupId?: string;
  phase?: 'start' | 'end';
  phases?: Iterable<'start' | 'end'>;
}

export interface TimedJourneyRetimingResult extends JourneyRetimingResult {
  journey: TimedJourney;
}

export interface DeleteTimedJourneyEaseLocationGroupResult extends DeleteJourneyEaseLocationGroupResult {
  journey: TimedJourney;
}

export declare function equalizeTimedJourneyLocationRangeSpeed(
  journey: unknown,
  options: TimedJourneyRangeOptions
): TimedJourneyRetimingResult;

export declare function easeTimedJourneyLocationRange(
  journey: unknown,
  options: TimedJourneyEaseRangeOptions
): TimedJourneyRetimingResult;

export declare function deleteTimedJourneyEaseGroup(
  journey: unknown,
  groupId: string,
  options?: { phase?: 'start' | 'end' }
): DeleteTimedJourneyEaseLocationGroupResult;

export declare function rebuildTimedJourneyEaseGroup(
  journey: unknown,
  groupId: string,
  options?: {
    easeSecs?: number;
    rampSampleSecs?: number;
    timeStepSecs?: number;
    samplesPerSegment?: number;
    phase?: 'start' | 'end';
  }
): TimedJourneyRetimingResult;

export {
  deleteTimedJourneyEaseGroup as deleteTimedJourneyEaseLocationGroupHelpers,
  rebuildTimedJourneyEaseGroup as rebuildTimedJourneyEaseLocationGroup,
};
