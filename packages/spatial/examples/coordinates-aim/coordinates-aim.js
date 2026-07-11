import {
  SPATIAL_LOCAL_FORWARD,
  SPATIAL_LOCAL_RIGHT,
  SPATIAL_LOCAL_UP,
  applySpatialQuaternion,
  evaluateSpatialAim,
  getSpatialVectorLength,
  icrsDirectionToTargetPc,
  icrsToRaDec,
  normalizeSpatialAimSpec,
  normalizeSpatialDirection,
  normalizeSpatialTarget,
  projectSpatialEquirectangular,
  raDecToIcrsDirection,
  resolveSpatialTarget,
  subtractSpatialVectors,
} from '@found-in-space/spatial';

const form = document.querySelector('[data-controls]');
const canvas = document.querySelector('[data-visualization]');
const context = canvas?.getContext('2d');

if (!(form instanceof HTMLFormElement) || !(canvas instanceof HTMLCanvasElement) || !context) {
  throw new Error('Coordinates & Aim requires its controls and a Canvas2D context.');
}

const fields = Object.fromEntries(
  [...form.querySelectorAll('[data-field]')].map((element) => [element.dataset.field, element]),
);
const output = {
  positionAngle: document.querySelector('[data-position-angle-output]'),
  status: document.querySelector('[data-status]'),
  semantics: document.querySelector('[data-semantics-copy]'),
  warningSummary: document.querySelector('[data-warning-summary]'),
  resolvedPosition: document.querySelector('[data-resolved-position]'),
  evaluatedForward: document.querySelector('[data-evaluated-forward]'),
  roundTripOrigin: document.querySelector('[data-roundtrip-origin]'),
  roundTripObserver: document.querySelector('[data-roundtrip-observer]'),
  authoredJson: document.querySelector('[data-authored-json]'),
  resultJson: document.querySelector('[data-result-json]'),
  diagnosticsJson: document.querySelector('[data-diagnostics-json]'),
};

let currentModel = null;

form.addEventListener('input', update);
form.addEventListener('change', update);

const resizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(() => renderCanvas(currentModel))
  : null;
resizeObserver?.observe(canvas);
window.addEventListener('resize', () => renderCanvas(currentModel));

update();

function update() {
  const authored = readAuthoredValues();
  output.positionAngle.textContent = `${formatNumber(authored.positionAngleDeg, 0)}°`;

  try {
    currentModel = evaluateAuthoredValues(authored);
    renderReadouts(currentModel);
    renderJson(currentModel);
    renderStatus(currentModel);
  } catch (error) {
    currentModel = null;
    renderError(error, authored);
  }
  renderCanvas(currentModel);
}

function readAuthoredValues() {
  return {
    semantics: fields.semantics.value,
    raDeg: numberFromInput(fields.raDeg),
    decDeg: numberFromInput(fields.decDeg),
    distancePc: numberFromInput(fields.distancePc),
    observerPc: {
      x: numberFromInput(fields.observerX),
      y: numberFromInput(fields.observerY),
      z: numberFromInput(fields.observerZ),
    },
    positionAngleDeg: numberFromInput(fields.positionAngleDeg),
    degenerateUp: fields.degenerateUp.checked,
  };
}

function evaluateAuthoredValues(authored) {
  const targetSpec = normalizeSpatialTarget({
    kind: 'radec',
    raDeg: authored.raDeg,
    decDeg: authored.decDeg,
    distancePc: authored.distancePc,
  });
  const resolvedTargetPc = resolveSpatialTarget(targetSpec);
  if (!resolvedTargetPc || typeof resolvedTargetPc.then === 'function') {
    throw new Error('The synchronous RA/Dec target did not resolve to a position.');
  }

  const authoredDirectionIcrs = raDecToIcrsDirection({
    raDeg: authored.raDeg,
    decDeg: authored.decDeg,
  });
  if (!authoredDirectionIcrs) {
    throw new TypeError('RA and Dec must resolve to an ICRS direction.');
  }

  const targetOffset = subtractSpatialVectors(resolvedTargetPc, authored.observerPc);
  const targetDistanceFromObserverPc = getSpatialVectorLength(targetOffset);
  const expectedForwardIcrs = authored.semantics === 'target'
    ? normalizeSpatialDirection(targetOffset)
    : authoredDirectionIcrs;
  const aimSpec = normalizeSpatialAimSpec({
    ...(authored.semantics === 'target'
      ? { kind: 'target', targetPc: resolvedTargetPc }
      : { kind: 'direction', forwardIcrs: authoredDirectionIcrs }),
    positionAngleDeg: authored.positionAngleDeg,
    ...(authored.degenerateUp ? { upIcrs: expectedForwardIcrs } : {}),
  });
  const aimInput = {
    observerPc: authored.observerPc,
    aim: aimSpec,
    syntheticTargetDistancePc: authored.distancePc,
  };
  const aimSample = evaluateSpatialAim(aimInput);
  const directionTargetPc = icrsDirectionToTargetPc(
    authoredDirectionIcrs,
    authored.distancePc,
    authored.observerPc,
  );
  if (!directionTargetPc) {
    throw new Error('The direction could not be materialized for the round-trip comparison.');
  }

  const originRaDec = icrsToRaDec(resolvedTargetPc);
  const observerRaDec = icrsToRaDec(resolvedTargetPc, authored.observerPc);
  const directionRaDec = icrsToRaDec(directionTargetPc, authored.observerPc);
  const evaluatedRaDec = icrsToRaDec(aimSample.forwardIcrs);
  if (!originRaDec || !evaluatedRaDec || !directionRaDec) {
    throw new Error('The evaluated coordinate could not be converted back to RA/Dec.');
  }

  const orientationBasisIcrs = {
    right: applySpatialQuaternion(SPATIAL_LOCAL_RIGHT, aimSample.orientationIcrs),
    up: applySpatialQuaternion(SPATIAL_LOCAL_UP, aimSample.orientationIcrs),
    forward: applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, aimSample.orientationIcrs),
  };
  const stableProjection = {
    authored: projectSpatialEquirectangular({
      raDeg: authored.raDeg,
      decDeg: authored.decDeg,
      width: 360,
      height: 180,
    }),
    evaluated: projectSpatialEquirectangular({
      ...evaluatedRaDec,
      width: 360,
      height: 180,
    }),
  };
  const diagnostics = aimSample.diagnostics ?? { warnings: [] };

  return {
    authored,
    canonicalInput: {
      authoredControls: authored,
      calls: {
        resolveSpatialTarget: { input: targetSpec },
        evaluateSpatialAim: { input: aimInput },
      },
    },
    result: {
      resolvedTargetPc,
      authoredDirectionIcrs,
      aimSample,
      orientationBasisIcrs,
      roundTrip: {
        resolvedTargetAtIcrsOrigin: {
          ...originRaDec,
          distancePc: getSpatialVectorLength(resolvedTargetPc),
        },
        resolvedTargetAtObserver: observerRaDec
          ? { ...observerRaDec, distancePc: targetDistanceFromObserverPc }
          : null,
        directionAtObserver: {
          targetPc: directionTargetPc,
          ...directionRaDec,
          distancePc: getSpatialVectorLength(
            subtractSpatialVectors(directionTargetPc, authored.observerPc),
          ),
        },
      },
      projectedSky360x180: stableProjection,
    },
    diagnostics,
    sky: {
      authoredRaDec: { raDeg: authored.raDeg, decDeg: authored.decDeg },
      evaluatedRaDec,
    },
  };
}

function renderReadouts(model) {
  const { authored, result } = model;
  output.resolvedPosition.textContent = formatVector(result.resolvedTargetPc, ' pc');
  output.evaluatedForward.textContent = formatVector(result.aimSample.forwardIcrs);
  output.roundTripOrigin.textContent = formatRaDec(
    result.roundTrip.resolvedTargetAtIcrsOrigin,
    result.roundTrip.resolvedTargetAtIcrsOrigin.distancePc,
  );
  output.roundTripObserver.textContent = result.roundTrip.resolvedTargetAtObserver
    ? formatRaDec(
        result.roundTrip.resolvedTargetAtObserver,
        result.roundTrip.resolvedTargetAtObserver.distancePc,
      )
    : 'Target coincides with observer; RA/Dec is undefined.';
  output.semantics.textContent = authored.semantics === 'target'
    ? 'Target aim follows a finite ICRS position. Moving the observer changes the evaluated forward direction and distance.'
    : 'Direction aim is observer-independent. Distance is used only to materialize a synthetic comparison point.';
}

function renderJson(model) {
  output.authoredJson.textContent = stringifyExact(model.canonicalInput);
  output.resultJson.textContent = stringifyExact(model.result);
  output.diagnosticsJson.textContent = stringifyExact(model.diagnostics);
}

function renderStatus(model) {
  const warnings = model.diagnostics.warnings ?? [];
  const recovered = warnings.some((warning) => warning.code === 'degenerateAimUp');
  output.status.dataset.state = warnings.length > 0 ? 'warning' : 'ready';
  output.status.textContent = recovered
    ? 'Degenerate up recovered with a deterministic perpendicular'
    : warnings.length > 0
      ? `${warnings.length} diagnostic warning${warnings.length === 1 ? '' : 's'}`
      : 'Canonical input accepted';
  output.warningSummary.textContent = warnings.length > 0
    ? warnings.map((warning) => warning.code).join(', ')
    : 'No diagnostics';
}

function renderError(error, authored) {
  const detail = {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
  output.status.dataset.state = 'error';
  output.status.textContent = detail.message;
  output.warningSummary.textContent = 'Input rejected';
  output.semantics.textContent = 'The strict canonical contract rejected this authored value.';
  output.resolvedPosition.textContent = '—';
  output.evaluatedForward.textContent = '—';
  output.roundTripOrigin.textContent = '—';
  output.roundTripObserver.textContent = '—';
  output.authoredJson.textContent = stringifyExact({ authoredControls: authored });
  output.resultJson.textContent = stringifyExact({ error: detail });
  output.diagnosticsJson.textContent = stringifyExact({ warnings: [], error: detail });
}

function renderCanvas(model) {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(320, Math.round(bounds.width || canvas.width || 960));
  const cssHeight = Math.max(480, Math.round(bounds.height || cssWidth * 0.71));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.round(cssWidth * pixelRatio);
  const nextHeight = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = '#050b14';
  context.fillRect(0, 0, cssWidth, cssHeight);

  if (!model) {
    context.fillStyle = '#ffbd9d';
    context.font = '600 15px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('Correct the authored input to render the spatial result.', cssWidth / 2, cssHeight / 2);
    return;
  }

  const margin = cssWidth < 560 ? 22 : 34;
  const sky = {
    x: margin,
    y: 54,
    width: cssWidth - margin * 2,
    height: Math.min(340, Math.max(230, cssHeight * 0.48)),
  };
  drawSkyMap(model, sky);

  const basisTop = sky.y + sky.height + 60;
  drawOrientationBasis(model, {
    x: margin,
    y: basisTop,
    width: cssWidth - margin * 2,
    height: cssHeight - basisTop - 24,
  });
}

function drawSkyMap(model, area) {
  context.fillStyle = '#9fb3c8';
  context.font = '600 12px system-ui, sans-serif';
  context.textAlign = 'left';
  context.fillText('EQUIRECTANGULAR ICRS SKY · RA INCREASES →', area.x, area.y - 22);

  context.fillStyle = '#081524';
  context.strokeStyle = 'rgba(128, 186, 255, 0.32)';
  context.lineWidth = 1;
  context.fillRect(area.x, area.y, area.width, area.height);
  context.strokeRect(area.x, area.y, area.width, area.height);

  context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (let raDeg = 0; raDeg < 360; raDeg += 30) {
    const projected = projectSpatialEquirectangular({
      raDeg,
      decDeg: 0,
      width: area.width,
      height: area.height,
    });
    const x = area.x + projected.x;
    context.strokeStyle = raDeg % 90 === 0
      ? 'rgba(130, 190, 255, 0.24)'
      : 'rgba(130, 190, 255, 0.1)';
    context.beginPath();
    context.moveTo(x, area.y);
    context.lineTo(x, area.y + area.height);
    context.stroke();
    context.fillStyle = '#7890aa';
    context.textAlign = raDeg === 0 ? 'left' : 'center';
    context.fillText(`${raDeg}°`, x + (raDeg === 0 ? 4 : 0), area.y + area.height - 7);
  }

  for (let decDeg = -60; decDeg <= 60; decDeg += 30) {
    const projected = projectSpatialEquirectangular({
      raDeg: 0,
      decDeg,
      width: area.width,
      height: area.height,
    });
    const y = area.y + projected.y;
    context.strokeStyle = decDeg === 0
      ? 'rgba(130, 190, 255, 0.24)'
      : 'rgba(130, 190, 255, 0.1)';
    context.beginPath();
    context.moveTo(area.x, y);
    context.lineTo(area.x + area.width, y);
    context.stroke();
    context.fillStyle = '#7890aa';
    context.textAlign = 'right';
    context.fillText(`${decDeg > 0 ? '+' : ''}${decDeg}°`, area.x + area.width - 6, y - 5);
  }

  const authored = mapPoint(model.sky.authoredRaDec, area);
  const evaluated = mapPoint(model.sky.evaluatedRaDec, area);
  drawSkyMarker(authored, '#72d9ff', 'diamond', area);
  drawSkyMarker(evaluated, '#ffbd72', 'ring', area);

  const legendY = area.y + 17;
  drawLegendMarker(area.x + 12, legendY, '#72d9ff', 'Authored RA/Dec');
  drawLegendMarker(area.x + Math.min(190, area.width * 0.48), legendY, '#ffbd72', 'Evaluated forward');
}

function drawOrientationBasis(model, area) {
  context.fillStyle = '#9fb3c8';
  context.font = '600 12px system-ui, sans-serif';
  context.textAlign = 'left';
  context.fillText('ORIENTATION BASIS IN ICRS', area.x, area.y - 20);

  const compact = area.width < 560;
  const center = {
    x: compact ? area.x + area.width * 0.5 : area.x + area.width * 0.32,
    y: area.y + Math.max(70, area.height * 0.53),
  };
  const scale = Math.max(42, Math.min(86, area.height * 0.38, area.width * (compact ? 0.17 : 0.12)));

  const globalAxes = [
    { vector: { x: 1, y: 0, z: 0 }, label: 'ICRS +X' },
    { vector: { x: 0, y: 1, z: 0 }, label: 'ICRS +Y' },
    { vector: { x: 0, y: 0, z: 1 }, label: 'ICRS +Z' },
  ];
  for (const axis of globalAxes) {
    drawBasisArrow(center, axis.vector, scale, 'rgba(150, 170, 195, 0.28)', axis.label, false);
  }

  const basis = model.result.orientationBasisIcrs;
  drawBasisArrow(center, basis.right, scale, '#ff8f91', 'local +X · right', true);
  drawBasisArrow(center, basis.up, scale, '#73e6ae', 'local +Y · up', true);
  drawBasisArrow(center, basis.forward, scale, '#72d9ff', 'local −Z · forward', true);

  const textX = compact ? area.x : area.x + area.width * 0.61;
  const textY = compact ? center.y + scale + 42 : area.y + 22;
  context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'left';
  const rows = [
    ['RIGHT', basis.right, '#ff8f91'],
    ['UP', basis.up, '#73e6ae'],
    ['FORWARD', basis.forward, '#72d9ff'],
  ];
  rows.forEach(([label, vector, color], index) => {
    context.fillStyle = color;
    context.fillText(
      `${String(label).padEnd(7)} ${formatVector(vector)}`,
      textX,
      textY + index * 24,
    );
  });
  context.fillStyle = '#7890aa';
  context.fillText(
    `q ${formatQuaternion(model.result.aimSample.orientationIcrs)}`,
    textX,
    textY + rows.length * 24 + 8,
  );
}

function drawSkyMarker(point, color, shape, area) {
  for (const offset of [-area.width, 0, area.width]) {
    const x = point.x + offset;
    if (x < area.x - 10 || x > area.x + area.width + 10) continue;
    context.save();
    context.translate(x, point.y);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    if (shape === 'diamond') {
      context.rotate(Math.PI / 4);
      context.fillRect(-5, -5, 10, 10);
    } else {
      context.beginPath();
      context.arc(0, 0, 9, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(0, 0, 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function drawLegendMarker(x, y, color, label) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#c5d4e5';
  context.font = '10px system-ui, sans-serif';
  context.textAlign = 'left';
  context.fillText(label, x + 9, y + 3);
}

function drawBasisArrow(center, vector, scale, color, label, strong) {
  const endpoint = projectBasisVector(vector, center, scale);
  const angle = Math.atan2(endpoint.y - center.y, endpoint.x - center.x);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = strong ? 2.5 : 1;
  context.beginPath();
  context.moveTo(center.x, center.y);
  context.lineTo(endpoint.x, endpoint.y);
  context.stroke();
  context.beginPath();
  context.moveTo(endpoint.x, endpoint.y);
  context.lineTo(
    endpoint.x - Math.cos(angle - 0.45) * (strong ? 9 : 6),
    endpoint.y - Math.sin(angle - 0.45) * (strong ? 9 : 6),
  );
  context.lineTo(
    endpoint.x - Math.cos(angle + 0.45) * (strong ? 9 : 6),
    endpoint.y - Math.sin(angle + 0.45) * (strong ? 9 : 6),
  );
  context.closePath();
  context.fill();
  context.font = `${strong ? 600 : 400} 10px system-ui, sans-serif`;
  context.textAlign = endpoint.x >= center.x ? 'left' : 'right';
  context.fillText(label, endpoint.x + (endpoint.x >= center.x ? 7 : -7), endpoint.y - 5);
}

function projectBasisVector(vector, center, scale) {
  return {
    x: center.x + (vector.x * 0.82 - vector.y * 0.82) * scale,
    y: center.y + (vector.x * 0.34 + vector.y * 0.34 - vector.z * 0.92) * scale,
  };
}

function mapPoint(raDec, area) {
  const point = projectSpatialEquirectangular({
    ...raDec,
    width: area.width,
    height: area.height,
  });
  return { x: area.x + point.x, y: area.y + point.y };
}

function numberFromInput(input) {
  const value = input.value.trim();
  return value === '' ? Number.NaN : Number(value);
}

function formatRaDec(value, distancePc) {
  if (!value) return 'undefined';
  return `RA ${formatNumber(value.raDeg, 5)}° · Dec ${formatSigned(value.decDeg, 5)}° · ${formatNumber(distancePc, 5)} pc`;
}

function formatVector(vector, suffix = '') {
  return `(${formatSigned(vector.x)}, ${formatSigned(vector.y)}, ${formatSigned(vector.z)})${suffix}`;
}

function formatQuaternion(quaternion) {
  return `(${formatSigned(quaternion.x)}, ${formatSigned(quaternion.y)}, ${formatSigned(quaternion.z)}, ${formatSigned(quaternion.w)})`;
}

function formatSigned(value, digits = 4) {
  const formatted = formatNumber(value, digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : String(value);
}

function stringifyExact(value) {
  return JSON.stringify(value, null, 2);
}
