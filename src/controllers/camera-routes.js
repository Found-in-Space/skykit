import { normalizePoint } from '../fields/octree-selection.js';
import {
  identityIcrsToSceneTransform,
  identitySceneToIcrsTransform,
} from '../layers/scene-orientation.js';

function clonePoint(point) {
  return point ? { x: point.x, y: point.y, z: point.z } : null;
}

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeDirectionInput(direction) {
  if (!Array.isArray(direction) || direction.length !== 3) {
    return null;
  }
  const [x, y, z] = direction;
  if (![x, y, z].every(Number.isFinite)) {
    return null;
  }
  const length = Math.hypot(x, y, z);
  if (!(length > 0)) {
    return null;
  }
  return [x / length, y / length, z / length];
}

function pointDistance(left, right) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }

  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const dz = right.z - left.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function resolveOrbitNormalIcrs({
  orbitNormal,
  sceneToIcrsTransform = identitySceneToIcrsTransform,
} = {}) {
  const userNormal = normalizeDirectionInput(orbitNormal);
  if (userNormal) {
    return { x: userNormal[0], y: userNormal[1], z: userNormal[2] };
  }

  const [nx, ny, nz] = sceneToIcrsTransform(0, 1, 0);
  const normalLength = Math.hypot(nx, ny, nz);
  if (!(normalLength > 0)) {
    return { x: 0, y: 1, z: 0 };
  }

  return {
    x: nx / normalLength,
    y: ny / normalLength,
    z: nz / normalLength,
  };
}

export function buildPolylineRoute(points = []) {
  const normalizedPoints = [];
  for (const point of points) {
    const normalizedPoint = normalizePoint(point, null);
    if (!normalizedPoint) {
      continue;
    }
    if (
      normalizedPoints.length > 0
      && pointDistance(normalizedPoints[normalizedPoints.length - 1], normalizedPoint) < 1e-9
    ) {
      continue;
    }
    normalizedPoints.push(normalizedPoint);
  }

  const segments = [];
  let totalLengthPc = 0;
  for (let index = 1; index < normalizedPoints.length; index += 1) {
    const start = normalizedPoints[index - 1];
    const end = normalizedPoints[index];
    const lengthPc = pointDistance(start, end);
    if (!(lengthPc > 0)) {
      continue;
    }
    segments.push({
      start,
      end,
      lengthPc,
      cumulativeStartPc: totalLengthPc,
      cumulativeEndPc: totalLengthPc + lengthPc,
    });
    totalLengthPc += lengthPc;
  }

  return {
    points: normalizedPoints,
    segments,
    totalLengthPc,
  };
}

export function samplePolylineRoutePosition(route, distancePc) {
  if (!route || !Array.isArray(route.points) || route.points.length === 0) {
    return null;
  }

  if (!Array.isArray(route.segments) || route.segments.length === 0 || !(route.totalLengthPc > 0)) {
    return clonePoint(route.points[0]);
  }

  const clampedDistancePc = clamp(distancePc, 0, route.totalLengthPc);
  for (const segment of route.segments) {
    if (clampedDistancePc > segment.cumulativeEndPc && segment !== route.segments[route.segments.length - 1]) {
      continue;
    }

    const distanceIntoSegmentPc = clamp(
      clampedDistancePc - segment.cumulativeStartPc,
      0,
      segment.lengthPc,
    );
    const blend = segment.lengthPc > 0 ? distanceIntoSegmentPc / segment.lengthPc : 0;
    return {
      x: segment.start.x + (segment.end.x - segment.start.x) * blend,
      y: segment.start.y + (segment.end.y - segment.start.y) * blend,
      z: segment.start.z + (segment.end.z - segment.start.z) * blend,
    };
  }

  return clonePoint(route.points[route.points.length - 1]);
}

export function deriveOrbitAngle(centerPc, positionPc, {
  icrsToSceneTransform = identityIcrsToSceneTransform,
} = {}) {
  const center = normalizePoint(centerPc, null);
  const position = normalizePoint(positionPc, null);
  if (!center || !position) {
    return 0;
  }

  const dx = position.x - center.x;
  const dy = position.y - center.y;
  const dz = position.z - center.z;
  const [sx, , sz] = icrsToSceneTransform(dx, dy, dz);
  if (!Number.isFinite(sx) || !Number.isFinite(sz)) {
    return 0;
  }
  return Math.atan2(sz, sx);
}

export function createOrbitalInsertAutomation(startPc, options = {}) {
  const start = normalizePoint(startPc, null);
  const center = normalizePoint(options.centerPc ?? options.center, null);
  if (!start || !center) {
    return null;
  }

  const sceneScale = positiveFinite(options.sceneScale, 1);
  const sceneToIcrsTransform = typeof options.sceneToIcrsTransform === 'function'
    ? options.sceneToIcrsTransform
    : identitySceneToIcrsTransform;
  const icrsToSceneTransform = typeof options.icrsToSceneTransform === 'function'
    ? options.icrsToSceneTransform
    : identityIcrsToSceneTransform;

  const currentDistance = pointDistance(start, center);
  const orbitRadius = positiveFinite(options.orbitRadius, currentDistance || 1);
  const angularSpeed = Number.isFinite(options.angularSpeed) ? Number(options.angularSpeed) : 0.1;
  const deceleration = positiveFinite(options.deceleration, 2);
  const durationSecs = Number.isFinite(options.durationSecs) && options.durationSecs > 0
    ? Number(options.durationSecs)
    : null;
  const approachSpeed = positiveFinite(options.approachSpeed ?? options.speed, 12);

  const orbitalSpeed = Math.abs(angularSpeed) * orbitRadius;
  let insertionRadius;
  if (durationSecs != null) {
    insertionRadius = positiveFinite(
      options.insertionRadius,
      Math.max(currentDistance * 1.02, orbitRadius * 3),
    );
  } else {
    const decelZone = deceleration > 0
      ? (approachSpeed - orbitalSpeed) / deceleration
      : 0;
    insertionRadius = positiveFinite(
      options.insertionRadius,
      Math.max(orbitRadius * 3, orbitRadius + decelZone * 1.2),
    );
  }

  return {
    type: 'orbitalInsert',
    center,
    orbitRadius,
    angularSpeed,
    approachSpeed: durationSecs == null ? approachSpeed : null,
    durationSecs,
    elapsedSecs: 0,
    deceleration,
    insertionRadius,
    normalIcrs: resolveOrbitNormalIcrs({
      orbitNormal: options.orbitNormal,
      sceneToIcrsTransform,
    }),
    sceneScale,
    sceneToIcrsTransform,
    icrsToSceneTransform,
  };
}

export function advanceOrbitalInsertAutomation(positionPc, automation, dt) {
  if (!positionPc || !automation || !(dt > 0)) {
    return { active: false, enteredOrbit: false };
  }

  const {
    center,
    orbitRadius,
    angularSpeed,
    deceleration,
    insertionRadius,
    normalIcrs,
    sceneScale,
    sceneToIcrsTransform,
    icrsToSceneTransform,
  } = automation;
  const orbitalSpeed = Math.abs(angularSpeed) * orbitRadius;

  const offX = positionPc.x - center.x;
  const offY = positionPc.y - center.y;
  const offZ = positionPc.z - center.z;
  const distance = Math.hypot(offX, offY, offZ);
  if (distance < 1e-8) {
    return { active: false, enteredOrbit: false };
  }

  const rX = offX / distance;
  const rY = offY / distance;
  const rZ = offZ / distance;

  const nX = normalIcrs.x;
  const nY = normalIcrs.y;
  const nZ = normalIcrs.z;

  let tX = rY * nZ - rZ * nY;
  let tY = rZ * nX - rX * nZ;
  let tZ = rX * nY - rY * nX;
  const tangentLength = Math.hypot(tX, tY, tZ);
  if (tangentLength < 1e-10) {
    return { active: false, enteredOrbit: false };
  }
  tX /= tangentLength;
  tY /= tangentLength;
  tZ /= tangentLength;
  if (angularSpeed < 0) {
    tX = -tX;
    tY = -tY;
    tZ = -tZ;
  }

  const tangentialBlend = 1 - smoothstep(orbitRadius, insertionRadius, distance);
  const excessDistance = Math.max(0, distance - orbitRadius);
  let radialSpeed;
  if (automation.durationSecs != null) {
    automation.elapsedSecs += dt;
    const remainingSecs = Math.max(automation.durationSecs - automation.elapsedSecs, 0.05);
    radialSpeed = excessDistance / remainingSecs;
  } else {
    radialSpeed = Math.min(automation.approachSpeed, excessDistance * deceleration);
  }
  const tangentialSpeed = orbitalSpeed * tangentialBlend;

  positionPc.x += (-rX * radialSpeed + tX * tangentialSpeed) * dt;
  positionPc.y += (-rY * radialSpeed + tY * tangentialSpeed) * dt;
  positionPc.z += (-rZ * radialSpeed + tZ * tangentialSpeed) * dt;

  if (tangentialBlend > 0) {
    const pOffX = positionPc.x - center.x;
    const pOffY = positionPc.y - center.y;
    const pOffZ = positionPc.z - center.z;
    const normalDot = pOffX * nX + pOffY * nY + pOffZ * nZ;
    const planeAlpha = clamp(tangentialBlend * 4 * dt, 0, 1);
    positionPc.x -= normalDot * nX * planeAlpha;
    positionPc.y -= normalDot * nY * planeAlpha;
    positionPc.z -= normalDot * nZ * planeAlpha;
  }

  const newOffX = positionPc.x - center.x;
  const newOffY = positionPc.y - center.y;
  const newOffZ = positionPc.z - center.z;
  const newDistance = Math.hypot(newOffX, newOffY, newOffZ);

  if (newDistance <= orbitRadius * 1.002 && newDistance > 1e-8) {
    const angle = deriveOrbitAngle(center, positionPc, {
      icrsToSceneTransform,
    });
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const [ix, iy, iz] = sceneToIcrsTransform(
      cosAngle * orbitRadius * sceneScale,
      0,
      sinAngle * orbitRadius * sceneScale,
    );
    positionPc.x = center.x + ix / sceneScale;
    positionPc.y = center.y + iy / sceneScale;
    positionPc.z = center.z + iz / sceneScale;
    return {
      active: false,
      enteredOrbit: true,
      angle,
    };
  }

  if (newDistance < orbitRadius && newDistance > 1e-8) {
    const factor = orbitRadius / newDistance;
    positionPc.x = center.x + newOffX * factor;
    positionPc.y = center.y + newOffY * factor;
    positionPc.z = center.z + newOffZ * factor;
  }

  return {
    active: true,
    enteredOrbit: false,
  };
}

export function buildOrbitalInsertRoute(startPc, options = {}) {
  const start = normalizePoint(startPc, null);
  if (!start) {
    return null;
  }

  const automation = createOrbitalInsertAutomation(start, options);
  if (!automation) {
    return null;
  }

  const sampleStepSecs = positiveFinite(options.sampleStepSecs, 1 / 30);
  const maxPoints = Math.max(2, Math.floor(positiveFinite(options.maxPoints, 512)));
  const points = [clonePoint(start)];
  const currentPosition = clonePoint(start);

  while (points.length < maxPoints) {
    const result = advanceOrbitalInsertAutomation(currentPosition, automation, sampleStepSecs);
    const lastPoint = points[points.length - 1];
    if (pointDistance(lastPoint, currentPosition) > 1e-6) {
      points.push(clonePoint(currentPosition));
    }
    if (!result.active) {
      break;
    }
  }

  return {
    points,
    arrivalAction: {
      type: 'orbit',
      centerPc: clonePoint(automation.center),
      radius: automation.orbitRadius,
      angularSpeed: automation.angularSpeed,
    },
  };
}
