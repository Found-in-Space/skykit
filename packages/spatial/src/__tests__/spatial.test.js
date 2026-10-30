const space = Object.freeze({ frameId: 'spatial:example-icrs', metersPerUnit: 3.085677581491367e16 });
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
  assertVectorApprox(raDecDistanceToIcrs({ space, raHours: 6, decDeg: 0, distance: 10 }), { x: 0, y: 10, z: 0 });
  assert.deepEqual(icrsToRaDec({ x: 1e-12, y: 0, z: 0 }), { raDeg: 0, raHours: 0, decDeg: 0 });
  assert.deepEqual(projectSpatialEquirectangular({ raDeg: 180, decDeg: 0, width: 360, height: 180 }), { x: 180, y: 90 });
  assert.throws(() => normalizeSpatialPose({ space, observerPc: { x: 0, y: 0, z: 0 } }), /Noncanonical/);
  assert.deepEqual(normalizeSpatialPose({ space,}), { space,
    position: { x: 0, y: 0, z: 0 },
    orientation: SPATIAL_IDENTITY_QUATERNION,
  });
});

test('canonical normalizers reject malformed values instead of coercing or defaulting', () => {
  assert.throws(() => normalizeSpatialVector3({ x: '1', y: 2, z: 3 }), TypeError);
  assert.throws(() => normalizeSpatialVector3({ x: Number.NaN, y: 2, z: 3 }), RangeError);
  assert.throws(() => normalizeSpatialQuaternion({ x: 0, y: 0, z: 0, w: '1' }), TypeError);
  assert.throws(() => normalizeSpatialDirection({ x: '1', y: 0, z: 0 }), TypeError);
  assert.deepEqual(normalizeSpatialDirection({ x: 1e-12, y: 0, z: 0 }), { x: 1, y: 0, z: 0 });

  assert.throws(() => normalizeSpatialScaleProfile({ worldUnitsPerUnit: -1 }), RangeError);
  assert.throws(() => normalizeSpatialScaleProfile({ worldUnitsPerUnit: '1' }), TypeError);
  assert.throws(() => normalizeSpatialScaleProfile({ navigationUnits: 1 }), TypeError);

  assert.throws(() => normalizeSpatialTarget({ space,
    kind: 'radec',
    raDeg: 10,
    raHours: 1,
    decDeg: 0,
    distance: 1,
  }), TypeError);
  assert.throws(() => normalizeSpatialTarget({ space, kind: 'radec', raDeg: 10, decDeg: 91, distance: 1 }), RangeError);
  assert.throws(() => normalizeSpatialTarget({ space, kind: 'radec', raDeg: '10', decDeg: 0, distance: 1 }), TypeError);

  assert.throws(() => normalizeSpatialAimSpec({ space,
    kind: 'direction',
    forward: { x: 0, y: 0, z: 0 },
  }), RangeError);
  assert.deepEqual(normalizeSpatialAimSpec({ space,
    kind: 'direction',
    forward: { x: 1e-12, y: 0, z: 0 },
  }).forward, { x: 1, y: 0, z: 0 });
  assert.throws(() => normalizeSpatialAimSpec({ space,
    kind: 'target',
    target: { x: 0, y: 0, z: 0 },
    positionAngleDeg: Number.NaN,
  }), RangeError);
  assert.throws(() => normalizeSpatialAimSpec({ space,
    kind: 'target',
    target: { x: 0, y: 0, z: 0 },
    lock: 1,
  }), TypeError);

  assert.throws(() => normalizeSpatialDestination({ space, center: { x: 0, y: 0, z: 0 }, radius: -1 }), RangeError);
  assert.throws(() => normalizeSpatialDestination({ space, center: { x: 0, y: 0, z: 0 }, dwellSecs: Number.NaN }), RangeError);
  assert.throws(() => normalizeSpatialOrbitSpec({ space, center: { x: 0, y: 0, z: 0 }, radius: 0 }), RangeError);
  assert.throws(() => normalizeSpatialOrbitSpec({ space, center: { x: 0, y: 0, z: 0 }, radius: 1, handedness: 0 }), RangeError);

  assert.throws(() => normalizeSpatialTravelSpec({ space, kind: 'polyline', sampleStepSecs: 0 }), RangeError);
  assert.throws(() => normalizeSpatialTravelSpec({ space, kind: 'polyline', maxPoints: 1.5 }), RangeError);
  assert.throws(() => normalizeSpatialRouteEndpointSpec({ space, speedUnitsPerSec: -1 }), RangeError);
  assert.throws(() => normalizeSpatialArrivalAction({ space,
    kind: 'lookAt',
    aim: { space, kind: 'target', target: { x: 0, y: 0, z: 0 } },
    dwellSecs: -1,
  }), RangeError);
  assert.throws(() => normalizeSpatialArrivalAction({ space,
    kind: 'orbitalInsert',
    orbit: { space, center: { x: 0, y: 0, z: 0 }, radius: 1 },
    timing: { garbage: true },
  }), TypeError);

  const singlePositionKey = [{ space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 } }];
  assert.throws(() => buildSpatialAimTrack([], { space, durationSecs: -1 }), RangeError);
  assert.throws(() => normalizeSpatialPathSpec({ space,
    positionKeys: singlePositionKey,
    duplicateTimePolicy: 'merge',
  }), TypeError);
  assert.throws(() => normalizeSpatialPathSpec({ space, positionKeys: singlePositionKey, durationSecs: -1 }), RangeError);
  assert.throws(() => normalizeSpatialPathSpec({ space,
    positionKeys: singlePositionKey,
    timeRemap: { kind: 'linear', playbackDurationSecs: -1 },
  }), RangeError);

  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSecs: -1 }), RangeError);
  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSecs: Number.NaN }), RangeError);
  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSecs: '1' }), TypeError);
});

test('target aim samples preserve target semantics and orientation', () => {
  const sample = evaluateSpatialAim({ space,
    position: { x: 0, y: 0, z: 0 },
    aim: { space, kind: 'target', target: { x: 10, y: 0, z: 0 } },
  });
  assert.equal(sample.kind, 'target');
  assert.deepEqual(sample.target, { x: 10, y: 0, z: 0 });
  assertVectorApprox(sample.forward, { x: 1, y: 0, z: 0 });
  assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, sample.orientation), { x: 1, y: 0, z: 0 });

  const direction = evaluateSpatialAim({ space,
    position: { x: 1, y: 2, z: 3 },
    aim: { space, kind: 'direction', forward: { x: 0, y: 0, z: -1 } },
    syntheticTargetDistance: 5,
  });
  assert.equal(direction.kind, 'direction');
  assert.equal('target' in direction, false);
  assert.deepEqual(direction.syntheticTarget, { x: 1, y: 2, z: -2 });

  for (const up of [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]) {
    const recovered = evaluateSpatialAim({ space,
      position: { x: 0, y: 0, z: 0 },
      aim: { space, kind: 'target', target: { x: 1, y: 0, z: 0 }, up },
    });
    assert.equal(recovered.diagnostics.warnings.some((entry) => entry.code === 'degenerateAimUp'), true);
    assert.ok(Math.abs(dotTestVectors(recovered.forward, recovered.up)) < 1e-9);
    assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, recovered.orientation), { x: 1, y: 0, z: 0 });
  }
});

test('route endpoint resolution preserves destinations without using center as observer position', () => {
  const destination = { space,
    id: 'target',
    center: { x: 10, y: 0, z: 0 },
    radius: 2,
    metadata: { chapter: 1 },
  };
  assert.equal(buildSpatialRouteEndpoint({ space, destination }), null);
  const endpoint = buildSpatialRouteEndpoint({ space, destination }, {
    referencePose: { space,
      position: { x: 20, y: 0, z: 0 },
      orientation: SPATIAL_IDENTITY_QUATERNION,
    },
  });
  assert.ok(endpoint);
  assert.equal(endpoint.kind, 'destination');
  assert.deepEqual(endpoint.destination.metadata, { chapter: 1 });
  assert.deepEqual(endpoint.position, { x: 12, y: 0, z: 0 });

  const destinationOrbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 2,
    angularSpeedRadPerSec: 1,
  };
  const pointOnly = buildSpatialRouteEndpoint({ space,
    position: { x: 3, y: 0, z: 0 },
    destination: { space, center: destinationOrbit.center, orbit: destinationOrbit },
    orbit: null,
  }, { fallbackOrbit: destinationOrbit });
  assert.ok(pointOnly);
  assert.equal('orbit' in pointOnly, false);
  assert.equal('orbitBasis' in pointOnly, false);
});

test('route builders return canonical geometry, timing, diagnostics, and samples', () => {
  const route = buildSpatialPolylineRoute({ space,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: -10 },
      { x: 10, y: 0, z: -10 },
    ],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 10 } },
  });
  assert.equal(route.totalLength, 20);
  assert.equal(route.points.length, 3);
  assert.equal(getSpatialRouteDiagnostics(route).averageSpeedUnitsPerSec, 2);
  assert.deepEqual(evaluateSpatialRoute(route, 2.5).position, { x: 0, y: 0, z: -5 });
  assert.equal(sampleSpatialRoute(route, { sampleStepSecs: 5 }).length, 3);
  assert.equal('pointsPc' in route, false);
  assert.equal('totalLengthPc' in route, false);
});

test('non-zero routes below the general math epsilon retain exact geometry and timing', () => {
  const distance = 1e-10;
  const route = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: distance, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1 } },
  });
  assert.equal(route.segments.length, 1);
  assert.equal(route.totalLength, distance);
  assert.equal(route.timing.phases.at(-1).endDistance, distance);
  assert.equal(evaluateSpatialRoute(route, 0.5).position.x, distance * 0.5);
  assert.deepEqual(evaluateSpatialRoute(route, 1).position, route.arrival.position);

  const kinematic = deriveSpatialRouteTiming({ space,
    totalLength: distance,
    travel: {
      kind: 'polyline',
      timing: { space, kind: 'trapezoid', durationSecs: 1 },
    },
  });
  assert.ok(Math.abs(kinematic.phases.at(-1).endDistance - distance) <= distance * 1e-12);

  const asymmetricEndpoint = deriveSpatialRouteTiming({ space,
    totalLength: distance,
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'trapezoid',
        durationSecs: 1,
        departureSpeedUnitsPerSec: 0,
        arrivalSpeedUnitsPerSec: 0.1,
        accelerationUnitsPerSec2: 0.1,
        decelerationUnitsPerSec2: 0.1,
      },
    },
  });
  assert.ok(Math.abs(asymmetricEndpoint.phases.at(-1).endDistance - distance) <= distance * 1e-12);

  const tinyDurationRoute = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: distance, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1e-10 } },
  });
  assert.equal(evaluateSpatialRoute(tinyDurationRoute, 0).complete, false);
  assert.equal(evaluateSpatialRoute(tinyDurationRoute, 5e-11).position.x, distance * 0.5);
  assert.deepEqual(evaluateSpatialRoute(tinyDurationRoute, 1e-10).position, tinyDurationRoute.arrival.position);
  assert.equal(getSpatialRouteDiagnostics(tinyDurationRoute).averageSpeedUnitsPerSec, 1);

  const tinySpeed = deriveSpatialRouteTiming({ space,
    totalLength: distance,
    travel: { kind: 'polyline', timing: { space, kind: 'constantSpeed', speedUnitsPerSec: 1e-10 } },
  });
  assert.equal(tinySpeed.durationSecs, 1);

  const smallEqualEndpoints = deriveSpatialRouteTiming({ space,
    totalLength: distance,
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'trapezoid',
        departureSpeedUnitsPerSec: 0.1,
        arrivalSpeedUnitsPerSec: 0.1,
        accelerationUnitsPerSec2: 1e-6,
        decelerationUnitsPerSec2: 1e-6,
      },
    },
  });
  assert.ok(Math.abs(smallEqualEndpoints.phases.at(-1).endDistance - distance) <= distance * 1e-12);
});

test('orbit routes preserve destination and derive handoff angle continuity', () => {
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const route = buildSpatialOrbitalInsertRoute({ space,
    from: { space, position: { x: 15, y: 0, z: 0 } },
    orbit,
    destination: { space, id: 'orbit-home', center: orbit.center, orbit },
    travel: { space, kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 4 } },
  });
  assert.ok(route);
  assert.equal(route.arrivalAction.kind, 'orbitalInsert');
  assert.equal(route.arrival.destination.id, 'orbit-home');
  const handoff = deriveSpatialOrbitHandoff({ space, position: route.arrival.position, orbit });
  const orbitSample = evaluateSpatialOrbit(handoff.orbit, 0);
  assertVectorApprox(orbitSample.position, route.arrival.position);

  const leftHandedOrbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: -1,
    angularSpeedRadPerSec: 0.2,
  };
  const nearestAngle = deriveSpatialOrbitAngle({ space,
    center: leftHandedOrbit.center,
    position: { x: 0, y: 0, z: 10 },
    orbitNormal: leftHandedOrbit.orbitNormal,
    referenceAxis: leftHandedOrbit.referenceAxis,
    handedness: leftHandedOrbit.handedness,
  });
  assertVectorApprox(
    evaluateSpatialOrbit({ ...leftHandedOrbit, initialAngleRad: nearestAngle }, 0).position,
    { x: 0, y: 0, z: 5 },
  );
  const leftHandedInsert = buildSpatialOrbitalInsertRoute({ space,
    from: { space, position: { x: 0, y: 0, z: 10 } },
    orbit: leftHandedOrbit,
    travel: { space, kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 1 } },
  });
  assert.ok(leftHandedInsert);
  const leftHandedApproach = subtractTestVectors(
    leftHandedInsert.arrival.position,
    leftHandedInsert.departure.position,
  );
  const leftHandedRadial = subtractTestVectors(
    leftHandedInsert.arrival.position,
    leftHandedOrbit.center,
  );
  assert.ok(Math.abs(dotTestVectors(leftHandedApproach, leftHandedRadial)) < 1e-9);
});

test('orbital insert defaults to the signed orbital tangent for both handedness values', () => {
  const center = { x: 0, y: 0, z: 0 };
  const departure = { x: 15, y: 0, z: 0 };
  const radius = 5;
  const cases = [
    { handedness: 1, angularSpeedRadPerSec: 0.2 },
    { handedness: 1, angularSpeedRadPerSec: -0.2 },
    { handedness: -1, angularSpeedRadPerSec: 0.2 },
    { handedness: -1, angularSpeedRadPerSec: -0.2 },
    { handedness: 1, angularSpeedRadPerSec: 0 },
    { handedness: -1, angularSpeedRadPerSec: 0 },
  ];

  for (const [index, { handedness, angularSpeedRadPerSec }] of cases.entries()) {
    const orbit = { space,
      center,
      radius,
      orbitNormal: { x: 0, y: 1, z: 0 },
      referenceAxis: { x: 1, y: 0, z: 0 },
      handedness,
      angularSpeedRadPerSec,
    };
    const route = buildSpatialOrbitalInsertRoute({ space,
      from: { space,
        position: departure,
        // This deliberately favors the other candidate for the first case.
        // Orbit direction, rather than authored departure velocity, owns insertion selection.
        ...(index === 0 ? { velocityUnitsPerSec: { x: 0, y: 0, z: 0.25 } } : {}),
      },
      orbit,
      travel: { space,
        kind: 'orbitalInsert',
        sampleStepSecs: 0.005,
        maxPoints: 512,
        timing: { kind: 'duration', durationSecs: 4 },
      },
    });
    assert.ok(route);
    assert.equal(route.diagnostics.insertionSelection, 'tangent');
    assertVectorApprox(route.diagnostics.insertionPosition, route.arrival.position);
    assert.equal(route.diagnostics.insertionAngleRad, route.arrival.orbit.initialAngleRad);
    assert.ok(route.diagnostics.insertionApproachAlignment > 1 - 1e-12);
    assert.equal(route.diagnostics.insertionPlaneOffset, 0);
    if (index === 0) assert.ok(route.diagnostics.insertionDepartureVelocityAlignment < 0);

    const approach = subtractTestVectors(route.arrival.position, departure);
    const radial = subtractTestVectors(route.arrival.position, center);
    assert.ok(
      Math.abs(dotTestVectors(approach, radial)) < 1e-9,
      `approach must be perpendicular to arrival radial for handedness ${handedness} and angular speed ${angularSpeedRadPerSec}`,
    );
    assert.ok(Math.abs(testVectorLength(radial) - radius) < 1e-9);
    assert.ok(Math.abs(route.arrival.position.x - radius ** 2 / departure.x) < 1e-9);

    const signedDirection = handedness * Math.sign(angularSpeedRadPerSec || 1);
    assert.equal(
      Math.sign(route.arrival.position.z),
      -signedDirection,
      `tangent branch must follow handedness and signed angular speed`,
    );

    if (angularSpeedRadPerSec !== 0) {
      const routeEnd = evaluateSpatialRoute(route, route.timing.durationSecs);
      const orbitStart = evaluateSpatialOrbit(route.arrivalAction.orbit, 0);
      assertVectorApprox(route.arrival.velocityUnitsPerSec, orbitStart.velocityUnitsPerSec);
      assert.equal(route.arrival.speedUnitsPerSec, orbitStart.speedUnitsPerSec);
      assertVectorApprox(
        normalizeTestVector(routeEnd.velocityUnitsPerSec),
        normalizeTestVector(orbitStart.velocityUnitsPerSec),
        1e-9,
      );
    }
  }
});

test('orbital insert preserves an explicit initial angle instead of deriving a tangent', () => {
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: 1,
    initialAngleRad: Math.PI / 2,
    angularSpeedRadPerSec: 0.2,
  };
  const route = buildSpatialOrbitalInsertRoute({ space,
    from: { space, position: { x: 15, y: 0, z: 0 } },
    orbit,
    travel: { space,
      kind: 'orbitalInsert',
      sampleStepSecs: 0.005,
      maxPoints: 512,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(route);
  assert.equal(route.diagnostics.insertionSelection, 'explicitAngle');
  assertVectorApprox(route.diagnostics.insertionPosition, route.arrival.position);
  assert.equal(route.diagnostics.insertionAngleRad, orbit.initialAngleRad);
  assert.equal(route.arrival.orbit.initialAngleRad, orbit.initialAngleRad);
  assert.equal(route.arrivalAction.orbit.initialAngleRad, orbit.initialAngleRad);
  assertVectorApprox(route.arrival.position, { x: 0, y: 0, z: -5 });

  const approach = subtractTestVectors(route.arrival.position, route.departure.position);
  const radial = subtractTestVectors(route.arrival.position, orbit.center);
  assert.ok(Math.abs(dotTestVectors(approach, radial)) > 1);

  const routeEnd = evaluateSpatialRoute(route, route.timing.durationSecs);
  const orbitStart = evaluateSpatialOrbit(route.arrivalAction.orbit, 0);
  assertVectorApprox(route.arrival.velocityUnitsPerSec, orbitStart.velocityUnitsPerSec);
  assertVectorApprox(
    normalizeTestVector(routeEnd.velocityUnitsPerSec),
    normalizeTestVector(orbitStart.velocityUnitsPerSec),
    1e-9,
  );
});

test('orbital insert reports nearest-angle fallback reasons when no real tangent exists', () => {
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: 1,
    angularSpeedRadPerSec: 0.2,
  };
  const fallbackCases = [
    { space, position: { x: 2, y: 0, z: 0 }, reason: 'insideOrbitRadius' },
    { space, position: { x: 0, y: 0, z: 0 }, reason: 'onOrbitAxis' },
    { space, position: { x: 0, y: 10, z: 0 }, reason: 'onOrbitAxis' },
  ];

  for (const { position, reason } of fallbackCases) {
    const route = buildSpatialOrbitalInsertRoute({ space,
      from: { space, position },
      orbit,
      travel: { space, kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 2 } },
    });
    assert.ok(route);
    assert.equal(route.diagnostics.insertionSelection, 'nearestAngleFallback');
    const fallback = route.diagnostics.warnings.find((entry) => entry.code === 'orbitalInsertTangentFallback');
    assert.ok(fallback, `expected tangent fallback diagnostic for ${reason}`);
    assert.equal(fallback.metadata.reason, reason);
    assert.equal(fallback.metadata.radius, orbit.radius);
    assert.equal(fallback.metadata.projectedDistance, reason === 'insideOrbitRadius' ? 2 : 0);
    assertVectorApprox(route.diagnostics.insertionPosition, route.arrival.position);
    assert.equal(route.diagnostics.insertionAngleRad, route.arrival.orbit.initialAngleRad);
    assert.ok(Math.abs(testVectorLength(subtractTestVectors(
      route.arrival.position,
      orbit.center,
    )) - orbit.radius) < 1e-9);
  }
});

test('orbital insert classifies rotated orbit-axis starts with numerical tolerance', () => {
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 1, y: 1, z: 1 },
    referenceAxis: { x: 1, y: -1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const axisRoute = buildSpatialOrbitalInsertRoute({ space,
    from: { space, position: { x: 10, y: 10, z: 10 } },
    orbit,
    travel: { space, kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 2 } },
  });
  assert.ok(axisRoute);
  const axisFallback = axisRoute.diagnostics.warnings.find(
    (entry) => entry.code === 'orbitalInsertTangentFallback',
  );
  assert.ok(axisFallback);
  assert.equal(axisFallback.metadata.reason, 'onOrbitAxis');
  assert.ok(axisFallback.metadata.projectedDistance < 1e-12);

  const materialOffset = 1e-9;
  const inverseSqrtTwo = 1 / Math.sqrt(2);
  const offsetRoute = buildSpatialOrbitalInsertRoute({ space,
    from: { space,
      position: {
        x: 10 + materialOffset * inverseSqrtTwo,
        y: 10 - materialOffset * inverseSqrtTwo,
        z: 10,
      },
    },
    orbit,
    travel: { space, kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 2 } },
  });
  assert.ok(offsetRoute);
  const offsetFallback = offsetRoute.diagnostics.warnings.find(
    (entry) => entry.code === 'orbitalInsertTangentFallback',
  );
  assert.ok(offsetFallback);
  assert.equal(offsetFallback.metadata.reason, 'insideOrbitRadius');
  assert.ok(Math.abs(offsetFallback.metadata.projectedDistance - materialOffset) < 1e-14);
});

test('off-plane orbital insert selects a projected tangent and bends into the orbit plane', () => {
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    referenceAxis: { x: 1, y: 0, z: 0 },
    handedness: 1,
    angularSpeedRadPerSec: 0.2,
  };
  const route = buildSpatialOrbitalInsertRoute({ space,
    from: { space, position: { x: 15, y: 4, z: 0 } },
    orbit,
    travel: { space,
      kind: 'orbitalInsert',
      sampleStepSecs: 0.005,
      maxPoints: 512,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(route);
  assert.equal(route.diagnostics.insertionSelection, 'tangent');
  assertVectorApprox(route.diagnostics.insertionPosition, route.arrival.position);
  assert.equal(route.diagnostics.insertionAngleRad, route.arrival.orbit.initialAngleRad);
  assert.equal(route.diagnostics.insertionPlaneOffset, 4);
  assert.equal(route.diagnostics.warnings.some((entry) => entry.code === 'orbitalInsertTangentFallback'), false);
  const planeChange = route.diagnostics.warnings.find((entry) => entry.code === 'orbitalInsertPlaneChange');
  assert.ok(planeChange);
  assert.equal(planeChange.metadata.planeOffset, 4);
  assert.equal(planeChange.metadata.absolutePlaneOffset, 4);

  const approach = subtractTestVectors(route.arrival.position, route.departure.position);
  const radial = subtractTestVectors(route.arrival.position, orbit.center);
  assert.ok(Math.abs(dotTestVectors(approach, radial)) < 1e-9);
  assert.ok(Math.abs(route.arrival.position.y) < 1e-9);
  assert.ok(Math.abs(
    route.diagnostics.insertionApproachAlignment
      - dotTestVectors(normalizeTestVector(approach), route.diagnostics.selectedTangent)
  ) < 1e-12);
  assert.ok(route.diagnostics.insertionApproachAlignment > 0);
  assert.ok(route.diagnostics.insertionApproachAlignment < 1);

  const routeEnd = evaluateSpatialRoute(route, route.timing.durationSecs);
  const orbitStart = evaluateSpatialOrbit(route.arrivalAction.orbit, 0);
  assertVectorApprox(route.arrival.velocityUnitsPerSec, orbitStart.velocityUnitsPerSec);
  assertVectorApprox(
    normalizeTestVector(routeEnd.velocityUnitsPerSec),
    normalizeTestVector(orbitStart.velocityUnitsPerSec),
    1e-9,
  );
  assert.ok(Math.abs(routeEnd.velocityUnitsPerSec.y) < 1e-9);
});

test('timing profiles derive physical phases and constraint diagnostics', () => {
  assert.throws(() => deriveSpatialOrbitalInsertTiming({ space,
    distance: -1,
    orbitalSpeedUnitsPerSec: 0,
  }), /distance/);
  assert.throws(() => deriveSpatialOrbitalInsertTiming({ space,
    distance: 1,
    orbitalSpeedUnitsPerSec: -1,
  }), /orbitalSpeedUnitsPerSec/);

  const timing = deriveSpatialOrbitalInsertTiming({ space,
    distance: 10,
    currentSpeedUnitsPerSec: 0,
    approachSpeedUnitsPerSec: 4,
    orbitalSpeedUnitsPerSec: 1,
    accelerationUnitsPerSec2: 2,
    decelerationUnitsPerSec2: 1,
  });
  assert.equal(timing.phases.some((phase) => phase.kind === 'accelerate'), true);
  assert.equal(timing.phases.some((phase) => phase.kind === 'decelerate'), true);
  assert.equal(timing.diagnostics.requestedAccelerationApplied, true);
  assert.equal(timing.diagnostics.requestedDecelerationApplied, true);

  const constrained = deriveSpatialOrbitalInsertTiming({ space,
    distance: 10,
    currentSpeedUnitsPerSec: 5,
    orbitalSpeedUnitsPerSec: 1,
    durationSecs: 2,
    decelerationUnitsPerSec2: 0.1,
  });
  assert.equal(constrained.durationSecs, 2);
  assert.equal(constrained.diagnostics.durationConstrainedProfile, true);
  assert.equal(constrained.diagnostics.requestedDecelerationApplied, false);
  assert.equal(constrained.diagnostics.warnings.some((warning) => warning.code === 'requestedDecelerationFitted'), true);

  const accelerationOnly = deriveSpatialOrbitalInsertTiming({ space,
    distance: 10,
    currentSpeedUnitsPerSec: 1,
    orbitalSpeedUnitsPerSec: 5,
    accelerationUnitsPerSec2: 2,
  });
  assert.equal(accelerationOnly.departureSpeedUnitsPerSec, 1);
  assert.equal(accelerationOnly.arrivalSpeedUnitsPerSec, 5);
  assert.equal(accelerationOnly.phases.at(-1).endSpeedUnitsPerSec, 5);
  assert.equal(accelerationOnly.diagnostics.requestedAccelerationApplied, true);

  const decelerationOnly = deriveSpatialOrbitalInsertTiming({ space,
    distance: 10,
    currentSpeedUnitsPerSec: 5,
    orbitalSpeedUnitsPerSec: 1,
    decelerationUnitsPerSec2: 2,
  });
  assert.equal(decelerationOnly.departureSpeedUnitsPerSec, 5);
  assert.equal(decelerationOnly.arrivalSpeedUnitsPerSec, 1);
  assert.equal(decelerationOnly.phases.at(-1).endSpeedUnitsPerSec, 1);
  assert.equal(decelerationOnly.diagnostics.requestedDecelerationApplied, true);

  const ignoredDeceleration = deriveSpatialOrbitalInsertTiming({ space,
    distance: 10,
    currentSpeedUnitsPerSec: 1,
    orbitalSpeedUnitsPerSec: 5,
    decelerationUnitsPerSec2: 2,
  });
  assert.equal(ignoredDeceleration.departureSpeedUnitsPerSec, 1);
  assert.equal(ignoredDeceleration.arrivalSpeedUnitsPerSec, 5);
  assert.equal(ignoredDeceleration.phases.at(-1).endSpeedUnitsPerSec, 5);
  assert.equal(ignoredDeceleration.diagnostics.requestedDecelerationApplied, false);
  assert.equal(ignoredDeceleration.diagnostics.warnings.some((warning) => warning.code === 'requestedDecelerationIgnored'), true);

  const equalSpeedWithRates = deriveSpatialOrbitalInsertTiming({ space,
    distance: 10,
    currentSpeedUnitsPerSec: 1,
    orbitalSpeedUnitsPerSec: 1,
    accelerationUnitsPerSec2: 2,
    decelerationUnitsPerSec2: 2,
  });
  assert.equal(equalSpeedWithRates.departureSpeedUnitsPerSec, 1);
  assert.equal(equalSpeedWithRates.arrivalSpeedUnitsPerSec, 1);
  assert.equal(equalSpeedWithRates.diagnostics.requestedAccelerationApplied, false);
  assert.equal(equalSpeedWithRates.diagnostics.requestedDecelerationApplied, false);
  assert.equal(equalSpeedWithRates.diagnostics.warnings.some((warning) => warning.code === 'requestedAccelerationIgnored'), true);
  assert.equal(equalSpeedWithRates.diagnostics.warnings.some((warning) => warning.code === 'requestedDecelerationIgnored'), true);

  const clamped = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1, minDurationSecs: 4 } },
  });
  assert.equal(clamped.timing.durationSecs, 4);
  assert.equal(clamped.timing.diagnostics.clampedToMinDuration, true);

  const maxClamped = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 8, maxDurationSecs: 5 } },
  });
  assert.equal(maxClamped.timing.durationSecs, 5);
  assert.equal(maxClamped.timing.diagnostics.clampedToMaxDuration, true);
});

test('route timing preserves authored endpoint speeds and validates reusable profiles', () => {
  const authored = deriveSpatialRouteTiming({ space,
    totalLength: 7,
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'trapezoid',
        departureSpeedUnitsPerSec: 5,
        arrivalSpeedUnitsPerSec: 2,
      },
    },
  });
  assert.equal(authored.departureSpeedUnitsPerSec, 5);
  assert.equal(authored.arrivalSpeedUnitsPerSec, 2);
  assertTimingProfileInvariants(authored, 7);

  const endpointOverride = deriveSpatialRouteTiming({ space,
    totalLength: 7,
    departureSpeedUnitsPerSec: 3,
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'trapezoid',
        departureSpeedUnitsPerSec: 5,
        arrivalSpeedUnitsPerSec: 2,
      },
    },
  });
  assert.equal(endpointOverride.departureSpeedUnitsPerSec, 3);
  assert.equal(endpointOverride.arrivalSpeedUnitsPerSec, 2);

  const reusable = deriveSpatialRouteTiming({ space,
    totalLength: 7,
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 2 } },
  });
  const reused = deriveSpatialRouteTiming({ space,
    totalLength: 7,
    travel: { kind: 'polyline', timing: reusable },
  });
  assert.notEqual(reused, reusable);
  assert.notEqual(reused.phases, reusable.phases);
  assertTimingProfileInvariants(reused, 7);
  assert.throws(() => deriveSpatialRouteTiming({ space,
    totalLength: 8,
    travel: { kind: 'polyline', timing: reusable },
  }), /final phase distance/);
  assert.throws(() => deriveSpatialRouteTiming({ space,
    totalLength: 7,
    travel: { kind: 'polyline', timing: { ...reusable, distance: 8 } },
  }), /distance must match/);
  assert.throws(() => deriveSpatialRouteTiming({ space,
    totalLength: 7,
    travel: { kind: 'polyline', timing: { ...reusable, arrivalSpeedUnitsPerSec: 99 } },
  }), /arrivalSpeedUnitsPerSec must match/);
  assert.throws(() => deriveSpatialRouteTiming({ space,
    totalLength: 7,
    travel: { kind: 'polyline', timing: { ...reusable, kind: 'bogus' } },
  }), /profile kind/);
  for (const mismatch of [
    { peakSpeedUnitsPerSec: -1 },
    { cruiseSpeedUnitsPerSec: 99 },
    { accelerationUnitsPerSec2: 1 },
  ]) {
    assert.throws(() => deriveSpatialRouteTiming({ space,
      totalLength: 7,
      travel: { kind: 'polyline', timing: { ...reusable, ...mismatch } },
    }), /SpatialTimingProfile/);
  }
  assert.throws(() => deriveSpatialRouteTiming({ space,
    totalLength: 7,
    travel: { kind: 'polyline', timing: { ...reusable, diagnostics: {} } },
  }), /diagnostics\.warnings/);

  const normalizedArrival = normalizeSpatialArrivalAction({ space,
    kind: 'orbitalInsert',
    orbit: { space, center: { x: 0, y: 0, z: 0 }, radius: 1 },
    timing: reusable,
  });
  assert.notEqual(normalizedArrival.timing, reusable);
  assert.notEqual(normalizedArrival.timing.phases, reusable.phases);
});

test('kinematic timing fits infeasible rates without violating phase physics', () => {
  const restToRest = deriveSpatialRouteTiming({ space,
    totalLength: 1,
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'trapezoid',
        departureSpeedUnitsPerSec: 0,
        cruiseSpeedUnitsPerSec: 0,
        arrivalSpeedUnitsPerSec: 0,
        accelerationUnitsPerSec2: 1,
        decelerationUnitsPerSec2: 1,
      },
    },
  });
  assertTimingProfileInvariants(restToRest, 1);
  assert.equal(restToRest.kind, 'triangular');
  assert.ok(restToRest.peakSpeedUnitsPerSec > 0);

  const shortStop = deriveSpatialOrbitalInsertTiming({ space,
    distance: 1,
    currentSpeedUnitsPerSec: 10,
    orbitalSpeedUnitsPerSec: 0,
    accelerationUnitsPerSec2: 1,
    decelerationUnitsPerSec2: 1,
  });
  assertTimingProfileInvariants(shortStop, 1);
  assert.ok(Math.abs(shortStop.durationSecs - 0.2) < 1e-9);
  assert.equal(shortStop.diagnostics.requestedDecelerationApplied, false);
  assert.equal(shortStop.diagnostics.warnings.some((entry) => entry.code === 'endpointRateFittedToDistance'), true);

  const durationConstrained = deriveSpatialOrbitalInsertTiming({ space,
    distance: 1,
    currentSpeedUnitsPerSec: 10,
    orbitalSpeedUnitsPerSec: 0,
    durationSecs: 10,
    accelerationUnitsPerSec2: 1,
    decelerationUnitsPerSec2: 1,
  });
  assertTimingProfileInvariants(durationConstrained, 1);
  assert.equal(durationConstrained.durationSecs, 10);

  const route = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'trapezoid',
        departureSpeedUnitsPerSec: 10,
        arrivalSpeedUnitsPerSec: 0,
        accelerationUnitsPerSec2: 1,
        decelerationUnitsPerSec2: 1,
      },
    },
  });
  assert.ok(Math.abs(evaluateSpatialRoute(route, route.timing.durationSecs / 2).distance - 0.75) < 1e-9);
  const complete = evaluateSpatialRoute(route, route.timing.durationSecs);
  assert.equal(complete.complete, true);
  assertVectorApprox(complete.position, { x: 1, y: 0, z: 0 });
});

test('route evaluation samples distance from timing phases', () => {
  const route = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'trapezoid',
        departureSpeedUnitsPerSec: 0,
        arrivalSpeedUnitsPerSec: 0,
        accelerationUnitsPerSec2: 2,
        decelerationUnitsPerSec2: 2,
      },
    },
  });
  const sample = evaluateSpatialRoute(route, 1);
  const linearDistance = route.totalLength * (sample.elapsedSecs / route.timing.durationSecs);
  assert.equal(sample.distance < linearDistance, true);
  assertVectorApprox(sample.position, { x: 1, y: 0, z: 0 });
});

test('route evaluation normalizes authored endpoint velocities to endpoint speeds', () => {
  const polyline = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 2 } },
  });
  const polylineWithVelocities = {
    ...polyline,
    departure: {
      ...polyline.departure,
      velocityUnitsPerSec: { x: 0, y: 3, z: 4 },
      speedUnitsPerSec: 10,
    },
    arrival: {
      ...polyline.arrival,
      velocityUnitsPerSec: { x: 0, y: -4, z: 3 },
      speedUnitsPerSec: 5,
    },
  };
  const polylineDeparture = evaluateSpatialRoute(polylineWithVelocities, 0);
  assertVectorApprox(polylineDeparture.velocityUnitsPerSec, { x: 0, y: 6, z: 8 });
  assert.equal(polylineDeparture.speedUnitsPerSec, 10);
  const polylineArrival = evaluateSpatialRoute(polylineWithVelocities, 2);
  assertVectorApprox(polylineArrival.velocityUnitsPerSec, { x: 0, y: -4, z: 3 });
  assert.equal(polylineArrival.speedUnitsPerSec, 5);

  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const transfer = buildSpatialOrbitTransferRoute({ space,
    from: {
      orbit: { ...orbit, initialAngleRad: 0 },
      velocityUnitsPerSec: { x: 0, y: 0, z: -2 },
      speedUnitsPerSec: 3,
    },
    to: {
      orbit: { ...orbit, initialAngleRad: Math.PI / 2 },
      velocityUnitsPerSec: { x: -4, y: 0, z: 0 },
      speedUnitsPerSec: 2,
    },
    travel: { space, kind: 'orbitTransfer', timing: { kind: 'duration', durationSecs: 4 } },
  });
  assert.ok(transfer);
  const transferDeparture = evaluateSpatialRoute(transfer, 0);
  assertVectorApprox(transferDeparture.velocityUnitsPerSec, { x: 0, y: 0, z: -3 });
  assert.equal(transferDeparture.speedUnitsPerSec, 3);
  const transferArrival = evaluateSpatialRoute(transfer, transfer.timing.durationSecs);
  assertVectorApprox(transferArrival.velocityUnitsPerSec, { x: -2, y: 0, z: 0 });
  assert.equal(transferArrival.speedUnitsPerSec, 2);
});

test('completed zero-duration routes give arrival endpoint velocity precedence', () => {
  const route = buildSpatialPolylineRoute({ space,
    points: [{ x: 2, y: 3, z: 4 }, { x: 2, y: 3, z: 4 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 0 } },
  });
  const routeWithVelocities = {
    ...route,
    departure: {
      ...route.departure,
      velocityUnitsPerSec: { x: 1, y: 0, z: 0 },
      speedUnitsPerSec: 2,
    },
    arrival: {
      ...route.arrival,
      velocityUnitsPerSec: { x: 0, y: 0, z: -1 },
      speedUnitsPerSec: 4,
    },
  };
  const sample = evaluateSpatialRoute(routeWithVelocities, 0);
  assert.equal(sample.complete, true);
  assertVectorApprox(sample.position, routeWithVelocities.arrival.position);
  assertVectorApprox(sample.velocityUnitsPerSec, { x: 0, y: 0, z: -4 });
  assert.equal(sample.speedUnitsPerSec, 4);
});

test('custom timing validates phase speed integrals', () => {
  assert.throws(() => normalizeSpatialTimingSpec({ space,
    kind: 'custom',
    durationSecs: 1,
    phases: [],
  }), /at least one phase/);

  assert.throws(() => normalizeSpatialTimingSpec({ space,
    kind: 'custom',
    durationSecs: 1,
    phases: [{
      kind: 'cruise',
      startTimeSecs: 0,
      endTimeSecs: 1,
      startDistance: 0,
      endDistance: 2,
      startSpeedUnitsPerSec: 1,
      endSpeedUnitsPerSec: 1,
    }],
  }), /speed integral/);

  const zeroDurationHold = normalizeSpatialTimingSpec({ space,
    kind: 'custom',
    durationSecs: 0,
    phases: [{
      kind: 'hold',
      startTimeSecs: 0,
      endTimeSecs: 0,
      startDistance: 0,
      endDistance: 0,
      startSpeedUnitsPerSec: 0,
      endSpeedUnitsPerSec: 0,
    }],
  });
  assert.equal(zeroDurationHold.durationSecs, 0);

  const customRoute = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    travel: {
      kind: 'polyline',
      timing: { space,
        kind: 'custom',
        durationSecs: 2,
        phases: [{
          kind: 'cruise',
          startTimeSecs: 0,
          endTimeSecs: 2,
          startDistance: 0,
          endDistance: 2,
          startSpeedUnitsPerSec: 1,
          endSpeedUnitsPerSec: 1,
        }],
      },
    },
  });
  assert.equal(customRoute.timing.durationSecs, 2);

  assert.throws(() => normalizeSpatialTimingSpec({ space,
    kind: 'custom',
    durationSecs: 2,
    phases: [
      {
        kind: 'cruise',
        startTimeSecs: 0,
        endTimeSecs: 1,
        startDistance: 0,
        endDistance: 1,
        startSpeedUnitsPerSec: 1,
        endSpeedUnitsPerSec: 1,
      },
      {
        kind: 'cruise',
        startTimeSecs: 1,
        endTimeSecs: 2,
        startDistance: 1,
        endDistance: 3,
        startSpeedUnitsPerSec: 2,
        endSpeedUnitsPerSec: 2,
      },
    ],
  }), /contiguous speeds/);
});

test('orbital insert and transfer routes use curved orbit-aware geometry', () => {
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 5,
    orbitNormal: { x: 0, y: 1, z: 0 },
    angularSpeedRadPerSec: 0.2,
  };
  const insert = buildSpatialOrbitalInsertRoute({ space,
    from: { space, position: { x: 15, y: 0, z: 0 } },
    orbit,
    travel: { space,
      kind: 'orbitalInsert',
      sampleStepSecs: 0.25,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(insert);
  assert.notEqual(insert.points[Math.floor(insert.points.length / 2)].z, 0);
  const insertFinalDirection = normalizeTestVector(subtractTestVectors(
    insert.points[insert.points.length - 1],
    insert.points[insert.points.length - 2],
  ));
  assert.equal(dotTestVectors(insertFinalDirection, insert.diagnostics.selectedTangent) > 0.9, true);
  const rebuiltInsert = buildSpatialOrbitalInsertRoute({ space,
    from: { space, position: { x: 15, y: 0, z: 0 } },
    orbit,
    travel: { space,
      kind: 'orbitalInsert',
      sampleStepSecs: 0.25,
      timing: insert.timing,
    },
  });
  assert.ok(rebuiltInsert);
  assert.ok(Math.abs(rebuiltInsert.totalLength - insert.totalLength) < 1e-9);

  const transfer = buildSpatialOrbitTransferRoute({ space,
    from: { space,
      position: { x: 10, y: 0, z: 0 },
      orbit: { ...orbit, radius: 10, initialAngleRad: 0 },
    },
    to: { orbit: { ...orbit, initialAngleRad: Math.PI / 2 } },
    travel: { space,
      kind: 'orbitTransfer',
      sampleStepSecs: 0.25,
      timing: { kind: 'duration', durationSecs: 4 },
    },
  });
  assert.ok(transfer);
  assert.equal(transfer.diagnostics.warnings.length, 0);
  assert.equal(transfer.points.some((point) => pointLineDistance(point, transfer.departure.position, transfer.arrival.position) > 0.1), true);
  const rebuiltTransfer = buildSpatialOrbitTransferRoute({ space,
    from: { space,
      position: { x: 10, y: 0, z: 0 },
      orbit: { ...orbit, radius: 10, initialAngleRad: 0 },
    },
    to: { orbit: { ...orbit, initialAngleRad: Math.PI / 2 } },
    travel: { space,
      kind: 'orbitTransfer',
      sampleStepSecs: 0.25,
      timing: transfer.timing,
    },
  });
  assert.ok(rebuiltTransfer);
  assert.ok(Math.abs(rebuiltTransfer.totalLength - transfer.totalLength) < 1e-9);
});

test('aim tracks require an observer source for target aims', () => {
  const track = buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'target', target: { x: 1, y: 0, z: 0 } } },
  ], { space, durationSecs: 1 });
  assert.throws(() => evaluateSpatialAimTrack(track, 0.5, {}), /position/);
  const sample = evaluateSpatialAimTrack(track, 0.5, { space, position: { x: 0, y: 0, z: 0 } });
  assert.equal(sample.aim.kind, 'target');
});

test('paths evaluate canonical samples, playback remap, defaults, and duplicate policy', () => {
  assert.throws(() => normalizeSpatialPathSpec({ space, positionKeys: [] }), /positionKeys/);
  assert.throws(() => normalizeSpatialPathSpec({ space,
    positionKeys: [
      { space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 } },
      { space, id: 'b', timeSecs: 0, position: { x: 1, y: 0, z: 0 } },
    ],
  }), /Duplicate/);

  const path = normalizeSpatialPathSpec({ space,
    durationSecs: 10,
    positionKeys: [
      { space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 } },
      { space, id: 'b', timeSecs: 10, position: { x: 10, y: 0, z: 0 } },
    ],
    aimKeys: [
      { id: 'aim', timeSecs: 0, aim: { space, kind: 'target', target: { x: 10, y: 0, z: 0 } } },
    ],
    timeRemap: { kind: 'linear', playbackDurationSecs: 20 },
  });
  const sample = evaluateSpatialPath(path, 5);
  assert.equal(sample.pose.position.x > 4 && sample.pose.position.x < 6, true);
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
  assert.throws(() => normalizeSpatialPathSpec({ space, positionKeys: [{ space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 } }], timeRemap: { kind: 'profile' } }), /linear and eased/);
});

test('route and path sampling include endpoints, enforce maxSamples, and reject invalid options', () => {
  const route = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 12 } },
  });
  const routeSamples = sampleSpatialRoute(route, { sampleStepSecs: 5 });
  assert.deepEqual(routeSamples.map((sample) => sample.elapsedSecs), [0, 5, 10, 12]);
  assert.equal(routeSamples.at(-1).complete, true);

  const cappedRouteSamples = sampleSpatialRoute(route, { sampleStepSecs: 5, maxSamples: 3 });
  assert.deepEqual(cappedRouteSamples.map((sample) => sample.elapsedSecs), [0, 5, 10]);
  assert.equal(cappedRouteSamples.at(-1).complete, false);
  assert.equal(cappedRouteSamples.at(-1).diagnostics.warnings.at(-1).code, 'maxSamplesTruncatesRoute');

  const path = normalizeSpatialPathSpec({ space,
    durationSecs: 12,
    positionKeys: [
      { space, id: 'start', timeSecs: 0, position: { x: 0, y: 0, z: 0 } },
      { space, id: 'end', timeSecs: 12, position: { x: 12, y: 0, z: 0 } },
    ],
  });
  const pathSamples = sampleSpatialPath(path, { sampleStepSecs: 5 });
  assert.deepEqual(pathSamples.map((sample) => sample.timeSecs), [0, 5, 10, 12]);
  assertVectorApprox(pathSamples.at(-1).pose.position, { x: 12, y: 0, z: 0 });

  const cappedPathSamples = sampleSpatialPath(path, { sampleStepSecs: 5, maxSamples: 3 });
  assert.deepEqual(cappedPathSamples.map((sample) => sample.timeSecs), [0, 5, 10]);
  assert.equal(cappedPathSamples.at(-1).diagnostics.warnings.at(-1).code, 'maxSamplesTruncatesPath');
  assert.equal(sampleSpatialPathDiagnostics(path, { sampleStepSecs: 5, maxSamples: 3 }).warnings.at(-1).code, 'maxSamplesTruncatesPath');
  assert.equal(sampleSpatialPathDiagnostics(path, { sampleStepSecs: 5, maxSamples: 4 }).warnings.length, 0);

  const decimalRoute = buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 0.9 } },
  });
  const decimalSamples = sampleSpatialRoute(decimalRoute, { sampleStepSecs: 0.09, maxSamples: 11 });
  assert.equal(decimalSamples.length, 11);
  assert.equal(decimalSamples.at(-1).elapsedSecs, 0.9);
  assert.equal(decimalSamples.at(-1).complete, true);
  assert.equal(decimalSamples.at(-1).diagnostics.warnings.length, 0);

  const decimalPath = normalizeSpatialPathSpec({ space,
    durationSecs: 0.9,
    positionKeys: [
      { space, id: 'start', timeSecs: 0, position: { x: 0, y: 0, z: 0 } },
      { space, id: 'end', timeSecs: 0.9, position: { x: 0.9, y: 0, z: 0 } },
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
  const holdPath = normalizeSpatialPathSpec({ space,
    durationSecs: 10,
    positionKeys: [
      { space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 }, interpolation: { kind: 'hold' } },
      { space, id: 'b', timeSecs: 10, position: { x: 10, y: 0, z: 0 } },
    ],
  });
  assertVectorApprox(evaluateSpatialPath(holdPath, 5).pose.position, { x: 0, y: 0, z: 0 });
  assertVectorApprox(evaluateSpatialPath(holdPath, 10).pose.position, { x: 10, y: 0, z: 0 });
  assert.equal(evaluateSpatialPath(holdPath, 5).speedUnitsPerSec, 0);

  const linearPath = normalizeSpatialPathSpec({ space,
    durationSecs: 10,
    positionKeys: [
      { space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 } },
      { space, id: 'b', timeSecs: 10, position: { x: 10, y: 0, z: 0 } },
    ],
  });
  const linear = evaluateSpatialPath(linearPath, 5);
  assertVectorApprox(linear.pose.position, { x: 5, y: 0, z: 0 });
  assertVectorApprox(linear.velocityUnitsPerSec, { x: 1, y: 0, z: 0 });
  assertVectorApprox(linear.accelerationUnitsPerSec2, { x: 0, y: 0, z: 0 });

  const bezier = evaluateSpatialPath(normalizeSpatialPathSpec({ space,
    durationSecs: 10,
    positionKeys: [
      { space,
        id: 'a',
        timeSecs: 0,
        position: { x: 0, y: 0, z: 0 },
        interpolation: { kind: 'cubicBezier', outTangent: { x: 0, y: 10, z: 0 } },
      },
      { space,
        id: 'b',
        timeSecs: 10,
        position: { x: 10, y: 0, z: 0 },
        interpolation: { kind: 'cubicBezier', inTangent: { x: 0, y: 10, z: 0 } },
      },
    ],
  }), 5);
  assert.equal(bezier.pose.position.y > 7, true);
  assert.equal(Number.isFinite(bezier.speedUnitsPerSec), true);
  assert.equal(Number.isFinite(bezier.accelerationMagnitudeUnitsPerSec2), true);

  const hermite = evaluateSpatialPath(normalizeSpatialPathSpec({ space,
    durationSecs: 10,
    positionKeys: [
      { space,
        id: 'a',
        timeSecs: 0,
        position: { x: 0, y: 0, z: 0 },
        interpolation: { kind: 'hermite', outVelocityUnitsPerSec: { x: 0, y: 2, z: 0 } },
      },
      { space,
        id: 'b',
        timeSecs: 10,
        position: { x: 10, y: 0, z: 0 },
        interpolation: { kind: 'hermite', inVelocityUnitsPerSec: { x: 0, y: -2, z: 0 } },
      },
    ],
  }), 5);
  assert.equal(hermite.pose.position.y > 4, true);
  assert.equal(Number.isFinite(hermite.speedUnitsPerSec), true);
  assert.equal(Number.isFinite(hermite.accelerationMagnitudeUnitsPerSec2), true);

  const catmull = evaluateSpatialPath(normalizeSpatialPathSpec({ space,
    durationSecs: 30,
    positionKeys: [
      { space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 } },
      { space, id: 'b', timeSecs: 10, position: { x: 10, y: 0, z: 0 }, interpolation: { kind: 'catmullRom' } },
      { space, id: 'c', timeSecs: 20, position: { x: 20, y: 10, z: 0 } },
      { space, id: 'd', timeSecs: 30, position: { x: 30, y: 0, z: 0 } },
    ],
  }), 15);
  assert.equal(Math.abs(catmull.pose.position.y - 5) > 0.01, true);
});

test('path interpolation normalizers reject unsupported kinds and numeric ranges', () => {
  const pathWithInterpolation = (interpolation) => ({ space,
    positionKeys: [
      { space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 }, interpolation },
      { space, id: 'b', timeSecs: 1, position: { x: 1, y: 0, z: 0 } },
    ],
  });
  assert.throws(() => normalizeSpatialPathSpec(pathWithInterpolation({ kind: 'warp' })), TypeError);
  assert.throws(() => normalizeSpatialPathSpec(pathWithInterpolation({ kind: 'catmullRom', tension: 2 })), RangeError);
  assert.throws(() => normalizeSpatialPathSpec({ space,
    ...pathWithInterpolation({ kind: 'linear' }),
    timeRemap: { kind: 'eased', easing: { kind: 'cubicBezier', x1: -0.1, y1: 0, x2: 1, y2: 1 } },
  }), RangeError);
});

test('aim interpolation preserves target, direction, orientation, and hold semantics', () => {
  const targetTrack = buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } } },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'target', target: { x: 10, y: 0, z: -10 } } },
  ], { space, durationSecs: 10 });
  const target = evaluateSpatialAimTrack(targetTrack, 5, { space, position: { x: 0, y: 0, z: 0 } }).aim;
  assert.equal(target.kind, 'target');
  assertVectorApprox(target.target, { x: 5, y: 0, z: -10 });

  const targetBezier = evaluateSpatialAimTrack(buildSpatialAimTrack([
    {
      id: 'a',
      timeSecs: 0,
      aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } },
      interpolation: { kind: 'targetBezier' },
    },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'target', target: { x: 10, y: 0, z: -10 } } },
  ], { space, durationSecs: 10 }), 2.5, { space, position: { x: 0, y: 0, z: 0 } }).aim;
  assertVectorApprox(targetBezier.target, { x: 1.5625, y: 0, z: -10 });

  const cubicEased = evaluateSpatialAimTrack(buildSpatialAimTrack([
    {
      id: 'a',
      timeSecs: 0,
      aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } },
      interpolation: { kind: 'targetLinear', easing: { kind: 'cubicBezier', x1: 0, y1: 0, x2: 0, y2: 1 } },
    },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'target', target: { x: 10, y: 0, z: -10 } } },
  ], { space, durationSecs: 10 }), 1.25, { space, position: { x: 0, y: 0, z: 0 } }).aim;
  assertVectorApprox(cubicEased.target, { x: 5, y: 0, z: -10 }, 1e-6);

  const direction = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'direction', forward: { x: 1, y: 0, z: 0 } } },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'direction', forward: { x: 0, y: 1, z: 0 } } },
  ], { space, durationSecs: 10 }), 5, {}).aim;
  assert.equal(direction.kind, 'direction');
  assertVectorApprox(direction.forward, { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 });

  const orientation = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'orientation', orientation: SPATIAL_IDENTITY_QUATERNION } },
    {
      id: 'b',
      timeSecs: 10,
      aim: { space, kind: 'orientation', orientation: createSpatialQuaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2) },
    },
  ], { space, durationSecs: 10 }), 5, {}).aim;
  assert.equal(orientation.kind, 'orientation');

  const mixed = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'direction', forward: { x: 1, y: 0, z: 0 } }, source: { packageName: 'test', id: 'left' } },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } }, source: { packageName: 'test', id: 'right' } },
  ], { space, durationSecs: 10 }), 5, { space, position: { x: 0, y: 0, z: 0 } });
  assert.equal(mixed.aim.kind, 'orientation');
  assert.equal(mixed.aim.diagnostics.warnings[0].code, 'mixedAimInterpolation');
  assert.equal(mixed.aim.diagnostics.warnings[0].metadata.leftSource.id, 'left');

  const mixedLeftOnly = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'direction', forward: { x: 1, y: 0, z: 0 } }, source: { packageName: 'test', id: 'left-only' } },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } } },
  ], { space, durationSecs: 10 }), 5, { space, position: { x: 0, y: 0, z: 0 } });
  assert.equal(mixedLeftOnly.aim.diagnostics.warnings[0].metadata.leftSource.id, 'left-only');
  assert.equal('rightSource' in mixedLeftOnly.aim.diagnostics.warnings[0].metadata, false);

  const mixedRightOnly = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'direction', forward: { x: 1, y: 0, z: 0 } } },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } }, source: { packageName: 'test', id: 'right-only' } },
  ], { space, durationSecs: 10 }), 5, { space, position: { x: 0, y: 0, z: 0 } });
  assert.equal(mixedRightOnly.aim.diagnostics.warnings[0].metadata.rightSource.id, 'right-only');
  assert.equal('leftSource' in mixedRightOnly.aim.diagnostics.warnings[0].metadata, false);

  const hold = evaluateSpatialAimTrack(buildSpatialAimTrack([
    {
      id: 'a',
      timeSecs: 0,
      aim: { space, kind: 'direction', forward: { x: 1, y: 0, z: 0 } },
      interpolation: { kind: 'hold' },
    },
    { id: 'b', timeSecs: 10, aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } } },
  ], { space, durationSecs: 10 }), 5, {});
  assert.equal(hold.aim.kind, 'direction');
});

test('aim interpolation validates specs and applies fallback up vectors', () => {
  assert.throws(() => buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'direction', forward: { x: 1, y: 0, z: 0 } }, interpolation: { kind: 'spin' } },
  ], { space, durationSecs: 1 }), TypeError);
  assert.throws(() => buildSpatialAimTrack([], { space,
    defaultInterpolation: { kind: 'targetLinear', easing: { kind: 'cubicBezier', x1: 0.2, y1: 0, x2: 1.2, y2: 1 } },
  }), RangeError);

  const fallback = evaluateSpatialAimTrack(buildSpatialAimTrack([
    { id: 'a', timeSecs: 0, aim: { space, kind: 'target', target: { x: 10, y: 0, z: 0 } } },
  ], { space, durationSecs: 1 }), 0, { space,
    position: { x: 0, y: 0, z: 0 },
    fallbackUp: { x: 0, y: 0, z: 1 },
  }).aim;
  assertVectorApprox(fallback.up, { x: 0, y: 0, z: 1 });
});

test('view transition lanes delay, ease, and complete independently', () => {
  const transition = buildSpatialViewTransitionPath({ space,
    from: {
      pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
      aim: evaluateSpatialAim({ space,
        position: { x: 0, y: 0, z: 0 },
        aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } },
      }),
    },
    to: {
      pose: { space, position: { x: 10, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
      aim: evaluateSpatialAim({ space,
        position: { x: 10, y: 0, z: 0 },
        aim: { space, kind: 'target', target: { x: 10, y: 0, z: -10 } },
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
  assertVectorApprox(beforePosition.pose.position, { x: 0, y: 0, z: 0 });
  assert.equal(beforePosition.frameState.aim.kind, 'target');
  assertVectorApprox(beforePosition.frameState.aim.target, { x: 0, y: 0, z: -10 });
  assert.equal(beforePosition.positionComplete, false);
  assert.equal(beforePosition.aimComplete, false);

  const easedMidpoint = evaluateSpatialViewTransition(transition, 2);
  assertVectorApprox(easedMidpoint.pose.position, { x: 2.5, y: 0, z: 0 });
  assertVectorApprox(easedMidpoint.frameState.aim.target, { x: 0, y: 0, z: -10 });
  assert.equal(easedMidpoint.positionComplete, false);
  assert.equal(easedMidpoint.aimComplete, false);

  const aimMidpoint = evaluateSpatialViewTransition(transition, 2.5);
  assert.equal(aimMidpoint.frameState.aim.kind, 'target');
  assertVectorApprox(aimMidpoint.frameState.aim.target, { x: 5, y: 0, z: -10 });

  const lanesComplete = evaluateSpatialViewTransition(transition, 3);
  assertVectorApprox(lanesComplete.pose.position, { x: 10, y: 0, z: 0 });
  assertVectorApprox(lanesComplete.frameState.aim.target, { x: 10, y: 0, z: -10 });
  assert.equal(lanesComplete.positionComplete, true);
  assert.equal(lanesComplete.aimComplete, true);
  assert.equal(lanesComplete.complete, false);
  assert.equal(evaluateSpatialViewTransition(transition, 4).complete, true);
});

test('pose transitions delegate to equivalent view transitions', () => {
  const from = { space,
    position: { x: 0, y: 0, z: 0 },
    orientation: SPATIAL_IDENTITY_QUATERNION,
  };
  const to = { space,
    position: { x: 10, y: 0, z: 0 },
    orientation: createSpatialQuaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2),
  };
  const lanes = { space,
    durationSecs: 3,
    movement: { delaySecs: 1, durationSecs: 1, interpolation: 'smoothstep' },
    orientation: { delaySecs: 0.5, durationSecs: 2, interpolation: 'slerp' },
  };
  const poseTransition = createSpatialPoseTransition({ space, from, to, ...lanes });
  const viewTransition = buildSpatialViewTransitionPath({ space,
    from: { pose: from, aim: null },
    to: { pose: to, aim: null },
    durationSecs: lanes.durationSecs,
    position: lanes.movement,
    aim: lanes.orientation,
  });

  const held = evaluateSpatialPoseTransition(poseTransition, 0.25);
  assertVectorApprox(held.pose.position, { x: 0, y: 0, z: 0 });
  assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, held.pose.orientation), SPATIAL_LOCAL_FORWARD);
  assert.equal(held.movementComplete, false);
  assert.equal(held.orientationComplete, false);

  const poseSample = evaluateSpatialPoseTransition(poseTransition, 1.5);
  const viewSample = evaluateSpatialViewTransition(viewTransition, 1.5);
  assertVectorApprox(poseSample.pose.position, viewSample.pose.position);
  assertVectorApprox(
    applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, poseSample.pose.orientation),
    applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, viewSample.pose.orientation),
  );

  const rawPoseTransition = { from, to, durationSecs: 2 };
  assert.equal(evaluateSpatialPoseTransition(rawPoseTransition, 1).pose.position.x > 0, true);
});

test('transition lane normalization rejects invalid timing and interpolation', () => {
  const spec = {
    from: frame({ x: 0, y: 0, z: 0 }),
    to: frame({ x: 1, y: 0, z: 0 }),
    durationSecs: 1,
  };
  assert.throws(() => buildSpatialViewTransitionPath({ space,
    ...spec,
    position: { delaySecs: 0.75, durationSecs: 0.5 },
  }), RangeError);
  assert.throws(() => buildSpatialViewTransitionPath({ space,
    ...spec,
    position: { delaySecs: -1 },
  }), RangeError);
  assert.throws(() => buildSpatialViewTransitionPath({ space,
    ...spec,
    position: { interpolation: 'warp' },
  }), TypeError);
  assert.throws(() => createSpatialPoseTransition({ space,
    from: spec.from.pose,
    to: spec.to.pose,
    durationSecs: 1,
    orientation: { delaySecs: 0.75, durationSecs: 0.5 },
  }), RangeError);
});

test('preload hints and navigation wrapper use canonical fields', () => {
  const path = normalizeSpatialPathSpec({ space,
    durationSecs: 1,
    positionKeys: [
      { space, id: 'a', timeSecs: 0, position: { x: 0, y: 0, z: 0 } },
      { space, id: 'b', timeSecs: 1, position: { x: 1, y: 0, z: 0 } },
    ],
  });
  const hints = materializeSpatialPreloadHints(path, {
    pathRadius: 1,
    sphereRadius: 1,
    lookaheadSecs: 1,
    sampleStepSecs: 0.5,
  });
  assert.equal(hints.some((hint) => hint.kind === 'pathVolume'), true);
  assert.equal(hints.some((hint) => hint.kind === 'sphereVolume'), true);
  assert.equal(hints.some((hint) => hint.kind === 'viewLookahead'), true);

  const navigation = createSpatialNavigationAutomation(space);
  const route = buildSpatialOrbitTransferRoute({ space,
    from: { space, position: { x: 0, y: 0, z: 0 } },
    to: { space, position: { x: 1, y: 0, z: 0 } },
    travel: { space, kind: 'orbitTransfer', timing: { kind: 'duration', durationSecs: 1 } },
  });
  navigation.flyRoute(route);
  const pose = navigation.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    deltaSecs: 0.5,
  });
  assert.equal(pose.position.x > 0, true);
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbitTransfer');
  assert.equal(normalizeSpatialUpdateDelta({ deltaSecs: 1 }), 1);
  assert.throws(() => normalizeSpatialUpdateDelta({ deltaSeconds: 1 }), /deltaSecs/);
});

test('navigation preserves orbit handoff time and keeps movement and aim cancellation independent', () => {
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 1,
    angularSpeedRadPerSec: 1,
  };
  const route = buildSpatialOrbitTransferRoute({ space,
    from: { space, position: { x: 2, y: 0, z: 0 } },
    to: { orbit },
    travel: { space, kind: 'orbitTransfer', timing: { kind: 'duration', durationSecs: 1 } },
  });
  assert.ok(route);
  const navigation = createSpatialNavigationAutomation(space);
  navigation.flyRoute(route);
  const handedOff = navigation.update({
    pose: { space, position: { x: 2, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    deltaSecs: 1.5,
  });
  const expectedOrbit = evaluateSpatialOrbit(route.arrivalAction.orbit, 0.5);
  assertVectorApprox(handedOff.position, expectedOrbit.position);
  assert.equal(navigation.getDiagnostics().elapsedSecs, 0.5);
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbit');
  assert.equal(navigation.getFrameState().aim.kind, 'target');

  navigation.lockAt({ space, kind: 'target', target: { x: 0, y: 1, z: 0 } });
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
  const orbit = { space,
    center: { x: 0, y: 0, z: 0 },
    radius: 1,
    angularSpeedRadPerSec: 1,
  };
  const routeWithArrival = (arrivalAction) => buildSpatialPolylineRoute({ space,
    points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1 } },
    arrivalAction,
  });
  const initialPose = { space,
    position: { x: 0, y: 0, z: 0 },
    orientation: SPATIAL_IDENTITY_QUATERNION,
  };
  const preservedAim = { space, kind: 'direction', forward: { x: 0, y: 1, z: 0 } };

  const preserving = createSpatialNavigationAutomation(space);
  preserving.lookAt(preservedAim);
  preserving.flyRoute(routeWithArrival(normalizeSpatialArrivalAction({ space,
    kind: 'orbit',
    orbit,
    settleSecs: 2,
    preserveAim: true,
  })));
  const settlingPose = preserving.update({ pose: initialPose, deltaSecs: 1.5 });
  assertVectorApprox(settlingPose.position, { x: 1, y: 0, z: 0 });
  assert.deepEqual(preserving.getDiagnostics().pendingSettle, {
    behavior: 'continueOrbit',
    elapsedSecs: 0.5,
    durationSecs: 2,
    targetOrbit: normalizeSpatialOrbitSpec(orbit),
  });
  const handedOffPose = preserving.update({ pose: settlingPose, deltaSecs: 1.5 });
  assertVectorApprox(handedOffPose.position, { x: 1, y: 0, z: 0 });
  assert.equal(preserving.getDiagnostics().pendingSettle, null);
  assert.equal(preserving.getFrameState().aim.kind, 'direction');
  preserving.update({ pose: handedOffPose, deltaSecs: 0.5 });
  assert.ok(Math.abs(preserving.getFrameState().pose.position.z) > 0.1);

  const replacing = createSpatialNavigationAutomation(space);
  replacing.lookAt(preservedAim);
  replacing.flyRoute(routeWithArrival(normalizeSpatialArrivalAction({ space,
    kind: 'orbit',
    orbit,
    settleSecs: 2,
    preserveAim: false,
  })));
  replacing.update({ pose: initialPose, deltaSecs: 3 });
  assert.equal(replacing.getFrameState().aim.kind, 'target');
  assertVectorApprox(replacing.getFrameState().aim.target, orbit.center);

  const dwelling = createSpatialNavigationAutomation(space);
  dwelling.flyRoute(routeWithArrival(normalizeSpatialArrivalAction({ space,
    kind: 'lockAt',
    aim: { space, kind: 'target', target: { x: 0, y: 0, z: -10 } },
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
  const navigation = createSpatialNavigationAutomation(space);
  navigation.orbit({ space,
    center: { x: 0, y: 0, z: 0 },
    radius: 1,
    angularSpeedRadPerSec: 0,
  });
  navigation.lockAt({ space, kind: 'target', target: { x: 0, y: 0, z: -10 } });
  const manualOrientation = createSpatialQuaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
  const manualPose = navigation.update({
    pose: { space, position: { x: 1, y: 0, z: 0 }, orientation: manualOrientation },
    deltaSecs: 0,
    manualLookActive: true,
  });
  assert.deepEqual(manualPose.orientation, manualOrientation);
  assert.equal(navigation.getDiagnostics().activeAim.manualLookActive, true);
  assert.equal(navigation.getFrameState().aim.kind, 'target');

  const automatedPose = navigation.update({
    pose: manualPose,
    deltaSecs: 0,
    manualLookActive: false,
  });
  assert.notDeepEqual(automatedPose.orientation, manualOrientation);
  assert.equal(navigation.getDiagnostics().activeAim.manualLookActive, false);

  navigation.cancelOrientation();
  const orientationHeld = navigation.update({
    pose: { space, ...automatedPose, orientation: manualOrientation },
    deltaSecs: 0.25,
  });
  assert.deepEqual(orientationHeld.orientation, manualOrientation);
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbit');
});

test('manual motion models implement direct, inertial, and thrust translation and retain scale', () => {
  assert.throws(() => createDirectSpatialMotionModel({ space, moveSpeedUnitsPerSec: '2' }), TypeError);
  assert.throws(() => createDirectSpatialMotionModel({ space, moveSpeedUnitsPerSec: 0 }), RangeError);
  assert.throws(() => createDirectSpatialMotionModel({ space, moveAxis: '' }), TypeError);
  assert.throws(() => createInertialSpatialMotionModel({ space, damping: -1 }), RangeError);
  assert.throws(() => createThrustSpatialMotionModel({ space, mass: 0 }), RangeError);

  const model = createDirectSpatialMotionModel({ space, moveSpeedUnitsPerSec: 2 });
  const controls = {
    getAxis(name) {
      return name === 'move' ? { x: 0, y: 1, magnitude: 1, active: true } : { x: 0, y: 0, magnitude: 0, active: false };
    },
  };
  const pose = model.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 1,
    scale: {
      worldUnitsPerUnit: 3,
    },
  });
  assert.equal(pose.position.z, 2);
  assert.deepEqual(model.getSnapshot().scale, {
    worldUnitsPerUnit: 3,
  });

  const inertial = createInertialSpatialMotionModel({ space,
    moveSpeedUnitsPerSec: 10,
    accelerationUnitsPerSec2: 2,
    damping: Math.log(2),
    maxSpeedUnitsPerSec: 3,
  });
  inertial.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 0.5,
  });
  assert.ok(Math.abs(inertial.getSnapshot().speedUnitsPerSec - 1) < 1e-9);
  inertial.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 2,
  });
  assert.ok(Math.abs(inertial.getSnapshot().speedUnitsPerSec - 3) < 1e-9);
  inertial.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls: { getAxis: () => ({ x: 0, y: 0, magnitude: 0, active: false }) },
    deltaSecs: 1,
  });
  assert.ok(Math.abs(inertial.getSnapshot().speedUnitsPerSec - 1.5) < 1e-9);

  const boostedInertial = createInertialSpatialMotionModel({ space,
    accelerationUnitsPerSec2: 10,
    boostMultiplier: 10,
    maxSpeedUnitsPerSec: 2,
  });
  boostedInertial.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls: {
      ...controls,
      getButton: (name) => ({ pressed: name === 'boost', value: name === 'boost' ? 1 : 0 }),
    },
    deltaSecs: 1,
  });
  assert.ok(Math.abs(boostedInertial.getSnapshot().speedUnitsPerSec - 2) < 1e-9);

  const thrust = createThrustSpatialMotionModel({ space,
    thrustUnitsPerSec2: 4,
    mass: 2,
    drag: 0,
    maxSpeedUnitsPerSec: 10,
  });
  thrust.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 0.5,
  });
  assert.ok(Math.abs(thrust.getSnapshot().speedUnitsPerSec - 1) < 1e-9);

  const draggedThrust = createThrustSpatialMotionModel({ space,
    thrustUnitsPerSec2: 2,
    mass: 1,
    drag: Math.log(2),
    maxSpeedUnitsPerSec: 10,
  });
  draggedThrust.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls,
    deltaSecs: 1,
  });
  const thrustBeforeIdle = draggedThrust.getSnapshot().speedUnitsPerSec;
  draggedThrust.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls: { getAxis: () => ({ x: 0, y: 0, magnitude: 0, active: false }) },
    deltaSecs: 1,
  });
  assert.ok(Math.abs(draggedThrust.getSnapshot().speedUnitsPerSec - thrustBeforeIdle / 2) < 1e-9);

  const rolling = createDirectSpatialMotionModel({ space, rollRateRadPerSec: Math.PI / 2 });
  const rolledPose = rolling.update({
    pose: { space, position: { x: 0, y: 0, z: 0 }, orientation: SPATIAL_IDENTITY_QUATERNION },
    controls: {
      getAxis: (name) => name === 'attitude'
        ? { x: 1, y: 0, magnitude: 1, active: true }
        : { x: 0, y: 0, magnitude: 0, active: false },
      getButton: (name) => ({ pressed: name === 'rollModifier', value: name === 'rollModifier' ? 1 : 0 }),
    },
    deltaSecs: 1,
  });
  assertVectorApprox(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, rolledPose.orientation), SPATIAL_LOCAL_FORWARD);
});

function frame(position) {
  return {
    pose: { space, position, orientation: SPATIAL_IDENTITY_QUATERNION },
    aim: null,
  };
}

function assertVectorApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `x expected ${expected.x}, got ${actual.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `y expected ${expected.y}, got ${actual.y}`);
  assert.ok(Math.abs(actual.z - expected.z) <= epsilon, `z expected ${expected.z}, got ${actual.z}`);
}

function assertTimingProfileInvariants(profile, expectedDistance, epsilon = 1e-7) {
  assert.ok(profile.phases.length > 0);
  assert.ok(Math.abs(profile.phases[0].startTimeSecs) <= epsilon);
  assert.ok(Math.abs(profile.phases[0].startDistance) <= epsilon);
  for (let index = 0; index < profile.phases.length; index += 1) {
    const phase = profile.phases[index];
    const durationSecs = phase.endTimeSecs - phase.startTimeSecs;
    const integratedDistance = (phase.startSpeedUnitsPerSec + phase.endSpeedUnitsPerSec) * 0.5 * durationSecs;
    assert.ok(
      Math.abs((phase.endDistance - phase.startDistance) - integratedDistance) <= epsilon,
      `phase ${index} distance must match its speed integral`,
    );
    if (index === 0) continue;
    const previous = profile.phases[index - 1];
    assert.ok(Math.abs(phase.startTimeSecs - previous.endTimeSecs) <= epsilon, `phase ${index} time must be contiguous`);
    assert.ok(Math.abs(phase.startDistance - previous.endDistance) <= epsilon, `phase ${index} distance must be contiguous`);
    assert.ok(Math.abs(phase.startSpeedUnitsPerSec - previous.endSpeedUnitsPerSec) <= epsilon, `phase ${index} speed must be contiguous`);
  }
  const finalPhase = profile.phases.at(-1);
  assert.ok(Math.abs(finalPhase.endTimeSecs - profile.durationSecs) <= epsilon);
  assert.ok(Math.abs(finalPhase.endDistance - expectedDistance) <= epsilon);
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
