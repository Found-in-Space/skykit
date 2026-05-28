import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDENTITY_QUATERNION,
  LOCAL_FORWARD,
  LOCAL_UP,
  applyQuaternion,
  buildSpatialPolylineRoute,
  createRaDecLookAt,
  createSpatialOrientationTrack,
  createSpatialPoseTransition,
  createSpatialPositionTrack,
  createSpatialSmoothPath,
  computeSpatialLookAtOrientation,
  createDirectSpatialMotionModel,
  createFlyToSpatialMotionModel,
  createInertialSpatialMotionModel,
  createOrbitTransferRoute,
  createSpatialNavigationAutomation,
  createThrustSpatialMotionModel,
  deriveSpatialOrbitAngle,
  evaluateSpatialOrientationTrack,
  evaluateSpatialPoseTransition,
  evaluateSpatialPositionTrack,
  materializeSpatialPathSamples,
  materializeSpatialPreloadHints,
  icrsToRaDec,
  parseDeclination,
  parseRightAscension,
  parseSpatialLookAtText,
  projectEquirectangular,
  raDecDistanceToIcrs,
  raDecToIcrsDirection,
  resolveSpatialLookAt,
  resolveSpatialTarget,
  sampleSpatialPolylineRoutePosition,
} from '../index.js';

test('coordinates convert RA/Dec/distance to ICRS and back', () => {
  assert.deepEqual(raDecToIcrsDirection({ raDeg: 0, decDeg: 0 }), { x: 1, y: 0, z: 0 });
  const target = raDecDistanceToIcrs({ raHours: 6, decDeg: 0, distancePc: 10 });
  assert.ok(target);
  assert.ok(Math.abs(target.x) < 1e-12);
  assert.ok(Math.abs(target.y - 10) < 1e-12);
  const offsetObserverTarget = raDecDistanceToIcrs({
    raHours: 6,
    decDeg: 0,
    distancePc: 10,
    observerPc: { x: 100, y: 200, z: 300 },
  });
  assert.deepEqual(offsetObserverTarget, target);
  assert.deepEqual(icrsToRaDec({ x: 0, y: 1, z: 0 }), {
    raDeg: 90,
    raHours: 6,
    decDeg: 0,
  });
  assert.deepEqual(projectEquirectangular({ raDeg: 180, decDeg: 0, width: 360, height: 180 }), {
    x: 180,
    y: 90,
  });
});

test('parseSpatialLookAtText accepts RA/Dec text, vectors, and JSON look specs', () => {
  assert.deepEqual(parseSpatialLookAtText('ra=4.496h, dec=16.948'), {
    raHours: 4.496,
    decDeg: 16.948,
  });
  assert.deepEqual(parseSpatialLookAtText('67.447, 16.948'), {
    raDeg: 67.447,
    decDeg: 16.948,
  });
  assert.deepEqual(parseSpatialLookAtText('17.574,42.316,13.963'), {
    targetPc: { x: 17.574, y: 42.316, z: 13.963 },
  });
  const orionNebula = parseSpatialLookAtText('05h 35m 17.3s, -05d 23m 28s, 414pc');
  assert.ok(orionNebula && 'raHours' in orionNebula);
  assertApprox(orionNebula.raHours, 5 + 35 / 60 + 17.3 / 3600);
  assertApprox(orionNebula.decDeg, -(5 + 23 / 60 + 28 / 3600));
  assert.equal(orionNebula.distancePc, 414);
  assert.deepEqual(parseSpatialLookAtText('{"raHours":4.496,"decDeg":16.948,"positionAngleDeg":12}'), {
    raHours: 4.496,
    decDeg: 16.948,
    positionAngleDeg: 12,
  });
  assert.equal(parseSpatialLookAtText('not coordinates'), null);
});

test('RA/Dec helpers accept sexagesimal and Unicode coordinate text', () => {
  const alnilamRaHours = 5 + 36 / 60 + 12.81 / 3600;
  const alnilamDecDeg = -(1 + 12 / 60 + 6.9 / 3600);

  assert.deepEqual(parseRightAscension('05h 36m 12.81s'), {
    raHours: alnilamRaHours,
  });
  assert.deepEqual(parseRightAscension('84° 03′ 12.216″'), {
    raDeg: 84 + 3 / 60 + 12.216 / 3600,
  });
  assertApprox(parseDeclination('−01° 12′ 06.9″'), alnilamDecDeg);
  assertApprox(parseDeclination('-01:12:06.9'), alnilamDecDeg);

  const compact = parseSpatialLookAtText('05:36:12.81, −01:12:06.9');
  assert.ok(compact && 'raHours' in compact);
  assertApprox(compact.raHours, alnilamRaHours);
  assertApprox(compact.decDeg, alnilamDecDeg);

  const named = parseSpatialLookAtText('Right ascension 05h 36m 12.81s, Declination −01° 12′ 06.9″');
  assert.ok(named && 'raHours' in named);
  assertApprox(named.raHours, alnilamRaHours);
  assertApprox(named.decDeg, alnilamDecDeg);

  const catalogText = parseSpatialLookAtText('Right ascension\t05h 36m 12.81s\nDeclination\t−01° 12′ 06.9″');
  assert.ok(catalogText && 'raHours' in catalogText);
  assertApprox(catalogText.raHours, alnilamRaHours);
  assertApprox(catalogText.decDeg, alnilamDecDeg);

  const helper = createRaDecLookAt('05h36m12.81s', '−01°12′06.9″', { positionAngleDeg: 12 });
  assert.ok(helper && 'raHours' in helper);
  assertApprox(helper.raHours, alnilamRaHours);
  assertApprox(helper.decDeg, alnilamDecDeg);
  assert.equal(helper.positionAngleDeg, 12);
});

test('resolveSpatialTarget handles vectors, RA/Dec, and bookmark resolvers', async () => {
  assert.deepEqual(resolveSpatialTarget([1, 2, 3]), { x: 1, y: 2, z: 3 });
  assert.deepEqual(resolveSpatialTarget({ targetPc: { x: 4, y: 5, z: 6 } }), { x: 4, y: 5, z: 6 });
  assert.deepEqual(resolveSpatialTarget({ raDeg: 0, decDeg: 0, distancePc: 2 }), { x: 2, y: 0, z: 0 });
  assert.deepEqual(
    resolveSpatialTarget(
      { raDeg: 0, decDeg: 0, distancePc: 2 },
      { observerPc: { x: 10, y: 20, z: 30 } },
    ),
    { x: 2, y: 0, z: 0 },
  );
  const bookmark = await resolveSpatialTarget({ bookmarkId: 'pleiades' }, {
    resolveBookmark: (id) => id === 'pleiades'
      ? { raDeg: 0, decDeg: 90, distancePc: 4 }
      : null,
  });
  assert.ok(bookmark);
  assert.ok(Math.abs(bookmark.z - 4) < 1e-12);
});

test('resolveSpatialLookAt derives target, RA/Dec, position angle, and star looks', async () => {
  const targetLook = resolveSpatialLookAt({
    targetPc: { x: 10, y: 0, z: 0 },
    positionAngleDeg: 0,
  });
  assert.deepEqual(targetLook.targetPc, { x: 10, y: 0, z: 0 });
  assert.ok(targetLook.orientationIcrs);
  assertVectorApprox(applyQuaternion(LOCAL_FORWARD, targetLook.orientationIcrs), { x: 1, y: 0, z: 0 });
  assertVectorApprox(applyQuaternion(LOCAL_UP, targetLook.orientationIcrs), { x: 0, y: 0, z: 1 });

  const rotated = resolveSpatialLookAt({ raDeg: 0, decDeg: 0, positionAngleDeg: 90 });
  assert.ok(rotated.orientationIcrs);
  assert.equal(rotated.targetPc, null);
  assertVectorApprox(applyQuaternion(LOCAL_UP, rotated.orientationIcrs), { x: 0, y: 1, z: 0 });

  const fixedTargetFromSun = resolveSpatialLookAt({ raDeg: 0, decDeg: 0, distancePc: 10 });
  const fixedTargetFromOffset = resolveSpatialLookAt(
    { raDeg: 0, decDeg: 0, distancePc: 10 },
    { observerPc: { x: 1, y: 2, z: 3 } },
  );
  assert.deepEqual(fixedTargetFromSun.targetPc, { x: 10, y: 0, z: 0 });
  assert.deepEqual(fixedTargetFromOffset.targetPc, fixedTargetFromSun.targetPc);
  assert.ok(fixedTargetFromOffset.orientationIcrs);
  assertVectorApprox(
    applyQuaternion(LOCAL_FORWARD, fixedTargetFromOffset.orientationIcrs),
    normalizeVector({ x: 9, y: -2, z: -3 }),
  );

  const star = await resolveSpatialLookAt({ star: 'hyades', positionAngleDeg: 0 }, {
    resolveStar: (id) => id === 'hyades' ? { targetPc: { x: 4, y: 5, z: 6 } } : null,
  });
  assert.equal(star.lookAt.star, 'hyades');
  assert.deepEqual(star.targetPc, { x: 4, y: 5, z: 6 });
  assert.ok(star.orientationIcrs);

  const coordinateString = resolveSpatialLookAt('ra=05h 36m 12.81s, dec=−01° 12′ 06.9″');
  assert.ok(coordinateString.lookAt && 'raHours' in coordinateString.lookAt);
  assert.ok(coordinateString.orientationIcrs);
  assert.equal(coordinateString.unresolved, null);
});

test('polyline route builds and samples deterministic route positions', () => {
  const route = buildSpatialPolylineRoute([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -10 },
    { x: 10, y: 0, z: -10 },
  ]);
  assert.equal(route.totalLength, 20);
  assert.deepEqual(sampleSpatialPolylineRoutePosition(route, 5), { x: 0, y: 0, z: -5 });
  assert.deepEqual(sampleSpatialPolylineRoutePosition(route, 15), { x: 5, y: 0, z: -10 });
  assert.deepEqual(sampleSpatialPolylineRoutePosition(route, -100), { x: 0, y: 0, z: 0 });
  assert.deepEqual(sampleSpatialPolylineRoutePosition(route, 100), { x: 10, y: 0, z: -10 });
});

test('timed Catmull-Rom position tracks sample by arc length and expose velocity', () => {
  const track = createSpatialPositionTrack([
    { id: 'a', timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
    { id: 'b', timeSecs: 5, positionPc: { x: 0, y: 0, z: -10 } },
    { id: 'c', timeSecs: 10, positionPc: { x: 10, y: 0, z: -10 } },
  ]);
  const mid = evaluateSpatialPositionTrack(track, 2.5);
  assert.ok(mid.position.z < -4 && mid.position.z > -6);
  assert.ok(mid.speed > 1.5);
  assert.ok(mid.velocity.z < 0);
  assert.equal(track.segments.length, 2);
});

test('orientation tracks evaluate direction, target, and quaternion keys', () => {
  const track = createSpatialOrientationTrack([
    { id: 'dir', timeSecs: 0, kind: 'direction', forward: { x: 0, y: 0, z: -1 } },
    { id: 'target', timeSecs: 1, kind: 'target', targetPc: { x: 10, y: 0, z: 0 } },
    { id: 'quat', timeSecs: 2, kind: 'quaternion', orientationIcrs: IDENTITY_QUATERNION },
  ]);
  const target = evaluateSpatialOrientationTrack(track, 1, { position: { x: 0, y: 0, z: 0 } });
  assert.ok(target.forward.x > 0.99);
  const identity = evaluateSpatialOrientationTrack(track, 2, { position: { x: 0, y: 0, z: 0 } });
  assert.ok(Math.abs(identity.orientation.w - 1) < 1e-12);
});

test('smooth paths materialize samples and preload hints', () => {
  const path = createSpatialSmoothPath({
    durationSecs: 4,
    positionWaypoints: [
      { timeSecs: 0, positionPc: { x: 0, y: 0, z: 0 } },
      { timeSecs: 4, positionPc: { x: 0, y: 0, z: -8 } },
    ],
    orientationWaypoints: [
      { timeSecs: 0, kind: 'direction', forward: { x: 0, y: 0, z: -1 } },
      { timeSecs: 4, kind: 'target', targetPc: { x: 8, y: 0, z: -8 } },
    ],
  });
  const samples = materializeSpatialPathSamples(path, { stepSecs: 2 });
  assert.equal(samples.length, 3);
  assert.deepEqual(samples[0].pose.position, { x: 0, y: 0, z: 0 });
  assert.ok(samples[1].speed > 0);
  const hints = materializeSpatialPreloadHints(samples, {
    pathRadiusPc: 2,
    sphereRadiusPc: 1,
    lookaheadSecs: 3,
  });
  assert.equal(hints.some((hint) => hint.kind === 'path-volume'), true);
  assert.equal(hints.some((hint) => hint.kind === 'sphere-volume'), true);
  assert.equal(hints.some((hint) => hint.kind === 'view-lookahead'), true);
});

test('pose transitions can move and rotate over independent durations', () => {
  const transition = createSpatialPoseTransition({
    from: {
      position: { x: 0, y: 0, z: 0 },
      orientation: IDENTITY_QUATERNION,
    },
    to: {
      position: { x: 10, y: 0, z: 0 },
      orientation: computeSpatialLookAtOrientation({
        position: { x: 0, y: 0, z: 0 },
        target: { x: 10, y: 0, z: 0 },
      }),
    },
    movement: { durationSecs: 5 },
    orientation: { durationSecs: 1 },
  });
  const oneSecond = evaluateSpatialPoseTransition(transition, 1);
  assert.ok(oneSecond.pose.position.x > 0 && oneSecond.pose.position.x < 2);
  assert.equal(oneSecond.orientationComplete, true);
  assert.equal(oneSecond.movementComplete, false);
  const final = evaluateSpatialPoseTransition(transition, 5);
  assert.deepEqual(final.pose.position, { x: 10, y: 0, z: 0 });
  assert.equal(final.complete, true);
});

test('direct, inertial, thrust, and fly-to motion models update poses', () => {
  const controls = {
    getAxis(name) {
      if (name === 'move') return { x: 0, y: -1, magnitude: 1, active: true };
      return { x: 0, y: 0, magnitude: 0, active: false };
    },
    isPressed() {
      return false;
    },
  };
  const pose = { position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUATERNION };

  const direct = createDirectSpatialMotionModel({ moveSpeed: 2 });
  assert.ok(direct.update({ pose, controls, deltaSeconds: 1 }).position.z < 0);

  const inertial = createInertialSpatialMotionModel({ acceleration: 4, damping: 2, maxSpeed: 10 });
  assert.ok(inertial.update({ pose, controls, deltaSeconds: 1 }).position.z < 0);

  const thrust = createThrustSpatialMotionModel({ thrust: 8, mass: 2, drag: 0.1, maxSpeed: 10 });
  assert.ok(thrust.update({ pose, controls, deltaSeconds: 1 }).position.z < 0);

  const fly = createFlyToSpatialMotionModel({ acceleration: 4, deceleration: 6, maxSpeed: 10 });
  fly.flyTo({ x: 10, y: 0, z: 0 });
  const first = fly.update({ pose, deltaSeconds: 0.25 });
  const second = fly.update({ pose: first, deltaSeconds: 0.25 });
  assert.ok(first.position.x > 0);
  assert.ok(second.position.x > first.position.x);

  const timedRoute = createSpatialNavigationAutomation();
  timedRoute.flyPolyline([
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ], { durationSecs: 1, arrivalThreshold: 9 });
  const halfway = timedRoute.update({ pose, deltaSeconds: 0.5 });
  assert.equal(timedRoute.getSnapshot().activeAutomation, 'flyPolyline');
  assert.ok(halfway.position.x > 0);
  assert.ok(halfway.position.x < 10);
  const finished = timedRoute.update({ pose: halfway, deltaSeconds: 0.5 });
  assert.equal(timedRoute.getSnapshot().activeAutomation, null);
  assert.equal(finished.position.x, 10);

  const overshootRoute = createSpatialNavigationAutomation();
  overshootRoute.flyPolyline([
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ], {
    durationSecs: 1,
    arrivalAction: {
      type: 'orbit',
      center: { x: 0, y: 0, z: 0 },
      radius: 10,
      angularSpeedRadPerSec: 1,
      normal: { x: 0, y: 0, z: 1 },
    },
  });
  const overshot = overshootRoute.update({ pose, deltaSeconds: 1.1 });
  assert.equal(overshootRoute.getSnapshot().activeAutomation, 'orbit');
  assert.ok(Math.abs(distance(overshot.position, { x: 0, y: 0, z: 0 }) - 10) < 1e-9);
  assert.ok(overshot.position.y < -0.5);
});

test('spatial navigation automation smooths route, orbit, insert, and look-at', () => {
  const automation = createSpatialNavigationAutomation({ speed: 10, acceleration: 4, deceleration: 5 });
  let pose = { position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUATERNION };
  automation.flyTo({ x: 10, y: 0, z: 0 });
  pose = automation.update({ pose, deltaSeconds: 0.25 });
  assert.ok(pose.position.x > 0);
  assert.ok(automation.getSnapshot().speedNavigationUnitsPerSecond > 0);

  automation.lookAt({ x: 10, y: 0, z: -10 }, { blend: 1 });
  pose = automation.update({ pose, deltaSeconds: 1 });
  assert.notDeepEqual(pose.orientation, IDENTITY_QUATERNION);

  automation.orbit({ x: 10, y: 0, z: 0 }, { radius: 5, angularSpeed: 1 });
  pose = automation.update({ pose, deltaSeconds: 1 });
  assert.ok(Math.abs(distance(pose.position, { x: 10, y: 0, z: 0 }) - 5) < 1e-9);

  const insert = createSpatialNavigationAutomation({ speed: 20, acceleration: 20, deceleration: 20 });
  let insertPose = { position: { x: 40, y: -20, z: 5 }, orientation: IDENTITY_QUATERNION };
  let inserted = false;
  insert.orbitalInsert({ x: 5, y: 3, z: -2 }, {
    radius: 6,
    angularSpeed: 0.3,
    durationSecs: 2,
    orbitNormal: { x: 0, y: 1, z: 0 },
    onInserted() {
      inserted = true;
    },
  });
  for (let index = 0; index < 150; index += 1) {
    insertPose = insert.update({ pose: insertPose, deltaSeconds: 1 / 60 });
  }
  const insertSnapshot = insert.getSnapshot();
  assert.equal(inserted, true);
  assert.equal(insertSnapshot.activeAutomation, 'orbit');
  assert.deepEqual(insertSnapshot.movementAutomation?.normal, { x: 0, y: 1, z: 0 });
  assert.ok(Math.abs(distance(insertPose.position, { x: 5, y: 3, z: -2 }) - 6) < 1e-9);
});

test('orbit angle and orbit transfer derive smooth same-center and insertion routes', () => {
  assert.equal(deriveSpatialOrbitAngle({
    center: { x: 0, y: 0, z: 0 },
    position: { x: 1, y: 0, z: 0 },
  }), 0);

  const sameCenter = createOrbitTransferRoute({
    start: { x: 8, y: 0, z: 0 },
    sourceOrbit: {
      center: { x: 0, y: 0, z: 0 },
      radius: 8,
      angularSpeedRadPerSec: 0.26,
      normal: { x: 0, y: 0, z: 1 },
    },
    destinationOrbit: {
      center: { x: 0, y: 0, z: 0 },
      radius: 175,
      angularSpeedRadPerSec: 0.06,
      normal: { x: 0, y: 0, z: 1 },
    },
    durationSecs: 5,
    sampleStepSecs: 1 / 60,
  });
  assert.ok(sameCenter);
  assert.ok(sameCenter.points.length > 10);
  assert.deepEqual(sameCenter.points[0], { x: 8, y: 0, z: 0 });
  assert.ok(Math.abs(distance(sameCenter.points.at(-1), { x: 0, y: 0, z: 0 }) - 175) < 1e-9);
  assert.equal(sameCenter.arrivalAction.angularSpeedRadPerSec, 0.06);
  assert.deepEqual(sameCenter.arrivalAction.normal, { x: 0, y: 0, z: 1 });
  assert.equal(sameCenter.departureSpeed, 8 * 0.26);
  assert.equal(sameCenter.arrivalSpeed, 175 * 0.06);
  assert.ok(finalSegmentOrbitTangentAngle(sameCenter.points, sameCenter.arrivalAction) < 0.05);

  const inserted = createOrbitTransferRoute({
    start: { x: 175, y: 0, z: 0 },
    sourceOrbit: {
      center: { x: 0, y: 0, z: 0 },
      radius: 175,
      angularSpeedRadPerSec: 0.06,
      normal: { x: 0, y: 0, z: 1 },
    },
    destinationOrbit: {
      center: { x: 17.574, y: 42.316, z: 13.963 },
      radius: 15,
      angularSpeedRadPerSec: 0.2,
      normal: { x: 0, y: 0, z: 1 },
    },
    durationSecs: 5,
    sampleStepSecs: 1 / 60,
  });
  assert.ok(inserted);
  assert.ok(inserted.points.length > 10);
  assert.deepEqual(inserted.points[0], { x: 175, y: 0, z: 0 });
  assert.ok(Math.abs(distance(inserted.points.at(-1), inserted.arrivalAction.center) - 15) < 1e-9);
  assert.ok(Math.abs(orbitPlaneOffset(inserted.points.at(-1), inserted.arrivalAction)) < 1e-9);
  assert.ok(finalSegmentOrbitTangentAngle(inserted.points, inserted.arrivalAction) < 0.05);
  assert.ok(minDistanceToCenter(inserted.points, inserted.arrivalAction.center) >= inserted.arrivalAction.radius * 0.95);
  assert.ok(pathTurnCost(inserted.points) < pathTurnCost([
    inserted.points[0],
    inserted.arrivalAction.center,
    inserted.points.at(-1),
  ]));
  assert.equal(inserted.departureSpeed, 175 * 0.06);
  assert.equal(inserted.arrivalSpeed, 15 * 0.2);

  const inferred = createOrbitTransferRoute({
    start: { x: 175, y: 0, z: 0 },
    sourceOrbit: {
      center: { x: 0, y: 0, z: 0 },
      radius: 175,
      angularSpeedRadPerSec: 0.06,
      normal: { x: 0, y: 0, z: 1 },
    },
    destinationOrbit: {
      center: { x: 17.574, y: 42.316, z: 13.963 },
      radius: 15,
      angularSpeedRadPerSec: -0.2,
    },
    durationSecs: 5,
    sampleStepSecs: 1 / 60,
  });
  assert.ok(inferred);
  assert.ok(Math.abs(inferred.arrivalAction.normal.z - 1) > 0.001);
  assert.equal(inferred.arrivalAction.angularSpeedRadPerSec, 0.2);
  assert.ok(finalSegmentOrbitTangentAngle(inferred.points, inferred.arrivalAction) < 0.05);
  assert.ok(dot(
    finalOrbitTangent(inferred.points, inferred.arrivalAction),
    normalizeVector({ x: 0, y: -1, z: 0 }),
  ) > 0.95);

  const automation = createSpatialNavigationAutomation();
  automation.flyPolyline(inserted.points, {
    durationSecs: 5,
    currentSpeed: inserted.departureSpeed,
    arrivalSpeed: inserted.arrivalSpeed,
    arrivalAction: inserted.arrivalAction,
  });
  let pose = { position: { x: 175, y: 0, z: 0 }, orientation: IDENTITY_QUATERNION };
  let previous = pose.position;
  const steps = [];
  for (let index = 0; index < 180; index += 1) {
    pose = automation.update({ pose, deltaSeconds: 1 / 30 });
    steps.push({
      active: automation.getSnapshot().activeAutomation,
      distance: distance(previous, pose.position),
      planeOffset: orbitPlaneOffset(pose.position, inserted.arrivalAction),
    });
    previous = pose.position;
  }
  const handoffIndex = steps.findIndex((step) => step.active === 'orbit');
  assert.ok(handoffIndex > 0);
  assert.ok(Math.abs(steps[handoffIndex].planeOffset) < 1e-9);
  assert.ok(steps[handoffIndex - 1].distance > inserted.arrivalSpeed / 30 * 0.4);
  assert.ok(Math.abs(steps[handoffIndex + 1].distance - inserted.arrivalSpeed / 30) < 0.02);
});

test('computeSpatialLookAtOrientation points local forward at the target', () => {
  const orientation = computeSpatialLookAtOrientation({
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: -1 },
  });
  assert.ok(orientation);
  assert.ok(Math.abs(orientation.x - IDENTITY_QUATERNION.x) < 1e-12);
  assert.ok(Math.abs(orientation.y - IDENTITY_QUATERNION.y) < 1e-12);
  assert.ok(Math.abs(orientation.z - IDENTITY_QUATERNION.z) < 1e-12);
  assert.ok(Math.abs(orientation.w - IDENTITY_QUATERNION.w) < 1e-12);
});

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function orbitPlaneOffset(point, orbit) {
  return (point.x - orbit.center.x) * orbit.normal.x
    + (point.y - orbit.center.y) * orbit.normal.y
    + (point.z - orbit.center.z) * orbit.normal.z;
}

function finalSegmentOrbitTangentAngle(points, orbit) {
  const end = points.at(-1);
  const previous = points.at(-2);
  return vectorAngle(normalizeVector(subtract(end, previous)), finalOrbitTangent(points, orbit));
}

function finalOrbitTangent(points, orbit) {
  const end = points.at(-1);
  const radial = normalizeVector(subtract(end, orbit.center));
  const tangent = normalizeVector(cross(radial, orbit.normal));
  return orbit.angularSpeedRadPerSec < 0
    ? { x: -tangent.x, y: -tangent.y, z: -tangent.z }
    : tangent;
}

function minDistanceToCenter(points, center) {
  return points.reduce((min, point) => Math.min(min, distance(point, center)), Number.POSITIVE_INFINITY);
}

function pathTurnCost(points) {
  let cost = 0;
  for (let index = 2; index < points.length; index += 1) {
    const a = subtract(points[index - 1], points[index - 2]);
    const b = subtract(points[index], points[index - 1]);
    cost += vectorAngle(a, b) ** 2;
  }
  return cost;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : { x: 0, y: 0, z: 0 };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vectorAngle(a, b) {
  const aLength = Math.hypot(a.x, a.y, a.z);
  const bLength = Math.hypot(b.x, b.y, b.z);
  if (!(aLength > 0) || !(bLength > 0)) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (aLength * bLength))));
}

function assertVectorApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual.x - expected.x) < epsilon, `x ${actual.x} !== ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < epsilon, `y ${actual.y} !== ${expected.y}`);
  assert.ok(Math.abs(actual.z - expected.z) < epsilon, `z ${actual.z} !== ${expected.z}`);
}

function assertApprox(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} !== ${expected}`);
}
