import { requiredSpatialVector3 } from './math.js';
import {
  SPATIAL_IDENTITY_QUATERNION,
  SPATIAL_LOCAL_FORWARD,
  SPATIAL_LOCAL_RIGHT,
  SPATIAL_ZERO_VECTOR,
  addSpatialVectors,
  cloneSpatialVector3,
  combineSpatialVectors,
  crossSpatialVectors,
  dotSpatialVectors,
  getSpatialVectorLength,
  lerpVector,
  normalizeDirectionOr,
  normalizeSpatialVector3,
  scaleSpatialVector,
  subtractSpatialVectors,
} from './math.js';
import {
  EPSILON,
  clamp,
  copySource,
  finiteNumber,
  isDestinationLike,
  isVectorLike,
  nonNegativeFiniteNumber,
  positiveInteger,
  positiveNumber,
  timingTimeNearlyEqual,
  warning,
} from './numerics.js';
import {
  createSpatialOrbitBasis,
  deriveSpatialOrbitHandoff,
  evaluateSpatialOrbit,
  normalizeSpatialOrbitSpec,
  sampleSpatialOrbitPosition,
} from './orbits.js';
import {
  addSamplingWarning,
  createSpatialSamplingTimeline,
  normalizeSpatialSamplingOptions,
} from './paths.js';
import {
  normalizeSpatialAimSpec,
  normalizeSpatialPose,
} from './pose-aim.js';
import {
  attachSpatialSpace,
  spatialSpaceFor,
} from './spaces.js';
import {
  cloneTimingProfileForDistance,
  deriveSpatialOrbitalInsertTiming,
  deriveSpatialRouteTiming,
  deriveTimingProfile,
  evaluateTimingProfileAt,
  isTimingProfile,
  normalizeSpatialTravelSpec,
  normalizeTimingProfile,
} from './timing.js';

export function normalizeSpatialDestination(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialDestinationSpec object.');
  }
  if (input.id !== undefined && typeof input.id !== 'string') {
    throw new TypeError('Destination id must be a string.');
  }
  if (input.label !== undefined && typeof input.label !== 'string') {
    throw new TypeError('Destination label must be a string.');
  }
  return { space,
    ...(input.id !== undefined ? { id: input.id } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    center: requiredSpatialVector3(input.center, 'center'),
    ...(input.radius !== undefined ? { radius: nonNegativeFiniteNumber(input.radius, 'radius') } : {}),
    ...(input.boundsRadius !== undefined ? { boundsRadius: nonNegativeFiniteNumber(input.boundsRadius, 'boundsRadius') } : {}),
    ...(input.aim !== undefined ? { aim: normalizeSpatialAimSpec(input.aim, space) } : {}),
    ...(input.orbit !== undefined ? { orbit: normalizeSpatialOrbitSpec(input.orbit, space) } : {}),
    ...(input.dwellSecs !== undefined ? { dwellSecs: nonNegativeFiniteNumber(input.dwellSecs, 'dwellSecs') } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function normalizeSpatialRouteEndpointSpec(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Expected a SpatialRouteEndpointSpec object.');
  }
  return { space,
    ...(input.position !== undefined ? { position: normalizeSpatialVector3(input.position) } : {}),
    ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination, space) } : {}),
    ...(input.orbit !== undefined ? { orbit: input.orbit == null ? null : normalizeSpatialOrbitSpec(input.orbit, space) } : {}),
    ...(input.aim !== undefined ? { aim: input.aim == null ? null : normalizeSpatialAimSpec(input.aim, space) } : {}),
    ...(input.velocityUnitsPerSec !== undefined ? { velocityUnitsPerSec: normalizeSpatialVector3(input.velocityUnitsPerSec) } : {}),
    ...(input.speedUnitsPerSec !== undefined ? { speedUnitsPerSec: nonNegativeFiniteNumber(input.speedUnitsPerSec, 'speedUnitsPerSec') } : {}),
    ...copySource(input),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
  };
}

export function buildSpatialRouteEndpoint(input, options = {}) {
  const space = spatialSpaceFor(input, options.space);
  if (isVectorLike(input)) {
    return attachSpatialSpace(endpointFromSpec({ position: normalizeSpatialVector3(input) }, options), space);
  }
  const spec = isDestinationLike(input)
    ? { destination: normalizeSpatialDestination(input, space) }
    : normalizeSpatialRouteEndpointSpec(input, space);
  return attachSpatialSpace(endpointFromSpec(spec, options), space);
}

export function buildSpatialPolylineRoute(input) {
  const space = spatialSpaceFor(input);
  if (!input || typeof input !== 'object') {
    throw new TypeError('buildSpatialPolylineRoute() requires an input object.');
  }
  const points = Array.from(input.points ?? []).map((point) => requiredSpatialVector3(point, 'Route point'));
  if (points.length === 0) {
    throw new TypeError('Polyline routes require at least one point.');
  }
  const segments = buildRouteSegments(points);
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const travel = input.travel ? normalizeSpatialTravelSpec(input.travel, space) : { kind: 'polyline' };
  const timing = deriveSpatialRouteTiming({ space, totalLength, travel });
  const departure = buildSpatialRouteEndpoint({ position: points[0] }, { space, role: 'departure' });
  const arrival = buildSpatialRouteEndpoint({ position: points[points.length - 1] }, { space, role: 'arrival' });
  const arrivalAction = input.arrivalAction === undefined
    ? undefined
    : input.arrivalAction === null ? null : normalizeSpatialArrivalAction(input.arrivalAction, space);
  return attachSpatialSpace(createRoute({
    kind: 'polyline',
    points,
    segments,
    totalLength,
    timing,
    departure,
    arrival,
    ...(arrivalAction !== undefined ? { arrivalAction } : {}),
    diagnostics: routeDiagnostics(totalLength, timing),
    ...copySource(input),
  }), space);
}

export function buildSpatialOrbitTransferRoute(input) {
  const space = spatialSpaceFor(input);
  if (!input || typeof input !== 'object') throw new TypeError('Expected orbit transfer route input.');
  const from = buildSpatialRouteEndpoint(input.from, { space, role: 'departure', referencePose: input.referencePose });
  const to = buildSpatialRouteEndpoint(input.to, { space,
    role: 'arrival',
    referencePose: from ? { space, position: from.position, orientation: SPATIAL_IDENTITY_QUATERNION } : input.referencePose,
  });
  if (!from || !to) return null;
  const travel = input.travel ? normalizeSpatialTravelSpec(input.travel, space) : { kind: 'orbitTransfer' };
  const authoredTimingProfile = isTimingProfile(travel.timing) ? travel.timing : null;
  let geometry = createOrbitTransferGeometry(from, to, travel, authoredTimingProfile);
  let segments = buildRouteSegments(geometry.points);
  let totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let timing = deriveSpatialRouteTiming({ space, totalLength, travel, departureSpeedUnitsPerSec: from.speedUnitsPerSec, arrivalSpeedUnitsPerSec: to.speedUnitsPerSec });
  geometry = createOrbitTransferGeometry(from, to, travel, timing);
  segments = buildRouteSegments(geometry.points);
  totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  timing = deriveSpatialRouteTiming({ space, totalLength, travel, departureSpeedUnitsPerSec: from.speedUnitsPerSec, arrivalSpeedUnitsPerSec: to.speedUnitsPerSec });
  const arrivalAction = input.arrivalAction !== undefined
    ? input.arrivalAction == null ? null : normalizeSpatialArrivalAction(input.arrivalAction, space)
    : to.orbit ? normalizeSpatialArrivalAction({
        kind: 'orbit',
        destination: to.destination,
        orbit: deriveSpatialOrbitHandoff({ space, position: to.position, orbit: to.orbit }).orbit,
        aim: to.aim ?? to.destination?.aim ?? to.orbit.aim ?? null,
      }, space) : null;
  return attachSpatialSpace(createRoute({
    kind: 'orbitTransfer',
    points: geometry.points,
    segments,
    totalLength,
    timing,
    departure: from,
    arrival: to,
    arrivalAction,
    diagnostics: routeDiagnostics(totalLength, timing, geometry.diagnostics),
    ...copySource(input),
  }), space);
}

export function buildSpatialOrbitalInsertRoute(input) {
  const space = spatialSpaceFor(input);
  if (!input || typeof input !== 'object') throw new TypeError('Expected orbital insert route input.');
  const orbit = normalizeSpatialOrbitSpec(input.orbit, space);
  const from = buildSpatialRouteEndpoint(input.from, { space, role: 'departure', referencePose: input.referencePose });
  if (!from) return null;
  const insertion = deriveOrbitalInsertionSelection(from, orbit);
  const arrivalOrbit = { ...orbit, initialAngleRad: insertion.angleRad };
  const arrivalPosition = insertion.position;
  const arrivalOrbitSample = evaluateSpatialOrbit(arrivalOrbit, 0);
  const arrival = buildSpatialRouteEndpoint({
    position: arrivalPosition,
    destination: input.destination,
    orbit: arrivalOrbit,
    aim: orbit.aim ?? input.destination?.aim ?? null,
    velocityUnitsPerSec: arrivalOrbitSample.velocityUnitsPerSec,
    speedUnitsPerSec: arrivalOrbitSample.speedUnitsPerSec,
  }, { space, role: 'arrival' });
  const travel = input.travel ? normalizeSpatialTravelSpec(input.travel, space) : { kind: 'orbitalInsert' };
  const orbitalSpeedUnitsPerSec = arrivalOrbitSample.speedUnitsPerSec;
  const authoredTimingProfile = isTimingProfile(travel.timing) ? travel.timing : null;
  let geometry = createOrbitalInsertGeometry(from, arrival, arrivalOrbit, travel, authoredTimingProfile);
  let segments = buildRouteSegments(geometry.points);
  let totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let timing = deriveOrbitalInsertRouteTiming({ space,
    totalLength,
    travel,
    from,
    orbitalSpeedUnitsPerSec,
  });
  geometry = createOrbitalInsertGeometry(from, arrival, arrivalOrbit, travel, timing);
  segments = buildRouteSegments(geometry.points);
  totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  timing = deriveOrbitalInsertRouteTiming({ space,
    totalLength,
    travel,
    from,
    orbitalSpeedUnitsPerSec,
  });
  return attachSpatialSpace(createRoute({
    kind: 'orbitalInsert',
    points: geometry.points,
    segments,
    totalLength,
    timing,
    departure: from,
    arrival,
    arrivalAction: normalizeSpatialArrivalAction({
      kind: 'orbitalInsert',
      destination: input.destination,
      orbit: arrivalOrbit,
      timing,
    }, space),
    diagnostics: routeDiagnostics(totalLength, timing, {
      settleBehavior: 'continueOrbit',
      ...geometry.diagnostics,
      insertionSelection: insertion.selection,
      insertionAngleRad: insertion.angleRad,
      insertionPosition: cloneSpatialVector3(insertion.position),
      insertionPlaneOffset: insertion.planeOffset,
      ...(insertion.approachAlignment !== null
        ? { insertionApproachAlignment: insertion.approachAlignment }
        : {}),
      ...(insertion.departureVelocityAlignment !== null
        ? { insertionDepartureVelocityAlignment: insertion.departureVelocityAlignment }
        : {}),
      warnings: [...insertion.warnings, ...(geometry.diagnostics.warnings ?? [])],
    }),
    ...copySource(input),
  }), space);
}

export function normalizeSpatialArrivalAction(input, inheritedSpace) {
  const space = spatialSpaceFor(input, inheritedSpace);
  if (!input || typeof input !== 'object') throw new TypeError('Expected SpatialArrivalAction object.');
  if (input.kind === 'none') return { space, kind: 'none' };
  if (input.kind === 'orbit') {
    if (input.preserveAim !== undefined && typeof input.preserveAim !== 'boolean') {
      throw new TypeError('preserveAim must be a boolean.');
    }
    return { space,
      kind: 'orbit',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination, space) } : {}),
      orbit: normalizeSpatialOrbitSpec(input.orbit, space),
      ...(input.aim !== undefined ? { aim: input.aim == null ? null : normalizeSpatialAimSpec(input.aim, space) } : {}),
      ...(input.settleSecs !== undefined ? { settleSecs: nonNegativeFiniteNumber(input.settleSecs, 'settleSecs') } : {}),
      ...(input.preserveAim !== undefined ? { preserveAim: input.preserveAim } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'orbitalInsert') {
    return { space,
      kind: 'orbitalInsert',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination, space) } : {}),
      orbit: normalizeSpatialOrbitSpec(input.orbit, space),
      ...(input.timing !== undefined ? { timing: normalizeTimingProfile(input.timing) } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'lookAt') {
    return { space,
      kind: 'lookAt',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination, space) } : {}),
      aim: normalizeSpatialAimSpec(input.aim, space),
      ...(input.dwellSecs !== undefined ? { dwellSecs: nonNegativeFiniteNumber(input.dwellSecs, 'dwellSecs') } : {}),
      ...copySource(input),
    };
  }
  if (input.kind === 'lockAt') {
    const aim = normalizeSpatialAimSpec(input.aim, space);
    if (aim.kind !== 'target') throw new TypeError('lockAt arrival actions require target aim.');
    return { space,
      kind: 'lockAt',
      ...(input.destination !== undefined ? { destination: normalizeSpatialDestination(input.destination, space) } : {}),
      aim,
      ...(input.dwellSecs !== undefined ? { dwellSecs: nonNegativeFiniteNumber(input.dwellSecs, 'dwellSecs') } : {}),
      ...copySource(input),
    };
  }
  throw new TypeError(`Unsupported arrival action kind: ${String(input.kind)}`);
}

export function getSpatialRouteDiagnostics(route) {
  return { space: spatialSpaceFor(route), ...route.diagnostics, warnings: [...(route.diagnostics?.warnings ?? [])] };
}

export function evaluateSpatialRoute(route, elapsedSecs, options = {}) {
  const space = spatialSpaceFor(route);
  const elapsed = Math.max(0, finiteNumber(elapsedSecs, 0));
  const duration = Math.max(0, route.timing?.durationSecs ?? route.diagnostics?.durationSecs ?? 0);
  const timingSample = evaluateTimingProfileAt(route.timing, elapsed);
  const distance = clamp(timingSample.distance, 0, route.totalLength);
  const sample = sampleRouteAtDistance(route, distance, timingSample.speedUnitsPerSec);
  const complete = elapsed >= duration || timingTimeNearlyEqual(elapsed, duration);
  const endpointVelocity = complete
    ? sampleRouteEndpointVelocity(route.arrival)
    : elapsed === 0 ? sampleRouteEndpointVelocity(route.departure) : null;
  return { space,
    elapsedSecs: elapsed,
    ...(options.frameIndex !== undefined ? { frameIndex: options.frameIndex } : {}),
    ...(route.id !== undefined ? { routeId: route.id } : {}),
    routeKind: route.kind,
    position: sample.position,
    velocityUnitsPerSec: endpointVelocity?.velocityUnitsPerSec ?? sample.velocityUnitsPerSec,
    speedUnitsPerSec: endpointVelocity?.speedUnitsPerSec ?? sample.speedUnitsPerSec,
    distance,
    segmentIndex: sample.segmentIndex,
    complete,
    diagnostics: { warnings: [] },
  };
}

export function sampleSpatialRoute(route, options = {}) {
  const space = spatialSpaceFor(route);
  const sampling = normalizeSpatialSamplingOptions(options);
  const duration = Math.max(0, route.timing?.durationSecs ?? route.diagnostics?.durationSecs ?? 0);
  const timeline = createSpatialSamplingTimeline(duration, sampling);
  const samples = timeline.times.map((timeSecs, frameIndex) => (
    evaluateSpatialRoute(route, timeSecs, { frameIndex })
  ));
  if (timeline.truncated) {
    addSamplingWarning(
      samples,
      warning('maxSamplesTruncatesRoute', 'maxSamples truncates route sampling before the end time.', {
        maxSamples: sampling.maxSamples,
        durationSecs: duration,
      }),
    );
  }
  return samples;
}

export function endpointFromSpec(spec, options) {
  const space = spatialSpaceFor(spec, options.space);
  let position = spec.position ? cloneSpatialVector3(spec.position) : null;
  let destination = spec.destination ?? null;
  const orbit = Object.prototype.hasOwnProperty.call(spec, 'orbit')
    ? spec.orbit
    : destination?.orbit ?? options.fallbackOrbit ?? null;
  if (!position && orbit) {
    const basis = createSpatialOrbitBasis(orbit);
    position = sampleSpatialOrbitPosition(basis, orbit.initialAngleRad ?? 0);
  }
  if (!position && destination?.radius !== undefined && options.referencePose) {
    const referencePose = normalizeSpatialPose(options.referencePose, space);
    const radial = normalizeDirectionOr(
      subtractSpatialVectors(referencePose.position, destination.center),
      SPATIAL_LOCAL_RIGHT,
    );
    position = addSpatialVectors(destination.center, scaleSpatialVector(radial, destination.radius));
  }
  if (!position && destination?.center) return null;
  if (!position) return null;
  const endpointOrbit = orbit ? normalizeSpatialOrbitSpec(orbit, space) : null;
  return { space,
    kind: destination ? 'destination' : endpointOrbit ? 'orbit' : 'point',
    position,
    ...(destination ? { destination } : {}),
    ...(spec.velocityUnitsPerSec ? { velocityUnitsPerSec: cloneSpatialVector3(spec.velocityUnitsPerSec) } : {}),
    ...(spec.speedUnitsPerSec !== undefined ? { speedUnitsPerSec: spec.speedUnitsPerSec } : {}),
    ...(endpointOrbit ? { orbit: endpointOrbit, orbitBasis: createSpatialOrbitBasis(endpointOrbit) } : {}),
    ...(spec.aim !== undefined ? { aim: spec.aim } : destination?.aim ? { aim: destination.aim } : options.fallbackAim ? { aim: options.fallbackAim } : {}),
    ...copySource(spec),
    ...(spec.metadata ? { metadata: { ...spec.metadata } } : {}),
  };
}

export function createRoute(route) {
  return {
    ...route,
    points: route.points.map(cloneSpatialVector3),
    segments: route.segments.map((segment) => ({ ...segment, start: cloneSpatialVector3(segment.start), end: cloneSpatialVector3(segment.end) })),
  };
}

export function buildRouteSegments(points) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = getSpatialVectorLength(subtractSpatialVectors(end, start));
    if (length === 0) continue;
    segments.push({
      index: segments.length,
      start: cloneSpatialVector3(start),
      end: cloneSpatialVector3(end),
      length,
      cumulativeStart: total,
      cumulativeEnd: total + length,
    });
    total += length;
  }
  return segments;
}

export function interpolateRoutePoints(start, end, travel, timing = null, minimumPointCount = 2) {
  const distance = getSpatialVectorLength(subtractSpatialVectors(end, start));
  const pointCount = routePointCountForTravel(distance, travel, timing, minimumPointCount);
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    points.push(lerpVector(start, end, pointCount === 1 ? 1 : index / (pointCount - 1)));
  }
  return points;
}

export function routePointCountForTravel(distance, travel, timing = null, minimumPointCount = 2) {
  const step = positiveNumber(travel.sampleStepSecs, 1);
  const maxPoints = positiveInteger(travel.maxPoints, 32);
  const sampleBasis = timing?.durationSecs > 0 ? timing.durationSecs : step * (maxPoints - 1);
  return Math.max(2, Math.min(maxPoints, Math.max(minimumPointCount, Math.ceil(sampleBasis / step) + 1)));
}

export function createOrbitTransferGeometry(from, to, travel, timing) {
  const start = from.position;
  const end = to.position;
  const chord = subtractSpatialVectors(end, start);
  const distance = getSpatialVectorLength(chord);
  const fromOrbitFrame = from.orbit ? orbitFrameAtPosition(from.orbit, from.position) : null;
  const toOrbitFrame = to.orbit ? orbitFrameAtPosition(to.orbit, to.position) : null;
  if (!fromOrbitFrame && !toOrbitFrame) {
    return {
      points: interpolateRoutePoints(start, end, travel, timing),
      diagnostics: {
        warnings: [warning('linearOrbitTransferFallback', 'Orbit transfer used linear geometry because no endpoint orbit metadata was available.')],
      },
    };
  }
  const chordDirection = normalizeDirectionOr(chord, SPATIAL_LOCAL_FORWARD);
  const startTangent = normalizeDirectionOr(from.velocityUnitsPerSec, null)
    ?? fromOrbitFrame?.tangent
    ?? chordDirection;
  const endTangent = normalizeDirectionOr(to.velocityUnitsPerSec, null)
    ?? toOrbitFrame?.tangent
    ?? chordDirection;
  const points = sampleHermiteRoutePoints({
    start,
    end,
    startTangent,
    endTangent,
    travel,
    timing,
    minimumPointCount: 4,
  });
  const selectedFrame = toOrbitFrame ?? fromOrbitFrame;
  return {
    points,
    diagnostics: {
      ...(selectedFrame ? {
        selectedOrbitNormal: selectedFrame.basis.normal,
        selectedRadial: selectedFrame.radial,
        selectedTangent: selectedFrame.tangent,
      } : {}),
      warnings: [],
    },
  };
}

export function deriveOrbitalInsertionSelection(from, orbit) {
  const basis = createSpatialOrbitBasis(orbit);
  const departureOffset = subtractSpatialVectors(from.position, basis.center);
  const planeOffset = dotSpatialVectors(departureOffset, basis.normal);
  const projectedOffset = subtractSpatialVectors(
    departureOffset,
    scaleSpatialVector(basis.normal, planeOffset),
  );
  const projectedDistance = getSpatialVectorLength(projectedOffset);
  const axisScale = Math.max(orbit.radius, getSpatialVectorLength(departureOffset));
  const axisTolerance = Number.EPSILON * 32 * axisScale;
  const onOrbitAxis = projectedDistance <= axisTolerance;
  const planeWarnings = orbitalInsertionPlaneWarnings(departureOffset, planeOffset, orbit.radius);

  if (orbit.initialAngleRad !== undefined) {
    return orbitalInsertionSelectionAtAngle({
      selection: 'explicitAngle',
      angleRad: orbit.initialAngleRad,
      from,
      orbit,
      planeOffset,
      warnings: planeWarnings,
    });
  }

  if (!onOrbitAxis && projectedDistance >= orbit.radius) {
    const projectedRadial = scaleSpatialVector(projectedOffset, 1 / projectedDistance);
    const projectedTangent = normalizeDirectionOr(
      crossSpatialVectors(basis.normal, projectedRadial),
      basis.tangent,
    );
    const radialAlongDeparture = clamp(orbit.radius / projectedDistance, 0, 1);
    const radialAlongTangent = Math.sqrt(Math.max(0, 1 - radialAlongDeparture ** 2));

    // Tangency is solved in the orbit plane. For an off-plane departure, the
    // actual Hermite route also sheds its plane-normal offset before handoff;
    // the selected contact still satisfies (T - projectedDeparture) dotSpatialVectors
    // (T - center) = 0 and provides an exact signed orbital end tangent.
    const candidates = [1, -1].map((side) => {
      const contactRadial = normalizeDirectionOr(addSpatialVectors(
        scaleSpatialVector(projectedRadial, radialAlongDeparture),
        scaleSpatialVector(projectedTangent, side * radialAlongTangent),
      ), projectedRadial);
      const position = addSpatialVectors(
        basis.center,
        scaleSpatialVector(contactRadial, orbit.radius),
      );
      const angleRad = Math.atan2(
        dotSpatialVectors(contactRadial, basis.tangent),
        dotSpatialVectors(contactRadial, basis.radial),
      );
      return orbitalInsertionCandidate({
        angleRad,
        position,
        from,
        orbit,
      });
    });
    const firstApproachAlignment = candidates[0].approachAlignment ?? Number.NEGATIVE_INFINITY;
    const secondApproachAlignment = candidates[1].approachAlignment ?? Number.NEGATIVE_INFINITY;
    const firstDepartureAlignment = candidates[0].departureVelocityAlignment ?? Number.NEGATIVE_INFINITY;
    const secondDepartureAlignment = candidates[1].departureVelocityAlignment ?? Number.NEGATIVE_INFINITY;
    const selected = secondApproachAlignment > firstApproachAlignment
      || (secondApproachAlignment === firstApproachAlignment
        && secondDepartureAlignment > firstDepartureAlignment)
      ? candidates[1]
      : candidates[0];
    return {
      selection: 'tangent',
      angleRad: selected.angleRad,
      position: selected.position,
      approachAlignment: selected.approachAlignment,
      departureVelocityAlignment: selected.departureVelocityAlignment,
      planeOffset,
      warnings: planeWarnings,
    };
  }

  const fallbackReason = onOrbitAxis ? 'onOrbitAxis' : 'insideOrbitRadius';
  const fallbackAngleRad = !onOrbitAxis
    ? Math.atan2(dotSpatialVectors(projectedOffset, basis.tangent), dotSpatialVectors(projectedOffset, basis.radial))
    : 0;
  return orbitalInsertionSelectionAtAngle({
    selection: 'nearestAngleFallback',
    angleRad: fallbackAngleRad,
    from,
    orbit,
    planeOffset,
    warnings: [
      warning(
        'orbitalInsertTangentFallback',
        'A tangent orbital insertion contact is unavailable; the nearest orbit angle was selected.',
        {
          reason: fallbackReason,
          projectedDistance,
          radius: orbit.radius,
        },
      ),
      ...planeWarnings,
    ],
  });
}

export function orbitalInsertionPlaneWarnings(departureOffset, planeOffset, radius) {
  const planeScale = Math.max(radius, getSpatialVectorLength(departureOffset));
  const planeTolerance = Number.EPSILON * 32 * planeScale;
  return Math.abs(planeOffset) > planeTolerance
    ? [warning(
        'orbitalInsertPlaneChange',
        'The orbital insertion route must shed the departure offset from the orbit plane before handoff.',
        {
          planeOffset,
          absolutePlaneOffset: Math.abs(planeOffset),
        },
      )]
    : [];
}

export function orbitalInsertionSelectionAtAngle(options) {
  const position = sampleSpatialOrbitPosition(options.orbit, options.angleRad);
  const candidate = orbitalInsertionCandidate({
    angleRad: options.angleRad,
    position,
    from: options.from,
    orbit: options.orbit,
  });
  return {
    selection: options.selection,
    angleRad: options.angleRad,
    position,
    approachAlignment: candidate.approachAlignment,
    departureVelocityAlignment: candidate.departureVelocityAlignment,
    planeOffset: options.planeOffset,
    warnings: options.warnings,
  };
}

export function orbitalInsertionCandidate(options) {
  const approachDirection = normalizeDirectionOr(
    subtractSpatialVectors(options.position, options.from.position),
    null,
  );
  const signedOrbitTangent = orbitFrameAtPosition(options.orbit, options.position).tangent;
  const departureVelocityDirection = normalizeDirectionOr(options.from.velocityUnitsPerSec, null);
  return {
    angleRad: options.angleRad,
    position: options.position,
    approachAlignment: approachDirection ? dotSpatialVectors(approachDirection, signedOrbitTangent) : null,
    departureVelocityAlignment: approachDirection && departureVelocityDirection
      ? dotSpatialVectors(approachDirection, departureVelocityDirection)
      : null,
  };
}

export function createOrbitalInsertGeometry(from, arrival, arrivalOrbit, travel, timing) {
  const start = from.position;
  const end = arrival.position;
  const chord = subtractSpatialVectors(end, start);
  const chordDirection = normalizeDirectionOr(chord, SPATIAL_LOCAL_FORWARD);
  const arrivalFrame = orbitFrameAtPosition(arrivalOrbit, end);
  const startTangent = normalizeDirectionOr(from.velocityUnitsPerSec, null) ?? chordDirection;
  const points = sampleHermiteRoutePoints({
    start,
    end,
    startTangent,
    endTangent: arrivalFrame.tangent,
    travel,
    timing,
    minimumPointCount: 4,
  });
  return {
    points,
    diagnostics: {
      selectedOrbitNormal: arrivalFrame.basis.normal,
      selectedRadial: arrivalFrame.radial,
      selectedTangent: arrivalFrame.tangent,
      warnings: [],
    },
  };
}

export function sampleHermiteRoutePoints(options) {
  const distance = getSpatialVectorLength(subtractSpatialVectors(options.end, options.start));
  if (!(distance > 0)) return [cloneSpatialVector3(options.start), cloneSpatialVector3(options.end)];
  const pointCount = routePointCountForTravel(distance, options.travel, options.timing, options.minimumPointCount);
  const handleLength = distance * 0.55;
  const m0 = scaleSpatialVector(normalizeDirectionOr(options.startTangent, normalizeDirectionOr(subtractSpatialVectors(options.end, options.start), SPATIAL_LOCAL_FORWARD)), handleLength);
  const m1 = scaleSpatialVector(normalizeDirectionOr(options.endTangent, normalizeDirectionOr(subtractSpatialVectors(options.end, options.start), SPATIAL_LOCAL_FORWARD)), handleLength);
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    const u = pointCount === 1 ? 1 : index / (pointCount - 1);
    points.push(evaluateCubicHermiteVector(options.start, options.end, m0, m1, u));
  }
  points[0] = cloneSpatialVector3(options.start);
  points[points.length - 1] = cloneSpatialVector3(options.end);
  return points;
}

export function orbitFrameAtPosition(orbit, position) {
  const normalized = normalizeSpatialOrbitSpec(orbit);
  const basis = createSpatialOrbitBasis(normalized);
  const radial = normalizeDirectionOr(subtractSpatialVectors(position, basis.center), basis.radial);
  const tangentSign = (normalized.handedness === -1 ? -1 : 1) * Math.sign(finiteNumber(normalized.angularSpeedRadPerSec, 0) || 1);
  const tangent = normalizeDirectionOr(scaleSpatialVector(crossSpatialVectors(basis.normal, radial), tangentSign), basis.tangent);
  return { basis, radial, tangent };
}

export function evaluateCubicHermiteVector(start, end, startTangent, endTangent, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return combineSpatialVectors([
    [start, 2 * t3 - 3 * t2 + 1],
    [startTangent, t3 - 2 * t2 + t],
    [end, -2 * t3 + 3 * t2],
    [endTangent, t3 - t2],
  ]);
}

export function deriveOrbitalInsertRouteTiming(input) {
  const space = spatialSpaceFor(input, input.from?.space);
  const timing = input.travel?.timing;
  if (isTimingProfile(timing)) return cloneTimingProfileForDistance(timing, input.totalLength);
  if (timing?.kind === 'custom') {
    return deriveTimingProfile({ space, ...timing, distance: input.totalLength });
  }
  const currentSpeedUnitsPerSec = timing?.departureSpeedUnitsPerSec ?? input.from.speedUnitsPerSec;
  const approachSpeedUnitsPerSec = timing?.speedUnitsPerSec
    ?? timing?.cruiseSpeedUnitsPerSec
    ?? timing?.peakSpeedUnitsPerSec;
  return deriveSpatialOrbitalInsertTiming({ space,
    distance: input.totalLength,
    orbitalSpeedUnitsPerSec: input.orbitalSpeedUnitsPerSec,
    currentSpeedUnitsPerSec,
    approachSpeedUnitsPerSec,
    durationSecs: timing?.durationSecs,
    accelerationUnitsPerSec2: timing?.accelerationUnitsPerSec2,
    decelerationUnitsPerSec2: timing?.decelerationUnitsPerSec2,
    minDurationSecs: timing?.minDurationSecs,
    maxDurationSecs: timing?.maxDurationSecs,
  });
}

export function routeDiagnostics(totalLength, timing, overrides = {}) {
  const averageSpeedUnitsPerSec = timing.durationSecs > 0 ? totalLength / timing.durationSecs : 0;
  const overrideWarnings = Array.isArray(overrides.warnings) ? overrides.warnings : [];
  const { warnings: _warnings, ...rest } = overrides;
  return {
    durationSecs: timing.durationSecs,
    totalLength,
    averageSpeedUnitsPerSec,
    peakSpeedUnitsPerSec: Math.max(averageSpeedUnitsPerSec, timing.peakSpeedUnitsPerSec ?? 0),
    departureSpeedUnitsPerSec: timing.departureSpeedUnitsPerSec ?? 0,
    arrivalSpeedUnitsPerSec: timing.arrivalSpeedUnitsPerSec ?? 0,
    ...rest,
    warnings: [...(timing.diagnostics?.warnings ?? []), ...overrideWarnings],
  };
}

export function sampleRouteEndpointVelocity(endpoint) {
  if (!endpoint?.velocityUnitsPerSec) return null;
  const authoredVelocity = cloneSpatialVector3(endpoint.velocityUnitsPerSec);
  const authoredMagnitude = getSpatialVectorLength(authoredVelocity);
  if (!(authoredMagnitude > 0)) {
    return {
      velocityUnitsPerSec: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
      speedUnitsPerSec: 0,
    };
  }
  const speedUnitsPerSec = endpoint.speedUnitsPerSec ?? authoredMagnitude;
  return {
    velocityUnitsPerSec: scaleSpatialVector(authoredVelocity, speedUnitsPerSec / authoredMagnitude),
    speedUnitsPerSec,
  };
}

export function sampleRouteAtDistance(route, distance, speedUnitsPerSec = null) {
  if (route.segments.length === 0) {
    return {
      position: cloneSpatialVector3(route.points[0]),
      velocityUnitsPerSec: cloneSpatialVector3(SPATIAL_ZERO_VECTOR),
      speedUnitsPerSec: 0,
      segmentIndex: null,
    };
  }
  const clampedDistance = clamp(distance, 0, route.totalLength);
  const segment = route.segments.find((candidate) => clampedDistance <= candidate.cumulativeEnd)
    ?? route.segments[route.segments.length - 1];
  const localDistance = clamp(clampedDistance - segment.cumulativeStart, 0, segment.length);
  const t = segment.length > 0 ? localDistance / segment.length : 0;
  const direction = normalizeDirectionOr(subtractSpatialVectors(segment.end, segment.start), SPATIAL_ZERO_VECTOR);
  const speed = Math.max(0, finiteNumber(speedUnitsPerSec, route.timing.durationSecs > 0 ? route.totalLength / route.timing.durationSecs : 0));
  return {
    position: lerpVector(segment.start, segment.end, t),
    velocityUnitsPerSec: scaleSpatialVector(direction, speed),
    speedUnitsPerSec: speed,
    segmentIndex: segment.index,
  };
}
