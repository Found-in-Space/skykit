import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJourneyController,
  createJourney,
  createJourneyGraph,
  createTimedJourneyEvaluator,
  deleteJourneyEaseLocationGroupHelpers,
  easeJourneyLocationRangeStartEnd,
  equalizeJourneyLocationRangeSpeeds,
  evaluateTimedJourneyAtTime,
  getJourneyLocationArcSegments,
  getJourneyLocationRangeSpeedStats,
  getTimedJourneyCueOpacity,
  normalizeTimedJourney,
  rebuildJourneyEaseLocationGroup,
  sampleJourneyLocationArcPoint,
} from '../index.js';
import {
  deleteTimedJourneyEaseGroup,
  easeTimedJourneyLocationRange,
  equalizeTimedJourneyLocationRangeSpeed,
  rebuildTimedJourneyEaseGroup,
} from '../authoring.js';

test('createJourney normalizes ordered orbit scenes and generated transitions', () => {
  const journey = createJourney({
    initial: 'inside',
    order: ['inside', 'outside', 'hyades'],
    targets: {
      sun: { positionPc: { x: 0, y: 0, z: 0 } },
      hyades: { positionPc: { x: 17, y: 42, z: 14 } },
      orion: { positionPc: { x: 44, y: 410, z: -39 } },
    },
    scenes: {
      inside: {
        view: {
          observerPc: { x: 8, y: 0, z: 0 },
          targetPc: { x: 0, y: 0, z: 0 },
        },
        camera: { type: 'orbit', center: 'sun', radiusPc: 8, angularSpeedRadPerSec: 0.26, lookAt: 'orion' },
      },
      outside: {
        camera: { type: 'orbit', center: 'sun', radiusPc: 175, angularSpeedRadPerSec: 0.06, lookAt: 'sun' },
      },
      hyades: {
        camera: { type: 'orbit', center: 'hyades', radiusPc: 15, angularSpeedRadPerSec: 0.2 },
      },
    },
    travel: { type: 'orbit-transfer', durationSecs: 5 },
  });

  assert.equal(journey.initialSceneId, 'inside');
  assert.deepEqual(journey.getScene('inside')?.view?.observerPc, { x: 8, y: 0, z: 0 });
  assert.deepEqual(journey.sceneIds, ['inside', 'outside', 'hyades']);
  assert.equal(journey.targets.hyades.positionPc.x, 17);
  assert.equal(journey.getScene('inside')?.camera.radiusPc, 8);
  assert.equal(journey.transitions.length, 2);
  assert.deepEqual(journey.transitions.map((transition) => transition.id), [
    'inside->outside',
    'outside->hyades',
  ]);
  assert.equal(journey.getTransition('inside', 'outside')?.travel.durationSecs, 5);
  assert.equal(journey.resolveSceneSpec('outside', { fromSceneId: 'inside' })?.travel.type, 'orbit-transfer');
});

test('interactive graph resolves scenes and transition overrides', () => {
  const graph = createJourneyGraph({
    initialSceneId: 'intro',
    scenes: {
      intro: { title: 'Intro', view: { limitingMagnitude: 6 } },
      hyades: { title: 'Hyades', view: { limitingMagnitude: 8 } },
    },
    transitions: [
      {
        id: 'intro-to-hyades',
        fromSceneId: 'intro',
        toSceneId: 'hyades',
        navigation: { transitionTo: { durationSecs: 5 } },
      },
    ],
  });

  assert.equal(graph.initialSceneId, 'intro');
  assert.equal(graph.getScene('hyades')?.title, 'Hyades');
  assert.equal(graph.getTransition('intro', 'hyades')?.id, 'intro-to-hyades');
  const spec = graph.resolveSceneSpec('hyades', { fromSceneId: 'intro' });
  assert.equal(spec?.transitionId, 'intro-to-hyades');
  assert.deepEqual(spec?.navigation, { transitionTo: { durationSecs: 5 } });
});

test('journey controller handles goTo/next/previous, events, and snapshots', () => {
  const events = [];
  const controller = createJourneyController({
    scenes: {
      one: { title: 'One' },
      two: { title: 'Two' },
      three: { title: 'Three' },
    },
    initialSceneId: 'one',
  });
  const unsubscribe = controller.subscribe((event) => events.push(event));

  assert.equal(controller.getSnapshot().activeSceneId, 'one');
  assert.equal(controller.next({ source: 'test' })?.sceneId, 'two');
  assert.equal(controller.getSnapshot().activeSceneId, 'two');
  assert.equal(controller.previous()?.sceneId, 'one');
  assert.equal(controller.goTo('three')?.title, 'Three');
  assert.equal(events.length, 3);
  assert.equal(events[0].previousSceneId, 'one');
  assert.equal(events[0].sceneId, 'two');

  unsubscribe();
  controller.goTo('one');
  assert.equal(events.length, 3);
  controller.dispose();
  assert.equal(controller.getSnapshot().disposed, true);
});

test('timed evaluator normalizes fis journey data and evaluates pose, cues, tracks, and preload hints', () => {
  const journey = {
    format: 'fis-journey-v1',
    id: 'tour',
    durationSecs: 10,
    locationWaypoints: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
    ],
    cameraLookWaypoints: [
      { id: 'look-a', timeSecs: 0, kind: 'target', targetPc: { x: 10, y: 0, z: 0 } },
      { id: 'look-b', timeSecs: 10, kind: 'target', targetPc: { x: 20, y: 0, z: 0 } },
    ],
    cues: [
      { id: 'hello', startSecs: 2, endSecs: 6, text: 'Hello' },
    ],
    tracks: {
      overlayOpacity: {
        interpolation: 'linear',
        keyframes: [
          { timeSecs: 0, value: 0 },
          { timeSecs: 10, value: 1 },
        ],
      },
      label: {
        interpolation: 'hold',
        keyframes: [
          { timeSecs: 0, value: 'start' },
          { timeSecs: 5, value: 'middle' },
        ],
      },
    },
  };

  const evaluator = createTimedJourneyEvaluator(journey, {
    pathRadiusPc: 3,
    sphereRadiusPc: 1,
    lookaheadSecs: 2,
    preloadStepSecs: 5,
  });
  const frame = evaluator.evaluate(5);

  assert.equal(evaluator.durationSecs, 10);
  assert.ok(frame.observerPc.x > 4 && frame.observerPc.x < 6);
  assert.ok(frame.speedPcPerSec > 0);
  assert.equal(frame.cue?.id, 'hello');
  assert.ok(frame.cueOpacity > 0);
  assert.equal(frame.tracks.overlayOpacity, 0.5);
  assert.equal(frame.tracks.label, 'middle');
  assert.ok(frame.preloadHints.some((hint) => hint.kind === 'path-volume'));
  assert.ok(frame.preloadHints.some((hint) => hint.kind === 'sphere-volume'));
  assert.ok(frame.preloadHints.some((hint) => hint.kind === 'view-lookahead'));
  assert.equal(evaluator.getPreloadHints(), frame.preloadHints);
  assert.equal(evaluator.evaluate(6).preloadHints, frame.preloadHints);

  const directFrame = evaluateTimedJourneyAtTime(journey, 3);
  assert.equal(directFrame.sceneTimeSecs, 3);
  assert.equal(evaluator.sample({ stepSecs: 5 }).length, 3);
});

test('sparse journeys degrade to sensible defaults', () => {
  const normalized = normalizeTimedJourney({});
  assert.equal(normalized.durationSecs, 60);
  assert.deepEqual(normalized.locationWaypoints, []);

  const frame = createTimedJourneyEvaluator({ durationSecs: 1 }).evaluate(0.5);
  assert.deepEqual(frame.observerPc, { x: 0, y: 0, z: 0 });
  assert.deepEqual(frame.orientationIcrs, { x: 0, y: 0, z: 0, w: 1 });
  assert.equal(frame.cue, null);
});

test('cue opacity fades in and out', () => {
  const cue = { id: 'cue', startSecs: 10, endSecs: 20 };
  assert.equal(getTimedJourneyCueOpacity(cue, 10, 2), 0);
  assert.equal(getTimedJourneyCueOpacity(cue, 12, 2), 1);
  assert.equal(getTimedJourneyCueOpacity(cue, 20, 2), 0);
});

test('retiming helpers report range speeds, equalize movement, and insert ease helpers', () => {
  const waypoints = [
    { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'b', timeSecs: 5, positionPc: { x: 1, y: 0, z: 0 } },
    { id: 'c', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
  ];

  const before = getJourneyLocationRangeSpeedStats(waypoints, 'a', 'c');
  assert.equal(before?.segmentCount, 2);
  assert.ok(before?.totalLengthPc ?? 0 > 9);

  const equalized = equalizeJourneyLocationRangeSpeeds(waypoints, 'a', 'c');
  assert.ok(equalized.changedIds.includes('b'));
  const b = equalized.locationWaypoints.find((waypoint) => waypoint.id === 'b');
  assert.ok(b);
  assert.ok(b.timeSecs > 0.5 && b.timeSecs < 2);

  const withHold = [
    { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'hold', timeSecs: 2, positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'b', timeSecs: 5, positionPc: { x: 1, y: 0, z: 0 } },
    { id: 'c', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
  ];
  const holdEqualized = equalizeJourneyLocationRangeSpeeds(withHold, 'a', 'c', { timeStepSecs: 0.05 });
  assert.equal(holdEqualized.locationWaypoints.find((waypoint) => waypoint.id === 'hold')?.timeSecs, 2);
  assert.equal(holdEqualized.locationWaypoints.find((waypoint) => waypoint.id === 'b')?.timeSecs, 2.8);

  const eased = easeJourneyLocationRangeStartEnd(waypoints, 'a', 'c', {
    easeSecs: 2,
    rampSampleSecs: 1,
    groupId: 'ease-test',
  });
  assert.equal(eased.groupId, 'ease-test');
  assert.equal(eased.startGroupId, 'ease-test');
  assert.notEqual(eased.endGroupId, eased.startGroupId);
  assert.deepEqual(eased.groupIds, [eased.startGroupId, eased.endGroupId]);
  assert.equal(eased.insertedCount, 4);
  assert.ok(eased.insertedIds.some((id) => id.startsWith('loc-ease-test')));
  assert.ok(eased.locationWaypoints.some((waypoint) => waypoint.motionGroup?.phase === 'end'));
});

test('arc diagnostics and sampling expose editor-friendly path data', () => {
  const waypoints = [
    { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'b', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
    { id: 'c', timeSecs: 20, positionPc: { x: 10, y: 0, z: 0 } },
  ];

  const segments = getJourneyLocationArcSegments(waypoints);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].startId, 'a');
  assert.equal(segments[0].endId, 'b');
  assert.ok(segments[0].lengthPc > 9);
  assert.equal(segments[1].held, true);

  const midpoint = sampleJourneyLocationArcPoint(waypoints, 0, segments[0].lengthPc / 2);
  assert.ok(midpoint.x > 4 && midpoint.x < 6);
  assert.deepEqual(sampleJourneyLocationArcPoint(waypoints, 1, 100), { x: 10, y: 0, z: 0 });
});

test('ease group helpers delete and rebuild editor helper waypoints', () => {
  const waypoints = [
    {
      id: 'a',
      timeSecs: 0,
      positionPc: { x: 0, y: 0, z: 0 },
      motionGroup: { id: 'ease-a', kind: 'ease', role: 'anchor', phase: 'start' },
    },
    {
      id: 'helper',
      timeSecs: 1,
      positionPc: { x: 1, y: 0, z: 0 },
      motionGroup: { id: 'ease-a', kind: 'ease', role: 'helper', phase: 'start' },
    },
    {
      id: 'b',
      timeSecs: 10,
      positionPc: { x: 10, y: 0, z: 0 },
      motionGroup: { id: 'ease-a', kind: 'ease', role: 'anchor', phase: 'end' },
    },
  ];

  const deleted = deleteJourneyEaseLocationGroupHelpers(waypoints, 'ease-a', { phase: 'start' });
  assert.deepEqual(deleted.deletedIds, ['helper']);
  assert.deepEqual(deleted.clearedIds, ['a']);
  assert.equal(deleted.locationWaypoints.some((waypoint) => waypoint.id === 'helper'), false);
  assert.equal(deleted.locationWaypoints.find((waypoint) => waypoint.id === 'b')?.motionGroup?.id, 'ease-a');

  const rebuilt = rebuildJourneyEaseLocationGroup(waypoints, 'ease-a', {
    easeSecs: 2,
    rampSampleSecs: 1,
  });
  assert.equal(rebuilt.groupId, 'ease-a');
  assert.ok(rebuilt.insertedCount >= 2);
  assert.ok(rebuilt.insertedIds.some((id) => id.startsWith('loc-ease-a')));
});

test('authoring retiming transforms return journey-focused results', () => {
  const journey = normalizeTimedJourney({
    durationSecs: 10,
    locationWaypoints: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'hold', timeSecs: 2, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', timeSecs: 5, positionPc: { x: 1, y: 0, z: 0 } },
      { id: 'c', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
    ],
  });

  const equalized = equalizeTimedJourneyLocationRangeSpeed(journey, {
    anchorId: 'a',
    focusId: 'c',
    timeStepSecs: 0.05,
  });
  assert.equal(equalized.journey.locationWaypoints.find((waypoint) => waypoint.id === 'hold')?.timeSecs, 2);
  assert.equal(equalized.locationWaypoints.find((waypoint) => waypoint.id === 'b')?.timeSecs, 2.8);

  const eased = easeTimedJourneyLocationRange(journey, {
    anchorId: 'a',
    focusId: 'c',
    easeSecs: 2,
    rampSampleSecs: 1,
    timeStepSecs: 0.05,
  });
  assert.ok(eased.startGroupId);
  assert.ok(eased.endGroupId);
  assert.notEqual(eased.startGroupId, eased.endGroupId);
  assert.equal(eased.insertedCount, 4);
  assert.equal(eased.journey.locationWaypoints.some((waypoint) => waypoint.motionGroup?.rangeStartId === 'a'), true);

  const evaluator = createTimedJourneyEvaluator(eased.journey);
  for (const timeSecs of [0, 1, 2, 5, 9, 10]) {
    const frame = evaluator.evaluate(timeSecs);
    assert.equal(Number.isFinite(frame.observerPc.x), true);
    assert.equal(Number.isFinite(frame.velocityPcPerSec.x), true);
    assert.equal(Number.isFinite(frame.speedPcPerSec), true);
  }

  const deletedStart = deleteTimedJourneyEaseGroup(eased.journey, eased.startGroupId, { phase: 'start' });
  assert.equal(deletedStart.journey.locationWaypoints.some((waypoint) => waypoint.motionGroup?.id === eased.startGroupId), false);
  assert.equal(deletedStart.journey.locationWaypoints.some((waypoint) => waypoint.motionGroup?.id === eased.endGroupId), true);

  const rebuiltEnd = rebuildTimedJourneyEaseGroup(eased.journey, eased.endGroupId, {
    phase: 'end',
    easeSecs: 1,
    rampSampleSecs: 0.5,
    timeStepSecs: 0.05,
  });
  assert.equal(rebuiltEnd.journey.locationWaypoints.some((waypoint) => waypoint.motionGroup?.id === eased.startGroupId), true);
  assert.equal(rebuiltEnd.journey.locationWaypoints.some((waypoint) => waypoint.motionGroup?.id === eased.endGroupId), true);
});
