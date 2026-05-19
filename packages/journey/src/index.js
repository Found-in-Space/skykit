import {
  ZERO_VECTOR,
  createSpatialPositionTrack,
  createSpatialSmoothPath,
  evaluateSpatialPositionTrack,
  materializeSpatialPathSamples,
  normalizeTimedSpatialPositionWaypoints,
  normalizeVector3,
  scaleVector,
  vectorLength,
} from '@found-in-space/spatial';

export const FIS_JOURNEY_FORMAT = 'fis-journey-v1';

const EPSILON = 1e-9;
const DEFAULT_TARGET_DISTANCE_PC = 100;
const DEFAULT_TIME_STEP_SECS = 0.05;
const DEFAULT_EASE_SECS = 3;
const DEFAULT_RAMP_SAMPLE_SECS = 0.5;
const DEFAULT_INTERACTIVE_TRAVEL_SECS = 5;
const DEFAULT_INTERACTIVE_SAMPLE_STEP_SECS = 1 / 60;
const DEFAULT_INTERACTIVE_ANGULAR_SPEED = 0.1;

/**
 * Canonical authored interactive journey API. Lessons describe targets,
 * ordered scenes, orbit camera intent, and default travel policy; downstream
 * packages turn that intent into geometry and motion.
 *
 * @param {import('./index.d.ts').CreateJourneyOptions} [options]
 * @returns {import('./index.d.ts').JourneyDefinition}
 */
export function createJourney(options = {}) {
  const source = /** @type {Record<string, unknown>} */ (
    options && typeof options === 'object' ? options : {}
  );
  const targets = normalizeJourneyTargets(source.targets);
  const scenes = normalizeJourneyScenes(source.scenes);
  const sceneIds = normalizeJourneySceneOrder(source.order, scenes);
  const initialSceneId = resolveInitialJourneyScene(source.initial, sceneIds);
  const travel = normalizeJourneyTravel(source.travel);
  const transitions = normalizeJourneyTransitions(source.transitions, sceneIds, travel);
  const graph = createJourneyGraph({
    initialSceneId,
    scenes: Object.fromEntries(sceneIds.map((sceneId) => [sceneId, scenes[sceneId]])),
    transitions,
  });

  return {
    ...graph,
    id: typeof source.id === 'string' ? source.id : null,
    title: typeof source.title === 'string' ? source.title : null,
    targets,
    travel,
    order: [...sceneIds],
  };
}

/**
 * @param {{ initialSceneId?: string | null; scenes?: Record<string, object>; transitions?: Iterable<object> }} [options]
 * @returns {import('./index.d.ts').JourneyGraph}
 */
export function createJourneyGraph(options = {}) {
  const sceneMap = new Map(
    Object.entries(options.scenes ?? {}).map(([sceneId, scene]) => [
      sceneId,
      { ...scene, sceneId },
    ]),
  );
  const transitions = Array.from(options.transitions ?? []).map((transition, index) => {
    const source = /** @type {{ id?: unknown; fromSceneId?: unknown; toSceneId?: unknown }} */ (transition);
    const fromSceneId = source.fromSceneId;
    const toSceneId = source.toSceneId;
    if (typeof fromSceneId !== 'string' || typeof toSceneId !== 'string') {
      throw new TypeError('Journey transitions require string fromSceneId/toSceneId values.');
    }
    return {
      .../** @type {Record<string, unknown>} */ (transition),
      id: String(source.id ?? `${fromSceneId}->${toSceneId}`),
      fromSceneId,
      toSceneId,
      index,
    };
  });
  const transitionMap = new Map(transitions.map((transition) => [
    `${transition.fromSceneId}->${transition.toSceneId}`,
    transition,
  ]));

  return {
    initialSceneId: options.initialSceneId ?? null,
    sceneIds: Array.from(sceneMap.keys()),
    transitions,
    getScene(sceneId) {
      return sceneMap.get(sceneId) ?? null;
    },
    getTransition(fromSceneId, toSceneId) {
      return transitionMap.get(`${fromSceneId}->${toSceneId}`) ?? null;
    },
    resolveSceneSpec(toSceneId, context = {}) {
      const scene = sceneMap.get(toSceneId);
      if (!scene) return null;
      const fromSceneId = typeof context.fromSceneId === 'string' ? context.fromSceneId : null;
      const transition = fromSceneId ? transitionMap.get(`${fromSceneId}->${toSceneId}`) : null;
      return {
        ...scene,
        ...(transition ?? {}),
        sceneId: toSceneId,
        ...(transition ? {
          transitionId: transition.id,
          fromSceneId: transition.fromSceneId,
          toSceneId: transition.toSceneId,
        } : {}),
      };
    },
    listResolvedTransitionSpecs() {
      return transitions
        .map((transition) => this.resolveSceneSpec(transition.toSceneId, { fromSceneId: transition.fromSceneId }))
        .filter(Boolean);
    },
  };
}

/**
 * @param {import('./index.d.ts').CreateJourneyControllerOptions} [options]
 * @returns {import('./index.d.ts').JourneyController}
 */
export function createJourneyController(options = {}) {
  const graph = options.graph ?? createJourneyGraph(options);
  let activeSceneId = options.initialSceneId ?? graph.initialSceneId ?? graph.sceneIds[0] ?? null;
  let previousSceneId = /** @type {string | null} */ (null);
  /** @type {Set<(event: import('./index.d.ts').JourneyControllerEvent) => void>} */
  const listeners = new Set();
  let disposed = false;

  function emit(event) {
    for (const listener of listeners) listener(event);
  }

  return {
    graph,
    goTo(sceneId, context = {}) {
      assertActive();
      if (!graph.getScene(sceneId)) return null;
      const fromSceneId = activeSceneId;
      const spec = graph.resolveSceneSpec(sceneId, { fromSceneId }) ?? null;
      previousSceneId = fromSceneId;
      activeSceneId = sceneId;
      emit({
        type: 'journey/scene',
        sceneId,
        previousSceneId,
        source: String(context.source ?? 'controller'),
        spec,
      });
      return spec;
    },
    next(context = {}) {
      const index = Math.max(0, graph.sceneIds.indexOf(activeSceneId ?? ''));
      return this.goTo(graph.sceneIds[Math.min(graph.sceneIds.length - 1, index + 1)] ?? activeSceneId, context);
    },
    previous(context = {}) {
      const index = Math.max(0, graph.sceneIds.indexOf(activeSceneId ?? ''));
      return this.goTo(graph.sceneIds[Math.max(0, index - 1)] ?? activeSceneId, context);
    },
    getSnapshot() {
      return {
        disposed,
        activeSceneId,
        previousSceneId,
        sceneIds: [...graph.sceneIds],
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };

  function assertActive() {
    if (disposed) throw new Error('JourneyController has been disposed.');
  }
}

/**
 * @param {unknown} journeyInput
 * @returns {import('./index.d.ts').TimedJourney}
 */
export function normalizeTimedJourney(journeyInput = {}) {
  const source = /** @type {Record<string, unknown>} */ (journeyInput && typeof journeyInput === 'object' ? journeyInput : {});
  const durationSecs = Math.max(EPSILON, finiteNumber(source.durationSecs, 60));
  return {
    format: String(source.format ?? FIS_JOURNEY_FORMAT),
    id: String(source.id ?? 'journey'),
    title: String(source.title ?? 'Journey'),
    durationSecs,
    targetDistancePc: positiveFinite(source.targetDistancePc, DEFAULT_TARGET_DISTANCE_PC),
    locationWaypoints: normalizeTimedSpatialPositionWaypoints(source.locationWaypoints ?? [])
      .map((waypoint) => ({
        id: waypoint.id,
        timeSecs: waypoint.timeSecs,
        positionPc: waypoint.position,
        ...(waypoint.motionGroup ? { motionGroup: waypoint.motionGroup } : {}),
      })),
    cameraLookWaypoints: normalizeCameraLookWaypoints(source.cameraLookWaypoints ?? source.cameraWaypoints ?? []),
    cues: normalizeCues(source.cues ?? []),
    guides: normalizeGuides(source.guides ?? []),
    tracks: normalizeTracks(source.tracks ?? {}),
  };
}

/**
 * @param {unknown} journeyInput
 * @param {import('./index.d.ts').CreateTimedJourneyEvaluatorOptions} [options]
 * @returns {import('./index.d.ts').TimedJourneyEvaluator}
 */
export function createTimedJourneyEvaluator(journeyInput, options = {}) {
  const journey = normalizeTimedJourney(journeyInput);
  const path = createSpatialSmoothPath({
    durationSecs: journey.durationSecs,
    targetDistance: options.targetDistancePc ?? journey.targetDistancePc,
    positionWaypoints: journey.locationWaypoints.map((waypoint) => ({
      id: waypoint.id,
      timeSecs: waypoint.timeSecs,
      positionPc: waypoint.positionPc,
      motionGroup: waypoint.motionGroup,
    })),
    orientationWaypoints: journey.cameraLookWaypoints,
  }, {
    samplesPerSegment: options.samplesPerSegment,
    useLinearInterpolation: options.useLinearInterpolation,
    targetDistance: options.targetDistancePc ?? journey.targetDistancePc,
  });
  const preloadHints = path.materializePreloadHints({
    stepSecs: options.preloadStepSecs ?? 1,
    pathRadiusPc: options.pathRadiusPc,
    sphereRadiusPc: options.sphereRadiusPc,
    lookaheadSecs: options.lookaheadSecs,
  });

  function evaluate(sceneTimeSecs) {
    const timeSecs = clamp(finiteNumber(sceneTimeSecs, 0), 0, journey.durationSecs);
    const sample = path.evaluate(timeSecs);
    const cue = getTimedJourneyCueAt(journey, timeSecs);
    return {
      sceneTimeSecs: timeSecs,
      observerPc: sample.pose.position,
      orientationIcrs: sample.pose.orientation,
      cameraQuaternion: sample.pose.orientation,
      targetPc: sample.target,
      cameraForwardPc: sample.forward,
      cameraUpPc: sample.up,
      velocityPcPerSec: sample.velocity,
      velocityUnitVectorPc: sample.velocityUnit,
      speedPcPerSec: sample.speed,
      cue,
      cueOpacity: cue ? getTimedJourneyCueOpacity(cue, timeSecs, options.cueFadeSecs) : 0,
      tracks: evaluateTracks(journey.tracks, timeSecs),
      preloadHints,
    };
  }

  return {
    journey,
    durationSecs: journey.durationSecs,
    evaluate,
    sample(sampleOptions = {}) {
      const stepSecs = positiveFinite(sampleOptions.stepSecs, 1);
      return materializeSpatialPathSamples(path, { stepSecs })
        .map((sample) => evaluate(sample.timeSecs));
    },
    getCueAt(timeSecs) {
      return getTimedJourneyCueAt(journey, timeSecs);
    },
    getCueOpacity(timeSecs, fadeSecs) {
      const cue = getTimedJourneyCueAt(journey, timeSecs);
      return cue ? getTimedJourneyCueOpacity(cue, timeSecs, fadeSecs) : 0;
    },
    getPreloadHints() {
      return preloadHints;
    },
  };
}

/** @param {unknown} journeyInput @param {number} sceneTimeSecs @param {import('./index.d.ts').CreateTimedJourneyEvaluatorOptions} [options] */
export function evaluateTimedJourneyAtTime(journeyInput, sceneTimeSecs, options = {}) {
  return createTimedJourneyEvaluator(journeyInput, options).evaluate(sceneTimeSecs);
}

/** @param {import('./index.d.ts').TimedJourney} journey @param {number} timeSecs */
export function getTimedJourneyCueAt(journey, timeSecs) {
  const time = finiteNumber(timeSecs, 0);
  return journey.cues.find((cue) => time >= cue.startSecs && time <= cue.endSecs) ?? null;
}

/** @param {import('./index.d.ts').TimedJourneyCue} cue @param {number} timeSecs @param {number} [fadeSecs] */
export function getTimedJourneyCueOpacity(cue, timeSecs, fadeSecs = 0.5) {
  const fade = Math.max(EPSILON, finiteNumber(fadeSecs, 0.5));
  const time = finiteNumber(timeSecs, 0);
  const fadeIn = clamp((time - cue.startSecs) / fade, 0, 1);
  const fadeOut = clamp((cue.endSecs - time) / fade, 0, 1);
  return Math.min(fadeIn, fadeOut);
}

/**
 * @param {Iterable<unknown>} locationWaypoints
 * @param {string} anchorId
 * @param {string} focusId
 * @param {{ samplesPerSegment?: number }} [options]
 */
export function getJourneyLocationRangeSpeedStats(locationWaypoints, anchorId, focusId, options = {}) {
  const context = rangeContext(locationWaypoints, anchorId, focusId, options);
  if (!context) return null;
  return statsFromRangeContext(context);
}

/**
 * @param {Iterable<unknown>} locationWaypoints
 * @param {{ samplesPerSegment?: number }} [options]
 * @returns {import('./index.d.ts').JourneyLocationArcSegment[]}
 */
export function getJourneyLocationArcSegments(locationWaypoints, options = {}) {
  const sorted = sortLocationWaypoints(locationWaypoints);
  const track = createSpatialPositionTrack(sorted.map((waypoint) => ({
    id: waypoint.id,
    timeSecs: waypoint.timeSecs,
    positionPc: waypoint.positionPc,
  })), options);
  return track.segments.map((segment) => ({
    index: segment.index,
    startId: segment.start.id,
    endId: segment.end.id,
    startTimeSecs: segment.start.timeSecs,
    endTimeSecs: segment.end.timeSecs,
    durationSecs: segment.durationSecs,
    lengthPc: segment.length,
    held: segment.held,
    speedPcPerSec: segment.speed,
  }));
}

/**
 * @param {Iterable<unknown>} locationWaypoints
 * @param {number} segmentIndex
 * @param {number} distancePc
 * @param {{ samplesPerSegment?: number }} [options]
 * @returns {import('@found-in-space/spatial').SpatialVector3}
 */
export function sampleJourneyLocationArcPoint(locationWaypoints, segmentIndex, distancePc, options = {}) {
  const sorted = sortLocationWaypoints(locationWaypoints);
  const track = createSpatialPositionTrack(sorted.map((waypoint) => ({
    id: waypoint.id,
    timeSecs: waypoint.timeSecs,
    positionPc: waypoint.positionPc,
  })), options);
  const segment = track.segments[segmentIndex];
  if (!segment) return { ...(sorted[sorted.length - 1]?.positionPc ?? ZERO_VECTOR) };
  if (segment.held || segment.length <= EPSILON) return { ...segment.start.position };
  const targetDistance = clamp(finiteNumber(distancePc, 0), 0, segment.length);
  return pointAtArcDistance(segment.arc.samples, targetDistance);
}

/** @param {ReturnType<typeof rangeContext>} context */
function statsFromRangeContext(context) {
  if (!context) return null;
  const moving = context.segments.filter((segment) => !segment.held && segment.length > EPSILON);
  const totalLengthPc = context.segments.reduce((sum, segment) => sum + segment.length, 0);
  const movingDurationSecs = moving.reduce((sum, segment) => sum + Math.max(0, segment.durationSecs), 0);
  const speeds = moving.map((segment) => segment.speed).filter(Number.isFinite);
  return {
    startId: context.start.id,
    endId: context.end.id,
    startTimeSecs: context.start.timeSecs,
    endTimeSecs: context.end.timeSecs,
    durationSecs: Math.max(0, context.end.timeSecs - context.start.timeSecs),
    waypointCount: context.rangeWaypoints.length,
    segmentCount: context.segments.length,
    totalLengthPc,
    averageSpeedPcPerSec: movingDurationSecs > EPSILON ? totalLengthPc / movingDurationSecs : 0,
    minSpeedPcPerSec: speeds.length ? Math.min(...speeds) : 0,
    maxSpeedPcPerSec: speeds.length ? Math.max(...speeds) : 0,
    movingSegmentCount: moving.length,
    holdSegmentCount: context.segments.length - moving.length,
    segments: context.segments.map((segment) => ({
      index: segment.index,
      startId: segment.start.id,
      endId: segment.end.id,
      startTimeSecs: segment.start.timeSecs,
      endTimeSecs: segment.end.timeSecs,
      durationSecs: segment.durationSecs,
      lengthPc: segment.length,
      held: segment.held,
      speedPcPerSec: segment.speed,
    })),
  };
}

/**
 * @param {Iterable<unknown>} locationWaypoints
 * @param {string} anchorId
 * @param {string} focusId
 * @param {{ samplesPerSegment?: number }} [options]
 */
export function equalizeJourneyLocationRangeSpeeds(locationWaypoints, anchorId, focusId, options = {}) {
  const context = rangeContext(locationWaypoints, anchorId, focusId, options);
  if (!context || context.movementLength <= EPSILON || context.movementDuration <= EPSILON) {
    return noRetimingChange(locationWaypoints, context?.before ?? null);
  }
  const next = context.sorted.map(cloneLocationWaypoint);
  let traversedLength = 0;
  const changedIds = [];
  for (const segment of context.segments) {
    if (!segment.held && segment.length > EPSILON) traversedLength += segment.length;
    const waypointIndex = segment.index + 1;
    if (waypointIndex <= context.startIndex || waypointIndex >= context.endIndex) continue;
    const waypoint = next[waypointIndex];
    const nextTime = context.start.timeSecs + (traversedLength / context.movementLength) * context.movementDuration;
    if (Math.abs(waypoint.timeSecs - nextTime) > EPSILON) changedIds.push(waypoint.id);
    waypoint.timeSecs = roundTime(nextTime);
  }
  const locationWaypointsNext = sortLocationWaypoints(next);
  return {
    locationWaypoints: locationWaypointsNext,
    before: context.before,
    after: getJourneyLocationRangeSpeedStats(locationWaypointsNext, anchorId, focusId, options),
    changedIds,
    insertedIds: [],
    insertedCount: 0,
    effectiveEaseSecs: 0,
  };
}

/**
 * @param {Iterable<unknown>} locationWaypoints
 * @param {string} anchorId
 * @param {string} focusId
 * @param {{ easeSecs?: number; rampSampleSecs?: number; samplesPerSegment?: number; groupId?: string }} [options]
 */
export function easeJourneyLocationRangeStartEnd(locationWaypoints, anchorId, focusId, options = {}) {
  const context = rangeContext(locationWaypoints, anchorId, focusId, options);
  if (!context || context.movementLength <= EPSILON || context.movementDuration <= EPSILON) {
    return noRetimingChange(locationWaypoints, context?.before ?? null, { effectiveEaseSecs: 0 });
  }
  const easeSecs = Math.min(
    Math.max(0, finiteNumber(options.easeSecs, DEFAULT_EASE_SECS)),
    context.movementDuration / 2,
  );
  const groupId = String(options.groupId ?? nextEaseGroupId(context.sorted));
  const rampSampleSecs = positiveFinite(options.rampSampleSecs, DEFAULT_RAMP_SAMPLE_SECS);
  const track = createSpatialPositionTrack(context.sorted.map((waypoint) => ({
    id: waypoint.id,
    timeSecs: waypoint.timeSecs,
    positionPc: waypoint.positionPc,
  })), options);
  /** @type {import('./index.d.ts').TimedJourneyLocationWaypoint[]} */
  const inserted = [];
  let insertedIndex = 1;
  for (const phase of ['start', 'end']) {
    if (easeSecs <= EPSILON) continue;
    for (let offset = rampSampleSecs; offset < easeSecs - EPSILON; offset += rampSampleSecs) {
      const timeSecs = phase === 'start'
        ? context.start.timeSecs + offset
        : context.end.timeSecs - offset;
      const sample = evaluateSpatialPositionTrack(track, timeSecs);
      inserted.push({
        id: `loc-${groupId}-${String(insertedIndex).padStart(3, '0')}`,
        timeSecs: roundTime(timeSecs),
        positionPc: sample.position,
        motionGroup: {
          id: groupId,
          kind: 'ease',
          role: 'helper',
          phase,
          easeSecs,
          rampSampleSecs,
        },
      });
      insertedIndex += 1;
    }
  }
  const next = context.sorted.map((waypoint) => {
    if (waypoint.id === anchorId || waypoint.id === focusId) {
      return {
        ...waypoint,
        motionGroup: {
          id: groupId,
          kind: 'ease',
          role: 'anchor',
          phase: waypoint.id === anchorId ? 'start' : 'end',
          easeSecs,
          rampSampleSecs,
        },
      };
    }
    return waypoint;
  });
  const locationWaypointsNext = sortLocationWaypoints([...next, ...inserted]);
  return {
    locationWaypoints: locationWaypointsNext,
    before: context.before,
    after: getJourneyLocationRangeSpeedStats(locationWaypointsNext, anchorId, focusId, options),
    changedIds: [],
    insertedIds: inserted.map((waypoint) => waypoint.id),
    insertedCount: inserted.length,
    effectiveEaseSecs: easeSecs,
    groupId,
  };
}

/**
 * @param {Iterable<unknown>} locationWaypoints
 * @param {string} groupId
 * @param {{ phase?: string }} [options]
 * @returns {import('./index.d.ts').DeleteJourneyEaseLocationGroupResult}
 */
export function deleteJourneyEaseLocationGroupHelpers(locationWaypoints, groupId, options = {}) {
  const phase = options.phase === 'start' || options.phase === 'end' ? options.phase : null;
  /** @type {string[]} */
  const deletedIds = [];
  /** @type {string[]} */
  const clearedIds = [];
  /** @type {import('./index.d.ts').TimedJourneyLocationWaypoint[]} */
  const locationWaypointsNext = [];
  for (const waypoint of sortLocationWaypoints(locationWaypoints)) {
    const group = normalizeMotionGroup(waypoint.motionGroup);
    if (!group || group.id !== groupId || group.kind !== 'ease' || (phase && group.phase !== phase)) {
      locationWaypointsNext.push(waypoint);
      continue;
    }
    if (group.role === 'helper') {
      deletedIds.push(waypoint.id);
      continue;
    }
    const next = cloneLocationWaypoint(waypoint);
    delete next.motionGroup;
    clearedIds.push(waypoint.id);
    locationWaypointsNext.push(next);
  }
  return {
    locationWaypoints: sortLocationWaypoints(locationWaypointsNext),
    deletedIds,
    clearedIds,
  };
}

/**
 * @param {Iterable<unknown>} locationWaypoints
 * @param {string} groupId
 * @param {{ easeSecs?: number; rampSampleSecs?: number; samplesPerSegment?: number; phase?: string }} [options]
 * @returns {import('./index.d.ts').JourneyRetimingResult}
 */
export function rebuildJourneyEaseLocationGroup(locationWaypoints, groupId, options = {}) {
  const phase = options.phase === 'start' || options.phase === 'end' ? options.phase : null;
  const sorted = sortLocationWaypoints(locationWaypoints);
  const groupWaypoints = sorted.filter((waypoint) => {
    const group = normalizeMotionGroup(waypoint.motionGroup);
    return group?.id === groupId && group.kind === 'ease' && (!phase || group.phase === phase);
  });
  const anchors = groupWaypoints.filter((waypoint) => normalizeMotionGroup(waypoint.motionGroup)?.role === 'anchor');
  const endpoints = anchors.length >= 2 ? anchors : groupWaypoints;
  if (endpoints.length < 2) {
    return noRetimingChange(sorted, null, { effectiveEaseSecs: 0, groupId });
  }
  const withoutHelpers = sorted.filter((waypoint) => {
    const group = normalizeMotionGroup(waypoint.motionGroup);
    return !(group?.id === groupId && group.role === 'helper' && (!phase || group.phase === phase));
  });
  return easeJourneyLocationRangeStartEnd(withoutHelpers, endpoints[0].id, endpoints[endpoints.length - 1].id, {
    ...options,
    groupId,
  });
}

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function positiveFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {unknown} value */
function normalizeJourneyTargets(value) {
  const entries = Object.entries(
    value && typeof value === 'object'
      ? /** @type {Record<string, unknown>} */ (value)
      : {},
  );
  return Object.fromEntries(entries.map(([targetId, target]) => {
    const source = /** @type {Record<string, unknown>} */ (
      target && typeof target === 'object' ? target : {}
    );
    return [
      targetId,
      {
        ...source,
        positionPc: normalizeJourneyPositionPc(source.positionPc, `targets.${targetId}.positionPc`),
      },
    ];
  }));
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizeJourneyPositionPc(value, label) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`Journey ${label} must be a vector with x/y/z parsec coordinates.`);
  }
  const vector = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(vector.x);
  const y = Number(vector.y);
  const z = Number(vector.z);
  if (![x, y, z].every(Number.isFinite)) {
    throw new TypeError(`Journey ${label} must be a vector with finite x/y/z coordinates.`);
  }
  return { x, y, z };
}

/** @param {unknown} value */
function normalizeJourneyScenes(value) {
  const entries = Object.entries(
    value && typeof value === 'object'
      ? /** @type {Record<string, unknown>} */ (value)
      : {},
  );
  return Object.fromEntries(entries.map(([sceneId, scene]) => {
    const source = /** @type {Record<string, unknown>} */ (
      scene && typeof scene === 'object' ? scene : {}
    );
    const camera = normalizeJourneyCamera(source.camera);
    return [
      sceneId,
      {
        ...source,
        ...(camera ? { camera } : {}),
        sceneId,
      },
    ];
  }));
}

/**
 * @param {unknown} orderInput
 * @param {Record<string, unknown>} scenes
 */
function normalizeJourneySceneOrder(orderInput, scenes) {
  const sceneIds = Object.keys(scenes);
  const order = Array.isArray(orderInput)
    ? orderInput.map(String).filter((sceneId) => sceneId.length > 0)
    : sceneIds;
  const unknownSceneId = order.find((sceneId) => !Object.hasOwn(scenes, sceneId));
  if (unknownSceneId) {
    throw new TypeError(`Journey order references unknown scene "${unknownSceneId}".`);
  }
  const ordered = [...order];
  for (const sceneId of sceneIds) {
    if (!ordered.includes(sceneId)) ordered.push(sceneId);
  }
  return ordered;
}

/**
 * @param {unknown} initial
 * @param {string[]} sceneIds
 */
function resolveInitialJourneyScene(initial, sceneIds) {
  if (typeof initial === 'string') {
    if (!sceneIds.includes(initial)) {
      throw new TypeError(`Journey initial scene "${initial}" is not declared in scenes.`);
    }
    return initial;
  }
  return sceneIds[0] ?? null;
}

/** @param {unknown} value */
function normalizeJourneyCamera(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const type = source.type == null ? 'orbit' : String(source.type);
  if (type !== 'orbit') {
    return { ...source, type };
  }
  if (source.center == null) {
    throw new TypeError('Journey orbit cameras require a center target.');
  }
  return {
    ...source,
    type,
    center: source.center,
    lookAt: source.lookAt ?? source.center,
    radiusPc: positiveFinite(source.radiusPc, 1),
    angularSpeedRadPerSec: finiteNumber(source.angularSpeedRadPerSec, DEFAULT_INTERACTIVE_ANGULAR_SPEED),
    ...(source.normal != null ? { normal: source.normal } : {}),
    ...(source.dwellSecs != null ? { dwellSecs: Math.max(0, finiteNumber(source.dwellSecs, 0)) } : {}),
  };
}

/** @param {unknown} value */
function normalizeJourneyTravel(value) {
  const source = /** @type {Record<string, unknown>} */ (
    value && typeof value === 'object' ? value : {}
  );
  const type = source.type == null ? 'orbit-transfer' : String(source.type);
  if (type !== 'orbit-transfer') {
    throw new TypeError(`Unsupported journey travel type "${type}".`);
  }
  return {
    ...source,
    type,
    durationSecs: positiveFinite(source.durationSecs, DEFAULT_INTERACTIVE_TRAVEL_SECS),
    sampleStepSecs: positiveFinite(source.sampleStepSecs, DEFAULT_INTERACTIVE_SAMPLE_STEP_SECS),
    ...(source.dwellSecs != null ? { dwellSecs: Math.max(0, finiteNumber(source.dwellSecs, 0)) } : {}),
  };
}

/**
 * @param {unknown} entriesInput
 * @param {string[]} sceneIds
 * @param {Record<string, unknown>} defaultTravel
 */
function normalizeJourneyTransitions(entriesInput, sceneIds, defaultTravel) {
  const entries = entriesInput && typeof /** @type {{ [Symbol.iterator]?: unknown }} */ (entriesInput)[Symbol.iterator] === 'function'
    ? Array.from(/** @type {Iterable<unknown>} */ (entriesInput))
    : [];
  if (entries.length === 0) {
    return sceneIds.slice(1).map((toSceneId, index) => {
      const fromSceneId = sceneIds[index];
      return {
        id: `${fromSceneId}->${toSceneId}`,
        fromSceneId,
        toSceneId,
        travel: { ...defaultTravel },
      };
    });
  }
  return entries.map((entry, index) => {
    const source = /** @type {Record<string, unknown>} */ (
      entry && typeof entry === 'object' ? entry : {}
    );
    const fromSceneId = typeof source.fromSceneId === 'string' ? source.fromSceneId : null;
    const toSceneId = typeof source.toSceneId === 'string' ? source.toSceneId : null;
    if (!fromSceneId || !toSceneId) {
      throw new TypeError('Journey transitions require canonical fromSceneId/toSceneId values.');
    }
    if (!sceneIds.includes(fromSceneId) || !sceneIds.includes(toSceneId)) {
      throw new TypeError(`Journey transition "${fromSceneId}->${toSceneId}" references an unknown scene.`);
    }
    return {
      ...source,
      id: String(source.id ?? `${fromSceneId}->${toSceneId}`),
      fromSceneId,
      toSceneId,
      travel: {
        ...defaultTravel,
        ...(source.travel && typeof source.travel === 'object'
          ? normalizeJourneyTravel({ ...defaultTravel, .../** @type {Record<string, unknown>} */ (source.travel) })
          : {}),
      },
      index,
    };
  });
}

/** @param {unknown} entries */
function normalizeCameraLookWaypoints(entries) {
  return Array.from(Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const source = /** @type {Record<string, unknown>} */ (entry && typeof entry === 'object' ? entry : {});
      const base = {
        id: String(source.id ?? `cam-${index}`),
        timeSecs: finiteNumber(source.timeSecs, 0),
      };
      if (source.kind === 'target' || source.targetPc || source.target) {
        return {
          ...base,
          kind: 'target',
          targetPc: normalizeVector3(source.targetPc ?? source.target, ZERO_VECTOR),
          up: normalizeVector3(source.up, { x: 0, y: 1, z: 0 }),
          ...(source.targetGuide && typeof source.targetGuide === 'object'
            ? { targetGuide: { ...source.targetGuide } }
            : {}),
        };
      }
      if (source.kind === 'quaternion' || source.orientation || source.orientationIcrs || source.cameraQuaternion) {
        return {
          ...base,
          kind: 'quaternion',
          orientation: source.orientation ?? source.orientationIcrs ?? source.cameraQuaternion,
        };
      }
      return {
        ...base,
        kind: 'direction',
        forward: normalizeVector3(source.forward, { x: 0, y: 0, z: -1 }),
        up: normalizeVector3(source.up, { x: 0, y: 1, z: 0 }),
      };
    })
    .sort((left, right) => left.timeSecs - right.timeSecs || left.id.localeCompare(right.id));
}

/** @param {unknown} entries */
function normalizeCues(entries) {
  return Array.from(Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const source = /** @type {Record<string, unknown>} */ (entry && typeof entry === 'object' ? entry : {});
      const startSecs = finiteNumber(source.startSecs ?? source.timeSecs, 0);
      const endSecs = Math.max(startSecs, finiteNumber(source.endSecs, startSecs));
      return {
        ...source,
        id: String(source.id ?? `cue-${index}`),
        startSecs,
        endSecs,
      };
    })
    .sort((left, right) => left.startSecs - right.startSecs || left.id.localeCompare(right.id));
}

/** @param {unknown} entries */
function normalizeGuides(entries) {
  return Array.from(Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const source = /** @type {Record<string, unknown>} */ (entry && typeof entry === 'object' ? entry : {});
      return {
        ...source,
        id: String(source.id ?? `guide-${index}`),
        label: String(source.label ?? source.id ?? `Guide ${index + 1}`),
      };
    });
}

/** @param {unknown} input */
function normalizeTracks(input) {
  const entries = Array.isArray(input)
    ? input.map((track, index) => [String(/** @type {{ id?: unknown }} */ (track)?.id ?? `track-${index}`), track])
    : Object.entries(/** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {}));
  return Object.fromEntries(entries.map(([id, track]) => {
    const source = /** @type {Record<string, unknown>} */ (track && typeof track === 'object' ? track : {});
    const keyframes = Array.from(Array.isArray(source.keyframes) ? source.keyframes : [])
      .map((keyframe) => {
        const frame = /** @type {Record<string, unknown>} */ (keyframe && typeof keyframe === 'object' ? keyframe : {});
        return {
          timeSecs: finiteNumber(frame.timeSecs, 0),
          value: frame.value,
        };
      })
      .sort((left, right) => left.timeSecs - right.timeSecs);
    return [id, {
      id,
      interpolation: source.interpolation === 'smoothstep' || source.interpolation === 'linear'
        ? source.interpolation
        : 'hold',
      keyframes,
    }];
  }));
}

/** @param {Record<string, import('./index.d.ts').TimedJourneyTrack>} tracks @param {number} timeSecs */
function evaluateTracks(tracks, timeSecs) {
  return Object.fromEntries(Object.entries(tracks).map(([id, track]) => [id, evaluateTrack(track, timeSecs)]));
}

/** @param {import('./index.d.ts').TimedJourneyTrack} track @param {number} timeSecs */
function evaluateTrack(track, timeSecs) {
  const frames = track.keyframes;
  if (!frames.length) return null;
  if (frames.length === 1 || timeSecs <= frames[0].timeSecs) return frames[0].value;
  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index];
    const right = frames[index + 1];
    if (timeSecs >= left.timeSecs && timeSecs <= right.timeSecs) {
      const span = right.timeSecs - left.timeSecs;
      const t = span > EPSILON ? clamp((timeSecs - left.timeSecs) / span, 0, 1) : 0;
      if (typeof left.value === 'number' && typeof right.value === 'number' && track.interpolation !== 'hold') {
        const eased = track.interpolation === 'smoothstep' ? smoothstep(t) : t;
        return left.value + (right.value - left.value) * eased;
      }
      return t >= 1 ? right.value : left.value;
    }
  }
  return frames[frames.length - 1].value;
}

/** @param {number} value */
function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/** @param {Iterable<unknown>} locationWaypoints */
function sortLocationWaypoints(locationWaypoints) {
  return Array.from(locationWaypoints ?? [])
    .map((entry, index) => {
      const source = /** @type {Record<string, unknown>} */ (entry && typeof entry === 'object' ? entry : {});
      return {
        id: String(source.id ?? `loc-${index}`),
        timeSecs: finiteNumber(source.timeSecs, 0),
        positionPc: normalizeVector3(source.positionPc ?? source.position, ZERO_VECTOR),
        ...(source.motionGroup && typeof source.motionGroup === 'object'
          ? { motionGroup: { ...source.motionGroup } }
          : {}),
      };
    })
    .sort((left, right) => left.timeSecs - right.timeSecs || left.id.localeCompare(right.id));
}

/** @param {import('./index.d.ts').TimedJourneyLocationWaypoint} waypoint */
function cloneLocationWaypoint(waypoint) {
  return {
    ...waypoint,
    positionPc: { ...waypoint.positionPc },
    ...(waypoint.motionGroup ? { motionGroup: { ...waypoint.motionGroup } } : {}),
  };
}

/** @param {Iterable<unknown>} locationWaypoints @param {string} anchorId @param {string} focusId @param {{ samplesPerSegment?: number }} options */
function rangeContext(locationWaypoints, anchorId, focusId, options) {
  const sorted = sortLocationWaypoints(locationWaypoints);
  const startIndex = sorted.findIndex((waypoint) => waypoint.id === anchorId);
  const endIndex = sorted.findIndex((waypoint) => waypoint.id === focusId);
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) return null;
  const low = Math.min(startIndex, endIndex);
  const high = Math.max(startIndex, endIndex);
  const track = createSpatialPositionTrack(sorted.map((waypoint) => ({
    id: waypoint.id,
    timeSecs: waypoint.timeSecs,
    positionPc: waypoint.positionPc,
  })), options);
  const segments = track.segments.filter((segment) => segment.index >= low && segment.index < high);
  const movementLength = segments.filter((segment) => !segment.held).reduce((sum, segment) => sum + segment.length, 0);
  const movementDuration = segments.filter((segment) => !segment.held).reduce((sum, segment) => sum + segment.durationSecs, 0);
  const context = {
    sorted,
    startIndex: low,
    endIndex: high,
    start: sorted[low],
    end: sorted[high],
    rangeWaypoints: sorted.slice(low, high + 1),
    segments,
    movementLength,
    movementDuration,
    before: null,
  };
  context.before = statsFromRangeContext(context);
  return context;
}

/** @param {Iterable<unknown>} locationWaypoints @param {unknown} before @param {Record<string, unknown>} [extra] */
function noRetimingChange(locationWaypoints, before, extra = {}) {
  return {
    locationWaypoints: sortLocationWaypoints(locationWaypoints),
    before,
    after: before,
    changedIds: [],
    insertedIds: [],
    insertedCount: 0,
    ...extra,
  };
}

/** @param {number} time */
function roundTime(time) {
  return Number(time.toFixed(6));
}

/** @param {import('./index.d.ts').TimedJourneyLocationWaypoint[]} waypoints */
function nextEaseGroupId(waypoints) {
  let max = 0;
  for (const waypoint of waypoints) {
    const match = /^ease-(\d+)$/u.exec(String(waypoint.motionGroup?.id ?? ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `ease-${max + 1}`;
}

/**
 * @param {{ distance: number; point: import('@found-in-space/spatial').SpatialVector3 }[]} samples
 * @param {number} targetDistance
 */
function pointAtArcDistance(samples, targetDistance) {
  if (!samples.length) return { ...ZERO_VECTOR };
  if (targetDistance <= samples[0].distance) return { ...samples[0].point };
  for (let index = 1; index < samples.length; index += 1) {
    const left = samples[index - 1];
    const right = samples[index];
    if (targetDistance <= right.distance) {
      const span = right.distance - left.distance;
      const t = span > EPSILON ? (targetDistance - left.distance) / span : 0;
      return {
        x: left.point.x + (right.point.x - left.point.x) * t,
        y: left.point.y + (right.point.y - left.point.y) * t,
        z: left.point.z + (right.point.z - left.point.z) * t,
      };
    }
  }
  return { ...samples[samples.length - 1].point };
}

/** @param {unknown} motionGroup */
function normalizeMotionGroup(motionGroup) {
  if (!motionGroup || typeof motionGroup !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (motionGroup);
  if (source.id == null) return null;
  return {
    ...source,
    id: String(source.id),
    kind: source.kind === 'ease' ? 'ease' : String(source.kind ?? 'ease'),
    role: ['anchor', 'real', 'helper'].includes(String(source.role)) ? String(source.role) : 'real',
    ...(source.phase === 'start' || source.phase === 'end' ? { phase: source.phase } : {}),
  };
}
