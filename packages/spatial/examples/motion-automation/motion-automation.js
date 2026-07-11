import {
  SPATIAL_IDENTITY_QUATERNION,
  SPATIAL_LOCAL_FORWARD,
  applySpatialQuaternion,
  buildSpatialPolylineRoute,
  createDirectSpatialMotionModel,
  createInertialSpatialMotionModel,
  createSpatialNavigationAutomation,
  createSpatialQuaternionFromAxisAngle,
  createThrustSpatialMotionModel,
  deriveSpatialOrbitHandoff,
  sampleSpatialRoute,
} from '@found-in-space/spatial';

const COLORS = {
  direct: '#78dcff',
  inertial: '#ffc778',
  thrust: '#da9cff',
  route: '#6f9cff',
  orbit: '#6ee7c8',
  aim: '#ffcf73',
  grid: 'rgba(148, 187, 224, 0.14)',
  muted: '#8399b1',
  text: '#ecf6ff',
};

const originPose = Object.freeze({
  observerPc: Object.freeze({ x: 0, y: 0, z: 0 }),
  orientationIcrs: SPATIAL_IDENTITY_QUATERNION,
});

const navigationStart = Object.freeze({ x: -8, y: 0, z: -4 });
const orbit = Object.freeze({
  centerPc: Object.freeze({ x: 4, y: 0, z: 0 }),
  radiusPc: 3,
  orbitNormal: Object.freeze({ x: 0, y: 1, z: 0 }),
  referenceAxis: Object.freeze({ x: 1, y: 0, z: 0 }),
  handedness: 1,
  initialAngleRad: 0,
  angularSpeedRadPerSec: 0.7,
});

const route = buildSpatialPolylineRoute({
  pointsPc: [
    navigationStart,
    { x: -5, y: 0, z: 3 },
    { x: 0, y: 0, z: -2 },
    { x: 7, y: 0, z: 0 },
  ],
  travel: {
    kind: 'polyline',
    timing: {
      kind: 'trapezoid',
      durationSecs: 6,
      departureSpeedPcPerSec: 0,
      arrivalSpeedPcPerSec: orbit.radiusPc * orbit.angularSpeedRadPerSec,
      accelerationPcPerSec2: 2,
      decelerationPcPerSec2: 2,
    },
  },
  arrivalAction: {
    kind: 'orbit',
    orbit,
    settleSecs: 1,
    preserveAim: true,
  },
  source: { kind: 'example', id: 'motion-automation-route' },
});

const routeSamples = sampleSpatialRoute(route, {
  sampleStepSecs: 0.08,
  maxSamples: 160,
});

main();

function main() {
  const motionCanvas = required('[data-canvas="motion"]');
  const navigationCanvas = required('[data-canvas="navigation"]');
  const motionContext = motionCanvas.getContext('2d');
  const navigationContext = navigationCanvas.getContext('2d');
  if (!motionContext || !navigationContext) {
    throw new Error('Canvas2D is required for this example.');
  }

  const controls = {
    moveX: 0,
    moveY: 1,
    attitudeX: 0,
    attitudeY: 0,
    boost: false,
    roll: false,
  };
  const controlReader = {
    getAxis(name) {
      if (name === 'move') return axisSample(controls.moveX, controls.moveY);
      if (name === 'attitude') return axisSample(controls.attitudeX, controls.attitudeY);
      return axisSample(0, 0);
    },
    getButton(name) {
      const pressed = name === 'boost' ? controls.boost : name === 'rollModifier' && controls.roll;
      return { pressed, value: pressed ? 1 : 0 };
    },
  };

  let models;
  let navigation;
  let navigationPose;
  let navigationTrail;
  let manualLookActive = false;
  let lastCommand = 'reset';
  let animationFrame = 0;
  let previousTimeMs = performance.now();
  let lastDomUpdateMs = 0;
  const listeners = new AbortController();

  resetMotionModels();
  resetNavigation();
  bindControls();
  renderStaticCommands();
  animationFrame = requestAnimationFrame(tick);
  window.addEventListener('beforeunload', dispose, { once: true });

  function resetMotionModels() {
    for (const entry of models ?? []) entry.model.dispose?.();
    models = [
      {
        id: 'direct',
        label: 'Direct',
        model: createDirectSpatialMotionModel({
          moveSpeedPcPerSec: 4,
          boostMultiplier: 2,
          yawRateRadPerSec: 1.2,
          pitchRateRadPerSec: 1.2,
          rollRateRadPerSec: 1.2,
        }),
        pose: clonePose(originPose),
        trail: [{ x: 0, y: 0, z: 0 }],
      },
      {
        id: 'inertial',
        label: 'Inertial',
        model: createInertialSpatialMotionModel({
          moveSpeedPcPerSec: 4,
          accelerationPcPerSec2: 3,
          damping: 0.75,
          maxSpeedPcPerSec: 6,
          boostMultiplier: 2,
          yawRateRadPerSec: 1.2,
          pitchRateRadPerSec: 1.2,
          rollRateRadPerSec: 1.2,
        }),
        pose: clonePose(originPose),
        trail: [{ x: 0, y: 0, z: 0 }],
      },
      {
        id: 'thrust',
        label: 'Thrust',
        model: createThrustSpatialMotionModel({
          moveSpeedPcPerSec: 4,
          thrustPcPerSec2: 6,
          mass: 2,
          drag: 0.28,
          maxSpeedPcPerSec: 6,
          boostMultiplier: 2,
          yawRateRadPerSec: 1.2,
          pitchRateRadPerSec: 1.2,
          rollRateRadPerSec: 1.2,
        }),
        pose: clonePose(originPose),
        trail: [{ x: 0, y: 0, z: 0 }],
      },
    ];
  }

  function resetNavigation() {
    navigation?.dispose();
    navigation = createSpatialNavigationAutomation();
    navigationPose = {
      observerPc: { ...navigationStart },
      orientationIcrs: { ...SPATIAL_IDENTITY_QUATERNION },
    };
    navigationTrail = [{ ...navigationStart }];
    manualLookActive = false;
    const checkbox = document.querySelector('[data-control="manual-look"]');
    if (checkbox) checkbox.checked = false;
    navigation.update({ pose: navigationPose, deltaSecs: 0 });
    lastCommand = 'reset';
  }

  function bindControls() {
    for (const name of ['move-x', 'move-y', 'attitude-x', 'attitude-y']) {
      const input = required(`[data-control="${name}"]`);
      const readout = required(`[data-readout="${name}"]`);
      input.addEventListener('input', () => {
        const property = name.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
        controls[property] = Number(input.value);
        readout.textContent = Number(input.value).toFixed(2);
      }, { signal: listeners.signal });
    }

    required('[data-control="boost"]').addEventListener('change', (event) => {
      controls.boost = event.currentTarget.checked;
    }, { signal: listeners.signal });
    required('[data-control="roll"]').addEventListener('change', (event) => {
      controls.roll = event.currentTarget.checked;
    }, { signal: listeners.signal });
    required('[data-control="manual-look"]').addEventListener('change', (event) => {
      manualLookActive = event.currentTarget.checked;
      if (manualLookActive) {
        navigationPose = {
          ...navigationPose,
          orientationIcrs: createSpatialQuaternionFromAxisAngle(
            { x: 0, y: 1, z: 0 },
            Math.PI * 0.72,
          ),
        };
      }
      lastCommand = manualLookActive ? 'manual-look override' : 'resume semantic aim';
    }, { signal: listeners.signal });

    for (const button of document.querySelectorAll('[data-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'forward') setManualAxes({ moveX: 0, moveY: 1, attitudeX: 0, attitudeY: 0 });
        if (action === 'turn') setManualAxes({ moveX: 0, moveY: 0.75, attitudeX: 0.72, attitudeY: 0 });
        if (action === 'coast') setManualAxes({ moveX: 0, moveY: 0, attitudeX: 0, attitudeY: 0 });
        if (action === 'reset-motion') resetMotionModels();
      }, { signal: listeners.signal });
    }

    for (const button of document.querySelectorAll('[data-nav-action]')) {
      button.addEventListener('click', () => runNavigationAction(button.dataset.navAction), {
        signal: listeners.signal,
      });
    }
  }

  function setManualAxes(next) {
    for (const [property, value] of Object.entries(next)) {
      controls[property] = value;
      const name = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      required(`[data-control="${name}"]`).value = String(value);
      required(`[data-readout="${name}"]`).textContent = value.toFixed(2);
    }
  }

  function runNavigationAction(action) {
    if (action === 'route') {
      navigation.cancel();
      navigationPose = {
        observerPc: { ...navigationStart },
        orientationIcrs: { ...SPATIAL_IDENTITY_QUATERNION },
      };
      navigationTrail = [{ ...navigationStart }];
      navigation.lookAt({
        kind: 'direction',
        forwardIcrs: { x: 0.35, y: 0.12, z: 1 },
        source: { kind: 'example', id: 'preserved-route-aim' },
      });
      navigation.flyRoute(route);
      lastCommand = 'flyRoute(route)';
      return;
    }
    if (action === 'orbit') {
      navigation.orbit(deriveSpatialOrbitHandoff({
        positionPc: navigationPose.observerPc,
        orbit,
      }).orbit);
      lastCommand = 'orbit(handoff.orbit) · radius snap';
      return;
    }
    if (action === 'lock') {
      navigation.lockAt({
        kind: 'target',
        targetPc: orbit.centerPc,
        lock: true,
        source: { kind: 'example', id: 'orbit-center-lock' },
      });
      lastCommand = 'lockAt(center)';
      return;
    }
    if (action === 'look') {
      navigation.lookAt({
        kind: 'direction',
        forwardIcrs: { x: 0, y: 0, z: 1 },
        source: { kind: 'example', id: 'positive-z' },
      });
      lastCommand = 'lookAt(+Z)';
      return;
    }
    if (action === 'cancel-movement') {
      navigation.cancelMovement();
      lastCommand = 'cancelMovement()';
      return;
    }
    if (action === 'cancel-orientation') {
      navigation.cancelOrientation();
      lastCommand = 'cancelOrientation()';
      return;
    }
    if (action === 'reset') resetNavigation();
  }

  function tick(timeMs) {
    const deltaSecs = Math.min(0.05, Math.max(0, (timeMs - previousTimeMs) / 1000));
    previousTimeMs = timeMs;

    if (deltaSecs > 0) {
      for (const entry of models) {
        entry.pose = entry.model.update({
          pose: entry.pose,
          controls: controlReader,
          deltaSecs,
          scale: {
            navigationUnits: 'pc',
            metersPerNavigationUnit: 3.085677581491367e16,
            worldUnitsPerNavigationUnit: 1,
          },
        });
        appendTrail(entry.trail, entry.pose.observerPc, 360);
      }

      navigationPose = navigation.update({
        pose: navigationPose,
        deltaSecs,
        manualLookActive,
      });
      appendTrail(navigationTrail, navigationPose.observerPc, 520);
    }

    drawMotionComparison(motionCanvas, motionContext, models);
    drawNavigation(navigationCanvas, navigationContext, navigationPose, navigationTrail);
    if (timeMs - lastDomUpdateMs > 100) {
      updateReadouts();
      lastDomUpdateMs = timeMs;
    }
    animationFrame = requestAnimationFrame(tick);
  }

  function drawNavigation(canvas, context, pose, trail) {
    const { width, height, dpr } = prepareCanvas(canvas, context, 1100, 400);
    context.save();
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);
    drawGrid(context, 0, 0, width, height, 40);

    const bounds = { minX: -10, maxX: 9, minZ: -7, maxZ: 7 };
    const project = (point) => ({
      x: 38 + ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * (width - 76),
      y: height - 34 - ((point.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * (height - 68),
    });

    drawPolyline(context, routeSamples.map((sample) => project(sample.positionPc)), COLORS.route, 2);
    const center = project(orbit.centerPc);
    const edge = project({ x: orbit.centerPc.x + orbit.radiusPc, y: 0, z: orbit.centerPc.z });
    context.strokeStyle = COLORS.orbit;
    context.lineWidth = 1.5;
    context.setLineDash([7, 5]);
    context.beginPath();
    context.arc(center.x, center.y, Math.abs(edge.x - center.x), 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    drawPolyline(context, trail.map(project), 'rgba(255,255,255,0.38)', 1.2);
    const observer = project(pose.observerPc);
    const forward = applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, pose.orientationIcrs);
    const forwardEnd = project({
      x: pose.observerPc.x + forward.x * 2.2,
      y: pose.observerPc.y + forward.y * 2.2,
      z: pose.observerPc.z + forward.z * 2.2,
    });
    drawArrow(context, observer, forwardEnd, COLORS.aim);
    drawDot(context, observer, 6, COLORS.text);
    drawDot(context, center, 5, COLORS.orbit);

    context.fillStyle = COLORS.muted;
    context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText('authored route', 16, 22);
    context.fillStyle = COLORS.route;
    context.fillRect(124, 16, 28, 2);
    context.fillStyle = COLORS.muted;
    context.fillText('orbit', 172, 22);
    context.fillStyle = COLORS.orbit;
    context.fillRect(214, 16, 28, 2);
    context.fillStyle = COLORS.muted;
    context.fillText('aim', 262, 22);
    context.fillStyle = COLORS.aim;
    context.fillRect(290, 16, 28, 2);
    context.restore();
  }

  function updateReadouts() {
    const host = required('[data-readouts="motion"]');
    host.replaceChildren(...models.map((entry) => {
      const snapshot = entry.model.getSnapshot();
      const element = document.createElement('div');
      element.className = 'model-readout';
      element.innerHTML = `<strong style="color:${COLORS[entry.id]}">${entry.label}</strong><span>${formatNumber(snapshot.speedPcPerSec)} pc/s · ${formatVector(entry.pose.observerPc)}</span>`;
      return element;
    }));

    const diagnostics = navigation.getDiagnostics();
    const movementKind = diagnostics.activeMovement?.kind ?? 'idle';
    const aimKind = diagnostics.activeAim?.aim?.kind ?? 'none';
    const settle = diagnostics.pendingSettle;
    required('[data-status="manual"]').textContent = axisSample(controls.moveX, controls.moveY).active
      ? controls.boost ? 'boosting' : 'driving'
      : 'released';
    required('[data-status="navigation"]').textContent = lastCommand;
    required('[data-nav-readout="movement"]').textContent = movementKind;
    required('[data-nav-readout="aim"]').textContent = manualLookActive ? `${aimKind} (manual override)` : aimKind;
    required('[data-nav-readout="speed"]').textContent = `${formatNumber(diagnostics.currentSpeedPcPerSec)} pc/s`;
    required('[data-nav-readout="arrival"]').textContent = settle
      ? `settling ${formatNumber(settle.elapsedSecs)}/${formatNumber(settle.durationSecs)} s`
      : diagnostics.arrivalAction?.kind ?? 'none';

    required('[data-json="diagnostics"]').textContent = stringify({
      activeMovement: diagnostics.activeMovement && {
        kind: diagnostics.activeMovement.kind,
        distancePc: diagnostics.activeMovement.distancePc,
        totalLengthPc: diagnostics.activeMovement.totalLengthPc,
        speedPcPerSec: diagnostics.activeMovement.speedPcPerSec,
        orbit: diagnostics.activeMovement.orbit && {
          angleRad: diagnostics.activeMovement.orbit.angleRad,
          speedPcPerSec: diagnostics.activeMovement.orbit.speedPcPerSec,
        },
      },
      activeAim: diagnostics.activeAim && {
        kind: diagnostics.activeAim.aim?.kind ?? null,
        manualLookActive: diagnostics.activeAim.manualLookActive ?? false,
        targetLocked: Boolean(diagnostics.activeAim.targetLock),
      },
      currentSpeedPcPerSec: diagnostics.currentSpeedPcPerSec,
      pendingSettle: diagnostics.pendingSettle,
      arrivalAction: diagnostics.arrivalAction?.kind ?? null,
      navigationWarnings: diagnostics.warnings,
      routeWarnings: route.diagnostics.warnings,
      timingWarnings: route.timing.diagnostics.warnings,
      pose: navigation.getFrameState().pose,
    });
  }

  function renderStaticCommands() {
    required('[data-json="commands"]').textContent = stringify({
      manualModels: [
        ['createDirectSpatialMotionModel', { moveSpeedPcPerSec: 4 }],
        ['createInertialSpatialMotionModel', { accelerationPcPerSec2: 3, damping: 0.75, maxSpeedPcPerSec: 6 }],
        ['createThrustSpatialMotionModel', { thrustPcPerSec2: 6, mass: 2, drag: 0.28, maxSpeedPcPerSec: 6 }],
      ],
      route: {
        builder: 'buildSpatialPolylineRoute',
        pointsPc: route.pointsPc,
        timing: route.timing,
        arrivalAction: route.arrivalAction,
      },
      semanticCommands: [
        'flyRoute(route)',
        'orbit(orbit)',
        'lookAt(aim)',
        'lockAt(targetAim)',
        'cancelMovement()',
        'cancelOrientation()',
      ],
    });
  }

  function dispose() {
    cancelAnimationFrame(animationFrame);
    listeners.abort();
    for (const entry of models) entry.model.dispose?.();
    navigation.dispose();
  }
}

function drawMotionComparison(canvas, context, models) {
  const { width, height, dpr } = prepareCanvas(canvas, context, 1100, 430);
  context.save();
  context.scale(dpr, dpr);
  context.clearRect(0, 0, width, height);
  const gap = 12;
  const panelWidth = (width - gap * 4) / 3;
  const panelTop = 12;
  const panelHeight = height - 24;
  const extent = Math.max(7, ...models.flatMap((entry) => entry.trail.flatMap((point) => [Math.abs(point.x), Math.abs(point.z)])));

  models.forEach((entry, index) => {
    const left = gap + index * (panelWidth + gap);
    context.save();
    context.beginPath();
    context.roundRect(left, panelTop, panelWidth, panelHeight, 12);
    context.clip();
    drawGrid(context, left, panelTop, panelWidth, panelHeight, 32);
    const project = (point) => ({
      x: left + panelWidth / 2 + (point.x / extent) * panelWidth * 0.43,
      y: panelTop + panelHeight / 2 - (point.z / extent) * panelHeight * 0.43,
    });
    drawPolyline(context, entry.trail.map(project), COLORS[entry.id], 2);
    const position = project(entry.pose.observerPc);
    const forward = applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, entry.pose.orientationIcrs);
    drawArrow(context, position, {
      x: position.x + forward.x * 24,
      y: position.y - forward.z * 24,
    }, COLORS[entry.id]);
    drawDot(context, position, 5, COLORS.text);
    context.restore();

    context.fillStyle = COLORS[entry.id];
    context.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText(entry.label.toUpperCase(), left + 13, panelTop + 22);
    context.fillStyle = COLORS.muted;
    context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText(`${formatNumber(entry.model.getSnapshot().speedPcPerSec)} pc/s`, left + 13, panelTop + 39);
  });
  context.restore();
}

function prepareCanvas(canvas, context, designWidth, designHeight) {
  const cssWidth = Math.max(320, canvas.clientWidth || designWidth);
  const cssHeight = cssWidth * (designHeight / designWidth);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(cssWidth * dpr);
  const pixelHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  return { width: cssWidth, height: cssHeight, dpr };
}

function drawGrid(context, x, y, width, height, spacing) {
  context.fillStyle = 'rgba(2, 8, 16, 0.7)';
  context.fillRect(x, y, width, height);
  context.strokeStyle = COLORS.grid;
  context.lineWidth = 1;
  context.beginPath();
  for (let offset = spacing; offset < width; offset += spacing) {
    context.moveTo(x + offset, y);
    context.lineTo(x + offset, y + height);
  }
  for (let offset = spacing; offset < height; offset += spacing) {
    context.moveTo(x, y + offset);
    context.lineTo(x + width, y + offset);
  }
  context.stroke();
}

function drawPolyline(context, points, color, lineWidth) {
  if (points.length < 2) return;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
}

function drawArrow(context, from, to, color) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle - 0.55) * 8, to.y - Math.sin(angle - 0.55) * 8);
  context.lineTo(to.x - Math.cos(angle + 0.55) * 8, to.y - Math.sin(angle + 0.55) * 8);
  context.closePath();
  context.fill();
}

function drawDot(context, point, radius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}

function appendTrail(trail, point, maxLength) {
  const previous = trail.at(-1);
  if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) > 0.015) {
    trail.push({ ...point });
    if (trail.length > maxLength) trail.splice(0, trail.length - maxLength);
  }
}

function axisSample(x, y) {
  const magnitude = Math.min(1, Math.hypot(x, y));
  return { x, y, magnitude, active: magnitude > 0 };
}

function clonePose(pose) {
  return {
    observerPc: { ...pose.observerPc },
    orientationIcrs: { ...pose.orientationIcrs },
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatVector(vector) {
  return `(${formatNumber(vector.x)}, ${formatNumber(vector.y)}, ${formatNumber(vector.z)}) pc`;
}

function stringify(value) {
  return JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'number' && Number.isFinite(entry)) return Number(entry.toFixed(5));
    return entry;
  }, 2);
}

function required(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing example element: ${selector}`);
  return element;
}
