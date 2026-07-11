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
  createSpatialPoseTransition,
  createDirectSpatialMotionModel,
  createInertialSpatialMotionModel,
  createSpatialNavigationAutomation,
  createThrustSpatialMotionModel,
  deriveSpatialOrbitAngle,
  deriveSpatialOrbitHandoff,
  deriveSpatialOrbitalInsertTiming,
  deriveSpatialRouteTiming,
  evaluateSpatialAim,
  evaluateSpatialAimTrack,
  evaluateSpatialOrbit,
  evaluateSpatialPath,
  evaluateSpatialPathPlayback,
  evaluateSpatialPoseTransition,
  evaluateSpatialRoute,
  evaluateSpatialViewTransition,
  getSpatialRouteDiagnostics,
  icrsToRaDec,
  materializeSpatialPreloadHints,
  normalizeSpatialAimSpec,
  normalizeSpatialArrivalAction,
  normalizeSpatialDestination,
  normalizeSpatialDirection,
  normalizeSpatialOrbitSpec,
  normalizeSpatialPathSpec,
  normalizeSpatialPose,
  normalizeSpatialQuaternion,
  normalizeSpatialRouteEndpointSpec,
  normalizeSpatialScaleProfile,
  normalizeSpatialTarget,
  normalizeSpatialTimingSpec,
  normalizeSpatialTravelSpec,
  normalizeSpatialUpdateDelta,
  normalizeSpatialVector3,
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
  assert.deepEqual(icrsToRaDec({ x: 1e-12, y: 0, z: 0 }), { raDeg: 0, raHours: 0, decDeg: 0 });
  assert.deepEqual(projectSpatialEquirectangular({ raDeg: 180, decDeg: 0, width: 360, height: 180 }), { x: 180, y: 90 });
  assert.throws(() => normalizeSpatialPose({ position: { x: 0, y: 0, z: 0 } }), /observerPc/);
  assert.deepEqual(normalizeSpatialPose({}), {
    observerPc: { x: 0, y: 0, z: 0 },
    orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
  });
});

test('canonical normalizers reject malformed values instead of coercing or defaulting', () => {
  assert.throws(() => normalizeSpatialVector3({ x: '1', y: 2, z: 3 }), TypeError);
  assert.throws(() => normalizeSpatialVector3({ x: Number.NaN, y: 2, z: 3 }), RangeError);
  assert.throws(() => normalizeSpatialQuaternion({ x: 0, y: 0, z: 0, w: '1' }), TypeError);
  assert.throws(() => normalizeSpatialDirection({ x: '1', y: 0, z: 0 }), TypeError);
  assert.deepEqual(normalizeSpatialDirection({ x: 1e-12, y: 0, z: 0 }), { x: 1, y: 0, z: 0 });

  assert.throws(() => normalizeSpatialScaleProfile({ metersPerNavigationUnit: -1 }), RangeError);
  assert.throws(() => normalizeSpatialScaleProfile({ worldUnitsPerNavigationUnit: '1' }), TypeError);
  assert.throws(() => normalizeSpatialScaleProfile({ navigationUnits: 1 }), TypeError);

  assert.throws(() => normalizeSpatialTarget({
    kind: 'radec',
    raDeg: 10,
    raHours: 1,
    decDeg: 0,
    distancePc: 1,
  }), TypeError);
  assert.throws(() => normalizeSpatialTarget({ kind: 'radec', raDeg: 10, decDeg: 91, distancePc: 1 }), RangeError);
  assert.throws(() => normalizeSpatialTarget({ kind: 'radec', raDeg: '10', decDeg: 0, distancePc: 1 }), TypeError);

  assert.throws(() => normalizeSpatialAimSpec({
    kind: 'direction',
    forwardIcrs: { x: 0, y: 0, z: 0 },
  }), RangeError);
  assert.deepEqual(normalizeSpatialAimSpec({
    kind: 'direction',
    forwardIcrs: { x: 1e-12, y: 0, z: 0 },
  }).forwardIcrs, { x: 1, y: 0, z: 0 });
  assert.throws(() => normalizeSpatialAimSpec({
    kind: 'target',
    targetPc: { x: 0, y: 0, z: 0 },
    positionAngleDeg: Number.NaN,
  }), RangeError);
  assert.throws(() => normalizeSpatialAimSpec({
    kind: 'target',
    targetPc: { x: 0, y: 0, z: 0 },
    lock: 1,
  }), TypeError);

  assert.throws(() => normalizeSpatialDestination({ centerPc: { x: 0, y: 0, z: 0 }, radiusPc: -1 }), RangeError);
  assert.throws(() => normalizeSpatialDestination({ centerPc: { x: 0, y: 0, z: 0 }, dwellSecs: Number.NaN }), RangeError);
  assert.throws(() => normalizeSpatialOrbitSpec({ centerPc: { x: 0, y: 0, z: 0 }, radiusPc: 0 }), RangeError);
  assert.throws(() => normalizeSpatialOrbitSpec({ centerPc: { x: 0, y: 0, z: 0 }, radiusPc: 1, handedness: 0 }), RangeError);

  assert.throws(() => normalizeSpatialTravelSpec({ kind: 'polyline', sampleStepSecs: 0 }), RangeError);
  assert.throws(() => normalizeSpatialTravelSpec({ kind: 'polyline', maxPoints: 1.5 }), RangeError);
  assert.throws(() => normalizeSpatialRouteEndpointSpec({ speedPcPerSec: -1 }), RangeError);
  assert.throws(() => normalizeSpatialArrivalAction({
    kind: 'lookAt',
    aim: { kind: 'target', targetPc: { x: 0, y: 0, z: 0 } },
    dwellSecs: -1,
  }), RangeError);
  assert.throws(() => normalizeSpatialArrivalAction({
    kind: 'orbitalInsert',
    orbit: { centerPc: { x: 0, y: 0, z: 0 }, radiusPc: 1 },
    timing: { garbage: true },
  }), TypeError);

  const singlePositionKey = [{ id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } }];
  assert.throws(() => buildSpatialAimTrack([], { durationSecs: -1 }), RangeError);
  assert.throws(() => normalizeSpatialPathSpec({
    positionKeys: singlePositionKey,
    duplicateTimePolicy: 'merge',
  }), TypeError);
  assert.throws(() => normalizeSpatialPathSpec({ positionKeys: singlePositionKey, durationSecs: -1 }), RangeError);
  assert.throws(() => normalizeSpatialPathSpec({
    positionKeys: singlePositionKey,
    timeRemap: { kind: 'linear', playbackDurationSecs: -1 },
  }), RangeError);

  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSecs: -1 }), RangeError);
  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSecs: Number.NaN }), RangeError);
  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSecs: '1' }), TypeError);
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

  for (const upIcrs of [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]) {
    const recovered = evaluateSpatialAim({
      observerPc: { x: 0, y: 0, z: 0 },
      aim: { kind: 'target', targetPc: { x: 1, y: 0, z: 0 }, upIcrs },
    });
    assert.equal(recovered.diagnostics.warnings.some((entry) => entry.code === 'degenerateAimUp'), true);
    assert.ok(Math.abs(dotTestVectors(recovered.forwardIcrs, recovered.upIcrs)) < 1e-9);
    assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, recovered.orientationIcrs), { x: 1, y: 0, z: 0 });
  }
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

  const destinationOrbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 2,
    angularSpeedRadPerSec: 1,
  };
  const pointOnly = buildSpatialRouteEndpoint({
    positionPc: { x: 3, y: 0, z: 0 },
    destination: { centerPc: destinationOrbit.centerPc, orbit: destinationOrbit },
    orbit: null,
  }, { fallbackOrbit: destinationOrbit });
  assert.ok(pointOnly);
  assert.equal('orbit' in pointOnly, false);
  assert.equal('orbitBasis' in pointOnly, false);
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

test('non-zero routes below the general math epsilon retain exact geometry and timing', () => {
  const distancePc = 1e-10;
  const route = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: distancePc, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1 } },
  });
  assert.equal(route.segments.length, 1);
  assert.equal(route.totalLengthPc, distancePc);
  assert.equal(route.timing.phases.at(-1).endDistancePc, distancePc);
  assert.equal(evaluateSpatialRoute(route, 0.5).positionPc.x, distancePc * 0.5);
  assert.deepEqual(evaluateSpatialRoute(route, 1).positionPc, route.arrival.positionPc);

  const kinematic = deriveSpatialRouteTiming({
    totalLengthPc: distancePc,
    travel: {
      kind: 'polyline',
      timing: { kind: 'trapezoid', durationSecs: 1 },
    },
  });
  assert.ok(Math.abs(kinematic.phases.at(-1).endDistancePc - distancePc) <= distancePc * 1e-12);

  const asymmetricEndpoint = deriveSpatialRouteTiming({
    totalLengthPc: distancePc,
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'trapezoid',
        durationSecs: 1,
        departureSpeedPcPerSec: 0,
        arrivalSpeedPcPerSec: 0.1,
        accelerationPcPerSec2: 0.1,
        decelerationPcPerSec2: 0.1,
      },
    },
  });
  assert.ok(Math.abs(asymmetricEndpoint.phases.at(-1).endDistancePc - distancePc) <= distancePc * 1e-12);

  const tinyDurationRoute = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: distancePc, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1e-10 } },
  });
  assert.equal(evaluateSpatialRoute(tinyDurationRoute, 0).complete, false);
  assert.equal(evaluateSpatialRoute(tinyDurationRoute, 5e-11).positionPc.x, distancePc * 0.5);
  assert.deepEqual(evaluateSpatialRoute(tinyDurationRoute, 1e-10).positionPc, tinyDurationRoute.arrival.positionPc);
  assert.equal(getSpatialRouteDiagnostics(tinyDurationRoute).averageSpeedPcPerSec, 1);

  const tinySpeed = deriveSpatialRouteTiming({
    totalLengthPc: distancePc,
    travel: { kind: 'polyline', timing: { kind: 'constantSpeed', speedPcPerSec: 1e-10 } },
  });
  assert.equal(tinySpeed.durationSecs, 1);

  const smallEqualEndpoints = deriveSpatialRouteTiming({
    totalLengthPc: distancePc,
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'trapezoid',
        departureSpeedPcPerSec: 0.1,
        arrivalSpeedPcPerSec: 0.1,
        accelerationPcPerSec2: 1e-6,
        decelerationPcPerSec2: 1e-6,
      },
    },
  });
  assert.ok(Math.abs(smallEqualEndpoints.phases.at(-1).endDistancePc - distancePc) <= distancePc * 1e-12);
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

  const leftHandedOrbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: -1,
    angularSpeedRadPerSec: 0.2,
  };
  const nearestAngle = deriveSpatialOrbitAngle({
    centerPc: leftHandedOrbit.centerPc,
    positionPc: { x: 0, y: 0, z: 10 },
    orbitNormal: leftHandedOrbit.orbitNormal,
    referenceAxis: leftHandedOrbit.referenceAxis,
    handedness: leftHandedOrbit.handedness,
  });
  assertVectorApprox(
    evaluateSpatialOrbit({ ...leftHandedOrbit, initialAngleRad: nearestAngle }, 0).positionPc,
    { x: 0, y: 0, z: 5 },
  );
  const leftHandedInsert = buildSpatialOrbitalInsertRoute({
    from: { positionPc: { x: 0, y: 0, z: 10 } },
    orbit: leftHandedOrbit,
    travel: { kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 1 } },
  });
  assert.ok(leftHandedInsert);
  const leftHandedApproach = subtractTestVectors(
    leftHandedInsert.arrival.positionPc,
    leftHandedInsert.departure.positionPc,
  );
  const leftHandedRadial = subtractTestVectors(
    leftHandedInsert.arrival.positionPc,
    leftHandedOrbit.centerPc,
  );
  assert.ok(Math.abs(dotTestVectors(leftHandedApproach, leftHandedRadial)) < 1e-9);
});

test('orbital insert defaults to the signed orbital tangent for both handedness values', () => {
  const centerPc = { x: 0, y: 0, z: 0 };
  const departurePc = { x: 15, y: 0, z: 0 };
  const radiusPc = 5;
  const cases = [
    { handedness: 1, angularSpeedRadPerSec: 0.2 },
    { handedness: 1, angularSpeedRadPerSec: -0.2 },
    { handedness: -1, angularSpeedRadPerSec: 0.2 },
    { handedness: -1, angularSpeedRadPerSec: -0.2 },
    { handedness: 1, angularSpeedRadPerSec: 0 },
    { handedness: -1, angularSpeedRadPerSec: 0 },
  ];

  for (const [index, { handedness, angularSpeedRadPerSec }] of cases.entries()) {
    const orbit = {
      centerPc,
      radiusPc,
      orbitNormal: { x: 0, y: 1, z: 0 },
      referenceAxis: { x: 1, y: 0, z: 0 },
      handedness,
      angularSpeedRadPerSec,
    };
    const route = buildSpatialOrbitalInsertRoute({
      from: {
        positionPc: departurePc,
        // This deliberately favors the other candidate for the first case.
        // Orbit direction, rather than authored departure velocity, owns insertion selection.
        ...(index === 0 ? { velocityPcPerSec: { x: 0, y: 0, z: 0.25 } } : {}),
      },
      orbit,
      travel: {
        kind: 'orbitalInsert',
        sampleStepSecs: 0.005,
        maxPoints: 512,
        timing: { kind: 'duration', durationSecs: 4 },
      },
    });
    assert.ok(route);
    assert.equal(route.diagnostics.insertionSelection, 'tangent');
    assertVectorApprox(route.diagnostics.insertionPositionPc, route.arrival.positionPc);
    assert.equal(route.diagnostics.insertionAngleRad, route.arrival.orbit.initialAngleRad);
    assert.ok(route.diagnostics.insertionApproachAlignment > 1 - 1e-12);
    assert.equal(route.diagnostics.insertionPlaneOffsetPc, 0);
    if (index === 0) assert.ok(route.diagnostics.insertionDepartureVelocityAlignment < 0);

    const approach = subtractTestVectors(route.arrival.positionPc, departurePc);
    const radial = subtractTestVectors(route.arrival.positionPc, centerPc);
    assert.ok(
      Math.abs(dotTestVectors(approach, radial)) < 1e-9,
      `approach must be perpendicular to arrival radial for handedness ${handedness} and angular speed ${angularSpeedRadPerSec}`,
    );
    assert.ok(Math.abs(testVectorLength(radial) - radiusPc) < 1e-9);
    assert.ok(Math.abs(route.arrival.positionPc.x - radiusPc ** 2 / departurePc.x) < 1e-9);

    const signedDirection = handedness * Math.sign(angularSpeedRadPerSec || 1);
    assert.equal(
      Math.sign(route.arrival.positionPc.z),
      -signedDirection,
      `tangent branch must follow handedness and signed angular speed`,
    );

    if (angularSpeedRadPerSec !== 0) {
      const routeEnd = evaluateSpatialRoute(route, route.timing.durationSecs);
      const orbitStart = evaluateSpatialOrbit(route.arrivalAction.orbit, 0);
      assertVectorApprox(route.arrival.velocityPcPerSec, orbitStart.velocityPcPerSec);
      assert.equal(route.arrival.speedPcPerSec, orbitStart.speedPcPerSec);
      assertVectorApprox(
        normalizeTestVector(routeEnd.velocityPcPerSec),
        normalizeTestVector(orbitStart.velocityPcPerSec),
        1e-9,
      );
    }
  }
});

test('orbital insert preserves an explicit initial angle instead of deriving a tangent', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: 1,
    initialAngleRad: Math.PI / 2,
    angularSpeedRadPerSec: 0.2,
  };
  const route = buildSpatialOrbitalInsertRoute({
    from: { positionPc: { x: 15, y: 0, z: 0 } },
    orbit,
    travel: {
      kind: 'orbitalInsert',
      sampleStepSecs: 0.005,
      maxPoints: 512,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(route);
  assert.equal(route.diagnostics.insertionSelection, 'explicitAngle');
  assertVectorApprox(route.diagnostics.insertionPositionPc, route.arrival.positionPc);
  assert.equal(route.diagnostics.insertionAngleRad, orbit.initialAngleRad);
  assert.equal(route.arrival.orbit.initialAngleRad, orbit.initialAngleRad);
  assert.equal(route.arrivalAction.orbit.initialAngleRad, orbit.initialAngleRad);
  assertVectorApprox(route.arrival.positionPc, { x: 0, y: 0, z: -5 });

  const approach = subtractTestVectors(route.arrival.positionPc, route.departure.positionPc);
  const radial = subtractTestVectors(route.arrival.positionPc, orbit.centerPc);
  assert.ok(Math.abs(dotTestVectors(approach, radial)) > 1);

  const routeEnd = evaluateSpatialRoute(route, route.timing.durationSecs);
  const orbitStart = evaluateSpatialOrbit(route.arrivalAction.orbit, 0);
  assertVectorApprox(route.arrival.velocityPcPerSec, orbitStart.velocityPcPerSec);
  assertVectorApprox(
    normalizeTestVector(routeEnd.velocityPcPerSec),
    normalizeTestVector(orbitStart.velocityPcPerSec),
    1e-9,
  );
});

test('orbital insert reports nearest-angle fallback reasons when no real tangent exists', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: 1,
    angularSpeedRadPerSec: 0.2,
  };
  const fallbackCases = [
    { positionPc: { x: 2, y: 0, z: 0 }, reason: 'insideOrbitRadius' },
    { positionPc: { x: 0, y: 0, z: 0 }, reason: 'onOrbitAxis' },
    { positionPc: { x: 0, y: 10, z: 0 }, reason: 'onOrbitAxis' },
  ];

  for (const { positionPc, reason } of fallbackCases) {
    const route = buildSpatialOrbitalInsertRoute({
      from: { positionPc },
      orbit,
      travel: { kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 2 } },
    });
    assert.ok(route);
    assert.equal(route.diagnostics.insertionSelection, 'nearestAngleFallback');
    const fallback = route.diagnostics.warnings.find((entry) => entry.code === 'orbitalInsertTangentFallback');
    assert.ok(fallback, `expected tangent fallback diagnostic for ${reason}`);
    assert.equal(fallback.metadata.reason, reason);
    assert.equal(fallback.metadata.radiusPc, orbit.radiusPc);
    assert.equal(fallback.metadata.projectedDistancePc, reason === 'insideOrbitRadius' ? 2 : 0);
    assertVectorApprox(route.diagnostics.insertionPositionPc, route.arrival.positionPc);
    assert.equal(route.diagnostics.insertionAngleRad, route.arrival.orbit.initialAngleRad);
    assert.ok(Math.abs(testVectorLength(subtractTestVectors(
      route.arrival.positionPc,
      orbit.centerPc,
    )) - orbit.radiusPc) < 1e-9);
  }
});

test('orbital insert classifies rotated orbit-axis starts with numerical tolerance', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 1, y: 1, z: 1 },
    referenceAxis: { x: 1, y: -1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const axisRoute = buildSpatialOrbitalInsertRoute({
    from: { positionPc: { x: 10, y: 10, z: 10 } },
    orbit,
    travel: { kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 2 } },
  });
  assert.ok(axisRoute);
  const axisFallback = axisRoute.diagnostics.warnings.find(
    (entry) => entry.code === 'orbitalInsertTangentFallback',
  );
  assert.ok(axisFallback);
  assert.equal(axisFallback.metadata.reason, 'onOrbitAxis');
  assert.ok(axisFallback.metadata.projectedDistancePc < 1e-12);

  const materialOffsetPc = 1e-9;
  const inverseSqrtTwo = 1 / Math.sqrt(2);
  const offsetRoute = buildSpatialOrbitalInsertRoute({
    from: {
      positionPc: {
        x: 10 + materialOffsetPc * inverseSqrtTwo,
        y: 10 - materialOffsetPc * inverseSqrtTwo,
        z: 10,
      },
    },
    orbit,
    travel: { kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 2 } },
  });
  assert.ok(offsetRoute);
  const offsetFallback = offsetRoute.diagnostics.warnings.find(
    (entry) => entry.code === 'orbitalInsertTangentFallback',
  );
  assert.ok(offsetFallback);
  assert.equal(offsetFallback.metadata.reason, 'insideOrbitRadius');
  assert.ok(Math.abs(offsetFallback.metadata.projectedDistancePc - materialOffsetPc) < 1e-14);
});

test('off-plane orbital insert selects a projected tangent and bends into the orbit plane', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: 1,
    angularSpeedRadPerSec: 0.2,
  };
  const route = buildSpatialOrbitalInsertRoute({
    from: { positionPc: { x: 15, y: 4, z: 0 } },
    orbit,
    travel: {
      kind: 'orbitalInsert',
      sampleStepSecs: 0.005,
      maxPoints: 512,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(route);
  assert.equal(route.diagnostics.insertionSelection, 'tangent');
  assertVectorApprox(route.diagnostics.insertionPositionPc, route.arrival.positionPc);
  assert.equal(route.diagnostics.insertionAngleRad, route.arrival.orbit.initialAngleRad);
  assert.equal(route.diagnostics.insertionPlaneOffsetPc, 4);
  assert.equal(route.diagnostics.warnings.some((entry) => entry.code === 'orbitalInsertTangentFallback'), false);
  const planeChange = route.diagnostics.warnings.find((entry) => entry.code === 'orbitalInsertPlaneChange');
  assert.ok(planeChange);
  assert.equal(planeChange.metadata.planeOffsetPc, 4);
  assert.equal(planeChange.metadata.absolutePlaneOffsetPc, 4);

  const approach = subtractTestVectors(route.arrival.positionPc, route.departure.positionPc);
  const radial = subtractTestVectors(route.arrival.positionPc, orbit.centerPc);
  assert.ok(Math.abs(dotTestVectors(approach, radial)) < 1e-9);
  assert.ok(Math.abs(route.arrival.positionPc.y) < 1e-9);
  assert.ok(Math.abs(
    route.diagnostics.insertionApproachAlignment
      - dotTestVectors(normalizeTestVector(approach), route.diagnostics.selectedTangent)
  ) < 1e-12);
  assert.ok(route.diagnostics.insertionApproachAlignment > 0);
  assert.ok(route.diagnostics.insertionApproachAlignment < 1);

  const routeEnd = evaluateSpatialRoute(route, route.timing.durationSecs);
  const orbitStart = evaluateSpatialOrbit(route.arrivalAction.orbit, 0);
  assertVectorApprox(route.arrival.velocityPcPerSec, orbitStart.velocityPcPerSec);
  assertVectorApprox(
    normalizeTestVector(routeEnd.velocityPcPerSec),
    normalizeTestVector(orbitStart.velocityPcPerSec),
    1e-9,
  );
  assert.ok(Math.abs(routeEnd.velocityPcPerSec.y) < 1e-9);
});

test('timing profiles derive physical phases and constraint diagnostics', () => {
  assert.throws(() => deriveSpatialOrbitalInsertTiming({
    distancePc: -1,
    orbitalSpeedPcPerSec: 0,
  }), /distancePc/);
  assert.throws(() => deriveSpatialOrbitalInsertTiming({
    distancePc: 1,
    orbitalSpeedPcPerSec: -1,
  }), /orbitalSpeedPcPerSec/);

  const timing = deriveSpatialOrbitalInsertTiming({
    distancePc: 10,
    currentSpeedPcPerSec: 0,
    approachSpeedPcPerSec: 4,
    orbitalSpeedPcPerSec: 1,
    accelerationPcPerSec2: 2,
    decelerationPcPerSec2: 1,
  });
  assert.equal(timing.phases.some((phase) => phase.kind === 'accelerate'), true);
  assert.equal(timing.phases.some((phase) => phase.kind === 'decelerate'), true);
  assert.equal(timing.diagnostics.requestedAccelerationApplied, true);
  assert.equal(timing.diagnostics.requestedDecelerationApplied, true);

  const constrained = deriveSpatialOrbitalInsertTiming({
    distancePc: 10,
    currentSpeedPcPerSec: 5,
    orbitalSpeedPcPerSec: 1,
    durationSecs: 2,
    decelerationPcPerSec2: 0.1,
  });
  assert.equal(constrained.durationSecs, 2);
  assert.equal(constrained.diagnostics.durationConstrainedProfile, true);
  assert.equal(constrained.diagnostics.requestedDecelerationApplied, false);
  assert.equal(constrained.diagnostics.warnings.some((warning) => warning.code === 'requestedDecelerationFitted'), true);

  const accelerationOnly = deriveSpatialOrbitalInsertTiming({
    distancePc: 10,
    currentSpeedPcPerSec: 1,
    orbitalSpeedPcPerSec: 5,
    accelerationPcPerSec2: 2,
  });
  assert.equal(accelerationOnly.departureSpeedPcPerSec, 1);
  assert.equal(accelerationOnly.arrivalSpeedPcPerSec, 5);
  assert.equal(accelerationOnly.phases.at(-1).endSpeedPcPerSec, 5);
  assert.equal(accelerationOnly.diagnostics.requestedAccelerationApplied, true);

  const decelerationOnly = deriveSpatialOrbitalInsertTiming({
    distancePc: 10,
    currentSpeedPcPerSec: 5,
    orbitalSpeedPcPerSec: 1,
    decelerationPcPerSec2: 2,
  });
  assert.equal(decelerationOnly.departureSpeedPcPerSec, 5);
  assert.equal(decelerationOnly.arrivalSpeedPcPerSec, 1);
  assert.equal(decelerationOnly.phases.at(-1).endSpeedPcPerSec, 1);
  assert.equal(decelerationOnly.diagnostics.requestedDecelerationApplied, true);

  const ignoredDeceleration = deriveSpatialOrbitalInsertTiming({
    distancePc: 10,
    currentSpeedPcPerSec: 1,
    orbitalSpeedPcPerSec: 5,
    decelerationPcPerSec2: 2,
  });
  assert.equal(ignoredDeceleration.departureSpeedPcPerSec, 1);
  assert.equal(ignoredDeceleration.arrivalSpeedPcPerSec, 5);
  assert.equal(ignoredDeceleration.phases.at(-1).endSpeedPcPerSec, 5);
  assert.equal(ignoredDeceleration.diagnostics.requestedDecelerationApplied, false);
  assert.equal(ignoredDeceleration.diagnostics.warnings.some((warning) => warning.code === 'requestedDecelerationIgnored'), true);

  const equalSpeedWithRates = deriveSpatialOrbitalInsertTiming({
    distancePc: 10,
    currentSpeedPcPerSec: 1,
    orbitalSpeedPcPerSec: 1,
    accelerationPcPerSec2: 2,
    decelerationPcPerSec2: 2,
  });
  assert.equal(equalSpeedWithRates.departureSpeedPcPerSec, 1);
  assert.equal(equalSpeedWithRates.arrivalSpeedPcPerSec, 1);
  assert.equal(equalSpeedWithRates.diagnostics.requestedAccelerationApplied, false);
  assert.equal(equalSpeedWithRates.diagnostics.requestedDecelerationApplied, false);
  assert.equal(equalSpeedWithRates.diagnostics.warnings.some((warning) => warning.code === 'requestedAccelerationIgnored'), true);
  assert.equal(equalSpeedWithRates.diagnostics.warnings.some((warning) => warning.code === 'requestedDecelerationIgnored'), true);

  const clamped = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1, minDurationSecs: 4 } },
  });
  assert.equal(clamped.timing.durationSecs, 4);
  assert.equal(clamped.timing.diagnostics.clampedToMinDuration, true);

  const maxClamped = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 8, maxDurationSecs: 5 } },
  });
  assert.equal(maxClamped.timing.durationSecs, 5);
  assert.equal(maxClamped.timing.diagnostics.clampedToMaxDuration, true);
});

test('route timing preserves authored endpoint speeds and validates reusable profiles', () => {
  const authored = deriveSpatialRouteTiming({
    totalLengthPc: 7,
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'trapezoid',
        departureSpeedPcPerSec: 5,
        arrivalSpeedPcPerSec: 2,
      },
    },
  });
  assert.equal(authored.departureSpeedPcPerSec, 5);
  assert.equal(authored.arrivalSpeedPcPerSec, 2);
  assertTimingProfileInvariants(authored, 7);

  const endpointOverride = deriveSpatialRouteTiming({
    totalLengthPc: 7,
    departureSpeedPcPerSec: 3,
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'trapezoid',
        departureSpeedPcPerSec: 5,
        arrivalSpeedPcPerSec: 2,
      },
    },
  });
  assert.equal(endpointOverride.departureSpeedPcPerSec, 3);
  assert.equal(endpointOverride.arrivalSpeedPcPerSec, 2);

  const reusable = deriveSpatialRouteTiming({
    totalLengthPc: 7,
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 2 } },
  });
  const reused = deriveSpatialRouteTiming({
    totalLengthPc: 7,
    travel: { kind: 'polyline', timing: reusable },
  });
  assert.notEqual(reused, reusable);
  assert.notEqual(reused.phases, reusable.phases);
  assertTimingProfileInvariants(reused, 7);
  assert.throws(() => deriveSpatialRouteTiming({
    totalLengthPc: 8,
    travel: { kind: 'polyline', timing: reusable },
  }), /final phase distance/);
  assert.throws(() => deriveSpatialRouteTiming({
    totalLengthPc: 7,
    travel: { kind: 'polyline', timing: { ...reusable, distancePc: 8 } },
  }), /distancePc must match/);
  assert.throws(() => deriveSpatialRouteTiming({
    totalLengthPc: 7,
    travel: { kind: 'polyline', timing: { ...reusable, arrivalSpeedPcPerSec: 99 } },
  }), /arrivalSpeedPcPerSec must match/);
  assert.throws(() => deriveSpatialRouteTiming({
    totalLengthPc: 7,
    travel: { kind: 'polyline', timing: { ...reusable, kind: 'bogus' } },
  }), /profile kind/);
  for (const mismatch of [
    { peakSpeedPcPerSec: -1 },
    { cruiseSpeedPcPerSec: 99 },
    { accelerationPcPerSec2: 1 },
  ]) {
    assert.throws(() => deriveSpatialRouteTiming({
      totalLengthPc: 7,
      travel: { kind: 'polyline', timing: { ...reusable, ...mismatch } },
    }), /SpatialTimingProfile/);
  }
  assert.throws(() => deriveSpatialRouteTiming({
    totalLengthPc: 7,
    travel: { kind: 'polyline', timing: { ...reusable, diagnostics: {} } },
  }), /diagnostics\.warnings/);

  const normalizedArrival = normalizeSpatialArrivalAction({
    kind: 'orbitalInsert',
    orbit: { centerPc: { x: 0, y: 0, z: 0 }, radiusPc: 1 },
    timing: reusable,
  });
  assert.notEqual(normalizedArrival.timing, reusable);
  assert.notEqual(normalizedArrival.timing.phases, reusable.phases);
});

test('kinematic timing fits infeasible rates without violating phase physics', () => {
  const restToRest = deriveSpatialRouteTiming({
    totalLengthPc: 1,
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'trapezoid',
        departureSpeedPcPerSec: 0,
        cruiseSpeedPcPerSec: 0,
        arrivalSpeedPcPerSec: 0,
        accelerationPcPerSec2: 1,
        decelerationPcPerSec2: 1,
      },
    },
  });
  assertTimingProfileInvariants(restToRest, 1);
  assert.equal(restToRest.kind, 'triangular');
  assert.ok(restToRest.peakSpeedPcPerSec > 0);

  const shortStop = deriveSpatialOrbitalInsertTiming({
    distancePc: 1,
    currentSpeedPcPerSec: 10,
    orbitalSpeedPcPerSec: 0,
    accelerationPcPerSec2: 1,
    decelerationPcPerSec2: 1,
  });
  assertTimingProfileInvariants(shortStop, 1);
  assert.ok(Math.abs(shortStop.durationSecs - 0.2) < 1e-9);
  assert.equal(shortStop.diagnostics.requestedDecelerationApplied, false);
  assert.equal(shortStop.diagnostics.warnings.some((entry) => entry.code === 'endpointRateFittedToDistance'), true);

  const durationConstrained = deriveSpatialOrbitalInsertTiming({
    distancePc: 1,
    currentSpeedPcPerSec: 10,
    orbitalSpeedPcPerSec: 0,
    durationSecs: 10,
    accelerationPcPerSec2: 1,
    decelerationPcPerSec2: 1,
  });
  assertTimingProfileInvariants(durationConstrained, 1);
  assert.equal(durationConstrained.durationSecs, 10);

  const route = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'trapezoid',
        departureSpeedPcPerSec: 10,
        arrivalSpeedPcPerSec: 0,
        accelerationPcPerSec2: 1,
        decelerationPcPerSec2: 1,
      },
    },
  });
  assert.ok(Math.abs(evaluateSpatialRoute(route, route.timing.durationSecs / 2).distancePc - 0.75) < 1e-9);
  const complete = evaluateSpatialRoute(route, route.timing.durationSecs);
  assert.equal(complete.complete, true);
  assertVectorApprox(complete.positionPc, { x: 1, y: 0, z: 0 });
});

test('route evaluation samples distance from timing phases', () => {
  const route = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'trapezoid',
        departureSpeedPcPerSec: 0,
        arrivalSpeedPcPerSec: 0,
        accelerationPcPerSec2: 2,
        decelerationPcPerSec2: 2,
      },
    },
  });
  const sample = evaluateSpatialRoute(route, 1);
  const linearDistance = route.totalLengthPc * (sample.elapsedSecs / route.timing.durationSecs);
  assert.equal(sample.distancePc < linearDistance, true);
  assertVectorApprox(sample.positionPc, { x: 1, y: 0, z: 0 });
});

test('route evaluation normalizes authored endpoint velocities to endpoint speeds', () => {
  const polyline = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 2 } },
  });
  const polylineWithVelocities = {
    ...polyline,
    departure: {
      ...polyline.departure,
      velocityPcPerSec: { x: 0, y: 3, z: 4 },
      speedPcPerSec: 10,
    },
    arrival: {
      ...polyline.arrival,
      velocityPcPerSec: { x: 0, y: -4, z: 3 },
      speedPcPerSec: 5,
    },
  };
  const polylineDeparture = evaluateSpatialRoute(polylineWithVelocities, 0);
  assertVectorApprox(polylineDeparture.velocityPcPerSec, { x: 0, y: 6, z: 8 });
  assert.equal(polylineDeparture.speedPcPerSec, 10);
  const polylineArrival = evaluateSpatialRoute(polylineWithVelocities, 2);
  assertVectorApprox(polylineArrival.velocityPcPerSec, { x: 0, y: -4, z: 3 });
  assert.equal(polylineArrival.speedPcPerSec, 5);

  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const transfer = buildSpatialOrbitTransferRoute({
    from: {
      orbit: { ...orbit, initialAngleRad: 0 },
      velocityPcPerSec: { x: 0, y: 0, z: -2 },
      speedPcPerSec: 3,
    },
    to: {
      orbit: { ...orbit, initialAngleRad: Math.PI / 2 },
      velocityPcPerSec: { x: -4, y: 0, z: 0 },
      speedPcPerSec: 2,
    },
    travel: { kind: 'orbitTransfer', timing: { kind: 'duration', durationSecs: 4 } },
  });
  assert.ok(transfer);
  const transferDeparture = evaluateSpatialRoute(transfer, 0);
  assertVectorApprox(transferDeparture.velocityPcPerSec, { x: 0, y: 0, z: -3 });
  assert.equal(transferDeparture.speedPcPerSec, 3);
  const transferArrival = evaluateSpatialRoute(transfer, transfer.timing.durationSecs);
  assertVectorApprox(transferArrival.velocityPcPerSec, { x: -2, y: 0, z: 0 });
  assert.equal(transferArrival.speedPcPerSec, 2);
});

test('completed zero-duration routes give arrival endpoint velocity precedence', () => {
  const route = buildSpatialPolylineRoute({
    pointsPc: [{ x: 2, y: 3, z: 4 }, { x: 2, y: 3, z: 4 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 0 } },
  });
  const routeWithVelocities = {
    ...route,
    departure: {
      ...route.departure,
      velocityPcPerSec: { x: 1, y: 0, z: 0 },
      speedPcPerSec: 2,
    },
    arrival: {
      ...route.arrival,
      velocityPcPerSec: { x: 0, y: 0, z: -1 },
      speedPcPerSec: 4,
    },
  };
  const sample = evaluateSpatialRoute(routeWithVelocities, 0);
  assert.equal(sample.complete, true);
  assertVectorApprox(sample.positionPc, routeWithVelocities.arrival.positionPc);
  assertVectorApprox(sample.velocityPcPerSec, { x: 0, y: 0, z: -4 });
  assert.equal(sample.speedPcPerSec, 4);
});

test('custom timing validates phase speed integrals', () => {
  assert.throws(() => normalizeSpatialTimingSpec({
    kind: 'custom',
    durationSecs: 1,
    phases: [],
  }), /at least one phase/);

  assert.throws(() => normalizeSpatialTimingSpec({
    kind: 'custom',
    durationSecs: 1,
    phases: [{
      kind: 'cruise',
      startTimeSecs: 0,
      endTimeSecs: 1,
      startDistancePc: 0,
      endDistancePc: 2,
      startSpeedPcPerSec: 1,
      endSpeedPcPerSec: 1,
    }],
  }), /speed integral/);

  const zeroDurationHold = normalizeSpatialTimingSpec({
    kind: 'custom',
    durationSecs: 0,
    phases: [{
      kind: 'hold',
      startTimeSecs: 0,
      endTimeSecs: 0,
      startDistancePc: 0,
      endDistancePc: 0,
      startSpeedPcPerSec: 0,
      endSpeedPcPerSec: 0,
    }],
  });
  assert.equal(zeroDurationHold.durationSecs, 0);

  const customRoute = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    travel: {
      kind: 'polyline',
      timing: {
        kind: 'custom',
        durationSecs: 2,
        phases: [{
          kind: 'cruise',
          startTimeSecs: 0,
          endTimeSecs: 2,
          startDistancePc: 0,
          endDistancePc: 2,
          startSpeedPcPerSec: 1,
          endSpeedPcPerSec: 1,
        }],
      },
    },
  });
  assert.equal(customRoute.timing.durationSecs, 2);

  assert.throws(() => normalizeSpatialTimingSpec({
    kind: 'custom',
    durationSecs: 2,
    phases: [
      {
        kind: 'cruise',
        startTimeSecs: 0,
        endTimeSecs: 1,
        startDistancePc: 0,
        endDistancePc: 1,
        startSpeedPcPerSec: 1,
        endSpeedPcPerSec: 1,
      },
      {
        kind: 'cruise',
        startTimeSecs: 1,
        endTimeSecs: 2,
        startDistancePc: 1,
        endDistancePc: 3,
        startSpeedPcPerSec: 2,
        endSpeedPcPerSec: 2,
      },
    ],
  }), /contiguous speeds/);
});

test('orbital insert and transfer routes use curved orbit-aware geometry', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const insert = buildSpatialOrbitalInsertRoute({
    from: { positionPc: { x: 15, y: 0, z: 0 } },
    orbit,
    travel: {
      kind: 'orbitalInsert',
      sampleStepSecs: 0.25,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(insert);
  assert.notEqual(insert.pointsPc[Math.floor(insert.pointsPc.length / 2)].z, 0);
  const insertFinalDirection = normalizeTestVector(subtractTestVectors(
    insert.pointsPc[insert.pointsPc.length - 1],
    insert.pointsPc[insert.pointsPc.length - 2],
  ));
  assert.equal(dotTestVectors(insertFinalDirection, insert.diagnostics.selectedTangent) > 0.9, true);
  const rebuiltInsert = buildSpatialOrbitalInsertRoute({
    from: { positionPc: { x: 15, y: 0, z: 0 } },
    orbit,
    travel: {
      kind: 'orbitalInsert',
      sampleStepSecs: 0.25,
      timing: insert.timing,
    },
  });
  assert.ok(rebuiltInsert);
  assert.ok(Math.abs(rebuiltInsert.totalLengthPc - insert.totalLengthPc) < 1e-9);

  const transfer = buildSpatialOrbitTransferRoute({
    from: {
      positionPc: { x: 10, y: 0, z: 0 },
      orbit: { ...orbit, radiusPc: 10, initialAngleRad: 0 },
    },
    to: { orbit: { ...orbit, initialAngleRad: Math.PI / 2 } },
    travel: {
      kind: 'orbitTransfer',
      sampleStepSecs: 0.25,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(transfer);
  assert.equal(transfer.diagnostics.warnings.length, 0);
  assert.equal(transfer.pointsPc.some((point) => pointLineDistance(point, transfer.departure.positionPc, transfer.arrival.positionPc) > 0.1), true);
  const rebuiltTransfer = buildSpatialOrbitTransferRoute({
    from: {
      positionPc: { x: 10, y: 0, z: 0 },
      orbit: { ...orbit, radiusPc: 10, initialAngleRad: 0 },
    },
    to: { orbit: { ...orbit, initialAngleRad: Math.PI / 2 } },
    travel: {
      kind: 'orbitTransfer',
      sampleStepSecs: 0.25,
      timing: transfer.timing,
    },
  });
  assert.ok(rebuiltTransfer);
  assert.ok(Math.abs(rebuiltTransfer.totalLengthPc - transfer.totalLengthPc) < 1e-9);
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

test('route and path sampling include endpoints, enforce maxSamples, and reject invalid options', () => {
  const route = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 12 } },
  });
  const routeSamples = sampleSpatialRoute(route, { sampleStepSecs: 5 });
  assert.deepEqual(routeSamples.map((sample) => sample.elapsedSecs), [0, 5, 10, 12]);
  assert.equal(routeSamples.at(-1).complete, true);

  const cappedRouteSamples = sampleSpatialRoute(route, { sampleStepSecs: 5, maxSamples: 3 });
  assert.deepEqual(cappedRouteSamples.map((sample) => sample.elapsedSecs), [0, 5, 10]);
  assert.equal(cappedRouteSamples.at(-1).complete, false);
  assert.equal(cappedRouteSamples.at(-1).diagnostics.warnings.at(-1).code, 'maxSamplesTruncatesRoute');

  const path = normalizeSpatialPathSpec({
    durationSecs: 12,
    positionKeys: [
      { id: 'start', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'end', timeSecs: 12, positionPc: { x: 12, y: 0, z: 0 } },
    ],
  });
  const pathSamples = sampleSpatialPath(path, { sampleStepSecs: 5 });
  assert.deepEqual(pathSamples.map((sample) => sample.timeSecs), [0, 5, 10, 12]);
  assertVectorApprox(pathSamples.at(-1).pose.observerPc, { x: 12, y: 0, z: 0 });

  const cappedPathSamples = sampleSpatialPath(path, { sampleStepSecs: 5, maxSamples: 3 });
  assert.deepEqual(cappedPathSamples.map((sample) => sample.timeSecs), [0, 5, 10]);
  assert.equal(cappedPathSamples.at(-1).diagnostics.warnings.at(-1).code, 'maxSamplesTruncatesPath');
  assert.equal(sampleSpatialPathDiagnostics(path, { sampleStepSecs: 5, maxSamples: 3 }).warnings.at(-1).code, 'maxSamplesTruncatesPath');
  assert.equal(sampleSpatialPathDiagnostics(path, { sampleStepSecs: 5, maxSamples: 4 }).warnings.length, 0);

  const decimalRoute = buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 0.9 } },
  });
  const decimalSamples = sampleSpatialRoute(decimalRoute, { sampleStepSecs: 0.09, maxSamples: 11 });
  assert.equal(decimalSamples.length, 11);
  assert.equal(decimalSamples.at(-1).elapsedSecs, 0.9);
  assert.equal(decimalSamples.at(-1).complete, true);
  assert.equal(decimalSamples.at(-1).diagnostics.warnings.length, 0);

  const decimalPath = normalizeSpatialPathSpec({
    durationSecs: 0.9,
    positionKeys: [
      { id: 'start', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { id: 'end', timeSecs: 0.9, positionPc: { x: 0.9, y: 0, z: 0 } },
    ],
  });
  assert.equal(sampleSpatialPathDiagnostics(decimalPath, { sampleStepSecs: 0.09, maxSamples: 11 }).warnings.length, 0);
  assert.equal(sampleSpatialPath(decimalPath, { sampleStepSecs: 0.09, maxSamples: 11 }).at(-1).timeSecs, 0.9);

  for (const sampleStepSecs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => sampleSpatialRoute(route, { sampleStepSecs }), /sampleStepSecs/);
  }
  for (const frameRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => sampleSpatialRoute(route, { frameRate }), /frameRate/);
  }
  for (const maxSamples of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => sampleSpatialRoute(route, { maxSamples }), /maxSamples/);
  }
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

test('view transition lanes delay, ease, and complete independently', () => {
  const transition = buildSpatialViewTransitionPath({
    from: {
      pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
      aim: evaluateSpatialAim({
        observerPc: { x: 0, y: 0, z: 0 },
        aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } },
      }),
    },
    to: {
      pose: { observerPc: { x: 10, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
      aim: evaluateSpatialAim({
        observerPc: { x: 10, y: 0, z: 0 },
        aim: { kind: 'target', targetPc: { x: 10, y: 0, z: -10 } },
      }),
    },
    durationSecs: 4,
    position: { delaySecs: 1, durationSecs: 2, interpolation: 'easeIn' },
    aim: { delaySecs: 2, durationSecs: 1, interpolation: 'linear' },
  });
  assert.equal(typeof transition.evaluate, 'undefined');
  assert.equal(transition.diagnostics.positionDelaySecs, 1);
  assert.equal(transition.diagnostics.aimDelaySecs, 2);

  const beforePosition = evaluateSpatialViewTransition(transition, 0.5);
  assertVectorApprox(beforePosition.pose.observerPc, { x: 0, y: 0, z: 0 });
  assert.equal(beforePosition.frameState.aim.kind, 'target');
  assertVectorApprox(beforePosition.frameState.aim.targetPc, { x: 0, y: 0, z: -10 });
  assert.equal(beforePosition.positionComplete, false);
  assert.equal(beforePosition.aimComplete, false);

  const easedMidpoint = evaluateSpatialViewTransition(transition, 2);
  assertVectorApprox(easedMidpoint.pose.observerPc, { x: 2.5, y: 0, z: 0 });
  assertVectorApprox(easedMidpoint.frameState.aim.targetPc, { x: 0, y: 0, z: -10 });
  assert.equal(easedMidpoint.positionComplete, false);
  assert.equal(easedMidpoint.aimComplete, false);

  const aimMidpoint = evaluateSpatialViewTransition(transition, 2.5);
  assert.equal(aimMidpoint.frameState.aim.kind, 'target');
  assertVectorApprox(aimMidpoint.frameState.aim.targetPc, { x: 5, y: 0, z: -10 });

  const lanesComplete = evaluateSpatialViewTransition(transition, 3);
  assertVectorApprox(lanesComplete.pose.observerPc, { x: 10, y: 0, z: 0 });
  assertVectorApprox(lanesComplete.frameState.aim.targetPc, { x: 10, y: 0, z: -10 });
  assert.equal(lanesComplete.positionComplete, true);
  assert.equal(lanesComplete.aimComplete, true);
  assert.equal(lanesComplete.complete, false);
  assert.equal(evaluateSpatialViewTransition(transition, 4).complete, true);
});

test('pose transitions delegate to equivalent view transitions', () => {
  const from = {
    observerPc: { x: 0, y: 0, z: 0 },
    orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
  };
  const to = {
    observerPc: { x: 10, y: 0, z: 0 },
    orientationIcrs: createSpatialQuaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2),
  };
  const lanes = {
    durationSecs: 3,
    movement: { delaySecs: 1, durationSecs: 1, interpolation: 'smoothstep' },
    orientation: { delaySecs: 0.5, durationSecs: 2, interpolation: 'slerp' },
  };
  const poseTransition = createSpatialPoseTransition({ from, to, ...lanes });
  const viewTransition = buildSpatialViewTransitionPath({
    from: { pose: from, aim: null },
    to: { pose: to, aim: null },
    durationSecs: lanes.durationSecs,
    position: lanes.movement,
    aim: lanes.orientation,
  });

  const held = evaluateSpatialPoseTransition(poseTransition, 0.25);
  assertVectorApprox(held.pose.observerPc, { x: 0, y: 0, z: 0 });
  assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, held.pose.orientationIcrs), SPATIAL_LOCAL_FORWARD);
  assert.equal(held.movementComplete, false);
  assert.equal(held.orientationComplete, false);

  const poseSample = evaluateSpatialPoseTransition(poseTransition, 1.5);
  const viewSample = evaluateSpatialViewTransition(viewTransition, 1.5);
  assertVectorApprox(poseSample.pose.observerPc, viewSample.pose.observerPc);
  assertVectorApprox(
    applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, poseSample.pose.orientationIcrs),
    applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, viewSample.pose.orientationIcrs),
  );

  const rawPoseTransition = { from, to, durationSecs: 2 };
  assert.equal(evaluateSpatialPoseTransition(rawPoseTransition, 1).pose.observerPc.x > 0, true);
});

test('transition lane normalization rejects invalid timing and interpolation', () => {
  const spec = {
    from: frame({ x: 0, y: 0, z: 0 }),
    to: frame({ x: 1, y: 0, z: 0 }),
    durationSecs: 1,
  };
  assert.throws(() => buildSpatialViewTransitionPath({
    ...spec,
    position: { delaySecs: 0.75, durationSecs: 0.5 },
  }), RangeError);
  assert.throws(() => buildSpatialViewTransitionPath({
    ...spec,
    position: { delaySecs: -1 },
  }), RangeError);
  assert.throws(() => buildSpatialViewTransitionPath({
    ...spec,
    position: { interpolation: 'warp' },
  }), TypeError);
  assert.throws(() => createSpatialPoseTransition({
    from: spec.from.pose,
    to: spec.to.pose,
    durationSecs: 1,
    orientation: { delaySecs: 0.75, durationSecs: 0.5 },
  }), RangeError);
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

test('navigation preserves orbit handoff time and keeps movement and aim cancellation independent', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 1,
    angularSpeedRadPerSec: 1,
  };
  const route = buildSpatialOrbitTransferRoute({
    from: { positionPc: { x: 2, y: 0, z: 0 } },
    to: { orbit },
    travel: { kind: 'orbitTransfer', timing: { kind: 'duration', durationSecs: 1 } },
  });
  assert.ok(route);
  const navigation = createSpatialNavigationAutomation();
  navigation.flyRoute(route);
  const handedOff = navigation.update({
    pose: { observerPc: { x: 2, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    deltaSecs: 1.5,
  });
  const expectedOrbit = evaluateSpatialOrbit(route.arrivalAction.orbit, 0.5);
  assertVectorApprox(handedOff.observerPc, expectedOrbit.positionPc);
  assert.equal(navigation.getDiagnostics().elapsedSecs, 0.5);
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbit');
  assert.equal(navigation.getFrameState().aim.kind, 'target');

  navigation.lockAt({ kind: 'target', targetPc: { x: 0, y: 1, z: 0 } });
  navigation.update({ pose: handedOff, deltaSecs: 0 });
  navigation.cancelMovement();
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'idle');
  assert.equal(navigation.getDiagnostics().activeAim.aim.kind, 'target');

  navigation.flyRoute(route);
  navigation.update({ pose: handedOff, deltaSecs: 0.25 });
  navigation.cancelOrientation();
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbitTransfer');
  assert.equal(navigation.getDiagnostics().activeAim.aim, null);
});

test('navigation honors arrival settle, aim preservation, and dwell semantics', () => {
  const orbit = {
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 1,
    angularSpeedRadPerSec: 1,
  };
  const routeWithArrival = (arrivalAction) => buildSpatialPolylineRoute({
    pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1 } },
    arrivalAction,
  });
  const initialPose = {
    observerPc: { x: 0, y: 0, z: 0 },
    orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
  };
  const preservedAim = { kind: 'direction', forwardIcrs: { x: 0, y: 1, z: 0 } };

  const preserving = createSpatialNavigationAutomation();
  preserving.lookAt(preservedAim);
  preserving.flyRoute(routeWithArrival(normalizeSpatialArrivalAction({
    kind: 'orbit',
    orbit,
    settleSecs: 2,
    preserveAim: true,
  })));
  const settlingPose = preserving.update({ pose: initialPose, deltaSecs: 1.5 });
  assertVectorApprox(settlingPose.observerPc, { x: 1, y: 0, z: 0 });
  assert.deepEqual(preserving.getDiagnostics().pendingSettle, {
    behavior: 'continueOrbit',
    elapsedSecs: 0.5,
    durationSecs: 2,
    targetOrbit: normalizeSpatialOrbitSpec(orbit),
  });
  const handedOffPose = preserving.update({ pose: settlingPose, deltaSecs: 1.5 });
  assertVectorApprox(handedOffPose.observerPc, { x: 1, y: 0, z: 0 });
  assert.equal(preserving.getDiagnostics().pendingSettle, null);
  assert.equal(preserving.getFrameState().aim.kind, 'direction');
  preserving.update({ pose: handedOffPose, deltaSecs: 0.5 });
  assert.ok(Math.abs(preserving.getFrameState().pose.observerPc.z) > 0.1);

  const replacing = createSpatialNavigationAutomation();
  replacing.lookAt(preservedAim);
  replacing.flyRoute(routeWithArrival(normalizeSpatialArrivalAction({
    kind: 'orbit',
    orbit,
    settleSecs: 2,
    preserveAim: false,
  })));
  replacing.update({ pose: initialPose, deltaSecs: 3 });
  assert.equal(replacing.getFrameState().aim.kind, 'target');
  assertVectorApprox(replacing.getFrameState().aim.targetPc, orbit.centerPc);

  const dwelling = createSpatialNavigationAutomation();
  dwelling.flyRoute(routeWithArrival(normalizeSpatialArrivalAction({
    kind: 'lockAt',
    aim: { kind: 'target', targetPc: { x: 0, y: 0, z: -10 } },
    dwellSecs: 1,
  })));
  const dwellingPose = dwelling.update({ pose: initialPose, deltaSecs: 1.5 });
  assert.equal(dwelling.getFrameState().aim.kind, 'target');
  assert.ok(dwelling.getFrameState().targetLock);
  dwelling.update({ pose: dwellingPose, deltaSecs: 0.5 });
  assert.equal(dwelling.getFrameState().aim, null);
  assert.equal(dwelling.getFrameState().targetLock, null);
});

test('navigation lets manual look override active aim without discarding aim state', () => {
  const navigation = createSpatialNavigationAutomation();
  navigation.orbit({
    centerPc: { x: 0, y: 0, z: 0 },
    radiusPc: 1,
    angularSpeedRadPerSec: 0,
  });
  navigation.lockAt({ kind: 'target', targetPc: { x: 0, y: 0, z: -10 } });
  const manualOrientation = createSpatialQuaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
  const manualPose = navigation.update({
    pose: { observerPc: { x: 1, y: 0, z: 0 }, orientationIcrs: manualOrientation },
    deltaSecs: 0,
    manualLookActive: true,
  });
  assert.deepEqual(manualPose.orientationIcrs, manualOrientation);
  assert.equal(navigation.getDiagnostics().activeAim.manualLookActive, true);
  assert.equal(navigation.getFrameState().aim.kind, 'target');

  const automatedPose = navigation.update({
    pose: manualPose,
    deltaSecs: 0,
    manualLookActive: false,
  });
  assert.notDeepEqual(automatedPose.orientationIcrs, manualOrientation);
  assert.equal(navigation.getDiagnostics().activeAim.manualLookActive, false);

  navigation.cancelOrientation();
  const orientationHeld = navigation.update({
    pose: { ...automatedPose, orientationIcrs: manualOrientation },
    deltaSecs: 0.25,
  });
  assert.deepEqual(orientationHeld.orientationIcrs, manualOrientation);
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbit');
});

test('manual motion models implement direct, inertial, and thrust translation and retain scale', () => {
  assert.throws(() => createDirectSpatialMotionModel({ moveSpeedPcPerSec: '2' }), TypeError);
  assert.throws(() => createDirectSpatialMotionModel({ moveSpeedPcPerSec: 0 }), RangeError);
  assert.throws(() => createDirectSpatialMotionModel({ moveAxis: '' }), TypeError);
  assert.throws(() => createInertialSpatialMotionModel({ damping: -1 }), RangeError);
  assert.throws(() => createThrustSpatialMotionModel({ mass: 0 }), RangeError);

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
    scale: {
      navigationUnits: 'pc',
      metersPerNavigationUnit: 7,
      worldUnitsPerNavigationUnit: 3,
    },
  });
  assert.equal(pose.observerPc.z, 2);
  assert.deepEqual(model.getSnapshot().scale, {
    navigationUnits: 'pc',
    metersPerNavigationUnit: 7,
    worldUnitsPerNavigationUnit: 3,
  });

  const inertial = createInertialSpatialMotionModel({
    moveSpeedPcPerSec: 10,
    accelerationPcPerSec2: 2,
    damping: Math.log(2),
    maxSpeedPcPerSec: 3,
  });
  inertial.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 0.5,
  });
  assert.ok(Math.abs(inertial.getSnapshot().speedPcPerSec - 1) < 1e-9);
  inertial.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 2,
  });
  assert.ok(Math.abs(inertial.getSnapshot().speedPcPerSec - 3) < 1e-9);
  inertial.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls: { getAxis: () => ({ x: 0, y: 0, magnitude: 0, active: false }) },
    deltaSecs: 1,
  });
  assert.ok(Math.abs(inertial.getSnapshot().speedPcPerSec - 1.5) < 1e-9);

  const boostedInertial = createInertialSpatialMotionModel({
    accelerationPcPerSec2: 10,
    boostMultiplier: 10,
    maxSpeedPcPerSec: 2,
  });
  boostedInertial.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls: {
      ...controls,
      getButton: (name) => ({ pressed: name === 'boost', value: name === 'boost' ? 1 : 0 }),
    },
    deltaSecs: 1,
  });
  assert.ok(Math.abs(boostedInertial.getSnapshot().speedPcPerSec - 2) < 1e-9);

  const thrust = createThrustSpatialMotionModel({
    thrustPcPerSec2: 4,
    mass: 2,
    drag: 0,
    maxSpeedPcPerSec: 10,
  });
  thrust.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 0.5,
  });
  assert.ok(Math.abs(thrust.getSnapshot().speedPcPerSec - 1) < 1e-9);

  const draggedThrust = createThrustSpatialMotionModel({
    thrustPcPerSec2: 2,
    mass: 1,
    drag: Math.log(2),
    maxSpeedPcPerSec: 10,
  });
  draggedThrust.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 1,
  });
  const thrustBeforeIdle = draggedThrust.getSnapshot().speedPcPerSec;
  draggedThrust.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls: { getAxis: () => ({ x: 0, y: 0, magnitude: 0, active: false }) },
    deltaSecs: 1,
  });
  assert.ok(Math.abs(draggedThrust.getSnapshot().speedPcPerSec - thrustBeforeIdle / 2) < 1e-9);

  const rolling = createDirectSpatialMotionModel({ rollRateRadPerSec: Math.PI / 2 });
  const rolledPose = rolling.update({
    pose: { observerPc: { x: 0, y: 0, z: 0 }, orientationIcrs: SPATIAL_IDENTITY_QUATERNION },
    controls: {
      getAxis: (name) => name === 'attitude'
        ? { x: 1, y: 0, magnitude: 1, active: true }
        : { x: 0, y: 0, magnitude: 0, active: false },
      getButton: (name) => ({ pressed: name === 'rollModifier', value: name === 'rollModifier' ? 1 : 0 }),
    },
    deltaSecs: 1,
  });
  assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, rolledPose.orientationIcrs), SPATIAL_LOCAL_FORWARD);
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

function assertTimingProfileInvariants(profile, expectedDistancePc, epsilon = 1e-7) {
  assert.ok(profile.phases.length > 0);
  assert.ok(Math.abs(profile.phases[0].startTimeSecs) <= epsilon);
  assert.ok(Math.abs(profile.phases[0].startDistancePc) <= epsilon);
  for (let index = 0; index < profile.phases.length; index += 1) {
    const phase = profile.phases[index];
    const durationSecs = phase.endTimeSecs - phase.startTimeSecs;
    const integratedDistancePc = (phase.startSpeedPcPerSec + phase.endSpeedPcPerSec) * 0.5 * durationSecs;
    assert.ok(
      Math.abs((phase.endDistancePc - phase.startDistancePc) - integratedDistancePc) <= epsilon,
      `phase ${index} distance must match its speed integral`,
    );
    if (index === 0) continue;
    const previous = profile.phases[index - 1];
    assert.ok(Math.abs(phase.startTimeSecs - previous.endTimeSecs) <= epsilon, `phase ${index} time must be contiguous`);
    assert.ok(Math.abs(phase.startDistancePc - previous.endDistancePc) <= epsilon, `phase ${index} distance must be contiguous`);
    assert.ok(Math.abs(phase.startSpeedPcPerSec - previous.endSpeedPcPerSec) <= epsilon, `phase ${index} speed must be contiguous`);
  }
  const finalPhase = profile.phases.at(-1);
  assert.ok(Math.abs(finalPhase.endTimeSecs - profile.durationSecs) <= epsilon);
  assert.ok(Math.abs(finalPhase.endDistancePc - expectedDistancePc) <= epsilon);
}

function subtractTestVectors(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dotTestVectors(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossTestVectors(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function testVectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalizeTestVector(vector) {
  const length = testVectorLength(vector);
  return length > 0 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : { x: 0, y: 0, z: 0 };
}

function pointLineDistance(point, start, end) {
  const line = subtractTestVectors(end, start);
  const offset = subtractTestVectors(point, start);
  const lineLength = testVectorLength(line);
  if (!(lineLength > 0)) return testVectorLength(offset);
  return testVectorLength(crossTestVectors(offset, line)) / lineLength;
}
