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
  createSpatialQuaternionFromAxisAngle,
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
  assert.equal('position' in sample, false);
  assert.equal('target' in sample, false);
  assert.equal('speed' in sample, false);
  assert.equal('deltaSeconds' in sample, false);
  assert.equal(evaluateSpatialPathPlayback(path, 10).timeSecs, 5);
  assert.equal(sampleSpatialPath(path, { sampleStepSecs: 10 }).length, 3);
  assert.equal(sampleSpatialPathDiagnostics(path, { sampleStepSecs: 1, maxSamples: 2 }).warnings[0].code, 'maxSamplesTruncatesPath');
  assert.throws(() => sampleSpatialPath(path, { sampleStepSecs: 1, frameRate: 30 }), /sampleStepSecs/);
  assert.throws(() => sampleSpatialPath(path, { stepSecs: 1 }), /sampleStepSecs/);
  assert.throws(() => normalizeSpatialPathSpec({ positionKeys: [{ id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } }], timeRemap: { kind: 'profile' } }), /linear and eased/);
});

test('path position interpolation kinds affect canonical samples', () => {
  const holdPath = normalizeSpatialPathSpec({
    durationSecs: 10,
    positionKeys: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 }, interpolation: { kind: 'hold' } },
      { id: 'b', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
    ],
  });
  assertVectorApprox(evaluateSpatialPath(holdPath, 5).pose.observerPc, { x: 0, y: 0, z: 0 });
  assertVectorApprox(evaluateSpatialPath(holdPath, 10).pose.observerPc, { x: 10, y: 0, z: 0 });
  assert.equal(evaluateSpatialPath(holdPath, 5).speedPcPerSec, 0);

  const linearPath = normalizeSpatialPathSpec({
    durationSecs: 10,
    positionKeys: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 } },
    ],
  });
  const linear = evaluateSpatialPath(linearPath, 5);
  assertVectorApprox(linear.pose.observerPc, { x: 5, y: 0, z: 0 });
  assertVectorApprox(linear.velocityPcPerSec, { x: 1, y: 0, z: 0 });
  assertVectorApprox(linear.accelerationPcPerSec2, { x: 0, y: 0, z: 0 });

  const bezier = evaluateSpatialPath(normalizeSpatialPathSpec({
    durationSecs: 10,
    positionKeys: [
      {
        id: 'a',
        timeSecs: 0,
        positionPc: { x: 0, y: 0, z: 0 },
        interpolation: { kind: 'cubicBezier', outTangentPc: { x: 0, y: 10, z: 0 } },
      },
      {
        id: 'b',
        timeSecs: 10,
        positionPc: { x: 10, y: 0, z: 0 },
        interpolation: { kind: 'cubicBezier', inTangentPc: { x: 0, y: 10, z: 0 } },
      },
    ],
  }), 5);
  assert.equal(bezier.pose.observerPc.y > 7, true);
  assert.equal(Number.isFinite(bezier.speedPcPerSec), true);
  assert.equal(Number.isFinite(bezier.accelerationMagnitudePcPerSec2), true);

  const hermite = evaluateSpatialPath(normalizeSpatialPathSpec({
    durationSecs: 10,
    positionKeys: [
      {
        id: 'a',
        timeSecs: 0,
        positionPc: { x: 0, y: 0, z: 0 },
        interpolation: { kind: 'hermite', outVelocityPcPerSec: { x: 0, y: 2, z: 0 } },
      },
      {
        id: 'b',
        timeSecs: 10,
        positionPc: { x: 10, y: 0, z: 0 },
        interpolation: { kind: 'hermite', inVelocityPcPerSec: { x: 0, y: -2, z: 0 } },
      },
    ],
  }), 5);
  assert.equal(hermite.pose.observerPc.y > 4, true);
  assert.equal(Number.isFinite(hermite.speedPcPerSec), true);
  assert.equal(Number.isFinite(hermite.accelerationMagnitudePcPerSec2), true);

  const catmull = evaluateSpatialPath(normalizeSpatialPathSpec({
    durationSecs: 30,
    positionKeys: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'b', timeSecs: 10, positionPc: { x: 10, y: 0, z: 0 }, interpolation: { kind: 'catmullRom' } },
      { id: 'c', timeSecs: 20, positionPc: { x: 20, y: 10, z: 0 } },
      { id: 'd', timeSecs: 30, positionPc: { x: 30, y: 0, z: 0 } },
    ],
  }), 15);
  assert.equal(Math.abs(catmull.pose.observerPc.y - 5) > 0.01, true);
});

test('path interpolation normalizers reject unsupported kinds and numeric ranges', () => {
  const pathWithInterpolation = (interpolation) => ({
    positionKeys: [
      { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 }, interpolation },
      { id: 'b', timeSecs: 1, positionPc: { x: 1, y: 0, z: 0 } },
    ],
  });
  assert.throws(() => normalizeSpatialPathSpec(pathWithInterpolation({ kind: 'warp' })), TypeError);
  assert.throws(() => normalizeSpatialPathSpec(pathWithInterpolation({ kind: 'catmullRom', tension: 2 })), RangeError);
  assert.throws(() => normalizeSpatialPathSpec({
    ...pathWithInterpolation({ kind: 'linear' }),
    timeRemap: { kind: 'eased', easing: { kind: 'cubicBezier', x1: -0.1, y1: 0, x2: 1, y2: 1 } },
  }), RangeError);
});

test('aim interpolation preserves target, direction, orientation, and hold semantics', () => {
  const targetTrack = buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } } },
    { id: 'b', timeSecs: 10, aim: { kind: 'target', targetPc: { x: 10, y: 0, z: -10 } } },
  ], { durationSecs: 10 });
  const target = evaluateSpatialAimTrack(targetTrack, 5, { observerPc: { x: 0, y: 0, z: 0 } }).aim;
  assert.equal(target.kind, 'target');
  assertVectorApprox(target.targetPc, { x: 5, y: 0, z: -10 });

  const targetBezier = evaluateSpatialAimTrack(buildSpatialAimTrack([
    {
      id: 'a',
      timeSecs: 0,
      aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } },
      interpolation: { kind: 'targetBezier' },
    },
    { id: 'b', timeSecs: 10, aim: { kind: 'target', targetPc: { x: 10, y: 0, z: -10 } } },
  ], { durationSecs: 10 }), 2.5, { observerPc: { x: 0, y: 0, z: 0 } }).aim;
  assertVectorApprox(targetBezier.targetPc, { x: 1.5625, y: 0, z: -10 });

  const cubicEased = evaluateSpatialAimTrack(buildSpatialAimTrack([
    {
      id: 'a',
      timeSecs: 0,
      aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } },
      interpolation: { kind: 'targetLinear', easing: { kind: 'cubicBezier', x1: 0, y1: 0, x2: 0, y2: 1 } },
    },
    { id: 'b', timeSecs: 10, aim: { kind: 'target', targetPc: { x: 10, y: 0, z: -10 } } },
  ], { durationSecs: 10 }), 1.25, { observerPc: { x: 0, y: 0, z: 0 } }).aim;
  assertVectorApprox(cubicEased.targetPc, { x: 5, y: 0, z: -10 }, 1e-6);

  const direction = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'direction', forwardIcrs: { x: 1, y: 0, z: 0 } } },
    { id: 'b', timeSecs: 10, aim: { kind: 'direction', forwardIcrs: { x: 0, y: 1, z: 0 } } },
  ], { durationSecs: 10 }), 5, {}).aim;
  assert.equal(direction.kind, 'direction');
  assertVectorApprox(direction.forwardIcrs, { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 });

  const orientation = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'orientation', orientationIcrs: SPATIAL_IDENTITY_QUATERNION } },
    {
      id: 'b',
      timeSecs: 10,
      aim: { kind: 'orientation', orientationIcrs: createSpatialQuaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2) },
    },
  ], { durationSecs: 10 }), 5, {}).aim;
  assert.equal(orientation.kind, 'orientation');

  const mixed = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'direction', forwardIcrs: { x: 1, y: 0, z: 0 } }, source: { packageName: 'test', id: 'left' } },
    { id: 'b', timeSecs: 10, aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } }, source: { packageName: 'test', id: 'right' } },
  ], { durationSecs: 10 }), 5, { observerPc: { x: 0, y: 0, z: 0 } });
  assert.equal(mixed.aim.kind, 'orientation');
  assert.equal(mixed.aim.diagnostics.warnings[0].code, 'mixedAimInterpolation');
  assert.equal(mixed.aim.diagnostics.warnings[0].metadata.leftSource.id, 'left');

  const mixedLeftOnly = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'direction', forwardIcrs: { x: 1, y: 0, z: 0 } }, source: { packageName: 'test', id: 'left-only' } },
    { id: 'b', timeSecs: 10, aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } } },
  ], { durationSecs: 10 }), 5, { observerPc: { x: 0, y: 0, z: 0 } });
  assert.equal(mixedLeftOnly.aim.diagnostics.warnings[0].metadata.leftSource.id, 'left-only');
  assert.equal('rightSource' in mixedLeftOnly.aim.diagnostics.warnings[0].metadata, false);

  const mixedRightOnly = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'direction', forwardIcrs: { x: 1, y: 0, z: 0 } } },
    { id: 'b', timeSecs: 10, aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } }, source: { packageName: 'test', id: 'right-only' } },
  ], { durationSecs: 10 }), 5, { observerPc: { x: 0, y: 0, z: 0 } });
  assert.equal(mixedRightOnly.aim.diagnostics.warnings[0].metadata.rightSource.id, 'right-only');
  assert.equal('leftSource' in mixedRightOnly.aim.diagnostics.warnings[0].metadata, false);

  const hold = evaluateSpatialAimTrack(buildSpatialAimTrack([
    {
      id: 'a',
      timeSecs: 0,
      aim: { kind: 'direction', forwardIcrs: { x: 1, y: 0, z: 0 } },
      interpolation: { kind: 'hold' },
    },
    { id: 'b', timeSecs: 10, aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } } },
  ], { durationSecs: 10 }), 5, {});
  assert.equal(hold.aim.kind, 'direction');
});

test('aim interpolation validates specs and applies fallback up vectors', () => {
  assert.throws(() => buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'direction', forwardIcrs: { x: 1, y: 0, z: 0 } }, interpolation: { kind: 'spin' } },
  ], { durationSecs: 1 }), TypeError);
  assert.throws(() => buildSpatialAimTrack([], {
    defaultInterpolation: { kind: 'targetLinear', easing: { kind: 'cubicBezier', x1: 0.2, y1: 0, x2: 1.2, y2: 1 } },
  }), RangeError);

  const fallback = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { kind: 'target', targetPc: { x: 10, y: 0, z: 0 } } },
  ], { durationSecs: 1 }), 0, {
    observerPc: { x: 0, y: 0, z: 0 },
    fallbackUpIcrs: { x: 0, y: 0, z: 1 },
  }).aim;
  assertVectorApprox(fallback.upIcrs, { x: 0, y: 0, z: 1 });
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
