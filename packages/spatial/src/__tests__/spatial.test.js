import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDENTITY_QUATERNION,
  buildSpatialOrbitalInsertRoute,
  buildSpatialPolylineRoute,
  computeSpatialLookAtOrientation,
  createDirectSpatialMotionModel,
  createFlyToSpatialMotionModel,
  createInertialSpatialMotionModel,
  createSpatialNavigationAutomation,
  createThrustSpatialMotionModel,
  deriveSpatialOrbitAngle,
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

test('orbit angle and orbital insertion derive a usable orbit plane', () => {
  assert.equal(deriveSpatialOrbitAngle({
    center: { x: 0, y: 0, z: 0 },
    position: { x: 1, y: 0, z: 0 },
  }), 0);

  const route = buildSpatialOrbitalInsertRoute({ x: 12, y: 0, z: 0 }, {
    center: { x: 0, y: 0, z: 0 },
    radius: 4,
    angularSpeed: 0.5,
    approachVelocity: { x: -1, y: 0, z: -1 },
    mode: 'current-trajectory',
    sampleStepSeconds: 0.25,
  });
  assert.ok(route);
  assert.ok(route.points.length > 1);
  assert.ok(Math.abs(route.arrivalAction.orbitNormal.y) > 0.1);
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
