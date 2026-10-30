import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPATIAL_IDENTITY_QUATERNION, SPATIAL_METERS_PER_AU, SPATIAL_METERS_PER_PARSEC,
  SPATIAL_Z_UP_TO_Y_UP, normalizeSpatialCoordinateSpace, normalizeSpatialPose, normalizeSpatialAimSpec,
  normalizeSpatialScaleProfile, normalizeSpatialOrbitSpec, resolveSpatialTarget,
  createSpatialQuaternionFromAxisAngle, applySpatialQuaternion,
  normalizeSpatialTransform, transformSpatialPoint, transformSpatialDisplacement,
  transformSpatialDirection, transformSpatialOrientation, transformSpatialPose,
  invertSpatialTransform, composeSpatialTransforms, interpolateSpatialDirections,
  buildSpatialPolylineRoute, buildSpatialOrbitalInsertRoute, evaluateSpatialRoute,
  evaluateSpatialOrbit, buildSpatialAimTrack, evaluateSpatialAimTrack,
  normalizeSpatialPathSpec, evaluateSpatialPath, buildSpatialViewTransitionPath,
  evaluateSpatialViewTransition, materializeSpatialPreloadHints,
  createDirectSpatialMotionModel, createInertialSpatialMotionModel,
  createSpatialNavigationAutomation, raDecToIcrsDirection, icrsToRaDec,
} from '../index.js';

const meters = Object.freeze({ frameId: 'test:inertial', metersPerUnit: 1 });
const au = Object.freeze({ frameId: meters.frameId, metersPerUnit: SPATIAL_METERS_PER_AU });
const parsecs = Object.freeze({ frameId: meters.frameId, metersPerUnit: SPATIAL_METERS_PER_PARSEC });
const other = Object.freeze({ frameId: 'test:another-origin', metersPerUnit: 1 });
const point = (x = 0, y = 0, z = 0) => ({ x, y, z });
const pose = (space, position = point()) => ({ space, position, orientation: SPATIAL_IDENTITY_QUATERNION });
function near(a, b, tolerance = 1e-9) {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b} by ${Math.abs(a - b)}`);
}
function vectorNear(a, b, tolerance = 1e-9) {
  for (const axis of ['x', 'y', 'z']) near(a[axis], b[axis], tolerance);
}

test('semantic operations require spaces and reject implicit frame or unit mixing', () => {
  assert.throws(() => normalizeSpatialCoordinateSpace(), TypeError);
  assert.throws(() => normalizeSpatialCoordinateSpace({ frameId: '', metersPerUnit: 1 }), TypeError);
  assert.throws(() => normalizeSpatialCoordinateSpace({ frameId: 'a', metersPerUnit: '1' }), TypeError);
  for (const metersPerUnit of [0, -1, Infinity, NaN]) {
    assert.throws(() => normalizeSpatialCoordinateSpace({ frameId: 'a', metersPerUnit }), RangeError);
  }
  assert.throws(() => normalizeSpatialPose({ position: point() }), TypeError);
  assert.throws(() => normalizeSpatialPose(42, meters), TypeError);
  assert.throws(() => normalizeSpatialPose([], meters), TypeError);
  assert.throws(() => normalizeSpatialScaleProfile([]), TypeError);
  assert.throws(() => normalizeSpatialAimSpec({ space: meters, kind: 'orientation' }), TypeError);
  assert.throws(() => normalizeSpatialAimSpec({ space: meters, kind: 'target' }), TypeError);
  assert.throws(() => normalizeSpatialScaleProfile({ metersPerUnit: 1 }), TypeError);
  assert.throws(() => normalizeSpatialCoordinateSpace(au, meters), RangeError);
  assert.throws(() => normalizeSpatialCoordinateSpace(other, meters), RangeError);
  assert.throws(() => normalizeSpatialOrbitSpec({ space: meters, center: point(), radius: 2,
    aim: { space: other, kind: 'target', target: point() } }), RangeError);
  assert.throws(() => buildSpatialOrbitalInsertRoute({ space: meters,
    from: { space: au, position: point(20) }, orbit: { center: point(), radius: 2 } }), RangeError);
  assert.throws(() => normalizeSpatialPathSpec({ space: meters, positionKeys: [
    { id: 'wrong', space: other, timeSecs: 0, position: point() },
  ] }), RangeError);
});

test('bookmark resolvers cannot silently switch coordinate spaces', async () => {
  const input = { space: meters, kind: 'bookmark', id: 'home' };
  assert.throws(() => resolveSpatialTarget(input, {
    resolveBookmark: () => ({ space: other, kind: 'position', target: point() }),
  }), RangeError);
  await assert.rejects(resolveSpatialTarget(input, {
    resolveBookmark: async () => ({ space: au, kind: 'position', target: point() }),
  }), RangeError);
});

test('transforms distinguish anchored points, displacements, unit directions and orientations', () => {
  const transform = { from: meters, to: { ...other, metersPerUnit: 2 },
    sourceOrigin: point(10, 20, 30), targetOrigin: point(4, 5, 6), rotation: SPATIAL_Z_UP_TO_Y_UP };
  vectorNear(transformSpatialPoint(transform, point(12, 24, 36)), point(5, 8, 4));
  vectorNear(transformSpatialDisplacement(transform, point(2, 4, 6)), point(1, 3, -2));
  vectorNear(transformSpatialDirection(transform, point(0, 10, 0)), point(0, 0, -1));
  vectorNear(applySpatialQuaternion(point(0, 1, 0),
    transformSpatialOrientation(transform, SPATIAL_IDENTITY_QUATERNION)), point(0, 0, -1));
  const transformed = transformSpatialPose(transform, pose(meters, point(12, 24, 36)));
  assert.deepEqual(transformed.space, transform.to);
  vectorNear(transformed.position, point(5, 8, 4));
  assert.throws(() => transformSpatialPose(transform, pose(other)), RangeError);
  assert.throws(() => transformSpatialDirection(transform, point()), RangeError);
});

test('transform inversion and composition preserve positions and orientation', () => {
  const first = { from: meters, to: au, sourceOrigin: point(12, 3, -4),
    targetOrigin: point(2, 4, 6), rotation: createSpatialQuaternionFromAxisAngle(point(0, 0, 1), 0.7) };
  const second = { from: au, to: { ...other, metersPerUnit: 0.25 },
    sourceOrigin: point(2, 4, 6), rotation: SPATIAL_Z_UP_TO_Y_UP };
  const value = point(230, -90, 45);
  vectorNear(transformSpatialPoint(invertSpatialTransform(first), transformSpatialPoint(first, value)), value, 0.001);
  vectorNear(transformSpatialPoint(composeSpatialTransforms(first, second), value),
    transformSpatialPoint(second, transformSpatialPoint(first, value)), 0.001);
  assert.throws(() => composeSpatialTransforms(first, { from: meters, to: other }), RangeError);
  const normalized = normalizeSpatialTransform(first);
  normalized.sourceOrigin.x = -100;
  assert.equal(first.sourceOrigin.x, 12);
});

test('rebase Neptune-distance origins before conversion and preserve tracked local offsets', () => {
  const origin = point(4.5e12, -2.1e12, 7.2e11);
  const value = point(origin.x + 12.5, origin.y - 3.25, origin.z + 8);
  const transform = { from: meters, to: parsecs, sourceOrigin: origin, rotation: SPATIAL_Z_UP_TO_Y_UP };
  const relativePc = transformSpatialPoint(transform, value);
  vectorNear(transformSpatialDisplacement({ from: parsecs, to: meters }, relativePc), point(12.5, 8, 3.25), 1e-12);
  vectorNear(transformSpatialPoint(invertSpatialTransform(transform), relativePc), value, 0.001);
  const roomOffsetPc = transformSpatialDisplacement({ from: meters, to: parsecs }, point(0.001));
  near(roomOffsetPc.x * SPATIAL_METERS_PER_PARSEC, 0.001, 1e-18);
});

test('route geometry, physical timing and orbital insertion are equivalent in metres, AU and parsecs', () => {
  for (const space of [meters, au, parsecs]) {
    const u = space.metersPerUnit;
    const route = buildSpatialPolylineRoute({ space, points: [point(), point(1000 / u)],
      travel: { kind: 'polyline', timing: { kind: 'trapezoid', accelerationUnitsPerSec2: 10 / u,
        decelerationUnitsPerSec2: 10 / u, cruiseSpeedUnitsPerSec: 100 / u } } });
    near(route.timing.durationSecs, 20, 1e-10);
    near(evaluateSpatialRoute(route, 10).position.x * u, 500, 1e-8);
    near(evaluateSpatialRoute(route, 20).position.x * u, 1000, 1e-8);
    assert.deepEqual(route.space, space);
    const insertion = buildSpatialOrbitalInsertRoute({ space, from: { position: point(1000 / u) },
      orbit: { center: point(), radius: 200 / u, angularSpeedRadPerSec: 0.2 },
      travel: { kind: 'orbitalInsert', timing: { kind: 'duration', durationSecs: 30 } } });
    near(insertion.arrival.speedUnitsPerSec * u, 40, 1e-8);
    const handoff = evaluateSpatialOrbit(insertion.arrival.orbit, 0);
    vectorNear(transformSpatialDisplacement({ from: space, to: meters }, handoff.position),
      transformSpatialDisplacement({ from: space, to: meters }, insertion.arrival.position), 1e-8);
  }
});

test('reusable timing profiles reject reuse in a different physical unit context', () => {
  const route = buildSpatialPolylineRoute({ space: meters, points: [point(), point(10)],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 2 } } });
  assert.throws(() => buildSpatialPolylineRoute({ space: au, points: [point(), point(10)],
    travel: { kind: 'polyline', timing: route.timing } }), RangeError);
});

test('paths preserve physical samples and tiny positive key intervals', () => {
  for (const space of [meters, au, parsecs]) {
    const path = { space, positionKeys: [
      { id: 'a', timeSecs: 0, position: point() },
      { id: 'b', timeSecs: 1e-12, position: point(10 / space.metersPerUnit) },
      { id: 'c', timeSecs: 2e-12, position: point(30 / space.metersPerUnit) },
    ] };
    near(evaluateSpatialPath(path, 1.5e-12).pose.position.x * space.metersPerUnit, 20, 1e-10);
  }
  const transition = buildSpatialViewTransitionPath({
    from: { pose: pose(meters), aim: null }, to: { pose: pose(meters, point(2)), aim: null }, durationSecs: 1e-12,
  });
  const half = evaluateSpatialViewTransition(transition, 5e-13);
  assert.equal(half.complete, false);
  near(half.pose.position.x, 1);
  assert.equal(evaluateSpatialViewTransition(transition, 1e-12).complete, true);
});

test('aim evaluation and preload samples reject mixed-space position sources', () => {
  const track = buildSpatialAimTrack([
    { id: 'aim', timeSecs: 0, aim: { kind: 'target', target: point(10) } },
  ], { space: meters });
  const positionSample = evaluateSpatialPath({ space: other,
    positionKeys: [{ id: 'p', timeSecs: 0, position: point() }] }, 0);
  assert.throws(() => evaluateSpatialAimTrack(track, 0, { positionSample }), RangeError);
  const local = evaluateSpatialPath({ space: meters,
    positionKeys: [{ id: 'p', timeSecs: 0, position: point() }] }, 0);
  assert.throws(() => materializeSpatialPreloadHints([local, positionSample], { pathRadius: 2 }), RangeError);
});

test('motion and navigation keep physical state independent from presentation scale', () => {
  const controls = { getAxis: name => ({ x: name === 'move' ? 1 : 0, y: 0, active: name === 'move', magnitude: 1 }) };
  for (const space of [meters, au, parsecs]) {
    const speed = 10 / space.metersPerUnit;
    const model = createDirectSpatialMotionModel({ space, moveSpeedUnitsPerSec: speed });
    for (const worldUnitsPerUnit of [1e-12, 1, 1e12]) {
      const result = model.update({ pose: pose(space), controls, deltaSecs: 0.5, scale: { worldUnitsPerUnit } });
      near(result.position.x * space.metersPerUnit, 5);
      assert.deepEqual(model.getSnapshot().space, space);
    }
    const inertia = createInertialSpatialMotionModel({ space, accelerationUnitsPerSec2: speed,
      maxSpeedUnitsPerSec: speed, moveSpeedUnitsPerSec: speed });
    near(inertia.update({ pose: pose(space), controls, deltaSecs: 0.5 }).position.x * space.metersPerUnit, 2.5);
    assert.throws(() => model.update({ pose: pose(other), controls, deltaSecs: 1 }), RangeError);
    const navigation = createSpatialNavigationAutomation(space);
    assert.throws(() => navigation.orbit({ space: other, center: point(), radius: 2 }), RangeError);
    assert.throws(() => navigation.update({ pose: pose(other), deltaSecs: 1 }), RangeError);
  }
  assert.throws(() => normalizeSpatialScaleProfile({ metersPerNavigationUnit: 1 }), TypeError);
});

test('direction interpolation preserves endpoints and explicit antipodal arc choices', () => {
  vectorNear(interpolateSpatialDirections(point(1), point(-1), 0.5, { antipodalTangent: point(0, 1) }), point(0, 1));
  vectorNear(interpolateSpatialDirections(point(1), point(-1), 1), point(-1));
  vectorNear(interpolateSpatialDirections(point(1), point(-1, 1e-5), 1),
    transformSpatialDirection({ from: meters, to: meters }, point(-1, 1e-5)));
  assert.throws(() => interpolateSpatialDirections(point(), point(1), 0.5), RangeError);
});

test('celestial angles wrap at the seam and remain finite at the poles', () => {
  vectorNear(raDecToIcrsDirection({ raDeg: -90, decDeg: 0 }), point(0, -1));
  vectorNear(raDecToIcrsDirection({ raHours: 30, decDeg: 90 }), point(0, 0, 1));
  assert.equal(icrsToRaDec(point()), null);
  assert.throws(() => raDecToIcrsDirection({ raDeg: 0, raHours: 0, decDeg: 0 }), TypeError);
  assert.throws(() => raDecToIcrsDirection({ raDeg: 0, decDeg: 91 }), RangeError);
});

test('navigation honors short positive arrival settle intervals', () => {
  const navigation = createSpatialNavigationAutomation(meters);
  navigation.flyRoute(buildSpatialPolylineRoute({ space: meters, points: [point(), point(2)],
    travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1 } },
    arrivalAction: { kind: 'orbit', settleSecs: 1e-12,
      orbit: { center: point(), radius: 2, angularSpeedRadPerSec: 1 } },
  }));
  const arrived = navigation.update({ pose: pose(meters), deltaSecs: 1 });
  assert.ok(navigation.getDiagnostics().pendingSettle);
  navigation.update({ pose: arrived, deltaSecs: 5e-13 });
  assert.ok(navigation.getDiagnostics().pendingSettle);
  navigation.update({ pose: arrived, deltaSecs: 5e-13 });
  assert.equal(navigation.getDiagnostics().pendingSettle, null);
  assert.equal(navigation.getDiagnostics().activeMovement.kind, 'orbit');
});
