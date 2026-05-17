import { normalizeTimedJourney } from '@found-in-space/journey';

export const JOURNEY_VIDEO_EXPORT_PACKAGE_STATUS = 'alpha-export';

export const JOURNEY_VIDEO_EXPORT_PLATES = Object.freeze([
  'sky',
  'overlay',
  'composite',
]);

export const JOURNEY_VIDEO_BROWSER_IDS = Object.freeze([
  'webkit',
  'chromium',
  'firefox',
]);

export const JOURNEY_VIDEO_LAYOUTS = Object.freeze({
  'landscape-4k': Object.freeze({
    id: 'landscape-4k',
    label: 'Landscape 4K',
    width: 3840,
    height: 2160,
    text: Object.freeze({
      x: 132,
      bottom: 126,
      maxWidth: 1460,
      titleMaxWidth: 870,
      bodyMaxWidth: 930,
      eyebrowFontSize: 28,
      titleFontSize: 72,
      bodyFontSize: 36,
      eyebrowGap: 22,
      bodyGap: 30,
      titleLineHeight: 1.04,
      bodyLineHeight: 1.36,
      shadowBlur: 32,
      shadowOffsetY: 6,
    }),
  }),
  'landscape-1080p': Object.freeze({
    id: 'landscape-1080p',
    label: 'Landscape 1080p',
    width: 1920,
    height: 1080,
    text: Object.freeze({
      x: 66,
      bottom: 63,
      maxWidth: 730,
      titleMaxWidth: 435,
      bodyMaxWidth: 465,
      eyebrowFontSize: 14,
      titleFontSize: 36,
      bodyFontSize: 18,
      eyebrowGap: 11,
      bodyGap: 15,
      titleLineHeight: 1.04,
      bodyLineHeight: 1.36,
      shadowBlur: 16,
      shadowOffsetY: 3,
    }),
  }),
  'vertical-1080x1920': Object.freeze({
    id: 'vertical-1080x1920',
    label: 'Vertical 9:16',
    width: 1080,
    height: 1920,
    text: Object.freeze({
      x: 72,
      bottom: 120,
      maxWidth: 880,
      eyebrowFontSize: 20,
      titleFontSize: 52,
      bodyFontSize: 26,
      eyebrowGap: 18,
      bodyGap: 24,
      titleLineHeight: 1.06,
      bodyLineHeight: 1.34,
      shadowBlur: 24,
      shadowOffsetY: 5,
    }),
  }),
  'square-1080': Object.freeze({
    id: 'square-1080',
    label: 'Square 1:1',
    width: 1080,
    height: 1080,
    text: Object.freeze({
      x: 64,
      bottom: 78,
      maxWidth: 850,
      eyebrowFontSize: 18,
      titleFontSize: 44,
      bodyFontSize: 23,
      eyebrowGap: 15,
      bodyGap: 21,
      titleLineHeight: 1.06,
      bodyLineHeight: 1.34,
      shadowBlur: 22,
      shadowOffsetY: 4,
    }),
  }),
  'portrait-1080x1350': Object.freeze({
    id: 'portrait-1080x1350',
    label: 'Portrait 4:5',
    width: 1080,
    height: 1350,
    text: Object.freeze({
      x: 72,
      bottom: 92,
      maxWidth: 860,
      eyebrowFontSize: 18,
      titleFontSize: 46,
      bodyFontSize: 24,
      eyebrowGap: 16,
      bodyGap: 22,
      titleLineHeight: 1.06,
      bodyLineHeight: 1.34,
      shadowBlur: 22,
      shadowOffsetY: 4,
    }),
  }),
});

export const JOURNEY_VIDEO_LAYOUT_IDS = Object.freeze(Object.keys(JOURNEY_VIDEO_LAYOUTS));
export const JOURNEY_VIDEO_DEFAULT_LAYOUT_ID = 'landscape-4k';
export const JOURNEY_VIDEO_PREVIEW_LAYOUT_ID = 'landscape-1080p';

export const JOURNEY_VIDEO_RENDER_PROFILES = Object.freeze({
  preview: Object.freeze({
    mode: 'preview',
    layout: JOURNEY_VIDEO_PREVIEW_LAYOUT_ID,
    fps: 12,
    browser: 'webkit',
    crf: 20,
    seconds: 60,
    retainFrames: true,
  }),
  final: Object.freeze({
    mode: 'final',
    layout: JOURNEY_VIDEO_DEFAULT_LAYOUT_ID,
    fps: 24,
    browser: 'webkit',
    crf: 18,
    seconds: 60,
    retainFrames: false,
  }),
});

export const JOURNEY_VIDEO_RENDER_PROFILE_IDS = Object.freeze(Object.keys(JOURNEY_VIDEO_RENDER_PROFILES));

/**
 * @param {unknown} layoutInput
 * @returns {import('./export.d.ts').JourneyVideoLayoutProfile}
 */
export function normalizeJourneyVideoLayout(layoutInput = JOURNEY_VIDEO_DEFAULT_LAYOUT_ID) {
  if (typeof layoutInput === 'string') {
    const layout = JOURNEY_VIDEO_LAYOUTS[layoutInput];
    if (!layout) {
      throw new Error(`Unknown journey video layout "${layoutInput}".`);
    }
    return cloneLayout(layout);
  }
  const source = /** @type {Record<string, unknown>} */ (layoutInput && typeof layoutInput === 'object' ? layoutInput : {});
  const id = String(source.id ?? JOURNEY_VIDEO_DEFAULT_LAYOUT_ID);
  const base = JOURNEY_VIDEO_LAYOUTS[id] ?? JOURNEY_VIDEO_LAYOUTS[JOURNEY_VIDEO_DEFAULT_LAYOUT_ID];
  return {
    ...cloneLayout(base),
    ...source,
    id,
    label: String(source.label ?? base.label),
    width: positiveInteger(source.width, base.width),
    height: positiveInteger(source.height, base.height),
    text: {
      ...base.text,
      ...(source.text && typeof source.text === 'object' ? source.text : {}),
    },
  };
}

/**
 * @param {unknown} input
 * @returns {import('./export.d.ts').JourneyVideoRenderProfile}
 */
export function normalizeJourneyVideoRenderProfile(input = {}) {
  const source = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const mode = String(source.mode ?? 'preview');
  const defaults = JOURNEY_VIDEO_RENDER_PROFILES[mode] ?? JOURNEY_VIDEO_RENDER_PROFILES.preview;
  const layout = normalizeJourneyVideoLayout(source.layout ?? defaults.layout);
  const fps = positiveNumber(source.fps, defaults.fps);
  const seconds = positiveNumber(source.seconds, defaults.seconds);
  const frameCount = positiveInteger(source.frameCount ?? source.frames, Math.ceil(seconds * fps));
  const browser = JOURNEY_VIDEO_BROWSER_IDS.includes(String(source.browser))
    ? String(source.browser)
    : defaults.browser;
  return {
    mode: defaults.mode,
    layout,
    fps,
    seconds,
    frameCount,
    browser,
    crf: clamp(finiteNumber(source.crf, defaults.crf), 0, 51),
    retainFrames: source.retainFrames == null ? defaults.retainFrames : source.retainFrames !== false,
  };
}

/**
 * @param {unknown} journeyInput
 * @param {{ fadeSecs?: number }} [options]
 * @returns {import('./export.d.ts').JourneyVideoOverlayBlock[]}
 */
export function createJourneyVideoOverlayBlocks(journeyInput, options = {}) {
  const journey = normalizeTimedJourney(journeyInput);
  const fadeSecs = Math.max(0, finiteNumber(options.fadeSecs, 0.85));
  return journey.cues.map((cue, index) => ({
    id: String(cue.id ?? `cue-${index}`),
    startSecs: cue.startSecs,
    endSecs: cue.endSecs,
    fadeInSecs: Math.max(0, finiteNumber(cue.fadeInSecs, fadeSecs)),
    fadeOutSecs: Math.max(0, finiteNumber(cue.fadeOutSecs, fadeSecs)),
    eyebrow: String(cue.eyebrow ?? ''),
    title: String(cue.title ?? cue.text ?? cue.id ?? ''),
    body: String(cue.body ?? ''),
  }));
}

/**
 * @param {import('./export.d.ts').JourneyVideoOverlayBlock} block
 * @param {number} timeSecs
 */
export function computeJourneyVideoOverlayOpacity(block, timeSecs) {
  const time = finiteNumber(timeSecs, 0);
  if (time < block.startSecs || time >= block.endSecs) return 0;
  const fadeIn = block.fadeInSecs > 0
    ? clamp((time - block.startSecs) / block.fadeInSecs, 0, 1)
    : 1;
  const fadeOut = block.fadeOutSecs > 0
    ? clamp((block.endSecs - time) / block.fadeOutSecs, 0, 1)
    : 1;
  return Math.min(fadeIn, fadeOut);
}

/**
 * @param {import('./export.d.ts').BuildJourneyVideoFfmpegArgsOptions} options
 */
export function buildJourneyVideoFfmpegArgs(options) {
  const profile = normalizeJourneyVideoRenderProfile(options.profile);
  const blocks = Array.from(options.overlayBlocks ?? []);
  const args = [
    '-y',
    '-framerate',
    String(profile.fps),
    '-i',
    options.skyFramePattern,
  ];
  for (const block of blocks) {
    args.push('-loop', '1', '-t', formatSeconds(Math.max(0.001, block.endSecs - block.startSecs)), '-i', block.assetPath);
  }
  const filter = buildJourneyVideoFfmpegFilter(blocks);
  if (filter) {
    args.push('-filter_complex', filter, '-map', '[v]');
  }
  args.push(
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    String(profile.crf),
    options.outputPath,
  );
  return args;
}

/**
 * @param {Array<import('./export.d.ts').JourneyVideoOverlayBlock & { assetPath: string }>} blocks
 */
export function buildJourneyVideoFfmpegFilter(blocks) {
  if (!blocks.length) return '';
  const parts = ['[0:v]format=rgba[base0]'];
  blocks.forEach((block, index) => {
    const inputIndex = index + 1;
    const duration = Math.max(0.001, block.endSecs - block.startSecs);
    const fadeOutStart = Math.max(0, duration - block.fadeOutSecs);
    parts.push(
      `[${inputIndex}:v]format=rgba`
      + `,fade=t=in:st=0:d=${formatSeconds(block.fadeInSecs)}:alpha=1`
      + `,fade=t=out:st=${formatSeconds(fadeOutStart)}:d=${formatSeconds(block.fadeOutSecs)}:alpha=1`
      + `,setpts=PTS+${formatSeconds(block.startSecs)}/TB[ov${index}]`,
    );
    parts.push(
      `[base${index}][ov${index}]overlay=0:0:enable='between(t,${formatSeconds(block.startSecs)},${formatSeconds(block.endSecs)})'[base${index + 1}]`,
    );
  });
  parts.push(`[base${blocks.length}]format=yuv420p[v]`);
  return parts.join(';');
}

/**
 * @param {unknown} input
 */
export function createJourneyVideoRenderMetadata(input = {}) {
  const source = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  return {
    format: 'fis-journey-video-render-v1',
    generatedAt: new Date().toISOString(),
    ...source,
  };
}

/** @param {import('./export.d.ts').JourneyVideoLayoutProfile} layout */
function cloneLayout(layout) {
  return {
    ...layout,
    text: { ...layout.text },
  };
}

/** @param {unknown} value @param {number} fallback */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function positiveNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

/** @param {unknown} value @param {number} fallback */
function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {number} value */
function formatSeconds(value) {
  return Number(value).toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '') || '0';
}
