import {
  SPATIAL_IDENTITY_QUATERNION,
  buildSpatialViewTransitionPath,
  evaluateSpatialAim,
  evaluateSpatialPathPlayback,
  evaluateSpatialViewTransition,
  materializeSpatialPreloadHints,
  normalizeSpatialPathSpec,
  sampleSpatialPath,
  sampleSpatialPathDiagnostics,
} from '@found-in-space/spatial';

const PATH_DURATION_SECS = 6;
const PLAYBACK_DURATION_SECS = 8;
const SAMPLE_STEP_SECS = 0.125;
const POSITION_KEYS = Object.freeze([
  { id: 'departure', timeSecs: 0, positionPc: { x: -4.5, y: 0, z: 1.2 } },
  { id: 'climb', timeSecs: 2, positionPc: { x: -1.5, y: 0, z: -2.5 } },
  { id: 'swing', timeSecs: 4, positionPc: { x: 2.2, y: 0, z: 2.7 } },
  { id: 'arrival', timeSecs: 6, positionPc: { x: 5.2, y: 0, z: -0.8 } },
]);
const AIM_KEYS = Object.freeze([
  { id: 'aim-a', timeSecs: 0, targetPc: { x: -0.5, y: 0, z: -3.4 } },
  { id: 'aim-b', timeSecs: 3, targetPc: { x: 1.5, y: 0, z: 3.8 } },
  { id: 'aim-c', timeSecs: 6, targetPc: { x: 6.2, y: 0, z: 2.2 } },
]);
const PLOT_BOUNDS = Object.freeze({ minX: -6, maxX: 7.5, minZ: -4.5, maxZ: 4.8 });
const COLORS = Object.freeze({
  grid: 'rgba(148, 187, 224, 0.15)',
  axes: 'rgba(178, 242, 255, 0.28)',
  path: '#78dcff',
  pathSoft: 'rgba(120, 220, 255, 0.18)',
  warm: '#ffc778',
  aim: '#ff9fcb',
  velocity: '#b8ff8a',
  text: '#dcecff',
  muted: '#8da8c2',
  surface: '#07111f',
});

const elements = {
  interpolation: document.querySelector('[data-interpolation]'),
  easedPlayback: document.querySelector('[data-eased-playback]'),
  scrub: document.querySelector('[data-scrub]'),
  play: document.querySelector('[data-play]'),
  reset: document.querySelector('[data-reset]'),
  playState: document.querySelector('[data-play-state]'),
  positionDelay: document.querySelector('[data-position-delay]'),
  positionDuration: document.querySelector('[data-position-duration]'),
  aimDelay: document.querySelector('[data-aim-delay]'),
  aimDuration: document.querySelector('[data-aim-duration]'),
  pathCanvas: document.querySelector('[data-path-canvas]'),
  transitionCanvas: document.querySelector('[data-transition-canvas]'),
  interpolationState: document.querySelector('[data-interpolation-state]'),
  specJson: document.querySelector('[data-spec-json]'),
  diagnosticsJson: document.querySelector('[data-diagnostics-json]'),
};

for (const [name, element] of Object.entries(elements)) {
  if (!element) throw new Error(`Paths and transitions lab requires [${name}].`);
}

const readouts = new Map(
  Array.from(document.querySelectorAll('[data-readout]'), (element) => [element.dataset.readout, element]),
);

let elapsedSecs = 0;
let previousFrameTime = null;
let playing = false;
let path = null;
let pathSamples = [];
let pathDiagnostics = null;
let preloadHints = [];
let transitionSpec = null;
let transition = null;

elements.scrub.max = String(PLAYBACK_DURATION_SECS);
elements.interpolation.addEventListener('change', rebuildPath);
elements.easedPlayback.addEventListener('change', rebuildPath);
elements.scrub.addEventListener('input', () => {
  elapsedSecs = clamp(Number(elements.scrub.value), 0, PLAYBACK_DURATION_SECS);
  setPlaying(false);
  render();
});
elements.play.addEventListener('click', () => {
  if (elapsedSecs >= PLAYBACK_DURATION_SECS) elapsedSecs = 0;
  setPlaying(!playing);
});
elements.reset.addEventListener('click', () => {
  elapsedSecs = 0;
  setPlaying(false);
  render();
});
for (const input of [
  elements.positionDelay,
  elements.positionDuration,
  elements.aimDelay,
  elements.aimDuration,
]) {
  input.addEventListener('input', rebuildTransition);
}

rebuildPath();
requestAnimationFrame(update);

function rebuildPath() {
  const interpolationKind = elements.interpolation.value;
  path = normalizeSpatialPathSpec({
    durationSecs: PATH_DURATION_SECS,
    positionKeys: POSITION_KEYS.map((key, index) => ({
      ...key,
      interpolation: createPositionInterpolation(interpolationKind, index),
    })),
    aimKeys: AIM_KEYS.map((key) => ({
      id: key.id,
      timeSecs: key.timeSecs,
      aim: { kind: 'target', targetPc: key.targetPc },
      interpolation: {
        kind: 'targetBezier',
        easing: { kind: 'smoothstep' },
      },
    })),
    timeRemap: elements.easedPlayback.checked
      ? {
          kind: 'eased',
          playbackDurationSecs: PLAYBACK_DURATION_SECS,
          easing: { kind: 'easeInOut', power: 2.25 },
        }
      : {
          kind: 'linear',
          playbackDurationSecs: PLAYBACK_DURATION_SECS,
        },
    metadata: { lesson: 'paths-transitions', interpolationKind },
  });
  pathSamples = sampleSpatialPath(path, { sampleStepSecs: SAMPLE_STEP_SECS });
  pathDiagnostics = sampleSpatialPathDiagnostics(path, { sampleStepSecs: SAMPLE_STEP_SECS });
  preloadHints = materializeSpatialPreloadHints(path, {
    sampleStepSecs: 0.5,
    pathRadiusPc: 0.34,
    sphereRadiusPc: 0.16,
    lookaheadSecs: 0.7,
    priority: 3,
  });
  elements.interpolationState.textContent = interpolationKind;
  rebuildTransition();
}

function rebuildTransition() {
  const positionDelaySecs = readLaneNumber(elements.positionDelay, 0.4);
  const positionDurationSecs = readLaneDuration(elements.positionDuration, 3.2, positionDelaySecs);
  const aimDelaySecs = readLaneNumber(elements.aimDelay, 1.4);
  const aimDurationSecs = readLaneDuration(elements.aimDuration, 5.2, aimDelaySecs);
  const fromPosition = POSITION_KEYS[0].positionPc;
  const toPosition = POSITION_KEYS.at(-1).positionPc;
  const fromAim = evaluateSpatialAim({
    observerPc: fromPosition,
    aim: { kind: 'target', targetPc: AIM_KEYS[0].targetPc },
  });
  const toAim = evaluateSpatialAim({
    observerPc: toPosition,
    aim: { kind: 'target', targetPc: AIM_KEYS.at(-1).targetPc },
  });
  transitionSpec = {
    durationSecs: PLAYBACK_DURATION_SECS,
    from: {
      pose: { observerPc: fromPosition, orientationIcrs: fromAim.orientationIcrs },
      aim: fromAim,
    },
    to: {
      pose: { observerPc: toPosition, orientationIcrs: toAim.orientationIcrs },
      aim: toAim,
    },
    position: {
      delaySecs: positionDelaySecs,
      durationSecs: positionDurationSecs,
      interpolation: 'smoothstep',
    },
    aim: {
      delaySecs: aimDelaySecs,
      durationSecs: aimDurationSecs,
      interpolation: 'easeInOut',
      easing: { kind: 'easeInOut', power: 2 },
    },
    metadata: { lesson: 'independent-transition-lanes' },
  };
  transition = buildSpatialViewTransitionPath(transitionSpec);
  render();
}

function update(frameTime) {
  if (previousFrameTime == null) previousFrameTime = frameTime;
  const deltaSecs = Math.min(0.1, Math.max(0, (frameTime - previousFrameTime) / 1000));
  previousFrameTime = frameTime;
  if (playing) {
    elapsedSecs = Math.min(PLAYBACK_DURATION_SECS, elapsedSecs + deltaSecs);
    if (elapsedSecs >= PLAYBACK_DURATION_SECS) setPlaying(false);
    render();
  }
  requestAnimationFrame(update);
}

function render() {
  if (!path || !transition) return;
  const pathSample = evaluateSpatialPathPlayback(path, elapsedSecs);
  const transitionSample = evaluateSpatialViewTransition(transition, elapsedSecs);
  elements.scrub.value = String(elapsedSecs);
  drawPathPlot(elements.pathCanvas, pathSample);
  drawTransitionPlot(elements.transitionCanvas, transitionSample);
  updateReadouts(pathSample, transitionSample);
  renderJson(pathSample, transitionSample);
}

function drawPathPlot(canvas, current) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  drawBackground(context, width, height);
  const project = createPlotProjection(width, height);
  drawPlotGrid(context, project, width, height);

  const pathVolume = preloadHints.find((hint) => hint.kind === 'pathVolume');
  if (pathVolume) {
    context.save();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = COLORS.pathSoft;
    context.lineWidth = Math.max(8, project.scale * pathVolume.radiusPc * 2);
    strokePoints(context, pathVolume.pointsPc, project);
    context.restore();
  }

  context.save();
  context.setLineDash([4, 7]);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(184, 255, 138, 0.14)';
  for (const hint of preloadHints.filter((entry) => entry.kind === 'viewLookahead')) {
    const end = addScaled(hint.pose.observerPc, hint.velocityPcPerSec, hint.lookaheadSecs);
    strokeSegment(context, project(hint.pose.observerPc), project(end));
  }
  context.restore();

  context.save();
  context.strokeStyle = 'rgba(255, 199, 120, 0.28)';
  context.lineWidth = 1.5;
  const spheres = preloadHints.filter((hint) => hint.kind === 'sphereVolume');
  for (let index = 0; index < spheres.length; index += 2) {
    const hint = spheres[index];
    const point = project(hint.centerPc);
    context.beginPath();
    context.arc(point.x, point.y, Math.max(2, project.scale * hint.radiusPc), 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();

  context.save();
  context.strokeStyle = COLORS.path;
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  strokePoints(context, pathSamples.map((sample) => sample.pose.observerPc), project);
  context.restore();

  for (const key of POSITION_KEYS) {
    const point = project(key.positionPc);
    drawDot(context, point, 6, COLORS.surface, COLORS.warm, 2);
    drawLabel(context, key.id, point.x + 9, point.y - 9, COLORS.muted);
  }

  const observer = project(current.pose.observerPc);
  drawDot(context, observer, 9, COLORS.path, '#e9fbff', 2);
  drawVectorArrow(context, project, current.pose.observerPc, current.velocityPcPerSec, 0.52, COLORS.velocity, 'velocity');

  if (current.aim) {
    drawVectorArrow(context, project, current.pose.observerPc, current.aim.forwardIcrs, 2.2, COLORS.aim, 'aim');
    if (current.aim.kind === 'target') {
      const target = project(current.aim.targetPc);
      drawCross(context, target, 7, COLORS.aim);
      drawLabel(context, 'target', target.x + 9, target.y - 8, COLORS.aim);
    }
  }

  drawLegend(context, [
    [COLORS.path, 'sampleSpatialPath()'],
    [COLORS.velocity, 'current velocity'],
    [COLORS.aim, 'current aim'],
    [COLORS.warm, 'preload spheres / corridor'],
  ], 22, height - 25);
}

function drawTransitionPlot(canvas, current) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  drawBackground(context, width, height);
  const left = 150;
  const right = width - 45;
  const timelineWidth = right - left;
  const toX = (timeSecs) => left + clamp(timeSecs / transition.durationSecs, 0, 1) * timelineWidth;

  context.save();
  context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';
  context.fillStyle = COLORS.muted;
  for (let second = 0; second <= transition.durationSecs; second += 1) {
    const x = toX(second);
    context.strokeStyle = COLORS.grid;
    context.beginPath();
    context.moveTo(x, 68);
    context.lineTo(x, 350);
    context.stroke();
    context.fillText(`${second}s`, x, 54);
  }
  context.restore();

  drawLane(context, {
    label: 'position',
    y: 130,
    color: COLORS.path,
    delaySecs: transition.diagnostics.positionDelaySecs,
    durationSecs: transition.diagnostics.positionDurationSecs,
    complete: current.positionComplete,
    toX,
    left,
    right,
  });
  drawLane(context, {
    label: 'aim',
    y: 255,
    color: COLORS.aim,
    delaySecs: transition.diagnostics.aimDelaySecs,
    durationSecs: transition.diagnostics.aimDurationSecs,
    complete: current.aimComplete,
    toX,
    left,
    right,
  });

  const cursorX = toX(current.elapsedSecs);
  context.save();
  context.strokeStyle = COLORS.warm;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cursorX, 65);
  context.lineTo(cursorX, 340);
  context.stroke();
  drawLabel(context, `${current.elapsedSecs.toFixed(2)}s`, cursorX + 7, 82, COLORS.warm);
  context.restore();

  const cardY = 385;
  context.save();
  context.fillStyle = 'rgba(2, 8, 16, 0.64)';
  context.strokeStyle = 'rgba(129, 194, 255, 0.18)';
  roundRect(context, 34, cardY, width - 68, 112, 12);
  context.fill();
  context.stroke();
  context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = COLORS.text;
  context.fillText(`observer  ${formatVector(current.pose.observerPc)}`, 54, cardY + 31);
  context.fillStyle = COLORS.muted;
  context.fillText(`positionComplete  ${String(current.positionComplete)}`, 54, cardY + 58);
  context.fillText(`aimComplete       ${String(current.aimComplete)}`, 54, cardY + 82);
  if (current.frameState.aim) {
    context.fillStyle = COLORS.aim;
    context.fillText(`forward  ${formatVector(current.frameState.aim.forwardIcrs)}`, width / 2, cardY + 31);
  }
  context.restore();
}

function drawLane(context, options) {
  const activeStart = options.toX(options.delaySecs);
  const activeEnd = options.toX(options.delaySecs + options.durationSecs);
  context.save();
  context.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = COLORS.text;
  context.textAlign = 'right';
  context.fillText(options.label, options.left - 17, options.y + 6);
  context.fillStyle = 'rgba(82, 107, 133, 0.24)';
  roundRect(context, options.left, options.y - 18, options.right - options.left, 36, 8);
  context.fill();
  context.fillStyle = options.color;
  context.globalAlpha = 0.78;
  roundRect(context, activeStart, options.y - 18, Math.max(2, activeEnd - activeStart), 36, 8);
  context.fill();
  context.globalAlpha = 1;
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'left';
  context.fillStyle = COLORS.muted;
  context.fillText(`delay ${options.delaySecs.toFixed(1)}s`, options.left, options.y + 42);
  context.textAlign = 'right';
  context.fillText(`duration ${options.durationSecs.toFixed(1)}s`, options.right, options.y + 42);
  context.fillStyle = options.complete ? COLORS.velocity : COLORS.warm;
  context.fillText(options.complete ? 'complete' : 'active / waiting', options.right, options.y - 29);
  context.restore();
}

function updateReadouts(pathSample, transitionSample) {
  setReadout('playback', `${elapsedSecs.toFixed(2)} / ${PLAYBACK_DURATION_SECS.toFixed(2)} s`);
  setReadout('path-time', `${pathSample.timeSecs.toFixed(2)} / ${PATH_DURATION_SECS.toFixed(2)} s`);
  setReadout('speed', `${pathSample.speedPcPerSec.toFixed(2)} pc/s`);
  setReadout('aim', pathSample.aim?.kind ?? 'none');
  setReadout('position-lane', laneState(
    elapsedSecs,
    transition.diagnostics.positionDelaySecs,
    transition.diagnostics.positionDurationSecs,
  ));
  setReadout('aim-lane', laneState(
    elapsedSecs,
    transition.diagnostics.aimDelaySecs,
    transition.diagnostics.aimDurationSecs,
  ));
  const hintCounts = countByKind(preloadHints);
  setReadout(
    'preload',
    `${preloadHints.length} (${Object.entries(hintCounts).map(([kind, count]) => `${kind}:${count}`).join(', ')})`,
  );
}

function renderJson(pathSample, transitionSample) {
  elements.specJson.textContent = prettyJson({
    path,
    transition: transitionSpec,
  });
  elements.diagnosticsJson.textContent = prettyJson({
    pathDiagnostics,
    transitionDiagnostics: transition.diagnostics,
    current: {
      path: {
        playbackElapsedSecs: pathSample.playbackElapsedSecs,
        timeSecs: pathSample.timeSecs,
        observerPc: pathSample.pose.observerPc,
        velocityPcPerSec: pathSample.velocityPcPerSec,
        speedPcPerSec: pathSample.speedPcPerSec,
        aim: pathSample.aim,
      },
      transition: {
        elapsedSecs: transitionSample.elapsedSecs,
        positionComplete: transitionSample.positionComplete,
        aimComplete: transitionSample.aimComplete,
      },
    },
    preloadHints: preloadHints.map(summarizePreloadHint),
  });
}

function createPositionInterpolation(kind, index) {
  if (kind === 'hold') return { kind: 'hold' };
  if (kind === 'linear') return { kind: 'linear' };
  if (kind === 'catmullRom') return { kind: 'catmullRom', tension: 0.08, centripetal: true };
  if (kind === 'cubicBezier') {
    const outTangents = [
      { x: 1.2, y: 0, z: -1.8 },
      { x: 1.5, y: 0, z: 1.9 },
      { x: 1.2, y: 0, z: -1.6 },
      { x: 0.8, y: 0, z: 0.5 },
    ];
    const inTangents = [
      { x: -0.8, y: 0, z: 0.6 },
      { x: -1.2, y: 0, z: -1.6 },
      { x: -1.4, y: 0, z: 1.6 },
      { x: -1.1, y: 0, z: 1.4 },
    ];
    return { kind: 'cubicBezier', outTangentPc: outTangents[index], inTangentPc: inTangents[index] };
  }
  const velocities = [
    { x: 1.2, y: 0, z: -1.8 },
    { x: 2.4, y: 0, z: 1.1 },
    { x: 2.0, y: 0, z: -1.0 },
    { x: 1.1, y: 0, z: -1.4 },
  ];
  return { kind: 'hermite', inVelocityPcPerSec: velocities[index], outVelocityPcPerSec: velocities[index] };
}

function createPlotProjection(width, height) {
  const margin = 54;
  const plotWidth = width - margin * 2;
  const plotHeight = height - margin * 2;
  const scaleX = plotWidth / (PLOT_BOUNDS.maxX - PLOT_BOUNDS.minX);
  const scaleZ = plotHeight / (PLOT_BOUNDS.maxZ - PLOT_BOUNDS.minZ);
  const project = (point) => ({
    x: margin + (point.x - PLOT_BOUNDS.minX) * scaleX,
    y: height - margin - (point.z - PLOT_BOUNDS.minZ) * scaleZ,
  });
  project.scale = Math.min(scaleX, scaleZ);
  project.margin = margin;
  return project;
}

function drawBackground(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#081523');
  gradient.addColorStop(1, '#020711');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawPlotGrid(context, project, width, height) {
  context.save();
  context.lineWidth = 1;
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = COLORS.muted;
  for (let x = Math.ceil(PLOT_BOUNDS.minX); x <= PLOT_BOUNDS.maxX; x += 1) {
    const point = project({ x, y: 0, z: 0 });
    context.strokeStyle = x === 0 ? COLORS.axes : COLORS.grid;
    strokeSegment(context, { x: point.x, y: project.margin }, { x: point.x, y: height - project.margin });
    context.fillText(String(x), point.x + 3, height - project.margin + 17);
  }
  for (let z = Math.ceil(PLOT_BOUNDS.minZ); z <= PLOT_BOUNDS.maxZ; z += 1) {
    const point = project({ x: 0, y: 0, z });
    context.strokeStyle = z === 0 ? COLORS.axes : COLORS.grid;
    strokeSegment(context, { x: project.margin, y: point.y }, { x: width - project.margin, y: point.y });
    context.fillText(String(z), project.margin - 25, point.y - 3);
  }
  context.fillStyle = COLORS.muted;
  context.fillText('x / pc', width - project.margin - 32, height - 18);
  context.fillText('z / pc', 12, project.margin - 12);
  context.restore();
}

function strokePoints(context, points, project) {
  if (points.length === 0) return;
  context.beginPath();
  const first = project(points[0]);
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    const projected = project(point);
    context.lineTo(projected.x, projected.y);
  }
  context.stroke();
}

function drawVectorArrow(context, project, originValue, vector, scale, color, label) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!(length > 1e-8)) return;
  const factor = scale / Math.max(1, length);
  const endValue = addScaled(originValue, vector, factor);
  const origin = project(originValue);
  const end = project(endValue);
  const angle = Math.atan2(end.y - origin.y, end.x - origin.x);
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2.5;
  strokeSegment(context, origin, end);
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - 11 * Math.cos(angle - 0.45), end.y - 11 * Math.sin(angle - 0.45));
  context.lineTo(end.x - 11 * Math.cos(angle + 0.45), end.y - 11 * Math.sin(angle + 0.45));
  context.closePath();
  context.fill();
  drawLabel(context, label, end.x + 7, end.y - 8, color);
  context.restore();
}

function drawDot(context, point, radius, fill, stroke, lineWidth) {
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

function drawCross(context, point, radius, color) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2;
  strokeSegment(context, { x: point.x - radius, y: point.y }, { x: point.x + radius, y: point.y });
  strokeSegment(context, { x: point.x, y: point.y - radius }, { x: point.x, y: point.y + radius });
  context.restore();
}

function drawLabel(context, text, x, y, color) {
  context.save();
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillStyle = color;
  context.fillText(text, x, y);
  context.restore();
}

function drawLegend(context, entries, x, y) {
  context.save();
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  let cursor = x;
  for (const [color, label] of entries) {
    context.fillStyle = color;
    context.fillRect(cursor, y - 8, 12, 3);
    context.fillStyle = COLORS.muted;
    context.fillText(label, cursor + 17, y - 3);
    cursor += context.measureText(label).width + 42;
  }
  context.restore();
}

function strokeSegment(context, start, end) {
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, Math.max(0, width), height, radius);
}

function setPlaying(next) {
  playing = next;
  elements.play.textContent = playing ? 'Pause' : elapsedSecs >= PLAYBACK_DURATION_SECS ? 'Replay' : 'Play';
  elements.play.setAttribute('aria-pressed', String(playing));
  elements.playState.textContent = playing ? 'playing' : elapsedSecs >= PLAYBACK_DURATION_SECS ? 'complete' : 'paused';
  previousFrameTime = null;
}

function setReadout(name, value) {
  const element = readouts.get(name);
  if (element) element.textContent = value;
}

function laneState(elapsed, delay, duration) {
  if (elapsed < delay) return 'waiting';
  if (elapsed >= delay + duration) return 'complete';
  const progress = duration > 0 ? (elapsed - delay) / duration : 1;
  return `${Math.round(progress * 100)}%`;
}

function readLaneNumber(input, fallback) {
  const value = clamp(Number(input.value), 0, PLAYBACK_DURATION_SECS);
  const resolved = Number.isFinite(value) ? value : fallback;
  input.value = resolved.toFixed(1);
  return resolved;
}

function readLaneDuration(input, fallback, delaySecs) {
  const value = Number(input.value);
  const resolved = clamp(Number.isFinite(value) ? value : fallback, 0, PLAYBACK_DURATION_SECS - delaySecs);
  input.value = resolved.toFixed(1);
  return resolved;
}

function summarizePreloadHint(hint) {
  if (hint.kind === 'pathVolume') {
    return {
      kind: hint.kind,
      pointCount: hint.pointsPc.length,
      radiusPc: hint.radiusPc,
      timeRangeSecs: hint.timeRangeSecs,
      priority: hint.priority,
    };
  }
  if (hint.kind === 'sphereVolume') {
    return {
      kind: hint.kind,
      centerPc: hint.centerPc,
      radiusPc: hint.radiusPc,
      timeRangeSecs: hint.timeRangeSecs,
      priority: hint.priority,
    };
  }
  return {
    kind: hint.kind,
    pose: hint.pose,
    velocityPcPerSec: hint.velocityPcPerSec,
    lookaheadSecs: hint.lookaheadSecs,
    timeRangeSecs: hint.timeRangeSecs,
    priority: hint.priority,
  };
}

function countByKind(values) {
  return values.reduce((counts, value) => {
    counts[value.kind] = (counts[value.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function prettyJson(value) {
  return JSON.stringify(value, (_key, entry) => (
    typeof entry === 'number' && Number.isFinite(entry)
      ? Number(entry.toFixed(5))
      : entry
  ), 2);
}

function formatVector(vector) {
  return `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`;
}

function addScaled(origin, vector, scale) {
  return {
    x: origin.x + vector.x * scale,
    y: origin.y + vector.y * scale,
    z: origin.z + vector.z * scale,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
