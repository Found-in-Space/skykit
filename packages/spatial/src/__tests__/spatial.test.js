import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDENTITY_QUATERNION,
  buildSpatialPolylineRoute,
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
  projectEquirectangular,
  raDecDistanceToIcrs,
  raDecToIcrsDirection,
  resolveSpatialTarget,
  sampleSpatialPolylineRoutePosition,
} from '../index.js';

test('coordinates convert RA/Dec/distance to ICRS and back', () => {
  assert.deepEqual(raDecToIcrsDirection({ raDeg: 0, decDeg: 0 }), { x: 1, y: 0, z: 0 });
  const target = raDecDistanceToIcrs({ raHours: 6, decDeg: 0, distancePc: 10 });
  assert.ok(target);
  assert.ok(Math.abs(target.x) < 1e-12);
  assert.ok(Math.abs(target.y - 10) < 1e-12);
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

test('resolveSpatialTarget handles vectors, RA/Dec, and bookmark resolvers', async () => {
  assert.deepEqual(resolveSpatialTarget([1, 2, 3]), { x: 1, y: 2, z: 3 });
  assert.deepEqual(resolveSpatialTarget({ targetPc: { x: 4, y: 5, z: 6 } }), { x: 4, y: 5, z: 6 });
  assert.deepEqual(resolveSpatialTarget({ raDeg: 0, decDeg: 0, distancePc: 2 }), { x: 2, y: 0, z: 0 });
  const bookmark = await resolveSpatialTarget({ bookmarkId: 'pleiades' }, {
    resolveBookmark: (id) => id === 'pleiades'
      ? { raDeg: 0, decDeg: 90, distancePc: 4 }
      : null,
  });
  assert.ok(bookmark);
  assert.ok(Math.abs(bookmark.z - 4) < 1e-12);
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
    sampleStepSecs: 0.25,
  });
  assert.ok(sameCenter);
  assert.ok(sameCenter.points.length > 10);
  assert.deepEqual(sameCenter.points[0], { x: 8, y: 0, z: 0 });
  assert.ok(Math.abs(distance(sameCenter.points.at(-1), { x: 0, y: 0, z: 0 }) - 175) < 1e-9);
  assert.equal(sameCenter.arrivalAction.angularSpeedRadPerSec, 0.06);
  assert.deepEqual(sameCenter.arrivalAction.normal, { x: 0, y: 0, z: 1 });
  assert.equal(sameCenter.departureSpeed, 8 * 0.26);
  assert.equal(sameCenter.arrivalSpeed, 175 * 0.06);

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
    sampleStepSecs: 0.25,
  });
  assert.ok(inserted);
  assert.ok(inserted.points.length > 10);
  assert.deepEqual(inserted.points[0], { x: 175, y: 0, z: 0 });
  assert.ok(Math.abs(distance(inserted.points.at(-1), inserted.arrivalAction.center) - 15) < 1e-9);
  assert.ok(Math.abs(orbitPlaneOffset(inserted.points.at(-1), inserted.arrivalAction)) < 1e-9);
  assert.equal(inserted.departureSpeed, 175 * 0.06);
  assert.equal(inserted.arrivalSpeed, 15 * 0.2);

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
