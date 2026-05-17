import {
  FIS_JOURNEY_FORMAT,
  normalizeTimedJourney,
} from '@found-in-space/journey';

export const JOURNEY_VIDEO_PACKAGE_STATUS = 'alpha-editor';

export const DEFAULT_JOURNEY_VIDEO_EDITOR_STATE = Object.freeze({
  tileModes: Object.freeze(['xy', 'xz', 'perspective', 'skykit']),
  zoom: 1,
  selectedWidget: null,
  selectedLocationRange: null,
  selectedLocationGroupId: null,
  selectedLocationGroupPhase: null,
  timeSecs: 0,
  playing: false,
});

export const JOURNEY_VIDEO_EDITOR_TILE_MODES = Object.freeze([
  'xy',
  'xz',
  'yz',
  'perspective',
  'skykit',
]);

/**
 * @param {unknown} input
 * @returns {import('./index.d.ts').JourneyVideoEditorState}
 */
export function normalizeJourneyVideoEditorState(input = {}) {
  const source = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const tileModes = Array.isArray(source.tileModes)
    ? source.tileModes.map((mode, index) => normalizeTileMode(mode, DEFAULT_JOURNEY_VIDEO_EDITOR_STATE.tileModes[index] ?? 'xy'))
    : [...DEFAULT_JOURNEY_VIDEO_EDITOR_STATE.tileModes];
  while (tileModes.length < 4) tileModes.push(DEFAULT_JOURNEY_VIDEO_EDITOR_STATE.tileModes[tileModes.length] ?? 'xy');
  return {
    tileModes: tileModes.slice(0, 4),
    zoom: clamp(Number(source.zoom ?? DEFAULT_JOURNEY_VIDEO_EDITOR_STATE.zoom), 0.35, 50),
    selectedWidget: normalizeWidgetRef(source.selectedWidget),
    selectedLocationRange: normalizeLocationRange(source.selectedLocationRange),
    selectedLocationGroupId: typeof source.selectedLocationGroupId === 'string' ? source.selectedLocationGroupId : null,
    selectedLocationGroupPhase: source.selectedLocationGroupPhase === 'start' || source.selectedLocationGroupPhase === 'end'
      ? source.selectedLocationGroupPhase
      : null,
    timeSecs: Math.max(0, finiteNumber(source.timeSecs, 0)),
    playing: source.playing === true,
  };
}

/**
 * @param {{ journey?: unknown; editorState?: unknown; metadata?: Record<string, unknown> }} [options]
 * @returns {import('./index.d.ts').JourneyVideoEditorDocument}
 */
export function createJourneyVideoEditorDocument(options = {}) {
  return {
    format: 'fis-journey-video-editor-v1',
    journey: normalizeTimedJourney(options.journey ?? {}),
    editorState: normalizeJourneyVideoEditorState(options.editorState),
    metadata: { ...(options.metadata ?? {}) },
  };
}

/** @param {import('./index.d.ts').JourneyVideoEditorDocument} document */
export function exportJourneyVideoEditorDocument(document) {
  return `${JSON.stringify(createJourneyVideoEditorDocument(document), null, 2)}\n`;
}

/** @param {string | unknown} input */
export function importJourneyVideoEditorDocument(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  const source = /** @type {Record<string, unknown>} */ (parsed && typeof parsed === 'object' ? parsed : {});
  if (source.format === 'fis-journey-video-editor-v1') {
    return createJourneyVideoEditorDocument({
      journey: source.journey,
      editorState: source.editorState,
      metadata: /** @type {Record<string, unknown>} */ (source.metadata ?? {}),
    });
  }
  if (source.format === FIS_JOURNEY_FORMAT || source.locationWaypoints || source.cameraLookWaypoints) {
    return createJourneyVideoEditorDocument({ journey: source });
  }
  throw new TypeError('Journey video editor documents require fis-journey-v1 or fis-journey-video-editor-v1 data.');
}

/**
 * @param {{ getItem?: Function; setItem?: Function; removeItem?: Function } | null | undefined} storage
 * @param {string} key
 */
export function createJourneyVideoStorage(storage, key = 'fis-journey-video-editor') {
  return {
    load() {
      if (!storage || typeof storage.getItem !== 'function') return null;
      const raw = storage.getItem(key);
      return raw ? importJourneyVideoEditorDocument(String(raw)) : null;
    },
    save(document) {
      if (!storage || typeof storage.setItem !== 'function') return;
      storage.setItem(key, exportJourneyVideoEditorDocument(document));
    },
    clear() {
      if (!storage || typeof storage.removeItem !== 'function') return;
      storage.removeItem(key);
    },
  };
}

/** @param {unknown} mode @param {string} fallback */
function normalizeTileMode(mode, fallback) {
  const text = String(mode ?? '');
  return JOURNEY_VIDEO_EDITOR_TILE_MODES.includes(text) ? text : fallback;
}

/** @param {unknown} value */
function normalizeWidgetRef(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const type = String(source.type ?? '');
  const id = String(source.id ?? '');
  return ['location', 'camera', 'guide'].includes(type) && id ? { type, id } : null;
}

/** @param {unknown} value */
function normalizeLocationRange(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const anchorId = typeof source.anchorId === 'string' ? source.anchorId : null;
  const focusId = typeof source.focusId === 'string' ? source.focusId : null;
  return anchorId && focusId && anchorId !== focusId ? { anchorId, focusId } : null;
}

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
