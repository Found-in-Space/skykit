import type {
  SpatialPreloadHint,
  SpatialSmoothPathSample,
  SpatialVector3,
  SpatialQuaternion,
} from '@found-in-space/spatial';

export declare const FIS_JOURNEY_FORMAT: 'fis-journey-v1';

export interface JourneySceneSpec {
  sceneId?: string;
  title?: string;
  view?: Record<string, unknown>;
  navigation?: Record<string, unknown>;
  preloadHints?: SpatialPreloadHint[];
  [key: string]: unknown;
}

export interface JourneyTransitionSpec {
  id: string;
  fromSceneId: string;
  toSceneId: string;
  index: number;
  [key: string]: unknown;
}

export interface JourneyGraph {
  initialSceneId: string | null;
  sceneIds: string[];
  transitions: JourneyTransitionSpec[];
  getScene(sceneId: string): JourneySceneSpec | null;
  getTransition(fromSceneId: string, toSceneId: string): JourneyTransitionSpec | null;
  resolveSceneSpec(toSceneId: string, context?: { fromSceneId?: string | null }): JourneySceneSpec | null;
  listResolvedTransitionSpecs(): JourneySceneSpec[];
}

export interface CreateJourneyGraphOptions {
  initialSceneId?: string | null;
  scenes?: Record<string, JourneySceneSpec>;
  transitions?: Iterable<Partial<JourneyTransitionSpec> & {
    from?: string;
    to?: string;
    fromSceneId?: string;
    toSceneId?: string;
  }>;
}

export interface JourneyControllerEvent {
  type: 'journey/scene';
  sceneId: string;
  previousSceneId: string | null;
  source: string;
  spec: JourneySceneSpec | null;
}

export interface JourneyControllerSnapshot {
  disposed: boolean;
  activeSceneId: string | null;
  previousSceneId: string | null;
  sceneIds: string[];
}

export interface JourneyController {
  readonly graph: JourneyGraph;
  goTo(sceneId: string, context?: { source?: string }): JourneySceneSpec | null;
  next(context?: { source?: string }): JourneySceneSpec | null;
  previous(context?: { source?: string }): JourneySceneSpec | null;
  getSnapshot(): JourneyControllerSnapshot;
  subscribe(listener: (event: JourneyControllerEvent) => void): () => void;
  dispose(): void;
}

export interface CreateJourneyControllerOptions extends CreateJourneyGraphOptions {
  graph?: JourneyGraph;
}

export interface TimedJourneyLocationWaypoint {
  id: string;
  timeSecs: number;
  positionPc: SpatialVector3;
  motionGroup?: Record<string, unknown>;
}

export type TimedJourneyCameraLookWaypoint =
  | {
      id: string;
      timeSecs: number;
      kind: 'direction';
      forward: SpatialVector3;
      up: SpatialVector3;
    }
  | {
      id: string;
      timeSecs: number;
      kind: 'target';
      targetPc: SpatialVector3;
      up: SpatialVector3;
      targetGuide?: Record<string, unknown>;
    }
  | {
      id: string;
      timeSecs: number;
      kind: 'quaternion';
      orientation: SpatialQuaternion;
    };

export interface TimedJourneyCue {
  id: string;
  startSecs: number;
  endSecs: number;
  [key: string]: unknown;
}

export interface TimedJourneyGuide {
  id: string;
  label: string;
  [key: string]: unknown;
}

export interface TimedJourneyTrackKeyframe {
  timeSecs: number;
  value: unknown;
}

export interface TimedJourneyTrack {
  id: string;
  interpolation: 'hold' | 'linear' | 'smoothstep';
  keyframes: TimedJourneyTrackKeyframe[];
}

export interface TimedJourney {
  format: string;
  id: string;
  title: string;
  durationSecs: number;
  targetDistancePc: number;
  locationWaypoints: TimedJourneyLocationWaypoint[];
  cameraLookWaypoints: TimedJourneyCameraLookWaypoint[];
  cues: TimedJourneyCue[];
  guides: TimedJourneyGuide[];
  tracks: Record<string, TimedJourneyTrack>;
}

export interface CreateTimedJourneyEvaluatorOptions {
  samplesPerSegment?: number;
  useLinearInterpolation?: boolean;
  targetDistancePc?: number;
  cueFadeSecs?: number;
  preloadStepSecs?: number;
  pathRadiusPc?: number;
  sphereRadiusPc?: number;
  lookaheadSecs?: number;
}

export interface TimedJourneyFrame {
  sceneTimeSecs: number;
  observerPc: SpatialVector3;
  orientationIcrs: SpatialQuaternion;
  cameraQuaternion: SpatialQuaternion;
  targetPc: SpatialVector3;
  cameraForwardPc: SpatialVector3;
  cameraUpPc: SpatialVector3;
  velocityPcPerSec: SpatialVector3;
  velocityUnitVectorPc: SpatialVector3;
  speedPcPerSec: number;
  cue: TimedJourneyCue | null;
  cueOpacity: number;
  tracks: Record<string, unknown>;
  preloadHints: SpatialPreloadHint[];
}

export interface TimedJourneyEvaluator {
  journey: TimedJourney;
  durationSecs: number;
  evaluate(sceneTimeSecs: number): TimedJourneyFrame;
  sample(options?: { stepSecs?: number }): TimedJourneyFrame[];
  getCueAt(timeSecs: number): TimedJourneyCue | null;
  getCueOpacity(timeSecs: number, fadeSecs?: number): number;
  getPreloadHints(): SpatialPreloadHint[];
}

export interface JourneyLocationRangeSpeedStats {
  startId: string;
  endId: string;
  startTimeSecs: number;
  endTimeSecs: number;
  durationSecs: number;
  waypointCount: number;
  segmentCount: number;
  totalLengthPc: number;
  averageSpeedPcPerSec: number;
  minSpeedPcPerSec: number;
  maxSpeedPcPerSec: number;
  movingSegmentCount: number;
  holdSegmentCount: number;
  segments: Array<{
    index: number;
    startId: string;
    endId: string;
    startTimeSecs: number;
    endTimeSecs: number;
    durationSecs: number;
    lengthPc: number;
    held: boolean;
    speedPcPerSec: number;
  }>;
}

export interface JourneyRetimingResult {
  locationWaypoints: TimedJourneyLocationWaypoint[];
  before: JourneyLocationRangeSpeedStats | null;
  after: JourneyLocationRangeSpeedStats | null;
  changedIds: string[];
  insertedIds: string[];
  insertedCount: number;
  effectiveEaseSecs?: number;
  groupId?: string;
}

export declare function createJourneyGraph(options?: CreateJourneyGraphOptions): JourneyGraph;
export declare function createJourneyController(options?: CreateJourneyControllerOptions): JourneyController;
export declare function normalizeTimedJourney(journeyInput?: unknown): TimedJourney;
export declare function createTimedJourneyEvaluator(
  journeyInput: unknown,
  options?: CreateTimedJourneyEvaluatorOptions
): TimedJourneyEvaluator;
export declare function evaluateTimedJourneyAtTime(
  journeyInput: unknown,
  sceneTimeSecs: number,
  options?: CreateTimedJourneyEvaluatorOptions
): TimedJourneyFrame;
export declare function getTimedJourneyCueAt(journey: TimedJourney, timeSecs: number): TimedJourneyCue | null;
export declare function getTimedJourneyCueOpacity(cue: TimedJourneyCue, timeSecs: number, fadeSecs?: number): number;
export declare function getJourneyLocationRangeSpeedStats(
  locationWaypoints: Iterable<unknown>,
  anchorId: string,
  focusId: string,
  options?: { samplesPerSegment?: number }
): JourneyLocationRangeSpeedStats | null;
export declare function equalizeJourneyLocationRangeSpeeds(
  locationWaypoints: Iterable<unknown>,
  anchorId: string,
  focusId: string,
  options?: { samplesPerSegment?: number }
): JourneyRetimingResult;
export declare function easeJourneyLocationRangeStartEnd(
  locationWaypoints: Iterable<unknown>,
  anchorId: string,
  focusId: string,
  options?: { easeSecs?: number; rampSampleSecs?: number; samplesPerSegment?: number; groupId?: string }
): JourneyRetimingResult;

export type { SpatialPreloadHint, SpatialSmoothPathSample, SpatialVector3, SpatialQuaternion };
