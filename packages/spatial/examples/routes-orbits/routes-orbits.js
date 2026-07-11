import {
  SPATIAL_IDENTITY_QUATERNION,
  buildSpatialOrbitalInsertRoute,
  buildSpatialOrbitTransferRoute,
  buildSpatialPolylineRoute,
  createSpatialNavigationAutomation,
  evaluateSpatialOrbit,
  evaluateSpatialRoute,
  getSpatialRouteDiagnostics,
  sampleSpatialOrbitPosition,
  sampleSpatialRoute,
} from '@found-in-space/spatial';

const CENTER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const ORBIT_NORMAL = Object.freeze({ x: 0, y: 1, z: 0 });
const REFERENCE_AXIS = Object.freeze({ x: 1, y: 0, z: 0 });
const INNER_RADIUS_PC = 6;
const OUTER_RADIUS_PC = 14;
const ANGULAR_SPEED_RAD_PER_SEC = 0.24;
const ORBIT_PREVIEW_SECS = 3.5;
const ROUTE_COLORS = Object.freeze({
  route: '#73d5ff',
  routeFaint: 'rgba(115, 213, 255, 0.25)',
  orbit: '#7b86a3',
  orbitActive: '#73f0c1',
  observer: '#ffd479',
  velocity: '#ff8e71',
  departure: '#c5a7ff',
  arrival: '#73f0c1',
  grid: 'rgba(151, 180, 214, 0.12)',
  text: '#9fb3c8',
});
const PHASE_COLORS = Object.freeze({
  accelerate: 'rgba(76, 191, 255, 0.22)',
  cruise: 'rgba(115, 240, 193, 0.18)',
  decelerate: 'rgba(255, 142, 113, 0.22)',
  blend: 'rgba(197, 167, 255, 0.2)',
  hold: 'rgba(159, 179, 200, 0.16)',
});

const elements = {
  routeKind: document.querySelector('[data-route-kind]'),
  timingKind: document.querySelector('[data-timing-kind]'),
  handedness: document.querySelector('[data-handedness]'),
  duration: document.querySelector('[data-duration]'),
  speed: document.querySelector('[data-speed]'),
  acceleration: document.querySelector('[data-acceleration]'),
  deceleration: document.querySelector('[data-deceleration]'),
  settle: document.querySelector('[data-settle]'),
  controlNote: document.querySelector('[data-control-note]'),
  play: document.querySelector('[data-play]'),
  reset: document.querySelector('[data-reset]'),
  scrub: document.querySelector('[data-scrub]'),
  phase: document.querySelector('[data-phase]'),
  timeReadout: document.querySelector('[data-time-readout]'),
  length: document.querySelector('[data-length]'),
  routeDuration: document.querySelector('[data-route-duration]'),
  currentSpeed: document.querySelector('[data-current-speed]'),
  sampleCount: document.querySelector('[data-sample-count]'),
  routeCanvas: document.querySelector('[data-route-canvas]'),
  timingCanvas: document.querySelector('[data-timing-canvas]'),
  specJson: document.querySelector('[data-spec-json]'),
  diagnosticsJson: document.querySelector('[data-diagnostics-json]'),
  error: document.querySelector('[data-error]'),
};

if (!elements.routeCanvas || !elements.timingCanvas) {
  throw new Error('Routes and orbits example requires both canvases.');
}

let route = null;
let authoredSpec = null;
let arrivalOrbit = null;
let routeSamples = [];
let navigation = null;
let pose = null;
let playheadSecs = 0;
let totalTimelineSecs = 1;
let playing = false;
let lastFrameMs = null;

bindControls();
rebuildRoute();
requestAnimationFrame(frame);

function bindControls() {
  for (const control of [
    elements.routeKind,
    elements.timingKind,
    elements.handedness,
    elements.duration,
    elements.speed,
    elements.acceleration,
    elements.deceleration,
    elements.settle,
  ]) {
    control?.addEventListener('change', rebuildRoute);
  }

  elements.play?.addEventListener('click', () => {
    if (!route) return;
    if (playheadSecs >= totalTimelineSecs) setNavigationAt(0);
    playing = !playing;
    lastFrameMs = null;
    syncPlaybackControls();
  });

  elements.reset?.addEventListener('click', () => {
    playing = false;
    setNavigationAt(0);
    syncPlaybackControls();
  });

  elements.scrub?.addEventListener('input', () => {
    playing = false;
    setNavigationAt(Number(elements.scrub.value));
    syncPlaybackControls();
  });

  window.addEventListener('resize', render);
  window.addEventListener('beforeunload', () => navigation?.dispose());
}

function rebuildRoute() {
  try {
    const routeKind = elements.routeKind.value;
    syncAuthoredControlState();
    const handedness = Number(elements.handedness.value);
    const settleSecs = routeKind === 'orbitalInsert'
      ? 0
      : readNonNegative(elements.settle, 'Arrival settle');
    const timing = readTimingSpec(routeKind);
    const insertionDepartureSpeedPcPerSec = timing.departureSpeedPcPerSec
      ?? timing.speedPcPerSec;

    const arrivalOrbitTemplate = {
      centerPc: CENTER_PC,
      radiusPc: INNER_RADIUS_PC,
      orbitNormal: ORBIT_NORMAL,
      referenceAxis: REFERENCE_AXIS,
      handedness,
      angularSpeedRadPerSec: ANGULAR_SPEED_RAD_PER_SEC,
      aim: { kind: 'target', targetPc: CENTER_PC },
    };
    const authoredArrivalOrbit = {
      ...arrivalOrbitTemplate,
      initialAngleRad: 0.62,
    };
    const outerOrbit = {
      centerPc: CENTER_PC,
      radiusPc: OUTER_RADIUS_PC,
      orbitNormal: ORBIT_NORMAL,
      referenceAxis: REFERENCE_AXIS,
      handedness,
      initialAngleRad: 2.48,
      angularSpeedRadPerSec: ANGULAR_SPEED_RAD_PER_SEC * 0.45,
    };
    const travel = {
      kind: routeKind,
      timing,
      ...(routeKind === 'polyline' ? {} : { sampleStepSecs: 0.12, maxPoints: 160 }),
    };
    const arrivalAction = {
      kind: 'orbit',
      orbit: authoredArrivalOrbit,
      settleSecs,
      preserveAim: false,
    };

    if (routeKind === 'polyline') {
      const arrivalPc = sampleSpatialOrbitPosition(
        authoredArrivalOrbit,
        authoredArrivalOrbit.initialAngleRad,
      );
      authoredSpec = {
        pointsPc: [
          { x: -15, y: 0, z: 8 },
          { x: -9, y: 0, z: -10 },
          { x: 1, y: 0, z: -11 },
          arrivalPc,
        ],
        travel,
        arrivalAction,
      };
      route = buildSpatialPolylineRoute(authoredSpec);
    } else if (routeKind === 'orbitTransfer') {
      authoredSpec = {
        from: { orbit: outerOrbit },
        to: { orbit: authoredArrivalOrbit },
        travel,
        arrivalAction,
      };
      route = buildSpatialOrbitTransferRoute(authoredSpec);
    } else {
      authoredSpec = {
        from: {
          positionPc: { x: -15, y: 0, z: 9 },
          ...(insertionDepartureSpeedPcPerSec !== undefined
            ? { speedPcPerSec: insertionDepartureSpeedPcPerSec }
            : {}),
        },
        // Omitting initialAngleRad asks the builder for a geometric tangent
        // contact point aligned with the signed orbit direction.
        orbit: arrivalOrbitTemplate,
        destination: {
          id: 'inner-orbit',
          label: 'Inner review orbit',
          centerPc: CENTER_PC,
          orbit: arrivalOrbitTemplate,
        },
        travel,
      };
      route = buildSpatialOrbitalInsertRoute(authoredSpec);
    }

    if (!route) throw new Error('The selected route geometry could not be built.');
    arrivalOrbit = route.arrival.orbit
      ?? (route.arrivalAction?.kind === 'orbit' || route.arrivalAction?.kind === 'orbitalInsert'
        ? route.arrivalAction.orbit
        : null)
      ?? authoredArrivalOrbit;
    const sampleStepSecs = Math.max(route.timing.durationSecs / 100, 0.01);
    routeSamples = sampleSpatialRoute(route, { sampleStepSecs, maxSamples: 140 });
    const settleDuration = route.arrivalAction?.kind === 'orbit'
      ? route.arrivalAction.settleSecs ?? 0
      : 0;
    totalTimelineSecs = route.timing.durationSecs + settleDuration + ORBIT_PREVIEW_SECS;
    elements.scrub.max = String(totalTimelineSecs);
    elements.specJson.textContent = displayJson({
      builder: builderName(routeKind),
      input: authoredSpec,
    });
    elements.length.textContent = `${formatNumber(route.totalLengthPc)} pc`;
    elements.routeDuration.textContent = `${formatNumber(route.timing.durationSecs)} s`;
    elements.sampleCount.textContent = String(routeSamples.length);
    elements.controlNote.textContent = routeKind === 'orbitalInsert'
      ? 'No initialAngleRad is authored: the builder chooses the contact point whose approach is perpendicular to the radius and aligned with the signed orbit direction. This in-plane route converges on orbital speed without a heading snap; author an angle to override the default.'
      : `The explicit orbit arrival action holds for ${formatNumber(settleDuration)} s, then continues from the exact route endpoint.`;
    setError(null);
    playing = false;
    setNavigationAt(0);
    syncPlaybackControls();
  } catch (error) {
    route = null;
    routeSamples = [];
    playing = false;
    setError(error);
    render();
  }
}

function readTimingSpec(routeKind) {
  const kind = elements.timingKind.value;
  if (kind === 'duration') {
    return { kind, durationSecs: readPositive(elements.duration, 'Duration') };
  }
  const speedPcPerSec = readPositive(elements.speed, 'Cruise / peak speed');
  if (kind === 'constantSpeed') return { kind, speedPcPerSec };
  const accelerationPcPerSec2 = routeKind === 'orbitalInsert'
    ? undefined
    : readPositive(elements.acceleration, 'Acceleration');
  const decelerationPcPerSec2 = readPositive(elements.deceleration, 'Deceleration');
  const departureSpeedPcPerSec = routeKind === 'orbitalInsert' ? speedPcPerSec : 0;
  if (kind === 'triangular') {
    return {
      kind,
      departureSpeedPcPerSec,
      peakSpeedPcPerSec: speedPcPerSec,
      arrivalSpeedPcPerSec: INNER_RADIUS_PC * ANGULAR_SPEED_RAD_PER_SEC,
      ...(accelerationPcPerSec2 !== undefined ? { accelerationPcPerSec2 } : {}),
      decelerationPcPerSec2,
    };
  }
  return {
    kind: 'trapezoid',
    departureSpeedPcPerSec,
    cruiseSpeedPcPerSec: speedPcPerSec,
    arrivalSpeedPcPerSec: INNER_RADIUS_PC * ANGULAR_SPEED_RAD_PER_SEC,
    ...(accelerationPcPerSec2 !== undefined ? { accelerationPcPerSec2 } : {}),
    decelerationPcPerSec2,
  };
}

function setNavigationAt(timeSecs) {
  if (!route) return;
  playheadSecs = clamp(timeSecs, 0, totalTimelineSecs);
  navigation?.dispose();
  navigation = createSpatialNavigationAutomation();
  navigation.flyRoute(route);
  pose = {
    observerPc: route.departure.positionPc,
    orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
  };
  pose = navigation.update({ pose, deltaSecs: playheadSecs });
  render();
}

function frame(timestampMs) {
  if (playing && route && navigation) {
    if (lastFrameMs == null) lastFrameMs = timestampMs;
    const deltaSecs = Math.min((timestampMs - lastFrameMs) / 1000, 0.1);
    lastFrameMs = timestampMs;
    const remainingSecs = Math.max(0, totalTimelineSecs - playheadSecs);
    const appliedDelta = Math.min(deltaSecs, remainingSecs);
    playheadSecs += appliedDelta;
    pose = navigation.update({ pose, deltaSecs: appliedDelta });
    if (playheadSecs >= totalTimelineSecs) {
      playing = false;
      lastFrameMs = null;
    }
    render();
    syncPlaybackControls();
  }
  requestAnimationFrame(frame);
}

function render() {
  const routeSurface = prepareCanvas(elements.routeCanvas);
  const timingSurface = prepareCanvas(elements.timingCanvas);
  if (!route || !navigation || !pose) {
    drawEmpty(routeSurface, 'Choose valid route controls to build geometry.');
    drawEmpty(timingSurface, 'Timing diagnostics will appear here.');
    return;
  }

  const navigationDiagnostics = navigation.getDiagnostics();
  const frameState = navigation.getFrameState();
  const currentMotion = deriveCurrentMotion(navigationDiagnostics, frameState);
  drawRoute(routeSurface, currentMotion, frameState);
  drawTiming(timingSurface, currentMotion);
  renderReadouts(navigationDiagnostics, frameState, currentMotion);
}

function drawRoute(surface, currentMotion, frameState) {
  const { ctx, width, height } = surface;
  ctx.clearRect(0, 0, width, height);
  const bounds = collectPlotBounds();
  const project = createXzProjector(bounds, width, height, 42);
  drawGrid(ctx, project, bounds, width, height);

  drawOrbitCircle(ctx, project, CENTER_PC, OUTER_RADIUS_PC, {
    color: 'rgba(123, 134, 163, 0.3)',
    dash: [5, 7],
  });
  drawOrbitCircle(ctx, project, CENTER_PC, INNER_RADIUS_PC, {
    color: frameState.orbit ? ROUTE_COLORS.orbitActive : ROUTE_COLORS.orbit,
    dash: [8, 6],
  });

  const arrivalOrbitSample = evaluateSpatialOrbit(arrivalOrbit, 0);
  const arrivalRadial = route.diagnostics.selectedRadial ?? arrivalOrbitSample.radial;
  const arrivalTangent = route.diagnostics.selectedTangent ?? arrivalOrbitSample.tangent;
  drawVector(
    ctx,
    project,
    CENTER_PC,
    scaleVector(arrivalRadial, arrivalOrbit.radiusPc),
    '#c5a7ff',
    'arrival radius',
    { labelAt: 0.58, labelOffsetX: -92, labelOffsetY: -7 },
  );
  if (arrivalTangent) {
    drawVector(
      ctx,
      project,
      route.arrival.positionPc,
      scaleVector(arrivalTangent, 3.5),
      '#73f0c1',
      'orbit tangent',
      { labelOffsetX: 7, labelOffsetY: 14 },
    );
  }
  if (route.kind === 'orbitalInsert') {
    drawGuideLine(
      ctx,
      project,
      route.departure.positionPc,
      route.arrival.positionPc,
      'tangent approach',
    );
  }

  ctx.save();
  ctx.strokeStyle = ROUTE_COLORS.route;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  route.pointsPc.forEach((point, index) => {
    const screen = project(point);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
  ctx.restore();

  for (const sample of routeSamples) {
    const screen = project(sample.positionPc);
    const speedRatio = route.diagnostics.peakSpeedPcPerSec > 0
      ? sample.speedPcPerSec / route.diagnostics.peakSpeedPcPerSec
      : 0;
    ctx.fillStyle = colorMix('#73d5ff', '#ff8e71', speedRatio);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPoint(ctx, project(route.departure.positionPc), ROUTE_COLORS.departure, 5, 'departure');
  drawPoint(ctx, project(route.arrival.positionPc), ROUTE_COLORS.arrival, 5, 'arrival');
  drawPoint(ctx, project(currentMotion.positionPc), ROUTE_COLORS.observer, 7, `observer · ${currentMotion.phaseLabel.toLowerCase()}`, 18);

  const velocityLength = currentMotion.speedPcPerSec > 0
    ? 2.2 + 3.8 * currentMotion.speedPcPerSec / Math.max(currentMotion.maxSpeedPcPerSec, currentMotion.speedPcPerSec)
    : 0;
  if (velocityLength > 0) {
    const direction = normalizeVector(currentMotion.velocityPcPerSec);
    drawVector(ctx, project, currentMotion.positionPc, scaleVector(direction, velocityLength), ROUTE_COLORS.velocity, 'velocity');
  }

  ctx.fillStyle = ROUTE_COLORS.text;
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('X →', width - 42, height - 14);
  ctx.fillText('Z ↑', 12, 18);
}

function drawTiming(surface, currentMotion) {
  const { ctx, width, height } = surface;
  ctx.clearRect(0, 0, width, height);
  const margin = { left: 48, right: 20, top: 18, bottom: 42 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const routeDuration = route.timing.durationSecs;
  const settleDuration = route.arrivalAction?.kind === 'orbit'
    ? route.arrivalAction.settleSecs ?? 0
    : 0;
  const maxSpeed = Math.max(
    route.diagnostics.peakSpeedPcPerSec,
    INNER_RADIUS_PC * ANGULAR_SPEED_RAD_PER_SEC,
    0.1,
  );
  const xAt = (timeSecs) => margin.left + timeSecs / totalTimelineSecs * plotWidth;
  const yAt = (speedPcPerSec) => margin.top + plotHeight - speedPcPerSec / maxSpeed * plotHeight;

  for (const phase of route.timing.phases) {
    const left = xAt(phase.startTimeSecs);
    const right = xAt(phase.endTimeSecs);
    ctx.fillStyle = PHASE_COLORS[phase.kind] ?? PHASE_COLORS.hold;
    ctx.fillRect(left, margin.top, Math.max(1, right - left), plotHeight);
    if (right - left > 45) {
      ctx.fillStyle = ROUTE_COLORS.text;
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(phase.kind, left + 5, margin.top + 13);
    }
  }

  if (settleDuration > 0) {
    ctx.fillStyle = 'rgba(197, 167, 255, 0.16)';
    ctx.fillRect(xAt(routeDuration), margin.top, xAt(routeDuration + settleDuration) - xAt(routeDuration), plotHeight);
  }
  ctx.fillStyle = 'rgba(115, 240, 193, 0.08)';
  ctx.fillRect(xAt(routeDuration + settleDuration), margin.top, xAt(totalTimelineSecs) - xAt(routeDuration + settleDuration), plotHeight);

  ctx.strokeStyle = 'rgba(159, 179, 200, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotHeight);
  ctx.lineTo(width - margin.right, margin.top + plotHeight);
  ctx.stroke();

  ctx.strokeStyle = ROUTE_COLORS.route;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  routeSamples.forEach((sample, index) => {
    const x = xAt(sample.elapsedSecs);
    const y = yAt(sample.speedPcPerSec);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (settleDuration > 0) {
    ctx.lineTo(xAt(routeDuration), yAt(0));
    ctx.lineTo(xAt(routeDuration + settleDuration), yAt(0));
  }
  const orbitSpeed = INNER_RADIUS_PC * ANGULAR_SPEED_RAD_PER_SEC;
  ctx.lineTo(xAt(routeDuration + settleDuration), yAt(orbitSpeed));
  ctx.lineTo(xAt(totalTimelineSecs), yAt(orbitSpeed));
  ctx.stroke();

  const markerX = xAt(playheadSecs);
  ctx.strokeStyle = ROUTE_COLORS.observer;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(markerX, margin.top);
  ctx.lineTo(markerX, margin.top + plotHeight);
  ctx.stroke();
  ctx.fillStyle = ROUTE_COLORS.observer;
  ctx.beginPath();
  ctx.arc(markerX, yAt(currentMotion.speedPcPerSec), 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = ROUTE_COLORS.text;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(`${formatNumber(maxSpeed)} pc/s`, 4, margin.top + 4);
  ctx.fillText('0', 30, margin.top + plotHeight + 4);
  ctx.fillText('route', xAt(routeDuration / 2) - 14, height - 15);
  if (settleDuration > 0) {
    ctx.fillText('settle', xAt(routeDuration + settleDuration / 2) - 17, height - 15);
  }
  ctx.fillText('orbit', xAt(routeDuration + settleDuration + ORBIT_PREVIEW_SECS / 2) - 14, height - 15);
}

function renderReadouts(navigationDiagnostics, frameState, currentMotion) {
  elements.timeReadout.textContent = `${formatNumber(playheadSecs)} / ${formatNumber(totalTimelineSecs)} s`;
  elements.currentSpeed.textContent = `${formatNumber(currentMotion.speedPcPerSec)} pc/s`;
  elements.phase.textContent = currentMotion.phaseLabel;
  elements.phase.dataset.phase = currentMotion.phaseLabel.toLowerCase();
  elements.diagnosticsJson.textContent = displayJson({
    route: getSpatialRouteDiagnostics(route),
    insertionGeometry: deriveInsertionGeometryReview(),
    timing: route.timing,
    navigation: {
      activeMovement: navigationDiagnostics.activeMovement?.kind ?? 'idle',
      elapsedSecs: navigationDiagnostics.elapsedSecs,
      currentSpeedPcPerSec: navigationDiagnostics.currentSpeedPcPerSec,
      pendingSettle: navigationDiagnostics.pendingSettle,
      arrivalAction: navigationDiagnostics.arrivalAction,
    },
    frame: {
      observerPc: frameState.pose.observerPc,
      orbit: frameState.orbit
        ? {
            angleRad: frameState.orbit.angleRad,
            speedPcPerSec: frameState.orbit.speedPcPerSec,
          }
        : null,
      pathFollow: frameState.pathFollow,
    },
  });
  elements.scrub.value = String(playheadSecs);
}

function deriveInsertionGeometryReview() {
  if (route.kind !== 'orbitalInsert') return null;
  const approach = normalizeVector(subtractVector(
    route.arrival.positionPc,
    route.departure.positionPc,
  ));
  const radial = route.diagnostics.selectedRadial
    ?? normalizeVector(subtractVector(route.arrival.positionPc, CENTER_PC));
  const tangent = route.diagnostics.selectedTangent;
  return {
    selection: route.diagnostics.insertionSelection,
    derivedInitialAngleRad: route.diagnostics.insertionAngleRad
      ?? arrivalOrbit.initialAngleRad,
    insertionPositionPc: route.diagnostics.insertionPositionPc,
    approachAlignment: route.diagnostics.insertionApproachAlignment,
    departureVelocityAlignment: route.diagnostics.insertionDepartureVelocityAlignment,
    planeOffsetPc: route.diagnostics.insertionPlaneOffsetPc,
    approachDotRadial: dotVector(approach, radial),
    approachDotTangent: tangent ? dotVector(approach, tangent) : null,
    note: 'A tangent insertion has approachDotRadial near 0 and approachDotTangent near 1.',
  };
}

function deriveCurrentMotion(navigationDiagnostics, frameState) {
  const activeKind = navigationDiagnostics.activeMovement?.kind ?? 'idle';
  if (navigationDiagnostics.pendingSettle) {
    return {
      positionPc: frameState.pose.observerPc,
      velocityPcPerSec: { x: 0, y: 0, z: 0 },
      speedPcPerSec: 0,
      maxSpeedPcPerSec: Math.max(route.diagnostics.peakSpeedPcPerSec, 0.1),
      phaseLabel: 'Settle',
    };
  }
  if (route && playheadSecs < route.timing.durationSecs && activeKind !== 'orbit') {
    const routeSample = evaluateSpatialRoute(route, playheadSecs);
    return {
      positionPc: routeSample.positionPc,
      velocityPcPerSec: routeSample.velocityPcPerSec,
      speedPcPerSec: routeSample.speedPcPerSec,
      maxSpeedPcPerSec: Math.max(route.diagnostics.peakSpeedPcPerSec, 0.1),
      phaseLabel: 'Route',
    };
  }
  if (frameState.orbit) {
    const orbitSample = evaluateSpatialOrbit(frameState.orbit.orbit, navigationDiagnostics.elapsedSecs);
    return {
      positionPc: orbitSample.positionPc,
      velocityPcPerSec: orbitSample.velocityPcPerSec,
      speedPcPerSec: orbitSample.speedPcPerSec,
      maxSpeedPcPerSec: Math.max(route.diagnostics.peakSpeedPcPerSec, orbitSample.speedPcPerSec, 0.1),
      phaseLabel: 'Orbit',
    };
  }
  return {
    positionPc: frameState.pose.observerPc,
    velocityPcPerSec: { x: 0, y: 0, z: 0 },
    speedPcPerSec: 0,
    maxSpeedPcPerSec: Math.max(route.diagnostics.peakSpeedPcPerSec, 0.1),
    phaseLabel: 'Idle',
  };
}

function collectPlotBounds() {
  const points = [
    ...route.pointsPc,
    { x: CENTER_PC.x - OUTER_RADIUS_PC, y: 0, z: CENTER_PC.z - OUTER_RADIUS_PC },
    { x: CENTER_PC.x + OUTER_RADIUS_PC, y: 0, z: CENTER_PC.z + OUTER_RADIUS_PC },
  ];
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function drawGrid(ctx, project, bounds, width, height) {
  ctx.save();
  ctx.strokeStyle = ROUTE_COLORS.grid;
  ctx.lineWidth = 1;
  const gridStartX = Math.floor(bounds.minX / 5) * 5;
  const gridEndX = Math.ceil(bounds.maxX / 5) * 5;
  const gridStartZ = Math.floor(bounds.minZ / 5) * 5;
  const gridEndZ = Math.ceil(bounds.maxZ / 5) * 5;
  for (let x = gridStartX; x <= gridEndX; x += 5) {
    const top = project({ x, y: 0, z: bounds.maxZ });
    const bottom = project({ x, y: 0, z: bounds.minZ });
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }
  for (let z = gridStartZ; z <= gridEndZ; z += 5) {
    const left = project({ x: bounds.minX, y: 0, z });
    const right = project({ x: bounds.maxX, y: 0, z });
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }
  const origin = project(CENTER_PC);
  ctx.strokeStyle = 'rgba(159, 179, 200, 0.3)';
  ctx.beginPath();
  ctx.moveTo(0, origin.y);
  ctx.lineTo(width, origin.y);
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, height);
  ctx.stroke();
  ctx.restore();
}

function drawOrbitCircle(ctx, project, centerPc, radiusPc, options) {
  ctx.save();
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(options.dash ?? []);
  ctx.beginPath();
  for (let index = 0; index <= 96; index += 1) {
    const angle = index / 96 * Math.PI * 2;
    const point = {
      x: centerPc.x + Math.cos(angle) * radiusPc,
      y: centerPc.y,
      z: centerPc.z + Math.sin(angle) * radiusPc,
    };
    const screen = project(point);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPoint(ctx, screen, color, radius, label, labelOffsetY = -radius - 3) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(label, screen.x + radius + 5, screen.y + labelOffsetY);
}

function drawVector(ctx, project, originPc, vectorPc, color, label, options = {}) {
  const start = project(originPc);
  const endPc = addVector(originPc, vectorPc);
  const end = project(endPc);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - 0.5) * 8, end.y - Math.sin(angle - 0.5) * 8);
  ctx.lineTo(end.x - Math.cos(angle + 0.5) * 8, end.y - Math.sin(angle + 0.5) * 8);
  ctx.closePath();
  ctx.fill();
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  const labelAt = options.labelAt ?? 1;
  ctx.fillText(
    label,
    start.x + (end.x - start.x) * labelAt + (options.labelOffsetX ?? 5),
    start.y + (end.y - start.y) * labelAt + (options.labelOffsetY ?? -5),
  );
  ctx.restore();
}

function drawGuideLine(ctx, project, startPc, endPc, label) {
  const start = project(startPc);
  const end = project(endPc);
  ctx.save();
  ctx.strokeStyle = 'rgba(115, 240, 193, 0.38)';
  ctx.fillStyle = '#73f0c1';
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(label, (start.x + end.x) / 2 + 6, (start.y + end.y) / 2 - 6);
  ctx.restore();
}

function createXzProjector(bounds, width, height, padding) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanZ);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  return (point) => ({
    x: width / 2 + (point.x - centerX) * scale,
    y: height / 2 - (point.z - centerZ) * scale,
  });
}

function prepareCanvas(canvas) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawEmpty(surface, message) {
  surface.ctx.clearRect(0, 0, surface.width, surface.height);
  surface.ctx.fillStyle = ROUTE_COLORS.text;
  surface.ctx.font = '14px system-ui, sans-serif';
  surface.ctx.fillText(message, 24, 40);
}

function syncPlaybackControls() {
  elements.play.textContent = playing ? 'Pause' : 'Play';
  elements.play.setAttribute('aria-pressed', String(playing));
  elements.scrub.value = String(playheadSecs);
}

function setError(error) {
  if (!error) {
    elements.error.hidden = true;
    elements.error.textContent = '';
    return;
  }
  elements.error.hidden = false;
  elements.error.textContent = error instanceof Error ? error.message : String(error);
}

function syncAuthoredControlState() {
  const timingKind = elements.timingKind.value;
  elements.duration.disabled = timingKind !== 'duration';
  elements.speed.disabled = timingKind === 'duration';
  const ratesApply = timingKind === 'trapezoid' || timingKind === 'triangular';
  elements.acceleration.disabled = !ratesApply
    || elements.routeKind.value === 'orbitalInsert';
  elements.deceleration.disabled = !ratesApply;
  elements.settle.disabled = elements.routeKind.value === 'orbitalInsert';
}

function builderName(kind) {
  if (kind === 'polyline') return 'buildSpatialPolylineRoute';
  if (kind === 'orbitalInsert') return 'buildSpatialOrbitalInsertRoute';
  return 'buildSpatialOrbitTransferRoute';
}

function readPositive(input, label) {
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return value;
}

function readNonNegative(input, label) {
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative.`);
  return value;
}

function displayJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number') return Number(item.toFixed(5));
    return item;
  }, 2);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : { x: 0, y: 0, z: 0 };
}

function scaleVector(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function addVector(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtractVector(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dotVector(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function colorMix(from, to, amount) {
  const left = hexToRgb(from);
  const right = hexToRgb(to);
  const t = clamp(amount, 0, 1);
  return `rgb(${Math.round(left.r + (right.r - left.r) * t)}, ${Math.round(left.g + (right.g - left.g) * t)}, ${Math.round(left.b + (right.b - left.b) * t)})`;
}

function hexToRgb(value) {
  const number = Number.parseInt(value.slice(1), 16);
  return { r: number >> 16, g: number >> 8 & 255, b: number & 255 };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
