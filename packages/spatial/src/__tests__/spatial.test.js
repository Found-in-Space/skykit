import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPATIAL_IDENTITY_QUATERNION,
  SPATIAL_LOCAL_FORWARD,
  applySpatialQuaternion,
  buildSpatialAimTrack,
  buildSpatialOrbitTransferRoute,
  buildSpatialOrbitalInsertRoute,
  buildSpatialPolylineRoute,
  buildSpatialRouteEndpoint,
  buildSpatialViewTransitionPath,
  createDirectSpatialMotionModel,
  createSpatialNavigationAutomation,
  deriveSpatialOrbitHandoff,
  evaluateSpatialAim,
  evaluateSpatialAimTrack,
  evaluateSpatialOrbit,
  evaluateSpatialPath,
  evaluateSpatialPathPlayback,
  evaluateSpatialPoseTransition,
  evaluateSpatialRoute,
  evaluateSpatialViewTransition,
  getSpatialRouteDiagnostics,
  materializeSpatialPreloadHints,
  normalizeSpatialPathSpec,
  normalizeSpatialPose,
  normalizeSpatialUpdateDelta,
  projectSpatialEquirectangular,
  raDecDistanceToIcrs,
  raDecToIcrsDirection,
  sampleSpatialPath,
  sampleSpatialPathDiagnostics,
  sampleSpatialRoute,
} from '../index.js';

test('math and coordinate helpers use canonical names and strict pose fields', () => {
  assert.deepEqual(raDecToIcrsDirection({ raDeg: 0, decDeg: 0 }), { x: 1, y: 0, z: 0 });
  assertVectorApprox(raDecDistanceToIcrs({ raHours: 6, decDeg: 0, distancePc: 10 }), { x: 0, y: 10, z: 0 });
  assert.deepEqual(projectSpatialEquirectangular({ raDeg: 180, decDeg: 0, width: 360, height: 180 }), { x: 180, y: 90 });
  assert.throws(() => normalizeSpatialPose({ position: { x: 0, y: 0, z: 0 } }), /observerPc/);
  assert.deepEqual(normalizeSpatialPose({}), {
    observerPc: { x: 0, y: 0, z: 0 },
    orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
  });
});

test('target aim samples preserve target semantics and orientation', () => {
  const sample = evaluateSpatialAim({
    observerPc: { x: 0, y: 0, z: 0 },
    aim: { kind: 'target', targetPc: { x: 10, y: 0, z: 0 } },
  });
  assert.equal(sample.kind, 'target');
  assert.deepEqual(sample.targetPc, { x: 10, y: 0, z: 0 });
  assertVectorApprox(sample.forwardIcrs, { x: 1, y: 0, z: 0 });
  assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, sample.orientationIcrs), { x: 1, y: 0, z: 0 });

  const direction = evaluateSpatialAim({
    observerPc: { x: 1, y: 2, z: 3 },
    aim: { kind: 'direction', forwardIcrs: { x: 0, y: 0, z: -1 } },
    syntheticTargetDistancePc: 5,
  });
  assert.equal(direction.kind, 'direction');
  assert.equal('targetPc' in direction, false);
  assert.deepEqual(direction.syntheticTargetPc, { x: 1, y: 2, z: -2 });
});

test('route endpoint resolution preserves destinations without using center as observer position', () => {
  const destination = {
    id: 'target',
    centerPc: { x: 10, y: 0, z: 0 },
    radiusPc: 2,
    metadata: { chapter: 1 },
  };
  assert.equal(buildSpatialRouteEndpoint({ destination }), null);
  const endpoint = buildSpatialRouteEndpoint({ destination }, {
    referencePose: {
      observerPc: { x: 20, y: 0, z: 0 },
      orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
    },
  });
  assert.ok(endpoint);
  assert.equal(endpoint.kind, 'destination');
  assert.deepEqual(endpoint.destination.metadata, { chapter: 1 });
  assert.deepEqual(endpoint.positionPc, { x: 12, y: 0, z: 0 });
});

test('route builders return canonical geometry, timing, diagnostics, and samples', () => {
  const route = buildSpatialPolylineRoute({
    pointsPc: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -10 },
      { x: 10, y: 0, z: -10 },
    ],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 10 } },
  });
  assert.equal(route.totalLengthPc, 20);
  assert.equal(route.pointsPc.length, 3);
  assert.equal(getSpatialRouteDiagnostics(route).averageSpeedPcPerSec, 2);
  assert.deepEqual(evaluateSpatialRoute(route, 2.5).positionPc, { x: 0, y: 0, z: -5 });
  assert.equal(sampleSpatialRoute(route, { sampleStepSecs: 5 }).length, 3);
  assert.equal('points' in route, false);
  assert.equal('totalLength' in route, false);
});

test('orbit routes preserve destination and derive handoff angle continuity', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const route = buildSpatialOrbitalInsertRoute({
    from: { positionPc: { x: 15, y: 0, z: 0 } },
    orbit,
    destination: { id: 'orbit-home', centerPc: orbit.centerPc, orbit },
    travel: { kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 4 } },
  });
  assert.ok(route);
  assert.equal(route.arrivalAction.kind, 'orbitalInsert');
  assert.equal(route.arrival.destination.id, 'orbit-home');
  const handoff = deriveSpatialOrbitHandoff({ positionPc: route.arrival.positionPc, orbit });
  const orbitSample = evaluateSpatialOrbit(handoff.orbit, 0);
  assertVectorApprox(orbitSample.positionPc, route.arrival.positionPc);
});

test('aim tracks require an observer source for target aims', () => {
  const track = buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'target', targetPc: { x: 1, y: 0, z: 0 } } },
  ], { durationSecs: 1 });
  assert.throws(() => evaluateSpatialAimTrack(track, 0.5, {}), /observerPc/);
  const sample = evaluateSpatialAimTrack(track, 0.5, { observerPc: { x: 0, y: 0, z: 0 } });
  assert.equal(sample.aim.kind, 'target');
});

test('paths evaluate canonical samples, playback remap, defaults, and duplicate policy', () => {
  assert.throws(() => normalizeSpatialPathSpec({ positionKeys: [] }), /positionKeys/);
  assert.throws(() => normalizeSpatialPathSpec({
    positionKeys: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', timeSecs: 0, positionPc: { x: 1, y: 0, z: 0 } },
    ],
  }), /Duplicate/);

  const path = normalizeSpatialPathSpec({
    durationSecs: 10,
    positionKeys: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
    ],
    aimKeys: [
      { id: 'aim', timeSecs: 0, aim: { kind: 'target', targetPc: { x: 10, y: 0, z: 0 } } },
    ],
    timeRemap: { kind: 'linear', playbackDurationSecs: 20 },
  });
  const sample = evaluateSpatialPath(path, 5);
  assert.equal(sample.pose.observerPc.x > 4 && sample.pose.observerPc.x < 6, true);
  assert.equal(sample.aim.kind, 'target');
  assert.equal(evaluateSpatialPathPlayback(path, 10).timeSecs, 5);
  assert.equal(sampleSpatialPath(path, { sampleStepSecs: 10 }).length, 3);
  assert.equal(sampleSpatialPathDiagnostics(path, { sampleStepSecs: 1, maxSamples: 2 }).warnings[0].code, 'maxSamplesTruncatesPath');
  assert.throws(() => sampleSpatialPath(path, { sampleStepSecs: 1, frameRate: 30 }), /sampleStepSecs/);
  assert.throws(() => sampleSpatialPath(path, { stepSecs: 1 }), /sampleStepSecs/);
  assert.throws(() => normalizeSpatialPathSpec({ positionKeys: [{ id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } }], timeRemap: { kind: 'profile' } }), /linear and eased/);
});

test('view transitions are data-only and pose transitions evaluate with canonical poses', () => {
  const transition = buildSpatialViewTransitionPath({
    from: frame({ x: 0, y: 0, z: 0 }),
    to: frame({ x: 10, y: 0, z: 0 }),
    durationSecs: 2,
  });
  assert.equal(typeof transition.evaluate, 'undefined');
  assert.equal(evaluateSpatialViewTransition(transition, 1).pose.observerPc.x > 0, true);

  const poseTransition = {
    from: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    to: { observerPc: { x: 10, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    durationSecs: 2,
  };
  assert.equal(evaluateSpatialPoseTransition(poseTransition, 1).pose.observerPc.x > 0, true);
});

test('preload hints and navigation wrapper use canonical fields', () => {
  const path = normalizeSpatialPathSpec({
    durationSecs: 1,
    positionKeys: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', timeSecs: 1, positionPc: { x: 1, y: 0, z: 0 } },
    ],
  });
  const hints = materializeSpatialPreloadHints(path, {
    pathRadiusPc: 1,
    sphereRadiusPc: 1,
    lookaheadSecs: 1,
    sampleStepSecs: 0.5,
  });
  assert.equal(hints.some((hint) => hint.kind === 'pathVolume'), true);
  assert.equal(hints.some((hint) => hint.kind === 'sphereVolume'), true);
  assert.equal(hints.some((hint) => hint.kind === 'viewLookahead'), true);

  const navigation = createSpatialNavigationAutomation();
  const route = buildSpatialOrbitTransferRoute({
    from: { positionPc: { x: 0, y: 0, z: 0 } },
    to: { positionPc: { x: 1, y: 0, z: 0 } },
    travel: { kind: 'orbitTransfer', timing: { kind: 'duration', durationSecs: 1 } },
  });
  navigation.flyRoute(route);
  const pose = navigation.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    deltaSecs: 0.5,
  });
  assert.equal(pose.observerPc.x > 0, true);
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbitTransfer');
  assert.equal(normalizeSpatialUpdateDelta({ deltaSecs: 1 }), 1);
  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSeconds: 1 }), /deltaSecs/);
});

test('manual motion models consume deltaSecs and canonical poses', () => {
  const model = createDirectSpatialMotionModel({ moveSpeedPcPerSec: 2 });
  const controls = {
    getAxis(name) {
      return name === 'move' ? { x: 0, y: 1, magnitude: 1, active: true } : { x: 0, y: 0, magnitude: 0, active: false };
    },
  };
  const pose = model.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 1,
  });
  assert.equal(pose.observerPc.z, 2);
});

function frame(observerPc) {
  return {
    pose: { observerPc, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    aim: null,
  };
}

function assertVectorApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `x expected ${expected.x}, got ${actual.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `y expected ${expected.y}, got ${actual.y}`);
  assert.ok(Math.abs(actual.z - expected.z) <= epsilon, `z expected ${expected.z}, got ${actual.z}`);
}
