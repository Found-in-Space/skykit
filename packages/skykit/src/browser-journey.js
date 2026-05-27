import { createJourney } from '@found-in-space/journey';
import { parseSpatialLookAtText } from '@found-in-space/spatial';

import { SKYKIT_ACTIONS } from './actions.js';
import {
  createSkykitJourneyPlugin,
  createSkykitNavigationPlugin,
} from './plugins.js';

const NAVIGATION_CAPABILITY = 'skykit:navigation';
const JOURNEY_CAPABILITY = 'skykit:browser.journey';
const SOURCE = 'browser.journey';

/**
 * @param {{ browser: import('./browser.d.ts').SkykitBrowser }} context
 * @returns {Promise<import('./browser.d.ts').SkykitBrowserJourneyFacade>}
 */
export async function installSkykitJourneyBrowserCapability({ browser }) {
  browser.capabilities.add(JOURNEY_CAPABILITY);

  return {
    transitionTo(viewOrScene, options) {
      return transitionTo(browser, viewOrScene, options);
    },
    applyScene(sceneSpec) {
      return applyScene(browser, sceneSpec);
    },
    load(input, options) {
      return loadJourney(browser, input, options);
    },
    getSnapshot() {
      return {
        capability: JOURNEY_CAPABILITY,
        navigationInstalled: browser.capabilities.has(NAVIGATION_CAPABILITY),
      };
    },
  };
}

/**
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 */
async function ensureNavigation(browser) {
  if (browser.capabilities.has(NAVIGATION_CAPABILITY)) return;
  await browser.install(createSkykitNavigationPlugin());
  browser.capabilities.add(NAVIGATION_CAPABILITY);
}

/**
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @param {unknown} viewOrScene
 * @param {Record<string, unknown>} [options]
 */
async function transitionTo(browser, viewOrScene, options = {}) {
  await ensureNavigation(browser);
  const payload = normalizeTransitionPayload(viewOrScene, options);
  return browser.viewer.actions.invoke(SKYKIT_ACTIONS.navigation.transitionTo, payload, { source: SOURCE });
}

/**
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @param {unknown} sceneSpec
 */
async function applyScene(browser, sceneSpec) {
  const scene = /** @type {Record<string, unknown> | null} */ (
    sceneSpec && typeof sceneSpec === 'object' ? sceneSpec : null
  );
  if (!scene) return null;
  if (scene.view && typeof scene.view === 'object') {
    browser.viewer.requestViewState(normalizeView(/** @type {Record<string, unknown>} */ (scene.view)), SOURCE);
  }
  const navigation = /** @type {Record<string, unknown> | null} */ (
    scene.navigation && typeof scene.navigation === 'object' ? scene.navigation : null
  );
  if (navigation?.transitionTo) {
    return transitionTo(browser, navigation.transitionTo);
  }
  return scene;
}

/**
 * @param {import('./browser.d.ts').SkykitBrowser} browser
 * @param {unknown} input
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<import('./browser.d.ts').SkykitBrowserJourneyInstance>}
 */
async function loadJourney(browser, input, options = {}) {
  await ensureNavigation(browser);
  const definition = await loadJourneyDefinition(input);
  const plugin = isTimedJourney(definition)
    ? createSkykitJourneyPlugin({
      ...options,
      timedJourney: definition,
    })
    : createSkykitJourneyPlugin({
      ...options,
      journey: createJourney(/** @type {import('@found-in-space/journey').CreateJourneyOptions} */ (definition)),
    });
  const uninstall = await browser.install(plugin);
  let disposed = false;

  return {
    goTo(sceneId) {
      assertActive();
      return plugin.goTo?.(sceneId) ?? Promise.resolve(null);
    },
    next() {
      assertActive();
      return plugin.next?.() ?? Promise.resolve(null);
    },
    previous() {
      assertActive();
      return plugin.previous?.() ?? Promise.resolve(null);
    },
    play(payload) {
      assertActive();
      return plugin.play?.(payload) ?? 0;
    },
    pause() {
      assertActive();
      return plugin.pause?.() ?? 0;
    },
    seek(timeSecs) {
      assertActive();
      return plugin.seek?.({ timeSecs }) ?? 0;
    },
    getSnapshot() {
      return {
        disposed,
        plugin: plugin.getSnapshot?.() ?? null,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      uninstall();
    },
  };

  function assertActive() {
    if (disposed) throw new Error('SkyKit journey instance has been disposed.');
  }
}

/**
 * @param {unknown} input
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadJourneyDefinition(input) {
  if (typeof input === 'string') {
    const response = await fetch(input);
    if (!response.ok) throw new Error(`Failed to load SkyKit journey: ${response.status} ${response.statusText}`);
    return /** @type {Record<string, unknown>} */ (await response.json());
  }
  if (!input || typeof input !== 'object') {
    throw new TypeError('browser.journey.load() requires a URL or journey definition.');
  }
  return /** @type {Record<string, unknown>} */ (input);
}

/** @param {Record<string, unknown>} definition */
function isTimedJourney(definition) {
  return Number.isFinite(Number(definition.durationSecs))
    && (Array.isArray(definition.locationWaypoints)
      || Array.isArray(definition.cameraLookWaypoints)
      || Array.isArray(definition.cameraWaypoints));
}

/**
 * @param {unknown} input
 * @param {Record<string, unknown>} [options]
 */
function normalizeTransitionPayload(input, options = {}) {
  const source = /** @type {Record<string, unknown>} */ (
    input && typeof input === 'object' ? input : { lookAt: input }
  );
  if (source.navigation && typeof source.navigation === 'object') {
    const navigation = /** @type {Record<string, unknown>} */ (source.navigation);
    if (navigation.transitionTo) return normalizeTransitionPayload(navigation.transitionTo, options);
  }
  const viewSource = source.view && typeof source.view === 'object'
    ? /** @type {Record<string, unknown>} */ (source.view)
    : source.to && typeof source.to === 'object'
      ? /** @type {Record<string, unknown>} */ (source.to)
      : stripTransitionOptions(source);
  return {
    ...stripUndefined({
      ...source,
      ...options,
      view: normalizeView(viewSource),
      durationSecs: options.durationSecs ?? source.durationSecs,
    }),
  };
}

/** @param {Record<string, unknown>} input */
function normalizeView(input) {
  const lookAt = input.lookAt ?? (
    hasLookAtShape(input) ? input : undefined
  );
  return {
    ...input,
    ...(lookAt !== undefined ? { lookAt: normalizeLookAt(lookAt) } : {}),
  };
}

/** @param {unknown} input */
function normalizeLookAt(input) {
  if (typeof input !== 'string') return input;
  return parseSpatialLookAtText(input) ?? { star: input };
}

/** @param {Record<string, unknown>} input */
function stripTransitionOptions(input) {
  const {
    durationSecs: _durationSecs,
    movement: _movement,
    orientation: _orientation,
    orientationDurationSecs: _orientationDurationSecs,
    movementDurationSecs: _movementDurationSecs,
    onArrive: _onArrive,
    ...view
  } = input;
  return view;
}

/** @param {Record<string, unknown>} input */
function hasLookAtShape(input) {
  return 'raDeg' in input
    || 'raHours' in input
    || 'decDeg' in input
    || 'targetPc' in input
    || 'orientationIcrs' in input
    || 'star' in input;
}

/** @param {Record<string, unknown>} input */
function stripUndefined(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
