import { createSkykitBrowser } from './browser.js';

const DEFAULT_SELECTOR = '[data-skykit-story]';
const started = new WeakSet();

if (typeof document !== 'undefined') {
  ready(() => {
    for (const host of document.querySelectorAll(DEFAULT_SELECTOR)) {
      if (started.has(host)) continue;
      started.add(host);
      void createSkykitStory(host, readStoryOptions(host))
        .then((story) => reportReady(host, story))
        .catch((error) => reportError(host, error));
    }
  });
}

/**
 * Create an authored chapter tour around the beginner SkyKit browser.
 *
 * @param {import('./story.d.ts').SkykitStoryHost | import('./story.d.ts').SkykitStoryOptions} [input]
 * @param {import('./story.d.ts').SkykitStoryOptions} [options]
 * @returns {Promise<import('./story.d.ts').SkykitStory>}
 */
export async function createSkykitStory(input = {}, options = {}) {
  const storyOptions = normalizeStoryOptions(input, options);
  const host = resolveTarget(storyOptions.host ?? '#viewer', 'SkyKit story host');
  const chapters = await resolveChapters(host, storyOptions);
  const browser = await createSkykitBrowser({
    ...storyOptions,
    host,
  });
  const controls = storyOptions.controls === false
    ? null
    : createControls(host, storyOptions);
  let currentIndex = clampIndex(resolveInitialIndex(chapters, storyOptions.initialChapter), chapters.length);
  let disposed = false;

  /** @type {import('./story.d.ts').SkykitStory} */
  const storyApi = {
    browser,
    viewer: browser.viewer,
    chapters,
    get currentIndex() {
      return currentIndex;
    },
    get currentChapter() {
      return chapters[currentIndex] ?? null;
    },
    next,
    previous,
    goTo,
    dispose,
  };

  hideInlineChapters(host);
  if (controls) bindControls(controls);
  if (chapters.length > 0) {
    goTo(currentIndex);
  } else {
    renderControls(controls, null, -1, 0);
  }

  return storyApi;

  function next() {
    return goTo(Math.min(currentIndex + 1, chapters.length - 1));
  }

  function previous() {
    return goTo(Math.max(currentIndex - 1, 0));
  }

  /**
   * @param {number | string} indexOrId
   */
  function goTo(indexOrId) {
    if (disposed || chapters.length === 0) return null;
    const nextIndex = typeof indexOrId === 'string'
      ? chapters.findIndex((chapter) => chapter.id === indexOrId)
      : indexOrId;
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= chapters.length) {
      throw new RangeError(`SkyKit story chapter not found: ${indexOrId}`);
    }
    currentIndex = nextIndex;
    const chapter = chapters[currentIndex];
    applyChapter(chapter);
    renderControls(controls, chapter, currentIndex, chapters.length);
    const detail = { story: storyApi, chapter, index: currentIndex };
    host.dispatchEvent(new CustomEvent('skykit-story-chapter-change', {
      detail,
      bubbles: true,
    }));
    browser.viewer.emit({
      type: 'story/chapter-change',
      story: storyApi,
      chapter,
      index: currentIndex,
    });
    return chapter;
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    controls?.root.remove();
    await browser.dispose();
  }

  /**
   * @param {import('./story.d.ts').SkykitStoryChapter} chapter
   */
  function applyChapter(chapter) {
    const targetPc = chapter.targetPc ?? chapter.observerPc ?? null;
    browser.viewer.requestViewState({
      ...(targetPc ? { observerPc: targetPc, targetPc } : {}),
      ...(chapter.view ?? {}),
    }, 'story');
  }

  /**
   * @param {ReturnType<typeof createControls>} storyControls
   */
  function bindControls(storyControls) {
    storyControls.previous.addEventListener('click', () => {
      previous();
    });
    storyControls.next.addEventListener('click', () => {
      next();
    });
  }
}

/**
 * @param {Element} host
 * @param {import('./story.d.ts').SkykitStoryOptions} options
 * @returns {Promise<import('./story.d.ts').SkykitStoryChapter[]>}
 */
async function resolveChapters(host, options) {
  if (options.chapters) return normalizeChapters(options.chapters);
  if (options.src) {
    const response = await fetch(options.src);
    if (!response.ok) {
      throw new Error(`SkyKit story could not load ${options.src}: ${response.status}`);
    }
    const json = await response.json();
    const chapters = Array.isArray(json) ? json : json?.chapters;
    return normalizeChapters(chapters ?? []);
  }
  return readInlineChapters(host);
}

/**
 * @param {Element} host
 * @returns {import('./story.d.ts').SkykitStoryChapter[]}
 */
function readInlineChapters(host) {
  return Array.from(host.querySelectorAll('[data-skykit-chapter]'))
    .map((section, index) => {
      const element = /** @type {HTMLElement} */ (section);
      return normalizeChapter({
        id: element.dataset.id ?? element.id ?? `chapter-${index + 1}`,
        title: element.dataset.title ?? element.getAttribute('aria-label') ?? `Chapter ${index + 1}`,
        body: element.textContent?.trim() ?? '',
        bodyHtml: element.innerHTML.trim(),
        targetPc: parseVector3(element.dataset.targetPc),
        observerPc: parseVector3(element.dataset.observerPc),
      }, index);
    });
}

/**
 * @param {Iterable<import('./story.d.ts').SkykitStoryChapterInput>} chapters
 */
function normalizeChapters(chapters) {
  return Array.from(chapters, normalizeChapter);
}

/**
 * @param {import('./story.d.ts').SkykitStoryChapterInput} input
 * @param {number} index
 * @returns {import('./story.d.ts').SkykitStoryChapter}
 */
function normalizeChapter(input, index) {
  const chapter = input ?? {};
  return {
    id: String(chapter.id ?? `chapter-${index + 1}`),
    title: String(chapter.title ?? `Chapter ${index + 1}`),
    body: chapter.body == null ? '' : String(chapter.body),
    bodyHtml: typeof chapter.bodyHtml === 'string' ? chapter.bodyHtml : null,
    targetPc: normalizeOptionalVector3(chapter.targetPc),
    observerPc: normalizeOptionalVector3(chapter.observerPc),
    view: chapter.view ?? null,
    annotations: Array.isArray(chapter.annotations) ? chapter.annotations : [],
  };
}

/**
 * @param {Element} host
 */
function hideInlineChapters(host) {
  for (const section of host.querySelectorAll('[data-skykit-chapter]')) {
    if (section instanceof HTMLElement) section.hidden = true;
  }
}

/**
 * @param {Element} host
 * @param {import('./story.d.ts').SkykitStoryOptions} options
 */
function createControls(host, options) {
  const htmlHost = /** @type {HTMLElement} */ (host);
  if (htmlHost.style && getComputedStyle(htmlHost).position === 'static') {
    htmlHost.style.position = 'relative';
  }
  const root = document.createElement('div');
  const title = document.createElement('h2');
  const body = document.createElement('div');
  const nav = document.createElement('div');
  const previous = document.createElement('button');
  const next = document.createElement('button');

  root.dataset.skykitStoryControls = '';
  title.dataset.skykitStoryTitle = '';
  body.dataset.skykitStoryBody = '';
  previous.type = 'button';
  next.type = 'button';
  previous.textContent = options.previousLabel ?? 'Back';
  next.textContent = options.nextLabel ?? 'Next';
  nav.append(previous, next);
  root.append(title, body, nav);
  applyDefaultControlStyles(root, title, body, nav, previous, next);
  host.appendChild(root);

  return { root, title, body, previous, next };
}

/**
 * @param {ReturnType<typeof createControls> | null} controls
 * @param {import('./story.d.ts').SkykitStoryChapter | null} chapter
 * @param {number} index
 * @param {number} count
 */
function renderControls(controls, chapter, index, count) {
  if (!controls) return;
  controls.title.textContent = chapter?.title ?? 'SkyKit story';
  if (chapter?.bodyHtml) {
    controls.body.innerHTML = chapter.bodyHtml;
  } else {
    controls.body.textContent = chapter?.body ?? '';
  }
  controls.previous.disabled = index <= 0;
  controls.next.disabled = index < 0 || index >= count - 1;
}

function applyDefaultControlStyles(root, title, body, nav, previous, next) {
  Object.assign(root.style, {
    position: 'absolute',
    left: '16px',
    right: '16px',
    bottom: '16px',
    zIndex: '2',
    display: 'grid',
    gap: '10px',
    maxWidth: '34rem',
    padding: '14px',
    border: '1px solid rgba(242, 200, 121, 0.28)',
    borderRadius: '8px',
    background: 'rgba(2, 4, 11, 0.78)',
    color: '#f6f1e8',
    font: '14px system-ui, sans-serif',
    pointerEvents: 'auto',
  });
  Object.assign(title.style, {
    margin: '0',
    color: '#f2c879',
    fontSize: '16px',
    lineHeight: '1.2',
  });
  Object.assign(body.style, {
    color: '#d8deea',
    lineHeight: '1.5',
  });
  Object.assign(nav.style, {
    display: 'flex',
    gap: '8px',
  });
  for (const button of [previous, next]) {
    Object.assign(button.style, {
      border: '1px solid rgba(242, 200, 121, 0.42)',
      borderRadius: '999px',
      background: 'rgba(242, 200, 121, 0.12)',
      color: '#f6f1e8',
      padding: '7px 12px',
      cursor: 'pointer',
    });
  }
}

/**
 * @param {import('./story.d.ts').SkykitStoryHost | import('./story.d.ts').SkykitStoryOptions} input
 * @param {import('./story.d.ts').SkykitStoryOptions} options
 */
function normalizeStoryOptions(input, options) {
  if (typeof input === 'string' || isElementLike(input)) {
    return { ...options, host: input };
  }
  return { ...(input ?? {}), ...options };
}

/**
 * @param {Element} host
 */
function readStoryOptions(host) {
  const data = host instanceof HTMLElement ? host.dataset : {};
  return {
    ...(data.skykitStorySrc ? { src: data.skykitStorySrc } : {}),
    ...(data.skykitMagnitude ? { limitingMagnitude: Number(data.skykitMagnitude) } : {}),
    ...(data.skykitSpeed ? { speedPcPerSec: Number(data.skykitSpeed) } : {}),
    ...(data.skykitExposure ? { exposure: Number(data.skykitExposure) } : {}),
  };
}

/**
 * @param {Element} host
 * @param {import('./story.d.ts').SkykitStory} story
 */
function reportReady(host, story) {
  host.dispatchEvent(new CustomEvent('skykit-story-ready', {
    detail: { story, browser: story.browser, viewer: story.viewer },
    bubbles: true,
  }));
}

/**
 * @param {Element} host
 * @param {unknown} error
 */
function reportError(host, error) {
  host.dispatchEvent(new CustomEvent('skykit-story-error', {
    detail: { error },
    bubbles: true,
  }));
}

function ready(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
    return;
  }
  callback();
}

function resolveTarget(input, label) {
  if (typeof input !== 'string') {
    if (input) return input;
    throw new Error(`${label} is missing.`);
  }
  const target = document.querySelector(input);
  if (!target) throw new Error(`${label} not found: ${input}`);
  return target;
}

function resolveInitialIndex(chapters, initialChapter) {
  if (typeof initialChapter === 'string') {
    return chapters.findIndex((chapter) => chapter.id === initialChapter);
  }
  return Number.isInteger(initialChapter) ? Number(initialChapter) : 0;
}

function clampIndex(index, count) {
  if (count <= 0) return -1;
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, count - 1);
}

function parseVector3(value) {
  if (!value) return null;
  const parts = String(value).split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function normalizeOptionalVector3(value) {
  if (!value || typeof value !== 'object') return null;
  const candidate = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const z = Number(candidate.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function isElementLike(value) {
  return Boolean(value && typeof value === 'object' && 'appendChild' in value);
}
