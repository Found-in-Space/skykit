import {
  OCTREE_DEFAULT,
  createObserverShellStrategy,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import {
  consumeStarCellDeltas,
  createStarCellKey,
  createStarCellStore,
} from '@found-in-space/star-trees';
import {
  createCanvasStarMap,
  createGnomonicProjection,
  createRaDecEquirectangularProjection,
  icrsDirectionToRaDec,
  icrsPositionToRaDec,
} from '@found-in-space/star-map-canvas';
import {
  loadAnchoredImageManifest,
  solveAnchoredImageMesh,
} from '@found-in-space/anchored-image';
import { drawAnchoredImageMeshCanvas } from '@found-in-space/anchored-image/canvas';

const DEFAULT_SKYCULTURE_MANIFEST_URL =
  'https://unpkg.com/@found-in-space/stellarium-skycultures-western@0.1.0/dist/manifest.json';
const DEFAULT_ART_GROUPS = new Set(['Ori']);

const elements = {
  form: document.querySelector('[data-query-form]'),
  url: document.querySelector('[data-url]'),
  x: document.querySelector('[data-x]'),
  y: document.querySelector('[data-y]'),
  z: document.querySelector('[data-z]'),
  magnitude: document.querySelector('[data-magnitude]'),
  projection: document.querySelector('[data-projection]'),
  centerRa: document.querySelector('[data-center-ra]'),
  centerDec: document.querySelector('[data-center-dec]'),
  fov: document.querySelector('[data-fov]'),
  motion: document.querySelector('[data-motion]'),
  glyph: document.querySelector('[data-glyph]'),
  grid: document.querySelector('[data-grid]'),
  art: document.querySelector('[data-art]'),
  reset: document.querySelector('[data-reset]'),
  status: document.querySelector('[data-status]'),
  canvas: document.querySelector('[data-star-map]'),
  storeCount: document.querySelector('[data-store-count]'),
  visibleCount: document.querySelector('[data-visible-count]'),
  cellCount: document.querySelector('[data-cell-count]'),
  demandState: document.querySelector('[data-demand-state]'),
  selected: document.querySelector('[data-selected]'),
  projectionPreview: document.querySelector('[data-projection-preview]'),
};

const store = createStarCellStore();
const artItems = [];
const gridLayer = createGridLayer();
const artLayer = createArtLayer(artItems);
const fallSimulation = createFallingStarPileSimulation();
const map = createCanvasStarMap(elements.canvas, {
  store,
  style: {
    background: '#020712',
    maxRadiusPx: 5,
    haloScale: 2.8,
  },
});

const state = {
  provider: null,
  session: null,
  url: '',
  token: 0,
  observerPc: { x: 0, y: 0, z: 0 },
  limitingMagnitude: 6.5,
  lastRender: null,
  lastFrameMs: performance.now(),
  animating: false,
};

elements.url.value = OCTREE_DEFAULT;
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  applyView();
});
for (const control of [
  elements.projection,
  elements.centerRa,
  elements.centerDec,
  elements.fov,
  elements.motion,
  elements.glyph,
  elements.grid,
  elements.art,
]) {
  control.addEventListener('input', () => {
    renderMap();
    updateAnimationLoop();
  });
}
elements.reset.addEventListener('click', () => {
  elements.x.value = '0';
  elements.y.value = '0';
  elements.z.value = '0';
  elements.magnitude.value = '6.5';
  applyView();
});
elements.canvas.addEventListener('click', (event) => {
  const bounds = elements.canvas.getBoundingClientRect();
  const picked = map.pick({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  });
  renderSelection(picked);
});

store.subscribe(() => {
  renderMap();
});

if (typeof ResizeObserver === 'function') {
  const resizeObserver = new ResizeObserver(() => {
    renderMap();
  });
  resizeObserver.observe(elements.canvas);
}

window.addEventListener('pagehide', () => {
  state.session?.dispose();
  state.provider?.dispose();
  map.dispose();
});

void loadDemoArt().then((items) => {
  artItems.splice(0, artItems.length, ...items);
  renderMap();
}).catch((error) => {
  console.error('[star-map-canvas-use-cases] failed to load anchored image art', error);
});

applyView();

function applyView() {
  const url = elements.url.value.trim() || OCTREE_DEFAULT;
  state.observerPc = {
    x: parseFiniteNumber(elements.x.value, 0),
    y: parseFiniteNumber(elements.y.value, 0),
    z: parseFiniteNumber(elements.z.value, 0),
  };
  state.limitingMagnitude = parseFiniteNumber(elements.magnitude.value, 6.5);

  if (!state.provider || state.url !== url) {
    resetProvider(url);
  }

  state.session?.updateView({
    observerPc: state.observerPc,
    limitingMagnitude: state.limitingMagnitude,
  });
  setStatus('streaming');
  renderMap();
  updateAnimationLoop();
}

function resetProvider(url) {
  state.token += 1;
  state.session?.dispose();
  state.provider?.dispose();
  state.url = url;
  fallSimulation.reset();
  store.clear();

  state.provider = createStarOctreeProviderService({
    id: 'star-map-canvas-use-cases',
    url,
  });
  state.session = state.provider.createSession({
    id: 'star-map-canvas-use-cases-session',
    strategy: createObserverShellStrategy(),
    attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
    streaming: {
      emitCachedFirst: true,
      coarseFirst: true,
    },
  });

  const token = state.token;
  void consumeStarCellDeltas(state.session.deltas(), store, {
    throwOnError: false,
  }).then((result) => {
    if (token !== state.token) return;
    if (result.stoppedOn === 'error') {
      setStatus('failed');
    }
  }).catch((error) => {
    if (token !== state.token) return;
    setStatus(error instanceof Error ? error.message : String(error));
  });
}

function renderMap(now = performance.now()) {
  if (!elements.canvas.isConnected) {
    return;
  }

  const deltaMs = Math.max(0, now - state.lastFrameMs);
  state.lastFrameMs = now;
  const projection = resolveProjection();
  const motionMode = elements.motion.value;
  const layers = [
    ...(elements.art.checked ? [artLayer] : []),
    ...(elements.grid.checked ? [gridLayer] : []),
  ];
  if (motionMode === 'fall') {
    fallSimulation.setSceneKey(createFallSceneKey());
  } else {
    fallSimulation.reset();
  }

  state.lastRender = map.render({
    observerPc: state.observerPc,
    limitingMagnitude: state.limitingMagnitude,
    projection,
    layers,
    timeMs: now,
    deltaMs,
    mapPoint: createMapPoint(motionMode),
    drawPoint: elements.glyph.checked ? drawGlyphPoint : undefined,
  });
  if (motionMode === 'fall') {
    fallSimulation.finishFrame();
  }
  renderMetrics();
  renderProjectionPreview();
}

function updateAnimationLoop() {
  const needsAnimation = elements.motion.value !== 'static';
  if (state.animating === needsAnimation) {
    return;
  }
  state.animating = needsAnimation;
  if (needsAnimation) {
    requestAnimationFrame(animationFrame);
  }
}

function animationFrame(now) {
  if (!state.animating) {
    return;
  }
  renderMap(now);
  requestAnimationFrame(animationFrame);
}

function resolveProjection() {
  if (elements.projection.value === 'fov') {
    return createGnomonicProjection({
      centerRaDeg: parseFiniteNumber(elements.centerRa.value, 83),
      centerDecDeg: parseFiniteNumber(elements.centerDec.value, -5),
      fovDeg: parseFiniteNumber(elements.fov.value, 70),
    });
  }
  return createRaDecEquirectangularProjection();
}

function createFallSceneKey() {
  return [
    elements.projection.value,
    elements.centerRa.value,
    elements.centerDec.value,
    elements.fov.value,
    state.observerPc.x,
    state.observerPc.y,
    state.observerPc.z,
    state.limitingMagnitude,
  ].join('|');
}

function createMapPoint(mode = elements.motion.value) {
  if (mode === 'static') {
    return null;
  }

  return (point, context) => {
    if (mode === 'twinkle') {
      const wave = Math.sin(context.timeMs * 0.006 + point.objectIndex * 0.73);
      return {
        ...point,
        alpha: point.alpha * (0.68 + 0.32 * wave * wave),
        radius: point.radius * (0.86 + 0.18 * wave * wave),
      };
    }

    return fallSimulation.mapPoint(point, context);
  };
}

// Demo-only particle helper: shows that game behavior can sit on projected points.
function createFallingStarPileSimulation(options = {}) {
  const maxParticles = Math.max(1, Math.floor(options.maxParticles ?? 1400));
  const bucketSize = Math.max(16, Math.floor(options.bucketSize ?? 72));
  const maxNewParticlesPerBucket = Math.max(1, Math.floor(options.maxNewParticlesPerBucket ?? 6));
  const particles = new Map();
  const frameBucketCounts = new Map();
  let frameId = 0;
  let activeFrameTime = null;
  let startedAtMs = null;
  let sceneKey = '';
  let boundsKey = '';

  function reset() {
    particles.clear();
    frameBucketCounts.clear();
    activeFrameTime = null;
    startedAtMs = null;
    boundsKey = '';
  }

  function setSceneKey(nextSceneKey) {
    if (sceneKey !== nextSceneKey) {
      sceneKey = nextSceneKey;
      reset();
    }
  }

  function beginFrame(context) {
    const nextBoundsKey = [
      Math.round(context.rect.x),
      Math.round(context.rect.y),
      Math.round(context.rect.w),
      Math.round(context.rect.h),
    ].join('|');

    if (boundsKey && boundsKey !== nextBoundsKey) {
      reset();
    }
    boundsKey = nextBoundsKey;

    if (activeFrameTime === context.timeMs) {
      return;
    }
    activeFrameTime = context.timeMs;
    if (startedAtMs == null) {
      startedAtMs = context.timeMs;
    }
    frameBucketCounts.clear();
    frameId += 1;

    const dt = clampNumber((context.deltaMs || 16) / 1000, 1 / 120, 1 / 24);
    stepParticles([...particles.values()], context.rect, dt);
  }

  function mapPoint(point, context) {
    beginFrame(context);
    const key = starPointKey(point);
    let particle = particles.get(key);
    if (!particle) {
      if (!canCreateParticle(point, context)) {
        return createCheapFallingPoint(point, context, key, startedAtMs ?? context.timeMs);
      }
      particle = createParticle(point, context.rect, key);
      particles.set(key, particle);
    }

    particle.seenFrame = frameId;
    particle.radius = Math.max(particle.radius, clampNumber(point.radius * 1.25, 2.2, 6));
    particle.mass = particle.radius * particle.radius;
    return {
      ...point,
      x: particle.x,
      y: particle.y,
      radius: particle.radius,
      alpha: point.alpha * 0.88,
    };
  }

  function finishFrame() {
    for (const [key, particle] of particles) {
      if (particle.seenFrame !== frameId) {
        particles.delete(key);
      }
    }
  }

  return {
    setSceneKey,
    reset,
    mapPoint,
    finishFrame,
  };

  function canCreateParticle(point, context) {
    if (particles.size >= maxParticles) {
      return false;
    }

    const bucketKey = starPointBucketKey(point, context.rect, bucketSize);
    const count = frameBucketCounts.get(bucketKey) ?? 0;
    if (count >= maxNewParticlesPerBucket) {
      return false;
    }

    frameBucketCounts.set(bucketKey, count + 1);
    return true;
  }
}

function createParticle(point, rect, key) {
  const seed = hashString(key);
  const radius = clampNumber(point.radius * 1.25, 2.2, 6);
  return {
    x: clampNumber(point.x, rect.x + radius, rect.x + rect.w - radius),
    y: clampNumber(point.y, rect.y + radius, rect.y + rect.h - radius),
    vx: ((seed & 0xff) - 128) * 0.45,
    vy: -40 - ((seed >>> 8) & 0x7f) * 0.18,
    radius,
    mass: radius * radius,
    seenFrame: 0,
  };
}

function createCheapFallingPoint(point, context, key, startedAtMs) {
  const seed = hashString(key);
  const radius = clampNumber(point.radius * 1.1, 1.7, 4.5);
  const delay = ((seed >>> 16) & 0xff) / 180;
  const elapsed = Math.max(0, (context.timeMs - startedAtMs) / 1000 - delay);
  const floorY = context.rect.y + context.rect.h - radius;
  const targetX = context.rect.x + radius
    + (((seed >>> 8) % 1000) / 999) * Math.max(0, context.rect.w - radius * 2);
  const targetLayer = ((seed >>> 24) & 0x0f) % 7;
  const targetY = floorY - targetLayer * radius * 1.55;
  const fallingY = point.y + 0.5 * 1250 * elapsed * elapsed;
  const settle = clampNumber(elapsed / 1.6, 0, 1);
  const drift = (targetX - point.x) * settle * settle;

  return {
    ...point,
    x: clampNumber(point.x + drift, context.rect.x + radius, context.rect.x + context.rect.w - radius),
    y: Math.min(fallingY, targetY),
    radius,
    alpha: point.alpha * 0.45,
  };
}

function starPointBucketKey(point, rect, bucketSize) {
  const column = Math.floor((point.x - rect.x) / bucketSize);
  const row = Math.floor((point.y - rect.y) / bucketSize);
  return `${column}:${row}`;
}

function stepParticles(particles, rect, dt) {
  if (particles.length === 0) {
    return;
  }

  const left = rect.x;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const gravity = 1500;
  const airDrag = 0.997;

  for (const particle of particles) {
    particle.vy += gravity * dt;
    particle.vx *= airDrag;
    particle.vy *= airDrag;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }

  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (const particle of particles) {
      resolveParticleBounds(particle, left, right, bottom);
    }
    resolveParticlePairs(particles);
    for (const particle of particles) {
      resolveParticleBounds(particle, left, right, bottom);
    }
  }
}

function resolveParticleBounds(particle, left, right, bottom) {
  const restitution = 0.08;
  const floorFriction = 0.72;
  if (particle.x - particle.radius < left) {
    particle.x = left + particle.radius;
    particle.vx = Math.abs(particle.vx) * restitution;
  } else if (particle.x + particle.radius > right) {
    particle.x = right - particle.radius;
    particle.vx = -Math.abs(particle.vx) * restitution;
  }

  if (particle.y + particle.radius > bottom) {
    particle.y = bottom - particle.radius;
    particle.vy = Math.abs(particle.vy) < 30 ? 0 : -particle.vy * restitution;
    particle.vx *= floorFriction;
  }
}

function resolveParticlePairs(particles) {
  const restitution = 0.03;
  const cellSize = 16;
  const cells = new Map();
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    const cellKey = `${Math.floor(particle.x / cellSize)}:${Math.floor(particle.y / cellSize)}`;
    const cell = cells.get(cellKey);
    if (cell) {
      cell.push(index);
    } else {
      cells.set(cellKey, [index]);
    }
  }

  for (let leftIndex = 0; leftIndex < particles.length; leftIndex += 1) {
    const left = particles[leftIndex];
    const cellX = Math.floor(left.x / cellSize);
    const cellY = Math.floor(left.y / cellSize);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const neighborIndexes = cells.get(`${cellX + offsetX}:${cellY + offsetY}`);
        if (!neighborIndexes) continue;
        for (const rightIndex of neighborIndexes) {
          if (rightIndex <= leftIndex) continue;
          resolveParticlePair(left, particles[rightIndex], leftIndex, rightIndex, restitution);
        }
      }
    }
  }
}

function resolveParticlePair(left, right, leftIndex, rightIndex, restitution) {
  let dx = left.x - right.x;
  let dy = left.y - right.y;
  let distance = Math.hypot(dx, dy);
  const minDistance = left.radius + right.radius;
  if (!(distance < minDistance)) {
    return;
  }

  if (distance < 0.0001) {
    const angle = (leftIndex * 12.9898 + rightIndex * 78.233) % (Math.PI * 2);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 1;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = minDistance - distance;
  const totalMass = left.mass + right.mass;
  const leftShare = right.mass / totalMass;
  const rightShare = left.mass / totalMass;
  left.x += nx * overlap * leftShare;
  left.y += ny * overlap * leftShare;
  right.x -= nx * overlap * rightShare;
  right.y -= ny * overlap * rightShare;

  const relativeVx = left.vx - right.vx;
  const relativeVy = left.vy - right.vy;
  const relativeNormalVelocity = relativeVx * nx + relativeVy * ny;
  if (relativeNormalVelocity >= 0) {
    return;
  }

  const impulse = -(1 + restitution) * relativeNormalVelocity
    / (1 / left.mass + 1 / right.mass);
  left.vx += impulse * nx / left.mass;
  left.vy += impulse * ny / left.mass;
  right.vx -= impulse * nx / right.mass;
  right.vy -= impulse * ny / right.mass;
}

function drawGlyphPoint(ctx, point) {
  const previousAlpha = typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1;
  const size = Math.max(point.radius * 1.5, 2.5);
  ctx.globalAlpha = point.alpha;
  ctx.fillStyle = point.color;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - size);
  ctx.lineTo(point.x + size, point.y);
  ctx.lineTo(point.x, point.y + size);
  ctx.lineTo(point.x - size, point.y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = previousAlpha;
}

function createGridLayer() {
  return {
    id: 'ra-dec-grid',
    phase: 'background',
    render(context) {
      if (!context.projectRaDec) return;
      const ctx = context.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(115, 213, 255, 0.22)';
      ctx.lineWidth = 1;
      for (const decDeg of [-60, -30, 0, 30, 60]) {
        strokeRaDecPath(ctx, context, Array.from({ length: 73 }, (_, index) => ({
          raDeg: index * 5,
          raHours: index / 3,
          decDeg,
        })));
      }
      for (const raDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
        strokeRaDecPath(ctx, context, Array.from({ length: 49 }, (_, index) => ({
          raDeg,
          raHours: raDeg / 15,
          decDeg: -80 + index * (160 / 48),
        })));
      }
      ctx.restore();
    },
  };
}

function strokeRaDecPath(ctx, context, samples) {
  let open = false;
  for (const sample of samples) {
    const point = context.projectRaDec(sample);
    if (!point) {
      open = false;
      continue;
    }
    if (!open) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      open = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  if (open) {
    ctx.stroke();
  }
}

function createArtLayer(items) {
  return {
    id: 'anchored-art',
    phase: 'background',
    render(context) {
      if (!context.projectRaDec) return;
      const ctx = context.ctx;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(context.rect.x, context.rect.y, context.rect.w, context.rect.h);
        ctx.clip();
        for (const item of items) {
          drawAnchoredImageMeshCanvas(ctx, item.mesh, {
            sourceImage: item.image,
            opacity: 0.28,
            wrapWidth: context.rect.w,
            context,
            projectTarget(target, layerContext) {
              const sky = target.kind === 'direction'
                ? icrsDirectionToRaDec(target)
                : icrsPositionToRaDec(target, layerContext.observerPc);
              return sky
                ? layerContext.projectRaDecUnclipped?.(sky)
                  ?? layerContext.projectRaDec?.(sky)
                  ?? null
                : null;
            },
          });
        }
      } finally {
        ctx.restore();
      }
    },
  };
}

async function loadDemoArt() {
  const manifest = await loadAnchoredImageManifest({
    manifestUrl: DEFAULT_SKYCULTURE_MANIFEST_URL,
  });

  const selectedImages = manifest.images.filter((image) => DEFAULT_ART_GROUPS.has(image.groupId));
  const loadedItems = [];
  for (const image of selectedImages) {
    const mesh = solveAnchoredImageMesh(image, { subdivisions: 3 });
    if (!mesh) continue;
    loadedItems.push({
      mesh,
      image: await loadImage(image.image.src),
    });
  }

  return loadedItems;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

function renderMetrics() {
  const snapshot = store.getSnapshot();
  const sessionSnapshot = state.session?.getSnapshot();
  elements.storeCount.textContent = formatInteger(snapshot.starCount);
  elements.visibleCount.textContent = formatInteger(state.lastRender?.visibleCount ?? 0);
  elements.cellCount.textContent = formatInteger(snapshot.cellCount);
  elements.demandState.textContent = sessionSnapshot?.demand.status ?? 'idle';
  if (sessionSnapshot?.demand.status === 'current') {
    setStatus('current');
  }
}

function renderProjectionPreview() {
  const render = state.lastRender;
  elements.projectionPreview.textContent = JSON.stringify({
    projectionId: render?.projectionId ?? null,
    observerPc: render?.observerPc ?? null,
    starCount: render?.starCount ?? 0,
    visibleCount: render?.visibleCount ?? 0,
    sample: (render?.points ?? []).slice(0, 5).map((point) => ({
      x: round(point.x),
      y: round(point.y),
      radius: round(point.radius),
      alpha: round(point.alpha),
      appMag: round(point.apparentMagnitude),
      cellKey: point.cellKey,
      objectIndex: point.objectIndex,
    })),
  }, null, 2);
}

function renderSelection(picked) {
  if (!picked) {
    elements.selected.textContent = 'No star selected.';
    return;
  }

  const ref = picked.objectRef
    ? `${createStarCellKey(picked.objectRef)} / ${picked.objectRef.ordinal}`
    : `${picked.cellKey} / ${picked.objectIndex}`;
  elements.selected.textContent = [
    `Star ${ref}`,
    `App mag ${formatNumber(picked.apparentMagnitude, 2)}`,
    `Distance ${formatNumber(picked.distancePc, 2)} pc`,
  ].join('\n');
}

function setStatus(value) {
  elements.status.textContent = value;
}

function starPointKey(point) {
  if (point.objectRef?.mortonCode != null && point.objectRef?.ordinal != null) {
    return `${point.cellKey}:${createStarCellKey(point.objectRef)}:${point.objectRef.ordinal}`;
  }
  return `${point.cellKey}:${point.objectIndex}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max) {
  if (!(max >= min)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function formatNumber(value, fractionDigits) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: Math.min(fractionDigits, 2),
    })
    : '';
}

function formatInteger(value) {
  return Math.round(value).toLocaleString();
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}
