import { createStarOctreeProviderService } from '../../src/index.js';
import {
  consumeProductDeltas,
  createStarRepresentationStore,
} from '@found-in-space/star-products';
import { createCanvasStarMap } from '@found-in-space/star-map-canvas';

const DEFAULT_OCTREE_URL =
  'https://d1kwci8ql2abxm.cloudfront.net/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree';

const elements = {
  form: document.querySelector('[data-query-form]'),
  url: document.querySelector('[data-url]'),
  x: document.querySelector('[data-x]'),
  y: document.querySelector('[data-y]'),
  z: document.querySelector('[data-z]'),
  magnitude: document.querySelector('[data-magnitude]'),
  reset: document.querySelector('[data-reset]'),
  status: document.querySelector('[data-status]'),
  canvas: document.querySelector('[data-star-map]'),
  storeCount: document.querySelector('[data-store-count]'),
  visibleCount: document.querySelector('[data-visible-count]'),
  productCount: document.querySelector('[data-product-count]'),
  demandState: document.querySelector('[data-demand-state]'),
  selected: document.querySelector('[data-selected]'),
};

const store = createStarRepresentationStore();
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
};

elements.url.value = DEFAULT_OCTREE_URL;
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  applyView();
});
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

applyView();

function applyView() {
  const url = elements.url.value.trim() || DEFAULT_OCTREE_URL;
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
}

function resetProvider(url) {
  state.token += 1;
  state.session?.dispose();
  state.provider?.dispose();
  state.url = url;
  store.clear();

  state.provider = createStarOctreeProviderService({
    id: 'canvas-star-map-example',
    url,
  });
  state.session = state.provider.createSession({
    id: 'canvas-star-map-session',
    strategy: { kind: 'observer-shell' },
    attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
    streaming: {
      emitCachedFirst: true,
      coarseFirst: true,
    },
  });

  const token = state.token;
  void consumeProductDeltas(state.session.deltas(), store, {
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

function renderMap() {
  if (!elements.canvas.isConnected) {
    return;
  }
  state.lastRender = map.render({
    observerPc: state.observerPc,
    limitingMagnitude: state.limitingMagnitude,
  });
  renderMetrics();
}

function renderMetrics() {
  const snapshot = store.getSnapshot();
  const sessionSnapshot = state.session?.getSnapshot();
  elements.storeCount.textContent = formatInteger(snapshot.starCount);
  elements.visibleCount.textContent = formatInteger(state.lastRender?.visibleCount ?? 0);
  elements.productCount.textContent = formatInteger(snapshot.productCount);
  elements.demandState.textContent = sessionSnapshot?.demand.status ?? snapshot.status;
  if (sessionSnapshot?.demand.status === 'current') {
    setStatus('current');
  }
}

function renderSelection(picked) {
  if (!picked) {
    elements.selected.textContent = 'No star selected.';
    return;
  }

  const ref = picked.objectRef
    ? `${picked.objectRef.nodeKey} / ${picked.objectRef.ordinal}`
    : `${picked.productId} / ${picked.objectIndex}`;
  elements.selected.textContent = [
    `Star ${ref}`,
    `App mag ${formatNumber(picked.apparentMagnitude, 2)}`,
    `Distance ${formatNumber(picked.distancePc, 2)} pc`,
  ].join('\n');
}

function setStatus(value) {
  elements.status.textContent = value;
}

function parseFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
