import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJourneyController,
  createJourneyGraph,
  createTimedJourneyEvaluator,
  easeJourneyLocationRangeStartEnd,
  equalizeJourneyLocationRangeSpeeds,
  evaluateTimedJourneyAtTime,
  getJourneyLocationRangeSpeedStats,
  getTimedJourneyCueOpacity,
  normalizeTimedJourney,
} from '../index.js';

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

  const eased = easeJourneyLocationRangeStartEnd(waypoints, 'a', 'c', {
    easeSecs: 2,
    rampSampleSecs: 1,
    groupId: 'ease-test',
  });
  assert.equal(eased.groupId, 'ease-test');
  assert.equal(eased.insertedCount, 2);
  assert.ok(eased.insertedIds.every((id) => id.startsWith('loc-ease-test')));
});
