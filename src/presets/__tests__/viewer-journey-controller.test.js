import assert from 'node:assert/strict';
import test from 'node:test';

import { createJourneyGraph } from '../journey-controller.js';
import {
  applyViewerJourneyScene,
  createViewerJourneyController,
} from '../viewer-journey-controller.js';

function createFakeViewer() {
  return {
    stateUpdates: [],
    refreshCalls: 0,
    setState(nextState) {
      this.stateUpdates.push(nextState);
      return nextState;
    },
    async refreshSelection() {
      this.refreshCalls += 1;
      return { strategy: 'observer-shell', nodes: [], meta: {} };
    },
  };
}

function createFakeCameraController() {
  return {
    calls: [],
    cancelAutomation() {
      this.calls.push(['cancelAutomation']);
    },
    lockAt(targetPc, options) {
      this.calls.push(['lockAt', targetPc, options]);
    },
    unlockAt() {
      this.calls.push(['unlockAt']);
    },
    flyTo(targetPc, options) {
      this.calls.push(['flyTo', targetPc, options]);
    },
    orbit(centerPc, options) {
      this.calls.push(['orbit', centerPc, options]);
    },
    orbitalInsert(centerPc, options) {
      this.calls.push(['orbitalInsert', centerPc, options]);
    },
    flyPolyline(pointsPc, options) {
      this.calls.push(['flyPolyline', pointsPc, options]);
    },
    lookAt(targetPc, options) {
      this.calls.push(['lookAt', targetPc, options]);
    },
  };
}

test('applyViewerJourneyScene handles fly-and-look scenes with preload and state updates', async () => {
  const viewer = createFakeViewer();
  const cameraController = createFakeCameraController();
  const steps = [];

  await applyViewerJourneyScene({
    sceneId: 'intro',
    type: 'flyAndLook',
    observerPc: { x: 10, y: 5, z: -2 },
    lookAtPc: { x: 0, y: 0, z: 0 },
    flySpeed: 120,
    state: {
      chapter: 'intro',
      mDesired: 7.5,
    },
  }, {
    viewer,
    cameraController,
    async preloadScene(scene) {
      steps.push(`preload:${scene.sceneId}`);
    },
    async applySceneState(scene) {
      steps.push(`state:${scene.sceneId}`);
    },
  });

  assert.deepEqual(steps, ['preload:intro', 'state:intro']);
  assert.deepEqual(viewer.stateUpdates, [{ chapter: 'intro', mDesired: 7.5 }]);
  assert.equal(viewer.refreshCalls, 1);
  assert.deepEqual(cameraController.calls[0], ['cancelAutomation']);
  assert.deepEqual(cameraController.calls[1], [
    'lockAt',
    { x: 0, y: 0, z: 0 },
    { dwellMs: 0, recenterSpeed: 0.08, upIcrs: undefined },
  ]);
  assert.deepEqual(cameraController.calls[2], [
    'flyTo',
    { x: 10, y: 5, z: -2 },
    {
      speed: 120,
      deceleration: undefined,
      durationSecs: undefined,
      arrivalThreshold: undefined,
      onArrive: undefined,
    },
  ]);
});

test('applyViewerJourneyScene unlocks on arrival for free-roam scenes', async () => {
  const viewer = createFakeViewer();
  const cameraController = createFakeCameraController();

  await applyViewerJourneyScene({
    sceneId: 'free',
    type: 'free-roam',
    observerPc: { x: 24, y: 3, z: 9 },
    lookAtPc: { x: 0, y: 0, z: 0 },
    flySpeed: 90,
  }, {
    viewer,
    cameraController,
  });

  const flyToCall = cameraController.calls.find(([type]) => type === 'flyTo');
  assert.ok(flyToCall);
  assert.equal(typeof flyToCall[2].onArrive, 'function');

  flyToCall[2].onArrive();
  assert.deepEqual(cameraController.calls.at(-1), ['unlockAt']);
});

test('createViewerJourneyController activates declarative orbit and lesson scenes', async () => {
  const viewer = createFakeViewer();
  const cameraController = createFakeCameraController();
  const preloaded = [];
  const applied = [];

  const graph = createJourneyGraph({
    initialSceneId: null,
    scenes: {
      overview: {
        type: 'orbit',
        centerPc: { x: 0, y: 0, z: 0 },
        lookAtPc: { x: 0, y: 0, z: 0 },
        orbitRadiusPc: 48,
        angularSpeed: 0.12,
        flySpeed: 140,
        preload: { scope: 'overview' },
      },
      lesson: {
        type: 'flyAndLook',
        observerPc: { x: 6, y: 8, z: -12 },
        lookAtPc: { x: 0, y: 0, z: 0 },
        state: {
          chapter: 'lesson',
          fieldStrategy: 'target-frustum',
        },
      },
    },
  });

  const journey = createViewerJourneyController({
    graph,
    viewer,
    cameraController,
    autoInitialize: false,
    async preloadScene(scene) {
      preloaded.push(scene.sceneId);
    },
    async applySceneState(scene) {
      applied.push(scene.sceneId);
    },
  });

  const overview = await journey.activateScene('overview', { source: 'test' });
  assert.equal(overview?.sceneId, 'overview');
  assert.equal(preloaded[0], 'overview');
  assert.equal(applied[0], 'overview');
  assert.equal(cameraController.calls[1][0], 'lockAt');
  assert.equal(cameraController.calls[2][0], 'orbitalInsert');

  const lesson = await journey.activateScene('lesson', { source: 'test' });
  assert.equal(lesson?.sceneId, 'lesson');
  assert.deepEqual(viewer.stateUpdates.at(-1), {
    chapter: 'lesson',
    fieldStrategy: 'target-frustum',
  });
  assert.equal(viewer.refreshCalls, 1);
  assert.equal(journey.getSnapshot().journey.activeSceneId, 'lesson');
  assert.equal(cameraController.calls.at(-1)[0], 'flyTo');
});
