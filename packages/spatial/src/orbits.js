import { requiredSpatialVector3 } from './math.js';
import {
  SPATIAL_LOCAL_FORWARD,
  SPATIAL_LOCAL_RIGHT,
  SPATIAL_LOCAL_UP,
  addSpatialVectors,
  cloneSpatialVector3,
  crossSpatialVectors,
  dotSpatialVectors,
  getSpatialVectorLength,
  normalizeDirectionOr,
  normalizeSpatialVector3,
  perpendicularTo,
  scaleSpatialVector,
  subtractSpatialVectors,
} from './math.js';
import {
  EPSILON,
  copySource,
  finiteNumber,
  finiteRequiredNumber,
  positiveFiniteNumber,
  warning,
} from './numerics.js';
import {
  evaluateSpatialAim,
  normalizeSpatialAimSpec,
} from './pose-aim.js';
import {
  spatialSpaceFor,
} from './spaces.js';

export function normalizeSpatialOrbitSpec(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialOrbitSpec object.');
  }
  const radius = positiveFiniteNumber(input.radius, 'Orbit radius');
  if (input.handedness !== undefined && input.handedness !== -1 && input.handedness !== 1) {
    throw new RangeError('Orbit handedness must be 1 or -1.');
  }
  return { space,
    center: requiredSpatialVector3(input.center, 'center'),
    radius,
    ...(input.orbitNormal !== undefined ? { orbitNormal: normalizeSpatialVector3(input.orbitNormal) } : {}),
    ...(input.referenceAxis !== undefined ? { referenceAxis: normalizeSpatialVector3(input.referenceAxis) } : {}),
    ...(input.handedness !== undefined ? { handedness: input.handedness } : {}),
    ...(input.initialAngleRad !== undefined ? { initialAngleRad: finiteRequiredNumber(input.initialAngleRad, 'initialAngleRad') } : {}),
    ...(input.angularSpeedRadPerSec !== undefined ? { angularSpeedRadPerSec: finiteRequiredNumber(input.angularSpeedRadPerSec, 'angularSpeedRadPerSec') } : {}),
    ...(input.aim !== undefined ? { aim: normalizeSpatialAimSpec(input.aim, space) } : {}),
    ...copySource(input),
  };
}

export function createSpatialOrbitBasis(orbit) {
  const space = spatialSpaceFor(orbit);
  const normalized = normalizeSpatialOrbitSpec(orbit, space);
  const warnings = [];
  const normal = normalizeDirectionOr(normalized.orbitNormal ?? SPATIAL_LOCAL_UP, SPATIAL_LOCAL_UP);
  let reference = normalized.referenceAxis
    ? normalizeDirectionOr(normalized.referenceAxis, SPATIAL_LOCAL_RIGHT)
    : cloneSpatialVector3(SPATIAL_LOCAL_RIGHT);
  reference = subtractSpatialVectors(reference, scaleSpatialVector(normal, dotSpatialVectors(reference, normal)));
  if (getSpatialVectorLength(reference) <= EPSILON) {
    warnings.push(warning('orbitReferenceParallelToNormal', 'Orbit reference axis was parallel to orbit normal.'));
    reference = perpendicularTo(normal);
  }
  const radial = normalizeDirectionOr(reference, SPATIAL_LOCAL_RIGHT);
  const tangent = scaleSpatialVector(crossSpatialVectors(normal, radial), normalized.handedness === -1 ? -1 : 1);
  return { space,
    center: cloneSpatialVector3(normalized.center),
    radius: normalized.radius,
    normal,
    radial,
    tangent: normalizeDirectionOr(tangent, SPATIAL_LOCAL_FORWARD),
    referenceAxis: radial,
    warnings,
  };
}

export function deriveSpatialOrbitAngle(input) {
  const space = spatialSpaceFor(input);
  const center = requiredSpatialVector3(input?.center, 'center');
  const position = requiredSpatialVector3(input?.position, 'position');
  const basis = createSpatialOrbitBasis({ space,
    center,
    radius: Math.max(getSpatialVectorLength(subtractSpatialVectors(position, center)), 1),
    ...(input?.orbitNormal !== undefined ? { orbitNormal: input.orbitNormal } : {}),
    ...(input?.referenceAxis !== undefined ? { referenceAxis: input.referenceAxis } : {}),
    ...(input?.handedness !== undefined ? { handedness: input.handedness } : {}),
  });
  const offset = subtractSpatialVectors(position, center);
  return Math.atan2(dotSpatialVectors(offset, basis.tangent), dotSpatialVectors(offset, basis.radial));
}

export function sampleSpatialOrbitPosition(orbitOrBasis, angleRad) {
  const space = spatialSpaceFor(orbitOrBasis);
  const basis = 'radial' in orbitOrBasis && 'tangent' in orbitOrBasis
    ? orbitOrBasis
    : createSpatialOrbitBasis(orbitOrBasis);
  const radial = scaleSpatialVector(basis.radial, Math.cos(angleRad));
  const tangent = scaleSpatialVector(basis.tangent, Math.sin(angleRad));
  return addSpatialVectors(
    basis.center,
    scaleSpatialVector(addSpatialVectors(radial, tangent), basis.radius),
  );
}

export function evaluateSpatialOrbit(orbit, elapsedSecs) {
  const space = spatialSpaceFor(orbit);
  const normalized = normalizeSpatialOrbitSpec(orbit, space);
  const basis = createSpatialOrbitBasis(normalized);
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const angleRad = finiteNumber(normalized.initialAngleRad, 0)
    + finiteNumber(normalized.angularSpeedRadPerSec, 0) * elapsed;
  const position = sampleSpatialOrbitPosition(basis, angleRad);
  const radial = normalizeDirectionOr(subtractSpatialVectors(position, basis.center), basis.radial);
  const tangent = normalizeDirectionOr(scaleSpatialVector(crossSpatialVectors(basis.normal, radial), normalized.handedness === -1 ? -1 : 1), basis.tangent);
  const speedUnitsPerSec = Math.abs(finiteNumber(normalized.angularSpeedRadPerSec, 0)) * normalized.radius;
  const velocityUnitsPerSec = scaleSpatialVector(tangent, speedUnitsPerSec * Math.sign(finiteNumber(normalized.angularSpeedRadPerSec, 0) || 1));
  const aim = evaluateSpatialAim({ space,
    position: position,
    aim: normalized.aim ?? { kind: 'target', target: normalized.center },
  });
  return { space,
    elapsedSecs: elapsed,
    angleRad,
    position,
    velocityUnitsPerSec,
    speedUnitsPerSec,
    radial,
    tangent,
    basis,
    aim,
  };
}

export function deriveSpatialOrbitHandoff(input) {
  const space = spatialSpaceFor(input, input?.orbit?.space);
  const orbit = normalizeSpatialOrbitSpec(input?.orbit, space);
  const position = requiredSpatialVector3(input?.position, 'position');
  const basis = createSpatialOrbitBasis(orbit);
  const angleRad = Math.atan2(
    dotSpatialVectors(subtractSpatialVectors(position, basis.center), basis.tangent),
    dotSpatialVectors(subtractSpatialVectors(position, basis.center), basis.radial),
  );
  return { space,
    orbit: { ...orbit, initialAngleRad: angleRad },
    basis,
    angleRad,
  };
}
