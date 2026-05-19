import * as THREE from 'three';

import { createTimedJourneyEvaluator } from '@found-in-space/journey';
import {
  createObject3dPlugin,
  createSkykitViewer,
  createStreamingStarsPlugin,
} from '@found-in-space/skykit';
import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '@found-in-space/star-octree-provider';
import { createObserverShellStrategy } from '@found-in-space/star-trees';
import { createThreeStarField } from '@found-in-space/three-star-field';
import { normalizeJourneyVideoLayout } from '@found-in-space/journey-video/export';

const DEFAULT_COORDINATE_UNITS_PER_PARSEC = 0.02;
const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_CURRENT_TIMEOUT_MS = 180_000;

const host = document.querySelector('[data-viewer]');
const statusTarget = document.querySelector('[data-status]');

let state = {
  readyState: 'loading',
  error: null,
  profile: null,
  journey: null,
  evaluator: null,
  provider: null,
  viewer: null,
  renderer: null,
  camera: null,
  starPlugin: null,
  starField: null,
  guideGroup: null,
  currentTimeSecs: 0,
  captureCount: 0,
  configuredAt: null,
};

window.__journeyVideoExport = {
  async configure(options) {
    await configure(options);
    return getStatus();
  },
  getStatus,
  getCanvasInfo,
  async seekFrame(input) {
    return seekFrame(input);
  },
  async captureSkyFrame(input) {
    return captureSkyFrame(input);
  },
  async renderOverlayBlock(block) {
    return renderOverlayBlock(block);
  },
  async dispose() {
    await dispose();
    return getStatus();
  },
};

setStatus('waiting for configure()');

async function configure(options = {}) {
  await dispose();
  state = {
    ...state,
    readyState: 'loading',
    error: null,
    profile: options.profile,
    journey: options.journey,
    evaluator: createTimedJourneyEvaluator(options.journey, {
      preloadStepSecs: options.preloadStepSecs ?? 1,
      pathRadiusPc: options.pathRadiusPc ?? 3,
      sphereRadiusPc: options.sphereRadiusPc ?? 4,
      lookaheadSecs: options.lookaheadSecs ?? 4,
    }),
    configuredAt: new Date().toISOString(),
  };

  try {
    const layout = normalizeJourneyVideoLayout(options.profile?.layout);
    const coordinateUnitsPerParsec = Number(options.coordinateUnitsPerParsec)
      || DEFAULT_COORDINATE_UNITS_PER_PARSEC;
    const limitingMagnitude = Number(options.limitingMagnitude) || DEFAULT_LIMITING_MAGNITUDE;

    host.style.width = `${layout.width}px`;
    host.style.height = `${layout.height}px`;
    document.body.style.width = `${layout.width}px`;
    document.body.style.height = `${layout.height}px`;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer !== false,
    });
    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(1);
    renderer.setSize(layout.width, layout.height, false);

    const camera = new THREE.PerspectiveCamera(60, layout.width / layout.height, 0.001, 100000);
    const provider = createStarOctreeProviderService({
      url: options.octreeUrl ?? OCTREE_DEFAULT,
      persistentCache: options.persistentCache ?? 'off',
    });
    const starField = createThreeStarField({
      renderScale: 1,
      limitingMagnitude,
      coordinateUnitsPerParsec,
      exposure: Number(options.exposure) || 2400,
    });
    const guideGroup = createGuideGroup(state.evaluator.journey, coordinateUnitsPerParsec);
    const starPlugin = createStreamingStarsPlugin({
      id: 'journey-video-stars',
      provider,
      renderer: starField,
      session: {
        strategy: createObserverShellStrategy(),
        streaming: {
          coarseFirst: true,
          emitCachedFirst: true,
        },
      },
      attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
    });
    const viewer = await createSkykitViewer({
      host,
      renderer,
      camera,
      view: {
        limitingMagnitude,
        coordinateUnitsPerParsec,
      },
      plugins: [
        starPlugin,
        createObject3dPlugin({
          id: 'journey-video-guides',
          object3d: guideGroup,
          anchorMode: 'world-space',
          disposeObject: true,
        }),
      ],
    });
    viewer.resize({ width: layout.width, height: layout.height, devicePixelRatio: 1 });

    Object.assign(state, {
      readyState: 'ready',
      provider,
      viewer,
      renderer,
      camera,
      starPlugin,
      starField,
      guideGroup,
    });
    document.body.classList.add('render-ready');
    await seekFrame({ frameIndex: 1, timeSecs: 0 });
    setStatus('ready');
  } catch (error) {
    state.readyState = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    setStatus(state.error);
    throw error;
  }
}

async function seekFrame(input = {}) {
  assertReady();
  const timeSecs = clamp(Number(input.timeSecs) || 0, 0, state.evaluator.durationSecs);
  const frame = state.evaluator.evaluate(timeSecs);
  state.currentTimeSecs = timeSecs;
  state.viewer.requestViewState({
    observerPc: frame.observerPc,
    orientationIcrs: frame.orientationIcrs,
    targetPc: frame.targetPc,
    limitingMagnitude: Number(state.profile?.limitingMagnitude) || DEFAULT_LIMITING_MAGNITUDE,
    motion: {
      velocityPcPerSec: frame.velocityPcPerSec,
      speedPcPerSec: frame.speedPcPerSec,
    },
  }, 'journey-video.seek');
  state.viewer.frame(0);
  await waitForStarsCurrent(input.currentTimeoutMs ?? DEFAULT_CURRENT_TIMEOUT_MS);
  state.viewer.frame(0);
  return {
    frameIndex: input.frameIndex ?? null,
    timeSecs,
    stats: getStatus(),
  };
}

async function captureSkyFrame(input = {}) {
  const seek = await seekFrame(input);
  const canvas = state.renderer.domElement;
  const blob = await canvasToBlob(canvas, input.type ?? 'image/png');
  state.captureCount += 1;
  return {
    frameIndex: input.frameIndex ?? null,
    timeSecs: state.currentTimeSecs,
    width: canvas.width,
    height: canvas.height,
    type: blob.type || 'image/png',
    size: blob.size,
    stats: seek.stats,
    dataUrl: await blobToDataUrl(blob),
  };
}

async function renderOverlayBlock(block) {
  assertConfigured();
  const layout = normalizeJourneyVideoLayout(state.profile?.layout);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawOverlayBlock(context, layout, block);
  const blob = await canvasToBlob(canvas, 'image/png');
  return {
    id: block.id,
    width: canvas.width,
    height: canvas.height,
    type: blob.type || 'image/png',
    size: blob.size,
    dataUrl: await blobToDataUrl(blob),
  };
}

async function dispose() {
  document.body.classList.remove('render-ready');
  const current = state;
  state = {
    readyState: 'disposed',
    error: null,
    profile: null,
    journey: null,
    evaluator: null,
    provider: null,
    viewer: null,
    renderer: null,
    camera: null,
    starPlugin: null,
    starField: null,
    guideGroup: null,
    currentTimeSecs: 0,
    captureCount: 0,
    configuredAt: null,
  };
  await current.viewer?.dispose?.();
  await current.provider?.dispose?.();
  current.renderer?.dispose?.();
  setStatus('disposed');
}

function getStatus() {
  const starSnapshot = state.starPlugin?.getSnapshot?.() ?? null;
  return {
    readyState: state.readyState,
    error: state.error,
    currentTimeSecs: state.currentTimeSecs,
    captureCount: state.captureCount,
    configuredAt: state.configuredAt,
    journey: state.evaluator
      ? {
          id: state.evaluator.journey.id,
          title: state.evaluator.journey.title,
          durationSecs: state.evaluator.durationSecs,
        }
      : null,
    canvas: getCanvasInfo(),
    stars: starSnapshot
      ? {
          status: starSnapshot.status,
          deltaCount: starSnapshot.deltaCount,
          cellCount: starSnapshot.renderer?.cellCount ?? 0,
          starCount: starSnapshot.renderer?.starCount ?? 0,
          session: starSnapshot.session
            ? {
                status: starSnapshot.session.status,
                viewRevision: starSnapshot.session.viewRevision,
                demandRevision: starSnapshot.session.demandRevision,
                activeWorkItemCount: starSnapshot.session.activeWorkItemCount,
              }
            : null,
        }
      : null,
  };
}

function getCanvasInfo() {
  const canvas = state.renderer?.domElement ?? null;
  return {
    width: canvas?.width ?? 0,
    height: canvas?.height ?? 0,
    clientWidth: canvas?.clientWidth ?? 0,
    clientHeight: canvas?.clientHeight ?? 0,
  };
}

async function waitForStarsCurrent(timeoutMs) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const snapshot = state.starPlugin?.getSnapshot?.();
    if (snapshot?.status === 'current') return;
    if (snapshot?.status === 'failed') {
      throw new Error(snapshot.lastError ?? 'Streaming star layer failed.');
    }
    await delay(80);
    state.viewer?.frame?.(0);
  }
  throw new Error(`Timed out waiting for streamed stars to become current after ${timeoutMs}ms.`);
}

function createGuideGroup(journey, coordinateUnitsPerParsec) {
  const group = new THREE.Group();
  group.name = 'journey-video-guides';
  for (const guide of journey.guides ?? []) {
    const color = new THREE.Color(guide.color ?? '#74d8ff');
    const opacity = clamp(Number(guide.opacity ?? 0.36), 0, 1);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      wireframe: opacity < 0.35,
      depthWrite: false,
    });
    const size = Number(guide.sizePc ?? guide.radiusPc ?? 1) * coordinateUnitsPerParsec;
    const geometry = guide.shape === 'cube'
      ? new THREE.BoxGeometry(size, size, size)
      : new THREE.SphereGeometry(Math.max(0.001, size), 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = guide.id ?? guide.label ?? 'journey-guide';
    mesh.position.set(
      Number(guide.positionPc?.x ?? 0) * coordinateUnitsPerParsec,
      Number(guide.positionPc?.y ?? 0) * coordinateUnitsPerParsec,
      Number(guide.positionPc?.z ?? 0) * coordinateUnitsPerParsec,
    );
    group.add(mesh);
  }
  return group;
}

function drawOverlayBlock(context, layout, block) {
  const text = layout.text;
  const x = Number(text.x ?? 64);
  const bottom = Number(text.bottom ?? 64);
  const titleFontSize = Number(text.titleFontSize ?? 40);
  const bodyFontSize = Number(text.bodyFontSize ?? 22);
  const eyebrowFontSize = Number(text.eyebrowFontSize ?? 16);
  const titleLines = wrapText(context, block.title ?? '', text.titleMaxWidth ?? text.maxWidth ?? 800, font(titleFontSize, 700));
  const bodyLines = wrapText(context, block.body ?? '', text.bodyMaxWidth ?? text.maxWidth ?? 800, font(bodyFontSize, 400));
  const titleLineHeight = titleFontSize * Number(text.titleLineHeight ?? 1.05);
  const bodyLineHeight = bodyFontSize * Number(text.bodyLineHeight ?? 1.35);
  const eyebrowHeight = block.eyebrow ? eyebrowFontSize : 0;
  const height = eyebrowHeight
    + (block.eyebrow ? Number(text.eyebrowGap ?? 12) : 0)
    + titleLines.length * titleLineHeight
    + (bodyLines.length ? Number(text.bodyGap ?? 18) : 0)
    + bodyLines.length * bodyLineHeight;
  let y = layout.height - bottom - height;

  context.save();
  context.shadowColor = 'rgba(0, 0, 0, 0.78)';
  context.shadowBlur = Number(text.shadowBlur ?? 18);
  context.shadowOffsetY = Number(text.shadowOffsetY ?? 4);
  context.fillStyle = '#ffffff';
  if (block.eyebrow) {
    context.font = font(eyebrowFontSize, 700);
    context.letterSpacing = '0px';
    context.globalAlpha = 0.82;
    context.fillText(String(block.eyebrow).toUpperCase(), x, y + eyebrowFontSize);
    y += eyebrowFontSize + Number(text.eyebrowGap ?? 12);
  }
  context.globalAlpha = 1;
  context.font = font(titleFontSize, 700);
  for (const line of titleLines) {
    context.fillText(line, x, y + titleFontSize);
    y += titleLineHeight;
  }
  if (bodyLines.length) {
    y += Number(text.bodyGap ?? 18);
    context.globalAlpha = 0.88;
    context.font = font(bodyFontSize, 400);
    for (const line of bodyLines) {
      context.fillText(line, x, y + bodyFontSize);
      y += bodyLineHeight;
    }
  }
  context.restore();
}

function wrapText(context, rawText, maxWidth, textFont) {
  const text = String(rawText ?? '').trim();
  if (!text) return [];
  context.save();
  context.font = textFont;
  const words = text.split(/\s+/u);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  context.restore();
  return lines;
}

function font(size, weight) {
  return `${weight} ${size}px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

function setStatus(message) {
  if (statusTarget) statusTarget.textContent = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
}

function assertConfigured() {
  if (!state.evaluator || !state.profile) {
    throw new Error('Journey video render page has not been configured.');
  }
}

function assertReady() {
  assertConfigured();
  if (state.readyState !== 'ready' || !state.viewer || !state.renderer) {
    throw new Error(`Journey video render page is not ready: ${state.readyState}.`);
  }
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas capture failed.'));
    }, type);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Blob read failed.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
